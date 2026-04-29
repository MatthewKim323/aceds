# Pitch-deck assets

Core pitch plots:

```bash
python data_pipeline/scripts/20_ablation_plots.py
python data_pipeline/scripts/22_regime_reliability.py   # 07_regime_reliability.svg
python data_pipeline/scripts/24_showcase_improvement_charts.py  # 08–12 + showcase_improvement_metrics.json
```

`make ds-plots` at repo root runs all three.

Inputs it consumes (all already generated upstream):

- `processed/features.parquet` — Phase 2.1
- `processed/xgb_model.json` + `xgb_feature_cols.json` — Phase 2.4
- `processed/xgb_pred_test*.csv` — Phase 2.4 main + two ablation variants
- `processed/baseline_{heuristic,linear}_report.json` — Phases 2.2, 2.3
- `processed/xgb_report*.json` — Phase 2.4
- `processed/cold_start_report.json` — Phase 2.5
- `processed/decision_eval_synthetic.json` — optional for `12_*` (run `make ds-decision-eval` first)

| Output | What it is |
|---|---|
| `01_per_dept_rmse.svg` | Test RMSE across top-20 departments, three models side-by-side |
| `02_calibration.svg` | 10-decile calibration curve on XGBoost test predictions, with OLS slope |
| `03_feature_ablation.svg` | Full model vs `− RMP features` vs `− history features` |
| `04_feature_importance.svg` | Top-15 XGBoost features by split gain |
| `05_optimizer_latency.svg` | IP solve wall-clock, p50 / p95 across 240 synthetic problems |
| `06_data_coverage.svg` | Heatmap of `sections × quarter` over 17 academic years |
| `metrics_table.json` | Machine-readable summary of the three headline models |
| `metrics_table.md` | Same table, markdown-ready |
| `optimizer_latency_raw.csv` | Every trial timing, for re-slicing |
| `07_regime_reliability.svg` | Binned predicted vs actual on test, by cold-start regime (`22_regime_reliability.py`) |
| `08_rmse_ladder_improvement.svg` | **Real** RMSE ladder: global mean → heuristic → ElasticNet → XGBoost (same test rows) |
| `09_abs_error_cdf_test.svg` | **Real** CDF of \|y − ŷ\| for heuristic vs XGBoost on held-out test |
| `10_row_level_win_rate.svg` | **Real** pie: per-row who wins on \|error\|; bar: MAE — plus `showcase_improvement_metrics.json` |
| `11_regime_rmse_test.svg` | **Real** regime RMSE bars from `cold_start_report.json` |
| `12_decision_risk_toy_scores.svg` | **Synthetic** MILP scores from `decision_eval_synthetic.json` (risk λ ablation) |

Aesthetic: dark ink on warm bone background, single sand accent (`#c9a46a`). Matches the frontend palette so screenshots can be intercut in the deck without color clashes.
