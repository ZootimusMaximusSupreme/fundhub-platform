import React from 'react';
import {
  BrandFrame,
  COLORS,
  CONTENT_WIDTH,
  Eyebrow,
  TRACK,
  countUp,
  enter,
  fadeUp,
  formatDollars,
  progressBetween,
  useTimeline,
} from '../brand';

/** A dollar amount (counts up) or a phrase such as "Several hundred thousand" (fades in). */
export type Amount = {label: string; value?: number; text?: string};

export type QualifyTodayProps = {
  eyebrow: string;
  today: Amount;
  after: Amount;
  /**
   * The chip under the amounts. With two numbers it reads "<gap amount> <gapLabel>", e.g. "$22,150 left on the table".
   * With words in place of numbers it shows gapLabel alone. Null hides it.
   */
  gapLabel: string | null;
  durationInFrames?: number;
  showSafeZones?: boolean;
};

export const QUALIFY_TODAY_BASE = 75;
export const QUALIFY_TODAY_HERO = 72;

// Defaults are the /roadmap sample client (UnderwriteIQ on the one simulated
// file: $199,350 today, $221,500 once fixed, $22,150 left on the table).
// See ops/workflows/2026-10-02-roadmap-sample-content.md.
export const qualifyTodayDefaults: QualifyTodayProps = {
  eyebrow: 'How much you qualify for',
  today: {label: 'Today', value: 199350},
  after: {label: 'Once your file is fixed', value: 221500},
  gapLabel: 'left on the table',
};

const AmountRow: React.FC<{amount: Amount; shown: string; color: string; progress: number}> = ({
  amount,
  shown,
  color,
  progress,
}) => (
  <div style={{...fadeUp(progress), display: 'flex', flexDirection: 'column', alignItems: 'center'}}>
    <div
      style={{
        fontSize: 30,
        fontWeight: 600,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color: COLORS.gray2,
        lineHeight: 1.2,
      }}
    >
      {amount.label}
    </div>
    <div
      style={{
        marginTop: 6,
        fontSize: amount.value === undefined ? 92 : 148,
        fontWeight: 800,
        letterSpacing: TRACK.num,
        lineHeight: 1.04,
        color,
        fontVariantNumeric: 'tabular-nums',
        textAlign: 'center',
      }}
    >
      {shown}
    </div>
  </div>
);

export const QualifyToday: React.FC<QualifyTodayProps> = ({eyebrow, today, after, gapLabel, durationInFrames, showSafeZones}) => {
  const {f, fps} = useTimeline(QUALIFY_TODAY_BASE, durationInFrames);

  const both = today.value !== undefined && after.value !== undefined;
  const todayShown =
    today.value !== undefined ? formatDollars(countUp(f, 6, 30, 0, today.value)) : (today.text ?? '');
  const afterShown =
    after.value !== undefined
      ? formatDollars(countUp(f, 28, 50, today.value ?? 0, after.value))
      : (after.text ?? '');
  const gap = both ? (after.value as number) - (today.value as number) : 0;

  const ratio = both ? Math.max(0.08, Math.min(1, (today.value as number) / (after.value as number))) : 0;
  const barToday = progressBetween(f, 8, 32);
  const barGap = progressBetween(f, 30, 52);

  return (
    <BrandFrame showSafeZones={showSafeZones}>
      <Eyebrow text={eyebrow} progress={enter(f, fps, 0, 14)} />
      <div style={{height: 70}} />
      <AmountRow amount={today} shown={todayShown} color={COLORS.ink} progress={enter(f, fps, 4, 16)} />
      <div style={{height: 46}} />
      <AmountRow amount={after} shown={afterShown} color={COLORS.accent} progress={enter(f, fps, 24, 16)} />
      {both ? (
        <>
          <div style={{height: 58}} />
          <div
            style={{
              position: 'relative',
              width: CONTENT_WIDTH - 60,
              height: 26,
              borderRadius: 13,
              background: COLORS.line,
              overflow: 'hidden',
              opacity: enter(f, fps, 4, 12),
            }}
          >
            <div
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                bottom: 0,
                width: `${ratio * barToday * 100}%`,
                background: COLORS.ink2,
              }}
            />
            <div
              style={{
                position: 'absolute',
                left: `${ratio * 100}%`,
                top: 0,
                bottom: 0,
                width: `${(1 - ratio) * barGap * 100}%`,
                background: COLORS.accent,
              }}
            />
          </div>
          {gapLabel && gap > 0 ? (
            <div
              style={{
                ...fadeUp(enter(f, fps, 46, 14), 18),
                marginTop: 40,
                display: 'inline-flex',
                alignItems: 'baseline',
                gap: 14,
                padding: '18px 30px',
                borderRadius: 999,
                background: COLORS.accentSoft,
                border: `2px solid ${COLORS.accentLine}`,
              }}
            >
              <span style={{fontSize: 46, fontWeight: 800, color: COLORS.accent, letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums'}}>
                {formatDollars(countUp(f, 48, 62, 0, gap))}
              </span>
              <span style={{fontSize: 38, fontWeight: 600, color: COLORS.ink2, letterSpacing: '-0.015em'}}>{gapLabel}</span>
            </div>
          ) : null}
        </>
      ) : gapLabel ? (
        <div
          style={{
            ...fadeUp(enter(f, fps, 46, 14), 18),
            marginTop: 54,
            padding: '18px 30px',
            borderRadius: 999,
            background: COLORS.accentSoft,
            border: `2px solid ${COLORS.accentLine}`,
            fontSize: 40,
            fontWeight: 700,
            color: COLORS.accent,
            letterSpacing: '-0.015em',
          }}
        >
          {gapLabel}
        </div>
      ) : null}
    </BrandFrame>
  );
};
