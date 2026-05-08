import { useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { GradeTrendPoint } from '../lib/api'
import {
  aggregateBreakdownForTerm,
  aggregateDistributionByTerm,
  termLetterTotal,
  toStackedPercentRows,
  type StackedChartRow,
} from '../lib/grade-distribution'

const COL = {
  A: '#34d399',
  B: '#60a5fa',
  C: '#fbbf24',
  D: '#fb923c',
  F: '#f87171',
  P: '#a78bfa',
  NP: '#64748b',
} as const

const BRK_LABEL: Record<string, string> = {
  Ap: 'A+',
  Am: 'A−',
  Bp: 'B+',
  Bm: 'B−',
  Cp: 'C+',
  Cm: 'C−',
  Dp: 'D+',
  Dm: 'D−',
  F: 'F',
}

function formatBreakKey(k: string): string {
  return BRK_LABEL[k] ?? k
}

type TooltipProps = {
  active?: boolean
  payload?: Array<{ payload: StackedChartRow }>
}

function DistTooltip({ active, payload }: TooltipProps) {
  if (!active || !payload?.length) return null
  const r = payload[0].payload
  const tot = termLetterTotal(r)
  if (tot <= 0) return null
  const row = (label: string, n: number) => (
    <div key={label} className="gd-tip-row">
      <span>{label}</span>
      <span>
        {n} ({((100 * n) / tot).toFixed(1)}%)
      </span>
    </div>
  )
  return (
    <div className="gd-tip">
      <div className="gd-tip-title">{r.label}</div>
      {r.avgGpa != null ? (
        <div className="gd-tip-meta">Weighted mean GPA · {r.avgGpa.toFixed(2)} · n={tot}</div>
      ) : (
        <div className="gd-tip-meta">Letter grades · n={tot}</div>
      )}
      {row('A', r.A)}
      {row('B', r.B)}
      {row('C', r.C)}
      {row('D', r.D)}
      {row('F', r.F)}
      {r.P > 0 ? row('P', r.P) : null}
      {r.NP > 0 ? row('NP', r.NP) : null}
    </div>
  )
}

type Props = {
  points: GradeTrendPoint[]
  /** Extra class on outer wrapper */
  className?: string
  /** Tighter layout inside schedule optimizer cards */
  compact?: boolean
}

export function GradeDistributionViz({ points, className = '', compact }: Props) {
  const terms = useMemo(() => aggregateDistributionByTerm(points), [points])
  const withBuckets = useMemo(() => terms.filter((t) => termLetterTotal(t) > 0), [terms])
  const chartData = useMemo(() => toStackedPercentRows(withBuckets), [withBuckets])

  const [inspectKey, setInspectKey] = useState<string | null>(null)
  const resolvedKey = useMemo(() => {
    if (inspectKey && withBuckets.some((t) => t.key === inspectKey)) return inspectKey
    return withBuckets[withBuckets.length - 1]?.key ?? ''
  }, [inspectKey, withBuckets])

  const inspectTerm = useMemo(
    () => withBuckets.find((t) => t.key === resolvedKey) ?? withBuckets[withBuckets.length - 1] ?? null,
    [withBuckets, resolvedKey],
  )

  const breakdown = useMemo(() => {
    if (!inspectTerm) return []
    return aggregateBreakdownForTerm(points, inspectTerm.year, inspectTerm.quarter)
  }, [points, inspectTerm])

  const chartW = Math.max(compact ? 320 : 400, chartData.length * (compact ? 36 : 44))

  if (points.length === 0) {
    return <p className="gd-viz-empty">No historical grade rows for this course.</p>
  }

  if (chartData.length === 0) {
    return (
      <p className="gd-viz-empty">
        Letter-grade counts are not in the database for this course yet. If mean GPA by term appears
        above, it is from averaged rows without full A–F breakdown.
      </p>
    )
  }

  return (
    <div className={`gd-viz ${compact ? 'gd-viz--compact' : ''} ${className}`.trim()}>
      <div className="gd-viz-chart-scroll">
        <div className="gd-viz-chart-inner" style={{ width: chartW, minWidth: '100%' }}>
          <ResponsiveContainer width="100%" height={compact ? 200 : 260}>
            <BarChart data={chartData} margin={{ top: 6, right: 6, left: 4, bottom: compact ? 48 : 56 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--gray-500)" opacity={0.25} />
              <XAxis
                dataKey="shortLabel"
                tick={{ fill: 'var(--gray-600)', fontSize: compact ? 9 : 10 }}
                interval={chartData.length > 16 ? 'preserveStartEnd' : 0}
                angle={chartData.length > 12 ? -32 : 0}
                textAnchor={chartData.length > 12 ? 'end' : 'middle'}
                height={chartData.length > 12 ? 52 : 28}
              />
              <YAxis
                domain={[0, 100]}
                tickFormatter={(v) => `${v}%`}
                width={compact ? 32 : 40}
                tick={{ fill: 'var(--gray-600)', fontSize: 10 }}
              />
              <Tooltip content={<DistTooltip />} cursor={{ fill: 'var(--gray-400)', opacity: 0.12 }} />
              <Legend
                wrapperStyle={{ fontSize: compact ? '10px' : '11px', paddingTop: 4 }}
                formatter={(value) => <span className="gd-legend">{value}</span>}
              />
              <Bar dataKey="pctA" stackId="g" name="A" fill={COL.A} />
              <Bar dataKey="pctB" stackId="g" name="B" fill={COL.B} />
              <Bar dataKey="pctC" stackId="g" name="C" fill={COL.C} />
              <Bar dataKey="pctD" stackId="g" name="D" fill={COL.D} />
              <Bar dataKey="pctF" stackId="g" name="F" fill={COL.F} />
              <Bar dataKey="pctP" stackId="g" name="P" fill={COL.P} />
              <Bar dataKey="pctNP" stackId="g" name="NP" fill={COL.NP} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <p className="gd-viz-hint">
        Each bar is one quarter (all sections combined). Height shows share of letter grades in Nexus
        data — not your grade.
      </p>

      {withBuckets.length > 0 ? (
        <div className="gd-viz-inspect">
          <label className="gd-viz-inspect-label">
            <span>± breakdown</span>
            <select
              className="gd-viz-select"
              value={resolvedKey}
              onChange={(e) => setInspectKey(e.target.value)}
            >
              {withBuckets.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label} (n={termLetterTotal(t)})
                </option>
              ))}
            </select>
          </label>
          {breakdown.length > 0 ? (
            <ul className="gd-break-list">
              {breakdown.map((b) => (
                <li key={b.key} className="gd-break-row">
                  <span className="gd-break-name">{formatBreakKey(b.key)}</span>
                  <span className="gd-break-bar-wrap">
                    <span
                      className="gd-break-bar"
                      style={{
                        width: `${(100 * b.count) / breakdown.reduce((s, x) => s + x.count, 0)}%`,
                      }}
                    />
                  </span>
                  <span className="gd-break-n">{b.count}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="gd-viz-subempty">No A+/A− split in the database for this term.</p>
          )}
        </div>
      ) : null}
    </div>
  )
}
