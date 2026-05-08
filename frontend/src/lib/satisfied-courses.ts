/**
 * Transcript + AP / articulation satisfaction for major paths (no pdf.js — safe for unit tests).
 */

import { toCourseNorm } from './course-norm'

export type SatisfiedApCredit = {
  exam: string
  ucsb_equivalent?: string[] | null
  units?: number
  score?: number | null
}

/** Normalize GOLD/Coll.Board-style AP tokens for lookup (e.g. "AP MATH BC" → "AP-MATH-BC"). */
export function normalizeApExamCodeKey(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
}

/**
 * Infer UCSB calculus credit from the AP exam title when Academic History lists AP-* codes
 * but does not spell out MATH 3A/3B (used for profiles already saved with empty ucsb_equivalent).
 */
export function inferCalculusCoursesFromApExamName(examName: string): string[] {
  const n = examName.toUpperCase()
  if (
    /\bCALCULUS\s*(BC|B\s*\/\s*C)\b|\bCALC\s*BC\b|\bCALCULUS\s+BC\b/i.test(examName) ||
    /MATHEMATICS:\s*CALCULUS\s*BC/i.test(n) ||
    /\bMATH(?:EMATICS)?\s+BC\b/i.test(n) ||
    /\bBC\s+CALC/i.test(n)
  ) {
    return ['MATH 3A', 'MATH 3B']
  }
  if (
    /\bCALCULUS\s*(AB|A\s*\/\s*B)\b|\bCALC\s*AB\b|\bCALCULUS\s+AB\b/i.test(examName) ||
    /MATHEMATICS:\s*CALCULUS\s*AB/i.test(n) ||
    /\bMATH(?:EMATICS)?\s+AB\b/i.test(n) ||
    /\bAB\s+CALC/i.test(n)
  ) {
    return ['MATH 3A']
  }
  return []
}

/**
 * Map AP line (code + exam name) to UCSB course codes — GOLD uses AP-MATH-* etc.; older logic dropped AP-* entirely.
 */
export function resolveApUcsbEquivalents(apCode: string, examName: string): string[] {
  const key = normalizeApExamCodeKey(apCode)

  const table: Record<string, string[]> = {
    'AP-MATH-AB': ['MATH 3A'],
    'AP-MATH-A1': ['MATH 3A'],
    'AP-CALC-AB': ['MATH 3A'],
    'AP-MATH-BC': ['MATH 3A', 'MATH 3B'],
    'AP-MATH-B1': ['MATH 3A', 'MATH 3B'],
    'AP-CALC-BC': ['MATH 3A', 'MATH 3B'],
    'AP-MATHEMATICS-BC': ['MATH 3A', 'MATH 3B'],
    'AP-MATHEMATICS-AB': ['MATH 3A'],
  }

  if (table[key]) return [...table[key]]

  const fromExam = inferCalculusCoursesFromApExamName(examName)
  if (fromExam.length > 0) return fromExam

  if (/COMP\s*SCI\s*P|COMPUTER\s*SCIENCE\s*PRINCIPLES/i.test(apCode + examName)) {
    return ['AP COMP SCI P']
  }

  if (!key.startsWith('AP-')) {
    const t = apCode.trim()
    return t ? [t] : []
  }

  return []
}

/**
 * UCSB-style overlaps: AP / articulation often posts as MATH 3A–3B while major sheets list MATH 2A–2B
 * (same tier for prerequisites). Expand so GradPath, Explorer, and Schedule agree.
 */
const UCSB_PLACEMENT_EQUIV: ReadonlyArray<readonly [string, string]> = [
  ['MATH 3A', 'MATH 2A'],
  ['MATH 3B', 'MATH 2B'],
  ['MATH 2A', 'MATH 3A'],
  ['MATH 2B', 'MATH 3B'],
  ['MATH 34A', 'MATH 3A'],
  ['MATH 34B', 'MATH 3B'],
]

export function expandUcsbPlacementEquivalents(normSet: Set<string>): void {
  let changed = true
  while (changed) {
    changed = false
    const snapshot = [...normSet]
    for (const have of snapshot) {
      for (const [a, b] of UCSB_PLACEMENT_EQUIV) {
        if (have !== a) continue
        const bn = toCourseNorm(b)
        if (bn && !normSet.has(bn)) {
          normSet.add(bn)
          changed = true
        }
      }
    }
  }
}

/** UCSB courses satisfied by transcript grades plus AP / articulation equivalents from Academic History. */
export function buildSatisfiedCourseSet(
  completedCourseCodes: string[],
  apCredits: SatisfiedApCredit[] | undefined | null,
): Set<string> {
  const s = new Set<string>()
  for (const c of completedCourseCodes) {
    const n = toCourseNorm(c)
    if (n) s.add(n)
  }
  for (const ap of apCredits ?? []) {
    let codes = ap.ucsb_equivalent ?? []
    if (codes.length === 0) {
      codes = inferCalculusCoursesFromApExamName(ap.exam)
    }
    for (const eq of codes) {
      const n = toCourseNorm(eq)
      if (n) s.add(n)
    }
  }
  expandUcsbPlacementEquivalents(s)
  return s
}
