import { useEffect, useState, useRef } from 'react'
import { Navigate, useNavigate, Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'motion/react'
import { useAuth } from '../lib/auth'
import { getProfile } from '../lib/profile'
import { getMajorById } from '../data/majors'
import { parsePDF } from '../lib/pdf-parser'
import { supabase } from '../lib/supabase'

// ── Types ──

interface Profile {
  major: string
  year: string
  completed_courses: string[]
  in_progress_courses: string[]
  course_grades: Record<string, string>
  cumulative_gpa: number | null
  transfer_units: number
  ap_credits: { exam: string; ucsb_equivalent: string[]; units: number; score: number | null }[]
  requirement_status: Record<string, unknown> | null
  earliest_class: string
  preferred_days: string
  target_units: number
  priority_weights: Record<string, number>
  onboarding_complete: boolean
}

type Tab = 'overview' | 'courses' | 'requirements' | 'settings'

export function Dashboard() {
  const { user, loading: authLoading, signOut } = useAuth()
  const navigate = useNavigate()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loadingProfile, setLoadingProfile] = useState(true)
  const [tab, setTab] = useState<Tab>('overview')
  const [sidebarOpen, setSidebarOpen] = useState(false)

  useEffect(() => {
    if (!user) return
    getProfile(user.id).then(({ profile: p }) => {
      if (p) setProfile(p as unknown as Profile)
      setLoadingProfile(false)
    })
  }, [user])

  if (authLoading) return null
  if (!user) return <Navigate to="/auth" replace />

  if (loadingProfile) {
    return (
      <div className="dash">
        <div className="dash-loading">
          <div className="dash-loading-spinner" />
          <span>Loading your profile...</span>
        </div>
      </div>
    )
  }

  if (!profile || !profile.onboarding_complete) {
    return <Navigate to="/onboarding" replace />
  }

  const majorIds = profile.major.split(',').filter(Boolean)
  const selectedMajors = majorIds.map(getMajorById).filter((m): m is NonNullable<ReturnType<typeof getMajorById>> => !!m)
  const majorName = selectedMajors.map((m) => `${m.name} ${m.degree}`).join(' + ') || profile.major
  const yearLabels: Record<string, string> = {
    '1': 'Freshman', '2': 'Sophomore', '3': 'Junior', '4': 'Senior', '5': '5th year+',
  }

  const completedSet = new Set(profile.completed_courses)
  let majorCompleted = 0
  let majorTotal = 0
  for (const major of selectedMajors) {
    for (const g of major.groups) {
      majorTotal += g.courses.length
      for (const c of g.courses) {
        if (completedSet.has(c.id) || (c.alt && completedSet.has(c.alt))) majorCompleted++
      }
    }
  }

  const gradePoints: Record<string, number> = {
    'A+': 4.0, 'A': 4.0, 'A-': 3.7, 'B+': 3.3, 'B': 3.0, 'B-': 2.7,
    'C+': 2.3, 'C': 2.0, 'C-': 1.7, 'D+': 1.3, 'D': 1.0, 'D-': 0.7, 'F': 0.0,
  }

  let gpaSumW = 0, gpaUnitsW = 0
  for (const [code, grade] of Object.entries(profile.course_grades)) {
    const gp = gradePoints[grade]
    if (gp !== undefined) {
      gpaSumW += gp * 4
      gpaUnitsW += 4
    }
  }

  const gpa = profile.cumulative_gpa ?? (gpaUnitsW > 0 ? gpaSumW / gpaUnitsW : null)
  const totalUnits = profile.completed_courses.length * 4 + profile.transfer_units
  const unitsRemaining = Math.max(0, 180 - totalUnits)

  // Grade distribution
  const gradeDist: Record<string, number> = {}
  for (const g of Object.values(profile.course_grades)) {
    const letter = g.replace(/[+-]/, '')
    gradeDist[letter] = (gradeDist[letter] ?? 0) + 1
  }

  const quarters = new Set<string>()
  // We don't have quarter info stored per-course in profile, so estimate from course count
  const estQuarters = Math.ceil(profile.completed_courses.length / 4)

  function handleSignOut() {
    signOut().then(() => navigate('/'))
  }

  const TABS: { id: Tab; label: string; icon: string }[] = [
    { id: 'overview', label: 'Overview', icon: '\u25A0' },
    { id: 'courses', label: 'Courses', icon: '\u25CB' },
    { id: 'requirements', label: 'Requirements', icon: '\u25B3' },
    { id: 'settings', label: 'Settings', icon: '\u2699' },
  ]

  return (
    <div className="dash">
      {/* Mobile menu toggle */}
      <button className="dash-menu-toggle" onClick={() => setSidebarOpen(!sidebarOpen)}>
        {sidebarOpen ? '\u2715' : '\u2630'}
      </button>

      {/* Sidebar */}
      <aside className={`dash-sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="dash-sidebar-top">
          <a href="/" className="dash-logo">ACE</a>
          <nav className="dash-nav">
            {TABS.map((t) => (
              <button
                key={t.id}
                className={`dash-nav-btn ${tab === t.id ? 'active' : ''}`}
                onClick={() => { setTab(t.id); setSidebarOpen(false) }}
              >
                <span className="dash-nav-icon">{t.icon}</span>
                {t.label}
              </button>
            ))}
            <div className="dash-nav-divider" />
            <Link to="/explorer" className="dash-nav-btn dash-nav-link">
              <span className="dash-nav-icon">{'\u25C7'}</span>
              Course Explorer
            </Link>
            <Link to="/schedule" className="dash-nav-btn dash-nav-link">
              <span className="dash-nav-icon">{'\u2630'}</span>
              Schedule Builder
            </Link>
            <Link to="/grad-path" className="dash-nav-btn dash-nav-link">
              <span className="dash-nav-icon">{'\u25B8'}</span>
              Graduation Path
            </Link>
            <Link to="/status" className="dash-nav-btn dash-nav-link">
              <span className="dash-nav-icon">{'\u25CE'}</span>
              System Status
            </Link>
            <Link to="/settings" className="dash-nav-btn dash-nav-link">
              <span className="dash-nav-icon">{'\u2699'}</span>
              Settings
            </Link>
          </nav>
        </div>
        <div className="dash-sidebar-bottom">
          <div className="dash-user-card">
            <div className="dash-user-avatar">
              {user.email?.charAt(0).toUpperCase() ?? '?'}
            </div>
            <div className="dash-user-info">
              <span className="dash-user-name">{user.email?.split('@')[0]}</span>
              <span className="dash-user-meta">{majorName} &middot; {yearLabels[profile.year] ?? profile.year}</span>
            </div>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="dash-main">
        <AnimatePresence mode="wait">
          {tab === 'overview' && (
            <motion.div
              key="overview"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.25 }}
              className="dash-content"
            >
              <OverviewTab
                gpa={gpa}
                totalUnits={totalUnits}
                unitsRemaining={unitsRemaining}
                completedCourses={profile.completed_courses.length}
                inProgressCourses={profile.in_progress_courses.length}
                majorCompleted={majorCompleted}
                majorTotal={majorTotal}
                transferUnits={profile.transfer_units}
                apCredits={profile.ap_credits}
                gradeDist={gradeDist}
                courseGrades={profile.course_grades}
                majorName={majorName}
                year={yearLabels[profile.year] ?? profile.year}
              />
            </motion.div>
          )}
          {tab === 'courses' && (
            <motion.div
              key="courses"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.25 }}
              className="dash-content"
            >
              <CoursesTab
                completedCourses={profile.completed_courses}
                inProgressCourses={profile.in_progress_courses}
                courseGrades={profile.course_grades}
                majors={selectedMajors}
                userId={user.id}
                onUpdate={(updatedProfile) => setProfile(updatedProfile as unknown as Profile)}
              />
            </motion.div>
          )}
          {tab === 'requirements' && (
            <motion.div
              key="requirements"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.25 }}
              className="dash-content"
            >
              <RequirementsTab
                requirementStatus={profile.requirement_status}
                majors={selectedMajors}
                completedSet={completedSet}
                majorCompleted={majorCompleted}
                majorTotal={majorTotal}
              />
            </motion.div>
          )}
          {tab === 'settings' && (
            <motion.div
              key="settings"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.25 }}
              className="dash-content"
            >
              <SettingsTab
                email={user.email ?? ''}
                onSignOut={handleSignOut}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  )
}

/* ── Overview Tab ── */

function OverviewTab({
  gpa,
  totalUnits,
  unitsRemaining,
  completedCourses,
  inProgressCourses,
  majorCompleted,
  majorTotal,
  transferUnits,
  apCredits,
  gradeDist,
  courseGrades,
  majorName,
  year,
}: {
  gpa: number | null
  totalUnits: number
  unitsRemaining: number
  completedCourses: number
  inProgressCourses: number
  majorCompleted: number
  majorTotal: number
  transferUnits: number
  apCredits: { exam: string; ucsb_equivalent: string[]; units: number; score: number | null }[]
  gradeDist: Record<string, number>
  courseGrades: Record<string, string>
  majorName: string
  year: string
}) {
  const majorPct = majorTotal > 0 ? Math.round((majorCompleted / majorTotal) * 100) : 0
  const unitPct = Math.round((totalUnits / 180) * 100)
  const estGradQuarters = Math.ceil(unitsRemaining / 16)

  return (
    <>
      <div className="dash-page-header">
        <h1 className="dash-page-title">Overview</h1>
        <p className="dash-page-sub">{majorName} &middot; {year}</p>
      </div>

      {/* Hero stats */}
      <div className="dash-stat-hero">
        <div className="dash-hero-stat">
          <span className="dash-hero-value">{gpa?.toFixed(2) ?? '--'}</span>
          <span className="dash-hero-label">Cumulative GPA</span>
        </div>
        <div className="dash-hero-divider" />
        <div className="dash-hero-stat">
          <span className="dash-hero-value">{totalUnits}</span>
          <span className="dash-hero-label">Units completed</span>
        </div>
        <div className="dash-hero-divider" />
        <div className="dash-hero-stat">
          <span className="dash-hero-value">{completedCourses}</span>
          <span className="dash-hero-label">Courses taken</span>
        </div>
        <div className="dash-hero-divider" />
        <div className="dash-hero-stat">
          <span className="dash-hero-value">{majorCompleted}/{majorTotal}</span>
          <span className="dash-hero-label">Major courses</span>
        </div>
      </div>

      {/* Next steps command center */}
      <div className="dash-nextsteps">
        <div className="dash-nextsteps-head">
          <span className="dash-nextsteps-eyebrow">Next up</span>
          <h2 className="dash-nextsteps-title">What do you want to plan?</h2>
        </div>
        <div className="dash-nextsteps-grid">
          <Link to="/schedule" className="dash-nextstep-card primary">
            <span className="dash-nextstep-num">01</span>
            <span className="dash-nextstep-title">Build Spring 2026</span>
            <span className="dash-nextstep-sub">ML-scored sections &middot; optimized for your preferences</span>
            <span className="dash-nextstep-cta">open builder &rarr;</span>
          </Link>
          <Link to="/grad-path" className="dash-nextstep-card">
            <span className="dash-nextstep-num">02</span>
            <span className="dash-nextstep-title">Graduation path</span>
            <span className="dash-nextstep-sub">{majorPct}% toward {majorName.split(' ').slice(0, 2).join(' ') || 'major'} complete</span>
            <span className="dash-nextstep-cta">review progression &rarr;</span>
          </Link>
          <Link to="/explorer" className="dash-nextstep-card">
            <span className="dash-nextstep-num">03</span>
            <span className="dash-nextstep-title">Browse courses</span>
            <span className="dash-nextstep-sub">Search by dept, GE, or level &middot; see grade trends</span>
            <span className="dash-nextstep-cta">explore catalog &rarr;</span>
          </Link>
          <Link to="/status" className="dash-nextstep-card muted">
            <span className="dash-nextstep-num">04</span>
            <span className="dash-nextstep-title">System status</span>
            <span className="dash-nextstep-sub">Model health, data freshness, pipeline log</span>
            <span className="dash-nextstep-cta">view dashboard &rarr;</span>
          </Link>
        </div>
      </div>

      <div className="dash-grid">
        {/* Unit progress */}
        <div className="dash-card">
          <div className="dash-card-header">
            <span className="dash-card-title">Unit Progress</span>
            <span className="dash-card-badge">{unitPct}%</span>
          </div>
          <div className="dash-progress-bar">
            <div className="dash-progress-fill" style={{ width: `${Math.min(unitPct, 100)}%` }} />
          </div>
          <div className="dash-progress-labels">
            <span>{totalUnits} completed</span>
            <span>{unitsRemaining} remaining</span>
          </div>
          <div className="dash-unit-breakdown">
            <div className="dash-unit-row">
              <span>UCSB coursework</span>
              <span>{totalUnits - transferUnits} units</span>
            </div>
            {transferUnits > 0 && (
              <div className="dash-unit-row">
                <span>Transfer / AP credit</span>
                <span>{transferUnits} units</span>
              </div>
            )}
            <div className="dash-unit-row total">
              <span>Total needed</span>
              <span>180 units</span>
            </div>
          </div>
        </div>

        {/* Major progress */}
        <div className="dash-card">
          <div className="dash-card-header">
            <span className="dash-card-title">Major Progress</span>
            <span className="dash-card-badge">{majorPct}%</span>
          </div>
          <div className="dash-progress-bar">
            <div className="dash-progress-fill major" style={{ width: `${Math.min(majorPct, 100)}%` }} />
          </div>
          <div className="dash-progress-labels">
            <span>{majorCompleted} completed</span>
            <span>{majorTotal - majorCompleted} remaining</span>
          </div>
          {estGradQuarters > 0 && (
            <div className="dash-estimate">
              ~{estGradQuarters} quarter{estGradQuarters !== 1 ? 's' : ''} to graduate (at 16 units/qtr)
            </div>
          )}
        </div>

        {/* Grade distribution */}
        <div className="dash-card">
          <div className="dash-card-header">
            <span className="dash-card-title">Grade Distribution</span>
          </div>
          {Object.keys(gradeDist).length > 0 ? (
            <div className="dash-grade-chart">
              {['A', 'B', 'C', 'D', 'F', 'P'].map((letter) => {
                const count = gradeDist[letter] ?? 0
                const max = Math.max(...Object.values(gradeDist), 1)
                return (
                  <div key={letter} className="dash-grade-bar-row">
                    <span className="dash-grade-letter">{letter}</span>
                    <div className="dash-grade-bar-track">
                      <motion.div
                        className={`dash-grade-bar-fill grade-${letter.toLowerCase()}`}
                        initial={{ width: 0 }}
                        animate={{ width: `${(count / max) * 100}%` }}
                        transition={{ duration: 0.5, delay: 0.1 }}
                      />
                    </div>
                    <span className="dash-grade-count">{count}</span>
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="dash-empty">Upload a transcript to see grade distribution.</p>
          )}
        </div>

        {/* In progress */}
        {inProgressCourses > 0 && (
          <div className="dash-card">
            <div className="dash-card-header">
              <span className="dash-card-title">Currently Enrolled</span>
              <span className="dash-card-badge ip">{inProgressCourses} courses</span>
            </div>
            <p className="dash-empty">Your in-progress courses will appear here once uploaded via transcript.</p>
          </div>
        )}

        {/* AP Credits */}
        {apCredits.length > 0 && (
          <div className="dash-card dash-card--wide">
            <div className="dash-card-header">
              <span className="dash-card-title">AP/Transfer Credits</span>
              <span className="dash-card-badge">{apCredits.length} exams</span>
            </div>
            <div className="dash-ap-list">
              {apCredits.map((ap, i) => (
                <div key={i} className="dash-ap-row">
                  <span className="dash-ap-exam">{ap.exam}</span>
                  <span className="dash-ap-score">{ap.score ?? '--'}</span>
                  <span className="dash-ap-equiv">
                    {ap.ucsb_equivalent.length > 0 ? ap.ucsb_equivalent.join(', ') : '--'}
                  </span>
                  <span className="dash-ap-units">{ap.units}u</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  )
}

/* ── Courses Tab ── */

function CoursesTab({
  completedCourses,
  inProgressCourses,
  courseGrades,
  majors,
  userId,
  onUpdate,
}: {
  completedCourses: string[]
  inProgressCourses: string[]
  courseGrades: Record<string, string>
  majors: NonNullable<ReturnType<typeof getMajorById>>[]
  userId: string
  onUpdate: (profile: unknown) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadMsg, setUploadMsg] = useState<string | null>(null)

  async function handleReUpload(file: File) {
    setUploading(true)
    setUploadMsg(null)
    try {
      const doc = await parsePDF(file)
      const courseGradesMap: Record<string, string> = {}
      for (const c of doc.completed_courses) {
        if (c.grade) courseGradesMap[c.course_code] = c.grade
      }

      const payload = {
        completed_courses: doc.completed_courses.map((c) => c.course_code),
        in_progress_courses: doc.in_progress_courses.map((c) => c.course_code),
        course_grades: courseGradesMap,
        cumulative_gpa: doc.cumulative_gpa,
        transfer_units: doc.transfer_units,
        ap_credits: doc.ap_credits,
        requirement_status: doc.requirement_status,
      }

      await supabase.from('student_profiles').update(payload).eq('user_id', userId)

      const { profile } = await getProfile(userId)
      if (profile) onUpdate(profile)
      setUploadMsg('Updated successfully.')
    } catch {
      setUploadMsg('Failed to parse. Try again or use a different PDF.')
    } finally {
      setUploading(false)
    }
  }

  return (
    <>
      <div className="dash-page-header">
        <h1 className="dash-page-title">Courses</h1>
        <div className="dash-page-actions">
          <input
            ref={inputRef}
            type="file"
            accept=".pdf"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) handleReUpload(f)
            }}
          />
          <button
            className="dash-action-btn"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? 'Parsing...' : 'Re-upload PDF'}
          </button>
        </div>
      </div>
      {uploadMsg && <p className="dash-msg">{uploadMsg}</p>}

      {/* Completed */}
      <div className="dash-card dash-card--wide">
        <div className="dash-card-header">
          <span className="dash-card-title">Completed ({completedCourses.length})</span>
        </div>
        {completedCourses.length > 0 ? (
          <div className="dash-course-grid">
            {completedCourses.map((code) => {
              const grade = courseGrades[code]
              return (
                <div key={code} className="dash-course-chip">
                  <span className="dash-course-code">{code}</span>
                  {grade && <span className={`dash-course-grade ${gradeColor(grade)}`}>{grade}</span>}
                </div>
              )
            })}
          </div>
        ) : (
          <p className="dash-empty">No completed courses yet. Upload a transcript to populate.</p>
        )}
      </div>

      {/* In progress */}
      {inProgressCourses.length > 0 && (
        <div className="dash-card dash-card--wide">
          <div className="dash-card-header">
            <span className="dash-card-title">In Progress ({inProgressCourses.length})</span>
          </div>
          <div className="dash-course-grid">
            {inProgressCourses.map((code) => (
              <div key={code} className="dash-course-chip ip">
                <span className="dash-course-code">{code}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* By major group */}
      {majors.map((m) => (
        <div key={m.id} className="dash-card dash-card--wide">
          <div className="dash-card-header">
            <span className="dash-card-title">{m.name} {m.degree}</span>
          </div>
          {m.groups.map((group) => {
            const done = group.courses.filter(
              (c) => completedCourses.includes(c.id) || (c.alt && completedCourses.includes(c.alt)),
            ).length
            return (
              <div key={group.label} className="dash-req-group">
                <div className="dash-req-group-header">
                  <span className="dash-req-group-label">{group.label}</span>
                  <span className="dash-req-group-count">{done}/{group.courses.length}</span>
                </div>
                <div className="dash-course-grid">
                  {group.courses.map((c) => {
                    const isDone = completedCourses.includes(c.id) || (c.alt && completedCourses.includes(c.alt))
                    return (
                      <div key={c.id} className={`dash-course-chip ${isDone ? 'done' : 'pending'}`}>
                        <span className="dash-course-code">{c.id}</span>
                        {isDone && <span className="dash-course-check">{'\u2713'}</span>}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      ))}
    </>
  )
}

function gradeColor(grade: string): string {
  if (grade.startsWith('A')) return 'grade-a'
  if (grade.startsWith('B')) return 'grade-b'
  if (grade.startsWith('C')) return 'grade-c'
  if (grade === 'P') return 'grade-p'
  return 'grade-low'
}

/* ── Requirements Tab ── */

function RequirementsTab({
  requirementStatus,
  majors,
  completedSet,
  majorCompleted,
  majorTotal,
}: {
  requirementStatus: Record<string, unknown> | null
  majors: NonNullable<ReturnType<typeof getMajorById>>[]
  completedSet: Set<string>
  majorCompleted: number
  majorTotal: number
}) {
  const geAreas = [
    ['ge_area_a1', 'Area A-1 (English Reading & Composition)'],
    ['ge_area_a2', 'Area A-2 (English Communication)'],
    ['ge_area_b', 'Area B (Foreign Language)'],
    ['ge_area_c', 'Area C (Science, Math, Technology)'],
    ['ge_area_d', 'Area D (Social Sciences)'],
    ['ge_area_e', 'Area E (Culture & Thought)'],
    ['ge_area_f', 'Area F (Arts)'],
    ['ge_area_g', 'Area G (Literature)'],
    ['ge_writing', 'Writing Requirement'],
    ['ge_quantitative', 'Quantitative Relationships'],
    ['ge_world_cultures', 'World Cultures (EUR)'],
    ['ge_ethnicity', 'Ethnicity Requirement (ETH)'],
    ['foreign_language', 'Foreign Language'],
    ['american_history', 'American History & Institutions'],
  ]

  return (
    <>
      <div className="dash-page-header">
        <h1 className="dash-page-title">Requirements</h1>
        <p className="dash-page-sub">
          {requirementStatus
            ? 'Imported from your Academic History'
            : 'Upload an Academic History PDF for detailed requirement tracking'}
        </p>
      </div>

      {requirementStatus ? (
        <div className="dash-grid">
          {/* GE Requirements */}
          <div className="dash-card dash-card--wide">
            <div className="dash-card-header">
              <span className="dash-card-title">General Education</span>
            </div>
            <div className="dash-req-list">
              {geAreas.map(([key, label]) => {
                const status = requirementStatus[key]
                const isOk = status === 'OK'
                return (
                  <div key={key} className={`dash-req-row ${isOk ? 'done' : 'needs'}`}>
                    <span className="dash-req-status">{isOk ? '\u2713' : '\u25CB'}</span>
                    <span className="dash-req-label">{label}</span>
                    <span className="dash-req-value">
                      {typeof status === 'string' ? status : '--'}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Major Requirements */}
          <div className="dash-card dash-card--wide">
            <div className="dash-card-header">
              <span className="dash-card-title">Major Requirements</span>
              <span className="dash-card-badge">{majorCompleted}/{majorTotal}</span>
            </div>
            {['pre_major', 'preparation_for_major', 'upper_div_major'].map((key) => {
              const status = requirementStatus[key]
              const isOk = status === 'OK'
              return (
                <div key={key} className={`dash-req-row ${isOk ? 'done' : 'needs'}`}>
                  <span className="dash-req-status">{isOk ? '\u2713' : '\u25CB'}</span>
                  <span className="dash-req-label">
                    {key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                  </span>
                  <span className="dash-req-value">
                    {typeof status === 'string' ? status : '--'}
                  </span>
                </div>
              )
            })}
          </div>

          {/* Unit requirements if available */}
          {requirementStatus.unit_requirements && (
            <div className="dash-card">
              <div className="dash-card-header">
                <span className="dash-card-title">Unit Requirements</span>
              </div>
              {Object.entries(requirementStatus.unit_requirements as Record<string, number>).map(([k, v]) => (
                <div key={k} className="dash-unit-row">
                  <span>{k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}</span>
                  <span>{v}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="dash-card dash-card--wide">
          <div className="dash-empty-state">
            <span className="dash-empty-icon">{'\u25B3'}</span>
            <h3>No requirement data yet</h3>
            <p>
              Upload your Academic History PDF (GOLD &rarr; Progress &rarr; Major Progress Check)
              to see detailed GE and major requirement tracking.
            </p>
          </div>

          {/* Fallback: show major groups */}
          {majors.map((m) => (
            <div key={m.id} style={{ marginTop: '1.5rem' }}>
              <div className="ob-major-section-header" style={{ marginBottom: '0.75rem' }}>
                {m.name} {m.degree}
              </div>
              {m.groups.map((group) => {
                const done = group.courses.filter(
                  (c) => completedSet.has(c.id) || (c.alt && completedSet.has(c.alt)),
                ).length
                return (
                  <div key={group.label} className="dash-req-group">
                    <div className="dash-req-group-header">
                      <span className="dash-req-group-label">{group.label}</span>
                      <span className="dash-req-group-count">{done}/{group.courses.length}</span>
                    </div>
                    <div className="dash-progress-bar sm">
                      <div
                        className="dash-progress-fill"
                        style={{ width: `${(done / group.courses.length) * 100}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </>
  )
}

/* ── Settings Tab ── */

function SettingsTab({
  email,
  onSignOut,
}: {
  email: string
  onSignOut: () => void
}) {
  return (
    <>
      <div className="dash-page-header">
        <h1 className="dash-page-title">Settings</h1>
      </div>

      <div className="dash-card">
        <div className="dash-card-header">
          <span className="dash-card-title">Account</span>
        </div>
        <div className="dash-settings-row">
          <span className="dash-settings-label">Email</span>
          <span className="dash-settings-value">{email}</span>
        </div>
        <div className="dash-settings-actions">
          <button className="dash-signout-btn" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </div>
    </>
  )
}
