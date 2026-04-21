from __future__ import annotations

from fastapi import APIRouter, HTTPException

from ..db import get_supabase

router = APIRouter(prefix="/majors", tags=["majors"])


@router.get("")
async def list_majors(reviewed_only: bool = True):
    sb = get_supabase()
    q = sb.table("major_requirements").select("major_id,name,degree,department,college,catalog_year,reviewed")
    if reviewed_only:
        q = q.eq("reviewed", True)
    res = q.order("name").execute()
    return {"items": res.data or []}


@router.get("/{major_id}")
async def get_major(major_id: str):
    sb = get_supabase()
    res = sb.table("major_requirements").select("*").eq("major_id", major_id).maybe_single().execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="major not found")
    return res.data
