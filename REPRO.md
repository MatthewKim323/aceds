# Reproducibility — ACE grade predictor and intervals

## Pinned artifacts (SHA-256)

Computed on the machine that last refreshed artifacts (re-run `shasum -a 256` after you replace files):

| File | SHA-256 |
|------|---------|
| `backend/app/ml/artifacts/xgb_model.json` | `4ce5af124149ebf7370b05e28e0665c28a2740e5c9ee64eee2ba69e63bfae4a9` |
| `backend/app/ml/artifacts/conformal_quantiles.json` | `752a997bf569d7bed6310093040bbba8bdb5d37bad517e9896dc251a3c600bd3` |

`model_meta.json` in the same directory pins `predictor_id` for API responses.

## One-command flows

From repo root:

```bash
make ds-train          # data_pipeline/scripts/13_xgboost.py
make ds-conformal      # val-split |residual| quantiles → conformal_quantiles.json + copy to backend/artifacts
make ds-plots          # pitch SVGs + regime reliability figure
make ds-decision-eval  # toy MILP mean-only vs risk-aware JSON
```

Upstream features: build `data_pipeline/processed/features.parquet` via your existing pipeline (`10_build_features.py`, merge steps, etc.) before training.

## Temporal split

Documented in [MODEL_CARD.md](MODEL_CARD.md): train ≤ 2024 Fall, val 2025 quarters, test 2026 Winter. Leakage controls for historical aggregates are described there.

## After retraining

1. Copy `data_pipeline/processed/xgb_model.json` and `xgb_feature_cols.json` into `backend/app/ml/artifacts/` if training wrote only to `processed/`.
2. Run `make ds-conformal` so intervals match the new val residuals.
3. Update the SHA table in this file.
