import { motion } from 'motion/react'

const fadeUp = {
  hidden: { opacity: 0, y: 30 },
  visible: { opacity: 1, y: 0 },
}

export function HowItWorks() {
  return (
    <section className="how-it-works" id="how-it-works">
      <div className="container">
        <motion.div
          className="how-header"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-80px' }}
          variants={{
            visible: { transition: { staggerChildren: 0.12 } },
          }}
        >
          <motion.div className="section-label" variants={fadeUp}>
            How It Works
          </motion.div>
          <motion.h2 className="section-title" variants={fadeUp}>
            Three steps to your
            <br />
            best quarter yet.
          </motion.h2>
          <motion.p className="section-desc" variants={fadeUp}>
            Upload your info, let ACE pull the data, and get ranked schedules
            backed by real numbers — not vibes.
          </motion.p>
        </motion.div>

        <div className="steps-grid">
          <motion.div
            className="step-card"
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-60px' }}
            transition={{ duration: 0.6, delay: 0.1 }}
          >
            <div className="step-number">01</div>
            <div className="step-mock">
              <div className="mock-upload">
                <div className="mock-field">
                  <span className="mock-field-label">Major</span>
                  <span className="mock-field-value">CS B.S.</span>
                </div>
                <div className="mock-field">
                  <span className="mock-field-label">Year</span>
                  <span className="mock-field-value">3rd Year</span>
                </div>
                <div className="mock-dropzone">
                  Upload Transcript
                </div>
              </div>
            </div>
            <h3 className="step-title">Tell ACE what you've taken</h3>
            <p className="step-desc">
              Pick your major, upload your transcript or Academic History PDF,
              and ACE auto-populates everything in 2 seconds.
            </p>
          </motion.div>

          <motion.div
            className="step-card"
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-60px' }}
            transition={{ duration: 0.6, delay: 0.25 }}
          >
            <div className="step-number">02</div>
            <div className="step-mock">
              <div className="mock-pipeline">
                <div className="mock-pipe-row">
                  <span className="mock-pipe-label">Courses</span>
                  <div className="mock-pipe-bar">
                    <div className="mock-pipe-fill done" style={{ width: '100%' }} />
                  </div>
                  <span className="mock-pipe-pct mock-done">Done</span>
                </div>
                <div className="mock-pipe-row">
                  <span className="mock-pipe-label">Profs</span>
                  <div className="mock-pipe-bar">
                    <div className="mock-pipe-fill" style={{ width: '72%' }} />
                  </div>
                  <span className="mock-pipe-pct">72%</span>
                </div>
                <div className="mock-pipe-row">
                  <span className="mock-pipe-label">Grades</span>
                  <div className="mock-pipe-bar">
                    <div className="mock-pipe-fill done" style={{ width: '100%' }} />
                  </div>
                  <span className="mock-pipe-pct mock-done">Done</span>
                </div>
                <div className="mock-pipe-row">
                  <span className="mock-pipe-label">Optimize</span>
                  <div className="mock-pipe-bar">
                    <div className="mock-pipe-fill" style={{ width: '0%' }} />
                  </div>
                  <span className="mock-pipe-pct">—</span>
                </div>
              </div>
            </div>
            <h3 className="step-title">ACE pulls data in seconds</h3>
            <p className="step-desc">
              Watch live as ACE queries UCSB's API, matches 15 years of grade
              distributions, and looks up every professor on RMP.
            </p>
          </motion.div>

          <motion.div
            className="step-card"
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-60px' }}
            transition={{ duration: 0.6, delay: 0.4 }}
          >
            <div className="step-number">03</div>
            <div className="step-mock">
              <div className="mock-schedule">
                <div className="mock-sched-header">
                  <span className="mock-sched-title">Schedule A</span>
                  <span className="mock-sched-score">92 / 100</span>
                </div>
                <div className="mock-sched-row">
                  <span className="mock-sched-course">CMPSC 156</span>
                  <span className="mock-sched-prof">Wang — 4.8</span>
                  <span className="mock-sched-grade">62% A</span>
                </div>
                <div className="mock-sched-row">
                  <span className="mock-sched-course">PSTAT 120B</span>
                  <span className="mock-sched-prof">Ravat — 4.2</span>
                  <span className="mock-sched-grade">45% A</span>
                </div>
                <div className="mock-sched-row">
                  <span className="mock-sched-course">CMPSC 130A</span>
                  <span className="mock-sched-prof">Krintz — 3.9</span>
                  <span className="mock-sched-grade">38% A</span>
                </div>
              </div>
            </div>
            <h3 className="step-title">Get your ranked schedules</h3>
            <p className="step-desc">
              Ranked by professor quality, grade odds, time fit, and seat
              availability — with a registration strategy for your pass time.
            </p>
          </motion.div>
        </div>
      </div>
    </section>
  )
}
