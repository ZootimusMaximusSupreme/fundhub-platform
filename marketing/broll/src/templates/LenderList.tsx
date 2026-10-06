import React from 'react';
import {
  BackdropStage,
  BrandFrame,
  COLORS,
  Card3D,
  Coin,
  Decor,
  Eyebrow,
  GradientDash,
  MoneyGutters,
  P3D,
  Stage3D,
  TRACK,
  enter,
  fadeUp,
  useTimeline,
} from '../brand';

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
const DETAIL_WIDTHS = [0.42, 0.5, 0.36, 0.46, 0.4, 0.44];

/** A plain bank pictogram (no logo, no name) so a blank row still reads as a bank. */
const BankIcon: React.FC = () => (
  <div
    style={{
      flex: '0 0 auto',
      width: 60,
      height: 60,
      borderRadius: 16,
      background: 'linear-gradient(160deg, #FFFFFF, #F1F1F3)',
      border: `2px solid ${COLORS.line}`,
      boxShadow: '0 3px 0 -1px #DCDCE1',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}
  >
    <svg width={32} height={32} viewBox="0 0 24 24" fill="none" stroke={COLORS.gray2} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9.5 12 4l9 5.5" />
      <path d="M5 10.5v7M9.7 10.5v7M14.3 10.5v7M19 10.5v7" />
      <path d="M3 20h18" />
    </svg>
  </div>
);

export const LenderList: React.FC<LenderListProps> = ({eyebrow, headline, footer, rows, names, durationInFrames, showSafeZones}) => {
  const {f, fps} = useTimeline(LENDER_LIST_BASE, durationInFrames);
  const L = LENDER_LIST_BASE;
  const n = Math.max(3, Math.min(6, Math.round(rows)));
  const rowH = n >= 6 ? 76 : 86;
  const gap = n >= 6 ? 10 : 12;

  return (
    <BrandFrame
      showSafeZones={showSafeZones}
      backdrop={
        <BackdropStage f={f} length={L}>
          <MoneyGutters f={f} mode="drift" count={8} seed="lender-list" size={[160, 240]} depth={[-700, -150]} opacity={0.42} blur={2.5} />
        </BackdropStage>
      }
    >
      <Stage3D f={f} length={L}>
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
        <div style={{marginTop: 36, width: '100%', display: 'flex', flexDirection: 'column', gap, ...P3D}}>
          {Array.from({length: n}, (_, i) => {
            const p = enter(f, fps, 10 + i * 5, 14);
            const coin = enter(f, fps, 18 + i * 5, 14);
            const name = names[i];
            return (
              <Card3D
                key={i}
                enter={p}
                from="depth"
                z={30 + (n - i) * 4}
                tilt={{rx: 2}}
                elevation={0.7}
                radius={24}
                padding="0 26px"
                style={{display: 'flex', alignItems: 'center', gap: 24, height: rowH}}
              >
                <div
                  style={{
                    flex: '0 0 auto',
                    width: 56,
                    height: 56,
                    borderRadius: '50%',
                    background: 'radial-gradient(circle at 34% 30%, #7FB0F5 0%, #3D86F0 55%, #2F6CC4 100%)',
                    boxShadow: '0 4px 10px rgba(61,134,240,.28)',
                    color: COLORS.white,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 29,
                    fontWeight: 700,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {i + 1}
                </div>
                <BankIcon />
                {name ? (
                  <span style={{flex: 1, fontSize: 38, fontWeight: 600, letterSpacing: TRACK.body, color: COLORS.ink}}>{name}</span>
                ) : (
                  <div style={{flex: 1, display: 'flex', flexDirection: 'column', gap: 12}}>
                    <div style={{width: `${BAR_WIDTHS[i] * 100}%`, height: 20, borderRadius: 10, background: COLORS.line}} />
                    <div style={{width: `${DETAIL_WIDTHS[i] * 100}%`, height: 13, borderRadius: 7, background: COLORS.soft}} />
                  </div>
                )}
                <Decor>
                  <div style={{flex: '0 0 auto', opacity: coin, transform: `translateY(${(1 - coin) * -18}px) scale(${0.7 + 0.3 * coin})`}}>
                    <Coin size={54} spin={(1 - coin) * 200} tilt={{rx: 10}} />
                  </div>
                </Decor>
              </Card3D>
            );
          })}
        </div>
        {footer ? (
          <div
            style={{
              ...fadeUp(enter(f, fps, 44, 14), 16),
              marginTop: 32,
              display: 'flex',
              alignItems: 'center',
              gap: 18,
            }}
          >
            <GradientDash />
            <span style={{fontSize: 40, fontWeight: 700, letterSpacing: TRACK.body, color: COLORS.ink}}>{footer}</span>
          </div>
        ) : null}
      </Stage3D>
    </BrandFrame>
  );
};
