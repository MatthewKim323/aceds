import { supabase } from './supabase'
import { toCourseNorm } from './course-norm'
import { type ParsedDocument } from './pdf-parser'

export type IngestSource = 'transcript' | 'academic_history' | 'manual'

/** Append-only audit row (non-blocking; fails quietly if table missing). */
export async function logStudentIngestionEvent(
  userId: string,
  source: IngestSource,
  summary: Record<string, unknown>,
  parseSchemaVersion: string = 'v1',
): Promise<void> {
  try {
    const { error } = await supabase.from('student_ingestion_events').insert({
      user_id: userId,
      source,
      parse_schema_version: parseSchemaVersion,
      summary,
    })
    if (error) console.warn('[ace] student_ingestion_events:', error.message)
  } catch (e) {
    console.warn('[ace] student_ingestion_events:', e)
  }
}

function prioritiesToWeights(ordered: string[]) {
  const weights: Record<string, number> = {}
  const base = [0.40, 0.30, 0.20, 0.10]
  const keyMap: Record<string, string> = {
    'Professor Rating': 'professor',
    'Easy A': 'grades',
    'Schedule Convenience': 'convenience',
    'Seat Availability': 'availability',
  }
  ordered.forEach((label, i) => {
    const key = keyMap[label]
    if (key) weights[key] = base[i] ?? 0.1
  })
  return weights
}

function formatTime(h: number) {
  const hh = h.toString().padStart(2, '0')
  return `${hh}:00`
}

function patternToDb(pattern: string) {
  if (pattern === 'MWF') return 'mwf'
  if (pattern === 'TR') return 'tr'
  return 'no_preference'
}

export interface OnboardingPayload {
  majorIds: string[]
  year: string
  completedCourses: string[]
  earliestTime: number
  pattern: string
  units: number
  priorities: string[]
  parsedDoc: ParsedDocument | null
  /** How the user supplied academic data (drives ingestion audit `source`). */
  ingestSource?: IngestSource
}

export async function saveProfile(userId: string, data: OnboardingPayload) {
  const { data: existing } = await supabase
    .from('student_profiles')
    .select(
      'id, course_grades, in_progress_courses, cumulative_gpa, transfer_units, ap_credits, requirement_status',
    )
    .eq('user_id', userId)
    .maybeSingle()

  let courseGrades: Record<string, string> = {}
  let inProgressCourses: string[] = []
  let cumulativeGpa: number | null = null
  let transferUnits = 0
  let apCredits: unknown[] = []
  let requirementStatus: unknown = null

  if (data.parsedDoc) {
    for (const c of data.parsedDoc.completed_courses) {
      const id = toCourseNorm(c.course_code)
      if (c.grade) courseGrades[id] = c.grade
    }
    for (const c of data.parsedDoc.in_progress_courses) {
      inProgressCourses.push(toCourseNorm(c.course_code))
    }
    cumulativeGpa = data.parsedDoc.cumulative_gpa ?? null
    transferUnits = data.parsedDoc.transfer_units ?? 0
    apCredits = data.parsedDoc.ap_credits ?? []
    requirementStatus = data.parsedDoc.requirement_status ?? null
  } else if (existing) {
    courseGrades = { ...((existing.course_grades as Record<string, string>) ?? {}) }
    inProgressCourses = [...((existing.in_progress_courses as string[]) ?? [])]
    cumulativeGpa = (existing.cumulative_gpa as number | null) ?? null
    transferUnits = (existing.transfer_units as number) ?? 0
    apCredits = Array.isArray(existing.ap_credits) ? [...existing.ap_credits] : []
    requirementStatus = existing.requirement_status ?? null
    const completedNorm = new Set(data.completedCourses.map((c) => toCourseNorm(String(c))))
    for (const k of Object.keys(courseGrades)) {
      if (!completedNorm.has(k)) delete courseGrades[k]
    }
  }

  const payload: Record<string, unknown> = {
    user_id: userId,
    major: data.majorIds.join(','),
    year: data.year,
    completed_courses: data.completedCourses.map((c) => toCourseNorm(String(c))),
    in_progress_courses: inProgressCourses,
    course_grades: courseGrades,
    cumulative_gpa: cumulativeGpa,
    transfer_units: transferUnits,
    ap_credits: apCredits,
    requirement_status: requirementStatus,
    earliest_class: formatTime(data.earliestTime),
    preferred_days: patternToDb(data.pattern),
    target_units: data.units,
    priority_weights: prioritiesToWeights(data.priorities),
    onboarding_complete: true,
  }

  const ingestSummary: Record<string, unknown> = {
    majors: data.majorIds,
    completed_count: data.completedCourses.length,
    in_progress_count: inProgressCourses.length,
    grades_count: Object.keys(courseGrades).length,
    gpa_present: cumulativeGpa != null,
    has_parsed_doc: Boolean(data.parsedDoc),
  }
  const source: IngestSource =
    data.ingestSource ??
    (data.parsedDoc ? 'transcript' : 'manual')

  if (existing?.id) {
    const { error } = await supabase
      .from('student_profiles')
      .update(payload)
      .eq('user_id', userId)
    if (!error) void logStudentIngestionEvent(userId, source, ingestSummary)
    return { error: error?.message ?? null }
  }

  const { error } = await supabase.from('student_profiles').insert(payload)
  if (!error) void logStudentIngestionEvent(userId, source, ingestSummary)
  return { error: error?.message ?? null }
}

export async function getProfile(userId: string) {
  const { data, error } = await supabase
    .from('student_profiles')
    .select('*')
    .eq('user_id', userId)
    .single()

  return { profile: data, error: error?.message ?? null }
}

export interface SyntheticStudent {
  id: string
  name: string
  major_id: string
  catalog_year: number
  year_standing: string
  gpa: number
  preference_weights: {
    grades: number
    professor: number
    convenience: number
    availability: number
  }
  completed_courses: string[]
  working_hours_week: number
  avoid_friday_afternoon: boolean
  target_units_min: number
  target_units_max: number
}

export async function updateProfilePartial(
  userId: string,
  patch: Record<string, unknown>,
) {
  const { error } = await supabase
    .from('student_profiles')
    .update(patch)
    .eq('user_id', userId)
  if (!error) {
    void logStudentIngestionEvent(userId, 'manual', {
      kind: 'settings_update',
      keys: Object.keys(patch),
    })
  }
  return { error: error?.message ?? null }
}

export async function applySyntheticStudent(
  userId: string,
  s: SyntheticStudent,
) {
  const payload: Record<string, unknown> = {
    major: s.major_id,
    year: s.year_standing,
    completed_courses: s.completed_courses,
    in_progress_courses: [],
    course_grades: {},
    cumulative_gpa: s.gpa,
    target_units: Math.round((s.target_units_min + s.target_units_max) / 2),
    priority_weights: s.preference_weights,
    earliest_class: '09:00',
    preferred_days: 'no_preference',
    onboarding_complete: true,
    demo_student_id: s.id,
  }
  const out = await updateProfilePartial(userId, payload)
  if (!out.error) {
    void logStudentIngestionEvent(userId, 'manual', {
      kind: 'synthetic_student',
      demo_student_id: s.id,
      major_id: s.major_id,
      completed_count: s.completed_courses.length,
    })
  }
  return out
}
