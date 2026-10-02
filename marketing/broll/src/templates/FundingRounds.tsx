import React from 'react';
import {AbsoluteFill} from 'remotion';
import {
  BILL_ASPECT,
  BackdropStage,
  BrandFrame,
  COLORS,
  CONTENT,
  CONTENT_WIDTH,
  CashStack,
  DEPTH,
  Decor,
  DollarCounter,
  Eyebrow,
  MoneyField,
  P3D,
  STAGE_CENTER,
  Stage3D,
  TAG,
  TRACK,
  enter,
  fadeUp,
  progressBetween,
} from '../brand';
import {useClipTimeline} from './clipTimeline';

// A funding sequence that runs round by round (3 to 6 rounds). Each round
// lights up on the track and stacks another strapped bundle onto one cash
// tower while bills and coins pour down onto it; between rounds a
// hard-inquiries chip pops up, gets struck off and leaves before the next
// round lights. Every piece of loose money is masked to the tower area or the
// side gutters, so none of it ever sits on a word.
//
// Words from the 9/30 /watch VSL (P5-P6): "removing the hard inquiries
// between each funding round ... that's how a funding sequence keeps going for
// three to six rounds and builds into substantial capital."
//
// Rounds are written "Round 1", "Round 2" (never spelled out). No dollar
// figure shows unless `amounts` is passed in props.

export type FundingRoundsProps = {
  eyebrow: string;
  /** How many rounds run, 3 to 6. */
  rounds: number;
  /** Word in front of each round number: "Round" -> "Round 1". */
  roundLabel: string;
  /** The chip that comes off between rounds. */
  inquiryChip: string;
  /** Caption under the track: the struck words, then the rest of the line. */
  captionStruck: string;
  captionRest: string;
  /** Optional dollar figure per round (only from the script line, the page, the sample client or a real approval). */
  amounts?: number[] | null;
  durationInFrames?: number;
  showSafeZones?: boolean;
};

export const fundingRoundsDefaults: FundingRoundsProps = {
  eyebrow: 'Funding sequence',
  rounds: 4,
  roundLabel: 'Round',
  inquiryChip: 'Inquiries',
  captionStruck: 'Hard inquiries',
  captionRest: 'removed between rounds',
  amounts: null,
};

const clampRounds = (n: number): number => Math.min(6, Math.max(3, Math.round(Number.isFinite(n) ? n : 4)));

/** Default clip length grows with the rounds: 3 rounds 3.5 s, 4 rounds 3.67 s, 5 rounds 3.83 s, 6 rounds 4 s. */
export const fundingRoundsBase = (rounds: number): number => 90 + 5 * clampRounds(rounds);
export const FUNDING_ROUNDS_BASE = fundingRoundsBase(fundingRoundsDefaults.rounds); // 110
export const FUNDING_ROUNDS_HERO = FUNDING_ROUNDS_BASE - 4;

// Layout (content box is 900 x 824). Heights add up to the column Stage3D
// centers, so the pour below can find the tower top on the full frame.
const EYEBROW_H = 36; // 30px label at line-height 1.2
const TOWER_AREA_H = 470;
const STACK_W = 350;
const STACK_D = STACK_W / BILL_ASPECT; // depth of the bills on the floor
const STACK_VIEW = {rx: 58, rz: -24};
const RISE = Math.sin((STACK_VIEW.rx * Math.PI) / 180); // how much of a bundle's height shows as rise on screen
const TOWER_MAX = 220; // tallest the tower gets, px (a picture, never an amount)
const TOWER_TOP_AT = 150; // where the finished tower's top sits in the tower area
const ANCHOR_TOP = Math.round(TOWER_TOP_AT - STACK_D / 2 + TOWER_MAX * RISE); // floor of the tower in the area
const NODE = 50;
const TRACK_Y = 66; // track line y inside the stepper block (room above it for the chip)
const STEPPER_H = TRACK_Y + NODE / 2 + 74;
const FIGURE_H = 36; // extra room under the round labels when dollar figures are passed
const CAPTION_H = 8 + 46;

/**
 * Where things land on the full frame. Stage3D centers the column, so the
 * heights below add up to it; `figH` is the extra row for optional figures.
 * - pourMask: the back pour fades in under the eyebrow, so falling money
 *   never passes behind the label or the wordmark.
 * - frontMask: the front pour (in front of the tower, in the content box)
 *   opens under the eyebrow and closes above the round track, so the cash
 *   can never sit on a word: it only shows over the tower area.
 */
const layoutFor = (figH: number) => {
  const stepperH = STEPPER_H + figH;
  const columnH = EYEBROW_H + TOWER_AREA_H + stepperH + CAPTION_H;
  const columnTop = CONTENT.top + (CONTENT.bottom - CONTENT.top - columnH) / 2;
  const eyebrowBottom = columnTop + EYEBROW_H;
  const eyebrowBottomLocal = eyebrowBottom - CONTENT.top;
  const trackTopLocal = eyebrowBottomLocal + TOWER_AREA_H - 14; // the inquiries chip rises a little above the stepper block
  return {
    stepperH,
    eyebrowBottom,
    eyebrowBottomLocal,
    towerFloorY: eyebrowBottom + ANCHOR_TOP + STACK_D / 2, // full-frame y of the tower floor's center
    pourMask: `linear-gradient(to bottom, transparent 0px, transparent ${eyebrowBottom + 14}px, #000 ${eyebrowBottom + 104}px, #000 100%)`,
    frontMask:
      `linear-gradient(to bottom, transparent 0px, transparent ${eyebrowBottomLocal + 16}px, #000 ${eyebrowBottomLocal + 110}px, ` +
      `#000 ${trackTopLocal - 90}px, transparent ${trackTopLocal - 20}px, transparent 100%)`,
  };
};

// Timing (template frames, for the default clip length; stretched for others).
const FIRST = 14; // first round lights
const LAST_END_GAP = 22; // frames left after the last round settles

/** A small chip in the page's .tg.bad tones (sentence case, so it fits narrow gaps). */
const InquiryChip: React.FC<{text: string; strike: number; style?: React.CSSProperties}> = ({text, strike, style}) => (
  <div
    style={{
      position: 'relative',
      display: 'inline-flex',
      alignItems: 'center',
      gap: 8,
      padding: '7px 14px',
      borderRadius: 12,
      background: TAG.bad.bg,
      border: `2px solid ${TAG.bad.border}`,
      color: TAG.bad.fg,
      fontSize: 23,
      fontWeight: 700,
      letterSpacing: '-0.005em',
      lineHeight: 1,
      whiteSpace: 'nowrap',
      boxShadow: '0 3px 0 -1px #EBC6C3, 0 10px 18px rgba(180,84,76,.12)',
      ...style,
    }}
  >
    <span style={{width: 8, height: 8, borderRadius: '50%', background: TAG.bad.fg}} />
    {text}
    <div
      style={{
        position: 'absolute',
        left: 10,
        top: '50%',
        height: 4,
        marginTop: -2,
        borderRadius: 2,
        width: `calc(${strike} * (100% - 20px))`,
        background: TAG.bad.fg,
      }}
    />
  </div>
);

export const FundingRounds: React.FC<FundingRoundsProps> = ({
  eyebrow,
  rounds,
  roundLabel,
  inquiryChip,
  captionStruck,
  captionRest,
  amounts,
  durationInFrames,
  showSafeZones,
}) => {
  const N = clampRounds(rounds);
  const L = fundingRoundsBase(N);
  const {f, fps} = useClipTimeline(L, durationInFrames);

  const span = L - FIRST - LAST_END_GAP; // frames for all rounds
  const P = span / N; // one round
  const startOf = (k: number) => FIRST + k * P;

  const figures = amounts && amounts.length >= N && amounts.slice(0, N).every((a) => Number.isFinite(a) && a > 0) ? amounts.slice(0, N) : null;
  const totalFig = figures ? figures.reduce((a, b) => a + b, 0) : 0;
  // Bundle heights: equal bundles by default; with real figures, sized to them.
  const slabH = (k: number) => (figures ? (TOWER_MAX * (figures[k] as number)) / totalFig : TOWER_MAX / N);
  const baseOf = (k: number) => {
    let b = 0;
    for (let i = 0; i < k; i++) b += slabH(i);
    return b;
  };

  const pitch = CONTENT_WIDTH / N;
  const nodeX = (k: number) => pitch * (k + 0.5);

  const lay = layoutFor(figures ? FIGURE_H : 0);
  /** Full-frame y of the tower's top once round k's bundle is on. */
  const topAfter = (k: number) => lay.towerFloorY - (baseOf(k) + slabH(k)) * RISE;

  return (
    <BrandFrame
      showSafeZones={showSafeZones}
      backdrop={
        <>
          <BackdropStage f={f} length={L}>
            {/* faint cash drifting down both sides */}
            <MoneyField f={f} mode="drift" count={4} seed="rounds-left" area={{x: -40, y: 240, w: 230, h: 1350}} size={[150, 220]} depth={[-900, -300]} opacity={0.4} blur={2.5} />
            <MoneyField f={f} mode="drift" count={4} seed="rounds-right" area={{x: 890, y: 240, w: 230, h: 1350}} size={[150, 220]} depth={[-900, -300]} opacity={0.4} blur={2.5} />
          </BackdropStage>
          {/* each round, bills and coins pour down onto the tower (more every round); masked so they appear under the eyebrow */}
          <Decor>
            <AbsoluteFill
              style={{
                perspective: DEPTH.backdropPerspective,
                perspectiveOrigin: `${STAGE_CENTER.x}px ${STAGE_CENTER.y}px`,
                WebkitMaskImage: lay.pourMask,
                maskImage: lay.pourMask,
              }}
            >
              {Array.from({length: N}, (_, k) => (
                <MoneyField
                  key={k}
                  f={f}
                  mode="flow"
                  kind="mix"
                  count={Math.round(5 + (9 * k) / (N - 1))}
                  seed={`rounds-pour-${k}`}
                  from={{x: STAGE_CENTER.x, y: lay.eyebrowBottom - 160}}
                  to={{x: STAGE_CENTER.x, y: topAfter(k) + 14}}
                  start={startOf(k) - 10}
                  end={startOf(k) + P * 0.6 + 10}
                  travel={16}
                  size={[110, 170]}
                  depth={[-160, 0]}
                  opacity={0.8}
                  blur={1.2}
                />
              ))}
            </AbsoluteFill>
          </Decor>
        </>
      }
    >
      <Stage3D f={f} length={L}>
        <Eyebrow text={eyebrow} progress={enter(f, fps, 0, 14)} />

        {/* the cash tower: one strapped bundle stacks on per round */}
        <div style={{...P3D, position: 'relative', width: CONTENT_WIDTH, height: TOWER_AREA_H}}>
          <div style={{...P3D, position: 'absolute', left: (CONTENT_WIDTH - STACK_W) / 2, top: ANCHOR_TOP}}>
            {Array.from({length: N}, (_, k) => {
              const grow = progressBetween(f, startOf(k), startOf(k) + P * 0.6);
              if (grow <= 0) return null;
              return (
                <div key={k} style={{...P3D, position: 'absolute', left: 0, top: 0}}>
                  <CashStack width={STACK_W} height={(slabH(k) - 3) * grow} base={baseOf(k)} view={STACK_VIEW} shadow={k === 0} />
                </div>
              );
            })}
          </div>
        </div>

        {/* the track: Round 1, Round 2 ... with inquiries coming off between them */}
        <div style={{position: 'relative', width: CONTENT_WIDTH, height: lay.stepperH, opacity: enter(f, fps, 4, 14)}}>
          <div style={{position: 'absolute', left: nodeX(0), width: nodeX(N - 1) - nodeX(0), top: TRACK_Y - 2, height: 4, borderRadius: 2, background: COLORS.line}} />
          {Array.from({length: N - 1}, (_, k) => {
            const draw = progressBetween(f, startOf(k) + P * 0.78, startOf(k + 1) + 2);
            return (
              <div
                key={`seg${k}`}
                style={{position: 'absolute', left: nodeX(k), width: pitch * draw, top: TRACK_Y - 2, height: 4, borderRadius: 2, background: COLORS.accent}}
              />
            );
          })}
          {Array.from({length: N}, (_, k) => {
            const lit = enter(f, fps, startOf(k), 8);
            return (
              <React.Fragment key={`n${k}`}>
                <div
                  style={{
                    position: 'absolute',
                    left: nodeX(k) - NODE / 2,
                    top: TRACK_Y - NODE / 2,
                    width: NODE,
                    height: NODE,
                    borderRadius: '50%',
                    background: lit > 0.01 ? `rgba(61,134,240,${lit})` : COLORS.white,
                    border: `4px solid ${lit > 0.5 ? COLORS.accent : COLORS.track}`,
                    boxShadow: `0 0 0 ${12 * lit}px rgba(61,134,240,${0.12 * lit}), 0 6px 12px rgba(10,10,10,.08)`,
                    transform: `scale(${0.86 + 0.14 * lit})`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <svg width={22} height={22} viewBox="0 0 24 24" style={{opacity: lit}}>
                    <path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="#FFFFFF" strokeWidth={3.4} strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <div
                  style={{
                    position: 'absolute',
                    left: nodeX(k) - pitch / 2,
                    width: pitch,
                    top: TRACK_Y + NODE / 2 + 16,
                    textAlign: 'center',
                    fontSize: N >= 6 ? 27 : 30,
                    fontWeight: 700,
                    letterSpacing: TRACK.body,
                    lineHeight: 1.15,
                    whiteSpace: 'nowrap',
                    color: lit > 0.5 ? COLORS.ink : COLORS.gray2,
                  }}
                >
                  {roundLabel} {k + 1}
                  {figures ? (
                    <div style={{marginTop: 4, opacity: lit}}>
                      <DollarCounter value={figures[k] as number} f={f} start={startOf(k)} end={startOf(k) + P * 0.6} size={26} weight={700} color={COLORS.accent} />
                    </div>
                  ) : null}
                </div>
              </React.Fragment>
            );
          })}
          {/* the inquiries chip between each round and the next */}
          {Array.from({length: N - 1}, (_, k) => {
            const s = startOf(k);
            const pop = enter(f, fps, s + P * 0.4, 6);
            const strike = progressBetween(f, s + P * 0.55, s + P * 0.72);
            const leave = progressBetween(f, s + P * 0.78, s + P * 1.0);
            const show = pop * (1 - leave);
            if (show <= 0.01) return null;
            return (
              <div
                key={`chip${k}`}
                style={{
                  position: 'absolute',
                  left: nodeX(k) + pitch / 2,
                  top: TRACK_Y - NODE / 2 - 12,
                  transform: `translate(-50%, -100%) translateY(${(1 - pop) * 14 - leave * 26}px)`,
                  opacity: show,
                }}
              >
                <InquiryChip text={inquiryChip} strike={strike} />
              </div>
            );
          })}
        </div>

        {/* caption: what happens between rounds */}
        <div style={{...fadeUp(enter(f, fps, 10, 16), 18), marginTop: 8, display: 'flex', alignItems: 'baseline', gap: 12, whiteSpace: 'nowrap'}}>
          <span style={{position: 'relative', fontSize: 38, fontWeight: 700, color: TAG.bad.fg, letterSpacing: TRACK.body}}>
            {captionStruck}
            <span
              style={{
                position: 'absolute',
                left: -4,
                top: '56%',
                height: 4,
                borderRadius: 2,
                width: `calc(${progressBetween(f, 18, 30)} * (100% + 8px))`,
                background: TAG.bad.fg,
              }}
            />
          </span>
          <span style={{fontSize: 38, fontWeight: 600, color: COLORS.ink2, letterSpacing: TRACK.body}}>{captionRest}</span>
        </div>
      </Stage3D>

      {/* the front pour: each round, cash tumbles down over the tower (more every round), masked to the tower area */}
      <Decor>
        <AbsoluteFill
          style={{
            perspective: DEPTH.perspective,
            perspectiveOrigin: '450px 412px',
            WebkitMaskImage: lay.frontMask,
            maskImage: lay.frontMask,
          }}
        >
          {Array.from({length: N}, (_, k) => (
            <MoneyField
              key={k}
              f={f}
              stage="content"
              mode="pour"
              kind="bill"
              count={Math.round(3 + (4 * k) / (N - 1))}
              seed={`rounds-front-${k}`}
              from={{x: 450, y: lay.eyebrowBottomLocal + 30}}
              start={startOf(k) - 4}
              end={startOf(k) + P * 0.7}
              size={[120, 180]}
              depth={[-220, 40]}
              opacity={0.72}
              speed={1.2}
            />
          ))}
        </AbsoluteFill>
      </Decor>
    </BrandFrame>
  );
};
