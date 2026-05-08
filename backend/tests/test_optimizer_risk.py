from __future__ import annotations

from app.ml.optimizer import SectionCandidate, optimize
from app.models.schemas import OptimizePreferences, OptimizeRequest, PredictResponse
from app.models.schemas import Prediction


def _sec(
    enroll: str,
    course: str,
    *,
    days: str,
    gpa: float,
    half_w: float,
    regime: str,
) -> SectionCandidate:
    lo = max(0.0, gpa - half_w)
    hi = min(4.0, gpa + half_w)
    return SectionCandidate(
        enroll_code=enroll,
        course_norm=course,
        section_label=None,
        instructor_norm="T",
        days=days,
        begin_min=10 * 60,
        end_min=11 * 60,
        units=4.0,
        predicted_gpa=gpa,
        rmp_rating=4.0,
        fill_rate=0.5,
        capacity=100,
        predicted_gpa_std=half_w / 1.645,
        regime=regime,
        gpa_lo=lo,
        gpa_hi=hi,
        interval_half_width=half_w,
    )


def test_risk_lambda_lowers_total_score_on_toy() -> None:
    prefs0 = OptimizePreferences(
        target_units_min=4,
        target_units_max=22,
        weight_grades=1.0,
        weight_professor=0.0,
        weight_convenience=0.0,
        weight_availability=0.0,
        risk_lambda=0.0,
    )
    prefs1 = OptimizePreferences(**{**prefs0.model_dump(), "risk_lambda": 0.75})
    req = OptimizeRequest(
        quarter_code="20262",
        major_id="pytest",
        required_courses=["A", "B"],
        optional_courses=[],
        preferences=prefs0,
        top_k=1,
    )
    by_course = {
        "A": [_sec("e1", "A", days="M", gpa=3.2, half_w=0.4, regime="cold_both")],
        "B": [_sec("e2", "B", days="W", gpa=3.2, half_w=0.1, regime="warm")],
    }
    pred = PredictResponse(
        predictions=[
            Prediction(
                enroll_code="e1",
                course_norm="A",
                predicted_gpa=3.2,
                predicted_gpa_std=0.3,
                regime="cold_both",
                gpa_lo=2.8,
                gpa_hi=3.6,
                interval_half_width=0.4,
            ),
            Prediction(
                enroll_code="e2",
                course_norm="B",
                predicted_gpa=3.2,
                predicted_gpa_std=0.1,
                regime="warm",
                gpa_lo=3.1,
                gpa_hi=3.3,
                interval_half_width=0.1,
            ),
        ],
        model_version="test",
        conformal_method="n/a",
    )
    out0 = optimize(req, by_course, pred)
    out1 = optimize(req.model_copy(update={"preferences": prefs1}), by_course, pred)
    assert out0.candidates and out1.candidates
    assert out1.candidates[0].score < out0.candidates[0].score
