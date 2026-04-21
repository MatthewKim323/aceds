# ACE — a better schedule builder for UCSB

> _An aggregate grade predictor and integer-program schedule optimizer, trained on 17 years of UCSB grade data, fronted by a FastAPI service and a React dashboard._

ACE is the registration tool Gauchos deserve. Pick your required courses, tell us what you care about (grade, professor rating, time of day, availability), and get a ranked set of non-conflicting schedules in ~50 ms — each with an explainable prediction of what the section is actually going to be like.

---

## What makes this more than a GPA calculator

- **104,549 course × instructor × quarter rows** from the Daily Nexus, 2009 → 2026 Winter, joined with 6,028 unique RateMyProfessor lookups and the live UCSB catalog for 20262.
- **XGBoost grade predictor** with 32 features and native NaN handling. Test RMSE **0.234**, calibration slope **1.03** — 14% sharper than a sensible hard-cascade heuristic, and meaningfully better than ElasticNet on the same features. Cold-start regimes (new instructor-course pair, new everything) are explicitly modeled and the returned `predicted_gpa_std` widens to match.
- **Integer-program scheduler** (PuLP + CBC) that respects unit budgets, time conflicts, user-chosen must-take courses, and a preference vector over grade / professor / time / availability. Solves 3–6 course problems in **p50 = 44 ms, p95 = 83 ms** across 240 benchmarks.
- **Synthetic-student layer.** 50 distributionally-calibrated fake Gauchos, so judges can click "try demo" instead of uploading a real transcript.
- **Evidence bundle.** Every number above is reproducible from a single script. Plots and a metrics table live in [`data_pipeline/processed/pitch/`](data_pipeline/processed/pitch/README.md).

---

## Repo layout

```
ace/
├── backend/                 FastAPI service (routers, predictor, optimizer, supabase client)
├── frontend/                React 19 + Vite + motion.dev dashboard
├── data_pipeline/           ETL: Nexus + catalog + RMP → one DataFrame + model
│   ├── scripts/             01_fetch_nexus → 20_ablation_plots, numbered & idempotent
│   └── processed/pitch/     Pitch-deck plots, metrics table, latency CSV
├── MODEL_CARD.md            What the model does, limitations, full eval table
└── .github/workflows/ci.yml Ruff + mypy + pytest + docker smoke + frontend typecheck/build
```

Each directory has its own README with setup and a smoke-test curl.

---

## Thirty-second demo (no API keys required)

```bash
# 1. Backend
cd backend
python3.12 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
export SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=...
uvicorn app.main:app --reload --port 8000

# 2. Frontend (new terminal)
cd frontend
npm install
VITE_API_BASE=http://localhost:8000 \
VITE_SUPABASE_URL=... VITE_SUPABASE_ANON_KEY=... \
npm run dev
```

Open `http://localhost:5173`, click "Try demo mode" on the landing page, and you'll be dropped into a synthetic student's dashboard. The `/schedule` page hits the live optimizer; `/gradpath` walks the major requirement graph.

No Supabase project on hand? The `/health`, `/courses`, and `/predict` endpoints work against a read-only Supabase service key; request one or run the data pipeline yourself (see `data_pipeline/README.md`) to materialize `unified.csv` and train your own model.

---

## Results at a glance

All on the 2026 Winter held-out test set, n = 1,132.

| Model | Test RMSE | MAE | R² | Calibration slope |
|---|---|---|---|---|
| Heuristic (IC → instr → course → dept → global) | 0.272 | 0.196 | 0.564 | 0.86 |
| ElasticNet (111 one-hot features) | 0.255 | 0.191 | 0.619 | 0.99 |
| **XGBoost (full features)** | **0.234** | **0.174** | **0.678** | **1.03** |
| XGBoost — no RMP features | 0.236 | 0.175 | 0.672 | — |
| XGBoost — no historical aggregates | 0.293 | 0.221 | 0.496 | — |

**One-line interpretation.** Historical aggregates are the model; RMP adds <1% RMSE on top; cold-start is handled explicitly and the returned prediction std reflects it. The full story, including per-regime breakdown and calibration plot, lives in [`MODEL_CARD.md`](MODEL_CARD.md).

---

## Design choices that are unusual, and why

1. **Missingness preserved, never imputed.** Imputing `rmp_rating` with the department mean leaks information and makes the model look better than it is. XGBoost handles NaN natively; we took the pain of not imputing and the ablation shows the model is robust to it.
2. **Temporal splits, strict `<` cutoffs.** Every historical feature is computed expanding from the training side of the cutoff. Retraining is a single `python scripts/13_train.py` away and will never accidentally learn from its own test set.
3. **IP over heuristic scheduling.** A greedy "pick the best section per course" approach ignores time conflicts; a full IP with conflict constraints returns feasible, non-conflicting schedules and happens to solve in <100 ms for realistic problem sizes.
4. **No training on RMP alone.** RMP would-take-again sentinel values (−1 = insufficient data) are converted to NaN up-front; we never use RMP as a standalone signal because it over-represents loud students.

---

## Contributing / reproducing

- Data pipeline: **~15 min end-to-end** from a clean checkout, most of that is the RMP scrape. See [`data_pipeline/README.md`](data_pipeline/README.md).
- Model retraining: **~2 min on a laptop**. See `data_pipeline/scripts/13_train.py`.
- Pitch assets: `python data_pipeline/scripts/20_ablation_plots.py` regenerates every SVG + the metrics JSON.
- CI: every push runs ruff, mypy, pytest, a Docker smoke test, and a frontend typecheck + build. See `.github/workflows/ci.yml`.

---

## Attribution

Grade data: the Daily Nexus grade dump (public). Professor ratings: RateMyProfessor (scraped respectfully, cached, only used where the match confidence is high enough). Catalog: UCSB's public curriculum API. This project is not affiliated with UCSB.
