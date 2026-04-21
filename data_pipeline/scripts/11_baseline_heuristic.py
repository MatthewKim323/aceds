#!/usr/bin/env python3
"""
Heuristic baseline for grade prediction. Establishes the floor that any ML
model must beat to justify complexity.

Rule: use the most specific history we have, with a fallback chain.
    ic_hist_mean_gpa  ->  instr_hist_mean_gpa  ->  course_hist_mean_gpa
                                                ->  dept_hist_mean_gpa
                                                ->  global_train_mean

Evaluated on val + test split in processed/features.parquet.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

PIPELINE = Path(__file__).resolve().parents[1]
PROC = PIPELINE / "processed"


def rmse(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    return float(np.sqrt(np.mean((y_true - y_pred) ** 2)))


def r2(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    ss_res = np.sum((y_true - y_pred) ** 2)
    ss_tot = np.sum((y_true - np.mean(y_true)) ** 2)
    return float(1.0 - ss_res / ss_tot) if ss_tot > 0 else 0.0


def predict(df: pd.DataFrame, global_mean: float) -> np.ndarray:
    out = df["ic_hist_mean_gpa"].copy()
    out = out.fillna(df["instr_hist_mean_gpa"])
    out = out.fillna(df["course_hist_mean_gpa"])
    out = out.fillna(df["dept_hist_mean_gpa"])
    out = out.fillna(global_mean)
    return out.values


def main() -> None:
    f = pd.read_parquet(PROC / "features.parquet")
    train = f[f["split"] == "train"]
    global_mean = float(train["avgGPA"].mean())

    report = {"global_train_mean": global_mean, "splits": {}}
    for split_name in ("val", "test"):
        sub = f[f["split"] == split_name]
        y = sub["avgGPA"].values
        yhat = predict(sub, global_mean)
        report["splits"][split_name] = {
            "n": int(len(sub)),
            "rmse": rmse(y, yhat),
            "r2": r2(y, yhat),
            "mae": float(np.mean(np.abs(y - yhat))),
        }

    per_dept_rows = []
    for split_name in ("val", "test"):
        sub = f[f["split"] == split_name]
        yhat_all = predict(sub, global_mean)
        sub = sub.assign(pred=yhat_all)
        for dept, g in sub.groupby("dept"):
            if len(g) < 30:
                continue
            per_dept_rows.append({
                "split": split_name,
                "dept": dept,
                "n": int(len(g)),
                "rmse": rmse(g["avgGPA"].values, g["pred"].values),
            })

    per_dept = pd.DataFrame(per_dept_rows).sort_values(["split", "rmse"], ascending=[True, False])
    per_dept_path = PROC / "baseline_heuristic_per_dept.csv"
    per_dept.to_csv(per_dept_path, index=False)

    out_path = PROC / "baseline_heuristic_report.json"
    out_path.write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))
    print(f"\nper-dept breakdown -> {per_dept_path}")


if __name__ == "__main__":
    main()
