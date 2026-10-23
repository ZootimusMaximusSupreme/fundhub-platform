import React from 'react';
import {Composition, Easing, interpolate} from 'remotion';
import {COLORS, Card3D, Decor, Eyebrow, FRAME, P3D, Stage3D, TAG, TRACK, enter, fadeUp} from '../brand';
import {SeeThrough} from '../brand/Grid';
import {KIT_WIDE, KitFrame, type KitFormat, type KitSide} from '../brand/KitFrame';
import {clampClip, useClipTimeline} from './clipTimeline';

// ScoreBadge: credit scores on a 3D card, in one of three modes picked by `mode`. "range": a score gauge whose whole arc, from the low score to the high one, sweeps in lit and gets a green check (we work with every score in it). "threshold": a marker rides the gauge up to one score; that score lands big in the middle and the arc from it to the top lights up ("or higher"). "program": three score badges drop into one dark program box and come out the other side as three identical gray badges, the numbers gone.
//
// Script lines it serves (exact words; only these numbers):
// - Direct Book Ad 16: "We work with credit scores anywhere from 400 to 850"
//   (mode "range"; the default props).
// - Direct Book Ad 16: "they run everybody through the exact same program,
//   whether your credit is an 850, 400, 500" (mode "program").
// - Direct Book Ad 14: "If you have a 780 or higher credit score" (mode
//   "threshold", score 780). Direct Book Ad 13 uses 700; Capital Blueprint Ad 3
//   uses 600.
//
// The gauge's hidden scale (where a threshold or a badge's arc sits) runs from
// 300 to 850, the usual credit score scale. It is never printed; the only
// numbers on screen are the ones in the props.
//
// Two formats from one component: vertical 1080x1920 (ads; words in the
// text-safe band y 269-1248) and wide 3840x2160 (the sideways 4K VSL and
// thank-you video; everything in one side panel picked by `side`). KitFrame
// (src/brand/KitFrame.tsx) draws both and the see-through card.

export type ScoreBadgeMode = 'range' | 'threshold' | 'program';

export type ScoreBadgeProps = {
  /** "vertical" (1080x1920, ads; the default) or "wide" (3840x2160, the sideways 4K VSL and thank-you video). */
  format?: KitFormat;
  /** Wide only: the side panel everything sits in, so the face and the captions in the middle stay clear. Default "left". */
  side?: KitSide;
  /** "range" (the whole span lit as accepted), "threshold" (one score and up) or "program" (three scores, one identical program). */
  mode: ScoreBadgeMode;
  /** The label over the card, in the words of the script line. */
  eyebrow: string;
  /** range: the two ends of the span, and the words in front of them ("Anywhere from" 400 to 850). */
  low: number;
  high: number;
  rangeLead: string;
  /** threshold: the one score, and the words under it. */
  score: number;
  scoreNote: string;
  /** program: the scores that go in (two to four), and the words on the box. */
  scores: number[];
  programLabel: string;
  durationInFrames?: number;
  showSafeZones?: boolean;
  /** See-through: no page and no grid, so the clip renders with alpha (README.md). Default false. */
  transparent?: boolean;
};

export const scoreBadgeDefaults: ScoreBadgeProps = {
  format: 'vertical',
  side: 'left',
  mode: 'range',
  eyebrow: 'We work with credit scores',
  low: 400,
  high: 850,
  rangeLead: 'Anywhere from',
  score: 780,
  scoreNote: 'or higher',
  scores: [850, 400, 500],
  programLabel: 'The exact same program',
  transparent: false,
};

/** Base length 3.2 s; a shot list may ask for 2.5 to 4 s (75 to 120 frames). */
export const SCORE_BADGE_BASE = 96;
export const SCORE_BADGE_MIN = 75;
export const SCORE_BADGE_MAX = 120;
/** Frame (on the base timeline) where every mode has landed: arc lit, check or score in, outputs out. */
export const SCORE_BADGE_HERO = 90;

export const scoreBadgeDuration = (requested?: number): number => clampClip(requested, SCORE_BADGE_BASE, SCORE_BADGE_MIN, SCORE_BADGE_MAX);

// ---------------------------------------------------------------------------
// Shared pieces

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
/** The hidden credit score scale the gauge places scores on (never printed). */
const SCALE = {min: 300, max: 850} as const;
const onScale = (s: number) => clamp01((s - SCALE.min) / (SCALE.max - SCALE.min));

const between = (f: number, a: number, b: number, ease = Easing.inOut(Easing.cubic)) =>
  interpolate(f, [a, b], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease});

/** Score colors along the scale: red low, amber middle, green high. */
const SCORE_STOPS = ['#D9645A', '#E3A93B', '#3E9E5F'] as const;
const hex = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const scoreColor = (t: number): string => {
  const x = clamp01(t) * 2;
  const [a, b] = x <= 1 ? [SCORE_STOPS[0], SCORE_STOPS[1]] : [SCORE_STOPS[1], SCORE_STOPS[2]];
  const k = x <= 1 ? x : x - 1;
  const pa = hex(a);
  const pb = hex(b);
  return `rgb(${pa.map((v, i) => Math.round(v + (pb[i] - v) * k)).join(',')})`;
};

/** A point on a top half-circle: t 0 is the left end, 1 the right end. */
const arcPoint = (cx: number, cy: number, r: number, t: number) => {
  const a = Math.PI * (1 - t);
  return {x: cx + r * Math.cos(a), y: cy - r * Math.sin(a)};
};
const arcPath = (cx: number, cy: number, r: number, t0: number, t1: number) => {
  const p0 = arcPoint(cx, cy, r, t0);
  const p1 = arcPoint(cx, cy, r, t1);
  return `M ${p0.x} ${p0.y} A ${r} ${r} 0 0 1 ${p1.x} ${p1.y}`;
};

/** The check mark, drawn in as `draw` goes 0 to 1. */
const CheckMark: React.FC<{size: number; draw: number; color?: string; width?: number}> = ({size, draw, color = COLORS.white, width = 3.2}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" style={{display: 'block'}}>
    <path
      d="M5.5 12.5 L10 17 L18.5 7.5"
      fill="none"
      stroke={color}
      strokeWidth={width}
      strokeLinecap="round"
      strokeLinejoin="round"
      pathLength={1}
      strokeDasharray={1}
      strokeDashoffset={1 - clamp01(draw)}
    />
  </svg>
);

// The big gauge (range and threshold).
const G = {r: 318, stroke: 58} as const;
const G_W = 2 * (G.r + G.stroke / 2) + 24;
const G_H = G.r + G.stroke / 2 + 18;
const G_CX = G_W / 2;
const G_CY = G.r + G.stroke / 2 + 12;

/** The gauge: a gray track, and a lit arc from `from` to `to` (0 to 1 along the arc) in the score colors. */
const Gauge: React.FC<{id: string; from: number; to: number; track: number; glow: number; children?: React.ReactNode}> = ({id, from, to, track, glow, children}) => (
  <div style={{position: 'relative', width: G_W, height: G_H}}>
    <svg width={G_W} height={G_H} viewBox={`0 0 ${G_W} ${G_H}`} style={{position: 'absolute', inset: 0, overflow: 'visible'}}>
      <defs>
        <linearGradient id={`${id}-lit`} x1={G_CX - G.r} y1={0} x2={G_CX + G.r} y2={0} gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={SCORE_STOPS[0]} />
          <stop offset="50%" stopColor={SCORE_STOPS[1]} />
          <stop offset="100%" stopColor={SCORE_STOPS[2]} />
        </linearGradient>
      </defs>
      {/* track: the thickness edge, then the face */}
      <path d={arcPath(G_CX, G_CY + 6, G.r, 0, 1)} fill="none" stroke="#D9D9DE" strokeWidth={G.stroke} strokeLinecap="round" opacity={track} />
      <path d={arcPath(G_CX, G_CY, G.r, 0, 1)} fill="none" stroke="#EDEDF0" strokeWidth={G.stroke} strokeLinecap="round" opacity={track} />
      <path d={arcPath(G_CX, G_CY, G.r - G.stroke / 2 + 5, 0, 1)} fill="none" stroke="rgba(10,10,10,.05)" strokeWidth={4} opacity={track} />
      {to - from > 0.002 ? (
        <>
          <path d={arcPath(G_CX, G_CY + 6, G.r, from, to)} fill="none" stroke={`url(#${id}-lit)`} strokeWidth={G.stroke} strokeLinecap="round" opacity={0.55} />
          <path d={arcPath(G_CX, G_CY, G.r, from, to)} fill="none" stroke={`url(#${id}-lit)`} strokeWidth={G.stroke} strokeLinecap="round" />
          <path d={arcPath(G_CX, G_CY - G.stroke / 2 + 10, G.r - G.stroke / 2 + 10, from, to)} fill="none" stroke="rgba(255,255,255,.45)" strokeWidth={5} strokeLinecap="round" />
        </>
      ) : null}
      <Decor>
        {glow > 0 ? (
          <path d={arcPath(G_CX, G_CY, G.r, from, to)} fill="none" stroke="rgba(62,158,95,.35)" strokeWidth={G.stroke + 26 * glow} strokeLinecap="round" opacity={(1 - glow) * 0.9} />
        ) : null}
      </Decor>
    </svg>
    {children}
  </div>
);

const NUM: React.CSSProperties = {fontWeight: 800, letterSpacing: TRACK.num, fontVariantNumeric: 'tabular-nums', lineHeight: 1};

// ---------------------------------------------------------------------------
// Mode: range — the whole span sweeps in lit and gets the check.

const T_RANGE = {card: 4, track: 8, sweep: [16, 50] as const, check: 52, line: 58} as const;

const RangeScene: React.FC<{f: number; fps: number; low: number; high: number; rangeLead: string}> = ({f, fps, low, high, rangeLead}) => {
  const sweep = between(f, T_RANGE.sweep[0], T_RANGE.sweep[1]);
  const check = enter(f, fps, T_RANGE.check, 12);
  const glow = between(f, T_RANGE.check, T_RANGE.check + 18, Easing.out(Easing.cubic));
  const end = (t: number, value: number, show: number) => {
    const p = arcPoint(G_CX, G_CY, G.r, t);
    return (
      <div
        style={{
          position: 'absolute',
          left: p.x - 90,
          top: G_CY + G.stroke / 2 + 10,
          width: 180,
          textAlign: 'center',
          fontSize: 44,
          color: COLORS.gray,
          ...NUM,
          ...fadeUp(show, 16),
        }}
      >
        {value}
      </div>
    );
  };
  return (
    <Card3D enter={enter(f, fps, T_RANGE.card, 16)} z={40} tilt={{rx: 3, ry: -3}} elevation={0.7} padding="40px 30px 34px">
      <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center'}}>
        <div style={{position: 'relative', width: G_W, height: G_H + 86}}>
          <Gauge id="range" from={0} to={sweep} track={enter(f, fps, T_RANGE.track, 12)} glow={glow}>
            {/* the check in the middle of the gauge */}
            <div
              style={{
                position: 'absolute',
                left: G_CX - 78,
                top: G_CY - 196,
                width: 156,
                height: 156,
                borderRadius: '50%',
                background: `radial-gradient(circle at 34% 28%, #74C08D 0%, ${TAG.ok.fg} 58%, #2F7346 100%)`,
                boxShadow: `inset 0 3px 0 rgba(255,255,255,.28), 0 14px 30px rgba(62,142,88,${0.32 * check})`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: check,
                transform: `scale(${0.6 + 0.4 * check + 0.06 * Math.sin(Math.PI * clamp01((f - T_RANGE.check) / 12))})`,
              }}
            >
              <CheckMark size={104} draw={clamp01((f - T_RANGE.check - 3) / 9)} width={3.4} />
            </div>
          </Gauge>
          {end(0, low, enter(f, fps, T_RANGE.sweep[0], 12))}
          {end(1, high, enter(f, fps, T_RANGE.sweep[1] - 4, 12))}
        </div>
        <div
          style={{
            ...fadeUp(enter(f, fps, T_RANGE.line, 14), 18),
            marginTop: 6,
            fontSize: 54,
            fontWeight: 700,
            letterSpacing: TRACK.h2,
            color: COLORS.ink,
            lineHeight: 1.1,
            whiteSpace: 'nowrap',
          }}
        >
          {rangeLead} <span style={{color: TAG.ok.fg}}>{low}</span> to <span style={{color: TAG.ok.fg}}>{high}</span>
        </div>
      </div>
    </Card3D>
  );
};

// ---------------------------------------------------------------------------
// Mode: threshold — the marker climbs to the score, the score lands, the arc above it lights.

const T_TH = {card: 4, track: 8, ride: [14, 42] as const, num: 40, lit: [46, 66] as const, note: 58} as const;

const ThresholdScene: React.FC<{f: number; fps: number; score: number; scoreNote: string}> = ({f, fps, score, scoreNote}) => {
  const at = onScale(score);
  const ride = between(f, T_TH.ride[0], T_TH.ride[1]) * at;
  const lit = between(f, T_TH.lit[0], T_TH.lit[1]);
  const num = enter(f, fps, T_TH.num, 14);
  const glow = between(f, T_TH.lit[1], T_TH.lit[1] + 18, Easing.out(Easing.cubic));
  const knob = arcPoint(G_CX, G_CY, G.r, ride);
  return (
    <Card3D enter={enter(f, fps, T_TH.card, 16)} z={40} tilt={{rx: 3, ry: -3}} elevation={0.7} padding="40px 30px 40px">
      <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center'}}>
        <Gauge id="threshold" from={at} to={at + (1 - at) * lit} track={enter(f, fps, T_TH.track, 12)} glow={glow}>
          {/* the tick at the score */}
          {(() => {
            const a = arcPoint(G_CX, G_CY, G.r - G.stroke / 2 - 16, at);
            const b = arcPoint(G_CX, G_CY, G.r + G.stroke / 2 + 16, at);
            return (
              <svg width={G_W} height={G_H} style={{position: 'absolute', inset: 0, overflow: 'visible'}}>
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={COLORS.ink2} strokeWidth={6} strokeLinecap="round" opacity={clamp01((f - T_TH.ride[1] + 4) / 6)} />
              </svg>
            );
          })()}
          {/* the marker riding the arc */}
          <div
            style={{
              position: 'absolute',
              left: knob.x - 38,
              top: knob.y - 38,
              width: 76,
              height: 76,
              borderRadius: '50%',
              background: COLORS.white,
              border: `10px solid ${scoreColor(onScale(SCALE.min + ride * (SCALE.max - SCALE.min)))}`,
              boxShadow: '0 8px 18px rgba(10,10,10,.22), inset 0 -3px 0 rgba(10,10,10,.06)',
              opacity: enter(f, fps, T_TH.ride[0] - 4, 10),
            }}
          />
          {/* the score in the middle */}
          <div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: G_CY - 236,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
            }}
          >
            <div style={{fontSize: 156, color: COLORS.ink, ...NUM, opacity: num, transform: `scale(${0.82 + 0.18 * num})`}}>{score}</div>
            <div
              style={{
                ...fadeUp(enter(f, fps, T_TH.note, 14), 16),
                marginTop: 18,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 12,
                padding: '12px 26px',
                borderRadius: 999,
                background: TAG.ok.bg,
                border: `2px solid ${TAG.ok.border}`,
                color: TAG.ok.fg,
                fontSize: 40,
                fontWeight: 700,
                letterSpacing: '-0.01em',
                whiteSpace: 'nowrap',
              }}
            >
              <svg width={30} height={30} viewBox="0 0 24 24">
                <path d="M12 19 V6 M6 11.5 L12 5.5 L18 11.5" fill="none" stroke={TAG.ok.fg} strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {scoreNote}
            </div>
          </div>
        </Gauge>
      </div>
    </Card3D>
  );
};

// ---------------------------------------------------------------------------
// Mode: program — every score goes into the same box and comes out the same.

const B = {w: 228, h: 168, gap: 36} as const;
const BOX = {h: 168, gapY: 64} as const;
const T_PG = {inAt: 4, drop: 24, dropStep: 8, dropLen: 14, out: 54, outStep: 7, outLen: 14, eq: 80} as const;

/** A score badge: a small gauge in the score's color with the number under it. `blank` is the gray copy that comes out of the program. */
const Badge: React.FC<{score: number | null; style?: React.CSSProperties}> = ({score, style}) => {
  const t = score === null ? 0.5 : onScale(score);
  const color = score === null ? '#A1A1AA' : scoreColor(t);
  const r = 46;
  const w = 2 * r + 24;
  const h = r + 20;
  const cx = w / 2;
  const cy = r + 10;
  return (
    <div
      style={{
        width: B.w,
        height: B.h,
        borderRadius: 30,
        background: score === null ? 'linear-gradient(165deg, #F4F4F5 0%, #ECECEF 100%)' : 'linear-gradient(165deg, #FFFFFF 0%, #FFFFFF 55%, #FAFAFB 100%)',
        borderStyle: 'solid',
        borderWidth: 2,
        borderColor: score === null ? '#E1E1E5 #D9D9DE #CDCDD3 #D9D9DE' : '#EFEFF2 #E4E4E7 #D5D5DA #E4E4E7',
        boxShadow: '0 5px 0 -1px #DCDCE1, 0 14px 26px rgba(10,10,10,.10)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        ...style,
      }}
    >
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
        <path d={arcPath(cx, cy, r, 0, 1)} fill="none" stroke="#E4E4E7" strokeWidth={14} strokeLinecap="round" />
        <path d={arcPath(cx, cy, r, 0, Math.max(0.02, t))} fill="none" stroke={color} strokeWidth={14} strokeLinecap="round" />
      </svg>
      {score === null ? (
        <div style={{width: 112, height: 22, borderRadius: 11, background: '#D4D4D8', marginTop: 10, marginBottom: 12}} />
      ) : (
        <div style={{fontSize: 66, color: COLORS.ink, ...NUM}}>{score}</div>
      )}
    </div>
  );
};

const ProgramScene: React.FC<{f: number; fps: number; scores: number[]; programLabel: string}> = ({f, fps, scores, programLabel}) => {
  const list = scores.slice(0, 4);
  const n = Math.max(1, list.length);
  const bw = n >= 4 ? 190 : B.w;
  const rowW = n * bw + (n - 1) * B.gap;
  const xOf = (i: number) => i * (bw + B.gap);
  const boxTop = B.h + BOX.gapY;
  const outTop = boxTop + BOX.h + BOX.gapY;
  const scale = bw / B.w;
  const busy = between(f, T_PG.drop, T_PG.out + (n - 1) * T_PG.outStep + 6, Easing.linear);
  const shake = busy > 0 && busy < 1 ? Math.sin(f * 2.1) * 3 : 0;
  const boxIn = enter(f, fps, T_PG.inAt + 6, 16);
  return (
    <div style={{position: 'relative', width: Math.max(rowW, 820), height: outTop + B.h, ...P3D}}>
      {/* the scores going in: each badge stays put while its score slides out from under it and drops into the box */}
      {list.map((s, i) => {
        const show = enter(f, fps, T_PG.inAt + i * 3, 14);
        const drop = between(f, T_PG.drop + i * T_PG.dropStep, T_PG.drop + i * T_PG.dropStep + T_PG.dropLen, Easing.in(Easing.cubic));
        const left = (Math.max(rowW, 820) - rowW) / 2 + xOf(i);
        const at: React.CSSProperties = {position: 'absolute', left: left - (B.w - bw) / 2, top: 0, width: B.w, height: B.h, transformOrigin: '50% 0'};
        return (
          <React.Fragment key={`in-${i}`}>
            {drop > 0 && drop < 1 ? (
              <div
                style={{
                  position: 'absolute',
                  left: left + bw / 2 - 80,
                  top: B.h * scale * 0.5 - 34,
                  width: 160,
                  height: 68,
                  borderRadius: 34,
                  background: COLORS.white,
                  border: `4px solid ${scoreColor(onScale(s))}`,
                  boxShadow: '0 10px 20px rgba(10,10,10,.18)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 40,
                  color: COLORS.ink,
                  ...NUM,
                  opacity: 1 - clamp01((drop - 0.75) / 0.25),
                  transform: `translateY(${drop * (boxTop - B.h * scale * 0.5 + 40)}px) scale(${1 - 0.25 * drop})`,
                }}
              >
                {s}
              </div>
            ) : null}
            <div style={{...at, opacity: show, transform: `translateY(${(1 - show) * -26}px) scale(${scale})`}}>
              <Badge score={s} />
            </div>
          </React.Fragment>
        );
      })}
      {/* the program box */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: boxTop,
          height: BOX.h,
          borderRadius: 34,
          background: 'linear-gradient(170deg, #2A2A2F 0%, #18181B 60%, #111114 100%)',
          border: '2px solid #34343A',
          boxShadow: '0 6px 0 -1px #0B0B0D, 0 22px 40px rgba(10,10,10,.28), inset 0 2px 0 rgba(255,255,255,.08)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: boxIn,
          transform: `translate(${shake}px, ${(1 - boxIn) * 30}px)`,
        }}
      >
        {/* the slot on top and the chute at the bottom */}
        <div style={{position: 'absolute', left: '8%', right: '8%', top: 16, height: 14, borderRadius: 7, background: '#050506', boxShadow: 'inset 0 3px 4px rgba(0,0,0,.6)'}} />
        <div style={{position: 'absolute', left: '8%', right: '8%', bottom: 16, height: 14, borderRadius: 7, background: '#050506', boxShadow: 'inset 0 3px 4px rgba(0,0,0,.6)'}} />
        <Decor>
          <div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: 0,
              bottom: 0,
              borderRadius: 34,
              background: `linear-gradient(90deg, rgba(255,255,255,0) ${busy * 140 - 40}%, rgba(255,255,255,.08) ${busy * 140 - 20}%, rgba(255,255,255,0) ${busy * 140}%)`,
            }}
          />
        </Decor>
        <span style={{fontSize: 50, fontWeight: 700, letterSpacing: TRACK.h2, color: COLORS.white, whiteSpace: 'nowrap'}}>{programLabel}</span>
      </div>
      {/* the same thing coming out, every time */}
      {list.map((_, i) => {
        const out = between(f, T_PG.out + i * T_PG.outStep, T_PG.out + i * T_PG.outStep + T_PG.outLen, Easing.out(Easing.cubic));
        const left = (Math.max(rowW, 820) - rowW) / 2 + xOf(i);
        return (
          <div
            key={`out-${i}`}
            style={{
              position: 'absolute',
              left: left - (B.w - bw) / 2,
              top: outTop,
              width: B.w,
              height: B.h,
              opacity: clamp01(out * 3),
              transform: `translateY(${(1 - out) * -(BOX.gapY + 40)}px) scale(${scale * (0.7 + 0.3 * out)})`,
              transformOrigin: '50% 0',
            }}
          >
            <Badge score={null} />
          </div>
        );
      })}
      {/* equals signs between the copies */}
      {list.slice(0, -1).map((_, i) => {
        const eq = enter(f, fps, T_PG.eq + i * 2, 10);
        const left = (Math.max(rowW, 820) - rowW) / 2 + xOf(i) + bw + B.gap / 2;
        return (
          <div
            key={`eq-${i}`}
            style={{position: 'absolute', left: left - 16, top: outTop + B.h * scale / 2 - 14, width: 32, height: 28, opacity: eq, transform: `scale(${0.6 + 0.4 * eq})`}}
          >
            <div style={{position: 'absolute', left: 0, right: 0, top: 2, height: 7, borderRadius: 4, background: COLORS.gray}} />
            <div style={{position: 'absolute', left: 0, right: 0, bottom: 2, height: 7, borderRadius: 4, background: COLORS.gray}} />
          </div>
        );
      })}
    </div>
  );
};

// ---------------------------------------------------------------------------

export const ScoreBadge: React.FC<ScoreBadgeProps> = ({
  format,
  side,
  mode,
  eyebrow,
  low,
  high,
  rangeLead,
  score,
  scoreNote,
  scores,
  programLabel,
  durationInFrames,
  showSafeZones,
  transparent,
}) => {
  const {f, fps} = useClipTimeline(SCORE_BADGE_BASE, durationInFrames, SCORE_BADGE_MIN, SCORE_BADGE_MAX);
  const scene =
    mode === 'program' ? (
      <ProgramScene f={f} fps={fps} scores={scores} programLabel={programLabel} />
    ) : mode === 'threshold' ? (
      <ThresholdScene f={f} fps={fps} score={score} scoreNote={scoreNote} />
    ) : (
      <RangeScene f={f} fps={fps} low={low} high={high} rangeLead={rangeLead} />
    );
  const page = (
    <KitFrame format={format} side={side} showSafeZones={showSafeZones}>
      <Stage3D f={f} length={SCORE_BADGE_BASE}>
        <Eyebrow text={eyebrow} progress={enter(f, fps, 0, 14)} />
        <div style={{height: mode === 'program' ? 46 : 40}} />
        {scene}
      </Stage3D>
    </KitFrame>
  );
  return <SeeThrough on={transparent}>{page}</SeeThrough>;
};

const size = (format?: KitFormat) => (format === 'wide' ? {width: KIT_WIDE.width, height: KIT_WIDE.height} : {width: FRAME.width, height: FRAME.height});

// Stills:  npx remotion still src/index.ts ScoreBadge out/score-badge.png --frame=90
//          npx remotion still src/index.ts ScoreBadgeWide out/score-badge-wide.png --frame=90
// Other modes: --props '{"mode":"threshold","eyebrow":"Credit score","score":780}' or '{"mode":"program","eyebrow":"They run everybody through"}'.
export const ScoreBadgeCompositions: React.FC = () => (
  <>
    <Composition
      id="ScoreBadge"
      component={ScoreBadge}
      durationInFrames={SCORE_BADGE_BASE}
      fps={FRAME.fps}
      width={FRAME.width}
      height={FRAME.height}
      defaultProps={scoreBadgeDefaults}
      calculateMetadata={({props}) => ({durationInFrames: scoreBadgeDuration(props.durationInFrames), ...size(props.format)})}
    />
    <Composition
      id="ScoreBadgeWide"
      component={ScoreBadge}
      durationInFrames={SCORE_BADGE_BASE}
      fps={KIT_WIDE.fps}
      width={KIT_WIDE.width}
      height={KIT_WIDE.height}
      defaultProps={{...scoreBadgeDefaults, format: 'wide' as const}}
      calculateMetadata={({props}) => ({durationInFrames: scoreBadgeDuration(props.durationInFrames), ...size(props.format)})}
    />
  </>
);
