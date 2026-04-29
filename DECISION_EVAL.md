# Decision-layer evaluation (synthetic)

This complements **point** metrics (RMSE, R²) in [MODEL_CARD.md](MODEL_CARD.md) with a **decision** ablation on a toy integer program.

## Script

```bash
make ds-decision-eval
# or: PYTHONPATH=backend python data_pipeline/scripts/23_decision_eval_synthetic.py
```

## Latest artifact

Results are written to `data_pipeline/processed/decision_eval_synthetic.json`.

## What is measured

- Two **required** courses, non-overlapping times, identical predicted GPA **μ**, different symmetric interval half-widths (wide cold bucket vs narrow warm bucket).
- Preferences: **100% weight on grades**, `risk_lambda ∈ {0, 0.75}`.
- **Observation:** `risk_lambda > 0` lowers the **PuLP objective value** (weighted grade term uses effective GPA `μ − λ · half_width` before 0..4 normalization). Feasibility (conflicts, units window) is unchanged.

## Limits

Toy instance only; not a claim about live student utility. Next steps: batch over `synthetic_students.json` with real section pools and report distributions of `best_score` and runtime.
