import { useEffect, type ReactNode } from 'react'
import Lenis from 'lenis'

/**
 * Buttery in-app scrolling (dashboard, explorer, etc.). Respects prefers-reduced-motion.
 * Landing keeps native scroll so VimaLoader / hero orchestration stays predictable.
 */
export function SmoothScroll({ children }: { children: ReactNode }) {
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    if (window.location.pathname === '/') return

    const lenis = new Lenis({
      smoothWheel: true,
      lerp: 0.09,
      wheelMultiplier: 0.92,
    })

    let raf = 0
    function tick(time: number) {
      lenis.raf(time)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(raf)
      lenis.destroy()
    }
  }, [])

  return <>{children}</>
}
