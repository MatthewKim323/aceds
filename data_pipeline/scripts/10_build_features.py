#!/usr/bin/env python3
"""
Build the leak-free feature matrix for the grade predictor.

Input:  processed/unified.csv + raw/rmp_cache.json
Output: processed/features.parquet

Design (mirrors ACE_PLAN.md §2.1):
  1. Drop rows with n_letter <= 5 (kills avgGPA=0.0 artifacts and tiny sections)
  2. Join RMP confidence from rmp_cache.json
  3. Sentinel cleanup:
     - rmp_would_take_again == -1.0 -> NaN
     - rmp_num_ratings == 0 -> NaN on all RMP fields
  4. Compute expanding (leak-free) historical aggregates keyed by time_key
  5. Add catalog-derived section features (level, units, GE)
  6. Emit train/val/test markers for time-based split

Usage:
    python scripts/10_build_features.py
    python scripts/10_build_features.py --strict-rmp  # only exact_initial / only_candidate
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

import numpy as np
import pandas as pd

PIPELINE = Path(__file__).resolve().parents[1]
RAW = PIPELINE / "raw"
PROC = PIPELINE / "processed"

QUARTER_ORD = {"Winter": 0, "Spring": 1, "Summer": 2, "Fall": 3}
TRAIN_MAX_TIME = 2025 * 4 + QUARTER_ORD["Winter"]       # train: strictly before Spring 2025
VAL_MAX_TIME   = 2025 * 4 + QUARTER_ORD["Fall"]         # val:   Spring 2025 + Summer 2025 + Fall 2025
# anything after VAL_MAX_TIME is test (Winter 2026 et al.)


def _level(course_norm: str) -> str:
    m = re.search(r"(\d+)", course_norm)
    if not m:
        return "lower"
    n = int(m.group(1))
    if n >= 500:
        return "grad"
    if n >= 100:
        return "upper"
    return "lower"


def _expanding_mean_std(df: pd.DataFrame, key_cols: list[str], target: str) -> pd.DataFrame:
    """
    For each group on key_cols, compute the leak-free expanding mean/std/count of `target`
    using only rows strictly before the current row's time_key.

    Returns a DataFrame with columns [mean, std, count] aligned to df.index.
    """
    out = pd.DataFrame(index=df.index, columns=["mean", "std", "count"], dtype="float64")
    for keys, sub in df.groupby(key_cols, sort=False):
        sub = sub.sort_values("time_key")
        vals = sub[target].values.astype("float64")
        idx = sub.index.values
        cum_sum = np.zeros(len(sub))
        cum_sq = np.zeros(len(sub))
        cum_n = np.zeros(len(sub))
        running_sum = 0.0
        running_sq = 0.0
        running_n = 0
        prev_time_key = None
        pending_sum = 0.0
        pending_sq = 0.0
        pending_n = 0
        times = sub["time_key"].values
        for i, (t, v) in enumerate(zip(times, vals)):
            if prev_time_key is not None and t != prev_time_key:
                running_sum += pending_sum
                running_sq += pending_sq
                running_n += pending_n
                pending_sum = 0.0
                pending_sq = 0.0
                pending_n = 0
            cum_sum[i] = running_sum
            cum_sq[i] = running_sq
            cum_n[i] = running_n
            if not np.isnan(v):
                pending_sum += v
                pending_sq += v * v
                pending_n += 1
            prev_time_key = t
        with np.errstate(divide="ignore", invalid="ignore"):
            mean = np.where(cum_n > 0, cum_sum / cum_n, np.nan)
            var = np.where(cum_n > 1, (cum_sq - cum_n * (mean**2)) / (cum_n - 1), np.nan)
            std = np.sqrt(np.maximum(var, 0))
        out.loc[idx, "mean"] = mean
        out.loc[idx, "std"] = std
        out.loc[idx, "count"] = cum_n
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--strict-rmp", action="store_true")
    ap.add_argument("--n-letter-floor", type=int, default=5)
    args = ap.parse_args()

    df = pd.read_csv(PROC / "unified.csv")
    cache = json.loads((RAW / "rmp_cache.json").read_text())
    df["rmp_confidence"] = df["instructor_norm"].map(
        {k: v.get("confidence", "none") for k, v in cache.items()}
    ).fillna("none")

    df["quarter_ord"] = df["quarter"].map(QUARTER_ORD)
    df["time_key"] = df["year"] * 4 + df["quarter_ord"]

    # --- filter --------------------------------------------------------------
    before = len(df)
    df = df[df["n_letter"] > args.n_letter_floor].copy()
    if args.strict_rmp:
        df = df[df["rmp_confidence"].isin(["exact_initial", "only_candidate"])].copy()
    print(f"rows after filter: {len(df):,} (from {before:,})")

    # --- sentinel cleanup ----------------------------------------------------
    df.loc[df["rmp_would_take_again"] == -1.0, "rmp_would_take_again"] = np.nan
    zero_ratings = df["rmp_num_ratings"].fillna(0) == 0
    for col in ["rmp_rating", "rmp_difficulty", "rmp_num_ratings", "rmp_would_take_again"]:
        df.loc[zero_ratings, col] = np.nan

    # --- leak-free history --------------------------------------------------
    df = df.sort_values("time_key").reset_index(drop=True)
    instr = _expanding_mean_std(df, ["instructor_norm"], "avgGPA")
    course = _expanding_mean_std(df, ["course_norm"], "avgGPA")
    ic = _expanding_mean_std(df, ["instructor_norm", "course_norm"], "avgGPA")
    dept = _expanding_mean_std(df, ["dept"], "avgGPA")

    df["instr_hist_mean_gpa"] = instr["mean"]
    df["instr_hist_gpa_std"] = instr["std"]
    df["instr_hist_n_sections"] = instr["count"]
    df["course_hist_mean_gpa"] = course["mean"]
    df["course_hist_gpa_std"] = course["std"]
    df["course_hist_n_sections"] = course["count"]
    df["ic_hist_mean_gpa"] = ic["mean"]
    df["ic_hist_n_sections"] = ic["count"]
    df["dept_hist_mean_gpa"] = dept["mean"]
    df["dept_hist_gpa_std"] = dept["std"]

    df["instr_is_cold"] = df["instr_hist_n_sections"].fillna(0) == 0
    df["course_is_cold"] = df["course_hist_n_sections"].fillna(0) == 0
    df["ic_is_cold"] = df["ic_hist_n_sections"].fillna(0) == 0

    first_taught = (
        df.groupby("instructor_norm")["time_key"].min().rename("instr_first_time_key")
    )
    df = df.join(first_taught, on="instructor_norm")
    df["years_since_instr_first_taught"] = (df["time_key"] - df["instr_first_time_key"]) / 4.0

    # --- section features ----------------------------------------------------
    df["course_level"] = df["course_norm"].map(_level)
    df["is_ge"] = df["generalEducation_raw"].notna() & (df["generalEducation_raw"].astype(str).str.len() > 0)

    # --- split markers -------------------------------------------------------
    def _split(t: int) -> str:
        if t <= TRAIN_MAX_TIME:
            return "train"
        if t <= VAL_MAX_TIME:
            return "val"
        return "test"

    df["split"] = df["time_key"].map(_split)

    # --- select output columns ----------------------------------------------
    keep = [
        # keys
        "course_norm", "instructor_norm", "quarter", "year", "dept", "time_key", "split",
        # target
        "avgGPA", "n_letter",
        # section
        "course_level", "unitsFixed", "is_ge",
        # historical
        "instr_hist_mean_gpa", "instr_hist_gpa_std", "instr_hist_n_sections",
        "course_hist_mean_gpa", "course_hist_gpa_std", "course_hist_n_sections",
        "ic_hist_mean_gpa", "ic_hist_n_sections",
        "dept_hist_mean_gpa", "dept_hist_gpa_std",
        "instr_is_cold", "course_is_cold", "ic_is_cold",
        "years_since_instr_first_taught",
        # RMP
        "rmp_rating", "rmp_difficulty", "rmp_num_ratings", "rmp_would_take_again",
        "rmp_match", "rmp_confidence",
    ]
    keep = [c for c in keep if c in df.columns]
    out = df[keep].copy()
    out.to_parquet(PROC / "features.parquet", index=False)

    print("split counts:", out["split"].value_counts().to_dict())
    print(f"wrote {PROC/'features.parquet'}  shape={out.shape}")


if __name__ == "__main__":
    main()
