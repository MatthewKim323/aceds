#!/usr/bin/env python3
"""
Generate frontend/src/data/majors.ts from reviewed JSON requirement sheets.

Also emits frontend/src/data/majors.json as the runtime source of truth so
the TS file stays diff-friendly.

Usage:
    python scripts/08_majors_json_to_ts.py
    python scripts/08_majors_json_to_ts.py --include-unreviewed
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PIPELINE = ROOT / "data_pipeline"
SRC = PIPELINE / "processed" / "majors"
TS_OUT = ROOT / "frontend" / "src" / "data" / "majors.ts"
JSON_OUT = ROOT / "frontend" / "src" / "data" / "majors.json"

HEADER = """// ============================================================================
// AUTO-GENERATED. Do not edit by hand.
// Regenerate: `python data_pipeline/scripts/08_majors_json_to_ts.py`
// Source of truth lives in data_pipeline/processed/majors/*.json.
// ============================================================================

import majorsJson from './majors.json';

export type Course = {
  id: string;
  title?: string;
  alt?: string[];
  units?: number | null;
  note?: string;
};

export type PickRule = {
  n_courses?: number | null;
  n_units?: number | null;
  mode: 'choose_n_courses' | 'choose_n_units' | 'all';
};

export type Group = {
  id: string;
  label: string;
  note?: string;
  pick?: PickRule | null;
  upper_division_required?: boolean;
  min_grade?: string;
  courses: Course[];
  subgroups?: Group[];
};

export type MajorDefinition = {
  id: string;
  name: string;
  kind: 'major' | 'minor';
  degree?: string | null;
  catalog_year: string;
  department?: string;
  college?: string;
  pre_major_gpa?: number | null;
  total_units_required?: number | null;
  upper_div_units_required?: number | null;
  source_pdf?: string;
  reviewed?: boolean;
  notes?: string;
  groups: Group[];
};

const ALL = majorsJson as MajorDefinition[];

export const majors: MajorDefinition[] = ALL.filter((m) => m.kind === 'major');
export const minors: MajorDefinition[] = ALL.filter((m) => m.kind === 'minor');

export const majorById = (id: string): MajorDefinition | undefined =>
  ALL.find((m) => m.id === id);

export const majorOptions = majors.map((m) => ({
  value: m.id,
  label: `${m.name}${m.degree ? ' (' + m.degree + ')' : ''}`,
  department: m.department,
  college: m.college,
}));

export const minorOptions = minors.map((m) => ({
  value: m.id,
  label: m.name,
  department: m.department,
}));
"""


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--include-unreviewed", action="store_true")
    args = ap.parse_args()

    items = []
    for p in sorted(SRC.glob("*.json")):
        data = json.loads(p.read_text())
        if not data.get("reviewed") and not args.include_unreviewed:
            continue
        items.append(data)

    JSON_OUT.parent.mkdir(parents=True, exist_ok=True)
    JSON_OUT.write_text(json.dumps(items, indent=2))
    TS_OUT.write_text(HEADER)

    kinds = {}
    for m in items:
        kinds[m.get("kind", "?")] = kinds.get(m.get("kind", "?"), 0) + 1
    print(f"wrote {JSON_OUT}  ({len(items)} items: {kinds})")
    print(f"wrote {TS_OUT}")


if __name__ == "__main__":
    main()
