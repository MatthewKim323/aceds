/**
 * Typed client for the FastAPI backend.
 *
 * Endpoints are lazy-wrapped so pages can optimistically render with stubbed
 * data when the backend is unavailable (useful for the demo on localhost and
 * when only Supabase is up).
 */

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? 'http://localhost:8000'

export type Course = {
  course_norm: string
  dept: string
  course_id: string
  title: string | null
  description: string | null
  units_fixed: number | null
  ge_areas: string[]
  level: 'lower' | 'upper' | 'grad'
  /** Present when row came from UCSB catalog cache instead of Supabase `courses`. */
  detail_source?: 'ucsb_catalog_cache'
}

export type Professor = {
  instructor_norm: string
  display_name: string
  rmp_rating: number | null
  rmp_difficulty: number | null
  rmp_num_ratings: number | null
  rmp_would_take_again: number | null
  rmp_department: string | null
  rmp_confidence: 'exact_initial' | 'only_candidate' | 'top_by_ratings' | 'none'
}

export type Section = {
  enroll_code: string
  quarter_code: string
  course_norm: string
  instructor_norm: string | null
  section_label: string | null
  days: string | null
  begin_time: string | null
  end_time: string | null
  building: string | null
  room: string | null
  max_enroll: number | null
  enrolled: number | null
  open_seats: number | null
}

export type Prediction = {
  enroll_code: string
  course_norm: string
  predicted_gpa: number
  predicted_gpa_std: number
  regime: string
  gpa_lo: number
  gpa_hi: number
  interval_half_width: number
}

export type SectionPick = {
  enroll_code: string
  course_norm: string
  /** GOLD section id when the optimizer joined it (e.g. 0100). */
  section_label?: string | null
  instructor_norm: string | null
  days: string | null
  begin_time: string | null
  end_time: string | null
  predicted_gpa: number | null
  predicted_gpa_std?: number | null
  regime?: string | null
  gpa_lo?: number | null
  gpa_hi?: number | null
  interval_half_width?: number | null
  rmp_rating: number | null
  rmp_num_ratings?: number | null
  rmp_difficulty?: number | null
  course_hist_avg_gpa?: number | null
  course_hist_n_letter?: number | null
  pair_hist_avg_gpa?: number | null
  pair_hist_n_letter?: number | null
  reason: Record<string, number>
}

export type ScheduleCandidate = {
  score: number
  total_units: number
  sections: SectionPick[]
  explanation: Record<string, unknown>
}

export type OptimizeResponsePayload = {
  candidates: ScheduleCandidate[]
  model_version?: string
  conformal_method?: string
  /** Backend hints when candidates is empty (units band, missing sections, conflicts). */
  optimize_notes?: string[]
}

export type OptimizePreferences = {
  weight_grades: number
  weight_professor: number
  weight_convenience: number
  weight_availability: number
  target_units_min: number
  target_units_max: number
  earliest_start: string
  latest_end: string
  preferred_days: string[]
  avoid_friday_afternoon: boolean
  diversity_lambda: number
  /** Penalize wide GPA intervals in the grade term (0 = mean-only). */
  risk_lambda?: number
  elective_subject_bonus?: number
  preferred_elective_prefixes?: string[]
}

export type OptimizeRequest = {
  quarter_code: string
  major_id: string
  required_courses: string[]
  optional_courses?: string[]
  excluded_courses?: string[]
  completed_courses?: string[]
  preferences: OptimizePreferences
  top_k?: number
  /** For optimization_runs audit log (RLS). */
  user_id?: string | null
}

/** One SSE JSON payload from POST /optimize/stream (excluding terminal `complete` / `error`). */
export type OptimizeStreamPhaseEvent = {
  phase: string
  label?: string
  [key: string]: unknown
}

class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
  if (!r.ok) {
    const text = await r.text().catch(() => '')
    throw new ApiError(`${r.status} ${r.statusText} ${text}`.trim(), r.status)
  }
  return (await r.json()) as T
}

type Page<T> = { items: T[]; total: number; limit: number; offset: number }

export type CatalogCoursesPage = Page<Course> & {
  quarter: string
  label: string
  source: string
}

export type CatalogMeta = {
  quarter: string
  label: string
  ucsb_api_configured: boolean
  department_fetch_count: number
  /** Subject codes merged into the live catalog (plus UCSB quarter-wide search). */
  department_codes: string[]
  source: string
}

export type ProfessorHistoryRow = {
  course_norm: string
  quarter: string
  year: number
  avg_gpa: number | null
  n_letter: number
}

/** One historical offering row from `grade_distributions` (Nexus / GOLD). */
export type GradeTrendPoint = {
  year: number
  quarter: string
  instructor_norm: string
  avg_gpa: number | null
  n_letter: number
  a_count?: number | null
  b_count?: number | null
  c_count?: number | null
  d_count?: number | null
  f_count?: number | null
  p_count?: number | null
  np_count?: number | null
  grade_breakdown_json?: Record<string, unknown> | null
}

function toQuery(params: Record<string, unknown>): string {
  const usp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') usp.set(k, String(v))
  }
  const s = usp.toString()
  return s ? `?${s}` : ''
}

/**
 * POST /optimize/stream — SSE `data:` lines are JSON. Phases yield `{ phase, label?, ... }`;
 * terminal `complete` includes `result` (same shape as POST /optimize).
 */
export async function runOptimizeStream(
  body: OptimizeRequest,
  opts: { onPhase: (e: OptimizeStreamPhaseEvent) => void; signal?: AbortSignal },
): Promise<OptimizeResponsePayload> {
  const r = await fetch(`${API_BASE}/optimize/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(body),
    signal: opts.signal,
  })
  if (!r.ok) {
    const text = await r.text().catch(() => '')
    throw new ApiError(`${r.status} ${r.statusText} ${text}`.trim(), r.status)
  }
  if (!r.body) throw new ApiError('No response body', 500)

  const reader = r.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let result: OptimizeResponsePayload | null = null

  const consumeLine = (line: string) => {
    if (!line.startsWith('data:')) return
    const raw = line.startsWith('data: ') ? line.slice(6).trim() : line.slice(5).trim()
    if (!raw) return
    let json: Record<string, unknown>
    try {
      json = JSON.parse(raw) as Record<string, unknown>
    } catch {
      return
    }
    const ph = json.phase
    if (ph === 'complete' && json.result != null) {
      result = json.result as OptimizeResponsePayload
      return
    }
    if (ph === 'error') {
      throw new ApiError(String(json.detail ?? 'optimize stream error'), Number(json.status_code) || 500)
    }
    opts.onPhase(json as OptimizeStreamPhaseEvent)
  }

  while (true) {
    const { done, value } = await reader.read()
    if (value) buffer += decoder.decode(value, { stream: !done })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) consumeLine(line)
    if (done) break
  }

  if (buffer.trim()) {
    for (const line of buffer.split('\n')) consumeLine(line)
  }

  if (!result) throw new ApiError('Stream ended without complete result', 500)
  return result
}

export type StatusPayload = {
  status: string
  model: {
    trained: boolean
    metrics?: {
      rmse?: number
      r2?: number
      mae?: number
    }
    n_train?: number
    n_val?: number
    n_test?: number
    train_date?: string
    features_path?: string
    [key: string]: unknown
  }
  supabase: {
    tables: Record<string, number>
    error: string | null
  }
  refresh_log: Array<{
    source: string
    rows: number
    notes: string | null
    ran_at: string
  }>
}

export const api = {
  health: () => req<{ status: string }>('/health'),
  status: () => req<StatusPayload>('/status'),

  listCourses: (params: {
    dept?: string
    ge?: string
    level?: string
    search?: string
    limit?: number
    offset?: number
  } = {}) => req<Page<Course>>(`/courses${toQuery(params)}`),

  /** Live UCSB curriculum (requires UCSB_API_KEY on the backend). */
  catalogMeta: (params: { quarter?: string } = {}) =>
    req<CatalogMeta>(`/catalog/meta${toQuery(params)}`),

  listCatalogCourses: (params: {
    quarter?: string
    dept?: string
    ge?: string
    level?: string
    search?: string
    limit?: number
    offset?: number
  } = {}) => req<CatalogCoursesPage>(`/catalog/courses${toQuery(params)}`),

  getCourse: (courseNorm: string, quarter?: string | null) =>
    req<Course>(
      `/courses/${encodeURIComponent(courseNorm)}${toQuery(quarter ? { quarter } : {})}`,
    ),

  listSections: (params: {
    quarter: string
    course?: string
    dept?: string
    open_only?: boolean
    limit?: number
    offset?: number
  }) => req<Page<Section>>(`/sections${toQuery(params)}`),

  /** Distinct course_norm values with sections loaded for this quarter (optimizer scope). */
  listDistinctCourseNorms: (quarter: string) =>
    req<{ quarter_code: string; course_norms: string[]; n: number }>(
      `/sections/distinct-course-norms${toQuery({ quarter })}`,
    ),

  getProfessor: (instructorNorm: string) =>
    req<{ professor: Professor; history: ProfessorHistoryRow[] }>(
      `/professors/${encodeURIComponent(instructorNorm)}`,
    ),

  listProfessors: (params: {
    dept?: string
    search?: string
    limit?: number
    offset?: number
  } = {}) => req<Page<Professor>>(`/professors${toQuery(params)}`),

  // ml
  predict: (section_ids: string[], quarter_code: string) =>
    req<{ predictions: Prediction[]; model_version?: string; conformal_method?: string }>('/predict', {
      method: 'POST',
      body: JSON.stringify({ section_ids, quarter_code }),
    }),
  optimize: (body: OptimizeRequest) =>
    req<OptimizeResponsePayload>('/optimize', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  /**
   * Streamed optimize: POST /optimize/stream (SSE). Yields JSON per phase, then `complete` with full result.
   * On network/parse error, fall back to `api.optimize()`.
   */
  optimizeStream: runOptimizeStream,

  // trends (historical grade rows per offering — powers course explorer charts)
  getGradeTrend: (courseNorm: string) =>
    req<{ course_norm: string; points: GradeTrendPoint[] }>(
      `/trends/grades${toQuery({ course_norm: courseNorm })}`,
    ),
}

export { ApiError, API_BASE }
