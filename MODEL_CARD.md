# ACE — Grade Prediction Model Card

_Last updated: 2026-04-20_

## Intended use

Predict the **section-level mean GPA** of a UCSB offering — `(course × instructor × quarter)` — so the schedule optimizer can reason about expected grade quality as one of several ranked preferences.

Not designed to predict an individual student's grade. See Limitations.

## Model

| | |
|---|---|
| Algorithm | XGBoost regressor, `hist` tree method, `reg:squarederror` |
| Artifact | `backend/app/ml/artifacts/xgb_model.json` (≈ 2 MB) |
| Trees | 253 (early-stopped on validation RMSE) |
| Max depth | 6 |
| Learning rate | 0.05 |
| Categorical handling | XGBoost native (`enable_categorical=True`) |

## Data

- Source: Daily Nexus grade dump (2009 Fall → 2026 Winter) merged with RateMyProfessor and the UCSB public catalog. See `data_pipeline/README.md`.
- Raw rows: **104,549** (course × instructor × quarter × year).
- Rows kept for training (`n_letter > 5`): **74,487** — dropping 21,850 ghost sections (no letter grades) and 8,212 tiny sections.
- Split (temporal, leak-free):
  - **train**: everything ≤ 2024 Fall, `70,390` rows
  - **val**: 2025 Winter → 2025 Fall, `2,965` rows
  - **test**: 2026 Winter, `1,132` rows
- All historical aggregates (`instr_hist_mean_gpa`, `course_hist_mean_gpa`, `ic_hist_mean_gpa`, `dept_hist_mean_gpa`, plus std/count variants) are computed **expanding, with strict `<` time cutoffs**, so no row can see its own or future grades.

## Features (32)

| Group | Columns |
|---|---|
| Target | `avgGPA` |
| Catalog | `unitsFixed`, `course_level`, `is_ge`, `dept`, `quarter`, `year` |
| Instructor history | `instr_hist_mean_gpa`, `instr_hist_gpa_std`, `instr_hist_n_sections`, `years_since_instr_first_taught` |
| Course history | `course_hist_mean_gpa`, `course_hist_gpa_std`, `course_hist_n_sections` |
| Instructor-Course pair | `ic_hist_mean_gpa`, `ic_hist_n_sections` |
| Department | `dept_hist_mean_gpa`, `dept_hist_gpa_std` |
| Cold-start flags | `instr_is_cold`, `course_is_cold`, `ic_is_cold` |
| RMP | `rmp_rating`, `rmp_difficulty`, `rmp_num_ratings`, `rmp_would_take_again`, `rmp_confidence`, `rmp_match` |

Missingness is **preserved, not imputed** — XGBoost's native NaN handling does the right thing and avoids the leaky "impute with historical mean" trap.

## Results

All values on the 2026 Winter held-out test set (n=1,132).

| Model | RMSE | R² | MAE |
|---|---|---|---|
| Global mean | ≈ 0.41 | 0.00 | — |
| Heuristic fallback (IC → instr → course → dept → global) | 0.272 | 0.564 | 0.196 |
| ElasticNet (111 one-hot features) | 0.255 | 0.619 | 0.191 |
| **XGBoost (full features)** | **0.234** | **0.678** | **0.174** |
| XGBoost (no RMP) | 0.236 | 0.672 | 0.175 |
| XGBoost (no historical aggregates) | 0.293 | 0.496 | 0.221 |

### Ablation interpretation

- **History is the model.** Remove the historical aggregates and RMSE jumps 25%. Everything else is window dressing.
- **RMP is nearly irrelevant conditional on history.** Removing all four RMP features costs 0.002 RMSE. RMP adds rating-of-the-prof signal, but the prof's own past grade distribution already encodes that (and much more precisely). This matters for the pitch: we're not "RMP for grades." We're a section-quality predictor that happens to beat RMP.
- **XGBoost gains ≈ 14% over the heuristic fallback.** The gain comes from modeling interaction between instructor history, course history, and cold-start regime — the heuristic hard-cascades through them, the tree model blends.

### Per-regime performance (test set)

From `processed/cold_start_report.md` (2026 Winter test set, n=1,132):

| Regime | n | RMSE | bias |
|---|---:|---:|---:|
| Warm (both instructor & course have ≥1 prior) | 891 | 0.219 | −0.021 |
| Cold pair (new instructor-course combo, both individually known) | 181 | 0.275 | +0.005 |
| Cold both (new instructor AND new course) | 60 | 0.307 | −0.035 |
| Overall | 1132 | 0.234 | −0.017 |

Cold-start is where uncertainty goes up by design. The `predicted_gpa_std` returned by the API widens in the cold regimes to match.

## Limitations

1. **Aggregate, not individual.** The target is a section's mean GPA. Your personal grade will vary. The synthetic-student layer (`16_synthetic_students.py`) adds per-student perturbation on top, but that layer is calibrated against distributions, not real students.
2. **Temporal coverage skew.** Recent quarters (post-COVID grade inflation) are under-represented in the training set. The val/test splits control for this but don't eliminate it.
3. **RMP bias.** RMP ratings over-represent the loudest students. We use match-confidence as an ablation split (`exact_initial + only_candidate` = "strict") and verify the ranking is unchanged.
4. **Small courses.** Dropped rows with `n_letter <= 5`. Those sections exist but are too noisy to train on — the model does not predict them and the optimizer treats them as "unknown quality."
5. **Label noise.** `avgGPA` is a section average, not a per-student letter grade. Two sections with the same avgGPA can have very different spreads.

## Intended deployment

- Served by FastAPI at `POST /predict` — input: `{section_ids, quarter_code}`, output: `{predictions: [{enroll_code, predicted_gpa, predicted_gpa_std, regime}]}`.
- Retraining cadence: once per quarter after new grade data lands.
- Version tracking: `xgb_report.json` is written next to the model and includes training RMSE, val/test metrics, and the feature list. Any schema change bumps the `feature_cols.json` hash; the predictor refuses to load a model whose features don't match.
