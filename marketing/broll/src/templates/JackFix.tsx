import React from 'react';
import {CARD_EDGE, COLORS, BrandFrame, Decor, MoneyField, P3D, Stage3D, TAG, TRACK, cardShadow, enter} from '../brand';
import {
  CarCorner,
  CaptionBlock,
  JACK,
  LugWrench,
  NUTS,
  type NutState,
  Road,
  RoadShadow,
  ScissorJack,
  ToolDefs,
  WHEEL,
  Wheel,
  Z_BODY,
  easeOut,
  seg,
  track,
  useToolTimeline,
} from './toolScene';

// JackFix: the right tool. The same car on the same flat tire. A blue scissor
// jack slides in and cranks the car up, a blue cross wrench spins the lug nuts
// off, the flat is tossed aside and a fresh full tire drops in and goes on, the
// wrench spins the nuts back, the jack lets the car down and slides out. A
// "Back on the road" check pops, the wheel turns and the road moves, and a few
// bills drift down behind. The clock by the caption only gets a quarter of
// the way round: fifteen minutes.
//
// Every word comes from props. No dollar figure.

export type JackFixProps = {
  eyebrow: string;
  caption: string;
  /** The chip that pops when the car is back down. */
  doneLabel?: string;
  /** Clip length in frames, 75 to 105 (2.5 to 3.5 seconds at 30 fps). Default 90. */
  durationInFrames?: number;
  showSafeZones?: boolean;
};

export const JACK_FIX_BASE = 90;
export const JACK_FIX_MIN = 75;
export const JACK_FIX_MAX = 105;
/** The frame where the fix is fully on screen (new tire on, car down, check up). */
export const JACK_FIX_HERO = 86;

export const jackFixDefaults: JackFixProps = {
  eyebrow: 'Right tool',
  caption: 'Fifteen minutes with a jack',
  doneLabel: 'Back on the road',
};

const ORIGIN = {x: 440, y: 600};
const SCENE_TILT = {rx: -12, ry: -26};
/** Where the jack stands, hub-relative x: under the rocker, just behind the wheel arch. */
const JACK_X = 395;
const JACK_Z = Z_BODY - 44;
/** The wrench sits on the hub, in front of the cap. */
const WRENCH_Z = WHEEL.T / 2 - 14 + 42;
const FLAT_H = WHEEL.R - WHEEL.flatDrop; // hub height on the flat
const LIFT_H = WHEEL.R + 30; // hub height on the jack: the tire clears the road
const FULL_H = WHEEL.R; // hub height on the new tire

// Beats (template frames at the default 90-frame length).
const T = {
  jackIn: [2, 13],
  lift: [13, 27],
  wrenchIn: [23, 28],
  spinOff: [28, 36],
  wrenchOut: [36, 40],
  pullOut: [38, 44],
  tossOut: [44, 50],
  dropIn: [45, 54],
  pushIn: [54, 59],
  wrenchIn2: [57, 60],
  spinOn: [60, 66],
  wrenchOut2: [66, 70],
  lower: [66, 74],
  detach: [74, 77],
  jackOut: [77, 83],
  check: [75, 83],
  drive: [80, 90],
  money: [74, 84],
} as const;

const s = (f: number, k: keyof typeof T): number => seg(f, T[k][0], T[k][1]);

export const JackFix: React.FC<JackFixProps> = ({eyebrow, caption, doneLabel = 'Back on the road', durationInFrames, showSafeZones}) => {
  const L = JACK_FIX_BASE;
  const {f, fps} = useToolTimeline(L, durationInFrames, JACK_FIX_MIN, JACK_FIX_MAX);

  const settle = enter(f, fps, 0, 22);
  const sceneTransform = `translateZ(${(-170 * (1 - settle)).toFixed(1)}px) rotateX(${SCENE_TILT.rx}deg) rotateY(${(SCENE_TILT.ry - 8 * (1 - settle)).toFixed(2)}deg)`;

  // Hub height above the road: flat -> up on the jack -> down on the new tire.
  const hubH = track(f, [
    [T.lift[0], FLAT_H],
    [T.lift[1], LIFT_H, 'inout'],
    [T.lower[0], LIFT_H],
    [T.lower[1], FULL_H, 'inout'],
  ]);
  // The jack: slides in a touch short of the rocker, cranks up to it and lifts,
  // follows the car down, lets go, slides out.
  const reach = hubH - WHEEL.rocker;
  const preTouch = track(f, [
    [T.jackIn[1], -12],
    [T.lift[0] + 3, 0, 'out'],
  ]);
  const jackH = f < T.detach[0] ? reach + Math.min(0, preTouch) : track(f, [[T.detach[0], reach], [T.detach[1], reach - 34, 'inout']]);
  const jackX = JACK_X + 560 * (1 - easeOut(s(f, 'jackIn'))) + 620 * s(f, 'jackOut') ** 2;
  const crank = jackH * 0.16;

  // The wrench: comes in, spins the nuts off, backs away; again for the new wheel.
  const wrenchIn = Math.max(easeOut(s(f, 'wrenchIn')) * (1 - s(f, 'wrenchOut')), easeOut(s(f, 'wrenchIn2')) * (1 - s(f, 'wrenchOut2')));
  const wrenchSpin = -620 * easeOut(s(f, 'spinOff')) + 620 * easeOut(s(f, 'spinOn'));
  const wrenchOn = wrenchIn > 0.001;
  const wq = 1 - wrenchIn;

  // Old wheel: nuts come off one by one, then it pulls out and rolls away.
  const oldNuts: NutState[] = NUTS.map((_, i) => ({out: seg(f, T.spinOff[0] + 1 + i * 1.1, T.spinOff[0] + 5 + i * 1.1), spin: wrenchSpin}));
  // Every wheel stays inside the frame the whole time: a wheel that crosses
  // the frame edge loses slices with the default renderer (measured), so the
  // old one is tossed aside and shrinks away, and the new one drops in.
  const pull = s(f, 'pullOut');
  const toss = s(f, 'tossOut');
  const oldX = -250 * easeOut(toss);
  const oldZ = 180 * easeOut(pull);
  const oldY = 70 * easeOut(toss);
  const oldScale = 1 - toss * toss;
  const oldTurn = -110 * toss * toss;
  // New wheel: drops in in front, lands on the road, then goes onto the hub.
  const drop = s(f, 'dropIn');
  const push = s(f, 'pushIn');
  const newX = 260 * (1 - easeOut(drop));
  const newZ = 180 * (1 - easeOut(push));
  const ground = LIFT_H - FULL_H; // on the road, the hub sits this far below the lifted hub
  // starts low enough (and small enough) that it never crosses the wordmark
  const newY = push > 0 ? ground * (1 - easeOut(push)) : -130 + (130 + ground) * drop * drop;
  const newScale = 0.5 + 0.5 * drop;
  const newTurn = 70 * (1 - easeOut(drop));
  const newNuts: NutState[] = NUTS.map((_, i) => ({out: 1 - seg(f, T.spinOn[0] + i * 0.9, T.spinOn[0] + 3 + i * 0.9), spin: wrenchSpin}));
  // Back on the road: the wheel turns and the lane dashes slide by.
  const drive = s(f, 'drive');
  const driveDist = 520 * drive * drive;
  const driveTurn = (driveDist / WHEEL.R) * (180 / Math.PI);

  const showOld = f < T.tossOut[1];
  const showNew = f >= T.dropIn[0];
  const check = enter(f, fps, T.check[0], 12);
  const checkDraw = seg(f, T.check[0] + 3, T.check[0] + 10);

  return (
    <BrandFrame showSafeZones={showSafeZones}>
      <ToolDefs />
      <Stage3D f={f} length={L}>
        <div style={{position: 'relative', width: 900, height: 824, ...P3D}}>
          {/* a few bills drift down at the sides once it is fixed */}
          <Decor>
            {[
              {x: -60, seed: 'jack-fix-l', depth: [-60, 160] as [number, number]},
              {x: 580, seed: 'jack-fix-r', depth: [320, 440] as [number, number]},
            ].map((side) => (
              <MoneyField
                key={side.seed}
                f={f}
                mode="fall"
                stage="content"
                count={3}
                seed={side.seed}
                area={{x: side.x, y: 40, w: 320, h: 500}}
                size={[120, 170]}
                depth={side.depth}
                opacity={0.85}
                speed={0.75}
                appear={s(f, 'money')}
              />
            ))}
          </Decor>

          <div style={{position: 'absolute', left: ORIGIN.x, top: ORIGIN.y, width: 0, height: 0, ...P3D, transform: sceneTransform}}>
            <Road travel={driveDist} />
            <RoadShadow w={1320} d={250} z={20} strength={0.07} />
            {/* contact shadow: soft while the tire is up */}
            <RoadShadow w={430} d={140} z={0} strength={0.3 - 0.2 * Math.min(1, (hubH - FLAT_H) / 30)} />
            {/* the jack */}
            {jackX < 1100 ? (
              <>
                <RoadShadow x={jackX} w={300} d={110} z={JACK_Z} strength={0.16} />
                <div style={{position: 'absolute', left: 0, top: 0, ...P3D, transform: `translate3d(${jackX.toFixed(1)}px, 0px, ${JACK_Z}px)`}}>
                  <ScissorJack h={Math.max(JACK.min, jackH)} crank={crank} />
                </div>
              </>
            ) : null}
            {/* the car */}
            <div style={{position: 'absolute', left: 0, top: 0, ...P3D, transform: `translate3d(0px, ${(-hubH).toFixed(2)}px, 0px)`}}>
              <CarCorner />
              {showOld ? (
                <div
                  style={{
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    ...P3D,
                    transform: `translate3d(${oldX.toFixed(1)}px, ${oldY.toFixed(1)}px, ${oldZ.toFixed(1)}px) rotateZ(${oldTurn.toFixed(2)}deg) scale(${Math.max(0.001, oldScale).toFixed(3)})`,
                  }}
                >
                  <Wheel id="jfo" flat={1} nuts={oldNuts} />
                </div>
              ) : null}
              {showNew ? (
                <div
                  style={{
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    ...P3D,
                    transform: `translate3d(${newX.toFixed(1)}px, ${newY.toFixed(1)}px, ${newZ.toFixed(1)}px) rotateZ(${(newTurn + driveTurn).toFixed(2)}deg) scale(${newScale.toFixed(3)})`,
                  }}
                >
                  <Wheel id="jfn" flat={0} nuts={newNuts} />
                </div>
              ) : null}
              {wrenchOn ? (
                <div
                  style={{
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    ...P3D,
                    transform: `translate3d(${(430 * wq).toFixed(1)}px, ${(-300 * wq).toFixed(1)}px, ${(WRENCH_Z + 260 * wq).toFixed(1)}px) rotateZ(${(wrenchSpin + 50 * wq).toFixed(1)}deg)`,
                  }}
                >
                  <LugWrench />
                </div>
              ) : null}
            </div>
          </div>

          {/* eyebrow + caption under the scene (the clock only gets a quarter of the way round: fifteen minutes) */}
          <CaptionBlock eyebrow={eyebrow} caption={caption} clockTurn={0.25 * easeOut(Math.min(1, f / (T.check[0] + 2)))} f={f} fps={fps} />
        </div>
      </Stage3D>
      <div style={{position: 'absolute', inset: 0}}>
          {/* the check: a flat overlay on top of the 3D stage, so the car can never cover it */}
          <div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: 46,
              display: 'flex',
              justifyContent: 'center',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 18,
                padding: '18px 34px 18px 20px',
                borderRadius: 999,
                background: COLORS.white,
                ...CARD_EDGE,
                boxShadow: cardShadow(0.9),
                opacity: check,
                transform: `translateY(${(24 * (1 - check)).toFixed(1)}px) scale(${(0.7 + 0.3 * check).toFixed(3)})`,
              }}
            >
              <svg width={56} height={56} viewBox="0 0 56 56" style={{display: 'block'}}>
                <circle cx={28} cy={28} r={26} fill={TAG.ok.bg} stroke={TAG.ok.border} strokeWidth={3} />
                <path
                  d="M16 29 L24.5 37 L40 20"
                  fill="none"
                  stroke={TAG.ok.fg}
                  strokeWidth={5.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray={40}
                  strokeDashoffset={40 * (1 - checkDraw)}
                />
              </svg>
              <span style={{fontSize: 44, fontWeight: 700, letterSpacing: TRACK.h2, color: COLORS.ink, whiteSpace: 'nowrap', lineHeight: 1}}>{doneLabel}</span>
            </div>
          </div>

      </div>
    </BrandFrame>
  );
};
