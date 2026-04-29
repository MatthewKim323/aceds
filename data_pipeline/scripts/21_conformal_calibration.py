#!/usr/bin/env python3
"""
Split-style calibration: (1-alpha) quantile of |y - y_hat| per cold-start regime on VAL.

Writes:
  data_pipeline/processed/conformal_quantiles.json
Copies to:
  backend/app/ml/artifacts/conformal_quantiles.json  (when run from repo root)

Requires: processed/features.parquet, processed/xgb_model.json, processed/xgb_feature_cols.json
(from scripts/13_xgboost.py).

Usage:
  cd data_pipeline && python scripts/21_conformal_calibration.py
"""

from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import xgboost as xgb

PIPELINE = Path(__file__).resolve().parents[1]
PROC = PIPELINE / "processed"
ROOT = PIPELINE.parent
ARTIFACTS = ROOT / "backend" / "app" / "ml" / "artifacts"

# Mirror scripts/13_xgboost.py regime logic (must match predictor._regime).
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
    feat_path = PROC / "features.parquet"
    model_path = PROC / "xgb_model.json"
    cols_path = PROC / "xgb_feature_cols.json"
    for p in (feat_path, model_path, cols_path):
        if not p.exists():
            print(f"missing {p}; run scripts/13_xgboost.py first", file=sys.stderr)
            sys.exit(1)

    meta = json.loads(cols_path.read_text())
    feature_cols = meta["feature_cols"]
    categorical_cols = meta["categorical_cols"]

    df = pd.read_parquet(feat_path)
    val = df[df["split"] == "val"].copy()
    if val.empty:
        print("no val split", file=sys.stderr)
        sys.exit(1)

    X = val.reindex(columns=feature_cols).copy()
    for c in categorical_cols:
        if c in X.columns:
            X[c] = X[c].astype("category")
    for c in X.columns:
        if c not in categorical_cols:
            X[c] = pd.to_numeric(X[c], errors="coerce")

    y = val["avgGPA"].values
    booster = xgb.Booster()
    booster.load_model(str(model_path))
    pred = booster.predict(xgb.DMatrix(X, enable_categorical=True))
    abs_res = np.abs(y - pred)
    regimes = val.apply(regime_from_row, axis=1).values

    alpha = 0.10
    q_level = 1.0 - alpha / 2.0  # symmetric two-sided ~90% if Gaussian-ish; use high quantile of |res|
    quantile_abs_by_regime: dict[str, float] = {}
    for reg in sorted(set(regimes)):
        mask = regimes == reg
        arr = abs_res[mask]
        if len(arr) < 30:
            # Pool sparse regimes toward warm for stability
            arr = abs_res
        q = float(np.quantile(arr, q_level))
        quantile_abs_by_regime[str(reg)] = max(q, 0.05)

    out = {
        "coverage_target": 1.0 - alpha,
        "alpha": alpha,
        "quantile_level": q_level,
        "split": "val",
        "method": "split_abs_residual_per_regime",
        "quantile_abs_by_regime": quantile_abs_by_regime,
        "n_val": int(len(val)),
    }
    out_path = PROC / "conformal_quantiles.json"
    out_path.write_text(json.dumps(out, indent=2))
    print("wrote", out_path)

    if ARTIFACTS.is_dir():
        dest = ARTIFACTS / "conformal_quantiles.json"
        shutil.copy(out_path, dest)
        print("copied ->", dest)


if __name__ == "__main__":
    main()
