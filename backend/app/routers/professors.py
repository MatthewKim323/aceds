from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from ..db import get_supabase

router = APIRouter(prefix="/professors", tags=["professors"])


@router.get("")
async def list_professors(
    dept: str | None = Query(default=None),
    search: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
):
    sb = get_supabase()
    q = sb.table("professors").select("*", count="exact")
    if dept:
        q = q.eq("rmp_department", dept)
    if search:
        q = q.ilike("display_name", f"%{search}%")
    q = q.order("display_name").range(offset, offset + limit - 1)
    res = q.execute()
    return {"items": res.data or [], "total": res.count or 0, "limit": limit, "offset": offset}


@router.get("/{instructor_norm}")
async def get_professor(instructor_norm: str):
    sb = get_supabase()
    prof = (
        sb.table("professors")
        .select("*")
        .eq("instructor_norm", instructor_norm)
        .maybe_single()
        .execute()
    )
    if not prof.data:
        raise HTTPException(status_code=404, detail="professor not found")
    history = (
        sb.table("grade_distributions")
        .select("*")
        .eq("instructor_norm", instructor_norm)
        .order("year", desc=True)
        .order("quarter")
        .limit(200)
        .execute()
    )
    return {"professor": prof.data, "history": history.data or []}
