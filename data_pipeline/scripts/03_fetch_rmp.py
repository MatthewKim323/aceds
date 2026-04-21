"""Scrape RateMyProfessor for every unique instructor in the Nexus grade data.

Goes direct to RMP's GraphQL endpoint instead of the stale pip package.
Results are cached to rmp_cache.json so re-runs never re-scrape.

The hard part is name matching. Nexus stores instructors like "DEAN C W"
(LASTNAME FIRSTINITIAL MIDDLEINITIAL). We query RMP with just the last name
(+ school filter) and pick the top match by ratings count. If the first-initial
matches too, we take it confidently; otherwise mark as low-confidence.
"""
from __future__ import annotations

import argparse
import json
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import pandas as pd
import requests
from tqdm import tqdm

ROOT = Path(__file__).parent.parent
NEXUS_CSV = ROOT / "raw" / "nexus_grades.csv"
CACHE_PATH = ROOT / "raw" / "rmp_cache.json"
OUT_CSV = ROOT / "raw" / "rmp_ratings.csv"

UCSB_SCHOOL_LEGACY_ID = 1077  # UC Santa Barbara on RMP

GRAPHQL_URL = "https://www.ratemyprofessors.com/graphql"
# "test:test" base64-encoded; this auth header is hardcoded in RMP's public website code.
HEADERS = {
    "Authorization": "Basic dGVzdDp0ZXN0",
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    "Referer": "https://www.ratemyprofessors.com/",
    "Origin": "https://www.ratemyprofessors.com",
}

# RMP uses globally-unique base64 "relay" IDs for schools in the new search.
# "School-1077" b64-encoded is what they expect.
import base64

SCHOOL_RELAY_ID = base64.b64encode(f"School-{UCSB_SCHOOL_LEGACY_ID}".encode()).decode()

SEARCH_QUERY = """
query NewSearchTeachersQuery($text: String!, $schoolID: ID!) {
  newSearch {
    teachers(query: {text: $text, schoolID: $schoolID}) {
      edges {
        node {
          id
          legacyId
          firstName
          lastName
          department
          avgRating
          avgDifficulty
          numRatings
          wouldTakeAgainPercent
        }
      }
    }
  }
}
""".strip()


def parse_nexus_name(raw: str) -> tuple[str, str]:
    """'DEAN C W' -> (last='DEAN', first_initial='C')."""
    parts = raw.strip().split()
    last = parts[0] if parts else ""
    first_initial = parts[1][0] if len(parts) >= 2 and parts[1] else ""
    return last.upper(), first_initial.upper()


def search_rmp(last: str) -> list[dict]:
    payload = {
        "query": SEARCH_QUERY,
        "variables": {"text": last, "schoolID": SCHOOL_RELAY_ID},
    }
    r = requests.post(GRAPHQL_URL, headers=HEADERS, json=payload, timeout=20)
    r.raise_for_status()
    data = r.json()
    edges = (
        data.get("data", {})
        .get("newSearch", {})
        .get("teachers", {})
        .get("edges", [])
    ) or []
    return [e["node"] for e in edges if e.get("node")]


def pick_best(matches: list[dict], first_initial: str) -> tuple[dict | None, str]:
    """Pick best candidate and return (node, confidence).

    Confidence:
        'exact_initial' — first initial matched, highest num_ratings among those
        'top_by_ratings' — first-initial mismatch, took most-rated last-name hit
        'only_candidate' — one last-name match but initial unknown
        'none' — nothing matched
    """
    if not matches:
        return None, "none"
    if first_initial:
        initial_matches = [m for m in matches if (m.get("firstName") or "").upper().startswith(first_initial)]
        if initial_matches:
            best = max(initial_matches, key=lambda m: m.get("numRatings") or 0)
            return best, "exact_initial"
    if len(matches) == 1:
        return matches[0], "only_candidate"
    best = max(matches, key=lambda m: m.get("numRatings") or 0)
    return best, "top_by_ratings"


def scrape_one(raw_nexus_name: str) -> dict:
    last, first_initial = parse_nexus_name(raw_nexus_name)
    if not last:
        return {"query_last": "", "match": False, "reason": "empty_name"}
    try:
        candidates = search_rmp(last)
    except Exception as e:
        return {"query_last": last, "error": str(e)}
    node, conf = pick_best(candidates, first_initial)
    if node is None:
        return {
            "query_last": last,
            "query_initial": first_initial,
            "match": False,
            "confidence": conf,
            "n_candidates": len(candidates),
        }
    return {
        "query_last": last,
        "query_initial": first_initial,
        "match": True,
        "confidence": conf,
        "n_candidates": len(candidates),
        "id": node.get("legacyId"),
        "first_name": node.get("firstName"),
        "last_name": node.get("lastName"),
        "department": node.get("department"),
        "rating": node.get("avgRating"),
        "difficulty": node.get("avgDifficulty"),
        "num_ratings": node.get("numRatings"),
        "would_take_again": node.get("wouldTakeAgainPercent"),
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--workers", type=int, default=6)
    args = ap.parse_args()

    if not NEXUS_CSV.exists():
        print(f"ERROR: run 01_fetch_nexus_grades.py first", file=sys.stderr); return 1

    nexus = pd.read_csv(NEXUS_CSV)
    instructors = sorted(
        x for x in nexus["instructor"].dropna().unique()
        if isinstance(x, str) and any(c.isalpha() for c in x)
    )
    print(f"Unique instructors in Nexus data: {len(instructors):,}")

    cache = json.loads(CACHE_PATH.read_text()) if CACHE_PATH.exists() else {}
    print(f"Already cached:                   {len(cache):,}")

    todo = [i for i in instructors if i not in cache]
    if args.limit:
        todo = todo[: args.limit]
    print(f"To scrape this run:               {len(todo):,} ({args.workers} workers)")

    lock = threading.Lock()
    flush_every = 50

    def work(name):
        return name, scrape_one(name)

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = [pool.submit(work, n) for n in todo]
        for i, f in enumerate(tqdm(as_completed(futures), total=len(futures), desc="RMP")):
            name, result = f.result()
            with lock:
                cache[name] = result
                if i % flush_every == 0:
                    CACHE_PATH.write_text(json.dumps(cache, indent=2))
    CACHE_PATH.write_text(json.dumps(cache, indent=2))

    rows = [{"instructor_nexus": k, **v} for k, v in cache.items()]
    df = pd.DataFrame(rows)
    df.to_csv(OUT_CSV, index=False)

    total = len(df)
    matched = int(df.get("match", pd.Series(dtype=bool)).fillna(False).sum())
    print(f"\nSaved -> {OUT_CSV}")
    print(f"Total instructors: {total:,}")
    print(f"Matched on RMP:    {matched:,} ({matched/total:.1%})" if total else "")
    if "confidence" in df.columns:
        print("By confidence:")
        print(df["confidence"].value_counts().to_string())
    if "rating" in df.columns:
        r = df["rating"].dropna()
        if len(r):
            print(f"Rating (matched):  mean={r.mean():.2f}  n={len(r)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
