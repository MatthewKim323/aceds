#!/usr/bin/env python3
"""
Idempotent upsert of the full ACE pipeline into Supabase.

Loads:
  courses              from unified.csv + ucsb_catalog_<q>.csv
  professors           from unified.csv + raw/rmp_cache.json (confidence)
  grade_distributions  from unified.csv (one row per section)
  sections             from raw/ucsb_catalog_<q>.csv
  major_requirements   from processed/majors/*.json (kind=major)
  minor_requirements   from processed/majors/*.json (kind=minor)

All writes use ON CONFLICT upsert semantics. Safe to re-run.

Usage:
    python scripts/07_load_to_supabase.py --quarter 20262
    python scripts/07_load_to_supabase.py --quarter 20262 --only sections
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys
from pathlib import Path

import pandas as pd
from dotenv import load_dotenv
from supabase import Client, create_client
from tqdm import tqdm

ROOT = Path(__file__).resolve().parents[2]
PIPELINE = ROOT / "data_pipeline"
RAW = PIPELINE / "raw"
PROC = PIPELINE / "processed"
MAJORS_DIR = PROC / "majors"

BATCH = 500


def get_client() -> Client:
    load_dotenv(ROOT / ".env")
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing", file=sys.stderr)
        sys.exit(1)
    return create_client(url, key)


def _sanitize(d: dict) -> dict:
    out = {}
    for k, v in d.items():
        if isinstance(v, float) and math.isnan(v):
            out[k] = None
        elif v == "":
            out[k] = None
        else:
            out[k] = v
    return out


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
    codes = []
    for p in parts:
        p = p.strip().upper()
        if re.match(r"^[A-Z]\d?$", p):
            codes.append(p)
    return sorted(set(codes))


def upsert_batches(sb: Client, table: str, rows: list[dict], on_conflict: str) -> int:
    n = 0
    for i in tqdm(range(0, len(rows), BATCH), desc=f"upsert {table}"):
        chunk = [_sanitize(r) for r in rows[i : i + BATCH]]
        sb.table(table).upsert(chunk, on_conflict=on_conflict).execute()
        n += len(chunk)
    return n


def load_courses_and_grades(sb: Client, unified: pd.DataFrame, catalog: pd.DataFrame) -> None:
    catalog_by_course = (
        catalog.dropna(subset=["courseId"])
        .assign(course_norm=lambda d: d["courseId"].astype(str).str.strip())
        .drop_duplicates("course_norm")
        .set_index("course_norm")
    )

    courses = (
        unified.groupby("course_norm")
        .agg(dept=("dept", "first"))
        .reset_index()
    )
    course_rows = []
    for _, row in courses.iterrows():
        course_norm = row["course_norm"]
        cat = catalog_by_course.loc[course_norm] if course_norm in catalog_by_course.index else None
        title = cat["title"] if cat is not None and "title" in cat else None
        desc = cat["description"] if cat is not None and "description" in cat else None
        units = cat["unitsFixed"] if cat is not None and "unitsFixed" in cat else None
        ge_raw = cat["generalEducation_raw"] if cat is not None and "generalEducation_raw" in cat else None
        course_id = course_norm.split(" ", 1)[-1] if " " in course_norm else course_norm
        course_rows.append(
            {
                "course_norm": course_norm,
                "dept": row["dept"],
                "course_id": course_id,
                "title": title,
                "description": desc,
                "units_fixed": units if units and not (isinstance(units, float) and math.isnan(units)) else None,
                "ge_raw": ge_raw,
                "ge_areas": _parse_ge(ge_raw),
                "level": _level(course_id),
            }
        )
    upsert_batches(sb, "courses", course_rows, on_conflict="course_norm")

    grade_rows = []
    for _, r in unified.iterrows():
        if r["n_letter"] == 0:
            continue
        grade_rows.append(
            {
                "course_norm": r["course_norm"],
                "instructor_norm": r["instructor_norm"],
                "quarter": r["quarter"],
                "year": int(r["year"]),
                "n_letter": int(r["n_letter"]),
                "avg_gpa": float(r["avgGPA"]) if not pd.isna(r["avgGPA"]) else None,
                "a_count": int(r["A"]) if not pd.isna(r["A"]) else 0,
                "b_count": int(r["B"]) if not pd.isna(r["B"]) else 0,
                "c_count": int(r["C"]) if not pd.isna(r["C"]) else 0,
                "d_count": int(r["D"]) if not pd.isna(r["D"]) else 0,
                "f_count": int(r["F"]) if not pd.isna(r["F"]) else 0,
                "p_count": int(r["P"]) if not pd.isna(r["P"]) else 0,
                "np_count": 0,
                "grade_breakdown_json": {
                    "Ap": r.get("Ap"), "Am": r.get("Am"),
                    "Bp": r.get("Bp"), "Bm": r.get("Bm"),
                    "Cp": r.get("Cp"), "Cm": r.get("Cm"),
                    "Dp": r.get("Dp"), "Dm": r.get("Dm"),
                },
            }
        )
    upsert_batches(
        sb,
        "grade_distributions",
        grade_rows,
        on_conflict="course_norm,instructor_norm,quarter,year",
    )


def load_professors(sb: Client, unified: pd.DataFrame, cache: dict) -> None:
    recent = (
        unified.sort_values(["year", "quarter"], ascending=[False, False])
        .drop_duplicates("instructor_norm")
        .set_index("instructor_norm")
    )
    rows = []
    for instructor_norm, conf_entry in cache.items():
        rec = recent.loc[instructor_norm] if instructor_norm in recent.index else None
        rows.append(
            {
                "instructor_norm": instructor_norm,
                "display_name": rec["instructor"] if rec is not None else instructor_norm,
                "rmp_legacy_id": conf_entry.get("legacyId"),
                "rmp_rating": rec["rmp_rating"] if rec is not None and not pd.isna(rec["rmp_rating"]) else None,
                "rmp_difficulty": rec["rmp_difficulty"] if rec is not None and not pd.isna(rec["rmp_difficulty"]) else None,
                "rmp_num_ratings": int(rec["rmp_num_ratings"]) if rec is not None and not pd.isna(rec["rmp_num_ratings"]) else None,
                "rmp_would_take_again": rec["rmp_would_take_again"] if rec is not None and not pd.isna(rec["rmp_would_take_again"]) else None,
                "rmp_department": rec["rmp_department"] if rec is not None and not pd.isna(rec.get("rmp_department", float("nan"))) else None,
                "rmp_confidence": conf_entry.get("confidence", "none"),
            }
        )
    # Add any instructors in unified.csv not in cache (shouldn't happen, but defensively)
    for instructor_norm, rec in recent.iterrows():
        if instructor_norm in cache:
            continue
        rows.append(
            {
                "instructor_norm": instructor_norm,
                "display_name": rec["instructor"],
                "rmp_confidence": "none",
            }
        )
    upsert_batches(sb, "professors", rows, on_conflict="instructor_norm")


def load_sections(sb: Client, catalog: pd.DataFrame, quarter_code: str) -> None:
    rows = []
    for _, r in catalog.iterrows():
        if pd.isna(r.get("enrollCode")) or pd.isna(r.get("courseId")):
            continue
        rows.append(
            {
                "enroll_code": str(r["enrollCode"]),
                "quarter_code": quarter_code,
                "course_norm": str(r["courseId"]).strip(),
                "instructor_norm": r.get("instructor_norm") if not pd.isna(r.get("instructor_norm", float("nan"))) else None,
                "section_label": r.get("section"),
                "days": r.get("days"),
                "begin_time": r.get("beginTime"),
                "end_time": r.get("endTime"),
                "building": r.get("building"),
                "room": r.get("room"),
                "max_enroll": int(r["maxEnroll"]) if not pd.isna(r.get("maxEnroll", float("nan"))) else None,
                "enrolled": int(r["enrolledTotal"]) if not pd.isna(r.get("enrolledTotal", float("nan"))) else None,
                "open_seats": int(r["openSeats"]) if not pd.isna(r.get("openSeats", float("nan"))) else None,
                "class_closed": r.get("classClosed"),
                "restriction_level": r.get("restrictionLevel"),
                "restriction_major": r.get("restrictionMajor"),
                "restriction_comments": r.get("restrictionComments"),
            }
        )
    upsert_batches(sb, "sections", rows, on_conflict="enroll_code,quarter_code")


def load_majors(sb: Client) -> None:
    if not MAJORS_DIR.exists():
        print("no majors/ dir; skipping")
        return
    majors, minors = [], []
    for p in sorted(MAJORS_DIR.glob("*.json")):
        data = json.loads(p.read_text())
        if not data.get("reviewed"):
            continue
        row = {
            "name": data["name"],
            "catalog_year": data.get("catalog_year"),
            "department": data.get("department"),
            "structure": data,
            "reviewed": True,
            "source_pdf": data.get("source_pdf"),
        }
        if data.get("kind") == "minor":
            row["minor_id"] = data["id"]
            minors.append(row)
        else:
            row["major_id"] = data["id"]
            row["degree"] = data.get("degree")
            row["college"] = data.get("college")
            majors.append(row)
    if majors:
        upsert_batches(sb, "major_requirements", majors, on_conflict="major_id")
    if minors:
        upsert_batches(sb, "minor_requirements", minors, on_conflict="minor_id")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--quarter", default="20262")
    ap.add_argument("--only", choices=("courses", "professors", "sections", "majors"), default=None)
    args = ap.parse_args()

    sb = get_client()
    unified = pd.read_csv(PROC / "unified.csv")
    catalog = pd.read_csv(RAW / f"ucsb_catalog_{args.quarter}.csv")
    cache = json.loads((RAW / "rmp_cache.json").read_text())

    if args.only in (None, "courses"):
        load_courses_and_grades(sb, unified, catalog)
    if args.only in (None, "professors"):
        load_professors(sb, unified, cache)
    if args.only in (None, "sections"):
        load_sections(sb, catalog, args.quarter)
    if args.only in (None, "majors"):
        load_majors(sb)

    sb.table("data_refresh_log").insert(
        {
            "source": "full_pipeline",
            "status": "success",
            "rows_ingested": len(unified),
            "message": f"quarter={args.quarter}",
        }
    ).execute()
    print("done.")


if __name__ == "__main__":
    main()
