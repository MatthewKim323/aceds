# ACE agent tools (Phase-6 sketch — not implemented in runtime)

Goal: a **thin** natural-language layer that never free-texts degree logic. All numeric and feasibility truth comes from **typed tools**.

## Tools (proposed)

| Tool | Input | Output | Hard constraints |
|------|--------|--------|-------------------|
| `get_student_bundle` | `user_id` | `StudentBundle` JSON | RLS on profile |
| `predict_sections` | `section_ids[]`, `quarter_code` | `PredictResponse` (μ, interval, regime, `model_version`) | Same as FastAPI today |
| `optimize_schedule` | `OptimizeRequest` body | `OptimizeResponse` | PuLP solver; same as `POST /optimize` |
| `explain_regime` | `regime` enum | Markdown snippet | Static text from MODEL_CARD |

## Policy

1. Never emit a schedule without a successful `optimize_schedule` call.
2. Never assert GE or major satisfaction without `get_student_bundle` + server-side validators (future).
3. Log tool traces to `optimization_runs` / client export for judges.

## Non-goals

Replacing CBC with LLM reasoning; unstructured RAG over PDFs without labeled eval.
