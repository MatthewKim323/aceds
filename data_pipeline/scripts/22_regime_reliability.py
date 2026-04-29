#!/usr/bin/env python3
"""
Per-regime reliability on the temporal TEST split (binned predicted vs actual mean).

Output: data_pipeline/processed/pitch/07_regime_reliability.svg

Usage:
  python data_pipeline/scripts/22_regime_reliability.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import xgboost as xgb

PIPELINE = Path(__file__).resolve().parents[1]
PROC = PIPELINE / "processed"
PITCH = PROC / "pitch"


def regime_from_row(row: pd.Series) -> str:
    if bool(row["ic_is_cold"]) and bool(row["instr_is_cold"]):
        return "cold_both"
    if bool(row["ic_is_cold"]) and not bool(row["instr_is_cold"]):
        return "cold_pair"
    if bool(row["instr_is_cold"]):
        return "cold_instr"
    if bool(row["course_is_cold"]):
        return "cold_course"
    return "warm"


def main() -> None:
    csv_path = PROC / "xgb_pred_test.csv"
    if not csv_path.exists():
        print("missing", csv_path, "— run 13_xgboost.py first", file=sys.stderr)
        sys.exit(1)

    pred_df = pd.read_csv(csv_path)
    if "pred" not in pred_df.columns or "avgGPA" not in pred_df.columns:
        print("unexpected columns in test csv", file=sys.stderr)
        sys.exit(1)

    f = pd.read_parquet(PROC / "features.parquet")
    test = f[f["split"] == "test"].copy()
    # Align by row order if same length else merge on keys
    if len(test) == len(pred_df):
        test = test.reset_index(drop=True)
        pred_df = pred_df.reset_index(drop=True)
        test["pred"] = pred_df["pred"].values
        test["avgGPA"] = pred_df["avgGPA"].values
    else:
        merged = test.merge(
            pred_df[["course_norm", "instructor_norm", "quarter", "year", "pred", "avgGPA"]],
            on=["course_norm", "instructor_norm", "quarter", "year"],
            how="inner",
        )
        test = merged

    test["regime"] = test.apply(regime_from_row, axis=1)

    PITCH.mkdir(parents=True, exist_ok=True)
    regimes = ["warm", "cold_instr", "cold_course", "cold_pair", "cold_both"]
    fig, axes = plt.subplots(2, 3, figsize=(11, 7))
    axes = axes.flatten()
    for ax, reg in zip(axes, regimes, strict=False):
        sub = test[test["regime"] == reg]
        if sub.empty:
            ax.set_title(f"{reg} — ACE bucket (n=0)")
            ax.axis("off")
            continue
        # 10 equal-count bins on predicted GPA
        try:
            sub = sub.assign(bin=pd.qcut(sub["pred"], q=min(10, max(3, len(sub) // 50)), duplicates="drop"))
        except ValueError:
            ax.set_title(f"{reg} — ACE bucket (n={len(sub)})")
            ax.axis("off")
            continue
        g = sub.groupby("bin", observed=True).agg(pred_mean=("pred", "mean"), actual_mean=("avgGPA", "mean")).reset_index()
        ax.scatter(g["pred_mean"], g["actual_mean"], s=40, alpha=0.85)
        lo, hi = g["pred_mean"].min(), g["pred_mean"].max()
        ax.plot([lo, hi], [lo, hi], "k--", linewidth=1, alpha=0.5)
        ax.set_xlabel("ACE predicted mean GPA (bin)")
        ax.set_ylabel("Actual section mean GPA")
        ax.set_title(f"{reg} — ACE /predict bucket (n={len(sub)} UCSB sections)")
        ax.grid(True, alpha=0.25)
    axes[-1].axis("off")
    fig.suptitle(
        "ACE: grade predictions track reality by cold-start regime\n"
        "(UCSB test sections — same split as MODEL_CARD; bins = equal counts)",
        fontsize=11.5,
    )
    fig.tight_layout()
    out = PITCH / "07_regime_reliability.svg"
    fig.savefig(out, format="svg")
    plt.close()
    print("wrote", out)

    idx = {
        "figure": str(out.relative_to(PROC)),
        "source_script": "data_pipeline/scripts/22_regime_reliability.py",
    }
    (PITCH / "regime_reliability_index.json").write_text(json.dumps(idx, indent=2))


if __name__ == "__main__":
    main()
