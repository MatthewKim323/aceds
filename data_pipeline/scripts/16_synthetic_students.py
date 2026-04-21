#!/usr/bin/env python3
"""
Generate a plausible synthetic-student population for the demo.

The goal is NOT to simulate real UCSB students. It's to give the optimizer and
demo pages realistic diversity so a reviewer can click through 10 fake students
and see 10 visibly-different recommended schedules.

Each synthetic student has:
    id                   uuid
    name                 fake name (first+last)
    major_id             one of the reviewed majors (sampled weighted by UCSB enrollment)
    catalog_year         2023 / 2024 / 2025 / 2026
    year_standing        freshman | sophomore | junior | senior
    gpa                  sampled from ~N(3.25, 0.55) truncated [2.0, 4.0]
    preference_weights   {grades, professor, convenience, availability} summing to 1.0
    completed_courses    drawn from the major's requirements, partially completed
                         per year_standing
    working_hours_week   0 | 5..30
    avoid_friday_afternoon  bool

Output:
    processed/synthetic_students.json
"""
from __future__ import annotations

import argparse
import json
import random
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PROC = ROOT / "data_pipeline" / "processed"
MAJORS_DIR = PROC / "majors"

FIRST_NAMES = [
    "Emma", "Liam", "Aarav", "Priya", "Xiaolin", "Diego", "Chloe", "Noah",
    "Aisha", "Mateo", "Sofia", "Yuki", "Ethan", "Maya", "Dmitri", "Zoe",
    "Kwame", "Ananya", "Hiroshi", "Carmen", "Jordan", "Ife", "Lucia", "Kaito",
]
LAST_NAMES = [
    "Rivera", "Nguyen", "Patel", "Kim", "O'Brien", "Santos", "Chen", "Garcia",
    "Okafor", "Martinez", "Singh", "Tanaka", "Dubois", "Cohen", "Reyes", "Abebe",
    "Watanabe", "Johansson", "Hernandez", "Li", "Ali", "Tran", "Jackson",
]

YEAR_FRACTION = {
    "freshman": 0.1,
    "sophomore": 0.3,
    "junior": 0.6,
    "senior": 0.9,
}

DEFAULT_MAJOR_WEIGHTS = {
    "computer-science": 18,
    "psychological-brain-sciences": 12,
    "economics": 10,
    "biology": 10,
    "communication": 8,
    "mechanical-engineering": 6,
    "sociology": 5,
    "mathematics": 4,
    "political-science": 5,
    "art": 3,
    "music": 2,
}


def _truncnorm(mu: float, sigma: float, lo: float, hi: float, rng: random.Random) -> float:
    for _ in range(20):
        x = rng.gauss(mu, sigma)
        if lo <= x <= hi:
            return x
    return max(lo, min(hi, mu))


def _preference_weights(rng: random.Random) -> dict[str, float]:
    raw = [rng.random() + 0.1 for _ in range(4)]
    total = sum(raw)
    keys = ["grades", "professor", "convenience", "availability"]
    return {k: round(v / total, 3) for k, v in zip(keys, raw)}


def _completed_courses_for(major_struct: dict, fraction_done: float, rng: random.Random) -> list[str]:
    courses: list[str] = []
    for grp in major_struct.get("groups", []):
        for c in grp.get("courses", []):
            code = c.get("code") or c.get("id")
            if code:
                courses.append(code)
        for sub in grp.get("subgroups", []) or []:
            for c in sub.get("courses", []) or []:
                code = c.get("code") or c.get("id")
                if code:
                    courses.append(code)
    take = int(len(courses) * fraction_done)
    return rng.sample(courses, min(take, len(courses)))


def _load_majors() -> list[dict]:
    if not MAJORS_DIR.exists():
        return []
    out = []
    for p in sorted(MAJORS_DIR.glob("*.json")):
        try:
            out.append(json.loads(p.read_text()))
        except Exception:
            continue
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=50)
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    rng = random.Random(args.seed)
    majors = _load_majors()
    major_ids = [m["id"] for m in majors] or list(DEFAULT_MAJOR_WEIGHTS.keys())
    weights = [DEFAULT_MAJOR_WEIGHTS.get(mid, 2) for mid in major_ids]
    majors_by_id = {m["id"]: m for m in majors}

    students = []
    for _ in range(args.n):
        major_id = rng.choices(major_ids, weights=weights, k=1)[0]
        major = majors_by_id.get(major_id, {"groups": []})
        year = rng.choices(
            list(YEAR_FRACTION.keys()),
            weights=[1, 2, 3, 2],
            k=1,
        )[0]
        gpa = round(_truncnorm(3.25, 0.55, 2.0, 4.0, rng), 2)
        student = {
            "id": str(uuid.uuid4()),
            "name": f"{rng.choice(FIRST_NAMES)} {rng.choice(LAST_NAMES)}",
            "major_id": major_id,
            "catalog_year": rng.choice([2023, 2024, 2025, 2026]),
            "year_standing": year,
            "gpa": gpa,
            "preference_weights": _preference_weights(rng),
            "completed_courses": _completed_courses_for(major, YEAR_FRACTION[year], rng),
            "working_hours_week": rng.choices(
                [0, 5, 10, 15, 20, 25, 30], weights=[5, 2, 3, 3, 2, 1, 1], k=1
            )[0],
            "avoid_friday_afternoon": rng.random() < 0.35,
            "target_units_min": rng.choice([12, 12, 13, 15]),
            "target_units_max": rng.choice([16, 17, 17, 18, 20]),
        }
        students.append(student)

    out = PROC / "synthetic_students.json"
    out.write_text(json.dumps(students, indent=2))
    print(f"wrote {len(students)} synthetic students to {out}")


if __name__ == "__main__":
    main()
