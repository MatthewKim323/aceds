import type { GradeTrendPoint } from './api'

export type TrendPoint = {
  k: string
  y: number
  q: string
  qi: number
  gpa: number | null
}

function termKey(y: number, q: string) {
  return `${y} ${q}`
}

export function aggregateTrendByTerm(
  points: GradeTrendPoint[],
): TrendPoint[] {
  const m = new Map<string, { sum: number; w: number }>()
  for (const p of points) {
    if (p.avg_gpa == null || p.n_letter <= 0) continue
    const k = termKey(p.year, p.quarter)
    const cur = m.get(k) ?? { sum: 0, w: 0 }
    cur.sum += p.avg_gpa * p.n_letter
    cur.w += p.n_letter
    m.set(k, cur)
  }
  const order = ['Winter', 'Spring', 'Summer', 'Fall']
  return [...m.entries()]
    .map(([k, v]) => {
      const [ys, q] = k.split(' ')
      const y = Number(ys)
      const qi = order.indexOf(q)
      return { k, y, q, qi, gpa: v.w > 0 ? v.sum / v.w : null }
    })
    .filter((r): r is TrendPoint & { gpa: number } => r.gpa != null)
    .sort((a, b) => (a.y !== b.y ? a.y - b.y : a.qi - b.qi))
}
