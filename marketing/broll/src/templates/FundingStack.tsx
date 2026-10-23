import React from 'react';
import {Composition} from 'remotion';
import {BrandFrame, COLORS, Decor, FRAME, P3D, SPECTRUM, Stage3D, TRACK, cardShadow, enter, fadeUp} from '../brand';
import {SeeThrough} from '../brand/Grid';
import {clampClip, useClipTimeline} from './clipTimeline';
import {SidePanelFrame, WIDE_FRAME, type WideSide} from './sidePanel';

// FundingStack (Unit N2, animation-builds-2026-10-22). Funding types slide in from the sides one at a time and stack up, then the stack closes into one block with a single outline, and the caption comes in under it.
//
// Script lines it serves (the defaults are the VSL's):
// - VSL: "Credit cards are where most people start, and we also get you lines
//   of credit, SBA loans, merchant cash advances and personal funding, stacked
//   together at the lowest rates."
// - Direct Book Ad 14: "Credit cards, lines of credit, SBA, MCA, even personal
//   funding, we know how to stack ALL of it and blend it together."
// - Direct Book Ad 16: "That goes for credit cards, SBA loans, MCA and more."
//
// The list of types (3 to 5, first one at the bottom of the stack) and the
// caption are props; a null caption leaves it out. No dollar amounts: the
// scripts give none here. Only script words.
//
// Two formats from one scene, sized by one unit `u`:
// - vertical 1080x1920 (ads): inside BrandFrame's band, y 269-1248.
// - wide 3840x2160 (VSL, thank-you): one side panel picked by `side`
//   (sidePanel.tsx), x 192-1500 or 2340-3648, y 108-1512.
// The sheen that sweeps the stack as it closes is wrapped in Decor, so a render
// with --props '{"checkTextOnly":true}' drops it for the safe-zone scan.

export type FundingStackFormat = 'vertical' | 'wide';

export type FundingStackProps = {
  /** "vertical" (1080x1920, ads) or "wide" (3840x2160, the VSL and thank-you). */
  format?: FundingStackFormat;
  /** Wide only: which side panel holds the clip. Default "left". */
  side?: WideSide;
  /** 3 to 5 funding types, in the order the script says them. The first lands at the bottom. Past 5 are dropped. */
  types: string[];
  /** The line under the stack once it closes. Null leaves it out. */
  caption: string | null;
  durationInFrames?: number;
  showSafeZones?: boolean;
  /** See-through: no page and no grid, so the clip renders with alpha (README.md). Default false. */
  transparent?: boolean;
};

export const fundingStackDefaults: FundingStackProps = {
  format: 'vertical',
  side: 'left',
  types: ['Credit cards', 'Lines of credit', 'SBA loans', 'Merchant cash advances', 'Personal funding'],
  caption: 'Stacked together at the lowest rates',
  transparent: false,
};

/** Base length 3.3 s; a shot list may ask for 2.5 to 4 s (75 to 120 frames). */
export const FUNDING_STACK_BASE = 99;
export const FUNDING_STACK_MIN = 75;
export const FUNDING_STACK_MAX = 120;
/** Frame (on the base timeline) where the stack has closed and the caption is in. */
export const FUNDING_STACK_HERO = 90;

export const fundingStackDuration = (requested?: number): number =>
  clampClip(requested, FUNDING_STACK_BASE, FUNDING_STACK_MIN, FUNDING_STACK_MAX);

// ---------------------------------------------------------------------------
// Timeline (frames on the 99-frame base)

const T = {
  first: 4,
  /** The last type starts this many frames after the first, however many there are. */
  spread: 34,
  slide: 16,
  merge: 58,
  caption: 68,
} as const;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const bump = (f: number, at: number, len: number) => {
  const t = (f - at) / len;
  return t <= 0 || t >= 1 ? 0 : Math.sin(Math.PI * t);
};

/** One spectrum color per slot, bottom to top (the page's --spectrum stops). */
const SLOT_COLORS = [
  ['#F7C0B7', '#F2A69B'],
  ['#F8DDAE', '#F5CE8F'],
  ['#C2E5C8', '#A8D8B0'],
  ['#C3D8F0', '#A9C6E8'],
  ['#D6CAEE', '#C4B3E5'],
] as const;

/** A small card glyph in the slot's color: magnetic stripe and a chip. A shape, never a word. */
const TypeGlyph: React.FC<{u: number; i: number}> = ({u, i}) => {
  const [a, b] = SLOT_COLORS[i % SLOT_COLORS.length];
  const w = 76 * u;
  const h = 52 * u;
  return (
    <div
      style={{
        position: 'relative',
        flex: '0 0 auto',
        width: w,
        height: h,
        borderRadius: 10 * u,
        background: `linear-gradient(150deg, ${a} 0%, ${b} 100%)`,
        boxShadow: `inset 0 ${2 * u}px 0 rgba(255,255,255,.55), 0 ${3 * u}px ${6 * u}px rgba(10,10,10,.10)`,
        overflow: 'hidden',
      }}
    >
      <div style={{position: 'absolute', left: 0, right: 0, top: 10 * u, height: 9 * u, background: 'rgba(24,24,27,.22)'}} />
      <div
        style={{
          position: 'absolute',
          left: 10 * u,
          bottom: 9 * u,
          width: 16 * u,
          height: 12 * u,
          borderRadius: 3 * u,
          background: 'linear-gradient(135deg, #FCEBC6, #E3AE62)',
        }}
      />
    </div>
  );
};

/** The whole scene, sized by `u` (1 = the vertical ad). */
/** `travel` is how far (scene units) a type slides in from: off the frame edge on the vertical ad, a short slide inside the wide panel so no card is cut by the panel edge. */
const Scene: React.FC<{u: number; f: number; fps: number; types: string[]; caption: string | null; travel: number}> = ({u, f, fps, types, caption, travel}) => {
  const list = types.slice(0, 5);
  const n = Math.max(1, list.length);
  const W = 800 * u;
  const slabH = (n <= 3 ? 122 : n === 4 ? 106 : 96) * u;
  const radius = 26 * u;
  const merge = enter(f, fps, T.merge, 16);
  const gap = 18 * u * (1 - merge);
  const stackH = n * slabH + (n - 1) * gap;
  const stagger = n > 1 ? T.spread / (n - 1) : 0;
  const startOf = (i: number) => T.first + i * stagger;
  const landOf = (i: number) => startOf(i) + T.slide - 2;
  // The block settles a touch when it closes, as one.
  const pulse = bump(f, T.merge + 10, 14);
  const outline = enter(f, fps, T.merge + 4, 14);
  const spine = enter(f, fps, T.merge + 6, 18);
  const sheenT = clamp01((f - (T.merge + 8)) / 18);

  return (
    <>
      <div
        style={{
          position: 'relative',
          width: W,
          height: stackH,
          ...P3D,
          transform: `translateZ(${30 * u}px) rotateX(3deg) scale(${1 - 0.012 * pulse})`,
        }}
      >
        {/* one shared shadow and backing once the stack is one block */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: radius,
            background: '#FFFFFF',
            boxShadow: cardShadow(1.15 * u),
            opacity: merge,
          }}
        />
        {list.map((label, i) => {
          const p = enter(f, fps, startOf(i), T.slide);
          const dir = i % 2 === 0 ? -1 : 1;
          const q = 1 - p;
          // A slab dips a little when the next one lands on it.
          const dip = i < n - 1 ? 5 * u * bump(f, landOf(i + 1), 8) : 0;
          const top = (n - 1 - i) * (slabH + gap) + dip;
          const isTop = i === n - 1;
          const isBottom = i === 0;
          const inner = radius * (1 - merge);
          const corners = `${isTop ? radius : inner}px ${isTop ? radius : inner}px ${isBottom ? radius : inner}px ${isBottom ? radius : inner}px`;
          return (
            <div
              key={`${i}-${label}`}
              style={{
                position: 'absolute',
                left: 0,
                top,
                width: W,
                height: slabH,
                boxSizing: 'border-box',
                display: 'flex',
                alignItems: 'center',
                gap: 28 * u,
                padding: `0 ${34 * u}px 0 ${40 * u}px`,
                background: 'linear-gradient(165deg, #FFFFFF 0%, #FFFFFF 55%, #FAFAFB 100%)',
                borderStyle: 'solid',
                borderWidth: 2 * u,
                borderColor: `#EFEFF2 #E4E4E7 ${merge > 0.5 && !isBottom ? '#ECECEF' : '#D5D5DA'} #E4E4E7`,
                borderRadius: corners,
                boxShadow: cardShadow(u * (0.85 - 0.75 * merge)),
                opacity: clamp01(p * 2.2),
                transform:
                  `translate3d(${dir * q * travel * u}px, ${-q * 70 * u}px, ${q * 60 * u}px) ` +
                  `rotateZ(${dir * q * -7 * Math.min(1, travel / 760)}deg) rotateY(${dir * q * 18 * Math.max(0.3, Math.min(1, travel / 760))}deg)`,
              }}
            >
              <TypeGlyph u={u} i={i} />
              <div
                style={{
                  flex: 1,
                  minWidth: 0,
                  fontSize: 46 * u,
                  fontWeight: 800,
                  letterSpacing: TRACK.h2,
                  lineHeight: 1.05,
                  color: COLORS.ink,
                  whiteSpace: 'nowrap',
                }}
              >
                {label}
              </div>
            </div>
          );
        })}
        {/* the spine that binds them: a spectrum bar up the left edge */}
        <div
          style={{
            position: 'absolute',
            left: 14 * u,
            top: 14 * u,
            bottom: 14 * u,
            width: 8 * u,
            borderRadius: 4 * u,
            background: SPECTRUM.replace('90deg', '0deg'),
            transform: `scaleY(${spine})`,
            transformOrigin: '50% 100%',
            opacity: spine,
          }}
        />
        {/* the single outline around the closed stack */}
        <div
          style={{
            position: 'absolute',
            inset: -10 * u,
            borderRadius: radius + 10 * u,
            border: `${4 * u}px solid ${COLORS.accent}`,
            boxShadow: `0 0 0 ${6 * u}px rgba(61,134,240,.12)`,
            opacity: outline,
            transform: `scale(${1.04 - 0.04 * outline})`,
          }}
        />
        {/* a sheen sweeps down the block as it blends into one (decoration) */}
        <Decor>
          {sheenT > 0 && sheenT < 1 ? (
            <div style={{position: 'absolute', inset: 0, borderRadius: radius, overflow: 'hidden', pointerEvents: 'none'}}>
              <div
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  top: -0.4 * stackH + 1.4 * stackH * sheenT,
                  height: 0.4 * stackH,
                  background: 'linear-gradient(180deg, rgba(255,255,255,0), rgba(169,198,232,.32), rgba(255,255,255,0))',
                }}
              />
            </div>
          ) : null}
        </Decor>
      </div>
      {caption ? (
        <div
          style={{
            ...fadeUp(enter(f, fps, T.caption, 14), 18 * u),
            marginTop: 52 * u,
            maxWidth: 880 * u,
            padding: `${18 * u}px ${32 * u}px`,
            borderRadius: 999,
            background: '#EEF4FE',
            border: `${2 * u}px solid ${COLORS.accentLine}`,
            boxShadow: `0 ${4 * u}px 0 -${u}px rgba(61,134,240,.22), 0 ${18 * u}px ${36 * u}px rgba(61,134,240,.16)`,
            fontSize: 40 * u,
            fontWeight: 700,
            color: COLORS.accent,
            letterSpacing: TRACK.body,
            lineHeight: 1.15,
            textAlign: 'center',
            textWrap: 'balance',
          }}
        >
          {caption}
        </div>
      ) : null}
    </>
  );
};

/** Wide scene size against the vertical one. */
const WIDE_U = 1.3;

export const FundingStack: React.FC<FundingStackProps> = (props) => {
  const {f, fps} = useClipTimeline(FUNDING_STACK_BASE, props.durationInFrames, FUNDING_STACK_MIN, FUNDING_STACK_MAX);
  const page =
    props.format === 'wide' ? (
      <SidePanelFrame side={props.side} showSafeZones={props.showSafeZones}>
        <Stage3D f={f} length={FUNDING_STACK_BASE} perspective={2400 * WIDE_U}>
          <Scene u={WIDE_U} f={f} fps={fps} types={props.types} caption={props.caption} travel={70} />
        </Stage3D>
      </SidePanelFrame>
    ) : (
      <BrandFrame showSafeZones={props.showSafeZones}>
        <Stage3D f={f} length={FUNDING_STACK_BASE}>
          <Scene u={1} f={f} fps={fps} types={props.types} caption={props.caption} travel={760} />
        </Stage3D>
      </BrandFrame>
    );
  return <SeeThrough on={props.transparent}>{page}</SeeThrough>;
};

const size = (format?: FundingStackFormat) =>
  format === 'wide' ? {width: WIDE_FRAME.width, height: WIDE_FRAME.height} : {width: FRAME.width, height: FRAME.height};

// Stills:  npx remotion still src/index.ts FundingStack out/funding-stack.png --frame=90
//          npx remotion still src/index.ts FundingStackWide out/funding-stack-wide.png --frame=90
// FundingStack with --props '{"format":"wide"}' is the same as FundingStackWide.
export const FundingStackCompositions: React.FC = () => (
  <>
    <Composition
      id="FundingStack"
      component={FundingStack}
      durationInFrames={FUNDING_STACK_BASE}
      fps={FRAME.fps}
      width={FRAME.width}
      height={FRAME.height}
      defaultProps={fundingStackDefaults}
      calculateMetadata={({props}) => ({durationInFrames: fundingStackDuration(props.durationInFrames), ...size(props.format)})}
    />
    <Composition
      id="FundingStackWide"
      component={FundingStack}
      durationInFrames={FUNDING_STACK_BASE}
      fps={WIDE_FRAME.fps}
      width={WIDE_FRAME.width}
      height={WIDE_FRAME.height}
      defaultProps={{...fundingStackDefaults, format: 'wide' as const}}
      calculateMetadata={({props}) => ({durationInFrames: fundingStackDuration(props.durationInFrames), ...size(props.format)})}
    />
  </>
);
