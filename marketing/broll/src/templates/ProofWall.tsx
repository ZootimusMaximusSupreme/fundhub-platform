import React from 'react';
import {Composition, Easing, Img, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {
  BackdropStage,
  BrandFrame,
  CARD_EDGE,
  COLORS,
  Eyebrow,
  FRAME,
  GradientDash,
  GroundShadow,
  Layer,
  MoneyField,
  P3D,
  Stage3D,
  TRACK,
  enter,
  fadeUp,
} from '../brand';
import {PROOF_APPROVALS, type ProofApproval} from './proofWallApprovals';

// ProofWall: the real client approvals turn past on a 3D carousel of floating
// screens. Each screen is one approval picture exactly as it is (the branded
// win card from marketing/landing-pages/slo/client-wins/deck, copied to
// public/proof-wall/ by scripts/proof-wall-approvals.py). The amount on a screen
// is the one printed in that picture; this template adds no amount, lender,
// name or face of its own. Under the carousel the proof lines build up: "A
// decade", "Hundreds of files", "Thousands of data points" pop in as chips, then
// "A little over a million dollars funded for myself" lands big and holds.
// Bills drift behind the screens.

export type ProofWallProps = {
  eyebrow: string;
  /**
   * Approval ids from proofWallApprovals.ts, in carousel order. The first is in
   * front when the clip starts; the last ones sit just off to its left. "all"
   * uses all 40 in the manifest's order.
   */
  approvals: string[] | 'all';
  /**
   * Under the carousel. Every line but the last pops in as a small chip (keep those short: the
   * three default chips fill one row); the last line lands big under them and holds. One line =
   * just the big line.
   */
  proofLines: string[];
  /** 1 = four turns in the clip (a new approval in front about every 0.7 s). 1.5 = six turns. */
  speed: number;
  /** 90 to 120 frames (3 to 4 seconds). */
  durationInFrames?: number;
  showSafeZones?: boolean;
};

export const PROOF_WALL_BASE = 105;
/** The frame where the last approval has landed in front with the last proof line. */
export const PROOF_WALL_HERO = 94;
const MIN_FRAMES = 90;
const MAX_FRAMES = 120;

export const clampProofWall = (frames: number | undefined): number =>
  Math.min(MAX_FRAMES, Math.max(MIN_FRAMES, Math.round(frames ?? PROOF_WALL_BASE)));

// Default carousel: nine crisp approvals that each print their amount, none of
// them needing a blur. Front order climbs $20,000 -> $25,000 -> $50,000 ->
// $70,000 -> $74,000; the rest are the neighbors seen at the sides.
export const proofWallDefaults: ProofWallProps = {
  eyebrow: 'Client approvals',
  approvals: [
    'win-20000-truist',
    'win-25000-lender',
    'win-50000-keybank',
    'win-70000-lender',
    'win-74000-chase',
    'win-12000-bank-of-america-2',
    'win-10000-lender-2',
    'win-15000-fnbo',
    'win-16000-bankunited',
  ],
  proofLines: ['A decade', 'Hundreds of files', 'Thousands of data points', 'A little over a million dollars funded for myself'],
  speed: 1,
};

/** Every screen is fitted (whole picture, never cropped) inside this box. */
const BOX = {w: 440, h: 500};
/** Degrees between neighboring screens on the ring, and the ring's radius. */
const STEP = 32;
const RADIUS = 925;
const RING_H = 520;
const LINE_BOX_H = 190;
/** Thickness of a screen, px. */
const THICK = 12;
/** Corner radius of the win-card PNGs (32 px on a 1120 px wide card). */
const CARD_RADIUS_RATIO = 32 / 1120;

const BY_ID = new Map(PROOF_APPROVALS.map((a) => [a.id, a]));

const pick = (approvals: ProofWallProps['approvals']): ProofApproval[] => {
  if (approvals === 'all') return PROOF_APPROVALS;
  const list = approvals.map((id) => BY_ID.get(id)).filter((a): a is ProofApproval => Boolean(a));
  return list.length > 0 ? list : PROOF_APPROVALS;
};

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const turnEase = Easing.bezier(0.65, 0, 0.3, 1);

/** One floating screen: the approval picture with a lit edge, real thickness and a soft shadow. */
const Screen: React.FC<{a: ProofApproval; theta: number; alpha: number; bob: number}> = ({a, theta, alpha, bob}) => {
  const s = Math.min(BOX.w / a.width, BOX.h / a.height);
  const w = a.width * s;
  const h = a.height * s;
  const r = w * CARD_RADIUS_RATIO;
  const side = clamp01(Math.abs(theta) / 40);
  const face: React.CSSProperties = {position: 'absolute', inset: 0, borderRadius: r, backfaceVisibility: 'hidden'};
  return (
    <div
      style={{
        position: 'absolute',
        left: -w / 2,
        top: -h / 2,
        width: w,
        height: h,
        ...P3D,
        transform: `rotateY(${theta}deg) translateZ(${RADIUS}px) translateY(${bob}px)`,
      }}
    >
      {/* Thickness: two plates parallel to the picture, behind it. Parallel planes never cut through
          each other, so the browser always sorts them right (edge faces at right angles did not). */}
      <div style={{...face, background: '#DDE0E5', opacity: alpha, transform: `translateZ(${-THICK / 2}px)`}} />
      <div style={{...face, background: '#C9CDD4', opacity: alpha, transform: `translateZ(${-THICK}px)`}} />
      {/* The lift shadow is its own small plane behind the screen. A CSS box-shadow here reaches into the
          neighboring screens' space, and the browser then cuts a slice out of the screen when it sorts the planes. */}
      <div
        style={{
          position: 'absolute',
          left: -w * 0.05,
          top: h * 0.07,
          width: w * 1.1,
          height: h * 1.0,
          borderRadius: '50%',
          background: 'radial-gradient(closest-side, rgba(10,10,10,.17), rgba(10,10,10,.08) 62%, rgba(10,10,10,0))',
          opacity: alpha,
          transform: `translateZ(${-THICK - 8}px)`,
        }}
      />
      {/* No overflow clip on the face: the PNG already has its own rounded corners, and a clip mask breaks when the browser splits 3D planes. */}
      <div style={{...face, opacity: alpha}}>
        <Img src={staticFile(`proof-wall/${a.id}.png`)} style={{display: 'block', width: '100%', height: '100%'}} />
        {/* Screens turned away from the camera fall into a little shade. */}
        <div style={{position: 'absolute', inset: 0, borderRadius: r, background: `rgba(10,10,10,${(0.06 * side).toFixed(3)})`}} />
        {/* A soft glass glint that slides across as the screen turns. */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: r,
            background: 'linear-gradient(105deg, rgba(255,255,255,0) 38%, rgba(255,255,255,.34) 50%, rgba(255,255,255,0) 62%)',
            backgroundSize: '260% 100%',
            backgroundPosition: `${50 + theta * 1.6}% 0`,
            opacity: 0.55,
          }}
        />
      </div>
    </div>
  );
};

export const ProofWall: React.FC<ProofWallProps> = ({eyebrow, approvals, proofLines, speed, durationInFrames, showSafeZones}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const L = PROOF_WALL_BASE;
  const f = (frame * L) / clampProofWall(durationInFrames);

  const list = pick(approvals);
  const n = list.length;

  // The ring turns in steps: a smooth turn, then a short hold with one approval in front.
  const turns = Math.max(1, Math.round(4 * Math.max(0.25, speed)));
  const T0 = 14;
  const T1 = L - 8;
  const D = (T1 - T0) / turns;
  const turnLen = D * 0.62;
  let rot = 0;
  for (let k = 0; k < turns; k++) rot += turnEase(clamp01((f - T0 - k * D) / turnLen));

  // Entrance: the ring comes forward out of the wall while it spins into place.
  const inP = enter(f, fps, 0, 20);
  rot -= (1 - inP) * 0.8;
  const ringZ = -520 * (1 - inP);

  const screens: React.ReactNode[] = [];
  const first = Math.floor(rot) - 3;
  for (let i = first; i <= first + 7; i++) {
    const theta = (i - rot) * STEP;
    if (Math.abs(theta) > 84) continue;
    const a = list[((i % n) + n) % n];
    const alpha = clamp01(1 - (Math.abs(theta) - 50) / 26) * clamp01(inP * 1.4);
    const bob = Math.sin(f * 0.07 + i * 1.7) * 5;
    screens.push(<Screen key={i} a={a} theta={theta} alpha={alpha} bob={bob} />);
  }

  // Proof lines build up and stay: every line but the last pops in as a small
  // chip, one after another; the last line lands big under them and holds.
  const lines = proofLines.filter((t) => t.trim().length > 0);
  const chips = lines.slice(0, -1);
  const lead = lines.length > 0 ? lines[lines.length - 1] : null;
  const LAST_AT = 64;
  const revealAt = (j: number) => (lines.length <= 1 ? 6 : 4 + (j * (LAST_AT - 4)) / (lines.length - 1));

  return (
    <BrandFrame
      showSafeZones={showSafeZones}
      backdrop={
        <BackdropStage f={f} length={L}>
          <MoneyField
            f={f}
            mode="drift"
            count={13}
            seed="proof-wall-bills"
            area={{x: 20, y: 470, w: 1040, h: 620}}
            size={[180, 260]}
            depth={[-950, -300]}
            opacity={0.5}
            blur={2.5}
            appear={enter(f, fps, 2, 18)}
          />
        </BackdropStage>
      }
    >
      <Stage3D f={f} length={L}>
        <Eyebrow text={eyebrow} progress={enter(f, fps, 0, 14)} />
        <div style={{height: 22}} />
        <div style={{position: 'relative', width: 900, height: RING_H, ...P3D}}>
          <GroundShadow
            width={560}
            height={64}
            strength={0.12 * inP}
            style={{position: 'absolute', left: 170, top: RING_H - 26}}
          />
          <div
            style={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              ...P3D,
              transform: `translateZ(${-RADIUS + ringZ}px) rotateX(-2deg)`,
            }}
          >
            {screens}
          </div>
        </div>
        <div style={{height: 16}} />
        <Layer
          z={24}
          style={{position: 'relative', width: 900, height: LINE_BOX_H, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16}}
        >
          {chips.length > 0 ? (
            <div style={{display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 10}}>
              {chips.map((text, j) => {
                const p = enter(f, fps, revealAt(j), 12);
                return (
                  <div
                    key={j}
                    style={{
                      opacity: p,
                      transform: `translateY(${(1 - p) * 18}px) scale(${0.92 + 0.08 * p})`,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '10px 18px',
                      borderRadius: 999,
                      background: COLORS.white,
                      ...CARD_EDGE,
                      boxShadow: '0 3px 0 -1px #DCDCE1, 0 10px 22px rgba(10,10,10,.07)',
                      fontSize: 25,
                      fontWeight: 600,
                      letterSpacing: TRACK.body,
                      color: COLORS.ink2,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    <GradientDash size="bullet" grow={p} />
                    {text}
                  </div>
                );
              })}
            </div>
          ) : null}
          {lead ? (
            <div
              style={{
                ...fadeUp(enter(f, fps, revealAt(lines.length - 1), 14), 24),
                maxWidth: 860,
                textAlign: 'center',
                fontSize: 44,
                fontWeight: 700,
                letterSpacing: TRACK.h2,
                lineHeight: 1.12,
                color: COLORS.ink,
                textWrap: 'balance',
              }}
            >
              {lead}
            </div>
          ) : null}
        </Layer>
      </Stage3D>
    </BrandFrame>
  );
};

/** Registered in Root.tsx. Its own composition because it runs 3 to 4 seconds, longer than the kit's 2 to 3. */
export const ProofWallComposition: React.FC = () => (
  <Composition
    id="ProofWall"
    component={ProofWall}
    durationInFrames={PROOF_WALL_BASE}
    fps={FRAME.fps}
    width={FRAME.width}
    height={FRAME.height}
    defaultProps={proofWallDefaults}
    calculateMetadata={({props}) => ({durationInFrames: clampProofWall(props.durationInFrames)})}
  />
);
