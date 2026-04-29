/**
 * Canonical derived view of a student profile for UI, exports, and “knowledge graph” demos.
 * Pure functions — safe to call from ShowcaseLab, Explorer, etc.
 */

import { getMajorById, type Major } from '../data/majors'
import { toCourseNorm } from './course-norm'
import { buildPersonalizationFromMajors } from './explorer-personalize'

export const STUDENT_BUNDLE_SCHEMA_VERSION = 'v1' as const

export type GraphEdge = {
  type: 'completed' | 'in_progress' | 'required_by_major'
  from: string
  to: string
}

export type StudentBundle = {
  schemaVersion: typeof STUDENT_BUNDLE_SCHEMA_VERSION
  generatedAt: string
  /** Join keys for ML / optimizer logs (predictor id lives on backend `model_meta.json`). */
  meta: {
    defaultQuarterCode: string
    predictorIdNote: string
  }
  majors: Array<{ id: string; name: string; degree: string }>
  completedCourseNorms: string[]
  inProgressCourseNorms: string[]
  gradesByCourse: Record<string, string>
  cumulativeGpa: number | null
  transferUnits: number
  apCreditsCount: number
  /** Cheap derived stats for charts / poster */
  derived: {
    numCompleted: number
    numInProgress: number
    numGradedCourses: number
    numMajorRequirementCourses: number
    /** How many completed courses appear on at least one declared major sheet (incl. alts). */
    overlapCompletedWithMajorRequirements: number
    /** Distinct subject prefixes from major requirements. */
    numMajorSubjectPrefixes: number
  }
  /** Small explicit edge list for demo / export (capped). */
  graphEdges: GraphEdge[]
}

const MAX_EDGES = 180

/** Supabase `student_profiles` row (snake_case) plus any JSON fields. */
export type ProfileRow = Record<string, unknown>

function majorIdsFromProfile(profile: ProfileRow): string[] {
  const raw = profile.major
  if (typeof raw !== 'string' || !raw.trim()) return []
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.map((x) => toCourseNorm(String(x))).filter(Boolean)
}

function asGradeMap(v: unknown): Record<string, string> {
  if (!v || typeof v !== 'object') return {}
  const out: Record<string, string> = {}
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    const nk = toCourseNorm(k)
    if (nk && typeof val === 'string') out[nk] = val
  }
  return out
}

/**
 * Build a stable JSON bundle from a loaded profile row (or null if signed out / no row).
 */
export function buildStudentBundle(profile: ProfileRow | null | undefined): StudentBundle {
  const now = new Date().toISOString()
  if (!profile) {
    return {
      schemaVersion: STUDENT_BUNDLE_SCHEMA_VERSION,
      generatedAt: now,
      meta: {
        defaultQuarterCode: '20262',
        predictorIdNote: 'POST /predict returns model_version from server artifacts',
      },
      majors: [],
      completedCourseNorms: [],
      inProgressCourseNorms: [],
      gradesByCourse: {},
      cumulativeGpa: null,
      transferUnits: 0,
      apCreditsCount: 0,
      derived: {
        numCompleted: 0,
        numInProgress: 0,
        numGradedCourses: 0,
        numMajorRequirementCourses: 0,
        overlapCompletedWithMajorRequirements: 0,
        numMajorSubjectPrefixes: 0,
      },
      graphEdges: [],
    }
  }

  const majorIds = majorIdsFromProfile(profile)
  const majors: Array<{ id: string; name: string; degree: string }> = []
  for (const id of majorIds) {
    const m = getMajorById(id)
    if (m) majors.push({ id: m.id, name: m.name, degree: m.degree })
  }

  const completedCourseNorms = asStringArray(profile.completed_courses)
  const inProgressCourseNorms = asStringArray(profile.in_progress_courses)
  const gradesByCourse = asGradeMap(profile.course_grades)
  const cumulativeGpa =
    typeof profile.cumulative_gpa === 'number' && !Number.isNaN(profile.cumulative_gpa)
      ? profile.cumulative_gpa
      : null
  const transferUnits =
    typeof profile.transfer_units === 'number' && !Number.isNaN(profile.transfer_units)
      ? profile.transfer_units
      : 0
  const apCredits = Array.isArray(profile.ap_credits) ? profile.ap_credits : []

  const pers = buildPersonalizationFromMajors(majorIds)
  const needed = pers.neededCourseNorms
  const completedSet = new Set(completedCourseNorms)
  let overlap = 0
  for (const c of completedSet) {
    if (needed.has(c)) overlap += 1
  }

  const derived = {
    numCompleted: completedCourseNorms.length,
    numInProgress: inProgressCourseNorms.length,
    numGradedCourses: Object.keys(gradesByCourse).length,
    numMajorRequirementCourses: needed.size,
    overlapCompletedWithMajorRequirements: overlap,
    numMajorSubjectPrefixes: pers.neededDepts.size,
  }

  const graphEdges: GraphEdge[] = []
  const push = (e: GraphEdge) => {
    if (graphEdges.length >= MAX_EDGES) return
    graphEdges.push(e)
  }

  for (const c of completedCourseNorms) {
    push({ type: 'completed', from: 'student', to: c })
  }
  for (const c of inProgressCourseNorms) {
    push({ type: 'in_progress', from: 'student', to: c })
  }
  for (const mid of majorIds) {
    const m: Major | undefined = getMajorById(mid)
    if (!m) continue
    for (const g of m.groups) {
      for (const opt of g.courses) {
        const a = toCourseNorm(opt.id)
        if (a) push({ type: 'required_by_major', from: a, to: `major:${mid}` })
        if (opt.alt) {
          const b = toCourseNorm(opt.alt)
          if (b) push({ type: 'required_by_major', from: b, to: `major:${mid}` })
        }
      }
    }
  }

  return {
    schemaVersion: STUDENT_BUNDLE_SCHEMA_VERSION,
    generatedAt: now,
    meta: {
      defaultQuarterCode: '20262',
      predictorIdNote: 'POST /predict returns model_version from server artifacts',
    },
    majors,
    completedCourseNorms,
    inProgressCourseNorms,
    gradesByCourse,
    cumulativeGpa,
    transferUnits,
    apCreditsCount: apCredits.length,
    derived,
    graphEdges,
  }
}
