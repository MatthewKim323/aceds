import { useEffect, useRef } from 'react'
import { AnimatePresence, motion } from 'motion/react'

export type PipelineLogLine = {
  id: string
  phase: string
  label: string
  meta?: string
}

const PHASE_STEPS = [
  'normalize',
  'merge_evidence',
  'fetch_sections',
  'fetch_instructors',
  'predict',
  'optimize_milp',
  'enrich',
  'audit_log',
] as const

export function OptimizePipelineOverlay({
  open,
  lines,
}: {
  open: boolean
  lines: PipelineLogLine[]
}) {
  const logRef = useRef<HTMLDivElement>(null)
  const lastPhase = lines.length ? lines[lines.length - 1].phase : ''
  const stepIdx = PHASE_STEPS.indexOf(lastPhase as (typeof PHASE_STEPS)[number])
  const progress =
    stepIdx >= 0 ? (stepIdx + 1) / PHASE_STEPS.length : lines.length ? 0.06 : 0

  useEffect(() => {
    const el = logRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [lines])

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="opt-pipeline-overlay"
          role="dialog"
          aria-busy="true"
          aria-live="polite"
          aria-label="Schedule optimization progress"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.22 }}
        >
          <motion.div
            className="opt-pipeline-card"
            initial={{ y: 18, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 12, opacity: 0 }}
            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
          >
            <p className="opt-pipeline-kicker">Schedule optimizer</p>
            <div className="opt-pipeline-head">
              <h2 className="opt-pipeline-title">Building feasible schedules</h2>
              <p className="opt-pipeline-sub">
                Live pipeline from the API: sections → predict → MILP → enrich. Same flow as the sync
                optimizer.
              </p>
            </div>
            <div className="opt-pipeline-bar-wrap" aria-hidden>
              <motion.div
                className="opt-pipeline-bar"
                initial={false}
                animate={{ width: `${Math.max(5, progress * 100)}%` }}
                transition={{ type: 'spring', stiffness: 420, damping: 38 }}
              />
            </div>
            <div className="opt-pipeline-log" ref={logRef}>
              {lines.length === 0 ? (
                <p className="opt-pipeline-placeholder">Connecting…</p>
              ) : (
                lines.map((l) => (
                  <div key={l.id} className="opt-pipeline-line">
                    <span className="opt-pipeline-phase">{l.phase}</span>
                    <span className="opt-pipeline-label">{l.label}</span>
                    {l.meta ? <span className="opt-pipeline-meta">{l.meta}</span> : null}
                  </div>
                ))
              )}
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
