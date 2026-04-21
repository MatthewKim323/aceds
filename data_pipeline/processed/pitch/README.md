# Pitch-deck assets

Everything in this folder is reproduced from scratch by:

```bash
python data_pipeline/scripts/20_ablation_plots.py
```

Inputs it consumes (all already generated upstream):

- `processed/features.parquet` — Phase 2.1
- `processed/xgb_model.json` + `xgb_feature_cols.json` — Phase 2.4
- `processed/xgb_pred_test*.csv` — Phase 2.4 main + two ablation variants
- `processed/baseline_{heuristic,linear}_report.json` — Phases 2.2, 2.3
- `processed/xgb_report*.json` — Phase 2.4
- `processed/cold_start_report.json` — Phase 2.5
- `processed/unified.csv` — Phase 0.2

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

Aesthetic: dark ink on warm bone background, single sand accent (`#c9a46a`). Matches the frontend palette so screenshots can be intercut in the deck without color clashes.
