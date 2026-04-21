#!/usr/bin/env python3
"""
Train XGBoost grade predictor on processed/features.parquet.

Outputs:
  processed/xgb_model.json          XGBoost JSON artifact
  processed/xgb_feature_cols.json   Feature column list (for inference alignment)
  processed/xgb_report.json         Train/val/test metrics + per-dept breakdown
  processed/xgb_pred_test.csv       Per-row predictions on test set (for ablation plots)

Usage:
    python scripts/13_xgboost.py            # baseline
    python scripts/13_xgboost.py --tune     # Optuna sweep (~15 min)
    python scripts/13_xgboost.py --no-rmp   # ablation: drop RMP features
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd
import xgboost as xgb

PIPELINE = Path(__file__).resolve().parents[1]
PROC = PIPELINE / "processed"

CATEGORICAL_COLS = ["course_level", "rmp_confidence", "quarter", "dept"]
NUMERIC_COLS_BASE = [
    "year",
    "unitsFixed",
    "is_ge",
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
    "instr_is_cold",
    "course_is_cold",
    "ic_is_cold",
    "years_since_instr_first_taught",
]
RMP_COLS = ["rmp_rating", "rmp_difficulty", "rmp_num_ratings", "rmp_would_take_again"]


def rmse(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    return float(np.sqrt(np.mean((y_true - y_pred) ** 2)))


def r2(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    ss_res = np.sum((y_true - y_pred) ** 2)
    ss_tot = np.sum((y_true - np.mean(y_true)) ** 2)
    return float(1.0 - ss_res / ss_tot) if ss_tot > 0 else 0.0


def prepare(df: pd.DataFrame, feature_cols: list[str]) -> pd.DataFrame:
    X = df[feature_cols].copy()
    for c in CATEGORICAL_COLS:
        if c in X.columns:
            X[c] = X[c].astype("category")
    for c in X.columns:
        if c in CATEGORICAL_COLS:
            continue
        X[c] = pd.to_numeric(X[c], errors="coerce")
    return X


def train_once(
    X_train: pd.DataFrame,
    y_train: np.ndarray,
    X_val: pd.DataFrame,
    y_val: np.ndarray,
    params: dict,
    num_boost_round: int,
) -> xgb.Booster:
    dtrain = xgb.DMatrix(X_train, label=y_train, enable_categorical=True)
    dval = xgb.DMatrix(X_val, label=y_val, enable_categorical=True)
    booster = xgb.train(
        params,
        dtrain,
        num_boost_round=num_boost_round,
        evals=[(dtrain, "train"), (dval, "val")],
        early_stopping_rounds=30,
        verbose_eval=50,
    )
    return booster


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tune", action="store_true")
    ap.add_argument("--no-rmp", action="store_true", help="Ablation: drop RMP columns")
    ap.add_argument("--no-history", action="store_true", help="Ablation: drop historical aggregates")
    ap.add_argument("--rounds", type=int, default=600)
    args = ap.parse_args()

    f = pd.read_parquet(PROC / "features.parquet")
    train = f[f["split"] == "train"].copy()
    val = f[f["split"] == "val"].copy()
    test = f[f["split"] == "test"].copy()

    numeric_cols = list(NUMERIC_COLS_BASE)
    if not args.no_rmp:
        numeric_cols += RMP_COLS
    if args.no_history:
        numeric_cols = [c for c in numeric_cols if "hist_" not in c]

    feature_cols = numeric_cols + CATEGORICAL_COLS
    feature_cols = [c for c in feature_cols if c in f.columns]

    X_train = prepare(train, feature_cols)
    X_val = prepare(val, feature_cols)
    X_test = prepare(test, feature_cols)

    y_train = train["avgGPA"].values
    y_val = val["avgGPA"].values
    y_test = test["avgGPA"].values

    base_params = {
        "objective": "reg:squarederror",
        "eval_metric": "rmse",
        "learning_rate": 0.05,
        "max_depth": 6,
        "min_child_weight": 5,
        "subsample": 0.8,
        "colsample_bytree": 0.8,
        "reg_alpha": 0.1,
        "reg_lambda": 1.0,
        "tree_method": "hist",
    }

    if args.tune:
        import optuna

        def objective(trial: optuna.Trial) -> float:
            params = dict(base_params)
            params.update(
                {
                    "learning_rate": trial.suggest_float("learning_rate", 0.02, 0.15, log=True),
                    "max_depth": trial.suggest_int("max_depth", 4, 10),
                    "min_child_weight": trial.suggest_int("min_child_weight", 1, 12),
                    "subsample": trial.suggest_float("subsample", 0.6, 1.0),
                    "colsample_bytree": trial.suggest_float("colsample_bytree", 0.5, 1.0),
                    "reg_alpha": trial.suggest_float("reg_alpha", 1e-3, 1.0, log=True),
                    "reg_lambda": trial.suggest_float("reg_lambda", 1e-3, 5.0, log=True),
                }
            )
            booster = train_once(X_train, y_train, X_val, y_val, params, args.rounds)
            dval = xgb.DMatrix(X_val, label=y_val, enable_categorical=True)
            return rmse(y_val, booster.predict(dval))

        study = optuna.create_study(direction="minimize")
        study.optimize(objective, n_trials=30, show_progress_bar=True)
        base_params.update(study.best_params)
        print(f"best params: {study.best_params}")

    booster = train_once(X_train, y_train, X_val, y_val, base_params, args.rounds)

    report = {"params": base_params, "splits": {}, "ablation": {
        "no_rmp": args.no_rmp,
        "no_history": args.no_history,
    }}
    for name, X, y in (("train", X_train, y_train), ("val", X_val, y_val), ("test", X_test, y_test)):
        d = xgb.DMatrix(X, label=y, enable_categorical=True)
        pred = booster.predict(d)
        report["splits"][name] = {
            "n": int(len(y)),
            "rmse": rmse(y, pred),
            "r2": r2(y, pred),
            "mae": float(np.mean(np.abs(y - pred))),
        }

    # persist
    suffix = ""
    if args.no_rmp:
        suffix += "_no_rmp"
    if args.no_history:
        suffix += "_no_hist"
    booster.save_model(str(PROC / f"xgb_model{suffix}.json"))
    (PROC / f"xgb_feature_cols{suffix}.json").write_text(
        json.dumps({"feature_cols": feature_cols, "categorical_cols": CATEGORICAL_COLS}, indent=2)
    )

    # test predictions for downstream plots
    dtest = xgb.DMatrix(X_test, label=y_test, enable_categorical=True)
    test_pred = pd.DataFrame({
        "course_norm": test["course_norm"].values,
        "instructor_norm": test["instructor_norm"].values,
        "quarter": test["quarter"].values,
        "year": test["year"].values,
        "dept": test["dept"].values,
        "avgGPA": y_test,
        "pred": booster.predict(dtest),
    })
    test_pred.to_csv(PROC / f"xgb_pred_test{suffix}.csv", index=False)

    (PROC / f"xgb_report{suffix}.json").write_text(json.dumps(report, indent=2))
    print("\n" + json.dumps(report["splits"], indent=2))


if __name__ == "__main__":
    main()
