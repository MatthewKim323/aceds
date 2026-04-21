# ACE backend

FastAPI service that fronts the catalog, grade history, XGBoost predictor, and IP optimizer.

## Dev

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"

# copy the root .env.example into .env at repo root, fill in SUPABASE_URL
# and SUPABASE_SERVICE_ROLE_KEY, then:
uvicorn app.main:app --reload --port 8000
```

Smoke test:

```bash
curl http://localhost:8000/health
curl "http://localhost:8000/courses?dept=CMPSC&limit=5"
```

## Tests

```bash
pytest
```

## Layout

```
app/
  main.py           app factory, CORS, structlog wiring
  config.py         pydantic-settings
  db.py             supabase-py client
  routers/          one module per resource
  models/schemas.py pydantic request/response
  ml/               predictor, optimizer, embeddings
```

## Deploy

```bash
fly launch --no-deploy       # first time
fly secrets set SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=...
fly deploy
```
