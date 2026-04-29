# ACE — Pitch / Poster Source Document (Data Science Emphasis)

**Purpose:** Single canonical write-up for a **Pitchfire-style** research poster: objective, data, models, optimization, results, architecture, limitations, and visuals to pull into Figma / Illustrator / Google Slides.  
**Project:** **ACE** — *Aggregate Grade Prediction + Integer-Program Schedule Optimization for UCSB*  
**Repo:** [github.com/MatthewKim323/aceds](https://github.com/MatthewKim323/aceds) (paths below are in-repo)

---

## 1. Title block (hero)

| Field | Copy |
|--------|------|
| **Title** | **ACE** — *Academic Course Engine* (or spell out once: “ACE — UCSB Schedule Intelligence”) |
| **One-line subtitle** | **Section-level grade prediction from 17 years of public grade data + mixed-integer schedule optimization with uncertainty-aware objectives.** |
| **Tagline (optional)** | *Ranked, conflict-free schedules in tens of milliseconds — every score tied to reproducible evidence.* |

---

## 2. Objective (elevator pitch)

Undergraduates choose among thousands of **course sections** using weak signals (title, time, forum gossip). **ACE** turns **public** historical grade distributions, instructor metadata, and the live catalog into:

1. A **supervised model** that predicts each section’s **mean GPA** (aggregate label, not individual grades) with **regime-aware uncertainty** and optional **conformal-style intervals**.
2. A **discrete optimizer** (integer program) that returns **top‑K feasible schedules** maximizing a **weighted linear objective** over predicted grades, professor ratings, time preferences, and seat availability — under **hard constraints** (no time conflicts, unit budgets, required courses).

**Data science thesis:** This is a **decision system** (predict → calibrate uncertainty → optimize under constraints), not a dashboard-only product.

---

## 3. Problem framing (why ML + OR)

- **Information asymmetry:** Same course, different instructors → large, systematic differences in section mean GPA; students currently triangulate manually.
- **Combinatorial choice:** Picking “best section per course” **greedily** ignores **time conflicts** and **unit caps**; the correct object is a **joint choice** over sections.
- **Uncertainty matters:** New instructors / new pairings (**cold start**) inflate error; a responsible system should **surface uncertainty** and optionally **penalize risk** in the objective.

---

## 4. Data collection & integration (the “data” story)

| Source | Role | Scale / notes |
|--------|------|----------------|
| **Daily Nexus** grade dump | Primary label: section-level grade mix → **`avgGPA`**, counts | **104,549** rows (course × instructor × quarter × year), 2009 Fall → 2026 Winter |
| **UCSB public catalog** | Section metadata: times, enrollment, units, quarter | Joined for **live** scheduling; training join rate ~**8.5%** to a fixed quarter (expected) |
| **RateMyProfessor** (scraped, cached) | Auxiliary features: rating, difficulty, “would take again”, match confidence | **~6,028** unique instructor lookups; **missingness kept as NaN** (not mean-imputed) |
| **Supabase** | Operational DB: `sections`, `grade_distributions`, `professors`, `student_profiles`, optional audit tables | Service powers `/predict`, `/optimize`, dashboard |
| **Curated major sheets** | Requirement graphs for **Grad Path** / progress UI | Generated pipeline → `frontend/src/data/majors.ts` (+ Supabase mirror for QA) |
| **Transcript PDFs** (optional product path) | Student-specific completed courses, GPA, AP credit | Parsed client-side; **normalized course codes**; ingestion can log to **`student_ingestion_events`** |

**ETL:** Numbered, idempotent scripts (`data_pipeline/scripts/01_*` … `20_*`) produce **`unified.csv` → `features.parquet` → artifacts**. See `data_pipeline/README.md`.

**Leakage control (critical for grading):** All historical aggregates (`instr_hist_*`, `course_hist_*`, `ic_hist_*`, `dept_hist_*`) are computed **expanding with strict `<` time cutoffs** relative to each row’s quarter — the model never sees its own or future grades.

---

## 5. Methods — **Modeling** (core data science)

### 5.1 Target & grain

- **Target:** `avgGPA` = **mean GPA of the section** (aggregate), **not** an individual student’s grade.
- **Training filter:** Rows with very small letter-grade counts dropped (`n_letter > 5`); **~74,487** rows kept for modeling after quality filters (see `MODEL_CARD.md`).

### 5.2 Algorithms & baselines

| Stage | Method |
|--------|--------|
| **Baselines** | (1) **Heuristic cascade** (instructor–course → instructor → course → dept → global), (2) **ElasticNet** on expanded one-hot features |
| **Primary model** | **XGBoost** regressor, `tree_method=hist`, **`reg:squarederror`**, native **categorical** + **NaN** handling |
| **Hyperparameters (high level)** | Early stopping on validation RMSE; **253 trees**, max depth **6**, learning rate **0.05** (see `MODEL_CARD.md`) |
| **Features** | **32** structured features: catalog (units, level, GE, dept, quarter/year), **expanding** instructor / course / IC / dept **history** (mean, std, counts), **cold-start flags**, **RMP** fields + match confidence |

### 5.3 Key quantitative results (poster table)

**Held-out test:** **2026 Winter**, **n = 1,132** sections.

| Model | Test RMSE | MAE | R² | Calibration slope |
|--------|-----------|-----|-----|---------------------|
| Heuristic cascade | 0.272 | 0.196 | 0.564 | 0.86 |
| ElasticNet | 0.255 | 0.191 | 0.619 | 0.99 |
| **XGBoost (full)** | **0.234** | **0.174** | **0.678** | **1.03** |
| XGBoost, no RMP | 0.236 | 0.175 | 0.672 | — |
| XGBoost, no history aggregates | 0.293 | 0.221 | 0.496 | — |

**Interpretation bullets for poster:**

- **History is the model:** removing historical aggregates **+25% RMSE** — instructor/course/dept **time-safe** aggregates dominate.
- **RMP is incremental:** removing RMP features costs only **~0.002 RMSE** — past grade behavior already encodes most “prof quality” signal.
- **XGBoost vs heuristic ~14% RMSE reduction** — gains from **nonlinear blending** of histories and cold regimes, not from a longer cascade.

### 5.4 Cold-start regimes (uncertainty taxonomy)

Per **`MODEL_CARD.md`** / `cold_start_report` (test set):

| Regime | n (test) | RMSE | Story |
|--------|----------|------|--------|
| Warm (instructor & course both seen) | 891 | **0.219** | High confidence |
| Cold pair / cold instructor / cold course / cold both | remainder | **0.275–0.307** | **Uncertainty up** — API exposes this via **`predicted_gpa_std`** mapped to regime test RMSE |

### 5.5 Uncertainty & calibration (conformal narrative)

- **`predicted_gpa_std`:** regime-level **held-out residual RMSE** (documented mapping in `predictor.py`).
- **Intervals (`gpa_lo`, `gpa_hi`, `interval_half_width`):**  
  - If **`conformal_quantiles.json`** exists (from `data_pipeline/scripts/21_conformal_calibration.py` on **validation**): **split-style** quantiles of **|y − ŷ|** per regime.  
  - Else: **Gaussian fallback** `≈ 1.645 × σ` (documented as approximate).
- **Risk-aware optimization:** optional **`risk_lambda`** shrinks the grade term toward a **pessimistic** bound using interval half-width — ties ML uncertainty to **OR objective** (see `DECISION_EVAL.md`, `docs/ACE_decision_system_note.md`).

---

## 6. Methods — **Discrete optimization** (OR + ML interface)

- **Formulation:** **Mixed-integer / binary** section selection with:
  - **Exactly one** section per required course (and optional pools as specified),
  - **Pairwise time conflict** constraints,
  - **Unit** min/max,
  - **Time-of-day / day-of-week** pre-filters (and optional “avoid Friday afternoon”).
- **Solver:** **PuLP** + **CBC**.
- **Objective:** Weighted sum of **normalized** grade signal, professor rating, time convenience, seat availability, minus a small **instructor diversity** penalty.
- **Latency (evidence):** On **240** synthetic instances (3–6 courses × 6–12 candidates/section): **p50 = 44 ms**, **p95 = 83 ms** wall-clock (see `MODEL_CARD.md`, `processed/pitch/optimizer_latency_raw.csv`).

**Why IP, not greedy:** Greedy per-course picks can be **infeasible** when combined; IP returns **globally feasible** schedules within the preference polytope.

---

## 7. System architecture (tech stack diagram — for poster middle)

**Suggested boxes + arrows:**

```
[ NEXUS CSV + CATALOG + RMP ]  →  ETL (pandas)  →  unified.csv / features.parquet
                                              ↘
                           XGBoost train (scripts 13/14/21)  →  artifacts/
                                              ↘
        FastAPI  ←  Supabase (sections, grades, professors, profiles)
           │
           ├─ POST /predict   (predictor.py: batch features → μ, σ, intervals, regime)
           └─ POST /optimize (optimize.py: fetch sections → predict → PuLP → ranked schedules)

React 19 + Vite  →  Explorer · Dashboard · Schedule Builder · Grad Path · Data Lab (bundle export)
```

**Stack keywords for a “Technologies” strip:** Python 3.12 · FastAPI · XGBoost · PuLP/CBC · pandas · Supabase · React · TypeScript · Vite · Vitest (where used) · GitHub Actions CI.

---

## 8. Product surfaces (what judges can click)

| Surface | Role |
|---------|------|
| **Course Explorer** | Search / filter catalog; grade history where available |
| **Dashboard** | GPA, units, **estimated major-requirement unit progress**, transcript-driven profile |
| **Schedule Builder** | Calls **`/optimize`**; passes `user_id` for optional **`optimization_runs`** audit row |
| **Graduation Path** | Major requirement **tiers**; satisfied courses + AP; **unit-based** progress ring |
| **Demo mode** | **~50** distributionally calibrated **synthetic students** — judges need not upload PII |
| **Data Lab (`/showcase-lab`)** | Download **`student-bundle.json`**, Markdown summary, view **derived counts**, **ingestion** + **optimization** logs |

---

## 9. Results & figures to put on the poster (file paths)

Regenerate with pipeline scripts where noted; committed artifacts may already exist under `data_pipeline/processed/pitch/`.

| Figure / artifact | What it shows |
|-------------------|----------------|
| **Metrics table** | RMSE / R² / MAE / calibration — copy from `MODEL_CARD.md` or `processed/pitch/metrics_table.md` |
| **Ablation bar charts** | `data_pipeline/scripts/20_ablation_plots.py` → `processed/pitch/01–06*.svg` |
| **`showcase_improvement_metrics.json`** | **Real** computed stats on held-out test: RMSE ladder, row win rate, MAE — from `24_showcase_improvement_charts.py` |
| **`08_rmse_ladder_improvement.svg`** | Global mean → heuristic → ElasticNet → XGBoost RMSE (same **n=1,132** test sections) |
| **`09_abs_error_cdf_test.svg`** | CDF of absolute error: heuristic vs XGBoost (stochastic ordering on real rows) |
| **`10_row_level_win_rate.svg`** | Pie: who wins on \|error\| per row; MAE bar comparison |
| **`11_regime_rmse_test.svg`** | Cold-start regime RMSE bars (from `cold_start_report.json`) |
| **`12_decision_risk_toy_scores.svg`** | Synthetic MILP risk-λ ablation (`decision_eval_synthetic.json`) |
| **`07_regime_reliability.svg`** | Binned predicted vs actual by **cold-start regime** |
| **Optimizer latency hist** | p50/p95 from **`optimizer_latency_raw.csv`** |
| **Architecture diagram** | Section 7 above (redraw clean in Figma) |
| **Optional:** schedule UI screenshot | Feasible ranked schedules with explainable scores |

---

## 10. Experimental rigor & reproducibility (short “Methods integrity” box)

- **Temporal splits** — train / val / test by **calendar quarter**; no random row shuffle.
- **No leaky imputation** for RMP — **NaN preserved**; XGBoost handles missingness.
- **Strict RMP sensitivity** documented — strict match subset does not change ranking materially (`data_pipeline/README.md` notes).
- **Repro entrypoints** — `REPRO.md`, `make ds-*` targets where defined; **artifact hashes** tracked.
- **CI** — ruff, mypy, pytest, Docker smoke, **frontend typecheck + build** (`.github/workflows/ci.yml`).

---

## 11. Limitations (honesty block — judges expect this)

1. **Aggregate label** — predicts **section mean GPA**, not your personal grade distribution.
2. **Small / ghost sections** — filtered from training; optimizer may see **unknown quality** for rare offerings.
3. **Temporal skew** — post-COVID inflation underrepresented in long history; splits mitigate but do not erase.
4. **RMP bias** — loud-student sampling; used as **weak auxiliary**, not ground truth.
5. **Major graphs** — curated sheets are a **planning aid**, not a legal degree audit; PDF parsing has edge cases.
6. **Conformal coverage** — stated for the **section-mean** prediction under the documented calibration protocol, not for individual outcomes.

---

## 12. Broader impact / “Applications” column (Pitchfire style)

- **Student welfare:** Less time in **registrar-infeasible** schedules; more informed tradeoffs on **grade vs time vs instructor**.
- **Transparency:** **Model card** + **intervals** + **risk‑λ** connect recommender behavior to **measurable error**.
- **Institutional research angle:** Public data fusion (grades + catalog + ratings) as a template for **ethical, leak-aware** campus analytics.
- **Engineering:** **Append-only logs** (`student_ingestion_events`, `optimization_runs`) for **audit trails** when enabled in Supabase.

---

## 13. Future work (2–3 bullets)

- **Graph-aware requirements** — prerequisite chains, GE overlap, richer constraint types in the IP.
- **Embedding / RAG** on long PDFs — **gated on labeled eval** before surfacing in product (`SHOWCASE.md` future work).
- **Individual-level calibration** — only with appropriate data governance and labeled student outcomes (currently **out of scope**).

---

## 14. Attribution & ethics (footer)

- **Grade data:** Daily Nexus public dump.  
- **Ratings:** RateMyProfessor (scraped with caching; confidence field).  
- **Catalog:** UCSB public curriculum API.  
- **Not affiliated with UCSB.**  
- **Privacy:** Student profiles and logs are **user-scoped** (RLS); demo uses **synthetic** students.

---

## 15. Suggested poster layout (map to FACEMOTION / GuideLight / REFRACT style)

| Poster region | ACE content |
|---------------|-------------|
| **Header** | Title + 1-line subtitle (Section 1) |
| **Left column — Data** | Section 4 (sources table) + small ETL diagram |
| **Center — Methods** | Section 5 (model + results table) + Section 5.4–5.5 (regimes + intervals) |
| **Right column — OR + System** | Section 6 (IP constraints + latency) + Section 7 (architecture) |
| **Bottom — Evidence** | Section 9 (thumbnails of SVGs) + **QR** to repo or deployed demo |
| **Footer** | Section 14 + team names |

---

## 16. One-paragraph “poster abstract” (copy-paste)

> ACE is a full-stack **decision system** for undergraduate scheduling at UCSB. We fuse **104k+** historical section grade records with catalog and RateMyProfessor features under **strict temporal leakage controls**, then train an **XGBoost** model to predict **section mean GPA** (test RMSE **0.234**, R² **0.678** on held-out 2026 Winter). The API exposes **regime-aware uncertainty** and optional **conformal-style intervals**, which feed a **PuLP/CBC integer program** that outputs **feasible, top-ranked schedules** in **median 44 ms** while respecting time conflicts and unit limits—optionally using a **risk-aware** grade term. A React dashboard provides explorer, transcript-grounded profiles, graduation planning, and a **Data Lab** export of a canonical **student bundle**, with optional append-only **ingestion** and **optimization** logs for auditability.

---

## 17. Key file index (for you / judges)

| Topic | Path |
|--------|------|
| Big picture | `README.md`, `ONE_PAGER.md` |
| Model + eval + optimizer latency | `MODEL_CARD.md` |
| ETL | `data_pipeline/README.md` |
| Decision math note | `docs/ACE_decision_system_note.md` |
| Risk objective toy eval | `DECISION_EVAL.md` |
| Judge runbook | `scripts/JUDGE_RUNBOOK.md` |
| Showcase / Data Lab script | `SHOWCASE.md` |
| Predictor | `backend/app/ml/predictor.py` |
| Optimizer | `backend/app/ml/optimizer.py` |
| Student bundle | `frontend/src/lib/student-bundle.ts` |
| Data Lab UI | `frontend/src/pages/ShowcaseLab.tsx` |

---

*Generated as a poster source-of-truth for ACE. Update metrics if you retrain; `MODEL_CARD.md` remains canonical for model numbers.*
