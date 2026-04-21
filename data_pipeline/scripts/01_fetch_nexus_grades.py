"""Download Daily Nexus grade distribution dataset.

Source: https://github.com/dailynexusdata/grades-data
Grain: one row per (course x instructor x quarter x year)
Coverage: Fall 2009 through most recent quarter with >=5 enrolled students.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd
import requests

RAW_URL = "https://raw.githubusercontent.com/dailynexusdata/grades-data/main/courseGrades.csv"
OUT_PATH = Path(__file__).parent.parent / "raw" / "nexus_grades.csv"


def main() -> int:
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)

    print(f"Downloading {RAW_URL} ...")
    resp = requests.get(RAW_URL, timeout=60)
    resp.raise_for_status()
    OUT_PATH.write_bytes(resp.content)

    df = pd.read_csv(OUT_PATH)
    print(f"\nSaved -> {OUT_PATH}")
    print(f"Rows:          {len(df):,}")
    print(f"Columns:       {list(df.columns)}")
    print(f"Quarters:      {df['quarter'].nunique()} unique")
    print(f"Years:         {df['year'].min()} - {df['year'].max()}")
    print(f"Departments:   {df['dept'].nunique()}")
    print(f"Unique instr.: {df['instructor'].nunique():,}")
    print(f"Rows w/ avgGPA: {df['avgGPA'].notna().sum():,} ({df['avgGPA'].notna().mean():.1%})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
