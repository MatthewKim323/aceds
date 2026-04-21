import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { motion, AnimatePresence } from 'motion/react'
import { useAuth } from '../lib/auth'
import { api, type Course } from '../lib/api'

type GELabel = { code: string; label: string }
const GE_AREAS: GELabel[] = [
  { code: 'A', label: 'Analytical Thinking' },
  { code: 'B', label: 'Culture & Thought' },
  { code: 'C', label: 'Science, Math & Tech' },
  { code: 'D', label: 'Social Sciences' },
  { code: 'E', label: 'Culture & Thought (H)' },
  { code: 'F', label: 'Arts' },
  { code: 'G', label: 'Literature' },
  { code: 'WRT', label: 'Writing' },
  { code: 'QNT', label: 'Quantitative' },
  { code: 'ETH', label: 'Ethnicity' },
  { code: 'EUR', label: 'European Traditions' },
  { code: 'NWC', label: 'World Cultures' },
]

const LEVELS = [
  { code: 'lower', label: 'Lower division' },
  { code: 'upper', label: 'Upper division' },
  { code: 'grad', label: 'Graduate' },
]

export function Explorer() {
  const { user, loading: authLoading } = useAuth()
  const [params, setParams] = useSearchParams()

  const [courses, setCourses] = useState<Course[]>([])
  const [depts, setDepts] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const dept = params.get('dept') || ''
  const ge = params.get('ge') || ''
  const level = params.get('level') || ''
  const q = params.get('q') || ''

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }

  useEffect(() => {
    setLoading(true)
    setError(null)
    api
      .listCourses({ dept, ge, level, search: q, limit: 300 })
      .then((page) => {
        setCourses(page.items)
        const d = Array.from(new Set(page.items.map((r) => r.dept))).sort()
        if (d.length && depts.length === 0) setDepts(d)
      })
      .catch((e) => setError(String(e.message || e)))
      .finally(() => setLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dept, ge, level, q])

  useEffect(() => {
    if (depts.length) return
    api
      .listCourses({ limit: 500 })
      .then((page) => {
        setDepts(Array.from(new Set(page.items.map((r) => r.dept))).sort())
      })
      .catch(() => undefined)
  }, [depts.length])

  const byDept = useMemo(() => {
    const map = new Map<string, Course[]>()
    for (const c of courses) {
      if (!map.has(c.dept)) map.set(c.dept, [])
      map.get(c.dept)!.push(c)
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [courses])

  if (authLoading) return null
  if (!user) return <Navigate to="/auth" replace />

  return (
    <div className="xp">
      <header className="xp-header">
        <div>
          <Link to="/dashboard" className="xp-back">&larr; dashboard</Link>
          <h1 className="xp-title">Course Explorer</h1>
          <p className="xp-sub">
            Every UCSB course, historical grade distributions, and predicted GPA per section.
          </p>
        </div>
        <div className="xp-count">
          <span className="xp-count-n">{courses.length}</span>
          <span className="xp-count-l">results</span>
        </div>
      </header>

      <section className="xp-filters">
        <input
          type="search"
          placeholder="Search course, title, description…"
          value={q}
          onChange={(e) => setParam('q', e.target.value)}
          className="xp-search"
          autoComplete="off"
        />
        <div className="xp-chip-row">
          <span className="xp-chip-label">Dept</span>
          <button
            className={`xp-chip ${!dept ? 'on' : ''}`}
            onClick={() => setParam('dept', '')}
          >
            all
          </button>
          {depts.slice(0, 24).map((d) => (
            <button
              key={d}
              className={`xp-chip ${dept === d ? 'on' : ''}`}
              onClick={() => setParam('dept', d === dept ? '' : d)}
            >
              {d}
            </button>
          ))}
        </div>
        <div className="xp-chip-row">
          <span className="xp-chip-label">GE</span>
          <button
            className={`xp-chip ${!ge ? 'on' : ''}`}
            onClick={() => setParam('ge', '')}
          >
            any
          </button>
          {GE_AREAS.map((g) => (
            <button
              key={g.code}
              className={`xp-chip ${ge === g.code ? 'on' : ''}`}
              onClick={() => setParam('ge', g.code === ge ? '' : g.code)}
              title={g.label}
            >
              {g.code}
            </button>
          ))}
        </div>
        <div className="xp-chip-row">
          <span className="xp-chip-label">Level</span>
          {LEVELS.map((lv) => (
            <button
              key={lv.code}
              className={`xp-chip ${level === lv.code ? 'on' : ''}`}
              onClick={() => setParam('level', lv.code === level ? '' : lv.code)}
            >
              {lv.label}
            </button>
          ))}
        </div>
      </section>

      <AnimatePresence mode="wait">
        {error ? (
          <motion.div
            key="err"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="xp-state xp-state-error"
          >
            <strong>Backend unreachable.</strong>
            <p>
              This page pulls from <code>{(import.meta.env.VITE_API_BASE as string) || 'http://localhost:8000'}</code>.
              Start the FastAPI backend (<code>cd backend && uvicorn app.main:app --reload</code>) to see
              data here.
            </p>
            <p className="xp-state-detail">{error}</p>
          </motion.div>
        ) : loading && courses.length === 0 ? (
          <motion.div key="loading" className="xp-state">loading the catalog…</motion.div>
        ) : courses.length === 0 ? (
          <motion.div key="empty" className="xp-state">No courses match.</motion.div>
        ) : (
          <motion.div
            key="results"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="xp-results"
          >
            {byDept.map(([d, list]) => (
              <section key={d} className="xp-dept-block">
                <h2 className="xp-dept-header">
                  <span className="xp-dept-code">{d}</span>
                  <span className="xp-dept-count">{list.length}</span>
                </h2>
                <div className="xp-course-grid">
                  {list.map((c) => (
                    <CourseCard key={c.course_norm} c={c} />
                  ))}
                </div>
              </section>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function CourseCard({ c }: { c: Course }) {
  return (
    <motion.article
      className="xp-card"
      whileHover={{ y: -2, borderColor: 'rgba(212, 165, 106, 0.4)' }}
      transition={{ duration: 0.15 }}
    >
      <div className="xp-card-head">
        <span className="xp-card-code">{c.course_norm}</span>
        {c.units_fixed !== null && (
          <span className="xp-card-units">{c.units_fixed}u</span>
        )}
      </div>
      <h3 className="xp-card-title">{c.title ?? 'Untitled course'}</h3>
      {c.description && (
        <p className="xp-card-desc">
          {c.description.length > 180 ? c.description.slice(0, 180) + '…' : c.description}
        </p>
      )}
      <div className="xp-card-meta">
        <span className={`xp-level xp-level-${c.level}`}>{c.level}</span>
        {c.ge_areas.slice(0, 4).map((a) => (
          <span key={a} className="xp-ge">{a}</span>
        ))}
      </div>
    </motion.article>
  )
}
