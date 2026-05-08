import type { GradeTrendPoint } from './api'

const QUARTER_ORDER = ['Winter', 'Spring', 'Summer', 'Fall'] as const

function quarterIndex(q: string): number {
  const i = (QUARTER_ORDER as readonly string[]).indexOf(q)
  return i >= 0 ? i : 99
}

function nz(x: unknown): number {
  const n = Number(x)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0
}

export type TermGradeStack = {
  key: string
  year: number
  quarter: string
  qi: number
  /** e.g. Fall 2024 */
  label: string
  /** compact axis tick */
  shortLabel: string
  nLetter: number
  avgGpa: number | null
  A: number
  B: number
  C: number
  D: number
  F: number
  P: number
  NP: number
}

/** Sum letter buckets and weighted mean GPA per calendar term (all instructors combined). */
export function aggregateDistributionByTerm(points: GradeTrendPoint[]): TermGradeStack[] {
  type Acc = {
    year: number
    quarter: string
    A: number
    B: number
    C: number
    D: number
    F: number
    P: number
    NP: number
    nLetter: number
    gpaSum: number
    gpaW: number
  }
  const m = new Map<string, Acc>()
  for (const p of points) {
    const k = `${p.year}|${p.quarter}`
    const cur =
      m.get(k) ??
      ({
        year: p.year,
        quarter: p.quarter,
        A: 0,
        B: 0,
        C: 0,
        D: 0,
        F: 0,
        P: 0,
        NP: 0,
        nLetter: 0,
        gpaSum: 0,
        gpaW: 0,
      } satisfies Acc)
    cur.A += nz(p.a_count)
    cur.B += nz(p.b_count)
    cur.C += nz(p.c_count)
    cur.D += nz(p.d_count)
    cur.F += nz(p.f_count)
    cur.P += nz(p.p_count)
    cur.NP += nz(p.np_count)
    const nl = nz(p.n_letter)
    cur.nLetter += nl
    if (p.avg_gpa != null && nl > 0) {
      cur.gpaSum += p.avg_gpa * nl
      cur.gpaW += nl
    }
    m.set(k, cur)
  }

  const yy = (y: number) => String(y).slice(-2)
  return [...m.values()]
    .map((v) => {
      const qi = quarterIndex(v.quarter)
      const label = `${v.quarter} ${v.year}`
      const shortLabel = `${v.quarter.slice(0, 2)} '${yy(v.year)}`
      return {
        key: `${v.year}|${v.quarter}`,
        year: v.year,
        quarter: v.quarter,
        qi,
        label,
        shortLabel,
        nLetter: v.nLetter,
        avgGpa: v.gpaW > 0 ? v.gpaSum / v.gpaW : null,
        A: v.A,
        B: v.B,
        C: v.C,
        D: v.D,
        F: v.F,
        P: v.P,
        NP: v.NP,
      } satisfies TermGradeStack
    })
    .sort((a, b) => (a.year !== b.year ? a.year - b.year : a.qi - b.qi))
}

export function termLetterTotal(t: TermGradeStack): number {
  return t.A + t.B + t.C + t.D + t.F + t.P + t.NP
}

/** Merge +/- keys from `grade_breakdown_json` for one term. */
export function aggregateBreakdownForTerm(
  points: GradeTrendPoint[],
  year: number,
  quarter: string,
): { key: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const p of points) {
    if (p.year !== year || p.quarter !== quarter) continue
    const j = p.grade_breakdown_json
    if (!j || typeof j !== 'object' || Array.isArray(j)) continue
    for (const [k, v] of Object.entries(j as Record<string, unknown>)) {
      const n = Number(v)
      if (!Number.isFinite(n) || n <= 0) continue
      const kk = k.trim()
      if (!kk) continue
      counts.set(kk, (counts.get(kk) ?? 0) + Math.round(n))
    }
  }
  const order = ['Ap', 'A', 'Am', 'Bp', 'B', 'Bm', 'Cp', 'C', 'Cm', 'Dp', 'D', 'Dm', 'F']
  const out: { key: string; count: number }[] = []
  for (const k of order) {
    const c = counts.get(k)
    if (c && c > 0) out.push({ key: k, count: c })
  }
  for (const [k, c] of counts) {
    if (order.includes(k)) continue
    if (c > 0) out.push({ key: k, count: c })
  }
  return out.sort((a, b) => b.count - a.count)
}

export type StackedChartRow = TermGradeStack & {
  pctA: number
  pctB: number
  pctC: number
  pctD: number
  pctF: number
  pctP: number
  pctNP: number
}

export function toStackedPercentRows(terms: TermGradeStack[]): StackedChartRow[] {
  return terms.map((t) => {
    const tot = termLetterTotal(t)
    const d = tot > 0 ? 100 / tot : 0
    return {
      ...t,
      pctA: t.A * d,
      pctB: t.B * d,
      pctC: t.C * d,
      pctD: t.D * d,
      pctF: t.F * d,
      pctP: t.P * d,
      pctNP: t.NP * d,
    }
  })
}
