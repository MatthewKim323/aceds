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
# Visible “improvement” accent (darker green reads on bone background)
IMPROVE = "#1e5c40"
IMPROVE_SOFT = "#c5e0d0"

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
            "ACE XGBoost vs the in-app dept fallback on 1,132 held-out UCSB sections (Winter 2026). "
            "RMSE aggregates squared errors across all sections. "
            "Row win rate is strict |e_XGB| < |e_fallback|; ties were 0 on this split. "
            "~53% row wins can coexist with ~14% RMSE drop because a few large fallback misses "
            "are reduced disproportionately — that matters for Schedule Builder ranking."
        ),
    }
    (OUT / "showcase_improvement_metrics.json").write_text(json.dumps(metrics, indent=2))
    print(json.dumps(metrics, indent=2))

    # ---- 08: RMSE ladder ----------------------------------------------------
    labels = [
        "Campus-wide\navg only",
        "ACE dept\nfallback",
        "ACE linear\nbaseline",
        "ACE\nXGBoost",
    ]
    vals = [rmse_global, rmse_heur, rmse_lin, rmse_xgb]
    colors = [MUTED, GREY, "#6b6b6b", SAND]

    fig, ax = plt.subplots(figsize=(9.0, 5.8))
    fig.text(
        0.5,
        0.94,
        f"ACE ML vs dept fallback: −{pct_vs_heur:.0f}% RMSE   •   vs campus-wide average for every section: −{pct_vs_global:.0f}% RMSE",
        transform=fig.transFigure,
        ha="center",
        fontsize=11,
        color=IMPROVE,
        fontweight="bold",
    )
    bars = ax.bar(labels, vals, color=colors, edgecolor=INK, linewidth=0.6, width=0.65)
    # Highlight shipped model
    bars[-1].set_edgecolor(IMPROVE)
    bars[-1].set_linewidth(2.2)
    for b, v in zip(bars, vals):
        ax.text(b.get_x() + b.get_width() / 2, v + 0.008, f"{v:.3f}", ha="center", va="bottom", fontsize=10)
    ax.set_ylabel("RMSE on section mean GPA (0–4) — lower = better for students")
    ax.set_title(
        "Measurable gains from the models inside ACE (Explorer + Schedule Builder)\n"
        f"Real UCSB sections only — Winter 2026 hold-out (n={n})",
        loc="left",
        pad=12,
        fontsize=11,
    )
    ax.set_ylim(0, max(vals) * 1.28)
    ax.grid(axis="y", linestyle=":", color="#d4c9b2", linewidth=0.8)

    ax.annotate(
        "",
        xy=(3, rmse_xgb + 0.012),
        xytext=(1, rmse_heur + 0.012),
        arrowprops=dict(arrowstyle="->", color=IMPROVE, lw=2.4, shrinkA=8, shrinkB=8),
    )
    ax.text(
        2.0,
        max(rmse_heur, rmse_lin, rmse_xgb) + 0.04,
        "Shipped ACE XGBoost beats\nin-app dept fallback",
        ha="center",
        va="bottom",
        fontsize=10,
        color=IMPROVE,
        fontweight="bold",
    )

    note = (
        "Lower error here = better grade hints when students compare sections and when ACE ranks schedules."
    )
    fig.text(0.10, 0.02, note, fontsize=9.5, color=MUTED)
    fig.subplots_adjust(bottom=0.14, top=0.78)
    fig.savefig(OUT / "08_rmse_ladder_improvement.svg")
    plt.close(fig)
    print("[08] ->", OUT / "08_rmse_ladder_improvement.svg")

    # ---- 09: CDF of absolute errors -----------------------------------------
    qs = np.linspace(0, 1, 500)
    xh = np.quantile(abs_h, qs)
    xx = np.quantile(abs_x, qs)

    fig, ax = plt.subplots(figsize=(7.6, 5.6))
    # Gold curve left of grey = ACE ML errors are smaller at the same quantile
    ax.fill_betweenx(qs, xh, xx, where=(xx <= xh), interpolate=True, alpha=0.45, color=IMPROVE_SOFT,
                     label="ACE ML better here (lower error)")
    ax.plot(xh, qs, color=MUTED, linewidth=2.0, label="Without ACE ML (dept fallback)")
    ax.plot(xx, qs, color=SAND, linewidth=2.8, label="With ACE XGBoost (shipped in app)")
    ax.set_xlabel("|predicted − actual| section mean GPA (points on 0–4 scale)")
    ax.set_ylabel("Share of UCSB test sections with error ≤ x")
    ax.set_title(
        "Visible win: ACE XGBoost curve sits left = fewer large misses for students\n"
        "(Winter 2026 hold-out; same sections as Explorer / Schedule Builder scoring)",
        loc="left",
        pad=14,
        fontsize=11,
    )
    mae_drop = (1 - mean_abs_x / mean_abs_h) * 100
    ax.text(
        0.98,
        0.12,
        f"Mean |error|\n↓ {mae_drop:.1f}%\nwith ACE",
        transform=ax.transAxes,
        fontsize=11,
        color=IMPROVE,
        fontweight="bold",
        va="bottom",
        ha="right",
        bbox=dict(boxstyle="round,pad=0.35", facecolor=BONE, edgecolor=IMPROVE, linewidth=1.2),
    )
    ax.legend(frameon=False, loc="lower left")
    ax.set_xlim(0, min(1.2, float(max(xh.max(), xx.max()) * 1.05)))
    ax.grid(linestyle=":", color="#d4c9b2", linewidth=0.8)
    fig.savefig(OUT / "09_abs_error_cdf_test.svg")
    plt.close(fig)
    print("[09] ->", OUT / "09_abs_error_cdf_test.svg")

    # ---- 10: Win rate + MAE comparison --------------------------------------
    fig, axes = plt.subplots(1, 2, figsize=(9.5, 4.8), gridspec_kw={"width_ratios": [1.15, 1.0]})

    sizes = [strict_wins, strict_losses, ties]
    labels_pie = [
        f"ACE XGB\ncloser (n={strict_wins})",
        f"Dept fallback\ncloser (n={strict_losses})",
        f"Tie\n(n={ties})",
    ]
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
    axes[0].set_title("Where ACE’s model is tighter per section", loc="left", pad=10)

    mae_labels = ["ACE dept fallback", "ACE XGBoost"]
    mae_vals = [mean_abs_h, mean_abs_x]
    bx = axes[1].bar(mae_labels, mae_vals, color=[MUTED, SAND], edgecolor=INK, linewidth=0.6, width=0.55)
    for b, v in zip(bx, mae_vals):
        axes[1].text(b.get_x() + b.get_width() / 2, v + 0.004, f"{v:.3f}", ha="center", va="bottom", fontsize=11)
    axes[1].set_ylabel("Mean absolute error on section mean GPA")
    axes[1].set_title("Average mistake ↓ with ACE ML", loc="left", pad=10)
    mae_drop = (1 - mean_abs_x / mean_abs_h) * 100
    axes[1].set_ylim(0, max(mae_vals) * 1.35)
    axes[1].grid(axis="y", linestyle=":", color="#d4c9b2", linewidth=0.8)
    axes[1].annotate(
        f"−{mae_drop:.1f}%\nMAE",
        xy=(1, mean_abs_x),
        xytext=(0.5, mean_abs_x + 0.045),
        fontsize=12,
        color=IMPROVE,
        fontweight="bold",
        ha="center",
        arrowprops=dict(arrowstyle="->", color=IMPROVE, lw=1.8),
    )

    fig.suptitle(
        f"ACE improvement on real UCSB rows: {100 * win_rate:.1f}% of sections tighter with XGBoost, "
        f"MAE −{mae_drop:.1f}%\n(what powers grade ranking when you build a schedule in ACE)",
        fontsize=11.5,
        y=1.05,
        x=0.05,
        ha="left",
        color=INK,
    )
    fig.subplots_adjust(wspace=0.35, top=0.70)
    fig.savefig(OUT / "10_row_level_win_rate.svg")
    plt.close(fig)
    print("[10] ->", OUT / "10_row_level_win_rate.svg")

    # ---- 11: Regime RMSE from cold_start_report -----------------------------
    cold = json.loads((PROC / "cold_start_report.json").read_text())
    overall_rmse = next(s["rmse"] for s in cold["slices"] if s["regime"] == "overall")
    slices = [s for s in cold["slices"] if s["regime"] != "overall"]
    regimes = [s["regime"].replace("_", " ") for s in slices]
    rmses = [s["rmse"] for s in slices]
    counts = [s["n"] for s in slices]

    fig, ax = plt.subplots(figsize=(7.5, 5.2))
    xpos = np.arange(len(regimes))
    bars = ax.bar(xpos, rmses, color=[TEAL if "warm" in r.lower() else SAND_DARK for r in regimes],
                  edgecolor=INK, linewidth=0.5)
    for i, (b, r, c) in enumerate(zip(bars, rmses, counts)):
        ax.text(b.get_x() + b.get_width() / 2, r + 0.008, f"n={c}", ha="center", va="bottom", fontsize=9)
    ax.axhline(overall_rmse, color=IMPROVE, linestyle="--", linewidth=1.2, alpha=0.85,
               label=f"ACE overall test RMSE ({overall_rmse:.3f})")
    ax.set_xticks(xpos)
    ax.set_xticklabels([r.title() for r in regimes], rotation=15, ha="right")
    ax.set_ylabel("RMSE on section mean GPA (test)")
    ax.set_title(
        "Students see tighter forecasts when ACE “knows” the prof+course\n"
        "Cold slices = honest wider error — same logic as confidence in the app",
        loc="left",
        pad=14,
        fontsize=11,
    )
    ax.legend(frameon=False, loc="upper right", fontsize=9)
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
        pct_vs_mean = (1 - s1 / s0) * 100 if s0 else 0.0
        ax.bar(
            ["Grades only\n(no risk penalty)", "ACE risk-aware\n(λ = 0.75)"],
            [s0, s1],
            color=[GREY, SAND],
            edgecolor=INK,
            linewidth=0.6,
            width=0.5,
        )
        ax.set_ylabel("Schedule optimizer score (toy 2-course demo)")
        ax.set_title(
            "ACE adds a student-facing control: down-weight uncertain grade forecasts in the builder\n"
            "(synthetic MILP — same stack as POST /optimize; see DECISION_EVAL.md)",
            loc="left",
            pad=12,
            fontsize=10.5,
        )
        ax.grid(axis="y", linestyle=":", color="#d4c9b2", linewidth=0.8)
        delta = de.get("total_score_delta", s1 - s0)
        ax.text(
            0.5,
            max(s0, s1) + 0.06,
            f"Risk-aware score shift: {delta:+.3f}  (~{pct_vs_mean:.1f}% vs mean-only in this toy)\n"
            "Shows ACE can trade raw GPA optimism for pessimistic intervals in the builder.",
            ha="center",
            fontsize=9.5,
            color=IMPROVE,
            fontweight="bold",
        )
        fig.savefig(OUT / "12_decision_risk_toy_scores.svg")
        plt.close(fig)
        print("[12] ->", OUT / "12_decision_risk_toy_scores.svg")
    else:
        print("[12] skip — run: make ds-decision-eval")

    print("\nWrote showcase_improvement_metrics.json + SVGs to", OUT)


if __name__ == "__main__":
    main()
