import React from 'react';
import {AbsoluteFill, Composition} from 'remotion';
import {
  BackdropStage,
  BrandFrame,
  COLORS,
  CONTENT,
  Card3D,
  CashStack,
  DASH,
  Decor,
  DollarCounter,
  FONT_FAMILY,
  FRAME,
  FlatCoin,
  Grid,
  MoneyField,
  P3D,
  SPECTRUM,
  Stage3D,
  TRACK,
  TYPE,
  WORDMARK,
  Wordmark,
  cardShadow,
  countUp,
  enter,
  fadeUp,
  progressBetween,
} from '../brand';
import {SeeThrough, useSeeThrough} from '../brand/Grid';
import {clampClip, useClipTimeline} from './clipTimeline';

// MoneyClimb (Unit N1, animation-builds-2026-10-22). Dollar amounts climbing,
// in four modes picked by props, so one template serves every "how much
// money" line: steps (amounts stepping up, $20,000 to $400,000 to a million),
// range (a target range, $250,000 to $400,000), ladder (a monthly ladder up to
// a goal, $10,000 a month up to past $100,000 a month) and single (one income
// bar climbing to over $400,000).
//
// Every amount and word comes from props: the script line, never this file.
// A number counts up and shows with a thousands comma; `text` shows words as
// written. Bar heights and lengths are a picture of "more", never a scale, so
// no axis number is ever drawn.
//
// Two formats from one scene:
// - vertical: 1080x1920 for ads. Every word inside BrandFrame's band (y 269-1248).
// - wide: 3840x2160 (4K) for the VSL and the thank-you video. The whole clip sits
//   in ONE side panel picked by `side`: left x 192-1500 or right x 2340-3648,
//   y 108-1512. Nothing in the middle column (the face) or the bottom 30% (the
//   captions). The panel clips everything, decoration too.
//
// Money in the side gutters and the coin pops are wrapped in Decor, so a
// render with --props '{"checkTextOnly":true}' drops them for the zone scan.

export type MoneyClimbFormat = 'vertical' | 'wide';
export type MoneyClimbSide = 'left' | 'right';
/**
 * steps: amounts stepping up, lowest at the bottom (2 to 4 amounts).
 * range: a low and a high amount on a rising gauge (exactly 2 amounts).
 * ladder: rungs climbing up to `goal`, drawn as the dashed target on top (2 to 4 amounts).
 * single: one amount on a cash tower climbing (1 amount).
 */
export type MoneyClimbMode = 'steps' | 'range' | 'ladder' | 'single';

/** One amount. Give `value` (counts up, shown as $400,000) or `text` (shown as written, e.g. "A million"). */
export type MoneyClimbAmount = {
  value?: number;
  text?: string;
  /** A small word in front of the amount, e.g. "Over", "Even", "Past". */
  prefix?: string | null;
  /** A small line under the amount. */
  label?: string | null;
};

export type MoneyClimbProps = {
  /** "vertical" (1080x1920, ads) or "wide" (3840x2160, the VSL and the thank-you video). */
  format?: MoneyClimbFormat;
  /** Wide only: the side panel the clip sits in, clear of the face. Default "left". */
  side?: MoneyClimbSide;
  mode: MoneyClimbMode;
  eyebrow: string;
  headline: string | null;
  /** Lowest first. steps / ladder: 2 to 4. range: 2 (low, high). single: 1. */
  amounts: MoneyClimbAmount[];
  /** ladder only: the target on top of the ladder. Null in the other modes. */
  goal: MoneyClimbAmount | null;
  /** Small words after every amount, e.g. "a month". Null shows none. Never assumed. */
  unit: string | null;
  /** A chip under the card. Null hides it. */
  footer: string | null;
  durationInFrames?: number;
  showSafeZones?: boolean;
  /** See-through: no page and no grid, so the clip renders with alpha (README.md). Default false. */
  transparent?: boolean;
};

// Defaults: the VSL line "The condition of your credit decides whether you
// walk away with $20,000 in funding or $400,000, even a million across
// multiple businesses."
export const moneyClimbDefaults: MoneyClimbProps = {
  format: 'vertical',
  side: 'left',
  mode: 'steps',
  eyebrow: 'The condition of your credit decides',
  headline: null,
  amounts: [{value: 20000, label: 'In funding'}, {value: 400000}, {value: 1000000, prefix: 'Even', label: 'Across multiple businesses'}],
  goal: null,
  unit: null,
  footer: null,
  transparent: false,
};

/** Base length 3.2 s; a shot list may ask for 2.5 to 4 s (75 to 120 frames). */
export const MONEY_CLIMB_BASE = 96;
export const MONEY_CLIMB_MIN = 75;
export const MONEY_CLIMB_MAX = 120;
/** Frame (on the base timeline) where every amount has landed, in every mode. */
export const MONEY_CLIMB_HERO = 88;

export const moneyClimbDuration = (requested?: number): number => clampClip(requested, MONEY_CLIMB_BASE, MONEY_CLIMB_MIN, MONEY_CLIMB_MAX);

/** The wide frame (4K, 30 fps) and its two side panels (animation-builds-2026-10-22). */
export const WIDE = {width: 3840, height: 2160, fps: 30} as const;
export const WIDE_PANEL = {
  left: {x: 192, y: 108, w: 1308, h: 1404},
  right: {x: 2340, y: 108, w: 1308, h: 1404},
} as const;

// ---------------------------------------------------------------------------
// Sizes. The scene is laid out in vertical-ad units (a 900 x 824 content box)
// and every size is multiplied by `u` (1 = vertical, 1.32 = the wide panel), so
// the 4K version is drawn at 4K, never upscaled.

const BOX = {w: 900, h: CONTENT.bottom - CONTENT.top} as const; // 900 x 824
const CARD_PAD = {y: 34, x: 44} as const;
const FOOTER_H = 112;
const SPINE_W = 66;
/** The see-through header plate's padding, taken off the card height. */
const PLATE_EXTRA = 40;
/** Room under the card so its soft shadow fades out before the band (vertical) or panel (wide) edge. */
const SHADOW_ROOM = 52;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Width of an amount in em of its font size (DollarCounter: "$" 0.6, digit 0.62, comma 0.27). */
const amountEm = (a: MoneyClimbAmount): number => {
  if (a.value === undefined) return (a.text ?? '').length * 0.58;
  const n = String(Math.max(0, Math.round(a.value))).length;
  return 0.62 + 0.62 * n + 0.27 * Math.floor((n - 1) / 3);
};

/** Extra width (em of the amount size) taken by a prefix and the unit, drawn at 0.4 size. */
const sideEm = (a: MoneyClimbAmount, unit: string | null): number => (a.prefix ? a.prefix.length * 0.27 + 0.2 : 0) + (unit ? unit.length * 0.25 + 0.2 : 0);

const headlineSize = (text: string): number => (text.length <= 18 ? 88 : text.length <= 32 ? 76 : 64);

/** Height the eyebrow and headline take above the card, vertical units (an estimate from the text length). */
const headerHeight = (eyebrow: string, headline: string | null): number => {
  const eyebrowLines = Math.ceil((eyebrow.length * 25.5 + 70) / 860);
  let h = eyebrowLines * 37;
  if (headline) {
    const hs = headlineSize(headline);
    h += 20 + Math.min(3, Math.ceil((headline.length * hs * 0.52) / 860)) * hs * 1.04;
  }
  return h + 30;
};

const isNum = (a: MoneyClimbAmount | null | undefined): a is MoneyClimbAmount & {value: number} => !!a && a.value !== undefined;

// ---------------------------------------------------------------------------
// Small pieces

const SmallCaps: React.FC<{
  u: number;
  children: React.ReactNode;
  color?: string;
  style?: React.CSSProperties;
}> = ({u, children, color = COLORS.gray2, style}) => (
  <div
    style={{
      fontSize: 25 * u,
      fontWeight: 600,
      letterSpacing: '0.13em',
      textTransform: 'uppercase',
      color,
      lineHeight: 1.25,
      textWrap: 'balance',
      ...style,
    }}
  >
    {children}
  </div>
);

/** The brand eyebrow (spectrum dash, wide-tracked caps), scaled, and allowed to wrap onto two lines. */
const ClimbEyebrow: React.FC<{u: number; text: string; progress: number}> = ({u, text, progress}) => (
  <div
    style={{
      opacity: progress,
      maxWidth: 860 * u,
      fontSize: TYPE.eyebrow * u,
      fontWeight: 600,
      letterSpacing: TRACK.eyebrow,
      textTransform: 'uppercase',
      color: COLORS.gray,
      lineHeight: 1.25,
      textAlign: 'center',
      textWrap: 'balance',
    }}
  >
    {/* the dash rides in the text, so a two-line eyebrow keeps it beside the first word */}
    <span
      style={{
        display: 'inline-block',
        verticalAlign: 'middle',
        marginRight: DASH.width * 0.56 * u,
        marginTop: -0.2 * TYPE.eyebrow * u,
        width: DASH.width * u,
        height: DASH.height * u,
        borderRadius: DASH.radius * u,
        background: SPECTRUM,
        transform: `scaleX(${progress})`,
        transformOrigin: 'left center',
      }}
    />
    {text}
  </div>
);

/** An amount: optional prefix, the number (rolling digits) or words, optional unit. */
const AmountLine: React.FC<{
  u: number;
  f: number;
  amount: MoneyClimbAmount;
  from: number;
  start: number;
  end: number;
  size: number;
  color: string;
  unit: string | null;
  align?: 'flex-start' | 'center' | 'flex-end';
}> = ({u, f, amount, from, start, end, size, color, unit, align = 'flex-start'}) => {
  const small: React.CSSProperties = {
    fontSize: size * 0.4,
    fontWeight: 600,
    color: COLORS.gray,
    letterSpacing: TRACK.body,
    whiteSpace: 'nowrap',
    lineHeight: 1,
  };
  const wordsIn = progressBetween(f, start, start + 10);
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: align,
        gap: size * 0.16,
        color,
      }}
    >
      {amount.prefix ? <span style={small}>{amount.prefix}</span> : null}
      {amount.value !== undefined ? (
        <DollarCounter value={amount.value} from={Math.min(from, amount.value)} f={f} start={start} end={end} size={size} color={color} />
      ) : (
        <span
          style={{
            ...fadeUp(wordsIn, 14 * u),
            fontSize: size,
            fontWeight: 800,
            letterSpacing: TRACK.num,
            lineHeight: 1.06,
            whiteSpace: 'nowrap',
          }}
        >
          {amount.text ?? ''}
        </span>
      )}
      {unit ? <span style={small}>{unit}</span> : null}
    </div>
  );
};

/** A quick pop of coins and a ring where an amount lands. Decoration only. */
const LandPop: React.FC<{u: number; f: number; at: number; seed: number}> = ({u, f, at, seed}) => {
  const t = (f - at) / 18;
  if (t <= 0 || t >= 1) return null;
  const e = 1 - (1 - t) ** 3;
  const coins = [0, 1, 2, 3, 4, 5];
  return (
    <Decor>
      <div style={{position: 'absolute', left: 0, top: 0, width: 0, height: 0}}>
        <div
          style={{
            position: 'absolute',
            left: -60 * u * e,
            top: -60 * u * e,
            width: 120 * u * e,
            height: 120 * u * e,
            borderRadius: '50%',
            border: `${3 * u}px solid ${COLORS.accent}`,
            opacity: 0.55 * (1 - t),
          }}
        />
        {coins.map((i) => {
          const ang = ((-150 + i * 24 + (seed % 3) * 6) * Math.PI) / 180;
          const dist = (46 + (i % 3) * 16) * u * e;
          const size = (22 + (i % 2) * 8) * u;
          return (
            <div
              key={i}
              style={{
                position: 'absolute',
                left: Math.cos(ang) * dist - size / 2,
                top: Math.sin(ang) * dist + 30 * u * t * t - size / 2,
                opacity: Math.min(1, (1 - t) * 2.2),
                transform: `rotate(${(i - 2.5) * 30 * t}deg)`,
              }}
            >
              <FlatCoin size={size} tone={i % 2 ? 'gold' : 'accent'} />
            </div>
          );
        })}
      </div>
    </Decor>
  );
};

/** A footer chip under the card. */
const Footer: React.FC<{u: number; text: string; progress: number}> = ({u, text, progress}) => (
  <div
    style={{
      ...fadeUp(progress, 18 * u),
      marginTop: 30 * u,
      maxWidth: 860 * u,
      padding: `${16 * u}px ${30 * u}px`,
      borderRadius: 999,
      background: '#EEF4FE',
      border: `${2 * u}px solid ${COLORS.accentLine}`,
      boxShadow: `0 ${4 * u}px 0 ${-1 * u}px rgba(61,134,240,.22), 0 ${18 * u}px ${36 * u}px rgba(61,134,240,.16)`,
      fontSize: 38 * u,
      fontWeight: 700,
      color: COLORS.accent,
      letterSpacing: '-0.015em',
      lineHeight: 1.2,
      textAlign: 'center',
      textWrap: 'balance',
    }}
  >
    {text}
  </div>
);

// ---------------------------------------------------------------------------
// steps and ladder: rungs climbing from the bottom of the card to the top.

type Rung = {
  amount: MoneyClimbAmount;
  goal: boolean;
  top: boolean;
  from: number;
};

const rungTone = (k: number, n: number, r: Rung): string => {
  if (r.goal)
    return 'repeating-linear-gradient(135deg, rgba(61,134,240,.20) 0px, rgba(61,134,240,.20) 10px, rgba(61,134,240,.08) 10px, rgba(61,134,240,.08) 20px)';
  if (r.top) return 'linear-gradient(90deg, #7DB0F6 0%, #3D86F0 55%, #2C67C2 100%)';
  const t = n <= 1 ? 1 : k / (n - 1);
  return t < 0.5 ? 'linear-gradient(90deg, #E4E4E7 0%, #C9CAD1 100%)' : 'linear-gradient(90deg, #DCE7FA 0%, #A9C6F2 100%)';
};

const Ladder: React.FC<{
  p: MoneyClimbProps;
  f: number;
  fps: number;
  u: number;
  cardH: number;
}> = ({p, f, fps, u, cardH}) => {
  const list = p.amounts.slice(0, 4);
  const rungs: Rung[] = list.map((a, i) => ({
    amount: a,
    goal: false,
    top: p.mode === 'steps' && i === list.length - 1,
    from: i > 0 && isNum(list[i - 1]) ? (list[i - 1].value as number) : 0,
  }));
  if (p.mode === 'ladder' && p.goal) {
    const last = list[list.length - 1];
    rungs.push({
      amount: p.goal,
      goal: true,
      top: true,
      from: isNum(last) ? last.value : 0,
    });
  }
  const n = rungs.length;
  const gap = n <= 3 ? 17 : n === 4 ? 13 : 10;
  const at = (k: number) => 12 + k * gap;

  // One size for every rung: the largest that fits the row height and the widest amount.
  const anyLabel = rungs.some((r) => r.amount.label);
  const rowH = (cardH - 2 * CARD_PAD.y * u) / Math.max(1, n);
  const sizeH = (rowH / (1.06 + 0.16 + 0.24 + (anyLabel ? 0.5 : 0) + 0.12)) * 0.95;
  const innerW = (BOX.w - 2 * CARD_PAD.x - SPINE_W) * u;
  const widest = Math.max(...rungs.map((r) => amountEm(r.amount) + sideEm(r.amount, p.unit)));
  const size = clamp(Math.min(sizeH, (innerW / widest) * 0.97), 34 * u, 104 * u);
  const barH = Math.max(12 * u, size * 0.24);

  // The spine climbs from the bottom rung's node to the top one's.
  const climb = n <= 1 ? 1 : rungs.slice(0, -1).reduce((m, _r, j) => m + progressBetween(f, at(j) + 12, at(j + 1) + 6), 0) / (n - 1);
  const nodeY = (k: number) => `${(1 - (k + 0.5) / n) * 100}%`;
  const spineX = 22 * u;

  return (
    <div
      style={{
        position: 'relative',
        height: '100%',
        display: 'flex',
        flexDirection: 'column-reverse',
      }}
    >
      {/* spine track and its climbing fill */}
      {n > 1 ? (
        <>
          <div
            style={{
              position: 'absolute',
              left: spineX - 3 * u,
              width: 6 * u,
              top: nodeY(n - 1),
              bottom: `${(0.5 / n) * 100}%`,
              borderRadius: 3 * u,
              background: COLORS.soft,
              boxShadow: `inset 0 0 0 ${1 * u}px ${COLORS.line}`,
              opacity: enter(f, fps, 8, 12),
            }}
          />
          <div
            style={{
              position: 'absolute',
              left: spineX - 3 * u,
              width: 6 * u,
              bottom: `${(0.5 / n) * 100}%`,
              height: `${((n - 1) / n) * climb * 100}%`,
              borderRadius: 3 * u,
              background: `linear-gradient(0deg, #A9C6F2, ${COLORS.accent})`,
            }}
          />
        </>
      ) : null}
      {rungs.map((r, k) => {
        const t0 = at(k);
        const row = enter(f, fps, t0, 12);
        const grow = progressBetween(f, t0 + 2, t0 + 18);
        const lit = enter(f, fps, t0 + 16, 8);
        const frac = ((k + 1) / n) ** 1.15;
        const color = r.top ? COLORS.accent : COLORS.ink;
        return (
          <div
            key={k}
            style={{
              position: 'relative',
              flex: '1 1 0',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              paddingLeft: SPINE_W * u,
            }}
          >
            {/* node on the spine */}
            <div
              style={{
                position: 'absolute',
                left: spineX - 15 * u,
                top: '50%',
                width: 30 * u,
                height: 30 * u,
                marginTop: -15 * u,
                borderRadius: '50%',
                background: COLORS.white,
                border: `${3 * u}px solid ${lit > 0.5 ? COLORS.accent : COLORS.track}`,
                boxShadow: `0 ${3 * u}px ${8 * u}px rgba(10,10,10,.10)`,
                opacity: row,
                boxSizing: 'border-box',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  inset: 5 * u,
                  borderRadius: '50%',
                  background: r.goal ? COLORS.accent : `linear-gradient(135deg, #6AA4F5, ${COLORS.accent})`,
                  transform: `scale(${lit})`,
                }}
              />
            </div>
            <div style={{...fadeUp(row, 16 * u)}}>
              <AmountLine u={u} f={f} amount={r.amount} from={r.from} start={t0 + 2} end={t0 + 20} size={size} color={color} unit={p.unit} />
            </div>
            <div
              style={{
                position: 'relative',
                marginTop: size * 0.12,
                height: barH,
                borderRadius: barH / 2,
                background: r.goal ? 'transparent' : '#F1F1F4',
                border: r.goal ? `${2.5 * u}px dashed ${COLORS.accentLine}` : undefined,
                boxShadow: r.goal ? undefined : `inset 0 ${1 * u}px ${2 * u}px rgba(10,10,10,.06)`,
                boxSizing: 'border-box',
                opacity: row,
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: `${frac * grow * 100}%`,
                  borderRadius: barH / 2,
                  background: rungTone(k, n, r),
                  boxShadow: r.top && !r.goal ? `0 ${4 * u}px ${12 * u}px rgba(61,134,240,.28)` : undefined,
                  overflow: 'hidden',
                }}
              >
                {/* gloss on the top half */}
                <div
                  style={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    top: 0,
                    height: '45%',
                    background: 'rgba(255,255,255,.35)',
                  }}
                />
              </div>
              {r.top ? (
                <div
                  style={{
                    position: 'absolute',
                    left: `${frac * 100}%`,
                    top: '50%',
                  }}
                >
                  <LandPop u={u} f={f} at={t0 + 18} seed={k} />
                </div>
              ) : null}
            </div>
            {r.amount.label ? (
              <SmallCaps
                u={u}
                color={r.top ? COLORS.accent : COLORS.gray2}
                style={{
                  ...fadeUp(enter(f, fps, t0 + 8, 12), 10 * u),
                  marginTop: size * 0.12,
                }}
              >
                {r.amount.label}
              </SmallCaps>
            ) : null}
          </div>
        );
      })}
    </div>
  );
};

// ---------------------------------------------------------------------------
// range: a low and a high amount on a gauge; the band climbs from one to the other.

const GAUGE = {w: 132, track: 46, low: 0.34, high: 0.86} as const;

const Range: React.FC<{
  p: MoneyClimbProps;
  f: number;
  fps: number;
  u: number;
  cardH: number;
}> = ({p, f, fps, u, cardH}) => {
  const low = p.amounts[0] ?? {text: ''};
  const high = p.amounts[1] ?? p.amounts[0] ?? {text: ''};
  const T = {
    base: [10, 26],
    low: [14, 34],
    word: 30,
    band: [32, 62],
    pop: 62,
  } as const;

  const innerH = cardH - 2 * CARD_PAD.y * u;
  const innerW = (BOX.w - 2 * CARD_PAD.x - GAUGE.w - 30) * u;
  const anyLabel = !!(low.label || high.label);
  const sizeH = (innerH * (GAUGE.high - GAUGE.low)) / (anyLabel ? 2.3 : 1.9);
  const widest = Math.max(amountEm(low) + sideEm(low, p.unit), amountEm(high) + sideEm(high, p.unit));
  const size = clamp(Math.min(sizeH, (innerW / widest) * 0.97, 118 * u), 40 * u, 118 * u);

  const baseFill = progressBetween(f, T.base[0], T.base[1]);
  const band = progressBetween(f, T.band[0], T.band[1]);
  const lowIn = enter(f, fps, T.low[0], 12);
  const highIn = enter(f, fps, T.band[0], 12);
  const knobLow = enter(f, fps, T.base[1] - 4, 10);
  const pos = (v: number) => `${(1 - v) * 100}%`;
  const topNow = GAUGE.low + (GAUGE.high - GAUGE.low) * band;
  const trackX = (GAUGE.w - GAUGE.track) / 2;

  const amountBlock = (a: MoneyClimbAmount, from: number, start: number, end: number, color: string, inP: number, y: number) => (
    <div
      style={{
        position: 'absolute',
        right: 0,
        left: 0,
        top: pos(y),
        transform: `translateY(-50%) translateY(${(1 - inP) * 18 * u}px)`,
        opacity: inP,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        textAlign: 'right',
      }}
    >
      <AmountLine u={u} f={f} amount={a} from={from} start={start} end={end} size={size} color={color} unit={p.unit} align="flex-end" />
      {a.label ? (
        <SmallCaps u={u} color={color === COLORS.accent ? COLORS.accent : COLORS.gray2} style={{marginTop: size * 0.08}}>
          {a.label}
        </SmallCaps>
      ) : null}
    </div>
  );

  return (
    <div style={{display: 'flex', height: '100%', gap: 30 * u}}>
      <div style={{position: 'relative', flex: '1 1 auto'}}>
        {amountBlock(high, isNum(low) ? low.value : 0, T.band[0], T.band[1], COLORS.accent, highIn, GAUGE.high)}
        <div
          style={{
            position: 'absolute',
            right: 0,
            top: pos((GAUGE.low + GAUGE.high) / 2),
            transform: 'translateY(-50%)',
            ...fadeUp(enter(f, fps, T.word, 10), 10 * u),
            fontSize: size * 0.42,
            fontWeight: 600,
            color: COLORS.gray2,
            letterSpacing: TRACK.body,
          }}
        >
          to
        </div>
        {amountBlock(low, 0, T.low[0], T.low[1], COLORS.ink, lowIn, GAUGE.low)}
      </div>
      <div
        style={{
          position: 'relative',
          flex: `0 0 ${GAUGE.w * u}px`,
          opacity: enter(f, fps, 6, 12),
        }}
      >
        {/* ticks: a picture of a scale, no numbers on it */}
        {Array.from({length: 11}, (_, i) => (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: 0,
              width: (i % 5 === 0 ? 22 : 14) * u,
              top: pos(i / 10),
              height: 3 * u,
              marginTop: -1.5 * u,
              borderRadius: 2 * u,
              background: COLORS.line,
            }}
          />
        ))}
        <div
          style={{
            position: 'absolute',
            left: trackX,
            width: GAUGE.track * u,
            top: 0,
            bottom: 0,
            borderRadius: (GAUGE.track / 2) * u,
            background: '#F1F1F4',
            boxShadow: `inset 0 ${2 * u}px ${4 * u}px rgba(10,10,10,.07), inset 0 0 0 ${1 * u}px ${COLORS.line}`,
            overflow: 'hidden',
          }}
        >
          {/* climbing up to the low amount */}
          <div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              height: `${GAUGE.low * baseFill * 100}%`,
              background: 'linear-gradient(0deg, #E4E4E7, #C9D9F5)',
            }}
          />
          {/* the band from the low amount to the high one */}
          <div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: `${GAUGE.low * 100}%`,
              height: `${(topNow - GAUGE.low) * 100}%`,
              background: `linear-gradient(0deg, #7DB0F6, ${COLORS.accent} 60%, #2C67C2)`,
            }}
          >
            <div
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: 0,
                width: '42%',
                background: 'rgba(255,255,255,.28)',
              }}
            />
          </div>
        </div>
        {/* knobs at the low end and riding the top of the band */}
        {[
          {y: GAUGE.low, o: knobLow, ring: COLORS.track},
          {y: topNow, o: highIn, ring: COLORS.accent},
        ].map((k, i) => (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: trackX + (GAUGE.track / 2) * u,
              top: pos(k.y),
              width: 0,
              height: 0,
            }}
          >
            <div
              style={{
                position: 'absolute',
                left: -32 * u,
                top: -32 * u,
                width: 64 * u,
                height: 64 * u,
                borderRadius: '50%',
                background: COLORS.white,
                border: `${5 * u}px solid ${k.ring}`,
                boxShadow: `0 ${4 * u}px 0 ${-1 * u}px rgba(10,10,10,.08), 0 ${10 * u}px ${20 * u}px rgba(10,10,10,.14)`,
                boxSizing: 'border-box',
                opacity: k.o,
                transform: `scale(${0.6 + 0.4 * k.o})`,
              }}
            />
            {i === 1 ? <LandPop u={u} f={f} at={T.pop} seed={1} /> : null}
          </div>
        ))}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// single: one amount, and a cash tower that climbs with it.

const TOWER = {col: 270, bill: 224} as const;

const Single: React.FC<{
  p: MoneyClimbProps;
  f: number;
  fps: number;
  u: number;
  cardH: number;
}> = ({p, f, fps, u, cardH}) => {
  const a = p.amounts[0] ?? {text: ''};
  const T = {count: [10, 62], label: 6} as const;
  const innerH = cardH - 2 * CARD_PAD.y * u;
  const innerW = (BOX.w - 2 * CARD_PAD.x - TOWER.col - 24) * u;
  const prefixLine = a.prefix ? 1 : 0;
  // The prefix and unit sit on their own lines here, so only the number has to fit the width.
  const size = clamp(Math.min((innerW / amountEm(a)) * 0.97, innerH / (1.6 + 0.5 * prefixLine), 132 * u), 44 * u, 132 * u);

  const v = isNum(a) ? countUp(f, T.count[0], T.count[1], 0, a.value) : 0;
  const climb = isNum(a) ? (a.value > 0 ? v / a.value : 1) : progressBetween(f, T.count[0], T.count[1]);
  const towerMax = Math.min(innerH * 0.78, 470 * u);
  const towerH = Math.max(0, towerMax * climb);
  const colIn = enter(f, fps, 6, 14);
  const small: React.CSSProperties = {
    fontSize: size * 0.34,
    fontWeight: 600,
    color: COLORS.gray,
    letterSpacing: TRACK.body,
    lineHeight: 1.15,
  };

  return (
    <div
      style={{
        display: 'flex',
        height: '100%',
        alignItems: 'stretch',
        gap: 24 * u,
      }}
    >
      <div
        style={{
          flex: '1 1 auto',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          minWidth: 0,
        }}
      >
        {a.label ? (
          <SmallCaps
            u={u}
            style={{
              ...fadeUp(enter(f, fps, T.label, 12), 12 * u),
              marginBottom: 14 * u,
            }}
          >
            {a.label}
          </SmallCaps>
        ) : null}
        {a.prefix ? (
          <div
            style={{
              ...small,
              ...fadeUp(enter(f, fps, T.label + 2, 12), 12 * u),
            }}
          >
            {a.prefix}
          </div>
        ) : null}
        <div style={{...fadeUp(enter(f, fps, T.count[0] - 2, 10), 12 * u)}}>
          <AmountLine u={u} f={f} amount={{...a, prefix: null}} from={0} start={T.count[0]} end={T.count[1]} size={size} color={COLORS.accent} unit={null} />
        </div>
        {p.unit ? (
          <div
            style={{
              ...small,
              ...fadeUp(enter(f, fps, T.count[1] - 8, 12), 12 * u),
              marginTop: 4 * u,
            }}
          >
            {p.unit}
          </div>
        ) : null}
      </div>
      <div
        style={{
          position: 'relative',
          flex: `0 0 ${TOWER.col * u}px`,
          opacity: colIn,
          ...P3D,
        }}
      >
        {/* the floor line */}
        <div
          style={{
            position: 'absolute',
            left: 6 * u,
            right: 6 * u,
            bottom: 18 * u,
            height: 3 * u,
            borderRadius: 2 * u,
            background: COLORS.line,
          }}
        />
        {/* the cash tower, growing with the count */}
        <div
          style={{
            position: 'absolute',
            left: ((TOWER.col - TOWER.bill) / 2) * u,
            bottom: 40 * u,
            ...P3D,
          }}
        >
          <CashStack width={TOWER.bill * u} height={towerH} view={{rx: 62, rz: -22}} />
        </div>
        {/* an up arrow riding the top of the tower */}
        <div
          style={{
            position: 'absolute',
            left: '50%',
            bottom: 40 * u + towerH * 0.88 + 96 * u,
            width: 58 * u,
            height: 58 * u,
            marginLeft: -29 * u,
            borderRadius: '50%',
            background: `linear-gradient(160deg, #6AA4F5, ${COLORS.accent} 55%, #2C67C2)`,
            boxShadow: `0 ${6 * u}px ${16 * u}px rgba(61,134,240,.35)`,
            opacity: enter(f, fps, T.count[0], 10),
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <svg width={30 * u} height={30 * u} viewBox="0 0 24 24" style={{display: 'block'}}>
            <path d="M12 20 V5 M5.5 11 L12 4.5 L18.5 11" fill="none" stroke="#FFFFFF" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <div
          style={{
            position: 'absolute',
            left: '50%',
            bottom: 40 * u + towerH * 0.88 + 125 * u,
          }}
        >
          <LandPop u={u} f={f} at={T.count[1] - 2} seed={2} />
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// The scene: eyebrow, headline, the card for the mode, the footer. One column,
// BOX.w x BOX.h vertical units, drawn at scale u.

const Scene: React.FC<{
  p: MoneyClimbProps;
  f: number;
  fps: number;
  u: number;
}> = ({p, f, fps, u}) => {
  // See-through: the eyebrow and headline get their own white plate, so they read over any footage.
  const plate = useSeeThrough();
  const cardH = (BOX.h - headerHeight(p.eyebrow, p.headline) - (plate ? PLATE_EXTRA : 0) - (p.footer ? FOOTER_H : 0) - SHADOW_ROOM) * u;
  const headIn = enter(f, fps, 0, 14);
  const body =
    p.mode === 'range' ? (
      <Range p={p} f={f} fps={fps} u={u} cardH={cardH} />
    ) : p.mode === 'single' ? (
      <Single p={p} f={f} fps={fps} u={u} cardH={cardH} />
    ) : (
      <Ladder p={p} f={f} fps={fps} u={u} cardH={cardH} />
    );
  const lastLand = p.mode === 'range' ? 62 : p.mode === 'single' ? 62 : 70;
  return (
    <div
      style={{
        ...P3D,
        width: BOX.w * u,
        height: BOX.h * u,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'flex-start', // spare height falls under the card, where its shadow fades
      }}
    >
      <div
        style={
          plate
            ? {
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                maxWidth: BOX.w * u,
                padding: `${16 * u}px ${32 * u}px ${p.headline ? 20 * u : 16 * u}px`,
                borderRadius: 26 * u,
                background: 'rgba(255,255,255,.97)',
                boxShadow: cardShadow(0.6 * u),
                opacity: headIn,
                boxSizing: 'border-box',
              }
            : {display: 'flex', flexDirection: 'column', alignItems: 'center'}
        }
      >
        <ClimbEyebrow u={u} text={p.eyebrow} progress={headIn} />
        {p.headline ? (
          <div
            style={{
              ...fadeUp(enter(f, fps, 3, 14), 22 * u),
              marginTop: 20 * u,
              maxWidth: 880 * u,
              fontSize: headlineSize(p.headline) * u,
              fontWeight: 800,
              letterSpacing: TRACK.h1,
              lineHeight: 1.02,
              textAlign: 'center',
              textWrap: 'balance',
            }}
          >
            {p.headline}
          </div>
        ) : null}
      </div>
      <div style={{height: 30 * u, flex: '0 0 auto'}} />
      <Card3D
        enter={enter(f, fps, 5, 16)}
        z={40}
        tilt={{rx: 2, ry: -3}}
        elevation={u}
        radius={30 * u}
        padding={`${CARD_PAD.y * u}px ${CARD_PAD.x * u}px`}
        style={{
          height: cardH,
          boxSizing: 'border-box',
          flex: '0 0 auto',
          borderWidth: 2 * u,
        }}
      >
        {body}
      </Card3D>
      {p.footer ? <Footer u={u} text={p.footer} progress={enter(f, fps, lastLand + 2, 14)} /> : null}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Vertical (ads)

const Vertical: React.FC<{p: MoneyClimbProps; f: number; fps: number}> = ({p, f, fps}) => (
  <BrandFrame
    showSafeZones={p.showSafeZones}
    backdrop={
      <BackdropStage f={f} length={MONEY_CLIMB_BASE}>
        {/* bills rising in the side gutters only, inside the band: never behind a word, never in a corner */}
        <MoneyField
          f={f}
          mode="rise"
          count={4}
          seed="climb-l"
          area={{x: -60, y: 360, w: 180, h: 820}}
          size={[150, 220]}
          depth={[-700, -250]}
          opacity={0.42}
          blur={2}
          appear={enter(f, fps, 8, 20)}
        />
        <MoneyField
          f={f}
          mode="rise"
          count={4}
          seed="climb-r"
          area={{x: 960, y: 360, w: 180, h: 820}}
          size={[150, 220]}
          depth={[-700, -250]}
          opacity={0.42}
          blur={2}
          appear={enter(f, fps, 8, 20)}
        />
      </BackdropStage>
    }
  >
    <Stage3D f={f} length={MONEY_CLIMB_BASE}>
      <Scene p={p} f={f} fps={fps} u={1} />
    </Stage3D>
  </BrandFrame>
);

// ---------------------------------------------------------------------------
// Wide (the VSL and the thank-you video), 3840x2160: one side panel only.

/** Wide scale against the vertical layout: the 900-unit column becomes 1188 px in the 1308 px panel,
 * leaving room for the camera drift and the card shadow inside the panel. */
const WIDE_U = 1.32;

/** Review overlay: the allowed panel in red, the face column and the caption band shaded. */
const WideZoneGuide: React.FC<{side: MoneyClimbSide}> = ({side}) => {
  const z = WIDE_PANEL[side];
  return (
    <AbsoluteFill style={{pointerEvents: 'none'}}>
      <div
        style={{
          position: 'absolute',
          left: 1500,
          width: 840,
          top: 0,
          bottom: 0,
          background: 'rgba(220,38,38,.10)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 1512,
          bottom: 0,
          background: 'rgba(220,38,38,.10)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: z.x,
          top: z.y,
          width: z.w,
          height: z.h,
          border: '6px solid #DC2626',
          boxSizing: 'border-box',
        }}
      />
    </AbsoluteFill>
  );
};

const Wide: React.FC<{p: MoneyClimbProps; f: number; fps: number}> = ({p, f, fps}) => {
  const z = WIDE_PANEL[p.side === 'right' ? 'right' : 'left'];
  const u = WIDE_U;
  const wordTop = 44;
  const boxW = BOX.w * u;
  const boxTop = wordTop + (CONTENT.top - WORDMARK.top) * u;
  return (
    <AbsoluteFill
      style={{
        fontFamily: FONT_FAMILY,
        color: COLORS.ink,
        WebkitFontSmoothing: 'antialiased',
      }}
    >
      <Grid />
      {/* the panel clips everything, so nothing reaches the face or the captions */}
      <div
        style={{
          position: 'absolute',
          left: z.x,
          top: z.y,
          width: z.w,
          height: z.h,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: wordTop,
            display: 'flex',
            justifyContent: 'center',
            opacity: enter(f, fps, 0, 12),
          }}
        >
          <Wordmark width={WORDMARK.width * u} />
        </div>
        <div
          style={{
            position: 'absolute',
            left: (z.w - boxW) / 2,
            top: boxTop,
            width: boxW,
            height: BOX.h * u,
          }}
        >
          <Stage3D f={f} length={MONEY_CLIMB_BASE} perspective={2400 * u}>
            <Scene p={p} f={f} fps={fps} u={u} />
          </Stage3D>
        </div>
      </div>
      {p.showSafeZones ? <WideZoneGuide side={p.side === 'right' ? 'right' : 'left'} /> : null}
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------------------

export const MoneyClimb: React.FC<MoneyClimbProps> = (props) => {
  const {f, fps} = useClipTimeline(MONEY_CLIMB_BASE, props.durationInFrames, MONEY_CLIMB_MIN, MONEY_CLIMB_MAX);
  const page = props.format === 'wide' ? <Wide p={props} f={f} fps={fps} /> : <Vertical p={props} f={f} fps={fps} />;
  return <SeeThrough on={props.transparent}>{page}</SeeThrough>;
};

const size = (format?: MoneyClimbFormat) => (format === 'wide' ? {width: WIDE.width, height: WIDE.height} : {width: FRAME.width, height: FRAME.height});

// Stills:  npx remotion still src/index.ts MoneyClimb out/money-climb.png --frame=88
//          npx remotion still src/index.ts MoneyClimbWide out/money-climb-wide.png --frame=88
// MoneyClimb with --props '{"format":"wide"}' is the same as MoneyClimbWide.
export const MoneyClimbCompositions: React.FC = () => (
  <>
    <Composition
      id="MoneyClimb"
      component={MoneyClimb}
      durationInFrames={MONEY_CLIMB_BASE}
      fps={FRAME.fps}
      width={FRAME.width}
      height={FRAME.height}
      defaultProps={moneyClimbDefaults}
      calculateMetadata={({props}) => ({
        durationInFrames: moneyClimbDuration(props.durationInFrames),
        ...size(props.format),
      })}
    />
    <Composition
      id="MoneyClimbWide"
      component={MoneyClimb}
      durationInFrames={MONEY_CLIMB_BASE}
      fps={WIDE.fps}
      width={WIDE.width}
      height={WIDE.height}
      defaultProps={{...moneyClimbDefaults, format: 'wide' as const}}
      calculateMetadata={({props}) => ({
        durationInFrames: moneyClimbDuration(props.durationInFrames),
        ...size(props.format),
      })}
    />
  </>
);
