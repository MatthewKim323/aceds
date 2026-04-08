import { motion } from 'motion/react'

const fadeUp = {
  hidden: { opacity: 0, y: 30 },
  visible: { opacity: 1, y: 0 },
}

const features = [
  {
    num: '01',
    title: 'Best Professors First',
    desc: 'RateMyProfessor data for every section — ratings, difficulty, would-take-again percentage, and student tags. Side-by-side comparisons at a glance.',
    detail: 'Data from RateMyProfessor GraphQL API',
  },
  {
    num: '02',
    title: 'Know Your Grade Odds',
    desc: '15+ years of official grade distributions from the Office of the Registrar. See the exact A-rate for every professor x course combo.',
    detail: 'Daily Nexus dataset — Fall 2009 to present',
  },
  {
    num: '03',
    title: 'Never Miss a Prereq',
    desc: "Interactive prerequisite graph shows your entire path to graduation. See what's done, what's next, and what unlocks the most future options.",
    detail: 'Major sheets parsed via AI — CS, Data Science, Stats & more',
  },
  {
    num: '04',
    title: 'Beat the Pass Time Rush',
    desc: 'Fill-rate predictions tell you which classes to register for first. Know what fills in 11 minutes versus what survives until adjustment.',
    detail: 'Self-collected enrollment velocity data from UCSB API',
  },
]

export function Features() {
  return (
    <section className="features" id="features">
      <div className="container">
        <motion.div
          className="features-header"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-80px' }}
          variants={{
            visible: { transition: { staggerChildren: 0.12 } },
          }}
        >
          <motion.div className="section-label" variants={fadeUp}>
            Capabilities
          </motion.div>
          <motion.h2 className="section-title" variants={fadeUp}>
            Everything you need.
            <br />
            Nothing you don't.
          </motion.h2>
        </motion.div>

        <motion.div
          className="features-grid"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-60px' }}
          variants={{
            visible: { transition: { staggerChildren: 0.1 } },
          }}
        >
          {features.map((f) => (
            <motion.div
              key={f.title}
              className="feature-card"
              variants={fadeUp}
              transition={{ duration: 0.5 }}
            >
              <div className="feature-num">{f.num}</div>
              <h3 className="feature-title">{f.title}</h3>
              <p className="feature-desc">{f.desc}</p>
              <p className="feature-detail">{f.detail}</p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  )
}
