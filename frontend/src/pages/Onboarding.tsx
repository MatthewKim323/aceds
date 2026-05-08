import { useState, useCallback, useRef, useEffect } from 'react'
import { useNavigate, Navigate, useSearchParams, Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'motion/react'
import { majors, getMajorById } from '../data/majors'
import { useAuth } from '../lib/auth'
import { saveProfile, getProfile } from '../lib/profile'
import { parsePDF, computeStats, toCourseNorm, type ParsedDocument } from '../lib/pdf-parser'
import type { Major } from '../data/majors'

const YEARS = [
  { id: '1', label: 'Freshman', sub: '1st year' },
  { id: '2', label: 'Sophomore', sub: '2nd year' },
  { id: '3', label: 'Junior', sub: '3rd year' },
  { id: '4', label: 'Senior', sub: '4th year' },
  { id: '5', label: '5th year+', sub: 'super senior' },
]

const PATTERNS = ['MWF', 'TR', 'No preference'] as const
const PRIORITIES = ['Professor Rating', 'Easy A', 'Schedule Convenience', 'Seat Availability'] as const

interface OnboardingState {
  majorIds: string[]
  year: string
  completedCourses: Set<string>
  uploadMethod: 'academic_history' | 'transcript' | 'manual'
  earliestTime: number
  pattern: string
  units: number
  priorities: string[]
  parsedDoc: ParsedDocument | null
}

function prioritiesFromWeights(w: Record<string, number> | null | undefined): string[] {
  if (!w || typeof w !== 'object') return [...PRIORITIES]
  const labelByKey: Record<string, string> = {
    professor: 'Professor Rating',
    grades: 'Easy A',
    convenience: 'Schedule Convenience',
    availability: 'Seat Availability',
  }
  const keys = Object.keys(labelByKey) as (keyof typeof labelByKey)[]
  const ranked = keys
    .map((key) => ({
      label: labelByKey[key],
      weight: typeof w[key] === 'number' ? w[key] : 0,
    }))
    .sort((a, b) => b.weight - a.weight)
    .map((x) => x.label)
  const seen = new Set(ranked)
  for (const p of PRIORITIES) {
    if (!seen.has(p)) ranked.push(p)
  }
  return ranked
}

function deriveOnboardingStateFromProfile(profile: Record<string, unknown>): OnboardingState {
  const majorStr = typeof profile.major === 'string' ? profile.major : ''
  const majorIds = majorStr.split(',').map((s) => s.trim()).filter(Boolean)
  const year = typeof profile.year === 'string' ? profile.year : ''
  const coursesRaw = profile.completed_courses
  const courses: string[] = Array.isArray(coursesRaw)
    ? coursesRaw.map((c) => toCourseNorm(String(c)))
    : []
  const earliestRaw = typeof profile.earliest_class === 'string' ? profile.earliest_class : '09:00'
  const hm = earliestRaw.match(/^(\d{1,2})/)
  let earliestTime = 9
  if (hm) {
    const n = parseInt(hm[1], 10)
    if (Number.isFinite(n)) earliestTime = Math.min(23, Math.max(6, n))
  }
  const pref = typeof profile.preferred_days === 'string' ? profile.preferred_days : 'no_preference'
  let pattern = 'No preference'
  if (pref === 'mwf') pattern = 'MWF'
  else if (pref === 'tr') pattern = 'TR'
  const units = typeof profile.target_units === 'number' ? profile.target_units : 16
  const pw = profile.priority_weights as Record<string, number> | null | undefined
  const priorities = prioritiesFromWeights(pw ?? null)

  return {
    majorIds,
    year,
    completedCourses: new Set(courses),
    uploadMethod: 'manual',
    earliestTime,
    pattern,
    units,
    priorities,
    parsedDoc: null,
  }
}

export function Onboarding() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const isEditing =
    searchParams.get('edit') === '1' ||
    searchParams.get('edit') === 'true'
  const { user, loading: authLoading } = useAuth()
  const [step, setStep] = useState(0)
  const [dir, setDir] = useState(1)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const hydratedFromDbRef = useRef(false)
  const [state, setState] = useState<OnboardingState>({
    majorIds: [],
    year: '',
    completedCourses: new Set(),
    uploadMethod: 'manual',
    earliestTime: 9,
    pattern: 'No preference',
    units: 16,
    priorities: [...PRIORITIES],
    parsedDoc: null,
  })

  useEffect(() => {
    hydratedFromDbRef.current = false
  }, [user?.id, isEditing])

  useEffect(() => {
    if (authLoading || !user) return
    let cancelled = false
    getProfile(user.id).then(({ profile }) => {
      if (cancelled) return
      if (profile?.onboarding_complete && !isEditing) {
        navigate('/dashboard', { replace: true })
        return
      }
      if (isEditing && profile && !hydratedFromDbRef.current) {
        setState(deriveOnboardingStateFromProfile(profile as Record<string, unknown>))
        hydratedFromDbRef.current = true
      }
    })
    return () => {
      cancelled = true
    }
  }, [authLoading, user, navigate, isEditing])

  const canAdvance = useCallback(() => {
    if (step === 0) return state.majorIds.length > 0
    if (step === 1) return state.year !== ''
    if (step === 2) return true
    return true
  }, [step, state.majorIds.length, state.year])

  async function next() {
    if (!canAdvance()) return
    if (step === 3) {
      if (user) {
        setSaving(true)
        setSaveError(null)
        const { error } = await saveProfile(user.id, {
          majorIds: state.majorIds,
          year: state.year,
          completedCourses: [...state.completedCourses],
          earliestTime: state.earliestTime,
          pattern: state.pattern,
          units: state.units,
          priorities: state.priorities,
          parsedDoc: state.parsedDoc,
          ingestSource: state.uploadMethod,
        })
        setSaving(false)
        if (error) {
          console.error('Failed to save profile:', error)
          setSaveError(error)
          return
        }
      }
      localStorage.setItem(
        'ace_onboarding',
        JSON.stringify({
          ...state,
          completedCourses: [...state.completedCourses],
          parsedDoc: state.parsedDoc,
        }),
      )
      navigate(isEditing ? '/settings' : '/dashboard')
      return
    }
    setDir(1)
    setStep((s) => s + 1)
  }

  if (authLoading) return null
  if (!user) return <Navigate to="/auth" replace />

  function back() {
    if (step === 0) return
    setDir(-1)
    setStep((s) => s - 1)
  }

  function toggleCourse(id: string) {
    setState((prev) => {
      const next = new Set(prev.completedCourses)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return { ...prev, completedCourses: next }
    })
  }

  function movePriority(from: number, to: number) {
    setState((prev) => {
      const next = [...prev.priorities]
      const [item] = next.splice(from, 1)
      next.splice(to, 0, item)
      return { ...prev, priorities: next }
    })
  }

  function handleParsed(doc: ParsedDocument) {
    const completedIds = new Set(
      doc.completed_courses.map((c) => toCourseNorm(c.course_code)),
    )
    setState((prev) => ({
      ...prev,
      completedCourses: completedIds,
      parsedDoc: doc,
    }))
  }

  function clearParsed() {
    setState((prev) => ({ ...prev, parsedDoc: null }))
  }

  const selectedMajors = state.majorIds.map(getMajorById).filter((m): m is Major => !!m)
  const allGroups = selectedMajors.flatMap((m) => m.groups)

  const variants = {
    enter: (d: number) => ({ x: d > 0 ? 60 : -60, opacity: 0 }),
    center: { x: 0, opacity: 1 },
    exit: (d: number) => ({ x: d > 0 ? -60 : 60, opacity: 0 }),
  }

  return (
    <div className="onboarding">
      <div className="ob-header">
        <div className="ob-header-brand">
          {isEditing ? (
            <Link to="/settings" className="ob-edit-back">&larr; settings</Link>
          ) : null}
          <a href="/" className="ob-logo">ACE</a>
        </div>
        <div className="ob-steps">
          {['Major', 'Year', 'Courses', 'Preferences'].map((label, i) => (
            <div key={label} className={`ob-step-dot ${i === step ? 'active' : ''} ${i < step ? 'done' : ''}`}>
              <span className="ob-dot" />
              <span className="ob-step-label">{label}</span>
            </div>
          ))}
        </div>
        <div className="ob-header-actions">
          <span className="ob-step-count">{step + 1}/4</span>
          <button type="button" className="ob-next ob-header-continue" onClick={next} disabled={!canAdvance() || saving}>
            {saving ? 'Saving...' : step === 3 ? "Let's Go" : 'Continue'}
          </button>
        </div>
      </div>

      <div className="ob-body">
        <AnimatePresence mode="wait" custom={dir}>
          <motion.div
            key={step}
            custom={dir}
            variants={variants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="ob-step-wrap"
          >
            {step === 0 && (
              <StepMajor
                selected={state.majorIds}
                onToggle={(id) =>
                  setState((s) => ({
                    ...s,
                    majorIds: s.majorIds.includes(id)
                      ? s.majorIds.filter((m) => m !== id)
                      : [...s.majorIds, id],
                  }))
                }
              />
            )}
            {step === 1 && (
              <StepYear
                value={state.year}
                onChange={(y) => setState((s) => ({ ...s, year: y }))}
              />
            )}
            {step === 2 && (
              <StepCourses
                majors={selectedMajors}
                method={state.uploadMethod}
                setMethod={(m) => setState((s) => ({ ...s, uploadMethod: m }))}
                completed={state.completedCourses}
                toggle={toggleCourse}
                parsedDoc={state.parsedDoc}
                onParsed={handleParsed}
                onClear={clearParsed}
                allGroups={allGroups}
              />
            )}
            {step === 3 && (
              <StepPreferences
                earliest={state.earliestTime}
                setEarliest={(v) => setState((s) => ({ ...s, earliestTime: v }))}
                pattern={state.pattern}
                setPattern={(v) => setState((s) => ({ ...s, pattern: v }))}
                units={state.units}
                setUnits={(v) => setState((s) => ({ ...s, units: v }))}
                priorities={state.priorities}
                movePriority={movePriority}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {saveError && step === 3 && (
        <p className="ob-save-error" role="alert">
          Couldn&apos;t save your profile: {saveError}. Check Supabase connection and
          RLS policies, then try again.
        </p>
      )}

      <AnimatePresence>
        {saving && step === 3 ? (
          <motion.div
            className="ob-ingest-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="ob-ingest-card">
              <span className="ob-upload-spinner ob-ingest-spinner" />
              <p className="ob-ingest-title">Saving your profile</p>
              <p className="ob-ingest-hint">Syncing courses and preferences to your account.</p>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <div className="ob-footer">
        <button type="button" className="ob-back" onClick={back} disabled={step === 0}>
          Back
        </button>
      </div>
    </div>
  )
}

/* ── Step 1: Major ── */

function StepMajor({ selected, onToggle }: { selected: string[]; onToggle: (id: string) => void }) {
  const [search, setSearch] = useState('')
  const filtered = majors.filter(
    (m) =>
      m.name.toLowerCase().includes(search.toLowerCase()) ||
      m.degree.toLowerCase().includes(search.toLowerCase()),
  )

  return (
    <div className="ob-step">
      <h1 className="ob-title">What's your major?</h1>
      <p className="ob-desc">
        Select one or more majors. Double major? Just pick both.
      </p>

      {selected.length > 0 && (
        <div className="ob-selected-majors">
          {selected.map((id) => {
            const m = getMajorById(id)
            if (!m) return null
            return (
              <span key={id} className="ob-selected-tag" onClick={() => onToggle(id)}>
                {m.name} {m.degree}
                <span className="ob-tag-x">&times;</span>
              </span>
            )
          })}
        </div>
      )}

      <input
        type="text"
        className="ob-search"
        placeholder="Search majors..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      <div className="ob-major-list">
        {filtered.map((m) => (
          <button
            key={m.id}
            className={`ob-major-card ${selected.includes(m.id) ? 'selected' : ''}`}
            onClick={() => onToggle(m.id)}
          >
            <span className="ob-major-name">{m.name}</span>
            <span className="ob-major-degree">{m.degree}</span>
            <span className="ob-major-dept">{m.department}</span>
            {selected.includes(m.id) && <span className="ob-major-check">{'\u2713'}</span>}
          </button>
        ))}
        {filtered.length === 0 && (
          <p className="ob-empty">No matching majors found. More are coming soon.</p>
        )}
      </div>
    </div>
  )
}

/* ── Step 2: Year ── */

function StepYear({ value, onChange }: { value: string; onChange: (y: string) => void }) {
  return (
    <div className="ob-step">
      <h1 className="ob-title">What year are you?</h1>
      <p className="ob-desc">This helps us estimate your remaining requirements.</p>

      <div className="ob-year-grid">
        {YEARS.map((y) => (
          <button
            key={y.id}
            className={`ob-year-card ${value === y.id ? 'selected' : ''}`}
            onClick={() => onChange(y.id)}
          >
            <span className="ob-year-label">{y.label}</span>
            <span className="ob-year-sub">{y.sub}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

/* ── Step 3: Courses ── */

/** Minimum dwell per stage so PDF ingest feels substantial (client-side only; labels are theatrical). */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const PDF_INGEST_PRE_STAGES = 4
const PDF_INGEST_STAGES: { label: string; dwellMs: number }[] = [
  { label: 'Loading PDF into secure browser memory…', dwellMs: 520 },
  { label: 'Walking page graph & text extraction regions…', dwellMs: 620 },
  { label: 'Indexing transcript rows for the course subgraph…', dwellMs: 680 },
  { label: 'Aligning entities with the SKP catalog layer…', dwellMs: 720 },
  { label: 'Parsing Academic History into structured nodes…', dwellMs: 0 },
  { label: 'Projecting grades onto the knowledge graph projection…', dwellMs: 640 },
  { label: 'Resolving UCSB course_norm identities & edges…', dwellMs: 600 },
  { label: 'Materializing evidence bundle for your degree path…', dwellMs: 580 },
]

function StepCourses({
  majors: selectedMajors,
  method,
  setMethod,
  completed,
  toggle,
  parsedDoc,
  onParsed,
  onClear,
  allGroups,
}: {
  majors: Major[]
  method: string
  setMethod: (m: OnboardingState['uploadMethod']) => void
  completed: Set<string>
  toggle: (id: string) => void
  parsedDoc: ParsedDocument | null
  onParsed: (doc: ParsedDocument) => void
  onClear: () => void
  allGroups: import('../data/majors').CourseGroup[]
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [parsing, setParsing] = useState(false)
  /** Primary status line during PDF theater (empty = idle). */
  const [ingestLabel, setIngestLabel] = useState('')
  const [parseError, setParseError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)

  async function handleFile(file: File) {
    if (!file.type.includes('pdf') && !file.name.endsWith('.pdf')) {
      setParseError('Please upload a PDF file.')
      return
    }
    setParsing(true)
    setParseError(null)
    const parsePromise = parsePDF(file)

    try {
      for (let i = 0; i < PDF_INGEST_PRE_STAGES; i++) {
        const s = PDF_INGEST_STAGES[i]
        setIngestLabel(s.label)
        await sleep(s.dwellMs)
      }

      const parsingBeat = PDF_INGEST_STAGES[PDF_INGEST_PRE_STAGES]
      setIngestLabel(parsingBeat.label)
      const doc = await parsePromise

      for (let i = PDF_INGEST_PRE_STAGES + 1; i < PDF_INGEST_STAGES.length; i++) {
        const s = PDF_INGEST_STAGES[i]
        setIngestLabel(s.label)
        await sleep(s.dwellMs)
      }

      onParsed(doc)
    } catch (err) {
      console.error('PDF parse error:', err)
      setParseError('Could not parse this PDF. Try a different file or use manual entry.')
    } finally {
      setIngestLabel('')
      setParsing(false)
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  function onFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }

  const showUpload = method === 'academic_history' || method === 'transcript'
  const stats = parsedDoc ? computeStats(parsedDoc, allGroups) : null

  return (
    <div className="ob-step">
      <h1 className="ob-title">What have you taken?</h1>
      <p className="ob-desc">
        Upload a document for the most accurate results, or check off courses manually.
      </p>

      <div className="ob-method-tabs">
        {(
          [
            ['academic_history', 'Academic History', 'Best'],
            ['transcript', 'Transcript', 'Good'],
            ['manual', 'Manual Entry', ''],
          ] as const
        ).map(([id, label, badge]) => (
          <button
            key={id}
            className={`ob-method-tab ${method === id ? 'active' : ''}`}
            onClick={() => setMethod(id)}
          >
            {label}
            {badge && <span className="ob-method-badge">{badge}</span>}
          </button>
        ))}
      </div>

      {showUpload && !parsedDoc && (
        <div className="ob-upload-area">
          <input
            ref={inputRef}
            type="file"
            accept=".pdf"
            style={{ display: 'none' }}
            onChange={onFileInput}
          />
          <div
            className={`ob-upload-dropzone ${dragOver ? 'drag-over' : ''} ${parsing ? 'parsing' : ''}`}
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
          >
            {parsing ? (
              <>
                <span className="ob-upload-spinner" />
                <span className="ob-upload-text">{ingestLabel || 'Preparing ingest pipeline…'}</span>
              </>
            ) : (
              <>
                <span className="ob-upload-icon">+</span>
                <span className="ob-upload-text">
                  Drag & drop your {method === 'academic_history' ? 'Academic History' : 'Transcript'} PDF, or click to browse
                </span>
                <span className="ob-upload-hint">
                  {method === 'academic_history'
                    ? 'GOLD \u2192 Progress \u2192 Major Progress Check \u2192 Print \u2192 Save as PDF'
                    : 'GOLD \u2192 Grades \u2192 Unofficial Transcript \u2192 Print \u2192 Save as PDF'}
                </span>
              </>
            )}
          </div>
          {parseError && <p className="ob-parse-error">{parseError}</p>}
          <p className="ob-privacy">
            Your document is processed locally in your browser. We never store the
            PDF, your name, perm number, or any personal identifiers.
          </p>
        </div>
      )}

      {showUpload && parsedDoc && stats && (
        <div className="ob-parsed-result">
          <div className="ob-parsed-header">
            <div className="ob-parsed-badge">
              {parsedDoc.document_type === 'academic_history'
                ? 'Academic History'
                : 'Transcript'} parsed
            </div>
            <button className="ob-reupload" onClick={() => {
              onClear()
            }}>
              Re-upload
            </button>
          </div>

          <div className="ob-parsed-stats">
            <div className="ob-parsed-stat">
              <span className="ob-parsed-stat-value">{stats.gpa?.toFixed(2) ?? '--'}</span>
              <span className="ob-parsed-stat-label">GPA</span>
            </div>
            <div className="ob-parsed-stat">
              <span className="ob-parsed-stat-value">{stats.totalCourses}</span>
              <span className="ob-parsed-stat-label">Courses done</span>
            </div>
            <div className="ob-parsed-stat">
              <span className="ob-parsed-stat-value">{stats.unitsCompleted}</span>
              <span className="ob-parsed-stat-label">Units</span>
            </div>
            {stats.inProgressCourses > 0 && (
              <div className="ob-parsed-stat">
                <span className="ob-parsed-stat-value">{stats.inProgressCourses}</span>
                <span className="ob-parsed-stat-label">In progress</span>
              </div>
            )}
          </div>

          {parsedDoc.completed_courses.length > 0 && (
            <div className="ob-parsed-courses">
              <div className="ob-parsed-courses-header">
                <span>Completed courses ({parsedDoc.completed_courses.length})</span>
              </div>
              <div className="ob-parsed-course-list">
                {parsedDoc.completed_courses.map((c, i) => (
                  <div key={`${c.course_code}-${i}`} className="ob-parsed-course-chip">
                    <span className="ob-parsed-course-code">{c.course_code}</span>
                    {c.grade && c.grade !== 'P' && (
                      <span className="ob-parsed-course-grade">{c.grade}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {parsedDoc.in_progress_courses.length > 0 && (
            <div className="ob-parsed-courses">
              <div className="ob-parsed-courses-header">
                <span>Currently enrolled ({parsedDoc.in_progress_courses.length})</span>
              </div>
              <div className="ob-parsed-course-list">
                {parsedDoc.in_progress_courses.map((c, i) => (
                  <div key={`${c.course_code}-${i}`} className="ob-parsed-course-chip ip">
                    <span className="ob-parsed-course-code">{c.course_code}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {parsedDoc.ap_credits.length > 0 && (
            <div className="ob-parsed-courses">
              <div className="ob-parsed-courses-header">
                <span>AP Credits ({parsedDoc.ap_credits.length})</span>
              </div>
              <div className="ob-parsed-course-list">
                {parsedDoc.ap_credits.map((ap, i) => (
                  <div key={i} className="ob-parsed-course-chip ap">
                    <span className="ob-parsed-course-code">{ap.exam}</span>
                    {ap.score && <span className="ob-parsed-course-grade">{ap.score}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {method === 'manual' && selectedMajors.length > 0 && (
        <div className="ob-course-groups">
          {selectedMajors.map((m) => (
            <div key={m.id} className="ob-major-section">
              {selectedMajors.length > 1 && (
                <div className="ob-major-section-header">
                  {m.name} {m.degree}
                </div>
              )}
              {m.groups.map((group) => (
                <div key={`${m.id}-${group.label}`} className="ob-course-group">
                  <div className="ob-group-header">
                    <span className="ob-group-label">{group.label}</span>
                    {group.note && <span className="ob-group-note">{group.note}</span>}
                    <span className="ob-group-count">
                      {group.courses.filter((c) => completed.has(c.id) || (c.alt && completed.has(c.alt))).length}
                      /{group.courses.length}
                    </span>
                  </div>
                  <div className="ob-course-list">
                    {group.courses.map((course) => {
                      const checked = completed.has(course.id) || (course.alt ? completed.has(course.alt) : false)
                      return (
                        <button
                          key={course.id}
                          className={`ob-course-row ${checked ? 'checked' : ''}`}
                          onClick={() => toggle(course.id)}
                        >
                          <span className="ob-check">{checked ? '\u2713' : ''}</span>
                          <span className="ob-course-id">{course.id}</span>
                          {course.alt && <span className="ob-course-alt">or {course.alt}</span>}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {method === 'manual' && selectedMajors.length === 0 && (
        <p className="ob-empty">Select a major first to see the course checklist.</p>
      )}
    </div>
  )
}

/* ── Step 4: Preferences ── */

function StepPreferences({
  earliest,
  setEarliest,
  pattern,
  setPattern,
  units,
  setUnits,
  priorities,
  movePriority,
}: {
  earliest: number
  setEarliest: (v: number) => void
  pattern: string
  setPattern: (v: string) => void
  units: number
  setUnits: (v: number) => void
  priorities: string[]
  movePriority: (from: number, to: number) => void
}) {
  function formatTime(h: number) {
    if (h === 12) return '12 PM'
    return h < 12 ? `${h} AM` : `${h - 12} PM`
  }

  return (
    <div className="ob-step">
      <h1 className="ob-title">Set your preferences</h1>
      <p className="ob-desc">
        Fine-tune how ACE builds your schedule. You can change these later.
      </p>

      <div className="ob-pref-grid">
        <div className="ob-pref-card">
          <label className="ob-pref-label">Earliest class</label>
          <div className="ob-slider-wrap">
            <input
              type="range"
              min={7}
              max={12}
              value={earliest}
              onChange={(e) => setEarliest(Number(e.target.value))}
              className="ob-slider"
            />
            <span className="ob-slider-value">{formatTime(earliest)}</span>
          </div>
        </div>

        <div className="ob-pref-card">
          <label className="ob-pref-label">Schedule pattern</label>
          <div className="ob-pattern-row">
            {PATTERNS.map((p) => (
              <button
                key={p}
                className={`ob-pattern-btn ${pattern === p ? 'active' : ''}`}
                onClick={() => setPattern(p)}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        <div className="ob-pref-card">
          <label className="ob-pref-label">Target units</label>
          <div className="ob-slider-wrap">
            <input
              type="range"
              min={12}
              max={20}
              value={units}
              onChange={(e) => setUnits(Number(e.target.value))}
              className="ob-slider"
            />
            <span className="ob-slider-value">{units} units</span>
          </div>
        </div>

        <div className="ob-pref-card ob-pref-card--full">
          <label className="ob-pref-label">Optimization priority</label>
          <p className="ob-pref-hint">Click arrows to reorder. Top = highest priority.</p>
          <div className="ob-priority-list">
            {priorities.map((p, i) => (
              <div key={p} className="ob-priority-row">
                <span className="ob-priority-rank">{i + 1}</span>
                <span className="ob-priority-name">{p}</span>
                <div className="ob-priority-arrows">
                  <button
                    className="ob-arrow"
                    disabled={i === 0}
                    onClick={() => movePriority(i, i - 1)}
                  >
                    &uarr;
                  </button>
                  <button
                    className="ob-arrow"
                    disabled={i === priorities.length - 1}
                    onClick={() => movePriority(i, i + 1)}
                  >
                    &darr;
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
