import React from 'react';
import {useCurrentFrame, useVideoConfig} from 'remotion';
import {COLORS, DollarBill, Eyebrow, P3D, TRACK, enter, fadeUp} from '../brand';

// Shared pieces for the tool-analogy clips (FlatTireHammer, JackFix): the car
// corner with its wheel, the hammer, the scissor jack, the cross lug wrench
// and the little clock next to the caption. All drawn in code (SVG + CSS 3D),
// in the kit's look: white car body, charcoal tire, silver rim, and the right
// tools in the accent blue. No WebGL, no new packages.
//
// Coordinates: px, y down. The wheel's axis points at the camera (+z), so the
// outer sidewall faces the viewer. Turned parts (tire, rim, tools) are stacks
// of flat slices, like the kit's Coin: each slice is a filled shape, so the
// stack reads as a solid object from any angle the camera takes here.

// --- Timing ---------------------------------------------------------------

/** Clamp a requested clip length to the clip's own range (frames at 30 fps). */
export const clampTool = (frames: number | undefined, fallback: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, Math.round(frames ?? fallback)));

/**
 * The clip's own frame `f`, stretched so the joke lands before the clip ends at
 * any allowed length. The length comes from props (not useVideoConfig), so a
 * frozen preview keeps its timing.
 */
export const useToolTimeline = (base: number, requested: number | undefined, min: number, max: number): {f: number; fps: number} => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  return {f: (frame * base) / clampTool(requested, base, min, max), fps};
};

export const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
/** 0 to 1 between two frames, linear. */
export const seg = (f: number, a: number, b: number): number => clamp01((f - a) / (b - a));
export const easeIn = (t: number): number => clamp01(t) ** 3;
export const easeOut = (t: number): number => 1 - (1 - clamp01(t)) ** 3;
export const easeInOut = (t: number): number => {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
};

type Ease = 'linear' | 'in' | 'out' | 'inout';
const EASE: Record<Ease, (t: number) => number> = {linear: clamp01, in: easeIn, out: easeOut, inout: easeInOut};

/**
 * Keyframes: [[frame, value], [frame, value, ease], ...]. The ease on a key
 * shapes the segment that ends on it. Holds the first and last values outside.
 */
export const track = (f: number, keys: Array<[number, number, Ease?]>): number => {
  if (f <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [f1, v1, e = 'inout'] = keys[i];
    const [f0, v0] = keys[i - 1];
    if (f <= f1) return v0 + (v1 - v0) * EASE[e](f1 === f0 ? 1 : (f - f0) / (f1 - f0));
  }
  return keys[keys.length - 1][1];
};

/** A damped shake that starts at frame `at`: amp * e^(-t/decay) * sin(t * speed). */
export const wobble = (f: number, at: number, amp: number, speed = 0.9, decay = 7): number => {
  const t = f - at;
  return t < 0 ? 0 : amp * Math.exp(-t / decay) * Math.sin(t * speed);
};

const DEG = Math.PI / 180;
/** Smallest angle between two angles, radians. */
const angDist = (a: number, b: number): number => {
  const d = Math.abs(((a - b) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  return Math.min(d, 2 * Math.PI - d);
};

// --- Geometry ---------------------------------------------------------------

export const WHEEL = {
  /** Tire outer radius when full. */
  R: 232,
  /** Tire width (along the axle). */
  T: 140,
  /** Rim lip radius. */
  rim: 140,
  /** How far the flat tire's bottom sits above where a full tire's would. */
  flatDrop: 44,
  /** Wheel-arch radius in the body panel. */
  arch: 268,
  /** The rocker (bottom edge of the body) below the hub. */
  rocker: 82,
} as const;

/** Where the dent goes when the rim bends: upper right, where the hammer lands. */
export const DENT_ANGLE = -38 * DEG;

const Z_FACE = WHEEL.T / 2; // the outer sidewall
export const Z_BODY = Z_FACE + 6; // the body panel, just outboard of the tire
const Z_WELL = -WHEEL.T / 2 - 26; // back of the wheel well

const polyPath = (r: (theta: number) => number, n: number): string => {
  let d = '';
  for (let i = 0; i < n; i++) {
    const t = (i / n) * 2 * Math.PI;
    const rr = r(t);
    d += `${i === 0 ? 'M' : 'L'}${(rr * Math.cos(t)).toFixed(1)} ${(rr * Math.sin(t)).toFixed(1)}`;
  }
  return `${d}Z`;
};
const circlePath = (r: number): string => `M${r} 0A${r} ${r} 0 1 1 ${-r} 0A${r} ${r} 0 1 1 ${r} 0Z`;

/** A flat SVG placed at depth z, centered on (0, 0) of its parent. */
const Slice: React.FC<{z: number; size: number; bottom?: number; children: React.ReactNode; style?: React.CSSProperties}> = ({z, size, bottom, children, style}) => {
  // The element's box is what the browser sorts in 3D, so keep it tight: a box
  // that pokes through another plane (the road) gets split, and a split piece
  // can drop out with the default renderer. `bottom` cuts the box off there.
  const h = bottom === undefined ? size : size / 2 + bottom;
  return (
    <svg
      width={size}
      height={h}
      viewBox={`${-size / 2} ${-size / 2} ${size} ${h}`}
      style={{position: 'absolute', left: -size / 2, top: -size / 2, overflow: 'visible', transform: `translateZ(${z.toFixed(2)}px)`, ...style}}
    >
      {children}
    </svg>
  );
};

// --- The tire ---------------------------------------------------------------

/**
 * Outer radius of the tire at angle `theta` (0 = right, +90deg = down) for the
 * slice at `zn` (-1 back sidewall .. +1 outer sidewall). A flat tire sits on a
 * flat patch and bulges out just above it.
 */
const tireR = (theta: number, zn: number, flat: number, tread: number | null): number => {
  const {R, flatDrop} = WHEEL;
  const down = angDist(theta, Math.PI / 2);
  const g = Math.exp(-((down / 0.85) ** 2));
  const shoulder = 30 * (1 - 0.72 * flat * g);
  let r = R - shoulder * (1 - Math.sqrt(Math.max(0, 1 - zn * zn)));
  r += flat * 20 * g;
  if (tread !== null) {
    // Tread blocks: short grooves across the tread, staggered rib to rib.
    const deg = (((theta / DEG + tread) % 7.5) + 7.5) % 7.5;
    if (deg < 1.9) r -= 6;
  }
  const s = Math.sin(theta);
  const contact = R - flatDrop * flat;
  if (s > 0.02) r = Math.min(r, contact / s);
  return r;
};

const TIRE_SLICES = 13;

/** The tire: 13 slices across its width. Ribs alternate shade, so the tread reads as grooves. */
export const Tire: React.FC<{flat: number; id: string}> = ({flat, id}) => {
  const {R, T, rim} = WHEEL;
  const size = 2 * (R + 24);
  const contact = R - WHEEL.flatDrop * flat;
  // The outer slices leave room for the rim lip; the inner ones close in behind
  // the barrel, so a steep view never sees a gap stepping down between them.
  const holeOuter = circlePath(rim - 8);
  const holeInner = circlePath(rim - 30);
  const slices: React.ReactNode[] = [];
  for (let k = 0; k < TIRE_SLICES; k++) {
    const zn = -1 + (2 * k) / (TIRE_SLICES - 1);
    const z = (zn * T) / 2;
    const isFace = k === TIRE_SLICES - 1;
    const isBack = k === 0;
    const tread = !isFace && !isBack && Math.abs(zn) < 0.86 ? (k % 2) * 3.75 : null;
    const outer = polyPath((t) => tireR(t, zn, flat, tread), tread === null ? 200 : 480);
    slices.push(
      <Slice key={k} z={z} size={size} bottom={contact}>
        <path
          d={`${outer} ${z > T / 2 - 26 ? holeOuter : holeInner}`}
          fillRule="evenodd"
          fill={isFace ? `url(#${id}-wall)` : isBack ? '#1B1B1F' : k % 2 ? `url(#${id}-ribA)` : `url(#${id}-ribB)`}
        />
        {isFace ? (
          <>
            {/* bead ring, a faint second ring, and a soft sheen on the upper left */}
            <path d={circlePath(rim + 22)} fill="none" stroke="#3E3E46" strokeWidth={2.5} />
            <path d={circlePath(rim + 30)} fill="none" stroke="#202024" strokeWidth={1.5} />
            <path
              d={`M ${((R - 34) * Math.cos(195 * DEG)).toFixed(1)} ${((R - 34) * Math.sin(195 * DEG)).toFixed(1)} A ${R - 34} ${R - 34} 0 0 1 ${((R - 34) * Math.cos(255 * DEG)).toFixed(1)} ${((R - 34) * Math.sin(255 * DEG)).toFixed(1)}`}
              fill="none"
              stroke="rgba(255,255,255,.10)"
              strokeWidth={16}
              strokeLinecap="round"
            />
          </>
        ) : null}
      </Slice>,
    );
  }
  return (
    <>
      <svg width={0} height={0} style={{position: 'absolute'}}>
        <defs>
          <radialGradient id={`${id}-wall`} cx={0} cy={0} r={R} gradientUnits="userSpaceOnUse">
            <stop offset={`${((rim - 8) / R) * 100}%`} stopColor="#2A2A2F" />
            <stop offset="72%" stopColor="#222226" />
            <stop offset="90%" stopColor="#34343A" />
            <stop offset="100%" stopColor="#3F3F46" />
          </radialGradient>
          <linearGradient id={`${id}-ribA`} x1={0} y1={-R} x2={0} y2={R} gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#4A4A52" />
            <stop offset="45%" stopColor="#2C2C31" />
            <stop offset="100%" stopColor="#18181B" />
          </linearGradient>
          <linearGradient id={`${id}-ribB`} x1={0} y1={-R} x2={0} y2={R} gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#3A3A41" />
            <stop offset="45%" stopColor="#222226" />
            <stop offset="100%" stopColor="#121214" />
          </linearGradient>
        </defs>
      </svg>
      {slices}
    </>
  );
};

// --- The rim ----------------------------------------------------------------

const lipR = (theta: number, dent: number): number => WHEEL.rim - 38 * dent * Math.exp(-((angDist(theta, DENT_ANGLE) / 0.4) ** 2));

/** One lug nut: a small extruded hex. */
const LugNut: React.FC<{size?: number}> = ({size = 22}) => {
  const hex = Array.from({length: 6}, (_, i) => {
    const a = (i / 6) * 2 * Math.PI + Math.PI / 6;
    return `${((size / 2) * Math.cos(a)).toFixed(1)},${((size / 2) * Math.sin(a)).toFixed(1)}`;
  }).join(' ');
  return (
    <div style={{position: 'absolute', left: 0, top: 0, ...P3D}}>
      {[0, 4, 8].map((z) => (
        <Slice key={z} z={z} size={size + 4}>
          <polygon points={hex} fill={z === 8 ? 'url(#tool-nut)' : '#8C8C95'} stroke={z === 8 ? '#9C9CA5' : 'none'} strokeWidth={1.2} />
          {z === 8 ? <circle r={size * 0.2} fill="#B7B7BF" /> : null}
        </Slice>
      ))}
    </div>
  );
};

/** Where the lug nuts sit on the hub. */
export const NUTS = Array.from({length: 5}, (_, i) => -90 * DEG + (i * 2 * Math.PI) / 5);
const NUT_R = 42;

export type NutState = {out: number; spin: number};

/**
 * The rim: barrel, brake disc with an accent caliper, five spokes, hub, cap
 * and lug nuts. `dent` (0 to 1) pushes the lip in where the hammer landed.
 * `nuts[i].out` 0 = seated, 1 = off (it backs out toward the camera and drops away).
 */
export const Rim: React.FC<{dent?: number; nuts?: NutState[]; id: string}> = ({dent = 0, nuts, id}) => {
  const {rim, T} = WHEEL;
  const size = 2 * (rim + 20);
  const lip = (inset: number) => polyPath((t) => lipR(t, dent) - inset, 160);
  const spokes = Array.from({length: 5}, (_, i) => -90 + i * 72);
  const spoke = (deg: number) => {
    const a = deg * DEG;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    const px = -uy;
    const py = ux;
    const r0 = 56;
    const r1 = lipR(a, dent) - 12;
    const w0 = 15;
    const w1 = 23;
    const pts = [
      [r0 * ux + w0 * px, r0 * uy + w0 * py],
      [r1 * ux + w1 * px, r1 * uy + w1 * py],
      [r1 * ux - w1 * px, r1 * uy - w1 * py],
      [r0 * ux - w0 * px, r0 * uy - w0 * py],
    ];
    return {pts: pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' '), ridge: [r0 * ux, r0 * uy, r1 * ux, r1 * uy]};
  };
  const zLip = Z_FACE - 14;
  return (
    <>
      <svg width={0} height={0} style={{position: 'absolute'}}>
        <defs>
          <linearGradient id={`${id}-silver`} x1={-rim} y1={-rim} x2={rim} y2={rim} gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#FBFBFC" />
            <stop offset="45%" stopColor="#E3E3E8" />
            <stop offset="100%" stopColor="#B8B8C0" />
          </linearGradient>
          <linearGradient id={`${id}-spoke`} x1={-rim} y1={-rim} x2={rim} y2={rim} gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#F6F6F8" />
            <stop offset="100%" stopColor="#C5C5CC" />
          </linearGradient>
          <radialGradient id={`${id}-disc`} cx={0} cy={0} r={rim} gradientUnits="userSpaceOnUse">
            <stop offset="30%" stopColor="#7E7E87" />
            <stop offset="70%" stopColor="#A4A4AD" />
            <stop offset="100%" stopColor="#8A8A93" />
          </radialGradient>
          <radialGradient id={`${id}-cap`} cx="38%" cy="32%" r="75%">
            <stop offset="0%" stopColor="#7FB0F5" />
            <stop offset="100%" stopColor="#2F6CC4" />
          </radialGradient>
        </defs>
      </svg>
      {/* inside of the barrel, seen through the spokes */}
      <Slice z={-T / 2 + 20} size={size}>
        <path d={`${lip(0)} ${circlePath(36)}`} fillRule="evenodd" fill="#5A5A62" />
      </Slice>
      {/* brake disc and the accent caliper */}
      <Slice z={-8} size={size}>
        <path d={`${circlePath(rim - 30)} ${circlePath(34)}`} fillRule="evenodd" fill={`url(#${id}-disc)`} />
        <path d={circlePath(rim - 44)} fill="none" stroke="rgba(255,255,255,.18)" strokeWidth={2} />
        <path d={circlePath(70)} fill="none" stroke="rgba(10,10,10,.18)" strokeWidth={6} />
      </Slice>
      <Slice z={4} size={size}>
        <path
          d={`M ${(rim - 26) * Math.cos(196 * DEG)} ${(rim - 26) * Math.sin(196 * DEG)} A ${rim - 26} ${rim - 26} 0 0 1 ${(rim - 26) * Math.cos(234 * DEG)} ${(rim - 26) * Math.sin(234 * DEG)}`}
          fill="none"
          stroke="#3D86F0"
          strokeWidth={30}
          strokeLinecap="round"
        />
        <path
          d={`M ${(rim - 30) * Math.cos(200 * DEG)} ${(rim - 30) * Math.sin(200 * DEG)} A ${rim - 30} ${rim - 30} 0 0 1 ${(rim - 30) * Math.cos(228 * DEG)} ${(rim - 30) * Math.sin(228 * DEG)}`}
          fill="none"
          stroke="rgba(255,255,255,.35)"
          strokeWidth={5}
          strokeLinecap="round"
        />
      </Slice>
      {/* barrel: a short silver tube behind the lip */}
      {Array.from({length: 11}, (_, i) => -T / 2 + 22 + ((zLip - 10 - (-T / 2 + 22)) * i) / 10).map((z, i) => (
        <Slice key={`b${i}`} z={z} size={size}>
          <path d={`${lip(0)} ${lip(22)}`} fillRule="evenodd" fill={i === 10 ? '#C9C9D0' : i % 2 ? '#A6A6AE' : '#ADADB5'} />
        </Slice>
      ))}
      {/* spokes, back copy for thickness, then the face */}
      <Slice z={zLip - 8} size={size}>
        {spokes.map((d) => (
          <polygon key={d} points={spoke(d).pts} fill="#A2A2AA" />
        ))}
        <path d={circlePath(60)} fill="#A2A2AA" />
      </Slice>
      <Slice z={zLip} size={size}>
        <path d={`${lip(0)} ${lip(15)}`} fillRule="evenodd" fill={`url(#${id}-silver)`} />
        <path d={lip(2)} fill="none" stroke="rgba(255,255,255,.7)" strokeWidth={2} />
        <path d={lip(14)} fill="none" stroke="#A7A7AF" strokeWidth={2} />
        {dent > 0.01 ? (
          <path
            d={(() => {
              // a dark crease along the dented part of the lip, so the bend reads at a glance
              let d = '';
              for (let i = 0; i <= 24; i++) {
                const t = DENT_ANGLE - 0.55 + (1.1 * i) / 24;
                const r = lipR(t, dent) - 7;
                d += `${i ? 'L' : 'M'}${(r * Math.cos(t)).toFixed(1)} ${(r * Math.sin(t)).toFixed(1)}`;
              }
              return d;
            })()}
            fill="none"
            stroke={`rgba(60,60,68,${0.55 * dent})`}
            strokeWidth={4}
            strokeLinecap="round"
          />
        ) : null}
        {spokes.map((d) => {
          const s = spoke(d);
          return (
            <g key={d}>
              <polygon points={s.pts} fill={`url(#${id}-spoke)`} stroke="#B9B9C1" strokeWidth={1.2} />
              <line x1={s.ridge[0]} y1={s.ridge[1]} x2={s.ridge[2]} y2={s.ridge[3]} stroke="rgba(255,255,255,.75)" strokeWidth={2.4} />
            </g>
          );
        })}
        <path d={circlePath(60)} fill={`url(#${id}-silver)`} stroke="#B4B4BC" strokeWidth={1.5} />
      </Slice>
      {/* the cap */}
      <Slice z={zLip + 6} size={size}>
        <path d={circlePath(22)} fill={`url(#${id}-cap)`} />
        <path d={circlePath(15)} fill="none" stroke="rgba(255,255,255,.45)" strokeWidth={2} />
      </Slice>
      {/* lug nuts */}
      {NUTS.map((a, i) => {
        const st = nuts?.[i] ?? {out: 0, spin: 0};
        if (st.out >= 1) return null;
        const o = st.out;
        // back out toward the camera, then tip off and drop away
        const z = zLip + 2 + 70 * Math.min(1, o / 0.6);
        const drop = Math.max(0, o - 0.6) / 0.4;
        const x = NUT_R * Math.cos(a) + 60 * drop * Math.cos(a);
        const y = NUT_R * Math.sin(a) + 60 * drop * Math.sin(a) + 120 * drop * drop;
        return (
          <div
            key={`n${i}`}
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              ...P3D,
              opacity: 1 - drop,
              transform: `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, ${z.toFixed(1)}px) rotateZ(${st.spin}deg) rotateX(${(drop * 70).toFixed(1)}deg)`,
            }}
          >
            <LugNut />
          </div>
        );
      })}
    </>
  );
};

/** A whole wheel: tire + rim. `rimTilt` turns the rim a little against the tire (a bent wheel). */
export const Wheel: React.FC<{
  flat: number;
  dent?: number;
  rimTilt?: number;
  jiggle?: number;
  nuts?: NutState[];
  id: string;
}> = ({flat, dent = 0, rimTilt = 0, jiggle = 0, nuts, id}) => {
  const contact = WHEEL.R - WHEEL.flatDrop * flat;
  return (
    <div style={{position: 'absolute', left: 0, top: 0, ...P3D}}>
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          ...P3D,
          transformOrigin: `0px ${contact}px`,
          transform: `scale(${1 + jiggle}, ${1 - jiggle})`,
        }}
      >
        <Tire flat={flat} id={`${id}-t`} />
      </div>
      <div style={{position: 'absolute', left: 0, top: 0, ...P3D, transform: `rotateX(${(rimTilt * 4).toFixed(2)}deg) rotateY(${(-rimTilt * 3.5).toFixed(2)}deg) rotateZ(${(rimTilt * 4).toFixed(2)}deg)`}}>
        <Rim dent={dent} nuts={nuts} id={`${id}-r`} />
      </div>
    </div>
  );
};

// --- The car corner ----------------------------------------------------------

const BODY = {left: -660, right: 660, top: -WHEEL.R - 150};

/**
 * The lower corner of a white car around the wheel: the body side with its
 * wheel arch, the wheel well behind (back wall and curved liner) and the
 * rocker. Hub-relative coordinates: the hub is at (0, 0).
 */
export const CarCorner: React.FC = () => {
  const {arch: RA, rocker} = WHEEL;
  const xa = Math.sqrt(RA * RA - rocker * rocker);
  const a0 = Math.atan2(rocker, -xa); // lower left end of the arch (about 162deg)
  const a1 = Math.atan2(rocker, xa) + 2 * Math.PI; // lower right end (about 378deg)
  const archOnly = `M${-xa} ${rocker} A${RA} ${RA} 0 1 1 ${xa} ${rocker}`;
  const body = `M${BODY.left} ${rocker} L${-xa} ${rocker} A${RA} ${RA} 0 1 1 ${xa} ${rocker} L${BODY.right} ${rocker} L${BODY.right} ${BODY.top} L${BODY.left} ${BODY.top} Z`;
  const well = `${archOnly} Z`;
  const W = BODY.right - BODY.left;
  const H = rocker - BODY.top;
  const N = 26;
  const span = a1 - a0;
  const panelW = (RA * span) / N + 1.5;
  // The liner runs from just in front of the back wall to just behind the body
  // panel, so no two planes cross (a crossing gets split by the renderer).
  const zBack = Z_WELL + 1;
  const zFront = Z_BODY - 1;
  const depth = zFront - zBack;
  const liner: React.ReactNode[] = [];
  for (let i = 0; i < N; i++) {
    const a = a0 + span * ((i + 0.5) / N);
    const cx = RA * Math.cos(a);
    const cy = RA * Math.sin(a);
    // Darker at the top of the well, lighter low on the sides.
    const top = clamp01(-Math.sin(a));
    const shade = Math.round(214 - 26 * top);
    liner.push(
      <div
        key={i}
        style={{
          position: 'absolute',
          left: -panelW / 2,
          top: -depth / 2,
          width: panelW,
          height: depth,
          background: `linear-gradient(180deg, rgb(${shade + 22},${shade + 22},${shade + 26}), rgb(${shade},${shade},${shade + 5}))`,
          transform: `translate3d(${cx.toFixed(1)}px, ${cy.toFixed(1)}px, ${((zFront + zBack) / 2).toFixed(1)}px) rotateZ(${(a / DEG + 90).toFixed(2)}deg) rotateX(-90deg)`,
        }}
      />,
    );
  }
  // The body side is drawn once and shown through narrow strips: Chrome's
  // default renderer drops parts of wide 3D-turned layers (Unit B hit the same
  // thing with its belt), and narrow strips draw whole.
  const strips: React.ReactNode[] = [];
  for (let x0 = BODY.left; x0 < BODY.right; x0 += STRIP) {
    const w = Math.min(STRIP, BODY.right - x0) + 1;
    strips.push(
      <svg
        key={x0}
        width={w}
        height={H}
        viewBox={`${x0} ${BODY.top} ${w} ${H}`}
        style={{position: 'absolute', left: x0, top: BODY.top, overflow: 'hidden', transform: `translateZ(${Z_BODY}px)`}}
      >
        <use href="#tool-body-art" />
      </svg>,
    );
  }
  return (
    <>
      <svg width={0} height={0} style={{position: 'absolute'}}>
        <defs>
          <linearGradient id="tool-well" x1={0} y1={-RA} x2={0} y2={rocker} gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#A9A9B1" />
            <stop offset="100%" stopColor="#CFCFD5" />
          </linearGradient>
          {/* The top of the body fades out: an SVG mask inside the drawing (a CSS mask on a 3D layer is riskier). */}
          <linearGradient id="tool-body-fade" x1={0} y1={BODY.top} x2={0} y2={BODY.top + 130} gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#000" />
            <stop offset="100%" stopColor="#FFF" />
          </linearGradient>
          <mask id="tool-body-mask" maskUnits="userSpaceOnUse" x={BODY.left} y={BODY.top} width={W} height={H}>
            <rect x={BODY.left} y={BODY.top} width={W} height={H} fill="url(#tool-body-fade)" />
          </mask>
          <linearGradient id="tool-body" x1={0} y1={BODY.top} x2={0} y2={rocker} gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#F3F3F6" />
            <stop offset="42%" stopColor="#FDFDFE" />
            <stop offset="80%" stopColor="#F1F1F4" />
            <stop offset="100%" stopColor="#DCDCE1" />
          </linearGradient>
          <linearGradient id="tool-body-x" x1={BODY.left} y1={0} x2={BODY.right} y2={0} gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="rgba(10,10,10,.05)" />
            <stop offset="35%" stopColor="rgba(10,10,10,0)" />
            <stop offset="100%" stopColor="rgba(10,10,10,.03)" />
          </linearGradient>
          <g id="tool-body-art" mask="url(#tool-body-mask)">
            <path d={body} fill="url(#tool-body)" />
            <path d={body} fill="url(#tool-body-x)" />
            {/* a crisp character line along the side */}
            <path d={`M${BODY.left} ${-RA - 34} L${BODY.right} ${-RA - 34}`} stroke="rgba(255,255,255,.95)" strokeWidth={3} />
            <path d={`M${BODY.left} ${-RA - 31} L${BODY.right} ${-RA - 31}`} stroke="rgba(10,10,10,.06)" strokeWidth={2} />
            {/* rocker molding */}
            <path d={`M${BODY.left} ${rocker - 18} L${-xa - 2} ${rocker - 18} M${xa + 2} ${rocker - 18} L${BODY.right} ${rocker - 18}`} stroke="rgba(10,10,10,.07)" strokeWidth={2} />
            {/* the arch lip: lit outer edge, shaded inner edge */}
            <path d={archOnly} fill="none" stroke="#FFFFFF" strokeWidth={16} />
            <path d={archOnly} fill="none" stroke="#D2D2D8" strokeWidth={3} />
          </g>
        </defs>
      </svg>
      {/* back wall of the wheel well, in two halves */}
      {[-RA, 0].map((x0) => (
        <svg
          key={x0}
          width={RA + 1}
          height={RA + rocker}
          viewBox={`${x0} ${-RA} ${RA + 1} ${RA + rocker}`}
          style={{position: 'absolute', left: x0, top: -RA, overflow: 'hidden', transform: `translateZ(${Z_WELL}px)`}}
        >
          <path d={well} fill="url(#tool-well)" />
        </svg>
      ))}
      {liner}
      {strips}
    </>
  );
};

// --- Road ------------------------------------------------------------------

/** Width of the strips wide flat surfaces are cut into (see CarCorner). */
const STRIP = 220;

/** A light road surface the car stands on. `travel` slides the lane dashes (the car driving). Ground-relative: y = 0 is the road. */
export const Road: React.FC<{travel?: number}> = ({travel = 0}) => {
  const W = 2200;
  const D = 560;
  const dash = 150;
  const out: React.ReactNode[] = [];
  for (let x0 = -W / 2; x0 < W / 2; x0 += STRIP) {
    const off = (((-travel - (x0 + W / 2)) % (dash * 2)) + dash * 2) % (dash * 2);
    // lane dashes only across the middle of the road, where it is not faded out
    const lane = x0 + STRIP > -W * 0.32 && x0 < W * 0.32;
    out.push(
      <div
        key={x0}
        style={{
          position: 'absolute',
          left: x0,
          top: -D / 2,
          width: STRIP + 1,
          height: D,
          transform: `translate3d(0px, 3px, ${-40}px) rotateX(90deg)`,
          backgroundImage: 'radial-gradient(50% 50% at 50% 50%, #E7E7EB 0%, #EAEAEE 55%, rgba(234,234,238,0) 100%)',
          backgroundSize: `${W}px ${D}px`,
          backgroundPosition: `${-(x0 + W / 2)}px 0`,
          backgroundRepeat: 'no-repeat',
        }}
      >
        {lane ? (
          <div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: D * 0.84,
              height: 10,
              backgroundImage: `repeating-linear-gradient(90deg, rgba(255,255,255,.95) 0px, rgba(255,255,255,.95) ${dash}px, transparent ${dash}px, transparent ${dash * 2}px)`,
              backgroundPosition: `${off}px 0px`,
            }}
          />
        ) : null}
      </div>,
    );
  }
  return <>{out}</>;
};

/** Soft shadow on the road (ground-relative), a flat oval lying on the road, cut into strips like the road. */
export const RoadShadow: React.FC<{x?: number; z?: number; w: number; d: number; strength?: number}> = ({x = 0, z = 0, w, d, strength = 0.22}) => {
  const out: React.ReactNode[] = [];
  for (let x0 = x - w / 2; x0 < x + w / 2; x0 += STRIP) {
    const sw = Math.min(STRIP, x + w / 2 - x0) + 1;
    out.push(
      <div
        key={x0}
        style={{
          position: 'absolute',
          left: x0,
          top: -d / 2,
          width: sw,
          height: d,
          transform: `translate3d(0px, 1.5px, ${z}px) rotateX(90deg)`,
          backgroundImage: `radial-gradient(50% 50% at 50% 50%, rgba(10,10,10,${strength}), rgba(10,10,10,${strength * 0.4}) 55%, rgba(10,10,10,0))`,
          backgroundSize: `${w}px ${d}px`,
          backgroundPosition: `${-(x0 - (x - w / 2))}px 0`,
          backgroundRepeat: 'no-repeat',
        }}
      />,
    );
  }
  return <>{out}</>;
};

// --- Extruded tools -----------------------------------------------------------

/** Gradients the tools share. Render once per clip. */
export const ToolDefs: React.FC = () => (
  <svg width={0} height={0} style={{position: 'absolute'}}>
    <defs>
      <linearGradient id="tool-steel" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#FAFAFB" />
        <stop offset="50%" stopColor="#D9D9DF" />
        <stop offset="100%" stopColor="#A7A7B0" />
      </linearGradient>
      <linearGradient id="tool-grip" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#4A4A52" />
        <stop offset="50%" stopColor="#26262B" />
        <stop offset="100%" stopColor="#16161A" />
      </linearGradient>
      <linearGradient id="tool-shaft" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#F4F4F6" />
        <stop offset="100%" stopColor="#C2C2CA" />
      </linearGradient>
      <linearGradient id="tool-blue" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#8DBAF7" />
        <stop offset="45%" stopColor="#3D86F0" />
        <stop offset="100%" stopColor="#2A66BE" />
      </linearGradient>
      <radialGradient id="tool-nut" cx="35%" cy="30%" r="80%">
        <stop offset="0%" stopColor="#FFFFFF" />
        <stop offset="100%" stopColor="#B4B4BC" />
      </radialGradient>
    </defs>
  </svg>
);

/**
 * A flat drawing given real thickness: `layers` copies of its silhouette
 * stacked behind the detailed front face. The drawing's (0, 0) sits on the
 * parent's origin; `box` is its viewBox [x, y, w, h].
 */
export const Extrude: React.FC<{
  box: [number, number, number, number];
  depth: number;
  layers?: number;
  face: React.ReactNode;
  edge: React.ReactNode;
  style?: React.CSSProperties;
}> = ({box, depth, layers = 6, face, edge, style}) => {
  const [x, y, w, h] = box;
  const svg = (z: number, body: React.ReactNode, key: string) => (
    <svg
      key={key}
      width={w}
      height={h}
      viewBox={`${x} ${y} ${w} ${h}`}
      style={{position: 'absolute', left: x, top: y, overflow: 'visible', transform: `translateZ(${z.toFixed(2)}px)`}}
    >
      {body}
    </svg>
  );
  const out: React.ReactNode[] = [];
  for (let i = 0; i < layers; i++) out.push(svg(-depth / 2 + (depth * i) / layers, edge, `e${i}`));
  out.push(svg(depth / 2, face, 'face'));
  return <div style={{position: 'absolute', left: 0, top: 0, ...P3D, ...style}}>{out}</div>;
};

/** Hammer length, grip end (the hand, at 0, 0) to the head's center line. The handle points left (-x); the striking face points down (+y). */
export const HAMMER_L = 430;
export const HAMMER_FACE_Y = 70;

const hammerShapes = (shade: 'face' | 'edge') => {
  const L = HAMMER_L;
  const steel = shade === 'face' ? 'url(#tool-steel)' : '#8F8F98';
  const grip = shade === 'face' ? 'url(#tool-grip)' : '#141416';
  const shaft = shade === 'face' ? 'url(#tool-shaft)' : '#A9A9B1';
  return (
    <>
      {/* handle: light shaft, charcoal grip */}
      <path d={`M${-L + 10} -14 L${-L * 0.42} -16 L${-L * 0.42} 16 L${-L + 10} 14 Z`} fill={shaft} />
      <path d={`M${-L * 0.44} -18 L14 -21 Q26 -21 26 -9 L26 9 Q26 21 14 21 L${-L * 0.44} 18 Z`} fill={grip} />
      {/* head: neck + face toward +y, claw toward -y curving back over the handle */}
      <path d={`M${-L - 30} -34 L${-L + 30} -34 L${-L + 30} 38 L${-L - 30} 38 Z`} fill={steel} />
      <path d={`M${-L - 24} 36 L${-L + 24} 36 L${-L + 26} ${HAMMER_FACE_Y - 8} L${-L - 26} ${HAMMER_FACE_Y - 8} Z`} fill={steel} />
      <rect x={-L - 31} y={HAMMER_FACE_Y - 10} width={62} height={12} rx={4} fill={steel} />
      <path d={`M${-L - 26} -32 C${-L - 30} -82 ${-L - 4} -120 ${-L + 54} -134 L${-L + 58} -124 C${-L + 18} -104 ${-L + 4} -76 ${-L + 26} -32 Z`} fill={steel} />
    </>
  );
};

/** The claw hammer, extruded. Steel head, light shaft, charcoal grip. */
export const Hammer: React.FC = () => {
  const L = HAMMER_L;
  return (
    <>
      <Extrude
        box={[-L - 40, -140, L + 72, HAMMER_FACE_Y + 150]}
        depth={34}
        layers={7}
        edge={hammerShapes('edge')}
        face={
          <>
            {hammerShapes('face')}
            {/* grip ridges and a highlight on the head */}
            {Array.from({length: 7}, (_, i) => (
              <line key={i} x1={-L * 0.4 + i * 34} y1={-17} x2={-L * 0.4 + i * 34} y2={17} stroke="rgba(255,255,255,.07)" strokeWidth={4} />
            ))}
            <rect x={-L - 22} y={-28} width={8} height={60} rx={4} fill="rgba(255,255,255,.65)" />
          </>
        }
      />
    </>
  );
};

/** The cross lug wrench in accent blue, extruded. Centered on (0, 0). */
export const LugWrench: React.FC = () => {
  const A = 132;
  const w = 11;
  const bar = (shade: 'face' | 'edge') => {
    const fill = shade === 'face' ? 'url(#tool-blue)' : '#2459A8';
    return (
      <>
        <rect x={-A} y={-w} width={2 * A} height={2 * w} rx={w} fill={fill} />
        <rect x={-w} y={-A} width={2 * w} height={2 * A} rx={w} fill={fill} />
        {[
          [A, 0],
          [-A, 0],
          [0, A],
          [0, -A],
        ].map(([x, y]) => (
          <circle key={`${x}-${y}`} cx={x} cy={y} r={19} fill={fill} />
        ))}
        <circle r={24} fill={fill} />
      </>
    );
  };
  return (
    <>
      <Extrude
        box={[-A - 24, -A - 24, 2 * A + 48, 2 * A + 48]}
        depth={22}
        layers={5}
        edge={bar('edge')}
        face={
          <>
            {bar('face')}
            {[
              [A, 0],
              [-A, 0],
              [0, A],
              [0, -A],
            ].map(([x, y]) => (
              <circle key={`s${x}-${y}`} cx={x} cy={y} r={9} fill="#1F4E94" />
            ))}
            <line x1={-A + 10} y1={-4} x2={A - 10} y2={-4} stroke="rgba(255,255,255,.4)" strokeWidth={3} strokeLinecap="round" />
            <line x1={-4} y1={-A + 10} x2={-4} y2={A - 10} stroke="rgba(255,255,255,.4)" strokeWidth={3} strokeLinecap="round" />
          </>
        }
      />
    </>
  );
};

/** Scissor-jack sizes: `h` is the full height, base on the road (y = 0) to the top of the saddle. */
export const JACK = {base: 220, arm: 98, min: 60} as const;

const jackShapes = (h: number, crank: number, shade: 'face' | 'edge') => {
  const blue = shade === 'face' ? 'url(#tool-blue)' : '#2459A8';
  const steel = shade === 'face' ? 'url(#tool-steel)' : '#8F8F98';
  const yl = -24; // lower pivot
  const yu = -h + 22; // upper pivot
  const hh = Math.max(4, (yl - yu) / 2);
  const wx = Math.sqrt(Math.max(0, JACK.arm * JACK.arm - hh * hh));
  const ym = (yl + yu) / 2;
  const arm = (x0: number, y0: number, x1: number, y1: number, k: string) => (
    <line key={k} x1={x0} y1={y0} x2={x1} y2={y1} stroke={blue} strokeWidth={22} strokeLinecap="round" />
  );
  const cx = wx + 40;
  const cy = ym + Math.sin(crank) * 16;
  return (
    <>
      {/* base plate and saddle */}
      <path d={`M${-JACK.base / 2} 0 L${-JACK.base / 2 + 22} -20 L${JACK.base / 2 - 22} -20 L${JACK.base / 2} 0 Z`} fill={steel} />
      <rect x={-52} y={-h} width={104} height={16} rx={5} fill={steel} />
      {arm(-12, yl, -wx, ym, 'a1')}
      {arm(12, yl, wx, ym, 'a2')}
      {arm(-wx, ym, -12, yu, 'a3')}
      {arm(wx, ym, 12, yu, 'a4')}
      {/* the screw, then the crank on the right */}
      <line x1={-wx - 14} y1={ym} x2={wx + 30} y2={ym} stroke={steel} strokeWidth={8} strokeLinecap="round" />
      <line x1={wx + 30} y1={ym} x2={cx} y2={cy} stroke={steel} strokeWidth={7} strokeLinecap="round" />
      {[-wx, wx, 0].map((x, i) => (
        <circle key={`j${i}`} cx={x} cy={i === 2 ? yl : ym} r={i === 2 ? 0 : 12} fill={steel} />
      ))}
      <circle cx={0} cy={yl} r={11} fill={steel} />
      <circle cx={0} cy={yu} r={11} fill={steel} />
    </>
  );
};

/** The scissor jack, extruded. `h` its height, `crank` turns the handle (radians). */
export const ScissorJack: React.FC<{h: number; crank?: number}> = ({h, crank = 0}) => (
  <Extrude
    box={[-JACK.base / 2 - 10, -h - 10, JACK.base + 120, h + 20]}
    depth={40}
    layers={6}
    edge={jackShapes(h, crank, 'edge')}
    face={
      <>
        {jackShapes(h, crank, 'face')}
        <rect x={-46} y={-h + 3} width={92} height={4} rx={2} fill="rgba(255,255,255,.7)" />
      </>
    }
  />
);

// --- Money ------------------------------------------------------------------

/**
 * One bill tossed off from where it is placed (money leaving): the kit's
 * FlyingBill motion without its drop-shadow filter (a filter on a 3D-turned
 * layer draws dark smears with the default renderer).
 */
export const TossedBill: React.FC<{progress: number; dx: number; dy: number; width?: number; turn?: number}> = ({progress, dx, dy, width = 110, turn = -28}) => {
  if (progress <= 0 || progress >= 1) return null;
  const e = 1 - (1 - progress) ** 2;
  const a = Math.min(1, progress / 0.12, (1 - progress) / 0.35);
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        opacity: a,
        transform: `translate3d(${dx * e}px, ${dy * e + 30 * progress * progress}px, ${20 + 120 * e}px) rotateZ(${turn * e}deg) rotateX(${28 * e}deg) rotateY(${-22 * e}deg) scale(${0.7 + 0.3 * Math.min(1, progress * 4)})`,
      }}
    >
      <DollarBill width={width} detail="simple" />
    </div>
  );
};

// --- Caption clock ------------------------------------------------------------

/** A line clock with no numbers. `turn` is how far the minute hand has gone, in turns (1 = an hour). */
export const Clock: React.FC<{size: number; turn: number; color?: string}> = ({size, turn, color = COLORS.accent}) => {
  const m = turn * 360;
  const h = 300 + turn * 30; // the hour hand starts near ten o'clock
  return (
    <svg width={size} height={size} viewBox="-24 -24 48 48" style={{display: 'block', flex: 'none'}}>
      <circle r={20.5} fill={COLORS.white} stroke={color} strokeWidth={3} />
      {Array.from({length: 12}, (_, i) => (
        <line key={i} x1={0} y1={-17} x2={0} y2={i % 3 === 0 ? -13.5 : -15.5} stroke={COLORS.gray2} strokeWidth={1.6} strokeLinecap="round" transform={`rotate(${i * 30})`} />
      ))}
      <line x1={0} y1={0} x2={0} y2={-9} stroke={COLORS.ink} strokeWidth={3} strokeLinecap="round" transform={`rotate(${h})`} />
      <line x1={0} y1={0} x2={0} y2={-15} stroke={color} strokeWidth={2.4} strokeLinecap="round" transform={`rotate(${m})`} />
      <circle r={2.6} fill={COLORS.ink} />
    </svg>
  );
};

// --- Eyebrow + caption block -----------------------------------------------

/** Rough widths, so long words from a shot list shrink to fit instead of running off the side. */
const captionW = (t: string, fs: number): number => t.length * fs * 0.53;
const eyebrowW = (t: string): number => t.length * 30 * 0.78 + 64;

/**
 * An eyebrow scaled down only if it is too long for the 900 px column (the
 * kit's Eyebrow never wraps).
 */
export const FitEyebrow: React.FC<{text: string; progress: number}> = ({text, progress}) => {
  const k = Math.min(1, 880 / eyebrowW(text));
  return (
    <div style={{transform: `scale(${k.toFixed(3)})`, transformOrigin: '50% 50%'}}>
      <Eyebrow text={text} progress={progress} />
    </div>
  );
};

/**
 * The eyebrow and caption under the car, with the little clock in front of
 * the caption. The caption shrinks to fit one line (58 px down to 44 px); a
 * caption longer than that wraps to two lines and the eyebrow moves up.
 */
export const CaptionBlock: React.FC<{eyebrow: string; caption: string; clockTurn: number; f: number; fps: number}> = ({eyebrow, caption, clockTurn, f, fps}) => {
  const room = 900 - 64 - 22;
  let fs = 58;
  if (captionW(caption, fs) > room) fs = Math.max(44, Math.floor(room / (caption.length * 0.53)));
  const twoLines = captionW(caption, fs) > room;
  if (twoLines) fs = 46;
  const lift = twoLines ? Math.round(fs * 1.1) : 0;
  return (
    <>
      <div style={{position: 'absolute', left: 0, right: 0, bottom: 104 + lift}}>
        <FitEyebrow text={eyebrow} progress={enter(f, fps, 0, 14)} />
      </div>
      <div
        style={{
          ...fadeUp(enter(f, fps, 3, 14), 20),
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 16,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 22,
        }}
      >
        <Clock size={64} turn={clockTurn} />
        <span
          style={{
            fontSize: fs,
            fontWeight: 700,
            letterSpacing: TRACK.h2,
            lineHeight: 1.1,
            color: COLORS.ink,
            whiteSpace: twoLines ? 'normal' : 'nowrap',
            maxWidth: room,
            textWrap: 'balance',
          }}
        >
          {caption}
        </span>
      </div>
    </>
  );
};
