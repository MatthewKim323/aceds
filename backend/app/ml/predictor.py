from __future__ import annotations

import json
import logging
from functools import lru_cache
from pathlib import Path

import numpy as np
import pandas as pd
import xgboost as xgb

from ..config import get_settings
from ..db import get_supabase
from ..models.schemas import PredictRequest, PredictResponse, Prediction

log = logging.getLogger(__name__)


@lru_cache
def _load_artifacts() -> tuple[xgb.Booster, list[str], list[str]]:
    settings = get_settings()
    model_path = Path(settings.ace_model_dir) / "xgb_model.json"
    cols_path = Path(settings.ace_model_dir) / "xgb_feature_cols.json"
    if not model_path.exists():
        raise FileNotFoundError(
            f"XGBoost artifact missing at {model_path}. "
            f"Run data_pipeline/scripts/13_xgboost.py and copy the output into ACE_MODEL_DIR."
        )
    booster = xgb.Booster()
    booster.load_model(str(model_path))
    meta = json.loads(cols_path.read_text())
    return booster, meta["feature_cols"], meta["categorical_cols"]


def _build_feature_rows(section_ids: list[str], quarter_code: str) -> pd.DataFrame:
    """
    Pull enough joined data from Supabase to score the requested sections.
    We need:
        - sections (current quarter): course_norm, instructor_norm, section metadata
        - courses:                   units, level, ge
        - professors:                rmp_* fields, confidence
        - grade_distributions:       last 50 rows per (instructor, course) combo
                                     (server-side historical aggregates)
    """
    sb = get_supabase()
    sections = (
        sb.table("sections")
        .select("*, courses(units_fixed, ge_raw, level), professors(*)")
        .in_("enroll_code", section_ids)
        .eq("quarter_code", quarter_code)
        .execute()
        .data
        or []
    )
    if not sections:
        return pd.DataFrame()

    course_norms = sorted({s["course_norm"] for s in sections})
    instructor_norms = sorted({s["instructor_norm"] for s in sections if s["instructor_norm"]})
    history = (
        sb.table("grade_distributions")
        .select("course_norm,instructor_norm,quarter,year,n_letter,avg_gpa")
        .in_("course_norm", course_norms)
        .execute()
        .data
        or []
    )
    hist_df = pd.DataFrame(history)

    def _agg(df: pd.DataFrame, keys: list[str]) -> pd.DataFrame:
        if df.empty:
            return pd.DataFrame(columns=keys + ["mean", "std", "n"])
        g = df.groupby(keys)
        return g.agg(
            mean=("avg_gpa", "mean"),
            std=("avg_gpa", "std"),
            n=("avg_gpa", "count"),
        ).reset_index()

    instr_agg = _agg(hist_df, ["instructor_norm"])
    course_agg = _agg(hist_df, ["course_norm"])
    ic_agg = _agg(hist_df, ["instructor_norm", "course_norm"])
    dept_agg = _agg(
        hist_df.assign(dept=hist_df["course_norm"].str.split(" ").str[0]) if not hist_df.empty else hist_df,
        ["dept"],
    )

    rows = []
    for s in sections:
        course = s.get("courses") or {}
        prof = s.get("professors") or {}
        course_norm = s["course_norm"]
        instr = s.get("instructor_norm") or ""
        dept = course_norm.split(" ", 1)[0]

        def _lookup(df: pd.DataFrame, filt: dict) -> dict:
            if df.empty:
                return {"mean": np.nan, "std": np.nan, "n": 0}
            mask = np.ones(len(df), dtype=bool)
            for k, v in filt.items():
                mask &= df[k].values == v
            matches = df[mask]
            if matches.empty:
                return {"mean": np.nan, "std": np.nan, "n": 0}
            return matches.iloc[0].to_dict()

        i_hist = _lookup(instr_agg, {"instructor_norm": instr})
        c_hist = _lookup(course_agg, {"course_norm": course_norm})
        ic_hist = _lookup(ic_agg, {"instructor_norm": instr, "course_norm": course_norm})
        d_hist = _lookup(dept_agg, {"dept": dept})

        rows.append(
            {
                "enroll_code": s["enroll_code"],
                "course_norm": course_norm,
                "year": int(quarter_code[:4]),
                "quarter": {1: "Winter", 2: "Spring", 3: "Summer", 4: "Fall"}.get(
                    int(quarter_code[-1]), "Fall"
                ),
                "dept": dept,
                "course_level": course.get("level") or "lower",
                "unitsFixed": course.get("units_fixed"),
                "is_ge": bool(course.get("ge_raw")),
                "instr_hist_mean_gpa": i_hist.get("mean"),
                "instr_hist_gpa_std": i_hist.get("std"),
                "instr_hist_n_sections": i_hist.get("n", 0),
                "course_hist_mean_gpa": c_hist.get("mean"),
                "course_hist_gpa_std": c_hist.get("std"),
                "course_hist_n_sections": c_hist.get("n", 0),
                "ic_hist_mean_gpa": ic_hist.get("mean"),
                "ic_hist_n_sections": ic_hist.get("n", 0),
                "dept_hist_mean_gpa": d_hist.get("mean"),
                "dept_hist_gpa_std": d_hist.get("std"),
                "instr_is_cold": (i_hist.get("n", 0) or 0) == 0,
                "course_is_cold": (c_hist.get("n", 0) or 0) == 0,
                "ic_is_cold": (ic_hist.get("n", 0) or 0) == 0,
                "years_since_instr_first_taught": None,
                "rmp_rating": prof.get("rmp_rating"),
                "rmp_difficulty": prof.get("rmp_difficulty"),
                "rmp_num_ratings": prof.get("rmp_num_ratings"),
                "rmp_would_take_again": prof.get("rmp_would_take_again"),
                "rmp_confidence": prof.get("rmp_confidence") or "none",
                "rmp_match": bool(prof.get("rmp_rating") is not None),
                "instructor_norm": instr,
            }
        )
    return pd.DataFrame(rows)


def _regime(row: pd.Series) -> str:
    if row["ic_is_cold"] and row["instr_is_cold"]:
        return "cold_both"
    if row["ic_is_cold"] and not row["instr_is_cold"]:
        return "cold_pair"
    if row["instr_is_cold"]:
        return "cold_instr"
    if row["course_is_cold"]:
        return "cold_course"
    return "warm"


def predict_sections(req: PredictRequest) -> PredictResponse:
    booster, feature_cols, categorical_cols = _load_artifacts()
    df = _build_feature_rows(req.section_ids, req.quarter_code)
    if df.empty:
        return PredictResponse(predictions=[])

    X = df.reindex(columns=feature_cols).copy()
    for c in categorical_cols:
        if c in X.columns:
            X[c] = X[c].astype("category")
    for c in X.columns:
        if c not in categorical_cols:
            X[c] = pd.to_numeric(X[c], errors="coerce")

    preds = booster.predict(xgb.DMatrix(X, enable_categorical=True))

    out = []
    for i, row in df.iterrows():
        # predicted std = model residual RMSE on warm regime as a crude proxy;
        # replaced with proper quantile models later.
        base_std = 0.23
        penalty = 0.05 if row["instr_is_cold"] else 0.0
        out.append(
            Prediction(
                enroll_code=row["enroll_code"],
                course_norm=row["course_norm"],
                predicted_gpa=float(preds[i]),
                predicted_gpa_std=base_std + penalty,
                regime=_regime(row),
            )
        )
    return PredictResponse(predictions=out)
