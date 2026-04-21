from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException

from ..db import get_supabase

router = APIRouter(prefix="/schedules", tags=["schedules"])


def _require_user(authorization: str | None) -> str:
    """
    Placeholder: validates Supabase JWT and returns user_id.

    For v0.1 we expect the client to send the user_id via header, and RLS in
    Supabase itself is what enforces safety once we wire real JWT middleware.
    """
    if not authorization:
        raise HTTPException(status_code=401, detail="missing Authorization header")
    if authorization.startswith("Bearer dev-"):
        return authorization.split("-", 1)[1]
    raise HTTPException(status_code=501, detail="JWT validation not implemented; set Bearer dev-<user_id> during dev")


@router.get("")
async def list_schedules(authorization: str | None = Header(default=None)):
    user_id = _require_user(authorization)
    sb = get_supabase()
    res = (
        sb.table("schedules")
        .select("*")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .execute()
    )
    return {"items": res.data or []}
