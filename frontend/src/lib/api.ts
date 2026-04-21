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
}

export type SectionPick = {
  enroll_code: string
  course_norm: string
  instructor_norm: string | null
  days: string | null
  begin_time: string | null
  end_time: string | null
  predicted_gpa: number | null
  rmp_rating: number | null
  reason: Record<string, number>
}

export type ScheduleCandidate = {
  score: number
  total_units: number
  sections: SectionPick[]
  explanation: Record<string, unknown>
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

export type ProfessorHistoryRow = {
  course_norm: string
  quarter: string
  year: number
  avg_gpa: number | null
  n_letter: number
}

function toQuery(params: Record<string, unknown>): string {
  const usp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') usp.set(k, String(v))
  }
  const s = usp.toString()
  return s ? `?${s}` : ''
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

  getCourse: (courseNorm: string) =>
    req<Course>(`/courses/${encodeURIComponent(courseNorm)}`),

  listSections: (params: {
    quarter: string
    course?: string
    dept?: string
    open_only?: boolean
    limit?: number
    offset?: number
  }) => req<Page<Section>>(`/sections${toQuery(params)}`),

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
    req<{ predictions: Prediction[] }>('/predict', {
      method: 'POST',
      body: JSON.stringify({ section_ids, quarter_code }),
    }),
  optimize: (body: OptimizeRequest) =>
    req<{ candidates: ScheduleCandidate[] }>('/optimize', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  // trends
  getTrend: (courseNorm: string) =>
    req<Array<{ quarter: string; year: number; avg_gpa: number | null; n_letter: number; instructor_norm: string }>>(
      `/trends/${encodeURIComponent(courseNorm)}`,
    ),
}

export { ApiError, API_BASE }
