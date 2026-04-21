"""Merge Nexus grades + UCSB catalog + RMP ratings into one DataFrame.

Final grain: one row per (course x instructor x quarter x year).

The merge is the hard part. Three different sources, three different spellings
of the same instructor. We use fuzzy matching (rapidfuzz) between Nexus and
catalog instructor names, and a deterministic join on the Nexus raw string for
the RMP cache.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import pandas as pd
from rapidfuzz import fuzz, process

ROOT = Path(__file__).parent.parent
NEXUS = ROOT / "raw" / "nexus_grades.csv"
RMP = ROOT / "raw" / "rmp_ratings.csv"
OUT = ROOT / "processed" / "unified.csv"


def normalize_course_code(s: str) -> str:
    """'MATH 3A' -> 'MATH 3A' (strip, collapse whitespace, upper)."""
    if not isinstance(s, str):
        return s
    return " ".join(s.upper().split())


def normalize_nexus_instructor(s: str) -> str:
    """'DEAN C W' stays 'DEAN C W' but trimmed/upper-cased."""
    if not isinstance(s, str):
        return s
    return " ".join(s.upper().split())


def catalog_instructor_to_nexus_style(s: str) -> str:
    """UCSB catalog 'DEAN, CHARLES W' -> 'DEAN C W' to match Nexus format."""
    if not isinstance(s, str) or not s.strip():
        return ""
    s = s.strip().upper().replace(",", "")
    parts = s.split()
    if len(parts) == 0:
        return ""
    last = parts[0]
    initials = [p[0] for p in parts[1:] if p]
    return " ".join([last, *initials])


def load_catalog(quarter: str) -> pd.DataFrame | None:
    path = ROOT / "raw" / f"ucsb_catalog_{quarter}.csv"
    if not path.exists():
        print(f"NOTE: catalog file {path.name} not found, skipping catalog join", file=sys.stderr)
        return None
    df = pd.read_csv(path)
    df["course_norm"] = df["courseId"].apply(normalize_course_code)
    df["instr_nexus_style"] = df["instructor_primary"].apply(catalog_instructor_to_nexus_style)
    return df


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--quarter", default="20262", help="Catalog quarter to merge against")
    args = ap.parse_args()

    if not NEXUS.exists():
        print(f"ERROR: {NEXUS} missing", file=sys.stderr); return 1

    nexus = pd.read_csv(NEXUS)
    nexus["course_norm"] = nexus["course"].apply(normalize_course_code)
    nexus["instructor_norm"] = nexus["instructor"].apply(normalize_nexus_instructor)

    # Derived % features from the raw grade counts.
    grade_cols = ["A", "Ap", "Am", "B", "Bp", "Bm", "C", "Cp", "Cm", "D", "Dp", "Dm", "F"]
    existing = [c for c in grade_cols if c in nexus.columns]
    nexus["n_letter"] = nexus[existing].sum(axis=1)
    for c in existing:
        nexus[f"{c}_pct"] = nexus[c] / nexus["n_letter"].replace(0, pd.NA)
    nexus["pct_A_any"] = (
        nexus.get("A", 0).fillna(0)
        + nexus.get("Ap", 0).fillna(0)
        + nexus.get("Am", 0).fillna(0)
    ) / nexus["n_letter"].replace(0, pd.NA)

    # --- Join RMP ratings (deterministic on raw Nexus instructor string) ---
    if RMP.exists():
        rmp = pd.read_csv(RMP)
        rmp = rmp.rename(columns={
            "rating": "rmp_rating",
            "difficulty": "rmp_difficulty",
            "num_ratings": "rmp_num_ratings",
            "would_take_again": "rmp_would_take_again",
            "match": "rmp_match",
            "name": "rmp_name",
            "department": "rmp_department",
        })
        keep = ["instructor_nexus", "rmp_match", "rmp_rating", "rmp_difficulty",
                "rmp_num_ratings", "rmp_would_take_again", "rmp_name", "rmp_department"]
        keep = [c for c in keep if c in rmp.columns]
        nexus = nexus.merge(
            rmp[keep],
            left_on="instructor",
            right_on="instructor_nexus",
            how="left",
        ).drop(columns=["instructor_nexus"], errors="ignore")
    else:
        print(f"NOTE: {RMP.name} missing, skipping RMP join", file=sys.stderr)

    # --- Join UCSB catalog for the target quarter ---
    catalog = load_catalog(args.quarter)
    if catalog is not None:
        cat_min = catalog[["course_norm", "instr_nexus_style", "title", "description",
                           "unitsFixed", "generalEducation_raw"]].drop_duplicates(
            subset=["course_norm", "instr_nexus_style"]
        )
        nexus = nexus.merge(
            cat_min,
            left_on=["course_norm", "instructor_norm"],
            right_on=["course_norm", "instr_nexus_style"],
            how="left",
            suffixes=("", "_catalog"),
        )

    OUT.parent.mkdir(parents=True, exist_ok=True)
    nexus.to_csv(OUT, index=False)

    # Report.
    print(f"\nSaved -> {OUT}")
    print(f"Rows:                     {len(nexus):,}")
    print(f"Unique (course,instr,qy): {nexus.groupby(['course','instructor','quarter','year']).ngroups:,}")
    print(f"Rows with avgGPA:         {nexus['avgGPA'].notna().sum():,} ({nexus['avgGPA'].notna().mean():.1%})")
    if "rmp_match" in nexus.columns:
        rmp_rate = nexus["rmp_match"].fillna(False).mean()
        print(f"Rows with RMP match:      {int(nexus['rmp_match'].fillna(False).sum()):,} ({rmp_rate:.1%})")
    if "title" in nexus.columns:
        cat_rate = nexus["title"].notna().mean()
        print(f"Rows joined to catalog:   {int(nexus['title'].notna().sum()):,} ({cat_rate:.1%})")
    print("\nSample columns available:", [c for c in nexus.columns[:40]])
    return 0


if __name__ == "__main__":
    sys.exit(main())
