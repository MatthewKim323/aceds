#!/usr/bin/env python3
"""
Audit the unified DataFrame before any modeling work.

Writes `processed/audit_report.md` with:
- avgGPA distribution (and the n_letter=0 artifact)
- per-year / per-quarter row counts (train/test split sanity)
- RMP confidence breakdown joined from raw/rmp_cache.json
- top-20 departments by row count
- catalog-join coverage (Spring 2026)
- 20 random "top_by_ratings" spot-check rows

Run:
    python scripts/00_audit_unified.py
"""

from __future__ import annotations

import json
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "raw"
PROC = ROOT / "processed"
REPORT = PROC / "audit_report.md"


def _quarter_ord(q: str) -> int:
    return {"Winter": 0, "Spring": 1, "Summer": 2, "Fall": 3}.get(q, -1)


def main() -> None:
    df = pd.read_csv(PROC / "unified.csv")
    cache = json.loads((RAW / "rmp_cache.json").read_text())

    df["quarter_ord"] = df["quarter"].map(_quarter_ord)
    df["time_key"] = df["year"] * 4 + df["quarter_ord"]

    conf = {k: v.get("confidence", "none") for k, v in cache.items()}
    df["rmp_confidence"] = df["instructor_norm"].map(conf).fillna("none")

    # --- analysis ---------------------------------------------------------
    total = len(df)
    zero_n = int((df["n_letter"] == 0).sum())
    zero_gpa = int((df["avgGPA"] == 0).sum())
    zero_both = int(((df["n_letter"] == 0) & (df["avgGPA"] == 0)).sum())
    clean = df[df["n_letter"] > 5].copy()

    conf_counts = df["rmp_confidence"].value_counts().to_dict()
    conf_counts_clean = clean["rmp_confidence"].value_counts().to_dict()

    by_year = df.groupby("year").size().reset_index(name="rows")
    by_quarter = df.groupby(["year", "quarter"]).size().reset_index(name="rows")
    by_quarter["time_key"] = by_quarter["year"] * 4 + by_quarter["quarter"].map(_quarter_ord)
    by_quarter = by_quarter.sort_values("time_key").tail(12)

    top_depts = (
        df["dept"].value_counts().head(20).reset_index().rename(columns={"count": "rows"})
    )

    catalog_rows = df[df["title"].notna()]
    catalog_coverage = {
        "rows_with_catalog_join": int(len(catalog_rows)),
        "unique_courses_joined": int(catalog_rows["course_norm"].nunique()),
    }

    # strict training split preview
    strict = clean[clean["rmp_confidence"].isin(["exact_initial", "only_candidate"])]

    spot = df[df["rmp_confidence"] == "top_by_ratings"].sample(
        min(20, (df["rmp_confidence"] == "top_by_ratings").sum()),
        random_state=42,
    )[
        [
            "instructor_norm",
            "dept",
            "rmp_rating",
            "rmp_difficulty",
            "rmp_num_ratings",
            "rmp_department",
        ]
    ]

    # --- report -----------------------------------------------------------
    lines: list[str] = []
    push = lines.append
    push("# unified.csv audit\n")
    push(f"Total rows: **{total:,}**  \n")
    push(
        f"`n_letter == 0`: **{zero_n:,}** ({zero_n/total:.1%})  \n"
        f"`avgGPA == 0`: **{zero_gpa:,}** ({zero_gpa/total:.1%})  \n"
        f"Both: **{zero_both:,}** (these are the drop-for-training rows)\n"
    )
    push(
        f"\nAfter filter `n_letter > 5`: **{len(clean):,}** rows "
        f"(kept {len(clean)/total:.1%}).\n"
    )
    push(
        f"Strict training set (confidence in exact_initial/only_candidate): "
        f"**{len(strict):,}** rows ({len(strict)/total:.1%}).\n"
    )

    push("\n## RMP confidence breakdown\n")
    push("| confidence | all rows | n_letter>5 rows |\n|---|---:|---:|")
    for conf_key in ["exact_initial", "only_candidate", "top_by_ratings", "none"]:
        a = conf_counts.get(conf_key, 0)
        b = conf_counts_clean.get(conf_key, 0)
        push(f"| {conf_key} | {a:,} | {b:,} |")

    push("\n## Rows by year\n")
    push("| year | rows |\n|---:|---:|")
    for _, r in by_year.iterrows():
        push(f"| {int(r.year)} | {int(r.rows):,} |")

    push("\n## Last 12 quarters (train/test horizon)\n")
    push("| year | quarter | rows |\n|---:|---|---:|")
    for _, r in by_quarter.iterrows():
        push(f"| {int(r.year)} | {r.quarter} | {int(r.rows):,} |")

    push("\n## Top 20 departments by row count\n")
    push("| dept | rows |\n|---|---:|")
    for _, r in top_depts.iterrows():
        push(f"| {r.dept} | {int(r.rows):,} |")

    push("\n## Spring 2026 catalog join\n")
    push(
        f"- rows with catalog columns populated: **{catalog_coverage['rows_with_catalog_join']:,}**\n"
        f"- unique courses: **{catalog_coverage['unique_courses_joined']:,}**\n"
    )

    push("\n## Spot-check: 20 random top_by_ratings rows\n")
    push(spot.to_markdown(index=False))

    REPORT.write_text("\n".join(lines))
    print(f"wrote {REPORT}")
    print(
        f"total={total:,} clean={len(clean):,} strict={len(strict):,}"
        f" catalog_rows={catalog_coverage['rows_with_catalog_join']:,}"
    )


if __name__ == "__main__":
    main()
