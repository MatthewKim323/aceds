import { useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { api, type GradeTrendPoint, type ScheduleCandidate, type SectionPick } from '../lib/api'
import { aggregateTrendByTerm, type TrendPoint } from '../lib/grade-trend'
import { GradeDistributionViz } from './GradeDistributionViz'
import { blendPersonalPredictedGpa } from '../lib/personalized-gpa'
import { insertSavedSchedule } from '../lib/saved-schedules'

const CAL_DAY_ORDER = ['M', 'T', 'W', 'R', 'F'] as const
const CAL_START_MIN = 8 * 60
const CAL_END_MIN = 22 * 60
const CAL_TOTAL_MIN = CAL_END_MIN - CAL_START_MIN
/** Hour bands shown in the rail (8:00–8:59 … 9:00–9:59 … through 21:xx). */
const CAL_FIRST_HOUR = 8
const CAL_LAST_HOUR = 21

const SECTION_PALETTES = [
  'linear-gradient(135deg, rgba(242,167,184,0.45), rgba(242,167,184,0.12))',
  'linear-gradient(135deg, rgba(94,228,184,0.35), rgba(94,228,184,0.1))',
  'linear-gradient(135deg, rgba(147,197,253,0.4), rgba(147,197,253,0.1))',
  'linear-gradient(135deg, rgba(253,224,71,0.35), rgba(253,224,71,0.1))',
  'linear-gradient(135deg, rgba(196,181,253,0.45), rgba(196,181,253,0.12))',
  'linear-gradient(135deg, rgba(251,146,60,0.35), rgba(251,146,60,0.12))',
]

/** Minutes since midnight from UCSB-style or ISO clock strings. */
function parseTimeToMin(t: string | null): number | null {
  if (!t) return null
  let s = String(t).trim()
  if (!s || /^tba$/i.test(s)) return null
  const iso = s.match(/T(\d{1,2}):(\d{2})(?::(\d{2}))?/)
  if (iso) {
    const h = Number(iso[1])
    const m = Number(iso[2])
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null
    return h * 60 + m
  }
  const ampm = s.match(/^(\d{1,2}):(\d{2})\s*([AP])\.?M\.?$/i)
  if (ampm) {
    let h = Number(ampm[1])
    const m = Number(ampm[2])
    const ap = ampm[3].toUpperCase()
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null
    if (ap === 'P' && h < 12) h += 12
    if (ap === 'A' && h === 12) h = 0
    return h * 60 + m
  }
  const parts = s.split(':')
  const h = Number(parts[0])
  const m = Number(parts[1] ?? 0)
  if (!Number.isFinite(h)) return null
  return h * 60 + (Number.isFinite(m) ? m : 0)
}

/**
 * UCSB / GOLD weekday codes into calendar columns (Thu = R).
 * Handles spaced "T R", glued TR/TUTH, and Tu/Th spellings.
 */
function parseDayLetters(days: string | null): string[] {
  if (!days) return []
  const raw = String(days).trim().toUpperCase()
  if (!raw || raw === 'TBA') return []
  const compact = raw.replace(/\s+/g, '')
  const out: string[] = []
  let i = 0
  while (i < compact.length) {
    if (compact.startsWith('TUE', i)) {
      out.push('T')
      i += 3
      continue
    }
    if (compact.startsWith('THU', i)) {
      out.push('R')
      i += 3
      continue
    }
    if (compact.startsWith('MON', i)) {
      out.push('M')
      i += 3
      continue
    }
    if (compact.startsWith('WED', i)) {
      out.push('W')
      i += 3
      continue
    }
    if (compact.startsWith('FRI', i)) {
      out.push('F')
      i += 3
      continue
    }
    if (compact.startsWith('TU', i)) {
      out.push('T')
      i += 2
      continue
    }
    if (compact.startsWith('TH', i)) {
      out.push('R')
      i += 2
      continue
    }
    const c = compact[i]
    if (c === 'M' || c === 'W' || c === 'F') {
      out.push(c)
      i += 1
      continue
    }
    if (c === 'T') {
      out.push('T')
      i += 1
      continue
    }
    if (c === 'R') {
      out.push('R')
      i += 1
      continue
    }
    i += 1
  }
  const seen = new Set<string>()
  const uniq: string[] = []
  for (const d of CAL_DAY_ORDER) {
    if (out.includes(d) && !seen.has(d)) {
      seen.add(d)
      uniq.push(d)
    }
  }
  return uniq
}

function colorIndexForSection(s: SectionPick, i: number): number {
  let h = 0
  for (let k = 0; k < s.enroll_code.length; k++) h = (h + s.enroll_code.charCodeAt(k) * (k + 1)) % 997
  return (h + i) % SECTION_PALETTES.length
}

function formatClock(t: string | null): string {
  const mins = parseTimeToMin(t)
  if (mins == null) return '—'
  const d = new Date()
  d.setHours(Math.floor(mins / 60), mins % 60, 0, 0)
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

function CalendarWeekGrid({ sections }: { sections: SectionPick[] }) {
  const hasTimes = sections.some(
    (s) => parseTimeToMin(s.begin_time) != null && parseTimeToMin(s.end_time) != null,
  )
  if (!hasTimes) {
    return (
      <p className="sb-cal-fallback sb-cal-fallback--modal">
        No timed meetings for this schedule — calendar preview unavailable.
      </p>
    )
  }

  const hourRows = Array.from(
    { length: CAL_LAST_HOUR - CAL_FIRST_HOUR + 1 },
    (_, i) => CAL_FIRST_HOUR + i,
  )

  return (
    <div className="sb-cal sb-cal--modal" role="region" aria-label="Weekly schedule for this candidate">
      <div className="sb-cal-grid-wrap">
        <div className="sb-cal-corner" aria-hidden />
        {CAL_DAY_ORDER.map((d) => (
          <div key={d} className="sb-cal-dh">
            {d}
          </div>
        ))}
        <div className="sb-cal-time-rail" aria-hidden>
          {hourRows.map((hr) => {
            const d = new Date()
            d.setHours(hr, 0, 0, 0)
            const lab = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
            return (
              <div key={hr} className="sb-cal-hour-cell">
                <span className="sb-cal-hour-label">{lab}</span>
              </div>
            )
          })}
        </div>
        {CAL_DAY_ORDER.map((day) => (
          <div key={day} className="sb-cal-col">
            <div className="sb-cal-grid-lines">
              {hourRows.map((h) => (
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
                const hPct = Math.max(((end - begin) / CAL_TOTAL_MIN) * 100, 4.5)
                const clippedTop = Math.max(0, Math.min(100 - hPct, top))
                const clippedH = Math.min(hPct, 100 - clippedTop)
                const bg = SECTION_PALETTES[colorIndexForSection(s, si)]
                const cn = (s.course_norm || '').trim().toUpperCase()
                const secLabel = (s.section_label || '').trim()
                const timeLine = `${formatClock(s.begin_time)}–${formatClock(s.end_time)}`
                return (
                  <div
                    key={`${s.enroll_code}-${day}`}
                    className="sb-cal-block"
                    style={{
                      top: `${clippedTop}%`,
                      height: `${clippedH}%`,
                      background: bg,
                    }}
                    title={`${cn} · ${timeLine}`}
                  >
                    <span className="sb-cal-block-code">{cn || 'Course'}</span>
                    {secLabel ? <span className="sb-cal-block-sec">Sec {secLabel}</span> : null}
                    <span className="sb-cal-block-time">{timeLine}</span>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="sb-cal-axis-foot">
        <span className="sb-cal-axis-spacer" aria-hidden />
        <div className="sb-cal-axis-labels">
          <span>8:00</span>
          <span>12:00</span>
          <span>18:00</span>
          <span>10:00 p.m.</span>
        </div>
      </div>
    </div>
  )
}

function RmpBlock({ s }: { s: SectionPick }) {
  if (s.rmp_rating == null || s.rmp_rating <= 0) {
    return <span className="sb-rmp-muted">No RMP data</span>
  }
  const filled = Math.min(5, Math.max(0, Math.round(s.rmp_rating)))
  return (
    <div className="sb-rmp-block">
      <span className="sb-rmp-stars" aria-hidden>
        {'★'.repeat(filled)}
        {'☆'.repeat(5 - filled)}
      </span>
      <span className="sb-rmp-num">{s.rmp_rating.toFixed(1)}</span>
      {s.rmp_num_ratings != null && s.rmp_num_ratings > 0 ? (
        <span className="sb-rmp-n">({s.rmp_num_ratings} ratings)</span>
      ) : null}
      {s.rmp_difficulty != null ? (
        <span className="sb-rmp-diff">difficulty {s.rmp_difficulty.toFixed(1)}</span>
      ) : null}
    </div>
  )
}

function TrendSpark({ bars }: { bars: TrendPoint[] }) {
  if (bars.length === 0) return <p className="sb-trend-empty">No historical grade rows for this course.</p>
  return (
    <div className="sb-spark" role="img" aria-label="Historical mean GPA by term">
      {bars.map((b) => {
        const h = b.gpa != null ? Math.round(((b.gpa - 2) / 2) * 100) : 0
        return (
          <div key={b.k} className="sb-spark-cell" title={`${b.k}: ${b.gpa?.toFixed(2)}`}>
            <div className="sb-spark-bar" style={{ height: `${Math.min(100, Math.max(8, h))}%` }} />
            <span className="sb-spark-label">{b.q.slice(0, 1)}</span>
          </div>
        )
      })}
    </div>
  )
}

type Props = {
  open: boolean
  onClose: () => void
  candidates: ScheduleCandidate[]
  quarterCode: string
  quarterLabel: string
  courseGrades: Record<string, string>
  cumulativeGpa: number | null
  userId: string
  onSaved?: () => void
}

export function ScheduleOptimizeResults({
  open,
  onClose,
  candidates,
  quarterCode,
  quarterLabel,
  courseGrades,
  cumulativeGpa,
  userId,
  onSaved,
}: Props) {
  const [index, setIndex] = useState(0)
  const [trendRaw, setTrendRaw] = useState<Map<string, GradeTrendPoint[]>>(new Map())
  const [trendsLoading, setTrendsLoading] = useState(false)
  const [saveBusy, setSaveBusy] = useState(false)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)

  const n = candidates.length
  const active = n > 0 ? candidates[Math.min(index, n - 1)] : null

  const trendBarsByCourse = useMemo(() => {
    const m = new Map<string, TrendPoint[]>()
    for (const [cn, pts] of trendRaw) {
      m.set(cn, aggregateTrendByTerm(pts))
    }
    return m
  }, [trendRaw])

  useEffect(() => {
    setIndex(0)
    setSaveMsg(null)
  }, [candidates])

  useEffect(() => {
    if (!open || !active) return
    const norms = [...new Set(active.sections.map((s) => s.course_norm))]
    let cancelled = false
    setTrendsLoading(true)
    Promise.all(
      norms.map((cn) => api.getGradeTrend(cn).then((r) => [cn, r.points] as const)),
    )
      .then((rows) => {
        if (cancelled) return
        setTrendRaw(new Map(rows))
      })
      .catch(() => {
        if (!cancelled) setTrendRaw(new Map())
      })
      .finally(() => {
        if (!cancelled) setTrendsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, active])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') setIndex((i) => Math.max(0, i - 1))
      if (e.key === 'ArrowRight') setIndex((i) => Math.min(n - 1, i + 1))
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, n, onClose])

  /** Lenis smooth-scroll steals wheel events; lock document + opt out so the modal body scrolls natively. */
  useEffect(() => {
    if (!open) return
    const prevBody = document.body.style.overflow
    const prevHtml = document.documentElement.style.overflow
    document.body.style.overflow = 'hidden'
    document.documentElement.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prevBody
      document.documentElement.style.overflow = prevHtml
    }
  }, [open])

  const saveActive = useCallback(async () => {
    if (!active || !userId) return
    setSaveBusy(true)
    setSaveMsg(null)
    try {
      await insertSavedSchedule({
        userId,
        quarterCode,
        candidate: active,
        rankInRun: index + 1,
        label: `${quarterLabel} · rank #${index + 1}`,
      })
      setSaveMsg('Saved to your history.')
      onSaved?.()
    } catch (e) {
      setSaveMsg(String((e as Error).message || e))
    } finally {
      setSaveBusy(false)
    }
  }, [active, userId, quarterCode, quarterLabel, index, onSaved])

  return (
    <AnimatePresence>
      {open && n > 0 && active && (
        <motion.div
          className="sb-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="sb-res-title"
          data-lenis-prevent
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            className="sb-modal sb-modal--results"
            data-lenis-prevent
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ type: 'spring', damping: 26, stiffness: 320 }}
            onClick={(e) => e.stopPropagation()}
          >
            <header className="sb-res-head">
              <div>
                <h2 id="sb-res-title" className="sb-modal-title">
                  Optimized schedules
                </h2>
                <p className="sb-modal-sub">
                  {quarterLabel} · full week view · historical distributions · personalized GPA blend
                </p>
              </div>
              <button type="button" className="sb-modal-close" onClick={onClose}>
                Close
              </button>
            </header>

            <div className="sb-res-toolbar" aria-label={`Schedule ${index + 1} of ${n}`}>
              <button
                type="button"
                className="sb-res-arrow"
                disabled={index <= 0}
                onClick={() => setIndex((i) => Math.max(0, i - 1))}
                aria-label="Previous schedule"
              >
                ←
              </button>
              <div className="sb-res-progress">
                <span className="sb-res-count">
                  Schedule {index + 1} / {n}
                </span>
                <div className="sb-res-dots" role="tablist" aria-label="Choose schedule">
                  {candidates.map((_, i) => (
                    <button
                      key={i}
                      type="button"
                      role="tab"
                      aria-selected={i === index}
                      className={`sb-res-dot ${i === index ? 'sb-res-dot--on' : ''}`}
                      onClick={() => setIndex(i)}
                    />
                  ))}
                </div>
              </div>
              <button
                type="button"
                className="sb-res-arrow"
                disabled={index >= n - 1}
                onClick={() => setIndex((i) => Math.min(n - 1, i + 1))}
                aria-label="Next schedule"
              >
                →
              </button>
            </div>

            <div className="sb-res-meta-row">
              <div className="sb-res-score-pill">
                <span className="sb-res-score">{active.score.toFixed(3)}</span>
                <span className="sb-res-units">{active.total_units} units</span>
              </div>
              <button
                type="button"
                className="sb-res-save"
                disabled={saveBusy}
                onClick={() => void saveActive()}
              >
                {saveBusy ? 'Saving…' : 'Save to history'}
              </button>
              {saveMsg ? <span className="sb-res-save-msg">{saveMsg}</span> : null}
            </div>

            <div className="sb-modal-scroll sb-modal-scroll--results" data-lenis-prevent>
              <section className="sb-res-cal-section">
                <h3 className="sb-res-h3">Week calendar</h3>
                <CalendarWeekGrid sections={active.sections} />
              </section>

              <section className="sb-res-sections">
                <h3 className="sb-res-h3">Courses in this schedule</h3>
                {trendsLoading ? (
                  <p className="sb-res-loading">Loading historical grade trends…</p>
                ) : null}
                <div className="sb-sec-cards">
                  {active.sections.map((s) => (
                    <SectionDetailCard
                      key={s.enroll_code}
                      s={s}
                      bars={trendBarsByCourse.get(s.course_norm) ?? []}
                      distPoints={trendRaw.get(s.course_norm) ?? []}
                      courseGrades={courseGrades}
                      cumulativeGpa={cumulativeGpa}
                    />
                  ))}
                </div>
              </section>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function SectionDetailCard({
  s,
  bars,
  distPoints,
  courseGrades,
  cumulativeGpa,
}: {
  s: SectionPick
  bars: TrendPoint[]
  distPoints: GradeTrendPoint[]
  courseGrades: Record<string, string>
  cumulativeGpa: number | null
}) {
  const blend = blendPersonalPredictedGpa(s.predicted_gpa, s.course_norm, courseGrades, cumulativeGpa)
  const band =
    s.gpa_lo != null && s.gpa_hi != null ? `[${s.gpa_lo.toFixed(2)}, ${s.gpa_hi.toFixed(2)}]` : '—'

  return (
    <article className="sb-sec-card">
      <div className="sb-sec-card-top">
        <div>
          <div className="sb-sec-card-code">{s.course_norm}</div>
          <div className="sb-sec-card-prof">{s.instructor_norm ?? 'Instructor TBA'}</div>
          <div className="sb-sec-card-time">
            {(s.days ?? '—') + ' · '}
            {(s.begin_time ?? '—')?.slice(0, 5)}–{(s.end_time ?? '—')?.slice(0, 5)}
          </div>
        </div>
        <RmpBlock s={s} />
      </div>

      <div className="sb-sec-card-pred">
        <div className="sb-pred-blend">
          <span className="sb-pred-label">Your blend</span>
          <span className="sb-pred-val">
            {blend.blended != null ? blend.blended.toFixed(2) : '—'}
          </span>
          <span className="sb-pred-hint" title={blend.note}>
            {blend.note}
          </span>
        </div>
        <div className="sb-pred-model">
          <span className="sb-pred-label">Section model μ</span>
          <span className="sb-pred-val">{blend.model != null ? blend.model.toFixed(2) : '—'}</span>
          <span className="sb-pred-lohi">{band}</span>
          <span className="sb-pred-regime">{s.regime ?? '—'}</span>
        </div>
      </div>

      {(s.course_hist_avg_gpa != null || s.pair_hist_avg_gpa != null) && (
        <div className="sb-sec-card-nexus">
          {s.course_hist_avg_gpa != null && (
            <span>
              Course history avg {s.course_hist_avg_gpa.toFixed(2)}
              {s.course_hist_n_letter != null ? ` · n=${s.course_hist_n_letter}` : ''}
            </span>
          )}
          {s.pair_hist_avg_gpa != null && (
            <span>
              This instructor+course {s.pair_hist_avg_gpa.toFixed(2)}
              {s.pair_hist_n_letter != null ? ` · n=${s.pair_hist_n_letter}` : ''}
            </span>
          )}
        </div>
      )}

      <div className="sb-sec-card-trend">
        <h4 className="sb-sec-trend-h">Historical grades (Nexus)</h4>
        <p className="sb-sec-trend-sub">Department data · not your grade</p>
        <h5 className="sb-sec-trend-h5">Mean GPA by term</h5>
        <TrendSpark bars={bars} />
        <h5 className="sb-sec-trend-h5 sb-sec-trend-h5--spaced">Letter mix by quarter</h5>
        <GradeDistributionViz compact key={s.course_norm} points={distPoints} />
      </div>
    </article>
  )
}
