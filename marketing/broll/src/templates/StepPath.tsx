import React from 'react';
import {interpolate} from 'remotion';
import {BrandFrame, COLORS, Eyebrow, TRACK, enter, progressBetween, useTimeline} from '../brand';

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

export const StepPath: React.FC<StepPathProps> = ({eyebrow, steps, durationInFrames, showSafeZones}) => {
  const {f, fps} = useTimeline(STEP_PATH_BASE, durationInFrames);
  const list = steps.slice(0, 6);
  const n = list.length;
  const run = progressBetween(f, 14, 70); // the path travels down the steps
  const rowH = n >= 6 ? 104 : 118;
  const lineH = (n - 1) * (rowH + ROW_GAP);

  return (
    <BrandFrame showSafeZones={showSafeZones}>
      <Eyebrow text={eyebrow} progress={enter(f, fps, 0, 14)} />
      <div style={{height: 54}} />
      <div style={{position: 'relative', alignSelf: 'center', width: 'fit-content', maxWidth: '100%'}}>
        <div
          style={{position: 'absolute', left: NODE / 2 - 2, top: rowH / 2, width: 4, height: lineH, background: COLORS.line, opacity: enter(f, fps, 3, 12)}}
        />
        <div style={{position: 'absolute', left: NODE / 2 - 2, top: rowH / 2, width: 4, height: lineH * run, background: COLORS.accent}} />
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
                transform: `translateY(${(1 - show) * 18}px)`,
              }}
            >
              <div
                style={{
                  flex: '0 0 auto',
                  width: NODE,
                  height: NODE,
                  borderRadius: '50%',
                  background: on > 0.02 ? `rgba(61,134,240,${on})` : COLORS.white,
                  border: `4px solid ${on > 0.5 ? COLORS.accent : COLORS.track}`,
                  boxShadow: `0 0 0 ${10 * on}px rgba(61,134,240,${0.1 * on})`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 30,
                  fontWeight: 700,
                  color: on > 0.5 ? COLORS.white : COLORS.gray2,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {String(i + 1).padStart(2, '0')}
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
    </BrandFrame>
  );
};
