import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'motion/react'
import type { User } from '@supabase/supabase-js'
import { useAuth } from '../../lib/auth'
import { getProfile } from '../../lib/profile'
import { HeroIntroMark } from './HeroIntroMark'
import VimaLoader from './VimaLoader'
import { YozakuraBackdrop } from './YozakuraBackdrop'

function userAvatarLabel(user: User): string {
  const name = user.user_metadata?.full_name
  if (typeof name === 'string' && name.trim()) {
    const parts = name.trim().split(/\s+/)
    const a = parts[0]?.[0] ?? ''
    const b = parts[1]?.[0] ?? ''
    return (a + b).toUpperCase() || a.toUpperCase()
  }
  const email = user.email ?? ''
  return email.slice(0, 2).toUpperCase() || '?'
}

function ArrowDown({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M6 9l6 6 6-6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function SectionDivider() {
  return (
    <div className="ace-divider">
      <div className="ace-divider-line" aria-hidden />
    </div>
  )
}

function AceNavbar() {
  const [scrolled, setScrolled] = useState(false)
  const { user, loading: authLoading } = useAuth()
  const [onboardingDone, setOnboardingDone] = useState(false)

  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY
      setScrolled((prev) => {
        if (prev && y < 28) return false
        if (!prev && y > 72) return true
        return prev
      })
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    if (!user) {
      setOnboardingDone(false)
      return
    }
    let cancelled = false
    getProfile(user.id).then(({ profile }) => {
      if (!cancelled) setOnboardingDone(!!profile?.onboarding_complete)
    })
    return () => {
      cancelled = true
    }
  }, [user])

  const signedIn = !!user && !authLoading

  return (
    <header className={`ace-nav ${scrolled ? 'scrolled' : ''}`}>
      <Link to="/" className="ace-nav-brand">
        <img src="/ucsb-favicon.ico" alt="" width={22} height={22} />
        <span>ACE</span>
      </Link>
      <nav className="ace-nav-links" aria-label="sections">
        <a href="#catalog">catalog</a>
        <a href="#how-it-works">onboarding</a>
        <a href="#pipeline">pipeline</a>
        <a href="#features">product</a>
      </nav>
      <div className="ace-nav-actions">
        {signedIn ? (
          <>
            <Link
              to="/settings"
              className="ace-nav-account"
              title="Account"
              aria-label="Account settings"
            >
              {user!.user_metadata?.avatar_url ? (
                <img
                  src={user!.user_metadata.avatar_url as string}
                  alt=""
                  className="ace-nav-avatar-img"
                  width={32}
                  height={32}
                />
              ) : (
                <span className="ace-nav-avatar-fallback" aria-hidden>
                  {userAvatarLabel(user!)}
                </span>
              )}
            </Link>
            <Link
              to={onboardingDone ? '/dashboard' : '/onboarding'}
              className="ace-nav-pill"
            >
              {onboardingDone ? 'dashboard' : 'continue setup'}
            </Link>
          </>
        ) : (
          <>
            <Link to="/auth" className="ace-nav-ghost">
              log in
            </Link>
            <Link to="/auth" className="ace-nav-pill">
              get started
            </Link>
          </>
        )}
      </div>
    </header>
  )
}

export function AceLanding() {
  /** VIMA footer clip — hide element if asset missing */
  const [footerConstructionOk, setFooterConstructionOk] = useState(true)

  return (
    <>
      <VimaLoader />
      <div className="ace-landing">
        <div className="ace-landing-backdrop" aria-hidden>
          <YozakuraBackdrop />
        </div>
        <AceNavbar />

        <main className="ace-scroll-main">
        <section id="top" className="ace-hero">
          <div className="ace-hero-grid" aria-hidden />

          <div className="ace-hero-foreground">
          <motion.p
            className="ace-hero-eyebrow"
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0, ease: [0.16, 1, 0.3, 1] }}
          >
            ucsb · live catalog · graduation paths
          </motion.p>

          <div className="ace-wordmark-row">
            <HeroIntroMark />
            <motion.h1
              className="ace-wordmark"
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, delay: 0.08, ease: [0.16, 1, 0.3, 1] }}
            >
              <span>a</span>
              <span>c</span>
              <span>e</span>
              <span>.</span>
            </motion.h1>
          </div>

          <motion.p
            className="ace-hero-lead"
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.16, ease: [0.16, 1, 0.3, 1] }}
          >
            Scheduling intelligence for UCSB undergrads — course discovery, requirement
            tracking, and ranked schedules grounded in real enrollment data and history.
          </motion.p>

          <motion.p
            className="ace-hero-sub"
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.24, ease: [0.16, 1, 0.3, 1] }}
          >
            Upload your Academic History or unofficial transcript as a PDF. ACE parses
            completed courses, in-progress units, GPA, and AP credit into a profile you can
            audit. Layer on a public course explorer, GE and major rules from curated
            sheets, and an optimizer that respects the constraints you actually have.
          </motion.p>

          <motion.p
            className="ace-hero-pipeline"
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.32, ease: [0.16, 1, 0.3, 1] }}
          >
            pdf → parsed profile → catalog graph → GE &amp; major rules → ranked schedules
          </motion.p>

          <motion.div
            className="ace-hero-cta-row"
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.4, ease: [0.16, 1, 0.3, 1] }}
          >
            <Link to="/auth" className="hero-cta-button hero-cta-button--primary">
              <span>start with your transcript</span>
            </Link>
            <Link to="/explorer" className="hero-cta-button hero-cta-button--secondary">
              <span>open course explorer</span>
            </Link>
            <a href="#how-it-works" className="hero-cta-button hero-cta-button--secondary">
              <span>how it works</span>
            </a>
          </motion.div>

          <div className="ace-scroll-hint">
            <a href="#catalog">
              <span>scroll</span>
              <ArrowDown />
            </a>
          </div>
          </div>
        </section>

        <SectionDivider />

        <section id="catalog" className="ace-section">
          <p className="ace-section-kicker">public catalog · explorer · requirements</p>
          <h2 className="ace-section-title">every plan starts from courses you can verify.</h2>
          <div className="ace-split">
            <p className="ace-section-lede" style={{ margin: 0 }}>
              ACE mirrors how students actually decide: browse sections, trace prerequisites,
              and see how a schedule sits against GE and major prep — before you commit to
              GOLD.
            </p>
            <p className="ace-section-lede" style={{ margin: 0 }}>
              The explorer stays public: search the catalog, inspect historical grade
              distributions where we have them, and pull instructor signal into the same view
              you use to shortlist classes.
            </p>
          </div>
          <div className="ace-stats">
            <div className="ace-stat">
              <div className="ace-stat-label">data plane</div>
              <div className="ace-stat-value">3</div>
              <div className="ace-stat-note">catalog, grade history, instructor ratings</div>
            </div>
            <div className="ace-stat">
              <div className="ace-stat-label">transcript parse</div>
              <div className="ace-stat-value">PDF</div>
              <div className="ace-stat-note">Academic History &amp; unofficial transcript layouts</div>
            </div>
            <div className="ace-stat">
              <div className="ace-stat-label">majors / minors</div>
              <div className="ace-stat-value">sheets</div>
              <div className="ace-stat-note">community-maintained requirement references</div>
            </div>
          </div>
        </section>

        <SectionDivider />

        <section id="how-it-works" className="ace-section">
          <p className="ace-section-kicker">onboarding · profile · planning</p>
          <h2 className="ace-section-title">three beats from blank slate to ranked schedules.</h2>
          <p className="ace-section-lede">
            No manual re-typing your entire academic history. ACE ingests what UCSB already
            gave you on paper.
          </p>
          <div className="ace-steps">
            <div className="ace-step">
              <div className="ace-step-num">01</div>
              <h3>Choose majors / minors</h3>
              <p>
                Select one or multiple programs. Requirement groups load from curated sheets
                so checklists stay aligned with how departments publish prep and core paths.
              </p>
            </div>
            <div className="ace-step">
              <div className="ace-step-num">02</div>
              <h3>Upload transcript PDF</h3>
              <p>
                Drop Academic History or the unofficial transcript printable. We reconstruct
                line-level text across pages and extract courses, grades, in-progress rows,
                GPA, and AP credit blocks.
              </p>
            </div>
            <div className="ace-step">
              <div className="ace-step-num">03</div>
              <h3>Plan &amp; optimize</h3>
              <p>
                Your dashboard reflects units, distributions, and requirement progress. Feed
                that state into the scheduler: hard constraints on conflicts and units, soft
                scores on grades, workload, and instructor fit.
              </p>
            </div>
          </div>
        </section>

        <SectionDivider />

        <section id="pipeline" className="ace-section">
          <p className="ace-section-kicker">under the hood</p>
          <h2 className="ace-section-title">real inputs, joint scoring, no vibes-only ranks.</h2>
          <p className="ace-section-lede">
            Multiple signals fuse before the optimizer touches your calendar — same spirit as
            a serious recommender system, but all numbers are inspectable.
          </p>
          <div className="ace-pipeline-grid">
            <div className="ace-pipe-card">
              <span className="ace-pipe-name">UCSB catalog</span>
              <span className="ace-pipe-detail">Sections, times, enrollment where available</span>
              <span className="ace-pipe-live">live ingest</span>
            </div>
            <div className="ace-pipe-card">
              <span className="ace-pipe-name">Grade distributions</span>
              <span className="ace-pipe-detail">Historical curves for comparable sections</span>
              <span className="ace-pipe-live">15+ years where published</span>
            </div>
            <div className="ace-pipe-card">
              <span className="ace-pipe-name">Instructor signal</span>
              <span className="ace-pipe-detail">Ratings &amp; reviews normalized per dept</span>
              <span className="ace-pipe-live">continuous refresh</span>
            </div>
          </div>
        </section>

        <SectionDivider />

        <section id="features" className="ace-section">
          <p className="ace-section-kicker">product surface</p>
          <h2 className="ace-section-title">everything we ship rolls up to one goal.</h2>
          <p className="ace-section-lede">
            Fewer surprise workloads, fewer requirement misses, faster iteration when GOLD
            throws you a new section time.
          </p>
          <div className="ace-features-grid">
            <div className="ace-feature-card">
              <h3>Graduation path</h3>
              <p>
                Quarter-by-quarter scaffolding from where you are now — units, requirements,
                and realistic sequencing against prerequisites.
              </p>
            </div>
            <div className="ace-feature-card">
              <h3>Schedule optimizer</h3>
              <p>
                Multi-objective search with explicit tradeoffs: minimize conflicts, balance
                difficulty, protect mornings, weight instructor quality.
              </p>
            </div>
            <div className="ace-feature-card">
              <h3>Course explorer</h3>
              <p>
                Public catalog browsing with filters that match how UCSB students actually
                shop classes — cross-listed awareness, GE tags, historical outcomes.
              </p>
            </div>
            <div className="ace-feature-card">
              <h3>Demo mode</h3>
              <p>
                Try the product without your own PDF — synthetic students exercise the same
                flows so teammates and judges can click through end-to-end.
              </p>
            </div>
          </div>
        </section>

        <footer id="footer" className="ace-footer">
          <div className="ace-footer-video-wrap" aria-hidden>
            <div className="ace-footer-fallback" />
            {footerConstructionOk ? (
              <video
                className="ace-footer-video"
                autoPlay
                muted
                loop
                playsInline
                preload="metadata"
                poster="/vima/footer-yozakura-construction.png"
                onError={() => setFooterConstructionOk(false)}
              >
                <source src="/vima/footer-yozakura-construction.mp4" type="video/mp4" />
              </video>
            ) : null}
            <div className="ace-footer-video-veil" />
          </div>

          <div className="ace-footer-panel">
            <div className="ace-footer-inner">
              <div>
                <p className="ace-footer-wordmark">ace.</p>
                <p className="ace-footer-desc">
                  The UCSB schedule stack — catalog intelligence, transcript-grounded profiles,
                  and ranked plans you can defend to advisors (or your future self).
                </p>
              </div>
              <nav className="ace-footer-links" aria-label="footer">
                <a href="https://github.com/MatthewKim323/aceds" target="_blank" rel="noreferrer">
                  source
                </a>
                <Link to="/explorer">explorer</Link>
                <Link to="/auth">sign in</Link>
                <Link to="/status">status</Link>
              </nav>
              <div className="ace-footer-meta">
                <span>UCSB · scheduling · requirements</span>
                <span>not affiliated with the university</span>
              </div>
            </div>
          </div>
        </footer>
        </main>
      </div>
    </>
  )
}
