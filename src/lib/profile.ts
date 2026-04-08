import { supabase } from './supabase'
import type { ParsedDocument } from './pdf-parser'

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
}

export async function saveProfile(userId: string, data: OnboardingPayload) {
  const courseGrades: Record<string, string> = {}
  const inProgressCourses: string[] = []

  if (data.parsedDoc) {
    for (const c of data.parsedDoc.completed_courses) {
      if (c.grade) courseGrades[c.course_code] = c.grade
    }
    for (const c of data.parsedDoc.in_progress_courses) {
      inProgressCourses.push(c.course_code)
    }
  }

  const payload: Record<string, unknown> = {
    user_id: userId,
    major: data.majorIds.join(','),
    year: data.year,
    completed_courses: data.completedCourses,
    in_progress_courses: inProgressCourses,
    course_grades: courseGrades,
    cumulative_gpa: data.parsedDoc?.cumulative_gpa ?? null,
    transfer_units: data.parsedDoc?.transfer_units ?? 0,
    ap_credits: data.parsedDoc?.ap_credits ?? [],
    requirement_status: data.parsedDoc?.requirement_status ?? null,
    earliest_class: formatTime(data.earliestTime),
    preferred_days: patternToDb(data.pattern),
    target_units: data.units,
    priority_weights: prioritiesToWeights(data.priorities),
    onboarding_complete: true,
  }

  const { data: existing } = await supabase
    .from('student_profiles')
    .select('id')
    .eq('user_id', userId)
    .single()

  if (existing) {
    const { error } = await supabase
      .from('student_profiles')
      .update(payload)
      .eq('user_id', userId)
    return { error: error?.message ?? null }
  }

  const { error } = await supabase.from('student_profiles').insert(payload)
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
