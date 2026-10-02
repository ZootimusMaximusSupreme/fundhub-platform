import React from 'react';
import {BrandFrame, COLORS, Eyebrow, TRACK, enter, fadeUp, useTimeline} from '../brand';

export type HiddenDataPointsProps = {
  eyebrow: string;
  /** How many points the script line names. The dots are never labeled: the repo does not list all 13. */
  count: number;
  label: string;
  subline: string | null;
  durationInFrames?: number;
  showSafeZones?: boolean;
};

export const HIDDEN_DATA_POINTS_BASE = 90;
export const HIDDEN_DATA_POINTS_HERO = 86;

// Words from /roadmap How It Works step 01: "Even with perfect credit, your
// roadmap reveals the 13 hidden data points that transform a decent file into
// one that can secure an additional $100,000+ in low-interest funding."
export const hiddenDataPointsDefaults: HiddenDataPointsProps = {
  eyebrow: 'Even with perfect credit',
  count: 13,
  label: 'hidden data points',
  subline: 'An additional $100,000+ in low-interest funding',
};

const RING = 470; // ring box size
const RADIUS = 206; // dot orbit
const DOT = 30;

export const HiddenDataPoints: React.FC<HiddenDataPointsProps> = ({eyebrow, count, label, subline, durationInFrames, showSafeZones}) => {
  const {f, fps} = useTimeline(HIDDEN_DATA_POINTS_BASE, durationInFrames);
  const n = Math.max(1, Math.min(24, Math.round(count)));
  const ringIn = enter(f, fps, 3, 12);
  const step = 34 / n; // all dots light between frame 12 and 46
  const lit = Array.from({length: n}, (_, i) => enter(f, fps, 12 + i * step, 8));
  const litCount = Math.max(1, lit.filter((p) => p > 0.5).length); // shows from 1 as the first dot lights

  return (
    <BrandFrame showSafeZones={showSafeZones}>
      <Eyebrow text={eyebrow} progress={enter(f, fps, 0, 14)} />
      <div style={{height: 34}} />
      <div style={{position: 'relative', width: RING, height: RING, opacity: ringIn, transform: `scale(${0.96 + ringIn * 0.04})`}}>
        <svg width={RING} height={RING} style={{position: 'absolute', inset: 0}}>
          <circle cx={RING / 2} cy={RING / 2} r={RADIUS} fill="none" stroke={COLORS.line} strokeWidth={2} />
        </svg>
        {lit.map((p, i) => {
          const a = (-90 + (i * 360) / n) * (Math.PI / 180);
          const x = RING / 2 + RADIUS * Math.cos(a) - DOT / 2;
          const y = RING / 2 + RADIUS * Math.sin(a) - DOT / 2;
          return (
            <div
              key={i}
              style={{
                position: 'absolute',
                left: x,
                top: y,
                width: DOT,
                height: DOT,
                borderRadius: '50%',
                background: p > 0.02 ? `rgba(61,134,240,${p})` : COLORS.white,
                border: `3px solid ${p > 0.5 ? COLORS.accent : COLORS.track}`,
                boxShadow: `0 0 0 ${10 * p}px rgba(61,134,240,${0.12 * p})`,
                transform: `scale(${0.85 + 0.15 * p})`,
              }}
            />
          );
        })}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 250,
            fontWeight: 800,
            letterSpacing: '-0.06em',
            lineHeight: 1,
            color: COLORS.ink,
            fontVariantNumeric: 'tabular-nums',
            paddingRight: 12,
            opacity: lit[0],
          }}
        >
          {litCount}
        </div>
      </div>
      <div style={{height: 30}} />
      <div style={{...fadeUp(enter(f, fps, 46, 14)), fontSize: 72, fontWeight: 700, letterSpacing: TRACK.h2, lineHeight: 1.05, textAlign: 'center'}}>
        {label}
      </div>
      {subline ? (
        <div
          style={{
            ...fadeUp(enter(f, fps, 54, 14), 18),
            marginTop: 22,
            maxWidth: 820,
            textWrap: 'balance',
            fontSize: 40,
            fontWeight: 500,
            letterSpacing: TRACK.body,
            lineHeight: 1.3,
            color: COLORS.gray,
            textAlign: 'center',
          }}
        >
          {subline}
        </div>
      ) : null}
    </BrandFrame>
  );
};
