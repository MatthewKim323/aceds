#!/usr/bin/env python3
"""
Compute course embeddings locally with sentence-transformers.

Used by the Course Explorer for "similar courses" search and by the schedule
optimizer as a weak similarity signal ("don't stack three courses covering
near-identical content").

Why local: embeddings are a tiebreaker signal, not the core model. ~1,300
unique catalog courses × a 384-dim MiniLM encoder is ~30 s on CPU. Trading
a one-time ~80 MB model download for zero external API dependencies and a
reproducible pipeline is the right call.

Model default: `sentence-transformers/all-MiniLM-L6-v2` — 384-dim, fast,
solid baseline. Pass `--model BAAI/bge-small-en-v1.5` for a measurable
retrieval-quality bump at the same dim (still CPU-friendly).

Inputs:
    raw/ucsb_catalog_<q>.csv

Output:
    processed/course_embeddings.parquet     columns: course_norm, title, embedding (list[float])
    processed/course_embeddings_meta.json   model, n, dim, normalized=True
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
PROC = ROOT / "data_pipeline" / "processed"
RAW = ROOT / "data_pipeline" / "raw"

DEFAULT_MODEL = "sentence-transformers/all-MiniLM-L6-v2"
BATCH = 64


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--quarter", default="20262")
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument(
        "--device",
        default="cpu",
        choices=["cpu", "mps", "cuda"],
        help="cpu is fine for ~1300 rows; mps/cuda if you have it",
    )
    args = ap.parse_args()

    try:
        from sentence_transformers import SentenceTransformer
    except ImportError:
        print("pip install sentence-transformers", file=sys.stderr)
        sys.exit(1)

    catalog_path = RAW / f"ucsb_catalog_{args.quarter}.csv"
    if not catalog_path.exists():
        print(f"missing {catalog_path} — run 02_fetch_ucsb_catalog.py first", file=sys.stderr)
        sys.exit(1)

    catalog = pd.read_csv(catalog_path)
    # One row per course_norm (many catalog rows are per-section of the same course).
    catalog = catalog.dropna(subset=["courseId"]).drop_duplicates("courseId")

    rows = []
    for _, r in catalog.iterrows():
        title = (str(r.get("title") or "")).strip()
        desc = (str(r.get("description") or "")).strip()
        # The model sees title + description as one string. Most catalog
        # descriptions are a paragraph; short titles act as a topic anchor.
        text = f"{title}. {desc}".strip(". ").strip()
        if not text:
            continue
        rows.append({"course_norm": str(r["courseId"]).strip(), "title": title, "text": text})

    if not rows:
        print("no rows to embed", file=sys.stderr)
        sys.exit(1)

    print(f"loading {args.model} on {args.device}…")
    model = SentenceTransformer(args.model, device=args.device)

    texts = [r["text"] for r in rows]
    # normalize_embeddings=True → cosine similarity == dot product at query time.
    vectors = model.encode(
        texts,
        batch_size=BATCH,
        show_progress_bar=True,
        convert_to_numpy=True,
        normalize_embeddings=True,
    )

    dim = int(vectors.shape[1])

    out = pd.DataFrame(
        [
            {
                "course_norm": r["course_norm"],
                "title": r["title"],
                "embedding": vec.tolist(),
            }
            for r, vec in zip(rows, vectors, strict=True)
        ]
    )

    PROC.mkdir(parents=True, exist_ok=True)
    out_path = PROC / "course_embeddings.parquet"
    meta_path = PROC / "course_embeddings_meta.json"

    out.to_parquet(out_path, index=False)
    meta_path.write_text(
        json.dumps(
            {
                "model": args.model,
                "provider": "sentence-transformers (local)",
                "n": len(out),
                "dim": dim,
                "normalized": True,
                "quarter": args.quarter,
            },
            indent=2,
        )
    )
    print(f"wrote {len(out)} embeddings ({dim}d) to {out_path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
