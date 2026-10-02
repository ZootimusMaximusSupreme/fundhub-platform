import React from 'react';
import {AbsoluteFill, Composition, spring} from 'remotion';
import {
  BrandFrame,
  COLORS,
  Coin,
  DASH,
  Decor,
  DollarMark,
  Eyebrow,
  FONT_FAMILY,
  FRAME,
  GRID,
  P3D,
  SPECTRUM,
  Stage3D,
  TAG,
  TRACK,
  TYPE,
  WORDMARK,
  Wordmark,
  enter,
  fadeUp,
  progressBetween,
} from '../brand';
import {clampClip, useClipTimeline} from './clipTimeline';

// BankPockets (Unit I, broll-v2-2026-10-02). Chris: "When interest rates rise,
// we should show it like a bank pulling out its pockets, as if they have no
// money to lend out."
//
// The beat, in order: a small "Rates" chip climbs in three steps and the bank
// flinches at each one; the bank's doors swing open on an empty vault; two
// cloth pockets pop out of its sides, turned inside out; a puff of dust and a
// moth come out of one, a single coin drops out of the other and rolls away.
// No rate values, no dates, no amounts, no faces.
//
// Two formats from one scene:
// - vertical: 1080x1920 for ads. Words stay in BrandFrame's band (y 269-1248).
// - wide: 3840x2160 (4K) for the horizontal VSL. Words on the left, the bank on
//   the right, all text inside the 5% title-safe margin. Laid out for the wide
//   frame and drawn at 4K, never a stretched or upscaled vertical.
//
// Plain CSS 3D (no WebGL). Coin, moth and dust are wrapped in Decor, so a
// render with --props '{"checkTextOnly":true}' drops them for the safe-zone scan.

export type BankPocketsFormat = 'vertical' | 'wide';

export type BankPocketsProps = {
  /** "vertical" (1080x1920, ads) or "wide" (3840x2160, the VSL). */
  format?: BankPocketsFormat;
  eyebrow: string;
  headline: string;
  subline: string | null;
  durationInFrames?: number;
  showSafeZones?: boolean;
};

export const bankPocketsDefaults: BankPocketsProps = {
  format: 'vertical',
  eyebrow: 'Interest rates',
  headline: 'Rates went up. Banks tightened.',
  subline: 'Money gets harder to get.',
};

/** Base length 3.2 s; a shot list may ask for 2.5 to 3.5 s (75 to 105 frames). */
export const BANK_POCKETS_BASE = 96;
export const BANK_POCKETS_MIN = 75;
export const BANK_POCKETS_MAX = 105;
/** Frame (on the base timeline) where every beat is on screen: pockets out, coin rolling, moth up, subline in. */
export const BANK_POCKETS_HERO = 76;

export const bankPocketsDuration = (requested?: number): number =>
  clampClip(requested, BANK_POCKETS_BASE, BANK_POCKETS_MIN, BANK_POCKETS_MAX);

/** The wide frame: 4K, 30 fps, 5% title-safe margin. */
export const WIDE = {width: 3840, height: 2160, fps: 30, safeX: 192, safeY: 108} as const;

// ---------------------------------------------------------------------------
// Timeline (frames on the 96-frame base)

const T = {
  bank: 2,
  chip: 6,
  steps: [12, 21, 30],
  doors: 31,
  pocketL: 44,
  pocketR: 47,
  dust: 49,
  moth: 52,
  coinDrop: 55,
  sub: 60,
} as const;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** A short bump 0 -> 1 -> 0 over `len` frames starting at `at`. */
const bump = (f: number, at: number, len: number) => {
  const t = (f - at) / len;
  return t <= 0 || t >= 1 ? 0 : Math.sin(Math.PI * t);
};

// ---------------------------------------------------------------------------
// 3D building blocks. Every face is a leaf div; the fade-in reaches each face
// through context, because opacity on a wrapper would flatten the 3D.

const Fade = React.createContext(1);

const Face: React.FC<{
  x: number;
  y: number;
  w: number;
  h: number;
  t: string;
  o?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}> = ({x, y, w, h, t, o = '50% 50%', style, children}) => {
  const a = React.useContext(Fade);
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: w,
        height: h,
        transform: t,
        transformOrigin: o,
        opacity: a,
        ...style,
      }}
    >
      {children}
    </div>
  );
};

/**
 * A solid block: front face at depth `z`, running `d` back. (x, y) is the
 * front face's top-left corner. Only the faces the camera can see are drawn
 * (front, top, right side): the bank is turned so its right side shows.
 */
const Box: React.FC<{
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  d: number;
  front: React.CSSProperties;
  top?: React.CSSProperties;
  right?: React.CSSProperties;
  children?: React.ReactNode;
}> = ({x, y, w, h, z, d, front, top, right, children}) => (
  <>
    {top ? <Face x={x} y={y - d} w={w} h={d} o="50% 100%" t={`translateZ(${z}px) rotateX(90deg)`} style={top} /> : null}
    {right ? <Face x={x + w} y={y} w={d} h={h} o="0% 50%" t={`translateZ(${z}px) rotateY(90deg)`} style={right} /> : null}
    <Face x={x} y={y} w={w} h={h} t={`translateZ(${z}px)`} style={front}>
      {children}
    </Face>
  </>
);

// Stone tones: white and cool grays from the page (--paper, --soft, --line).
const STONE = {
  front: 'linear-gradient(180deg, #F7F7F9 0%, #EAEAEE 100%)',
  top: 'linear-gradient(180deg, #F3F3F5 0%, #FFFFFF 100%)',
  side: 'linear-gradient(180deg, #DCDDE2 0%, #CDCED4 100%)',
  edge: 'inset 0 -2px 0 #D9D9DE, inset 0 2px 0 #FFFFFF',
} as const;

const front = (extra?: React.CSSProperties): React.CSSProperties => ({background: STONE.front, boxShadow: STONE.edge, ...extra});
const topFace: React.CSSProperties = {background: STONE.top};
const sideFace: React.CSSProperties = {background: STONE.side};

// ---------------------------------------------------------------------------
// Bank geometry, in scene units (u = 1 is the vertical ad). The bank stands on
// the ground at y = 0 and faces the camera; its column plane is z = 0.

const GEO = {
  steps: [
    {w: 620, z: 70, d: 280},
    {w: 590, z: 52, d: 262},
    {w: 560, z: 34, d: 244},
  ],
  stepH: 16,
  podium: -48,
  colTop: -278,
  cols: [-226, -96, 96, 226],
  wall: {x: 240, z: -40, back: -200},
  door: {x: 66, top: -218},
  room: {back: -150},
  vault: {cx: 0, cy: -134, r: 40},
  ent: {x: 292, top: -336, z: 26, d: 236},
  cornice: {x: 302, top: -348, z: 33, d: 245},
  ped: {x: 304, h: 116},
  pocket: {x: 250, y: -204, z: 20},
} as const;

/** How far a pocket hangs out from straight down, degrees. */
const POCKET_REST = 6;

const Pocket: React.FC<{u: number; side: 'left' | 'right'; pop: number; sway: number}> = ({u, side, pop, sway}) => {
  const a = React.useContext(Fade);
  const w = 116 * u;
  const h = 158 * u;
  const dir = side === 'left' ? -1 : 1;
  // The lining comes out of a pinched slit (its mouth, top left of the drawing)
  // and droops out and down. Pulled out, it flops up, swings once, settles.
  const scale = 0.08 + 0.92 * pop;
  const rot = -dir * (POCKET_REST + 46 * (1 - pop) - sway);
  const mx = side === 'right' ? 0.18 : 0.82;
  const my = 0.04;
  const id = `bp-pocket-${side}`;
  return (
    <div
      style={{
        position: 'absolute',
        left: -mx * w,
        top: -my * h,
        width: w,
        height: h,
        opacity: pop > 0.01 ? a : 0,
        transformOrigin: `${mx * 100}% ${my * 100}%`,
        transform: `rotate(${rot}deg) scale(${scale})`,
        filter: `drop-shadow(${dir * 5 * u}px ${12 * u}px ${10 * u}px rgba(10,10,10,.17))`,
      }}
    >
      <svg width={w} height={h} viewBox="0 0 110 150" style={{display: 'block', overflow: 'visible', transform: side === 'left' ? 'scaleX(-1)' : undefined}}>
        <defs>
          <linearGradient id={`${id}-cloth`} x1="0" y1="0" x2="0.8" y2="1">
            <stop offset="0%" stopColor="#FFFFFF" />
            <stop offset="55%" stopColor="#F4F5F8" />
            <stop offset="100%" stopColor="#DFE4EC" />
          </linearGradient>
        </defs>
        {/* the lining, turned inside out: a limp, empty cloth bag */}
        <path
          d="M 2 7 C 13 1, 29 1, 38 7 C 52 16, 70 24, 84 40 C 100 58, 108 84, 102 106 C 98 124, 88 138, 70 144 C 61 147, 53 141, 46 146 C 36 150, 22 142, 18 126 C 12 104, 12 70, 8 40 C 6 26, 2 17, 2 7 Z"
          fill={`url(#${id}-cloth)`}
          stroke="#A3B0C4"
          strokeWidth={2.3}
          strokeLinejoin="round"
        />
        {/* wrinkles fanning out from where it is pinched */}
        <path d="M 19 12 C 25 40, 33 78, 40 128" fill="none" stroke="#A9B4C6" strokeOpacity={0.5} strokeWidth={2} strokeLinecap="round" />
        <path d="M 30 10 C 44 30, 62 60, 74 108" fill="none" stroke="#A9B4C6" strokeOpacity={0.42} strokeWidth={2} strokeLinecap="round" />
        <path d="M 35 12 C 52 30, 72 54, 86 86" fill="none" stroke="#FFFFFF" strokeWidth={3} strokeLinecap="round" />
        <path d="M 24 14 C 33 40, 46 74, 56 120" fill="none" stroke="#FFFFFF" strokeWidth={2.6} strokeLinecap="round" />
        {/* the seam across the bottom, stitched */}
        <path
          d="M 95 92 C 98 112, 90 128, 72 135 C 63 138, 55 133, 47 137 C 38 140, 28 134, 25 120"
          fill="none"
          stroke={COLORS.accent}
          strokeOpacity={0.6}
          strokeWidth={2}
          strokeDasharray="5 4"
          strokeLinecap="round"
        />
        {/* the dark slit it is pulled out of */}
        <ellipse cx={20} cy={6} rx={19} ry={5} fill="#27272A" fillOpacity={0.55} />
        <path d="M 2 7 C 13 3, 29 3, 38 7" fill="none" stroke="#A3B0C4" strokeWidth={2} strokeLinecap="round" />
      </svg>
    </div>
  );
};

/** The round vault door: a thick steel disk with a wheel handle. */
const VaultDoor: React.FC<{u: number; r: number}> = ({u, r}) => {
  const a = React.useContext(Fade);
  const d = r * 2;
  const thick = 12 * u;
  const layers = 5;
  const disk = (z: number, bg: string, key: string, children?: React.ReactNode) => (
    <div
      key={key}
      style={{position: 'absolute', inset: 0, borderRadius: '50%', background: bg, transform: `translateZ(${z}px)`, opacity: a}}
    >
      {children}
    </div>
  );
  const wheel = (
    <svg width={d} height={d} viewBox="-50 -50 100 100" style={{position: 'absolute', inset: 0}}>
      <circle r={41} fill="none" stroke="#A1A1AA" strokeWidth={2.5} />
      <circle r={33} fill="none" stroke="#FFFFFF" strokeOpacity={0.7} strokeWidth={1.5} />
      {[0, 60, 120].map((deg) => (
        <line key={deg} x1={-19} x2={19} y1={0} y2={0} stroke="#52525B" strokeWidth={4} strokeLinecap="round" transform={`rotate(${deg})`} />
      ))}
      <circle r={19} fill="none" stroke="#52525B" strokeWidth={3.5} />
      <circle r={6} fill="#71717A" />
    </svg>
  );
  return (
    <div style={{position: 'relative', width: d, height: d, ...P3D}}>
      {Array.from({length: layers}, (_, i) => disk(-thick / 2 + (thick * (i + 0.5)) / layers, '#8A8A93', `rim-${i}`))}
      {disk(-thick / 2, 'radial-gradient(circle at 60% 40%, #E4E4E7, #A1A1AA)', 'back')}
      {disk(thick / 2, 'radial-gradient(circle at 34% 28%, #FFFFFF 0%, #E4E4E7 45%, #A1A1AA 100%)', 'front', wheel)}
    </div>
  );
};

const Moth: React.FC<{size: number; flap: number}> = ({size, flap}) => (
  <svg width={size} height={size * 0.8} viewBox="-50 -40 100 80" style={{display: 'block', overflow: 'visible'}}>
    {[1, -1].map((m) => (
      <g key={m} transform={`scale(${m * flap} 1)`}>
        <path d="M 3 -4 C 16 -30, 44 -32, 48 -14 C 51 0, 32 6, 4 4 Z" fill="#C4C4CB" stroke="#8A8A93" strokeWidth={1.4} strokeLinejoin="round" />
        <circle cx={30} cy={-14} r={4.5} fill="#8A8A93" opacity={0.55} />
        <path d="M 3 3 C 16 6, 34 14, 30 28 C 23 37, 9 23, 3 9 Z" fill="#D4D4D8" stroke="#8A8A93" strokeWidth={1.3} strokeLinejoin="round" />
      </g>
    ))}
    <ellipse cx={0} cy={3} rx={4.6} ry={15} fill="#6B6B74" />
    <circle cx={0} cy={-13} r={4.2} fill="#6B6B74" />
    <path d="M -1.5 -16 C -5 -24, -9 -28, -14 -30 M 1.5 -16 C 5 -24, 9 -28, 14 -30" fill="none" stroke="#6B6B74" strokeWidth={1.4} strokeLinecap="round" />
  </svg>
);

// Coin path (right pocket, bank units): slips out of the bottom of the
// pocket (it starts hidden behind the cloth), drops past the end of the steps,
// one small hop, then rolls away out of the frame.
const COIN_R = 20;
const coinAt = (f: number) => {
  const t0 = T.coinDrop;
  const land = t0 + 6;
  const hopEnd = land + 6;
  const x0 = GEO.pocket.x + 55;
  const y0 = GEO.pocket.y + 124;
  const xLand = GEO.steps[0].w / 2 + COIN_R + 4;
  const yGround = -COIN_R;
  const z = GEO.pocket.z - 4;
  if (f < t0) return null;
  if (f < land) {
    const k = (f - t0) / (land - t0);
    return {x: x0 + (xLand - x0) * k, y: y0 + (yGround - y0) * k * k, z, roll: 50 * k};
  }
  if (f < hopEnd) {
    const k = (f - land) / (hopEnd - land);
    return {x: xLand + 14 * k, y: yGround - 15 * Math.sin(Math.PI * k), z, roll: 50 + 45 * k};
  }
  const k = f - hopEnd;
  const dx = 4.5 * k + 0.32 * k * k;
  return {x: xLand + 14 + dx, y: yGround, z, roll: 95 + (dx / COIN_R) * (180 / Math.PI)};
};

const BankScene: React.FC<{f: number; fps: number; u: number}> = ({f, fps, u}) => {
  const s = (n: number) => n * u;
  const W = s(900);
  const H = s(480);
  const groundY = s(470);

  const inP = enter(f, fps, T.bank, 18);
  const fade = clamp01((f - T.bank) / 7);
  const flinch = T.steps.reduce((m, at) => m + bump(f, at + 1, 6), 0);
  const doors = spring({frame: f - T.doors, fps, durationInFrames: 16, config: {damping: 200}});
  const pocketSpring = (at: number) => spring({frame: f - at, fps, config: {damping: 9, stiffness: 170, mass: 0.7}});
  const popL = pocketSpring(T.pocketL);
  const popR = pocketSpring(T.pocketR);
  const swayL = f > T.pocketL ? 3 * Math.sin((f - T.pocketL) * 0.32) * Math.exp(-(f - T.pocketL) / 24) : 0;
  const swayR = f > T.pocketR ? 3 * Math.sin((f - T.pocketR) * 0.32 + 1) * Math.exp(-(f - T.pocketR) / 24) : 0;

  // Rate chip: appears, then climbs three steps.
  const chipIn = enter(f, fps, T.chip, 10);
  const climb = T.steps.reduce((m, at) => m + spring({frame: f - at, fps, durationInFrames: 8, config: {damping: 200}}), 0);
  const STEP = 22;
  const chipY = s(84 - STEP * climb);
  const trackX = s(800);

  const coin = coinAt(f);
  const dustT = (f - T.dust) / 18;
  const mothT = (f - T.moth) / 40;

  const g = GEO;
  const cols = g.cols.map((cx) => {
    const shaftW = 44;
    return (
      <React.Fragment key={cx}>
        <Box
          x={s(cx - 29)}
          y={s(g.podium - 12)}
          w={s(58)}
          h={s(12)}
          z={s(15)}
          d={s(58)}
          front={front()}
          top={topFace}
        />
        <Face
          x={s(cx - shaftW / 2)}
          y={s(g.colTop + 14)}
          w={s(shaftW)}
          h={s(g.podium - 12 - (g.colTop + 14))}
          t={`translateZ(${s(6)}px)`}
          style={{
            background:
              'repeating-linear-gradient(90deg, rgba(10,10,10,0) 0px, rgba(10,10,10,0) 5px, rgba(10,10,10,.045) 5px, rgba(10,10,10,.045) 7px), ' +
              'linear-gradient(90deg, #E2E2E6 0%, #FFFFFF 30%, #F4F4F6 56%, #D6D6DB 100%)',
            backgroundSize: `${s(7)}px 100%, 100% 100%`,
          }}
        />
        <Box
          x={s(cx - 31)}
          y={s(g.colTop)}
          w={s(62)}
          h={s(14)}
          z={s(17)}
          d={s(62)}
          front={front()}
          top={topFace}
        />
      </React.Fragment>
    );
  });

  const wallFront = (extra?: React.CSSProperties): React.CSSProperties => ({
    background:
      `repeating-linear-gradient(180deg, rgba(10,10,10,0) 0px, rgba(10,10,10,0) ${s(27)}px, rgba(10,10,10,.035) ${s(27)}px, rgba(10,10,10,.035) ${s(29)}px), ` +
      'linear-gradient(180deg, #E3E3E7 0%, #EFEFF2 14%, #F1F1F4 100%)',
    ...extra,
  });
  const wallH = g.podium - g.colTop;
  const doorW = g.door.x;
  const doorH = g.podium - g.door.top;
  const roomD = g.wall.z - g.room.back;

  const pedL = Math.hypot(g.ped.x, g.ped.h);
  const pedA = (Math.atan2(g.ped.h, g.ped.x) * 180) / Math.PI;
  const apexY = g.cornice.top - g.ped.h;

  return (
    <div style={{position: 'relative', width: W, height: H, ...P3D}}>
      {/* the bank, turned a little so its right side shows */}
      <div
        style={{
          position: 'absolute',
          left: W / 2,
          top: groundY,
          width: 0,
          height: 0,
          ...P3D,
          transformOrigin: '0 0',
          transform:
            `translate3d(0, ${s(40) * (1 - inP)}px, ${-s(520) * (1 - inP)}px) ` +
            `rotateX(${4 + 10 * (1 - inP)}deg) rotateY(-12deg) scale(${1 + 0.006 * flinch}, ${1 - 0.016 * flinch})`,
        }}
      >
        <Fade.Provider value={fade}>
          {/* soft shadow on the floor */}
          <Face
            x={s(-400)}
            y={-s(400)}
            w={s(800)}
            h={s(400)}
            o="50% 100%"
            t={`translateZ(${s(130)}px) rotateX(90deg)`}
            style={{background: 'radial-gradient(closest-side, rgba(10,10,10,.13), rgba(10,10,10,.05) 62%, rgba(10,10,10,0))'}}
          />

          {/* steps */}
          {g.steps.map((st, i) => (
            <Box
              key={st.w}
              x={s(-st.w / 2)}
              y={s(-(i + 1) * g.stepH)}
              w={s(st.w)}
              h={s(g.stepH)}
              z={s(st.z)}
              d={s(st.d)}
              front={front()}
              top={topFace}
              right={sideFace}
            />
          ))}

          {/* the room behind the doors: the vault, door open, nothing inside */}
          <Face
            x={s(-doorW - 30)}
            y={s(g.door.top - 12)}
            w={s(2 * doorW + 60)}
            h={s(doorH + 12)}
            t={`translateZ(${s(g.room.back)}px)`}
            style={{background: 'linear-gradient(180deg, #C9CAD1 0%, #D8D9DE 100%)'}}
          >
            <svg
              width={s(2 * doorW + 60)}
              height={s(doorH + 12)}
              viewBox={`${-doorW - 30} ${g.door.top - 12} ${2 * doorW + 60} ${doorH + 12}`}
              style={{position: 'absolute', inset: 0}}
            >
              <defs>
                <radialGradient id="bp-vault" cx="0.45" cy="0.4" r="0.7">
                  <stop offset="0%" stopColor="#52525B" />
                  <stop offset="100%" stopColor="#27272A" />
                </radialGradient>
              </defs>
              <circle cx={g.vault.cx} cy={g.vault.cy} r={g.vault.r + 7} fill="#B4B5BD" />
              <circle cx={g.vault.cx} cy={g.vault.cy} r={g.vault.r + 7} fill="none" stroke="#E4E4E7" strokeWidth={1.5} />
              <circle cx={g.vault.cx} cy={g.vault.cy} r={g.vault.r} fill="url(#bp-vault)" />
              {/* bare shelves */}
              {[-16, 4, 22].map((dy) => {
                const y = g.vault.cy + dy;
                const half = Math.sqrt(g.vault.r ** 2 - dy ** 2) - 5;
                return (
                  <React.Fragment key={dy}>
                    <line x1={-half} x2={half} y1={y} y2={y} stroke="#8A8A93" strokeWidth={2.4} strokeLinecap="round" />
                    <line x1={-half} x2={half} y1={y + 2.2} y2={y + 2.2} stroke="#18181B" strokeOpacity={0.5} strokeWidth={1.2} />
                  </React.Fragment>
                );
              })}
            </svg>
          </Face>
          {/* room floor and left wall */}
          <Box
            x={s(-doorW)}
            y={s(g.podium)}
            w={s(2 * doorW)}
            h={0}
            z={s(g.wall.z)}
            d={s(roomD)}
            front={{}}
            top={{background: 'linear-gradient(180deg, #CFD0D6 0%, #E1E2E6 100%)'}}
          />
          <Face
            x={s(-doorW)}
            y={s(g.door.top)}
            w={s(roomD)}
            h={s(doorH)}
            o="0% 50%"
            t={`translateZ(${s(g.wall.z)}px) rotateY(90deg)`}
            style={{background: 'linear-gradient(90deg, #DCDDE2 0%, #C4C5CC 100%)'}}
          />
          {/* vault door, swung open on its left hinge */}
          <div
            style={{
              position: 'absolute',
              left: s(g.vault.cx - g.vault.r),
              top: s(g.vault.cy - g.vault.r),
              ...P3D,
              transformOrigin: '0% 50%',
              transform: `translateZ(${s(g.room.back + 7)}px) rotateY(-55deg)`,
            }}
          >
            <VaultDoor u={u} r={s(g.vault.r)} />
          </div>

          {/* front doors, swinging in */}
          {(['left', 'right'] as const).map((side) => (
            <Face
              key={side}
              x={side === 'left' ? s(-doorW) : 0}
              y={s(g.door.top)}
              w={s(doorW)}
              h={s(doorH)}
              o={side === 'left' ? '0% 50%' : '100% 50%'}
              t={`translateZ(${s(g.wall.z - 1)}px) rotateY(${(side === 'left' ? 1 : -1) * 98 * doors}deg)`}
              style={{
                background: 'linear-gradient(180deg, #4A92F2 0%, #3D86F0 45%, #2C67C2 100%)',
                boxShadow: `inset 0 0 0 ${s(2)}px rgba(255,255,255,.18)`,
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  left: s(10),
                  right: s(10),
                  top: s(12),
                  height: s(62),
                  border: `${s(2)}px solid rgba(255,255,255,.32)`,
                  borderRadius: s(4),
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  left: s(10),
                  right: s(10),
                  top: s(86),
                  bottom: s(12),
                  border: `${s(2)}px solid rgba(255,255,255,.32)`,
                  borderRadius: s(4),
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  top: s(80),
                  [side === 'left' ? 'right' : 'left']: s(6),
                  width: s(8),
                  height: s(8),
                  borderRadius: '50%',
                  background: 'radial-gradient(circle at 35% 30%, #FCEBC6, #E3AE62)',
                }}
              />
            </Face>
          ))}

          {/* the wall around the door */}
          <Box
            x={s(-g.wall.x)}
            y={s(g.colTop)}
            w={s(g.wall.x - doorW)}
            h={s(wallH)}
            z={s(g.wall.z)}
            d={0}
            front={wallFront({boxShadow: `inset ${-s(3)}px 0 0 #E2E2E6`})}
          />
          <Box
            x={s(doorW)}
            y={s(g.colTop)}
            w={s(g.wall.x - doorW)}
            h={s(wallH)}
            z={s(g.wall.z)}
            d={s(g.wall.z - g.wall.back)}
            front={wallFront({boxShadow: `inset ${s(3)}px 0 0 #E2E2E6`})}
            right={sideFace}
          />
          <Face
            x={s(-doorW)}
            y={s(g.colTop)}
            w={s(2 * doorW)}
            h={s(g.door.top - g.colTop)}
            t={`translateZ(${s(g.wall.z)}px)`}
            style={wallFront({boxShadow: `inset 0 ${-s(3)}px 0 #E2E2E6`})}
          />

          {cols}

          {/* entablature with the frieze, then the cornice */}
          <Box
            x={s(-g.ent.x)}
            y={s(g.ent.top)}
            w={s(2 * g.ent.x)}
            h={s(g.colTop - g.ent.top)}
            z={s(g.ent.z)}
            d={s(g.ent.d)}
            front={front({
              background: 'linear-gradient(180deg, #FAFAFB 0%, #F1F1F4 70%, #E6E6EA 71%, #EDEDF0 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              paddingBottom: s(10),
              boxSizing: 'border-box',
            })}
            right={sideFace}
          >
            <span
              style={{
                fontFamily: FONT_FAMILY,
                fontSize: s(27),
                fontWeight: 700,
                letterSpacing: '0.46em',
                marginRight: '-0.46em',
                color: COLORS.gray,
                lineHeight: 1,
              }}
            >
              BANK
            </span>
          </Box>
          <Box
            x={s(-g.cornice.x)}
            y={s(g.cornice.top)}
            w={s(2 * g.cornice.x)}
            h={s(g.ent.top - g.cornice.top)}
            z={s(g.cornice.z)}
            d={s(g.cornice.d)}
            front={front({background: 'linear-gradient(180deg, #FFFFFF 0%, #ECECEF 100%)'})}
            top={topFace}
            right={sideFace}
          />

          {/* roof slopes and the pediment with its "$" seal */}
          {[pedA, 180 - pedA].map((deg) => (
            <Face
              key={deg}
              x={0}
              y={s(apexY)}
              w={s(pedL)}
              h={s(g.cornice.d)}
              o="0% 0%"
              t={`translateZ(${s(g.cornice.z)}px) rotateZ(${deg}deg) rotateX(-90deg)`}
              style={{background: 'linear-gradient(180deg, #F2F2F4 0%, #E2E3E7 100%)', boxShadow: `inset 0 ${s(2)}px 0 #FFFFFF`}}
            />
          ))}
          <Face
            x={s(-g.ped.x)}
            y={s(apexY)}
            w={s(2 * g.ped.x)}
            h={s(g.ped.h)}
            t={`translateZ(${s(g.cornice.z + 0.5)}px)`}
            style={{background: 'linear-gradient(180deg, #FFFFFF 0%, #F0F0F3 100%)', clipPath: 'polygon(50% 0%, 100% 100%, 0% 100%)'}}
          >
            <svg width={s(2 * g.ped.x)} height={s(g.ped.h)} viewBox={`0 0 ${2 * g.ped.x} ${g.ped.h}`} style={{position: 'absolute', inset: 0}}>
              <polygon
                points={`${g.ped.x},22 ${2 * g.ped.x - 52},${g.ped.h - 9} 52,${g.ped.h - 9}`}
                fill="#F3F3F6"
                stroke="#DCDCE1"
                strokeWidth={2}
                strokeLinejoin="round"
              />
              <circle cx={g.ped.x} cy={g.ped.h - 40} r={27} fill="#2C67C2" />
              <circle cx={g.ped.x} cy={g.ped.h - 42} r={27} fill={COLORS.accent} />
              <circle cx={g.ped.x} cy={g.ped.h - 42} r={21} fill="none" stroke="#FFFFFF" strokeOpacity={0.45} strokeWidth={1.5} strokeDasharray="3 3" />
            </svg>
            <div style={{position: 'absolute', left: s(g.ped.x - 12), top: s(g.ped.h - 58), width: s(24), height: s(32)}}>
              <DollarMark height={s(32)} color="#FFFFFF" weight={2.8} />
            </div>
          </Face>

          {/* the pockets, pulled out of the bank's sides */}
          {(['left', 'right'] as const).map((side) => (
            <div
              key={side}
              style={{
                position: 'absolute',
                left: s(side === 'left' ? -g.pocket.x : g.pocket.x),
                top: s(g.pocket.y),
                ...P3D,
                transform: `translateZ(${s(g.pocket.z)}px)`,
              }}
            >
              <Pocket u={u} side={side} pop={side === 'left' ? popL : popR} sway={side === 'left' ? swayL : swayR} />
            </div>
          ))}

          <Decor>
            {/* a puff of dust shaken out of the left pocket (behind the cloth, so it billows around it) */}
            {dustT > 0 && dustT < 1
              ? [0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
                  const ang = (-215 + i * 34) * (Math.PI / 180);
                  const e = 1 - (1 - dustT) ** 2;
                  const dist = s(36 + (40 + (i % 3) * 12) * e);
                  const r = s(10 + 16 * e + (i % 2) * 4);
                  return (
                    <div
                      key={i}
                      style={{
                        position: 'absolute',
                        left: s(-g.pocket.x - 45) + Math.cos(ang) * dist - r,
                        top: s(g.pocket.y + 74) + Math.sin(ang) * dist * 0.85 - s(14) * e - r,
                        width: 2 * r,
                        height: 2 * r,
                        borderRadius: '50%',
                        background: 'radial-gradient(circle at 40% 35%, rgba(212,212,216,.95), rgba(190,190,197,.65) 55%, rgba(190,190,197,0) 72%)',
                        opacity: (1 - dustT) ** 1.2 * fade,
                        transform: `translateZ(${s(g.pocket.z - 3)}px)`,
                      }}
                    />
                  );
                })
              : null}

            {/* a moth flutters out of the left pocket */}
            {mothT > 0 && mothT < 1 ? (
              <div
                style={{
                  position: 'absolute',
                  left: s(-g.pocket.x - 62 - 50 * mothT + 16 * Math.sin(mothT * 9)) - s(30),
                  top: s(g.pocket.y + 70 - 270 * mothT + 9 * Math.sin(mothT * 15)) - s(24),
                  opacity: clamp01(mothT / 0.08) * clamp01((1 - mothT) / 0.28),
                  transform: `translateZ(${s(g.pocket.z + 10)}px) rotate(${-14 + 10 * Math.sin(mothT * 11)}deg)`,
                }}
              >
                <Moth size={s(60)} flap={0.3 + 0.7 * Math.abs(Math.sin(f * 1.35))} />
              </div>
            ) : null}

            {/* one coin drops out of the right pocket and rolls away */}
            {coin ? (
              <>
                <div
                  style={{
                    position: 'absolute',
                    left: s(coin.x - 15),
                    top: -s(5),
                    width: s(30),
                    height: s(8),
                    borderRadius: '50%',
                    background: 'radial-gradient(closest-side, rgba(10,10,10,.22), rgba(10,10,10,0))',
                    opacity: clamp01(1 - (coin.y + COIN_R) / -60),
                    transform: `translateZ(${s(coin.z - 1)}px)`,
                  }}
                />
                <div
                  style={{
                    position: 'absolute',
                    left: s(coin.x - COIN_R),
                    top: s(coin.y - COIN_R),
                    ...P3D,
                    transform: `translateZ(${s(coin.z)}px)`,
                  }}
                >
                  <Coin size={s(2 * COIN_R)} tilt={{rz: coin.roll}} />
                </div>
              </>
            ) : null}
          </Decor>
        </Fade.Provider>
      </div>

      {/* rate chip climbing a short track, right of the roof (no values, no dates) */}
      <div style={{position: 'absolute', left: 0, top: 0, width: W, height: H, transform: `translateZ(${s(70)}px)`, ...P3D}}>
        <div
          style={{
            position: 'absolute',
            left: trackX - s(2),
            top: s(4),
            width: s(4),
            height: s(112),
            borderRadius: s(2),
            background: `repeating-linear-gradient(180deg, ${COLORS.track} 0px, ${COLORS.track} ${s(6)}px, rgba(0,0,0,0) ${s(6)}px, rgba(0,0,0,0) ${s(12)}px)`,
            opacity: chipIn,
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: trackX - s(3),
            top: chipY,
            width: s(6),
            height: Math.max(0, s(116) - chipY),
            borderRadius: s(3),
            background: `linear-gradient(180deg, ${COLORS.accent}, rgba(61,134,240,.35))`,
            opacity: chipIn,
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: trackX,
            top: chipY,
            opacity: chipIn,
            transform: `translate(-50%, -50%) scale(${0.85 + 0.15 * chipIn})`,
          }}
        >
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: s(8),
              fontFamily: FONT_FAMILY,
              fontSize: s(26),
              fontWeight: 600,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              lineHeight: 1,
              whiteSpace: 'nowrap',
              color: TAG.info.fg,
              background: '#EEF4FE',
              border: `${s(2)}px solid ${TAG.info.border}`,
              borderRadius: s(11),
              padding: `${s(11)}px ${s(16)}px`,
              boxShadow: `0 ${s(3)}px 0 -${s(1)}px rgba(61,134,240,.25), 0 ${s(10)}px ${s(20)}px rgba(61,134,240,.14)`,
            }}
          >
            ↑ Rates
          </span>
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Vertical (ads)

/** Bank size in the vertical frame (1 = the scene's design size, 900 x 480). */
const VERTICAL_U = 0.92;

const verticalHeadlineSize = (text: string): number => (text.length <= 20 ? 96 : text.length <= 36 ? 82 : 72);

const Vertical: React.FC<BankPocketsProps & {f: number; fps: number}> = ({f, fps, eyebrow, headline, subline, showSafeZones}) => (
  <BrandFrame showSafeZones={showSafeZones}>
    <Stage3D f={f} length={BANK_POCKETS_BASE}>
      <Eyebrow text={eyebrow} progress={enter(f, fps, 0, 14)} />
      <div
        style={{
          ...fadeUp(enter(f, fps, 3, 14), 22),
          marginTop: 22,
          maxWidth: 900,
          fontSize: verticalHeadlineSize(headline),
          fontWeight: 800,
          letterSpacing: TRACK.h1,
          lineHeight: 1.02,
          textAlign: 'center',
          textWrap: 'balance',
        }}
      >
        {headline}
      </div>
      <div style={{...P3D, marginTop: 40}}>
        <BankScene f={f} fps={fps} u={VERTICAL_U} />
      </div>
      {subline ? (
        <div
          style={{
            ...fadeUp(enter(f, fps, T.sub, 14), 18),
            marginTop: 10,
            maxWidth: 860,
            textWrap: 'balance',
            fontSize: 46,
            fontWeight: 600,
            letterSpacing: TRACK.body,
            lineHeight: 1.2,
            color: COLORS.ink2,
            textAlign: 'center',
          }}
        >
          {subline}
        </div>
      ) : null}
    </Stage3D>
  </BrandFrame>
);

// ---------------------------------------------------------------------------
// Wide (the horizontal VSL), 3840x2160

/** Wide type scale against the vertical kit. */
const WS = 2.2;
const WIDE_TEXT = {left: WIDE.safeX + 40, width: 1500} as const;
/** The bank's stage box on the wide frame; the rate chip's right edge lands inside the title-safe line (x 3648). */
const WIDE_BANK = {u: 2.2, left: 1560, right: 240} as const;

const wideHeadlineSize = (text: string): number => (text.length <= 20 ? 220 : text.length <= 36 ? 184 : 160);

const WideGrid: React.FC = () => {
  const line = 3;
  return (
    <AbsoluteFill
      style={{
        backgroundColor: COLORS.paper,
        backgroundImage: `linear-gradient(${GRID.color} ${line}px, transparent ${line}px), linear-gradient(90deg, ${GRID.color} ${line}px, transparent ${line}px)`,
        backgroundSize: `${GRID.cell}px ${GRID.cell}px`,
        backgroundPosition: `${-line / 2}px ${-line / 2}px`,
      }}
    />
  );
};

const WideSafeGuide: React.FC = () => (
  <AbsoluteFill style={{pointerEvents: 'none'}}>
    <div
      style={{
        position: 'absolute',
        left: WIDE.safeX,
        top: WIDE.safeY,
        right: WIDE.safeX,
        bottom: WIDE.safeY,
        border: '6px solid #DC2626',
        boxShadow: '0 0 0 9999px rgba(220,38,38,.07)',
      }}
    />
  </AbsoluteFill>
);

const Wide: React.FC<BankPocketsProps & {f: number; fps: number}> = ({f, fps, eyebrow, headline, subline, showSafeZones}) => {
  const eye = enter(f, fps, 0, 14);
  // A slow drift on the words (flat, so 4K text stays sharp), matching the bank's camera.
  const drift = progressBetween(f, 0, BANK_POCKETS_BASE);
  return (
    <AbsoluteFill style={{fontFamily: FONT_FAMILY, color: COLORS.ink, WebkitFontSmoothing: 'antialiased'}}>
      <WideGrid />
      <div style={{position: 'absolute', left: WIDE_TEXT.left, top: WIDE.safeY + 70}}>
        <Wordmark width={WORDMARK.width * 1.9} />
      </div>
      <div
        style={{
          position: 'absolute',
          left: WIDE_TEXT.left,
          width: WIDE_TEXT.width,
          top: WIDE.safeY + 300,
          bottom: WIDE.safeY + 160,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          transform: `translateX(${-12 * drift}px)`,
        }}
      >
        <div style={{display: 'flex', alignItems: 'center', gap: DASH.width * 0.56 * WS, opacity: eye}}>
          <span
            style={{
              display: 'inline-block',
              width: DASH.width * WS,
              height: DASH.height * WS,
              borderRadius: DASH.radius * WS,
              background: SPECTRUM,
              transform: `scaleX(${eye})`,
              transformOrigin: 'left center',
            }}
          />
          <span
            style={{
              fontSize: TYPE.eyebrow * WS,
              fontWeight: 600,
              letterSpacing: TRACK.eyebrow,
              textTransform: 'uppercase',
              color: COLORS.gray,
              lineHeight: 1.2,
              whiteSpace: 'nowrap',
            }}
          >
            {eyebrow}
          </span>
        </div>
        <div
          style={{
            ...fadeUp(enter(f, fps, 3, 14), 50),
            marginTop: 64,
            fontSize: wideHeadlineSize(headline),
            fontWeight: 800,
            letterSpacing: TRACK.h1,
            lineHeight: 1.02,
            textWrap: 'balance',
          }}
        >
          {headline}
        </div>
        {subline ? (
          <div
            style={{
              ...fadeUp(enter(f, fps, T.sub, 14), 40),
              marginTop: 72,
              fontSize: 46 * WS,
              fontWeight: 600,
              letterSpacing: TRACK.body,
              lineHeight: 1.2,
              color: COLORS.ink2,
              textWrap: 'balance',
            }}
          >
            {subline}
          </div>
        ) : null}
      </div>
      <div style={{position: 'absolute', left: WIDE_BANK.left, right: WIDE_BANK.right, top: 0, bottom: 0}}>
        <Stage3D f={f} length={BANK_POCKETS_BASE} perspective={2400 * WIDE_BANK.u} style={{paddingTop: 60}}>
          <BankScene f={f} fps={fps} u={WIDE_BANK.u} />
        </Stage3D>
      </div>
      {showSafeZones ? <WideSafeGuide /> : null}
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------------------

export const BankPockets: React.FC<BankPocketsProps> = (props) => {
  const {f, fps} = useClipTimeline(BANK_POCKETS_BASE, props.durationInFrames, BANK_POCKETS_MIN, BANK_POCKETS_MAX);
  return props.format === 'wide' ? <Wide {...props} f={f} fps={fps} /> : <Vertical {...props} f={f} fps={fps} />;
};

const size = (format?: BankPocketsFormat) => (format === 'wide' ? {width: WIDE.width, height: WIDE.height} : {width: FRAME.width, height: FRAME.height});

// Stills:  npx remotion still src/index.ts BankPockets previews/bank-pockets.png --frame=76
//          npx remotion still src/index.ts BankPocketsWide previews/bank-pockets-wide.png --frame=76
// BankPockets with --props '{"format":"wide"}' is the same as BankPocketsWide.
export const BankPocketsCompositions: React.FC = () => (
  <>
    <Composition
      id="BankPockets"
      component={BankPockets}
      durationInFrames={BANK_POCKETS_BASE}
      fps={FRAME.fps}
      width={FRAME.width}
      height={FRAME.height}
      defaultProps={bankPocketsDefaults}
      calculateMetadata={({props}) => ({durationInFrames: bankPocketsDuration(props.durationInFrames), ...size(props.format)})}
    />
    <Composition
      id="BankPocketsWide"
      component={BankPockets}
      durationInFrames={BANK_POCKETS_BASE}
      fps={WIDE.fps}
      width={WIDE.width}
      height={WIDE.height}
      defaultProps={{...bankPocketsDefaults, format: 'wide' as const}}
      calculateMetadata={({props}) => ({durationInFrames: bankPocketsDuration(props.durationInFrames), ...size(props.format)})}
    />
  </>
);
