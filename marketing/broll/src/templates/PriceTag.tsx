import React from 'react';
import {Composition, spring} from 'remotion';
import {COLORS, FRAME, TRACK, formatDollars} from '../brand';
import {SeeThrough} from '../brand/Grid';
import {clampClip, useClipTimeline} from './clipTimeline';
import {
  EyebrowChip,
  PanelFrame,
  PanelStage,
  STAMP_WIDE,
  SublinePlate,
  sublineHeight,
  type PanelBox,
  type StampFormat,
  type StampSide,
} from './StampCard';

// PriceTag (unit N5, ops/workflows/animation-builds-2026-10-22.md). A price tag swings in on its string and settles, with an optional second tag beside it and an optional pile of cards stacking up under it ("Hundreds of hours" of "Outdated videos" and "Zoom calls").
//
// Every word and number on screen is a prop, so a script line supplies its own:
//   Capital Blueprint Ad 1 (the defaults): "$2,000" "a month", then "for the one
//     piece that decides how much you get approved for".
//   Capital Blueprint Ad 1: "$5,000" "to $10,000", then "Hundreds of hours" and a
//     pile of "Outdated videos" and "Zoom calls".
//   Capital Blueprint Ad 2: a "$5,000" "Course" tag and a "$2,000" "a month"
//     "Data points" tag.
// Prices are shown as passed, never counted up through numbers nobody said.
//
// Same two formats and the same see-through rules as StampCard (its PanelFrame):
// vertical 1080x1920 with every word in y 269-1248; wide 3840x2160 with
// everything in one side panel picked by `side`, no wordmark.

export type PriceTagItem = {
  /** Whole dollars, the big number on the tag. */
  amount: number;
  /** A second amount for a range ("to $10,000"). Null for one price. */
  upTo: number | null;
  /** How often, on a chip under the price ("a month"). Null hides it. */
  per: string | null;
  /** What it is, small above the price ("Course"). Null hides it. */
  label: string | null;
};

export type PriceTagProps = {
  /** "vertical" (1080x1920, ads) or "wide" (3840x2160, the VSL and thank-you video). */
  format?: StampFormat;
  /** Wide only: which side panel holds the clip. Default "left". */
  side?: StampSide;
  /** Small label on a chip above the tag. Null hides it. */
  eyebrow: string | null;
  /** The tag that swings in first. */
  tag: PriceTagItem;
  /** A second tag that swings in beside it. Null for one tag. */
  second: PriceTagItem | null;
  /** Bold line over the pile ("Hundreds of hours"). Null hides it. */
  pileLabel: string | null;
  /** Words on the cards that pile up; they repeat in order to fill pileCount. Empty hides the pile. */
  pile: string[];
  /** How many cards land on the pile (0 to 8). */
  pileCount: number;
  /** A line on a white plate at the bottom. Null hides it. */
  subline: string | null;
  durationInFrames?: number;
  showSafeZones?: boolean;
  /** See-through: no page and no grid, so the clip renders with alpha (README.md). Default false. */
  transparent?: boolean;
};

export const priceTagDefaults: PriceTagProps = {
  format: 'vertical',
  side: 'left',
  eyebrow: 'Some of them still charge you',
  tag: {amount: 2000, upTo: null, per: 'a month', label: null},
  second: null,
  pileLabel: null,
  pile: [],
  pileCount: 0,
  subline: 'for the one piece that decides how much you get approved for',
  transparent: false,
};

/** Base length 3.2 s; a shot list may ask for 2.5 to 4 s (75 to 120 frames). */
export const PRICE_TAG_BASE = 96;
export const PRICE_TAG_MIN = 75;
export const PRICE_TAG_MAX = 120;
/** Frame (on the base timeline) where every beat is on screen: tags settled, pile landed, subline in. */
export const PRICE_TAG_HERO = 86;

export const priceTagDuration = (requested?: number): number => clampClip(requested, PRICE_TAG_BASE, PRICE_TAG_MIN, PRICE_TAG_MAX);

// ---------------------------------------------------------------------------
// Timeline (frames on the 96-frame base)

const T = {
  eyebrow: 0,
  tag: 4,
  second: 15,
  pileLabel: 30,
  pile: 35,
  pileStep: 4,
  sub: 48,
} as const;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

// ---------------------------------------------------------------------------
// The tag

const TAG_W = 600;
const STRING = 100;
const HOLE = {y: 62, r: 17} as const;
const PAD_X = 52;

const priceText = (item: PriceTagItem) => formatDollars(item.amount);
const priceSize = (item: PriceTagItem): number => Math.min(150, (TAG_W - PAD_X * 2) / (priceText(item).length * 0.6));

/** The tag's height in design units, from what is printed on it. */
const tagHeight = (item: PriceTagItem): number => {
  const fs = priceSize(item);
  return (
    112 + (item.label ? 54 : 0) + fs * 1.02 + (item.upTo !== null ? fs * 0.58 * 1.1 + 6 : 0) + (item.per ? 86 : 10) + 46
  );
};

const TagShape: React.FC<{u: number; h: number; id: string}> = ({u, h, id}) => {
  const W = TAG_W;
  const c = 92;
  const r = 30;
  const outline = `M ${c} 0 H ${W - c} L ${W} ${c} V ${h - r} Q ${W} ${h} ${W - r} ${h} H ${r} Q 0 ${h} 0 ${h - r} V ${c} Z`;
  const hole = `M ${W / 2 + HOLE.r} ${HOLE.y} A ${HOLE.r} ${HOLE.r} 0 1 0 ${W / 2 - HOLE.r} ${HOLE.y} A ${HOLE.r} ${HOLE.r} 0 1 0 ${W / 2 + HOLE.r} ${HOLE.y} Z`;
  return (
    <svg width={W * u} height={h * u} viewBox={`0 0 ${W} ${h}`} style={{position: 'absolute', left: 0, top: 0, overflow: 'visible'}}>
      <defs>
        <linearGradient id={`${id}-paper`} x1="0" y1="0" x2="0.35" y2="1">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="64%" stopColor="#FFFFFF" />
          <stop offset="100%" stopColor="#F3F3F6" />
        </linearGradient>
        <linearGradient id={`${id}-brass`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FCEBC6" />
          <stop offset="55%" stopColor="#E3AE62" />
          <stop offset="100%" stopColor="#C38C42" />
        </linearGradient>
        <linearGradient id={`${id}-spectrum`} x1="0" y1="0" x2="1" y2="0">
          {/* the brand spectrum (tokens.ts SPECTRUM), as SVG stops */}
          <stop offset="0%" stopColor="#F2A69B" />
          <stop offset="20%" stopColor="#F5CE8F" />
          <stop offset="40%" stopColor="#F2E39B" />
          <stop offset="60%" stopColor="#A8D8B0" />
          <stop offset="80%" stopColor="#A9C6E8" />
          <stop offset="100%" stopColor="#C4B3E5" />
        </linearGradient>
        <clipPath id={`${id}-clip`}>
          <path d={outline} />
        </clipPath>
      </defs>
      <path d={`${outline} ${hole}`} fillRule="evenodd" fill={`url(#${id}-paper)`} stroke="#E1E1E6" strokeWidth={2.5} strokeLinejoin="round" />
      {/* brand spectrum along the bottom edge */}
      <g clipPath={`url(#${id}-clip)`}>
        <rect x={0} y={h - 12} width={W} height={12} fill={`url(#${id}-spectrum)`} />
      </g>
      {/* the perforation under the hole */}
      <line x1={36} x2={W - 36} y1={HOLE.y + 46} y2={HOLE.y + 46} stroke="#E1E1E6" strokeWidth={2.5} strokeDasharray="7 7" strokeLinecap="round" />
      {/* brass grommet */}
      <circle cx={W / 2} cy={HOLE.y} r={HOLE.r + 6} fill="none" stroke={`url(#${id}-brass)`} strokeWidth={10} />
      <circle cx={W / 2} cy={HOLE.y} r={HOLE.r + 1} fill="none" stroke="rgba(120,85,30,.35)" strokeWidth={1.6} />
    </svg>
  );
};

/** One tag on its string. The string's top is the pivot it swings on. */
const Tag: React.FC<{u: number; f: number; fps: number; item: PriceTagItem; start: number; rest: number; id: string}> = ({
  u,
  f,
  fps,
  item,
  start,
  rest,
  id,
}) => {
  const h = tagHeight(item);
  const fs = priceSize(item);
  const t = f - start;
  const drop = spring({frame: t, fps, durationInFrames: 16, config: {damping: 200}});
  // A damped swing: big at first, settles to its resting tilt.
  const swing = t <= 0 ? 24 : 24 * Math.exp(-t / 13) * Math.cos(t * 0.34);
  const angle = rest + swing;
  const ink = COLORS.ink;
  return (
    <div
      style={{
        position: 'relative',
        width: TAG_W * u,
        height: (STRING + h) * u,
        flex: '0 0 auto',
        opacity: clamp01(t / 4),
        transformOrigin: `50% 0`,
        transform: `translateY(${-(1 - drop) * 300 * u}px) rotate(${angle}deg) rotateY(${swing * 0.5}deg)`,
      }}
    >
      {/* the string, fading out toward the top */}
      <svg width={TAG_W * u} height={(STRING + HOLE.y) * u} viewBox={`0 0 ${TAG_W} ${STRING + HOLE.y}`} style={{position: 'absolute', left: 0, top: 0, overflow: 'visible'}}>
        <defs>
          <linearGradient id={`${id}-string`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#8A8A93" stopOpacity={0} />
            <stop offset="45%" stopColor="#8A8A93" stopOpacity={0.9} />
            <stop offset="100%" stopColor="#6B6B74" />
          </linearGradient>
        </defs>
        <path
          d={`M ${TAG_W / 2} 0 C ${TAG_W / 2 + 6} ${STRING * 0.5}, ${TAG_W / 2 - 4} ${STRING * 0.8}, ${TAG_W / 2} ${STRING + HOLE.y - HOLE.r + 4}`}
          fill="none"
          stroke={`url(#${id}-string)`}
          strokeWidth={4}
          strokeLinecap="round"
        />
      </svg>
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: STRING * u,
          width: TAG_W * u,
          height: h * u,
          filter: `drop-shadow(0 ${8 * u}px ${12 * u}px rgba(10,10,10,.10)) drop-shadow(0 ${24 * u}px ${28 * u}px rgba(10,10,10,.10))`,
        }}
      >
        <TagShape u={u} h={h} id={id} />
        <div
          style={{
            position: 'absolute',
            left: PAD_X * u,
            right: PAD_X * u,
            top: 112 * u,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            color: ink,
          }}
        >
          {item.label ? (
            <div
              style={{
                fontSize: 32 * u,
                fontWeight: 600,
                letterSpacing: '0.16em',
                marginRight: '-0.16em',
                textTransform: 'uppercase',
                color: COLORS.gray,
                lineHeight: 1.2,
                marginBottom: 16 * u,
                whiteSpace: 'nowrap',
              }}
            >
              {item.label}
            </div>
          ) : null}
          <div style={{fontSize: fs * u, fontWeight: 800, letterSpacing: TRACK.num, lineHeight: 1.02, whiteSpace: 'nowrap'}}>{priceText(item)}</div>
          {item.upTo !== null ? (
            <div
              style={{
                marginTop: 6 * u,
                fontSize: fs * 0.58 * u,
                fontWeight: 800,
                letterSpacing: TRACK.num,
                lineHeight: 1.1,
                color: COLORS.ink2,
                whiteSpace: 'nowrap',
              }}
            >
              to {formatDollars(item.upTo)}
            </div>
          ) : null}
          {item.per ? (
            <div
              style={{
                marginTop: 22 * u,
                padding: `${14 * u}px ${28 * u}px`,
                borderRadius: 999,
                background: '#EEF4FE',
                border: `${2 * u}px solid rgba(61,134,240,.28)`,
                fontSize: 32 * u,
                fontWeight: 700,
                letterSpacing: '0.14em',
                marginRight: '-0.14em',
                textTransform: 'uppercase',
                color: COLORS.accent,
                lineHeight: 1,
                whiteSpace: 'nowrap',
              }}
            >
              {item.per}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// The pile

const CHIP = {w: 540, h: 80} as const;
const PILE_STEP = 60;

const PlayMark: React.FC<{u: number}> = ({u}) => (
  <svg width={46 * u} height={46 * u} viewBox="0 0 46 46" style={{flex: '0 0 auto', display: 'block'}}>
    <circle cx={23} cy={23} r={23} fill={COLORS.accent} />
    <path d="M 18 14 L 32 23 L 18 32 Z" fill="#FFFFFF" />
  </svg>
);

const pileHeight = (n: number): number => (n > 0 ? CHIP.h + (n - 1) * PILE_STEP + 10 : 0);

const Pile: React.FC<{u: number; f: number; fps: number; words: string[]; count: number}> = ({u, f, fps, words, count}) => {
  const n = Math.max(0, Math.min(8, Math.round(count)));
  const h = pileHeight(n);
  return (
    <div style={{position: 'relative', width: (CHIP.w + 80) * u, height: h * u, flex: '0 0 auto'}}>
      {Array.from({length: n}, (_, i) => {
        const start = T.pile + i * T.pileStep;
        const land = spring({frame: f - start, fps, durationInFrames: 10, config: {damping: 200}});
        const jitter = (((i * 37) % 5) - 2) * 14;
        const tilt = (((i * 53) % 9) - 4) * 1.1;
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: (40 + jitter) * u,
              bottom: i * PILE_STEP * u,
              width: CHIP.w * u,
              height: CHIP.h * u,
              boxSizing: 'border-box',
              display: 'flex',
              alignItems: 'center',
              gap: 20 * u,
              padding: `0 ${30 * u}px`,
              borderRadius: 20 * u,
              background: COLORS.white,
              border: `${2 * u}px solid #E4E4E7`,
              boxShadow: `0 ${6 * u}px ${12 * u}px rgba(10,10,10,.10)`,
              opacity: clamp01((f - start) / 3),
              transform: `translateY(${-(1 - land) * 240 * u}px) rotate(${tilt}deg)`,
            }}
          >
            <PlayMark u={u} />
            <div style={{fontSize: 36 * u, fontWeight: 600, letterSpacing: TRACK.body, color: COLORS.ink2, whiteSpace: 'nowrap', lineHeight: 1}}>
              {words.length ? words[i % words.length] : ''}
            </div>
          </div>
        );
      })}
    </div>
  );
};

// ---------------------------------------------------------------------------
// The scene

const Scene: React.FC<PriceTagProps & {f: number; fps: number; box: PanelBox}> = (p) => {
  const {f, fps, box} = p;
  const GAP = 30;
  const two = p.second !== null;
  // Two tags hang staggered and overlap a little, the second in front, lower and to the right.
  const ts = two ? 0.84 : 1;
  const hA = (STRING + tagHeight(p.tag)) * ts;
  const hB = p.second ? (STRING + tagHeight(p.second)) * ts : 0;
  const stagger = hA * 0.56;
  const tagsH = p.second ? Math.max(hA, stagger + hB) : hA;
  const showPile = p.pile.length > 0 && p.pileCount > 0;
  const parts = [
    p.eyebrow ? 76 : 0,
    tagsH,
    p.pileLabel ? 104 : 0,
    showPile ? pileHeight(Math.min(8, p.pileCount)) : 0,
    sublineHeight(p.subline),
  ].filter((x) => x > 0);
  const total = parts.reduce((a, b) => a + b, 0) + GAP * (parts.length - 1);
  const k = Math.min(1, (box.h - 30) / total);
  const u = box.u * k;
  const id = `pt-${p.format === 'wide' ? 'w' : 'v'}`;
  const enter = (at: number, d = 14) => spring({frame: f - at, fps, durationInFrames: d, config: {damping: 200}});
  const labelIn = enter(T.pileLabel);

  return (
    <PanelStage f={f} length={PRICE_TAG_BASE} u={u} gap={GAP * u}>
      {p.eyebrow ? <EyebrowChip text={p.eyebrow} u={u} progress={enter(T.eyebrow)} /> : null}
      {p.second ? (
        <div style={{position: 'relative', width: 900 * u, height: tagsH * u, flex: '0 0 auto'}}>
          <div style={{position: 'absolute', left: 0, top: 0}}>
            <Tag u={u * ts} f={f} fps={fps} item={p.tag} start={T.tag} rest={-3} id={`${id}-a`} />
          </div>
          <div style={{position: 'absolute', right: 0, top: stagger * u}}>
            <Tag u={u * ts} f={f} fps={fps} item={p.second} start={T.second} rest={3} id={`${id}-b`} />
          </div>
        </div>
      ) : (
        <Tag u={u} f={f} fps={fps} item={p.tag} start={T.tag} rest={-2} id={`${id}-a`} />
      )}
      {p.pileLabel ? (
        <div
          style={{
            padding: `${18 * u}px ${40 * u}px`,
            borderRadius: 26 * u,
            background: COLORS.white,
            border: `${2 * u}px solid #ECECEF`,
            boxShadow: `0 ${8 * u}px ${18 * u}px rgba(10,10,10,.10)`,
            fontSize: 56 * u,
            fontWeight: 800,
            letterSpacing: TRACK.h2,
            lineHeight: 1.05,
            color: COLORS.ink,
            whiteSpace: 'nowrap',
            opacity: labelIn,
            transform: `translateY(${(1 - labelIn) * 24 * u}px) scale(${0.92 + 0.08 * labelIn})`,
          }}
        >
          {p.pileLabel}
        </div>
      ) : null}
      {showPile ? <Pile u={u} f={f} fps={fps} words={p.pile} count={p.pileCount} /> : null}
      {p.subline ? <SublinePlate text={p.subline} u={u} progress={enter(T.sub)} /> : null}
    </PanelStage>
  );
};

export const PriceTag: React.FC<PriceTagProps> = (props) => {
  const {f, fps} = useClipTimeline(PRICE_TAG_BASE, props.durationInFrames, PRICE_TAG_MIN, PRICE_TAG_MAX);
  const {transparent} = props;
  return (
    <SeeThrough on={transparent}>
      <PanelFrame format={props.format} side={props.side} showSafeZones={props.showSafeZones}>
        {(box) => <Scene {...props} f={f} fps={fps} box={box} />}
      </PanelFrame>
    </SeeThrough>
  );
};

const size = (format?: StampFormat) =>
  format === 'wide' ? {width: STAMP_WIDE.width, height: STAMP_WIDE.height} : {width: FRAME.width, height: FRAME.height};

// Stills:  npx remotion still src/index.ts PriceTag out/price-tag.png --frame=86
//          npx remotion still src/index.ts PriceTagWide out/price-tag-wide.png --frame=86
// PriceTag with --props '{"format":"wide"}' is the same as PriceTagWide.
export const PriceTagCompositions: React.FC = () => (
  <>
    <Composition
      id="PriceTag"
      component={PriceTag}
      durationInFrames={PRICE_TAG_BASE}
      fps={FRAME.fps}
      width={FRAME.width}
      height={FRAME.height}
      defaultProps={priceTagDefaults}
      calculateMetadata={({props}) => ({durationInFrames: priceTagDuration(props.durationInFrames), ...size(props.format)})}
    />
    <Composition
      id="PriceTagWide"
      component={PriceTag}
      durationInFrames={PRICE_TAG_BASE}
      fps={STAMP_WIDE.fps}
      width={STAMP_WIDE.width}
      height={STAMP_WIDE.height}
      defaultProps={{...priceTagDefaults, format: 'wide' as const}}
      calculateMetadata={({props}) => ({durationInFrames: priceTagDuration(props.durationInFrames), ...size(props.format)})}
    />
  </>
);
