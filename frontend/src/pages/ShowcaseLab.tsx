import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { getProfile } from '../lib/profile'
import { supabase } from '../lib/supabase'
import { buildStudentBundle, type StudentBundle } from '../lib/student-bundle'

type IngestionRow = {
  id: string
  source: string
  parse_schema_version: string
  summary: Record<string, unknown>
  created_at: string
}

type OptimizationRunRow = {
  id: string
  request_hash: string
  quarter_code: string
  model_version: string
  conformal_method: string
  summary: Record<string, unknown>
  duration_ms: number
  created_at: string
}

function BarRow({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0
  return (
    <div className="sl-bar-row">
      <span className="sl-bar-label">{label}</span>
      <div className="sl-bar-track" role="presentation">
        <div className="sl-bar-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="sl-bar-val">{value}</span>
    </div>
  )
}

export function ShowcaseLab() {
  const { user, loading: authLoading } = useAuth()
  const [bundle, setBundle] = useState<StudentBundle | null>(null)
  const [events, setEvents] = useState<IngestionRow[]>([])
  const [optRuns, setOptRuns] = useState<OptimizationRunRow[]>([])
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(true)

  const reload = useCallback(async () => {
    if (!user?.id) return
    setBusy(true)
    setLoadErr(null)
    try {
      const { profile, error: pErr } = await getProfile(user.id)
      if (pErr) {
        setLoadErr(pErr)
        setBundle(buildStudentBundle(null))
        setEvents([])
        setOptRuns([])
        return
      }
      setBundle(buildStudentBundle(profile ?? null))

      const { data: ev, error: eErr } = await supabase
        .from('student_ingestion_events')
        .select('id, source, parse_schema_version, summary, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(12)
      if (eErr) {
        setEvents([])
        if (!eErr.message.includes('relation') && !eErr.message.includes('does not exist')) {
          console.warn('ingestion events:', eErr.message)
        }
      } else {
        setEvents((ev as IngestionRow[]) ?? [])
      }

      const { data: runs, error: oErr } = await supabase
        .from('optimization_runs')
        .select(
          'id, request_hash, quarter_code, model_version, conformal_method, summary, duration_ms, created_at',
        )
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(15)
      if (oErr) {
        setOptRuns([])
        if (!oErr.message.includes('relation') && !oErr.message.includes('does not exist')) {
          console.warn('optimization_runs:', oErr.message)
        }
      } else {
        setOptRuns((runs as OptimizationRunRow[]) ?? [])
      }
    } finally {
      setBusy(false)
    }
  }, [user?.id])

  useEffect(() => {
    void reload()
  }, [reload])

  const chartMax = useMemo(() => {
    if (!bundle) return 1
    const d = bundle.derived
    return Math.max(
      1,
      d.numCompleted,
      d.numInProgress,
      d.numMajorRequirementCourses,
      d.overlapCompletedWithMajorRequirements,
    )
  }, [bundle])

  const posterSummary = useMemo(() => {
    if (!bundle) return ''
    const d = bundle.derived
    const lines = [
      '## ACE student bundle (showcase export)',
      '',
      `- **Schema:** ${bundle.schemaVersion} · generated ${bundle.generatedAt}`,
      `- **Majors:** ${bundle.majors.map((m) => m.name).join(' · ') || '—'}`,
      `- **Completed courses:** ${d.numCompleted}`,
      `- **In progress:** ${d.numInProgress}`,
      `- **Major requirement rows (distinct):** ${d.numMajorRequirementCourses}`,
      `- **Completed ∩ major sheet:** ${d.overlapCompletedWithMajorRequirements}`,
      `- **Graph edges (capped):** ${bundle.graphEdges.length}`,
      `- **Ingestion events (last query):** ${events.length}`,
      `- **Optimization runs (last query):** ${optRuns.length}`,
      `- **Default quarter (bundle meta):** ${bundle.meta.defaultQuarterCode}`,
      '',
      'Model metrics: see `MODEL_CARD.md` in repo root.',
    ]
    return lines.join('\n')
  }, [bundle, events.length, optRuns.length])

  function downloadJson() {
    if (!bundle) return
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `student-bundle-${bundle.generatedAt.slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function copySummary() {
    try {
      await navigator.clipboard.writeText(posterSummary)
    } catch {
      // ignore
    }
  }

  if (authLoading) return null
  if (!user) return <Navigate to="/auth" replace />

  return (
    <div className="sl">
      <header className="sl-top">
        <div className="sl-top-inner">
          <Link to="/dashboard" className="sl-back">
            ← Dashboard
          </Link>
          <h1 className="sl-title">Data lab</h1>
          <p className="sl-sub">
            Canonical <strong>student bundle</strong>, append-only <strong>ingestion</strong> and{' '}
            <strong>optimization run</strong> logs — decision-system audit trail (user-scoped only).
          </p>
        </div>
      </header>

      <div className="sl-shell">
        {loadErr && (
          <div className="sl-alert">
            Profile: {loadErr}. If you have not finished onboarding,{' '}
            <Link to="/onboarding" className="sl-a">
              complete it
            </Link>
            .
          </div>
        )}

        {busy ? (
          <p className="sl-muted">Loading…</p>
        ) : bundle ? (
          <>
            <section className="sl-actions">
              <button type="button" className="sl-btn" onClick={() => void downloadJson()}>
                Download student-bundle.json
              </button>
              <button type="button" className="sl-btn sl-btn-ghost" onClick={() => void copySummary()}>
                Copy poster summary (Markdown)
              </button>
              <button type="button" className="sl-btn sl-btn-ghost" onClick={() => void reload()}>
                Refresh
              </button>
            </section>

            <section className="sl-grid">
              <div className="sl-card">
                <h2 className="sl-h2">Derived counts</h2>
                <BarRow label="Completed" value={bundle.derived.numCompleted} max={chartMax} />
                <BarRow label="In progress" value={bundle.derived.numInProgress} max={chartMax} />
                <BarRow
                  label="Major req. rows"
                  value={bundle.derived.numMajorRequirementCourses}
                  max={chartMax}
                />
                <BarRow
                  label="Done ∩ major sheet"
                  value={bundle.derived.overlapCompletedWithMajorRequirements}
                  max={chartMax}
                />
                <p className="sl-note">
                  “Done ∩ major sheet” counts completed courses that appear on your declared major
                  requirement list (including alt options).
                </p>
              </div>

              <div className="sl-card">
                <h2 className="sl-h2">Ingestion events</h2>
                {events.length === 0 ? (
                  <p className="sl-muted">
                    No ingestion rows for <strong>your account</strong> yet. After{' '}
                    <code className="sl-code">004_student_ingestion_events.sql</code> is applied, finishing
                    onboarding or clicking <strong>Save</strong> on Settings writes an audit row (RLS: your user id
                    only).
                  </p>
                ) : (
                  <ul className="sl-events">
                    {events.map((e) => (
                      <li key={e.id} className="sl-event">
                        <span className="sl-event-src">{e.source}</span>
                        <span className="sl-event-meta">{e.parse_schema_version}</span>
                        <time className="sl-event-time">
                          {new Date(e.created_at).toLocaleString()}
                        </time>
                        <pre className="sl-event-json">{JSON.stringify(e.summary)}</pre>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>

            <section className="sl-card sl-card-wide">
              <h2 className="sl-h2">Optimization runs</h2>
              {optRuns.length === 0 ? (
                <p className="sl-muted">
                  No rows yet — run <code className="sl-code">005_optimization_runs.sql</code> in Supabase,
                  then run Schedule Builder while logged in (passes <code className="sl-code">user_id</code>).
                </p>
              ) : (
                <ul className="sl-events">
                  {optRuns.map((r) => (
                    <li key={r.id} className="sl-event">
                      <span className="sl-event-src">{r.quarter_code}</span>
                      <span className="sl-event-meta">
                        {r.model_version} · {r.conformal_method} · {r.duration_ms}ms
                      </span>
                      <time className="sl-event-time">{new Date(r.created_at).toLocaleString()}</time>
                      <pre className="sl-event-json">{JSON.stringify(r.summary)}</pre>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="sl-card sl-card-wide">
              <h2 className="sl-h2">Bundle preview</h2>
              <pre className="sl-pre">{JSON.stringify(bundle, null, 2)}</pre>
            </section>
          </>
        ) : null}
      </div>
    </div>
  )
}
