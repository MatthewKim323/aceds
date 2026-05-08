# Competition metrics — headline charts & reproducibility

## Primary headline (RMSE ablation — structured context)

**Claim:** Historical grade / catalog context used as relational features is **required** for calibrated section-quality prediction — not optional polish.

| Variant | Test RMSE (2026 Winter holdout, n=1,132) |
|---------|------------------------------------------|
| ACE XGBoost (full) | **0.234** |
| XGBoost **without** historical aggregates | **0.293** (~**25%** relative degradation) |
| Heuristic dept fallback | **0.272** |

Sources: [`MODEL_CARD.md`](../MODEL_CARD.md), regenerated artifacts under [`data_pipeline/processed/pitch/`](../data_pipeline/processed/pitch/).

### Assets

| Asset | Path |
|-------|------|
| Feature ablation figure | `data_pipeline/processed/pitch/03_feature_ablation.svg` |
| RMSE ladder / improvement | `08_rmse_ladder_improvement.svg`, `09_abs_error_cdf_test.svg`, `10_row_level_win_rate.svg` |
| Metrics JSON | `data_pipeline/processed/pitch/metrics_table.json` |
| Showcase interpretation | `data_pipeline/processed/pitch/showcase_improvement_metrics.json` |

### Regenerate (backend venv)

Install plot deps once if needed: `matplotlib`, `pyarrow` (parquet).

```bash
cd /Users/matthewkim/Documents/ace
backend/.venv/bin/pip install matplotlib pyarrow -q
backend/.venv/bin/python data_pipeline/scripts/20_ablation_plots.py
backend/.venv/bin/python data_pipeline/scripts/22_regime_reliability.py
backend/.venv/bin/python data_pipeline/scripts/24_showcase_improvement_charts.py
```

Or partial: `make ds-plots` / `make ds-decision-eval` from repo [`Makefile`](../Makefile) (requires same deps).

## Secondary — synthetic decision-layer (risk-aware objective)

**Claim:** Under grade-heavy preferences, **risk_lambda > 0** shifts the MILP objective using interval width (toy instance, not live student utility).

- Output: [`data_pipeline/processed/decision_eval_synthetic.json`](../data_pipeline/processed/decision_eval_synthetic.json)
- Chart: `data_pipeline/processed/pitch/12_decision_risk_toy_scores.svg` (from `24_showcase_improvement_charts.py`)
- Doc: [`DECISION_EVAL.md`](../DECISION_EVAL.md)

```bash
PYTHONPATH=backend backend/.venv/bin/python data_pipeline/scripts/23_decision_eval_synthetic.py
```

## Grounding / audit (G1, G2) — from `optimization_runs`

When `POST /optimize` includes `user_id`, the API merges `completed_courses` with `student_profiles` and logs `grounding` + `student_evidence_bundle_sha256`. Export for charts:

```bash
PYTHONPATH=backend backend/.venv/bin/python data_pipeline/scripts/25_competition_metrics_export.py
```

Requires `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (or load `backend/.env`). Apply migration [`backend/supabase/008_optimization_runs_evidence.sql`](../backend/supabase/008_optimization_runs_evidence.sql) in Supabase.

See [`data_pipeline/processed/competition/README.md`](../data_pipeline/processed/competition/README.md) for output CSVs.

## Honest limitations (slide)

See [`LIMITATIONS_COMPETITION.md`](LIMITATIONS_COMPETITION.md).
