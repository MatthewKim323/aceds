#!/usr/bin/env python3
"""
Compute course embeddings via OpenAI `text-embedding-3-small`.

Used by the Course Explorer for "similar courses" search and by the schedule
optimizer as a weak similarity signal ("don't stack three courses covering
near-identical content").

We only embed catalog-joined courses (the ones actually available in the target
quarter) to keep the API bill tiny. Dedup by course_norm.

Inputs:
    OPENAI_API_KEY  (env)
    raw/ucsb_catalog_<q>.csv

Output:
    processed/course_embeddings.parquet     columns: course_norm, title, embedding (list[float])
    processed/course_embeddings_meta.json   model, n, dim
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
PROC = ROOT / "data_pipeline" / "processed"
RAW = ROOT / "data_pipeline" / "raw"

MODEL = "text-embedding-3-small"
BATCH = 100


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--quarter", default="20262")
    args = ap.parse_args()

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        print("OPENAI_API_KEY missing", file=sys.stderr)
        sys.exit(1)

    try:
        from openai import OpenAI
    except ImportError:
        print("pip install openai", file=sys.stderr)
        sys.exit(1)

    client = OpenAI(api_key=api_key)

    catalog = pd.read_csv(RAW / f"ucsb_catalog_{args.quarter}.csv")
    catalog = catalog.dropna(subset=["courseId"]).drop_duplicates("courseId")
    texts = []
    for _, r in catalog.iterrows():
        title = (r.get("title") or "").strip()
        desc = (r.get("description") or "").strip()
        texts.append({"course_norm": r["courseId"].strip(), "title": title, "text": f"{title}. {desc}".strip(". ")})

    embeddings = []
    for i in range(0, len(texts), BATCH):
        chunk = texts[i : i + BATCH]
        resp = client.embeddings.create(
            model=MODEL,
            input=[c["text"] for c in chunk],
        )
        for j, item in enumerate(resp.data):
            embeddings.append(item.embedding)
        print(f"[{i + len(chunk)}/{len(texts)}]")
        time.sleep(0.5)  # gentle rate limit

    out = pd.DataFrame(
        [
            {"course_norm": t["course_norm"], "title": t["title"], "embedding": e}
            for t, e in zip(texts, embeddings)
        ]
    )
    out.to_parquet(PROC / "course_embeddings.parquet")
    (PROC / "course_embeddings_meta.json").write_text(
        json.dumps({"model": MODEL, "n": len(out), "dim": len(embeddings[0])}, indent=2)
    )
    print(f"wrote {len(out)} embeddings to course_embeddings.parquet")


if __name__ == "__main__":
    main()
