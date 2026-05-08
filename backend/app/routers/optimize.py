from __future__ import annotations

import hashlib
import json
import logging
import re
import time
from collections import defaultdict
from collections.abc import Iterable, Iterator
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from ..db import get_supabase
from ..ml.conformal import conformal_method_label
from ..ml.model_meta import predictor_id
from ..models.schemas import (
    OptimizeRequest,
    OptimizeResponse,
    PredictRequest,
    ScheduleCandidate,
    SectionPick,
)

log = logging.getLogger(__name__)

router = APIRouter(prefix="/optimize", tags=["ml"])

_SECTION_SELECT = (
    "enroll_code, course_norm, section_label, instructor_norm, days, begin_time, end_time, "
    "max_enroll, enrolled, open_seats, courses(units_fixed)"
)


def _normalize_ucsb_days(raw: str | None) -> str:
    """Map UCSB/GOLD day strings to single-letter MTWRF (Thu -> R)."""
    if not raw:
        return ""
    s = "".join(str(raw).strip().upper().split())
    if not s or s == "TBA":
        return ""
    out: list[str] = []
    i = 0
    while i < len(s):
        if s.startswith("TUE", i):
            out.append("T")
            i += 3
            continue
        if s.startswith("THU", i):
            out.append("R")
            i += 3
            continue
        if s.startswith("MON", i):
            out.append("M")
            i += 3
            continue
        if s.startswith("WED", i):
            out.append("W")
            i += 3
            continue
        if s.startswith("FRI", i):
            out.append("F")
            i += 3
            continue
        if s.startswith("TU", i):
            out.append("T")
            i += 2
            continue
        if s.startswith("TH", i):
            out.append("R")
            i += 2
            continue
        c = s[i]
        if c in "MWF":
            out.append(c)
            i += 1
            continue
        if c == "T":
            out.append("T")
            i += 1
            continue
        if c == "R":
            out.append("R")
            i += 1
            continue
        i += 1
    order = ("M", "T", "W", "R", "F")
    seen: set[str] = set()
    uniq: list[str] = []
    for d in order:
        if d in out and d not in seen:
            seen.add(d)
            uniq.append(d)
    return "".join(uniq)


def _normalize_cn(s: str) -> str:
    return " ".join((s or "").strip().upper().split())


def _course_norm_matches_prefix(canonical: str, requested: str) -> bool:
    """True if DB course_norm is exact match or a letter-suffix variant (e.g. PSTAT 100 vs PSTAT 100A)."""
    cc = _normalize_cn(canonical)
    rc = _normalize_cn(requested)
    if cc == rc:
        return True
    if not cc.startswith(rc):
        return False
    if len(cc) <= len(rc):
        return False
    # Next char after the requested prefix must not be a digit (avoid PSTAT 10 matching PSTAT 100).
    nxt = cc[len(rc)]
    if nxt.isdigit():
        return False
    return True


def _fetch_sections_for_requested_course(sb, quarter_code: str, requested_cn: str) -> list[dict]:
    """Rows for one pool/required code: exact course_norm first, then ilike-prefix + safe filter."""
    rc = _normalize_cn(requested_cn)
    res = (
        sb.table("sections")
        .select(_SECTION_SELECT)
        .eq("quarter_code", quarter_code)
        .eq("course_norm", rc)
        .execute()
    )
    rows = list(res.data or [])
    if rows:
        return rows
    res2 = (
        sb.table("sections")
        .select(_SECTION_SELECT)
        .eq("quarter_code", quarter_code)
        .ilike("course_norm", f"{rc}%")
        .execute()
    )
    cand = list(res2.data or [])
    return [r for r in cand if _course_norm_matches_prefix(r.get("course_norm") or "", rc)]


def _fingerprint(req: OptimizeRequest) -> str:
    payload = req.model_dump(mode="json", exclude={"user_id"})
    raw = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(raw).hexdigest()[:40]


def _fetch_student_evidence(sb, user_id: str) -> tuple[list[str], dict[str, str], bool]:
    """Load canonical completed courses and grades from student_profiles (service role)."""
    try:
        res = (
            sb.table("student_profiles")
            .select("completed_courses,course_grades")
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
    except Exception as e:
        log.warning("student_profiles fetch failed: %s", e)
        return [], {}, False
    rows = res.data or []
    if not rows:
        return [], {}, False
    row = rows[0]
    cc_raw = row.get("completed_courses") or []
    cg_raw = row.get("course_grades") or {}
    if not isinstance(cg_raw, dict):
        cg_raw = {}
    cc = [_normalize_cn(str(c)) for c in cc_raw]
    cg_norm = {_normalize_cn(str(k)): str(v) for k, v in cg_raw.items()}
    return cc, cg_norm, True


def _merge_completed_and_grounding(
    req: OptimizeRequest,
    server_completed: list[str],
    profile_found: bool,
) -> tuple[OptimizeRequest, dict]:
    """Union client + server completed sets for feasibility; record mismatches (G1 metric)."""
    client_set = set(req.completed_courses or [])
    server_set = set(server_completed)
    merged_sorted = sorted(client_set | server_set)
    only_client = sorted(client_set - server_set)
    only_server = sorted(server_set - client_set)
    meta = {
        "profile_found": profile_found,
        "completed_merge_only_in_client": only_client,
        "completed_merge_only_in_server": only_server,
        "completed_merge_symmetric_diff_count": len(only_client) + len(only_server),
    }
    return req.model_copy(update={"completed_courses": merged_sorted}), meta


def _student_bundle_digest(
    merged_completed: list[str],
    course_grades: dict[str, str],
    quarter_code: str,
    model_version: str,
) -> str:
    """Deterministic hash pinning merged evidence + quarter + predictor id for audit (G2)."""
    payload = {
        "completed_courses": merged_completed,
        "course_grades": sorted(course_grades.items()),
        "model_version": model_version,
        "quarter_code": quarter_code,
    }
    raw = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(raw).hexdigest()


def _log_optimization_run(
    *,
    user_id: str | None,
    request_hash: str,
    quarter_code: str,
    model_version: str,
    conformal_method: str,
    summary: dict,
    duration_ms: int,
    student_evidence_bundle_sha256: str | None = None,
) -> None:
    if not user_id:
        return
    try:
        sb = get_supabase()
        row: dict = {
            "user_id": user_id,
            "request_hash": request_hash,
            "quarter_code": quarter_code,
            "model_version": model_version,
            "conformal_method": conformal_method,
            "summary": summary,
            "duration_ms": duration_ms,
        }
        if student_evidence_bundle_sha256:
            row["student_evidence_bundle_sha256"] = student_evidence_bundle_sha256
        sb.table("optimization_runs").insert(row).execute()
    except Exception as e:
        log.warning("optimization_runs insert skipped: %s", e)


def _optimize_pipeline_generator(req: OptimizeRequest) -> Iterator[tuple[str, dict[str, Any]]]:
    """
    Yields (phase_id, meta) for streaming UX; final tuple is ("complete", {"response": OptimizeResponse}).
    """
    try:
        from ..ml.optimizer import SectionCandidate
        from ..ml.optimizer import optimize as run_ip
        from ..ml.predictor import predict_sections
    except ImportError as e:
        raise HTTPException(status_code=503, detail=f"optimizer unavailable: {e}") from e

    req = req.model_copy(
        update={
            "quarter_code": _normalize_cn(req.quarter_code),
            "required_courses": [_normalize_cn(c) for c in (req.required_courses or [])],
            "optional_courses": [_normalize_cn(c) for c in (req.optional_courses or [])],
            "completed_courses": [_normalize_cn(c) for c in (req.completed_courses or [])],
            "excluded_courses": [_normalize_cn(c) for c in (req.excluded_courses or [])],
        }
    )
    yield (
        "normalize",
        {
            "label": "Normalizing request",
            "quarter_code": req.quarter_code,
            "n_pool_courses": len(
                {*(req.required_courses or []), *(req.optional_courses or [])}
            ),
        },
    )

    sb = get_supabase()

    grounding_meta: dict = {"had_user_id": bool(req.user_id)}
    cg_for_digest: dict[str, str] = {}
    if req.user_id:
        srv_cc, cg_for_digest, profile_found = _fetch_student_evidence(sb, req.user_id)
        req, gm = _merge_completed_and_grounding(req, srv_cc, profile_found)
        grounding_meta.update(gm)
        yield (
            "merge_evidence",
            {
                "label": "Merging profile evidence",
                "profile_found": gm.get("profile_found"),
                "symmetric_diff_count": gm.get("completed_merge_symmetric_diff_count"),
            },
        )
    else:
        grounding_meta["profile_found"] = False
        yield ("merge_evidence", {"label": "Skipping profile merge (anonymous)", "skipped": True})

    t0 = time.perf_counter()
    fp = _fingerprint(req)

    course_filter = list({*(req.required_courses or []), *(req.optional_courses or [])})
    if not course_filter:
        out = OptimizeResponse(
            candidates=[],
            model_version=predictor_id(),
            conformal_method=conformal_method_label(),
            optimize_notes=["Add at least one course to the required or elective pool."],
        )
        yield ("complete", {"response": out})
        return

    rows: list[dict] = []
    seen_enroll: set[str] = set()
    for cn in course_filter:
        for r in _fetch_sections_for_requested_course(sb, req.quarter_code, cn):
            ec = r.get("enroll_code")
            if ec and ec not in seen_enroll:
                seen_enroll.add(ec)
                rows.append(r)
    yield (
        "fetch_sections",
        {
            "label": "Loading section offerings",
            "n_section_rows": len(rows),
            "n_unique_enroll_codes": len(seen_enroll),
        },
    )

    instrs = sorted({r.get("instructor_norm") for r in rows if r.get("instructor_norm")})
    prof_by_norm: dict[str, dict] = {}
    if instrs:
        pres = (
            sb.table("professors")
            .select("instructor_norm, rmp_rating, rmp_num_ratings, rmp_difficulty")
            .in_("instructor_norm", instrs)
            .execute()
            .data
            or []
        )
        prof_by_norm = {p["instructor_norm"]: p for p in pres}
    yield (
        "fetch_instructors",
        {
            "label": "Linking instructor signals",
            "n_instructors": len(instrs),
        },
    )

    if not rows:
        out = OptimizeResponse(
            candidates=[],
            model_version=predictor_id(),
            conformal_method=conformal_method_label(),
            optimize_notes=[
                f"No rows in `sections` for these courses for quarter {req.quarter_code}. "
                "Load schedule data for this quarter or verify course_norm strings match Supabase."
            ],
        )
        yield ("complete", {"response": out})
        return

    section_ids = [r["enroll_code"] for r in rows]
    try:
        pred_resp = predict_sections(
            PredictRequest(section_ids=section_ids, quarter_code=req.quarter_code)
        )
        pred_map = {p.enroll_code: p for p in pred_resp.predictions}
    except FileNotFoundError:
        pred_resp = None
        pred_map = {}
    yield (
        "predict",
        {
            "label": "Scoring sections (grade surface)",
            "n_scored": len(pred_map),
            "model_version": pred_resp.model_version if pred_resp else predictor_id(),
        },
    )

    by_course: dict[str, list[SectionCandidate]] = defaultdict(list)
    for cn in course_filter:
        for r in _fetch_sections_for_requested_course(sb, req.quarter_code, cn):
            course_db = _normalize_cn(r.get("course_norm") or cn)
            course_info = r.get("courses") or {}
            inm = r.get("instructor_norm")
            prof = (prof_by_norm.get(inm) or {}) if inm else {}
            p = pred_map.get(r["enroll_code"])
            by_course[cn].append(
                SectionCandidate(
                    enroll_code=r["enroll_code"],
                    course_norm=course_db,
                    section_label=(str(r["section_label"]).strip() if r.get("section_label") else None),
                    instructor_norm=r.get("instructor_norm"),
                    days=_normalize_ucsb_days(r.get("days")),
                    begin_min=_to_min(r.get("begin_time")),
                    end_min=_to_min(r.get("end_time")),
                    units=float(course_info.get("units_fixed") or r.get("units") or 4.0),
                    predicted_gpa=(p.predicted_gpa if p else None),
                    rmp_rating=prof.get("rmp_rating"),
                    fill_rate=r.get("fill_rate"),
                    capacity=r.get("max_enroll"),
                    predicted_gpa_std=(p.predicted_gpa_std if p else None),
                    regime=(p.regime if p else None),
                    gpa_lo=(p.gpa_lo if p else None),
                    gpa_hi=(p.gpa_hi if p else None),
                    interval_half_width=(p.interval_half_width if p else None),
                )
            )

    out = run_ip(req, by_course, pred_resp)
    yield (
        "optimize_milp",
        {
            "label": "Synthesizing feasible schedules",
            "n_candidates": len(out.candidates),
            "model_version": out.model_version,
        },
    )

    out = _enrich_schedule_candidates(sb, out, prof_by_norm)
    yield ("enrich", {"label": "Joining historical grade surfaces"})

    elapsed_ms = int((time.perf_counter() - t0) * 1000)
    best = out.candidates[0].score if out.candidates else None

    bundle_sha: str | None = None
    if req.user_id:
        bundle_sha = _student_bundle_digest(
            sorted(set(req.completed_courses or [])),
            cg_for_digest,
            req.quarter_code,
            out.model_version or predictor_id(),
        )

    summary = {
        "n_candidates": len(out.candidates),
        "best_score": best,
        "risk_lambda": req.preferences.risk_lambda,
        "n_section_rows": len(rows),
        "grounding": grounding_meta,
    }

    _log_optimization_run(
        user_id=req.user_id,
        request_hash=fp,
        quarter_code=req.quarter_code,
        model_version=out.model_version,
        conformal_method=out.conformal_method,
        summary=summary,
        duration_ms=elapsed_ms,
        student_evidence_bundle_sha256=bundle_sha,
    )
    yield (
        "audit_log",
        {
            "label": "Recording run envelope",
            "duration_ms": elapsed_ms,
            "request_hash_prefix": fp[:12],
        },
    )

    yield ("complete", {"response": out})


def _run_optimize_sync(req: OptimizeRequest) -> OptimizeResponse:
    """Non-streaming path: run generator and return final response."""
    out: OptimizeResponse | None = None
    for phase, meta in _optimize_pipeline_generator(req):
        if phase == "complete":
            out = meta["response"]
    assert out is not None
    return out


def _sse_format(obj: dict[str, Any]) -> str:
    return f"data: {json.dumps(obj, default=str)}\n\n"


@router.post("", response_model=OptimizeResponse)
async def optimize(req: OptimizeRequest) -> OptimizeResponse:
    return _run_optimize_sync(req)


@router.post("/stream")
async def optimize_stream(req: OptimizeRequest) -> StreamingResponse:
    """Server-Sent Events: each `data:` line is JSON with `phase`, optional `label`, then `complete` with full result."""

    def event_iter() -> Iterator[str]:
        try:
            for phase, meta in _optimize_pipeline_generator(req):
                if phase == "complete":
                    resp: OptimizeResponse = meta["response"]
                    payload = {
                        "phase": "complete",
                        "result": json.loads(resp.model_dump_json()),
                    }
                    yield _sse_format(payload)
                else:
                    evt = {"phase": phase, **meta}
                    yield _sse_format(evt)
        except HTTPException as e:
            err = {"phase": "error", "detail": e.detail, "status_code": e.status_code}
            yield _sse_format(err)

    return StreamingResponse(
        event_iter(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


def _weighted_grade(rows: Iterable[dict]) -> tuple[float | None, int]:
    num = 0.0
    den = 0
    for r in rows:
        ag = r.get("avg_gpa")
        n = r.get("n_letter") or 0
        if ag is None or n <= 0:
            continue
        num += float(ag) * int(n)
        den += int(n)
    return (num / den if den else None, den)


def _course_grade_aggregates(sb, course_norms: list[str]) -> dict[str, tuple[float | None, int]]:
    if not course_norms:
        return {}
    res = (
        sb.table("grade_distributions")
        .select("course_norm,avg_gpa,n_letter")
        .in_("course_norm", course_norms)
        .execute()
    )
    by_course: dict[str, list[dict]] = defaultdict(list)
    for r in res.data or []:
        by_course[r["course_norm"]].append(r)
    out: dict[str, tuple[float | None, int]] = {}
    for cn, rows in by_course.items():
        avg, n = _weighted_grade(rows)
        out[cn] = (avg, n)
    return out


def _pair_grade_aggregates(
    sb,
    pairs: set[tuple[str, str]],
) -> dict[tuple[str, str], tuple[float | None, int]]:
    if not pairs:
        return {}
    courses = list({p[0] for p in pairs})
    res = (
        sb.table("grade_distributions")
        .select("course_norm,instructor_norm,avg_gpa,n_letter")
        .in_("course_norm", courses)
        .execute()
    )
    by_pair: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for r in res.data or []:
        key = (r["course_norm"], r["instructor_norm"])
        if key in pairs:
            by_pair[key].append(r)
    return {k: _weighted_grade(rows) for k, rows in by_pair.items()}


def _enrich_schedule_candidates(
    sb,
    resp: OptimizeResponse,
    prof_by_norm: dict[str, dict],
) -> OptimizeResponse:
    """Attach historical Nexus aggregates + full RMP fields for the results UI."""
    if not resp.candidates:
        return resp

    pairs: set[tuple[str, str]] = set()
    courses: set[str] = set()
    for cand in resp.candidates:
        for sec in cand.sections:
            courses.add(sec.course_norm)
            if sec.instructor_norm:
                pairs.add((sec.course_norm, sec.instructor_norm))

    c_agg = _course_grade_aggregates(sb, list(courses))
    p_agg = _pair_grade_aggregates(sb, pairs)

    new_cands: list[ScheduleCandidate] = []
    for cand in resp.candidates:
        new_secs: list[SectionPick] = []
        for sec in cand.sections:
            ca, cn = c_agg.get(sec.course_norm, (None, 0))
            pa, pn = (None, 0)
            if sec.instructor_norm:
                pa, pn = p_agg.get((sec.course_norm, sec.instructor_norm), (None, 0))
            prof = prof_by_norm.get(sec.instructor_norm or "") or {}
            new_secs.append(
                sec.model_copy(
                    update={
                        "course_hist_avg_gpa": ca,
                        "course_hist_n_letter": cn or None,
                        "pair_hist_avg_gpa": pa,
                        "pair_hist_n_letter": pn or None,
                        "rmp_num_ratings": prof.get("rmp_num_ratings"),
                        "rmp_difficulty": prof.get("rmp_difficulty"),
                    }
                )
            )
        new_cands.append(cand.model_copy(update={"sections": new_secs}))
    return OptimizeResponse(
        candidates=new_cands,
        model_version=resp.model_version,
        conformal_method=resp.conformal_method,
    )


def _to_min(s: str | None) -> int | None:
    if not s:
        return None
    t = str(s).strip()
    if not t or t.upper() == "TBA":
        return None
    iso = re.search(r"T(\d{1,2}):(\d{2})(?::\d{2})?", t, re.I)
    if iso:
        h, m = int(iso.group(1)), int(iso.group(2))
        return h * 60 + m
    ampm = re.match(r"^(\d{1,2}):(\d{2})\s*([AP])\.?M\.?$", t, re.I)
    if ampm:
        h, m, ap = int(ampm.group(1)), int(ampm.group(2)), ampm.group(3).upper()
        if ap == "P" and h < 12:
            h += 12
        if ap == "A" and h == 12:
            h = 0
        return h * 60 + m
    try:
        parts = t.split(":")
        h, m = int(parts[0]), int(parts[1][:2]) if len(parts) > 1 else 0
        return h * 60 + m
    except Exception:
        return None
