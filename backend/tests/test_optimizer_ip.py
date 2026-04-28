from __future__ import annotations

from app.ml.optimizer import SectionCandidate, optimize
from app.models.schemas import OptimizePreferences, OptimizeRequest


def _sec(
    enroll: str,
    course: str,
    days: str,
    begin_min: int,
    end_min: int,
    *,
    units: float = 4.0,
    gpa: float = 3.5,
) -> SectionCandidate:
    return SectionCandidate(
        enroll_code=enroll,
        course_norm=course,
        instructor_norm="TEST PROF",
        days=days,
        begin_min=begin_min,
        end_min=end_min,
        units=units,
        predicted_gpa=gpa,
        rmp_rating=4.0,
        fill_rate=0.5,
        capacity=100,
        predicted_gpa_std=0.22,
        regime="warm",
    )


def test_optimize_two_required_non_overlapping() -> None:
    prefs = OptimizePreferences(target_units_min=4, target_units_max=22)
    req = OptimizeRequest(
        quarter_code="20262",
        major_id="pytest",
        required_courses=["C1", "C2"],
        optional_courses=[],
        preferences=prefs,
        top_k=2,
    )
    by_course = {
        "C1": [_sec("e1", "C1", "M", 10 * 60, 11 * 60)],
        "C2": [_sec("e2", "C2", "W", 10 * 60, 11 * 60)],
    }
    out = optimize(req, by_course)
    assert len(out.candidates) >= 1
    codes = {s.enroll_code for s in out.candidates[0].sections}
    assert codes == {"e1", "e2"}


def test_optimize_infeasible_time_conflict() -> None:
    prefs = OptimizePreferences(target_units_min=4, target_units_max=22)
    req = OptimizeRequest(
        quarter_code="20262",
        major_id="pytest",
        required_courses=["C1", "C2"],
        optional_courses=[],
        preferences=prefs,
        top_k=2,
    )
    # Same day, overlapping minutes → cannot pick both.
    by_course = {
        "C1": [_sec("e1", "C1", "M", 10 * 60, 11 * 60)],
        "C2": [_sec("e2", "C2", "M", 10 * 60 + 30, 11 * 60 + 30)],
    }
    out = optimize(req, by_course)
    assert len(out.candidates) == 0
