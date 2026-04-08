import { motion } from 'motion/react'
import { ShaderCanvas } from './ShaderCanvas'

export function Hero() {
  return (
    <section className="hero">
      <ShaderCanvas />
      <div className="hero-fade" />

      <div className="hero-content">
        <motion.h1
          className="hero-title"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.15 }}
        >
          ACE
        </motion.h1>

        <motion.p
          className="hero-subtitle"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.35 }}
        >
          The UCSB schedule optimizer. Live course data, 15 years of grade
          distributions, and professor ratings — your perfect quarter, built
          in seconds.
        </motion.p>

        <motion.div
          className="hero-actions"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.55 }}
        >
          <a href="/auth" className="btn-primary">Get Started</a>
          <a href="#how-it-works" className="btn-secondary">How It Works</a>
        </motion.div>
      </div>
    </section>
  )
}
