import React from 'react';
import {BrandFrame, COLORS, Eyebrow, Tag, TRACK, enter, fadeUp, progressBetween, useTimeline} from '../brand';

export type RatesRisingProps = {
  eyebrow: string;
  headline: string;
  subline: string | null;
  /** Chip at the tip of the line. */
  chipLabel: string;
  durationInFrames?: number;
  showSafeZones?: boolean;
};

export const RATES_RISING_BASE = 75;
export const RATES_RISING_HERO = 72;

// Words from Chris's 2026-10-02 economy angle: "Interest rates are going up ...
// When rates rise, banks tighten, and money gets harder to get." The line is a
// picture of "going up", not data: no axis, no dates, no rate values.
export const ratesRisingDefaults: RatesRisingProps = {
  eyebrow: 'Interest rates',
  headline: 'Rates are going up.',
  subline: 'When rates rise, banks tighten.',
  chipLabel: 'Rates',
};

const W = 900;
const H = 380;
const TIP = {x: 862, y: 58};
const LINE = `M 18 300 C 120 302, 190 286, 290 292 S 450 304, 540 276 S 690 196, 760 132 S 830 72, ${TIP.x} ${TIP.y}`;
const AREA = `${LINE} L ${TIP.x} ${H - 30} L 18 ${H - 30} Z`;

export const RatesRising: React.FC<RatesRisingProps> = ({eyebrow, headline, subline, chipLabel, durationInFrames, showSafeZones}) => {
  const {f, fps} = useTimeline(RATES_RISING_BASE, durationInFrames);
  const chart = enter(f, fps, 6, 14);
  const draw = progressBetween(f, 10, 50);
  const tip = enter(f, fps, 47, 10);
  const chip = enter(f, fps, 50, 12);

  return (
    <BrandFrame showSafeZones={showSafeZones}>
      <Eyebrow text={eyebrow} progress={enter(f, fps, 0, 14)} />
      <div
        style={{
          ...fadeUp(enter(f, fps, 3, 14), 22),
          marginTop: 34,
          fontSize: 104,
          fontWeight: 800,
          letterSpacing: TRACK.h1,
          lineHeight: 1.02,
          textAlign: 'center',
        }}
      >
        {headline}
      </div>
      <div style={{position: 'relative', width: W, height: H, marginTop: 44, opacity: chart}}>
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{position: 'absolute', inset: 0, overflow: 'visible'}}>
          <defs>
            <linearGradient id="rates-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={COLORS.accent} stopOpacity={0.16} />
              <stop offset="100%" stopColor={COLORS.accent} stopOpacity={0} />
            </linearGradient>
            <clipPath id="rates-reveal">
              <rect x={0} y={-40} width={18 + (TIP.x - 18) * draw} height={H + 80} />
            </clipPath>
          </defs>
          {[92, 186, 280].map((y) => (
            <line key={y} x1={0} x2={W} y1={y} y2={y} stroke={COLORS.line} strokeWidth={2} strokeDasharray="10 12" />
          ))}
          <line x1={0} x2={W} y1={H - 30} y2={H - 30} stroke={COLORS.track} strokeWidth={3} />
          <path d={AREA} fill="url(#rates-area)" clipPath="url(#rates-reveal)" />
          <path
            d={LINE}
            fill="none"
            stroke={COLORS.accent}
            strokeWidth={10}
            strokeLinecap="round"
            strokeLinejoin="round"
            pathLength={1}
            strokeDasharray={1}
            strokeDashoffset={1 - draw}
          />
          <circle cx={TIP.x} cy={TIP.y} r={30 * tip} fill={COLORS.accent} opacity={0.14} />
          <circle cx={TIP.x} cy={TIP.y} r={14 * tip} fill={COLORS.white} stroke={COLORS.accent} strokeWidth={6 * tip} />
        </svg>
        <div
          style={{
            position: 'absolute',
            right: 104,
            top: TIP.y - 30,
            opacity: chip,
            transform: `translateX(${(1 - chip) * 16}px)`,
          }}
        >
          <Tag text={`↑ ${chipLabel}`} tone="info" size={26} dot={false} />
        </div>
      </div>
      {subline ? (
        <div
          style={{
            ...fadeUp(enter(f, fps, 55, 14), 18),
            marginTop: 40,
            maxWidth: 860,
            fontSize: 48,
            fontWeight: 600,
            letterSpacing: TRACK.body,
            lineHeight: 1.22,
            color: COLORS.ink2,
            textAlign: 'center',
          }}
        >
          {subline}
        </div>
      ) : null}
    </BrandFrame>
  );
};
