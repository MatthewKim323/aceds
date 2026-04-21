from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from fastapi import APIRouter

from ..db import get_supabase

router = APIRouter(tags=["meta"])

ARTIFACT_DIR = Path(__file__).resolve().parents[1] / "ml" / "artifacts"


@router.get("/")
async def root() -> dict:
    return {"name": "ace-backend", "status": "ok"}


@router.get("/health")
async def health() -> dict:
    return {"status": "ok"}


@lru_cache(maxsize=1)
def _model_metadata() -> dict:
    report = ARTIFACT_DIR / "xgb_report.json"
    if not report.exists():
        return {"trained": False}
    try:
        data = json.loads(report.read_text())
    except Exception:
        return {"trained": False, "error": "failed to parse xgb_report.json"}
    return {"trained": True, **data}


@router.get("/status")
async def status() -> dict:
    """Fat status endpoint powering the /status page."""
    model = _model_metadata()

    supabase_tables = {}
    supabase_error: str | None = None
    try:
        sb = get_supabase()
        for t in ("courses", "professors", "grade_distributions", "sections", "major_requirements"):
            try:
                res = sb.table(t).select("*", count="exact", head=True).execute()
                supabase_tables[t] = res.count or 0
            except Exception as e:  # table missing or RLS blocks
                supabase_tables[t] = -1
                supabase_error = supabase_error or str(e)
    except Exception as e:
        supabase_error = str(e)

    refresh_log: list[dict] = []
    try:
        sb = get_supabase()
        res = (
            sb.table("data_refresh_log")
            .select("*")
            .order("ran_at", desc=True)
            .limit(10)
            .execute()
        )
        refresh_log = res.data or []
    except Exception:
        refresh_log = []

    return {
        "status": "ok",
        "model": model,
        "supabase": {
            "tables": supabase_tables,
            "error": supabase_error,
        },
        "refresh_log": refresh_log,
    }
