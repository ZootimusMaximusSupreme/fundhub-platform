import React from 'react';
import {interpolate} from 'remotion';
import {
  BackdropStage,
  BrandFrame,
  COLORS,
  Eyebrow,
  MoneyGutters,
  P3D,
  Stage3D,
  TRACK,
  enter,
  fadeUp,
  useTimeline,
} from '../brand';

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

const BOX_W = 900;
const BOX_H = 360;
const RADIUS = 330; // orbit radius, in the ring's own plane
const RING = RADIUS * 2 + 60;
const TILT = 63; // the orbit lies back like a ring around a planet (the camera adds about 4 degrees)
const DOT = 36;

/** A glossy dot; lit is accent blue, unlit is pale gray. */
const Dot: React.FC<{p: number}> = ({p}) => {
  const lit = p > 0.5;
  return (
    <div
      style={{
        width: DOT,
        height: DOT,
        borderRadius: '50%',
        background: lit
          ? 'radial-gradient(circle at 34% 30%, #FFFFFF 0%, #A9C9F8 22%, #3D86F0 62%, #2C67C2 100%)'
          : 'radial-gradient(circle at 34% 30%, #FFFFFF 0%, #F1F1F3 35%, #D4D4D8 100%)',
        boxShadow: `0 0 0 ${12 * p}px rgba(61,134,240,${0.13 * p}), 0 10px 18px rgba(10,10,10,.12)`,
        transform: `scale(${0.82 + 0.18 * p})`,
      }}
    />
  );
};

export const HiddenDataPoints: React.FC<HiddenDataPointsProps> = ({eyebrow, count, label, subline, durationInFrames, showSafeZones}) => {
  const {f, fps} = useTimeline(HIDDEN_DATA_POINTS_BASE, durationInFrames);
  const L = HIDDEN_DATA_POINTS_BASE;
  const n = Math.max(1, Math.min(24, Math.round(count)));
  const ringIn = enter(f, fps, 3, 14);
  const step = 34 / n; // all dots light between frame 12 and 46
  const lit = Array.from({length: n}, (_, i) => enter(f, fps, 12 + i * step, 8));
  const litCount = Math.max(1, lit.filter((p) => p > 0.5).length); // shows from 1 as the first dot lights
  // The orbit turns slowly the whole clip; lighting starts at the front.
  const spin = interpolate(f, [0, L], [-24, 18]);

  return (
    <BrandFrame
      showSafeZones={showSafeZones}
      backdrop={
        <BackdropStage f={f} length={L}>
          <MoneyGutters f={f} mode="drift" count={10} gutter={240} seed="data-points" size={[160, 240]} depth={[-700, -150]} opacity={0.55} blur={2.5} />
        </BackdropStage>
      }
    >
      <Stage3D f={f} length={L}>
        <Eyebrow text={eyebrow} progress={enter(f, fps, 0, 14)} />
        <div style={{height: 40}} />
        <div style={{position: 'relative', width: BOX_W, height: BOX_H, ...P3D}}>
          <div
            style={{
              position: 'absolute',
              left: (BOX_W - RING) / 2,
              top: (BOX_H - RING) / 2,
              width: RING,
              height: RING,
              ...P3D,
              transform: `rotateX(${TILT}deg) rotateZ(${spin}deg) scale(${0.9 + 0.1 * ringIn})`,
            }}
          >
            <svg width={RING} height={RING} style={{position: 'absolute', inset: 0, opacity: ringIn}}>
              <circle cx={RING / 2} cy={RING / 2} r={RADIUS} fill="none" stroke={COLORS.track} strokeWidth={3} />
              <circle cx={RING / 2} cy={RING / 2} r={RADIUS - 26} fill="none" stroke={COLORS.line} strokeWidth={2} strokeDasharray="4 10" />
            </svg>
            {lit.map((p, i) => {
              const a = (90 + (i * 360) / n) * (Math.PI / 180); // 90 = the front of the orbit
              const x = RING / 2 + RADIUS * Math.cos(a) - DOT / 2;
              const y = RING / 2 + RADIUS * Math.sin(a) - DOT / 2;
              return (
                <div
                  key={i}
                  style={{
                    position: 'absolute',
                    left: x,
                    top: y,
                    opacity: ringIn,
                    // turn back to face the camera
                    transform: `rotateZ(${-spin}deg) rotateX(${-TILT}deg)`,
                  }}
                >
                  <Dot p={p} />
                </div>
              );
            })}
          </div>
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 236,
              fontWeight: 800,
              letterSpacing: '-0.06em',
              lineHeight: 1,
              color: COLORS.ink,
              fontVariantNumeric: 'tabular-nums',
              paddingRight: 12,
              paddingBottom: 26,
              opacity: lit[0],
              textShadow: '0 22px 40px rgba(10,10,10,.12)',
            }}
          >
            {litCount}
          </div>
        </div>
        <div style={{height: 26}} />
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
      </Stage3D>
    </BrandFrame>
  );
};
