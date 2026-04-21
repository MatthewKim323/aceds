#!/usr/bin/env python3
"""
Extract structured major/minor requirements from PDF sheets via Claude.

Input:  data/major_sheets/*.pdf, data/minor_sheets/*.pdf
Output: data_pipeline/processed/majors/<id>.json (one per PDF)

Caches the raw Claude response per PDF so re-runs are free.

Usage:
    python scripts/05_extract_majors_claude.py                 # process all new
    python scripts/05_extract_majors_claude.py --force         # re-extract
    python scripts/05_extract_majors_claude.py --only foo.pdf  # one file
    python scripts/05_extract_majors_claude.py --kind minor    # only minors
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import re
import sys
import time
from dataclasses import dataclass
from pathlib import Path

from anthropic import Anthropic
from dotenv import load_dotenv
from jsonschema import Draft202012Validator
from tqdm import tqdm

ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "data"
PIPELINE = ROOT / "data_pipeline"
OUT_DIR = PIPELINE / "processed" / "majors"
CACHE_DIR = PIPELINE / "processed" / "majors_cache"
SCHEMA_PATH = PIPELINE / "schemas" / "major.schema.json"

MODEL = "claude-3-5-sonnet-20241022"
MAX_TOKENS = 4096


SYSTEM_PROMPT = """You are a meticulous data extraction assistant for UCSB's course planning tool (ACE). Your job is to convert an official UCSB major or minor requirement PDF into a strict JSON document matching the provided schema.

CRITICAL RULES:
1. Output ONLY a single JSON object. No markdown, no prose, no preamble.
2. Be lossless about course codes. Always use the format "DEPT NUM" (uppercase dept, preserve number incl. letters/suffixes, single space between).
   - Good: "CMPSC 130A", "MATH 4A", "WRIT 2E"
   - Bad: "CS 130a", "CMPSC130A", "Math 4A"
3. Group structure mirrors the sheet's visible headings. One group per heading. If the sheet says "Choose 2 of the following", set group.pick = {"mode": "choose_n_courses", "n_courses": 2}.
4. Use "alt" for explicit substitutions (e.g. "MATH 3A or MATH 2A" -> {id: "MATH 3A", alt: ["MATH 2A"]}).
5. Put free-form qualifications in "note" fields, never invent requirements.
6. `kind` is "major" or "minor". `degree` applies to majors only (B.A. or B.S.).
7. If a field is not stated on the sheet, set it to null. Do NOT guess GPA thresholds, unit totals, or catalog years.
"""


USER_PROMPT_TMPL = """Schema you MUST output against:

```json
{schema}
```

Filename: {filename}
Kind hint: {kind}

Extract the major/minor from the attached PDF into the schema. The `id` should be a lowercase snake_case slug based on the major/minor name and degree (e.g. "statistics_and_data_science_bs", "art_history_minor"). Respond with ONLY the JSON object."""


@dataclass
class ExtractionResult:
    doc_id: str
    source_pdf: str
    data: dict
    validated: bool


def _load_client() -> Anthropic:
    load_dotenv(ROOT / ".env")
    load_dotenv(PIPELINE / ".env")
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        print("ANTHROPIC_API_KEY missing. Put it in .env at repo root.", file=sys.stderr)
        sys.exit(1)
    return Anthropic(api_key=key)


def _hash_pdf(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()[:16]


def _cache_path(p: Path, kind: str) -> Path:
    return CACHE_DIR / kind / f"{p.stem}__{_hash_pdf(p)}.json"


def _extract_json(text: str) -> dict:
    """Pull the first JSON object from the response (Claude sometimes wraps)."""
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\n?", "", text)
        text = re.sub(r"\n?```\s*$", "", text)
    # find the first { ... } span that parses
    depth = 0
    start = None
    for i, ch in enumerate(text):
        if ch == "{":
            if depth == 0:
                start = i
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0 and start is not None:
                chunk = text[start : i + 1]
                try:
                    return json.loads(chunk)
                except json.JSONDecodeError:
                    continue
    raise ValueError(f"could not parse JSON from Claude response: {text[:200]}")


def extract_one(
    client: Anthropic,
    pdf: Path,
    kind: str,
    schema: dict,
    validator: Draft202012Validator,
    *,
    force: bool,
) -> ExtractionResult:
    cache = _cache_path(pdf, kind)
    cache.parent.mkdir(parents=True, exist_ok=True)
    if cache.exists() and not force:
        raw = json.loads(cache.read_text())
    else:
        pdf_b64 = base64.standard_b64encode(pdf.read_bytes()).decode()
        for attempt in range(3):
            try:
                resp = client.messages.create(
                    model=MODEL,
                    max_tokens=MAX_TOKENS,
                    system=SYSTEM_PROMPT,
                    messages=[
                        {
                            "role": "user",
                            "content": [
                                {
                                    "type": "document",
                                    "source": {
                                        "type": "base64",
                                        "media_type": "application/pdf",
                                        "data": pdf_b64,
                                    },
                                },
                                {
                                    "type": "text",
                                    "text": USER_PROMPT_TMPL.format(
                                        schema=json.dumps(schema),
                                        filename=pdf.name,
                                        kind=kind,
                                    ),
                                },
                            ],
                        }
                    ],
                )
                text = "".join(
                    block.text for block in resp.content if getattr(block, "type", None) == "text"
                )
                raw = {
                    "response_text": text,
                    "model": MODEL,
                    "usage": {
                        "input_tokens": resp.usage.input_tokens,
                        "output_tokens": resp.usage.output_tokens,
                    },
                }
                cache.write_text(json.dumps(raw, indent=2))
                break
            except Exception as e:  # pragma: no cover -- network flake path
                wait = 2**attempt
                print(f"  attempt {attempt+1} failed ({e}); retrying in {wait}s", file=sys.stderr)
                time.sleep(wait)
        else:
            raise RuntimeError(f"failed to extract {pdf.name} after 3 attempts")

    data = _extract_json(raw["response_text"])
    # enforce provenance + defaults
    data.setdefault("kind", kind)
    data["source_pdf"] = pdf.name
    data.setdefault("reviewed", False)
    if "id" not in data or not data["id"]:
        data["id"] = re.sub(r"[^a-z0-9]+", "_", pdf.stem.lower()).strip("_")

    errors = list(validator.iter_errors(data))
    validated = not errors
    if errors:
        print(f"  schema errors in {pdf.name}:", file=sys.stderr)
        for err in errors[:5]:
            print(f"    - {err.message} at {'/'.join(str(p) for p in err.absolute_path)}", file=sys.stderr)

    return ExtractionResult(doc_id=data["id"], source_pdf=pdf.name, data=data, validated=validated)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--only", type=str, default=None, help="Substring match on PDF filename")
    ap.add_argument("--kind", choices=("major", "minor", "both"), default="both")
    args = ap.parse_args()

    schema = json.loads(SCHEMA_PATH.read_text())
    validator = Draft202012Validator(schema)

    pdf_kinds: list[tuple[Path, str]] = []
    if args.kind in ("major", "both"):
        pdf_kinds += [(p, "major") for p in sorted((DATA_DIR / "major_sheets").glob("*.pdf"))]
    if args.kind in ("minor", "both"):
        pdf_kinds += [(p, "minor") for p in sorted((DATA_DIR / "minor_sheets").glob("*.pdf"))]

    if args.only:
        pdf_kinds = [(p, k) for (p, k) in pdf_kinds if args.only.lower() in p.name.lower()]

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    client = _load_client()

    n_ok, n_invalid = 0, 0
    for pdf, kind in tqdm(pdf_kinds, desc="extracting"):
        try:
            result = extract_one(client, pdf, kind, schema, validator, force=args.force)
            out_path = OUT_DIR / f"{result.doc_id}.json"
            out_path.write_text(json.dumps(result.data, indent=2))
            if result.validated:
                n_ok += 1
            else:
                n_invalid += 1
        except Exception as e:
            print(f"FAILED {pdf.name}: {e}", file=sys.stderr)
            n_invalid += 1

    print(f"\ndone. valid={n_ok} invalid_or_failed={n_invalid} total={len(pdf_kinds)}")


if __name__ == "__main__":
    main()
