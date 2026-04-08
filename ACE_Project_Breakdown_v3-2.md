# ACE — The UCSB Schedule Optimizer

## The One-Liner

A complete academic platform for UCSB students: browse every course, professor, and grade distribution (like UCSBPlat but better), then log in to upload your transcript, get AI-optimized schedules ranked by professor quality, grade odds, and seat availability, track your graduation path with UCSB's own degree audit data, and know exactly what to register for first at your pass time.

---

## The Problem

Every quarter, UCSB students go through the same painful ritual:

1. Open GOLD. Stare at a wall of section numbers and times.
2. Manually cross-reference every professor on RateMyProfessor.
3. Try to figure out grade distributions from scattered sources.
4. Attempt to build a schedule with no time conflicts.
5. Panic about which classes fill up before your pass time.
6. Hope you didn't accidentally miss a prerequisite.

This takes hours. And even after all that work, you're still guessing. You don't have the data to actually KNOW which schedule gives you the best shot at a high GPA, the best professors, and classes you can actually get into.

**ACE does all of this in minutes.**

---

## Target Audience

UCSB students — starting with Computer Science and Data Science / Statistics majors, expanding to all majors later.

---

## Data Strategy: APIs Over Scraping

> **Key Insight:** UCSB has an official Developer API Portal (https://developer.ucsb.edu) with auto-approved public endpoints for course data. The Daily Nexus has 15+ years of grade distributions freely available on GitHub. This eliminates the need for browser scraping on 3 out of 4 data sources.

### Data Source Overview

| Data Need | Source | Method | Notes |
|---|---|---|---|
| Course sections, times, instructors, enrollment | **UCSB Public API** — Academic Curriculums endpoint | REST API (API key, auto-approved) | Same API used by CS 156's proj-courses. Structured JSON, one call per quarter per subject. |
| Grade distributions (A%, B%, GPA, etc.) | **Daily Nexus Grades Dataset** (GitHub) | Static CSV import | Public records data from Office of the Registrar via FOIA. Fall 2009 – present. Free to reuse. |
| Professor ratings & reviews | **RateMyProfessor** | Python library (`RateMyProfessorAPI` on PyPI) | Wraps RMP's internal GraphQL API. No browser needed. Returns ratings, difficulty, would-take-again, tags. |
| Major requirements & prerequisites | **Official PDF major sheets** → Claude API extraction | LLM-powered PDF parsing (one-time per major per year) | Download major sheet PDFs from UCSB catalog, send to Claude API to extract structured JSON. Launch majors: CS B.S., CS B.A., Data Science B.S., Stats & Data Science B.S. Expand to all ~90 majors over time. |
| Student's completed courses + requirement status | **GOLD document upload** — Unofficial Transcript OR Academic History PDF | User uploads PDF, LLM extracts data | Academic History (Major Progress Check) is the premium option: gives courses, grades, AP credit mappings, AND full requirement status from UCSB's own degree audit. Transcript gives courses + grades only. Raw PDF never stored. |
| Historical fill rates / enrollment velocity | **UCSB Public API** (self-collected over time) | Periodic polling + own database | No public dataset exists. Build your own by polling enrollment counts during registration windows each quarter. |

---

## Core Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        SUPABASE AUTH                             │
│                Sign Up / Login / Student Profiles                │
└──────────────────────────┬──────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│                     FRONTEND (React)                             │
│                                                                  │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌───────────┐ │
│  │ Onboarding │  │ My         │  │ Data       │  │ Grad Path │ │
│  │ Flow       │  │ Schedules  │  │ Pipeline   │  │ (Prereq   │ │
│  │            │  │            │  │ Status     │  │  Graph)    │ │
│  └────────────┘  └────────────┘  └────────────┘  └───────────┘ │
└──────────────────────────┬──────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│                   PYTHON BACKEND (FastAPI)                        │
│                                                                  │
│  DATA PIPELINE (replaces browser agent fleet):                   │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  📋 Catalog Service ─► UCSB API for sections & enrollment  │  │
│  │  ⭐ Professor Service ► RateMyProfessorAPI (Python lib)     │  │
│  │  📊 Grade Service ────► Daily Nexus CSV (pre-loaded in DB)  │  │
│  │  🗺️ Prereq Service ──► UCSB API + cached major sheets      │  │
│  │  📈 Fill Rate Service ► Self-collected enrollment snapshots  │  │
│  │                                                             │  │
│  │  Progress streamed to frontend via Supabase Realtime        │  │
│  └──────────────────────────┬─────────────────────────────────┘  │
│                             │ all data collected                  │
│  OPTIMIZER ENGINE:          ▼                                    │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  🧮 Schedule Optimizer                                      │  │
│  │  • Multi-objective scoring (prof + grades + time + seats)  │  │
│  │  • Constraint satisfaction (no conflicts, prereqs met)     │  │
│  │  • Generates 3-5 ranked schedule options                   │  │
│  │  • Pass time registration strategy                         │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│              Hosted: Railway or Fly.io                            │
└──────────────────────────────────────────────────────────────────┘
```

---

## Page Architecture & User Flow

### Complete Flow

```
🏠 Landing Page (polished, public — sells the product)
    │
    ├── [Explore Courses] ──► 📚 Course Explorer (public, no login required)
    │                          ├── Browse by department
    │                          ├── Professor profiles + ratings
    │                          ├── Grade distribution charts
    │                          ├── GE finder (easy GEs by area)
    │                          └── Enrollment trends
    │
    │  [Get Started — It's Free]
    ▼
🔐 Auth Screen (Supabase — Google OAuth or email signup)
    │
    │  New user ──► Onboarding
    │  Returning user ──► Home Dashboard
    ▼
📝 Onboarding (first time only — major → year → upload transcript → preferences)
    │
    ▼
🏡 Home Dashboard (welcome screen with hero action + explore options)
    │
    ├── [Build My Schedule →] ──► ⚡ Pipeline Status (data loads, user sees progress)
    │                              │
    │                              │  [✅ Schedules Ready →]
    │                              ▼
    │                          📅 My Schedules (ranked list + calendar)
    │
    ├── [Explore Courses] ────► 📚 Course Explorer (same as public, but with personal context)
    │
    ├── [Explore Grad Path] ──► 🗺️ Grad Path (interactive prereq graph)
    │
    └── [Adjust Preferences] ─► ⚙️ Settings (profile, priorities, times)
```

The app has two modes:
- **Browse mode** (public, no login) — Anyone can explore the course catalog, professor ratings, grade distributions, and GE finder. This is ACE's version of UCSBPlat but with richer data and a cleaner interface. Accessible from the landing page and the sidebar.
- **Build mode** (logged in) — Upload your transcript/academic history, get personalized schedule optimization, grad path tracking, and registration strategies. Everything in browse mode is also available here, enhanced with personal context (e.g., "you've taken this course" badges, "this satisfies your Area G requirement" tags).

Once inside the app, the sidebar is always visible. Every view is accessible from the sidebar at any time.

---

### Page 1: 🏠 Landing Page

A polished public-facing page that sells ACE to students who visit the URL. Visible only to logged-out users.

#### Structure

**Top nav bar:**
```
🎓 ACE                                    [Log In]  [Get Started — It's Free]
```

**Hero section:**
- Headline: "Your Perfect UCSB Schedule in 2 Minutes"
- Subheadline: "ACE pulls live data from UCSB's course catalog, 15 years of grade distributions, and professor ratings — then builds your optimal schedule and tells you exactly what to register for first."
- CTA: [Get Started — It's Free]
- Hero image/animation: Screenshot or animated preview of the schedule builder with ranked results

**How It Works section (3 steps):**
1. "Tell us your major and what you've taken" — screenshot of onboarding
2. "ACE pulls data from 3 sources in seconds" — animated pipeline graphic
3. "Get your ranked schedules with a registration strategy" — screenshot of schedule cards

**Feature highlights:**
- "Best professors first" — RateMyProfessor data for every section
- "Know your grade odds" — 15+ years of historical grade distributions per professor
- "Never miss a prereq" — Interactive prerequisite graph and graduation path
- "Beat the pass time rush" — Fill-rate predictions tell you what to register for first

**Social proof section (post-launch):**
- "Built by UCSB students, for UCSB students"
- Number of schedules generated
- Supported majors

**Footer CTA:**
- [Get Started — It's Free]

---

### Page 1.5: 📚 Course Explorer (Public — No Login Required)

**This is ACE's answer to UCSBPlat.** A full course catalog with grade distributions, professor ratings, enrollment trends, and GE finder — all publicly accessible without an account. This is the top of the funnel: students discover ACE through the course explorer, then sign up when they want personalized schedule optimization.

#### Sub-pages

**📚 Browse by Department**
- Full list of all UCSB departments (same ~70 departments as GOLD/Plat)
- Click a department → see every course offered that quarter
- Each course card shows: course code, title, instructor(s), meeting times, enrollment count vs. capacity, average GPA from Nexus data, and a quick RMP rating badge for the instructor
- Filter by: quarter, time of day, days (MWF/TR), open seats only, GE area
- Sort by: average GPA (easiest first), professor rating, enrollment, course number

**👩‍🏫 Professor Profiles**
- Search any professor by name
- Profile page shows: overall RMP rating, difficulty, would-take-again %, top tags
- Grade distribution charts for every course they've taught (from Nexus data)
- Grading trend over time (are they getting easier or harder?)
- List of courses they're teaching this quarter with section details
- If logged in: "You had this professor for PSTAT 120A" context badges

**📊 Grade Distributions**
- Search any course → see grade distribution by professor across all available quarters
- Compare professors side-by-side for the same course
- Historical trend: how has the average GPA for this course changed over the years?
- Data source attribution: "Grade data from the Daily Nexus, obtained from the UCSB Office of the Registrar via Public Records Act requests"

**🎓 GE Finder**
- Browse GE requirements by area (A1, A2, B, C, D, E, F, G, WRT, EUR, ETH, QNT)
- For each area: list of courses that satisfy it, sorted by average GPA (easiest first)
- Each course shows: avg GPA, professor rating, typical enrollment, whether it has open seats this quarter
- If logged in: courses that satisfy YOUR remaining GE requirements are highlighted, already-completed areas are grayed out

**📈 Enrollment Trends**
- For any course: historical enrollment by quarter (how popular is it? is it getting harder to get into?)
- Current quarter: real-time enrollment vs. capacity (from UCSB API, refreshed on page load)
- If ACE has fill rate data: "This course typically fills within X hours of pass 1"

#### Data sources for browse mode

All browse mode data comes from the same shared data layer used by build mode:
- Course sections → UCSB Public API (cached in Supabase, refreshed daily during registration)
- Grade distributions → Daily Nexus dataset (pre-loaded in Supabase)
- Professor ratings → RateMyProfessorAPI (cached in Supabase, refreshed weekly)
- GE course lists → Daily Nexus `ges.csv` + UCSB API
- Enrollment → UCSB API (live on page load + historical snapshots)

#### Why this matters strategically

Browse mode serves two purposes:
1. **Acquisition funnel** — Students find ACE by googling "UCSB PSTAT 120A grade distribution" or "easy GE area G UCSB." They land on the course explorer, find it useful, and sign up for the full optimizer.
2. **SEO and traffic** — Every course page, professor page, and GE page is a unique URL that can be indexed. With 3,000+ courses and 3,000+ professors, that's thousands of pages of useful, indexable content. UCSBPlat gets 1.2M page views largely from this effect.

---

### Page 2: 🔐 Auth Screen

Clean, simple authentication page powered by Supabase Auth.

- [Continue with Google] (primary — one click, most students have Google)
- [Sign up with email] (secondary)
- "Already have an account? [Log in]"

After successful auth:
- New users → redirect to Onboarding
- Returning users → redirect to Home Dashboard

---

### Page 3: 📝 Onboarding (First Time Only)

Shown once after first signup. Collects the minimum needed to generate useful schedules. Under 2 minutes.

**Step 1: "What's your major?"**

Dropdown / searchable select:
- Computer Science (B.S.)
- Computer Science (B.A.)
- Data Science (B.S.)
- Statistics & Data Science (B.S.)
- *(More majors coming soon)*

**Step 2: "What year are you?"**

Radio buttons:
- Freshman (1st year)
- Sophomore (2nd year)
- Junior (3rd year)
- Senior (4th year)
- 5th year+

**Step 3: "What have you already taken?"**

Three options — upload Academic History (best), upload Transcript, or manual entry:

**Option A: Upload your Academic History (best — recommended)**
- Drag-and-drop or file picker for a PDF
- "Go to GOLD → Progress → Major Progress Check → Print this Page → Save as PDF → Upload here"
- This is the jackpot. The Academic History contains UCSB's own degree audit — it shows every completed course, every AP credit mapped to specific UCSB equivalents, AND the status of every requirement (GE areas A-G, writing, ethnicity, world cultures, pre-major, upper div major areas). ACE reads all of it.
- Claude API parses the PDF and extracts: courses + grades, AP credit mappings, AND the full requirement satisfaction status (which GEs are done, which major requirements are met, what's still needed)
- Student reviews the extracted data and confirms

**Option B: Upload your Unofficial Transcript (good)**
- "Go to GOLD → Grades → Unofficial Transcript → Print this window → Save as PDF → Upload here"
- Gets all courses + grades + in-progress courses + total transfer units
- Doesn't include AP credit detail or requirement status — ACE will cross-reference against major requirements to compute what's still needed (slightly less accurate than Option A for edge cases)

**Option C: Manual entry (fallback)**
- A searchable checklist of courses for their major, grouped by category (Pre-Major, Upper Division Required, Upper Division Electives, GE). Students check off everything they've completed or are currently enrolled in.

For the Stats & Data Science B.S. major, this would show:
- Pre-Major: CMPSC 8 or 9, MATH 4A, 4B, 6A, PSTAT 10, PSTAT 8 or 120A...
- Upper Division Required: PSTAT 100, 120A, 120B, 126, 127, 130, 131, 160A/160B...
- Upper Division Electives: PSTAT 115, 122, 134, 170, 174, 175, CMPSC 130A, 130B, ECON 140A...
- GE areas: A1, A2, B, C, D, E, EUR, ETH, WRT...

This list is pre-populated from the LLM-extracted major requirement data (see "Major Requirement Extraction Pipeline" below).

**Privacy notice (shown for both upload options):**
"Your document is processed to extract academic data only. We never store the PDF, your name, perm number, or any personal identifiers. The document is read, parsed, and immediately discarded."

How the parser handles edge cases:
- **Courses with no grade yet (in-progress):** Marked as "currently enrolled," not "completed"
- **P/NP courses:** Included in completed list with grade "P" (ACE doesn't need letter grades for optimization — just needs to know you took it)
- **AP/Transfer credits:** Transcript only shows total units (user may need to manually add AP equivalents). Academic History shows the full mapping — AP Calc BC → MATH 3A + 3B, AP Stats → PSTAT 5A, etc.
- **GE requirement status:** Only available from Academic History upload. If user uploads transcript instead, ACE computes GE status from the course list (less reliable for edge cases like courses that count for multiple areas)
- **Instructor name format:** Transcript uses "LASTNAME F M" format (e.g., "DEAN C W") — ACE normalizes this when matching against RMP and grade distribution data

**Step 4: "Set your preferences"**

- ⏰ Earliest class you'll take: slider from 8 AM to 12 PM
- 📅 Preferred schedule pattern: MWF / TR / No preference
- ⚖️ How many units? slider from 12 to 20
- 🎯 Optimization priority: drag-to-rank — Professor Rating, Easy A, Schedule Convenience, Seat Availability (pre-filled with default ranking but adjustable)

**[Let's Go →]** — Redirects to Home Dashboard

---

### Page 4: 🏡 Home Dashboard

The first thing users see after onboarding (and every time they return to the app). This is the central hub with the sidebar visible.

```
┌──────────────┬──────────────────────────────────────────────────┐
│              │                                                   │
│  🎓 ACE     │  Welcome back, Ted! 👋                            │
│              │                                                   │
│  ───────     │  ┌─────────────────────────────────────────────┐  │
│              │  │                                             │  │
│  🏡 Home     │  │  🚀 Build My Schedule                       │  │
│              │  │                                             │  │
│  📚 Courses  │  │  Pull live data from UCSB's course catalog, │  │
│              │  │  grade distributions, and professor ratings  │  │
│  📅 Schedules│  │  — then generate your optimal schedules.    │  │
│              │  │                                             │  │
│  ⚡ Pipeline │  │  Targeting: Fall 2026  •  CS B.S.  •  16 units│
│              │  │                                             │  │
│  ───────     │  │  [Start Building →]                         │  │
│              │  │                                             │  │
│  ⚙️ Settings │  └─────────────────────────────────────────────┘  │
│              │                                                   │
│  ───────     │  ┌──────────────────┐  ┌──────────────────────┐  │
│              │  │ 🗺️ Explore My    │  │ ⚙️ Adjust My         │  │
│  👤 Ted      │  │ Grad Path        │  │ Preferences          │  │
│  CS · 3rd yr │  │                  │  │                      │  │
│              │  │ See your prereq  │  │ Change priorities,   │  │
│              │  │ graph and path   │  │ times, unit load     │  │
│              │  │ to graduation    │  │                      │  │
│              │  └──────────────────┘  └──────────────────────┘  │
│              │                                                   │
│              │  ┌─────────────────────────────────────────────┐  │
│              │  │ 📊 Quick Stats                              │  │
│              │  │ Units completed: 112 / 180                  │  │
│              │  │ Major courses remaining: 7                   │  │
│              │  │ Estimated graduation: Spring 2027            │  │
│              │  └─────────────────────────────────────────────┘  │
│              │                                                   │
└──────────────┴──────────────────────────────────────────────────┘
```

When the user clicks [Start Building →], they're redirected to the Pipeline Status page and the data pipeline immediately begins.

If the user has already generated schedules, the Home Dashboard also shows a "Your Latest Schedules" preview with a link to the full view.

---

### Page 5: ⚡ Pipeline Status (replaces Agent HQ)

**This shows users that real data is being pulled in real time — fast and transparent.**

Instead of browser agent iframes, this page shows a clean progress dashboard as the API calls and data lookups execute. The sidebar shows a pulsing indicator while the pipeline runs:

```
⚡ Pipeline (running) ●
```

#### Layout During Active Build

```
┌──────────────┬──────────────────────────────────────────────────┐
│              │                                                   │
│  🎓 ACE     │  Building your schedule...                        │
│              │                                                   │
│  ───────     │  📋 Catalog  [████████████████████] ✅ Done        │
│              │  ⭐ Profs    [████████████░░░░░░░░] 68%            │
│  🏡 Home     │  📊 Grades   [████████████████████] ✅ Done        │
│              │  🗺️ Prereqs  [████████████████████] ✅ Done        │
│  📅 Schedules│  📈 Fill     [████████░░░░░░░░░░░] 42%            │
│              │  🧮 Optimize [░░░░░░░░░░░░░░░░░░░] Waiting...     │
│ ▶⚡ Pipeline │                                                   │
│   running ●  │  ┌─────────────────────────────────────────────┐  │
│              │  │ 📋 UCSB API — Course Catalog                │  │
│  🗺️ Grad Path│  │ ✅ Found 14 sections across 5 courses        │  │
│              │  │ CMPSC 130A (3 sections), CMPSC 156 (2),     │  │
│  ───────     │  │ PSTAT 120B (3), ENGL 10 (4), CMPSC 162 (2) │  │
│              │  └─────────────────────────────────────────────┘  │
│  ⚙️ Settings │                                                   │
│              │  ┌─────────────────────────────────────────────┐  │
│  ───────     │  │ ⭐ RateMyProfessor — Professor Ratings       │  │
│              │  │ ⏳ Looking up 7 instructors...                │  │
│  👤 Ted      │  │ ✅ Richert Wang — 4.8/5.0, 95% would take   │  │
│  CS · 3rd yr │  │ ✅ Ravat — 4.2/5.0, 78% would take again    │  │
│              │  │ ⏳ Looking up Krintz...                       │  │
│              │  └─────────────────────────────────────────────┘  │
│              │                                                   │
│              │  ┌─────────────────────────────────────────────┐  │
│              │  │ 📊 Daily Nexus — Grade Distributions         │  │
│              │  │ ✅ Matched 12 course×professor distributions  │  │
│              │  │ Data covers Fall 2009 – Fall 2025            │  │
│              │  └─────────────────────────────────────────────┘  │
│              │                                                   │
│              │  Pipeline Log:                                    │
│              │  12:04:32 📋 Querying UCSB API for CMPSC 130A... │
│              │  12:04:33 📋 Found 3 sections for CMPSC 130A     │
│              │  12:04:33 📋 Querying UCSB API for CMPSC 156...  │
│              │  12:04:34 📊 Grade lookup: 156 × Wang → 62% A    │
│              │  12:04:35 ⭐ RMP lookup: Richert Wang → 4.8/5.0  │
│              │                                                   │
└──────────────┴──────────────────────────────────────────────────┘
```

Each data source card expands as results come in, showing what was found in real time via Supabase Realtime subscriptions.

#### Completion State

When the pipeline finishes and the optimizer runs:

```
┌──────────────────────────────────────────────────────────┐
│                                                           │
│  ✅ Your schedules are ready!                             │
│                                                           │
│  14 sections found • 7 professors rated • 12 grade       │
│  distributions matched • optimization complete            │
│  Total time: 8 seconds                                    │
│                                                           │
│  [View My Schedules →]                                    │
│                                                           │
└──────────────────────────────────────────────────────────┘
```

#### Floating Widget (Pipeline Running in Background)

When the pipeline is active but the user navigates to another view:

```
                                     ┌──────────────┐
                                     │⚡ Pipeline    │
                                     │  running...  │
                                     │ [View Status]│
                                     └──────────────┘
```

---

### Page 6: 📅 My Schedules

The main results view. Two sub-views toggled at the top: **List** and **Calendar**.

#### Sub-view: Ranked Schedule List

```
┌──────────────┬──────────────────────────────────────────────────┐
│              │                                                   │
│  🎓 ACE     │  Your Schedules — Fall 2026                       │
│              │  Generated 2 minutes ago  [Rebuild]               │
│  ───────     │                                                   │
│              │  ┌────────────────────────────────────────────┐   │
│  🏡 Home     │  │ 🥇 SCHEDULE A — "The Dream"    92/100     │   │
│              │  │                                            │   │
│ ▶📅 Schedules│  │ Prof: 94  |  Grade: 88  |  Time: 90  |   │   │
│              │  │ Seats: 85                                  │   │
│  ⚡ Pipeline │  │                                            │   │
│              │  │ CMPSC 156  Wang ⭐4.8   62% A  MWF 10:00  │   │
│  🗺️ Grad Path│  │ PSTAT 120B Ravat ⭐4.2  45% A  TR 11:00   │   │
│              │  │ CMPSC 130A Krintz ⭐3.9 38% A  MWF 1:00   │   │
│  ───────     │  │ ENGL 10    Johnson ⭐4.5 71% A  TR 2:00    │   │
│              │  │                                            │   │
│  ⚙️ Settings │  │ 📈 Registration Strategy:                  │   │
│              │  │ 1st: CMPSC 156 (fills ~11 min) ⚠️          │   │
│  ───────     │  │ 2nd: CMPSC 130A (fills Day 1)             │   │
│              │  │ 3rd: PSTAT 120B (fills Day 2)              │   │
│  👤 Ted      │  │ 4th: ENGL 10 (safe — fills in adjustment) │   │
│  CS · 3rd yr │  │                                            │   │
│              │  │ [View Calendar] [Compare Profs] [Select]   │   │
│              │  └────────────────────────────────────────────┘   │
│              │                                                   │
│              │  ┌────────────────────────────────────────────┐   │
│              │  │ 🥈 SCHEDULE B — "The Backup"   84/100     │   │
│              │  │ ...                                        │   │
│              │  └────────────────────────────────────────────┘   │
│              │                                                   │
│              │  ┌────────────────────────────────────────────┐   │
│              │  │ 🥉 SCHEDULE C — "The Safety"   78/100     │   │
│              │  │ ...                                        │   │
│              │  └────────────────────────────────────────────┘   │
│              │                                                   │
└──────────────┴──────────────────────────────────────────────────┘
```

#### Sub-view: Weekly Calendar

When you click [View Calendar] on a schedule card, it expands into a Google Calendar-style weekly grid:

```
┌──────────────┬──────────────────────────────────────────────────┐
│              │                                                   │
│  🎓 ACE     │  🥇 Schedule A    🥈 B    🥉 C        [Back to List]│
│              │                                                   │
│  ───────     │       Mon       Tue       Wed       Thu      Fri  │
│              │  8   │         │         │         │         │    │
│  🏡 Home     │  9   │         │         │         │         │    │
│              │  10  │█████████│         │█████████│         │████│
│ ▶📅 Schedules│      │CMPSC 156│         │CMPSC 156│         │156 │
│              │      │Wang ⭐4.8│         │Wang ⭐4.8│         │    │
│  ⚡ Pipeline │  11  │         │█████████│         │█████████│    │
│              │      │         │PSTAT120B│         │PSTAT120B│    │
│  🗺️ Grad Path│  12  │         │Ravat    │         │Ravat    │    │
│              │  1   │█████████│         │█████████│         │████│
│  ───────     │      │CMPSC130A│         │CMPSC130A│         │130A│
│              │  2   │         │█████████│         │█████████│    │
│  ⚙️ Settings │      │         │ENGL 10  │         │ENGL 10  │    │
│              │  3   │         │Johnson  │         │Johnson  │    │
│  ───────     │                                                   │
│              │  Click any block for professor details + grades    │
│  👤 Ted      │                                                   │
│  CS · 3rd yr │                                                   │
└──────────────┴──────────────────────────────────────────────────┘
```

Each calendar block is color-coded by professor rating (green = great, yellow = okay, red = avoid). Clicking a block opens a detail panel with the professor comparison card and grade distribution chart.

#### Professor Comparison Cards

When you click [Compare Profs] on a schedule card, side-by-side cards for each course:

```
┌─────────── CMPSC 156 ────────────────────────────────────────┐
│                                                               │
│  ┌──────────────────┐         ┌──────────────────┐           │
│  │ Richert Wang     │         │ Ziad Matni       │           │
│  │ ⭐ 4.8 / 5.0     │         │ ⭐ 3.2 / 5.0     │           │
│  │ Difficulty: 2.8  │         │ Difficulty: 3.9  │           │
│  │ Again: 95%       │         │ Again: 42%       │           │
│  │ 📊 62% A's       │         │ 📊 28% A's       │           │
│  │                  │         │                  │           │
│  │ Tags: "Amazing   │         │ Tags: "Harsh     │           │
│  │ teacher", "Clear │         │ grader", "Lots   │           │
│  │ lectures"        │         │ of work"         │           │
│  │                  │         │                  │           │
│  │ MWF 10:00       │         │ TR 3:30          │           │
│  │ Fills: ~11 min  │         │ Fills: Day 2     │           │
│  │                  │         │                  │           │
│  │ [Selected ✓]     │         │ [Select Instead] │           │
│  └──────────────────┘         └──────────────────┘           │
└──────────────────────────────────────────────────────────────┘
```

> **Note on professor data presentation:** Professor ratings from RateMyProfessor are inherently subjective and can carry biases (sample size, gender, race). ACE should present this data transparently — always show the number of ratings, display raw distributions rather than computed "quality" scores where possible, and combine RMP data with objective grade distribution data. Consider requiring a minimum number of RMP ratings before displaying a score, and clearly label it as crowd-sourced student feedback rather than an authoritative quality metric.

#### Grade Distribution Charts

For each course × professor combo, a bar chart:

```
CMPSC 156 — Richert Wang (Fall 2025)

  A  ████████████████████████████████  62%
  B  ████████████████                  24%
  C  ██████                            8%
  D  ██                                3%
  F  ██                                3%

  Avg GPA: 3.42  |  Total: 120 students
  Source: Daily Nexus / Office of the Registrar
```

#### Fill Rate Timeline

For high-demand classes, a visualization of how enrollment historically progresses:

```
CMPSC 156 — Section 0100 (100 seats)

100 ┤                                          ●━━━━━━━━ FULL
    │                                     ●
 80 ┤                                ●
    │                           ●
 60 ┤                      ●
    │                 ●
 40 ┤            ●
    │       ●
 20 ┤  ●
    │●
  0 ┤━━━┯━━━┯━━━┯━━━┯━━━┯━━━┯━━━┯━━━┯━━━┯━━━
    0   1   2   3   4   5   6   8  10  12  hours

    ⚠️ This class typically fills within 11 minutes of Day 1 pass times.
    Register FIRST at your pass time.
```

> **Note:** Fill rate data is self-collected by ACE over time by polling the UCSB API during registration windows. This data improves with each quarter. For the first launch, fill rate estimates will be rougher (based on current enrollment vs. capacity snapshots) and will get more precise as historical data accumulates.

---

### Page 7: 🗺️ Grad Path (Prerequisite Graph)

An interactive force-directed graph (D3.js) showing the student's entire remaining path to graduation.

```
┌──────────────┬──────────────────────────────────────────────────┐
│              │                                                   │
│  🎓 ACE     │  Your Path to Graduation — CS B.S.                │
│              │  112 / 180 units complete  •  Est. Spring 2027    │
│  ───────     │                                                   │
│              │         ┌─────┐                                   │
│  🏡 Home     │    ┌───►│160  │                                   │
│              │    │    │(gray)                                   │
│  📅 Schedules│  ┌─┴───┐└─────┘    ┌─────┐                       │
│              │  │130B │──────────►│170  │                        │
│  ⚡ Pipeline │  │(blue)│          │(gray)│                       │
│              │  └─┬───┘          └─────┘                        │
│ ▶🗺️ Grad Path│  ┌─┴───┐                                         │
│              │  │130A │ ◄── Recommended next quarter (gold)      │
│  ───────     │  │(gold)│                                         │
│              │  └─┬───┘                                          │
│  ⚙️ Settings │  ┌─┴───┐                                          │
│              │  │ 24  │                                          │
│  ───────     │  │(grn) │ ◄── Completed                           │
│              │  └─────┘                                          │
│  👤 Ted      │                                                   │
│  CS · 3rd yr │  Legend:                                           │
│              │  ● Green = Completed                               │
│              │  ● Blue = Available next quarter (prereqs met)     │
│              │  ● Gold outline = Recommended by optimizer          │
│              │  ● Yellow = 1 prereq away                          │
│              │  ● Gray = Locked (prereqs not yet met)             │
│              │                                                   │
│              │  Click any node for details + available professors  │
│              │                                                   │
└──────────────┴──────────────────────────────────────────────────┘
```

Node interactions:
- **Click a node** → shows course description, prerequisites, available professors, grade distributions, and whether the optimizer included it
- **Hover** → highlights all prerequisite chains leading to and from this course
- **Green cluster** → grows as you complete more courses, giving visual progress satisfaction
- **Critical path** highlighted — the longest dependency chain determines your earliest possible graduation

---

### Page 8: ⚙️ Settings / Profile

Where students update their profile, preferences, and completed courses.

**Sections:**
- **Academic Info** — Major, year, completed courses (same UI as onboarding Step 3)
- **Update Courses** — Re-upload transcript or Academic History PDF, or manually add/remove courses. If user originally uploaded an Academic History, show a prompt to re-upload at the start of each quarter to refresh requirement status.
- **Schedule Preferences** — Earliest class, preferred days, target units
- **Optimization Priorities** — Drag-to-rank: Professor Rating, Easy A, Convenience, Seat Availability
- **Account** — Email, password, sign out

Changes take effect on the next schedule build.

---

## Student Onboarding — Detailed

### Authentication

Supabase Auth handles sign up, login, and session management.

### Profile Data Model

```
student_profiles:
  id                      UUID (primary key)
  user_id                 UUID (references auth.users)
  major                   text
  year                    text
  completed_courses       text[]
  in_progress_courses     text[]
  course_grades           jsonb ({"PSTAT 120A": "B", ...})
  cumulative_gpa          float
  transfer_units          int (default 0)
  ap_credits              jsonb ([{exam, ucsb_equivalent[], units, score}])
  requirement_status      jsonb (from Academic History: {ge_area_a1: "OK", upper_div_major: "NEEDS...", ...})
  earliest_class          text (default '09:00')
  preferred_days          text (default 'no_preference')
  target_units            int (default 16)
  priority_weights        jsonb (default professor:0.35, grades:0.30, convenience:0.20, availability:0.15)
  created_at              timestamp
  updated_at              timestamp
```

---

## The Data Pipeline — Detailed

### Setup: UCSB API Registration

Before any of this works, you need a UCSB API key:

1. Go to https://developer.ucsb.edu
2. Register for a developer account
3. Request access to the **Academic Curriculums** API (auto-approved — no waiting)
4. Get your API key from the dashboard

The base URL for all UCSB API calls is `https://api.ucsb.edu/`. Pass your API key in the `ucsb-api-key` header.

> **Rate limits:** The UCSB API allows up to 10,000 requests per minute. More than enough for our use case, but cache aggressively anyway.

---

### Service 1: 📋 Catalog Service

**Source:** UCSB Public API — Academic Curriculums endpoint

**What it does:** Queries the UCSB API for every section of every course the student could take next quarter. Returns structured JSON with section numbers, meeting times, days, locations, instructors, enrollment counts, and enrollment caps.

```python
import httpx
from pydantic import BaseModel

UCSB_API_BASE = "https://api.ucsb.edu/academics/curriculums/v3/classes/search"
UCSB_API_KEY = os.environ["UCSB_API_KEY"]

class Section(BaseModel):
    course: str           # "CMPSC 130A"
    section: str          # "0100"
    instructor: str       # "Richert Wang"
    days: str             # "MWF"
    time_start: str       # "09:00"
    time_end: str         # "09:50"
    location: str         # "Phelps 1260"
    enrolled: int         # 85
    capacity: int         # 100
    waitlist: int         # 0

class CatalogResult(BaseModel):
    quarter: str
    sections: list[Section]

async def fetch_catalog(courses: list[str], quarter: str) -> CatalogResult:
    """
    Query the UCSB API for course sections.
    
    The API returns one quarter at a time, so we query per-subject.
    Example: quarter="20264" for Fall 2026 (YYYYQ format: 1=Winter, 2=Spring, 3=Summer, 4=Fall)
    """
    async with httpx.AsyncClient() as client:
        all_sections = []
        
        # Group courses by subject (e.g., "CMPSC", "PSTAT", "ENGL")
        subjects = group_by_subject(courses)
        
        for subject, course_numbers in subjects.items():
            response = await client.get(
                UCSB_API_BASE,
                params={
                    "quarter": quarter,
                    "subjectCode": subject,
                    "pageNumber": 1,
                    "pageSize": 100,
                },
                headers={
                    "ucsb-api-key": UCSB_API_KEY,
                    "accept": "application/json",
                },
            )
            response.raise_for_status()
            data = response.json()
            
            # Parse the API response into our Section model
            for cls in data.get("classes", []):
                course_id = f"{cls['subjectArea'].strip()} {cls['courseNumber'].strip()}"
                if course_id not in courses:
                    continue
                    
                for section in cls.get("classSections", []):
                    time_loc = section.get("timeLocations", [{}])[0]
                    instructors = section.get("instructors", [])
                    instructor_name = (
                        f"{instructors[0].get('instructor', {}).get('firstName', '')} "
                        f"{instructors[0].get('instructor', {}).get('lastName', '')}"
                    ).strip() if instructors else "TBD"
                    
                    all_sections.append(Section(
                        course=course_id,
                        section=section.get("section", ""),
                        instructor=instructor_name,
                        days=time_loc.get("days", ""),
                        time_start=time_loc.get("beginTime", ""),
                        time_end=time_loc.get("endTime", ""),
                        location=f"{time_loc.get('building', '')} {time_loc.get('room', '')}".strip(),
                        enrolled=section.get("enrolledTotal", 0),
                        capacity=section.get("maxEnroll", 0),
                        waitlist=section.get("waitlisted", 0),
                    ))
        
        # Update pipeline status
        await update_pipeline_status("catalog", "completed", {
            "sections_found": len(all_sections),
            "courses_queried": len(courses),
        })
        
        return CatalogResult(quarter=quarter, sections=all_sections)
```

**Why this is better than scraping GOLD:**
- Returns structured JSON (no HTML parsing, no login required)
- One API call per subject per quarter (vs. navigating page by page)
- Reliable — this is the same data GOLD displays, served by the same backend
- Compliant — auto-approved for student use

---

### Service 2: ⭐ Professor Service

**Source:** RateMyProfessor (via `RateMyProfessorAPI` Python package)

**What it does:** Takes every unique instructor name from the Catalog Service's results and looks them up on RateMyProfessor using the existing Python wrapper that calls RMP's internal GraphQL API.

```python
import ratemyprofessor

# UCSB's school ID on RMP
UCSB = ratemyprofessor.get_school_by_name("University of California Santa Barbara")

class ProfessorProfile(BaseModel):
    name: str
    department: str
    overall_rating: float        # 1.0 - 5.0
    difficulty: float            # 1.0 - 5.0
    would_take_again_pct: float  # 0 - 100
    num_ratings: int
    top_tags: list[str]          # ["Gives good feedback", "Tough grader"]

class ProfessorResults(BaseModel):
    professors: list[ProfessorProfile]
    not_found: list[str]         # Instructors with no RMP profile

async def fetch_professors(instructors: list[str]) -> ProfessorResults:
    """
    Look up each instructor on RateMyProfessor.
    
    Uses the RateMyProfessorAPI package which wraps RMP's GraphQL API.
    No browser automation needed.
    """
    professors = []
    not_found = []
    
    for name in instructors:
        # Update live status
        await update_pipeline_status("professors", "running", {
            "current": name,
            "progress": f"{instructors.index(name) + 1}/{len(instructors)}",
        })
        
        try:
            prof = ratemyprofessor.get_professor_by_school_and_name(UCSB, name)
            
            if prof is None:
                not_found.append(name)
                continue
            
            professors.append(ProfessorProfile(
                name=prof.name,
                department=prof.department,
                overall_rating=prof.rating,
                difficulty=prof.difficulty,
                would_take_again_pct=prof.would_take_again if prof.would_take_again is not None else -1,
                num_ratings=prof.num_ratings,
                top_tags=[],  # Pull from individual ratings if needed
            ))
        except Exception as e:
            not_found.append(name)
            print(f"RMP lookup failed for {name}: {e}")
    
    await update_pipeline_status("professors", "completed", {
        "found": len(professors),
        "not_found": len(not_found),
    })
    
    return ProfessorResults(professors=professors, not_found=not_found)
```

**Why this is better than browser scraping RMP:**
- Direct GraphQL calls — milliseconds per professor instead of seconds
- No browser instances, no CAPTCHAs, no visual rendering overhead
- Well-tested library used by dozens of projects
- Falls back gracefully when a professor isn't found

> **Caveat:** RMP doesn't have an official public API, so this relies on their internal GraphQL endpoint. It could break if RMP changes their frontend. Cache results in Supabase and refresh periodically rather than on every build.

---

### Service 3: 📊 Grade Service

**Source:** Daily Nexus Grade Distribution Dataset (GitHub)

**What it does:** Looks up historical grade distributions for each course × professor combination. The data is pre-loaded into Supabase from the Daily Nexus CSV, so this is a simple database query — no external API calls needed at build time.

#### One-Time Setup: Load Grade Data into Supabase

```python
import pandas as pd
from supabase import create_client

"""
One-time script to load Daily Nexus grade data into Supabase.
Source: https://github.com/dailynexusdata/grades-data
File: courseGrades.csv

Run this quarterly when new data is released.
"""

def load_grade_data():
    # Download from GitHub
    df = pd.read_csv(
        "https://raw.githubusercontent.com/dailynexusdata/grades-data/main/courseGrades.csv"
    )
    
    # The CSV includes columns like:
    # quarter, courseLevel, course, instructor, avgGPA,
    # A, Am, Bp, B, Bm, Cp, C, Cm, Dp, D, F, W, P, NP, etc.
    
    # Compute aggregate letter grade percentages
    for _, row in df.iterrows():
        total_letter = row.get("nLetterStudents", 0)
        if total_letter == 0:
            continue
        
        a_total = row.get("A", 0) + row.get("Am", 0) + row.get("Ap", 0)
        b_total = row.get("Bp", 0) + row.get("B", 0) + row.get("Bm", 0)
        c_total = row.get("Cp", 0) + row.get("C", 0) + row.get("Cm", 0)
        d_total = row.get("Dp", 0) + row.get("D", 0) + row.get("Dm", 0)
        f_total = row.get("F", 0)
        
        supabase.table("grade_distributions").insert({
            "course": f"{row['courseLevel'].strip()} {row['course'].strip()}",
            "professor": row["instructor"].strip(),
            "quarter": row["quarter"],
            "total_students": int(total_letter),
            "a_pct": round(a_total / total_letter * 100, 1),
            "b_pct": round(b_total / total_letter * 100, 1),
            "c_pct": round(c_total / total_letter * 100, 1),
            "d_pct": round(d_total / total_letter * 100, 1),
            "f_pct": round(f_total / total_letter * 100, 1),
            "avg_gpa": row.get("avgGPA", None),
        }).execute()
```

#### At Build Time: Simple Database Query

```python
class GradeDistribution(BaseModel):
    course: str
    professor: str
    quarter: str
    total_students: int
    a_pct: float
    b_pct: float
    c_pct: float
    d_pct: float
    f_pct: float
    avg_gpa: float

class GradeResults(BaseModel):
    distributions: list[GradeDistribution]
    missing: list[str]  # Course×professor combos with no grade data

async def fetch_grades(
    course_professor_pairs: list[tuple[str, str]]
) -> GradeResults:
    """
    Look up grade distributions from pre-loaded Daily Nexus data.
    
    This is a database query, not an API call.
    Returns the most recent distribution for each course×professor pair.
    """
    distributions = []
    missing = []
    
    for course, professor in course_professor_pairs:
        # Query Supabase for the most recent grade distribution
        result = await supabase.table("grade_distributions") \
            .select("*") \
            .eq("course", course) \
            .ilike("professor", f"%{professor.split()[-1]}%") \
            .order("quarter", desc=True) \
            .limit(1) \
            .execute()
        
        if result.data:
            row = result.data[0]
            distributions.append(GradeDistribution(**row))
        else:
            missing.append(f"{course} × {professor}")
    
    await update_pipeline_status("grades", "completed", {
        "matched": len(distributions),
        "missing": len(missing),
    })
    
    return GradeResults(distributions=distributions, missing=missing)
```

**Why this is better than scraping Plat or any grade site:**
- Zero latency — it's a local database query
- 15+ years of data (Fall 2009 – present)
- Official data from the Office of the Registrar via Public Records Act
- Free to reuse, regularly updated by the Daily Nexus
- No scraping fragility, no HTML parsing, no CAPTCHAs

---

### Service 4: 🗺️ Prereq Service — Major Requirement Extraction Pipeline

**Source:** Official UCSB PDF major sheets → Claude API extraction

**What it does:** Extracts the full requirement structure for every supported major by sending official PDF major sheets to the Claude API. This is a one-time-per-year admin pipeline, not a per-user operation.

#### How it works

1. Download official major sheet PDFs from the UCSB General Catalog (https://catalog.ucsb.edu → each department's "Undergraduate Program" tab has PDF links)
2. Send each PDF to the Claude API with a structured extraction prompt
3. Store the extracted JSON in the `major_requirements` table in Supabase
4. Review the output for accuracy before going live with a new major

#### Launch majors (extract these first):
- Computer Science B.S.
- Computer Science B.A.
- Data Science B.S.
- Statistics & Data Science B.S.

#### The extraction script

```python
import anthropic
import base64
from pathlib import Path

client = anthropic.Anthropic()

EXTRACTION_PROMPT = """
You are extracting structured major requirement data from a UCSB major sheet PDF.

Extract ALL courses and organize them into these categories:
- "pre_major" — Preparation for the Major / Lower Division requirements
- "upper_div_required" — Upper Division Required courses
- "upper_div_electives" — Upper Division Electives (list ALL options)
- "capstone" — Senior thesis, capstone, or culminating experience if any
- "support" — Supporting courses outside the department (e.g., Math, Stats prerequisites)
- "ge" — General Education requirements (just list the area codes: A1, A2, B, C, D, E, EUR, ETH, WRT, etc.)

For EACH course, extract:
- course_code: e.g., "PSTAT 120A"
- course_name: e.g., "Probability & Statistics"
- units: integer
- required: true if mandatory, false if it's one of several elective options
- prerequisites: list of course codes that must be completed first
- corequisites: list of course codes that can be taken concurrently
- elective_group: if part of a "choose N from this list" requirement, give the group a name and specify how many must be chosen
- notes: any special conditions (e.g., "C or better required", "may not be taken P/NP")

Return ONLY valid JSON. No markdown, no preamble. Use this exact structure:
{
  "major": "Statistics & Data Science B.S.",
  "major_code": "STSDS",
  "college": "L&S",
  "total_units_required": 180,
  "major_units_required": 76,
  "categories": {
    "pre_major": [ { "course_code": "...", ... } ],
    "upper_div_required": [ ... ],
    "upper_div_electives": { "choose": 3, "from": [ ... ] },
    "support": [ ... ],
    "ge": ["A1", "A2", "B", "C", "D", "E", "EUR", "ETH", "WRT"]
  }
}
"""

async def extract_major_requirements(pdf_path: str) -> dict:
    """
    Send a major sheet PDF to Claude and get structured JSON back.
    Run this once per major per academic year.
    """
    pdf_bytes = Path(pdf_path).read_bytes()
    pdf_b64 = base64.standard_b64encode(pdf_bytes).decode("utf-8")
    
    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=4096,
        messages=[{
            "role": "user",
            "content": [
                {
                    "type": "document",
                    "source": {
                        "type": "base64",
                        "media_type": "application/pdf",
                        "data": pdf_b64,
                    },
                },
                {
                    "type": "text",
                    "text": EXTRACTION_PROMPT,
                },
            ],
        }],
    )
    
    # Parse the JSON response
    import json
    raw_text = response.content[0].text
    major_data = json.loads(raw_text)
    return major_data


async def load_major_to_supabase(major_data: dict):
    """
    Take the extracted JSON and write it to the major_requirements table.
    """
    major = major_data["major"]
    major_code = major_data["major_code"]
    
    # Clear existing data for this major
    await supabase.table("major_requirements") \
        .delete() \
        .eq("major", major_code) \
        .execute()
    
    # Insert all courses across all categories
    for category, courses in major_data["categories"].items():
        if category == "ge":
            # GE areas are stored differently
            for area in courses:
                await supabase.table("major_requirements").insert({
                    "major": major_code,
                    "course": area,
                    "category": "ge",
                    "units": 4,  # Standard GE unit count
                    "required": True,
                    "prerequisites": [],
                    "corequisites": [],
                }).execute()
            continue
        
        # Handle elective groups (choose N from list)
        if isinstance(courses, dict) and "choose" in courses:
            for course in courses["from"]:
                await supabase.table("major_requirements").insert({
                    "major": major_code,
                    "course": course["course_code"],
                    "category": category,
                    "units": course.get("units", 4),
                    "required": False,
                    "prerequisites": course.get("prerequisites", []),
                    "corequisites": course.get("corequisites", []),
                    "elective_group": category,
                    "elective_choose": courses["choose"],
                    "notes": course.get("notes", ""),
                }).execute()
            continue
        
        # Standard required courses
        for course in courses:
            await supabase.table("major_requirements").insert({
                "major": major_code,
                "course": course["course_code"],
                "category": category,
                "units": course.get("units", 4),
                "required": course.get("required", True),
                "prerequisites": course.get("prerequisites", []),
                "corequisites": course.get("corequisites", []),
                "notes": course.get("notes", ""),
            }).execute()


# --- RUN FOR LAUNCH MAJORS ---

async def extract_all_launch_majors():
    """
    One-time script to extract and load the 4 launch majors.
    
    Download these PDFs from the UCSB catalog first:
    - CS B.S.: https://my.sa.ucsb.edu/catalog/Current/Documents/2024_Majors/LS/CS/...
    - CS B.A.: same directory
    - Data Science B.S.: College of Engineering or L&S depending on catalog year
    - Stats & Data Science B.S.: .../PStat/Statistics-Data-Science-BS_2024.pdf
    """
    major_sheets = {
        "cs_bs": "major_sheets/CS-BS.pdf",
        "cs_ba": "major_sheets/CS-BA.pdf",
        "ds_bs": "major_sheets/DataScience-BS.pdf",
        "stsds_bs": "major_sheets/StatsDataScience-BS.pdf",
    }
    
    for name, path in major_sheets.items():
        print(f"Extracting {name}...")
        data = await extract_major_requirements(path)
        
        # Manual review step — print and verify before loading
        print(json.dumps(data, indent=2))
        confirm = input(f"Load {name} to Supabase? (y/n): ")
        if confirm.lower() == "y":
            await load_major_to_supabase(data)
            print(f"✅ {name} loaded")
        else:
            print(f"⏭️ Skipping {name}")
```

#### Expanding to all majors later

To scale to all ~90 UCSB majors:
1. Write a scraper that downloads every major sheet PDF from the UCSB catalog (they're all linked from department pages under "Undergraduate Program")
2. Run each PDF through the same `extract_major_requirements()` function
3. Have a human review pass before pushing to production — LLM extraction is accurate but not perfect, especially for majors with complex conditional logic
4. Re-run annually when new major sheets are published (typically summer before fall quarter)

The total Claude API cost for all ~90 majors would be minimal — roughly $2-5 total.

#### At build time: Simple database query (unchanged)

```python
class PrereqNode(BaseModel):
    course: str
    prerequisites: list[str]
    corequisites: list[str]
    category: str                # "pre_major", "upper_div_required", "upper_div_electives", "support", "ge"
    units: int
    required: bool
    elective_group: str | None
    elective_choose: int | None
    notes: str | None

class MajorRequirements(BaseModel):
    major: str
    total_units_required: int
    courses: list[PrereqNode]

async def fetch_prerequisites(major: str) -> MajorRequirements:
    """
    Load major requirements from Supabase.
    Data was pre-extracted from PDF major sheets via Claude API.
    """
    result = await supabase.table("major_requirements") \
        .select("*") \
        .eq("major", major) \
        .execute()
    
    if not result.data:
        raise ValueError(f"Major '{major}' not found. Supported majors: CS_BS, CS_BA, DS_BS, STSDS_BS")
    
    courses = [PrereqNode(**row) for row in result.data]
    return MajorRequirements(
        major=major,
        total_units_required=180,
        courses=courses,
    )
```

---

### Service 5.5: 📄 GOLD Document Upload Service

**Source:** User-uploaded UCSB documents — either Unofficial Transcript OR Academic History (Major Progress Check) PDF

**What it does:** Parses a student's uploaded GOLD document to automatically populate their completed courses, AP credits, and (if Academic History) their full degree requirement status. Used during onboarding and in Settings.

The Academic History is the premium upload — it gives ACE everything: courses, grades, AP credit mappings, AND the requirement satisfaction map straight from UCSB's own degree audit system. The transcript is the simpler fallback that gives courses + grades but requires ACE to compute requirement status independently.

```python
DOCUMENT_UPLOAD_PROMPT = """
You are parsing a UCSB student document. First, determine what type of document this is:

1. "academic_history" — A Major Progress Check / Academic History from GOLD. Contains degree audit with requirement statuses (OK/No), GE area satisfaction, major progress, AP credit mappings, and course history.
2. "transcript" — An Unofficial Transcript from GOLD. Contains courses, grades, units, and GPA by quarter.

Then extract the following data. IMPORTANT: Do NOT extract the student's name, perm number, or any personal identifiers. Only extract academic data.

Return ONLY valid JSON with this structure:

{
  "document_type": "academic_history" or "transcript",
  
  "completed_courses": [
    { "course_code": "PSTAT 120A", "grade": "B", "quarter": "Fall 2025", "units": 4 }
  ],
  
  "in_progress_courses": [
    { "course_code": "PSTAT 126", "quarter": "Spring 2026", "units": 4 }
  ],
  
  "ap_credits": [
    { "exam": "AP Calculus AB/BC", "ucsb_equivalent": ["MATH 3A", "MATH 3B"], "units": 8, "score": 5 },
    { "exam": "AP Statistics", "ucsb_equivalent": ["PSTAT 5A"], "units": 4, "score": 5 },
    { "exam": "AP English", "ucsb_equivalent": ["AP-ENGL-A1"], "units": 8, "score": 4 },
    { "exam": "AP US History", "ucsb_equivalent": ["AP-AMER"], "units": 8, "score": 5 },
    { "exam": "AP Macroeconomics", "ucsb_equivalent": ["AP-MACECON"], "units": 4, "score": 4 },
    { "exam": "AP Microeconomics", "ucsb_equivalent": ["AP-MICECON"], "units": 4, "score": 4 },
    { "exam": "AP Computer Science Principles", "ucsb_equivalent": ["AP COMP SCI P"], "units": 8, "score": 3 }
  ],
  
  "requirement_status": {
    "ge_area_a1": "OK",
    "ge_area_a2": "OK",
    "ge_area_b": "OK",
    "ge_area_c": "OK",
    "ge_area_d": "OK",
    "ge_area_e": "OK",
    "ge_area_f": "OK",
    "ge_area_g": "NEEDS 1 Course",
    "ge_writing": "NEEDS 1 Course",
    "ge_quantitative": "OK",
    "ge_world_cultures": "OK",
    "ge_ethnicity": "NEEDS 1 Course",
    "entry_level_writing": "OK",
    "american_history": "OK",
    "foreign_language": "OK",
    "pre_major": "OK",
    "preparation_for_major": "OK",
    "upper_div_major": "NEEDS 40.00 units, 3 Areas",
    "upper_div_major_detail": {
      "area_a": "OK — PSTAT 120A, 120B",
      "area_b": "NEEDS 8.00 units — PSTAT 122 and 126 required",
      "area_c": "NEEDS 24.00 units — elective PSTAT courses",
      "area_d": "NEEDS 8.00 units — other PSTAT or specified list"
    },
    "major_gpa": { "overall": 3.26, "upper_div": 3.15 },
    "unit_requirements": {
      "total_needed": 180,
      "total_completed": 116,
      "total_remaining": 64,
      "ud_needed": 60,
      "ud_completed": 16,
      "ud_remaining": 44
    }
  },
  
  "cumulative_gpa": 3.53,
  "transfer_units": 44,
  "total_units": 116
}

NOTES:
- The "requirement_status" section should ONLY be populated if the document is an academic_history. If it's a transcript, set "requirement_status" to null.
- The "ap_credits" section should list specific AP exams and their UCSB equivalents. This is available in detail from the academic_history. From the transcript, AP credits are only shown as a total unit count — set "ap_credits" to [] and just note the total in "transfer_units".
- For requirement statuses, use the exact status from the document: "OK" for completed, or the "NEEDS..." text for incomplete requirements.
"""

async def parse_gold_document(pdf_bytes: bytes) -> dict:
    """
    Send a GOLD document (transcript or academic history) to Claude.
    Auto-detects document type and extracts accordingly.
    
    The raw PDF bytes are NEVER stored — processed in memory only.
    """
    pdf_b64 = base64.standard_b64encode(pdf_bytes).decode("utf-8")
    
    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=4096,  # Academic history is longer, needs more tokens
        messages=[{
            "role": "user",
            "content": [
                {
                    "type": "document",
                    "source": {
                        "type": "base64",
                        "media_type": "application/pdf",
                        "data": pdf_b64,
                    },
                },
                {
                    "type": "text",
                    "text": DOCUMENT_UPLOAD_PROMPT,
                },
            ],
        }],
    )
    
    import json
    return json.loads(response.content[0].text)


# --- FastAPI endpoint ---

from fastapi import UploadFile, File

@app.post("/api/upload/gold-document")
async def upload_gold_document(
    file: UploadFile = File(...),
    user_id: str = Depends(get_current_user)
):
    """
    Upload a GOLD document (transcript OR academic history) → extract data → update profile.
    
    Auto-detects document type. Academic History gives richer data (requirement status,
    AP credit mappings). Transcript gives courses + grades only.
    
    Privacy guarantees:
    - PDF is read into memory, processed, then discarded
    - Never written to disk, object storage, or logs
    - Claude API prompt explicitly instructs: do NOT extract PII
    - Only academic data is saved to the database
    """
    # Read PDF into memory
    pdf_bytes = await file.read()
    
    # Validate it's a PDF
    if not pdf_bytes[:5] == b"%PDF-":
        raise HTTPException(400, "File must be a PDF")
    
    # Extract data via Claude API (auto-detects document type)
    doc_data = await parse_gold_document(pdf_bytes)
    
    # Discard the PDF immediately — do NOT store it
    del pdf_bytes
    
    # Build the update payload
    completed_courses = [c["course_code"] for c in doc_data.get("completed_courses", [])]
    in_progress_courses = [c["course_code"] for c in doc_data.get("in_progress_courses", [])]
    course_grades = {
        c["course_code"]: c["grade"] 
        for c in doc_data.get("completed_courses", []) if c.get("grade")
    }
    
    update_payload = {
        "completed_courses": completed_courses,
        "in_progress_courses": in_progress_courses,
        "course_grades": course_grades,
        "cumulative_gpa": doc_data.get("cumulative_gpa"),
        "transfer_units": doc_data.get("transfer_units", 0),
        "updated_at": datetime.now().isoformat(),
    }
    
    # If academic history, also store AP credits and requirement status
    if doc_data.get("document_type") == "academic_history":
        update_payload["ap_credits"] = doc_data.get("ap_credits", [])
        update_payload["requirement_status"] = doc_data.get("requirement_status")
    
    # Update the student's profile
    await supabase.table("student_profiles") \
        .update(update_payload) \
        .eq("user_id", user_id) \
        .execute()
    
    # Return extracted data for user review
    return {
        "document_type": doc_data.get("document_type"),
        "completed_courses": doc_data["completed_courses"],
        "in_progress_courses": doc_data["in_progress_courses"],
        "ap_credits": doc_data.get("ap_credits", []),
        "requirement_status": doc_data.get("requirement_status"),
        "cumulative_gpa": doc_data.get("cumulative_gpa"),
        "transfer_units": doc_data.get("transfer_units", 0),
        "message": (
            "We detected an Academic History upload — full requirement status imported! "
            "Review your data below and adjust if needed."
            if doc_data.get("document_type") == "academic_history"
            else "Review your courses below. You can manually adjust before saving."
        ),
    }
```

#### Example: Matthew's Academic History extraction

Input: The Academic History PDF (Major Progress Check for STSDS-BS)

Output:
```json
{
  "document_type": "academic_history",
  
  "completed_courses": [
    { "course_code": "CMPSC 8", "grade": "B+", "quarter": "Fall 2024", "units": 4 },
    { "course_code": "HIST 4A", "grade": "P", "quarter": "Fall 2024", "units": 5 },
    { "course_code": "INT W 1", "grade": "P", "quarter": "Fall 2024", "units": 1 },
    { "course_code": "MATH 4A", "grade": "A", "quarter": "Fall 2024", "units": 4 },
    { "course_code": "CMPSC 9", "grade": "B+", "quarter": "Winter 2025", "units": 4 },
    { "course_code": "MATH 4B", "grade": "B+", "quarter": "Winter 2025", "units": 4 },
    { "course_code": "PSTAT 10", "grade": "A-", "quarter": "Winter 2025", "units": 5 },
    { "course_code": "MATH 6A", "grade": "A-", "quarter": "Spring 2025", "units": 4 },
    { "course_code": "MUS 16", "grade": "A", "quarter": "Spring 2025", "units": 5 },
    { "course_code": "PSTAT 8", "grade": "C", "quarter": "Spring 2025", "units": 5 },
    { "course_code": "ECON 1", "grade": "A", "quarter": "Fall 2025", "units": 5 },
    { "course_code": "HIST 46A", "grade": "A", "quarter": "Fall 2025", "units": 5 },
    { "course_code": "PSTAT 120A", "grade": "B", "quarter": "Fall 2025", "units": 4 },
    { "course_code": "ECON 2", "grade": "A-", "quarter": "Winter 2026", "units": 5 },
    { "course_code": "PSTAT 120B", "grade": "B+", "quarter": "Winter 2026", "units": 4 },
    { "course_code": "TMP 124", "grade": "A-", "quarter": "Winter 2026", "units": 4 },
    { "course_code": "WRIT 105C", "grade": "A", "quarter": "Winter 2026", "units": 4 }
  ],
  
  "in_progress_courses": [
    { "course_code": "ECON 10A", "quarter": "Spring 2026", "units": 5 },
    { "course_code": "PSTAT 126", "quarter": "Spring 2026", "units": 4 },
    { "course_code": "PSTAT 100", "quarter": "Spring 2026", "units": 4 }
  ],
  
  "ap_credits": [
    { "exam": "AP Computer Science Principles", "ucsb_equivalent": ["AP COMP SCI P"], "units": 8, "score": 3 },
    { "exam": "AP US History", "ucsb_equivalent": ["AP-AMER"], "units": 8, "score": 5 },
    { "exam": "AP English", "ucsb_equivalent": ["AP-ENGL-A1"], "units": 8, "score": 4 },
    { "exam": "AP Macroeconomics", "ucsb_equivalent": ["AP-MACECON"], "units": 4, "score": 4 },
    { "exam": "AP Microeconomics", "ucsb_equivalent": ["AP-MICECON"], "units": 4, "score": 4 },
    { "exam": "AP Calculus AB/BC", "ucsb_equivalent": ["MATH 3A", "MATH 3B"], "units": 8, "score": 5 },
    { "exam": "AP Statistics", "ucsb_equivalent": ["PSTAT 5A"], "units": 4, "score": 5 }
  ],
  
  "requirement_status": {
    "ge_area_a1": "OK",
    "ge_area_a2": "OK",
    "ge_area_b": "OK",
    "ge_area_c": "OK",
    "ge_area_d": "OK",
    "ge_area_e": "OK",
    "ge_area_f": "OK",
    "ge_area_g": "NEEDS 1 Course",
    "ge_writing": "NEEDS 1 Course",
    "ge_quantitative": "OK",
    "ge_world_cultures": "OK",
    "ge_ethnicity": "NEEDS 1 Course",
    "entry_level_writing": "OK",
    "american_history": "OK",
    "foreign_language": "OK",
    "pre_major": "OK",
    "preparation_for_major": "OK",
    "upper_div_major": "NEEDS 40.00 units, 3 Areas",
    "upper_div_major_detail": {
      "area_a": "OK — PSTAT 120A, 120B completed",
      "area_b": "NEEDS 8.00 units — PSTAT 122 and 126 required",
      "area_c": "NEEDS 24.00 units — elective PSTAT courses required",
      "area_d": "NEEDS 8.00 units — other PSTAT or specified list courses"
    },
    "major_gpa": { "overall": 3.26, "upper_div": 3.15 },
    "unit_requirements": {
      "total_needed": 180,
      "total_completed": 116,
      "total_remaining": 64,
      "ud_needed": 60,
      "ud_completed": 16,
      "ud_remaining": 44
    }
  },
  
  "cumulative_gpa": 3.53,
  "transfer_units": 44,
  "total_units": 116
}
```

**Why the Academic History is so much better than the transcript:**

| Data Point | Transcript | Academic History |
|---|---|---|
| Courses + grades | ✅ | ✅ |
| In-progress courses | ✅ | ✅ |
| AP credit total | ✅ (just total units) | ✅ (every exam + UCSB equivalent + score) |
| GE area status (A-G) | ❌ (ACE must compute) | ✅ (UCSB's own audit: OK/NEEDS) |
| Writing/Ethnicity/WRT status | ❌ | ✅ |
| Pre-major status | ❌ | ✅ |
| Upper div major breakdown | ❌ | ✅ (areas A-D with specific needs) |
| Major GPA | ❌ (only overall GPA) | ✅ (overall + major + UD major GPAs) |
| Unit progress (total/UD) | ✅ (just total) | ✅ (total + UD + remaining) |

With the Academic History, ACE's Grad Path visualization can show requirement status that comes directly from UCSB's degree audit — not from ACE's own best-guess computation. This is significantly more reliable, especially for edge cases like AP courses satisfying multiple requirements, courses counting for both GE and major, or courses taken P/NP.

---

### Service 5: 📈 Fill Rate Service

**Source:** Self-collected enrollment snapshots (via UCSB API polling)

**What it does:** Estimates how quickly sections fill up during registration by analyzing historical enrollment data that ACE collects over time.

```python
class FillRateData(BaseModel):
    course: str
    section: str
    historical_fill_time_hours: float | None  # None if not enough data yet
    fills_day_1: bool | None
    typical_waitlist_size: int | None
    recommendation: str           # "Register immediately" / "Safe to wait" / "No data yet"

class FillRateResults(BaseModel):
    fill_rates: list[FillRateData]

async def estimate_fill_rates(sections: list[Section]) -> FillRateResults:
    """
    Estimate fill rates from self-collected enrollment snapshots.
    
    ACE runs a cron job that polls the UCSB API every 30 minutes during 
    registration windows, storing enrollment snapshots in the 
    enrollment_snapshots table. Over time, this builds a dataset of 
    how quickly each course/professor combo fills up.
    
    For courses with no historical data yet, fall back to a simple
    heuristic based on current enrollment vs. capacity.
    """
    fill_rates = []
    
    for section in sections:
        # Check historical snapshots
        history = await supabase.table("enrollment_snapshots") \
            .select("*") \
            .eq("course", section.course) \
            .ilike("instructor", f"%{section.instructor.split()[-1]}%") \
            .order("snapshot_at", desc=True) \
            .execute()
        
        if history.data and len(history.data) >= 5:
            # Calculate fill rate from historical snapshots
            fill_data = compute_fill_rate(history.data)
            fill_rates.append(fill_data)
        else:
            # Fallback: heuristic based on current enrollment ratio
            ratio = section.enrolled / max(section.capacity, 1)
            fill_rates.append(FillRateData(
                course=section.course,
                section=section.section,
                historical_fill_time_hours=None,
                fills_day_1=None,
                typical_waitlist_size=None,
                recommendation=(
                    "Register early — already filling up"
                    if ratio > 0.5 else
                    "Likely safe to wait"
                    if ratio < 0.2 else
                    "No historical data yet"
                ),
            ))
    
    return FillRateResults(fill_rates=fill_rates)


# --- CRON JOB: Run every 30 min during registration windows ---

async def snapshot_enrollment():
    """
    Polls the UCSB API for current enrollment numbers and stores snapshots.
    
    Run this as a cron job on Railway/Fly.io.
    Schedule: Every 30 minutes during registration windows.
    
    Over 2-3 quarters, this builds enough data for accurate fill rate predictions.
    """
    # Get all tracked courses for the current quarter
    tracked = await supabase.table("tracked_courses").select("*").execute()
    
    for course_info in tracked.data:
        sections = await fetch_catalog([course_info["course"]], current_quarter())
        for section in sections.sections:
            await supabase.table("enrollment_snapshots").insert({
                "course": section.course,
                "section": section.section,
                "instructor": section.instructor,
                "enrolled": section.enrolled,
                "capacity": section.capacity,
                "waitlist": section.waitlist,
                "snapshot_at": datetime.now().isoformat(),
            }).execute()
```

**The honest truth about fill rate data:** No public dataset of enrollment velocity exists for UCSB. You have to build it yourself. The good news: the UCSB API gives you current enrollment numbers for free, so you just need a cron job that polls every 30 minutes during registration and stores the results. After 2-3 quarters, you'll have solid fill rate predictions. For launch, use the simple heuristic above — it's better than nothing.

---

### The Optimizer Engine (No External API — Pure Computation)

```python
class ScheduleOption(BaseModel):
    rank: int
    overall_score: float
    professor_score: float
    grade_score: float
    convenience_score: float
    availability_score: float
    sections: list[ScoredSection]
    registration_order: list[str]
    warnings: list[str]

class ScoredSection(BaseModel):
    course: str
    section: str
    instructor: str
    days: str
    time_start: str
    time_end: str
    location: str
    professor_rating: float
    expected_a_rate: float
    fill_risk: str

def optimize_schedules(
    sections: list[Section],
    professors: list[ProfessorProfile],
    grades: list[GradeDistribution],
    fill_rates: list[FillRateData],
    preferences: UserPreferences,
    completed_courses: list[str],
    prereqs: MajorRequirements
) -> list[ScheduleOption]:
    """
    Multi-objective optimization:
    1. Filter to only courses where prereqs are met
    2. Score each section on all 4 dimensions
    3. Generate all valid (conflict-free) schedule combinations
    4. Rank by weighted composite score using user's priority weights
    5. Return top 3-5 options with registration strategies
    """

    weights = {
        "professor": preferences.weights["professor"],
        "grades": preferences.weights["grades"],
        "convenience": preferences.weights["convenience"],
        "availability": preferences.weights["availability"]
    }

    # Score each individual section
    scored_sections = []
    for section in sections:
        prof = find_professor(section.instructor, professors)
        grade = find_grade_dist(section.course, section.instructor, grades)
        fill = find_fill_rate(section.course, section.section, fill_rates)

        prof_score = (prof.overall_rating / 5.0) * 100 if prof else 50
        grade_score = grade.a_pct if grade else 50
        convenience_score = compute_convenience(
            section, preferences.earliest_class, preferences.preferred_days
        )
        availability_score = 100 - (fill.historical_fill_time_hours * 2) if fill and fill.historical_fill_time_hours else 50

        composite = (
            weights["professor"] * prof_score +
            weights["grades"] * grade_score +
            weights["convenience"] * convenience_score +
            weights["availability"] * availability_score
        )

        scored_sections.append(ScoredSection(
            **section.dict(),
            professor_rating=prof.overall_rating if prof else 0,
            expected_a_rate=grade.a_pct if grade else 0,
            fill_risk=fill.recommendation if fill else "unknown",
            score=composite
        ))

    # Generate conflict-free combinations
    valid_schedules = generate_conflict_free_combos(
        scored_sections,
        target_units=preferences.target_units,
        prereqs=prereqs,
        completed=completed_courses
    )

    valid_schedules.sort(key=lambda s: s.overall_score, reverse=True)

    for schedule in valid_schedules[:5]:
        schedule.registration_order = compute_registration_order(
            schedule.sections, fill_rates
        )

    return valid_schedules[:5]


def compute_registration_order(
    sections: list[ScoredSection],
    fill_rates: list[FillRateData]
) -> list[str]:
    """Sort sections by fill rate urgency — register fastest-filling first."""
    section_urgency = []
    for s in sections:
        fill = find_fill_rate(s.course, s.section, fill_rates)
        urgency = fill.historical_fill_time_hours if fill and fill.historical_fill_time_hours else 999
        section_urgency.append((s.course + " " + s.section, urgency))

    section_urgency.sort(key=lambda x: x[1])
    return [s[0] for s in section_urgency]
```

---

### The Orchestrator

```python
async def build_schedule(user: StudentProfile):
    """Main pipeline — triggered when user clicks 'Build My Schedule'"""

    # Step 0: Determine what courses the student needs
    prereqs = await fetch_prerequisites(user.major)
    needed_courses = compute_needed_courses(
        prereqs, user.completed_courses, user.year
    )
    
    await update_pipeline_status("prereqs", "completed", {
        "courses_needed": len(needed_courses),
    })

    # Step 1: Fetch catalog from UCSB API (need this first for instructor names)
    catalog = await fetch_catalog(needed_courses, current_quarter())

    # Step 2: Dispatch remaining data fetches IN PARALLEL
    unique_instructors = list(set(s.instructor for s in catalog.sections if s.instructor != "TBD"))
    course_prof_pairs = [
        (s.course, s.instructor) for s in catalog.sections if s.instructor != "TBD"
    ]

    professors, grades, fill_rates = await asyncio.gather(
        fetch_professors(unique_instructors),
        fetch_grades(course_prof_pairs),
        estimate_fill_rates(catalog.sections)
    )

    # Step 3: Run the optimizer
    await update_pipeline_status("optimizer", "running")
    
    schedules = optimize_schedules(
        sections=catalog.sections,
        professors=professors.professors,
        grades=grades.distributions,
        fill_rates=fill_rates.fill_rates,
        preferences=user.preferences,
        completed_courses=user.completed_courses,
        prereqs=prereqs
    )
    
    await update_pipeline_status("optimizer", "completed", {
        "schedules_generated": len(schedules),
    })

    # Step 4: Store results
    await supabase.table("schedule_results").insert({
        "user_id": user.id,
        "schedules": [s.model_dump() for s in schedules],
        "generated_at": datetime.now().isoformat()
    }).execute()

    return schedules


async def update_pipeline_status(service: str, status: str, details: dict = None):
    """Update the pipeline_status table — frontend subscribes via Supabase Realtime."""
    await supabase.table("pipeline_status").upsert({
        "service": service,
        "status": status,
        "details": details or {},
        "updated_at": datetime.now().isoformat(),
    }).execute()
```

---

## Database Schema (Supabase)

```sql
-- ============================================================
-- USER TABLES
-- ============================================================

CREATE TABLE student_profiles (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID REFERENCES auth.users(id) UNIQUE,
    major               TEXT NOT NULL,
    year                TEXT NOT NULL,
    completed_courses   TEXT[] DEFAULT '{}',
    in_progress_courses TEXT[] DEFAULT '{}',
    course_grades       JSONB DEFAULT '{}',     -- {"PSTAT 120A": "B", "CMPSC 8": "B+"}
    cumulative_gpa      FLOAT,
    transfer_units      INT DEFAULT 0,
    ap_credits          JSONB DEFAULT '[]',     -- [{exam, ucsb_equivalent[], units, score}]
    requirement_status  JSONB,                  -- From Academic History upload: {ge_area_a1: "OK", ...}
    earliest_class      TEXT DEFAULT '09:00',
    preferred_days      TEXT DEFAULT 'no_preference',
    target_units        INT DEFAULT 16,
    priority_weights    JSONB DEFAULT '{
        "professor": 0.35,
        "grades": 0.30,
        "convenience": 0.20,
        "availability": 0.15
    }',
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- DATA TABLES (from APIs and static datasets)
-- ============================================================

CREATE TABLE course_sections (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    quarter         TEXT NOT NULL,
    course          TEXT NOT NULL,
    section         TEXT NOT NULL,
    instructor      TEXT,
    days            TEXT,
    time_start      TEXT,
    time_end        TEXT,
    location        TEXT,
    enrolled        INT DEFAULT 0,
    capacity        INT DEFAULT 0,
    waitlist        INT DEFAULT 0,
    fetched_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE professor_ratings (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                TEXT NOT NULL,
    department          TEXT,
    overall_rating      FLOAT,
    difficulty          FLOAT,
    would_take_again    FLOAT,
    num_ratings         INT,
    top_tags            TEXT[],
    fetched_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE grade_distributions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course          TEXT NOT NULL,
    professor       TEXT NOT NULL,
    quarter         TEXT,
    total_students  INT,
    a_pct           FLOAT,
    b_pct           FLOAT,
    c_pct           FLOAT,
    d_pct           FLOAT,
    f_pct           FLOAT,
    avg_gpa         FLOAT,
    loaded_at       TIMESTAMPTZ DEFAULT NOW()
);

-- NEW: Self-collected enrollment snapshots for fill rate tracking
CREATE TABLE enrollment_snapshots (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course          TEXT NOT NULL,
    section         TEXT,
    instructor      TEXT,
    enrolled        INT NOT NULL,
    capacity        INT NOT NULL,
    waitlist        INT DEFAULT 0,
    snapshot_at     TIMESTAMPTZ DEFAULT NOW()
);

-- NEW: Courses to track during registration windows
CREATE TABLE tracked_courses (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course          TEXT NOT NULL,
    quarter         TEXT NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE fill_rates (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course                      TEXT NOT NULL,
    section                     TEXT,
    historical_fill_time_hours  FLOAT,
    fills_day_1                 BOOLEAN,
    typical_waitlist_size       INT,
    recommendation              TEXT,
    computed_at                 TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE major_requirements (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    major           TEXT NOT NULL,          -- Major code: "STSDS", "CMPSCI_BS", etc.
    course          TEXT NOT NULL,          -- Course code: "PSTAT 120A" or GE area: "A1"
    prerequisites   TEXT[] DEFAULT '{}',
    corequisites    TEXT[] DEFAULT '{}',
    category        TEXT NOT NULL,          -- "pre_major", "upper_div_required", "upper_div_electives", "support", "capstone", "ge"
    units           INT DEFAULT 4,
    required        BOOLEAN DEFAULT TRUE,
    elective_group  TEXT,                   -- Groups electives: "upper_div_electives", "applied_electives", etc.
    elective_choose INT,                    -- How many to pick from this group: e.g., 3
    notes           TEXT,                   -- "C or better required", "may not be taken P/NP"
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- RESULTS TABLES
-- ============================================================

CREATE TABLE schedule_results (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID REFERENCES auth.users(id),
    schedules       JSONB NOT NULL,
    raw_data        JSONB,
    selected_index  INT,
    generated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Pipeline status (powers the Pipeline Status page via Realtime)
CREATE TABLE pipeline_status (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID REFERENCES auth.users(id),
    service         TEXT NOT NULL,
    status          TEXT DEFAULT 'pending',
    details         JSONB,
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, service)
);

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX idx_sections_quarter ON course_sections(quarter, course);
CREATE INDEX idx_professors_name ON professor_ratings(name);
CREATE INDEX idx_grades_course_prof ON grade_distributions(course, professor);
CREATE INDEX idx_requirements_major ON major_requirements(major);
CREATE INDEX idx_pipeline_user ON pipeline_status(user_id);
CREATE INDEX idx_schedule_results_user ON schedule_results(user_id, generated_at DESC);
CREATE INDEX idx_snapshots_course ON enrollment_snapshots(course, section, snapshot_at DESC);

-- ============================================================
-- ENABLE REAL-TIME SUBSCRIPTIONS
-- ============================================================
-- pipeline_status → powers Pipeline Status page progress bars
-- schedule_results → notifies frontend when schedules are ready
```

---

## Tech Stack

| Component | Technology |
|---|---|
| Authentication | Supabase Auth (email + Google OAuth) |
| Course data | UCSB Public API (Academic Curriculums, auto-approved) |
| Professor ratings | RateMyProfessorAPI (Python package, wraps RMP GraphQL) |
| Grade distributions | Daily Nexus dataset (CSV → Supabase import) |
| Fill rate tracking | Self-collected via UCSB API polling (cron job) |
| Major requirements | Claude API extraction from PDF major sheets (one-time per major per year) |
| Transcript / Academic History parsing | Claude API extraction from uploaded GOLD PDFs (per user, auto-detects doc type, never stored) |
| Schedule optimizer | Python (pandas, numpy, itertools, constraint solver) |
| Database | Supabase (Postgres + real-time subscriptions) |
| Frontend framework | React |
| Prerequisite graph | D3.js (force-directed graph) |
| Grade charts | Recharts |
| Calendar component | React Big Calendar or FullCalendar |
| Landing page | Same React app, public route |
| Backend hosting | Railway or Fly.io |
| Frontend hosting | Vercel |

---

## Presentation Flow (10 Minutes)

### 1. The Problem (1 min)
"Every quarter, UCSB students spend hours manually cross-referencing GOLD, RateMyProfessor, and grade distributions to build a schedule. And even after all that, they're still guessing about which classes they can actually get into. I automated the entire process."

### 2. The Data Story (1 min)
"ACE has two modes. Browse mode is a public course catalog — think UCSBPlat but with richer data. Every course, every professor, 15 years of grade distributions from the Daily Nexus, enrollment trends, and a GE finder that shows you the easiest way to knock out your requirements. No login needed. Then Build mode is where it gets personal."

### 3. Live Demo — Trigger the Pipeline (1 min)
Open ACE. Show the onboarding flow: upload a transcript PDF, watch it auto-populate all completed courses in 2 seconds. Select CS major profile. Click "Build My Schedule." Show the Pipeline Status page as data loads.

### 4. Pipeline Status — Clean and Fast (2 min)
Show the progress bars updating in real time. "The UCSB API just returned 14 sections in 2 seconds. Grade distributions matched instantly from our database. RateMyProfessor is returning professor ratings one by one." Progress bar hits 100%. Click through to results.

### 5. The Results (2 min)
Click through to My Schedules. Show the ranked list. "Schedule A is the dream — best professors, highest A rates, times that work for me." Click into the calendar view. Show the professor comparison cards side-by-side. Show a grade distribution chart. Show the fill rate timeline.

"And here's my registration strategy — register for CMPSC 156 first because it fills in 11 minutes, save ENGL 10 for last because it doesn't fill until adjustment period."

### 6. Grad Path (1 min)
Switch to the prerequisite graph. "This is my entire remaining path to graduation. Green is completed, blue is what I can take next quarter. The optimizer recommended these gold-outlined courses because they unlock the most options for future quarters."

### 7. The Data Science (1 min)
"Behind the scenes, this is a multi-objective optimization problem with constraint satisfaction. The scoring engine weighs professor ratings, historical grade distributions, time preferences, and fill-rate predictions — all personalized to your priority ranking."

### 8. Close (1 min)
"ACE is two things: the best course catalog at UCSB — every course, every professor, 15 years of grade data, all free and public — and a personal schedule optimizer that turns a 3-hour registration ritual into a 30-second upload. Starting with CS and Data Science, every UCSB major coming soon. Powered by the Daily Nexus grade distribution dataset."
