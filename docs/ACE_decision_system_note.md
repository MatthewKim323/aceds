# ACE as a decision system (technical note)

**Abstract.** ACE combines a **temporally split** supervised model for section-level mean GPA with a **mixed-integer program** (PuLP/CBC) for feasible course schedules. We expose **regime-aware uncertainty** (cold-start buckets from held-out test RMSE) and optional **split conformal** half-widths fit on the validation fold. The optimizer can use a **risk-aware** grade term: effective GPA shrinks toward a pessimistic bound proportional to interval half-width. Append-only logs record ingestion and optimization requests for auditability.

## 1. Problem and notation

- **Units:** course sections `(course_norm, instructor_norm, quarter_code)` with calendar metadata.
- **Target:** historical section mean GPA `avgGPA` (not an individual student grade).
- **Decision:** choose a feasible subset of sections maximizing a weighted sum of normalized features subject to conflicts, units window, and required courses.

## 2. Data and leakage controls

Training rows and aggregates follow the pipeline described in `MODEL_CARD.md` and `data_pipeline/README.md`. Historical features use **strictly past** information relative to each row’s quarter (see model card: expanding aggregates with `<` time cutoffs).

## 3. Point predictor

XGBoost `reg:squarederror`, `tree_method=hist`, categorical native handling. Temporal split: train / val / test by calendar. Metrics on 2026 Winter test are reported in `MODEL_CARD.md`.

## 4. Uncertainty and intervals

**Regime** buckets (`warm`, `cold_instr`, `cold_course`, `cold_pair`, `cold_both`) are derived from cold flags in the feature row (same logic in `predictor.py` and calibration scripts).

**`predicted_gpa_std`:** fixed mapping from regime to test-set residual RMSE (documentation alignment).

**Intervals:** symmetric `[μ − w, μ + w]` clipped to `[0, 4]`. If `conformal_quantiles.json` exists, `w` is the validation quantile of `|y − ŷ|` for that regime at nominal coverage (see `21_conformal_calibration.py`). Otherwise `w = 1.645 × predicted_gpa_std` (Gaussian fallback, documented as approximate).

## 5. Discrete optimization

Binary selection per section, hard constraints for (i) exactly one section per required course, (ii) at most one per optional pool course, (iii) pairwise time conflicts, (iv) units min/max, (v) time-of-day and day-of-week preferences as pre-filters. Objective: weighted linear combination of normalized `grade`, `professor`, `convenience`, `availability`, minus a small diversity penalty on repeated instructors.

**Risk term:** `grade_norm = effective_gpa / 4` with `effective_gpa = clip(μ − λ·half_width, 0, 4)` when `risk_lambda > 0`.

## 6. Evaluation

- **Point:** RMSE, R², MAE, calibration slope, ablations (MODEL_CARD).
- **Regime plots:** `07_regime_reliability.svg` (binned test means).
- **Decision toy:** `DECISION_EVAL.md` / `decision_eval_synthetic.json` — objective delta mean-only vs risk-aware on a feasible MILP.

## 7. Observability

- `student_ingestion_events` (Supabase): transcript / manual saves.
- `optimization_runs` (Supabase): optional `user_id`, `request_hash`, `model_version`, `conformal_method`, summary JSON, `duration_ms`.

## 8. Limitations

Intervals are **not** individual-level grade forecasts; conformal coverage is for the **section mean** under the stated calibration protocol. The schedule “major pool” in the UI is a simplified demo, not a degree audit.

## References (in-repo)

- `MODEL_CARD.md`, `DECISION_EVAL.md`, `REPRO.md`, `SHOWCASE.md`
- `backend/app/ml/predictor.py`, `backend/app/ml/optimizer.py`, `backend/app/ml/conformal.py`
