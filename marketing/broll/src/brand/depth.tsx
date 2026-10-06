import React from 'react';
import {AbsoluteFill, Easing, getInputProps} from 'remotion';
import {CONTENT, FRAME, SAFE} from './tokens';

// Depth kit: the shared 3D look for every B-roll template.
//
// The idea: the faint brand grid stays flat. It is the wall. Everything else
// floats in front of it on a perspective stage, so cards tilt, cast layered
// shadows and drift a little as a slow camera moves. Plain CSS 3D transforms,
// no WebGL.
//
// Usage (inside a template):
//
//   const {f, fps} = useTimeline(BASE, durationInFrames);
//   <BrandFrame backdrop={<BackdropStage f={f} length={BASE}><MoneyField f={f} mode="drift" /></BackdropStage>}>
//     <Stage3D f={f} length={BASE}>
//       <Eyebrow text="..." />
//       <Card3D enter={enter(f, fps, 4, 16)} z={40}>...</Card3D>
//     </Stage3D>
//   </BrandFrame>
//
// Rules that keep 3D from breaking:
// - Any plain wrapper div between Stage3D and a 3D child needs `style={P3D}`,
//   or the child is flattened into the wrapper and loses its depth.
// - Opacity, filter, mask and overflow:hidden flatten an element's children.
//   Put fades on leaf elements (a card, a line of text), never on a wrapper
//   whose children use translateZ.
// - Words go in BrandFrame children only (clipped to y 269-1248). Full-frame
//   money goes in BackdropStage, which fades itself in the no-text zones.

export const DEPTH = {
  /** Perspective of the content stage, in px. Bigger = flatter. */
  perspective: 2400,
  /** Perspective of the full-frame backdrop stage. */
  backdropPerspective: 2000,
  /** How faint backdrop decoration gets inside the no-text zones (multiplier). */
  zoneOpacity: 0.32,
} as const;

/** Spread on any wrapper between Stage3D and a 3D child. */
export const P3D: React.CSSProperties = {transformStyle: 'preserve-3d'};

export type Camera = {rx: number; ry: number; z: number};

/**
 * The slow camera move every template shares: it looks down a little and
 * pans from left to right across the clip while it pushes in. `t` is 0 to 1
 * across the clip; `drift` scales it (0 = still camera).
 */
export const cameraAt = (t: number, drift = 1): Camera => {
  const e = Easing.inOut(Easing.sin)(Math.max(0, Math.min(1, t)));
  return {rx: (5 - 2 * e) * drift, ry: (-4 + 7 * e) * drift, z: 44 * e * drift};
};

export const cameraTransform = (c: Camera): string => `translateZ(${c.z}px) rotateX(${c.rx}deg) rotateY(${c.ry}deg)`;

/**
 * The content stage. Fill BrandFrame's children with it: it lays its children
 * out in a centered column (like BrandFrame does) and puts them in one 3D
 * space under the drifting camera. Pass the template timeline (`f` from
 * useTimeline and the template's base length) so the drift fits the clip.
 */
export const Stage3D: React.FC<{
  f: number;
  length: number;
  drift?: number;
  perspective?: number;
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({f, length, drift = 1, perspective = DEPTH.perspective, children, style}) => (
  <div style={{position: 'absolute', inset: 0, perspective, perspectiveOrigin: '50% 50%'}}>
    <div
      style={{
        position: 'absolute',
        inset: 0,
        ...P3D,
        transform: cameraTransform(cameraAt(f / length, drift)),
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        ...style,
      }}
    >
      {children}
    </div>
  </div>
);

/** Where the content stage's center sits on the full frame (the backdrop turns around the same point). */
export const STAGE_CENTER = {x: FRAME.width / 2, y: (CONTENT.top + CONTENT.bottom) / 2} as const; // 540, 812

/** True when a render was started with --props '{"checkTextOnly":true}'. Decoration then draws nothing. */
export const isTextCheck = (): boolean => {
  try {
    return (getInputProps() as Record<string, unknown>).checkTextOnly === true;
  } catch {
    return false;
  }
};

/**
 * Wrap pure decoration (money, glows) in this. A render with
 * `checkTextOnly: true` in its props drops everything inside, so a pixel scan
 * of that render proves no word or card sits in the no-text zones.
 */
export const Decor: React.FC<{children: React.ReactNode}> = ({children}) => (isTextCheck() ? null : <>{children}</>);

const zoneMask = (a: number): string =>
  `linear-gradient(to bottom, rgba(0,0,0,${a}) 0px, rgba(0,0,0,${a}) ${SAFE.top - 30}px, #000 ${SAFE.top + 70}px, ` +
  `#000 ${SAFE.bottom - 70}px, rgba(0,0,0,${a}) ${SAFE.bottom + 30}px, rgba(0,0,0,${a}) ${FRAME.height}px)`;

/**
 * Full-frame 3D stage for decoration only (never words). Put it in
 * BrandFrame's `backdrop`. It shares the content stage's camera, sits behind
 * the content, and fades whatever passes through the top 14% and bottom 35%
 * to `zoneOpacity` (default 0.32) of its strength, so money can pass through
 * those zones faintly and never covers a word. Children are positioned in
 * full-frame pixels (0-1080, 0-1920).
 */
export const BackdropStage: React.FC<{
  f: number;
  length: number;
  drift?: number;
  opacity?: number;
  zoneOpacity?: number;
  children: React.ReactNode;
}> = ({f, length, drift = 1, opacity = 1, zoneOpacity = DEPTH.zoneOpacity, children}) => (
  <Decor>
    <AbsoluteFill style={{opacity, WebkitMaskImage: zoneMask(zoneOpacity), maskImage: zoneMask(zoneOpacity)}}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          perspective: DEPTH.backdropPerspective,
          perspectiveOrigin: `${STAGE_CENTER.x}px ${STAGE_CENTER.y}px`,
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            ...P3D,
            transformOrigin: `${STAGE_CENTER.x}px ${STAGE_CENTER.y}px`,
            transform: cameraTransform(cameraAt(f / length, drift)),
          }}
        >
          {children}
        </div>
      </div>
    </AbsoluteFill>
  </Decor>
);

/** A wrapper placed at a depth. Positive z comes toward the camera; layers at different z drift apart as the camera moves (parallax). */
export const Layer: React.FC<{
  z?: number;
  x?: number;
  y?: number;
  rx?: number;
  ry?: number;
  rz?: number;
  scale?: number;
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({z = 0, x = 0, y = 0, rx = 0, ry = 0, rz = 0, scale = 1, children, style}) => (
  <div
    style={{
      ...P3D,
      transform: `translate3d(${x}px, ${y}px, ${z}px) rotateX(${rx}deg) rotateY(${ry}deg) rotateZ(${rz}deg) scale(${scale})`,
      ...style,
    }}
  >
    {children}
  </div>
);

/**
 * Layered soft shadow for a floating card. A thin hard edge right under the
 * card reads as its thickness; three soft layers below read as height off the
 * wall. `e` 0 to 2 scales the lift (1 = default card).
 */
export const cardShadow = (e = 1): string =>
  [
    `0 ${Math.round(5 * e)}px 0 -1px #DCDCE1`,
    `0 ${Math.round(10 * e)}px ${Math.round(18 * e)}px rgba(10,10,10,.05)`,
    `0 ${Math.round(28 * e)}px ${Math.round(46 * e)}px rgba(10,10,10,.07)`,
    `0 ${Math.round(58 * e)}px ${Math.round(70 * e)}px -${Math.round(26 * e)}px rgba(10,10,10,.13)`,
  ].join(', ');

/** Card border lit from above: lighter top edge, darker bottom edge. */
export const CARD_EDGE = {
  borderStyle: 'solid',
  borderWidth: 2,
  borderColor: '#EFEFF2 #E4E4E7 #D5D5DA #E4E4E7',
} as const;

export type Tilt = {rx?: number; ry?: number; rz?: number};

export type Card3DProps = {
  children: React.ReactNode;
  /** 0 to 1 entrance (use enter() from the brand motion helpers). 1 = resting. */
  enter?: number;
  /** Where it flies in from. "depth" comes forward out of the wall. */
  from?: 'depth' | 'left' | 'right' | 'below';
  /** Lift toward the camera at rest, px. */
  z?: number;
  /** Resting tilt in degrees, on top of the camera. */
  tilt?: Tilt;
  /** Shadow strength, 0 to 2. */
  elevation?: number;
  radius?: number;
  padding?: React.CSSProperties['padding'];
  width?: React.CSSProperties['width'];
  style?: React.CSSProperties;
};

/**
 * A white floating card: tilted, lifted off the wall, layered shadow, lit
 * edge. Its contents are flat (text stays crisp); the card itself lives in 3D.
 */
export const Card3D: React.FC<Card3DProps> = ({
  children,
  enter = 1,
  from = 'depth',
  z = 40,
  tilt = {},
  elevation = 1,
  radius = 30,
  padding = '34px 44px',
  width = '100%',
  style,
}) => {
  const q = 1 - enter;
  const rx = (tilt.rx ?? 0) + (from === 'depth' || from === 'below' ? q * 16 : 0);
  const ry = (tilt.ry ?? 0) + (from === 'left' ? -q * 26 : from === 'right' ? q * 26 : 0);
  const x = from === 'left' ? -q * 140 : from === 'right' ? q * 140 : 0;
  const y = from === 'below' ? q * 90 : from === 'depth' ? q * 36 : 0;
  const zz = z - (from === 'depth' ? q * 420 : q * 120);
  return (
    <div
      style={{
        position: 'relative',
        width,
        background: 'linear-gradient(165deg, #FFFFFF 0%, #FFFFFF 55%, #FAFAFB 100%)',
        ...CARD_EDGE,
        borderRadius: radius,
        boxShadow: cardShadow(elevation),
        padding,
        opacity: enter,
        // 3D pieces placed on the card (a cash stack, a coin) keep their depth,
        // even while the card fades in.
        perspective: DEPTH.perspective,
        transform: `translate3d(${x}px, ${y}px, ${zz}px) rotateX(${rx}deg) rotateY(${ry}deg) rotateZ(${tilt.rz ?? 0}deg)`,
        ...style,
      }}
    >
      {children}
    </div>
  );
};

/** A soft oval shadow on the wall under a floating object (no blur filter, cheap to render). */
export const GroundShadow: React.FC<{width: number; height?: number; strength?: number; style?: React.CSSProperties}> = ({
  width,
  height = width * 0.22,
  strength = 0.16,
  style,
}) => (
  <div
    style={{
      width,
      height,
      borderRadius: '50%',
      background: `radial-gradient(closest-side, rgba(10,10,10,${strength}), rgba(10,10,10,${strength * 0.45}) 55%, rgba(10,10,10,0))`,
      ...style,
    }}
  />
);

/**
 * A faint mirror image under an object, as if it stands on gloss. For money
 * and shapes only: never wrap words (the mirror image would be text pixels).
 */
export const Reflect: React.FC<{gap?: number; strength?: number; children: React.ReactNode; style?: React.CSSProperties}> = ({
  gap = 4,
  strength = 0.18,
  children,
  style,
}) => (
  <div
    style={{
      WebkitBoxReflect: `below ${gap}px linear-gradient(transparent 58%, rgba(255,255,255,${strength}))`,
      ...style,
    } as React.CSSProperties}
  >
    {children}
  </div>
);
