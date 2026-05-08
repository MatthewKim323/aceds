import type { CatalogMeta } from './api'

/** UCSB-style quarter codes: YYYY + Q (1=W 2=Sp 3=Su 4=F). */
export function quarterMenu(): { code: string; label: string }[] {
  const names: Record<number, string> = {
    1: 'Winter',
    2: 'Spring',
    3: 'Summer',
    4: 'Fall',
  }
  const out: { code: string; label: string }[] = []
  for (let y = 2028; y >= 2023; y--) {
    for (const q of [4, 3, 2, 1] as const) {
      out.push({ code: `${y}${q}`, label: `${names[q]} ${y}` })
    }
  }
  return out
}

export const QUARTER_MENU_OPTIONS = quarterMenu()

export function quarterLabelFromCode(code: string): string {
  if (code.length !== 5 || !/^\d{5}$/.test(code)) return code
  const y = parseInt(code.slice(0, 4), 10)
  const q = parseInt(code.slice(4), 10)
  const names: Record<number, string> = {
    1: 'Winter',
    2: 'Spring',
    3: 'Summer',
    4: 'Fall',
  }
  return `${names[q] ?? `Q${q}`} ${y}`
}

export function quarterSelectOptions(meta: CatalogMeta | null): { code: string; label: string }[] {
  const base = [...QUARTER_MENU_OPTIONS]
  if (meta?.quarter && !base.some((o) => o.code === meta.quarter)) {
    base.unshift({ code: meta.quarter, label: meta.label || meta.quarter })
  }
  return base
}
