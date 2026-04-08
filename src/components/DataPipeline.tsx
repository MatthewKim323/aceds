import { motion } from 'motion/react'

const fadeUp = {
  hidden: { opacity: 0, y: 30 },
  visible: { opacity: 1, y: 0 },
}

export function DataPipeline() {
  return (
    <section className="pipeline" id="pipeline">
      <div className="container">
        <motion.div
          className="pipeline-header"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-80px' }}
          variants={{
            visible: { transition: { staggerChildren: 0.12 } },
          }}
        >
          <motion.div className="section-label" variants={fadeUp}>
            Under the Hood
          </motion.div>
          <motion.h2 className="section-title" variants={fadeUp}>
            Real data, not guesses.
          </motion.h2>
          <motion.p className="section-desc" variants={fadeUp}>
            Three live data sources feed into a multi-objective optimizer that
            scores every possible schedule on four dimensions.
          </motion.p>
        </motion.div>

        <motion.div
          className="pipeline-flow"
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true, margin: '-60px' }}
          transition={{ duration: 0.8 }}
        >
          <div className="pipeline-sources">
            <motion.div
              className="pipeline-source"
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: 0.2 }}
            >
              <div className="pipeline-source-info">
                <span className="pipeline-source-name">UCSB API</span>
                <span className="pipeline-source-detail">Courses & Sections</span>
              </div>
              <div className="pipeline-source-status">
                <span className="status-dot" />
                Live
              </div>
            </motion.div>

            <motion.div
              className="pipeline-source"
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: 0.35 }}
            >
              <div className="pipeline-source-info">
                <span className="pipeline-source-name">Daily Nexus</span>
                <span className="pipeline-source-detail">Grade Distributions</span>
              </div>
              <div className="pipeline-source-status">
                <span className="status-dot" />
                Live
              </div>
            </motion.div>

            <motion.div
              className="pipeline-source"
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: 0.5 }}
            >
              <div className="pipeline-source-info">
                <span className="pipeline-source-name">RateMyProfessor</span>
                <span className="pipeline-source-detail">Ratings & Reviews</span>
              </div>
              <div className="pipeline-source-status">
                <span className="status-dot" />
                Live
              </div>
            </motion.div>
          </div>

          <div className="pipeline-connectors">
            <div className="connector-line" />
            <div className="connector-line" />
            <div className="connector-line" />
          </div>

          <motion.div
            className="pipeline-engine"
            initial={{ opacity: 0, scale: 0.9 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.5 }}
          >
            <div className="engine-title">ACE Engine</div>
            <div className="engine-subtitle">
              Multi-objective optimizer
              <br />
              scoring 4 dimensions
            </div>
          </motion.div>

          <div className="pipeline-connector-out">
            <div className="connector-out-line" />
          </div>

          <motion.div
            className="pipeline-output"
            initial={{ opacity: 0, x: 20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.7 }}
          >
            <div className="output-badge">Optimized</div>
            <div className="output-title">Your Ranked Schedules</div>
            <div className="output-mini-schedule">
              <div className="output-mini-row">
                <span className="output-mini-course">Schedule A</span>
                <span className="output-mini-rating">92 pts</span>
              </div>
              <div className="output-mini-row">
                <span className="output-mini-course">Schedule B</span>
                <span className="output-mini-rating">84 pts</span>
              </div>
              <div className="output-mini-row">
                <span className="output-mini-course">Schedule C</span>
                <span className="output-mini-rating">78 pts</span>
              </div>
            </div>
          </motion.div>
        </motion.div>
      </div>
    </section>
  )
}
