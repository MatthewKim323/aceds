"""
Integer-programming schedule optimizer.

Problem
-------
Given:
  - a set of candidate sections for a specific quarter,
  - a set of required courses (student must take one section of each),
  - an optional electives pool,
  - per-section predicted GPA, RMP rating, historical fill rate, and calendar
    (days + begin/end time),
  - student preference weights,
pick a subset of sections that:
  (1) covers every required course exactly once,
  (2) covers 0..N electives,
  (3) has no calendar conflicts,
  (4) hits a units window,
  (5) respects earliest-start / latest-end windows,
  (6) maximises a linear blend of {grade, professor, convenience, availability}.

We produce the top-K schedules by iteratively adding "no-good" cuts that
forbid the previously-found section set. For realistic UCSB majors this is
a <1s MILP.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass

import pulp

from ..models.schemas import (
    OptimizeRequest,
    OptimizeResponse,
    ScheduleCandidate,
    SectionPick,
)

log = logging.getLogger(__name__)

DAY_TOKENS = ("M", "T", "W", "R", "F", "S", "U")


# ---------- section candidate shape -----------------------------------------


@dataclass
class SectionCandidate:
    """In-memory representation of a schedulable section."""

    enroll_code: str
    course_norm: str
    instructor_norm: str | None
    days: str  # subset of "MTWRF" possibly empty -> TBA
    begin_min: int | None  # minutes since midnight; None for async
    end_min: int | None
    units: float
    predicted_gpa: float | None
    rmp_rating: float | None
    fill_rate: float | None  # historical 0..1, higher = scarcer
    capacity: int | None

    # derived / convenience
    def is_required_day(self, allowed: set[str]) -> bool:
        if not self.days:
            return True  # TBA / async always allowed
        return set(self.days).issubset(allowed)

    def time_ok(self, earliest_min: int, latest_min: int) -> bool:
        if self.begin_min is None or self.end_min is None:
            return True
        return self.begin_min >= earliest_min and self.end_min <= latest_min

    def is_fri_afternoon(self) -> bool:
        return "F" in self.days and (self.begin_min or 0) >= 12 * 60

    def score_components(self) -> dict[str, float]:
        """Raw 0..1 feature values; weights are applied by the caller."""
        # grade — normalise predicted GPA 0..4 to 0..1 (linear)
        grade = ((self.predicted_gpa or 0.0) / 4.0) if self.predicted_gpa is not None else 0.5
        # professor — RMP 0..5 to 0..1
        prof = ((self.rmp_rating or 0.0) / 5.0) if self.rmp_rating is not None else 0.5
        # convenience — prefer 10-16h, penalise edges
        conv = 0.5
        if self.begin_min is not None:
            hours_from_noon = abs(self.begin_min - 13 * 60) / 60.0
            conv = max(0.0, 1.0 - hours_from_noon / 6.0)
        # availability — inverse fill_rate (seats available beats full sections)
        avail = 0.5 if self.fill_rate is None else max(0.0, 1.0 - float(self.fill_rate))
        return {
            "grade": grade,
            "professor": prof,
            "convenience": conv,
            "availability": avail,
        }


def _time_to_min(s: str | None) -> int | None:
    if not s:
        return None
    try:
        h, m = s.split(":")[:2]
        return int(h) * 60 + int(m)
    except Exception:
        return None


def _sections_conflict(a: SectionCandidate, b: SectionCandidate) -> bool:
    """Return True iff two sections overlap in calendar."""
    if not a.days or not b.days:
        return False  # TBA never conflicts
    if a.begin_min is None or b.begin_min is None or a.end_min is None or b.end_min is None:
        return False
    shared_days = set(a.days) & set(b.days)
    if not shared_days:
        return False
    return not (a.end_min <= b.begin_min or b.end_min <= a.begin_min)


# ---------- main entrypoint --------------------------------------------------


def optimize(
    req: OptimizeRequest,
    candidates_by_course: dict[str, list[SectionCandidate]],
) -> OptimizeResponse:
    """
    `candidates_by_course` maps course_norm -> available section candidates
    for the requested quarter. The caller (FastAPI router) is responsible for
    pulling these from Supabase + scoring them with the predictor.
    """
    prefs = req.preferences
    earliest = _time_to_min(prefs.earliest_start) or 0
    latest = _time_to_min(prefs.latest_end) or (24 * 60)
    allowed_days = set(prefs.preferred_days) if prefs.preferred_days else set("MTWRF")

    # Pre-filter: drop sections that violate hard time/day constraints.
    filtered: dict[str, list[SectionCandidate]] = {}
    for course, secs in candidates_by_course.items():
        keep = [
            s
            for s in secs
            if s.time_ok(earliest, latest)
            and s.is_required_day(allowed_days)
            and not (prefs.avoid_friday_afternoon and s.is_fri_afternoon())
        ]
        if not keep:
            # if a required course has no valid section post-filter, relax day constraint for that course
            keep = [s for s in secs if s.time_ok(earliest, latest)]
        filtered[course] = keep

    # Flatten and index.
    all_sections: list[SectionCandidate] = []
    sec_to_idx: dict[str, int] = {}
    for secs in filtered.values():
        for s in secs:
            if s.enroll_code in sec_to_idx:
                continue
            sec_to_idx[s.enroll_code] = len(all_sections)
            all_sections.append(s)

    if not all_sections:
        return OptimizeResponse(candidates=[])

    # Pre-compute conflict pairs.
    conflict_pairs: list[tuple[int, int]] = []
    for i in range(len(all_sections)):
        for j in range(i + 1, len(all_sections)):
            if _sections_conflict(all_sections[i], all_sections[j]):
                conflict_pairs.append((i, j))

    weights = {
        "grade": prefs.weight_grades,
        "professor": prefs.weight_professor,
        "convenience": prefs.weight_convenience,
        "availability": prefs.weight_availability,
    }

    # Score each section once.
    scores: list[float] = []
    breakdowns: list[dict[str, float]] = []
    for s in all_sections:
        parts = s.score_components()
        breakdowns.append(parts)
        scores.append(sum(weights[k] * parts[k] for k in weights))

    candidates: list[ScheduleCandidate] = []
    banned_sets: list[set[int]] = []

    for _k in range(req.top_k):
        prob = pulp.LpProblem("ace-schedule", pulp.LpMaximize)
        x = [
            pulp.LpVariable(f"x_{i}", lowBound=0, upBound=1, cat="Binary")
            for i in range(len(all_sections))
        ]

        # Objective: weighted score minus a tiny diversity penalty for re-using the same professor across picks
        instr_counts: dict[str, list[int]] = {}
        for i, s in enumerate(all_sections):
            if s.instructor_norm:
                instr_counts.setdefault(s.instructor_norm, []).append(i)

        objective = pulp.lpSum(scores[i] * x[i] for i in range(len(all_sections)))

        # Diversity: penalize every additional pick of the same instructor.
        diversity_terms: list[pulp.LpAffineExpression] = []
        for instr, idxs in instr_counts.items():
            if len(idxs) < 2:
                continue
            # extra = max(0, sum(x) - 1); use aux var for linearity
            aux = pulp.LpVariable(f"extra_{instr}", lowBound=0)
            prob += aux >= pulp.lpSum(x[i] for i in idxs) - 1
            diversity_terms.append(aux)
        if diversity_terms:
            objective -= prefs.diversity_lambda * pulp.lpSum(diversity_terms)
        prob += objective

        # Required courses: exactly one.
        for rc in req.required_courses:
            if rc in req.completed_courses or rc in req.excluded_courses:
                continue
            idxs = [sec_to_idx[s.enroll_code] for s in filtered.get(rc, [])]
            if not idxs:
                log.warning("no sections available for required course %s", rc)
                continue  # soft-fail so we still return a partial schedule
            prob += pulp.lpSum(x[i] for i in idxs) == 1, f"req_{rc}"

        # Optional courses: at most one per course.
        for oc in req.optional_courses:
            if oc in req.completed_courses or oc in req.excluded_courses:
                continue
            idxs = [sec_to_idx[s.enroll_code] for s in filtered.get(oc, [])]
            if not idxs:
                continue
            prob += pulp.lpSum(x[i] for i in idxs) <= 1, f"opt_{oc}"

        # Excluded sections.
        for oc in req.excluded_courses:
            idxs = [sec_to_idx[s.enroll_code] for s in filtered.get(oc, [])]
            for i in idxs:
                prob += x[i] == 0

        # Calendar conflicts.
        for (i, j) in conflict_pairs:
            prob += x[i] + x[j] <= 1

        # Units window.
        total_units = pulp.lpSum(all_sections[i].units * x[i] for i in range(len(all_sections)))
        prob += total_units >= prefs.target_units_min
        prob += total_units <= prefs.target_units_max

        # No-good cuts against previous solutions.
        for banned in banned_sets:
            prob += pulp.lpSum(x[i] for i in banned) <= len(banned) - 1

        solver = pulp.PULP_CBC_CMD(msg=False, timeLimit=10)
        status = prob.solve(solver)
        if pulp.LpStatus[status] != "Optimal":
            log.info("no more feasible schedules after %d solutions", len(candidates))
            break

        chosen = {i for i in range(len(all_sections)) if pulp.value(x[i]) > 0.5}
        if not chosen or chosen in banned_sets:
            break
        banned_sets.append(chosen)

        picks: list[SectionPick] = []
        for i in sorted(chosen, key=lambda k: all_sections[k].course_norm):
            s = all_sections[i]
            picks.append(
                SectionPick(
                    enroll_code=s.enroll_code,
                    course_norm=s.course_norm,
                    instructor_norm=s.instructor_norm,
                    days=s.days or None,
                    begin_time=_min_to_time(s.begin_min),
                    end_time=_min_to_time(s.end_min),
                    predicted_gpa=s.predicted_gpa,
                    rmp_rating=s.rmp_rating,
                    reason=breakdowns[i],
                )
            )
        total_score = float(sum(scores[i] for i in chosen))
        total_units_val = float(sum(all_sections[i].units for i in chosen))
        candidates.append(
            ScheduleCandidate(
                score=total_score,
                total_units=total_units_val,
                sections=picks,
                explanation={
                    "weights": weights,
                    "diversity_lambda": prefs.diversity_lambda,
                    "n_sections": len(picks),
                },
            )
        )

    return OptimizeResponse(candidates=candidates)


def _min_to_time(m: int | None) -> str | None:
    if m is None:
        return None
    h = m // 60
    mm = m % 60
    return f"{h:02d}:{mm:02d}"
