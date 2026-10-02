import React from 'react';
import {interpolate} from 'remotion';
import {BackdropStage, BrandFrame, COLORS, DEPTH, Eyebrow, MoneyGutters, P3D, Stage3D, TRACK, enter, progressBetween, useTimeline} from '../brand';

export type StepPathProps = {
  eyebrow: string;
  /** Two to six steps, in the words of the script line. */
  steps: string[];
  durationInFrames?: number;
  showSafeZones?: boolean;
};

export const STEP_PATH_BASE = 90;
export const STEP_PATH_HERO = 86;

// Steps are the five How It Works titles on /roadmap. Step 2 on the page says
// "optimize"; the ad rules ban every form of that word, so it reads "fix" here.
export const stepPathDefaults: StepPathProps = {
  eyebrow: 'The order to do it in',
  steps: [
    'See what you qualify for today',
    'Find the gap and fix your personal credit',
    'Build the trust in the business',
    'Set up the businesses',
    'Apply in the right order',
  ],
};

const NODE = 70;
const ROW_GAP = 26;
const DISC_T = 12; // disc thickness

/** One face of a step disc. */
const DiscFace: React.FC<{label: string; lit: boolean; back?: boolean}> = ({label, lit, back}) => (
  <div
    style={{
      position: 'absolute',
      inset: 0,
      borderRadius: '50%',
      background: lit
        ? 'radial-gradient(circle at 34% 28%, #9CC2F8 0%, #3D86F0 52%, #2C67C2 100%)'
        : 'radial-gradient(circle at 34% 28%, #FFFFFF 0%, #F4F4F5 50%, #E4E4E7 100%)',
      boxShadow: lit
        ? 'inset 0 0 0 3px rgba(255,255,255,.22), 0 10px 16px rgba(10,10,10,.14)'
        : `inset 0 0 0 4px ${COLORS.track}, 0 10px 16px rgba(10,10,10,.10)`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: 30,
      fontWeight: 700,
      color: lit ? COLORS.white : COLORS.gray2,
      fontVariantNumeric: 'tabular-nums',
      transform: back ? `translateZ(${-DISC_T / 2}px) rotateY(180deg)` : `translateZ(${DISC_T / 2}px)`,
    }}
  >
    {label}
  </div>
);

/** A thick numbered disc that flips from its pale side to its blue side as `on` goes 0 to 1. */
const StepDisc: React.FC<{label: string; on: number}> = ({label, on}) => {
  const spin = 180 * (1 - on);
  const layers = 6;
  return (
    <div style={{position: 'relative', width: NODE, height: NODE, ...P3D, transform: `translateZ(16px) rotateY(${spin}deg)`}}>
      {Array.from({length: layers}, (_, i) => {
        const z = -DISC_T / 2 + (DISC_T * (i + 1)) / (layers + 1);
        return (
          <div
            key={i}
            style={{position: 'absolute', inset: 0, borderRadius: '50%', background: z > 0 ? '#2C67C2' : '#C9C9CF', transform: `translateZ(${z}px)`}}
          />
        );
      })}
      {/* front (blue) faces the camera at spin 0; back (pale) at spin 180 */}
      <DiscFace label={label} lit />
      <DiscFace label={label} lit={false} back />
    </div>
  );
};

export const StepPath: React.FC<StepPathProps> = ({eyebrow, steps, durationInFrames, showSafeZones}) => {
  const {f, fps} = useTimeline(STEP_PATH_BASE, durationInFrames);
  const L = STEP_PATH_BASE;
  const list = steps.slice(0, 6);
  const n = list.length;
  const run = progressBetween(f, 14, 70); // the path travels down the steps
  const rowH = n >= 6 ? 104 : 118;
  const lineH = (n - 1) * (rowH + ROW_GAP);

  return (
    <BrandFrame
      showSafeZones={showSafeZones}
      backdrop={
        <BackdropStage f={f} length={L}>
          {/* money rises up the sides as the path comes together */}
          <MoneyGutters
            f={f}
            mode="rise"
            count={10}
            seed="step-path"
            size={[160, 240]}
            depth={[-700, -150]}
            opacity={0.55}
            blur={2.5}
            appear={progressBetween(f, 30, 66)}
          />
        </BackdropStage>
      }
    >
      <Stage3D f={f} length={L}>
        <Eyebrow text={eyebrow} progress={enter(f, fps, 0, 14)} />
        <div style={{height: 54}} />
        <div style={{position: 'relative', alignSelf: 'center', width: 'fit-content', maxWidth: '100%', ...P3D, transform: 'rotateY(7deg) rotateX(3deg)'}}>
          <div
            style={{
              position: 'absolute',
              left: NODE / 2 - 3,
              top: rowH / 2,
              width: 6,
              height: lineH,
              borderRadius: 3,
              background: COLORS.line,
              opacity: enter(f, fps, 3, 12),
            }}
          />
          <div
            style={{
              position: 'absolute',
              left: NODE / 2 - 3,
              top: rowH / 2,
              width: 6,
              height: lineH * run,
              borderRadius: 3,
              background: COLORS.accent,
              boxShadow: '0 0 16px rgba(61,134,240,.35)',
            }}
          />
          {list.map((text, i) => {
            const show = enter(f, fps, 3 + i * 4, 12);
            const at = n === 1 ? 0 : i / (n - 1);
            const on = interpolate(run, [Math.max(0, at - 0.08), Math.min(1, at + 0.02)], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            });
            return (
              <div
                key={text}
                style={{
                  position: 'relative',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 34,
                  height: rowH,
                  marginTop: i === 0 ? 0 : ROW_GAP,
                  opacity: show,
                  // keeps the disc's depth even while the row fades in
                  perspective: DEPTH.perspective,
                  transform: `translate3d(0, ${(1 - show) * 18}px, ${(1 - show) * -120}px)`,
                }}
              >
                <div style={{flex: '0 0 auto', ...P3D}}>
                  <StepDisc label={String(i + 1).padStart(2, '0')} on={on} />
                </div>
                <span
                  style={{
                    fontSize: 44,
                    fontWeight: 600,
                    letterSpacing: TRACK.body,
                    lineHeight: 1.16,
                    maxWidth: 650,
                    textWrap: 'balance',
                    color: on > 0.5 ? COLORS.ink : COLORS.gray2,
                  }}
                >
                  {text}
                </span>
              </div>
            );
          })}
        </div>
      </Stage3D>
    </BrandFrame>
  );
};
