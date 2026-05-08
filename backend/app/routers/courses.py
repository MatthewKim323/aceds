from __future__ import annotations

from urllib.parse import unquote

from fastapi import APIRouter, HTTPException, Query

from ..db import get_supabase

router = APIRouter(prefix="/courses", tags=["courses"])


def _norm_course_norm(s: str) -> str:
    """Match pipeline / explorer: collapse whitespace, uppercase."""
    return " ".join(str(s).strip().upper().split())


def _search_or_title_course_norm(search: str) -> str:
    """PostgREST or() clause: match title or course_norm (ilike)."""
    s = search.strip()
    if not s:
        return ""
    # Wildcards in user input would broaden ilike — escape % and _.
    esc = s.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    pat = f"%{esc}%"
    return f"title.ilike.{pat},course_norm.ilike.{pat}"


@router.get("")
async def list_courses(
    dept: str | None = Query(default=None, description="Department code, e.g. CMPSC"),
    ge: str | None = Query(default=None, description="GE area, e.g. A1, ETH, WRT"),
    level: str | None = Query(default=None, pattern="^(lower|upper|grad)$"),
    search: str | None = Query(default=None, description="Substring on title or course_norm"),
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
):
    sb = get_supabase()
    q = sb.table("courses").select("*", count="exact")
    if dept:
        q = q.eq("dept", dept.upper().strip())
    if level:
        q = q.eq("level", level)
    if ge:
        # Overlap with one-tag array — works for ETH/WRT/B/A1 etc.; contains() missed many rows.
        q = q.overlaps("ge_areas", [ge.upper().strip()])
    if search and search.strip():
        q = q.or_(_search_or_title_course_norm(search))
    q = q.order("course_norm").range(offset, offset + limit - 1)
    res = q.execute()
    return {"items": res.data or [], "total": res.count or 0, "limit": limit, "offset": offset}


@router.get("/{course_norm}")
async def get_course(
    course_norm: str,
    quarter: str | None = Query(
        default=None,
        description="YYYYQ — used to fill from UCSB catalog cache when Supabase has no row yet",
    ),
):
    """Course metadata: prefer Supabase (`courses`); else same-quarter catalog cache as Explorer list."""
    raw = unquote(course_norm).strip()
    key = _norm_course_norm(raw)
    sb = get_supabase()
    res = sb.table("courses").select("*").eq("course_norm", key).maybe_single().execute()
    if res.data:
        return res.data
    res2 = sb.table("courses").select("*").eq("course_norm", raw).maybe_single().execute()
    if res2.data:
        return res2.data

    q = (quarter or "").strip()
    if q:
        try:
            from ..ucsb_curriculum import get_or_fetch_catalog

            rows = await get_or_fetch_catalog(q)
            for r in rows:
                cn = str(r.get("course_norm") or "")
                if _norm_course_norm(cn) == key:
                    out = dict(r)
                    out["detail_source"] = "ucsb_catalog_cache"
                    out["course_norm"] = key
                    return out
        except Exception:
            pass

    raise HTTPException(status_code=404, detail="course not found")
