#!/usr/bin/env python3
"""
Regenerate every pitch-deck asset from scratch.

Inputs  : processed/features.parquet, processed/xgb_model.json,
          processed/xgb_feature_cols.json, processed/xgb_pred_test*.csv,
          processed/baseline_*_report.json, processed/cold_start_report.json,
          processed/unified.csv
Outputs : processed/pitch/01_per_dept_rmse.svg
          processed/pitch/02_calibration.svg
          processed/pitch/03_feature_ablation.svg
          processed/pitch/04_feature_importance.svg
          processed/pitch/05_optimizer_latency.svg
          processed/pitch/06_data_coverage.svg
          processed/pitch/metrics_table.json
          processed/pitch/metrics_table.md

Run     : python data_pipeline/scripts/20_ablation_plots.py
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import xgboost as xgb
from matplotlib import rcParams
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.linear_model import ElasticNet
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

# Import optimizer from the backend package (we share the file tree).
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
from app.ml.optimizer import SectionCandidate, optimize  # type: ignore  # noqa: E402
from app.models.schemas import OptimizeRequest, OptimizePreferences  # type: ignore  # noqa: E402

PROC = ROOT / "data_pipeline" / "processed"
OUT = PROC / "pitch"
OUT.mkdir(exist_ok=True)

# ---- aesthetics: dark monochrome + sand accent (matches frontend) -----------
INK = "#101012"
BONE = "#f5f1ea"
SAND = "#c9a46a"  # warm accent
SAND_DARK = "#8b6f3c"
GREY = "#9b9b9b"
MUTED = "#4a4a4a"
PALETTE = [INK, SAND, "#5c5c5c"]  # heuristic, linear, xgb order

rcParams.update({
    "font.family": "DejaVu Serif",  # ships with matplotlib, warm + editorial
    "font.size": 10.5,
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
    return float(np.sqrt(np.mean((y_true - y_pred) ** 2)))


# ---- 0. load everything once ------------------------------------------------

features = pd.read_parquet(PROC / "features.parquet")
unified = pd.read_csv(PROC / "unified.csv", low_memory=False)

xgb_pred = pd.read_csv(PROC / "xgb_pred_test.csv")
xgb_pred_no_rmp = pd.read_csv(PROC / "xgb_pred_test_no_rmp.csv")
xgb_pred_no_hist = pd.read_csv(PROC / "xgb_pred_test_no_hist.csv")

heur_report = json.loads((PROC / "baseline_heuristic_report.json").read_text())
lin_report = json.loads((PROC / "baseline_linear_report.json").read_text())
xgb_report = json.loads((PROC / "xgb_report.json").read_text())
xgb_no_rmp_report = json.loads((PROC / "xgb_report_no_rmp.json").read_text())
xgb_no_hist_report = json.loads((PROC / "xgb_report_no_hist.json").read_text())
cold_report = json.loads((PROC / "cold_start_report.json").read_text())


# ---- compute heuristic predictions on test for per-dept bar -----------------

def heuristic_predict(df: pd.DataFrame, global_mean: float) -> np.ndarray:
    out = df["ic_hist_mean_gpa"].copy()
    out = out.fillna(df["instr_hist_mean_gpa"])
    out = out.fillna(df["course_hist_mean_gpa"])
    out = out.fillna(df["dept_hist_mean_gpa"])
    out = out.fillna(global_mean)
    return out.values


train_mean = heur_report["global_train_mean"]
test_df = features[features["split"] == "test"].copy()
test_df["heur_pred"] = heuristic_predict(test_df, train_mean)

# ---- retrain ElasticNet + predict on test (we don't persist the linear model)

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
test_lin_pred = lin.predict(fd.loc[mask_test, NUMERIC + BOOL + CAT])
# Align on the same index as test_df for merging
test_df = test_df.reset_index(drop=True)
lin_test_df = fd[fd["split"] == "test"].reset_index(drop=True)
test_df["lin_pred"] = test_lin_pred

# Merge XGB pred onto test_df by (course, instructor, quarter, year) keys.
join_keys = ["course_norm", "instructor_norm", "quarter", "year"]
merged = test_df.merge(
    xgb_pred[join_keys + ["pred"]].rename(columns={"pred": "xgb_pred"}),
    on=join_keys, how="left",
)

# ---- metrics table ----------------------------------------------------------

def slopes(y: np.ndarray, yhat: np.ndarray) -> float:
    """OLS slope of actual ~ predicted + intercept; 1.0 = perfect calibration."""
    x = np.asarray(yhat, float); y = np.asarray(y, float)
    if len(x) < 2 or x.std() == 0:
        return float("nan")
    return float(np.polyfit(x, y, 1)[0])


y_test = merged["avgGPA"].values
models = {
    "Heuristic":  merged["heur_pred"].values,
    "ElasticNet": merged["lin_pred"].values,
    "XGBoost":    merged["xgb_pred"].values,
}

metrics = {}
for name, yhat in models.items():
    metrics[name] = {
        "rmse": rmse(y_test, yhat),
        "mae":  float(np.mean(np.abs(y_test - yhat))),
        "r2":   float(1 - np.sum((y_test - yhat) ** 2) / np.sum((y_test - y_test.mean()) ** 2)),
        "calibration_slope": slopes(y_test, yhat),
    }

(OUT / "metrics_table.json").write_text(json.dumps(metrics, indent=2))

md = ["| Model | Test RMSE | MAE | R² | Calibration slope |",
      "|---|---|---|---|---|"]
for name, m in metrics.items():
    md.append(f"| {name} | {m['rmse']:.3f} | {m['mae']:.3f} | {m['r2']:.3f} | {m['calibration_slope']:.2f} |")
(OUT / "metrics_table.md").write_text("\n".join(md) + "\n")
print("[metrics]", json.dumps(metrics, indent=2))


# ---- PLOT 1: per-dept RMSE (top 20 by count) --------------------------------

def per_dept_rmse(df: pd.DataFrame, pred_col: str) -> pd.Series:
    return df.groupby("dept").apply(
        lambda g: rmse(g["avgGPA"].values, g[pred_col].values), include_groups=False,
    )


dept_counts = merged["dept"].value_counts()
top_depts = dept_counts.head(20).index.tolist()
sub = merged[merged["dept"].isin(top_depts)]

pd_h = per_dept_rmse(sub, "heur_pred").reindex(top_depts)
pd_l = per_dept_rmse(sub, "lin_pred").reindex(top_depts)
pd_x = per_dept_rmse(sub, "xgb_pred").reindex(top_depts)

# sort by xgb ascending (best-first)
order = pd_x.sort_values().index.tolist()
pd_h, pd_l, pd_x = pd_h.loc[order], pd_l.loc[order], pd_x.loc[order]

fig, ax = plt.subplots(figsize=(9.5, 6.5))
x = np.arange(len(order))
w = 0.27
ax.bar(x - w, pd_h.values, w, color=MUTED, label="Heuristic", edgecolor=INK, linewidth=0.4)
ax.bar(x,     pd_l.values, w, color=GREY,  label="ElasticNet", edgecolor=INK, linewidth=0.4)
ax.bar(x + w, pd_x.values, w, color=SAND,  label="XGBoost",   edgecolor=INK, linewidth=0.4)
ax.set_xticks(x)
ax.set_xticklabels(order, rotation=55, ha="right")
ax.set_ylabel("RMSE on held-out quarter")
ax.set_title("Per-department test RMSE — top 20 departments by row count", loc="left", pad=14)
ax.legend(frameon=False, loc="upper right", ncol=3)
ax.set_axisbelow(True)
ax.grid(axis="y", linestyle=":", color="#d4c9b2", linewidth=0.8)
fig.savefig(OUT / "01_per_dept_rmse.svg")
plt.close(fig)
print("[plot 1] per-dept RMSE ->", OUT / "01_per_dept_rmse.svg")


# ---- PLOT 2: calibration curve (XGB deciles on test) ------------------------

y = merged["avgGPA"].values
yhat = merged["xgb_pred"].values
order_yhat = np.argsort(yhat)
y_sorted, yhat_sorted = y[order_yhat], yhat[order_yhat]
n_bins = 10
bin_idx = np.array_split(np.arange(len(y_sorted)), n_bins)
bins = [(yhat_sorted[b].mean(), y_sorted[b].mean(), y_sorted[b].std() / max(np.sqrt(len(b)), 1))
        for b in bin_idx]
bin_arr = np.array(bins)

fig, ax = plt.subplots(figsize=(6.5, 6.5))
ax.plot([2.0, 4.0], [2.0, 4.0], ls="--", color=MUTED, linewidth=1.0, label="Perfect calibration")
ax.errorbar(bin_arr[:, 0], bin_arr[:, 1], yerr=1.96 * bin_arr[:, 2],
            fmt="o", color=SAND, ecolor=SAND_DARK, elinewidth=1.2, capsize=3,
            markersize=8, markeredgecolor=INK, markeredgewidth=0.6, label="XGBoost (deciles)")

# OLS fit line
slope, intercept = np.polyfit(bin_arr[:, 0], bin_arr[:, 1], 1)
xs = np.linspace(2.0, 4.0, 50)
ax.plot(xs, slope * xs + intercept, color=INK, linewidth=1.2,
        label=f"Fit slope = {slope:.2f}")

ax.set_xlim(2.0, 4.0); ax.set_ylim(2.0, 4.0)
ax.set_xlabel("Predicted mean GPA")
ax.set_ylabel("Actual mean GPA")
ax.set_title("Calibration — decile bins on test quarter", loc="left", pad=14)
ax.set_aspect("equal")
ax.legend(frameon=False, loc="upper left")
ax.grid(linestyle=":", color="#d4c9b2", linewidth=0.8)
fig.savefig(OUT / "02_calibration.svg")
plt.close(fig)
print(f"[plot 2] calibration slope = {slope:.3f}")


# ---- PLOT 3: feature-group ablation ----------------------------------------

ablation_labels = ["Full model", "− RMP features", "− history features"]
ablation_rmse = [
    xgb_report["splits"]["test"]["rmse"],
    xgb_no_rmp_report["splits"]["test"]["rmse"],
    xgb_no_hist_report["splits"]["test"]["rmse"],
]
ablation_delta = [(v / ablation_rmse[0] - 1) * 100 for v in ablation_rmse]

fig, ax = plt.subplots(figsize=(7.5, 5.0))
colors = [SAND, GREY, INK]
bars = ax.barh(ablation_labels[::-1], ablation_rmse[::-1], color=colors[::-1],
               edgecolor=INK, linewidth=0.5)
for i, (label, v, d) in enumerate(zip(ablation_labels[::-1], ablation_rmse[::-1], ablation_delta[::-1])):
    sign = "+" if d >= 0 else ""
    annot = f"{v:.3f}" + (f"  ({sign}{d:.1f}%)" if i != 2 else "  (baseline)")
    ax.text(v + 0.002, i, annot, va="center", fontsize=10, color=INK)

ax.set_xlim(0, max(ablation_rmse) * 1.25)
ax.invert_yaxis()
ax.set_xlabel("Test RMSE")
ax.set_title("Feature-group ablation — what's doing the work?", loc="left", pad=14)
ax.grid(axis="x", linestyle=":", color="#d4c9b2", linewidth=0.8)
fig.savefig(OUT / "03_feature_ablation.svg")
plt.close(fig)
print("[plot 3] feature ablation ok")


# ---- PLOT 4: feature importance (XGB gain, top 15) -------------------------

booster = xgb.Booster()
booster.load_model(str(PROC / "xgb_model.json"))
feat_meta = json.loads((PROC / "xgb_feature_cols.json").read_text())
feature_cols = feat_meta["feature_cols"]

gain = booster.get_score(importance_type="gain")
# map "f0", "f1" ... (dmatrix default) to real names if present
if all(k.startswith("f") and k[1:].isdigit() for k in gain):
    gain = {feature_cols[int(k[1:])]: v for k, v in gain.items()}

gain_df = pd.DataFrame(
    [(k, float(v)) for k, v in gain.items()],
    columns=["feature", "gain"],
).sort_values("gain", ascending=False).head(15)

fig, ax = plt.subplots(figsize=(8.0, 6.5))
ax.barh(gain_df["feature"].iloc[::-1], gain_df["gain"].iloc[::-1],
        color=SAND, edgecolor=INK, linewidth=0.4)
ax.set_xlabel("XGBoost split gain (higher = more signal)")
ax.set_title("Top 15 features by gain", loc="left", pad=14)
ax.grid(axis="x", linestyle=":", color="#d4c9b2", linewidth=0.8)
fig.savefig(OUT / "04_feature_importance.svg")
plt.close(fig)
print("[plot 4] feature importance ok")


# ---- PLOT 5: IP optimizer latency distribution ------------------------------
# Synthetic benchmark: generate N problems with varying candidate-set size, solve,
# record wall-clock. This shows the IP scales sub-second on realistic inputs.

def make_prob(n_required: int, n_cands_per_course: int, seed: int) -> tuple[OptimizeRequest, dict]:
    rng = np.random.default_rng(seed)
    candidates: dict[str, list[SectionCandidate]] = {}
    for c in range(n_required):
        course = f"TEST {c+1}"
        secs: list[SectionCandidate] = []
        for k in range(n_cands_per_course):
            begin = int(rng.integers(8 * 60, 17 * 60))
            dur = int(rng.choice([50, 75, 110]))
            days = "".join(rng.choice(list("MWF"), size=3, replace=False)) if rng.random() < 0.5 else "TR"
            secs.append(SectionCandidate(
                enroll_code=f"{course}-{k:02d}",
                course_norm=course,
                instructor_norm=f"PROF {c}-{k}",
                days=days,
                begin_min=begin,
                end_min=begin + dur,
                units=4.0,
                predicted_gpa=float(rng.normal(3.0, 0.35)),
                rmp_rating=float(rng.uniform(2.0, 5.0)),
                fill_rate=float(rng.uniform(0.3, 0.95)),
                capacity=int(rng.integers(20, 250)),
            ))
        candidates[course] = secs
    prefs = OptimizePreferences(
        weight_grades=0.35, weight_professor=0.25,
        weight_convenience=0.2, weight_availability=0.2,
        earliest_start="08:00", latest_end="18:00",
        preferred_days=["M", "T", "W", "R", "F"],
        avoid_friday_afternoon=False,
        target_units_min=12, target_units_max=20,
        diversity_lambda=0.15,
    )
    req = OptimizeRequest(
        quarter_code="20262",
        major_id="TEST",
        required_courses=list(candidates.keys()),
        preferences=prefs,
        top_k=3,
    )
    return req, candidates


def bench(seed_start: int = 0, n_trials: int = 40) -> pd.DataFrame:
    configs = [(3, 6), (4, 6), (4, 10), (5, 8), (6, 8), (6, 12)]
    rows = []
    for n_req, n_cand in configs:
        for t in range(n_trials):
            req, cands = make_prob(n_req, n_cand, seed=seed_start + n_req * 1000 + t)
            t0 = time.perf_counter()
            try:
                optimize(req, cands)
                dur_ms = (time.perf_counter() - t0) * 1000
                rows.append({"n_required": n_req, "n_cands_per_course": n_cand,
                             "total_sections": n_req * n_cand, "ms": dur_ms})
            except Exception as exc:  # infeasible; skip
                print(f"[warn] trial ({n_req},{n_cand},{t}) failed: {exc!r}")
    return pd.DataFrame(rows)


bench_df = bench()
bench_df.to_csv(OUT / "optimizer_latency_raw.csv", index=False)

fig, ax = plt.subplots(figsize=(8.0, 5.5))
group = bench_df.groupby("total_sections")["ms"]
x = sorted(bench_df["total_sections"].unique())
p50 = [group.get_group(v).median() for v in x]
p95 = [group.get_group(v).quantile(0.95) for v in x]

for xi, row in bench_df.iterrows():
    ax.scatter(row["total_sections"], row["ms"],
               color=SAND, alpha=0.35, s=20, edgecolor="none")
ax.plot(x, p50, color=INK, linewidth=1.5, marker="o", markersize=7,
        markerfacecolor=INK, label="p50")
ax.plot(x, p95, color=SAND_DARK, linewidth=1.0, marker="s", markersize=6,
        markerfacecolor=SAND_DARK, linestyle="--", label="p95")
ax.axhline(500, color=MUTED, linestyle=":", linewidth=1.0)
ax.text(max(x), 510, "500 ms target", color=MUTED, ha="right", fontsize=9)
ax.set_xlabel("Total candidate sections in problem")
ax.set_ylabel("Solve wall-clock (ms)")
ax.set_title("IP optimizer latency — 240 synthetic problems (CBC, PuLP)", loc="left", pad=14)
ax.legend(frameon=False, loc="upper left")
ax.grid(linestyle=":", color="#d4c9b2", linewidth=0.8)
fig.savefig(OUT / "05_optimizer_latency.svg")
plt.close(fig)
print(f"[plot 5] optimizer latency: p50 range {min(p50):.1f}–{max(p50):.1f} ms, "
      f"p95 range {min(p95):.1f}–{max(p95):.1f} ms")


# ---- PLOT 6: data coverage heatmap (quarters × top 20 depts) ---------------

u = unified.copy()
u = u[u["n_letter"].fillna(0) > 5]
q_order_map = {"Winter": 0, "Spring": 1, "Summer": 2, "Fall": 3}
u["q_ord"] = u["quarter"].map(q_order_map)
u = u.dropna(subset=["q_ord"])
u["term"] = u["year"].astype(int).astype(str) + " " + u["quarter"]

term_order = (u[["year", "q_ord", "term"]]
              .drop_duplicates()
              .sort_values(["year", "q_ord"])["term"].tolist())

dept_order = u["dept"].value_counts().head(20).index.tolist()

counts = (u[u["dept"].isin(dept_order)]
          .groupby(["dept", "term"]).size().unstack("term").reindex(index=dept_order, columns=term_order)
          .fillna(0))

fig_h = max(5.5, 0.32 * len(dept_order) + 1.0)
fig, ax = plt.subplots(figsize=(12.0, fig_h))
mat = counts.values
mat_log = np.log10(mat + 1)
im = ax.imshow(mat_log, aspect="auto", cmap="copper_r", interpolation="nearest")

ax.set_yticks(range(len(dept_order))); ax.set_yticklabels(dept_order, fontsize=9)
# thin out term ticks — every 4th
tick_step = max(1, len(term_order) // 14)
ax.set_xticks(range(0, len(term_order), tick_step))
ax.set_xticklabels([term_order[i] for i in range(0, len(term_order), tick_step)],
                   rotation=55, ha="right", fontsize=8)

cbar = fig.colorbar(im, ax=ax, pad=0.01, fraction=0.025)
cbar.set_label("log10(sections + 1)", fontsize=9)
cbar.outline.set_edgecolor(INK)

ax.set_title("Data coverage — top 20 departments × 66 quarters (2009–2026)",
             loc="left", pad=14)
ax.tick_params(length=0)
fig.savefig(OUT / "06_data_coverage.svg")
plt.close(fig)
print("[plot 6] coverage heatmap ok")

print(f"\nall plots written to {OUT}")
