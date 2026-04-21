#!/usr/bin/env python3
"""
Interactive review of Claude-extracted major/minor JSONs.

For each JSON in processed/majors/, prints a human-readable summary and asks
whether to approve. Approved JSONs get `reviewed: true`.

Usage:
    python scripts/06_review_majors.py                 # review unreviewed
    python scripts/06_review_majors.py --reset         # un-approve all
    python scripts/06_review_majors.py --id <major_id> # jump straight to one
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

PIPELINE = Path(__file__).resolve().parents[1]
MAJORS = PIPELINE / "processed" / "majors"


def _summarize(data: dict) -> str:
    lines: list[str] = []
    lines.append(f"  name:    {data.get('name')}")
    lines.append(f"  id:      {data.get('id')}")
    lines.append(f"  kind:    {data.get('kind')}  degree={data.get('degree')}")
    lines.append(f"  dept:    {data.get('department')}  college={data.get('college')}")
    lines.append(f"  catalog: {data.get('catalog_year')}")
    lines.append(f"  units:   total={data.get('total_units_required')} upper={data.get('upper_div_units_required')} pre_gpa={data.get('pre_major_gpa')}")
    lines.append(f"  groups:  {len(data.get('groups', []))}")
    for g in data.get("groups", []):
        pick = g.get("pick") or {}
        pick_str = ""
        if pick:
            pick_str = f" [pick {pick.get('n_courses') or pick.get('n_units')} {pick.get('mode')}]"
        courses = [c.get("id") for c in g.get("courses", [])]
        shown = ", ".join(courses[:8])
        extra = f" +{len(courses)-8}" if len(courses) > 8 else ""
        lines.append(f"    - {g.get('label')}{pick_str} ({len(courses)} courses): {shown}{extra}")
    return "\n".join(lines)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--reset", action="store_true", help="Un-approve everything")
    ap.add_argument("--id", type=str, default=None, help="Review a single major by id")
    args = ap.parse_args()

    if not MAJORS.exists():
        print(f"no JSONs found at {MAJORS}. Run 05_extract_majors_claude.py first.")
        sys.exit(1)

    if args.reset:
        for p in MAJORS.glob("*.json"):
            data = json.loads(p.read_text())
            data["reviewed"] = False
            p.write_text(json.dumps(data, indent=2))
        print("reset all reviewed flags")
        return

    files = sorted(MAJORS.glob("*.json"))
    if args.id:
        files = [p for p in files if p.stem == args.id]
        if not files:
            print(f"no file matches id={args.id}")
            sys.exit(1)

    for p in files:
        data = json.loads(p.read_text())
        if data.get("reviewed") and not args.id:
            continue
        print("\n" + "=" * 80)
        print(f"FILE: {p.name}  (source={data.get('source_pdf')})")
        print(_summarize(data))
        print("=" * 80)
        while True:
            choice = input("[a]pprove  [s]kip  [e]dit-note  [q]uit: ").strip().lower()
            if choice == "a":
                data["reviewed"] = True
                p.write_text(json.dumps(data, indent=2))
                print("  -> approved")
                break
            if choice == "s":
                print("  -> skipped")
                break
            if choice == "e":
                note = input("  review note: ").strip()
                data["review_notes"] = note
                p.write_text(json.dumps(data, indent=2))
                continue
            if choice == "q":
                print("bye")
                return
            print("unknown option")


if __name__ == "__main__":
    main()
