import { useSyncExternalStore } from 'react'
import { motion } from 'motion/react'

function usePrefersReducedMotion() {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
      mq.addEventListener('change', onChange)
      return () => mq.removeEventListener('change', onChange)
    },
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    () => false
  )
}

export function PipelineFlowVisual() {
  const reduce = usePrefersReducedMotion()
  return (
    <div
      className="ace-pipeline-flow"
      role="img"
      aria-label="Data flow: three signals — UCSB catalog, grade distributions, and instructor signal — converge into joint scoring with your transcript constraints, then produce ranked schedules."
    >
      <div className="ace-pipeline-flow-inner">
        <motion.div
          className="ace-pipeline-flow-upstream"
          initial={reduce ? false : { opacity: 0, y: 12 }}
          whileInView={reduce ? undefined : { opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-40px' }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="ace-pipeline-flow-node ace-pipeline-flow-node--src">
            <span className="ace-pipeline-flow-node-label">UCSB catalog</span>
            <span className="ace-pipeline-flow-node-hint">sections · times · prereqs</span>
          </div>
          <div className="ace-pipeline-flow-node ace-pipeline-flow-node--src">
            <span className="ace-pipeline-flow-node-label">Grade curves</span>
            <span className="ace-pipeline-flow-node-hint">historical outcomes</span>
          </div>
          <div className="ace-pipeline-flow-node ace-pipeline-flow-node--src">
            <span className="ace-pipeline-flow-node-label">Instructor signal</span>
            <span className="ace-pipeline-flow-node-hint">ratings · workload cues</span>
          </div>
        </motion.div>

        <div className="ace-pipeline-flow-svg-wrap" aria-hidden>
          <svg className="ace-pipeline-flow-svg" viewBox="0 0 560 72" preserveAspectRatio="none">
            <defs>
              <linearGradient id="ace-flow-stroke" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="rgba(242, 167, 184, 0.15)" />
                <stop offset="50%" stopColor="rgba(242, 167, 184, 0.65)" />
                <stop offset="100%" stopColor="rgba(166, 77, 121, 0.45)" />
              </linearGradient>
            </defs>
            {/* Three tributaries merging toward center */}
            <path
              className="ace-pipeline-flow-path"
              d="M 70 0 L 70 22 Q 70 36 140 44"
              fill="none"
              stroke="url(#ace-flow-stroke)"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
            <path
              className="ace-pipeline-flow-path"
              d="M 280 0 L 280 38"
              fill="none"
              stroke="url(#ace-flow-stroke)"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
            <path
              className="ace-pipeline-flow-path"
              d="M 490 0 L 490 22 Q 490 36 420 44"
              fill="none"
              stroke="url(#ace-flow-stroke)"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
            <path
              className="ace-pipeline-flow-path ace-pipeline-flow-path--gather"
              d="M 140 44 Q 280 52 420 44"
              fill="none"
              stroke="url(#ace-flow-stroke)"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
            <path
              className="ace-pipeline-flow-path"
              d="M 280 52 L 280 72"
              fill="none"
              stroke="url(#ace-flow-stroke)"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </div>

        <p className="ace-pipeline-flow-bridge" aria-hidden>
          signals merge
        </p>

        <motion.div
          className="ace-pipeline-flow-merge"
          initial={reduce ? false : { opacity: 0, y: 10 }}
          whileInView={reduce ? undefined : { opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-40px' }}
          transition={{ duration: 0.5, delay: 0.08, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="ace-pipeline-flow-node ace-pipeline-flow-node--merge">
            <span className="ace-pipeline-flow-node-label">Joint scoring + your constraints</span>
            <span className="ace-pipeline-flow-node-hint">
              transcript units · GE &amp; major rules · conflicts · preferences
            </span>
          </div>
        </motion.div>

        <div className="ace-pipeline-flow-arrow" aria-hidden>
          <svg width="20" height="28" viewBox="0 0 20 28" fill="none">
            <path
              d="M10 2v18M4 16l6 8 6-8"
              stroke="rgba(242, 167, 184, 0.55)"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>

        <motion.div
          className="ace-pipeline-flow-out"
          initial={reduce ? false : { opacity: 0, y: 10 }}
          whileInView={reduce ? undefined : { opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-40px' }}
          transition={{ duration: 0.5, delay: 0.14, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="ace-pipeline-flow-node ace-pipeline-flow-node--out">
            <span className="ace-pipeline-flow-node-label">Ranked quarter schedules</span>
            <span className="ace-pipeline-flow-node-hint">inspectable scores · replan when GOLD shifts</span>
          </div>
        </motion.div>
      </div>
    </div>
  )
}
