import React from 'react';
import {AbsoluteFill, Composition, Easing, interpolate} from 'remotion';
import {
  CARD_EDGE,
  COLORS,
  Decor,
  FRAME,
  Grid,
  SAFE,
  SPECTRUM,
  SafeZoneGuide,
  cardShadow,
  enter,
  progressBetween,
} from '../brand';
import {SeeThrough} from '../brand/Grid';
import {WORDMARK_ASPECT, WORDMARK_GROUP_TRANSFORM, WORDMARK_PATHS, WORDMARK_VIEWBOX} from '../brand/wordmark-paths';
import {clampClip, useClipTimeline} from './clipTimeline';

// FundhubLogo: the Fundhub brand sting. The real "fundhub." wordmark on a white plate: a thin brand-spectrum line draws across, the letters rise up out of it one by one, then the line gathers into the period, which lands in the spectrum colors, sends out one soft ring and settles to ink. The only place the logo shows on the videos.
//
// Chris (2026-10-23): "make 1 fundhub animation for the logo so that way we
// can get brand loyalty." The logo was taken off every other see-through clip,
// so this sting is the one spot the brand shows over his filmed videos.
//
// Only the real wordmark (src/brand/wordmark-paths.ts, byte-for-byte the live
// site logo, ink #0A0A0A with an ink period) and the brand spectrum. No other
// words. Once it lands, the logo is exactly the live logo.
//
// Two formats, 30 fps:
// - vertical: 1080x1920 for ads. The plate sits centered in the text-safe band
//   (y 269-1248).
// - wide: 3840x2160 for the VSL and the thank-you video. The plate sits near the
//   top of ONE side panel picked by `side`: left x 192-1500 or right x 2340-3648,
//   y 108-1512. Nothing in the middle column (x 1500-2340, the face) or the
//   bottom 30% (y > 1512, the captions).
//
// `transparent` drops the page and grid; the white plate and its soft shadow
// stay, so the wordmark reads over any footage. The spectrum line and the ring
// are wrapped in Decor, so a `checkTextOnly` render keeps only plate + logo.

export type FundhubLogoFormat = 'vertical' | 'wide';
export type FundhubLogoSide = 'left' | 'right';

export type FundhubLogoProps = {
  /** "vertical" (1080x1920, ads) or "wide" (3840x2160, the VSL). */
  format: FundhubLogoFormat;
  /** Wide only: the side panel the logo sits in. Default "left". */
  side?: FundhubLogoSide;
  durationInFrames?: number;
  showSafeZones?: boolean;
  /** See-through: no page and no grid, so the clip renders with alpha (README.md). Default false. */
  transparent?: boolean;
};

export const fundhubLogoDefaults: FundhubLogoProps = {
  format: 'vertical',
  side: 'left',
  transparent: false,
};

/** Base length 2.5 s; a shot list may ask for 2 to 3 s (60 to 90 frames). */
export const FUNDHUB_LOGO_BASE = 75;
export const FUNDHUB_LOGO_MIN = 60;
export const FUNDHUB_LOGO_MAX = 90;
/** Frame (on the base timeline) where the period has landed on screen. */
export const FUNDHUB_LOGO_LANDED = 46;
/** Frame (on the base timeline) where everything has settled: ring gone, period ink. */
export const FUNDHUB_LOGO_HERO = 62;

export const fundhubLogoDuration = (requested?: number): number =>
  clampClip(requested, FUNDHUB_LOGO_BASE, FUNDHUB_LOGO_MIN, FUNDHUB_LOGO_MAX);

/** The wide frame and its two side panels (owner rule in ops/workflows/animation-builds-2026-10-22.md). */
export const LOGO_WIDE = {width: 3840, height: 2160, fps: 30} as const;
export const LOGO_PANELS = {
  left: {x0: 192, x1: 1500},
  right: {x0: 2340, x1: 3648},
  y0: 108,
  y1: 1512,
} as const;

// ---------------------------------------------------------------------------
// The wordmark, letter by letter. Boxes are in the wordmark's viewBox units
// (0-2698 x 0-543), measured from the paths in wordmark-paths.ts. The path list
// is not in reading order, so `order` puts it left to right: f u n d h u b .

const LETTERS = [
  {path: 0, top: 0, bottom: 531}, // f
  {path: 5, top: 164, bottom: 544}, // u
  {path: 4, top: 151, bottom: 531}, // n
  {path: 1, top: 49, bottom: 543}, // d
  {path: 2, top: 50, bottom: 531}, // h
  {path: 6, top: 164, bottom: 544}, // u
  {path: 3, top: 50, bottom: 543}, // b
] as const;
/** The period path and its center / radius in viewBox units. */
const PERIOD = {path: 7, cx: 2625.6, cy: 460.2, r: 73} as const;
const VIEW_W = 2698.148471;

/** The letters rise from behind this line (viewBox y). */
const FLOOR_Y = 547;
/** The spectrum line: its top edge and thickness (viewBox units). */
const LINE = {y: 549, h: 30} as const;

/** The brand spectrum's stops, read from the one place the kit keeps it. */
const SPECTRUM_STOPS = [...SPECTRUM.matchAll(/(#[0-9A-Fa-f]{6})\s+(\d+)%/g)].map((m) => ({color: m[1], at: Number(m[2]) / 100}));

// ---------------------------------------------------------------------------
// Timeline (frames on the 75-frame base)

const T = {
  plate: 0,
  lineIn: [3, 17],
  letters: 7,
  stagger: 2.5,
  gather: [29, 40],
  period: 37,
  ring: [44, 60],
  ink: [47, 58],
  settle: [40, FUNDHUB_LOGO_BASE],
} as const;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** The sting itself, drawn at a given wordmark width. */
const LogoSting: React.FC<{f: number; fps: number; width: number; uid: string}> = ({f, fps, width, uid}) => {
  const height = width / WORDMARK_ASPECT;

  // Plate: lifts forward out of the wall and untilts.
  const plateIn = enter(f, fps, T.plate, 14);
  const settle = interpolate(f, [T.settle[0], T.settle[1]], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });
  const push = 1 + 0.016 * settle;

  // The spectrum line draws in from the left, then gathers to the period's spot.
  const lineIn = interpolate(f, T.lineIn, [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic)});
  const gather = interpolate(f, T.gather, [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic)});
  const lineEnd = PERIOD.cx * lineIn;
  const lineStart = (PERIOD.cx - LINE.h / 2) * gather;
  const lineW = Math.max(0, lineEnd - lineStart);
  const lineOn = gather < 1 && lineW > 0.5;

  // The period: born where the line ends, grows and rises onto the baseline.
  const land = enter(f, fps, T.period, 10);
  const lineMid = LINE.y + LINE.h / 2;
  const startScale = LINE.h / (PERIOD.r * 2);
  const pScale = startScale + (1 - startScale) * land;
  const pDy = (lineMid - PERIOD.cy) * (1 - land);
  const periodOn = f >= T.period;
  const inkP = progressBetween(f, T.ink[0], T.ink[1]);

  // One soft ring off the landing.
  const ringT = clamp01((f - T.ring[0]) / (T.ring[1] - T.ring[0]));
  const ringE = Easing.out(Easing.cubic)(ringT);
  const ringR = PERIOD.r * (1.1 + 1.9 * ringE);
  const ringOn = ringT > 0 && ringT < 1;

  const padX = 0.126 * width;
  const padTop = 0.097 * width;
  const padBottom = 0.113 * width;

  const periodTransform = `translate(${PERIOD.cx} ${PERIOD.cy + pDy}) scale(${pScale}) translate(${-PERIOD.cx} ${-PERIOD.cy})`;
  const periodPath = WORDMARK_PATHS[PERIOD.path];

  return (
    <div style={{perspective: 2400 * (width / 620)}}>
      <div
        style={{
          position: 'relative',
          padding: `${padTop}px ${padX}px ${padBottom}px`,
          borderRadius: (height + padTop + padBottom) * 0.3,
          background: 'linear-gradient(165deg, #FFFFFF 0%, #FFFFFF 55%, #FAFAFB 100%)',
          ...CARD_EDGE,
          borderWidth: Math.max(2, Math.round(2 * (width / 620))),
          boxShadow: cardShadow(width / 620),
          opacity: plateIn,
          transform: `translateY(${(1 - plateIn) * 0.05 * width}px) rotateX(${(1 - plateIn) * 14}deg) scale(${(0.94 + 0.06 * plateIn) * push})`,
          transformOrigin: '50% 60%',
        }}
      >
        <svg
          width={width}
          height={height}
          viewBox={WORDMARK_VIEWBOX}
          preserveAspectRatio="xMidYMid meet"
          style={{display: 'block', overflow: 'visible'}}
          aria-label="fundhub."
        >
          <defs>
            <linearGradient id={`${uid}-line`} gradientUnits="userSpaceOnUse" x1={0} y1={0} x2={PERIOD.cx + PERIOD.r} y2={0}>
              {SPECTRUM_STOPS.map((s) => (
                <stop key={s.at} offset={s.at} stopColor={s.color} />
              ))}
            </linearGradient>
            <linearGradient id={`${uid}-dot`} x1={0} y1={0} x2={1} y2={0}>
              {SPECTRUM_STOPS.map((s) => (
                <stop key={s.at} offset={s.at} stopColor={s.color} />
              ))}
            </linearGradient>
            <linearGradient id={`${uid}-ring`} x1={0} y1={0} x2={1} y2={1}>
              {SPECTRUM_STOPS.map((s) => (
                <stop key={s.at} offset={s.at} stopColor={s.color} />
              ))}
            </linearGradient>
            <clipPath id={`${uid}-floor`} clipPathUnits="userSpaceOnUse">
              <rect x={-200} y={-2000} width={VIEW_W + 400} height={2000 + FLOOR_Y} />
            </clipPath>
          </defs>

          {/* one soft spectrum ring off the landing, behind the letters so the "b" stays clean */}
          <Decor>
            {ringOn ? (
              <circle
                cx={PERIOD.cx}
                cy={PERIOD.cy}
                r={ringR}
                fill="none"
                stroke={`url(#${uid}-ring)`}
                strokeWidth={14 * (1 - ringE) + 4}
                opacity={0.9 * (1 - ringT) * (1 - ringT)}
              />
            ) : null}
          </Decor>

          {/* the letters rise out of the line, left to right */}
          <g clipPath={`url(#${uid}-floor)`}>
            {LETTERS.map((l, i) => {
              const e = enter(f, fps, T.letters + i * T.stagger, 14);
              const dy = (1 - e) * (FLOOR_Y - l.top + 30);
              return (
                <g key={l.path} transform={`translate(0 ${dy})`}>
                  <g transform={WORDMARK_GROUP_TRANSFORM} fill={COLORS.ink} stroke="none">
                    <path d={WORDMARK_PATHS[l.path]} />
                  </g>
                </g>
              );
            })}
          </g>

          {/* the brand spectrum line: draws in, then gathers into the period */}
          <Decor>
            {lineOn ? (
              <rect x={lineStart} y={LINE.y} width={lineW} height={LINE.h} rx={LINE.h / 2} fill={`url(#${uid}-line)`} />
            ) : null}
          </Decor>

          {/* the period: spectrum while it lands, then the logo's own ink */}
          {periodOn ? (
            <g transform={periodTransform}>
              <g transform={WORDMARK_GROUP_TRANSFORM} stroke="none">
                <path d={periodPath} fill={COLORS.ink} opacity={inkP} />
                <path d={periodPath} fill={`url(#${uid}-dot)`} opacity={1 - inkP} />
              </g>
            </g>
          ) : null}
        </svg>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Vertical (ads), 1080x1920

/** Wordmark width on the vertical frame. The plate is about 776 x 255 px. */
const V_WIDTH = 620;

const Vertical: React.FC<FundhubLogoProps & {f: number; fps: number}> = ({f, fps, showSafeZones}) => (
  <AbsoluteFill>
    <Grid />
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: SAFE.top,
        bottom: FRAME.height - SAFE.bottom,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <LogoSting f={f} fps={fps} width={V_WIDTH} uid="fhl-v" />
    </div>
    {showSafeZones ? <SafeZoneGuide /> : null}
  </AbsoluteFill>
);

// ---------------------------------------------------------------------------
// Wide (VSL, thank-you), 3840x2160

/** Wordmark width on the wide frame. The plate is about 1076 x 357 px. */
const W_WIDTH = 860;
/** Gap from the panel's top edge to the plate. */
const W_TOP_GAP = 72;

const WidePanelGuide: React.FC<{side: FundhubLogoSide}> = ({side}) => {
  const p = LOGO_PANELS[side];
  return (
    <AbsoluteFill style={{pointerEvents: 'none'}}>
      <div
        style={{
          position: 'absolute',
          left: p.x0,
          top: LOGO_PANELS.y0,
          width: p.x1 - p.x0,
          height: LOGO_PANELS.y1 - LOGO_PANELS.y0,
          border: '6px solid #DC2626',
          boxShadow: '0 0 0 9999px rgba(220,38,38,.07)',
        }}
      />
    </AbsoluteFill>
  );
};

const Wide: React.FC<FundhubLogoProps & {f: number; fps: number}> = ({f, fps, side = 'left', showSafeZones}) => {
  const p = LOGO_PANELS[side];
  return (
    <AbsoluteFill>
      {/* the kit's own page (paper + faint grid); draws nothing when see-through */}
      <Grid />
      <div
        style={{
          position: 'absolute',
          left: p.x0,
          width: p.x1 - p.x0,
          top: LOGO_PANELS.y0 + W_TOP_GAP,
          display: 'flex',
          justifyContent: 'center',
        }}
      >
        <LogoSting f={f} fps={fps} width={W_WIDTH} uid={`fhl-w-${side}`} />
      </div>
      {showSafeZones ? <WidePanelGuide side={side} /> : null}
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------------------

export const FundhubLogo: React.FC<FundhubLogoProps> = (props) => {
  const {f, fps} = useClipTimeline(FUNDHUB_LOGO_BASE, props.durationInFrames, FUNDHUB_LOGO_MIN, FUNDHUB_LOGO_MAX);
  const page = props.format === 'wide' ? <Wide {...props} f={f} fps={fps} /> : <Vertical {...props} f={f} fps={fps} />;
  return <SeeThrough on={props.transparent}>{page}</SeeThrough>;
};

const size = (format: FundhubLogoFormat) =>
  format === 'wide' ? {width: LOGO_WIDE.width, height: LOGO_WIDE.height} : {width: FRAME.width, height: FRAME.height};

// Stills:  npx remotion still src/index.ts FundhubLogo out/fundhub-logo.png --frame=62
//          npx remotion still src/index.ts FundhubLogoWide out/fundhub-logo-wide.png --frame=62 --props='{"side":"right"}'
// FundhubLogo with --props '{"format":"wide"}' is the same as FundhubLogoWide.
export const FundhubLogoCompositions: React.FC = () => (
  <>
    <Composition
      id="FundhubLogo"
      component={FundhubLogo}
      durationInFrames={FUNDHUB_LOGO_BASE}
      fps={FRAME.fps}
      width={FRAME.width}
      height={FRAME.height}
      defaultProps={fundhubLogoDefaults}
      calculateMetadata={({props}) => ({durationInFrames: fundhubLogoDuration(props.durationInFrames), ...size(props.format)})}
    />
    <Composition
      id="FundhubLogoWide"
      component={FundhubLogo}
      durationInFrames={FUNDHUB_LOGO_BASE}
      fps={LOGO_WIDE.fps}
      width={LOGO_WIDE.width}
      height={LOGO_WIDE.height}
      defaultProps={{...fundhubLogoDefaults, format: 'wide' as const}}
      calculateMetadata={({props}) => ({durationInFrames: fundhubLogoDuration(props.durationInFrames), ...size(props.format)})}
    />
  </>
);
