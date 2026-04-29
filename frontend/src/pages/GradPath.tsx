import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { motion } from 'motion/react'
import { useAuth } from '../lib/auth'
import { getProfile } from '../lib/profile'
import { getMajorById, type CourseGroup, type Major } from '../data/majors'
import { buildSatisfiedCourseSet, toCourseNorm } from '../lib/pdf-parser'
import { tierTotalUnits, tierDoneUnits } from '../lib/courseUnits'

type NodeState = 'done' | 'ready' | 'remaining'

interface DisplayCourse {
  id: string
  alt?: string
  state: NodeState
}

interface DisplayTier {
  label: string
  note?: string
  pick?: number
  nodes: DisplayCourse[]
  completionRatio: number
}

export function GradPath() {
  const { user, loading: authLoading } = useAuth()
  const [majorId, setMajorId] = useState<string | null>(null)
  const [satisfied, setSatisfied] = useState<Set<string>>(new Set())
  const [major, setMajor] = useState<Major | null>(null)

  useEffect(() => {
    if (!user) return
    getProfile(user.id).then(({ profile }) => {
      if (!profile) return
      const p = profile as unknown as {
        major: string
        completed_courses: string[]
        ap_credits?: { exam: string; ucsb_equivalent: string[]; units: number; score: number | null }[]
      }
      const firstMajor = p.major?.split(',').filter(Boolean)[0] || null
      setMajorId(firstMajor)
      setSatisfied(
        buildSatisfiedCourseSet(p.completed_courses || [], p.ap_credits ?? []),
      )
    })
  }, [user])

  useEffect(() => {
    if (!majorId) return
    setMajor(getMajorById(majorId) ?? null)
  }, [majorId])

  const tiers = useMemo<DisplayTier[]>(() => {
    if (!major) return []
    return major.groups.map((g) => buildTier(g, satisfied))
  }, [major, satisfied])

  const stats = useMemo(() => {
    if (!major) return null
    let doneUnits = 0
    let totalUnits = 0
    for (const g of major.groups) {
      totalUnits += tierTotalUnits(g)
      doneUnits += tierDoneUnits(g, satisfied)
    }
    return {
      doneUnits,
      totalUnits,
      pct: totalUnits === 0 ? 0 : Math.round((doneUnits / totalUnits) * 100),
    }
  }, [major, satisfied])

  if (authLoading) return null
  if (!user) return <Navigate to="/auth" replace />

  return (
    <div className="gp">
      <header className="gp-header">
        <div>
          <Link to="/dashboard" className="gp-back">&larr; dashboard</Link>
          <h1 className="gp-title">Graduation Path</h1>
          <p className="gp-sub">
            {major ? `${major.name} · ${major.degree}` : 'Select a major to view your path'}
          </p>
        </div>
        {stats && (
          <div className="gp-progress-block">
            <div className="gp-progress">
              <div className="gp-ring">
                <svg viewBox="0 0 60 60" className="gp-ring-svg">
                  <circle cx="30" cy="30" r="26" className="gp-ring-bg" />
                  <motion.circle
                    cx="30"
                    cy="30"
                    r="26"
                    className="gp-ring-fg"
                    strokeDasharray={`${2 * Math.PI * 26}`}
                    initial={{ strokeDashoffset: 2 * Math.PI * 26 }}
                    animate={{
                      strokeDashoffset: 2 * Math.PI * 26 * (1 - stats.pct / 100),
                    }}
                    transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
                    transform="rotate(-90 30 30)"
                  />
                </svg>
                <span className="gp-ring-n">{stats.pct}%</span>
              </div>
              <div className="gp-progress-meta">
                <span className="gp-progress-main">{stats.doneUnits} / {stats.totalUnits}</span>
                <span className="gp-progress-label">estimated major requirement units</span>
              </div>
            </div>
            <p className="gp-progress-footnote" role="note">
              Units use transcript-style estimates (typically 4 per course; labs lower). “Pick N” pools count
              at most N×4 units toward the total. AP/articulation satisfying a requirement counts when it
              appears in your profile. Your catalog may differ slightly from actual units.
            </p>
          </div>
        )}
      </header>

      {!major ? (
        <div className="gp-empty">
          <p>Your profile has no major selected yet.</p>
          <Link to="/onboarding" className="gp-empty-cta">finish onboarding →</Link>
        </div>
      ) : (
        <div className="gp-track">
          {tiers.map((t, i) => (
            <TierRow key={i} tier={t} index={i} isLast={i === tiers.length - 1} />
          ))}
        </div>
      )}

      <aside className="gp-legend">
        <Legend state="done" label="Completed" />
        <Legend state="ready" label="Ready to take" />
        <Legend state="remaining" label="Remaining" />
      </aside>
    </div>
  )
}

function buildTier(group: CourseGroup, satisfied: Set<string>): DisplayTier {
  const nodes: DisplayCourse[] = group.courses.map((c) => {
    const idN = toCourseNorm(c.id)
    const altN = c.alt != null ? toCourseNorm(c.alt) : null
    const isDone =
      satisfied.has(idN) || (altN != null && satisfied.has(altN))
    return {
      id: c.id,
      alt: c.alt,
      state: isDone ? 'done' : group.pick ? 'ready' : 'ready',
    }
  })
  const doneN = nodes.filter((n) => n.state === 'done').length
  const pick = group.pick
  const completionRatio =
    pick != null && pick > 0
      ? Math.min(doneN / pick, 1)
      : nodes.length === 0
        ? 0
        : doneN / nodes.length
  return {
    label: group.label,
    note: group.note,
    pick: group.pick,
    nodes,
    completionRatio,
  }
}

function TierRow({
  tier,
  index,
  isLast,
}: {
  tier: DisplayTier
  index: number
  isLast: boolean
}) {
  return (
    <motion.section
      className="gp-tier"
      initial={{ opacity: 0, x: -24 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: 0.1 + index * 0.06, ease: [0.16, 1, 0.3, 1] }}
    >
      <header className="gp-tier-head">
        <div className="gp-tier-num">{String(index + 1).padStart(2, '0')}</div>
        <div className="gp-tier-meta">
          <h3 className="gp-tier-label">{tier.label}</h3>
          {tier.note && <p className="gp-tier-note">{tier.note}</p>}
          {tier.pick && (
            <p className="gp-tier-note">
              pick {tier.pick} of {tier.nodes.length}
            </p>
          )}
        </div>
        <div className="gp-tier-pct">
          {Math.round(tier.completionRatio * 100)}%
        </div>
      </header>
      <div className="gp-tier-bar">
        <motion.span
          className="gp-tier-bar-fg"
          initial={{ width: 0 }}
          animate={{ width: `${tier.completionRatio * 100}%` }}
          transition={{ duration: 0.8, delay: 0.2 + index * 0.06 }}
        />
      </div>
      <div className="gp-nodes">
        {tier.nodes.map((n) => (
          <Node key={n.id} node={n} />
        ))}
      </div>
      {!isLast && <div className="gp-connector" aria-hidden="true" />}
    </motion.section>
  )
}

function Node({ node }: { node: DisplayCourse }) {
  return (
    <motion.div
      className={`gp-node gp-node-${node.state}`}
      whileHover={{ y: -1 }}
      transition={{ duration: 0.15 }}
    >
      <span className="gp-node-id">{node.id}</span>
      {node.alt && <span className="gp-node-alt">or {node.alt}</span>}
      <span className={`gp-node-dot gp-node-dot-${node.state}`} />
    </motion.div>
  )
}

function Legend({ state, label }: { state: NodeState; label: string }) {
  return (
    <span className="gp-legend-item">
      <span className={`gp-node-dot gp-node-dot-${state}`} />
      {label}
    </span>
  )
}
