/**
 * Target for VimaLoader fly-to animation (`data-gsap-intro="intro-logo-mark"`).
 * Same compound path as the loader’s final morph (VIMA hex mark).
 */
const SQRT3_2 = 0.8660254037844387

function hexPathPointy(cx: number, cy: number, r: number): string {
  const dx = r * SQRT3_2
  const dy = r * 0.5
  return [
    `M ${cx} ${cy - r}`,
    `L ${cx + dx} ${cy - dy}`,
    `L ${cx + dx} ${cy + dy}`,
    `L ${cx} ${cy + r}`,
    `L ${cx - dx} ${cy + dy}`,
    `L ${cx - dx} ${cy - dy}`,
    'Z',
  ].join(' ')
}

function hexPathRotated(cx: number, cy: number, r: number, rotDeg: number): string {
  const phi = (rotDeg * Math.PI) / 180
  const cosP = Math.cos(phi)
  const sinP = Math.sin(phi)
  const base: Array<[number, number]> = [
    [0, -r],
    [r * SQRT3_2, -r * 0.5],
    [r * SQRT3_2, r * 0.5],
    [0, r],
    [-r * SQRT3_2, r * 0.5],
    [-r * SQRT3_2, -r * 0.5],
  ]
  const pts = base.map(([x, y]) => [cx + x * cosP - y * sinP, cy + x * sinP + y * cosP])
  return `M ${pts[0][0]} ${pts[0][1]} ${pts.slice(1).map(([x, y]) => `L ${x} ${y}`).join(' ')} Z`
}

const LOGO_D = `${hexPathPointy(12, 12, 9.75)} ${hexPathRotated(12, 12, 4.5, 30)}`

export function HeroIntroMark() {
  return (
    <div className="ace-wordmark-logo" data-gsap-intro="intro-logo-mark" aria-hidden>
      <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <radialGradient id="ace-hero-mark-fill" cx="30%" cy="18%" r="82%">
            <stop offset="0%" stopColor="#fff7f9" stopOpacity="0.64" />
            <stop offset="42%" stopColor="#f2a7b8" stopOpacity="0.24" />
            <stop offset="100%" stopColor="#3b1420" stopOpacity="0.56" />
          </radialGradient>
          <linearGradient id="ace-hero-mark-stroke" x1="2" y1="1.5" x2="22" y2="22.5">
            <stop offset="0%" stopColor="#fff7f9" stopOpacity="0.98" />
            <stop offset="46%" stopColor="#f2a7b8" stopOpacity="0.72" />
            <stop offset="100%" stopColor="#7f334e" stopOpacity="0.86" />
          </linearGradient>
        </defs>
        <path
          d={LOGO_D}
          fill="url(#ace-hero-mark-fill)"
          fillRule="evenodd"
          stroke="url(#ace-hero-mark-stroke)"
          strokeWidth="2.2"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  )
}
