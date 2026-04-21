# ACE Data Pipeline

Three sources → one DataFrame → one model → one pitch deck. Scripts are **numbered**, **idempotent**, and committed — raw CSVs and intermediate parquet files are `.gitignore`d.

```
01–04  : ingest + merge   (Nexus grades + UCSB catalog + RMP → unified.csv)
05–08  : majors           (Claude extraction → manual review → Supabase + TS)
10–14  : modeling         (features → heuristic / linear / XGBoost + cold-start report)
15     : embeddings       (local, sentence-transformers — no API key)
16     : synthetic demo   (50 fake students for demo mode)
20     : pitch assets     (6 SVGs + metrics table + optimizer latency benchmark)
00     : audit            (spot-checks unified.csv + model artifacts)
```

## Setup

```bash
cd data_pipeline
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

`.env` at repo root sets:

```
UCSB_API_KEY=...           # required for 02_fetch_ucsb_catalog.py
ANTHROPIC_API_KEY=...      # required for 05_extract_majors_claude.py
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
```

## Run in order

```bash
# Phase 1: data ingest (one-time, ~15 min mostly RMP scrape)
python scripts/01_fetch_nexus_grades.py         # ~2s  → raw/nexus_grades.csv
python scripts/02_fetch_ucsb_catalog.py         # ~30s → raw/ucsb_catalog_20262.csv
python scripts/03_fetch_rmp.py --limit 25       # sanity-check first
python scripts/03_fetch_rmp.py                  # full scrape, ~10 min
python scripts/04_merge.py                      # → processed/unified.csv (104,549 rows)

# Phase 1b: majors (optional; Supabase ships with them pre-loaded)
python scripts/05_extract_majors_claude.py      # Claude extracts requirement graphs
python scripts/06_review_majors.py              # interactive review + correction
python scripts/07_load_to_supabase.py           # upload to majors/major_groups tables
python scripts/08_majors_json_to_ts.py          # emit frontend/src/lib/majors.ts

# Phase 2: modeling (~5 min)
python scripts/10_build_features.py             # temporal features → processed/features.parquet
python scripts/11_baseline_heuristic.py         # IC → instr → course → dept cascade
python scripts/12_baseline_linear.py            # ElasticNet
python scripts/13_xgboost.py                    # XGBoost → backend/app/ml/artifacts/
python scripts/14_cold_start.py                 # per-regime report → processed/cold_start_report.md

# Phase 2b: course embeddings (local, ~5s on CPU after first model download)
python scripts/15_embeddings.py                 # → processed/course_embeddings.parquet (384d, MiniLM)

# Phase 3: pitch-deck artifacts (~1 min)
python scripts/20_ablation_plots.py             # → processed/pitch/*.svg + metrics_table.{json,md}
```

The embeddings script uses `sentence-transformers/all-MiniLM-L6-v2` by default — runs locally on CPU, no API key. Pass `--model BAAI/bge-small-en-v1.5` for a quality bump at the same dim.

## Outputs

- `raw/nexus_grades.csv` — every graded UCSB course instance, 2009 Fall → 2026 Winter, 104,549 rows.
- `raw/ucsb_catalog_<quarter>.csv` — live sections for one quarter (times, enrollment, professors).
- `raw/rmp_cache.json` + `raw/rmp_ratings.csv` — cached RMP lookups keyed by unique Nexus instructor. Re-run is incremental.
- `processed/unified.csv` — the one DataFrame that feeds modeling.
- `processed/features.parquet` — temporally-leak-free features ready for `13_xgboost.py`.
- `processed/cold_start_report.md` — per-regime RMSE and bias.
- `processed/pitch/` — plots + metrics used in the model card and the pitch deck. See [that folder's README](processed/pitch/README.md).

## Grain of the final DataFrame

One row per historical `(course × instructor × quarter × year)`, with:

- Grade distribution (counts + percentages + `avgGPA`).
- RMP fields (`rmp_rating`, `rmp_difficulty`, `rmp_num_ratings`, `rmp_would_take_again`, `rmp_confidence`) — NULL where unmatched. **Do not impute.**
- Catalog fields for the target quarter (title, description, units, GE codes) — only populated where that instructor is teaching that course this quarter.

## Data-quality notes (read before training)

1. **`avgGPA == 0.0`** is legit only when `n_letter ≤ 5`. `10_build_features.py` drops rows with `n_letter ≤ 5` by default, removing the 8,212 noisy sections.
2. **`rmp_would_take_again == -1.0`** is RMP's "not enough ratings" sentinel. We convert it to NaN before training or it poisons the feature.
3. **RMP match confidence.** `exact_initial` (2,768, trust), `only_candidate` (520, usually fine), `top_by_ratings` (688, weaker), `none` (2,052). `13_xgboost.py` trains on all rows but `12_ablations.py` reports the "strict" slice (`exact_initial + only_candidate` only) for comparison. The ranking does not change.
4. **Catalog join rate is ~8.5%.** Expected — only ~1,300 of 10,562 historical courses are on offer this specific quarter. Catalog fields are used for prospective section-ranking, not for training the grade predictor.
5. **Nexus omits <5-enroll sections.** The long seminar tail has no grade data. Fine — the model does not try to predict them, and the optimizer treats them as "unknown quality."

## Known limitations

1. **RMP name matching.** Nexus stores `LASTNAME F M`; we query RMP as `F Lastname`. Fuzzy search returns ~87% row-level match. The `rmp_confidence` column is your escape hatch.
2. **Temporal coverage skew.** Recent (post-COVID) quarters are under-represented. Temporal splits in `13_xgboost.py` control for this but don't eliminate it.
