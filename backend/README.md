# ACE backend

FastAPI service that fronts the UCSB catalog, grade history, XGBoost predictor, and PuLP/CBC integer-program optimizer. Supabase-backed, typed with pydantic, deployed to Fly.io.

## Dev

```bash
cd backend
python3.12 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"

# .env at repo root must set:
#   SUPABASE_URL=https://<project>.supabase.co
#   SUPABASE_SERVICE_ROLE_KEY=<service-role>   # backend-only secret
uvicorn app.main:app --reload --port 8000
```

Smoke test:

```bash
curl http://localhost:8000/health
curl "http://localhost:8000/courses?dept=CMPSC&limit=5"
curl -X POST http://localhost:8000/predict \
  -H 'Content-Type: application/json' \
  -d '{"enroll_codes":["12345","67890"]}'
```

## Routers

| Path | Purpose | File |
|---|---|---|
| `GET /health` | liveness | `app/routers/health.py` |
| `GET /courses` | paginated catalog search | `app/routers/courses.py` |
| `GET /sections` | live quarter sections | `app/routers/sections.py` |
| `GET /professors` | RMP lookup | `app/routers/professors.py` |
| `GET /majors/{id}` | requirement graph | `app/routers/majors.py` |
| `GET /ge` | GE area lookup | `app/routers/ge.py` |
| `GET /trends` | historical grade trends | `app/routers/trends.py` |
| `POST /predict` | section GPA prediction | `app/routers/predict.py` |
| `POST /optimize` | IP scheduler | `app/routers/optimize.py` |
| `GET/POST /schedules` | saved schedule CRUD | `app/routers/schedules.py` |

Pydantic schemas in `app/models/schemas.py` are the single source of truth and are imported by the data pipeline's ablation scripts.

## ML stack

`app/ml/`:

- `predictor.py` — loads `artifacts/xgb_model.json` + `xgb_feature_cols.json`; computes per-(course, instructor, dept) historical aggregates from the `grade_distributions` table; returns `{predicted_gpa, predicted_gpa_std, regime}`.
- `optimizer.py` — takes a list of `SectionCandidate` objects plus `OptimizePreferences`, builds a PuLP IP with time-conflict constraints, solves with CBC, returns top-N schedules.
- `artifacts/` — model binaries, feature list, a JSON report with training + validation metrics. Retraining re-writes these atomically.

## Tests

```bash
pytest -q
```

Current coverage is a smoke test of `/health` and `/`. Router-level tests are a deliberate next step; the model's statistical correctness is validated offline by the data pipeline's `11_eval.py` + `12_ablations.py`.

## Lint / type

```bash
ruff check app tests
mypy app
```

Both are gated in CI (`.github/workflows/ci.yml`).

`pyproject.toml` relaxes a handful of mypy error codes (`union-attr`, `arg-type`, etc.) for noise from supabase-python's dynamic JSON response type. Real type mismatches still surface.

## Layout

```
app/
  main.py              FastAPI factory, CORS, structlog wiring, router registration
  config.py            pydantic-settings (reads SUPABASE_* from env)
  db.py                supabase-py client factory
  routers/             one module per resource
  models/schemas.py    pydantic request/response (shared with data_pipeline)
  ml/
    predictor.py       XGBoost inference + feature assembly
    optimizer.py       PuLP/CBC IP solver
    artifacts/         model.json, feature_cols.json, report.json
```

## Docker

```bash
docker build -t ace-backend:local .
docker run --rm -p 8000:8000 \
  -e SUPABASE_URL=... \
  -e SUPABASE_SERVICE_ROLE_KEY=... \
  ace-backend:local
```

CI builds the image on every PR and smoke-tests that `/health` returns 200 inside the container.

## Deploy (Fly.io)

```bash
fly launch --no-deploy                                     # first time only
fly secrets set SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=...
fly deploy
```

`fly.toml` pins the app to a single region. Auto-start / auto-stop is enabled for cost control.
