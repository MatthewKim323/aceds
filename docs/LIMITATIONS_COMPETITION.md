# One-slide limitations (judges)

## Prediction

- Section models estimate **historical section mean GPA**, **not** any individual’s grade. See [`MODEL_CARD.md`](../MODEL_CARD.md).
- Intervals are **calibrated uncertainty bands**, not personal guarantees.

## Decision-layer toy eval

- [`DECISION_EVAL.md`](../DECISION_EVAL.md) uses a **synthetic** two-course MILP instance — illustrative risk-aware scoring, **not** campus-wide validation.

## Grounding metrics

- **G1/G2** (`optimization_runs`) reflect **API-configured** merges after migration **`008_optimization_runs_evidence.sql`**; older rows lack bundle SHA columns.

## Workflow benchmark

- [`WORKFLOW_BENCHMARK_PROTOCOL.md`](WORKFLOW_BENCHMARK_PROTOCOL.md) is **optional** — results depend on participant protocol discipline.

## Scope

- UCSB-oriented catalog and imports — generalization claims require additional institutional data.
