import { type OptimizePreferences } from './api'

export const DEFAULT_OPTIMIZE_PREFS: OptimizePreferences = {
  weight_grades: 0.3,
  weight_professor: 0.25,
  weight_convenience: 0.25,
  weight_availability: 0.2,
  target_units_min: 12,
  target_units_max: 17,
  earliest_start: '09:00',
  latest_end: '18:00',
  preferred_days: ['M', 'T', 'W', 'R', 'F'],
  avoid_friday_afternoon: false,
  diversity_lambda: 0.15,
  risk_lambda: 0,
  elective_subject_bonus: 0,
  preferred_elective_prefixes: [],
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

/** Merge partial stored JSON over defaults (handles schema tweaks over time). */
export function mergeOptimizerPreferencePatch(
  patch: unknown,
): OptimizePreferences {
  if (!isPlainObject(patch)) return { ...DEFAULT_OPTIMIZE_PREFS }
  const d = DEFAULT_OPTIMIZE_PREFS
  const num = (x: unknown, fallback: number) =>
    typeof x === 'number' && Number.isFinite(x) ? x : fallback
  const str = (x: unknown, fallback: string) =>
    typeof x === 'string' ? x : fallback
  const strArr = (x: unknown, fallback: string[]) =>
    Array.isArray(x) && x.every((e) => typeof e === 'string')
      ? (x as string[])
      : fallback
  const bool = (x: unknown, fallback: boolean) =>
    typeof x === 'boolean' ? x : fallback

  return {
    weight_grades: num(patch.weight_grades, d.weight_grades),
    weight_professor: num(patch.weight_professor, d.weight_professor),
    weight_convenience: num(patch.weight_convenience, d.weight_convenience),
    weight_availability: num(patch.weight_availability, d.weight_availability),
    target_units_min: num(patch.target_units_min, d.target_units_min),
    target_units_max: num(patch.target_units_max, d.target_units_max),
    earliest_start: str(patch.earliest_start, d.earliest_start),
    latest_end: str(patch.latest_end, d.latest_end),
    preferred_days: strArr(patch.preferred_days, d.preferred_days),
    avoid_friday_afternoon: bool(patch.avoid_friday_afternoon, d.avoid_friday_afternoon),
    diversity_lambda: num(patch.diversity_lambda, d.diversity_lambda),
    risk_lambda:
      patch.risk_lambda === undefined || patch.risk_lambda === null
        ? d.risk_lambda
        : num(patch.risk_lambda, d.risk_lambda ?? 0),
    elective_subject_bonus: num(patch.elective_subject_bonus, d.elective_subject_bonus ?? 0),
    preferred_elective_prefixes: strArr(
      patch.preferred_elective_prefixes,
      d.preferred_elective_prefixes ?? [],
    ),
  }
}

function legacyPriorityWeights(pw: unknown): Partial<OptimizePreferences> {
  if (!isPlainObject(pw)) return {}
  const o = pw as Record<string, unknown>
  const g = o.grades
  const p = o.professor
  const c = o.convenience
  const a = o.availability
  const out: Partial<OptimizePreferences> = {}
  if (typeof g === 'number') out.weight_grades = g
  if (typeof p === 'number') out.weight_professor = p
  if (typeof c === 'number') out.weight_convenience = c
  if (typeof a === 'number') out.weight_availability = a
  return out
}

function dbPreferredPatternToDays(s: string | null | undefined): string[] {
  const d = DEFAULT_OPTIMIZE_PREFS.preferred_days
  if (!s || s === 'no_preference') return [...d]
  if (s === 'mwf') return ['M', 'W', 'F']
  if (s === 'tr') return ['T', 'R']
  return [...d]
}

function targetUnitsToRange(tu: number | null | undefined): {
  target_units_min: number
  target_units_max: number
} {
  const t = tu ?? 16
  return {
    target_units_min: Math.max(4, t - 3),
    target_units_max: Math.min(22, t + 2),
  }
}

/** Build OptimizePreferences from a student_profiles row (Supabase). */
export function profileRowToOptimizePreferences(
  profile: Record<string, unknown> | null | undefined,
): OptimizePreferences {
  if (!profile) return { ...DEFAULT_OPTIMIZE_PREFS }

  const blob = profile.optimizer_preferences
  if (blob != null) {
    return mergeOptimizerPreferencePatch(blob)
  }

  const base = { ...DEFAULT_OPTIMIZE_PREFS }
  Object.assign(base, legacyPriorityWeights(profile.priority_weights))
  if (typeof profile.earliest_class === 'string' && profile.earliest_class) {
    base.earliest_start = profile.earliest_class
  }
  if (typeof profile.preferred_days === 'string') {
    base.preferred_days = dbPreferredPatternToDays(profile.preferred_days)
  }
  if (profile.target_units != null && typeof profile.target_units === 'number') {
    const r = targetUnitsToRange(profile.target_units)
    base.target_units_min = r.target_units_min
    base.target_units_max = r.target_units_max
  }
  return base
}

/** Map preferred day set to legacy TEXT column (best-effort). */
export function preferredDaysToLegacyDb(days: string[]): string {
  const set = new Set(days.map((d) => d.toUpperCase()))
  if (set.size === 3 && set.has('M') && set.has('W') && set.has('F')) return 'mwf'
  if (set.size === 2 && set.has('T') && set.has('R')) return 'tr'
  return 'no_preference'
}

/** Payload for Supabase update: JSON blob + legacy columns kept in sync. */
export function optimizerPreferencesToProfilePatch(prefs: OptimizePreferences): Record<string, unknown> {
  return {
    optimizer_preferences: prefs,
    priority_weights: {
      grades: prefs.weight_grades,
      professor: prefs.weight_professor,
      convenience: prefs.weight_convenience,
      availability: prefs.weight_availability,
    },
    target_units: Math.round((prefs.target_units_min + prefs.target_units_max) / 2),
    earliest_class: prefs.earliest_start,
    preferred_days: preferredDaysToLegacyDb(prefs.preferred_days),
  }
}
