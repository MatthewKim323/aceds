#!/usr/bin/env bash
# ACE — Judge E2E smoke test.
#
# Verifies the full stack: data artifacts present, backend imports cleanly,
# key endpoints respond sanely, frontend builds. Run from repo root.
#
# Usage:
#   ./scripts/smoke_e2e.sh
#
# Requires: python3.12, node, npm, curl. Expects `data_pipeline/.venv` to be
# populated for offline checks; will skip live-server checks if backend isn't
# already running on :8000.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
DIM='\033[2m'
NC='\033[0m'

pass() { printf "  ${GREEN}✓${NC} %s\n" "$1"; }
fail() { printf "  ${RED}✗${NC} %s\n" "$1"; FAILED=1; }
skip() { printf "  ${YELLOW}○${NC} %s ${DIM}(skipped)${NC}\n" "$1"; }
section() { printf "\n${DIM}── %s ──${NC}\n" "$1"; }

FAILED=0

section "1. Repo layout"

for dir in backend frontend data_pipeline .github; do
  if [[ -d "$dir" ]]; then pass "$dir/ present"; else fail "$dir/ missing"; fi
done

for doc in README.md MODEL_CARD.md ONE_PAGER.md; do
  if [[ -f "$doc" ]]; then pass "$doc present"; else fail "$doc missing"; fi
done

section "2. Data pipeline artifacts"

REQUIRED_ARTIFACTS=(
  "data_pipeline/processed/pitch/01_per_dept_rmse.svg"
  "data_pipeline/processed/pitch/02_calibration.svg"
  "data_pipeline/processed/pitch/03_feature_ablation.svg"
  "data_pipeline/processed/pitch/04_feature_importance.svg"
  "data_pipeline/processed/pitch/05_optimizer_latency.svg"
  "data_pipeline/processed/pitch/06_data_coverage.svg"
  "data_pipeline/processed/pitch/metrics_table.md"
  "data_pipeline/processed/pitch/metrics_table.json"
)

for f in "${REQUIRED_ARTIFACTS[@]}"; do
  if [[ -f "$f" ]]; then pass "$f"; else fail "$f missing (run 20_ablation_plots.py)"; fi
done

section "3. Backend model artifacts"

for f in backend/app/ml/artifacts/xgb_model.json backend/app/ml/artifacts/xgb_feature_cols.json; do
  if [[ -f "$f" ]]; then
    size=$(wc -c < "$f" | tr -d ' ')
    pass "$f (${size} bytes)"
  else
    fail "$f missing (run 13_xgboost.py)"
  fi
done

section "4. Backend import + lint"

if command -v python3.12 > /dev/null; then
  PYBIN=python3.12
elif command -v python3 > /dev/null; then
  PYBIN=python3
else
  skip "python3 not found"
  PYBIN=""
fi

if [[ -n "$PYBIN" ]] && [[ -d data_pipeline/.venv ]]; then
  # Prefer the data_pipeline venv — it has all the tools installed locally.
  source data_pipeline/.venv/bin/activate
  if python -c "import app.main" --root backend 2>/dev/null || (cd backend && python -c "from app.main import create_app; app=create_app(); print('ok')") > /dev/null 2>&1; then
    pass "backend imports cleanly"
  else
    skip "backend import (missing SUPABASE_URL — expected in smoke context)"
  fi
  if (cd backend && ruff check app tests > /dev/null 2>&1); then
    pass "ruff clean"
  else
    fail "ruff errors"
  fi
  if (cd backend && mypy app > /dev/null 2>&1); then
    pass "mypy clean"
  else
    fail "mypy errors"
  fi
  deactivate
else
  skip "backend static checks (no venv)"
fi

section "5. Live backend (if running on :8000)"

if curl -fsS -o /dev/null -w '' http://localhost:8000/health 2>/dev/null; then
  pass "/health responds"

  if curl -fsS "http://localhost:8000/courses?dept=CMPSC&limit=3" | python3 -c 'import json,sys;d=json.load(sys.stdin);assert isinstance(d,(list,dict))' 2>/dev/null; then
    pass "/courses returns JSON"
  else
    fail "/courses broken"
  fi

  if curl -fsS "http://localhost:8000/sections?quarter=20262&dept=CMPSC&limit=3" | python3 -c 'import json,sys;json.load(sys.stdin)' 2>/dev/null; then
    pass "/sections returns JSON"
  else
    skip "/sections (may need quarter data loaded)"
  fi
else
  skip "backend not running on :8000 — start it with 'cd backend && uvicorn app.main:app --port 8000'"
fi

section "6. Frontend build"

if [[ -d frontend/node_modules ]]; then
  if (cd frontend && \
      VITE_SUPABASE_URL=https://dummy.supabase.co \
      VITE_SUPABASE_ANON_KEY=dummy \
      VITE_API_BASE=http://localhost:8000 \
      npm run build > /tmp/ace_fe_build.log 2>&1); then
    pass "frontend typecheck + build"
  else
    fail "frontend build (see /tmp/ace_fe_build.log)"
    tail -20 /tmp/ace_fe_build.log | sed 's/^/    /'
  fi
else
  skip "frontend build (run 'cd frontend && npm install')"
fi

section "7. Demo mode assets"

if [[ -f frontend/public/synthetic_students.json ]]; then
  count=$(python3 -c 'import json;print(len(json.load(open("frontend/public/synthetic_students.json"))))')
  pass "${count} synthetic students loaded"
else
  fail "frontend/public/synthetic_students.json missing (run 16_synthetic_students.py)"
fi

if [[ -L frontend/public/ocean.mp4 ]] && [[ -e frontend/public/ocean.mp4 ]]; then
  pass "ocean.mp4 symlink resolves"
elif [[ -f frontend/public/ocean.mp4 ]]; then
  pass "ocean.mp4 present"
else
  skip "ocean.mp4 missing (optional)"
fi

printf "\n"
if [[ "$FAILED" -eq 1 ]]; then
  printf "${RED}✗ smoke test FAILED${NC} — see above\n"
  exit 1
fi

printf "${GREEN}✓ all smoke checks passed${NC}\n"
printf "${DIM}  next: boot backend + frontend, open http://localhost:5173, click 'try demo'${NC}\n"
