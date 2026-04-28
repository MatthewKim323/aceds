#!/usr/bin/env python3
"""
Verify Supabase has ACE tables populated (run after 002/003 SQL + 07_load_to_supabase.py).

Usage (from repo root):
  source data_pipeline/.venv/bin/activate
  set -a && source .env && set +a
  python scripts/verify_supabase_data.py

Exit 0 if core tables have row counts > 0; exit 1 otherwise.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    try:
        from dotenv import load_dotenv
        from supabase import create_client
    except ImportError:
        print("pip install python-dotenv supabase", file=sys.stderr)
        return 1

    load_dotenv(ROOT / ".env")
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env", file=sys.stderr)
        return 1

    sb = create_client(url, key)
    required = ("courses", "professors", "grade_distributions", "sections")
    optional = ("major_requirements", "minor_requirements", "data_refresh_log")
    failed = False
    for t in required + optional:
        try:
            res = sb.table(t).select("*", count="exact", head=True).execute()
            n = res.count or 0
            ok = n > 0 if t in required else n >= 0
            status = "OK" if (n > 0 or t not in required) else "EMPTY"
            if t in required and n <= 0:
                failed = True
                status = "FAIL"
            print(f"  {t}: {n} rows ({status})")
        except Exception as e:
            print(f"  {t}: ERROR {e}", file=sys.stderr)
            failed = True

    if failed:
        print(
            "\nFix: apply backend/supabase/002_data_tables.sql and 003_demo_mode.sql in the "
            "SQL editor, then run:\n"
            "  python data_pipeline/scripts/07_load_to_supabase.py --quarter 20262",
            file=sys.stderr,
        )
        return 1
    print("Supabase data OK.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
