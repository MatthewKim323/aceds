import { BrowserRouter, Routes, Route } from 'react-router-dom'
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

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/auth" element={<Auth />} />
          <Route path="/onboarding" element={<Onboarding />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/explorer" element={<Explorer />} />
          <Route path="/schedule" element={<Schedule />} />
          <Route path="/grad-path" element={<GradPath />} />
          <Route path="/status" element={<Status />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App
