import { motion } from 'motion/react'

const fadeUp = {
  hidden: { opacity: 0, y: 25 },
  visible: { opacity: 1, y: 0 },
}

export function FooterCTA() {
  return (
    <footer className="footer-cta">
      <div className="container">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-60px' }}
          variants={{
            visible: { transition: { staggerChildren: 0.12 } },
          }}
        >
          <motion.h2 className="footer-cta-title" variants={fadeUp}>
            Ready to build your
            <br />
            perfect schedule?
          </motion.h2>
          <motion.p className="footer-cta-subtitle" variants={fadeUp}>
            Upload your transcript, set your preferences, and let ACE handle
            the rest. It takes less than 2 minutes.
          </motion.p>
          <motion.div variants={fadeUp}>
            <a href="/auth" className="btn-primary">Get Started — It's Free</a>
          </motion.div>
        </motion.div>

        <div className="footer-bottom">
          <div className="footer-logo">
            <span className="footer-logo-text">ACE</span>
          </div>
          <div className="footer-links">
            <a href="#">About</a>
            <a href="#">Privacy</a>
            <a href="#">GitHub</a>
          </div>
          <div>Built for UCSB</div>
        </div>
      </div>
    </footer>
  )
}
