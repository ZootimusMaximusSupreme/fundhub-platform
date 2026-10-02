import React from 'react';
import {
  BackdropStage,
  BrandFrame,
  COLORS,
  Card3D,
  CashStack,
  DollarCounter,
  Eyebrow,
  MoneyGutters,
  P3D,
  Stage3D,
  TRACK,
  countUp,
  enter,
  fadeUp,
  formatDollars,
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

const STACK_W = 172; // bill width on top of each cash stack
const STACK_MAX = 118; // tallest stack, px (a picture of size, never an amount)
const ROW_H = 176;

/** One row on the card: label and amount on the left, its cash stack on the right. */
const Row: React.FC<{
  amount: Amount;
  number: React.ReactNode;
  color: string;
  progress: number;
  stack: React.ReactNode;
}> = ({amount, number, color, progress, stack}) => (
  <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, minHeight: ROW_H}}>
    <div style={{...fadeUp(progress), display: 'flex', flexDirection: 'column', alignItems: 'flex-start', minWidth: 0}}>
      <div
        style={{
          fontSize: 28,
          fontWeight: 600,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: COLORS.gray2,
          lineHeight: 1.2,
          whiteSpace: 'nowrap',
        }}
      >
        {amount.label}
      </div>
      <div style={{marginTop: 6, color}}>
        {amount.value === undefined ? (
          <div style={{fontSize: 82, fontWeight: 800, letterSpacing: TRACK.h2, lineHeight: 1.04, maxWidth: 600, textWrap: 'balance'}}>
            {amount.text ?? ''}
          </div>
        ) : (
          number
        )}
      </div>
    </div>
    <div style={{flex: '0 0 auto', position: 'relative', width: STACK_W + 30, height: ROW_H, ...P3D}}>
      <div style={{position: 'absolute', left: 15, bottom: 36, ...P3D}}>{stack}</div>
    </div>
  </div>
);

export const QualifyToday: React.FC<QualifyTodayProps> = ({eyebrow, today, after, gapLabel, durationInFrames, showSafeZones}) => {
  const {f, fps} = useTimeline(QUALIFY_TODAY_BASE, durationInFrames);
  const L = QUALIFY_TODAY_BASE;

  const both = today.value !== undefined && after.value !== undefined;
  const top = Math.max(today.value ?? 0, after.value ?? 0, 1);
  const vToday = today.value !== undefined ? countUp(f, 6, 30, 0, today.value) : 0;
  const vAfter = after.value !== undefined ? countUp(f, 28, 50, today.value ?? 0, after.value) : 0;
  const gap = both ? (after.value as number) - (today.value as number) : 0;

  // Seven digits or more ($1,000,000+) get a smaller size so they clear the cash stack.
  const amountSize = String(Math.round(top)).length >= 7 ? 94 : 116;
  const card = enter(f, fps, 4, 16);
  const rowToday = enter(f, fps, 6, 16);
  const rowAfter = enter(f, fps, 24, 16);

  // Stack heights follow the amounts as they count. With words instead of
  // numbers, the "after" stack is simply the taller one.
  const hToday = both ? (STACK_MAX * vToday) / top : STACK_MAX * 0.4 * enter(f, fps, 8, 22);
  const hBase = both ? (STACK_MAX * (today.value as number)) / top : STACK_MAX * 0.4;
  const hSlab = both ? Math.max(0, (STACK_MAX * (vAfter - (today.value as number))) / top) : STACK_MAX * 0.6 * enter(f, fps, 30, 22);
  const afterStackIn = enter(f, fps, 24, 12);

  return (
    <BrandFrame
      showSafeZones={showSafeZones}
      backdrop={
        <BackdropStage f={f} length={L}>
          <MoneyGutters f={f} mode="rise" count={10} seed="qualify-rise" size={[170, 250]} depth={[-800, -200]} opacity={0.5} blur={2.5} />
        </BackdropStage>
      }
    >
      <Stage3D f={f} length={L}>
        <Eyebrow text={eyebrow} progress={enter(f, fps, 0, 14)} />
        <div style={{height: 44}} />
        <Card3D enter={card} z={40} tilt={{rx: 2, ry: -3}} padding="26px 36px 26px 50px">
          <Row
            amount={today}
            color={COLORS.ink}
            progress={rowToday}
            number={today.value !== undefined ? <DollarCounter value={today.value} f={f} start={6} end={30} size={amountSize} /> : null}
            stack={<CashStack width={STACK_W} height={hToday} />}
          />
          <div style={{height: 2, background: COLORS.soft, margin: '6px 0'}} />
          <Row
            amount={after}
            color={COLORS.accent}
            progress={rowAfter}
            number={
              after.value !== undefined ? (
                <DollarCounter value={after.value} from={today.value ?? 0} f={f} start={28} end={50} size={amountSize} />
              ) : null
            }
            stack={
              <div style={{position: 'relative', opacity: afterStackIn, ...P3D}}>
                <CashStack width={STACK_W} height={hBase} />
                {hSlab > 0.5 ? (
                  <div style={{position: 'absolute', left: 0, top: 0, ...P3D}}>
                    <CashStack width={STACK_W} height={hSlab} base={hBase} tone="accent" strap={false} shadow={false} />
                  </div>
                ) : null}
              </div>
            }
          />
        </Card3D>
        {both && gapLabel && gap > 0 ? (
          <div
            style={{
              ...fadeUp(enter(f, fps, 46, 14), 18),
              marginTop: 46,
              display: 'inline-flex',
              alignItems: 'baseline',
              gap: 14,
              padding: '18px 30px',
              borderRadius: 999,
              background: '#EEF4FE',
              border: `2px solid ${COLORS.accentLine}`,
              boxShadow: '0 4px 0 -1px rgba(61,134,240,.22), 0 18px 36px rgba(61,134,240,.16)',
            }}
          >
            <span style={{fontSize: 46, fontWeight: 800, color: COLORS.accent, letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums'}}>
              {formatDollars(countUp(f, 48, 62, 0, gap))}
            </span>
            <span style={{fontSize: 38, fontWeight: 600, color: COLORS.ink2, letterSpacing: '-0.015em'}}>{gapLabel}</span>
          </div>
        ) : !both && gapLabel ? (
          <div
            style={{
              ...fadeUp(enter(f, fps, 46, 14), 18),
              marginTop: 50,
              padding: '18px 30px',
              borderRadius: 999,
              background: '#EEF4FE',
              border: `2px solid ${COLORS.accentLine}`,
              boxShadow: '0 4px 0 -1px rgba(61,134,240,.22), 0 18px 36px rgba(61,134,240,.16)',
              fontSize: 40,
              fontWeight: 700,
              color: COLORS.accent,
              letterSpacing: '-0.015em',
            }}
          >
            {gapLabel}
          </div>
        ) : null}
      </Stage3D>
    </BrandFrame>
  );
};
