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


@router.get("/distinct-course-norms")
async def distinct_course_norms(
    quarter: str = Query(..., description="Quarter code, e.g. 20262"),
):
    """Unique course_norm values that have at least one section row this quarter (schedule optimizer scope)."""
    sb = get_supabase()
    seen: set[str] = set()
    offset = 0
    page = 1000
    while True:
        res = (
            sb.table("sections")
            .select("course_norm")
            .eq("quarter_code", quarter)
            .order("course_norm")
            .range(offset, offset + page - 1)
            .execute()
        )
        rows = res.data or []
        if not rows:
            break
        for r in rows:
            cn = r.get("course_norm")
            if cn:
                seen.add(cn)
        if len(rows) < page:
            break
        offset += page
    norms = sorted(seen)
    return {"quarter_code": quarter, "course_norms": norms, "n": len(norms)}


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
