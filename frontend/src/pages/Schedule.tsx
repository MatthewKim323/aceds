import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'motion/react'
import { useAuth } from '../lib/auth'
import { getProfile } from '../lib/profile'
import { getMajorById } from '../data/majors'
import {
  api,
  type OptimizePreferences,
  type ScheduleCandidate,
  type SectionPick,
} from '../lib/api'

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
}

const QUARTER_CODE = '20262' // Spring 2026
const QUARTER_LABEL = 'Spring 2026'

export function Schedule() {
  const { user, loading: authLoading } = useAuth()
  const [majorId, setMajorId] = useState<string | null>(null)
  const [completedSet, setCompletedSet] = useState<Set<string>>(new Set())

  const [requiredCourses, setRequiredCourses] = useState<string[]>([])
  const [optionalCourses, setOptionalCourses] = useState<string[]>([])
  const [excludedCourses, setExcludedCourses] = useState<Set<string>>(new Set())
  const [prefs, setPrefs] = useState<OptimizePreferences>(DEFAULT_PREFS)
  const [running, setRunning] = useState(false)
  const [candidates, setCandidates] = useState<ScheduleCandidate[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!user) return
    getProfile(user.id).then(({ profile }) => {
      if (!profile) return
      const p = profile as unknown as {
        major: string
        completed_courses: string[]
      }
      const firstMajor = p.major?.split(',').filter(Boolean)[0] || null
      setMajorId(firstMajor)
      setCompletedSet(new Set(p.completed_courses || []))
    })
  }, [user])

  // Derive uncompleted required + optional courses from the selected major
  const majorDerived = useMemo(() => {
    if (!majorId) return null
    const major = getMajorById(majorId)
    if (!major) return null

    const required: string[] = []
    const optional: string[] = []
    for (const group of major.groups) {
      const groupCourses = group.courses.map((c) => c.id)
      const anyComplete = group.courses.some(
        (c) => completedSet.has(c.id) || (c.alt && completedSet.has(c.alt)),
      )
      if (anyComplete) continue
      if (group.courses.length === 1) {
        required.push(groupCourses[0])
      } else {
        // "pick N of M" -> treat all as optional; optimizer will pick the best
        optional.push(...groupCourses)
      }
    }
    return { required, optional, name: `${major.name} ${major.degree}` }
  }, [majorId, completedSet])

  useEffect(() => {
    if (!majorDerived) return
    setRequiredCourses(majorDerived.required.slice(0, 4))
    setOptionalCourses(majorDerived.optional)
  }, [majorDerived])

  async function runOptimizer() {
    if (!majorId) return
    setRunning(true)
    setError(null)
    try {
      const resp = await api.optimize({
        quarter_code: QUARTER_CODE,
        major_id: majorId,
        required_courses: requiredCourses,
        optional_courses: optionalCourses,
        excluded_courses: Array.from(excludedCourses),
        completed_courses: Array.from(completedSet),
        preferences: prefs,
        top_k: 3,
      })
      setCandidates(resp.candidates)
    } catch (e) {
      setError(String((e as Error).message || e))
      setCandidates([])
    } finally {
      setRunning(false)
    }
  }

  if (authLoading) return null
  if (!user) return <Navigate to="/auth" replace />

  return (
    <div className="sb">
      <header className="sb-header">
        <div>
          <Link to="/dashboard" className="sb-back">&larr; dashboard</Link>
          <h1 className="sb-title">Schedule Builder</h1>
          <p className="sb-sub">
            {majorDerived ? `${majorDerived.name} · ${QUARTER_LABEL}` : QUARTER_LABEL}
            {' · optimizing across '}<span className="sb-accent">
              {requiredCourses.length} required + {optionalCourses.length} electives
            </span>
          </p>
        </div>
        <button
          className="sb-run"
          onClick={runOptimizer}
          disabled={running || !majorId || requiredCourses.length === 0}
        >
          {running ? 'solving…' : 'Optimize →'}
        </button>
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
        {candidates.length > 0 && (
          <motion.section
            key="cands"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="sb-results"
          >
            <h2 className="sb-pane-title">Top {candidates.length} schedules</h2>
            <div className="sb-cand-grid">
              {candidates.map((cand, i) => (
                <CandidateCard key={i} rank={i + 1} cand={cand} />
              ))}
            </div>
          </motion.section>
        )}
      </AnimatePresence>
    </div>
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
      transition={{ delay: rank * 0.07 }}
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
      <ul className="sb-cand-sections">
        {cand.sections.map((s) => (
          <SectionRow key={s.enroll_code} s={s} />
        ))}
      </ul>
    </motion.article>
  )
}

function SectionRow({ s }: { s: SectionPick }) {
  return (
    <li className="sb-sec">
      <div className="sb-sec-main">
        <span className="sb-sec-code">{s.course_norm}</span>
        <span className="sb-sec-prof">{s.instructor_norm ?? 'TBA'}</span>
      </div>
      <div className="sb-sec-meta">
        <span>{s.days ?? 'TBA'}</span>
        <span>
          {s.begin_time ?? '—'}–{s.end_time ?? '—'}
        </span>
        {s.predicted_gpa !== null && (
          <span className="sb-sec-gpa">GPA {s.predicted_gpa?.toFixed(2)}</span>
        )}
        {s.rmp_rating !== null && s.rmp_rating !== undefined && (
          <span className="sb-sec-rmp">RMP {s.rmp_rating.toFixed(1)}</span>
        )}
      </div>
    </li>
  )
}
