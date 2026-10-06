import React from 'react';
import {Img, staticFile} from 'remotion';
import {
  BackdropStage,
  BrandFrame,
  CARD_EDGE,
  COLORS,
  CONTENT_WIDTH,
  Card3D,
  Eyebrow,
  MoneyField,
  Stage3D,
  TAG,
  TRACK,
  enter,
  fadeUp,
} from '../brand';
import {SCROLL_BANKS, type ScrollBank} from '../data/lenderMatchScroll';
import {useClipTimeline} from './clipTimeline';

// A list of 59 real banks scrolls from the top of the list to the bottom on a
// 3D drum. Each row has the bank's logo (the CRM's own logo file) and the three
// bureaus with a status for each, heavily blurred: you can tell the data is
// there, but you cannot read it. The list slows and settles, then one clear
// line lands: "30–50 lenders matched to your file" (9/30 /watch VSL P4).
//
// Data: src/data/lenderMatchScroll.ts, baked from the CRM lenders table by
// scripts/bake-lender-scroll.mjs. The blurred statuses are each bank's real
// bureaus_pulled; the blurred line under the name is its real lender_table.
// No amounts and no approval words anywhere.

export type LenderMatchScrollProps = {
  eyebrow: string;
  /** Header over the logo column. */
  bankHeader: string;
  /** The three bureau column headers, in order: Experian, Equifax, TransUnion. */
  bureauHeaders: [string, string, string];
  /** Blurred chip words for a bureau the bank pulls / does not pull. */
  pulledLabel: string;
  notPulledLabel: string;
  /** The big number on the ending line. Empty string shows the words alone. */
  count: string;
  /** The words of the ending line. */
  countLabel: string;
  durationInFrames?: number;
  showSafeZones?: boolean;
};

export const LENDER_MATCH_SCROLL_BASE = 120; // 4.0 s
export const LENDER_MATCH_SCROLL_HERO = 116;
export const LENDER_MATCH_SCROLL_MIN = 105; // 3.5 s
export const LENDER_MATCH_SCROLL_MAX = 135; // 4.5 s

export const lenderMatchScrollDefaults: LenderMatchScrollProps = {
  eyebrow: 'Matching your file',
  bankHeader: 'Bank',
  bureauHeaders: ['Experian', 'Equifax', 'TransUnion'],
  pulledLabel: 'Pulls',
  notPulledLabel: 'No pull',
  count: '30–50',
  countLabel: 'lenders matched to your file',
};

// Panel and drum geometry (content box is 900 wide).
const PAD_X = 20;
const HEADER_H = 64;
const VIEW_H = 500; // the window the list scrolls through
const ROW_H = 100;
const RADIUS = Math.round(VIEW_H / 2 / Math.sin((40 * Math.PI) / 180)); // ~389: the window shows about 40 degrees each way
const STEP_DEG = (ROW_H / RADIUS) * (180 / Math.PI); // angle between rows on the drum
const LOGO_TILE = 72;
const LOGO_IMG = 56;
const CHIP_COL = 136; // one bureau column
const ROW_W = CONTENT_WIDTH - PAD_X * 2;

// Scroll timing (template frames): rest, speed up, run, slow down, settle.
const N = SCROLL_BANKS.length;
const FROM = 2; // the list starts with row 2 on the center line (rows 0 and 1 above it)
const TO = N - 3; // and settles with two banks still below the center line
const SCROLL = {start: 10, accel: 10, stop: 98, decel: 34} as const;
const DECEL_POWER = 2.2;

/** How far the list has scrolled (in rows) and how fast (rows per frame). */
const scrollAt = (f: number): {p: number; v: number} => {
  const dist = TO - FROM;
  const cruise = SCROLL.stop - SCROLL.decel - SCROLL.start - SCROLL.accel;
  const vmax = dist / (SCROLL.accel / 3 + cruise + SCROLL.decel / (DECEL_POWER + 1));
  const t = f - SCROLL.start;
  if (t <= 0) return {p: FROM, v: 0};
  if (t < SCROLL.accel) {
    const u = t / SCROLL.accel;
    return {p: FROM + (vmax * SCROLL.accel * u ** 3) / 3, v: vmax * u * u};
  }
  const pa = (vmax * SCROLL.accel) / 3;
  if (t < SCROLL.accel + cruise) return {p: FROM + pa + vmax * (t - SCROLL.accel), v: vmax};
  const u = Math.min(1, (t - SCROLL.accel - cruise) / SCROLL.decel);
  if (u >= 1) return {p: TO, v: 0};
  return {
    p: FROM + pa + vmax * cruise + ((vmax * SCROLL.decel) / (DECEL_POWER + 1)) * (1 - (1 - u) ** (DECEL_POWER + 1)),
    v: vmax * (1 - u) ** DECEL_POWER,
  };
};

/** A tiny padlock (the data is locked). */
const Lock: React.FC<{size?: number; color?: string}> = ({size = 18, color = COLORS.gray2}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" style={{display: 'block', flex: '0 0 auto'}}>
    <rect x={5} y={10.5} width={14} height={10} rx={2.5} fill={color} />
    <path d="M8.2 10.5V8a3.8 3.8 0 0 1 7.6 0v2.5" fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" />
  </svg>
);

/** One bureau status chip. The words are real (from the CRM) and blurred so they cannot be read. */
const StatusChip: React.FC<{pulled: boolean; pulledLabel: string; notPulledLabel: string}> = ({pulled, pulledLabel, notPulledLabel}) => {
  const t = pulled ? TAG.ok : {fg: COLORS.gray, border: COLORS.track, bg: COLORS.soft};
  return (
    <div style={{width: CHIP_COL, display: 'flex', justifyContent: 'center'}}>
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          padding: '9px 14px',
          borderRadius: 12,
          background: t.bg,
          border: `2px solid ${t.border}`,
          color: t.fg,
          fontSize: 21,
          fontWeight: 700,
          lineHeight: 1,
          whiteSpace: 'nowrap',
          filter: 'blur(7px)',
        }}
      >
        <span style={{width: 9, height: 9, borderRadius: '50%', background: t.fg}} />
        {pulled ? pulledLabel : notPulledLabel}
      </div>
    </div>
  );
};

const Row: React.FC<{bank: ScrollBank; pulledLabel: string; notPulledLabel: string}> = ({bank, pulledLabel, notPulledLabel}) => {
  const products = bank.products.split(' · ');
  const productLine = products.length > 1 ? `${products[0]} +${products.length - 1}` : products[0];
  return (
    <div style={{width: ROW_W, height: ROW_H, display: 'flex', alignItems: 'center'}}>
      <div
        style={{
          width: LOGO_TILE,
          height: LOGO_TILE,
          flex: '0 0 auto',
          borderRadius: 18,
          background: COLORS.white,
          ...CARD_EDGE,
          boxShadow: '0 3px 0 -1px #DCDCE1, 0 8px 16px rgba(10,10,10,.06)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        <Img src={staticFile(bank.logo)} style={{width: LOGO_IMG, height: LOGO_IMG, objectFit: 'contain', display: 'block'}} />
      </div>
      <div style={{flex: '1 1 auto', minWidth: 0, marginLeft: 18}}>
        <div
          style={{
            // long names step down a size so they never run into the bureau columns
            fontSize: bank.name.length > 20 ? 25 : bank.name.length > 16 ? 27 : 29,
            fontWeight: 700,
            letterSpacing: TRACK.body,
            lineHeight: 1.15,
            color: COLORS.ink,
            whiteSpace: 'nowrap',
          }}
        >
          {bank.name}
        </div>
        <div style={{marginTop: 6, fontSize: 20, fontWeight: 600, color: COLORS.gray2, whiteSpace: 'nowrap', filter: 'blur(5px)'}}>{productLine}</div>
      </div>
      <StatusChip pulled={bank.bureaus.EX} pulledLabel={pulledLabel} notPulledLabel={notPulledLabel} />
      <StatusChip pulled={bank.bureaus.EQ} pulledLabel={pulledLabel} notPulledLabel={notPulledLabel} />
      <StatusChip pulled={bank.bureaus.TU} pulledLabel={pulledLabel} notPulledLabel={notPulledLabel} />
    </div>
  );
};

export const LenderMatchScroll: React.FC<LenderMatchScrollProps> = ({
  eyebrow,
  bankHeader,
  bureauHeaders,
  pulledLabel,
  notPulledLabel,
  count,
  countLabel,
  durationInFrames,
  showSafeZones,
}) => {
  const L = LENDER_MATCH_SCROLL_BASE;
  const {f, fps} = useClipTimeline(L, durationInFrames, LENDER_MATCH_SCROLL_MIN, LENDER_MATCH_SCROLL_MAX);
  const {p, v} = scrollAt(f);
  const blur = Math.min(5, v * ROW_H * 0.045); // a light motion blur along the scroll (logos stay recognizable), gone once it slows
  const panel = enter(f, fps, 2, 18);
  const result = enter(f, fps, SCROLL.stop + 2, 16);

  const rows: React.ReactNode[] = [];
  for (let a = Math.floor(p) - 4; a <= Math.floor(p) + 4; a++) {
    if (a < 0 || a >= N) continue;
    const deg = (p - a) * STEP_DEG; // rows above the center line (a < p) turn up and away
    if (Math.abs(deg) > 62) continue;
    const c = Math.cos((deg * Math.PI) / 180);
    rows.push(
      <div
        key={a}
        style={{
          position: 'absolute',
          left: PAD_X,
          top: (VIEW_H - ROW_H) / 2,
          width: ROW_W,
          height: ROW_H,
          transform: `translateZ(${-RADIUS}px) rotateX(${deg}deg) translateZ(${RADIUS}px)`,
          backfaceVisibility: 'hidden',
          background: COLORS.white,
          borderTop: `2px solid ${COLORS.soft}`,
          opacity: Math.max(0, Math.min(1, (c - 0.6) / 0.3)),
        }}
      >
        <Row bank={SCROLL_BANKS[a]} pulledLabel={pulledLabel} notPulledLabel={notPulledLabel} />
      </div>,
    );
  }

  const headerStyle: React.CSSProperties = {fontSize: 22, fontWeight: 700, letterSpacing: '0.02em', color: COLORS.gray, whiteSpace: 'nowrap'};

  return (
    <BrandFrame
      showSafeZones={showSafeZones}
      backdrop={
        <BackdropStage f={f} length={L}>
          {/* faint cash drifting down both sides, behind the list */}
          <MoneyField f={f} mode="drift" count={4} seed="scroll-left" area={{x: -40, y: 260, w: 230, h: 1300}} size={[150, 220]} depth={[-900, -300]} opacity={0.42} blur={2.5} />
          <MoneyField f={f} mode="drift" count={4} seed="scroll-right" area={{x: 890, y: 260, w: 230, h: 1300}} size={[150, 220]} depth={[-900, -300]} opacity={0.42} blur={2.5} />
          {/* as the list settles, bills and coins pop out from behind both sides of the panel */}
          {[
            {seed: 'scroll-burst-l', x: 110},
            {seed: 'scroll-burst-r', x: 970},
          ].map((b) => (
            <MoneyField
              key={b.seed}
              f={f}
              mode="burst"
              kind="mix"
              count={8}
              seed={b.seed}
              from={{x: b.x, y: 780}}
              start={SCROLL.stop - 4}
              end={SCROLL.stop + 8}
              size={[130, 200]}
              depth={[-600, -200]}
              opacity={0.5}
              blur={2}
            />
          ))}
        </BackdropStage>
      }
    >
      <Stage3D f={f} length={L}>
        <Eyebrow text={eyebrow} progress={enter(f, fps, 0, 14)} />
        <div style={{height: 32}} />
        <Card3D enter={panel} z={40} tilt={{rx: 4, ry: -3}} padding={0} radius={30} elevation={1.2} style={{overflow: 'hidden'}}>
          {/* header: the bank column and the three bureaus, each locked */}
          <div
            style={{
              height: HEADER_H,
              padding: `0 ${PAD_X}px`,
              display: 'flex',
              alignItems: 'center',
              borderBottom: `2px solid ${COLORS.line}`,
              background: '#FAFAFB',
            }}
          >
            <div style={{...headerStyle, flex: '1 1 auto'}}>{bankHeader}</div>
            {bureauHeaders.map((h) => (
              <div key={h} style={{width: CHIP_COL, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6}}>
                <Lock size={17} />
                <span style={{...headerStyle, fontSize: 19}}>{h}</span>
              </div>
            ))}
          </div>
          {/* the list window: a drum of rows turning in 3D */}
          <div style={{position: 'relative', height: VIEW_H, overflow: 'hidden', background: '#F7F7F9'}}>
            <svg width={0} height={0} style={{position: 'absolute'}}>
              <filter id="lender-scroll-blur" x="-5%" y="-20%" width="110%" height="140%">
                <feGaussianBlur stdDeviation={`0 ${blur.toFixed(2)}`} />
              </filter>
            </svg>
            <div
              style={{
                position: 'absolute',
                inset: 0,
                perspective: 1300,
                perspectiveOrigin: '50% 50%',
                filter: blur > 0.4 ? 'url(#lender-scroll-blur)' : undefined,
              }}
            >
              {rows}
            </div>
            {/* the drum curves away into shade at the top and bottom of the window */}
            <div
              style={{
                position: 'absolute',
                inset: 0,
                background:
                  'linear-gradient(to bottom, rgba(247,247,249,1) 0%, rgba(247,247,249,.55) 12%, rgba(247,247,249,0) 30%, rgba(247,247,249,0) 70%, rgba(247,247,249,.55) 88%, rgba(247,247,249,1) 100%)',
              }}
            />
          </div>
        </Card3D>
        <div style={{height: 44}} />
        <div style={{...fadeUp(result, 22), display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 26}}>
          {count ? <span style={{fontSize: 108, fontWeight: 800, letterSpacing: TRACK.num, lineHeight: 1, color: COLORS.accent, whiteSpace: 'nowrap'}}>{count}</span> : null}
          <span
            style={{
              maxWidth: count ? 380 : 860,
              fontSize: count ? 42 : 54,
              fontWeight: count ? 700 : 800,
              letterSpacing: TRACK.h2,
              lineHeight: 1.12,
              color: count ? COLORS.ink2 : COLORS.accent,
              textWrap: 'balance',
              textAlign: count ? 'left' : 'center',
            }}
          >
            {countLabel}
          </span>
        </div>
      </Stage3D>
    </BrandFrame>
  );
};
