import type { Course } from './api'
import { getMajorById } from '../data/majors'
import { toCourseNorm } from './course-norm'

export type PersonalizationSignals = {
  /** Normalized course codes from major requirement sheets (incl. alt options). */
  neededCourseNorms: Set<string>
  /** Subject codes inferred from those requirement lines (e.g. CMPSC, AS AM). */
  neededDepts: Set<string>
  /** Human-readable major names for UI copy. */
  majorNames: string[]
}

/** First tokens of a requirement line before the catalog number (handles "AS AM 1"). */
export function deptPrefixFromCourseCode(raw: string): string {
  const parts = toCourseNorm(raw).split(/\s+/).filter(Boolean)
  if (parts.length < 2) return parts[0] ?? ''
  return parts.slice(0, -1).join(' ')
}

export function buildPersonalizationFromMajors(majorIds: string[]): PersonalizationSignals {
  const neededCourseNorms = new Set<string>()
  const neededDepts = new Set<string>()
  const majorNames: string[] = []

  for (const id of majorIds) {
    const m = getMajorById(id)
    if (!m) continue
    majorNames.push(m.name)
    for (const g of m.groups) {
      for (const opt of g.courses) {
        neededCourseNorms.add(toCourseNorm(opt.id))
        neededDepts.add(deptPrefixFromCourseCode(opt.id))
        if (opt.alt) {
          neededCourseNorms.add(toCourseNorm(opt.alt))
          neededDepts.add(deptPrefixFromCourseCode(opt.alt))
        }
      }
    }
  }
  return { neededCourseNorms, neededDepts, majorNames }
}

/**
 * Higher = closer to the top. Completed courses sink so the catalog surfaces what you still need.
 */
export function catalogPersonalScore(
  c: Course,
  sig: PersonalizationSignals,
  completedNorms: Set<string>,
  inProgressNorms: Set<string>,
): number {
  const cn = toCourseNorm(c.course_norm)
  const deptNorm = toCourseNorm(c.dept || '')
  let score = 0

  if (sig.neededCourseNorms.has(cn)) score += 1200
  if (sig.neededDepts.has(deptNorm)) score += 80
  if (inProgressNorms.has(cn)) score += 40
  if (completedNorms.has(cn)) score -= 3000

  return score
}

export function compareCoursesDefault(a: Course, b: Course): number {
  const da = toCourseNorm(a.dept || '').localeCompare(toCourseNorm(b.dept || ''))
  if (da !== 0) return da
  return toCourseNorm(a.course_norm).localeCompare(toCourseNorm(b.course_norm))
}
