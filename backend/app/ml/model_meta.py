"""Pinned predictor / artifact identity for API responses and reproducibility."""

from __future__ import annotations

import json
import logging
from functools import lru_cache
from pathlib import Path

from ..config import get_settings

log = logging.getLogger(__name__)

DEFAULT_PREDICTOR_ID = "xgb_hist_v1"


@lru_cache
def _meta_path() -> Path:
    return Path(get_settings().ace_model_dir) / "model_meta.json"


@lru_cache
def load_model_meta() -> dict:
    p = _meta_path()
    if not p.exists():
        return {
            "predictor_id": DEFAULT_PREDICTOR_ID,
            "conformal_note": "model_meta.json missing; using defaults",
        }
    try:
        return json.loads(p.read_text())
    except Exception as e:
        log.warning("model_meta.json unreadable: %s", e)
        return {"predictor_id": DEFAULT_PREDICTOR_ID, "conformal_note": str(e)}


def predictor_id() -> str:
    return str(load_model_meta().get("predictor_id") or DEFAULT_PREDICTOR_ID)
