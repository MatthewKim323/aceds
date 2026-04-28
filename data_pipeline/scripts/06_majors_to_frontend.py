#!/usr/bin/env python3
"""
Generate frontend/src/data/majors.ts from data_pipeline/processed/majors/*.json.

Why a generator instead of runtime fetch:
- The catalog is small (~40 majors) and ships with the app.
- Keeps the frontend a static build, no backend round-trip for "what majors exist".
- Hand-curated entries (see CURATED below) win over Claude extractions on id/name
  conflict — the extraction is a source-of-truth fallback, not an override.

Transform notes:
- Claude's group shape allows nested `subgroups`. The UI is flat, so we walk the
  tree and emit "Parent — Child" labels for subgroups. Good enough for v1; nested
  accordions later if we need them.
- `courses[].alt` is a list in the schema but the frontend expects a single string,
  so we join with " or ".
- `pick` is `{"mode":"choose_n_courses","n_courses":N}` or similar; we collapse it
  to a plain integer when the mode is a simple "pick N" and drop it otherwise.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PROCESSED = ROOT / "data_pipeline" / "processed" / "majors"
OUT_FILE = ROOT / "frontend" / "src" / "data" / "majors.ts"

# Hand-curated majors that win by (case-insensitive) name match. These were
# painstakingly massaged for the demo flow — we don't want to regress them when
# a wider Claude extraction lands.
CURATED: list[dict] = [
    {
        "id": "stats_ds_bs",
        "name": "Statistics and Data Science",
        "degree": "B.S.",
        "year": "2025–2026",
        "department": "Statistics and Applied Probability",
        "college": "College of Letters and Science",
        "preMajorGpa": 2.5,
        "groups": [
            {"label": "Pre-Major",
             "note": "All courses must be completed with a C or better. 2.5 GPA required.",
             "courses": [
                 {"id": "MATH 2A", "alt": "MATH 3A"},
                 {"id": "MATH 2B", "alt": "MATH 3B"},
                 {"id": "MATH 4A"},
                 {"id": "MATH 4B"},
                 {"id": "MATH 6A"},
                 {"id": "MATH 8", "alt": "PSTAT 8"},
                 {"id": "PSTAT 10"},
             ]},
            {"label": "Preparation for the Major",
             "courses": [
                 {"id": "CMPSC 8", "alt": "CMPSC W8"},
                 {"id": "CMPSC 9", "alt": "CMPSC 16"},
             ]},
            {"label": "A — Core Probability & Statistics",
             "courses": [
                 {"id": "PSTAT 120A", "alt": "PSTAT W120A"},
                 {"id": "PSTAT 120B"},
             ]},
            {"label": "B — Required Methods",
             "courses": [{"id": "PSTAT 122"}, {"id": "PSTAT 126"}]},
            {"label": "C — PSTAT Electives (pick 6)", "pick": 6,
             "note": "24 units from elective PSTAT courses.",
             "courses": [
                 {"id": "PSTAT 100"}, {"id": "PSTAT 105"}, {"id": "PSTAT 115"},
                 {"id": "PSTAT 120C"}, {"id": "PSTAT 123"}, {"id": "PSTAT 127"},
                 {"id": "PSTAT 130"}, {"id": "PSTAT 131"}, {"id": "PSTAT 132"},
                 {"id": "PSTAT 134"}, {"id": "PSTAT 135"},
                 {"id": "PSTAT 160A", "alt": "PSTAT W160A"}, {"id": "PSTAT 160B"},
                 {"id": "PSTAT 170"}, {"id": "PSTAT 171"},
                 {"id": "PSTAT 172A"}, {"id": "PSTAT 172B"}, {"id": "PSTAT 173"},
                 {"id": "PSTAT 174", "alt": "PSTAT W174"}, {"id": "PSTAT 175"},
                 {"id": "PSTAT 176"}, {"id": "PSTAT 183"},
                 {"id": "PSTAT 197A"}, {"id": "PSTAT 197B"}, {"id": "PSTAT 197C"},
             ]},
            {"label": "D — Additional UD Electives (pick 2)", "pick": 2,
             "note": "8 units from other PSTAT or approved Math/Econ courses.",
             "courses": [
                 {"id": "MATH 104A"}, {"id": "MATH 104B"}, {"id": "MATH 104C"},
                 {"id": "MATH 108A"}, {"id": "MATH 108B"},
                 {"id": "MATH 111A"}, {"id": "MATH 111B"}, {"id": "MATH 111C"},
                 {"id": "MATH 117"},
                 {"id": "MATH 118A"}, {"id": "MATH 118B"}, {"id": "MATH 118C"},
                 {"id": "MATH 132A"}, {"id": "MATH 132B"},
                 {"id": "ECON 100B"}, {"id": "ECON 101"},
                 {"id": "ECON 134A"}, {"id": "ECON 134B"},
             ]},
        ],
    },
    {
        "id": "econ_ba",
        "name": "Economics",
        "degree": "B.A.",
        "year": "2025–2026",
        "department": "Economics",
        "college": "College of Letters and Science",
        "preMajorGpa": 2.85,
        "groups": [
            {"label": "Pre-Major",
             "note": "ECON 1, 2, and 10A with 2.85+ GPA. No grade below C.",
             "courses": [{"id": "ECON 1"}, {"id": "ECON 2"}, {"id": "ECON 10A"}]},
            {"label": "Preparation for the Major",
             "note": "ECON 5 and 10A must be taken at UCSB.",
             "courses": [
                 {"id": "ECON 5", "alt": "PSTAT 120A"},
                 {"id": "MATH 2A", "alt": "MATH 3A"},
                 {"id": "MATH 2B", "alt": "MATH 3B"},
             ]},
            {"label": "A — Required Core", "courses": [{"id": "ECON 100B"}]},
            {"label": "B — Required Core", "courses": [{"id": "ECON 101"}]},
            {"label": "C — Required Core", "courses": [{"id": "ECON 140A"}]},
            {"label": "D — UD Electives (pick 6)", "pick": 6,
             "note": "24 units from upper-division Economics electives.",
             "courses": [{"id": c} for c in [
                 "ECON 100C", "ECON 106", "ECON 107A", "ECON 107B",
                 "ECON 112A", "ECON 112B", "ECON 113A", "ECON 113B",
                 "ECON 114A", "ECON 114B", "ECON 115",
                 "ECON 116A", "ECON 116B", "ECON 116C",
                 "ECON 117A", "ECON 120", "ECON 122", "ECON 127",
                 "ECON 130", "ECON 133",
                 "ECON 134A", "ECON 134B", "ECON 134C",
                 "ECON 135", "ECON 140B", "ECON 140C", "ECON 141",
                 "ECON 145", "ECON 150A", "ECON 151", "ECON 152",
                 "ECON 153", "ECON 154", "ECON 155", "ECON 156",
                 "ECON 157", "ECON 160", "ECON 164",
                 "ECON 170", "ECON 171", "ECON 174",
                 "ECON 176", "ECON 177",
                 "ECON 180", "ECON 181", "ECON 183", "ECON 184",
                 "ECON 187", "ECON 196A", "ECON 196B", "ECON 199",
             ]]},
            {"label": "E — Additional UD Elective (pick 1)", "pick": 1,
             "note": "From Area D or: ECON 118, 136A-C, 137A-B, 138A-B, 185.",
             "courses": [{"id": c} for c in [
                 "ECON 118", "ECON 136A", "ECON 136B", "ECON 136C",
                 "ECON 137A", "ECON 137B", "ECON 138A", "ECON 138B", "ECON 185",
             ]]},
        ],
    },
]


def _pick_to_int(pick: dict | None) -> int | None:
    if not isinstance(pick, dict):
        return None
    mode = pick.get("mode")
    # Only the simple "pick N courses" mode maps cleanly to the flat UI.
    if mode in ("choose_n_courses", "choose_n", None):
        n = pick.get("n_courses") or pick.get("n")
        if isinstance(n, int) and n > 0:
            return n
    return None


def _course_to_ui(c: dict) -> dict | None:
    cid = (c.get("id") or "").strip()
    if not cid:
        return None
    out: dict = {"id": cid}
    alt = c.get("alt")
    if isinstance(alt, list) and alt:
        out["alt"] = " or ".join(str(a).strip() for a in alt if a)
    elif isinstance(alt, str) and alt.strip():
        out["alt"] = alt.strip()
    return out


def _walk_groups(groups: list[dict], parent_label: str = "") -> list[dict]:
    """Flatten Claude's (group→subgroups) tree into the UI's flat groups."""
    out: list[dict] = []
    for g in groups or []:
        label = (g.get("label") or "").strip() or "Group"
        full_label = f"{parent_label} — {label}" if parent_label else label
        ui_group: dict = {"label": full_label}
        if note := (g.get("note") or "").strip():
            ui_group["note"] = note
        if (pick := _pick_to_int(g.get("pick"))) is not None:
            ui_group["pick"] = pick
        courses = [
            c for c in (_course_to_ui(raw) for raw in g.get("courses") or [])
            if c is not None
        ]
        ui_group["courses"] = courses
        # Only emit the parent group if it has courses of its own; otherwise
        # flatten its subgroups up one level (avoids empty "Heading" cards).
        if courses:
            out.append(ui_group)
        out.extend(_walk_groups(g.get("subgroups") or [], full_label))
    return out


def _claude_to_ui(doc: dict) -> dict | None:
    name = (doc.get("name") or "").strip()
    doc_id = (doc.get("id") or "").strip()
    if not name or not doc_id:
        return None

    degree = (doc.get("degree") or "").strip()
    year = (doc.get("catalog_year") or "2025–2026").strip() or "2025–2026"
    # Normalize to en-dash the way the UI already uses it.
    year = year.replace("--", "–").replace("-", "–") if len(year) <= 9 else year

    pre_gpa = doc.get("pre_major_gpa")
    if not isinstance(pre_gpa, (int, float)):
        pre_gpa = 0.0

    groups = _walk_groups(doc.get("groups") or [])
    if not groups:
        return None

    return {
        "id": doc_id,
        "name": name,
        "degree": degree or "B.A.",
        "year": year,
        "department": (doc.get("department") or "").strip(),
        "college": (doc.get("college") or "").strip(),
        "preMajorGpa": float(pre_gpa),
        "groups": groups,
    }


# --- TS emission --------------------------------------------------------------

_TS_HEADER = """// AUTO-GENERATED by data_pipeline/scripts/06_majors_to_frontend.py
// Do not edit by hand — edit the Claude extractions in processed/majors/ or the
// CURATED list in the generator script, then re-run it.
//
// Generated from {n_claude} Claude extractions + {n_curated} hand-curated entries.

export interface CourseOption {{
  id: string
  alt?: string
}}

export interface CourseGroup {{
  label: string
  courses: CourseOption[]
  pick?: number
  note?: string
}}

export interface Major {{
  id: string
  name: string
  degree: string
  year: string
  department: string
  college: string
  preMajorGpa: number
  groups: CourseGroup[]
}}

"""

_TS_FOOTER = """

export function getMajorById(id: string) {
  return majors.find((m) => m.id === id)
}

export function searchMajors(q: string): Major[] {
  const needle = q.trim().toLowerCase()
  if (!needle) return majors
  return majors.filter((m) =>
    m.name.toLowerCase().includes(needle) ||
    m.department.toLowerCase().includes(needle) ||
    m.id.toLowerCase().includes(needle)
  )
}
"""


def _ts_str(s: str) -> str:
    return "'" + s.replace("\\", "\\\\").replace("'", "\\'") + "'"


def _emit_course(c: dict) -> str:
    parts = [f"id: {_ts_str(c['id'])}"]
    if "alt" in c:
        parts.append(f"alt: {_ts_str(c['alt'])}")
    return "{ " + ", ".join(parts) + " }"


def _emit_group(g: dict) -> str:
    lines = ["    {"]
    lines.append(f"      label: {_ts_str(g['label'])},")
    if "pick" in g:
        lines.append(f"      pick: {g['pick']},")
    if "note" in g:
        lines.append(f"      note: {_ts_str(g['note'])},")
    lines.append("      courses: [")
    for c in g["courses"]:
        lines.append(f"        {_emit_course(c)},")
    lines.append("      ],")
    lines.append("    }")
    return "\n".join(lines)


def _emit_major(m: dict) -> str:
    lines = ["  {"]
    lines.append(f"    id: {_ts_str(m['id'])},")
    lines.append(f"    name: {_ts_str(m['name'])},")
    lines.append(f"    degree: {_ts_str(m['degree'])},")
    lines.append(f"    year: {_ts_str(m['year'])},")
    lines.append(f"    department: {_ts_str(m['department'])},")
    lines.append(f"    college: {_ts_str(m['college'])},")
    lines.append(f"    preMajorGpa: {m['preMajorGpa']},")
    lines.append("    groups: [")
    for g in m["groups"]:
        lines.append(_emit_group(g) + ",")
    lines.append("    ],")
    lines.append("  }")
    return "\n".join(lines)


def main() -> int:
    if not PROCESSED.exists():
        print(f"missing {PROCESSED}; run 05_extract_majors_claude.py first", file=sys.stderr)
        return 1

    curated_names = {m["name"].lower() for m in CURATED}
    curated_ids = {m["id"] for m in CURATED}

    claude_majors: list[dict] = []
    skipped: list[str] = []
    for f in sorted(PROCESSED.glob("*.json")):
        try:
            raw = json.loads(f.read_text())
        except Exception as e:
            print(f"  skip {f.name} (unreadable): {e}", file=sys.stderr)
            continue

        ui = _claude_to_ui(raw)
        if ui is None:
            skipped.append(f"{f.name} (empty after transform)")
            continue
        if ui["name"].lower() in curated_names or ui["id"] in curated_ids:
            skipped.append(f"{f.name} (curated override)")
            continue
        claude_majors.append(ui)

    # Curated first (so the demo flow lands on them), then Claude alphabetical.
    claude_majors.sort(key=lambda m: m["name"].lower())
    all_majors = CURATED + claude_majors

    lines = [_TS_HEADER.format(n_claude=len(claude_majors), n_curated=len(CURATED))]
    lines.append(f"export const majors: Major[] = [")
    for m in all_majors:
        lines.append(_emit_major(m) + ",")
    lines.append("]\n")
    lines.append(_TS_FOOTER)

    OUT_FILE.write_text("\n".join(lines).rstrip() + "\n")
    print(f"wrote {OUT_FILE.relative_to(ROOT)}")
    print(f"  curated: {len(CURATED)}, claude: {len(claude_majors)}, total: {len(all_majors)}")
    for s in skipped:
        print(f"  skip: {s}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
