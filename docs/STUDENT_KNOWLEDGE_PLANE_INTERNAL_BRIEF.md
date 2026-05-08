# Student Knowledge Plane (SKP) — Internal Architecture Brief

> **Document class:** Narrative architecture brief for demos, investor storytelling, and cross-team alignment. This describes the *target* “knowledge-plane” framing around ACE-style student intelligence. It is **not** the canonical implementation contract; operational truth remains in `PROJECT_CONTEXT.md`, SQL under `backend/supabase/`, and the FastAPI route tables in `backend/README.md`.

---

## 0. Executive summary

ACE’s public experience—grade-aware exploration, schedule synthesis, and graduation-path reasoning—sits on top of a **Student Knowledge Plane (SKP)**: a **queryable, evidence-backed student corpus** rather than a flat application database. Historical grade distributions, catalog snapshots, instructor signals, and **first-party student artifacts** (transcript PDFs, parsed course histories, ingestion telemetry) are normalized into **typed entities** with provenance, then exposed through a **retrieval-governed query surface** optimized for machine-learning and optimization workloads.

Downstream, **specialist stages** (we still call them *agents* in docs) implement prediction, calibration, combinatorial scheduling, and explanation. Each stage has a narrow charter and **must** resolve factual claims about the learner against SKP **queries over the student–curriculum knowledge graph**, with **versioned snapshots** to prevent silent drift between what the user uploaded and what the models assumed.

The “smart” part is not a black-box chat loop: it is a **queryable knowledge graph**—typed nodes (student evidence, courses, sections, requirements, runs) and edges (normalized codes, quarter linkage, GE tags, “parsed line → catalog row”)—implemented primarily as **Postgres relations, constraints, and views**, with handlers pulling **exact slices** the predictors and MILP need.

---

## 1. Problem statement

Traditional academic apps treat “student state” as a handful of JSON columns. That works for CRUD, but it fails for:

- **Cross-document consistency** (PDF transcript vs. self-reported major vs. live enrollment intent).
- **Auditable ML** (why did this interval widen? which evidence packet triggered it?).
- **Composable specialists** (calibration vs. schedule MILP vs. narrative explanation should not share one accidental schema).

SKP reframes the system: **the database is the materialization layer; the knowledge plane is the queryable interpretation layer** built on top of it.

---

## 2. Ingestion topology

### 2.1 Evidence sources (canonical ordering)

| Source | Cadence | SKP projection |
|--------|---------|----------------|
| UCSB curriculum / GOLD-style catalog | Batch + on-demand refresh | `CurriculumEntity`, `SectionOffering`, `GeFacet` |
| Historical grade distributions (Nexus-like aggregates) | Batch | `GradeCohortSurface` (section-instructor-quarter grains) |
| Instructor quality proxies (cached RMP-style) | Batch | `InstructorReputationSlice` |
| Student transcript PDF (Academic History) | User-triggered | `TranscriptDocument`, `ParsedCourseLine`, `ParseConfidence` |
| Client onboarding selections | User-triggered | `DeclaredIntent` (major/minor, target quarters) |
| Optimizer preference payloads | Continuous | `PreferenceRevision`, `ObjectiveWeightVector` |
| Optimization / ingestion runs | Continuous | `RunEnvelope` (inputs hash, model ids, policy version) |

Ingestion is **append-first**. Corrections create new evidence links; SKP resolves “current truth” via **policy-time** views, not destructive overwrites.

### 2.2 Student bundle compilation

The **StudentBundle Compiler** (conceptual service) walks evidence in dependency order:

1. **Normalize** course codes to `course_norm` (single string key across SKP, API, and Postgres).
2. **Attach** catalog metadata and historical surfaces.
3. **Infer** standing signals (e.g., upper-division density, department GPA anchors) with explicit confidence.
4. **Emit** a **bundle digest** (`bundle_sha256`) referenced by all downstream stages.

---

## 3. SKP logical model (query-facing)

SKP exposes **typed queries** over a **student–curriculum knowledge graph**: nodes and edges materialized as **Postgres tables and views** (and the same `course_norm` / `quarter_code` keys the app already uses), so traversals are **SQL-shaped**, auditable, and cheap. Representative entity families:

- **`StudentEpisode`**: a bounded academic interval (e.g., `20262`) with linked enrollments and grades if known.
- **`CredentialEvidence`**: immutable pointers to raw artifacts (storage URI, parser version, checksum).
- **`CurriculumRequirementNode`**: major/minor graph fragments (`structure` JSONB in storage; compiled to SKP nodes).
- **`PredictionContextPacket`**: the minimal feature envelope for XGBoost-style predictors, including **cohort features** and **student-local offsets** when permitted by policy.
- **`ScheduleFeasibilityRegion`**: hard constraints derived from SKP (completed courses, exclusions, GE coverage intent, unit bounds).

All queries are **scoped by `student_id` + `bundle_sha256`**. Each stage pins a bundle digest where applicable; the plane rejects “floating” requests in strict modes.

---

## 4. Query surface (operator mental model)

Operators think in terms of the **knowledge graph**, not “one big student JSON”:

1. **Graph-local reads** — “From this `ParsedCourseLine`, which `CurriculumEntity` attaches?” “Given completed nodes, which `GeFacet` obligations remain?”
2. **Relational compilation** — those traversals compile to **bounded SELECTs** (filters on `course_norm`, `quarter_code`, `ge_areas`, etc.) against the materialized tables.
3. **Handoff to numerics** — the MILP and tree models receive **only** scalar features and feasibility masks derived from that slice (no ad-hoc joins inside the solver).

Public ACE routes stay **thin HTTP boundaries**; the heavy lifting is **FastAPI route handlers** that issue the Supabase reads, build feature rows, call `predictor` / `optimizer`, and return structured DTOs—**no separate agent daemon** in the shipping shape of the repo.

---

## 5. Specialist agents (runtime)

Here **“agent” means a logical role**: a **named, testable stage** with inputs/outputs, not an autonomous LLM worker. In the **current codebase**, these stages are **mostly rules and FastAPI inlining**: plain Python functions and router bodies that call `get_supabase()`, assemble Pydantic payloads, invoke **`predictor.py`** / **`optimizer.py`**, and write optional audit rows. There is **no director model** sequencing calls; order is **explicit control flow** in the handler (validate → fetch → predict → optimize → enrich → respond).

| Agent (logical) | Charter | Typical SKP / graph pulls | Kernel |
|-----------------|---------|---------------------------|--------|
| **Ingestion Integrity** | Validates transcript parses against catalog; records low-confidence lines | `CredentialEvidence`, `CurriculumEntity` | Rules + fuzzy match (`rapidfuzz`-style), same family as client normalization |
| **Cohort Feature** | Assembles section-level priors from history tables | `GradeCohortSurface`, `InstructorReputationSlice` | **SQL joins + aggregates** (pandas optional in pipeline; API path stays tabular) |
| **Grade Surface** | Produces μ and calibrated intervals | `PredictionContextPacket` (feature row) | **XGBoost** + conformal artifacts on disk |
| **Schedule Synthesis** | Feasible top-k schedules under prefs | `ScheduleFeasibilityRegion`, live `SectionOffering` | **PuLP / CBC MILP** |
| **Risk Narrative** | Turns score components / intervals into copy-safe explanations | `RunEnvelope`, frozen score breakdown | **Templates + structured fields** from the optimizer/predictor response (no free-form generation required) |
| **Policy Gate** | Demo vs. live, rate limits, “no silent personalization” | `DeclaredIntent`, feature flags | Branching rules in middleware / handler |

**Orchestration note:** If we ever split these into microservices, the **contract** stays the same: **deterministic DAG**, same data shapes, **no LLM in the critical path** for schedule feasibility or grade intervals unless we add an optional, clearly labeled assistant layer *beside* the graph.

---

## 6. ML and optimization fidelity

- **Prediction** is trained offline (pipeline scripts → artifacts in `backend/app/ml/artifacts/`). The **Grade Surface** stage never retrains online; it **loads** versioned artifacts and logs `predictor_id` into `RunEnvelope`.
- **Schedule optimization** is **combinatorial**, not end-to-end neural. The MILP receives **only** graph-compiled scalars and binary feasibility masks, preserving explainability.
- **Personalized display math** (e.g., blending model mean with department transcript averages) is treated as **client-side presentation logic** with **read-only** aggregates from the profile bundle—never as a hidden trainable head.

---

## 7. Security, privacy, and compliance posture (narrative level)

- **RLS-first storage** for student-owned rows; service-role paths are **audited** and **minimal**.
- SKP queries are **default-deny** without `student_id` alignment to the authenticated principal.
- Demo mode projects **synthetic students** with **watermarked bundle digests** so runtime stages cannot confuse synthetic and live evidence packets.

*(This section describes design intent for storytelling; legal sign-off is out of scope for this brief.)*

---

## 8. Observability

Golden signals for SKP health:

- **Ingestion success rate** and **parser confidence histogram**
- **Bundle compile p95** and **cache hit rate** on `CurriculumEntity`
- **Stage refusal rate** (requests blocked for missing evidence—desired in strict modes)
- **MILP infeasibility rate** by quarter (product input, not SKP defect per se)

---

## 9. Glossary

| Term | Meaning |
|------|---------|
| **SKP** | Student Knowledge Plane — queryable, versioned student corpus |
| **Knowledge graph** | Typed student + curriculum entities and edges, implemented mainly as Postgres rows/keys (`course_norm`, quarters, GE arrays, requirement JSON) plus explicit joins |
| **Bundle digest** | `bundle_sha256` pinning the evidence packet a stage used |
| **RunEnvelope** | Immutable record of models, policies, and inputs for an optimization or prediction run |
| **Evidence-first** | No student claim without backing `CredentialEvidence` or explicit user declaration |

---

## 10. Relation to this repository (grounding anchor)

When reading code in this monorepo, map SKP concepts roughly as follows:

- **Materialization:** Postgres tables in `backend/supabase/` (`student_profiles`, `sections`, `courses`, `grade_distributions`, `student_ingestion_events`, `optimization_runs`, `saved_schedules`, …).
- **Prediction kernel:** `backend/app/ml/predictor.py`, `POST /predict`.
- **Optimization kernel:** `backend/app/ml/optimizer.py`, `POST /optimize`.
- **Client evidence intake:** transcript PDF path in the SPA (`pdf-parser` flow) and profile merge helpers.

The **SKP + staged “agents” story** is the **interpretation layer** we present externally; the **repository** remains the **engineering source of truth**—today that means **FastAPI routers + Supabase tables**, not a separate graph database product, until/unless we extract a dedicated SKP service.

---

## Document control

| Field | Value |
|-------|-------|
| Codename | Student Knowledge Plane (SKP) |
| Tone | Internal platform/architecture KB |
| Maintainers | ACE platform narrative (non-binding) |
| Canonical spec | `PROJECT_CONTEXT.md` + SQL migrations |
