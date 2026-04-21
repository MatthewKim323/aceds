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
    regime: str = Field(description="warm | cold_instr | cold_course | cold_both")


class PredictResponse(BaseModel):
    predictions: list[Prediction]


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


class OptimizeRequest(BaseModel):
    quarter_code: str
    major_id: str
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
    instructor_norm: str | None
    days: str | None
    begin_time: str | None
    end_time: str | None
    predicted_gpa: float | None
    rmp_rating: float | None
    reason: dict[str, float] = Field(default_factory=dict)


class ScheduleCandidate(BaseModel):
    score: float
    total_units: float
    sections: list[SectionPick]
    explanation: dict = Field(default_factory=dict)


class OptimizeResponse(BaseModel):
    candidates: list[ScheduleCandidate]
