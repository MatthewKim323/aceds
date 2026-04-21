import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'motion/react'
import { useAuth } from '../lib/auth'
import {
  getProfile,
  applySyntheticStudent,
  updateProfilePartial,
  type SyntheticStudent,
} from '../lib/profile'
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
}

export function Settings() {
  const { user, loading: authLoading, signOut } = useAuth()
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('profile')
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

  async function handleSavePrefs(nextWeights: Record<string, number>, nextUnits: number) {
    if (!user) return
    setStatus('saving…')
    const { error } = await updateProfilePartial(user.id, {
      priority_weights: nextWeights,
      target_units: nextUnits,
    })
    setStatus(error ? `error: ${error}` : 'saved ✓')
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
              onClick={() => setTab(t)}
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
                onSave={handleSavePrefs}
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
      <Link to="/onboarding" className="set-cta">edit profile →</Link>
    </motion.div>
  )
}

function PreferencesPane({
  profile,
  onSave,
}: {
  profile: LoadedProfile | null
  onSave: (weights: Record<string, number>, units: number) => Promise<void>
}) {
  const initial = profile?.priority_weights ?? {
    grades: 0.3,
    professor: 0.25,
    convenience: 0.25,
    availability: 0.2,
  }
  const [weights, setWeights] = useState<Record<string, number>>(initial)
  const [units, setUnits] = useState<number>(profile?.target_units ?? 15)

  useEffect(() => {
    if (profile?.priority_weights) setWeights(profile.priority_weights)
    if (profile?.target_units != null) setUnits(profile.target_units)
  }, [profile])

  const total = useMemo(
    () => Object.values(weights).reduce((a, b) => a + b, 0),
    [weights],
  )

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="set-pane"
    >
      <h2 className="set-pane-title">Optimizer preferences</h2>
      <p className="set-pane-note">
        These weights control how schedules are ranked. They should sum to 1.0 — current total{' '}
        <span className={total > 1.05 || total < 0.95 ? 'warn-text' : 'ok-text'}>
          {total.toFixed(2)}
        </span>
        .
      </p>
      <div className="set-weights">
        {(['grades', 'professor', 'convenience', 'availability'] as const).map((k) => (
          <WeightSlider
            key={k}
            label={k}
            value={weights[k] ?? 0}
            onChange={(v) => setWeights({ ...weights, [k]: v })}
          />
        ))}
      </div>
      <div className="set-row">
        <label className="set-field">
          <span>Target units</span>
          <input
            type="number"
            min={4}
            max={22}
            value={units}
            onChange={(e) => setUnits(Number(e.target.value))}
          />
        </label>
        <button className="set-cta" onClick={() => onSave(weights, units)}>
          save →
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

function WeightSlider({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (v: number) => void
}) {
  return (
    <label className="set-weight">
      <div className="set-weight-head">
        <span>{label}</span>
        <span className="set-weight-val">{(value * 100).toFixed(0)}%</span>
      </div>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
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
