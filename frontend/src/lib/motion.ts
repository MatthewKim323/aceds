/**
 * Shared Motion presets + reduced-motion helpers for consistent, polished transitions.
 */

/** Primary ease — smooth deceleration (similar to cubic-bezier “expo out”). */
export const EASE_OUT = [0.16, 1, 0.3, 1] as const

export const SPRING_SNAPPY = { type: 'spring', stiffness: 420, damping: 34, mass: 0.85 } as const

export const SPRING_SOFT = { type: 'spring', stiffness: 280, damping: 28, mass: 0.9 } as const

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** Route cross-fade (no blur — filter blur on large subtrees causes “invisible until hover” in WebKit). */
export const pageVariants = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -10 },
}

export const pageVariantsReduced = {
  initial: { opacity: 1 },
  animate: { opacity: 1 },
  exit: { opacity: 1 },
}

export function pageTransition(reduced: boolean) {
  if (reduced) return { duration: 0.15 }
  return { duration: 0.4, ease: EASE_OUT }
}

export const staggerContainer = (reduced: boolean, stagger = 0.05) => ({
  /** Parent stays visible so children are not trapped behind opacity:0 (fixes “shows on hover”). */
  hidden: { opacity: 1 },
  show: {
    opacity: 1,
    transition: reduced
      ? { duration: 0 }
      : { staggerChildren: stagger, delayChildren: 0.06 },
  },
})

export const staggerItem = (reduced: boolean) => ({
  hidden: reduced ? { opacity: 1, y: 0 } : { opacity: 0, y: 14 },
  show: {
    opacity: 1,
    y: 0,
    transition: reduced ? { duration: 0 } : { duration: 0.38, ease: EASE_OUT },
  },
})

export const fadeUp = (reduced: boolean, delay = 0) => ({
  initial: reduced ? { opacity: 1, y: 0 } : { opacity: 0, y: 18 },
  animate: { opacity: 1, y: 0 },
  transition: reduced ? { duration: 0 } : { duration: 0.45, ease: EASE_OUT, delay },
})

export const tapProps = { whileTap: { scale: 0.98 } } as const

export const hoverLift = {
  whileHover: { y: -2, transition: SPRING_SNAPPY },
} as const
