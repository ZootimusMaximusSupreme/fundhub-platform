import React from 'react';
import {
  BackdropStage,
  BrandFrame,
  COLORS,
  CONTENT_WIDTH,
  Card3D,
  Eyebrow,
  MoneyField,
  Stage3D,
  TRACK,
  enter,
  fadeUp,
  progressBetween,
} from '../brand';
import {LENDER_LANDING_DEFAULT, LENDER_NAMES} from '../data/lenders';
import {useClipTimeline} from './clipTimeline';

// A three-reel slot machine that spins through real lender names from the
// bank book (docs/legacy-strong/lenders-legacy-strong.csv, baked into
// src/data/lenders.ts), slows, lands one name per reel, then reads
// "30–50 lenders matched".
//
// Words from the 9/30 /watch VSL (P4): "it matches your file against thousands
// of lenders to find the thirty to fifty that fit you".
//
// Truth rules: only names from the bank book (a name passed in props that is
// not in the baked list is ignored), no amounts anywhere near a lender, and no
// approval words or marks: the reels land, nothing says "approved".

export type LenderSlotsProps = {
  eyebrow: string;
  /** The big number line, e.g. "30–50". Empty string shows the words alone. */
  count: string;
  /** Words after the number, e.g. "lenders matched". */
  countLabel: string;
  /** One name per reel to land on. Must be names in the baked bank-book list. */
  landOn: string[];
  durationInFrames?: number;
  showSafeZones?: boolean;
};

export const LENDER_SLOTS_BASE = 105; // 3.5 s
export const LENDER_SLOTS_HERO = 100;

export const lenderSlotsDefaults: LenderSlotsProps = {
  eyebrow: 'Matching your file',
  count: '30–50',
  countLabel: 'lenders matched',
  landOn: [...LENDER_LANDING_DEFAULT],
};

// Housing and reel geometry (content box is 900 wide).
const REELS = 3;
const PAD = 16; // housing padding
const GAP = 10; // between reels
const REEL_W = Math.floor((CONTENT_WIDTH - PAD * 2 - GAP * (REELS - 1)) / REELS); // 279
const CELL_H = 128; // one name on the reel
const WIN_H = CELL_H * 3; // the window shows the payline and one name above and below
const STEP_DEG = 36; // angle between names on the drum
const RADIUS = CELL_H / (2 * Math.tan(((STEP_DEG / 2) * Math.PI) / 180)); // drum radius

// Spin timing per reel (template frames): start, how long it speeds up, when
// it lands, how long it slows down, and how many names it travels.
const SPIN = [
  {start: 12, accel: 8, stop: 50, decel: 24, names: 17},
  {start: 14, accel: 8, stop: 59, decel: 26, names: 23},
  {start: 16, accel: 8, stop: 68, decel: 28, names: 29},
] as const;
// Each reel walks the list with its own step, so two reels never show the
// same name side by side. Every step is coprime with the list length, so a
// reel still passes every name once per lap.
const STRIDES = [1, 7, 16] as const;
const DECEL_POWER = 2.2; // how the speed falls off into the landing (higher = softer)
const ALL_LANDED = SPIN[REELS - 1].stop;

/** Position (in names travelled) and speed (names per frame) of one reel at frame f. */
const reelAt = (f: number, s: (typeof SPIN)[number]): {p: number; v: number} => {
  const cruise = s.stop - s.decel - s.start - s.accel;
  const vmax = s.names / (s.accel / 3 + cruise + s.decel / (DECEL_POWER + 1));
  const t = f - s.start;
  if (t <= 0) return {p: 0, v: 0};
  if (t < s.accel) {
    const u = t / s.accel;
    return {p: (vmax * s.accel * u ** 3) / 3, v: vmax * u * u};
  }
  const pAccel = (vmax * s.accel) / 3;
  if (t < s.accel + cruise) return {p: pAccel + vmax * (t - s.accel), v: vmax};
  const pCruise = pAccel + vmax * cruise;
  const u = Math.min(1, (t - s.accel - cruise) / s.decel);
  if (u >= 1) return {p: s.names, v: 0};
  return {
    p: pCruise + ((vmax * s.decel) / (DECEL_POWER + 1)) * (1 - (1 - u) ** (DECEL_POWER + 1)),
    v: vmax * (1 - u) ** DECEL_POWER,
  };
};

const mod = (a: number, n: number) => ((a % n) + n) % n;

/** One reel: a real drum of names turning in 3D behind a window. */
const Reel: React.FC<{
  id: string;
  p: number;
  v: number;
  nameAt: (a: number) => string;
  landed: number; // 0 to 1 once this reel has stopped
  sheen: number; // 0 to 1 light sweep over the landed name
}> = ({id, p, v, nameAt, landed, sheen}) => {
  const blur = Math.min(22, v * CELL_H * 0.16); // motion blur along the spin
  const faces: React.ReactNode[] = [];
  for (let a = Math.floor(p) - 3; a <= Math.floor(p) + 3; a++) {
    const deg = (a - p) * STEP_DEG;
    if (Math.abs(deg) > 96) continue;
    const c = Math.cos((deg * Math.PI) / 180);
    const onLine = Math.abs(a - p) < 0.5;
    const dim = onLine ? 1 : 1 - 0.7 * landed;
    faces.push(
      <div
        key={a}
        style={{
          position: 'absolute',
          left: 0,
          top: (WIN_H - CELL_H) / 2,
          width: REEL_W,
          height: CELL_H,
          transform: `translateZ(${-RADIUS}px) rotateX(${deg}deg) translateZ(${RADIUS}px)`,
          backfaceVisibility: 'hidden',
          background: '#FFFFFF',
          borderTop: '2px solid #EFEFF2',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '0 12px',
        }}
      >
        <span
          style={{
            // names fade out as the drum turns them away (no squashed slivers)
            opacity: Math.max(0, Math.min(1, (c - 0.42) / 0.36)) * dim,
            fontSize: 31,
            fontWeight: 700,
            letterSpacing: TRACK.body,
            lineHeight: 1.12,
            color: onLine && landed > 0.5 ? COLORS.ink : COLORS.ink2,
            textAlign: 'center',
            textWrap: 'balance',
          }}
        >
          {nameAt(a)}
        </span>
      </div>,
    );
  }
  return (
    <div
      style={{
        position: 'relative',
        width: REEL_W,
        height: WIN_H,
        borderRadius: 18,
        overflow: 'hidden',
        background: '#F6F6F8',
        boxShadow: 'inset 0 0 0 2px #E4E4E7',
      }}
    >
      <svg width={0} height={0} style={{position: 'absolute'}}>
        <filter id={id} x="-10%" y="-30%" width="120%" height="160%">
          <feGaussianBlur stdDeviation={`0 ${blur.toFixed(2)}`} />
        </filter>
      </svg>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          perspective: 1100,
          perspectiveOrigin: '50% 50%',
          filter: blur > 0.4 ? `url(#${id})` : undefined,
        }}
      >
        {faces}
      </div>
      {/* the drum curves away into shade at the top and bottom of the window */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'linear-gradient(to bottom, rgba(24,24,27,.16) 0%, rgba(24,24,27,.05) 22%, rgba(24,24,27,0) 36%, rgba(24,24,27,0) 64%, rgba(24,24,27,.05) 78%, rgba(24,24,27,.16) 100%)',
        }}
      />
      {/* a light sweep across the name the reel lands on */}
      {sheen > 0 && sheen < 1 ? (
        <div
          style={{
            position: 'absolute',
            left: -REEL_W * 0.6 + REEL_W * 2.2 * sheen,
            top: (WIN_H - CELL_H) / 2,
            width: REEL_W * 0.5,
            height: CELL_H,
            background: 'linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,.75), rgba(255,255,255,0))',
            transform: 'skewX(-18deg)',
          }}
        />
      ) : null}
      {/* the payline frame, lit when the reel locks */}
      <div
        style={{
          position: 'absolute',
          left: 6,
          right: 6,
          top: (WIN_H - CELL_H) / 2 + 2,
          height: CELL_H - 4,
          borderRadius: 14,
          border: `3px solid ${COLORS.accent}`,
          boxShadow: `0 0 0 ${8 * landed}px rgba(61,134,240,${0.1 * landed}), inset 0 0 0 1px rgba(255,255,255,.6)`,
          opacity: landed,
        }}
      />
    </div>
  );
};

const Pointer: React.FC<{side: 'left' | 'right'; on: number}> = ({side, on}) => (
  <div
    style={{
      position: 'absolute',
      top: PAD + WIN_H / 2 - 13,
      [side]: -2,
      width: 0,
      height: 0,
      borderTop: '13px solid transparent',
      borderBottom: '13px solid transparent',
      [side === 'left' ? 'borderLeft' : 'borderRight']: `14px solid ${on > 0.5 ? COLORS.accent : '#C9C9CF'}`,
    }}
  />
);

export const LenderSlots: React.FC<LenderSlotsProps> = ({eyebrow, count, countLabel, landOn, durationInFrames, showSafeZones}) => {
  const {f, fps} = useClipTimeline(LENDER_SLOTS_BASE, durationInFrames);
  const L = LENDER_SLOTS_BASE;
  const names = LENDER_NAMES;
  const n = names.length;

  // Landing names: only names that are in the baked bank-book list.
  const land = SPIN.map((_, r) => {
    const want = landOn[r];
    const i = want ? names.indexOf(want) : -1;
    return i >= 0 ? i : names.indexOf(LENDER_LANDING_DEFAULT[r]);
  });

  const housing = enter(f, fps, 2, 18);
  const result = enter(f, fps, ALL_LANDED + 4, 16);

  return (
    <BrandFrame
      showSafeZones={showSafeZones}
      backdrop={
        <BackdropStage f={f} length={L}>
          {/* faint cash drifting down both sides, behind the machine */}
          <MoneyField f={f} mode="drift" count={4} seed="slots-left" area={{x: -40, y: 260, w: 230, h: 1300}} size={[150, 220]} depth={[-900, -300]} opacity={0.42} blur={2.5} />
          <MoneyField f={f} mode="drift" count={4} seed="slots-right" area={{x: 890, y: 260, w: 230, h: 1300}} size={[150, 220]} depth={[-900, -300]} opacity={0.42} blur={2.5} />
          {/* as the last reel locks, bills and coins pop out from behind both sides of the machine */}
          {[
            {seed: 'slots-burst-l', x: 120},
            {seed: 'slots-burst-r', x: 960},
          ].map((b) => (
            <MoneyField
              key={b.seed}
              f={f}
              mode="burst"
              kind="mix"
              count={9}
              seed={b.seed}
              from={{x: b.x, y: 760}}
              start={ALL_LANDED - 3}
              end={ALL_LANDED + 9}
              size={[130, 200]}
              depth={[-600, -200]}
              opacity={0.55}
              blur={2}
            />
          ))}
        </BackdropStage>
      }
    >
      <Stage3D f={f} length={L}>
        <Eyebrow text={eyebrow} progress={enter(f, fps, 0, 14)} />
        <div style={{height: 44}} />
        <Card3D enter={housing} z={40} tilt={{rx: 3, ry: -3}} padding={PAD} radius={30} elevation={1.2}>
          <div style={{position: 'relative', display: 'flex', gap: GAP}}>
            {SPIN.map((s, r) => {
              const {p, v} = reelAt(f, s);
              const stride = STRIDES[r];
              const landed = enter(f, fps, s.stop, 8);
              return (
                <Reel
                  key={r}
                  id={`lender-slots-blur-${r}`}
                  p={p}
                  v={v}
                  nameAt={(a) => names[mod(land[r] + (a - s.names) * stride, n)]}
                  landed={f >= s.stop ? landed : 0}
                  sheen={progressBetween(f, s.stop, s.stop + 14)}
                />
              );
            })}
          </div>
          <Pointer side="left" on={enter(f, fps, ALL_LANDED, 6)} />
          <Pointer side="right" on={enter(f, fps, ALL_LANDED, 6)} />
        </Card3D>
        <div style={{height: 54}} />
        <div style={{...fadeUp(result, 22), display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 22}}>
          {count ? <span style={{fontSize: 132, fontWeight: 800, letterSpacing: TRACK.num, lineHeight: 1, color: COLORS.accent}}>{count}</span> : null}
          <span
            style={{
              fontSize: count ? 54 : 56,
              fontWeight: count ? 700 : 800,
              letterSpacing: TRACK.h2,
              lineHeight: 1.1,
              color: count ? COLORS.ink2 : COLORS.accent,
              whiteSpace: 'nowrap',
            }}
          >
            {countLabel}
          </span>
        </div>
      </Stage3D>
    </BrandFrame>
  );
};
