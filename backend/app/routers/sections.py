from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from ..db import get_supabase

router = APIRouter(prefix="/sections", tags=["sections"])


@router.get("")
async def list_sections(
    quarter: str = Query(..., description="Quarter code, e.g. 20262"),
    dept: str | None = Query(default=None),
    course: str | None = Query(default=None, description="Exact course_norm"),
    open_only: bool = Query(default=False),
    limit: int = Query(default=100, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
):
    sb = get_supabase()
    q = sb.table("sections").select("*", count="exact").eq("quarter_code", quarter)
    if course:
        q = q.eq("course_norm", course)
    elif dept:
        q = q.ilike("course_norm", f"{dept.upper()}%")
    if open_only:
        q = q.gt("open_seats", 0)
    q = q.order("course_norm").order("section_label").range(offset, offset + limit - 1)
    res = q.execute()
    return {"items": res.data or [], "total": res.count or 0, "limit": limit, "offset": offset}


@router.get("/{enroll_code}")
async def get_section(enroll_code: str, quarter: str = Query(...)):
    sb = get_supabase()
    res = (
        sb.table("sections")
        .select("*")
        .eq("enroll_code", enroll_code)
        .eq("quarter_code", quarter)
        .maybe_single()
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="section not found")
    return res.data
