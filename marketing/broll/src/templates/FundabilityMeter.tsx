import React from 'react';
import {Composition, interpolate} from 'remotion';
import {COLORS, Card3D, Decor, Eyebrow, FRAME, P3D, Stage3D, TAG, TRACK, enter} from '../brand';
import {SeeThrough} from '../brand/Grid';
import {KIT_WIDE, KitFrame, type KitFormat, type KitSide} from '../brand/KitFrame';
import {clampClip, useClipTimeline} from './clipTimeline';

// FundabilityMeter: a fundability meter climbs one notch as each step is checked off. On a floating card the steps sit on a timeline rail, first step at the bottom; as each one is checked, the meter beside it fills that notch and its pointer climbs, until the last step tops it out and the Maximum chip lights. No percentages, no amounts.
//
// Script lines it serves (exact words):
// - VSL: "Every step comes with a timeline, and as you finish each one, you see
//   your fundability climb toward the maximum." (the default props)
// - Capital Blueprint Ad 3: "It gives you a timeline for when you'll be
//   fundable, and you watch your fundability go up as you finish each step."
//   Props: eyebrow "A timeline for when you'll be fundable", maxLabel "Fundable".
//
// Two formats from one component: vertical 1080x1920 (ads; words in the
// text-safe band y 269-1248) and wide 3840x2160 (the sideways 4K VSL and
// thank-you video; everything in one side panel picked by `side`, so the face
// and the captions in the middle stay clear). KitFrame (src/brand/KitFrame.tsx)
// draws both and the see-through card.

export type FundabilityMeterProps = {
  /** "vertical" (1080x1920, ads; the default) or "wide" (3840x2160, the sideways 4K VSL and thank-you video). */
  format?: KitFormat;
  /** Wide only: the side panel everything sits in, so the face and the captions in the middle stay clear. Default "left". */
  side?: KitSide;
  /** The label over the card, in the words of the script line. */
  eyebrow: string;
  /** Two to six steps, first step first. They check off in this order, bottom to top. */
  steps: string[];
  /** The word under the meter. */
  meterLabel: string;
  /** The chip on top of the meter that lights when the last step is checked. */
  maxLabel: string;
  durationInFrames?: number;
  showSafeZones?: boolean;
  /** See-through: no page and no grid, so the clip renders with alpha (README.md). Default false. */
  transparent?: boolean;
};

export const fundabilityMeterDefaults: FundabilityMeterProps = {
  format: 'vertical',
  side: 'left',
  eyebrow: 'Every step comes with a timeline',
  steps: ['Bring balances down', 'Get negative items removed', 'Add to your file', 'Build bank relationships', 'Set up your business data'],
  meterLabel: 'Fundability',
  maxLabel: 'Maximum',
  transparent: false,
};

/** Base length 3.5 s; a shot list may ask for 3 to 4 s (90 to 120 frames). */
export const FUNDABILITY_METER_BASE = 105;
export const FUNDABILITY_METER_MIN = 90;
export const FUNDABILITY_METER_MAX = 120;
/** Frame (on the base timeline) where every step is checked, the meter is full and the chip is lit. */
export const FUNDABILITY_METER_HERO = 100;

export const fundabilityMeterDuration = (requested?: number): number =>
  clampClip(requested, FUNDABILITY_METER_BASE, FUNDABILITY_METER_MIN, FUNDABILITY_METER_MAX);

// ---------------------------------------------------------------------------
// Timeline (frames on the 105-frame base)

const T = {
  eyebrow: 0,
  card: 4,
  rows: 8, // + 3 per row
  firstCheck: 24,
  lastCheck: 76,
  max: 84,
} as const;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

const METER_COL = 214; // the meter column: chip, tube, label
const TUBE_W = 92;
const TUBE_PAD = 9;
const CHECK = 54; // check circle on the timeline rail
const ROW_GAP = 12;

/** The check mark: a short stroke drawn in as `draw` goes 0 to 1. */
const CheckMark: React.FC<{size: number; draw: number; color?: string}> = ({size, draw, color = COLORS.white}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" style={{display: 'block'}}>
    <path
      d="M5.5 12.5 L10 17 L18.5 7.5"
      fill="none"
      stroke={color}
      strokeWidth={3.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      pathLength={1}
      strokeDasharray={1}
      strokeDashoffset={1 - draw}
    />
  </svg>
);

/** One step on the rail: the check circle fills blue and the words go from gray to ink as `on` goes 0 to 1. */
const StepRow: React.FC<{text: string; on: number; show: number; height: number; fontSize: number}> = ({text, on, show, height, fontSize}) => (
  <div
    style={{
      position: 'relative',
      display: 'flex',
      alignItems: 'center',
      gap: 24,
      height,
      opacity: show,
      transform: `translateX(${(1 - show) * 24}px)`,
    }}
  >
    <div
      style={{
        flex: '0 0 auto',
        position: 'relative',
        width: CHECK,
        height: CHECK,
        borderRadius: '50%',
        background: on > 0.02 ? `rgba(61,134,240,${0.12 + 0.88 * on})` : COLORS.white,
        border: `3px solid ${on > 0.5 ? COLORS.accent : COLORS.track}`,
        boxShadow: on > 0.5 ? `0 6px 14px rgba(61,134,240,${0.3 * on}), inset 0 2px 0 rgba(255,255,255,.28)` : '0 3px 8px rgba(10,10,10,.06)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transform: `scale(${1 + 0.14 * Math.sin(Math.PI * clamp01(on))})`,
      }}
    >
      <CheckMark size={CHECK * 0.72} draw={clamp01((on - 0.25) / 0.75)} />
    </div>
    <span
      style={{
        fontSize,
        fontWeight: 600,
        letterSpacing: TRACK.body,
        lineHeight: 1.12,
        textWrap: 'balance',
        color: on > 0.5 ? COLORS.ink : COLORS.gray2,
      }}
    >
      {text}
    </span>
  </div>
);

export const FundabilityMeter: React.FC<FundabilityMeterProps> = ({
  format,
  side,
  eyebrow,
  steps,
  meterLabel,
  maxLabel,
  durationInFrames,
  showSafeZones,
  transparent,
}) => {
  const {f, fps} = useClipTimeline(FUNDABILITY_METER_BASE, durationInFrames, FUNDABILITY_METER_MIN, FUNDABILITY_METER_MAX);
  const L = FUNDABILITY_METER_BASE;
  const list = steps.slice(0, 6);
  const n = Math.max(1, list.length);
  const rowH = n >= 6 ? 74 : n === 5 ? 84 : 96;
  const fontSize = n >= 6 ? 32 : 35;
  const H = n * rowH + (n - 1) * ROW_GAP; // the rail and the tube are this tall

  // When each step is checked, evenly spaced between firstCheck and lastCheck.
  const checkAt = (i: number) => (n === 1 ? T.lastCheck : T.firstCheck + ((T.lastCheck - T.firstCheck) * i) / (n - 1));
  const on = list.map((_, i) => enter(f, fps, checkAt(i), 12));
  const level = on.reduce((a, b) => a + b, 0); // 0 to n, the meter's height in notches
  const fillH = Math.max(0, level * (rowH + ROW_GAP) - ROW_GAP * clamp01(level));
  const maxOn = enter(f, fps, T.max, 12);
  const sheen = interpolate(f, [T.max, T.max + 16], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const pop = 1 + 0.08 * Math.sin(Math.PI * clamp01((f - T.max) / 10));
  const card = enter(f, fps, T.card, 16);

  const tube = (
    <div style={{position: 'relative', width: TUBE_W, height: H}}>
      {/* the glass tube */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: TUBE_W / 2,
          background: 'linear-gradient(90deg, #EDEDF0 0%, #F7F7F9 45%, #E7E7EB 100%)',
          boxShadow: 'inset 0 3px 8px rgba(10,10,10,.10), inset 0 -2px 0 rgba(255,255,255,.8), 0 1px 0 #FFFFFF',
          border: '2px solid #DCDCE1',
        }}
      />
      {/* one notch per step, bottom to top; each fills as its step is checked */}
      {list.map((_, i) => {
        const top = H - (i + 1) * rowH - i * ROW_GAP;
        const r = i === 0 ? `${0}px ${0}px ${TUBE_W / 2 - TUBE_PAD}px ${TUBE_W / 2 - TUBE_PAD}px` : i === n - 1 ? `${TUBE_W / 2 - TUBE_PAD}px ${TUBE_W / 2 - TUBE_PAD}px 0 0` : '8px';
        const shade = n === 1 ? 1 : i / (n - 1);
        const fill = on[i];
        return (
          <div key={i} style={{position: 'absolute', left: TUBE_PAD, right: TUBE_PAD, top: top + 4, height: rowH - 8, borderRadius: r, overflow: 'hidden', background: 'rgba(10,10,10,.035)'}}>
            <div
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                bottom: 0,
                height: `${fill * 100}%`,
                background: `linear-gradient(90deg, ${mix('#8DB7F5', '#2F74DB', shade)} 0%, ${mix('#B5D0FA', '#5A99F3', shade)} 42%, ${mix('#7FAEF3', '#2C67C2', shade)} 100%)`,
                boxShadow: 'inset 0 2px 0 rgba(255,255,255,.45)',
              }}
            />
          </div>
        );
      })}
      {/* the notch lines on the side of the tube */}
      {list.slice(0, -1).map((_, i) => {
        const y = H - (i + 1) * (rowH + ROW_GAP) + ROW_GAP / 2;
        return <div key={i} style={{position: 'absolute', right: -16, top: y - 1.5, width: 12, height: 3, borderRadius: 2, background: COLORS.track}} />;
      })}
      {/* a light sweep up the full tube when it tops out */}
      <Decor>
        {sheen > 0 && sheen < 1 ? (
          <div
            style={{
              position: 'absolute',
              left: TUBE_PAD,
              right: TUBE_PAD,
              top: H * (1 - sheen) - 60,
              height: 120,
              borderRadius: 40,
              background: 'linear-gradient(180deg, rgba(255,255,255,0), rgba(255,255,255,.65), rgba(255,255,255,0))',
            }}
          />
        ) : null}
      </Decor>
      {/* the pointer rides the top of the fill */}
      <div
        style={{
          position: 'absolute',
          left: -34,
          top: H - fillH - 14,
          width: 0,
          height: 0,
          borderTop: '14px solid transparent',
          borderBottom: '14px solid transparent',
          borderLeft: `22px solid ${COLORS.accent}`,
          filter: 'drop-shadow(0 3px 4px rgba(61,134,240,.35))',
          opacity: clamp01(level * 3),
        }}
      />
    </div>
  );

  const okT = TAG.ok;
  const chip = (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 10,
        padding: '12px 20px',
        borderRadius: 999,
        fontSize: 25,
        fontWeight: 700,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        lineHeight: 1,
        whiteSpace: 'nowrap',
        color: maxOn > 0.5 ? okT.fg : COLORS.gray2,
        background: maxOn > 0.5 ? okT.bg : COLORS.white,
        border: `2px solid ${maxOn > 0.5 ? okT.border : COLORS.line}`,
        boxShadow: maxOn > 0.5 ? `0 4px 0 -1px ${okT.border}, 0 12px 26px rgba(62,142,88,${0.22 * maxOn})` : '0 3px 0 -1px #E4E4E7',
        transform: `scale(${pop})`,
      }}
    >
      <span
        style={{
          width: 26,
          height: 26,
          borderRadius: '50%',
          background: maxOn > 0.5 ? okT.fg : COLORS.line,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <CheckMark size={22} draw={maxOn} />
      </span>
      {maxLabel}
    </div>
  );

  const page = (
    <KitFrame format={format} side={side} showSafeZones={showSafeZones}>
      <Stage3D f={f} length={L}>
        <Eyebrow text={eyebrow} progress={enter(f, fps, T.eyebrow, 14)} />
        <div style={{height: 36}} />
        <Card3D enter={card} z={40} tilt={{rx: 2, ry: -4}} elevation={0.7} padding="30px 34px 26px 30px">
          <div style={{display: 'flex', alignItems: 'stretch', gap: 26, ...P3D}}>
            {/* the meter column */}
            <div style={{flex: `0 0 ${METER_COL}px`, display: 'flex', flexDirection: 'column', alignItems: 'center'}}>
              <div style={{height: 58, display: 'flex', alignItems: 'flex-start'}}>{chip}</div>
              <div style={{marginTop: 14}}>{tube}</div>
              <div
                style={{
                  marginTop: 18,
                  fontSize: 26,
                  fontWeight: 700,
                  letterSpacing: '0.14em',
                  textTransform: 'uppercase',
                  color: COLORS.ink2,
                  whiteSpace: 'nowrap',
                }}
              >
                {meterLabel}
              </div>
            </div>
            {/* the steps on their timeline rail, first step at the bottom */}
            <div style={{flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column'}}>
              <div style={{height: 58 + 14}} />
              <div style={{position: 'relative', height: H}}>
                <div
                  style={{position: 'absolute', left: CHECK / 2 - 2, top: rowH / 2, width: 4, height: H - rowH, borderRadius: 2, background: COLORS.line}}
                />
                <div
                  style={{
                    position: 'absolute',
                    left: CHECK / 2 - 2,
                    bottom: rowH / 2,
                    width: 4,
                    height: n === 1 ? 0 : Math.max(0, Math.min(level - 1, n - 1)) * (rowH + ROW_GAP),
                    borderRadius: 2,
                    background: COLORS.accent,
                  }}
                />
                <div style={{position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column-reverse', gap: ROW_GAP}}>
                  {list.map((text, i) => (
                    <StepRow key={`${i}-${text}`} text={text} on={on[i]} show={enter(f, fps, T.rows + i * 3, 12)} height={rowH} fontSize={fontSize} />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </Card3D>
      </Stage3D>
    </KitFrame>
  );
  return <SeeThrough on={transparent}>{page}</SeeThrough>;
};

/** Blend two #RRGGBB colors, t 0 to 1. */
function mix(a: string, b: string, t: number): string {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return `rgb(${pa.map((v, i) => Math.round(v + (pb[i] - v) * t)).join(',')})`;
}

const size = (format?: KitFormat) => (format === 'wide' ? {width: KIT_WIDE.width, height: KIT_WIDE.height} : {width: FRAME.width, height: FRAME.height});

// Stills:  npx remotion still src/index.ts FundabilityMeter out/fundability-meter.png --frame=100
//          npx remotion still src/index.ts FundabilityMeterWide out/fundability-meter-wide.png --frame=100
// FundabilityMeter with --props '{"format":"wide"}' is the same as FundabilityMeterWide.
export const FundabilityMeterCompositions: React.FC = () => (
  <>
    <Composition
      id="FundabilityMeter"
      component={FundabilityMeter}
      durationInFrames={FUNDABILITY_METER_BASE}
      fps={FRAME.fps}
      width={FRAME.width}
      height={FRAME.height}
      defaultProps={fundabilityMeterDefaults}
      calculateMetadata={({props}) => ({durationInFrames: fundabilityMeterDuration(props.durationInFrames), ...size(props.format)})}
    />
    <Composition
      id="FundabilityMeterWide"
      component={FundabilityMeter}
      durationInFrames={FUNDABILITY_METER_BASE}
      fps={KIT_WIDE.fps}
      width={KIT_WIDE.width}
      height={KIT_WIDE.height}
      defaultProps={{...fundabilityMeterDefaults, format: 'wide' as const}}
      calculateMetadata={({props}) => ({durationInFrames: fundabilityMeterDuration(props.durationInFrames), ...size(props.format)})}
    />
  </>
);
