import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import { SmoothScroll } from './components/SmoothScroll'
import { pageTransition, pageVariants, pageVariantsReduced, prefersReducedMotion } from './lib/motion'
import { AuthProvider } from './lib/auth'
import { Landing } from './pages/Landing'
import { Auth } from './pages/Auth'
import { Onboarding } from './pages/Onboarding'
import { Dashboard } from './pages/Dashboard'
import { Explorer } from './pages/Explorer'
import { Schedule } from './pages/Schedule'
import { GradPath } from './pages/GradPath'
import { Status } from './pages/Status'
import { Settings } from './pages/Settings'
import { ShowcaseLab } from './pages/ShowcaseLab'

function AppRoutes() {
  const location = useLocation()
  const reduced = prefersReducedMotion()
  const variants = reduced ? pageVariantsReduced : pageVariants

  return (
    <SmoothScroll>
      <AnimatePresence mode="wait">
        <motion.div
          key={location.pathname}
          variants={variants}
          initial="initial"
          animate="animate"
          exit="exit"
          transition={pageTransition(reduced)}
          style={{ minHeight: '100dvh' }}
        >
          <Routes location={location}>
            <Route path="/" element={<Landing />} />
            <Route path="/auth" element={<Auth />} />
            <Route path="/onboarding" element={<Onboarding />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/explorer" element={<Explorer />} />
            <Route path="/schedule" element={<Schedule />} />
            <Route path="/grad-path" element={<GradPath />} />
            <Route path="/status" element={<Status />} />
            <Route path="/showcase-lab" element={<ShowcaseLab />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </motion.div>
      </AnimatePresence>
    </SmoothScroll>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  )
}
