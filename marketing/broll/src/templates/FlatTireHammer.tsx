import React from 'react';
import {COLORS, BrandFrame, Decor, P3D, Stage3D, enter} from '../brand';
import {
  CarCorner,
  CaptionBlock,
  DENT_ANGLE,
  HAMMER_FACE_Y,
  HAMMER_L,
  Hammer,
  Road,
  RoadShadow,
  ToolDefs,
  TossedBill,
  WHEEL,
  Wheel,
  Z_BODY,
  easeOut,
  seg,
  track,
  useToolTimeline,
  wobble,
} from './toolScene';

// FlatTireHammer: the wrong tool. A car sits on a flat tire and a hammer
// swings at it. Each hit bounces off and the tire stays flat; the tire only
// jiggles. The last swing gets a bigger wind-up, and when it lands the rim
// bends (a dent at the upper right) and the wheel wobbles while two bills fly
// off. The clock by the caption runs a full turn: an hour of swinging.
//
// The joke is on the hammer, never on the viewer. Every word comes from props.

export type FlatTireHammerProps = {
  eyebrow: string;
  caption: string;
  /** The last hit bends the rim (default true). Off: the last hit bounces off like the others. */
  bendRim?: boolean;
  /** Clip length in frames, 75 to 105 (2.5 to 3.5 seconds at 30 fps). Default 90. */
  durationInFrames?: number;
  showSafeZones?: boolean;
};

export const FLAT_TIRE_HAMMER_BASE = 90;
export const FLAT_TIRE_HAMMER_MIN = 75;
export const FLAT_TIRE_HAMMER_MAX = 105;
/** The frame where the joke is fully on screen (rim bent, wobble settling). */
export const FLAT_TIRE_HAMMER_HERO = 84;

export const flatTireHammerDefaults: FlatTireHammerProps = {
  eyebrow: 'Wrong tool',
  caption: 'An hour with a hammer',
  bendRim: true,
};

/** The three hits (template frames). */
export const HITS = [17, 39, 71] as const;

const DEG = Math.PI / 180;
/** Where the hammer face lands, hub-relative: on the outer sidewall, just outside the rim lip. */
const TARGET = {x: 196 * Math.cos(DENT_ANGLE), y: 196 * Math.sin(DENT_ANGLE)};
/** Handle angle at impact (degrees, clockwise = head up). */
const STRIKE = 24;
/** The hand: placed so the face lands exactly on TARGET at STRIKE. Off the right edge of the frame. */
const PIVOT = (() => {
  const c = Math.cos(STRIKE * DEG);
  const s = Math.sin(STRIKE * DEG);
  const fx = -HAMMER_L * c - HAMMER_FACE_Y * s;
  const fy = -HAMMER_L * s + HAMMER_FACE_Y * c;
  return {x: TARGET.x - fx, y: TARGET.y - fy};
})();
const Z_HAMMER = Z_BODY + 30;

/** Scene origin (the road under the hub) inside the 900 x 824 content box. */
const ORIGIN = {x: 440, y: 600};
const SCENE_TILT = {rx: -12, ry: -26};

/** Handle angle over the clip: rest raised, swing, bounce off, settle; a bigger wind-up for the last one. */
const swingAngle = (f: number): number => {
  // Kept low enough that the raised hammer stays inside the band (y 269 up).
  const up = STRIKE + 30;
  const [h1, h2, h3] = HITS;
  const a = track(f, [
    [0, up],
    [h1 - 8, up + 3, 'inout'],
    [h1, STRIKE, 'in'],
    [h1 + 6, STRIKE + 26, 'out'],
    [h2 - 9, up + 2, 'inout'],
    [h2, STRIKE, 'in'],
    [h2 + 6, STRIKE + 24, 'out'],
    [h3 - 16, up + 13, 'inout'], // the big wind-up
    [h3 - 6, up + 15, 'linear'], // ...and the hold
    [h3, STRIKE, 'in'],
    [h3 + 7, STRIKE + 36, 'out'], // it bounces off harder
    [h3 + 19, STRIKE + 26, 'inout'],
  ]);
  // a little tremble while it is held up for the big one
  const hold = seg(f, h3 - 15, h3 - 13) * (1 - seg(f, h3 - 7, h3 - 6));
  return a + hold * 0.9 * Math.sin(f * 2.4);
};

/** The hammer's flat outline, for the motion smear. */
const HammerSmear: React.FC<{angle: number; opacity: number}> = ({angle, opacity}) =>
  opacity < 0.01 ? null : (
    <div
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        opacity,
        transform: `translate3d(${PIVOT.x}px, ${PIVOT.y}px, ${Z_HAMMER - 24}px) rotateZ(${angle}deg)`,
      }}
    >
      <svg width={HAMMER_L + 80} height={260} viewBox={`${-HAMMER_L - 50} -140 ${HAMMER_L + 80} 260`} style={{position: 'absolute', left: -HAMMER_L - 50, top: -140, overflow: 'visible'}}>
        <rect x={-HAMMER_L - 32} y={-36} width={64} height={HAMMER_FACE_Y + 38} rx={8} fill="#C7C7CE" />
        <rect x={-HAMMER_L} y={-17} width={HAMMER_L + 26} height={34} rx={14} fill="#C7C7CE" />
      </svg>
    </div>
  );

/** Short strokes popping out from where the hammer lands. */
const ImpactLines: React.FC<{t: number; big?: boolean}> = ({t, big}) => {
  if (t <= 0 || t >= 1) return null;
  const k = big ? 1.4 : 1;
  const out = 30 + 34 * easeOut(t) * k;
  const len = (20 + 18 * (1 - t)) * k;
  const lines = [-34, 0, 34].map((d) => {
    const a = DENT_ANGLE + d * DEG;
    return [TARGET.x + out * Math.cos(a), TARGET.y + out * Math.sin(a), TARGET.x + (out + len) * Math.cos(a), TARGET.y + (out + len) * Math.sin(a)];
  });
  return (
    <svg
      width={10}
      height={10}
      viewBox="0 0 10 10"
      style={{position: 'absolute', left: 0, top: 0, overflow: 'visible', opacity: 1 - t, transform: `translateZ(${Z_HAMMER + 20}px)`}}
    >
      {lines.map(([x0, y0, x1, y1], i) => (
        <line key={i} x1={x0} y1={y0} x2={x1} y2={y1} stroke={COLORS.gray} strokeWidth={big ? 7 : 6} strokeLinecap="round" />
      ))}
    </svg>
  );
};

export const FlatTireHammer: React.FC<FlatTireHammerProps> = ({eyebrow, caption, bendRim = true, durationInFrames, showSafeZones}) => {
  const L = FLAT_TIRE_HAMMER_BASE;
  const {f, fps} = useToolTimeline(L, durationInFrames, FLAT_TIRE_HAMMER_MIN, FLAT_TIRE_HAMMER_MAX);
  const [h1, h2, h3] = HITS;
  const bend = bendRim ? easeOut(seg(f, h3, h3 + 3)) : 0;

  const settle = enter(f, fps, 0, 22);
  const sceneTransform = `translateZ(${(-170 * (1 - settle)).toFixed(1)}px) rotateX(${SCENE_TILT.rx}deg) rotateY(${(SCENE_TILT.ry - 8 * (1 - settle)).toFixed(2)}deg)`;

  // Each hit: the tire jiggles and the car jolts. The last one harder.
  const jiggle = wobble(f, h1, 0.03, 1.25, 4) + wobble(f, h2, 0.03, 1.25, 4) + wobble(f, h3, bendRim ? 0.045 : 0.03, 1.25, 5);
  const jolt = wobble(f, h1, 5, 1.1, 4) + wobble(f, h2, 5, 1.1, 4) + wobble(f, h3, bendRim ? 9 : 5, 1.1, 5);
  // The bent wheel wobbles on its hub, then rests a little crooked.
  const wobZ = bendRim ? wobble(f, h3, 4.5, 0.72, 10) : 0;
  const wobY = bendRim ? wobble(f, h3 + 1, 7, 0.62, 11) : 0;

  const hubH = WHEEL.R - WHEEL.flatDrop;
  const angle = swingAngle(f);
  const speed = Math.abs(swingAngle(f) - swingAngle(f - 1));
  const smear = Math.min(1, Math.max(0, (speed - 6) / 14));

  return (
    <BrandFrame showSafeZones={showSafeZones}>
      <ToolDefs />
      <Stage3D f={f} length={L}>
        <div style={{position: 'relative', width: 900, height: 824, ...P3D}}>
          <div style={{position: 'absolute', left: ORIGIN.x, top: ORIGIN.y, width: 0, height: 0, ...P3D, transform: sceneTransform}}>
            <Road />
            <RoadShadow w={1320} d={250} z={20} strength={0.07} />
            <RoadShadow w={430} d={140} z={0} strength={0.3} />
            {/* the car and its wheel */}
            <div style={{position: 'absolute', left: 0, top: 0, ...P3D, transform: `translate3d(0px, ${(-hubH + jolt).toFixed(2)}px, 0px)`}}>
              <CarCorner />
              <div style={{position: 'absolute', left: 0, top: 0, ...P3D, transform: `rotateZ(${wobZ.toFixed(2)}deg) rotateY(${wobY.toFixed(2)}deg)`}}>
                <Wheel id="fth" flat={1} dent={bend} rimTilt={bend} jiggle={jiggle} />
              </div>
              <Decor>
                {bendRim
                  ? [
                      {dx: -240, dy: -170, turn: -30, at: 1},
                      {dx: -50, dy: -230, turn: 24, at: 3},
                    ].map((b, i) => (
                      <div key={i} style={{position: 'absolute', left: TARGET.x - 55, top: TARGET.y - 24, ...P3D, transform: `translateZ(${Z_HAMMER}px)`}}>
                        <TossedBill progress={seg(f, h3 + b.at, h3 + b.at + 16)} dx={b.dx} dy={b.dy} turn={b.turn} width={110} />
                      </div>
                    ))
                  : null}
              </Decor>
            </div>
            {/* the hammer, held off the right edge */}
            <div style={{position: 'absolute', left: 0, top: 0, ...P3D, transform: `translate3d(0px, ${-hubH}px, 0px)`}}>
              <HammerSmear angle={swingAngle(f - 1.4)} opacity={0.16 * smear} />
              <HammerSmear angle={swingAngle(f - 0.7)} opacity={0.26 * smear} />
              <div style={{position: 'absolute', left: 0, top: 0, ...P3D, transform: `translate3d(${PIVOT.x}px, ${PIVOT.y}px, ${Z_HAMMER}px) rotateZ(${angle.toFixed(2)}deg)`}}>
                <Hammer />
              </div>
              <ImpactLines t={seg(f, h1, h1 + 7)} />
              <ImpactLines t={seg(f, h2, h2 + 7)} />
              <ImpactLines t={seg(f, h3, h3 + 9)} big />
            </div>
          </div>

          {/* eyebrow + caption under the scene (the clock runs a full hour) */}
          <CaptionBlock eyebrow={eyebrow} caption={caption} clockTurn={Math.min(1, f / (L - 6))} f={f} fps={fps} />
        </div>
      </Stage3D>
    </BrandFrame>
  );
};
