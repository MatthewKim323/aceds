/**
 * Blend section-level model GPA with the student's transcript (dept + cumulative)
 * so predictions feel anchored to how they actually perform.
 */

export function letterGradeToGpa(letter: string | undefined | null): number | null {
  if (!letter) return null
  const x = letter.trim().toUpperCase().replace(/\s+/g, '')
  if (x === 'NP' || x === 'U' || x === 'I' || x === 'W' || x === 'P' || x === 'S') return null
  const map: Record<string, number> = {
    'A+': 4.0,
    A: 4.0,
    'A-': 3.7,
    'B+': 3.3,
    B: 3.0,
    'B-': 2.7,
    'C+': 2.3,
    C: 2.0,
    'C-': 1.7,
    'D+': 1.3,
    D: 1.0,
    'D-': 0.7,
    F: 0.0,
  }
  const v = map[x]
  if (v === undefined) return null
  return v
}

export function deptPrefix(courseNorm: string): string {
  const parts = courseNorm.trim().toUpperCase().split(/\s+/)
  return parts[0] ?? courseNorm
}

function avgDeptGpaFromTranscript(
  courseGrades: Record<string, string>,
  dept: string,
): { avg: number; n: number } {
  let sum = 0
  let n = 0
  for (const [cn, g] of Object.entries(courseGrades)) {
    if (deptPrefix(cn) !== dept) continue
    const v = letterGradeToGpa(g)
    if (v != null) {
      sum += v
      n += 1
    }
  }
  return { avg: n ? sum / n : 0, n }
}

export type PersonalBlend = {
  blended: number | null
  model: number | null
  weightPersonal: number
  personalBasis: 'dept' | 'cumulative' | 'none'
  personalGpa: number | null
  note: string
}

export function blendPersonalPredictedGpa(
  modelMu: number | null | undefined,
  courseNorm: string,
  courseGrades: Record<string, string>,
  cumulativeGpa: number | null | undefined,
): PersonalBlend {
  if (modelMu == null || Number.isNaN(modelMu)) {
    return {
      blended: null,
      model: null,
      weightPersonal: 0,
      personalBasis: 'none',
      personalGpa: null,
      note: 'No model prediction for this section.',
    }
  }
  const dept = deptPrefix(courseNorm)
  const { avg: deptAvg, n: deptN } = avgDeptGpaFromTranscript(courseGrades, dept)

  if (deptN >= 2 && deptAvg > 0) {
    const w = 0.38
    const blended = w * deptAvg + (1 - w) * modelMu
    return {
      blended: clampGpa(blended),
      model: modelMu,
      weightPersonal: w,
      personalBasis: 'dept',
      personalGpa: deptAvg,
      note: `Weighted ${Math.round(w * 100)}% your ${dept} transcript avg (${deptAvg.toFixed(2)}) vs model.`,
    }
  }

  if (cumulativeGpa != null && !Number.isNaN(cumulativeGpa) && cumulativeGpa > 0) {
    const w = 0.22
    const blended = w * cumulativeGpa + (1 - w) * modelMu
    return {
      blended: clampGpa(blended),
      model: modelMu,
      weightPersonal: w,
      personalBasis: 'cumulative',
      personalGpa: cumulativeGpa,
      note: `Weighted ${Math.round(w * 100)}% cumulative GPA vs section model.`,
    }
  }

  return {
    blended: clampGpa(modelMu),
    model: modelMu,
    weightPersonal: 0,
    personalBasis: 'none',
    personalGpa: null,
    note: 'Model only — add transcript grades for a personalized blend.',
  }
}

function clampGpa(x: number): number {
  return Math.min(4.0, Math.max(0, x))
}
