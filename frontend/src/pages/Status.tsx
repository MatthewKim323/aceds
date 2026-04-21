import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'motion/react'
import { api, type StatusPayload, API_BASE } from '../lib/api'

export function Status() {
  const [data, setData] = useState<StatusPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lastFetch, setLastFetch] = useState<Date | null>(null)

  async function fetchStatus() {
    try {
      const s = await api.status()
      setData(s)
      setError(null)
      setLastFetch(new Date())
    } catch (e) {
      setError(String((e as Error).message || e))
    }
  }

  useEffect(() => {
    fetchStatus()
    const id = setInterval(fetchStatus, 30_000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="st">
      <header className="st-header">
        <div>
          <Link to="/dashboard" className="st-back">&larr; dashboard</Link>
          <h1 className="st-title">System Status</h1>
          <p className="st-sub">
            Live health of the ML model, data pipeline, and Supabase backend.
          </p>
        </div>
        <div className="st-pulse">
          <span className={`st-pulse-dot ${data && !error ? 'ok' : 'warn'}`} />
          <span className="st-pulse-label">
            {error ? 'disconnected' : data ? 'operational' : 'connecting…'}
          </span>
        </div>
      </header>

      {error && (
        <div className="st-error">
          <strong>Backend unreachable.</strong>
          <p>
            Calling <code>{API_BASE}/status</code> — is the FastAPI server running?
          </p>
          <p className="st-error-msg">{error}</p>
        </div>
      )}

      {data && (
        <>
          <section className="st-grid">
            <ModelCard model={data.model} />
            <SupabaseCard supabase={data.supabase} />
          </section>

          <section className="st-logs">
            <h2 className="st-section-title">Recent data refreshes</h2>
            {data.refresh_log.length === 0 ? (
              <p className="st-logs-empty">No refreshes logged yet.</p>
            ) : (
              <table className="st-log-table">
                <thead>
                  <tr>
                    <th>Source</th>
                    <th>Rows</th>
                    <th>Notes</th>
                    <th>Ran</th>
                  </tr>
                </thead>
                <tbody>
                  {data.refresh_log.map((r, i) => (
                    <motion.tr
                      key={`${r.ran_at}-${i}`}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.03 }}
                    >
                      <td className="mono">{r.source}</td>
                      <td className="mono num">{r.rows.toLocaleString()}</td>
                      <td className="muted">{r.notes ?? '—'}</td>
                      <td className="muted mono">{prettyDate(r.ran_at)}</td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {lastFetch && (
            <p className="st-footer">
              last polled {prettyDate(lastFetch.toISOString())} · auto-refresh every 30s
            </p>
          )}
        </>
      )}
    </div>
  )
}

function ModelCard({ model }: { model: StatusPayload['model'] }) {
  if (!model.trained) {
    return (
      <div className="st-card">
        <h3 className="st-card-title">ML Model</h3>
        <p className="st-card-status warn">not trained</p>
        <p className="st-card-note">
          Run <code>python data_pipeline/scripts/13_xgboost.py</code> then copy artifacts.
        </p>
      </div>
    )
  }
  const m = model.metrics ?? {}
  return (
    <div className="st-card">
      <header className="st-card-head">
        <h3 className="st-card-title">XGBoost Grade Predictor</h3>
        <span className="st-badge">live</span>
      </header>
      <div className="st-metrics">
        <Metric label="RMSE" value={m.rmse?.toFixed(3) ?? '—'} good={m.rmse != null && m.rmse < 0.27} />
        <Metric label="R²" value={m.r2?.toFixed(3) ?? '—'} good={m.r2 != null && m.r2 > 0.6} />
        <Metric label="MAE" value={m.mae?.toFixed(3) ?? '—'} good={m.mae != null && m.mae < 0.20} />
      </div>
      <dl className="st-meta">
        <div>
          <dt>train / val / test</dt>
          <dd className="mono">
            {(model.n_train ?? 0).toLocaleString()} / {(model.n_val ?? 0).toLocaleString()} / {(model.n_test ?? 0).toLocaleString()}
          </dd>
        </div>
        {model.train_date ? (
          <div>
            <dt>trained</dt>
            <dd className="mono">{prettyDate(model.train_date)}</dd>
          </div>
        ) : null}
      </dl>
    </div>
  )
}

function SupabaseCard({ supabase }: { supabase: StatusPayload['supabase'] }) {
  const entries = Object.entries(supabase.tables)
  return (
    <div className="st-card">
      <header className="st-card-head">
        <h3 className="st-card-title">Supabase Data</h3>
        <span className={`st-badge ${supabase.error ? 'warn' : ''}`}>
          {supabase.error ? 'degraded' : 'healthy'}
        </span>
      </header>
      <ul className="st-tables">
        {entries.map(([name, n]) => (
          <li key={name} className="st-table-row">
            <span className="mono">{name}</span>
            <span className={`mono num ${n < 0 ? 'warn' : ''}`}>
              {n < 0 ? 'err' : n.toLocaleString()}
            </span>
          </li>
        ))}
      </ul>
      {supabase.error && (
        <p className="st-card-note warn-text">{supabase.error}</p>
      )}
    </div>
  )
}

function Metric({
  label,
  value,
  good,
}: {
  label: string
  value: string
  good: boolean
}) {
  return (
    <div className="st-metric">
      <span className="st-metric-val">{value}</span>
      <span className={`st-metric-label ${good ? 'good' : ''}`}>{label}</span>
    </div>
  )
}

function prettyDate(iso: string): string {
  try {
    const d = new Date(iso)
    if (Number.isNaN(+d)) return iso
    const diff = (Date.now() - d.getTime()) / 1000
    if (diff < 60) return `${Math.round(diff)}s ago`
    if (diff < 3600) return `${Math.round(diff / 60)}m ago`
    if (diff < 86400) return `${Math.round(diff / 3600)}h ago`
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  } catch {
    return iso
  }
}
