from __future__ import annotations

import hashlib
import json
import logging
import time
from collections import defaultdict
from collections.abc import Iterable

from fastapi import APIRouter, HTTPException

from ..db import get_supabase
from ..ml.conformal import conformal_method_label
from ..ml.model_meta import predictor_id
from ..models.schemas import (
    OptimizeRequest,
    OptimizeResponse,
    PredictRequest,
    ScheduleCandidate,
    SectionPick,
)

log = logging.getLogger(__name__)

router = APIRouter(prefix="/optimize", tags=["ml"])


def _fingerprint(req: OptimizeRequest) -> str:
    payload = req.model_dump(mode="json", exclude={"user_id"})
    raw = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(raw).hexdigest()[:40]


def _log_optimization_run(
    *,
    user_id: str | None,
    request_hash: str,
    quarter_code: str,
    model_version: str,
    conformal_method: str,
    summary: dict,
    duration_ms: int,
) -> None:
    if not user_id:
        return
    try:
        sb = get_supabase()
        sb.table("optimization_runs").insert(
            {
                "user_id": user_id,
                "request_hash": request_hash,
                "quarter_code": quarter_code,
                "model_version": model_version,
                "conformal_method": conformal_method,
                "summary": summary,
                "duration_ms": duration_ms,
            }
        ).execute()
    except Exception as e:
        log.warning("optimization_runs insert skipped: %s", e)


@router.post("", response_model=OptimizeResponse)
async def optimize(req: OptimizeRequest) -> OptimizeResponse:
    try:
        from ..ml.optimizer import SectionCandidate
        from ..ml.optimizer import optimize as run_ip
        from ..ml.predictor import predict_sections
    except ImportError as e:
        raise HTTPException(status_code=503, detail=f"optimizer unavailable: {e}") from e

    sb = get_supabase()
    t0 = time.perf_counter()
    fp = _fingerprint(req)

    course_filter = list(
        {*(req.required_courses or []), *(req.optional_courses or [])}
    )
    if not course_filter:
        return OptimizeResponse(
            candidates=[],
            model_version=predictor_id(),
            conformal_method=conformal_method_label(),
        )

    rows = (
        sb.table("sections")
        .select("enroll_code, course_norm, instructor_norm, days, begin_time, end_time, max_enroll, enrolled, open_seats, courses(units_fixed)")
        .in_("course_norm", course_filter)
        .eq("quarter_code", req.quarter_code)
        .execute()
        .data
        or []
    )
    instrs = sorted({r.get("instructor_norm") for r in rows if r.get("instructor_norm")})
    prof_by_norm: dict[str, dict] = {}
    if instrs:
        pres = (
            sb.table("professors")
            .select("instructor_norm, rmp_rating, rmp_num_ratings, rmp_difficulty")
            .in_("instructor_norm", instrs)
            .execute()
            .data
            or []
        )
        prof_by_norm = {p["instructor_norm"]: p for p in pres}
    if not rows:
        return OptimizeResponse(
            candidates=[],
            model_version=predictor_id(),
            conformal_method=conformal_method_label(),
        )

    # Predict for every section in one batch.
    section_ids = [r["enroll_code"] for r in rows]
    try:
        pred_resp = predict_sections(
            PredictRequest(section_ids=section_ids, quarter_code=req.quarter_code)
        )
        pred_map = {p.enroll_code: p for p in pred_resp.predictions}
    except FileNotFoundError:
        pred_resp = None
        pred_map = {}

    by_course: dict[str, list[SectionCandidate]] = defaultdict(list)
    for r in rows:
        course = r["course_norm"]
        course_info = r.get("courses") or {}
        inm = r.get("instructor_norm")
        prof = (prof_by_norm.get(inm) or {}) if inm else {}
        p = pred_map.get(r["enroll_code"])
        by_course[course].append(
            SectionCandidate(
                enroll_code=r["enroll_code"],
                course_norm=course,
                instructor_norm=r.get("instructor_norm"),
                days=r.get("days") or "",
                begin_min=_to_min(r.get("begin_time")),
                end_min=_to_min(r.get("end_time")),
                units=float(course_info.get("units_fixed") or r.get("units") or 4.0),
                predicted_gpa=(p.predicted_gpa if p else None),
                rmp_rating=prof.get("rmp_rating"),
                fill_rate=r.get("fill_rate"),
                capacity=r.get("max_enroll"),
                predicted_gpa_std=(p.predicted_gpa_std if p else None),
                regime=(p.regime if p else None),
                gpa_lo=(p.gpa_lo if p else None),
                gpa_hi=(p.gpa_hi if p else None),
                interval_half_width=(p.interval_half_width if p else None),
            )
        )

    out = run_ip(req, by_course, pred_resp)
    out = _enrich_schedule_candidates(sb, out, prof_by_norm)
    elapsed_ms = int((time.perf_counter() - t0) * 1000)
    best = out.candidates[0].score if out.candidates else None
    _log_optimization_run(
        user_id=req.user_id,
        request_hash=fp,
        quarter_code=req.quarter_code,
        model_version=out.model_version,
        conformal_method=out.conformal_method,
        summary={
            "n_candidates": len(out.candidates),
            "best_score": best,
            "risk_lambda": req.preferences.risk_lambda,
            "n_section_rows": len(rows),
        },
        duration_ms=elapsed_ms,
    )
    return out


def _weighted_grade(rows: Iterable[dict]) -> tuple[float | None, int]:
    num = 0.0
    den = 0
    for r in rows:
        ag = r.get("avg_gpa")
        n = r.get("n_letter") or 0
        if ag is None or n <= 0:
            continue
        num += float(ag) * int(n)
        den += int(n)
    return (num / den if den else None, den)


def _course_grade_aggregates(sb, course_norms: list[str]) -> dict[str, tuple[float | None, int]]:
    if not course_norms:
        return {}
    res = (
        sb.table("grade_distributions")
        .select("course_norm,avg_gpa,n_letter")
        .in_("course_norm", course_norms)
        .execute()
    )
    by_course: dict[str, list[dict]] = defaultdict(list)
    for r in res.data or []:
        by_course[r["course_norm"]].append(r)
    out: dict[str, tuple[float | None, int]] = {}
    for cn, rows in by_course.items():
        avg, n = _weighted_grade(rows)
        out[cn] = (avg, n)
    return out


def _pair_grade_aggregates(
    sb,
    pairs: set[tuple[str, str]],
) -> dict[tuple[str, str], tuple[float | None, int]]:
    if not pairs:
        return {}
    courses = list({p[0] for p in pairs})
    res = (
        sb.table("grade_distributions")
        .select("course_norm,instructor_norm,avg_gpa,n_letter")
        .in_("course_norm", courses)
        .execute()
    )
    by_pair: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for r in res.data or []:
        key = (r["course_norm"], r["instructor_norm"])
        if key in pairs:
            by_pair[key].append(r)
    return {k: _weighted_grade(rows) for k, rows in by_pair.items()}


def _enrich_schedule_candidates(
    sb,
    resp: OptimizeResponse,
    prof_by_norm: dict[str, dict],
) -> OptimizeResponse:
    """Attach historical Nexus aggregates + full RMP fields for the results UI."""
    if not resp.candidates:
        return resp

    pairs: set[tuple[str, str]] = set()
    courses: set[str] = set()
    for cand in resp.candidates:
        for sec in cand.sections:
            courses.add(sec.course_norm)
            if sec.instructor_norm:
                pairs.add((sec.course_norm, sec.instructor_norm))

    c_agg = _course_grade_aggregates(sb, list(courses))
    p_agg = _pair_grade_aggregates(sb, pairs)

    new_cands: list[ScheduleCandidate] = []
    for cand in resp.candidates:
        new_secs: list[SectionPick] = []
        for sec in cand.sections:
            ca, cn = c_agg.get(sec.course_norm, (None, 0))
            pa, pn = (None, 0)
            if sec.instructor_norm:
                pa, pn = p_agg.get((sec.course_norm, sec.instructor_norm), (None, 0))
            prof = prof_by_norm.get(sec.instructor_norm or "") or {}
            new_secs.append(
                sec.model_copy(
                    update={
                        "course_hist_avg_gpa": ca,
                        "course_hist_n_letter": cn or None,
                        "pair_hist_avg_gpa": pa,
                        "pair_hist_n_letter": pn or None,
                        "rmp_num_ratings": prof.get("rmp_num_ratings"),
                        "rmp_difficulty": prof.get("rmp_difficulty"),
                    }
                )
            )
        new_cands.append(cand.model_copy(update={"sections": new_secs}))
    return OptimizeResponse(
        candidates=new_cands,
        model_version=resp.model_version,
        conformal_method=resp.conformal_method,
    )


def _to_min(s: str | None) -> int | None:
    if not s:
        return None
    try:
        h, m = s.split(":")[:2]
        return int(h) * 60 + int(m)
    except Exception:
        return None
