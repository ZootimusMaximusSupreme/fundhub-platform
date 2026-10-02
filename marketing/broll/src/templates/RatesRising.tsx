import React from 'react';
import {
  BrandFrame,
  COLORS,
  Card3D,
  CashStack,
  Decor,
  Eyebrow,
  P3D,
  Stage3D,
  Tag,
  TRACK,
  enter,
  fadeUp,
  progressBetween,
  useTimeline,
} from '../brand';

export type RatesRisingProps = {
  eyebrow: string;
  headline: string;
  subline: string | null;
  /** Chip at the tip of the line. */
  chipLabel: string;
  /** Headline size in px (default 104). Smaller keeps a longer line on one row. */
  headlineSize?: number;
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

// The chart is drawn in a 900 x 380 box and shown at 820 x 346 on the panel.
const VB_W = 900;
const VB_H = 380;
const W = 820;
const H = (W * VB_H) / VB_W;
const SX = W / VB_W;
const TIP = {x: 862, y: 58};
const LINE = `M 18 300 C 120 302, 190 286, 290 292 S 450 304, 540 276 S 690 196, 760 132 S 830 72, ${TIP.x} ${TIP.y}`;
const AREA = `${LINE} L ${TIP.x} ${VB_H - 30} L 18 ${VB_H - 30} Z`;
/** Copies of the line under it, each a little lower and darker: the line reads as a thick ribbon. */
const RIBBON = [8, 6, 4, 2];

export const RatesRising: React.FC<RatesRisingProps> = ({
  eyebrow,
  headline,
  subline,
  chipLabel,
  headlineSize = 104,
  durationInFrames,
  showSafeZones,
}) => {
  const {f, fps} = useTimeline(RATES_RISING_BASE, durationInFrames);
    const panel = enter(f, fps, 5, 16);
  const draw = progressBetween(f, 12, 50);
  const tip = enter(f, fps, 47, 10);
  const chip = enter(f, fps, 50, 12);
  const dash = {pathLength: 1, strokeDasharray: 1, strokeDashoffset: 1 - draw};
  // As the line climbs, the cash shrinks: money gets harder to get.
  const cash = 118 - 92 * progressBetween(f, 16, 54);
  const cashIn = enter(f, fps, 8, 14);

  return (
    <BrandFrame showSafeZones={showSafeZones}>
      <Stage3D f={f} length={RATES_RISING_BASE}>
        <Eyebrow text={eyebrow} progress={enter(f, fps, 0, 14)} />
        <div
          style={{
            ...fadeUp(enter(f, fps, 3, 14), 22),
            marginTop: 34,
            fontSize: headlineSize,
            fontWeight: 800,
            letterSpacing: TRACK.h1,
            lineHeight: 1.02,
            textAlign: 'center',
            textWrap: 'balance',
          }}
        >
          {headline}
        </div>
        <div style={{height: 40}} />
        <Card3D enter={panel} z={40} tilt={{rx: 6, ry: -10}} padding="22px 40px 22px 40px" width={W + 80} radius={34}>
          <div style={{position: 'relative', width: W, height: H}}>
            <svg width={W} height={H} viewBox={`0 0 ${VB_W} ${VB_H}`} style={{position: 'absolute', inset: 0, overflow: 'visible'}}>
              <defs>
                <linearGradient id="rates-area" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={COLORS.accent} stopOpacity={0.18} />
                  <stop offset="100%" stopColor={COLORS.accent} stopOpacity={0} />
                </linearGradient>
                <radialGradient id="rates-tip" cx="0.36" cy="0.3" r="0.75">
                  <stop offset="0%" stopColor="#FFFFFF" />
                  <stop offset="30%" stopColor="#A9C9F8" />
                  <stop offset="75%" stopColor={COLORS.accent} />
                  <stop offset="100%" stopColor="#2C67C2" />
                </radialGradient>
                <clipPath id="rates-reveal">
                  <rect x={0} y={-40} width={18 + (TIP.x - 18) * draw} height={VB_H + 80} />
                </clipPath>
              </defs>
              {[92, 186, 280].map((y) => (
                <line key={y} x1={0} x2={VB_W} y1={y} y2={y} stroke={COLORS.line} strokeWidth={2} strokeDasharray="10 12" />
              ))}
              <line x1={0} x2={VB_W} y1={VB_H - 30} y2={VB_H - 30} stroke={COLORS.track} strokeWidth={3} />
              <path d={AREA} fill="url(#rates-area)" clipPath="url(#rates-reveal)" />
              {/* soft shadow of the line on the panel */}
              <path d={LINE} transform="translate(0 22)" fill="none" stroke="rgba(10,10,10,.07)" strokeWidth={16} strokeLinecap="round" strokeLinejoin="round" {...dash} />
              {RIBBON.map((dy, i) => (
                <path
                  key={dy}
                  d={LINE}
                  transform={`translate(0 ${dy})`}
                  fill="none"
                  stroke={i < 2 ? '#2558A8' : '#2C67C2'}
                  strokeWidth={10}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  {...dash}
                />
              ))}
              <path d={LINE} fill="none" stroke={COLORS.accent} strokeWidth={10} strokeLinecap="round" strokeLinejoin="round" {...dash} />
              <path d={LINE} transform="translate(0 -2.5)" fill="none" stroke="rgba(255,255,255,.45)" strokeWidth={2.5} strokeLinecap="round" {...dash} />
              <circle cx={TIP.x} cy={TIP.y} r={34 * tip} fill={COLORS.accent} opacity={0.13} />
              <circle cx={TIP.x} cy={TIP.y + 6} r={17 * tip} fill="rgba(10,10,10,.12)" />
              <circle cx={TIP.x} cy={TIP.y} r={17 * tip} fill="url(#rates-tip)" />
            </svg>
            <Decor>
              <div style={{position: 'absolute', left: 54, top: 70, opacity: cashIn, ...P3D}}>
                <CashStack width={176} height={cash} />
              </div>
            </Decor>
            <div
              style={{
                position: 'absolute',
                right: 104 * SX,
                top: (TIP.y - 30) * SX,
                opacity: chip,
                transform: `translateX(${(1 - chip) * 16}px)`,
              }}
            >
              <Tag text={`↑ ${chipLabel}`} tone="info" size={26} dot={false} style={{background: '#EEF4FE', boxShadow: '0 3px 0 -1px rgba(61,134,240,.25), 0 10px 20px rgba(61,134,240,.14)'}} />
            </div>
          </div>
        </Card3D>
        {subline ? (
          <div
            style={{
              ...fadeUp(enter(f, fps, 55, 14), 18),
              marginTop: 40,
              maxWidth: 860,
              textWrap: 'balance',
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
      </Stage3D>
    </BrandFrame>
  );
};
