#!/usr/bin/env python3
"""
ElasticNet linear baseline.

Gives the pitch a third datapoint between the hand-coded heuristic and XGBoost.
Shows that even a disciplined linear model with one-hot encoded categoricals
beats the heuristic slightly but loses to gradient boosting by a clean margin.

Outputs:
    processed/baseline_linear_report.json
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.linear_model import ElasticNet
from sklearn.metrics import mean_absolute_error, r2_score, mean_squared_error
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

ROOT = Path(__file__).resolve().parents[2]
PROC = ROOT / "data_pipeline" / "processed"


def _metrics(y_true, y_pred):
    rmse = float(np.sqrt(mean_squared_error(y_true, y_pred)))
    return {"n": int(len(y_true)), "rmse": rmse, "r2": float(r2_score(y_true, y_pred)), "mae": float(mean_absolute_error(y_true, y_pred))}


def main() -> None:
    df = pd.read_parquet(PROC / "features.parquet")
    df = df[df["avgGPA"].notna()]

    numeric_cols = [
        "unitsFixed",
        "instr_hist_mean_gpa",
        "instr_hist_gpa_std",
        "instr_hist_n_sections",
        "course_hist_mean_gpa",
        "course_hist_gpa_std",
        "course_hist_n_sections",
        "ic_hist_mean_gpa",
        "ic_hist_n_sections",
        "dept_hist_mean_gpa",
        "dept_hist_gpa_std",
        "years_since_instr_first_taught",
        "rmp_rating",
        "rmp_difficulty",
        "rmp_num_ratings",
        "rmp_would_take_again",
    ]
    cat_cols = ["dept", "quarter", "course_level", "rmp_confidence"]
    bool_cols = ["is_ge", "instr_is_cold", "course_is_cold", "ic_is_cold", "rmp_match"]

    # Coerce booleans to int
    for c in bool_cols:
        if c in df.columns:
            df[c] = df[c].astype(float)

    X = df[numeric_cols + bool_cols + cat_cols].copy()
    y = df["avgGPA"].astype(float).values
    split = df["split"].values

    pre = ColumnTransformer(
        [
            (
                "num",
                Pipeline(
                    [
                        ("imp", SimpleImputer(strategy="median")),
                        ("sc", StandardScaler()),
                    ]
                ),
                numeric_cols + bool_cols,
            ),
            (
                "cat",
                OneHotEncoder(handle_unknown="ignore", min_frequency=10, sparse_output=False),
                cat_cols,
            ),
        ]
    )
    model = Pipeline([("pre", pre), ("en", ElasticNet(alpha=0.001, l1_ratio=0.2, max_iter=10_000))])

    mask_train = split == "train"
    model.fit(X[mask_train], y[mask_train])

    out = {"alpha": 0.001, "l1_ratio": 0.2, "n_features": int(model.named_steps["pre"].transform(X.head(1)).shape[1]), "splits": {}}
    for name in ("train", "val", "test"):
        m = split == name
        if not m.any():
            continue
        preds = model.predict(X[m])
        out["splits"][name] = _metrics(y[m], preds)

    (PROC / "baseline_linear_report.json").write_text(json.dumps(out, indent=2))
    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
