from __future__ import annotations

from fastapi import APIRouter, Query

from ..db import get_supabase

router = APIRouter(prefix="/trends", tags=["trends"])


@router.get("/grades")
async def grade_trend(course_norm: str = Query(...)):
    sb = get_supabase()
    res = (
        sb.table("grade_distributions")
        .select("year,quarter,instructor_norm,avg_gpa,n_letter")
        .eq("course_norm", course_norm)
        .order("year", desc=False)
        .order("quarter")
        .execute()
    )
    return {"course_norm": course_norm, "points": res.data or []}
