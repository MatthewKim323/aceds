# ACE showcase — structured student index + data lab

A **60-second judge script** plus pointers to the ML story. Use this with the in-app **Dashboard → Data lab (showcase)** page (`/showcase-lab`).

## Spoken script (~60s)

> ACE is a **decision system**, not just a GPA widget: a temporal XGBoost model produces **section mean GPA with regime-aware intervals** (split conformal on val when calibrated, else a documented Gaussian fallback), and a **PuLP integer program** picks feasible schedules—optionally **risk-aware** via a grade term that penalizes wide intervals. Alongside that we ship **append-only logs** (ingestion + optimization runs) and a **canonical student bundle** in TypeScript so every surface agrees on the same structured student state. Judges can download JSON from the Data lab and read the full eval story in MODEL_CARD plus decision-layer ablations in DECISION_EVAL. Limitations: user-scoped data only; bundle is not a legal degree audit; vector RAG stays future work until we have labeled eval.

## Bullets (poster / slide)

- **Problem:** Schedules and recommendations need one deterministic “student index” shared across Dashboard, Explorer, and Grad Path—not three ad-hoc interpretations of the same Supabase row.
- **Data sources:** `student_profiles` (Supabase), major sheets from `frontend/src/data/majors.ts`, transcript parsing via `frontend/src/lib/pdf-parser.ts` (course normalization in `course-norm.ts`).
- **Auditable ingestion:** Table `student_ingestion_events` (migration `backend/supabase/004_student_ingestion_events.sql`) — append-only rows with `source` (`transcript` | `academic_history` | `manual`), `parse_schema_version`, and a JSON `summary`. RLS: each user can **insert** and **select** only their own rows.
- **Canonical bundle:** `buildStudentBundle` in `frontend/src/lib/student-bundle.ts` — stable keys, derived counts, capped `graphEdges` for demos. Unit tests: `frontend/src/lib/student-bundle.test.ts`.
- **Data lab UI:** `frontend/src/pages/ShowcaseLab.tsx` — load profile, render charts, **download** `student-bundle.json`, **copy** Markdown summary, list **ingestion** + **optimization** runs.
- **Optimization audit:** `backend/supabase/005_optimization_runs.sql` — `POST /optimize` logs when `user_id` is sent (Schedule Builder passes it).
- **Model metrics:** See **[MODEL_CARD.md](MODEL_CARD.md)** — intervals, risk-λ objective, test RMSE/R², ablations, regime reliability SVG.
- **Decision ablation:** [DECISION_EVAL.md](DECISION_EVAL.md) + `make ds-decision-eval`.
- **Limitations:** Bundle is a **derived view** of stored profile fields, not a legal degree audit; PDF parsing can miss edge-case rows. No Neo4j / warehouse in this milestone.
- **Privacy:** Ingestion log and profile remain **scoped to `auth.uid()`** via RLS; no aggregate export of other users’ data in-app.

## Future work (two lines)

- **Targeted embeddings** for long requirement PDFs and catalog text, gated on a **labeled eval** before RAG surfaces in the product.
- Deeper **requirement graph** (GE overlap, prereq chains) once `requirement_status` structure is stable enough to test against registrar truth.

## Quick links

| Artifact | Path |
|----------|------|
| Model card | [MODEL_CARD.md](MODEL_CARD.md) |
| Cold-start report (cited in model card) | [data_pipeline/processed/cold_start_report.md](data_pipeline/processed/cold_start_report.md) |
| Data pipeline overview | [data_pipeline/README.md](data_pipeline/README.md) |
| Ingestion migration | [backend/supabase/004_student_ingestion_events.sql](backend/supabase/004_student_ingestion_events.sql) |
| Optimization runs migration | [backend/supabase/005_optimization_runs.sql](backend/supabase/005_optimization_runs.sql) |
| Repro / hashes | [REPRO.md](REPRO.md) |
| Decision-system note | [docs/ACE_decision_system_note.md](docs/ACE_decision_system_note.md) |
