#!/usr/bin/env python3
"""
Export G1/G2 competition summaries from optimization_runs for plotting.

G1 — grounding consistency: fraction of runs with completed_merge_symmetric_diff_count > 0.
G2 — auditability: fraction of runs with student_evidence_bundle_sha256 present.

Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (same as backend .env).

Outputs:
  data_pipeline/processed/competition/g1_g2_summary.csv
  data_pipeline/processed/competition/optimization_runs_recent.csv (last N rows)

Run: PYTHONPATH=backend backend/.venv/bin/python data_pipeline/scripts/25_competition_metrics_export.py
"""
from __future__ import annotations

import csv
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PROC_COMP = ROOT / "data_pipeline" / "processed" / "competition"
PROC_COMP.mkdir(parents=True, exist_ok=True)

try:
    from dotenv import load_dotenv

    load_dotenv(ROOT / "backend" / ".env")
    load_dotenv(ROOT / ".env")
except ImportError:
    pass

RECENT_N = 500


def main() -> int:
    sys.path.insert(0, str(ROOT / "backend"))
    url = os.getenv("SUPABASE_URL") or ""
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or ""
    if not url or not key:
        write_placeholder()
        print(
            "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — wrote placeholder CSVs.",
            file=sys.stderr,
        )
        return 0

    from supabase import create_client

    sb = create_client(url, key)
    res = (
        sb.table("optimization_runs")
        .select("*")
        .order("created_at", desc=True)
        .limit(RECENT_N)
        .execute()
    )
    rows = res.data or []

    recent_path = PROC_COMP / "optimization_runs_recent.csv"
    if rows:
        keys = sorted({k for r in rows for k in r.keys()})
        with recent_path.open("w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=keys, extrasaction="ignore")
            w.writeheader()
            for r in rows:
                flat = {k: json.dumps(v) if isinstance(v, (dict, list)) else v for k, v in r.items()}
                w.writerow(flat)
    else:
        recent_path.write_text("")

    with_digest = sum(1 for r in rows if r.get("student_evidence_bundle_sha256"))
    mismatches = 0
    for r in rows:
        summary = r.get("summary") or {}
        if isinstance(summary, str):
            try:
                summary = json.loads(summary)
            except json.JSONDecodeError:
                summary = {}
        g = summary.get("grounding") or {}
        try:
            if int(g.get("completed_merge_symmetric_diff_count") or 0) > 0:
                mismatches += 1
        except (TypeError, ValueError):
            pass

    n = len(rows)
    summary_path = PROC_COMP / "g1_g2_summary.csv"
    with summary_path.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["metric", "value", "notes"])
        w.writerow(["runs_in_sample", n, f"last_{RECENT_N}_desc"])
        w.writerow(
            [
                "g2_pct_with_bundle_digest",
                f"{(with_digest / n * 100):.2f}" if n else "",
                "runs where student_evidence_bundle_sha256 IS populated",
            ]
        )
        w.writerow(
            [
                "g1_pct_with_client_server_diff",
                f"{(mismatches / n * 100):.2f}" if n else "",
                "runs where grounding.completed_merge_symmetric_diff_count > 0",
            ]
        )

    print(f"Wrote {summary_path} and {recent_path}")
    return 0


def write_placeholder() -> None:
    summary_path = PROC_COMP / "g1_g2_summary.csv"
    with summary_path.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["metric", "value", "notes"])
        w.writerow(["runs_in_sample", "", "set SUPABASE_* and re-run"])
        w.writerow(["g2_pct_with_bundle_digest", "", ""])
        w.writerow(["g1_pct_with_client_server_diff", "", ""])
    readme = PROC_COMP / "README.md"
    readme.write_text(
        "## Competition metric exports\n\n"
        "After deploying optimization runs with `student_evidence_bundle_sha256`, "
        "run `25_competition_metrics_export.py` with backend credentials.\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    raise SystemExit(main())
