"""Fetch one quarter of UCSB class schedules from the public developer API.

Docs:   https://developer.ucsb.edu/content/academic-curriculums
Auth:   header `ucsb-api-key` from .env
Scope:  ACADEMICS - CLASS SCHEDULES + ACADEMICS - CURRICULUMS

Quarter code format: YYYYQ where Q = 1(W) 2(S) 3(Su) 4(F).
Example: 20262 = Spring 2026.

Statistics / Data Science: use API dept **STATS** (not PSTAT); courseId values remain PSTAT ##…

Usage:
    python 02_fetch_ucsb_catalog.py                    # default quarter+dept list
    python 02_fetch_ucsb_catalog.py --quarter 20262    # custom quarter
    python 02_fetch_ucsb_catalog.py --dept CMPSC       # single dept (for testing)
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

import pandas as pd
import requests
from dotenv import load_dotenv
from tqdm import tqdm

ROOT = Path(__file__).parent.parent
load_dotenv(ROOT.parent / ".env")

API_KEY = os.getenv("UCSB_API_KEY")
BASE = "https://api.ucsb.edu/academics/curriculums/v3"
HEADERS = {
    "ucsb-api-key": API_KEY or "",
    "ucsb-api-version": "1.0",
    "accept": "application/json",
}

DEFAULT_QUARTER = "20262"  # Spring 2026

# Common UCSB department codes. Not exhaustive, but covers the bulk of
# undergraduate offerings. Expand as needed.
DEFAULT_DEPTS = [
    "ANTH", "ART", "ARTHI", "ASAM", "AS AM", "BIOL", "BMSE", "CH E", "CHEM",
    "CHIN", "CHST", "CLASS", "COMM", "CMPSC", "CMPTG", "DANCE", "EACS",
    "EARTH", "ECON", "ED", "EEMB", "ENGR", "ENGL", "ENV S", "ESM", "ES",
    "FEMST", "FILM", "FR", "GEOG", "GER", "GLOBL", "GPS", "GREEK", "HEB",
    "HIST", "INT", "ITAL", "JAPAN", "KOR", "LATIN", "LAIS", "LING",
    "MARSC", "MATRL", "MATH", "ME", "MCDB", "MES", "MS", "MUS", "MUS A",
    "PHIL", "PHYS", "POL S", "PORT", "PSY", "RG ST", "RUSS", "SLAV", "SOC",
    # Statistics / Data Science: API deptCode is STATS (PSTAT returns 0 rows). courseId stays PSTAT ##…
    "SPAN", "STATS", "TMP", "THTR", "W&L", "WRIT", "BIOE", "DYNS", "ENV",
    "FAMST", "GOV", "EPS", "GEOL", "IQB", "MTLE",
]


def fetch_classes(quarter: str, dept: str, page_size: int = 100) -> list[dict]:
    """Paginate through every class section for (quarter, dept)."""
    results: list[dict] = []
    page = 1
    while True:
        r = requests.get(
            f"{BASE}/classes/search",
            params={
                "quarter": quarter,
                "deptCode": dept,
                "pageNumber": page,
                "pageSize": page_size,
                "includeClassSections": "true",
            },
            headers=HEADERS,
            timeout=30,
        )
        if r.status_code == 404:
            return results  # dept doesn't exist this quarter
        if r.status_code != 200:
            print(f"  [{dept}] HTTP {r.status_code}: {r.text[:200]}", file=sys.stderr)
            return results
        payload = r.json()
        classes = payload.get("classes", [])
        if not classes:
            break
        results.extend(classes)
        total = payload.get("total", 0)
        if len(results) >= total:
            break
        page += 1
        time.sleep(0.1)
    return results


def _pick_time_row(times: list[dict]) -> dict | None:
    """First timeLocations entry is often TBA/empty while a later row has the real meeting."""
    if not times:
        return None
    for t in times:
        if not isinstance(t, dict):
            continue
        bt = str(t.get("beginTime") or "").strip()
        et = str(t.get("endTime") or "").strip()
        dy = str(t.get("days") or "").strip()
        if not bt or not et or not dy:
            continue
        if bt.upper() == "TBA" or et.upper() == "TBA" or dy.upper() == "TBA":
            continue
        return t
    first = times[0]
    return first if isinstance(first, dict) else None


def flatten(classes: list[dict]) -> pd.DataFrame:
    """Flatten the nested class/section response into row-per-section."""
    rows = []
    for c in classes:
        base = {
            "quarter": c.get("quarter"),
            "courseId": c.get("courseId"),
            "title": c.get("title"),
            "description": c.get("description"),
            "deptCode": c.get("deptCode"),
            "college": c.get("college"),
            "objLevelCode": c.get("objLevelCode"),
            "subjectArea": c.get("subjectArea"),
            "unitsFixed": c.get("unitsFixed"),
            "unitsVariableHigh": c.get("unitsVariableHigh"),
            "unitsVariableLow": c.get("unitsVariableLow"),
            "generalEducation_raw": json.dumps(c.get("generalEducation") or []),
        }
        for s in c.get("classSections", []) or []:
            instructors = s.get("instructors") or []
            times = s.get("timeLocations") or []
            tl = _pick_time_row(times) if times else None
            rows.append({
                **base,
                "section": s.get("section"),
                "enrollCode": s.get("enrollCode"),
                "enrolledTotal": s.get("enrolledTotal"),
                "maxEnroll": s.get("maxEnroll"),
                "availableSeats": s.get("availableSeats"),
                "departmentApprovalRequired": s.get("departmentApprovalRequired"),
                "instructorApprovalRequired": s.get("instructorApprovalRequired"),
                "restrictionMajor": s.get("restrictionMajor"),
                "restrictionLevel": s.get("restrictionLevel"),
                "instructor_primary": next(
                    (i.get("instructor") for i in instructors if i.get("functionCode") == "Teaching and in charge"),
                    instructors[0].get("instructor") if instructors else None,
                ),
                "instructors_all": "; ".join(i.get("instructor", "") for i in instructors),
                "days": tl.get("days") if tl else None,
                "beginTime": tl.get("beginTime") if tl else None,
                "endTime": tl.get("endTime") if tl else None,
                "building": tl.get("building") if tl else None,
                "room": tl.get("room") if tl else None,
                "timeLocations_raw": json.dumps(times),
            })
    return pd.DataFrame(rows)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--quarter", default=DEFAULT_QUARTER)
    ap.add_argument("--dept", help="Single dept code (for testing)")
    args = ap.parse_args()

    if not API_KEY:
        print("ERROR: UCSB_API_KEY not set in .env", file=sys.stderr)
        return 1

    depts = [args.dept] if args.dept else DEFAULT_DEPTS
    out_dir = ROOT / "raw"
    out_dir.mkdir(parents=True, exist_ok=True)

    all_frames = []
    raw_dump = {}
    for dept in tqdm(depts, desc=f"Fetching q={args.quarter}"):
        classes = fetch_classes(args.quarter, dept)
        raw_dump[dept] = classes
        if classes:
            all_frames.append(flatten(classes))

    # Save raw JSON for reproducibility.
    raw_path = out_dir / f"ucsb_catalog_{args.quarter}_raw.json"
    raw_path.write_text(json.dumps(raw_dump, indent=2))

    if not all_frames:
        print("WARNING: 0 classes returned across all depts. Check API key / quarter code.", file=sys.stderr)
        return 2

    df = pd.concat(all_frames, ignore_index=True)
    out_csv = out_dir / f"ucsb_catalog_{args.quarter}.csv"
    df.to_csv(out_csv, index=False)

    print(f"\nSaved -> {out_csv}")
    print(f"Sections:    {len(df):,}")
    print(f"Courses:     {df['courseId'].nunique():,}")
    print(f"Depts:       {df['deptCode'].nunique()}")
    print(f"Instructors: {df['instructor_primary'].nunique():,}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
