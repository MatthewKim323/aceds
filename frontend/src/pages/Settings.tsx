import { useEffect, useMemo, useState } from 'react'
import {
  Link,
  Navigate,
  useNavigate,
  useSearchParams,
} from 'react-router-dom'
import { motion, AnimatePresence } from 'motion/react'
import { useAuth } from '../lib/auth'
import {
  getProfile,
  applySyntheticStudent,
  updateProfilePartial,
  type SyntheticStudent,
} from '../lib/profile'
import {
  DEFAULT_OPTIMIZE_PREFS,
  optimizerPreferencesToProfilePatch,
  profileRowToOptimizePreferences,
} from '../lib/optimizer-preferences'
import type { OptimizePreferences } from '../lib/api'
import { OptimizerPreferencesEditor } from '../components/OptimizerPreferencesEditor'
import { majors } from '../data/majors'
import { supabase } from '../lib/supabase'

type Tab = 'profile' | 'preferences' | 'demo' | 'account'

interface LoadedProfile {
  major: string | null
  year: string | null
  cumulative_gpa: number | null
  target_units: number | null
  priority_weights: Record<string, number> | null
  earliest_class: string | null
  preferred_days: string | null
  onboarding_complete: boolean | null
  demo_student_id: string | null
  optimizer_preferences?: unknown | null
}

export function Settings() {
  const { user, loading: authLoading, signOut } = useAuth()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const tabFromUrl = searchParams.get('tab')
  const initialTab: Tab =
    tabFromUrl === 'profile' ||
    tabFromUrl === 'preferences' ||
    tabFromUrl === 'demo' ||
    tabFromUrl === 'account'
      ? tabFromUrl
      : 'profile'

  const [tab, setTab] = useState<Tab>(initialTab)
  const [profile, setProfile] = useState<LoadedProfile | null>(null)
  const [students, setStudents] = useState<SyntheticStudent[] | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  useEffect(() => {
    if (!user) return
    getProfile(user.id).then(({ profile }) => {
      setProfile((profile as unknown as LoadedProfile) || null)
    })
  }, [user])

  useEffect(() => {
    const t = searchParams.get('tab')
    if (
      t === 'profile' ||
      t === 'preferences' ||
      t === 'demo' ||
      t === 'account'
    ) {
      setTab(t)
    }
  }, [searchParams])

  function selectTab(next: Tab) {
    setTab(next)
    setSearchParams({ tab: next }, { replace: true })
  }

  useEffect(() => {
    if (tab !== 'demo' || students !== null) return
    fetch('/synthetic_students.json')
      .then((r) => r.json())
      .then((d: SyntheticStudent[]) => setStudents(d))
      .catch(() => setStudents([]))
  }, [tab, students])

  async function handleLoadStudent(s: SyntheticStudent) {
    if (!user) return
    setStatus('applying demo profile…')
    const { error } = await applySyntheticStudent(user.id, s)
    setStatus(error ? `error: ${error}` : `loaded profile: ${s.name}`)
    if (!error) {
      const { profile: next } = await getProfile(user.id)
      setProfile((next as unknown as LoadedProfile) || null)
    }
  }

  async function reloadProfile() {
    if (!user) return
    const { profile: next } = await getProfile(user.id)
    setProfile((next as unknown as LoadedProfile) || null)
  }

  async function handleSaveOptimizerPrefs(prefs: OptimizePreferences) {
    if (!user) return
    setStatus('saving…')
    const patch = optimizerPreferencesToProfilePatch(prefs)
    const { error } = await updateProfilePartial(user.id, patch)
    setStatus(error ? `error: ${error}` : 'saved ✓')
    if (!error) await reloadProfile()
  }

  async function handleSignOut() {
    await signOut()
    navigate('/')
  }

  if (authLoading) return null
  if (!user) return <Navigate to="/auth" replace />

  return (
    <div className="set">
      <header className="set-header">
        <div>
          <Link to="/dashboard" className="set-back">&larr; dashboard</Link>
          <h1 className="set-title">Settings</h1>
          <p className="set-sub">Profile, preferences, and demo mode.</p>
        </div>
      </header>

      <div className="set-shell">
        <nav className="set-nav">
          {(['profile', 'preferences', 'demo', 'account'] as const).map((t) => (
            <button
              key={t}
              className={`set-nav-item ${tab === t ? 'on' : ''}`}
              onClick={() => selectTab(t)}
            >
              <span className="set-nav-num">
                0{(['profile', 'preferences', 'demo', 'account'] as const).indexOf(t) + 1}
              </span>
              <span className="set-nav-label">{t}</span>
            </button>
          ))}
        </nav>

        <section className="set-main">
          <AnimatePresence mode="wait">
            {tab === 'profile' && (
              <ProfilePane key="p" profile={profile} />
            )}
            {tab === 'preferences' && (
              <PreferencesPane
                key="pr"
                profile={profile}
                onSave={handleSaveOptimizerPrefs}
              />
            )}
            {tab === 'demo' && (
              <DemoPane
                key="d"
                students={students}
                activeId={profile?.demo_student_id ?? null}
                onLoad={handleLoadStudent}
              />
            )}
            {tab === 'account' && (
              <AccountPane key="a" email={user.email ?? ''} onSignOut={handleSignOut} />
            )}
          </AnimatePresence>

          {status && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="set-status"
            >
              {status}
            </motion.p>
          )}
        </section>
      </div>
    </div>
  )
}

function ProfilePane({ profile }: { profile: LoadedProfile | null }) {
  const majorIds = (profile?.major ?? '').split(',').filter(Boolean)
  const majorNames = majorIds
    .map((id) => majors.find((m) => m.id === id)?.name)
    .filter(Boolean) as string[]

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="set-pane"
    >
      <h2 className="set-pane-title">Profile</h2>
      <dl className="set-dl">
        <DLRow label="Majors" value={majorNames.join(' · ') || '—'} />
        <DLRow label="Year standing" value={profile?.year ?? '—'} />
        <DLRow
          label="Cumulative GPA"
          value={
            profile?.cumulative_gpa != null
              ? profile.cumulative_gpa.toFixed(2)
              : '—'
          }
        />
        <DLRow label="Target units / quarter" value={profile?.target_units ?? '—'} />
        <DLRow
          label="Onboarding"
          value={profile?.onboarding_complete ? 'complete' : 'incomplete'}
        />
      </dl>
      <Link to="/onboarding?edit=1" className="set-cta">edit profile →</Link>
    </motion.div>
  )
}

function PreferencesPane({
  profile,
  onSave,
}: {
  profile: LoadedProfile | null
  onSave: (prefs: OptimizePreferences) => Promise<void>
}) {
  const [prefs, setPrefs] = useState<OptimizePreferences>(() => ({
    ...DEFAULT_OPTIMIZE_PREFS,
  }))

  useEffect(() => {
    setPrefs(profileRowToOptimizePreferences(profile as unknown as Record<string, unknown>))
  }, [profile])

  const total = useMemo(
    () =>
      prefs.weight_grades +
      prefs.weight_professor +
      prefs.weight_convenience +
      prefs.weight_availability,
    [prefs],
  )

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="set-pane set-pane-optimizer-prefs"
    >
      <h2 className="set-pane-title">Schedule optimizer</h2>
      <p className="set-pane-note">
        Used by <strong>Schedule Builder</strong> (<code>POST /optimize</code>). Objective weights should sum to
        about 1.0 — current total{' '}
        <span className={total > 1.05 || total < 0.95 ? 'warn-text' : 'ok-text'}>
          {total.toFixed(2)}
        </span>
        .
      </p>
      <div className="set-optimizer-shell">
        <OptimizerPreferencesEditor prefs={prefs} onChange={setPrefs} />
      </div>
      <div className="set-row set-row-actions">
        <button className="set-cta" type="button" onClick={() => onSave(prefs)}>
          save preferences →
        </button>
      </div>
    </motion.div>
  )
}

function DemoPane({
  students,
  activeId,
  onLoad,
}: {
  students: SyntheticStudent[] | null
  activeId: string | null
  onLoad: (s: SyntheticStudent) => void
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="set-pane"
    >
      <h2 className="set-pane-title">Demo mode</h2>
      <p className="set-pane-note">
        Load a pre-generated synthetic student to explore how ACE behaves for different
        profiles. Useful for demos and judge walkthroughs.
      </p>
      {students === null ? (
        <p className="set-pane-note">loading…</p>
      ) : students.length === 0 ? (
        <p className="set-pane-note warn-text">
          No synthetic_students.json in <code>frontend/public/</code>. Run{' '}
          <code>python data_pipeline/scripts/16_synthetic_students.py</code> first.
        </p>
      ) : (
        <div className="set-demo-grid">
          {students.slice(0, 12).map((s) => (
            <DemoCard
              key={s.id}
              s={s}
              active={s.id === activeId}
              onLoad={() => onLoad(s)}
            />
          ))}
        </div>
      )}
    </motion.div>
  )
}

function AccountPane({
  email,
  onSignOut,
}: {
  email: string
  onSignOut: () => void
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="set-pane"
    >
      <h2 className="set-pane-title">Account</h2>
      <dl className="set-dl">
        <DLRow label="Email" value={email} />
        <DLRow label="Supabase" value={supabase ? 'connected' : 'offline'} />
      </dl>
      <button className="set-cta danger" onClick={onSignOut}>
        sign out
      </button>
    </motion.div>
  )
}

function DLRow({
  label,
  value,
}: {
  label: string
  value: string | number | null
}) {
  return (
    <div className="set-dl-row">
      <dt>{label}</dt>
      <dd>{value ?? '—'}</dd>
    </div>
  )
}

function DemoCard({
  s,
  active,
  onLoad,
}: {
  s: SyntheticStudent
  active: boolean
  onLoad: () => void
}) {
  const majorName = majors.find((m) => m.id === s.major_id)?.name ?? s.major_id
  const topPref = (Object.entries(s.preference_weights) as [string, number][])
    .sort((a, b) => b[1] - a[1])[0]
  return (
    <motion.button
      className={`set-demo-card ${active ? 'active' : ''}`}
      onClick={onLoad}
      whileHover={{ y: -2 }}
    >
      <header className="set-demo-head">
        <span className="set-demo-name">{s.name}</span>
        <span className="set-demo-year">{s.year_standing}</span>
      </header>
      <p className="set-demo-major">{majorName}</p>
      <div className="set-demo-meta">
        <span>GPA {s.gpa.toFixed(2)}</span>
        <span>·</span>
        <span>prefers {topPref?.[0]}</span>
      </div>
      {active && <div className="set-demo-active">active profile</div>}
    </motion.button>
  )
}
