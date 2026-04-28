import { useLayoutEffect, useRef, useState } from "react";
import gsap from "gsap";
import { interpolate } from "flubber";

/** SVG path morph without Club GSAP MorphSVGPlugin (uses flubber). */
function morphPathTween(
  path: SVGPathElement,
  fromD: string,
  toD: string,
  duration: number,
  ease: string,
): gsap.core.Tween {
  let mixer: (t: number) => string;
  try {
    mixer = interpolate(fromD, toD, { maxSegmentLength: 1.5 });
  } catch {
    mixer = (_t: number) => toD;
  }
  const state = { t: 0 };
  return gsap.to(state, {
    t: 1,
    duration,
    ease,
    onUpdate: () => {
      path.setAttribute("d", mixer(state.t));
    },
  });
}

const LOADER_RELEASE_EVENT = "vima-loader-release";
const LOADER_COMPLETE_EVENT = "vima-loader-complete";
const CSS_FALLBACK_DURATION = 4300;

const loaderFrameCovers = [
  {
    src: "/vima/vima-loader-signal.png",
    position: "center",
  },
  {
    src: "/vima/vima-loader-rebar.png",
    position: "center",
  },
  {
    src: "/vima/vima-loader-site.png",
    position: "center",
  },
] as const;

const SQRT3_2 = 0.8660254037844387;

function hexPathPointy(cx: number, cy: number, r: number): string {
  const dx = r * SQRT3_2;
  const dy = r * 0.5;
  return [
    `M ${cx} ${cy - r}`,
    `L ${cx + dx} ${cy - dy}`,
    `L ${cx + dx} ${cy + dy}`,
    `L ${cx} ${cy + r}`,
    `L ${cx - dx} ${cy + dy}`,
    `L ${cx - dx} ${cy - dy}`,
    "Z",
  ].join(" ");
}

function hexPathRotated(cx: number, cy: number, r: number, rotDeg: number): string {
  const phi = (rotDeg * Math.PI) / 180;
  const cosP = Math.cos(phi);
  const sinP = Math.sin(phi);
  const base: Array<[number, number]> = [
    [0, -r],
    [r * SQRT3_2, -r * 0.5],
    [r * SQRT3_2, r * 0.5],
    [0, r],
    [-r * SQRT3_2, r * 0.5],
    [-r * SQRT3_2, -r * 0.5],
  ];
  const pts = base.map(([x, y]) => [cx + x * cosP - y * sinP, cy + x * sinP + y * cosP]);
  return `M ${pts[0][0]} ${pts[0][1]} ${pts.slice(1).map(([x, y]) => `L ${x} ${y}`).join(" ")} Z`;
}

const logoMorphPath = `${hexPathPointy(12, 12, 9.75)} ${hexPathRotated(12, 12, 4.5, 30)}`;

// Source-derived from Tabler Icons filled glyphs (MIT): analyze,
// grid-pattern, and barrier-block. Kept as filled 24x24 paths so MorphSVG
// interpolates cleanly before resolving into the vima mark.
const loaderMorphShapes = [
  "M4.99 12.862a7.1 7.1 0 0 0 12.171 3.924a1.956 1.956 0 0 1 -.156 -.637l-.005 -.149l.005 -.15a2 2 0 1 1 1.769 2.137a9.099 9.099 0 0 1 -15.764 -4.85a1 1 0 0 1 1.98 -.275z M12 8a4 4 0 1 1 -3.995 4.2l-.005 -.2l.005 -.2a4 4 0 0 1 3.995 -3.8z M13.142 3.09a9.1 9.1 0 0 1 7.848 7.772a1 1 0 0 1 -1.98 .276a7.1 7.1 0 0 0 -6.125 -6.064a7.096 7.096 0 0 0 -6.048 2.136a2 2 0 1 1 -3.831 .939l-.006 -.149l.005 -.15a2 2 0 0 1 2.216 -1.838a9.094 9.094 0 0 1 7.921 -2.922z",
  "M18 3a3 3 0 0 1 3 3v12a3 3 0 0 1 -3 3h-12a3 3 0 0 1 -3 -3v-12a3 3 0 0 1 3 -3zm-4 4a1 1 0 0 0 -1 1v1h-2v-1a1 1 0 0 0 -.883 -.993l-.117 -.007a1 1 0 0 0 -1 1v1h-1a1 1 0 0 0 -.993 .883l-.007 .117a1 1 0 0 0 1 1h1v2h-1a1 1 0 0 0 -.993 .883l-.007 .117a1 1 0 0 0 1 1h1v1a1 1 0 0 0 .883 .993l.117 .007a1 1 0 0 0 1 -1v-1h2v1a1 1 0 0 0 .883 .993l.117 .007a1 1 0 0 0 1 -1v-1h1a1 1 0 0 0 .993 -.883l.007 -.117a1 1 0 0 0 -1 -1h-1v-2h1a1 1 0 0 0 .993 -.883l.007 -.117a1 1 0 0 0 -1 -1h-1v-1a1 1 0 0 0 -.883 -.993zm-1 4v2h-2v-2z",
  "M15 21a1 1 0 0 1 0 -2h1v-2h-8v2h1a1 1 0 0 1 0 2h-4a1 1 0 0 1 0 -2h1v-2h-1a2 2 0 0 1 -2 -2v-7a2 2 0 0 1 2 -2h1v-1a1 1 0 1 1 2 0v1h8v-1a1 1 0 0 1 2 0v1h1a2 2 0 0 1 2 2v7a2 2 0 0 1 -2 2h-1v2h1a1 1 0 0 1 0 2zm-2.086 -13l-7 7h4.17l6.916 -7zm6.086 2.914l-4.086 4.086h4.086zm-10.916 -2.914h-3.084v3.084z",
] as const;

export default function VimaLoader() {
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const videoLayerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const markRef = useRef<HTMLDivElement>(null);
  const markShapeRef = useRef<SVGPathElement>(null);
  const apertureRef = useRef<HTMLDivElement>(null);
  const apertureInnerRef = useRef<HTMLDivElement>(null);
  const startRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const subtextRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const [hidden, setHidden] = useState(false);

  useLayoutEffect(() => {
    const root = rootRef.current;
    const stage = stageRef.current;
    const videoLayer = videoLayerRef.current;
    const video = videoRef.current;
    const mark = markRef.current;
    const markShape = markShapeRef.current;
    const aperture = apertureRef.current;
    const apertureInner = apertureInnerRef.current;
    const start = startRef.current;
    const end = endRef.current;
    const status = statusRef.current;
    const subtext = subtextRef.current;
    const progress = progressRef.current;
    if (!root || !stage || !videoLayer || !mark || !markShape || !aperture || !apertureInner || !start || !end || !status) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const letters = root.querySelectorAll("[data-loader-letter]");
    const frameCovers = root.querySelectorAll("[data-loader-frame-cover]");
    const apertureOverlays = root.querySelectorAll("[data-loader-overlay]");
    const backdropStage = document.querySelector<HTMLElement>("[data-landing-backdrop-stage]");
    const orderedFrameCovers = Array.from(frameCovers);
    let loaderTimeline: gsap.core.Timeline | undefined;
    let released = false;

    // Scroll handoff guard: when the user refreshes mid-scroll the browser
    // restores their old scroll position. The loader paints full-screen black
    // on top, plays its 5s typography animation, hands off to the hero — but
    // the user is parked 2000px down so they never see the hero, just a
    // half-finished page mid-section. Two-part fix:
    //   1. Tell the browser to STOP restoring scroll on refresh ("manual"
    //      means the page is responsible, default is "auto").
    //   2. Force scroll to 0 before the loader animation runs, so the
    //      handoff lands at the top where the hero actually is.
    if (typeof history !== "undefined" && "scrollRestoration" in history) {
      history.scrollRestoration = "manual";
    }
    if (window.scrollY !== 0) {
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    }

    root.style.animation = "none";

    const ctx = gsap.context(() => {
      const holdVideoAtStart = () => {
        if (!video) return;

        video.pause();
        try {
          video.currentTime = 0;
        } catch {
          video.addEventListener(
            "loadedmetadata",
            () => {
              video.pause();
              video.currentTime = 0;
            },
            { once: true },
          );
        }
      };
      const fitVideoToAperture = () => {
        const rect = aperture.getBoundingClientRect();
        const bleed = 2;
        gsap.set(videoLayer, {
          x: rect.left - bleed,
          y: rect.top - bleed,
          scaleX: (rect.width + bleed * 2) / window.innerWidth,
          scaleY: (rect.height + bleed * 2) / window.innerHeight,
          transformOrigin: "0 0",
        });
      };
      const fitMarkToAperture = () => {
        const rect = aperture.getBoundingClientRect();
        const size = Math.max(42, Math.min(rect.height * 0.82, rect.width * 0.34));
        gsap.set(mark, {
          x: rect.left + rect.width / 2 - size / 2,
          y: rect.top + rect.height / 2 - size / 2,
          width: size,
          height: size,
          transformOrigin: "50% 50%",
        });
      };
      const getHeroMarkTarget = () => {
        const target = document.querySelector<HTMLElement>('[data-gsap-intro="intro-logo-mark"]');
        if (!target) return null;

        const rect = target.getBoundingClientRect();
        const current = mark.getBoundingClientRect();
        const transformX = Number(gsap.getProperty(target, "x")) || 0;
        const transformY = Number(gsap.getProperty(target, "y")) || 0;
        const width = target.offsetWidth || rect.width || current.width;
        const height = target.offsetHeight || rect.height || current.height;
        const size = Math.max(18, Math.min(width, height));

        return {
          target,
          x: rect.left + rect.width / 2 - transformX - size / 2,
          y: rect.top + rect.height / 2 - transformY - size / 2,
          size,
        };
      };
      const flyMarkToHero = () => {
        const heroMark = getHeroMarkTarget();
        if (!heroMark) {
          gsap.to(mark, { autoAlpha: 0, scale: 0.72, duration: 0.52, ease: "power3.out" });
          return;
        }

        gsap.to(mark, {
          x: heroMark.x,
          y: heroMark.y,
          width: heroMark.size,
          height: heroMark.size,
          duration: 1.18,
          ease: "power2.inOut",
        });
      };
      const revealHeroMark = () => {
        const heroMark = getHeroMarkTarget();
        if (!heroMark) return;

        gsap.set(heroMark.target, {
          autoAlpha: 1,
          x: 0,
          y: 0,
          scale: 1,
          rotationY: 0,
          transformOrigin: "50% 50%",
          filter: "drop-shadow(0 0 18px rgba(242,167,184,0.18))",
        });
      };

      const completeLoader = () => {
        document.documentElement.setAttribute("data-vima-loader-complete", "true");
        (window as Window & { __vimaLoaderComplete?: boolean }).__vimaLoaderComplete = true;
        window.dispatchEvent(
          new CustomEvent(LOADER_COMPLETE_EVENT, {
            detail: {
              phase: "loader-hidden",
              at: performance.now(),
            },
          }),
        );
      };
      const finish = () => setHidden(true);
      const hideLoader = () => {
        gsap.to(root, {
          autoAlpha: 0,
          duration: 0.58,
          ease: "power3.out",
          overwrite: "auto",
          onComplete: () => {
            completeLoader();
            finish();
          },
        });
      };

      const releaseHero = () => {
        if (released) return;
        released = true;
        const videoTime = video && Number.isFinite(video.currentTime) ? video.currentTime : 0;
        document.documentElement.setAttribute("data-vima-loader-reveal", "true");
        root.style.pointerEvents = "none";
        (window as Window & { __vimaLoaderReleased?: boolean }).__vimaLoaderReleased = true;
        window.dispatchEvent(
          new CustomEvent(LOADER_RELEASE_EVENT, {
            detail: {
              phase: "hero-cover",
              aperture: "expanding-video-mask",
              videoTime,
              at: performance.now(),
            },
          }),
        );
        hideLoader();
      };

      if (reduce) {
        gsap.set(root, { autoAlpha: 0 });
        document.documentElement.setAttribute("data-vima-loader-reveal", "true");
        releaseHero();
        completeLoader();
        finish();
        return;
      }

      gsap.set(stage, { autoAlpha: 1, scale: 0.98 });
      video?.load();
      holdVideoAtStart();
      gsap.set(mark, { autoAlpha: 0, scale: 0.9 });
      gsap.set(markShape, { attr: { d: loaderMorphShapes[0] } });
      gsap.set(videoLayer, {
        autoAlpha: 0,
        x: 0,
        y: 0,
        scaleX: 0.001,
        scaleY: 0.001,
        transformOrigin: "0 0",
        willChange: "transform",
      });
      if (backdropStage) {
        gsap.set(backdropStage, {
          x: 0,
          y: 0,
          scale: 1,
          transformOrigin: "50% 50%",
        });
      }
      gsap.set(letters, { yPercent: 112 });
      gsap.set(frameCovers, { autoAlpha: 1 });
      gsap.set(aperture, {
        width: "0em",
        height: "0.82em",
        autoAlpha: 1,
        backgroundColor: "#080503",
        boxShadow: "0 0 0 120vmax #000000",
        // hint to the compositor: aperture mutates layout + paint heavily,
        // contain isolates its work from the rest of the doc tree.
        contain: "layout paint",
        willChange: "width, height",
      });
      gsap.set(apertureInner, {
        width: "0%",
        height: "100%",
        xPercent: -50,
        yPercent: -50,
        autoAlpha: 1,
        transformOrigin: "50% 50%",
      });
      gsap.set(status, { autoAlpha: 0, y: 10, clipPath: "inset(0 100% 0 0)" });
      if (subtext) gsap.set(subtext, { autoAlpha: 0, y: 8 });
      if (progress) gsap.set(progress, { scaleX: 0, transformOrigin: "0% 50%" });
      gsap.set([start, end], { x: "0em" });

      loaderTimeline = gsap
        .timeline({
          defaults: { ease: "expo.inOut" },
          onComplete: finish,
        })
        .addLabel("type", 0)
        .to(stage, { scale: 1, duration: 1.2 }, "type")
        .to(letters, { yPercent: 0, duration: 1.15, stagger: 0.04, ease: "expo.out" }, "type+=0.08")
        // subtext + progress bar appear shortly after the wordmark settles.
        // progress fills from 0 to ~100% across the loader's lifespan.
        .to(subtext, { autoAlpha: 1, y: 0, duration: 0.6, ease: "power3.out" }, "type+=0.85")
        .to(progress, { scaleX: 1, duration: 5.4, ease: "power1.inOut" }, "type+=0.4")
        .to(aperture, { width: "1.05em", duration: 1.18 }, "type+=0.66")
        .to(apertureInner, { width: "100%", duration: 1.18 }, "type+=0.66")
        .to(start, { x: "-0.055em", duration: 1.18 }, "type+=0.66")
        .to(end, { x: "0.055em", duration: 1.18 }, "type+=0.66")
        .call(fitMarkToAperture, undefined, "type+=1.28")
        .to(mark, { autoAlpha: 1, scale: 1, duration: 0.36, ease: "power3.out" }, "type+=1.3")
        .add(
          morphPathTween(markShape, loaderMorphShapes[0], loaderMorphShapes[1], 0.82, "power2.inOut"),
          "type+=1.86",
        )
        .add(
          morphPathTween(markShape, loaderMorphShapes[1], loaderMorphShapes[2], 0.82, "power2.inOut"),
          "type+=2.64",
        )
        .add(
          morphPathTween(markShape, loaderMorphShapes[2], logoMorphPath, 0.9, "power2.inOut"),
          "type+=3.42",
        )
        .to(
          orderedFrameCovers,
          {
            autoAlpha: 0,
            duration: 0.34,
            ease: "power1.inOut",
            stagger: 0.78,
          },
          "type+=1.86",
        )
        .call(
          () => {
            fitVideoToAperture();
            holdVideoAtStart();
          },
          undefined,
          "type+=4.32",
        )
        .to(videoLayer, { autoAlpha: 1, duration: 0.34, ease: "none" }, "type+=4.32")
        .to(aperture, { backgroundColor: "rgba(8,5,3,0)", duration: 0.34, ease: "none" }, "type+=4.32")
        .to(
          status,
          {
            autoAlpha: 1,
            y: 0,
            clipPath: "inset(0 0% 0 0)",
            duration: 0.68,
            ease: "power3.out",
          },
          "type+=1.34",
        )
        .addLabel("field", 4.84)
        .call(fitVideoToAperture, undefined, "field-=0.02")
        .call(() => document.documentElement.setAttribute("data-vima-loader-reveal", "true"), undefined, "field")
        // perf: snap-kill the giant 120vmax box-shadow at the start of field
        // instead of animating it. animating a viewport-sized blur shadow
        // forces a full-viewport repaint every frame.
        .set(aperture, { boxShadow: "0 0 0 0 rgba(0,0,0,0)" }, "field")
        // perf: kill the scan/grain animation immediately. it uses
        // mix-blend-mode: screen which is paint-heavy and contributes
        // nothing once the loader is dissolving.
        .set(".vima-loader-scan", { display: "none" }, "field")
        // perf: drop the 3 stacked drop-shadows on the mark during the fly.
        // gaussian blur filters re-rasterize every frame as the mark moves.
        .set(mark, { filter: "none" }, "field")
        .to(videoLayer, { x: 0, y: 0, scaleX: 1, scaleY: 1, duration: 2.04, ease: "power2.inOut" }, "field")
        .to(apertureOverlays, { autoAlpha: 0, duration: 0.12, ease: "none" }, "field-=0.08")
        .to(
          aperture,
          {
            width: "112vw",
            height: "112dvh",
            borderColor: "rgba(242,167,184,0)",
            duration: 2.04,
          },
          "field",
        )
        .to(apertureInner, { width: "112vw", height: "112dvh", duration: 2.04 }, "field")
        .to(start, { x: "-0.18em", duration: 1.08 }, "field+=0.02")
        .to(end, { x: "0.18em", duration: 1.08 }, "field+=0.02")
        .call(flyMarkToHero, undefined, "field+=0.24")
        .to(letters, { yPercent: -112, duration: 0.98, stagger: 0.03 }, "field+=0.16")
        .to(status, { autoAlpha: 0, y: -8, duration: 0.48, ease: "power3.out" }, "field+=1.12")
        .to([subtext, progress], { autoAlpha: 0, duration: 0.4, ease: "power3.out" }, "field+=0.2")
        .call(revealHeroMark, undefined, "field+=1.52")
        .call(releaseHero, undefined, "field+=1.7");

      loaderTimeline.timeScale(1);
    }, root);

    return () => {
      loaderTimeline?.kill();
      ctx.revert();
    };
  }, []);

  if (hidden) return null;

  return (
    <div
      ref={rootRef}
      aria-label="loading"
      role="status"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 80,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "#000000",
        pointerEvents: "none",
        animation: `vima-loader-css-release ${CSS_FALLBACK_DURATION}ms ease forwards`,
      }}
    >
      <style>
        {`
          @keyframes vima-loader-css-release {
            0%, 80% { opacity: 1; visibility: visible; }
            100% { opacity: 0; visibility: hidden; }
          }

          @media (max-width: 680px) {
            .vima-loader-stage {
              font-size: clamp(4.1rem, 22vw, 7rem) !important;
            }
          }

          .vima-loader-scan {
            position: absolute;
            inset: 0;
            z-index: 4;
            background:
              linear-gradient(90deg, transparent, rgba(242,167,184,0.18), transparent),
              repeating-linear-gradient(0deg, rgba(247,236,239,0.035) 0 1px, transparent 1px 7px);
            mix-blend-mode: screen;
            opacity: 0.42;
            animation: vima-loader-scan-pass 1.15s cubic-bezier(0.2, 0.8, 0.2, 1) infinite;
          }

          @keyframes vima-loader-scan-pass {
            0% { transform: translateX(-120%); opacity: 0; }
            22% { opacity: 0.42; }
            70% { opacity: 0.18; }
            100% { transform: translateX(120%); opacity: 0; }
          }
        `}
      </style>
      <div
        ref={stageRef}
        className="vima-loader-stage"
        style={{
          position: "relative",
          zIndex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: '"Times New Roman", Times, serif',
          fontSize: "clamp(6.5rem, 15vw, 15rem)",
          fontWeight: 400,
          lineHeight: 0.78,
          letterSpacing: "0.02em",
          color: "rgba(247,236,239,0.92)",
          textShadow: "0 0 34px rgba(242,167,184,0.12)",
          whiteSpace: "nowrap",
        }}
      >
        <div
          ref={startRef}
          style={{
            position: "relative",
            zIndex: 2,
            display: "flex",
            justifyContent: "flex-end",
            overflow: "hidden",
          }}
        >
          <span data-loader-letter>u</span>
          <span data-loader-letter style={{ paddingLeft: "0.18em" }}>
            c
          </span>
        </div>
        <div
          ref={apertureRef}
          aria-hidden
          style={{
            position: "relative",
            zIndex: 1,
            flex: "0 0 auto",
            width: "0em",
            height: "0.82em",
            margin: "0 0.08em",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
            border: 0,
            background: "#080503",
            willChange: "width, height",
            contain: "layout paint",
          }}
        >
          <div
            ref={apertureInnerRef}
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              width: "0%",
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                position: "absolute",
                width: "100%",
                minWidth: "1.05em",
                height: "100%",
              }}
            >
              {loaderFrameCovers.map((frame, index) => (
                <div
                  key={frame.src}
                  data-loader-frame-cover
                  aria-hidden
                  style={{
                    position: "absolute",
                    inset: "-8px",
                    backgroundImage: `url('${frame.src}')`,
                    backgroundSize: "cover",
                    backgroundPosition: frame.position,
                    transform: "translateZ(0) scale(1.018)",
                    transformOrigin: "50% 50%",
                    zIndex: loaderFrameCovers.length - index + 3,
                  }}
                />
              ))}
              <div
                data-loader-overlay
                style={{
                  position: "absolute",
                  inset: 0,
                  zIndex: loaderFrameCovers.length + 4,
                  background:
                    "linear-gradient(90deg, rgba(8,5,3,0.58), rgba(8,5,3,0.02) 44%, rgba(8,5,3,0.52)), linear-gradient(180deg, rgba(8,5,3,0.08), rgba(8,5,3,0.22)), radial-gradient(circle at 58% 32%, rgba(247,236,239,0.2), transparent 18%), radial-gradient(circle at 72% 42%, rgba(242,167,184,0.18), transparent 28%)",
                }}
              />
              <div className="vima-loader-scan" data-loader-overlay aria-hidden />
            </div>
          </div>
          {/* old aperture-anchored status: kept as a hidden anchor so the
              gsap timeline (statusRef) doesn't break, but content moved out
              to the page-level subtext + progress bar below the loader root */}
          <div
            ref={statusRef}
            aria-hidden
            style={{
              position: "absolute",
              width: 0,
              height: 0,
              overflow: "hidden",
              opacity: 0,
              pointerEvents: "none",
            }}
          />
          {/* explicit empty span — keeps the original component tree shape */}
        </div>
        <div
          ref={endRef}
          style={{
            position: "relative",
            zIndex: 2,
            display: "flex",
            justifyContent: "flex-start",
            overflow: "hidden",
          }}
        >
          <span data-loader-letter>s</span>
          <span data-loader-letter style={{ paddingLeft: "0.18em" }}>
            b
          </span>
        </div>
      </div>
      <div
        ref={markRef}
        aria-hidden
        style={{
          position: "fixed",
          left: 0,
          top: 0,
          zIndex: 3,
          width: 42,
          height: 42,
          opacity: 0,
          pointerEvents: "none",
          color: "#f7ecef",
          filter:
            "drop-shadow(0 0 12px rgba(242,167,184,0.22)) drop-shadow(0 0 30px rgba(166,77,121,0.18))",
        }}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          style={{
            width: "100%",
            height: "100%",
            display: "block",
            overflow: "visible",
          }}
        >
          <defs>
            <radialGradient id="vima-loader-mark-fill" cx="30%" cy="18%" r="82%">
              <stop offset="0%" stopColor="#fff7f9" stopOpacity="0.64" />
              <stop offset="42%" stopColor="#f2a7b8" stopOpacity="0.24" />
              <stop offset="100%" stopColor="#3b1420" stopOpacity="0.56" />
            </radialGradient>
            <linearGradient id="vima-loader-mark-stroke" x1="2" y1="1.5" x2="22" y2="22.5">
              <stop offset="0%" stopColor="#fff7f9" stopOpacity="0.98" />
              <stop offset="46%" stopColor="#f2a7b8" stopOpacity="0.72" />
              <stop offset="100%" stopColor="#7f334e" stopOpacity="0.86" />
            </linearGradient>
            <filter id="vima-loader-mark-shade" x="-35%" y="-35%" width="170%" height="170%">
              <feDropShadow dx="-1.2" dy="-1.4" stdDeviation="1.1" floodColor="#fff2f5" floodOpacity="0.22" />
              <feDropShadow dx="2.4" dy="3.2" stdDeviation="2.8" floodColor="#16070c" floodOpacity="0.78" />
              <feDropShadow dx="0" dy="0" stdDeviation="5.4" floodColor="#a64d79" floodOpacity="0.22" />
            </filter>
          </defs>
          <path
            ref={markShapeRef}
            d={loaderMorphShapes[0]}
            fill="url(#vima-loader-mark-fill)"
            fillRule="evenodd"
            stroke="url(#vima-loader-mark-stroke)"
            strokeWidth="2.2"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            filter="url(#vima-loader-mark-shade)"
          />
        </svg>
      </div>
      <div
        ref={videoLayerRef}
        aria-hidden
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 0,
          overflow: "hidden",
          pointerEvents: "none",
          opacity: 0,
          transform: "translate3d(0,0,0) scale(0.001, 0.001)",
          transformOrigin: "0 0",
          background:
            "radial-gradient(circle at 34% 43%, rgba(242,167,184,0.13), transparent 28%), radial-gradient(ellipse at 70% 43%, rgba(166,77,121,0.22), transparent 46%), linear-gradient(115deg, #080503 0%, #120811 50%, #070403 100%)",
        }}
      >
        <video
          ref={videoRef}
          loop
          muted
          playsInline
          poster="/vima/vima-yozakura-poster.jpg"
          preload="auto"
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            objectPosition: "center top",
            opacity: 0.88,
            filter: "brightness(0.92) saturate(0.94)",
          }}
        >
          <source src="/vima/vima-yozakura-loop.mp4" type="video/mp4" />
          <source src="/vima/vima-yozakura-loop.webm" type="video/webm" />
        </video>
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              // monotonic vignette, no middle re-darkening
              "linear-gradient(90deg, rgba(8,5,3,0.42) 0%, rgba(8,5,3,0.10) 40%, rgba(8,5,3,0.10) 60%, rgba(8,5,3,0.42) 100%), radial-gradient(circle at 68% 28%, rgba(242,167,184,0.08), transparent 28%)",
          }}
        />
      </div>

      <div
        ref={subtextRef}
        aria-hidden
        style={{
          position: "fixed",
          left: "50%",
          bottom: "calc(28% - 40px)",
          transform: "translateX(-50%)",
          zIndex: 6,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "14px",
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "clamp(9px, 0.85vw, 11px)",
            letterSpacing: "0.06em",
            color: "rgba(247,236,239,0.62)",
            textShadow: "0 0 14px rgba(166,77,121,0.18)",
            fontVariantNumeric: "tabular-nums",
            whiteSpace: "nowrap",
          }}
        >
          loading spatial field · CII stream · COLMAP zones
        </div>
        <div
          aria-hidden
          style={{
            position: "relative",
            width: "clamp(180px, 22vw, 260px)",
            height: "1px",
            background: "rgba(166,77,121,0.18)",
            overflow: "hidden",
          }}
        >
          <div
            ref={progressRef}
            style={{
              position: "absolute",
              inset: 0,
              background: "#f2a7b8",
              transform: "scaleX(0)",
              transformOrigin: "0% 50%",
              boxShadow: "0 0 8px rgba(242,167,184,0.42)",
            }}
          />
        </div>
      </div>

    </div>
  );
}
