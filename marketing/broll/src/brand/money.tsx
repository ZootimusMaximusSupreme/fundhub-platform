import React from 'react';
import {random} from 'remotion';
import {DEPTH, P3D, STAGE_CENTER} from './depth';
import {countUp} from './motion';
import {TRACK} from './tokens';

// Money pieces for the depth kit. All drawn in code (SVG and CSS), in the
// brand's own colors: bills use the page's green chip tones (.tg.ok), coins use
// the warm end of the brand spectrum, and every piece has an accent-blue tone.
//
// Truth rules built in:
// - No bill or coin carries a number. The "$" seal is the only mark, so no
//   piece can read as a denomination or an amount someone gets.
// - No faces: the portrait oval on a real bill is a "$" seal here.
// - DollarCounter only ever shows the value passed in (a prop from the script
//   line, the page, the sample client or a real approval). It counts up to it.

export type MoneyTone = 'green' | 'accent';

const BILL = {
  green: {base: '#EEF6F0', base2: '#DDECE1', ink: '#3E8E58', line: '#C4DDCB', seal: '#E4F0E7', edge: '#D3E5D8', edgeDark: '#B9D3C0'},
  accent: {base: '#EEF4FE', base2: '#DCE8FB', ink: '#3D86F0', line: '#C3D8F7', seal: '#E3EDFC', edge: '#D4E3FA', edgeDark: '#B5CDF3'},
} as const;

const COIN = {
  gold: {hi: '#FCEBC6', mid: '#F5CE8F', lo: '#E3AE62', rim: '#C99447', ink: '#A9772E'},
  accent: {hi: '#D8E7FD', mid: '#7FB0F5', lo: '#3D86F0', rim: '#2F6CC4', ink: '#FFFFFF'},
} as const;

/** The "$" mark, drawn as a path (not a font glyph), in a 24 x 32 box. */
const DOLLAR_D =
  'M17.6 9.4 C16.7 7 14.6 5.7 12 5.7 C8.7 5.7 6.4 7.5 6.4 10.2 C6.4 13.1 8.9 14.2 12 15 C15.4 15.8 17.9 17.1 17.9 20.3 C17.9 23.2 15.4 25.1 12 25.1 C9 25.1 6.8 23.7 5.9 21.2 M12 2.4 V28.6';

export const DollarMark: React.FC<{height: number; color: string; weight?: number; style?: React.CSSProperties}> = ({
  height,
  color,
  weight = 2.6,
  style,
}) => (
  <svg width={(height * 24) / 32} height={height} viewBox="0 0 24 32" style={{display: 'block', overflow: 'visible', ...style}}>
    <path d={DOLLAR_D} fill="none" stroke={color} strokeWidth={weight} strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** Bill shape: 470 x 200 (a real bill is about 2.35 : 1). */
export const BILL_ASPECT = 470 / 200;

export type DollarBillProps = {
  /** Width in px; height follows the bill shape. */
  width?: number;
  tone?: MoneyTone;
  /** "full" for hero bills, "simple" (fewer lines, faster) for rain and fields. */
  detail?: 'full' | 'simple';
  /** 0 to 1: a light sweep across the bill (reads as a curved, glossy note). */
  sheen?: number;
  style?: React.CSSProperties;
};

/** One bill, flat. Rotate or place it with a Layer or your own transform. No numbers, no face. */
export const DollarBill: React.FC<DollarBillProps> = ({width = 360, tone = 'green', detail = 'full', sheen, style}) => {
  const c = BILL[tone];
  const id = `fh-bill-${tone}`;
  const full = detail === 'full';
  const wave = (y: number, x0: number) =>
    `M${x0} ${y} q 12 -7 24 0 t 24 0 t 24 0 t 24 0 t 24 0`;
  return (
    <svg width={width} height={width / BILL_ASPECT} viewBox="0 0 470 200" style={{display: 'block', overflow: 'visible', ...style}}>
      <defs>
        <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={c.base} />
          <stop offset="100%" stopColor={c.base2} />
        </linearGradient>
        <linearGradient id={`${id}-sheen`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity={0} />
          <stop offset="50%" stopColor="#FFFFFF" stopOpacity={0.55} />
          <stop offset="100%" stopColor="#FFFFFF" stopOpacity={0} />
        </linearGradient>
      </defs>
      <rect x={1.5} y={1.5} width={467} height={197} rx={12} fill={`url(#${id}-bg)`} stroke={c.line} strokeWidth={3} />
      <rect x={14} y={14} width={442} height={172} rx={8} fill="none" stroke={c.ink} strokeOpacity={0.5} strokeWidth={2.2} />
      {full ? (
        <>
          <rect x={22} y={22} width={426} height={156} rx={6} fill="none" stroke={c.ink} strokeOpacity={0.22} strokeWidth={1.5} strokeDasharray="2 4" />
          {[64, 100, 136].map((y) => (
            <React.Fragment key={y}>
              <path d={wave(y, 34)} fill="none" stroke={c.ink} strokeOpacity={0.14} strokeWidth={1.6} />
              <path d={wave(y, 316)} fill="none" stroke={c.ink} strokeOpacity={0.14} strokeWidth={1.6} />
            </React.Fragment>
          ))}
          {[
            [56, 54],
            [414, 54],
            [56, 146],
            [414, 146],
          ].map(([x, y]) => (
            <g key={`${x}-${y}`}>
              <circle cx={x} cy={y} r={19} fill={c.seal} stroke={c.ink} strokeOpacity={0.42} strokeWidth={2} strokeDasharray="4 3" />
              <circle cx={x} cy={y} r={8} fill={c.ink} fillOpacity={0.2} />
            </g>
          ))}
          {[
            [96, 82, 70],
            [96, 98, 54],
            [96, 114, 62],
            [304, 82, 70],
            [320, 98, 54],
            [312, 114, 62],
          ].map(([x, y, w]) => (
            <rect key={`${x}-${y}`} x={x} y={y} width={w} height={6} rx={3} fill={c.ink} fillOpacity={0.13} />
          ))}
        </>
      ) : null}
      <circle cx={235} cy={100} r={58} fill={c.seal} stroke={c.ink} strokeOpacity={0.55} strokeWidth={2.6} />
      {full ? <circle cx={235} cy={100} r={48} fill="none" stroke={c.ink} strokeOpacity={0.25} strokeWidth={1.6} strokeDasharray="3 4" /> : null}
      <g transform="translate(213.5 71) scale(1.8)">
        <path d={DOLLAR_D} fill="none" stroke={c.ink} strokeWidth={2.9} strokeLinecap="round" strokeLinejoin="round" strokeOpacity={0.85} />
      </g>
      {sheen !== undefined ? (
        <rect x={-200 + 870 * sheen} y={0} width={200} height={200} fill={`url(#${id}-sheen)`} transform="skewX(-18)" style={{mixBlendMode: 'screen'}} />
      ) : null}
    </svg>
  );
};

export type CashStackProps = {
  /** Width of the bills on top, px. */
  width?: number;
  /** Thickness of the stack, px. Animate it to stack cash up. */
  height: number;
  /** Where the bottom of the stack sits above the floor, px (put a second stack on top of a first). */
  base?: number;
  /** View angle: rx tips the floor toward the camera, rz turns the stack. */
  view?: {rx?: number; rz?: number};
  tone?: MoneyTone;
  /** A band around the stack (accent blue). */
  strap?: boolean;
  /** Soft shadow on the floor under the stack. */
  shadow?: boolean;
  style?: React.CSSProperties;
};

/**
 * A strapped stack of bills as a real 3D block: the top bill, paper edges on
 * the sides, a band around it. Set `height` from a prop or an animation to
 * stack cash up; heights are a picture, never a dollar amount.
 */
export const CashStack: React.FC<CashStackProps> = ({
  width = 300,
  height,
  base = 0,
  view = {},
  tone = 'green',
  strap = true,
  shadow = true,
  style,
}) => {
  const c = BILL[tone];
  const W = width;
  const D = width / BILL_ASPECT;
  const h = Math.max(0, height);
  const strapL = 0.24;
  const strapW = 0.11;
  const edges = (dir: '90deg' | '180deg', dark: boolean) =>
    `repeating-linear-gradient(${dir}, ${dark ? c.edge : '#F4F9F5'} 0px, ${dark ? c.edge : '#F4F9F5'} 2px, ${dark ? c.edgeDark : c.edge} 2px, ${dark ? c.edgeDark : c.edge} 3px)`;
  const band = (dir: 'x' | 'none') =>
    strap && dir === 'x' ? (
      <div
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: `${strapL * 100}%`,
          width: `${strapW * 100}%`,
          background: 'linear-gradient(90deg, #2F74DA, #3D86F0 30%, #5B9AF3 50%, #3D86F0 70%, #2F74DA)',
        }}
      />
    ) : null;
  const face: React.CSSProperties = {position: 'absolute', backfaceVisibility: 'visible'};
  return (
    <div
      style={{
        position: 'relative',
        width: W,
        height: D,
        ...P3D,
        transform: `rotateX(${view.rx ?? 58}deg) rotateZ(${view.rz ?? -26}deg)`,
        ...style,
      }}
    >
      {shadow ? (
        <div
          style={{
            ...face,
            left: -W * 0.12,
            top: -D * 0.1,
            width: W * 1.24,
            height: D * 1.3,
            borderRadius: '50%',
            background: 'radial-gradient(closest-side, rgba(10,10,10,.16), rgba(10,10,10,.06) 60%, rgba(10,10,10,0))',
            transform: `translate3d(${W * 0.05}px, ${D * 0.12}px, ${base - 1}px)`,
          }}
        />
      ) : null}
      {h > 0.5 ? (
        <>
          {/* back and left faces (seen when the stack is turned the other way) */}
          <div style={{...face, left: 0, top: 0, width: W, height: h, transformOrigin: 'top', transform: `translateZ(${base}px) rotateX(90deg)`, background: edges('180deg', true)}}>
            {band('x')}
          </div>
          <div style={{...face, left: 0, top: 0, width: h, height: D, transformOrigin: 'left', transform: `translateZ(${base}px) rotateY(-90deg)`, background: edges('90deg', true)}} />
          {/* right face, in shade */}
          <div style={{...face, left: W, top: 0, width: h, height: D, transformOrigin: 'left', transform: `translateZ(${base}px) rotateY(-90deg)`, background: edges('90deg', true)}} />
          {/* front face, lit */}
          <div style={{...face, left: 0, top: D, width: W, height: h, transformOrigin: 'top', transform: `translateZ(${base}px) rotateX(90deg)`, background: edges('180deg', false)}}>
            {band('x')}
          </div>
        </>
      ) : null}
      {/* the top bill */}
      <div style={{...face, left: 0, top: 0, width: W, height: D, transform: `translateZ(${base + h}px)`}}>
        <DollarBill width={W} tone={tone} />
        {strap && h > 0.5 ? (
          <div
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: `${strapL * 100}%`,
              width: `${strapW * 100}%`,
              background: 'linear-gradient(90deg, #2F74DA, #3D86F0 30%, #6AA4F5 50%, #3D86F0 70%, #2F74DA)',
              boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.18)',
            }}
          />
        ) : null}
      </div>
    </div>
  );
};

export type CoinProps = {
  /** Diameter, px. */
  size?: number;
  /** Edge thickness, px (default 9% of the size). */
  thickness?: number;
  /** Turn around its vertical axis, degrees (animate it to spin or flip). */
  spin?: number;
  /** Tip toward the camera (rx) and turn in the picture (rz), degrees. */
  tilt?: {rx?: number; rz?: number};
  tone?: 'gold' | 'accent';
  style?: React.CSSProperties;
};

const CoinFace: React.FC<{size: number; tone: 'gold' | 'accent'; style?: React.CSSProperties}> = ({size, tone, style}) => {
  const c = COIN[tone];
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        borderRadius: '50%',
        background: `radial-gradient(circle at 34% 28%, ${c.hi} 0%, ${c.mid} 46%, ${c.lo} 100%)`,
        boxShadow: `inset 0 0 0 ${size * 0.035}px ${c.rim}, inset 0 0 0 ${size * 0.075}px rgba(255,255,255,.28)`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        ...style,
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: size * 0.14,
          borderRadius: '50%',
          border: `${Math.max(1.5, size * 0.016)}px dashed ${c.ink}`,
          opacity: 0.45,
        }}
      />
      <DollarMark height={size * 0.5} color={c.ink} weight={2.9} style={{opacity: 0.9}} />
    </div>
  );
};

/** A coin with real thickness. Spin it with `spin`; edge-on it shows its rim. No number on it. */
export const Coin: React.FC<CoinProps> = ({size = 120, thickness, spin = 0, tilt = {}, tone = 'gold', style}) => {
  const t = thickness ?? size * 0.09;
  const c = COIN[tone];
  const layers = 7;
  return (
    <div
      style={{
        position: 'relative',
        width: size,
        height: size,
        ...P3D,
        transform: `rotateX(${tilt.rx ?? 0}deg) rotateZ(${tilt.rz ?? 0}deg) rotateY(${spin}deg)`,
        ...style,
      }}
    >
      {Array.from({length: layers}, (_, i) => {
        const z = -t / 2 + (t * (i + 1)) / (layers + 1);
        return <div key={i} style={{position: 'absolute', inset: 0, borderRadius: '50%', background: c.rim, transform: `translateZ(${z}px)`}} />;
      })}
      <CoinFace size={size} tone={tone} style={{transform: `translateZ(${-t / 2}px) rotateY(180deg)`}} />
      <CoinFace size={size} tone={tone} style={{transform: `translateZ(${t / 2}px)`}} />
    </div>
  );
};

/** A flat coin (no thickness): cheaper, for fields of many coins. */
export const FlatCoin: React.FC<{size: number; tone?: 'gold' | 'accent'; style?: React.CSSProperties}> = ({size, tone = 'gold', style}) => (
  <div style={{position: 'relative', width: size, height: size, ...style}}>
    <CoinFace size={size} tone={tone} />
  </div>
);

type Pt = {x: number; y: number};

export type MoneyFieldProps = {
  /** The template frame (f from useTimeline). */
  f: number;
  /**
   * fall: bills float down. rise: bills float up. drift: bills hang and sway.
   * pour: a stream falls out of `from`. burst: they fly up out of `from` and fall.
   * flow: they travel from `from` to `to` and vanish there. recede: they move away into the distance.
   */
  mode: 'fall' | 'rise' | 'drift' | 'pour' | 'burst' | 'flow' | 'recede';
  count?: number;
  /** Change it to get a different, but repeatable, layout. */
  seed?: string;
  /** Where the money shows, in the parent stage's px (screen space; depth is handled for you). */
  area?: {x: number; y: number; w: number; h: number};
  /** Bill width range, px. */
  size?: [number, number];
  /** Depth range, px (negative = behind the stage plane). */
  depth?: [number, number];
  /** Strength of the nearest piece, 0 to 1. Far pieces are fainter. */
  opacity?: number;
  /** Blur in px on the farthest pieces (depth of field). 0 = none, the cheapest. */
  blur?: number;
  kind?: 'bill' | 'coin' | 'mix';
  tone?: MoneyTone;
  coinTone?: 'gold' | 'accent';
  speed?: number;
  /** pour / burst origin, flow start (stage px). */
  from?: Pt;
  /** flow end (stage px). */
  to?: Pt;
  /** pour / burst / flow: how wide the starting point is, px (0 = one point). */
  spread?: number;
  /** Frames: when pour / burst / flow start and stop sending money (recede: when pieces start pulling away, and when they reach the back). */
  start?: number;
  end?: number;
  /** flow: frames each piece takes to arrive. */
  travel?: number;
  /** flow: how far a piece may bow off the straight line, px (default 120; small keeps it on the line). */
  arc?: number;
  /** 0 to 1 overall fade (an entrance or exit). */
  appear?: number;
  /** The stage this field sits on: content stage (Stage3D) or full frame (BackdropStage, the default). */
  stage?: 'backdrop' | 'content';
};

/**
 * Many bills (or coins) moving through depth: rain, rising cash, a pour, a
 * flow toward a point. Deterministic: the same seed draws the same picture
 * every render. Put it inside BackdropStage (full frame, the default) or
 * inside Stage3D with stage="content".
 */
export const MoneyField: React.FC<MoneyFieldProps> = ({
  f,
  mode,
  count = 10,
  seed = 'money',
  area,
  size = [150, 250],
  depth = [-700, -150],
  opacity = 0.5,
  blur = 0,
  kind = 'bill',
  tone = 'green',
  coinTone = 'gold',
  speed = 1,
  from,
  to,
  spread = 0,
  start = 0,
  end = 60,
  travel = 20,
  arc: arcMax = 120,
  appear = 1,
  stage = 'backdrop',
}) => {
  const P = stage === 'backdrop' ? DEPTH.backdropPerspective : DEPTH.perspective;
  const o = stage === 'backdrop' ? STAGE_CENTER : {x: 450, y: 412};
  const A = area ?? (stage === 'backdrop' ? {x: 0, y: 0, w: 1080, h: 1920} : {x: 0, y: 0, w: 900, h: 824});
  const src = from ?? {x: A.x + A.w / 2, y: A.y};
  const dst = to ?? {x: A.x + A.w / 2, y: A.y + A.h};
  const pieces: React.ReactNode[] = [];

  for (let i = 0; i < count; i++) {
    const r = (k: number) => random(`${seed}-${i}-${k}`);
    const z0 = depth[0] + (depth[1] - depth[0]) * r(1);
    const near = depth[1] === depth[0] ? 1 : (z0 - depth[0]) / (depth[1] - depth[0]);
    const w = size[0] + (size[1] - size[0]) * r(2);
    const isCoin = kind === 'coin' || (kind === 'mix' && r(9) < 0.4);
    const pw = isCoin ? w * 0.42 : w;
    const ph = isCoin ? w * 0.42 : w / BILL_ASPECT;
    const phase = r(3) * Math.PI * 2;
    let x = 0;
    let y = 0;
    let z = z0;
    let rx = 0;
    let ry = 0;
    let rz = 0;
    let a = 1;
    let grow = 1;
    const s = P / (P - z0); // how much this depth shrinks things on screen
    const margin = Math.max(pw, ph) * s * 0.8;

    if (mode === 'fall' || mode === 'rise') {
      const span = A.h + margin * 2;
      const v = (2.2 + 2.4 * r(4)) * (0.6 + 0.6 * near) * speed;
      const p = (((r(5) * span + f * v) % span) + span) % span;
      y = mode === 'fall' ? A.y - margin + p : A.y + A.h + margin - p;
      x = A.x + r(6) * A.w + Math.sin(f * 0.05 * speed + phase) * 26;
      rz = -32 + 64 * r(7) + Math.sin(f * 0.06 * speed + phase) * 14;
      rx = Math.sin(f * 0.08 * speed + phase * 1.3) * 34;
      ry = Math.cos(f * 0.05 * speed + phase) * 26;
    } else if (mode === 'drift') {
      x = A.x + r(6) * A.w + Math.sin(f * 0.03 * speed + phase) * 22;
      y = A.y + r(5) * A.h + Math.cos(f * 0.026 * speed + phase) * 24 - f * 0.35 * speed;
      rz = -38 + 76 * r(7) + Math.sin(f * 0.035 * speed + phase) * 7;
      rx = 14 + Math.sin(f * 0.04 * speed + phase) * 16;
      ry = Math.cos(f * 0.032 * speed + phase) * 20;
    } else if (mode === 'recede') {
      // From `start`, each piece pulls away into the distance; by `end` it is
      // far back and faint (never fully gone, so the last frame still shows it).
      const el = Math.max(0, f - start);
      const span = Math.max(1, end - start);
      x = A.x + r(6) * A.w;
      y = A.y + r(5) * A.h - el * 0.6 * speed;
      z = z0 - el * (9 + 8 * r(4)) * speed;
      a = Math.min(1, el / 10) * (1 - 0.6 * Math.min(1, el / span));
      rz = -30 + 60 * r(7) + el * 0.25 * (r(8) - 0.5);
      rx = 20 + Math.sin(f * 0.05 + phase) * 12;
      ry = Math.cos(f * 0.04 + phase) * 16;
    } else if (mode === 'pour' || mode === 'burst') {
      const born = start + (end - start) * ((i + r(8) * 0.8) / count);
      const age = f - born;
      if (age < 0) continue;
      const burst = mode === 'burst';
      const vx = (r(4) - 0.5) * (burst ? 16 : 7) * speed;
      const vy = (burst ? -(9 + r(5) * 9) : 1.5 + r(5) * 3.5) * speed;
      const g = (burst ? 0.75 : 0.55) * speed * speed;
      x = src.x + (r(10) - 0.5) * spread + vx * age + Math.sin(age * 0.12 + phase) * 10;
      y = src.y + vy * age + 0.5 * g * age * age;
      rz = -40 + 80 * r(7) + age * (r(6) - 0.5) * 9;
      rx = Math.sin(age * 0.16 + phase) * 50;
      ry = Math.cos(age * 0.12 + phase) * 36;
      a = Math.min(1, age / 4);
    } else {
      // flow
      const born = start + Math.max(0, end - start - travel) * ((i + r(8) * 0.6) / count);
      const q = (f - born) / travel;
      if (q < 0 || q > 1) continue;
      const e = q < 0.5 ? 2 * q * q : 1 - (-2 * q + 2) ** 2 / 2;
      const sx = src.x + (r(10) - 0.5) * spread;
      const dx = dst.x - sx;
      const dy = dst.y - src.y;
      const len = Math.hypot(dx, dy) || 1;
      const arc = Math.sin(e * Math.PI) * (r(4) - 0.5) * arcMax;
      x = sx + dx * e + (-dy / len) * arc;
      y = src.y + dy * e + (dx / len) * arc;
      rz = -25 + 50 * r(7) + e * 40 * (r(6) - 0.5);
      rx = Math.sin(e * Math.PI * 2 + phase) * 30;
      ry = Math.cos(e * Math.PI + phase) * 22;
      a = Math.min(1, q / 0.15, (1 - q) / 0.2);
      grow = 1 - 0.4 * e; // shrinks as it arrives, as if taken in
    }

    // Screen position -> position on this piece's own depth plane.
    const k = (P - z) / P;
    const X = o.x + (x - o.x) * k;
    const Y = o.y + (y - o.y) * k;
    const alpha = Math.max(0, opacity * (0.55 + 0.45 * near) * a * appear);
    if (alpha < 0.005) continue;
    const b = blur * (1 - near);
    pieces.push(
      <div
        key={i}
        style={{
          position: 'absolute',
          left: X - pw / 2,
          top: Y - ph / 2,
          width: pw,
          height: ph,
          opacity: alpha,
          filter: b > 0.3 ? `blur(${b.toFixed(1)}px)` : undefined,
          transform: `translateZ(${z}px) rotateZ(${rz}deg) rotateX(${rx}deg) rotateY(${ry}deg) scale(${grow})`,
        }}
      >
        {isCoin ? <FlatCoin size={pw} tone={coinTone} /> : <DollarBill width={pw} tone={tone} detail="simple" />}
      </div>,
    );
  }
  return <>{pieces}</>;
};

/**
 * One bill that flies off from where it is placed (money leaving): it pops
 * in, travels by (dx, dy) while it tumbles toward the camera, and fades out.
 * Place it with `style` (position absolute). `progress` 0 to 1 runs the flight.
 */
export const FlyingBill: React.FC<{
  progress: number;
  dx?: number;
  dy?: number;
  width?: number;
  tone?: MoneyTone;
  /** Turn during the flight, degrees. */
  turn?: number;
  style?: React.CSSProperties;
}> = ({progress, dx = 360, dy = -40, width = 110, tone = 'green', turn = -28, style}) => {
  if (progress <= 0 || progress >= 1) return null;
  const e = 1 - (1 - progress) ** 2;
  const a = Math.min(1, progress / 0.12, (1 - progress) / 0.35);
  return (
    <div
      style={{
        position: 'absolute',
        pointerEvents: 'none',
        opacity: a,
        transform: `translate3d(${dx * e}px, ${dy * e + 30 * progress * progress}px, ${20 + 120 * e}px) rotateZ(${turn * e}deg) rotateX(${28 * e}deg) rotateY(${-22 * e}deg) scale(${0.7 + 0.3 * Math.min(1, progress * 4)})`,
        filter: 'drop-shadow(0 10px 12px rgba(10,10,10,.14))',
        ...style,
      }}
    >
      <DollarBill width={width} tone={tone} detail="simple" />
    </div>
  );
};

/**
 * Two MoneyFields, one down each side of the frame, so money peeks out from
 * behind the cards and never sits behind a line of words. Full-frame only
 * (inside BackdropStage). Same props as MoneyField, minus `area`.
 */
export const MoneyGutters: React.FC<Omit<MoneyFieldProps, 'area' | 'stage'> & {gutter?: number}> = ({gutter = 250, seed = 'gutters', count = 10, ...rest}) => (
  <>
    <MoneyField {...rest} seed={`${seed}-l`} count={Math.ceil(count / 2)} area={{x: -100, y: 0, w: gutter, h: 1920}} />
    <MoneyField {...rest} seed={`${seed}-r`} count={Math.floor(count / 2)} area={{x: 1080 + 100 - gutter, y: 0, w: gutter, h: 1920}} />
  </>
);

export type DollarCounterProps = {
  /** The amount to land on. It must come from props (the script line, the page, the sample client or a real approval). */
  value: number;
  /** Template frame and the frames the count runs between. */
  f: number;
  start: number;
  end: number;
  /** Count from here (default 0). */
  from?: number;
  /** Font size, px. */
  size: number;
  color?: string;
  weight?: number;
  style?: React.CSSProperties;
};

/**
 * Counting dollars: a rolling-digit counter (each digit rolls like a drum)
 * that lands exactly on `value`. Digit columns open up as the number grows, so
 * it never shows leading zeros, and it centers or aligns like plain text.
 */
export const DollarCounter: React.FC<DollarCounterProps> = ({value, f, start, end, from = 0, size, color = 'currentColor', weight = 800, style}) => {
  const target = Math.max(0, Math.round(value));
  const v = countUp(f, start, end, Math.max(0, from), target);
  const n = String(target).length;
  // A place-value column opens only once the count reaches it (1,000,000
  // opens the millions), fading in while its digit rolls 0 -> 1. It never
  // opens early, so there is never a leading "0" (no "$0,999,985").
  const opened = (k: number): number => (k === 0 ? 1 : Math.max(0, Math.min(1, v - (10 ** k - 1))));
  const lineH = size * 1.06;
  const digitW = size * 0.62;
  const commaW = size * 0.27;
  const cols: React.ReactNode[] = [];
  for (let idx = 0; idx < n; idx++) {
    const k = n - 1 - idx; // place value: 0 = ones
    const on = opened(k);
    // Odometer: the ones digit rolls freely; every other digit only rolls
    // while everything below it turns over from ...999 to ...000 (the carry),
    // so the last frame always shows exactly `value`.
    const unit = 10 ** k;
    const carry = k === 0 ? 0 : Math.max(0, Math.min(1, (v % unit) - (unit - 1)));
    const d = k === 0 ? v % 10 : (Math.floor(v / unit) % 10) + carry;
    cols.push(
      <span
        key={`d${k}`}
        style={{
          position: 'relative',
          display: 'inline-block',
          width: digitW * on,
          height: lineH,
          overflow: 'hidden',
          opacity: on,
          WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, #000 14%, #000 86%, transparent 100%)',
        }}
      >
        <span style={{position: 'absolute', left: 0, top: 0, width: digitW, transform: `translateY(${-d * lineH}px)`}}>
          {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map((digit, j) => (
            <span key={j} style={{display: 'block', height: lineH, lineHeight: `${lineH}px`, textAlign: 'center'}}>
              {digit}
            </span>
          ))}
        </span>
      </span>,
    );
    if (k > 0 && k % 3 === 0) {
      const cOn = opened(k);
      cols.push(
        <span key={`c${k}`} style={{display: 'inline-block', width: commaW * cOn, overflow: 'hidden', opacity: cOn, textAlign: 'left'}}>
          ,
        </span>,
      );
    }
  }
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        fontSize: size,
        fontWeight: weight,
        color,
        letterSpacing: TRACK.num,
        lineHeight: `${lineH}px`,
        fontVariantNumeric: 'tabular-nums',
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      <span style={{display: 'inline-block', marginRight: size * 0.01}}>$</span>
      {cols}
    </span>
  );
};

/**
 * A fan of bills spreading out from one corner, like cash held in a hand.
 * `spread` 0 to 1 opens the fan (animate it). No numbers on any bill.
 */
export const BillFan: React.FC<{
  spread: number;
  count?: number;
  width?: number;
  /** Total fan angle when fully open, degrees. */
  angle?: number;
  tone?: MoneyTone;
  style?: React.CSSProperties;
}> = ({spread, count = 5, width = 300, angle = 48, tone = 'green', style}) => {
  const h = width / BILL_ASPECT;
  return (
    <div style={{position: 'relative', width, height: h, ...P3D, ...style}}>
      {Array.from({length: count}, (_, i) => {
        const at = count === 1 ? 0 : i / (count - 1) - 0.5;
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              transformOrigin: `${width * 0.12}px ${h * 0.86}px`,
              transform: `translateZ(${i * 3}px) rotateZ(${at * angle * spread}deg)`,
              boxShadow: '0 6px 14px rgba(10,10,10,.10)',
              borderRadius: width * 0.026,
            }}
          >
            <DollarBill width={width} tone={tone} detail={i === count - 1 ? 'full' : 'simple'} />
          </div>
        );
      })}
    </div>
  );
};
