# ACE frontend

React 19 + Vite + TypeScript + Motion. No component library — just CSS variables and one handwritten design system.

## Dev

```bash
cd frontend
npm install

# .env or inline:
VITE_SUPABASE_URL=https://<project>.supabase.co \
VITE_SUPABASE_ANON_KEY=<anon-key> \
VITE_API_BASE=http://localhost:8000 \
npm run dev
```

Dev server runs on `http://localhost:5173`. The backend API is proxied implicitly via `VITE_API_BASE`.

## Build

```bash
npm run build
```

Outputs to `frontend/dist/`. CI gates merges on a clean typecheck + build.

## Pages

| Route | File | What it does |
|---|---|---|
| `/` | `pages/Landing.tsx` | Hero, feature strip, "try demo" and "sign in" CTAs |
| `/auth` | `pages/Auth.tsx` | Supabase magic-link sign-in |
| `/onboarding` | `pages/Onboarding.tsx` | PDF upload (Academic History) + major picker |
| `/dashboard` | `pages/Dashboard.tsx` | GPA, units, major progress, requirement status, grade dist |
| `/explorer` | `pages/Explorer.tsx` | Catalog search over the live quarter + grade history |
| `/schedule` | `pages/Schedule.tsx` | Preference-weighted optimizer, ranked schedules, swap UI |
| `/gradpath` | `pages/GradPath.tsx` | Major requirement graph, quarter-by-quarter projection |
| `/settings` | `pages/Settings.tsx` | Re-upload transcript, change majors, toggle demo mode |
| `/status` | `pages/Status.tsx` | Data freshness, model version, API health |

## Design system

All tokens live in `src/index.css` as CSS variables.

- Palette: warm sand `--color-accent` over a near-black surface, deliberately monochrome rather than rainbow-analytics.
- Typography: custom stack, no generic Inter / Roboto.
- Motion: `motion/react` for page-level entrances and stateful micro-interactions. No dependency on large animation libraries.

## PDF parser

`src/lib/pdf-parser.ts` reads the UCSB Academic History PDF (via `pdfjs-dist`) and extracts: completed courses, in-progress courses, grades, AP credits, transfer units, and the requirement status block. Deterministic regex + a small state machine — no LLM in this path.

## Synthetic students

`public/synthetic_students.json` (50 students) powers demo mode. See `src/lib/profile.ts::applySyntheticStudent`.

## Gotchas

- `pdf.worker.min.mjs` is bundled by Vite — it's the big chunk in the build output.
- `frontend/public/ocean.mp4` is a symlink to `../../video/ocean.mp4` at the repo root so the 40 MB asset doesn't bloat `git log`.
