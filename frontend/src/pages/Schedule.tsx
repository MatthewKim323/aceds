import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'motion/react'
import { useAuth } from '../lib/auth'
import { getProfile } from '../lib/profile'
import { getMajorById, type Major } from '../data/majors'
import {
  api,
  type OptimizePreferences,
  type ScheduleCandidate,
  type SectionPick,
} from '../lib/api'
import { toCourseNorm } from '../lib/pdf-parser'

const DEFAULT_PREFS: OptimizePreferences = {
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

const QUARTER_CODE = '20262' // Spring 2026
const QUARTER_LABEL = 'Spring 2026'

const CAL_DAY_ORDER = ['M', 'T', 'W', 'R', 'F'] as const
const CAL_START_MIN = 8 * 60
const CAL_END_MIN = 22 * 60
const CAL_TOTAL_MIN = CAL_END_MIN - CAL_START_MIN

const SECTION_PALETTES = [
  'linear-gradient(135deg, rgba(242,167,184,0.45), rgba(242,167,184,0.12))',
  'linear-gradient(135deg, rgba(94,228,184,0.35), rgba(94,228,184,0.1))',
  'linear-gradient(135deg, rgba(147,197,253,0.4), rgba(147,197,253,0.1))',
  'linear-gradient(135deg, rgba(253,224,71,0.35), rgba(253,224,71,0.1))',
  'linear-gradient(135deg, rgba(196,181,253,0.45), rgba(196,181,253,0.12))',
  'linear-gradient(135deg, rgba(251,146,60,0.35), rgba(251,146,60,0.12))',
]

/** Merge requirement pools from every declared major (profile.major is comma-separated). */
function mergedMajorPool(
  majorIds: string[],
  completedSet: Set<string>,
): { required: string[]; optional: string[]; label: string; invalidIds: string[] } | null {
  if (!majorIds.length) return null
  const invalidIds = majorIds.filter((id) => !getMajorById(id))
  const required: string[] = []
  const optional: string[] = []
  const seenReq = new Set<string>()
  const seenOpt = new Set<string>()
  const labels: string[] = []

  for (const mid of majorIds) {
    const major = getMajorById(mid) as Major | undefined
    if (!major) continue
    labels.push(`${major.name} ${major.degree}`)
    for (const group of major.groups) {
      const groupCourses = group.courses.map((c) => c.id)
      const anyComplete = group.courses.some((c) => {
        const idN = toCourseNorm(c.id)
        const altN = c.alt ? toCourseNorm(c.alt) : null
        return completedSet.has(idN) || (altN != null && completedSet.has(altN))
      })
      if (anyComplete) continue
      if (group.courses.length === 1) {
        const cid = groupCourses[0]
        if (!seenReq.has(cid)) {
          required.push(cid)
          seenReq.add(cid)
        }
      } else {
        for (const cid of groupCourses) {
          if (!seenOpt.has(cid)) {
            optional.push(cid)
            seenOpt.add(cid)
          }
        }
      }
    }
  }

  if (!labels.length && invalidIds.length === majorIds.length) return null
  return {
    required,
    optional,
    label: labels.join(' · ') || 'Declared majors',
    invalidIds,
  }
}

function isStatsDataMajor(majorIds: string[]): boolean {
  return majorIds.some((id) =>
    /statistics|data_science|stats_ds|pstat/i.test(id),
  )
}

/** UI ordering only — stats/data majors see DS-flavored electives first in the chip list. */
function prioritizeOptionalForPool(majorIds: string[], optional: string[]): string[] {
  if (!isStatsDataMajor(majorIds)) return optional
  const score = (c: string) => {
    const u = c.toUpperCase()
    let s = 0
    if (u.startsWith('PSTAT') || u.startsWith('STATS')) s += 120
    if (u.startsWith('CMPSC')) s += 100
    if (u.startsWith('MATH')) s += 55
    if (u.startsWith('DATA')) s += 70
    if (u.startsWith('ECON')) s -= 50
    return s
  }
  return [...optional].sort((a, b) => score(b) - score(a))
}

/**
 * When the student’s majors look stats/DS and they haven’t set a manual bump,
 * nudge optional PSTAT/CMPSC/MATH-style electives in the MILP objective.
 */
function effectiveOptimizePrefs(
  majorIds: string[],
  p: OptimizePreferences,
): OptimizePreferences {
  if (!isStatsDataMajor(majorIds)) return p
  const manualBonus = p.elective_subject_bonus != null && p.elective_subject_bonus > 0
  const manualPfx = (p.preferred_elective_prefixes?.length ?? 0) > 0
  if (manualBonus || manualPfx) return p
  return {
    ...p,
    preferred_elective_prefixes: ['PSTAT', 'CMPSC', 'MATH', 'STATS'],
    elective_subject_bonus: 0.12,
  }
}

function parseTimeToMin(t: string | null): number | null {
  if (!t) return null
  const parts = String(t).split(':')
  const h = Number(parts[0])
  const m = Number(parts[1] ?? 0)
  if (!Number.isFinite(h)) return null
  return h * 60 + (Number.isFinite(m) ? m : 0)
}

function parseDayLetters(days: string | null): string[] {
  if (!days) return []
  const allow = new Set(['M', 'T', 'W', 'R', 'F', 'S', 'U'])
  return [...days.toUpperCase()].filter((c) => allow.has(c))
}

function colorIndexForSection(s: SectionPick, i: number): number {
  let h = 0
  for (let k = 0; k < s.enroll_code.length; k++) h = (h + s.enroll_code.charCodeAt(k) * (k + 1)) % 997
  return (h + i) % SECTION_PALETTES.length
}

function CalendarWeekGrid({ sections }: { sections: SectionPick[] }) {
  const hasTimes = sections.some(
    (s) => parseTimeToMin(s.begin_time) != null && parseTimeToMin(s.end_time) != null,
  )
  if (!hasTimes) {
    return (
      <p className="sb-cal-fallback">
        No timed meetings parsed for this quarter — calendar preview unavailable.
      </p>
    )
  }

  return (
    <div className="sb-cal" aria-hidden>
      <div className="sb-cal-inner">
        <div className="sb-cal-time-rail" />
        <div className="sb-cal-board">
          <div className="sb-cal-head">
            {CAL_DAY_ORDER.map((d) => (
              <div key={d} className="sb-cal-dh">
                {d}
              </div>
            ))}
          </div>
          <div className="sb-cal-body">
            {CAL_DAY_ORDER.map((day) => (
              <div key={day} className="sb-cal-col">
                <div className="sb-cal-grid-lines">
                  {Array.from({ length: 14 }, (_, h) => (
                    <div key={h} className="sb-cal-hour-line" />
                  ))}
                </div>
                <div className="sb-cal-blocks">
                  {sections.flatMap((s, si) => {
                    const begin = parseTimeToMin(s.begin_time)
                    const end = parseTimeToMin(s.end_time)
                    if (begin == null || end == null || end <= begin) return []
                    if (!parseDayLetters(s.days).includes(day)) return []
                    const top = ((begin - CAL_START_MIN) / CAL_TOTAL_MIN) * 100
                    const hPct = Math.max(((end - begin) / CAL_TOTAL_MIN) * 100, 3)
                    const clippedTop = Math.max(0, Math.min(100 - hPct, top))
                    const clippedH = Math.min(hPct, 100 - clippedTop)
                    const bg = SECTION_PALETTES[colorIndexForSection(s, si)]
                    return (
                      <div
                        key={`${s.enroll_code}-${day}`}
                        className="sb-cal-block"
                        style={{
                          top: `${clippedTop}%`,
                          height: `${clippedH}%`,
                          background: bg,
                        }}
                        title={`${s.course_norm} · ${s.begin_time ?? ''}–${s.end_time ?? ''}`}
                      >
                        <span className="sb-cal-block-code">{s.course_norm}</span>
                        <span className="sb-cal-block-time">
                          {s.begin_time?.slice(0, 5)}–{s.end_time?.slice(0, 5)}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="sb-cal-axis-labels">
        <span>8:00</span>
        <span>12:00</span>
        <span>18:00</span>
        <span>22:00</span>
      </div>
    </div>
  )
}

export function Schedule() {
  const { user, loading: authLoading } = useAuth()
  const [majorIds, setMajorIds] = useState<string[]>([])
  const [completedSet, setCompletedSet] = useState<Set<string>>(new Set())

  const [requiredCourses, setRequiredCourses] = useState<string[]>([])
  const [optionalCourses, setOptionalCourses] = useState<string[]>([])
  const [excludedCourses, setExcludedCourses] = useState<Set<string>>(new Set())
  const [prefs, setPrefs] = useState<OptimizePreferences>(DEFAULT_PREFS)
  const [running, setRunning] = useState(false)
  const [candidates, setCandidates] = useState<ScheduleCandidate[]>([])
  const [error, setError] = useState<string | null>(null)
  const [optimizeReturnedEmpty, setOptimizeReturnedEmpty] = useState(false)
  const [resultsModalOpen, setResultsModalOpen] = useState(false)

  const closeResultsModal = useCallback(() => setResultsModalOpen(false), [])

  useEffect(() => {
    if (!user) return
    getProfile(user.id).then(({ profile }) => {
      if (!profile) return
      const p = profile as unknown as {
        major: string
        completed_courses: string[]
      }
      const ids =
        p.major
          ?.split(',')
          .map((s) => s.trim())
          .filter(Boolean) ?? []
      setMajorIds(ids)
      setCompletedSet(
        new Set((p.completed_courses || []).map((c) => toCourseNorm(String(c)))),
      )
    })
  }, [user])

  const majorDerived = useMemo(
    () => mergedMajorPool(majorIds, completedSet),
    [majorIds, completedSet],
  )

  useEffect(() => {
    if (!majorDerived) return
    setRequiredCourses(majorDerived.required.slice(0, 4))
    setOptionalCourses(prioritizeOptionalForPool(majorIds, majorDerived.optional))
  }, [majorDerived, majorIds])

  async function runOptimizer() {
    if (!majorIds.length || !user) return
    setRunning(true)
    setError(null)
    setOptimizeReturnedEmpty(false)
    try {
      const mergedPrefs = effectiveOptimizePrefs(majorIds, {
        ...prefs,
        risk_lambda: prefs.risk_lambda ?? 0,
      })
      const resp = await api.optimize({
        quarter_code: QUARTER_CODE,
        major_id: majorIds[0] ?? '',
        required_courses: requiredCourses,
        optional_courses: optionalCourses,
        excluded_courses: Array.from(excludedCourses),
        completed_courses: Array.from(completedSet),
        preferences: mergedPrefs,
        top_k: 3,
        user_id: user.id,
      })
      setCandidates(resp.candidates)
      setOptimizeReturnedEmpty(resp.candidates.length === 0)
      if (resp.candidates.length > 0) setResultsModalOpen(true)
    } catch (e) {
      setError(String((e as Error).message || e))
      setCandidates([])
      setOptimizeReturnedEmpty(false)
    } finally {
      setRunning(false)
    }
  }

  const canOptimize =
    Boolean(majorIds.length) &&
    (requiredCourses.length > 0 || optionalCourses.length > 0)

  if (authLoading) return null
  if (!user) return <Navigate to="/auth" replace />

  return (
    <div className="sb">
      <header className="sb-header">
        <div>
          <Link to="/dashboard" className="sb-back">&larr; dashboard</Link>
          <h1 className="sb-title">Schedule Builder</h1>
          <p className="sb-sub">
            {majorDerived ? `${majorDerived.label} · ${QUARTER_LABEL}` : QUARTER_LABEL}
            {' · optimizing across '}<span className="sb-accent">
              {requiredCourses.length} required + {optionalCourses.length} electives
            </span>
          </p>
          {majorDerived && majorDerived.invalidIds.length > 0 && (
            <p className="sb-run-hint">
              Not in bundled catalog (skipped):{' '}
              <code className="sb-code">{majorDerived.invalidIds.join(', ')}</code>
            </p>
          )}
          <p className="sb-disclaimer" role="note">
            Predicted GPA is a <strong>section mean</strong> from historical data, not your personal
            expected grade. Each section shows <strong>μ</strong>, a <strong>[lo, hi]</strong> symmetric
            interval (split conformal on val when calibrated; else Gaussian fallback), and a cold-start{' '}
            <strong>regime</strong>. σ is the test RMSE bucket from the model card. Major
            pools here are a <strong>simplified demo</strong> (e.g. “pick N of M” groups become electives;
            at most four auto-required courses) — not a degree audit.
          </p>
          {!canOptimize && (
            <p className="sb-run-hint">
              {majorIds.length === 0 ? (
                <>
                  Add a major in <Link to="/settings">Settings</Link> or finish onboarding — the optimizer needs a
                  curriculum bundle.
                </>
              ) : !majorDerived ? (
                <>
                  None of your declared ids matched bundled majors:{' '}
                  <code className="sb-code">{majorIds.join(', ')}</code> — check spelling against{' '}
                  <code className="sb-code">majors.ts</code> (e.g. <code className="sb-code">econ_ba</code>).
                </>
              ) : (
                <>
                  Every auto-tracked requirement group looks satisfied for this demo, so there are no candidate
                  courses. Adjust completed courses in Settings or choose another major to try Schedule Builder.
                </>
              )}
            </p>
          )}
        </div>
        <div className="sb-header-actions">
          {candidates.length > 0 && (
            <button
              type="button"
              className="sb-view-results"
              onClick={() => setResultsModalOpen(true)}
            >
              View schedules
            </button>
          )}
          <button
            className="sb-run"
            onClick={runOptimizer}
            disabled={running || !canOptimize}
          >
            {running ? 'solving…' : 'Optimize →'}
          </button>
        </div>
      </header>

      <section className="sb-pane sb-prefs">
        <h2 className="sb-pane-title">Preferences</h2>

        <div className="sb-prefs-grid">
          <Weight
            label="Grades"
            value={prefs.weight_grades}
            onChange={(v) => setPrefs({ ...prefs, weight_grades: v })}
          />
          <Weight
            label="Professor"
            value={prefs.weight_professor}
            onChange={(v) => setPrefs({ ...prefs, weight_professor: v })}
          />
          <Weight
            label="Convenience"
            value={prefs.weight_convenience}
            onChange={(v) => setPrefs({ ...prefs, weight_convenience: v })}
          />
          <Weight
            label="Availability"
            value={prefs.weight_availability}
            onChange={(v) => setPrefs({ ...prefs, weight_availability: v })}
          />
        </div>

        <div className="sb-row">
          <label className="sb-field">
            <span>Target units</span>
            <div className="sb-range-pair">
              <input
                type="number"
                min={4}
                max={22}
                value={prefs.target_units_min}
                onChange={(e) => setPrefs({ ...prefs, target_units_min: Number(e.target.value) })}
              />
              <span className="sb-dash">—</span>
              <input
                type="number"
                min={4}
                max={22}
                value={prefs.target_units_max}
                onChange={(e) => setPrefs({ ...prefs, target_units_max: Number(e.target.value) })}
              />
            </div>
          </label>
          <label className="sb-field">
            <span>Earliest start</span>
            <input
              type="time"
              value={prefs.earliest_start}
              onChange={(e) => setPrefs({ ...prefs, earliest_start: e.target.value })}
            />
          </label>
          <label className="sb-field">
            <span>Latest end</span>
            <input
              type="time"
              value={prefs.latest_end}
              onChange={(e) => setPrefs({ ...prefs, latest_end: e.target.value })}
            />
          </label>
          <label className="sb-field sb-field-check">
            <input
              type="checkbox"
              checked={prefs.avoid_friday_afternoon}
              onChange={(e) => setPrefs({ ...prefs, avoid_friday_afternoon: e.target.checked })}
            />
            <span>Skip Fri afternoons</span>
          </label>
        </div>

        <div className="sb-row">
          <label className="sb-field sb-field-wide">
            <span>Risk aversion λ (grade term)</span>
            <div className="sb-risk-row">
              <input
                type="range"
                min={0}
                max={1.5}
                step={0.05}
                value={prefs.risk_lambda ?? 0}
                onChange={(e) =>
                  setPrefs({ ...prefs, risk_lambda: Number(e.target.value) })
                }
              />
              <span className="sb-risk-val">{(prefs.risk_lambda ?? 0).toFixed(2)}</span>
            </div>
            <small className="sb-hint-inline">
              Optimizer uses effective GPA ≈ μ − λ·half-width on the grade axis (PuLP objective only).
            </small>
          </label>
        </div>

        <div className="sb-row">
          <span className="sb-field-label">Days</span>
          {(['M', 'T', 'W', 'R', 'F', 'S'] as const).map((d) => {
            const active = prefs.preferred_days.includes(d)
            return (
              <button
                key={d}
                className={`sb-day ${active ? 'on' : ''}`}
                onClick={() => {
                  const set = new Set(prefs.preferred_days)
                  if (active) set.delete(d)
                  else set.add(d)
                  setPrefs({ ...prefs, preferred_days: Array.from(set) })
                }}
              >
                {d}
              </button>
            )
          })}
        </div>
      </section>

      {majorDerived && (
        <section className="sb-pane">
          <h2 className="sb-pane-title">Courses in the pool</h2>
          <div className="sb-course-pool">
            {requiredCourses.map((c) => (
              <span key={c} className="sb-course-chip required">
                {c} <small>required</small>
              </span>
            ))}
            {optionalCourses.map((c) => (
              <button
                key={c}
                className={`sb-course-chip ${excludedCourses.has(c) ? 'excluded' : 'optional'}`}
                onClick={() => {
                  const n = new Set(excludedCourses)
                  if (n.has(c)) n.delete(c); else n.add(c)
                  setExcludedCourses(n)
                }}
              >
                {c} <small>{excludedCourses.has(c) ? 'skip' : 'elective'}</small>
              </button>
            ))}
          </div>
        </section>
      )}

      <AnimatePresence mode="wait">
        {error && (
          <motion.div
            key="err"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="sb-error"
          >
            <strong>Optimizer unavailable.</strong>
            <p>{error}</p>
            <p className="sb-hint">
              This page calls <code>POST /optimize</code> on the FastAPI backend. Start it with
              <code> uvicorn app.main:app --reload </code> and load section data via
              <code> data_pipeline/scripts/07_load_to_supabase.py</code>.
            </p>
          </motion.div>
        )}
        {optimizeReturnedEmpty && !error && (
          <motion.section
            key="empty"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="sb-empty-result"
          >
            <h2 className="sb-pane-title">No feasible schedules</h2>
            <p>
              The solver returned <strong>zero</strong> schedules. Typical causes: target units (min/max) can’t be met
              with your pool; every section conflicts on the calendar; required courses have no rows in Supabase for{' '}
              <code className="sb-code">{QUARTER_CODE}</code>; or you excluded every elective you needed for units.
            </p>
            <p className="sb-hint">
              Try widening <strong>target units</strong>, relaxing times/days, un-excluding electives, or confirm{' '}
              <code className="sb-code">07_load_to_supabase.py</code> loaded sections for these courses.
            </p>
          </motion.section>
        )}
      </AnimatePresence>

      <OptimizeResultsModal
        open={resultsModalOpen}
        onClose={closeResultsModal}
        candidates={candidates}
      />
    </div>
  )
}

function OptimizeResultsModal({
  open,
  onClose,
  candidates,
}: {
  open: boolean
  onClose: () => void
  candidates: ScheduleCandidate[]
}) {
  return (
    <AnimatePresence>
      {open && candidates.length > 0 && (
        <motion.div
          className="sb-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="sb-modal-title"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            className="sb-modal"
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ type: 'spring', damping: 26, stiffness: 320 }}
            onClick={(e) => e.stopPropagation()}
          >
            <header className="sb-modal-head">
              <div>
                <h2 id="sb-modal-title" className="sb-modal-title">
                  Top {candidates.length} schedules
                </h2>
                <p className="sb-modal-sub">
                  Week view + predicted grades, Nexus historical GPA where available, and Rate My Professor fields.
                </p>
              </div>
              <button type="button" className="sb-modal-close" onClick={onClose}>
                Close
              </button>
            </header>
            <div className="sb-modal-scroll">
              <div className="sb-cand-grid">
                {candidates.map((cand, i) => (
                  <CandidateCard key={i} rank={i + 1} cand={cand} />
                ))}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function Weight({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (n: number) => void
}) {
  return (
    <label className="sb-weight">
      <div className="sb-weight-head">
        <span>{label}</span>
        <span className="sb-weight-val">{(value * 100).toFixed(0)}%</span>
      </div>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  )
}

function CandidateCard({ rank, cand }: { rank: number; cand: ScheduleCandidate }) {
  const avgGpa =
    cand.sections.filter((s) => s.predicted_gpa !== null).reduce(
      (a, s) => a + (s.predicted_gpa ?? 0),
      0,
    ) / Math.max(1, cand.sections.filter((s) => s.predicted_gpa !== null).length)
  return (
    <motion.article
      className="sb-cand"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: rank * 0.05 }}
    >
      <header className="sb-cand-head">
        <span className="sb-cand-rank">#{rank}</span>
        <div>
          <div className="sb-cand-score">{cand.score.toFixed(3)}</div>
          <div className="sb-cand-sub">
            {cand.total_units}u · predicted GPA ≈ {avgGpa.toFixed(2)}
          </div>
        </div>
      </header>

      <CalendarWeekGrid sections={cand.sections} />

      <ul className="sb-cand-sections">
        {cand.sections.map((s) => (
          <SectionRow key={s.enroll_code} s={s} />
        ))}
      </ul>
    </motion.article>
  )
}

function SectionRow({ s }: { s: SectionPick }) {
  const regime = s.regime ?? '—'
  const sigma =
    s.predicted_gpa_std != null && s.predicted_gpa_std !== undefined
      ? s.predicted_gpa_std.toFixed(3)
      : '—'
  const band =
    s.gpa_lo != null && s.gpa_hi != null
      ? `[${s.gpa_lo.toFixed(2)}, ${s.gpa_hi.toFixed(2)}]`
      : '—'
  const tip = `Regime: ${regime}. Interval is symmetric around μ (conformal or Gaussian fallback). σ is test RMSE bucket — see MODEL_CARD.`

  const courseHist =
    s.course_hist_avg_gpa != null && s.course_hist_avg_gpa !== undefined
      ? `Course avg ${s.course_hist_avg_gpa.toFixed(2)}${s.course_hist_n_letter != null ? ` · n=${s.course_hist_n_letter}` : ''}`
      : null
  const pairHist =
    s.pair_hist_avg_gpa != null && s.pair_hist_avg_gpa !== undefined
      ? `This instructor · course ${s.pair_hist_avg_gpa.toFixed(2)}${s.pair_hist_n_letter != null ? ` · n=${s.pair_hist_n_letter}` : ''}`
      : null

  const rmpExtra =
    s.rmp_rating != null && s.rmp_rating !== undefined
      ? [
          `RMP ${s.rmp_rating.toFixed(1)}`,
          s.rmp_num_ratings != null ? `${s.rmp_num_ratings} ratings` : null,
          s.rmp_difficulty != null ? `diff ${s.rmp_difficulty.toFixed(1)}` : null,
        ]
          .filter(Boolean)
          .join(' · ')
      : null

  return (
    <li className="sb-sec">
      <div className="sb-sec-main">
        <span className="sb-sec-code">{s.course_norm}</span>
        <span className="sb-sec-prof">{s.instructor_norm ?? 'TBA'}</span>
      </div>
      <div className="sb-sec-meta" title={tip}>
        <span>{s.days ?? 'TBA'}</span>
        <span>
          {s.begin_time ?? '—'}–{s.end_time ?? '—'}
        </span>
        {s.predicted_gpa !== null && (
          <span className="sb-sec-gpa">μ {s.predicted_gpa?.toFixed(2)}</span>
        )}
        <span className="sb-sec-band" title={tip}>
          {band}
        </span>
        <span className="sb-sec-regime">{regime}</span>
        <span className="sb-sec-sigma">σ {sigma}</span>
        {rmpExtra && <span className="sb-sec-rmp">{rmpExtra}</span>}
      </div>
      {(courseHist || pairHist) && (
        <div className="sb-sec-hist">
          {courseHist && <span>{courseHist} (Nexus distributions)</span>}
          {pairHist && <span>{pairHist}</span>}
        </div>
      )}
    </li>
  )
}
