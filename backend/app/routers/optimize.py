from __future__ import annotations

import logging
from collections import defaultdict

from fastapi import APIRouter, HTTPException

from ..db import get_supabase
from ..models.schemas import (
    OptimizeRequest,
    OptimizeResponse,
    PredictRequest,
)

log = logging.getLogger(__name__)

router = APIRouter(prefix="/optimize", tags=["ml"])


@router.post("", response_model=OptimizeResponse)
async def optimize(req: OptimizeRequest) -> OptimizeResponse:
    try:
        from ..ml.optimizer import SectionCandidate, optimize as run_ip
        from ..ml.predictor import predict_sections
    except ImportError as e:
        raise HTTPException(status_code=503, detail=f"optimizer unavailable: {e}")

    sb = get_supabase()

    course_filter = list(
        {*(req.required_courses or []), *(req.optional_courses or [])}
    )
    if not course_filter:
        return OptimizeResponse(candidates=[])

    rows = (
        sb.table("sections")
        .select(
            "*, courses(units_fixed), professors(rmp_rating)"
        )
        .in_("course_norm", course_filter)
        .eq("quarter_code", req.quarter_code)
        .execute()
        .data
        or []
    )
    if not rows:
        return OptimizeResponse(candidates=[])

    # Predict for every section in one batch.
    section_ids = [r["enroll_code"] for r in rows]
    try:
        pred_resp = predict_sections(
            PredictRequest(section_ids=section_ids, quarter_code=req.quarter_code)
        )
        pred_map = {p.enroll_code: p for p in pred_resp.predictions}
    except FileNotFoundError:
        pred_map = {}

    by_course: dict[str, list[SectionCandidate]] = defaultdict(list)
    for r in rows:
        course = r["course_norm"]
        course_info = r.get("courses") or {}
        prof = r.get("professors") or {}
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
            )
        )

    return run_ip(req, by_course)


def _to_min(s: str | None) -> int | None:
    if not s:
        return None
    try:
        h, m = s.split(":")[:2]
        return int(h) * 60 + int(m)
    except Exception:
        return None
