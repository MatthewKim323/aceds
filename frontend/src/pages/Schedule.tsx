import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useLocation, useSearchParams } from 'react-router-dom'
import { motion, AnimatePresence } from 'motion/react'
import { useAuth } from '../lib/auth'
import { getProfile } from '../lib/profile'
import {
  DEFAULT_OPTIMIZE_PREFS,
  profileRowToOptimizePreferences,
} from '../lib/optimizer-preferences'
import { getMajorById, type Major } from '../data/majors'
import {
  api,
  type CatalogMeta,
  type Course,
  type OptimizePreferences,
  type OptimizeResponsePayload,
  type ScheduleCandidate,
} from '../lib/api'
import { quarterLabelFromCode, quarterSelectOptions } from '../lib/quarters'
import { toCourseNorm } from '../lib/pdf-parser'
import { buildSatisfiedCourseSet } from '../lib/satisfied-courses'
import { ScheduleOptimizeResults } from '../components/ScheduleOptimizeResults'
import {
  OptimizePipelineOverlay,
  type PipelineLogLine,
} from '../components/OptimizePipelineOverlay'
import {
  deleteSavedSchedule,
  listSavedSchedules,
  type SavedScheduleRow,
} from '../lib/saved-schedules'

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

function normKey(c: string): string {
  return toCourseNorm(c)
}

/** Undergrad-style numbering: course number ≥ 100 reads as upper-division (aligned with majors.ts). */
function isUpperDivisionCourseId(rawId: string): boolean {
  const u = rawId.trim().toUpperCase()
  const matches = u.match(/\b(\d{1,3})(?:[A-Z]{1,3})?\b/g)
  if (!matches?.length) return false
  const last = matches[matches.length - 1]
  const n = parseInt(/\d+/.exec(last)?.[0] ?? '', 10)
  return Number.isFinite(n) && n >= 100
}

function mergedMajorUdPools(
  majorIds: string[],
  completedSet: Set<string>,
): {
  requiredUd: string[]
  electiveUd: string[]
  label: string
  invalidIds: string[]
} | null {
  const base = mergedMajorPool(majorIds, completedSet)
  if (!base) return null
  return {
    requiredUd: base.required.filter(isUpperDivisionCourseId),
    electiveUd: base.optional.filter(isUpperDivisionCourseId),
    label: base.label,
    invalidIds: base.invalidIds,
  }
}

const GE_AREAS: { code: string; label: string }[] = [
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

type PoolSector = 'ge' | 'ud_req' | 'ud_elec'

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

export function Schedule() {
  const { user, loading: authLoading } = useAuth()
  const location = useLocation()
  const [params, setParams] = useSearchParams()

  const quarterParam = (params.get('quarter') || '').trim()
  const [meta, setMeta] = useState<CatalogMeta | null>(null)

  const setQuarterParam = useCallback(
    (code: string) => {
      setParams(
        (prev) => {
          const n = new URLSearchParams(prev)
          if (code) n.set('quarter', code)
          else n.delete('quarter')
          return n
        },
        { replace: true },
      )
    },
    [setParams],
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
      } catch {
        if (!cancelled) setMeta(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [quarterParam, setParams])

  const scheduleQuarter = quarterParam || meta?.quarter || ''
  const quarterOptions = useMemo(() => quarterSelectOptions(meta), [meta])
  const quarterLabel = useMemo(() => {
    const hit = quarterOptions.find((o) => o.code === scheduleQuarter)
    return hit?.label ?? quarterLabelFromCode(scheduleQuarter)
  }, [quarterOptions, scheduleQuarter])

  const [majorIds, setMajorIds] = useState<string[]>([])
  const [completedSet, setCompletedSet] = useState<Set<string>>(new Set())

  const [requiredCourses, setRequiredCourses] = useState<string[]>([])
  const [optionalCourses, setOptionalCourses] = useState<string[]>([])
  const [excludedCourses, setExcludedCourses] = useState<Set<string>>(new Set())
  const [prefs, setPrefs] = useState<OptimizePreferences>(() => ({
    ...DEFAULT_OPTIMIZE_PREFS,
  }))
  const [running, setRunning] = useState(false)
  const [pipelineLines, setPipelineLines] = useState<PipelineLogLine[]>([])
  const [candidates, setCandidates] = useState<ScheduleCandidate[]>([])
  const [error, setError] = useState<string | null>(null)
  const [optimizeReturnedEmpty, setOptimizeReturnedEmpty] = useState(false)
  const [optimizeNotes, setOptimizeNotes] = useState<string[]>([])
  const [resultsModalOpen, setResultsModalOpen] = useState(false)
  const [resultsModalCandidates, setResultsModalCandidates] = useState<ScheduleCandidate[]>([])
  const [resultsQuarterCode, setResultsQuarterCode] = useState('')
  const [resultsQuarterLabel, setResultsQuarterLabel] = useState('')
  const [courseGrades, setCourseGrades] = useState<Record<string, string>>({})
  const [cumulativeGpa, setCumulativeGpa] = useState<number | null>(null)
  const [savedRows, setSavedRows] = useState<SavedScheduleRow[]>([])
  const [savedLoading, setSavedLoading] = useState(false)
  const [savedErr, setSavedErr] = useState<string | null>(null)

  const [offeringsLoading, setOfferingsLoading] = useState(true)
  const [offeringsErr, setOfferingsErr] = useState<string | null>(null)
  const [offeredNorms, setOfferedNorms] = useState<Set<string> | null>(null)

  const [geArea, setGeArea] = useState('B')
  const [poolSector, setPoolSector] = useState<PoolSector>('ge')
  const [poolQuery, setPoolQuery] = useState('')
  const [poolDebounced, setPoolDebounced] = useState('')
  const [poolHits, setPoolHits] = useState<Course[]>([])
  const [poolLoading, setPoolLoading] = useState(false)

  const closeResultsModal = useCallback(() => setResultsModalOpen(false), [])

  const refreshSavedSchedules = useCallback(async () => {
    if (!user) return
    setSavedLoading(true)
    setSavedErr(null)
    try {
      const rows = await listSavedSchedules(user.id)
      setSavedRows(rows)
    } catch (e) {
      setSavedErr(String((e as Error).message || e))
      setSavedRows([])
    } finally {
      setSavedLoading(false)
    }
  }, [user])

  useEffect(() => {
    void refreshSavedSchedules()
  }, [refreshSavedSchedules])

  useEffect(() => {
    if (!user) return
    getProfile(user.id).then(({ profile }) => {
      if (!profile) return
      const p = profile as unknown as {
        major: string
        completed_courses: string[]
        course_grades?: Record<string, string>
        cumulative_gpa?: number | null
        ap_credits?: { exam: string; ucsb_equivalent: string[]; units: number; score: number | null }[]
      }
      const ids =
        p.major
          ?.split(',')
          .map((s) => s.trim())
          .filter(Boolean) ?? []
      setMajorIds(ids)
      setCompletedSet(
        buildSatisfiedCourseSet(p.completed_courses || [], p.ap_credits ?? []),
      )
      setPrefs(profileRowToOptimizePreferences(profile as Record<string, unknown>))
      setCourseGrades({ ...(p.course_grades ?? {}) })
      setCumulativeGpa(p.cumulative_gpa ?? null)
    })
  }, [user, location.pathname, location.key])

  const majorDerived = useMemo(
    () => mergedMajorPool(majorIds, completedSet),
    [majorIds, completedSet],
  )

  const majorUdDerived = useMemo(
    () => mergedMajorUdPools(majorIds, completedSet),
    [majorIds, completedSet],
  )

  const majorRequiredUdNormSet = useMemo(() => {
    if (!majorUdDerived?.requiredUd.length) return null as Set<string> | null
    return new Set(majorUdDerived.requiredUd.map((c) => normKey(c)))
  }, [majorUdDerived])

  const majorElectiveUdNormSet = useMemo(() => {
    if (!majorUdDerived?.electiveUd.length) return null as Set<string> | null
    return new Set(majorUdDerived.electiveUd.map((c) => normKey(c)))
  }, [majorUdDerived])

  useEffect(() => {
    if (!scheduleQuarter) {
      setOfferingsLoading(false)
      setOfferedNorms(null)
      return
    }
    let cancelled = false
    setOfferingsLoading(true)
    setOfferingsErr(null)
    api
      .listDistinctCourseNorms(scheduleQuarter)
      .then((r) => {
        if (!cancelled) setOfferedNorms(new Set(r.course_norms))
      })
      .catch((e) => {
        if (!cancelled) {
          setOfferingsErr(String((e as Error).message || e))
          setOfferedNorms(null)
        }
      })
      .finally(() => {
        if (!cancelled) setOfferingsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [scheduleQuarter])

  useEffect(() => {
    const t = window.setTimeout(() => setPoolDebounced(poolQuery.trim()), 350)
    return () => window.clearTimeout(t)
  }, [poolQuery])

  useEffect(() => {
    let cancelled = false
    setPoolLoading(true)

    const runGe = () => {
      api
        .listCourses({ ge: geArea, search: poolDebounced || undefined, limit: 80 })
        .then((page) => {
          if (!cancelled) setPoolHits(page.items)
        })
        .catch(() => {
          if (!cancelled) setPoolHits([])
        })
        .finally(() => {
          if (!cancelled) setPoolLoading(false)
        })
    }

    const runUdReq = () => {
      if (!majorRequiredUdNormSet?.size) {
        setPoolHits([])
        setPoolLoading(false)
        return
      }
      const q = poolDebounced.trim()
      if (!q) {
        setPoolHits([])
        setPoolLoading(false)
        return
      }
      api
        .listCourses({ search: q, limit: 150 })
        .then((page) => {
          const filtered = page.items.filter((row) =>
            majorRequiredUdNormSet!.has(normKey(row.course_norm)),
          )
          if (!cancelled) setPoolHits(filtered.slice(0, 50))
        })
        .catch(() => {
          if (!cancelled) setPoolHits([])
        })
        .finally(() => {
          if (!cancelled) setPoolLoading(false)
        })
    }

    const runUdElec = () => {
      if (!majorElectiveUdNormSet?.size) {
        setPoolHits([])
        setPoolLoading(false)
        return
      }
      const q = poolDebounced.trim()
      if (!q) {
        setPoolHits([])
        setPoolLoading(false)
        return
      }
      api
        .listCourses({ search: q, limit: 150 })
        .then((page) => {
          const filtered = page.items.filter((row) =>
            majorElectiveUdNormSet!.has(normKey(row.course_norm)),
          )
          if (!cancelled) setPoolHits(filtered.slice(0, 50))
        })
        .catch(() => {
          if (!cancelled) setPoolHits([])
        })
        .finally(() => {
          if (!cancelled) setPoolLoading(false)
        })
    }

    if (poolSector === 'ge') runGe()
    else if (poolSector === 'ud_req') runUdReq()
    else runUdElec()

    return () => {
      cancelled = true
    }
  }, [poolSector, poolDebounced, geArea, majorRequiredUdNormSet, majorElectiveUdNormSet])

  async function runOptimizer() {
    if (!user || !scheduleQuarter) return
    setRunning(true)
    setError(null)
    setOptimizeReturnedEmpty(false)
    setOptimizeNotes([])
    setPipelineLines([])
    const mergedPrefs = effectiveOptimizePrefs(majorIds, {
      ...prefs,
      risk_lambda: prefs.risk_lambda ?? 0,
    })
    const body = {
      quarter_code: scheduleQuarter,
      major_id: majorIds[0] ?? 'custom_pool',
      required_courses: requiredCourses,
      optional_courses: optionalCourses,
      excluded_courses: Array.from(excludedCourses),
      completed_courses: Array.from(completedSet),
      preferences: mergedPrefs,
      top_k: 3,
      user_id: user.id,
    }

    const applyResp = (resp: OptimizeResponsePayload) => {
      setCandidates(resp.candidates)
      setOptimizeReturnedEmpty(resp.candidates.length === 0)
      setOptimizeNotes(resp.optimize_notes ?? [])
      if (resp.candidates.length > 0) {
        setResultsModalCandidates(resp.candidates)
        setResultsQuarterCode(scheduleQuarter)
        setResultsQuarterLabel(quarterLabel)
        setResultsModalOpen(true)
      }
    }

    try {
      try {
        const resp = await api.optimizeStream(body, {
          onPhase: (e) => {
            const label = typeof e.label === 'string' ? e.label : e.phase
            const rest: Record<string, unknown> = { ...e }
            delete rest.phase
            delete rest.label
            const keys = Object.keys(rest)
            let meta: string | undefined
            if (keys.length) {
              try {
                meta = JSON.stringify(rest)
                if (meta.length > 160) meta = `${meta.slice(0, 157)}…`
              } catch {
                meta = undefined
              }
            }
            setPipelineLines((prev) => [
              ...prev,
              {
                id: `${performance.now()}-${prev.length}`,
                phase: e.phase,
                label,
                meta,
              },
            ])
          },
        })
        applyResp(resp)
      } catch (streamErr) {
        const msg = String((streamErr as Error).message ?? streamErr)
        setPipelineLines((prev) => [
          ...prev,
          {
            id: `fallback-${performance.now()}`,
            phase: 'fallback',
            label: 'Stream unavailable — using sync optimize',
            meta: msg.slice(0, 180),
          },
        ])
        const resp = await api.optimize(body)
        applyResp(resp)
      }
    } catch (e) {
      setError(String((e as Error).message || e))
      setCandidates([])
      setOptimizeReturnedEmpty(false)
      setOptimizeNotes([])
    } finally {
      setRunning(false)
    }
  }

  const electiveActiveCount = optionalCourses.filter((c) => !excludedCourses.has(c)).length

  const canOptimize =
    Boolean(user) &&
    Boolean(scheduleQuarter) &&
    (requiredCourses.length > 0 || electiveActiveCount > 0)

  const poolSearchPlaceholder = useMemo(() => {
    if (poolSector === 'ge') return 'Title or code (e.g. PHIL, ethics)'
    if (poolSector === 'ud_req') return 'e.g. PSTAT 122, core'
    return 'e.g. PSTAT 130, MATH 108A'
  }, [poolSector])

  const udReqLaneOpen = Boolean(majorUdDerived?.requiredUd.length)
  const udElecLaneOpen = Boolean(majorUdDerived?.electiveUd.length)

  function addOptionalFromCatalog(cid: string) {
    const k = normKey(cid)
    setExcludedCourses((ex) => {
      const n = new Set<string>()
      for (const x of ex) {
        if (normKey(x) !== k) n.add(x)
      }
      return n
    })
    setOptionalCourses((o) => (o.some((x) => normKey(x) === k) ? o : [...o, cid]))
  }

  function addRequiredFromCatalog(cid: string) {
    const k = normKey(cid)
    setOptionalCourses((o) => o.filter((x) => normKey(x) !== k))
    setExcludedCourses((ex) => {
      const n = new Set<string>()
      for (const x of ex) {
        if (normKey(x) !== k) n.add(x)
      }
      return n
    })
    setRequiredCourses((r) => (r.some((x) => normKey(x) === k) ? r : [...r, cid]))
  }

  function removeFromPool(cid: string) {
    const k = normKey(cid)
    setRequiredCourses((r) => r.filter((x) => normKey(x) !== k))
    setOptionalCourses((o) => o.filter((x) => normKey(x) !== k))
    setExcludedCourses((ex) => {
      const n = new Set<string>()
      for (const x of ex) {
        if (normKey(x) !== k) n.add(x)
      }
      return n
    })
  }

  function demoteToElective(cid: string) {
    const k = normKey(cid)
    setRequiredCourses((r) => r.filter((x) => normKey(x) !== k))
    setOptionalCourses((o) => (o.some((x) => normKey(x) === k) ? o : [...o, cid]))
  }

  function promoteFromElectiveToRequired(cid: string) {
    const k = normKey(cid)
    setOptionalCourses((o) => o.filter((x) => normKey(x) !== k))
    setExcludedCourses((ex) => {
      const n = new Set<string>()
      for (const x of ex) {
        if (normKey(x) !== k) n.add(x)
      }
      return n
    })
    setRequiredCourses((r) => (r.some((x) => normKey(x) === k) ? r : [...r, cid]))
  }

  function toggleExcludeElective(cid: string) {
    setExcludedCourses((ex) => {
      const n = new Set(ex)
      if (n.has(cid)) n.delete(cid)
      else n.add(cid)
      return n
    })
  }

  const fillSuggestedFromMajor = useCallback(() => {
    if (!majorDerived) return
    setRequiredCourses(majorDerived.required.slice(0, 4))
    setOptionalCourses(prioritizeOptionalForPool(majorIds, majorDerived.optional))
    setExcludedCourses(new Set())
  }, [majorDerived, majorIds])

  if (authLoading) return null
  if (!user) return <Navigate to="/auth" replace />

  return (
    <div className="sb">
      <OptimizePipelineOverlay open={running} lines={pipelineLines} />
      <header className="sb-header">
        <div>
          <Link to="/dashboard" className="sb-back">&larr; dashboard</Link>
          <h1 className="sb-title">Schedule Builder</h1>
          <p className="sb-sub">
            <span className="sb-quarter-inline">
              <label htmlFor="sb-schedule-quarter" className="sb-quarter-inline-label">
                Quarter
              </label>
              <select
                id="sb-schedule-quarter"
                className="sb-quarter-select"
                value={
                  scheduleQuarter && quarterOptions.some((o) => o.code === scheduleQuarter)
                    ? scheduleQuarter
                    : (quarterOptions[0]?.code ?? '')
                }
                onChange={(e) => setQuarterParam(e.target.value)}
                aria-label="Quarter to build schedule for"
              >
                {quarterOptions.map((opt) => (
                  <option key={opt.code} value={opt.code}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </span>
            {majorDerived ? `${majorDerived.label} · ${quarterLabel}` : quarterLabel}
            {' · pool: '}
            <span className="sb-accent">
              {requiredCourses.length} must · {electiveActiveCount} elective active
              {optionalCourses.length > electiveActiveCount
                ? ` · ${optionalCourses.length - electiveActiveCount} elective skipped`
                : ''}
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
            <strong>regime</strong>. σ is the test RMSE bucket from the model card. Your{' '}
            <strong>pool</strong> is whatever you add below — not a degree audit.
          </p>
          {!canOptimize && (
            <p className="sb-run-hint">
              Add courses from <strong>Discover</strong> into <strong>Your pool</strong>, then optimize.
              {majorDerived ? (
                <>
                  {' '}
                  Optional shortcut:{' '}
                  <button
                    type="button"
                    className="sb-inline-link"
                    onClick={fillSuggestedFromMajor}
                  >
                    Prefill from major sheet
                  </button>
                  .
                </>
              ) : null}
            </p>
          )}
        </div>
        <div className="sb-header-actions">
          <Link to="/settings?tab=preferences" className="sb-view-results">
            Preferences
          </Link>
          {candidates.length > 0 && (
            <button
              type="button"
              className="sb-view-results"
              onClick={() => {
                setResultsModalCandidates(candidates)
                setResultsQuarterCode(scheduleQuarter)
                setResultsQuarterLabel(quarterLabel)
                setResultsModalOpen(true)
              }}
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

      <section className="sb-pane sb-discovery-pane">
        <div className="sb-discovery-head">
          <h2 className="sb-pane-title">Discover courses</h2>
          <p className="sb-discovery-sub">
            One search bar · choose GE, UD required, or UD electives · results from{' '}
            <code className="sb-code">courses</code> ({quarterLabel} import overlay when available).
          </p>
        </div>

        {offeringsLoading && (
          <p className="sb-discovery-meta">Loading schedule import index…</p>
        )}
        {offeringsErr && (
          <p className="sb-discovery-meta sb-discovery-meta-warn" role="status">
            Could not load import index: {offeringsErr}
          </p>
        )}
        {!offeringsLoading && offeredNorms && (
          <p className="sb-discovery-meta">
            <strong>{offeredNorms.size}</strong> courses with sections in import for{' '}
            <code className="sb-code">{scheduleQuarter || '…'}</code>
          </p>
        )}

        <div className="sb-glass-search-shell">
          <motion.div
            layout
            className="sb-glass-search"
            transition={{ duration: 0.32, ease: [0.25, 0.1, 0.25, 1] }}
          >
            <div className="sb-search-sector-wrap">
              <select
                className="sb-search-sector"
                value={poolSector}
                onChange={(e) => setPoolSector(e.target.value as PoolSector)}
                aria-label="Search scope"
              >
                <option value="ge">General education</option>
                <option value="ud_req">Major · UD required</option>
                <option value="ud_elec">Major · UD electives</option>
              </select>
            </div>
            <input
              type="search"
              className="sb-search-input-glass"
              value={poolQuery}
              onChange={(e) => setPoolQuery(e.target.value)}
              placeholder={poolSearchPlaceholder}
              autoComplete="off"
              aria-label="Search courses"
            />
          </motion.div>

          <AnimatePresence mode="wait">
            {poolSector === 'ge' && (
              <motion.div
                key="ge-strip"
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.26, ease: [0.25, 0.1, 0.25, 1] }}
                className="sb-ge-strip"
              >
                <span className="sb-ge-strip-label">GE area</span>
                <div className="ce-pills sb-ge-pills-wrap">
                  {GE_AREAS.map((g) => (
                    <button
                      key={g.code}
                      type="button"
                      className={`ce-pill ${geArea === g.code ? 'on' : ''}`}
                      title={g.label}
                      onClick={() => setGeArea(g.code)}
                    >
                      {g.code}
                    </button>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="sb-catalog-panel sb-catalog-panel-unified">
          {poolSector === 'ud_req' && !udReqLaneOpen && (
            <p className="sb-pool-ghost">
              {majorDerived ? (
                <>No UD singleton requirements left in your sheet — try GE or UD electives.</>
              ) : (
                <>
                  <Link to="/settings">Settings</Link> — add a bundled major for UD lanes (GE works without).
                </>
              )}
            </p>
          )}
          {poolSector === 'ud_elec' && !udElecLaneOpen && (
            <p className="sb-pool-ghost">
              {majorDerived ? (
                <>No UD elective lists left, or groups satisfied.</>
              ) : (
                <>
                  <Link to="/settings">Settings</Link> — add a bundled major for UD lanes.
                </>
              )}
            </p>
          )}

          {(poolSector === 'ge' ||
            (poolSector === 'ud_req' && udReqLaneOpen) ||
            (poolSector === 'ud_elec' && udElecLaneOpen)) &&
            (poolLoading ? (
              <p className="sb-pool-status">
                {poolSector === 'ge' ? 'Loading catalog courses…' : 'Searching…'}
              </p>
            ) : (
              <div className="sb-course-pool sb-course-pool-scroll sb-catalog-results sb-catalog-results-unified">
                {poolHits.length === 0 ? (
                  <span className="sb-pool-empty">
                    {poolSector === 'ge'
                      ? 'No courses match this filter.'
                      : poolSector === 'ud_req'
                        ? poolDebounced.trim()
                          ? 'No matching UD required courses.'
                          : 'Search UD requirements'
                        : poolDebounced.trim()
                          ? 'No matching UD elective courses.'
                          : 'Search elective pools'}
                  </span>
                ) : (
                  poolHits.map((row) => {
                    const offered = offeredNorms?.has(normKey(row.course_norm)) ?? false
                    return (
                      <div key={row.course_norm} className="sb-pool-chip-row sb-ge-result-row">
                        <div className="sb-ge-result-meta">
                          <span className="sb-course-chip ghost">{row.course_norm}</span>
                          <span className="sb-ge-result-title">{row.title || '—'}</span>
                          <span className={`sb-ge-offered-tag ${offered ? 'yes' : 'no'}`}>
                            {offered ? 'In import' : 'Not in import'}
                          </span>
                        </div>
                        {poolSector === 'ge' && (
                          <>
                            <button
                              type="button"
                              className="sb-pool-mini"
                              onClick={() => addOptionalFromCatalog(row.course_norm)}
                            >
                              + elective
                            </button>
                            <button
                              type="button"
                              className="sb-pool-mini"
                              onClick={() => addRequiredFromCatalog(row.course_norm)}
                            >
                              + must take
                            </button>
                          </>
                        )}
                        {poolSector === 'ud_req' && (
                          <>
                            <button
                              type="button"
                              className="sb-pool-mini sb-pool-mini-primary"
                              onClick={() => addRequiredFromCatalog(row.course_norm)}
                            >
                              + must take
                            </button>
                            <button
                              type="button"
                              className="sb-pool-mini"
                              onClick={() => addOptionalFromCatalog(row.course_norm)}
                            >
                              + elective
                            </button>
                          </>
                        )}
                        {poolSector === 'ud_elec' && (
                          <>
                            <button
                              type="button"
                              className="sb-pool-mini sb-pool-mini-primary"
                              onClick={() => addOptionalFromCatalog(row.course_norm)}
                            >
                              + elective
                            </button>
                            <button
                              type="button"
                              className="sb-pool-mini"
                              onClick={() => addRequiredFromCatalog(row.course_norm)}
                            >
                              + must take
                            </button>
                          </>
                        )}
                      </div>
                    )
                  })
                )}
              </div>
            ))}
        </div>
      </section>

      <section className="sb-pane sb-your-pool-pane">
        <div className="sb-pane-title-row">
          <h2 className="sb-pane-title">Your pool</h2>
          {majorDerived ? (
            <button type="button" className="sb-pool-mini" onClick={fillSuggestedFromMajor}>
              Prefill from major sheet
            </button>
          ) : null}
        </div>
        <p className="sb-discovery-sub">
          Courses the optimizer may schedule — adjust must vs elective, skip electives for this run, or remove.
        </p>
        {requiredCourses.length === 0 && optionalCourses.length === 0 ? (
          <p className="sb-discovery-meta">
            Pool is empty. Use Discover above (<strong>+ must take</strong> / <strong>+ elective</strong>) to add courses.
          </p>
        ) : (
          <div className="sb-your-pool-list">
            {requiredCourses.map((c) => (
              <div key={`req-${c}`} className="sb-pool-chip-row sb-ge-result-row">
                <div className="sb-ge-result-meta">
                  <span className="sb-course-chip required">{c}</span>
                  <span className="sb-ge-result-title">Must schedule</span>
                </div>
                <button type="button" className="sb-pool-mini" onClick={() => demoteToElective(c)}>
                  → elective
                </button>
                <button type="button" className="sb-pool-mini" onClick={() => removeFromPool(c)}>
                  remove
                </button>
              </div>
            ))}
            {optionalCourses.map((c) => {
              const skipped = excludedCourses.has(c)
              return (
                <div key={`opt-${c}`} className="sb-pool-chip-row sb-ge-result-row">
                  <div className="sb-ge-result-meta">
                    <span className={`sb-course-chip ${skipped ? 'excluded' : 'optional'}`}>{c}</span>
                    <span className="sb-ge-result-title">
                      {skipped ? 'Skipped for this optimization run' : 'Elective'}
                    </span>
                  </div>
                  <button type="button" className="sb-pool-mini" onClick={() => toggleExcludeElective(c)}>
                    {skipped ? 'include in run' : 'skip this run'}
                  </button>
                  <button
                    type="button"
                    className="sb-pool-mini"
                    onClick={() => promoteFromElectiveToRequired(c)}
                  >
                    ↑ must take
                  </button>
                  <button type="button" className="sb-pool-mini" onClick={() => removeFromPool(c)}>
                    remove
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </section>

      <section className="sb-pane sb-saved-pane" aria-labelledby="sb-saved-heading">
        <h2 id="sb-saved-heading" className="sb-pane-title">
          Saved schedule history
        </h2>
        <p className="sb-discovery-sub">
          Schedules you saved from optimize runs. Open one to preview the full calendar and details again.
        </p>
        {savedLoading ? (
          <p className="sb-discovery-meta">Loading saved schedules…</p>
        ) : null}
        {savedErr ? (
          <p className="sb-discovery-meta sb-discovery-meta-warn" role="status">
            {savedErr}
            {savedErr.includes('saved_schedules') || savedErr.includes('relation') ? (
              <>
                {' '}
                Apply migration <code className="sb-code">backend/supabase/007_saved_schedules.sql</code> in the
                Supabase SQL editor.
              </>
            ) : null}
          </p>
        ) : null}
        {!savedLoading && !savedErr && savedRows.length === 0 ? (
          <p className="sb-discovery-meta">Nothing saved yet — run Optimize and use “Save to history” in the results.</p>
        ) : null}
        {savedRows.length > 0 ? (
          <ul className="sb-saved-list">
            {savedRows.map((row) => (
              <li key={row.id} className="sb-saved-row">
                <button
                  type="button"
                  className="sb-saved-open"
                  onClick={() => {
                    setResultsModalCandidates([row.candidate])
                    setResultsQuarterCode(row.quarter_code)
                    setResultsQuarterLabel(row.label?.trim() || quarterLabelFromCode(row.quarter_code))
                    setResultsModalOpen(true)
                  }}
                >
                  <span className="sb-saved-label">{row.label ?? quarterLabelFromCode(row.quarter_code)}</span>
                  <span className="sb-saved-meta">
                    {row.score != null ? row.score.toFixed(3) : '—'} ·{' '}
                    {row.total_units != null ? `${row.total_units}u` : '—'} ·{' '}
                    {new Date(row.created_at).toLocaleDateString()}
                  </span>
                </button>
                <button
                  type="button"
                  className="sb-saved-remove"
                  aria-label="Remove from history"
                  onClick={() => {
                    if (!user) return
                    void deleteSavedSchedule(user.id, row.id).then(() => refreshSavedSchedules())
                  }}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

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
            {optimizeNotes.length > 0 ? (
              <ul className="sb-empty-notes">
                {optimizeNotes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            ) : (
              <p>
                The solver returned <strong>zero</strong> schedules. Typical causes: target units (min/max) can’t be met
                with your pool; overlapping meetings between courses; missing rows in <code className="sb-code">sections</code>{' '}
                for <code className="sb-code">{scheduleQuarter || 'this quarter'}</code>; or filters that remove every section (times/days).
              </p>
            )}
            <p className="sb-hint">
              Adjust <Link to="/settings?tab=preferences">Schedule optimizer</Link> preferences (unit band, hours,
              weekdays), add electives if you need more units, or verify imported sections match your course codes.
            </p>
          </motion.section>
        )}
      </AnimatePresence>

      <ScheduleOptimizeResults
        open={resultsModalOpen}
        onClose={closeResultsModal}
        candidates={resultsModalCandidates}
        quarterCode={resultsQuarterCode}
        quarterLabel={resultsQuarterLabel}
        courseGrades={courseGrades}
        cumulativeGpa={cumulativeGpa}
        userId={user?.id ?? ''}
        onSaved={() => void refreshSavedSchedules()}
      />
    </div>
  )
}
