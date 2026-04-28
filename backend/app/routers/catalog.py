"""Live course catalog from UCSB Academic Curriculums API (developer.ucsb.edu)."""

from __future__ import annotations

import logging

import httpx
from fastapi import APIRouter, HTTPException, Query

from ..config import get_settings
from ..ucsb_curriculum import (
    default_catalog_quarter,
    dept_codes_for_fetch,
    filter_catalog_rows,
    get_or_fetch_catalog,
    quarter_label,
)

log = logging.getLogger(__name__)

router = APIRouter(prefix="/catalog", tags=["catalog"])


@router.get("/meta")
async def catalog_meta(quarter: str | None = Query(default=None, description="YYYYQ; default = heuristic")):
    s = get_settings()
    q = (quarter or "").strip() or default_catalog_quarter()
    depts = dept_codes_for_fetch()
    return {
        "quarter": q,
        "label": quarter_label(q),
        "ucsb_api_configured": bool((s.ucsb_api_key or "").strip()),
        "department_fetch_count": len(depts),
        "department_codes": depts,
        "source": "ucsb-api",
    }


@router.get("/courses")
async def list_catalog_courses(
    quarter: str | None = Query(default=None, description="YYYYQ, e.g. 20263"),
    dept: str | None = Query(default=None),
    ge: str | None = Query(default=None),
    level: str | None = Query(default=None, pattern="^(lower|upper|grad)$"),
    search: str | None = Query(default=None),
    limit: int = Query(default=500, ge=1, le=50_000),
    offset: int = Query(default=0, ge=0),
):
    q = (quarter or "").strip() or default_catalog_quarter()
    try:
        all_rows = await get_or_fetch_catalog(q)
    except RuntimeError as e:
        log.warning("catalog.fetch_config", error=str(e))
        raise HTTPException(status_code=503, detail=str(e)) from e
    except httpx.HTTPStatusError as e:
        log.exception("catalog.fetch_http")
        raise HTTPException(
            status_code=502,
            detail=f"UCSB curriculum API returned {e.response.status_code}",
        ) from e
    except httpx.RequestError as e:
        log.exception("catalog.fetch_network")
        raise HTTPException(status_code=502, detail=f"UCSB API unreachable: {e}") from e

    filtered = filter_catalog_rows(all_rows, dept=dept, ge=ge, level=level, search=search)
    total = len(filtered)
    page = filtered[offset : offset + limit]
    return {
        "items": page,
        "total": total,
        "limit": limit,
        "offset": offset,
        "quarter": q,
        "label": quarter_label(q),
        "source": "ucsb-api",
    }
