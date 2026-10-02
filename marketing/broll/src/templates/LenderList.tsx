import React from 'react';
import {BrandFrame, COLORS, Eyebrow, GradientDash, TRACK, enter, fadeRight, fadeUp, useTimeline} from '../brand';

export type LenderListProps = {
  eyebrow: string;
  headline: string;
  footer: string | null;
  /** How many rows to show (3 to 6). */
  rows: number;
  /**
   * Real bank names, only when a shot list takes them from a real source (the
   * script line or the /roadmap sample client). Empty means blank name bars,
   * which is the default: the kit never makes up a lender.
   */
  names: string[];
  durationInFrames?: number;
  showSafeZones?: boolean;
};

export const LENDER_LIST_BASE = 75;
export const LENDER_LIST_HERO = 72;

// Words from /roadmap step 05: "Your list shows the banks that approve files
// like yours. Apply in that order". Card name is the deliverable's name.
export const lenderListDefaults: LenderListProps = {
  eyebrow: 'Bank & Lender Match List',
  headline: 'The banks that approve files like yours',
  footer: 'Apply in that order',
  rows: 5,
  names: [],
};

const BAR_WIDTHS = [0.74, 0.6, 0.68, 0.54, 0.64, 0.58];

/** A plain bank pictogram (no logo, no name) so a blank row still reads as a bank. */
const BankIcon: React.FC = () => (
  <div
    style={{
      flex: '0 0 auto',
      width: 64,
      height: 64,
      borderRadius: 16,
      background: COLORS.soft,
      border: `2px solid ${COLORS.line}`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}
  >
    <svg width={34} height={34} viewBox="0 0 24 24" fill="none" stroke={COLORS.gray2} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9.5 12 4l9 5.5" />
      <path d="M5 10.5v7M9.7 10.5v7M14.3 10.5v7M19 10.5v7" />
      <path d="M3 20h18" />
    </svg>
  </div>
);
const DETAIL_WIDTHS = [0.42, 0.5, 0.36, 0.46, 0.4, 0.44];

export const LenderList: React.FC<LenderListProps> = ({eyebrow, headline, footer, rows, names, durationInFrames, showSafeZones}) => {
  const {f, fps} = useTimeline(LENDER_LIST_BASE, durationInFrames);
  const n = Math.max(3, Math.min(6, Math.round(rows)));

  return (
    <BrandFrame showSafeZones={showSafeZones}>
      <Eyebrow text={eyebrow} progress={enter(f, fps, 0, 14)} />
      <div
        style={{
          ...fadeUp(enter(f, fps, 3, 14), 20),
          marginTop: 30,
          maxWidth: 860,
          textWrap: 'balance',
          fontSize: 62,
          fontWeight: 700,
          letterSpacing: TRACK.h2,
          lineHeight: 1.1,
          textAlign: 'center',
        }}
      >
        {headline}
      </div>
      <div
        style={{
          ...fadeUp(enter(f, fps, 10, 14), 26),
          marginTop: 40,
          width: '100%',
          background: COLORS.white,
          border: `2px solid ${COLORS.line}`,
          borderRadius: 30,
          boxShadow: '0 30px 70px rgba(10,10,10,.08), 0 4px 14px rgba(10,10,10,.04)',
          padding: '10px 40px',
        }}
      >
        {Array.from({length: n}, (_, i) => {
          const p = enter(f, fps, 14 + i * 5, 12);
          const name = names[i];
          return (
            <div
              key={i}
              style={{
                ...fadeRight(p, 30),
                display: 'flex',
                alignItems: 'center',
                gap: 26,
                height: 94,
                borderBottom: i < n - 1 ? `2px solid ${COLORS.soft}` : 'none',
              }}
            >
              <div
                style={{
                  flex: '0 0 auto',
                  width: 58,
                  height: 58,
                  borderRadius: '50%',
                  background: COLORS.accent,
                  color: COLORS.white,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 30,
                  fontWeight: 700,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {i + 1}
              </div>
              <BankIcon />
              {name ? (
                <span style={{fontSize: 40, fontWeight: 600, letterSpacing: TRACK.body, color: COLORS.ink}}>{name}</span>
              ) : (
                <div style={{flex: 1, display: 'flex', flexDirection: 'column', gap: 12}}>
                  <div style={{width: `${BAR_WIDTHS[i] * 100}%`, height: 20, borderRadius: 10, background: COLORS.line}} />
                  <div style={{width: `${DETAIL_WIDTHS[i] * 100}%`, height: 13, borderRadius: 7, background: COLORS.soft}} />
                </div>
              )}
            </div>
          );
        })}
      </div>
      {footer ? (
        <div
          style={{
            ...fadeUp(enter(f, fps, 44, 14), 16),
            marginTop: 36,
            display: 'flex',
            alignItems: 'center',
            gap: 18,
          }}
        >
          <GradientDash />
          <span style={{fontSize: 40, fontWeight: 700, letterSpacing: TRACK.body, color: COLORS.ink}}>{footer}</span>
        </div>
      ) : null}
    </BrandFrame>
  );
};
