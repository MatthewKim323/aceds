"""Live UCSB class schedule + curriculum via developer API (same source as 02_fetch_ucsb_catalog.py).

Docs: https://developer.ucsb.edu/content/academic-curriculums
Env:  UCSB_API_KEY (header ucsb-api-key)
"""

from __future__ import annotations

import asyncio
import json
import math
import re
import time
from datetime import UTC, datetime
from typing import Any

import httpx

from .config import get_settings

BASE = "https://api.ucsb.edu/academics/curriculums/v3"

# Subject codes used for /classes/search (deptCode). Mirrors data_pipeline/scripts/02_fetch_ucsb_catalog.py;
# override with env ACE_UCSB_DEPT_CODES="DEPT1,DEPT2,..." for full coverage experiments.
DEFAULT_DEPT_CODES: tuple[str, ...] = (
    "ANTH",
    "ART",
    "ART CS",
    "ARTHI",
    "AS AM",
    "ASAM",
    "BIOL",
    "BL ST",
    "BMSE",
    "BIOE",
    "C LIT",
    "CH E",
    "CH ST",
    "CHEM",
    "CHIN",
    "CHNE",
    "CHST",
    "CLASS",
    "CMPTG",
    "CMPSC",
    "CMW",
    "CNCSP",
    "COMM",
    "CSTU",
    "DANCE",
    "DYNS",
    "EACS",
    "EARTH",
    "ECON",
    "ECE",
    "ED",
    "EEMB",
    "ENGL",
    "ENGR",
    "ENV",
    "ENV S",
    "EPS",
    "ES",
    "ESM",
    "FAMST",
    "FEMST",
    "FILM",
    "FR",
    "GEOG",
    "GEOL",
    "GER",
    "GEL",
    "GLOBL",
    "GPS",
    "GOV",
    "GREEK",
    "HEB",
    "HIST",
    "INT",
    "IQB",
    "ITAL",
    "JAPAN",
    "KOR",
    "LAIS",
    "LATIN",
    "LING",
    "MARSC",
    "MAT",
    "MATRL",
    "MATH",
    "MCDB",
    "ME",
    "MES",
    "MS",
    "MSRG",
    "MTLE",
    "MUS",
    "MUS A",
    "MUSC",
    "PHIL",
    "PHMS",
    "PHYS",
    "POL S",
    "PORT",
    "PRC",
    "PSTAT",
    "PSY",
    "RG ST",
    "RST",
    "RUSS",
    "SHS",
    "SLAV",
    "SOC",
    "SPAN",
    "THTR",
    "TMP",
    "W&L",
    "WRIT",
)

_CACHE: dict[str, tuple[float, list[dict[str, Any]]]] = {}
_CACHE_TTL_SEC = 45 * 60  # catalog is large; 45m is a good balance for dev + demos


def dept_codes_for_fetch() -> list[str]:
    import os

    raw = os.environ.get("ACE_UCSB_DEPT_CODES", "").strip()
    if raw:
        parts = [p.strip().upper() for p in raw.split(",") if p.strip()]
        return sorted(set(parts))
    # Dedupe while preserving order
    seen: set[str] = set()
    out: list[str] = []
    for d in DEFAULT_DEPT_CODES:
        if d not in seen:
            seen.add(d)
            out.append(d)
    return out


def quarter_label(code: str) -> str:
    """20262 -> 'Spring 2026' (best-effort; API quarter is source of truth)."""
    if len(code) != 5 or not code.isdigit():
        return code
    y, q = int(code[:4]), int(code[4])
    name = {1: "Winter", 2: "Spring", 3: "Summer", 4: "Fall"}.get(q, f"Q{q}")
    return f"{name} {y}"


def default_catalog_quarter(now: datetime | None = None) -> str:
    """Heuristic default quarter YYYYQ (1=W 2=Sp 3=Su 4=F). Override with ACE_CATALOG_QUARTER."""
    import os

    env_q = os.environ.get("ACE_CATALOG_QUARTER", "").strip()
    if env_q and len(env_q) == 5 and env_q.isdigit():
        return env_q
    now = now or datetime.now(UTC)
    now = now.replace(tzinfo=UTC) if now.tzinfo is None else now.astimezone(UTC)
    y, m = now.year, now.month
    # YYYY + single digit Q (1=W 2=Sp 3=Su 4=F); e.g. f"{y}2" not f"{y}62" (wrong length).
    if m == 12:
        return f"{y + 1}1"
    if m <= 2:
        return f"{y}1"
    if m <= 5:
        return f"{y}2"
    if m <= 8:
        return f"{y}3"
    if m <= 11:
        return f"{y}4"
    return f"{y + 1}1"


def _level(course_id: str) -> str:
    m = re.search(r"(\d+)", course_id)
    if not m:
        return "lower"
    n = int(m.group(1))
    if n >= 500:
        return "grad"
    if n >= 100:
        return "upper"
    return "lower"


def _parse_ge(raw: str | None) -> list[str]:
    if not raw or (isinstance(raw, float) and math.isnan(raw)):
        return []
    parts = re.split(r"[,;/]|\s{2,}", str(raw))
    codes: list[str] = []
    for p in parts:
        p = p.strip().upper()
        if re.match(r"^[A-Z]\d?$", p):
            codes.append(p)
    return sorted(set(codes))


def _ge_areas_from_api(ge_field: Any) -> list[str]:
    if ge_field is None:
        return []
    if isinstance(ge_field, str):
        return _parse_ge(ge_field)
    if isinstance(ge_field, list):
        codes: list[str] = []
        for item in ge_field:
            if isinstance(item, dict):
                code = item.get("code") or item.get("area") or item.get("geCode")
                if isinstance(code, str) and re.match(r"^[A-Z]\d?$", code.strip().upper()):
                    codes.append(code.strip().upper())
            elif isinstance(item, str):
                codes.extend(_parse_ge(item))
        return sorted(set(codes))
    return []


def _rows_from_class_payload(c: dict[str, Any]) -> list[dict[str, Any]]:
    """One synthetic row per class (section-level fields ignored for course catalog dedupe)."""
    ge_raw = json.dumps(c.get("generalEducation") or [])
    ge_areas = _ge_areas_from_api(c.get("generalEducation"))
    cid = str(c.get("courseId") or "").strip()
    if not cid:
        return []
    dept = str(c.get("deptCode") or "").strip().upper() or (cid.split()[0] if " " in cid else "")
    course_id = cid.split(" ", 1)[-1] if " " in cid else cid
    units = c.get("unitsFixed")
    if isinstance(units, float) and math.isnan(units):
        units = None
    return [
        {
            "course_norm": cid,
            "dept": dept,
            "course_id": course_id,
            "title": c.get("title"),
            "description": c.get("description"),
            "units_fixed": units,
            "ge_raw": ge_raw,
            "ge_areas": ge_areas,
            "level": _level(course_id),
        }
    ]


async def _fetch_classes_page(
    client: httpx.AsyncClient,
    headers: dict[str, str],
    quarter: str,
    dept: str | None,
    page: int,
    page_size: int,
) -> tuple[list[dict[str, Any]], int]:
    params: dict[str, str | int] = {
        "quarter": quarter,
        "pageNumber": page,
        "pageSize": page_size,
        "includeClassSections": "true",
    }
    if dept is not None:
        params["deptCode"] = dept
    r = await client.get(
        f"{BASE}/classes/search",
        params=params,
        headers=headers,
        timeout=45.0,
    )
    if r.status_code == 404:
        return [], 0
    if r.status_code == 401:
        r.raise_for_status()
    if r.status_code != 200:
        return [], 0
    payload = r.json()
    classes = payload.get("classes") or []
    total = int(payload.get("total") or 0)
    return classes, total


async def _fetch_all_classes_global(
    client: httpx.AsyncClient,
    headers: dict[str, str],
    quarter: str,
    page_size: int = 100,
) -> list[dict[str, Any]]:
    """Paginate /classes/search without deptCode (UCSB returns a quarter-wide class list)."""
    out: list[dict[str, Any]] = []
    page = 1
    total: int | None = None
    while True:
        classes, t = await _fetch_classes_page(client, headers, quarter, None, page, page_size)
        if total is None:
            total = t
        if not classes:
            break
        out.extend(classes)
        if len(out) >= total:
            break
        page += 1
        await asyncio.sleep(0.05)
    return out


async def _fetch_all_classes_for_dept(
    client: httpx.AsyncClient,
    headers: dict[str, str],
    quarter: str,
    dept: str,
    page_size: int = 100,
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    page = 1
    total = None
    while True:
        classes, t = await _fetch_classes_page(client, headers, quarter, dept, page, page_size)
        if total is None:
            total = t
        if not classes:
            break
        out.extend(classes)
        if len(out) >= total:
            break
        page += 1
        await asyncio.sleep(0.05)
    return out


async def fetch_quarter_catalog(quarter: str) -> list[dict[str, Any]]:
    """Distinct courses for `quarter`: quarter-wide search (no deptCode) plus per-dept passes.

    The UCSB API returns a large set without `deptCode`; per-dept fetches still add courses
    missing from that global listing for some quarters.
    """
    settings = get_settings()
    key = (settings.ucsb_api_key or "").strip()
    if not key:
        raise RuntimeError("UCSB_API_KEY is not set")

    headers = {
        "ucsb-api-key": key,
        "ucsb-api-version": "1.0",
        "accept": "application/json",
    }
    depts = dept_codes_for_fetch()
    by_course: dict[str, dict[str, Any]] = {}

    sem = asyncio.Semaphore(8)

    async with httpx.AsyncClient() as shared:

        async def global_rows() -> list[dict[str, Any]]:
            classes = await _fetch_all_classes_global(shared, headers, quarter)
            rows: list[dict[str, Any]] = []
            for c in classes:
                rows.extend(_rows_from_class_payload(c))
            return rows

        async def one_dept(d: str) -> list[dict[str, Any]]:
            async with sem:
                classes = await _fetch_all_classes_for_dept(shared, headers, quarter, d)
                rows: list[dict[str, Any]] = []
                for c in classes:
                    rows.extend(_rows_from_class_payload(c))
                return rows

        g_rows, *dept_batches = await asyncio.gather(global_rows(), *(one_dept(d) for d in depts))
        for row in g_rows:
            cn = row["course_norm"]
            if cn not in by_course:
                by_course[cn] = row
        for batch in dept_batches:
            for row in batch:
                cn = row["course_norm"]
                if cn not in by_course:
                    by_course[cn] = row
    # Stable sort for UX
    return [by_course[k] for k in sorted(by_course.keys())]


def get_cached_catalog(quarter: str) -> list[dict[str, Any]] | None:
    ent = _CACHE.get(quarter)
    if not ent:
        return None
    ts, rows = ent
    if time.time() - ts > _CACHE_TTL_SEC:
        return None
    return rows


def set_cached_catalog(quarter: str, rows: list[dict[str, Any]]) -> None:
    _CACHE[quarter] = (time.time(), rows)


async def get_or_fetch_catalog(quarter: str) -> list[dict[str, Any]]:
    hit = get_cached_catalog(quarter)
    if hit is not None:
        return hit
    rows = await fetch_quarter_catalog(quarter)
    set_cached_catalog(quarter, rows)
    return rows


def filter_catalog_rows(
    rows: list[dict[str, Any]],
    *,
    dept: str | None,
    ge: str | None,
    level: str | None,
    search: str | None,
) -> list[dict[str, Any]]:
    out = rows
    if dept:
        du = dept.upper().strip()
        out = [r for r in out if str(r.get("dept") or "").upper() == du]
    if level and level in ("lower", "upper", "grad"):
        out = [r for r in out if r.get("level") == level]
    if ge:
        gu = ge.upper().strip()
        out = [r for r in out if gu in (r.get("ge_areas") or [])]
    if search:
        q = search.lower().strip()
        out = [
            r
            for r in out
            if q in (str(r.get("title") or "").lower())
            or q in (str(r.get("description") or "").lower())
            or q in str(r.get("course_norm") or "").lower()
        ]
    return out
