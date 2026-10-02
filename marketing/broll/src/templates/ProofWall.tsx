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
  TAG,
  TRACK,
  enter,
  fadeUp,
  formatDollars,
} from '../brand';
import {PROOF_APPROVALS, type ProofApproval} from './proofWallApprovals';

// ProofWall: the real client approvals turn past on a 3D carousel of floating
// screens. Each screen is one approval picture exactly as it is (the branded
// win card from marketing/landing-pages/slo/client-wins/deck, copied to
// public/proof-wall/ by scripts/proof-wall-approvals.py). Built to read on a
// phone: few approvals per clip, each one held in front about a second, the
// front screen big and square to the camera, the side screens pushed back,
// dimmed and softened. A chip pinned to the front screen repeats its amount and
// lender from that picture's manifest entry (the figure read off the picture),
// never anything else. No name or face is added. Under the carousel the proof lines build up: "A
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
  /** 1 = three approvals in front, each held about a second (two turns). 1.5 = three turns, 2 = four turns (shorter holds). */
  speed: number;
  /** 90 to 120 frames (3 to 4 seconds). Default 120. */
  durationInFrames?: number;
  showSafeZones?: boolean;
};

export const PROOF_WALL_BASE = 120;
/** The frame where the last approval has landed in front with the last proof line. */
export const PROOF_WALL_HERO = 112;
const MIN_FRAMES = 90;
const MAX_FRAMES = 120;

export const clampProofWall = (frames: number | undefined): number =>
  Math.min(MAX_FRAMES, Math.max(MIN_FRAMES, Math.round(frames ?? PROOF_WALL_BASE)));

// Default carousel: crisp approvals that each print their amount and whose
// manifest entry names the lender, none of them needing a blur. In front, in
// order: $15,000 FNBO -> $50,000 KeyBank -> $74,000 Chase. The rest are the
// dimmed neighbors at the sides (and the next ones in front at a higher speed).
export const proofWallDefaults: ProofWallProps = {
  eyebrow: 'Client approvals',
  approvals: [
    'win-15000-fnbo',
    'win-50000-keybank',
    'win-74000-chase',
    'win-20000-truist',
    'win-16000-bankunited',
    'win-12000-bank-of-america-2',
  ],
  proofLines: ['A decade', 'Hundreds of files', 'Thousands of data points', 'A little over a million dollars funded for myself'],
  speed: 1,
};

/** Every screen is fitted (whole picture, never cropped) inside this box. */
const BOX = {w: 470, h: 510};
/** Degrees between neighboring screens on the ring, and the ring's radius. Wide spacing pushes the side screens out to the frame edges. */
const STEP = 40;
const RADIUS = 900;
/** The screen in front grows a little and comes forward. */
const FRONT_SCALE = 1.06;
const FRONT_Z = 30;
const RING_H = 548;
const LINE_BOX_H = 166;
/** Timing, in frames: the entrance, then each turn. Holds share what is left. */
const ENTRANCE = 16;
const TURN = 14;
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

/** On-screen size of a picture fitted inside BOX. */
const fit = (a: ProofApproval) => {
  const s = Math.min(BOX.w / a.width, BOX.h / a.height);
  return {w: a.width * s, h: a.height * s};
};

/** The manifest's lender, without a product note in brackets: "Chase (Ink Business Unlimited card)" -> "Chase". */
const lenderLabel = (a: ProofApproval): string | null => (a.lender ? a.lender.replace(/\s*\(.*\)\s*$/, '') : null);

/** One line for a short lender name; two even lines for a long one ("American Express and / Bank of America"). */
const lenderLines = (name: string): string[] => {
  if (name.length <= 24) return [name];
  const words = name.split(' ');
  let best = [name];
  let bestLen = Infinity;
  for (let k = 1; k < words.length; k++) {
    const a = words.slice(0, k).join(' ');
    const b = words.slice(k).join(' ');
    const m = Math.max(a.length, b.length);
    if (m < bestLen) {
      bestLen = m;
      best = [a, b];
    }
  }
  return best;
};
const turnEase = Easing.bezier(0.65, 0, 0.3, 1);

/** One floating screen: the approval picture with a lit edge, real thickness and a soft shadow. */
const Screen: React.FC<{a: ProofApproval; theta: number; alpha: number; bob: number}> = ({a, theta, alpha, bob}) => {
  const {w, h} = fit(a);
  const r = w * CARD_RADIUS_RATIO;
  // 0 = in front, 1 = at a side position.
  const side = clamp01(Math.abs(theta) / STEP);
  const near = 1 - side;
  const scale = 1 + (FRONT_SCALE - 1) * near;
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
        transform: `rotateY(${theta}deg) translateZ(${RADIUS + FRONT_Z * near}px) translateY(${bob * side}px) scale(${scale})`,
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
      <div style={{...face, opacity: alpha, filter: side > 0.05 ? `blur(${(2.4 * side).toFixed(2)}px)` : undefined}}>
        <Img src={staticFile(`proof-wall/${a.id}.png`)} style={{display: 'block', width: '100%', height: '100%'}} />
        {/* Side screens fade back toward the page (a pale veil) so the front one wins. */}
        <div style={{position: 'absolute', inset: 0, borderRadius: r, background: `rgba(252,252,252,${(0.55 * side).toFixed(3)})`}} />
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

  // The ring turns in steps: a quick smooth turn, then a long hold with one
  // approval square to the camera. Holds share whatever the turns leave.
  const turns = Math.max(1, Math.round(2 * Math.max(0.5, speed)));
  const hold = (L - ENTRANCE - turns * TURN) / (turns + 1);
  const turnAt = (k: number) => ENTRANCE + hold + k * (hold + TURN);
  let rot = 0;
  for (let k = 0; k < turns; k++) rot += turnEase(clamp01((f - turnAt(k)) / TURN));

  // Entrance: the ring comes forward out of the wall while it spins into place.
  const inP = enter(f, fps, 0, 18);
  rot -= (1 - inP) * 0.6;
  const ringZ = -520 * (1 - inP);

  const screens: React.ReactNode[] = [];
  const first = Math.floor(rot) - 2;
  for (let i = first; i <= first + 5; i++) {
    const theta = (i - rot) * STEP;
    if (Math.abs(theta) > 84) continue;
    const a = list[((i % n) + n) % n];
    const alpha = clamp01(1 - (Math.abs(theta) - 50) / 26) * clamp01(inP * 1.4);
    const bob = Math.sin(f * 0.07 + i * 1.7) * 6;
    screens.push(<Screen key={i} a={a} theta={theta} alpha={alpha} bob={bob} />);
  }

  // The chip on the front screen: its amount and lender from the manifest. It
  // shows while that screen is settled in front and fades as the turn starts.
  const frontIdx = Math.round(rot);
  const front = list[((frontIdx % n) + n) % n];
  const chipOn = clamp01(1 - Math.abs(frontIdx - rot) / 0.16) * clamp01((inP - 0.85) / 0.15);
  const frontH = fit(front).h * FRONT_SCALE;
  const frontLender = lenderLabel(front);

  // Proof lines build up and stay: every line but the last pops in as a small
  // chip, one after another; the last line lands big under them and holds.
  const lines = proofLines.filter((t) => t.trim().length > 0);
  const chips = lines.slice(0, -1);
  const lead = lines.length > 0 ? lines[lines.length - 1] : null;
  const LAST_AT = 72;
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
      <Stage3D f={f} length={L} drift={0.6}>
        <Eyebrow text={eyebrow} progress={enter(f, fps, 0, 14)} />
        <div style={{height: 14}} />
        <div style={{position: 'relative', width: 900, height: RING_H, ...P3D}}>
          <GroundShadow
            width={600}
            height={70}
            strength={0.12 * inP}
            style={{position: 'absolute', left: 150, top: RING_H - 30}}
          />
          <div
            style={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              ...P3D,
              transform: `translateZ(${-RADIUS + ringZ}px)`,
            }}
          >
            {screens}
          </div>
          {chipOn > 0.004 ? (
            <div
              style={{
                position: 'absolute',
                left: '50%',
                // Pinned over the screen's footer strip (the card's rule and wordmark), not its screenshot.
                top: RING_H / 2 + frontH / 2 - Math.min(70, frontH * 0.11 + 12),
                opacity: chipOn,
                transform: `translateX(-50%) translateY(${(1 - chipOn) * 14}px) translateZ(${FRONT_Z + 50}px)`,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 18,
                maxWidth: 860,
                padding: '14px 34px 14px 18px',
                borderRadius: 999,
                background: COLORS.white,
                ...CARD_EDGE,
                boxShadow: '0 4px 0 -1px #DCDCE1, 0 16px 34px rgba(10,10,10,.12)',
                whiteSpace: 'nowrap',
              }}
            >
              <svg width={52} height={52} viewBox="0 0 52 52" style={{flex: '0 0 auto', display: 'block'}}>
                <circle cx={26} cy={26} r={26} fill={TAG.ok.fg} />
                <path d="M15 26.5 L22.5 34 L37.5 19" fill="none" stroke="#FFFFFF" strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span style={{fontSize: 66, fontWeight: 800, letterSpacing: TRACK.num, color: COLORS.ink, lineHeight: 1.08, fontVariantNumeric: 'tabular-nums'}}>
                {front.amount !== null ? formatDollars(front.amount) : 'Approved'}
              </span>
              {frontLender ? (
                <>
                  <span style={{flex: '0 0 auto', width: 2, height: 46, background: COLORS.line}} />
                  <span
                    style={{
                      flex: '0 0 auto',
                      display: 'flex',
                      flexDirection: 'column',
                      fontSize: frontLender.length > 14 ? 32 : 40,
                      fontWeight: 600,
                      letterSpacing: TRACK.body,
                      color: COLORS.gray,
                      lineHeight: 1.05,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {lenderLines(frontLender).map((line) => (
                      <span key={line}>{line}</span>
                    ))}
                  </span>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
        <div style={{height: 40}} />
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
                ...fadeUp(enter(f, fps, revealAt(lines.length - 1), 14), 14),
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
