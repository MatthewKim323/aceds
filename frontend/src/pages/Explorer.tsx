import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { api, type CatalogMeta, type Course } from '../lib/api'
import { getProfile } from '../lib/profile'
import { toCourseNorm } from '../lib/pdf-parser'
import {
  buildPersonalizationFromMajors,
  catalogPersonalScore,
  compareCoursesDefault,
} from '../lib/explorer-personalize'

type GELabel = { code: string; label: string }
const GE_AREAS: GELabel[] = [
  { code: 'A', label: 'Area A' },
  { code: 'B', label: 'Area B' },
  { code: 'C', label: 'Area C' },
  { code: 'D', label: 'Area D' },
  { code: 'E', label: 'Area E' },
  { code: 'F', label: 'Area F' },
  { code: 'G', label: 'Area G' },
  { code: 'ETH', label: 'Ethnicity' },
  { code: 'EUR', label: 'European traditions' },
  { code: 'NWC', label: 'World cultures' },
  { code: 'WRT', label: 'Writing' },
  { code: 'QNT', label: 'Quantitative' },
]

const LEVELS = [
  { code: 'lower', label: 'Lower div' },
  { code: 'upper', label: 'Upper div' },
  { code: 'grad', label: 'Grad' },
]

/** Browse tiles — common departments first (counts from live catalog). */
const FEATURED: { dept: string; label: string }[] = [
  { dept: 'ECON', label: 'Economics' },
  { dept: 'MATH', label: 'Mathematics' },
  { dept: 'CHEM', label: 'Chemistry' },
  { dept: 'PHYS', label: 'Physics' },
  { dept: 'PSY', label: 'Psychology' },
  { dept: 'PSTAT', label: 'Statistics' },
  { dept: 'MCDB', label: 'MCDB' },
  { dept: 'ECE', label: 'Electrical & computer eng.' },
  { dept: 'CMPSC', label: 'Computer science' },
  { dept: 'BIOL', label: 'Biological sciences' },
]

function quarterMenu(): { code: string; label: string }[] {
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

const QUARTERS = quarterMenu()
const CATALOG_LIMIT = 25_000

function quarterSelectOptions(meta: CatalogMeta | null): { code: string; label: string }[] {
  const base = [...QUARTERS]
  if (meta?.quarter && !base.some((o) => o.code === meta.quarter)) {
    base.unshift({ code: meta.quarter, label: meta.label || meta.quarter })
  }
  return base
}

type StudentProfileRow = {
  major?: string | null
  completed_courses?: string[] | null
  in_progress_courses?: string[] | null
}

export function Explorer() {
  const { user, loading: authLoading } = useAuth()
  const [params, setParams] = useSearchParams()

  const [meta, setMeta] = useState<CatalogMeta | null>(null)
  const [courses, setCourses] = useState<Course[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [profile, setProfile] = useState<StudentProfileRow | null>(null)

  const quarterParam = (params.get('quarter') || '').trim()
  const dept = (params.get('dept') || '').trim()
  const ge = (params.get('ge') || '').trim()
  const level = (params.get('level') || '').trim()
  const q = (params.get('q') || '').trim()

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const m = await api.catalogMeta(quarterParam ? { quarter: quarterParam } : {})
        if (cancelled) return
        setMeta(m)
        if (!quarterParam && m.quarter) {
          setParams(
            (prev) => {
              const n = new URLSearchParams(prev)
              n.set('quarter', m.quarter)
              return n
            },
            { replace: true },
          )
        }
      } catch (e) {
        if (!cancelled) {
          setError(String((e as Error).message || e))
          setMeta(null)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [quarterParam, setParams])

  useEffect(() => {
    if (!user?.id) return
    let cancelled = false
    getProfile(user.id).then(({ profile: p }) => {
      if (cancelled || !p) return
      setProfile(p as StudentProfileRow)
    })
    return () => {
      cancelled = true
    }
  }, [user?.id])

  const effectiveQuarter = quarterParam || meta?.quarter || null
  const apiKeyMissing = meta ? !meta.ucsb_api_configured : false

  useEffect(() => {
    if (!effectiveQuarter || apiKeyMissing) {
      setLoading(false)
      setCourses([])
      setTotal(0)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    api
      .listCatalogCourses({
        quarter: effectiveQuarter,
        dept: dept || undefined,
        ge: ge || undefined,
        level: level || undefined,
        search: q || undefined,
        limit: CATALOG_LIMIT,
      })
      .then((page) => {
        if (cancelled) return
        setCourses(page.items)
        setTotal(page.total)
      })
      .catch((e) => {
        if (!cancelled) setError(String(e.message || e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [effectiveQuarter, dept, ge, level, q, apiKeyMissing])

  const majorIds = useMemo(
    () => (profile?.major ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    [profile?.major],
  )

  const personalization = useMemo(
    () => buildPersonalizationFromMajors(majorIds),
    [majorIds.join('|')],
  )

  const completedNorms = useMemo(() => {
    const s = new Set<string>()
    for (const c of profile?.completed_courses ?? []) {
      const n = toCourseNorm(String(c))
      if (n) s.add(n)
    }
    return s
  }, [profile?.completed_courses])

  const inProgressNorms = useMemo(() => {
    const s = new Set<string>()
    for (const c of profile?.in_progress_courses ?? []) {
      const n = toCourseNorm(String(c))
      if (n) s.add(n)
    }
    return s
  }, [profile?.in_progress_courses])

  const countsByDept = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of courses) {
      const d = c.dept || '—'
      m.set(d, (m.get(d) ?? 0) + 1)
    }
    return m
  }, [courses])

  const rankedRows = useMemo(() => {
    return courses
      .map((c) => ({
        c,
        score: catalogPersonalScore(c, personalization, completedNorms, inProgressNorms),
      }))
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score
        return compareCoursesDefault(a.c, b.c)
      })
  }, [courses, personalization, completedNorms, inProgressNorms])

  const featuredOrdered = useMemo(() => {
    if (!personalization.neededDepts.size) return FEATURED
    const hit: typeof FEATURED = []
    const rest: typeof FEATURED = []
    for (const f of FEATURED) {
      if (personalization.neededDepts.has(f.dept)) hit.push(f)
      else rest.push(f)
    }
    return [...hit, ...rest]
  }, [personalization])

  const quarterOptions = useMemo(() => quarterSelectOptions(meta), [meta])

  const filteredView = Boolean(dept || ge || level || q)

  const showPersonalStrip =
    majorIds.length > 0 && personalization.majorNames.length > 0 && !filteredView

  if (authLoading) return null
  if (!user) return <Navigate to="/auth" replace />

  return (
    <div className="ce">
      <header className="ce-top">
        <div className="ce-top-inner">
          <Link to="/dashboard" className="ce-back">
            ← Dashboard
          </Link>
          <div className="ce-headline">
            <h1 className="ce-title">Courses</h1>
            <p className="ce-tagline">
              Live UCSB catalog ·{' '}
              <a
                href="https://developer.ucsb.edu/content/academic-curriculums"
                target="_blank"
                rel="noreferrer"
                className="ce-link"
              >
                Academic Curriculums API
              </a>
            </p>
          </div>
        </div>
      </header>

      <div className="ce-shell">
        {apiKeyMissing && (
          <div className="ce-alert" role="status">
            Set <code>UCSB_API_KEY</code> (your portal consumer key) in the repo root <code>.env</code>, restart
            the backend, then reload.
          </div>
        )}

        <section className="ce-toolbar">
          <div className="ce-toolbar-row">
            <label className="ce-field">
              <span className="ce-field-label">Quarter</span>
              <select
                className="ce-select"
                value={effectiveQuarter || ''}
                onChange={(e) => setParam('quarter', e.target.value)}
              >
                {quarterOptions.map((opt) => (
                  <option key={opt.code} value={opt.code}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="ce-field ce-field-grow">
              <span className="ce-field-label">Search</span>
              <input
                type="search"
                className="ce-input"
                placeholder="Course code, title, or description…"
                value={q}
                onChange={(e) => setParam('q', e.target.value)}
                autoComplete="off"
              />
            </label>
          </div>

          <div className="ce-toolbar-row ce-toolbar-row-tight">
            <label className="ce-field">
              <span className="ce-field-label">Subject</span>
              <select
                className="ce-select ce-select-wide"
                value={dept}
                onChange={(e) => setParam('dept', e.target.value)}
                disabled={!meta?.department_codes?.length}
              >
                <option value="">All subjects</option>
                {(meta?.department_codes ?? []).map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
            <div className="ce-field ce-field-nogrow">
              <span className="ce-field-label">GE area</span>
              <div className="ce-pills">
                <button type="button" className={`ce-pill ${!ge ? 'on' : ''}`} onClick={() => setParam('ge', '')}>
                  Any
                </button>
                {GE_AREAS.map((g) => (
                  <button
                    key={g.code}
                    type="button"
                    title={g.label}
                    className={`ce-pill ${ge === g.code ? 'on' : ''}`}
                    onClick={() => setParam('ge', ge === g.code ? '' : g.code)}
                  >
                    {g.code}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="ce-toolbar-row ce-toolbar-row-tight">
            <span className="ce-field-label">Level</span>
            <div className="ce-pills">
              <button
                type="button"
                className={`ce-pill ${!level ? 'on' : ''}`}
                onClick={() => setParam('level', '')}
              >
                Any
              </button>
              {LEVELS.map((lv) => (
                <button
                  key={lv.code}
                  type="button"
                  className={`ce-pill ${level === lv.code ? 'on' : ''}`}
                  onClick={() => setParam('level', lv.code === level ? '' : lv.code)}
                >
                  {lv.label}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="ce-stats" aria-live="polite">
          <div className="ce-stat">
            <span className="ce-stat-n">{loading ? '…' : total.toLocaleString()}</span>
            <span className="ce-stat-l">courses this quarter</span>
          </div>
          {meta?.label ? (
            <div className="ce-stat ce-stat-muted">
              <span className="ce-stat-n ce-stat-n-sm">{meta.label}</span>
              <span className="ce-stat-l">catalog range</span>
            </div>
          ) : null}
        </section>

        <section className="ce-discover">
          <h2 className="ce-h2">Browse by subject</h2>
          <div className="ce-tiles">
            {featuredOrdered.map(({ dept: d, label }) => {
              const n = countsByDept.get(d) ?? 0
              const on = dept === d
              return (
                <button
                  key={d}
                  type="button"
                  className={`ce-tile ${on ? 'on' : ''}`}
                  onClick={() => setParam('dept', on ? '' : d)}
                >
                  <span className="ce-tile-dept">{d}</span>
                  <span className="ce-tile-name">{label}</span>
                  <span className="ce-tile-count">
                    {loading ? '—' : filteredView ? `${n} in results` : `${n} courses`}
                  </span>
                </button>
              )
            })}
          </div>
        </section>

        {error ? (
          <div className="ce-empty ce-empty-err">
            <strong>Could not load catalog.</strong>
            <p>
              Check that the API is running at{' '}
              <code>{(import.meta.env.VITE_API_BASE as string) || 'http://localhost:8000'}</code>.
            </p>
            <p className="ce-empty-detail">{error}</p>
          </div>
        ) : loading && courses.length === 0 ? (
          <div className="ce-empty">Loading catalog from UCSB… first load can take a minute.</div>
        ) : rankedRows.length === 0 ? (
          <div className="ce-empty">No courses match these filters.</div>
        ) : (
          <>
            {showPersonalStrip ? (
              <p className="ce-personal-strip">
                <span className="ce-personal-label">For you</span>
                Rows are ordered for{' '}
                <strong>{personalization.majorNames.join(' · ')}</strong> — requirement courses and your
                subjects first (completed courses move down). Add or change majors in{' '}
                <Link to="/onboarding" className="ce-link">
                  onboarding
                </Link>
                .
              </p>
            ) : null}
            <div className="ce-table-wrap">
              <table className="ce-table">
                <thead>
                  <tr>
                    <th className="ce-th-tag" aria-hidden />
                    <th>Code</th>
                    <th>Title</th>
                    <th className="ce-th-n">Units</th>
                    <th>GE</th>
                    <th className="ce-th-n">Level</th>
                  </tr>
                </thead>
                <tbody>
                  {rankedRows.map(({ c, score }) => {
                    const cn = toCourseNorm(c.course_norm)
                    const isDone = completedNorms.has(cn)
                    const isReq = personalization.neededCourseNorms.has(cn)
                    const rowForYou = score >= 80 && !isDone
                    return (
                      <tr
                        key={c.course_norm}
                        className={rowForYou ? 'ce-row-for-you' : undefined}
                      >
                        <td className="ce-tag-cell">
                          {isReq && !isDone ? (
                            <span className="ce-pill-tag" title="On your major sheet">
                              req
                            </span>
                          ) : inProgressNorms.has(cn) ? (
                            <span className="ce-pill-tag ce-pill-tag-ip" title="In progress">
                              now
                            </span>
                          ) : isDone ? (
                            <span className="ce-pill-tag ce-pill-tag-done" title="Already completed">
                              done
                            </span>
                          ) : null}
                        </td>
                        <td className="ce-mono">{c.course_norm.trim()}</td>
                        <td className="ce-titlecell">{c.title?.trim() || '—'}</td>
                        <td className="ce-n">{c.units_fixed != null ? String(c.units_fixed) : '—'}</td>
                        <td className="ce-ge">{c.ge_areas.length ? c.ge_areas.join(', ') : '—'}</td>
                        <td className="ce-n">{c.level}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        <footer className="ce-foot">
          Not affiliated with UC Santa Barbara. Course data is from the official curriculum API; counts are
          distinct courses in the merged catalog for the selected quarter.
        </footer>
      </div>
    </div>
  )
}
