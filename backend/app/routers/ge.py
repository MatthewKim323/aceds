from __future__ import annotations

from fastapi import APIRouter, Query

from ..db import get_supabase

router = APIRouter(prefix="/ge", tags=["ge"])


@router.get("")
async def list_ge_courses(
    area: str = Query(..., description="GE area code, e.g. A1, D, E"),
    sort: str = Query(default="avg_gpa_desc", pattern="^(avg_gpa_desc|avg_gpa_asc|code)$"),
    limit: int = Query(default=100, ge=1, le=500),
):
    sb = get_supabase()
    res = (
        sb.table("courses")
        .select("course_norm,title,dept,level,units_fixed,ge_areas")
        .contains("ge_areas", [area.upper()])
        .order("course_norm")
        .limit(limit)
        .execute()
    )
    return {"area": area.upper(), "items": res.data or []}
