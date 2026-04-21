from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from ..db import get_supabase

router = APIRouter(prefix="/courses", tags=["courses"])


@router.get("")
async def list_courses(
    dept: str | None = Query(default=None, description="Department code, e.g. CMPSC"),
    ge: str | None = Query(default=None, description="GE area, e.g. A1"),
    level: str | None = Query(default=None, pattern="^(lower|upper|grad)$"),
    search: str | None = Query(default=None, description="Title substring"),
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
):
    sb = get_supabase()
    q = sb.table("courses").select("*", count="exact")
    if dept:
        q = q.eq("dept", dept.upper())
    if level:
        q = q.eq("level", level)
    if ge:
        q = q.contains("ge_areas", [ge.upper()])
    if search:
        q = q.ilike("title", f"%{search}%")
    q = q.order("course_norm").range(offset, offset + limit - 1)
    res = q.execute()
    return {"items": res.data or [], "total": res.count or 0, "limit": limit, "offset": offset}


@router.get("/{course_norm}")
async def get_course(course_norm: str):
    sb = get_supabase()
    res = sb.table("courses").select("*").eq("course_norm", course_norm).maybe_single().execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="course not found")
    return res.data
