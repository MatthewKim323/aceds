# ACE — judge / venue checklist (cold laptop)

Use this on a fresh machine before a pitchfire. Paths are relative to the repo root.

## 0. Prereqs

- Python 3.12+, Node 20+, `git`, `curl`
- Supabase project with **002** + **003** SQL applied (`backend/supabase/002_data_tables.sql`, `003_demo_mode.sql`)
- Root `.env` with `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and frontend `VITE_*` vars as in `README.md`

## 1. Data load (once per quarter)

```bash
cd data_pipeline && source .venv/bin/activate
set -a && source ../.env && set +a
python scripts/07_load_to_supabase.py   # default quarter 20262
python ../scripts/verify_supabase_data.py
```

Exit 0 on verify = core tables have rows. If connect fails, check VPN/network and credentials.

## 2. Backend

```bash
cd backend
python3.12 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
set -a && source ../.env && set +a
uvicorn app.main:app --reload --port 8000
```

Sanity: `curl -s http://localhost:8000/health` → `{"status":"ok"}`  
`curl -s http://localhost:8000/status` → JSON with non-negative table counts.

## 3. Frontend

```bash
cd frontend && npm install
VITE_API_BASE=http://localhost:8000 \
VITE_SUPABASE_URL=... VITE_SUPABASE_ANON_KEY=... \
npm run dev
```

Open `http://localhost:5173` → **Try demo** → Dashboard → **Schedule** (run optimize) → **Graduation Path** → **System Status** (evidence links to `/pitch/*.svg`).

## 4. Automated smoke (repo root)

```bash
./scripts/smoke_e2e.sh
```

With backend up on `:8000`, this also hits `POST /predict` and `POST /optimize` using live section IDs.

## 5. What to say if probed

- **`predicted_gpa_std`:** per-regime **test residual RMSE**, not a personal grade interval — see `MODEL_CARD.md`.
- **Majors:** GradPath/Schedule use bundled `frontend/src/data/majors.ts` for offline demo; Supabase `major_requirements` is loaded for server/API consistency — keep them aligned when majors change.
- **Schedule simplification:** UI states that “pick N of M” groups are treated as electives for the demo pool; predictions are **section means**.
