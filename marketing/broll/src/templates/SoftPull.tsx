import React from 'react';
import {
  BackdropStage,
  BrandFrame,
  COLORS,
  Eyebrow,
  GroundShadow,
  MoneyGutters,
  P3D,
  Stage3D,
  Tag,
  TRACK,
  enter,
  fadeUp,
  progressBetween,
  useTimeline,
} from '../brand';

export type SoftPullProps = {
  eyebrow: string;
  /**
   * The score on the gauge. It never moves: that is the point of the clip.
   * Null shows no number at all (use it when the script line says no score);
   * `scoreLabel` then sits large in the middle of the gauge.
   */
  score: number | null;
  scoreLabel: string;
  headline: string;
  chip: string;
  durationInFrames?: number;
  showSafeZones?: boolean;
};

export const SOFT_PULL_BASE = 75;
export const SOFT_PULL_HERO = 72;

// Words from the close on the locked ads and the 9/30 VSL: "We pull your credit
// with a soft inquiry, so your score doesn't move" / "zero impact on your score".
// 762 is the /roadmap sample client's middle score (762 / 770 / 758).
export const softPullDefaults: SoftPullProps = {
  eyebrow: 'Soft pull only',
  score: 762,
  scoreLabel: 'Credit score',
  headline: 'Zero impact on your score.',
  chip: "Score doesn't move",
};

/** Where the marker sits when no score is given: a picture, not a value. */
const NO_SCORE_AT = 0.78;
const MIN = 300;
const MAX = 850;
const W = 780;
const R = 330;
const STROKE = 34;
const DEPTH_PX = 12; // how thick the dial band looks
const CX = W / 2;
const CY = R + STROKE;
const H = CY + DEPTH_PX + 10;

const polar = (t: number) => {
  const a = Math.PI * (1 - t); // t=0 left, t=1 right
  return {x: CX + R * Math.cos(a), y: CY - R * Math.sin(a)};
};
const arc = (t0: number, t1: number) => {
  const a = polar(t0);
  const b = polar(t1);
  return `M ${a.x} ${a.y} A ${R} ${R} 0 0 1 ${b.x} ${b.y}`;
};

export const SoftPull: React.FC<SoftPullProps> = ({eyebrow, score, scoreLabel, headline, chip, durationInFrames, showSafeZones}) => {
  const {f, fps} = useTimeline(SOFT_PULL_BASE, durationInFrames);
  const L = SOFT_PULL_BASE;
  const t = score === null ? NO_SCORE_AT : Math.max(0, Math.min(1, (score - MIN) / (MAX - MIN)));
  const gauge = enter(f, fps, 2, 16);
  const num = enter(f, fps, 6, 12);
  const scan = progressBetween(f, 18, 46);
  const scanOn = scan > 0 && scan < 1 ? 1 : 0;
  const marker = polar(t);
  const pulse = Math.max(0, 1 - Math.abs(scan - t) * 6) * scanOn;

  return (
    <BrandFrame
      showSafeZones={showSafeZones}
      backdrop={
        <BackdropStage f={f} length={L}>
          <MoneyGutters f={f} mode="drift" count={8} seed="soft-pull" size={[160, 240]} depth={[-800, -250]} opacity={0.42} blur={3} speed={0.6} />
        </BackdropStage>
      }
    >
      <Stage3D f={f} length={L}>
        <Eyebrow text={eyebrow} progress={enter(f, fps, 0, 14)} />
        <div
          style={{
            position: 'relative',
            width: W,
            height: H,
            marginTop: 50,
            ...P3D,
            transform: `translate3d(0, ${(1 - gauge) * 30}px, ${30 - (1 - gauge) * 300}px) rotateX(${12 + (1 - gauge) * 14}deg)`,
          }}
        >
          <GroundShadow width={W * 0.9} height={70} strength={0.1} style={{position: 'absolute', left: W * 0.05, top: CY - 28, opacity: gauge, transform: 'translateZ(-30px)'}} />
          <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{position: 'absolute', inset: 0, overflow: 'visible', opacity: gauge}}>
            <defs>
              <linearGradient id="soft-scan" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor={COLORS.white} stopOpacity={0} />
                <stop offset="50%" stopColor={COLORS.white} stopOpacity={0.8} />
                <stop offset="100%" stopColor={COLORS.white} stopOpacity={0} />
              </linearGradient>
              <radialGradient id="soft-knob" cx="0.36" cy="0.3" r="0.75">
                <stop offset="0%" stopColor="#FFFFFF" />
                <stop offset="60%" stopColor="#F4F4F5" />
                <stop offset="100%" stopColor="#D4D4D8" />
              </radialGradient>
              {/* the scan only lights the arc, never the space around it */}
              <mask id="soft-arc" maskUnits="userSpaceOnUse" x={0} y={0} width={W} height={H}>
                <path d={arc(0, 1)} fill="none" stroke="#FFFFFF" strokeWidth={STROKE} strokeLinecap="round" />
              </mask>
            </defs>
            {/* the band's thickness: the same arcs, lower and darker */}
            {[DEPTH_PX, DEPTH_PX * 0.66, DEPTH_PX * 0.33].map((dy) => (
              <React.Fragment key={dy}>
                <path d={arc(0, 1)} transform={`translate(0 ${dy})`} fill="none" stroke="#CDCDD3" strokeWidth={STROKE} strokeLinecap="round" />
                <path d={arc(0, t)} transform={`translate(0 ${dy})`} fill="none" stroke="#2558A8" strokeWidth={STROKE} strokeLinecap="round" />
              </React.Fragment>
            ))}
            <path d={arc(0, 1)} fill="none" stroke={COLORS.line} strokeWidth={STROKE} strokeLinecap="round" />
            <path d={arc(0, t)} fill="none" stroke={COLORS.accent} strokeWidth={STROKE} strokeLinecap="round" />
            {/* a thin highlight along the top edge of the band */}
            <path d={arc(0.005, 0.995)} transform="translate(0 -11)" fill="none" stroke="rgba(255,255,255,.55)" strokeWidth={3} strokeLinecap="round" />
            {scanOn ? (
              <rect x={-60 + (W + 120) * scan - 90} y={0} width={180} height={H} fill="url(#soft-scan)" mask="url(#soft-arc)" />
            ) : null}
            <circle cx={marker.x} cy={marker.y + 8} r={27 + 8 * pulse} fill="rgba(10,10,10,.14)" />
            <circle cx={marker.x} cy={marker.y} r={26 + 8 * pulse} fill="url(#soft-knob)" stroke={COLORS.accent} strokeWidth={8} />
          </svg>
          <div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: CY - 250,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              opacity: num,
              transform: 'translateZ(24px)',
            }}
          >
            {score === null ? (
              <div style={{marginTop: 118, fontSize: 86, fontWeight: 800, letterSpacing: TRACK.h1, lineHeight: 1, whiteSpace: 'nowrap'}}>
                {scoreLabel}
              </div>
            ) : (
              <>
                <div style={{fontSize: 190, fontWeight: 800, letterSpacing: '-0.05em', lineHeight: 1, fontVariantNumeric: 'tabular-nums'}}>
                  {score}
                </div>
                <div
                  style={{
                    marginTop: 10,
                    fontSize: 28,
                    fontWeight: 600,
                    letterSpacing: '0.14em',
                    textTransform: 'uppercase',
                    color: COLORS.gray2,
                  }}
                >
                  {scoreLabel}
                </div>
              </>
            )}
          </div>
        </div>
        <div style={{...fadeUp(enter(f, fps, 44, 12), 14), marginTop: 46}}>
          <Tag text={chip} tone="ok" size={28} style={{boxShadow: '0 3px 0 -1px #CFE3D4, 0 12px 22px rgba(62,142,88,.12)'}} />
        </div>
        <div
          style={{
            ...fadeUp(enter(f, fps, 50, 14), 18),
            marginTop: 34,
            fontSize: 68,
            fontWeight: 800,
            letterSpacing: TRACK.h2,
            lineHeight: 1.08,
            textAlign: 'center',
          }}
        >
          {headline}
        </div>
      </Stage3D>
    </BrandFrame>
  );
};
