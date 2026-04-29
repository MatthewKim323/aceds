#!/usr/bin/env python3
"""
Decision-layer ablation: mean-only (risk_lambda=0) vs risk-aware (risk_lambda>0) on toy MILPs.

Imports the backend optimizer in-process (same as 20_ablation_plots.py).

Output: data_pipeline/processed/decision_eval_synthetic.json

Usage:
  python data_pipeline/scripts/23_decision_eval_synthetic.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from app.ml.optimizer import SectionCandidate, optimize  # noqa: E402
from app.models.schemas import OptimizePreferences, OptimizeRequest  # noqa: E402
from app.models.schemas import PredictResponse  # noqa: E402
from app.models.schemas import Prediction  # noqa: E402


def _sec(
    enroll: str,
    course: str,
    *,
    gpa: float,
    half_w: float,
    regime: str = "warm",
    days: str = "M",
) -> SectionCandidate:
    lo = max(0.0, gpa - half_w)
    hi = min(4.0, gpa + half_w)
    return SectionCandidate(
        enroll_code=enroll,
        course_norm=course,
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


def run_case(risk_lambda: float) -> dict:
    prefs = OptimizePreferences(
        target_units_min=4,
        target_units_max=22,
        weight_grades=1.0,
        weight_professor=0.0,
        weight_convenience=0.0,
        weight_availability=0.0,
        risk_lambda=risk_lambda,
    )
    req = OptimizeRequest(
        quarter_code="20262",
        major_id="synth",
        required_courses=["A", "B"],
        optional_courses=[],
        preferences=prefs,
        top_k=1,
    )
    # Same point GPA, different uncertainty → risk-aware should prefer B when lambda>0
    by_course = {
        "A": [_sec("e1", "A", gpa=3.2, half_w=0.4, regime="cold_both", days="M")],
        "B": [_sec("e2", "B", gpa=3.2, half_w=0.1, regime="warm", days="W")],
    }
    fake_pred = PredictResponse(
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
        model_version="synthetic_eval",
        conformal_method="n/a",
    )
    out = optimize(req, by_course, fake_pred)
    cand0 = out.candidates[0] if out.candidates else None
    picks = [s.enroll_code for s in cand0.sections] if cand0 else []
    return {
        "risk_lambda": risk_lambda,
        "picked": picks,
        "total_score": cand0.score if cand0 else None,
    }


def main() -> None:
    a = run_case(0.0)
    b = run_case(0.75)
    results = {
        "description": "Toy MILP: two required courses, same calendar day offset, identical predicted GPA, different interval half-width. Risk-aware lowers total objective when grade weight dominates.",
        "mean_only": a,
        "risk_aware": b,
        "total_score_delta": (b.get("total_score") or 0) - (a.get("total_score") or 0),
    }
    out_path = ROOT / "data_pipeline" / "processed" / "decision_eval_synthetic.json"
    out_path.write_text(json.dumps(results, indent=2))
    print(json.dumps(results, indent=2))
    print("wrote", out_path)


if __name__ == "__main__":
    main()
