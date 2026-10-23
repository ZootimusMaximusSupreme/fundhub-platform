import React from 'react';
import {AbsoluteFill, Composition, interpolate} from 'remotion';
import {
  COLORS,
  Card3D,
  CashStack,
  Decor,
  DollarCounter,
  Eyebrow,
  FONT_FAMILY,
  FRAME,
  FlyingBill,
  Grid,
  P3D,
  SAFE,
  SAFE_HEIGHT,
  SafeZoneGuide,
  Stage3D,
  TAG,
  TRACK,
  WORDMARK,
  Wordmark,
  enter,
  fadeUp,
  progressBetween,
} from '../brand';
import {SeeThrough, useSeeThrough} from '../brand/Grid';
import {clampClip, useClipTimeline} from './clipTimeline';

// ReturnMultiple (Unit N7, ops/workflows/animation-builds-2026-10-22.md): money goes into a system with proven returns and comes back bigger, about 4x, with no made-up total.
//
// Script line (Direct Book Ad 4): "Every dollar I put into Meta comes back
// about FOUR times, and that's on the low end, so $200,000 run through a system
// that already has proven returns turns into a LOT more than $200,000."
//
// The beat: an "In" card rolls up to $200,000; bills fly from it into a
// spinning ring (the system) that lands on "About 4x"; an "Out" card rises
// with a row of cash stacks (one per x, a picture of size, never a number) and
// says "A LOT more than $200,000". The footer chip says "That's on the low
// end". The template never multiplies: the out side shows only `outText`.
//
// Two formats from one scene:
// - vertical 1080x1920 (ads): the wordmark and the content sit in the
//   text-safe band (y 269-1248).
// - wide 3840x2160 (the sideways 4K VSL and thank-you video): everything sits
//   in ONE side panel picked by `side` (left x 192-1500, right x 2340-3648,
//   both y 108-1512). The middle column (the face) and the bottom 30% (the
//   captions) stay empty. No wordmark in the wide format.
// See-through (`transparent`): no page and no grid; every word and card sits
// on one white plate inside the allowed zone, so it reads over any film.
// Flying bills and cash stacks are wrapped in Decor, so a checkTextOnly render
// keeps only the plate, cards and words.

export type ReturnMultipleFormat = 'vertical' | 'wide';
export type ReturnMultipleSide = 'left' | 'right';

export type ReturnMultipleProps = {
  /** The label over the scene. Null hides it. */
  eyebrow: string | null;
  /** The "In" card: its small label and the dollar amount it rolls up to. */
  inLabel: string;
  inAmount: number;
  /** The ring in the middle: "<lead> <value>x" (About 4x) and the line under it. `value` also sets how many cash stacks come out (1 to 6). */
  multiple: {lead: string; value: number};
  systemLabel: string;
  /** The "Out" card: its small label and its words. Never a computed amount. */
  outLabel: string;
  outText: string;
  /** The last line, in a chip under the scene. Null hides it. */
  footer: string | null;
  /** "vertical" (1080x1920, ads; the default) or "wide" (3840x2160, the sideways 4K VSL and thank-you video). */
  format?: ReturnMultipleFormat;
  /** Wide only: the side panel everything sits in, so the face and the captions in the middle stay clear. Default "left". */
  side?: ReturnMultipleSide;
  durationInFrames?: number;
  showSafeZones?: boolean;
  /** See-through: no page and no grid, so the clip renders with alpha (README.md). Default false. */
  transparent?: boolean;
};

export const returnMultipleDefaults: ReturnMultipleProps = {
  eyebrow: 'Every dollar I put into Meta',
  inLabel: 'In',
  inAmount: 200000,
  multiple: {lead: 'About', value: 4},
  systemLabel: 'Proven returns',
  outLabel: 'Out',
  outText: 'A LOT more than $200,000',
  footer: "That's on the low end",
  format: 'vertical',
  side: 'left',
  transparent: false,
};

/** Base length 3.2 s; a shot list may ask for 2.5 to 4 s (75 to 120 frames). */
export const RETURN_MULTIPLE_BASE = 96;
export const RETURN_MULTIPLE_MIN = 75;
export const RETURN_MULTIPLE_MAX = 120;
/** Frame (on the base timeline) where every beat is on screen. */
export const RETURN_MULTIPLE_HERO = 90;

export const returnMultipleDuration = (requested?: number): number =>
  clampClip(requested, RETURN_MULTIPLE_BASE, RETURN_MULTIPLE_MIN, RETURN_MULTIPLE_MAX);

// ---------------------------------------------------------------------------
// Frame: vertical band or one wide side panel, with the see-through plate.

const WIDE = {width: 3840, height: 2160, fps: 30} as const;
const PANEL = {left: 192, right: 2340, top: 108, width: 1308, height: 1404} as const;
/** The scene is laid out in this box (design px). Vertical draws it 1:1 at y 400; wide scales it into the panel. */
const BOX = {w: 900, h: 800} as const;
const PLATE_PAD = 50;
const SHADOW_ROOM = 40;
const WIDE_SCALE = (PANEL.width - SHADOW_ROOM * 2) / (BOX.w + PLATE_PAD * 2); // 1.228
const VERTICAL_PLATE = {left: 36, top: 277, width: 1008, height: 945} as const; // y 277-1222, inside 269-1248
const VERTICAL_BOX_TOP = 400;

const PLATE_SHADOW = ['0 0 0 1px rgba(10,10,10,.05)', '0 5px 0 -2px #DCDCE1', '0 8px 18px rgba(10,10,10,.16)', '0 2px 6px rgba(10,10,10,.06)'].join(', ');

const Plate: React.FC<{style: React.CSSProperties}> = ({style}) => (
  <div
    style={{
      position: 'absolute',
      borderRadius: 40,
      background: 'linear-gradient(170deg, #FFFFFF 0%, #FFFFFF 60%, #FAFAFB 100%)',
      border: '2px solid #ECECEF',
      boxShadow: PLATE_SHADOW,
      ...style,
    }}
  />
);

const WideZoneGuide: React.FC<{side: ReturnMultipleSide}> = ({side}) => (
  <AbsoluteFill style={{pointerEvents: 'none'}}>
    <div
      style={{
        position: 'absolute',
        left: side === 'right' ? PANEL.right : PANEL.left,
        top: PANEL.top,
        width: PANEL.width,
        height: PANEL.height,
        border: '6px solid #DC2626',
        boxShadow: '0 0 0 9999px rgba(220,38,38,.07)',
      }}
    />
  </AbsoluteFill>
);

const Frame: React.FC<{format?: ReturnMultipleFormat; side?: ReturnMultipleSide; showSafeZones?: boolean; children: React.ReactNode}> = ({
  format = 'vertical',
  side = 'left',
  showSafeZones = false,
  children,
}) => {
  const seeThrough = useSeeThrough();
  const base: React.CSSProperties = {fontFamily: FONT_FAMILY, color: COLORS.ink, WebkitFontSmoothing: 'antialiased'};
  if (format === 'wide') {
    const plateW = (BOX.w + PLATE_PAD * 2) * WIDE_SCALE;
    const plateH = (BOX.h + PLATE_PAD * 2) * WIDE_SCALE;
    const plateX = (PANEL.width - plateW) / 2;
    const plateY = (PANEL.height - plateH) / 2;
    return (
      <AbsoluteFill style={base}>
        <Grid />
        <div
          style={{
            position: 'absolute',
            left: side === 'right' ? PANEL.right : PANEL.left,
            top: PANEL.top,
            width: PANEL.width,
            height: PANEL.height,
            overflow: 'hidden',
          }}
        >
          {seeThrough ? <Plate style={{left: plateX, top: plateY, width: plateW, height: plateH}} /> : null}
          <div
            style={{
              position: 'absolute',
              left: plateX + PLATE_PAD * WIDE_SCALE,
              top: plateY + PLATE_PAD * WIDE_SCALE,
              width: BOX.w,
              height: BOX.h,
              transformOrigin: '0 0',
              transform: `scale(${WIDE_SCALE})`,
            }}
          >
            {children}
          </div>
        </div>
        {showSafeZones ? <WideZoneGuide side={side} /> : null}
      </AbsoluteFill>
    );
  }
  return (
    <AbsoluteFill style={base}>
      <Grid />
      <div style={{position: 'absolute', left: 0, right: 0, top: SAFE.top, height: SAFE_HEIGHT, overflow: 'hidden'}}>
        {seeThrough ? (
          <Plate
            style={{left: VERTICAL_PLATE.left, top: VERTICAL_PLATE.top - SAFE.top, width: VERTICAL_PLATE.width, height: VERTICAL_PLATE.height}}
          />
        ) : null}
        <div style={{position: 'absolute', left: 0, right: 0, top: WORDMARK.top - SAFE.top, display: 'flex', justifyContent: 'center'}}>
          <Wordmark width={WORDMARK.width} />
        </div>
        <div
          style={{
            position: 'absolute',
            left: (FRAME.width - BOX.w) / 2,
            top: VERTICAL_BOX_TOP - SAFE.top,
            width: BOX.w,
            height: BOX.h,
          }}
        >
          {children}
        </div>
      </div>
      {showSafeZones ? <SafeZoneGuide /> : null}
    </AbsoluteFill>
  );
};
// ---------------------------------------------------------------------------
// Pieces

const SMALL_CAPS: React.CSSProperties = {
  fontSize: 22,
  fontWeight: 600,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: COLORS.gray2,
  lineHeight: 1.2,
};

const T = {
  eyebrow: 0,
  inCard: 4,
  count: [6, 30] as const,
  ring: 10,
  bills: [14, 22, 30] as const,
  multiple: 26,
  arrow: 40,
  outCard: 44,
  stacks: [50, 76] as const,
  footer: 66,
};

/** The system: a glossy ring that turns, with the multiple in the middle. */
const Ring: React.FC<{f: number; fps: number; lead: string; value: number; label: string}> = ({f, fps, lead, value, label}) => {
  const inP = enter(f, fps, T.ring, 16);
  const pop = enter(f, fps, T.multiple, 14);
  const turn = interpolate(f, [0, RETURN_MULTIPLE_BASE], [0, 300]);
  const D = 256;
  const valueText = `${Number.isInteger(value) ? value : Math.round(value * 10) / 10}x`;
  return (
    <div style={{...P3D, width: D, display: 'flex', flexDirection: 'column', alignItems: 'center', opacity: inP, transform: `translateZ(${60 - (1 - inP) * 260}px)`}}>
      <div style={{position: 'relative', width: D, height: D}}>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: '50%',
            background: `conic-gradient(from ${turn}deg, #3D86F0 0deg, #A9C6E8 90deg, #C4B3E5 150deg, #3D86F0 230deg, #6FA6F5 300deg, #3D86F0 360deg)`,
            boxShadow: '0 18px 40px rgba(61,134,240,.28), 0 4px 10px rgba(10,10,10,.08)',
          }}
        />
        <div
          style={{
            position: 'absolute',
            inset: 22,
            borderRadius: '50%',
            background: 'linear-gradient(165deg, #FFFFFF 0%, #FFFFFF 60%, #F4F4F5 100%)',
            boxShadow: 'inset 0 4px 10px rgba(10,10,10,.08)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div style={{...SMALL_CAPS, fontSize: 24, color: COLORS.gray, opacity: pop}}>{lead}</div>
          <div
            style={{
              fontSize: 96,
              fontWeight: 800,
              letterSpacing: TRACK.num,
              lineHeight: 1,
              color: COLORS.accent,
              opacity: pop,
              transform: `scale(${0.6 + 0.4 * pop})`,
            }}
          >
            {valueText}
          </div>
        </div>
      </div>
      <div style={{...fadeUp(enter(f, fps, T.multiple + 4, 14)), marginTop: 12, fontSize: 30, fontWeight: 700, letterSpacing: TRACK.body, whiteSpace: 'nowrap'}}>
        {label}
      </div>
    </div>
  );
};

const Arrow: React.FC<{p: number; dir: 'right' | 'down'}> = ({p, dir}) => (
  <svg
    width={dir === 'right' ? 70 : 40}
    height={dir === 'right' ? 40 : 54}
    viewBox={dir === 'right' ? '0 0 70 40' : '0 0 40 54'}
    style={{opacity: p, transform: dir === 'right' ? `translateX(${(1 - p) * -14}px)` : `translateY(${(1 - p) * -14}px)`}}
  >
    {dir === 'right' ? (
      <path d="M4 20 H60 M46 6 L62 20 L46 34" stroke={COLORS.accent} strokeWidth="6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    ) : (
      <path d="M20 4 V46 M6 32 L20 48 L34 32" stroke={COLORS.accent} strokeWidth="6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    )}
  </svg>
);

const Scene: React.FC<ReturnMultipleProps & {f: number; fps: number}> = ({f, fps, eyebrow, inLabel, inAmount, multiple, systemLabel, outLabel, outText, footer}) => {
  const stacks = Math.max(1, Math.min(6, Math.round(multiple.value)));
  const outIn = enter(f, fps, T.outCard, 18);
  return (
    <Stage3D f={f} length={RETURN_MULTIPLE_BASE} drift={0.6} style={{justifyContent: 'flex-start'}}>
      {eyebrow ? (
        <div style={{...fadeUp(enter(f, fps, T.eyebrow, 14)), height: 40}}>
          <Eyebrow text={eyebrow} progress={enter(f, fps, T.eyebrow, 14)} />
        </div>
      ) : null}
      <div style={{...P3D, marginTop: 30, width: 900, display: 'flex', alignItems: 'center', justifyContent: 'space-between'}}>
        <div style={{...P3D, position: 'relative'}}>
          <Card3D enter={enter(f, fps, T.inCard, 16)} from="left" z={30} tilt={{ry: 5}} width={400} padding="32px 34px 30px" radius={32}>
            <div style={SMALL_CAPS}>{inLabel}</div>
            <div style={{marginTop: 10, height: 86, display: 'flex', alignItems: 'center'}}>
              <DollarCounter value={inAmount} f={f} start={T.count[0]} end={T.count[1]} size={74} color={COLORS.ink} />
            </div>
            <div style={{marginTop: 16, height: 70, position: 'relative', ...P3D}}>
              <Decor>
                <div style={{position: 'absolute', left: 10, bottom: 0, ...P3D}}>
                  <CashStack width={150} height={40} view={{rx: 58, rz: -22}} shadow={false} />
                </div>
              </Decor>
            </div>
          </Card3D>
          <Decor>
            {T.bills.map((at, i) => (
              <FlyingBill
                key={at}
                progress={progressBetween(f, at, at + 18)}
                dx={460}
                dy={-100 + i * 16}
                width={110}
                turn={-20 + i * 12}
                style={{left: 260, top: 210}}
              />
            ))}
          </Decor>
        </div>
        <Arrow p={progressBetween(f, 14, 26)} dir="right" />
        <Ring f={f} fps={fps} lead={multiple.lead} value={multiple.value} label={systemLabel} />
      </div>
      <div style={{marginTop: 4, marginLeft: 644}}>
        <Arrow p={progressBetween(f, T.arrow, T.arrow + 10)} dir="down" />
      </div>
      <div style={{...P3D, marginTop: 4}}>
        <Card3D enter={outIn} from="below" z={60} width={900} padding="30px 40px 32px" radius={34}>
          <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24}}>
            <div style={{flex: '1 1 auto'}}>
              <div style={SMALL_CAPS}>{outLabel}</div>
              <div style={{...fadeUp(enter(f, fps, T.outCard + 8, 14)), marginTop: 10, fontSize: 52, fontWeight: 800, letterSpacing: TRACK.h2, lineHeight: 1.05, textWrap: 'balance'}}>
                {outText}
              </div>
            </div>
            <div style={{position: 'relative', flex: '0 0 auto', width: 300, height: 150, ...P3D}}>
              <Decor>
                {Array.from({length: stacks}, (_, i) => {
                  const col = i % 3;
                  const row = Math.floor(i / 3);
                  return (
                    <div key={i} style={{position: 'absolute', left: col * 92 + row * 30, bottom: row * 52, ...P3D}}>
                      <CashStack width={118} height={6 + 56 * progressBetween(f, T.stacks[0] + i * 4, T.stacks[1] - (stacks - 1 - i) * 2)} tone={i === 0 ? 'green' : 'accent'} view={{rx: 58, rz: -22}} shadow={false} />
                    </div>
                  );
                })}
              </Decor>
            </div>
          </div>
        </Card3D>
      </div>
      {footer ? (
        <div style={{marginTop: 30}}>
          <div
            style={{
              ...fadeUp(enter(f, fps, T.footer, 16), 24),
              display: 'inline-flex',
              alignItems: 'center',
              gap: 16,
              padding: '16px 30px',
              borderRadius: 999,
              background: TAG.info.bg,
              border: `2px solid ${TAG.info.border}`,
              boxShadow: '0 10px 24px rgba(61,134,240,.14)',
              fontSize: 32,
              fontWeight: 700,
              letterSpacing: TRACK.body,
              whiteSpace: 'nowrap',
            }}
          >
            <span style={{width: 14, height: 14, borderRadius: '50%', background: COLORS.accent, flex: '0 0 auto'}} />
            {footer}
          </div>
        </div>
      ) : null}
    </Stage3D>
  );
};

// ---------------------------------------------------------------------------

export const ReturnMultiple: React.FC<ReturnMultipleProps> = (props) => {
  const {f, fps} = useClipTimeline(RETURN_MULTIPLE_BASE, props.durationInFrames, RETURN_MULTIPLE_MIN, RETURN_MULTIPLE_MAX);
  const page = (
    <Frame format={props.format} side={props.side} showSafeZones={props.showSafeZones}>
      <Scene {...props} f={f} fps={fps} />
    </Frame>
  );
  return <SeeThrough on={props.transparent}>{page}</SeeThrough>;
};

const size = (format?: ReturnMultipleFormat) => (format === 'wide' ? {width: WIDE.width, height: WIDE.height} : {width: FRAME.width, height: FRAME.height});

// Stills:  npx remotion still src/index.ts ReturnMultiple out/return-multiple.png --frame=90
//          npx remotion still src/index.ts ReturnMultipleWide out/return-multiple-wide.png --frame=90
export const ReturnMultipleCompositions: React.FC = () => (
  <>
    <Composition
      id="ReturnMultiple"
      component={ReturnMultiple}
      durationInFrames={RETURN_MULTIPLE_BASE}
      fps={FRAME.fps}
      width={FRAME.width}
      height={FRAME.height}
      defaultProps={returnMultipleDefaults}
      calculateMetadata={({props}) => ({durationInFrames: returnMultipleDuration(props.durationInFrames), ...size(props.format)})}
    />
    <Composition
      id="ReturnMultipleWide"
      component={ReturnMultiple}
      durationInFrames={RETURN_MULTIPLE_BASE}
      fps={WIDE.fps}
      width={WIDE.width}
      height={WIDE.height}
      defaultProps={{...returnMultipleDefaults, format: 'wide' as const}}
      calculateMetadata={({props}) => ({durationInFrames: returnMultipleDuration(props.durationInFrames), ...size(props.format)})}
    />
  </>
);
