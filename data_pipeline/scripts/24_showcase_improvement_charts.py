#!/usr/bin/env python3
"""
Showcase charts: *real* improvement metrics on the held-out test quarter.

Uses the same test rows as MODEL_CARD / 20_ablation_plots.py:
  - Row-level absolute errors: heuristic vs XGBoost (CDF, win rate).
  - Aggregate RMSE ladder: global mean → heuristic → ElasticNet → XGBoost.
  - Cold-start regime RMSE (from cold_start_report.json).
  - Decision-layer toy: scores from decision_eval_synthetic.json (clearly labeled synthetic).

Outputs (processed/pitch/):
  08_rmse_ladder_improvement.svg
  09_abs_error_cdf_test.svg
  10_row_level_win_rate.svg
  11_regime_rmse_test.svg
  12_decision_risk_toy_scores.svg
  showcase_improvement_metrics.json

Run:  python data_pipeline/scripts/24_showcase_improvement_charts.py
After: 20_ablation_plots.py (needs merged test predictions + lin pred path — we recompute lin minimal or skip EN in CDF).

This script is self-contained: recomputes ElasticNet on train / test like 20_ablation_plots.py.
"""
from __future__ import annotations

import json
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from matplotlib import rcParams
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.linear_model import ElasticNet
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

ROOT = Path(__file__).resolve().parents[2]
PROC = ROOT / "data_pipeline" / "processed"
OUT = PROC / "pitch"
OUT.mkdir(parents=True, exist_ok=True)

INK = "#101012"
BONE = "#f5f1ea"
SAND = "#c9a46a"
SAND_DARK = "#8b6f3c"
GREY = "#9b9b9b"
MUTED = "#4a4a4a"
TEAL = "#2d6a6a"

rcParams.update({
    "font.family": "DejaVu Serif",
    "font.size": 11,
    "axes.edgecolor": INK,
    "axes.linewidth": 0.8,
    "axes.spines.top": False,
    "axes.spines.right": False,
    "axes.labelcolor": INK,
    "xtick.color": INK,
    "ytick.color": INK,
    "text.color": INK,
    "figure.facecolor": BONE,
    "axes.facecolor": BONE,
    "savefig.facecolor": BONE,
    "savefig.bbox": "tight",
})


def rmse(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    return float(np.sqrt(np.mean((np.asarray(y_true, float) - np.asarray(y_pred, float)) ** 2)))


def heuristic_predict(df: pd.DataFrame, global_mean: float) -> np.ndarray:
    out = df["ic_hist_mean_gpa"].copy()
    out = out.fillna(df["instr_hist_mean_gpa"])
    out = out.fillna(df["course_hist_mean_gpa"])
    out = out.fillna(df["dept_hist_mean_gpa"])
    out = out.fillna(global_mean)
    return out.values


def load_merged_test() -> pd.DataFrame:
    features = pd.read_parquet(PROC / "features.parquet")
    xgb_pred = pd.read_csv(PROC / "xgb_pred_test.csv")
    heur_report = json.loads((PROC / "baseline_heuristic_report.json").read_text())
    train_mean = heur_report["global_train_mean"]

    test_df = features[features["split"] == "test"].copy().reset_index(drop=True)
    test_df["heur_pred"] = heuristic_predict(test_df, train_mean)

    NUMERIC = [
        "unitsFixed", "instr_hist_mean_gpa", "instr_hist_gpa_std", "instr_hist_n_sections",
        "course_hist_mean_gpa", "course_hist_gpa_std", "course_hist_n_sections",
        "ic_hist_mean_gpa", "ic_hist_n_sections", "dept_hist_mean_gpa", "dept_hist_gpa_std",
        "years_since_instr_first_taught", "rmp_rating", "rmp_difficulty",
        "rmp_num_ratings", "rmp_would_take_again",
    ]
    CAT = ["dept", "quarter", "course_level", "rmp_confidence"]
    BOOL = ["is_ge", "instr_is_cold", "course_is_cold", "ic_is_cold", "rmp_match"]

    fd = features[features["avgGPA"].notna()].copy()
    for c in BOOL:
        fd[c] = fd[c].astype(float)

    pre = ColumnTransformer([
        ("num", Pipeline([("imp", SimpleImputer(strategy="median")), ("sc", StandardScaler())]),
         NUMERIC + BOOL),
        ("cat", OneHotEncoder(handle_unknown="ignore", min_frequency=10, sparse_output=False), CAT),
    ])
    lin = Pipeline([("pre", pre), ("en", ElasticNet(alpha=0.001, l1_ratio=0.2, max_iter=10_000))])
    mask_train = fd["split"].values == "train"
    lin.fit(fd.loc[mask_train, NUMERIC + BOOL + CAT], fd.loc[mask_train, "avgGPA"].astype(float).values)
    mask_test = fd["split"].values == "test"
    lin_pred = lin.predict(fd.loc[mask_test, NUMERIC + BOOL + CAT])
    test_df["lin_pred"] = lin_pred

    join_keys = ["course_norm", "instructor_norm", "quarter", "year"]
    merged = test_df.merge(
        xgb_pred[join_keys + ["pred"]].rename(columns={"pred": "xgb_pred"}),
        on=join_keys,
        how="left",
    )
    if merged["xgb_pred"].isna().any():
        raise RuntimeError("Missing XGB predictions on test — run 13_xgboost.py first.")
    return merged


def main() -> None:
    merged = load_merged_test()
    y = merged["avgGPA"].astype(float).values
    heur = merged["heur_pred"].values
    lin = merged["lin_pred"].values
    xgb = merged["xgb_pred"].values
    n = len(y)

    heur_report = json.loads((PROC / "baseline_heuristic_report.json").read_text())
    mu0 = heur_report["global_train_mean"]
    global_pred = np.full(n, mu0, dtype=float)

    rmse_global = rmse(y, global_pred)
    rmse_heur = rmse(y, heur)
    rmse_lin = rmse(y, lin)
    rmse_xgb = rmse(y, xgb)

    pct_vs_heur = (1 - rmse_xgb / rmse_heur) * 100
    pct_vs_global = (1 - rmse_xgb / rmse_global) * 100

    abs_h = np.abs(y - heur)
    abs_x = np.abs(y - xgb)
    strict_wins = np.sum(abs_x < abs_h)
    strict_losses = np.sum(abs_x > abs_h)
    ties = np.sum(abs_x == abs_h)
    win_rate = strict_wins / n

    median_abs_h = float(np.median(abs_h))
    median_abs_x = float(np.median(abs_x))
    mean_abs_h = float(np.mean(abs_h))
    mean_abs_x = float(np.mean(abs_x))

    metrics = {
        "test_quarter": "2026 Winter (held-out)",
        "n_test_sections": n,
        "rmse_global_mean": rmse_global,
        "rmse_heuristic": rmse_heur,
        "rmse_elastic_net": rmse_lin,
        "rmse_xgboost": rmse_xgb,
        "pct_rmse_reduction_vs_heuristic": round(pct_vs_heur, 2),
        "pct_rmse_reduction_vs_global_mean": round(pct_vs_global, 2),
        "row_level_win_rate_xgb_vs_heuristic": round(win_rate, 4),
        "row_level_strict_wins": int(strict_wins),
        "row_level_strict_losses": int(strict_losses),
        "row_level_ties": int(ties),
        "median_abs_error_heuristic": median_abs_h,
        "median_abs_error_xgboost": median_abs_x,
        "mean_abs_error_heuristic": mean_abs_h,
        "mean_abs_error_xgboost": mean_abs_x,
        "interpretation": (
            "RMSE aggregates squared errors across all 1,132 held-out sections. "
            "Row win rate is strict |e_XGB| < |e_heur|; ties were 0 on this split. "
            "Slightly >50% row wins can coexist with ~14% RMSE drop because a few "
            "large heuristic misses are reduced disproportionately by XGBoost."
        ),
    }
    (OUT / "showcase_improvement_metrics.json").write_text(json.dumps(metrics, indent=2))
    print(json.dumps(metrics, indent=2))

    # ---- 08: RMSE ladder ----------------------------------------------------
    labels = ["Global mean\n(baseline)", "Heuristic\ncascade", "ElasticNet", "XGBoost"]
    vals = [rmse_global, rmse_heur, rmse_lin, rmse_xgb]
    colors = [MUTED, GREY, "#6b6b6b", SAND]

    fig, ax = plt.subplots(figsize=(8.5, 5.2))
    bars = ax.bar(labels, vals, color=colors, edgecolor=INK, linewidth=0.6, width=0.65)
    for b, v in zip(bars, vals):
        ax.text(b.get_x() + b.get_width() / 2, v + 0.008, f"{v:.3f}", ha="center", va="bottom", fontsize=10)
    ax.set_ylabel("RMSE (section mean GPA)")
    ax.set_title(
        f"Prediction error on held-out test (n={n}) — lower is better",
        loc="left",
        pad=14,
    )
    ax.axhline(rmse_heur, color=SAND_DARK, linestyle=":", linewidth=0.9, alpha=0.7)
    ax.set_ylim(0, max(vals) * 1.18)
    ax.grid(axis="y", linestyle=":", color="#d4c9b2", linewidth=0.8)
    note = (
        f"XGBoost vs heuristic: −{pct_vs_heur:.1f}% RMSE  ·  "
        f"vs always predicting train mean: −{pct_vs_global:.1f}% RMSE"
    )
    fig.text(0.12, 0.02, note, fontsize=9.5, color=MUTED)
    fig.subplots_adjust(bottom=0.18)
    fig.savefig(OUT / "08_rmse_ladder_improvement.svg")
    plt.close(fig)
    print("[08] ->", OUT / "08_rmse_ladder_improvement.svg")

    # ---- 09: CDF of absolute errors -----------------------------------------
    qs = np.linspace(0, 1, 500)
    xh = np.quantile(abs_h, qs)
    xx = np.quantile(abs_x, qs)

    fig, ax = plt.subplots(figsize=(7.2, 5.4))
    ax.plot(xh, qs, color=MUTED, linewidth=2.0, label="Heuristic |error|")
    ax.plot(xx, qs, color=SAND, linewidth=2.2, label="XGBoost |error|")
    ax.set_xlabel("Absolute error (GPA points)")
    ax.set_ylabel("Fraction of test sections ≤ error")
    ax.set_title("Row-level error distribution — same 1,132 held-out sections", loc="left", pad=14)
    ax.legend(frameon=False, loc="lower right")
    ax.set_xlim(0, min(1.2, float(max(xh.max(), xx.max()) * 1.05)))
    ax.grid(linestyle=":", color="#d4c9b2", linewidth=0.8)
    fig.savefig(OUT / "09_abs_error_cdf_test.svg")
    plt.close(fig)
    print("[09] ->", OUT / "09_abs_error_cdf_test.svg")

    # ---- 10: Win rate + MAE comparison --------------------------------------
    fig, axes = plt.subplots(1, 2, figsize=(9.5, 4.8), gridspec_kw={"width_ratios": [1.15, 1.0]})

    sizes = [strict_wins, strict_losses, ties]
    labels_pie = [f"XGB tighter\n(n={strict_wins})", f"Heuristic tighter\n(n={strict_losses})", f"Tie\n(n={ties})"]
    colors_pie = [SAND, MUTED, GREY]
    explode = (0.02, 0, 0)
    axes[0].pie(
        sizes,
        labels=labels_pie,
        colors=colors_pie,
        explode=explode,
        autopct="%1.1f%%",
        startangle=90,
        wedgeprops={"edgecolor": INK, "linewidth": 0.5},
        textprops={"fontsize": 9},
    )
    axes[0].set_title("Per-section: who has lower |error|?", loc="left", pad=10)

    mae_labels = ["Heuristic", "XGBoost"]
    mae_vals = [mean_abs_h, mean_abs_x]
    bx = axes[1].bar(mae_labels, mae_vals, color=[MUTED, SAND], edgecolor=INK, linewidth=0.6, width=0.55)
    for b, v in zip(bx, mae_vals):
        axes[1].text(b.get_x() + b.get_width() / 2, v + 0.004, f"{v:.3f}", ha="center", va="bottom", fontsize=11)
    axes[1].set_ylabel("Mean absolute error (test)")
    axes[1].set_title("Aggregate MAE on same rows", loc="left", pad=10)
    axes[1].set_ylim(0, max(mae_vals) * 1.2)
    axes[1].grid(axis="y", linestyle=":", color="#d4c9b2", linewidth=0.8)

    fig.suptitle(
        f"Head-to-head on held-out test — XGB wins {100 * win_rate:.1f}% of rows (strict)",
        fontsize=12,
        y=1.02,
        x=0.08,
        ha="left",
    )
    fig.subplots_adjust(wspace=0.35, top=0.82)
    fig.savefig(OUT / "10_row_level_win_rate.svg")
    plt.close(fig)
    print("[10] ->", OUT / "10_row_level_win_rate.svg")

    # ---- 11: Regime RMSE from cold_start_report -----------------------------
    cold = json.loads((PROC / "cold_start_report.json").read_text())
    slices = [s for s in cold["slices"] if s["regime"] != "overall"]
    regimes = [s["regime"].replace("_", " ") for s in slices]
    rmses = [s["rmse"] for s in slices]
    counts = [s["n"] for s in slices]

    fig, ax = plt.subplots(figsize=(7.5, 5.0))
    xpos = np.arange(len(regimes))
    bars = ax.bar(xpos, rmses, color=[TEAL if "warm" in r.lower() else SAND_DARK for r in regimes],
                  edgecolor=INK, linewidth=0.5)
    for i, (b, r, c) in enumerate(zip(bars, rmses, counts)):
        ax.text(b.get_x() + b.get_width() / 2, r + 0.008, f"n={c}", ha="center", va="bottom", fontsize=9)
    ax.set_xticks(xpos)
    ax.set_xticklabels([r.title() for r in regimes], rotation=15, ha="right")
    ax.set_ylabel("Test RMSE")
    ax.set_title("Cold-start regimes — uncertainty matches harder slices", loc="left", pad=14)
    ax.grid(axis="y", linestyle=":", color="#d4c9b2", linewidth=0.8)
    fig.savefig(OUT / "11_regime_rmse_test.svg")
    plt.close(fig)
    print("[11] ->", OUT / "11_regime_rmse_test.svg")

    # ---- 12: Decision toy from JSON -----------------------------------------
    de_path = PROC / "decision_eval_synthetic.json"
    if de_path.exists():
        de = json.loads(de_path.read_text())
        s0 = de["mean_only"]["total_score"]
        s1 = de["risk_aware"]["total_score"]
        fig, ax = plt.subplots(figsize=(5.5, 4.8))
        ax.bar(["Mean-only\nobjective", "Risk-aware\n(λ=0.75)"], [s0, s1], color=[GREY, SAND],
               edgecolor=INK, linewidth=0.6, width=0.5)
        ax.set_ylabel("PuLP total score (toy instance)")
        ax.set_title(
            "Decision layer: risk-aware term changes objective\n"
            "(synthetic 2-course MILP — see DECISION_EVAL.md)",
            loc="left",
            pad=12,
        )
        ax.grid(axis="y", linestyle=":", color="#d4c9b2", linewidth=0.8)
        delta = de.get("total_score_delta", s1 - s0)
        ax.annotate(
            f"Δ = {delta:+.4f}",
            xy=(1, s1),
            xytext=(0.55, min(s0, s1) - 0.08),
            fontsize=10,
            arrowprops=dict(arrowstyle="->", color=INK, lw=0.8),
        )
        fig.savefig(OUT / "12_decision_risk_toy_scores.svg")
        plt.close(fig)
        print("[12] ->", OUT / "12_decision_risk_toy_scores.svg")
    else:
        print("[12] skip — run: make ds-decision-eval")

    print("\nWrote showcase_improvement_metrics.json + SVGs to", OUT)


if __name__ == "__main__":
    main()
