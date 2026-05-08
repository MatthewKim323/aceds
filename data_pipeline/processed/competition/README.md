# Competition metric exports

CSV summaries for G1 (client vs profile completed-course mismatch rate) and G2 (bundle digest coverage).

Generate:

```bash
# From repo root; load backend/.env or export SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
PYTHONPATH=backend backend/.venv/bin/python data_pipeline/scripts/25_competition_metrics_export.py
```

Apply [`backend/supabase/008_optimization_runs_evidence.sql`](../../backend/supabase/008_optimization_runs_evidence.sql) in Supabase before inserts include `student_evidence_bundle_sha256`.
