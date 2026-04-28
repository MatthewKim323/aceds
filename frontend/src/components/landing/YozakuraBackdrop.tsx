/**
 * Ported from philip-chen6/vima YozakuraBackground (CC / same repo terms as upstream).
 * Full-bleed loop: vima-yozakura-loop.{mp4,webm} + poster + cherry-blossom SVG layers.
 * Pauses until intro loader releases (matches VIMA handoff).
 * @see https://github.com/philip-chen6/vima
 */
import { useEffect, useId, useRef } from 'react'

const PROGRAMMATIC_SCROLL_START = 'vima-programmatic-scroll:start'
const PROGRAMMATIC_SCROLL_END = 'vima-programmatic-scroll:end'
const LOADER_RELEASE_EVENT = 'vima-loader-release'

const CONTOURS = [
  'M 982 156 C 1118 116 1288 160 1370 260 C 1458 368 1408 512 1286 584 C 1136 674 932 640 836 520 C 740 400 802 208 982 156 Z',
  'M 1004 206 C 1120 178 1254 210 1318 288 C 1386 370 1348 486 1248 542 C 1128 610 962 584 888 490 C 814 396 858 244 1004 206 Z',
  'M 1026 256 C 1122 232 1220 260 1268 320 C 1320 386 1290 468 1210 514 C 1114 568 990 548 932 474 C 876 402 904 288 1026 256 Z',
  'M 1056 306 C 1124 292 1186 308 1222 354 C 1260 402 1236 458 1176 490 C 1106 528 1016 510 974 458 C 934 406 958 326 1056 306 Z',
  'M 1082 350 C 1132 340 1170 354 1194 384 C 1220 416 1202 454 1160 476 C 1110 500 1048 490 1018 452 C 990 416 1014 364 1082 350 Z',
  'M 1110 390 C 1140 384 1164 392 1178 410 C 1194 430 1182 454 1156 466 C 1126 482 1088 474 1070 452 C 1052 430 1068 398 1110 390 Z',
]

const BRANCHES = [
  'M 1092 112 C 1046 196 1028 288 1002 374 C 980 448 936 518 862 584',
  'M 1238 180 C 1178 246 1142 322 1114 414 C 1090 492 1042 562 956 636',
  'M 1378 280 C 1264 296 1186 336 1114 414',
  'M 1300 552 C 1200 512 1132 476 1064 426',
]

export function YozakuraBackdrop() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const reactId = useId().replace(/:/g, '')
  const washId = `sumi-wash-${reactId}`
  const softId = `soft-wash-${reactId}`
  const glowId = `line-glow-${reactId}`

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    let inViewport = true
    let programmaticScroll = document.documentElement.getAttribute('data-programmatic-scroll') === 'true'
    let documentVisible = !document.hidden
    let loaderReleased =
      (window as Window & { __vimaLoaderReleased?: boolean }).__vimaLoaderReleased === true ||
      document.documentElement.getAttribute('data-vima-loader-reveal') === 'true'

    const syncPlayback = () => {
      if (inViewport && documentVisible && !programmaticScroll && loaderReleased) {
        void video.play().catch(() => {})
      } else {
        video.pause()
      }
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        inViewport = Boolean(entry?.isIntersecting)
        syncPlayback()
      },
      { rootMargin: '180px 0px', threshold: 0 },
    )

    observer.observe(video)

    const onProgrammaticScrollStart = () => {
      programmaticScroll = true
      syncPlayback()
    }
    const onProgrammaticScrollEnd = () => {
      programmaticScroll = false
      syncPlayback()
    }
    const onVisibilityChange = () => {
      documentVisible = !document.hidden
      syncPlayback()
    }
    const onLoaderRelease = (event: Event) => {
      loaderReleased = true
      const videoTime = (event as CustomEvent<{ videoTime?: number }>).detail?.videoTime
      const syncReleaseFrame = () => {
        if (typeof videoTime === 'number' && Number.isFinite(videoTime)) {
          const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : undefined
          video.currentTime = duration ? videoTime % duration : videoTime
        }

        syncPlayback()
      }

      if (video.readyState >= 1) {
        syncReleaseFrame()
      } else {
        video.addEventListener('loadedmetadata', syncReleaseFrame, { once: true })
      }
    }

    window.addEventListener(PROGRAMMATIC_SCROLL_START, onProgrammaticScrollStart)
    window.addEventListener(PROGRAMMATIC_SCROLL_END, onProgrammaticScrollEnd)
    window.addEventListener(LOADER_RELEASE_EVENT, onLoaderRelease)
    document.addEventListener('visibilitychange', onVisibilityChange)
    syncPlayback()

    return () => {
      observer.disconnect()
      window.removeEventListener(PROGRAMMATIC_SCROLL_START, onProgrammaticScrollStart)
      window.removeEventListener(PROGRAMMATIC_SCROLL_END, onProgrammaticScrollEnd)
      window.removeEventListener(LOADER_RELEASE_EVENT, onLoaderRelease)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [])

  return (
    <div
      aria-hidden
      data-landing-backdrop-stage
      data-gsap-bg
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        pointerEvents: 'none',
        background:
          'radial-gradient(circle at 34% 43%, rgba(242,167,184,0.13), transparent 28%), radial-gradient(ellipse at 70% 43%, rgba(166,77,121,0.22), transparent 46%), linear-gradient(115deg, #080503 0%, #120811 50%, #070403 100%)',
      }}
    >
      <video
        ref={videoRef}
        loop
        muted
        playsInline
        poster="/vima/vima-yozakura-poster.jpg"
        preload="metadata"
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          objectPosition: 'center top',
          opacity: 0.88,
          filter: 'brightness(0.92) saturate(0.94)',
        }}
      >
        <source src="/vima/vima-yozakura-loop.mp4" type="video/mp4" />
        <source src="/vima/vima-yozakura-loop.webm" type="video/webm" />
      </video>

      <svg
        viewBox="0 0 1440 900"
        preserveAspectRatio="xMidYMid slice"
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          opacity: 0.1,
        }}
      >
        <defs>
          <radialGradient id={washId} cx="68%" cy="44%" r="44%">
            <stop offset="0%" stopColor="#f2a7b8" stopOpacity="0.22" />
            <stop offset="42%" stopColor="#a64d79" stopOpacity="0.15" />
            <stop offset="100%" stopColor="#3b1c32" stopOpacity="0" />
          </radialGradient>
          <filter id={softId} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="34" />
          </filter>
          <filter id={glowId} x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="1.2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <path
          d="M 816 130 C 992 16 1278 74 1400 254 C 1512 420 1398 666 1164 752 C 934 836 680 738 620 558 C 562 382 658 232 816 130 Z"
          fill={`url(#${washId})`}
          filter={`url(#${softId})`}
        />

        <g
          fill="none"
          stroke="#f2a7b8"
          strokeWidth="1"
          strokeLinecap="round"
          strokeLinejoin="round"
          filter={`url(#${glowId})`}
        >
          {CONTOURS.map((d, index) => (
            <path
              key={d}
              d={d}
              opacity={0.18 - index * 0.018}
              strokeDasharray={index % 2 === 0 ? '1 10' : '34 18'}
            />
          ))}
        </g>

        <g fill="none" stroke="#261019" strokeWidth="3" strokeLinecap="round" opacity="0.36">
          {BRANCHES.map((d) => (
            <path key={d} d={d} />
          ))}
        </g>

        <g fill="#f7ecef" opacity="0.22">
          <circle cx="1090" cy="244" r="2.2" />
          <circle cx="1176" cy="302" r="1.6" />
          <circle cx="1238" cy="438" r="2.4" />
          <circle cx="1044" cy="500" r="1.7" />
          <circle cx="1302" cy="372" r="1.4" />
        </g>
      </svg>

      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'linear-gradient(90deg, rgba(8,5,3,0.42) 0%, rgba(8,5,3,0.10) 40%, rgba(8,5,3,0.10) 60%, rgba(8,5,3,0.42) 100%), radial-gradient(circle at 68% 28%, rgba(242,167,184,0.08), transparent 28%)',
        }}
      />
    </div>
  )
}
