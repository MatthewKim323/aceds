# ACE — pitch deck outline (10 slides, refined)

**Visual:** Ink `#080503`, text `#f7ecef`, accent sakura `#f2a7b8` · large type · few words on-slide; speaker notes carry detail.

**Team:** matthew kim, brendan chung, sabrina nguyen, sou hamura, rachel seo, jun taek oh

---

## Slide 1 — Title / hook

**On-slide (minimal):**
- **ACE** — UCSB-native, grade-aware schedule planning
- **Tagline:** One pipeline: your evidence + live catalog + historical grades → feasible schedules you can trust.

**Speaker framing:**
- **Problem:** Planning a quarter means juggling **GOLD**, **Rate My Professor**, **past grade PDFs**, and mental calendar math — tools rarely share one **grounded** picture of sections, uncertainty, and feasibility.
- **Introduce ACE:** A web app that **stores student context** (Supabase), **queries live curriculum + sections + grade history** (FastAPI + Postgres), and **turns predictions into actual schedules** (XGBoost + MILP), not a generic chat wrapper.

---

## Slide 2 — Solution + demo

**On-slide:**
- **ACE in one line:** Retrieve evidence → score sections → optimize under real constraints → explain results.
- **Demo path (live or recorded):** Academic History PDF (browser parse) → **preferences** (weights, units band, time windows) → **Optimize** → top‑k **non-overlapping** schedules with GPA surfaces + RMP + history.

**Speaker detail:**
- **Onboarding:** PDF parsed **locally**; normalized course codes; profile saved to **`student_profiles`** (RLS).
- **Schedule:** User builds **required / elective pool** → backend loads **`sections`** for the quarter, batch **`/predict`**, then **`/optimize`** (PuLP/CBC) → modal with candidates; optional **saved schedules**.
- **Honesty line:** Model predicts **section mean GPA** (aggregate), not an individual grade — intervals + regime shown in UI (`MODEL_CARD.md`).

---

## Slide 3 — One diagram: full technical story

**On-slide:** Single figure — entire flow from APIs → tables → ML → UI (see suggested shape below).

**Suggested diagram content (not “three boxes”):**
```text
[ UCSB Curriculum API · GOLD-adjacent exports · Nexus grade distributions · RMP-style professors ]
        → ETL / cleaning / features → Postgres (Supabase)
                    ↓
        Typed entities: courses · sections · grade_distributions · professors · student_profiles
                    ↓
        Join keys: course_norm · enroll_code · quarter_code · instructor_norm
                    ↓
     Predictor: sections + history aggregates → μ, [lo,hi], regime
                    ↓
     Optimizer: preferences + time conflicts + units → top‑k schedules → enrich with history + RMP
                    ↓
              React SPA (Explorer · Schedule · dashboards)
```

**One-line summary for the slide footer:**  
**Relational knowledge plane (Postgres joins), not a separate graph DB — same IDs from ingest through predict and optimize.**

---

## Slide 4 — Data collection & ingestion into the “knowledge plane”

**On-slide bullets:**
- **Live / public-style inputs:** UCSB **Curriculum API** (catalog quarters, departments), **sections** loaded into Postgres, **grade distributions** (historical offering stats), **professor** table for RMP-aligned signals.
- **Student path:** Transcript PDF → parsed rows → **`student_profiles`** (completed courses, grades metadata).
- **Pipeline:** `data_pipeline/scripts/` → cleaned CSV/Parquet → loads → **`grade_distributions`**, **`courses`**, **`sections`**, etc.

**Speaker detail:**
- **Cleaning:** Normalize **course codes**, align **quarters**, dedupe offerings, handle missing instructors.
- **Feature engineering:** Historical aggregates per **(course, instructor, dept)** for XGBoost rows (`predictor.py` joins).
- **“Knowledge graph” truth:** **SKP = typed tables + stable IDs + SQL joins** (`DEPLOYED_KNOWLEDGE_GRAPH.md`) — queryable later by the same keys the UI and optimizer use (`course_norm`, `enroll_code`, …).

---

## Slide 5 — ML prediction + optimization + querying layer

**On-slide:**
- **Predict:** XGBoost on disk → **section mean GPA** + conformal-style **intervals** + **regime** (cold vs warm).
- **Optimize:** Turn scored **SectionCandidates** into **feasible schedules** — time conflicts, units band, preference weights; optional **`risk_lambda`** uses interval width in the objective.
- **Query layer:** Every step pulls context via **joins** (catalog, sections, grades, professors), not ad-hoc text retrieval.

**Speaker hooks:**
- **`POST /predict`** — batch sections for a quarter.
- **`POST /optimize`** — sections for pool courses → predict → **PuLP/CBC MILP** → enrich candidates with **historical surfaces** + full professor fields.
- With **`user_id`:** merge **server transcript evidence** with client pool for feasibility; **`optimization_runs`** audit (e.g. bundle digest where migrated).

---

## Slide 6 — Backend ↔ frontend

**On-slide diagram (simple):**
```text
React (Vite) ── VITE_API_BASE ──► FastAPI
     │                              │
     └── Supabase (anon + JWT)      └── Service role → Postgres
        Auth · profiles · RLS          sections · grades · logs
```

**Speaker detail:**
- **Browser → Supabase:** Auth, **`student_profiles`**, saved schedules (where enabled), RLS-scoped reads/writes.
- **Browser → FastAPI:** All heavy ML + catalog + **`/predict`**, **`/optimize`**, **`/catalog`**, **`/sections`**, **`/trends`**, etc.
- **FastAPI → Supabase:** Service role for **`sections`**, **`grade_distributions`**, **`professors`**, **`optimization_runs`** inserts — keys consistent end-to-end.

---

## Slide 7 — Visualizations & what they mean

**On-slide:** **Two chart placeholders** (boxed “Figure A” / “Figure B”) + captions only.

**Suggested pair (drop figures from `data_pipeline/processed/pitch/`):**

| Slot | Figure (repo) | Say in one sentence |
|------|----------------|----------------------|
| **A** | `03_feature_ablation.svg` or `08_rmse_ladder_improvement.svg` | Historical / relational features **aren’t optional** — RMSE **~0.234** full vs **~0.293** without history (~25% relative gap on holdout). |
| **B** | `10_row_level_win_rate.svg` or regime reliability from pipeline | Model wins row-level vs naive baselines where history resolves structure; intervals communicate **uncertainty**, not magic precision. |

**Backup:** Risk toy chart (`12_decision_risk_toy_scores.svg`) if judges care about **decision layer** not just accuracy.

---

## Slide 8 — Impact

**On-slide:**
- **Motivation loop:** Less tab-switching, fewer **impossible** schedules proposed, clearer **tradeoffs** (grades vs time vs difficulty).
- **Quant hooks (use what you have):** Holdout **RMSE 0.234**; **~25%** degradation without history features; empty-pool / conflict cases surfaced with **`optimize_notes`** instead of silent failure.

**Speaker honesty:** Impact is **workflow + transparency**; we’re not claiming GPA causality for individuals — we reduce search cost and make constraints explicit.

---

## Slide 9 — Challenges + future work

**On-slide:**
- **Limits:** Section-level prediction, not personal grades; **UCSB-shaped** data and bundled majors; synthetic risk demo is **illustrative**, not a randomized controlled trial.
- **Future:** Better **cold-start** surfaces; richer **degree-audit** alignment; institution packs → **same architecture extends to other UCs** if catalog + grade feeds are wired similarly (not copy-paste GOLD — repeatable **pipeline + schema**).

**Speaker:** Optional path — **NL layer / agents as tools** over the same APIs (`ACE_agent_tools_spec.md` sketch) without replacing deterministic core.

---

## Slide 10 — Closing

**On-slide (one cool line):**
- **ACE doesn’t guess your quarter — it joins your evidence to the same grade and catalog surfaces the registrar already implied, then optimizes what’s actually feasible.**

**Optional smaller:** *Questions?* · **ace** · repo / demo link

---

### Appendix — asset paths & canonical docs

| Topic | Path |
|-------|------|
| Repo orientation | [`PROJECT_CONTEXT.md`](../PROJECT_CONTEXT.md) |
| Model metrics & limits | [`MODEL_CARD.md`](../MODEL_CARD.md) |
| Join / SKP narrative | [`DEPLOYED_KNOWLEDGE_GRAPH.md`](DEPLOYED_KNOWLEDGE_GRAPH.md) |
| Competition metrics index | [`COMPETITION_METRICS.md`](COMPETITION_METRICS.md) |
| Pitch limitations | [`LIMITATIONS_COMPETITION.md`](LIMITATIONS_COMPETITION.md) |
