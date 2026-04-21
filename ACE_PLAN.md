# ACE — Execution Plan (2026-04-20)

Authoritative source of truth. Supersedes the `matthewkim-main-design-20260420-213808.md` design doc and the v3.2 breakdown where they conflict.

## Status

- **Phase 0.1 RMP scrape** — DONE. 6,028 instructors in cache (exact_initial 2,768 / only_candidate 520 / top_by_ratings 688 / none 2,052). 87% row-level match.
- **Phase 0.2 Merge** — DONE. `data_pipeline/processed/unified.csv`, 104,549 rows, 2009–2026, 95 depts, 10,562 courses, 6,028 instructors. Spring 2026 catalog columns joined (`title`, `description`, `unitsFixed`, `generalEducation_raw`).
- **Phase 0.2b Audit** — DONE. `processed/audit_report.md`. `clean=74,487 strict=62,454 catalog=8,912`. `n_letter <= 5` drops 21,850 garbage rows (20.9%).
- **Phase 0.5 FastAPI skeleton** — DONE. `backend/app/` with 10 routers, Dockerfile, fly.toml, tests.
- **Phase 2.1 Features** — DONE. `processed/features.parquet` shape `(74,487 x 32)`; split train 70,390 / val 2,965 / test 1,132.
- **Phase 2.2 Heuristic baseline** — DONE. Test RMSE **0.272**, R² **0.564**, MAE 0.196 (fallback: IC → instr → course → dept → global).
- **Phase 2.3 ElasticNet** — DONE. Test RMSE **0.255**, R² **0.619**, MAE 0.191 (111 one-hot features, alpha=0.001 l1_ratio=0.2).
- **Phase 2.4 XGBoost** — DONE. Test RMSE **0.234**, R² **0.678**, MAE 0.174. Ablations:
  - no-RMP: RMSE 0.236 (+0.9% worse) — RMP is *barely* signal once history is in the model.
  - no-history: RMSE 0.293 (+25% worse) — historical aggregates dominate.
- **Phase 2.5 Cold-start** — DONE. warm=0.219 / cold_pair=0.275 / cold_both=0.307 RMSE.
- **Phase 2.6 Embeddings** — Script ready (`15_embeddings.py`), blocked on OPENAI_API_KEY.
- **Phase 2.7 Synthetic students** — DONE. 50 students in `processed/synthetic_students.json`.
- **Phase 2.8 IP optimizer** — DONE. `backend/app/ml/optimizer.py` PuLP MILP with no-good top-K cuts + diversity penalty. Smoke test: 3 distinct schedules in <3s.
- **Phase 2.9 Productionize** — DONE. `backend/app/ml/predictor.py` loads XGB artifact and scores sections from Supabase joins. `/predict` and `/optimize` routers wired.
- **Known data quirks (must handle in feature engineering):**
  - 21,850 rows (20.9%) have `n_letter == 0` and `avgGPA == 0.0` — sections with no graded students. Drop for training.
  - `rmp_would_take_again == -1.0` is RMP's "not enough ratings" sentinel. Convert to NaN.
  - `rmp_match` in unified.csv is only boolean — confidence labels live in `raw/rmp_cache.json` and must be left-joined during feature engineering if we want a confidence ablation.

Decisions locked after brutal critique:

| Fork | Chosen | Why |
|---|---|---|
| Pitchfire date | No hard deadline, optimize for quality | Lets us ship the full product + rigorous DS |
| Eval design | **Ablation study** (drop counterfactual) | Tautology-free, DS-judge-respected |
| Optimizer | **Integer programming** (PuLP / OR-Tools) | User chose; must justify problem size in pitch |
| Backend | **FastAPI** on Fly.io | Needed for adoption; serves optimizer + model |
| Major extraction | **Claude → JSON → review → majors.ts** | 38 majors + 29 minors, one-time |
| Product scope | **Full v3.2** (course explorer, schedule builder, grad path, fill-rate) | User accepted DS-budget trade-off |
| Predictor target | **Section-level mean GPA** + **synthetic student trajectories** on top | Honest about aggregate data; synthetic layer unlocks student-level story |

---

## Guiding principles

1. **Data before UI.** Every UI feature blocks on clean data. Phase 0 + 1 (data + majors) must finish before Phase 5 (frontend build-out) starts in earnest.
2. **Notebook before code.** ML lives in Jupyter until the numbers are real. Then it moves to `backend/ml/` as a production module.
3. **One DataFrame to rule them all.** `processed/unified.csv` is the ground truth. If a model/optimizer needs a field, it goes in there first.
4. **Reproducibility over elegance.** Every pipeline script is re-runnable. Every model has a `model_card.md`. Every eval plot is regenerated from a single notebook.
5. **No narrative overclaiming.** If the data is section-level, the pitch says section-level. If RMP match is 70%, we say 70%.

---

## Phase 0 — Infrastructure triage (unblock everything)

**Goal:** end this phase with a working `processed/unified.csv`, a skeleton FastAPI, expanded Supabase schema, and all secrets wired.

### 0.1 RMP scrape — DONE
### 0.2 Merge — DONE

### 0.2b Data audit (new)
- `data_pipeline/scripts/00_audit_unified.py` — regenerates `processed/audit_report.md`:
  - `avgGPA` distribution, incl. exact count of `n_letter == 0` drops
  - Per-quarter / per-year row counts (train/test split sanity)
  - RMP confidence breakdown (left-join from `rmp_cache.json`)
  - Top 20 departments by row count (per-dept eval target list)
  - Spot-check: 20 random `top_by_ratings` rows printed for manual eyeballing

### 0.3 Supabase schema expansion
New migration `002_data_tables.sql`:
- `courses` — one row per (deptCode, courseId). Canonical course metadata.
- `sections` — one row per (quarter, enrollCode). Live catalog.
- `grade_distributions` — one row per (course_norm, instructor_norm, quarter, year). From Nexus.
- `professors` — RMP cache keyed by `instructor_nexus`.
- `major_requirements` — one row per `major_id`, JSONB `structure` column.
- `minor_requirements` — same shape.
- `schedules` — saved student schedules (user_id, name, sections[], created_at).
- `preference_profiles` — expands `student_profiles.priority_weights` into a richer shape if needed.
- RLS policies: `courses`, `sections`, `grade_distributions`, `professors`, `major_requirements`, `minor_requirements` are public read. `schedules` is user-scoped.

### 0.4 Data ingestion into Supabase
`data_pipeline/scripts/07_load_to_supabase.py`:
- Reads `unified.csv`, `ucsb_catalog_<q>.csv`, `rmp_ratings.csv`.
- Upserts into the six tables above.
- Idempotent (ON CONFLICT DO UPDATE).
- Uses service-role key from `.env` (only this script does).

### 0.5 FastAPI skeleton
```
backend/
  pyproject.toml      (uv/poetry — pick uv for speed)
  Dockerfile
  fly.toml
  app/
    __init__.py
    main.py           (app factory, CORS, routers)
    config.py         (env loading)
    db.py             (supabase client)
    routers/
      health.py
      courses.py
      professors.py
      majors.py
      sections.py
      optimize.py     (stub)
      predict.py      (stub)
    models/
      pydantic_schemas.py
    ml/
      __init__.py
      artifacts/      (pickled model, embeddings, .gitignored beyond metadata)
  tests/
    conftest.py
    test_health.py
```
- `GET /health` returns 200.
- `GET /sections?quarter=20262&dept=CMPSC` reads from Supabase.
- Deploy script: `fly deploy`. Smoke-test from the frontend via CORS.

### 0.6 Secrets + .env.example
- Root `.env.example` with every key: `UCSB_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (server only), `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_BASE` (points at FastAPI).

---

## Phase 1 — Major-sheet extraction

**Goal:** 38 major JSONs + 29 minor JSONs, a review script, and a generated `majors.ts`.

### 1.1 JSON schema
`data_pipeline/schemas/major.schema.json`:
```json
{
  "id": "stats_ds_bs",
  "name": "Statistics and Data Science",
  "degree": "B.S.",
  "catalog_year": "2025-2026",
  "department": "Statistics and Applied Probability",
  "college": "College of Letters and Science",
  "pre_major_gpa": 2.5,
  "total_units_required": 180,
  "upper_div_units_required": 60,
  "groups": [
    {
      "id": "pre_major",
      "label": "Pre-Major",
      "note": "...",
      "pick": null,
      "courses": [
        {"id": "MATH 3A", "alt": ["MATH 2A"]},
        ...
      ]
    }
  ],
  "ge_overrides": {},
  "notes": "Raw Claude output before review."
}
```

### 1.2 Claude extraction script
`data_pipeline/scripts/05_extract_majors_claude.py`:
- Iterates `data/major_sheets/*.pdf` and `data/minor_sheets/*.pdf`.
- Uses Anthropic SDK with `claude-3-5-sonnet-20241022` (or current Sonnet).
- Sends PDF as a document input, with a structured extraction prompt.
- Writes JSON to `data_pipeline/processed/majors/<id>.json`.
- Caches responses to avoid re-spending on re-runs.
- Rate-limited, retries on 429.

### 1.3 Human-in-the-loop review
`data_pipeline/scripts/06_review_majors.py`:
- For each extracted JSON, prints a diff against `frontend/src/data/majors.ts` (for the 4 already-hand-coded).
- For new majors, prints summary (groups, course counts) and asks to approve.
- Writes `reviewed=true` to JSON metadata after approval.

### 1.4 JSON → TS generator
`data_pipeline/scripts/08_majors_json_to_ts.py`:
- Reads all reviewed JSONs → emits `frontend/src/data/majors.ts`.
- Also writes `frontend/src/data/majors.json` (source of truth; the .ts imports from it via Vite JSON import).
- Run as a pre-build step.

### 1.5 Upload to Supabase
Part of 0.4 — `major_requirements` table gets the same JSONs.

---

## Phase 2 — Data science layer

All work starts in `data_pipeline/notebooks/`. Graduate to `backend/app/ml/` when the numbers are locked.

### 2.1 Feature engineering (`data_pipeline/scripts/10_build_features.py`)
Target grain: one row per (course × instructor × quarter × year) — same as `unified.csv`. Output: `processed/features.parquet`.

**Row filter (apply before anything else):**
1. Drop rows where `n_letter <= 5` — kills the 21,850 `avgGPA == 0.0` artifacts and tiny sections with unstable grade means.
2. Left-join `rmp_confidence` from `raw/rmp_cache.json`. Primary training set = `rmp_confidence in {exact_initial, only_candidate}`. The ablation script tests whether the full matched set hurts/helps.
3. Compute quarter ordinal: `quarter_ord = {Winter: 0, Spring: 1, Summer: 2, Fall: 3}`, then `time_key = year * 4 + quarter_ord` for the train/test split.

**Sentinel cleanup:**
- `rmp_would_take_again == -1.0` → NaN.
- `rmp_num_ratings == 0` → NaN on all RMP fields.
- `rmp_match == False` rows keep their (NaN) RMP features; XGBoost handles NAs natively, do not impute.

**Leak-free aggregates** (computed with a single sort + expanding groupby on `time_key`; for each row, only rows with `time_key < current_time_key` contribute):
- Instructor historical: `instr_hist_mean_gpa`, `instr_hist_gpa_std`, `instr_hist_n_sections`, `instr_hist_n_students`.
- Course historical: `course_hist_mean_gpa`, `course_hist_gpa_std`, `course_hist_n_sections`, `course_hist_enrollment`.
- Instructor × Course historical: `ic_hist_mean_gpa`, `ic_hist_n_sections` (typically the strongest signal).
- Department historical: `dept_hist_mean_gpa`, `dept_hist_gpa_std`.
- Cold-start indicators: `instr_is_cold`, `course_is_cold`, `ic_is_cold`.

**Catalog / section features** (from the Spring 2026 join columns — only populated for current-quarter rows; for historical rows, derived from the course number itself):
- `course_level` ∈ {lower, upper, grad} via regex on course number.
- `unitsFixed` (numeric; NaN when catalog join missing).
- `is_ge` (boolean; NaN when catalog join missing).

**Time features:** `year`, `quarter` (categorical), `years_since_instr_first_taught`.

**Train/val/test split:**
- Train: `time_key < 2025*4 + 1` (everything before Spring 2025).
- Validation: Spring 2025 + Fall 2025.
- Test: Winter 2026 (most recent complete quarter).

**Output columns** persist both the numeric target `avgGPA` and the original keys (`course_norm`, `instructor_norm`, `quarter`, `year`, `dept`) for downstream joins and error analysis.

### 2.2 Baseline 1 — heuristic (`notebooks/02_heuristic_baseline.ipynb`)
- `pred = ic_hist_mean_gpa`, fallback to `course_hist_mean_gpa`, fallback to `instr_hist_mean_gpa`, fallback to global mean.
- Report RMSE, R², calibration, per-dept RMSE on held-out quarters.
- Save as `baselines/heuristic.pkl`.

### 2.3 Baseline 2 — linear (`notebooks/03_linear_baseline.ipynb`)
- ElasticNet on the same features.
- Log-transform GPA? Probably not — GPA is ~normal in [1.5, 4.0].
- Report same metrics.

### 2.4 XGBoost (`notebooks/04_xgboost.ipynb`)
- Time-based holdout: train on ≤ Winter 2025, test on Spring 2025 + Fall 2025 (most recent 2 quarters with data).
- Optuna for hyperparameter search (50 trials, `tree_method="hist"`).
- Report: overall RMSE/R²/calibration, per-dept RMSE, SHAP summary plot.
- **Calibration curve** is the money plot: bin predictions into deciles, plot mean(pred) vs mean(actual).
- Save `artifacts/xgboost_v1.json` (booster) + `artifacts/feature_names.json`.

### 2.5 Cold-start handling (`notebooks/05_cold_start.ipynb`)
Three regimes:
1. **Warm** (both instructor and course have history) — use the main model.
2. **Cold instructor, warm course** — use `course_hist_mean_gpa` + dept-mean correction + RMP if available.
3. **Cold course** — use instructor's history + department prior.
4. **Cold both** — department prior + RMP + course level prior.

Model file: `artifacts/cold_start_priors.json`.

Output of predict: `{mean, std, regime}`. UI surfaces the regime ("limited history — lower confidence").

### 2.6 Course embeddings (`notebooks/06_embeddings.ipynb`)
- Input: `sections.description` from UCSB catalog (unique courseIds).
- `text-embedding-3-small` (OpenAI), batch 1000 per call.
- Store: `artifacts/course_embeddings.npy` + `artifacts/course_ids.json`.
- Cosine similarity function → "similar electives" widget + optimizer diversity regularizer.
- ~$2 one-time cost.

### 2.7 Synthetic students (`notebooks/07_synthetic_students.ipynb`)
Generate `n=10_000` synthetic students per pitch-target major (CS, Stats&DS, DS, Econ):
- Sample: `major`, `year` (1-4), `cumulative_gpa ~ N(3.2, 0.4)` truncated [2.0, 4.0].
- Sample prior trajectory: for each prior quarter, pick constraint-satisfying sections + sample predicted grade from predictor's distribution + noise.
- Sample preference weights: Dirichlet over (prof, grades, convenience, availability).
- Output: `processed/synthetic_students.parquet`.

### 2.8 IP optimizer (`backend/app/ml/optimizer.py`)
Problem:
- Decision: $x_s \in \{0,1\}$ for each candidate section $s$.
- Objective: $\max \sum_s x_s \cdot \text{score}(s, \text{student})$ where $\text{score} = w_g \hat{G}_s + w_p R_s + w_t T_s + w_a A_s - \lambda \cdot \text{redundancy}_s$.
- Constraints:
  - Exactly one section per required course.
  - Total units within $[u_\min, u_\max]$.
  - No time overlap: for any two sections $s_1, s_2$ with overlapping meeting times, $x_{s_1} + x_{s_2} \le 1$.
  - Prereq satisfied (can be pre-filtered, not in IP).
  - Enrollment restriction (major, level) pre-filtered.
- Redundancy: cosine similarity between already-selected course embedding and candidate. Discourages taking two "same-flavor" electives.

Implementation: **PuLP** (CBC solver, free) first; swap to OR-Tools if slow. For pitchfire, runtime on a 4-course problem should be < 200ms.

Fallback: if IP infeasible (rare), run beam-search with top-k=5.

Explainability: for each returned schedule, compute per-section feature contributions by perturbing each score component and logging the delta. Return to UI as `{section_id, reason: {prof: +0.3, grades: +0.2, ...}}`.

### 2.9 Productionize ML
- Copy finalized notebooks → `backend/app/ml/{predictor.py, embeddings.py, optimizer.py, cold_start.py}`.
- `backend/app/ml/__init__.py` loads artifacts on import.
- Pydantic request/response models in `backend/app/models/pydantic_schemas.py`.
- Unit tests against fixture data in `backend/tests/ml/`.

---

## Phase 3 — Ablation eval (the DS pitch substance)

**Goal:** one notebook (`notebooks/10_ablation.ipynb`) that regenerates every pitch plot from scratch.

### 3.1 Metrics table
| Model | Overall RMSE | Overall R² | CS RMSE | ENGL RMSE | Econ RMSE | Calibration slope |
|---|---|---|---|---|---|---|
| Heuristic (course avg) | — | — | — | — | — | — |
| Heuristic (ic avg w/ fallback) | — | — | — | — | — | — |
| ElasticNet | — | — | — | — | — | — |
| **XGBoost** | — | — | — | — | — | — |

### 3.2 Feature ablation
For XGBoost, drop each feature group (instructor, course, instr×course, RMP, time) and retrain. Report RMSE delta per group. The feature that hurts the most when removed is your strongest signal — pitch story.

### 3.3 Calibration plot
Bin predictions into 10 deciles. Plot (mean predicted, mean actual) with 45° reference line. Shade 95% bootstrap CI.

### 3.4 Per-department RMSE bar chart
For the top 20 departments by section count: RMSE bar for Heuristic / Linear / XGBoost side-by-side. Shows where XGBoost wins and where it doesn't (transparent).

### 3.5 Preference-satisfaction sanity check
Run the optimizer on all 10k synthetic students vs greedy / random baselines. Report mean schedule score per baseline. This is a **sanity check** in an appendix, not the headline.

### 3.6 Model card
`backend/app/ml/MODEL_CARD.md`:
- Intended use
- Training data (scope, gaps)
- Performance by slice (department, cold-start regime)
- Known limitations (section-level aggregate, RMP match rate, cold start)
- Fairness considerations (some departments have less data → higher error, communicate that)

---

## Phase 4 — FastAPI backend endpoints

Build these after Phase 2 artifacts exist.

### 4.1 Endpoint list
- `GET /health` ✓ (Phase 0)
- `GET /sections?quarter=&dept=&search=` — paginated.
- `GET /sections/{enrollCode}` — full detail incl. historical grades by prof, similar courses.
- `GET /courses/{courseId}` — grade distribution across all instructors, historical trend, current sections.
- `GET /professors/{rmpLegacyId}` — RMP data + all courses taught + grade dist per course.
- `GET /majors` + `GET /majors/{id}` + `GET /minors/{id}`.
- `GET /ge?area=` — list of courses satisfying a GE area, sorted by avg GPA.
- `POST /predict` — input: `{section_ids: []}` → output: `{predictions: [{section_id, mean, std, regime}]}`.
- `POST /optimize` — input: `{profile, preferences, quarter, required_courses, excluded_courses}` → output: `{schedules: [{sections: [], score, explanation, breakdown}]}` top 3.
- `GET /trends/enrollment?courseId=` — historical enrollment.
- `POST /schedules` / `GET /schedules` — user-scoped save/list.

### 4.2 Deployment
- Fly.io single app, 256MB (upgrade to 512MB if model needs it).
- Supabase service-role key via `fly secrets set`.
- Model artifacts baked into Docker image (not downloaded at boot).
- GitHub Action for CI on PR (ruff, mypy, pytest).

---

## Phase 5 — Frontend product scope (full v3.2)

Do **not** start until Phase 2.4 (XGBoost trained) + Phase 4.1 (endpoints live) are done. Premature frontend work against fake data always has to be redone.

### 5.1 Route map (new)
```
/                     Landing (✓ exists)
/auth                 Auth (✓ exists)
/onboarding           Onboarding (✓ exists — needs AP parsing hardening)
/dashboard            Dashboard (✓ exists — overhaul in 5.6)
/explore              Course Explorer home (new)
/explore/courses/:id  Course detail (new)
/explore/professors/:id  Prof detail (new)
/explore/ge           GE finder (new)
/explore/trends       Enrollment trends (new)
/schedule             Schedule builder (new, gated on auth)
/grad-path            Prereq graph (new, gated on auth)
/settings             Preferences (new, gated on auth)
/status               Pipeline status (new, gated on auth)
```

### 5.2 Course Explorer (`/explore`)
- **Browse by department** — sidebar of ~70 depts, main panel paginates sections.
- **Filters**: quarter, time of day, days, open seats, GE area, units.
- **Sort**: avg GPA, prof rating, enrollment, course number.
- **Course card**: code, title, instructor + RMP badge, mean GPA (from `grade_distributions`), enrollment / capacity bar.
- **Course detail**: grade dist chart (Recharts), historical instructors with per-instructor grade dist, similar courses (embeddings), current quarter sections.
- **Prof detail**: RMP data, courses taught, grading trend over time.
- **GE finder**: Area-by-area lists, sorted by avg GPA, with logged-in user's completed areas greyed out.
- **Public routes** — no auth required. SEO-indexable.

### 5.3 Schedule Builder (`/schedule`)
- Calendar view (react-big-calendar or custom grid — custom is lighter).
- Left panel: required-courses list + "add course" search.
- Right panel: candidate sections for each required course with predicted GPA + RMP + time-fit.
- "Optimize for me" button → POST `/optimize` with current prefs → replace suggestion list with top 3 schedules.
- Per-schedule explanation card: "Schedule A scored 94/100 — +0.3 on predicted GPA because of Prof X, +0.15 on availability because section has 80% open seats."
- "Save this schedule" → `schedules` table.

### 5.4 Grad Path (`/grad-path`)   **DONE**
- Tiered progression view (Pre-Major → Lower Division → Upper Division → Electives → Capstone).
- Groups sourced from `frontend/src/data/majors.ts`; nodes colored by state: completed (green), ready (sand), remaining (gray).
- Overall progress ring + per-tier completion bars.

### 5.5 Pipeline Status + Settings   **DONE**
- `/status`: live `/status` endpoint (FastAPI) with auto-refresh every 30s. Cards for ML model (RMSE, R², MAE, dataset size, last trained), Supabase (per-table row counts + error surfaces), and a placeholder for the `data_refresh_log` table.
- `/settings`: four-tab shell (profile / preferences / demo / account). Preference sliders write `priority_weights` + `target_units` via `updateProfilePartial`. Account tab exposes email, Supabase connectivity, and sign-out.

### 5.6 Dashboard overhaul   **DONE**
- Added a "Next up" command center card directly under the hero metrics with 4 CTAs: Build schedule, Graduation path, Browse courses, System status.
- Primary CTA (Build schedule) uses sand-accent gradient; secondary CTAs follow the neutral card aesthetic.
- Kept existing Overview / Courses / Requirements tabs intact; sidebar now deep-links to `/explorer`, `/schedule`, `/grad-path`, `/status`, `/settings`.

### 5.7 Demo mode   **DONE**
- 50 synthetic students from `16_synthetic_students.py` published to `frontend/public/synthetic_students.json`.
- `/settings` → Demo tab lists the first 12 with name, major, year, GPA, and top preference.
- Clicking a card calls `applySyntheticStudent` → upserts profile, sets `demo_student_id`, flips `onboarding_complete`, and refreshes the profile pane.
- Supabase migration `003_demo_mode.sql` adds the `demo_student_id` column.

---

## Phase 6 — Launch prep

### 6.1 Pitch deck assets
- 6 plots saved as SVG from `notebooks/10_ablation.ipynb`:
  1. Per-dept RMSE bar (XGBoost wins in 18/20 depts).
  2. Calibration curve (slope ≈ 1.0).
  3. Feature ablation (RMP + ic_hist are the two most-important features, say).
  4. SHAP summary.
  5. Optimizer time distribution (p50, p95 latency).
  6. Data coverage heatmap (quarters × departments, cell = row count).
- One-pager: "UCSB-native moat" — data coverage numbers.

### 6.2 README + docs
- `/README.md` — quickstart for developers.
- `/data_pipeline/README.md` — already exists; update to include Phase 1 steps.
- `/backend/README.md` — FastAPI setup, deployment.
- `/frontend/README.md` — dev server, env setup.
- `MODEL_CARD.md` — published.

### 6.3 E2E smoke test
- Judge opens `/`, clicks demo, picks CS junior, clicks "Optimize for me", sees 3 ranked schedules in < 3s.
- Screenshot diff vs reference.

---

## Anti-goals (explicitly not shipping)

- Counterfactual eval (methodologically weak as designed, dropped).
- Browser-scraping of GOLD (the UCSB public API covers it; RMP goes direct-to-GraphQL).
- Real-time fill-rate predictions beyond simple trend plots (self-collecting the data takes a full quarter).
- LLM-fine-tuning anything. Claude is for PDF extraction only.
- Mobile app. Responsive web only.

---

## Risk register

| Risk | Impact | Mitigation |
|---|---|---|
| RMP match rate < 50% | Predictor leaks half the signal | Hand-review top 200 unmatched instructors; accept NULL + indicator feature |
| XGBoost RMSE > 0.4 (i.e. predictions are ±0.8 GPA useless) | DS pitch is dead | Pivot to section-level ranking (ordinal) rather than regression; calibration story still holds |
| Claude extraction of PDFs is inconsistent | 10+ hours of manual cleanup | Ship 6 majors by hand first, run Claude for the other 32, treat it as augmentation |
| IP optimizer too slow for real-time | UX is broken | Pre-compute demo-persona results; use beam search as fallback |
| Supabase free tier hits row limit on `grade_distributions` (104k rows) | Ingestion fails | Free tier is 500MB / 50k rows on some plans — check. If so, chunk by year or pay $25/mo |
| Fly.io free tier pulls app to sleep | First request is slow | Use always-on tier ($2/mo) or ping every 5min from Supabase Edge Function |

---

## Done criteria (the checklist the final PR must satisfy)

- [ ] `processed/unified.csv` exists, 100k+ rows, RMP match ≥ 60%.
- [ ] All 38 major + 29 minor JSONs extracted and reviewed.
- [ ] `majors.ts` auto-generated from JSON.
- [ ] XGBoost model RMSE ≤ 0.35 on held-out quarter.
- [ ] Calibration slope in `[0.9, 1.1]`.
- [ ] Per-dept RMSE bar chart shows XGBoost ≥ Linear ≥ Heuristic on ≥ 15/20 depts.
- [ ] IP optimizer returns top-3 schedules in < 500ms for a 4-course problem.
- [ ] FastAPI deployed to Fly.io, passing health + integration tests.
- [ ] Course Explorer live, public, indexable.
- [ ] Schedule Builder live, "Optimize for me" flow works end-to-end.
- [ ] Grad Path live.
- [ ] Demo mode live — judge can generate a schedule in < 3s from landing page.
- [ ] MODEL_CARD.md published.
- [ ] 6 pitch plots saved as SVG.
