#!/usr/bin/env python3
"""
Cold-start analysis. Slices the XGBoost test-set predictions by regime
(warm / cold course / cold instructor / cold both) and reports RMSE per slice.

Input:
    processed/xgb_pred_test.csv          (written by 13_xgboost.py)
    processed/features.parquet           (for the cold-flag columns)

Output:
    processed/cold_start_report.md
    processed/cold_start_report.json
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
PROC = ROOT / "data_pipeline" / "processed"


def _regime(row) -> str:
    if row.ic_is_cold and row.instr_is_cold:
        return "cold_both"
    if row.ic_is_cold and not row.instr_is_cold:
        return "cold_pair"
    if row.instr_is_cold:
        return "cold_instr"
    if row.course_is_cold:
        return "cold_course"
    return "warm"


def main() -> None:
    preds = pd.read_csv(PROC / "xgb_pred_test.csv")
    feats = pd.read_parquet(PROC / "features.parquet")
    feats = feats[feats["split"] == "test"].reset_index(drop=True)

    # Align by index (both in the same order after the split filter in 13_xgboost)
    if len(preds) != len(feats):
        raise SystemExit(f"pred rows ({len(preds)}) != test rows ({len(feats)})")
    feats["pred"] = preds["pred"].values
    feats["regime"] = feats.apply(_regime, axis=1)

    rows = []
    for reg, g in feats.groupby("regime", sort=False):
        err = g["avgGPA"].values - g["pred"].values
        rmse = float(np.sqrt((err ** 2).mean()))
        bias = float(err.mean())
        rows.append({"regime": reg, "n": int(len(g)), "rmse": round(rmse, 4), "bias": round(bias, 4)})
    rows = sorted(rows, key=lambda r: r["rmse"])
    overall = {
        "regime": "overall",
        "n": int(len(feats)),
        "rmse": float(np.sqrt(((feats["avgGPA"] - feats["pred"]) ** 2).mean())),
        "bias": float((feats["avgGPA"] - feats["pred"]).mean()),
    }
    rows.append(overall)

    out = {"slices": rows}
    (PROC / "cold_start_report.json").write_text(json.dumps(out, indent=2))

    md = ["# Cold-start analysis", "", "| regime | n | RMSE | bias |", "|---|---:|---:|---:|"]
    for r in rows:
        md.append(f"| {r['regime']} | {r['n']} | {r['rmse']:.4f} | {r['bias']:+.4f} |")
    (PROC / "cold_start_report.md").write_text("\n".join(md))
    print("\n".join(md))


if __name__ == "__main__":
    main()
