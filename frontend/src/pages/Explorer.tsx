import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import gsap from 'gsap'
import { useAuth } from '../lib/auth'
import {
  api,
  type CatalogMeta,
  type Course,
  type GradeTrendPoint,
  type Prediction,
  type Section,
} from '../lib/api'
import { getProfile } from '../lib/profile'
import { toCourseNorm } from '../lib/pdf-parser'
import { buildSatisfiedCourseSet } from '../lib/satisfied-courses'
import {
  buildPersonalizationFromMajors,
  catalogPersonalScore,
  compareCoursesDefault,
} from '../lib/explorer-personalize'
import { quarterSelectOptions } from '../lib/quarters'
import { EASE_OUT, fadeUp, prefersReducedMotion, staggerContainer, staggerItem } from '../lib/motion'
import { GradeDistributionViz } from '../components/GradeDistributionViz'

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

const FEATURED: { dept: string; label: string }[] = [
  { dept: 'ECON', label: 'Economics' },
  { dept: 'PSTAT', label: 'Statistics' },
  { dept: 'MATH', label: 'Mathematics' },
  { dept: 'CHEM', label: 'Chemistry' },
  { dept: 'PHYS', label: 'Physics' },
  { dept: 'PSY', label: 'Psychology' },
  { dept: 'MCDB', label: 'MCDB' },
  { dept: 'ECE', label: 'Electrical & computer eng.' },
  { dept: 'CMPSC', label: 'Computer science' },
  { dept: 'BIOL', label: 'Biological sciences' },
]

const CATALOG_LIMIT = 25_000
const PREDICT_BATCH = 48

type StudentProfileRow = {
  major?: string | null
  completed_courses?: string[] | null
  in_progress_courses?: string[] | null
  ap_credits?: { exam: string; ucsb_equivalent: string[]; units: number; score: number | null }[]
}

function termKey(y: number, q: string) {
  return `${y} ${q}`
}

/** Aggregate historical rows into one point per term (mean GPA weighted by n_letter). */
function trendSeries(
  points: Array<{ year: number; quarter: string; avg_gpa: number | null; n_letter: number }>,
) {
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
  const rows = [...m.entries()]
    .map(([k, v]) => {
      const [ys, q] = k.split(' ')
      const y = Number(ys)
      const qi = order.indexOf(q)
      return { k, y, q, qi, gpa: v.w > 0 ? v.sum / v.w : null }
    })
    .filter((r) => r.gpa != null)
    .sort((a, b) => (a.y !== b.y ? a.y - b.y : a.qi - b.qi))
  return rows
}

async function predictBatched(sectionIds: string[], quarter: string): Promise<Prediction[]> {
  const out: Prediction[] = []
  for (let i = 0; i < sectionIds.length; i += PREDICT_BATCH) {
    const slice = sectionIds.slice(i, i + PREDICT_BATCH)
    const r = await api.predict(slice, quarter)
    out.push(...r.predictions)
  }
  return out
}

/** Cards per page — 3 columns × 8 rows */
const PAGE_SIZE = 24

type CardExtra =
  | { status: 'loading' }
  | {
      status: 'ready'
      instructor: string | null
      schedule: string
      rmp: number | null
      rmpN: number | null
    }

function pickPrimarySection(items: Section[]): Section | null {
  if (!items.length) return null
  const rank = (s: Section) => {
    const lab = /DIS|WKS|STU|APP|SEM|FMP/i.test(s.section_label || '') ? 2 : 0
    const hasTime = s.days && s.begin_time ? 0 : 1
    return lab + hasTime
  }
  return [...items].sort((a, b) => rank(a) - rank(b))[0]
}

function formatScheduleLine(s: Section): string {
  const days = (s.days || '').trim()
  const t1 = (s.begin_time || '').slice(0, 5)
  const t2 = (s.end_time || '').slice(0, 5)
  const tm = t1 && t2 ? `${t1}–${t2}` : t1 || t2 || ''
  return [days, tm].filter(Boolean).join(' · ') || ''
}

function RmpStars({ r, n }: { r: number | null; n: number | null }) {
  if (r == null || r <= 0) {
    return <span className="ce-rmp-muted">No RMP data</span>
  }
  const filled = Math.min(5, Math.max(0, Math.round(r)))
  return (
    <span className="ce-course-card-rmp">
      <span className="ce-rmp-stars" aria-hidden>
        {'★'.repeat(filled)}
        {'☆'.repeat(5 - filled)}
      </span>
      <span className="ce-rmp-num">{r.toFixed(1)}</span>
      {n != null && n > 0 ? <span className="ce-rmp-n">({n} ratings)</span> : null}
    </span>
  )
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
  const openOnly = params.get('open') === '1'
  const courseOpen = (params.get('course') || '').trim()
  const pageRaw = (params.get('page') || '').trim()

  const setParam = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(params)
      if (value) next.set(key, value)
      else next.delete(key)
      setParams(next, { replace: true })
    },
    [params, setParams],
  )

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
    return buildSatisfiedCourseSet(profile?.completed_courses ?? [], profile?.ap_credits ?? [])
  }, [profile?.completed_courses, profile?.ap_credits])

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

  const filterKey = useMemo(
    () => `${dept}|${ge}|${level}|${q}|${effectiveQuarter ?? ''}`,
    [dept, ge, level, q, effectiveQuarter],
  )

  const maxPage = useMemo(
    () => Math.max(1, Math.ceil(rankedRows.length / PAGE_SIZE)),
    [rankedRows.length],
  )

  const pageNum = useMemo(() => {
    const raw = parseInt(pageRaw || '1', 10)
    const n = Number.isFinite(raw) && raw > 0 ? raw : 1
    return Math.min(maxPage, n)
  }, [pageRaw, maxPage])

  const pageSlice = useMemo(() => {
    const start = (pageNum - 1) * PAGE_SIZE
    return rankedRows.slice(start, start + PAGE_SIZE)
  }, [rankedRows, pageNum])

  const [extras, setExtras] = useState<Record<string, CardExtra>>({})

  const filterMountRef = useRef(false)
  useEffect(() => {
    if (!filterMountRef.current) {
      filterMountRef.current = true
      return
    }
    setParam('page', '')
  }, [filterKey, setParam])

  useEffect(() => {
    if (!pageRaw && pageNum === 1) return
    if (pageRaw === String(pageNum)) return
    setParam('page', pageNum <= 1 ? '' : String(pageNum))
  }, [pageNum, pageRaw, setParam])

  useEffect(() => {
    const quarter = effectiveQuarter
    if (!quarter || apiKeyMissing || pageSlice.length === 0) return
    const quarterStr: string = quarter
    let cancelled = false
    const norms = [...new Set(pageSlice.map(({ c }) => c.course_norm.trim()))]
    setExtras((prev) => {
      const next = { ...prev }
      for (const n of norms) next[n] = { status: 'loading' }
      return next
    })

    const CONC = 5
    let cursor = 0

    async function fetchOne(norm: string) {
      try {
        const { items } = await api.listSections({
          quarter: quarterStr,
          course: norm,
          limit: 50,
        })
        if (cancelled) return
        const s = pickPrimarySection(items)
        let instructor: string | null = s?.instructor_norm ?? null
        const schedule = s ? formatScheduleLine(s) : ''
        let rmp: number | null = null
        let rmpN: number | null = null
        if (s?.instructor_norm) {
          try {
            const pr = await api.getProfessor(s.instructor_norm)
            rmp = pr.professor.rmp_rating
            rmpN = pr.professor.rmp_num_ratings
            if (pr.professor.display_name) instructor = pr.professor.display_name
          } catch {
            /* no professor row */
          }
        }
        if (cancelled) return
        setExtras((e) => ({
          ...e,
          [norm]: {
            status: 'ready',
            instructor,
            schedule: schedule || 'Schedule TBA',
            rmp,
            rmpN,
          },
        }))
      } catch {
        if (!cancelled) {
          setExtras((e) => ({
            ...e,
            [norm]: {
              status: 'ready',
              instructor: null,
              schedule: 'Schedule TBA',
              rmp: null,
              rmpN: null,
            },
          }))
        }
      }
    }

    async function worker() {
      while (!cancelled) {
        const i = cursor++
        if (i >= norms.length) break
        await fetchOne(norms[i])
      }
    }

    void Promise.all(Array.from({ length: Math.min(CONC, norms.length) }, () => worker()))
    return () => {
      cancelled = true
    }
  }, [effectiveQuarter, apiKeyMissing, pageSlice, filterKey, pageNum])

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

  const filteredView = Boolean(dept || ge || level || q || openOnly)

  const showPersonalStrip =
    majorIds.length > 0 && personalization.majorNames.length > 0 && !filteredView

  /* —— course detail drawer —— */
  const [dLoading, setDLoading] = useState(false)
  const [dErr, setDErr] = useState<string | null>(null)
  const [dCourse, setDCourse] = useState<Course | null>(null)
  const [dSections, setDSections] = useState<Section[]>([])
  const [dPreds, setDPreds] = useState<Prediction[]>([])
  const [dTrend, setDTrend] = useState<GradeTrendPoint[]>([])

  const catalogFallbackCourse = useMemo(() => {
    if (!courseOpen) return null
    const k = toCourseNorm(courseOpen)
    return courses.find((c) => toCourseNorm(c.course_norm) === k) ?? null
  }, [courseOpen, courses])

  useEffect(() => {
    if (!courseOpen || !effectiveQuarter || apiKeyMissing) {
      setDCourse(null)
      setDSections([])
      setDPreds([])
      setDTrend([])
      setDErr(null)
      setDLoading(false)
      return
    }
    let cancelled = false
    setDLoading(true)
    setDErr(null)
    ;(async () => {
      try {
        let co: Course | null = null
        try {
          co = await api.getCourse(courseOpen, effectiveQuarter)
        } catch {
          co = catalogFallbackCourse
        }
        if (!co) {
          throw new Error(
            'Course not found in database or catalog. Check UCSB_API_KEY and quarter.',
          )
        }
        const [secPage, tr] = await Promise.all([
          api.listSections({
            quarter: effectiveQuarter,
            course: courseOpen,
            open_only: openOnly,
            limit: 500,
          }),
          api.getGradeTrend(courseOpen).catch(() => ({
            course_norm: courseOpen,
            points: [],
          })),
        ])
        if (cancelled) return
        setDCourse(co)
        setDSections(secPage.items)
        setDTrend(tr.points ?? [])
        const ids = secPage.items.map((s) => s.enroll_code).filter(Boolean)
        const preds = ids.length ? await predictBatched(ids, effectiveQuarter) : []
        if (cancelled) return
        setDPreds(preds)
      } catch (e) {
        if (!cancelled) setDErr(String((e as Error).message || e))
      } finally {
        if (!cancelled) setDLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [
    courseOpen,
    effectiveQuarter,
    apiKeyMissing,
    openOnly,
    catalogFallbackCourse,
  ])

  const predByEnroll = useMemo(() => {
    const m = new Map<string, Prediction>()
    for (const p of dPreds) m.set(p.enroll_code, p)
    return m
  }, [dPreds])

  const trendBars = useMemo(() => trendSeries(dTrend), [dTrend])

  const closeDrawer = () => setParam('course', '')

  const reduced = prefersReducedMotion()
  const sparkWrapRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (reduced || !courseOpen || dLoading || trendBars.length === 0) return
    const root = sparkWrapRef.current
    if (!root) return
    const bars = root.querySelectorAll<HTMLElement>('.ce-spark-bar')
    const ctx = gsap.context(() => {
      gsap.fromTo(
        bars,
        { scaleY: 0, transformOrigin: '50% 100%' },
        { scaleY: 1, duration: 0.55, stagger: 0.04, ease: 'power2.out' },
      )
    }, root)
    return () => ctx.revert()
  }, [reduced, courseOpen, dLoading, trendBars])

  if (authLoading) return null
  if (!user) return <Navigate to="/auth" replace />

  return (
    <motion.div
      className="ce ce-wide"
      initial={reduced ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: reduced ? 0 : 0.4, ease: EASE_OUT }}
    >
      <motion.header className="ce-top ce-top-wide" {...fadeUp(reduced)}>
        <div className="ce-top-inner ce-top-inner-wide">
          <Link to="/dashboard" className="ce-back">
            ← Dashboard
          </Link>
          <div className="ce-headline">
            <h1 className="ce-title">Course explorer</h1>
            <p className="ce-tagline">
              Queries join catalog, sections, and grade history · live UCSB curriculum · modeled section grades ·{' '}
              <a
                href="https://developer.ucsb.edu/content/academic-curriculums"
                target="_blank"
                rel="noreferrer"
                className="ce-link"
              >
                Curriculum API
              </a>
            </p>
          </div>
        </div>
      </motion.header>

      <div className="ce-hero">
        <motion.div className="ce-hero-inner" {...fadeUp(reduced, reduced ? 0 : 0.06)}>
          <div className="ce-hero-row">
            <label className="ce-hero-quarter">
              <span className="ce-field-label">Quarter</span>
              <select
                className="ce-select ce-select-hero"
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
            <label className="ce-hero-searchwrap">
              <span className="ce-field-label">Search courses</span>
              <input
                type="search"
                className="ce-input ce-input-hero"
                placeholder="Code, title, or description — same quarter as above"
                value={q}
                onChange={(e) => setParam('q', e.target.value)}
                autoComplete="off"
              />
            </label>
          </div>
        </motion.div>
      </div>

      <div className="ce-layout">
        <motion.aside
          className="ce-sidebar"
          aria-label="Filters"
          initial={reduced ? false : { opacity: 0, x: -14 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: reduced ? 0 : 0.42, ease: EASE_OUT, delay: reduced ? 0 : 0.08 }}
        >
          {apiKeyMissing && (
            <div className="ce-alert" role="status">
              Set <code>UCSB_API_KEY</code> in <code>.env</code>, restart backend, reload.
            </div>
          )}
          <div className="ce-side-block">
            <span className="ce-field-label">Subject</span>
            <select
              className="ce-select ce-select-block"
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
          </div>
          <div className="ce-side-block">
            <span className="ce-field-label">GE area</span>
            <div className="ce-pills ce-pills-col">
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
          <div className="ce-side-block">
            <span className="ce-field-label">Level</span>
            <div className="ce-pills ce-pills-col">
              <button type="button" className={`ce-pill ${!level ? 'on' : ''}`} onClick={() => setParam('level', '')}>
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
          <label className="ce-side-toggle">
            <input
              type="checkbox"
              checked={openOnly}
              onChange={(e) => setParam('open', e.target.checked ? '1' : '')}
            />
            <span>Open seats only (sections pane)</span>
          </label>
        </motion.aside>

        <motion.main
          className="ce-main"
          initial={reduced ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reduced ? 0 : 0.4, ease: EASE_OUT, delay: reduced ? 0 : 0.05 }}
        >
          <section className="ce-stats ce-stats-inline" aria-live="polite">
            <div className="ce-stat">
              <span className="ce-stat-n">{loading ? '…' : total.toLocaleString()}</span>
              <span className="ce-stat-l">courses · this quarter</span>
            </div>
            {meta?.label ? (
              <div className="ce-stat ce-stat-muted">
                <span className="ce-stat-n ce-stat-n-sm">{meta.label}</span>
                <span className="ce-stat-l">catalog</span>
              </div>
            ) : null}
          </section>

          <section className="ce-discover">
            <h2 className="ce-h2">Browse by subject</h2>
            <motion.div
              className="ce-tiles ce-tiles-wide"
              variants={staggerContainer(reduced, 0.055)}
              initial="hidden"
              animate="show"
            >
              {featuredOrdered.map(({ dept: d, label }) => {
                const n = countsByDept.get(d) ?? 0
                const on = dept === d
                return (
                  <motion.button
                    key={d}
                    type="button"
                    className={`ce-tile ${on ? 'on' : ''}`}
                    variants={staggerItem(reduced)}
                    whileHover={reduced ? undefined : { y: -2 }}
                    whileTap={reduced ? undefined : { scale: 0.98 }}
                    onClick={() => setParam('dept', on ? '' : d)}
                  >
                    <span className="ce-tile-dept">{d}</span>
                    <span className="ce-tile-name">{label}</span>
                    <span className="ce-tile-count">
                      {loading ? '—' : filteredView ? `${n} in view` : `${n} courses`}
                    </span>
                  </motion.button>
                )
              })}
            </motion.div>
          </section>

          {error ? (
            <div className="ce-empty ce-empty-err">
              <strong>Could not load catalog.</strong>
              <p>
                API at <code>{(import.meta.env.VITE_API_BASE as string) || 'http://localhost:8000'}</code>
              </p>
              <p className="ce-empty-detail">{error}</p>
            </div>
          ) : loading && courses.length === 0 ? (
            <div className="ce-empty">Loading UCSB catalog… first load can take a minute.</div>
          ) : rankedRows.length === 0 ? (
            <div className="ce-empty">No courses match these filters.</div>
          ) : (
            <>
              {showPersonalStrip ? (
                <p className="ce-personal-strip ce-personal-strip-wide">
                  <span className="ce-personal-label">For you</span>
                  Boosting <strong>{personalization.majorNames.join(' · ')}</strong> reqs — change majors in{' '}
                  <Link to="/onboarding" className="ce-link">
                    onboarding
                  </Link>
                  .
                </p>
              ) : null}
              <nav className="ce-pagination" aria-label="Course list pages">
                <span>
                  Showing {(pageNum - 1) * PAGE_SIZE + 1}–{Math.min(pageNum * PAGE_SIZE, rankedRows.length)} of{' '}
                  {rankedRows.length.toLocaleString()} · {PAGE_SIZE} per page
                </span>
                <div className="ce-pagination-btns">
                  <button
                    type="button"
                    className="ce-page-btn"
                    disabled={pageNum <= 1}
                    onClick={() => setParam('page', pageNum <= 2 ? '' : String(pageNum - 1))}
                  >
                    Previous
                  </button>
                  <span className="ce-mono" style={{ color: 'var(--gray-600)', fontSize: '0.68rem' }}>
                    Page {pageNum} / {maxPage}
                  </span>
                  <button
                    type="button"
                    className="ce-page-btn"
                    disabled={pageNum >= maxPage}
                    onClick={() => setParam('page', String(pageNum + 1))}
                  >
                    Next
                  </button>
                </div>
              </nav>
              <motion.div
                className="ce-card-grid"
                key={`cards-${effectiveQuarter}-${dept}-${ge}-${level}-${q}-p${pageNum}`}
                initial={reduced ? false : { opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: reduced ? 0 : 0.38, ease: EASE_OUT }}
              >
                {pageSlice.map(({ c, score }) => {
                  const cn = toCourseNorm(c.course_norm)
                  const isDone = completedNorms.has(cn)
                  const isReq = personalization.neededCourseNorms.has(cn)
                  const rowForYou = score >= 80 && !isDone
                  const norm = c.course_norm.trim()
                  const ex = extras[norm]
                  return (
                    <button
                      key={c.course_norm}
                      type="button"
                      className={`ce-course-card ${rowForYou ? 'ce-course-card-hot' : ''}`}
                      onClick={() => setParam('course', norm)}
                    >
                      <div className="ce-course-card-top">
                        {isReq && !isDone ? (
                          <span className="ce-pill-tag">req</span>
                        ) : inProgressNorms.has(cn) ? (
                          <span className="ce-pill-tag ce-pill-tag-ip">now</span>
                        ) : isDone ? (
                          <span className="ce-pill-tag ce-pill-tag-done">done</span>
                        ) : (
                          <span className="ce-course-card-spacer" />
                        )}
                        <span className="ce-course-card-code">{norm}</span>
                      </div>
                      <div className="ce-course-card-title">{c.title?.trim() || '—'}</div>
                      <div className="ce-course-card-prof">
                        <strong>Instructor</strong>{' '}
                        {ex?.status === 'loading' ? (
                          <span className="ce-card-skel" style={{ display: 'inline-block', width: '72%', maxWidth: '14rem' }} />
                        ) : ex?.status === 'ready' ? (
                          ex.instructor || 'TBA'
                        ) : (
                          '—'
                        )}
                      </div>
                      <div>
                        {ex?.status === 'loading' ? (
                          <span className="ce-card-skel" style={{ display: 'inline-block', width: '55%', maxWidth: '10rem' }} />
                        ) : ex?.status === 'ready' ? (
                          <RmpStars r={ex.rmp} n={ex.rmpN} />
                        ) : null}
                      </div>
                      <div className="ce-course-card-sched">
                        {ex?.status === 'loading' ? (
                          <span className="ce-card-skel" style={{ display: 'block', width: '88%', maxWidth: '18rem' }} />
                        ) : ex?.status === 'ready' ? (
                          ex.schedule
                        ) : null}
                      </div>
                      <div className="ce-course-card-meta">
                        <span>{c.units_fixed != null ? `${c.units_fixed} units` : '—'}</span>
                        <span className="ce-course-card-ge">
                          {c.ge_areas.length ? c.ge_areas.join(' · ') : 'No GE tag'}
                        </span>
                        <span className="ce-course-card-cap">{c.level}</span>
                      </div>
                      <span className="ce-course-card-cta">Full sections &amp; grades →</span>
                    </button>
                  )
                })}
              </motion.div>

              <motion.div
                className="ce-table-wrap ce-table-dense"
                key={`table-${effectiveQuarter}-${dept}-${ge}-${level}-${q}-p${pageNum}`}
                initial={reduced ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: reduced ? 0 : 0.35, delay: reduced ? 0 : 0.05 }}
              >
                <table className="ce-table">
                  <caption className="ce-table-cap">Compact table · same rows as cards</caption>
                  <thead>
                    <tr>
                      <th className="ce-th-tag" aria-hidden />
                      <th>Code</th>
                      <th>Title</th>
                      <th>Instructor</th>
                      <th>When</th>
                      <th>RMP</th>
                      <th className="ce-th-n">Units</th>
                      <th>GE</th>
                      <th className="ce-th-n">Level</th>
                      <th className="ce-th-action" />
                    </tr>
                  </thead>
                  <tbody>
                    {pageSlice.map(({ c, score }) => {
                      const cn = toCourseNorm(c.course_norm)
                      const isDone = completedNorms.has(cn)
                      const isReq = personalization.neededCourseNorms.has(cn)
                      const rowForYou = score >= 80 && !isDone
                      const norm = c.course_norm.trim()
                      const ex = extras[norm]
                      return (
                        <tr
                          key={`t-${c.course_norm}`}
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
                          <td className="ce-mono">{norm}</td>
                          <td className="ce-titlecell">{c.title?.trim() || '—'}</td>
                          <td className="ce-ge">
                            {ex?.status === 'loading'
                              ? '…'
                              : ex?.status === 'ready'
                                ? ex.instructor || '—'
                                : '—'}
                          </td>
                          <td className="ce-ge">
                            {ex?.status === 'loading'
                              ? '…'
                              : ex?.status === 'ready'
                                ? ex.schedule
                                : '—'}
                          </td>
                          <td className="ce-n">
                            {ex?.status === 'ready' && ex.rmp != null && ex.rmp > 0 ? ex.rmp.toFixed(1) : '—'}
                          </td>
                          <td className="ce-n">{c.units_fixed != null ? String(c.units_fixed) : '—'}</td>
                          <td className="ce-ge">{c.ge_areas.length ? c.ge_areas.join(', ') : '—'}</td>
                          <td className="ce-n">{c.level}</td>
                          <td className="ce-td-action">
                            <button
                              type="button"
                              className="ce-linkbtn"
                              onClick={() => setParam('course', norm)}
                            >
                              Open
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </motion.div>
            </>
          )}

          <footer className="ce-foot ce-foot-wide">
            Not affiliated with UC Santa Barbara. Catalog: official API; grade charts: historical Nexus-derived
            distributions in ACE; section predictions: ACE model on held-out metrics (see MODEL_CARD).
          </footer>
        </motion.main>
      </div>

      <AnimatePresence>
        {courseOpen ? (
          <motion.div
            key="ce-drawer"
            className="ce-drawer-root"
            role="dialog"
            aria-modal="true"
            aria-label="Course detail"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduced ? 0.12 : 0.28 }}
          >
            <motion.button
              type="button"
              className="ce-drawer-scrim"
              aria-label="Close"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={closeDrawer}
            />
            <motion.aside
              className="ce-drawer"
              initial={reduced ? { x: 0 } : { x: '100%' }}
              animate={{ x: 0 }}
              exit={reduced ? { x: 0 } : { x: '100%' }}
              transition={
                reduced
                  ? { duration: 0.12 }
                  : { type: 'spring', stiffness: 320, damping: 34, mass: 0.85 }
              }
            >
            <div className="ce-drawer-head">
              <button type="button" className="ce-drawer-x" onClick={closeDrawer} aria-label="Close drawer">
                ×
              </button>
              {dLoading ? (
                <p className="ce-drawer-loading">Loading course…</p>
              ) : dErr ? (
                <p className="ce-drawer-err">{dErr}</p>
              ) : dCourse ? (
                <>
                  <h2 className="ce-drawer-title">{dCourse.course_norm.trim()}</h2>
                  <p className="ce-drawer-sub">{dCourse.title?.trim() || '—'}</p>
                  {dCourse.detail_source === 'ucsb_catalog_cache' ? (
                    <p className="ce-drawer-hint">
                      Details from live UCSB catalog (no Supabase course row yet). Run pipeline +{' '}
                      <code className="ce-mono">07_load_to_supabase</code> for full DB sync.
                    </p>
                  ) : null}
                  <div className="ce-drawer-chips">
                    <span>{dCourse.units_fixed != null ? `${dCourse.units_fixed} units` : '—'}</span>
                    <span>{dCourse.ge_areas.length ? dCourse.ge_areas.join(' · ') : 'No GE'}</span>
                    <span>{dCourse.level}</span>
                  </div>
                </>
              ) : null}
            </div>
            {dCourse?.description ? (
              <p className="ce-drawer-desc">{dCourse.description.trim().slice(0, 520)}</p>
            ) : null}

            {trendBars.length > 0 || dTrend.length > 0 ? (
              <section className="ce-drawer-section">
                <h3 className="ce-drawer-h3">Historical grades (Nexus)</h3>
                <p className="ce-drawer-hint">
                  Department-reported distributions · not your personal grades
                </p>
                {trendBars.length > 0 ? (
                  <>
                    <h4 className="ce-drawer-h4">Mean GPA by term</h4>
                    <div ref={sparkWrapRef} className="ce-spark" role="img" aria-label="Grade trend bars">
                      {trendBars.map((b) => {
                        const h = b.gpa != null ? Math.round(((b.gpa - 2) / 2) * 100) : 0
                        return (
                          <div key={b.k} className="ce-spark-cell" title={`${b.k}: ${b.gpa?.toFixed(2)}`}>
                            <div className="ce-spark-bar" style={{ height: `${Math.min(100, Math.max(8, h))}%` }} />
                            <span className="ce-spark-label">{b.q.slice(0, 1)}</span>
                          </div>
                        )
                      })}
                    </div>
                  </>
                ) : null}
                {dTrend.length > 0 ? (
                  <>
                    <h4 className={trendBars.length ? 'ce-drawer-h4 ce-drawer-h4--spaced' : 'ce-drawer-h4'}>
                      Letter distribution by quarter
                    </h4>
                    <GradeDistributionViz key={courseOpen} points={dTrend} />
                  </>
                ) : null}
              </section>
            ) : null}

            <section className="ce-drawer-section">
              <h3 className="ce-drawer-h3">Sections · {effectiveQuarter}</h3>
              {dSections.length === 0 ? (
                <p className="ce-drawer-empty">No section rows for this course in Supabase for this quarter.</p>
              ) : (
                <div className="ce-sec-scroll">
                  <table className="ce-sec-table">
                    <thead>
                      <tr>
                        <th>Sec</th>
                        <th>When</th>
                        <th>Instructor</th>
                        <th>Room</th>
                        <th>Seats</th>
                        <th>Pred. GPA</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dSections.map((s) => {
                        const pr = predByEnroll.get(s.enroll_code)
                        const when = [s.days, s.begin_time, s.end_time].filter(Boolean).join(' ')
                        const room = [s.building, s.room].filter(Boolean).join(' ')
                        const seat =
                          s.open_seats != null && s.max_enroll != null
                            ? `${s.open_seats}/${s.max_enroll}`
                            : '—'
                        return (
                          <tr key={s.enroll_code}>
                            <td className="ce-mono">{s.section_label || '—'}</td>
                            <td>{when || '—'}</td>
                            <td>{s.instructor_norm || 'TBA'}</td>
                            <td>{room || '—'}</td>
                            <td>{seat}</td>
                            <td>
                              {pr ? (
                                <span className="ce-pred" title={`${pr.regime} · σ≈${pr.predicted_gpa_std.toFixed(2)}`}>
                                  <span className="ce-pred-mu">{pr.predicted_gpa.toFixed(2)}</span>
                                  <span className="ce-pred-lohi">
                                    {' '}
                                    ({pr.gpa_lo.toFixed(1)}–{pr.gpa_hi.toFixed(1)})
                                  </span>
                                </span>
                              ) : (
                                '—'
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
            </motion.aside>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.div>
  )
}
