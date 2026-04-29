"""Split-style absolute-residual quantiles for GPA prediction intervals (per regime)."""

from __future__ import annotations

import json
import logging
from functools import lru_cache
from pathlib import Path

from ..config import get_settings

log = logging.getLogger(__name__)

# Fallback: ~90% two-sided Gaussian scaling on regime RMSE (conservative if no JSON).
_GAUSS_90 = 1.645


@lru_cache
def _quantiles_path() -> Path:
    return Path(get_settings().ace_model_dir) / "conformal_quantiles.json"


@lru_cache
def load_conformal_config() -> dict | None:
    p = _quantiles_path()
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text())
    except Exception as e:
        log.warning("conformal_quantiles.json unreadable: %s", e)
        return None


def conformal_method_label() -> str:
    """Label for API: whether val-split JSON quantiles are loaded."""
    return "split_abs_residual_val" if load_conformal_config() else "gaussian_fallback"


def half_width_abs(regime: str, regime_rmse: float) -> float:
    """
    Half-width of a symmetric interval around the point prediction.

    If ``conformal_quantiles.json`` exists (from ``scripts/21_conformal_calibration.py``),
    uses the val-split (1-alpha) quantile of |y - y_hat| per regime.
    Otherwise falls back to Gaussian _GAUSS_90 * RMSE (documented in MODEL_CARD).
    """
    cfg = load_conformal_config()
    if cfg and isinstance(cfg.get("quantile_abs_by_regime"), dict):
        qmap = cfg["quantile_abs_by_regime"]
        q = qmap.get(regime) or qmap.get("warm")
        if isinstance(q, (int, float)) and q > 0:
            return float(q)
    return _GAUSS_90 * float(regime_rmse)
