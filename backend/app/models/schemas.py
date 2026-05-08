from __future__ import annotations

from pydantic import BaseModel, Field

# ---------- predict --------------------------------------------------------


class PredictRequest(BaseModel):
    section_ids: list[str] = Field(..., description="List of enroll_codes to predict for")
    quarter_code: str = Field(..., description="e.g. 20262")


class Prediction(BaseModel):
    enroll_code: str
    course_norm: str
    predicted_gpa: float
    predicted_gpa_std: float
    regime: str = Field(
        description="warm | cold_instr | cold_course | cold_pair | cold_both (cold-start bucket)"
    )
    gpa_lo: float = Field(description="Lower end of symmetric uncertainty interval (clipped to [0,4])")
    gpa_hi: float = Field(description="Upper end of symmetric uncertainty interval (clipped to [0,4])")
    interval_half_width: float = Field(
        ge=0.0,
        description="(gpa_hi - gpa_lo) / 2; used by risk-aware optimizer objective",
    )


class PredictResponse(BaseModel):
    predictions: list[Prediction]
    model_version: str = Field(description="Pinned predictor id from model_meta.json")
    conformal_method: str = Field(
        default="gaussian_fallback",
        description="split_abs_residual_val | gaussian_fallback — see conformal_quantiles.json",
    )


# ---------- optimize -------------------------------------------------------


class OptimizePreferences(BaseModel):
    weight_grades: float = 0.25
    weight_professor: float = 0.25
    weight_convenience: float = 0.25
    weight_availability: float = 0.25
    target_units_min: int = 12
    target_units_max: int = 17
    earliest_start: str = "09:00"
    latest_end: str = "20:00"
    preferred_days: list[str] = Field(default_factory=lambda: ["M", "T", "W", "R", "F"])
    avoid_friday_afternoon: bool = False
    diversity_lambda: float = 0.15
    risk_lambda: float = Field(
        default=0.0,
        ge=0.0,
        le=2.0,
        description="Risk aversion in grade term: effective_gpa = pred - risk_lambda * interval_half_width before 0..4 normalization",
    )
    elective_subject_bonus: float = Field(
        default=0.0,
        ge=0.0,
        le=0.5,
        description="Additive objective bump for optional courses whose course_norm starts with a preferred prefix",
    )
    preferred_elective_prefixes: list[str] = Field(
        default_factory=list,
        description="Uppercase course_norm prefixes (e.g. PSTAT, CMPSC) — bonus applies only to optional pool",
    )


class OptimizeRequest(BaseModel):
    quarter_code: str
    major_id: str
    user_id: str | None = Field(
        default=None,
        description="Optional auth user id for append-only optimization_runs logging (RLS-scoped reads on client)",
    )
    required_courses: list[str] = Field(
        description="course_norm codes that MUST appear in the schedule"
    )
    optional_courses: list[str] = Field(
        default_factory=list,
        description="course_norm codes eligible as electives",
    )
    excluded_courses: list[str] = Field(default_factory=list)
    completed_courses: list[str] = Field(default_factory=list)
    preferences: OptimizePreferences = OptimizePreferences()
    top_k: int = Field(default=3, ge=1, le=5)


class SectionPick(BaseModel):
    enroll_code: str
    course_norm: str
    section_label: str | None = None
    instructor_norm: str | None
    days: str | None
    begin_time: str | None
    end_time: str | None
    predicted_gpa: float | None
    predicted_gpa_std: float | None = None
    regime: str | None = None
    gpa_lo: float | None = None
    gpa_hi: float | None = None
    interval_half_width: float | None = None
    rmp_rating: float | None
    rmp_num_ratings: int | None = None
    rmp_difficulty: float | None = None
    # Nexus aggregates (all offerings of course; same instructor+course when known)
    course_hist_avg_gpa: float | None = None
    course_hist_n_letter: int | None = None
    pair_hist_avg_gpa: float | None = None
    pair_hist_n_letter: int | None = None
    reason: dict[str, float] = Field(default_factory=dict)


class ScheduleCandidate(BaseModel):
    score: float
    total_units: float
    sections: list[SectionPick]
    explanation: dict = Field(default_factory=dict)


class OptimizeResponse(BaseModel):
    candidates: list[ScheduleCandidate]
    model_version: str = Field(default="unknown")
    conformal_method: str = Field(default="unknown")
    optimize_notes: list[str] = Field(
        default_factory=list,
        description="Human hints when candidates are empty (units window, missing sections, etc.)",
    )
