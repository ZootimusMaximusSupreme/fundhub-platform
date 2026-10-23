import React from 'react';
import {Composition, spring} from 'remotion';
import {BrandFrame, COLORS, Card3D, Decor, FRAME, P3D, Stage3D, TAG, TRACK, countUp, enter, fadeUp} from '../brand';
import {SeeThrough} from '../brand/Grid';
import {clampClip, useClipTimeline} from './clipTimeline';
import {SidePanelFrame, WIDE_FRAME, type WideSide} from './sidePanel';

// DeadlineClocks (Unit N2, animation-builds-2026-10-22). Two time limits with a guarantee: two stopwatch cards (24 business hours, 72 hours) fill their rings and land, then the guarantee line comes in under them.
//
// Script lines it serves (exact words; the defaults are the VSL's):
// - VSL: "A funding advisor starts on your file within 24 business hours, and
//   your first applications go out within 72." / "If you qualify and we can't
//   fund you, you don't pay."
// - Direct Book Ad 13: "An advisor is on your file inside 24 business hours,
//   applications are out inside 72, and if we miss either one, you pay us nothing."
// - Direct Book Ad 14: "An advisor starts on your file within 24 business
//   hours, and your applications go out within 72. If either deadline slips,
//   you don't pay."
//
// Each clock shows its lead word ("Within", "Inside"), the number counting up
// as the ring fills, its unit, and a short label from the script. The guarantee
// is a prop; null leaves it out. Only script words, never a new number or claim.
//
// Two formats from one scene, sized by one unit `u`:
// - vertical 1080x1920 (ads): inside BrandFrame's band, y 269-1248.
// - wide 3840x2160 (VSL, thank-you): one side panel picked by `side`
//   (sidePanel.tsx), x 192-1500 or 2340-3648, y 108-1512.
// The ring glow and the landing sparkle are wrapped in Decor, so a render with
// --props '{"checkTextOnly":true}' drops them for the safe-zone scan.

export type DeadlineClocksFormat = 'vertical' | 'wide';

export type DeadlineClock = {
  /** The lead word from the script: "Within" or "Inside". */
  lead: string;
  /** The number of hours, as the script says it (24, 72). */
  hours: number;
  /** The unit under the number: "business hours" or "hours". */
  unit: string;
  /** A short label from the script, e.g. "A funding advisor starts on your file". */
  label: string;
};

export type DeadlineClocksProps = {
  /** "vertical" (1080x1920, ads) or "wide" (3840x2160, the VSL and thank-you). */
  format?: DeadlineClocksFormat;
  /** Wide only: which side panel holds the clip. Default "left". */
  side?: WideSide;
  /** Exactly two clocks, in the order the script says them. */
  clocks: DeadlineClock[];
  /** The guarantee line under the clocks. Null leaves it out. */
  guarantee: string | null;
  durationInFrames?: number;
  showSafeZones?: boolean;
  /** See-through: no page and no grid, so the clip renders with alpha (README.md). Default false. */
  transparent?: boolean;
};

export const deadlineClocksDefaults: DeadlineClocksProps = {
  format: 'vertical',
  side: 'left',
  clocks: [
    {lead: 'Within', hours: 24, unit: 'business hours', label: 'A funding advisor starts on your file'},
    {lead: 'Within', hours: 72, unit: 'hours', label: 'Your first applications go out'},
  ],
  guarantee: "If you qualify and we can't fund you, you don't pay.",
  transparent: false,
};

/** Base length 3.2 s; a shot list may ask for 2.5 to 4 s (75 to 120 frames). */
export const DEADLINE_CLOCKS_BASE = 96;
export const DEADLINE_CLOCKS_MIN = 75;
export const DEADLINE_CLOCKS_MAX = 120;
/** Frame (on the base timeline) where both clocks have landed and the guarantee is in. */
export const DEADLINE_CLOCKS_HERO = 84;

export const deadlineClocksDuration = (requested?: number): number =>
  clampClip(requested, DEADLINE_CLOCKS_BASE, DEADLINE_CLOCKS_MIN, DEADLINE_CLOCKS_MAX);

// ---------------------------------------------------------------------------
// Timeline (frames on the 96-frame base)

const T = {
  clocks: [
    {card: 2, sweep: 8, land: 36},
    {card: 14, sweep: 22, land: 52},
  ],
  guarantee: 58,
} as const;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

const CheckBadge: React.FC<{size: number; pop: number}> = ({size, pop}) => (
  <div
    style={{
      width: size,
      height: size,
      borderRadius: '50%',
      background: `linear-gradient(160deg, #57A872 0%, ${TAG.ok.fg} 100%)`,
      boxShadow: `0 ${size * 0.08}px ${size * 0.2}px rgba(62,142,88,.35), inset 0 ${size * 0.04}px 0 rgba(255,255,255,.35)`,
      border: `${size * 0.06}px solid #FFFFFF`,
      boxSizing: 'border-box',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      opacity: clamp01(pop * 3),
      transform: `scale(${pop})`,
    }}
  >
    <svg width={size * 0.5} height={size * 0.5} viewBox="0 0 24 24">
      <path d="M 4.5 12.5 L 9.5 17.5 L 19.5 6.5" fill="none" stroke="#FFFFFF" strokeWidth={3.4} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  </div>
);

/** A stopwatch face: tick ring, the filling progress ring, the crown on top, and the number and unit in the middle. */
const Dial: React.FC<{u: number; f: number; fps: number; clock: DeadlineClock; at: {sweep: number; land: number}}> = ({u, f, fps, clock, at}) => {
  const D = 272 * u;
  const p = clamp01((f - at.sweep) / (at.land - at.sweep));
  const eased = 1 - (1 - p) ** 3;
  const value = Math.round(countUp(f, at.sweep, at.land, 0, clock.hours));
  const landed = spring({frame: f - at.land, fps, config: {damping: 11, stiffness: 190, mass: 0.6}});
  const R = 41; // ring radius in the 100-unit view box
  const C = 2 * Math.PI * R;
  const head = (eased * 360 - 90) * (Math.PI / 180);
  const sparkle = clamp01((f - at.land) / 14);
  const id = `dc-${clock.hours}-${clock.unit.length}`;
  return (
    <div style={{position: 'relative', width: D, height: D + 26 * u}}>
      {/* crown and side button, drawn first so the face sits over their bases */}
      <div
        style={{
          position: 'absolute',
          left: D / 2 - 24 * u,
          top: 0,
          width: 48 * u,
          height: 22 * u,
          borderRadius: 7 * u,
          background: 'linear-gradient(180deg, #F4F4F6 0%, #D9DAE0 100%)',
          border: `${2 * u}px solid #D2D3D9`,
          boxSizing: 'border-box',
          transform: `translateY(${2 * u * Math.sin(Math.PI * clamp01((f - at.sweep) / 5))}px)`,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: D / 2 - 8 * u,
          top: 18 * u,
          width: 16 * u,
          height: 14 * u,
          background: '#D2D3D9',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: D * 0.82,
          top: 26 * u + D * 0.06,
          width: 30 * u,
          height: 16 * u,
          borderRadius: 6 * u,
          background: 'linear-gradient(180deg, #F4F4F6 0%, #D9DAE0 100%)',
          border: `${2 * u}px solid #D2D3D9`,
          boxSizing: 'border-box',
          transform: 'rotate(45deg)',
        }}
      />
      <div style={{position: 'absolute', left: 0, top: 26 * u, width: D, height: D}}>
        {/* soft blue glow behind the face while it fills (decoration) */}
        <Decor>
          <div
            style={{
              position: 'absolute',
              inset: -18 * u,
              borderRadius: '50%',
              background: 'radial-gradient(closest-side, rgba(61,134,240,.20), rgba(61,134,240,0))',
              opacity: 0.4 + 0.6 * eased,
            }}
          />
        </Decor>
        <svg width={D} height={D} viewBox="0 0 100 100" style={{position: 'absolute', inset: 0, overflow: 'visible'}}>
          <defs>
            <linearGradient id={`${id}-ring`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#6FA6F5" />
              <stop offset="100%" stopColor={COLORS.accent} />
            </linearGradient>
            <radialGradient id={`${id}-face`} cx="0.42" cy="0.32" r="0.75">
              <stop offset="0%" stopColor="#FFFFFF" />
              <stop offset="100%" stopColor="#F2F3F6" />
            </radialGradient>
          </defs>
          {/* the case */}
          <circle cx={50} cy={50} r={49} fill="#FFFFFF" stroke="#DADBE0" strokeWidth={1} />
          <circle cx={50} cy={50} r={47} fill={`url(#${id}-face)`} />
          {/* minute ticks around the edge; the ones the ring has passed turn blue */}
          {Array.from({length: 60}, (_, i) => {
            const a = (i * 6 - 90) * (Math.PI / 180);
            const long = i % 5 === 0;
            const r1 = long ? 31.5 : 33;
            const r2 = 35;
            const passed = i / 60 < eased && p > 0;
            return (
              <line
                key={i}
                x1={50 + r1 * Math.cos(a)}
                y1={50 + r1 * Math.sin(a)}
                x2={50 + r2 * Math.cos(a)}
                y2={50 + r2 * Math.sin(a)}
                stroke={passed ? COLORS.accent : '#C9CAD1'}
                strokeOpacity={passed ? 0.9 : 0.8}
                strokeWidth={long ? 1.3 : 0.7}
                strokeLinecap="round"
              />
            );
          })}
          {/* the track and the progress ring */}
          <circle cx={50} cy={50} r={R} fill="none" stroke={COLORS.soft} strokeWidth={6} />
          <circle
            cx={50}
            cy={50}
            r={R}
            fill="none"
            stroke={`url(#${id}-ring)`}
            strokeWidth={6}
            strokeLinecap="round"
            strokeDasharray={`${C * eased} ${C}`}
            transform="rotate(-90 50 50)"
            opacity={p > 0 ? 1 : 0}
          />
          {/* the bright head of the ring */}
          {p > 0 && p < 1 ? <circle cx={50 + R * Math.cos(head)} cy={50 + R * Math.sin(head)} r={2.2} fill="#FFFFFF" /> : null}
        </svg>
        {/* the number and its unit */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            paddingBottom: 4 * u,
          }}
        >
          <div
            style={{
              fontSize: 96 * u,
              fontWeight: 800,
              letterSpacing: TRACK.num,
              lineHeight: 0.95,
              fontVariantNumeric: 'tabular-nums',
              color: p >= 1 ? COLORS.accent : COLORS.ink,
              transform: `scale(${1 + 0.06 * Math.sin(Math.PI * clamp01((f - at.land) / 8))})`,
            }}
          >
            {value}
          </div>
          <div
            style={{
              marginTop: 4 * u,
              maxWidth: 140 * u,
              fontSize: 19 * u,
              fontWeight: 700,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              textAlign: 'center',
              lineHeight: 1.15,
              color: COLORS.gray,
              textWrap: 'balance',
            }}
          >
            {clock.unit}
          </div>
        </div>
        {/* a ring of tiny sparks when it lands (decoration) */}
        <Decor>
          {sparkle > 0 && sparkle < 1
            ? Array.from({length: 10}, (_, i) => {
                const a = ((i * 36 - 90) * Math.PI) / 180;
                const r = (D / 2) * (1.02 + 0.16 * sparkle);
                const s = 9 * u * (1 - sparkle);
                return (
                  <div
                    key={i}
                    style={{
                      position: 'absolute',
                      left: D / 2 + r * Math.cos(a) - s / 2,
                      top: D / 2 + r * Math.sin(a) - s / 2,
                      width: s,
                      height: s,
                      borderRadius: '50%',
                      background: i % 2 ? COLORS.accent : '#F5CE8F',
                      opacity: 1 - sparkle,
                    }}
                  />
                );
              })
            : null}
        </Decor>
        {/* done: a green check at the top right of the face */}
        <div style={{position: 'absolute', right: -6 * u, top: -4 * u}}>
          {landed > 0.001 ? <CheckBadge size={70 * u} pop={landed} /> : null}
        </div>
      </div>
    </div>
  );
};

const ClockCard: React.FC<{u: number; f: number; fps: number; clock: DeadlineClock; i: number}> = ({u, f, fps, clock, i}) => {
  const at = T.clocks[i] ?? T.clocks[T.clocks.length - 1];
  const inP = enter(f, fps, at.card, 18);
  return (
    <Card3D
      enter={inP}
      from="depth"
      z={40 * u}
      tilt={{rx: 2, ry: i === 0 ? 4 : -4}}
      elevation={u}
      radius={34 * u}
      padding={`${28 * u}px ${24 * u}px ${32 * u}px`}
      width={430 * u}
      style={{borderWidth: 2 * u, display: 'flex', flexDirection: 'column', alignItems: 'center'}}
    >
      <div
        style={{
          fontSize: 25 * u,
          fontWeight: 700,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: COLORS.accent,
          lineHeight: 1.2,
          padding: `${7 * u}px ${18 * u}px`,
          borderRadius: 999,
          background: '#EEF4FE',
          border: `${2 * u}px solid ${COLORS.accentLine}`,
          whiteSpace: 'nowrap',
        }}
      >
        {clock.lead}
      </div>
      <div style={{height: 14 * u}} />
      <Dial u={u} f={f} fps={fps} clock={clock} at={at} />
      <div
        style={{
          ...fadeUp(enter(f, fps, at.sweep + 6, 16), 14 * u),
          marginTop: 20 * u,
          maxWidth: 370 * u,
          minHeight: 2 * 1.14 * 36 * u,
          fontSize: 36 * u,
          fontWeight: 700,
          letterSpacing: TRACK.body,
          lineHeight: 1.14,
          textAlign: 'center',
          color: COLORS.ink2,
          textWrap: 'balance',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {clock.label}
      </div>
    </Card3D>
  );
};

const Shield: React.FC<{size: number}> = ({size}) => (
  <svg width={size} height={size * 1.12} viewBox="0 0 40 45" style={{display: 'block', flex: '0 0 auto'}}>
    <defs>
      <linearGradient id="dc-shield" x1="0" y1="0" x2="0.4" y2="1">
        <stop offset="0%" stopColor="#57A872" />
        <stop offset="100%" stopColor={TAG.ok.fg} />
      </linearGradient>
    </defs>
    <path d="M 20 2 L 37 8 C 37 24, 32 36, 20 43 C 8 36, 3 24, 3 8 Z" fill="url(#dc-shield)" stroke="#FFFFFF" strokeWidth={1.5} strokeLinejoin="round" />
    <path d="M 12.5 22.5 L 18 28 L 28 16.5" fill="none" stroke="#FFFFFF" strokeWidth={3.4} strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const GuaranteeCard: React.FC<{u: number; f: number; fps: number; text: string}> = ({u, f, fps, text}) => {
  const inP = enter(f, fps, T.guarantee, 18);
  const shieldPop = spring({frame: f - (T.guarantee + 6), fps, config: {damping: 11, stiffness: 190, mass: 0.6}});
  return (
    <Card3D
      enter={inP}
      from="below"
      z={110 * u}
      elevation={0.8 * u}
      radius={30 * u}
      padding={`${24 * u}px ${40 * u}px`}
      width={860 * u}
      style={{borderWidth: 2 * u, borderColor: `#DDEEE1 ${TAG.ok.border} #BFD8C6 ${TAG.ok.border}`}}
    >
      <div
        style={{
          fontSize: 40 * u,
          fontWeight: 800,
          letterSpacing: TRACK.h2,
          lineHeight: 1.16,
          color: COLORS.ink,
          textAlign: 'center',
          textWrap: 'balance',
        }}
      >
        <span
          style={{
            display: 'inline-block',
            verticalAlign: '-0.28em',
            marginRight: 16 * u,
            transform: `scale(${shieldPop})`,
            opacity: clamp01(shieldPop * 3),
          }}
        >
          <Shield size={50 * u} />
        </span>
        {text}
      </div>
    </Card3D>
  );
};

/** The whole scene, sized by `u` (1 = the vertical ad). */
const Scene: React.FC<{u: number; f: number; fps: number; clocks: DeadlineClock[]; guarantee: string | null}> = ({u, f, fps, clocks, guarantee}) => (
  <>
    <div style={{display: 'flex', gap: 30 * u, alignItems: 'stretch', ...P3D}}>
      {clocks.slice(0, 2).map((c, i) => (
        <ClockCard key={`${c.hours}-${c.label}`} u={u} f={f} fps={fps} clock={c} i={i} />
      ))}
    </div>
    {guarantee ? (
      <div style={{marginTop: 34 * u, ...P3D}}>
        <GuaranteeCard u={u} f={f} fps={fps} text={guarantee} />
      </div>
    ) : null}
  </>
);

/** Wide scene size against the vertical one. */
const WIDE_U = 1.2;

export const DeadlineClocks: React.FC<DeadlineClocksProps> = (props) => {
  const {f, fps} = useClipTimeline(DEADLINE_CLOCKS_BASE, props.durationInFrames, DEADLINE_CLOCKS_MIN, DEADLINE_CLOCKS_MAX);
  const page =
    props.format === 'wide' ? (
      <SidePanelFrame side={props.side} showSafeZones={props.showSafeZones}>
        <Stage3D f={f} length={DEADLINE_CLOCKS_BASE} perspective={2400 * WIDE_U}>
          <Scene u={WIDE_U} f={f} fps={fps} clocks={props.clocks} guarantee={props.guarantee} />
        </Stage3D>
      </SidePanelFrame>
    ) : (
      <BrandFrame showSafeZones={props.showSafeZones}>
        <Stage3D f={f} length={DEADLINE_CLOCKS_BASE} style={{paddingBottom: 50}}>
          <Scene u={1} f={f} fps={fps} clocks={props.clocks} guarantee={props.guarantee} />
        </Stage3D>
      </BrandFrame>
    );
  return <SeeThrough on={props.transparent}>{page}</SeeThrough>;
};

const size = (format?: DeadlineClocksFormat) =>
  format === 'wide' ? {width: WIDE_FRAME.width, height: WIDE_FRAME.height} : {width: FRAME.width, height: FRAME.height};

// Stills:  npx remotion still src/index.ts DeadlineClocks out/deadline-clocks.png --frame=84
//          npx remotion still src/index.ts DeadlineClocksWide out/deadline-clocks-wide.png --frame=84
// DeadlineClocks with --props '{"format":"wide"}' is the same as DeadlineClocksWide.
export const DeadlineClocksCompositions: React.FC = () => (
  <>
    <Composition
      id="DeadlineClocks"
      component={DeadlineClocks}
      durationInFrames={DEADLINE_CLOCKS_BASE}
      fps={FRAME.fps}
      width={FRAME.width}
      height={FRAME.height}
      defaultProps={deadlineClocksDefaults}
      calculateMetadata={({props}) => ({durationInFrames: deadlineClocksDuration(props.durationInFrames), ...size(props.format)})}
    />
    <Composition
      id="DeadlineClocksWide"
      component={DeadlineClocks}
      durationInFrames={DEADLINE_CLOCKS_BASE}
      fps={WIDE_FRAME.fps}
      width={WIDE_FRAME.width}
      height={WIDE_FRAME.height}
      defaultProps={{...deadlineClocksDefaults, format: 'wide' as const}}
      calculateMetadata={({props}) => ({durationInFrames: deadlineClocksDuration(props.durationInFrames), ...size(props.format)})}
    />
  </>
);
