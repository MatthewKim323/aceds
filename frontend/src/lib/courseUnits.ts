import type { CourseGroup } from '../data/majors'
import { toCourseNorm } from './pdf-parser'

/**
 * UCSB schedule units when transcript metadata is unavailable.
 * Most letter-graded courses are 4 units; labs / activity suffixes are lower.
 */
export function estimateUcsbCourseUnits(courseCode: string): number {
  const n = toCourseNorm(courseCode)
  const numPart = n.split(/\s+/).pop() ?? ''
  if (/AL$/i.test(numPart)) return 2
  if (/BL$/i.test(numPart)) return 2
  if (/CL$/i.test(numPart)) return 2
  if (/AC$/i.test(numPart)) return 2
  if (/BC$/i.test(numPart)) return 2
  if (/CC$/i.test(numPart)) return 2
  if (/DL$/i.test(numPart)) return 2
  if (/\d[A-Z]L$/i.test(numPart) && numPart.length <= 4) return 2
  if (/\dL$/i.test(numPart) && numPart.length <= 3) return 1
  return 4
}

/** Total catalog units for a requirement group (pick-N pools use N×4). */
export function tierTotalUnits(group: CourseGroup): number {
  if (group.pick != null && group.pick > 0) {
    return group.pick * 4
  }
  return group.courses.reduce((s, c) => s + estimateUcsbCourseUnits(c.id), 0)
}

/** Estimated units satisfied in this group from transcript + AP. */
export function tierDoneUnits(group: CourseGroup, satisfied: Set<string>): number {
  let raw = 0
  for (const c of group.courses) {
    const idN = toCourseNorm(c.id)
    const altN = c.alt != null ? toCourseNorm(c.alt) : null
    const doneHere =
      satisfied.has(idN) || (altN != null && satisfied.has(altN))
    if (!doneHere) continue
    const codeForUnits =
      satisfied.has(idN) ? c.id : altN != null && satisfied.has(altN) ? c.alt! : c.id
    raw += estimateUcsbCourseUnits(codeForUnits)
  }
  if (group.pick != null && group.pick > 0) {
    const cap = group.pick * 4
    return Math.min(raw, cap)
  }
  return raw
}

export function aggregateMajorRequirementUnits(
  majors: { groups: CourseGroup[] }[],
  satisfied: Set<string>,
): { doneUnits: number; totalUnits: number } {
  let doneUnits = 0
  let totalUnits = 0
  for (const m of majors) {
    for (const g of m.groups) {
      totalUnits += tierTotalUnits(g)
      doneUnits += tierDoneUnits(g, satisfied)
    }
  }
  return { doneUnits, totalUnits }
}
