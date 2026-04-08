import { motion } from 'motion/react'

const fadeUp = {
  hidden: { opacity: 0, y: 30 },
  visible: { opacity: 1, y: 0 },
}

const stats = [
  { value: '3', label: 'Live Data Sources' },
  { value: '15+', label: 'Years of Grades' },
  { value: '4', label: 'Launch Majors' },
  { value: '<10s', label: 'Build Time' },
]

export function BuiltForUCSB() {
  return (
    <section className="built-for">
      <div className="container">
        <motion.div
          className="built-for-inner"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-80px' }}
          variants={{
            visible: { transition: { staggerChildren: 0.12 } },
          }}
        >
          <motion.div
            className="section-label"
            variants={fadeUp}
            style={{ justifyContent: 'center' }}
          >
            Why ACE
          </motion.div>
          <motion.h2 className="built-for-title" variants={fadeUp}>
            Built by Gauchos,
            <br />
            for <em>Gauchos</em>.
          </motion.h2>
          <motion.p className="built-for-desc" variants={fadeUp}>
            ACE is purpose-built for UCSB — using the university's own public
            API, official grade data from the Registrar, and the courses and
            majors you actually need. Starting with CS and Data Science.
          </motion.p>

          <motion.div
            className="stats-grid"
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: '-40px' }}
            variants={{
              visible: { transition: { staggerChildren: 0.08 } },
            }}
          >
            {stats.map((s) => (
              <motion.div
                key={s.label}
                className="stat-card"
                variants={fadeUp}
                transition={{ duration: 0.5 }}
              >
                <div className="stat-value">{s.value}</div>
                <div className="stat-label">{s.label}</div>
              </motion.div>
            ))}
          </motion.div>
        </motion.div>
      </div>
    </section>
  )
}
