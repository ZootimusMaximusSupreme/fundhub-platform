import React from 'react';
import {AbsoluteFill, Composition, interpolate} from 'remotion';
import {
  COLORS,
  Card3D,
  CashStack,
  Coin,
  Decor,
  DollarCounter,
  Eyebrow,
  FONT_FAMILY,
  FRAME,
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

// CalendarStrip (Unit N7, ops/workflows/animation-builds-2026-10-22.md): a strip of days fills across, the window of days lights up in blue, and the money lands in the account at the end.
//
// Script line (Direct Book Ad 4): "sitting in your account in the next 15 to
// 30 days, depending on what your roadmap takes to get you there."
//
// The beat: a calendar card of days 1 to `toDay` (10 to a row). Days
// `fromDay` to `toDay` are tinted as the window. A fill wipes across the days
// one by one: gray before the window, blue inside it. When it reaches the last
// day a coin drops into the account card ("Sitting in your account") and a
// cash stack rises there. The footer chip says "Depending on what your roadmap
// takes". No dollar amount shows unless `amount` is passed.
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
// The coin and the cash stack are wrapped in Decor, so a checkTextOnly render
// keeps only the plate, cards and words.

export type CalendarStripFormat = 'vertical' | 'wide';
export type CalendarStripSide = 'left' | 'right';

export type CalendarStripProps = {
  /** The label over the scene. Null hides it. */
  eyebrow: string | null;
  /** The window of days, drawn as days fromDay to toDay on a strip of days 1 to toDay (toDay 1 to 40). */
  fromDay: number;
  toDay: number;
  /** The legend next to the blue window on the calendar card. */
  windowLabel: string;
  /** The account card's words, and an optional amount that rolls up there (null shows no amount). */
  accountLabel: string;
  amount: number | null;
  /** The last line, in a chip under the scene. Null hides it. */
  footer: string | null;
  /** "vertical" (1080x1920, ads; the default) or "wide" (3840x2160, the sideways 4K VSL and thank-you video). */
  format?: CalendarStripFormat;
  /** Wide only: the side panel everything sits in, so the face and the captions in the middle stay clear. Default "left". */
  side?: CalendarStripSide;
  durationInFrames?: number;
  showSafeZones?: boolean;
  /** See-through: no page and no grid, so the clip renders with alpha (README.md). Default false. */
  transparent?: boolean;
};

export const calendarStripDefaults: CalendarStripProps = {
  eyebrow: 'In the next 15 to 30 days',
  fromDay: 15,
  toDay: 30,
  windowLabel: '15 to 30 days',
  accountLabel: 'Sitting in your account',
  amount: null,
  footer: 'Depending on what your roadmap takes',
  format: 'vertical',
  side: 'left',
  transparent: false,
};

/** Base length 3.2 s; a shot list may ask for 2.5 to 4 s (75 to 120 frames). */
export const CALENDAR_STRIP_BASE = 96;
export const CALENDAR_STRIP_MIN = 75;
export const CALENDAR_STRIP_MAX = 120;
/** Frame (on the base timeline) where every beat is on screen. */
export const CALENDAR_STRIP_HERO = 90;

export const calendarStripDuration = (requested?: number): number =>
  clampClip(requested, CALENDAR_STRIP_BASE, CALENDAR_STRIP_MIN, CALENDAR_STRIP_MAX);

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

const WideZoneGuide: React.FC<{side: CalendarStripSide}> = ({side}) => (
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

const Frame: React.FC<{format?: CalendarStripFormat; side?: CalendarStripSide; showSafeZones?: boolean; children: React.ReactNode}> = ({
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

const T = {
  eyebrow: 0,
  card: 3,
  tint: 12,
  sweep: [12, 56] as const,
  legend: 20,
  account: 46,
  coin: [56, 70] as const,
  stack: [64, 82] as const,
  footer: 70,
};

const COLS = 10;
const CELL = 76;
const GAP = 10;

const Day: React.FC<{day: number; fill: number; inWindow: boolean; tint: number}> = ({day, fill, inWindow, tint}) => {
  const lit = fill >= 0.55;
  return (
    <div
      style={{
        position: 'relative',
        width: CELL,
        height: CELL,
        borderRadius: 16,
        overflow: 'hidden',
        background: inWindow ? `rgba(61,134,240,${0.1 * tint})` : COLORS.soft,
        border: `2px solid ${inWindow ? `rgba(61,134,240,${0.12 + 0.2 * tint})` : COLORS.line}`,
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: `${fill * 100}%`,
          background: inWindow ? 'linear-gradient(160deg, #6FA6F5 0%, #3D86F0 100%)' : 'linear-gradient(160deg, #E4E4E7 0%, #D4D4D8 100%)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 28,
          fontWeight: 700,
          letterSpacing: TRACK.num,
          color: lit ? (inWindow ? '#FFFFFF' : COLORS.gray) : inWindow ? COLORS.accent : COLORS.gray2,
        }}
      >
        {day}
      </div>
    </div>
  );
};

/** A plain account glyph: a rounded wallet with a clasp. */
const AccountGlyph: React.FC = () => (
  <div
    style={{
      width: 92,
      height: 92,
      borderRadius: 26,
      flex: '0 0 auto',
      background: 'linear-gradient(160deg, #6FA6F5 0%, #3D86F0 100%)',
      boxShadow: '0 10px 22px rgba(61,134,240,.28)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}
  >
    <svg width={52} height={52} viewBox="0 0 52 52">
      <rect x="5" y="12" width="42" height="30" rx="7" fill="none" stroke="#FFFFFF" strokeWidth="4" />
      <path d="M5 20 H47" stroke="#FFFFFF" strokeWidth="4" />
      <rect x="31" y="26" width="16" height="10" rx="4" fill="#FFFFFF" />
    </svg>
  </div>
);

const Scene: React.FC<CalendarStripProps & {f: number; fps: number}> = ({f, fps, eyebrow, fromDay, toDay, windowLabel, accountLabel, amount, footer}) => {
  const last = Math.max(1, Math.min(40, Math.round(toDay)));
  const first = Math.max(1, Math.min(last, Math.round(fromDay)));
  const sweep = interpolate(f, [T.sweep[0], T.sweep[1]], [0, last], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const tint = progressBetween(f, T.tint, T.tint + 12);
  const rows = Math.ceil(last / COLS);
  const coin = progressBetween(f, T.coin[0], T.coin[1]);
  const landed = f >= T.coin[1];
  return (
    <Stage3D f={f} length={CALENDAR_STRIP_BASE} drift={0.6} style={{justifyContent: 'flex-start'}}>
      {eyebrow ? (
        <div style={{...fadeUp(enter(f, fps, T.eyebrow, 14)), height: 40}}>
          <Eyebrow text={eyebrow} progress={enter(f, fps, T.eyebrow, 14)} />
        </div>
      ) : null}
      <div style={{...P3D, marginTop: 28, position: 'relative'}}>
        <Card3D enter={enter(f, fps, T.card, 18)} z={40} width={900} padding="26px 25px 22px" radius={34}>
          <div style={{display: 'grid', gridTemplateColumns: `repeat(${COLS}, ${CELL}px)`, gap: GAP}}>
            {Array.from({length: last}, (_, i) => {
              const d = i + 1;
              return <Day key={d} day={d} fill={Math.max(0, Math.min(1, sweep - i))} inWindow={d >= first} tint={tint} />;
            })}
          </div>
          <div style={{...fadeUp(enter(f, fps, T.legend, 14), 14), marginTop: 18, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12}}>
            <span style={{width: 22, height: 22, borderRadius: 7, background: 'linear-gradient(160deg, #6FA6F5 0%, #3D86F0 100%)'}} />
            <span style={{fontSize: 28, fontWeight: 700, letterSpacing: TRACK.body, color: COLORS.ink2}}>{windowLabel}</span>
          </div>
        </Card3D>
        <Decor>
          {coin > 0 && !landed ? (
            <div
              style={{
                position: 'absolute',
                left: 25 + ((last - 1) % COLS) * (CELL + GAP) + CELL / 2 - 40,
                top: 26 + (rows - 1) * (CELL + GAP) + CELL / 2 - 40 + coin * coin * 220,
                ...P3D,
                transform: `translateZ(${120 - coin * 40}px)`,
                opacity: Math.min(1, coin * 5, (1 - coin) * 6),
              }}
            >
              <Coin size={80} spin={coin * 360} tone="gold" tilt={{rx: 10}} />
            </div>
          ) : null}
        </Decor>
      </div>
      <div style={{...P3D, marginTop: 30}}>
        <Card3D enter={enter(f, fps, T.account, 16)} from="below" z={60} width={900} padding="26px 34px" radius={34}>
          <div style={{display: 'flex', alignItems: 'center', gap: 26}}>
            <AccountGlyph />
            <div style={{flex: '1 1 auto'}}>
              <div style={{fontSize: 44, fontWeight: 800, letterSpacing: TRACK.h2, lineHeight: 1.05}}>{accountLabel}</div>
              {amount !== null ? (
                <div style={{marginTop: 6, height: 60, display: 'flex', alignItems: 'center'}}>
                  <DollarCounter value={amount} f={f} start={T.stack[0]} end={T.stack[1]} size={54} color={COLORS.accent} />
                </div>
              ) : null}
            </div>
            <div style={{position: 'relative', width: 170, height: 110, flex: '0 0 auto', ...P3D}}>
              <Decor>
                <div style={{position: 'absolute', left: 10, bottom: 4, ...P3D}}>
                  <CashStack width={150} height={4 + 60 * progressBetween(f, T.stack[0], T.stack[1])} tone="accent" view={{rx: 58, rz: -22}} shadow={false} />
                </div>
              </Decor>
            </div>
          </div>
        </Card3D>
      </div>
      {footer ? (
        <div style={{marginTop: 36}}>
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

export const CalendarStrip: React.FC<CalendarStripProps> = (props) => {
  const {f, fps} = useClipTimeline(CALENDAR_STRIP_BASE, props.durationInFrames, CALENDAR_STRIP_MIN, CALENDAR_STRIP_MAX);
  const page = (
    <Frame format={props.format} side={props.side} showSafeZones={props.showSafeZones}>
      <Scene {...props} f={f} fps={fps} />
    </Frame>
  );
  return <SeeThrough on={props.transparent}>{page}</SeeThrough>;
};

const size = (format?: CalendarStripFormat) => (format === 'wide' ? {width: WIDE.width, height: WIDE.height} : {width: FRAME.width, height: FRAME.height});

// Stills:  npx remotion still src/index.ts CalendarStrip out/calendar-strip.png --frame=90
//          npx remotion still src/index.ts CalendarStripWide out/calendar-strip-wide.png --frame=90
export const CalendarStripCompositions: React.FC = () => (
  <>
    <Composition
      id="CalendarStrip"
      component={CalendarStrip}
      durationInFrames={CALENDAR_STRIP_BASE}
      fps={FRAME.fps}
      width={FRAME.width}
      height={FRAME.height}
      defaultProps={calendarStripDefaults}
      calculateMetadata={({props}) => ({durationInFrames: calendarStripDuration(props.durationInFrames), ...size(props.format)})}
    />
    <Composition
      id="CalendarStripWide"
      component={CalendarStrip}
      durationInFrames={CALENDAR_STRIP_BASE}
      fps={WIDE.fps}
      width={WIDE.width}
      height={WIDE.height}
      defaultProps={{...calendarStripDefaults, format: 'wide' as const}}
      calculateMetadata={({props}) => ({durationInFrames: calendarStripDuration(props.durationInFrames), ...size(props.format)})}
    />
  </>
);
