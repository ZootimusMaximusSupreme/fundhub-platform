import React from 'react';
import {AbsoluteFill, Composition} from 'remotion';
import {
  COLORS,
  Card3D,
  Decor,
  FONT_FAMILY,
  FRAME,
  Grid,
  SAFE,
  SAFE_HEIGHT,
  SPECTRUM,
  SafeZoneGuide,
  Stage3D,
  TAG,
  TRACK,
  WORDMARK,
  Wordmark,
  countUp,
  enter,
  fadeUp,
  progressBetween,
} from '../brand';
import {SeeThrough, useSeeThrough} from '../brand/Grid';
import {clampClip, useClipTimeline} from './clipTimeline';

// One bar split into the part you have and the part you are missing: the big part grows in, the missing part pulses, and it can fill in at the end.
//
// Unit N6 (ops/workflows/animation-builds-2026-10-22.md), Direct Book Ad 12:
// "almost every one of them is working off information that's about 80% right
// and the 20% they're missing decides how much funding you actually get", then
// "Our system has collected thousands of data points from hundreds of files.
// That's where the other 20% comes from." (fillGap on, the sources feed the gap).
//
// The beat: the card comes forward; the dark part of the bar grows to its share
// while its number counts up; the missing slot draws in red and dashed and
// starts to pulse. With fillGap on, small chips (the sources) land above the
// bar, dots stream from them into the slot, the slot fills blue from the left,
// its number turns blue, and a shine runs down the whole bar. The headline
// comes last. Every word is a prop; the defaults are the script's own words.
//
// Two formats from one card:
// - vertical 1080x1920 (ads): the card sits inside the text-safe band
//   (y 269-1248), under the wordmark when the page is on.
// - wide 3840x2160 (the sideways 4K VSL and thank-you video): the same card,
//   drawn bigger, in ONE side panel picked by `side` (left x 192-1500, right
//   x 2340-3648, both y 108-1512). Nothing in the middle column (the face) or
//   the bottom 30% (the captions). No wordmark in the wide format.
// See-through (`transparent`): the paper and grid drop out; the card stays, so
// every word sits on solid white and reads over any film. The dots, the shine
// and the pulse ring are Decor, so a `checkTextOnly` render drops them.

export type SplitBarFormat = 'vertical' | 'wide';
export type SplitBarSide = 'left' | 'right';

export type SplitBarProps = {
  /** "vertical" (1080x1920, ads) or "wide" (3840x2160, the VSL and thank-you video). */
  format?: SplitBarFormat;
  /** Wide only: which side panel holds the card. The face is in the middle. Default "left". */
  side?: SplitBarSide;
  /** The big part's share, e.g. 80. Shown as "80%". */
  knownPercent: number;
  /** The missing part's share, e.g. 20. Shown as "20%". */
  missingPercent: number;
  /** Small words under the big part's number, e.g. "right". Null shows the number alone. */
  knownLabel: string | null;
  /** Small words under the missing part's number, e.g. "they're missing". Null shows the number alone. */
  missingLabel: string | null;
  /** The line under the bar. Null hides it. */
  headline: string | null;
  /** True: the missing part fills in at the end. False: it keeps pulsing. */
  fillGap: boolean;
  /** Chips that feed the gap as it fills, e.g. ["thousands of data points", "hundreds of files"]. Shown only with fillGap. */
  sources: string[];
  durationInFrames?: number;
  showSafeZones?: boolean;
  /** See-through: no page and no grid, so the clip renders with alpha (README.md). Default false. */
  transparent?: boolean;
};

export const splitBarDefaults: SplitBarProps = {
  format: 'vertical',
  side: 'left',
  knownPercent: 80,
  missingPercent: 20,
  knownLabel: 'right',
  missingLabel: "they're missing",
  headline: 'decides how much funding you actually get',
  fillGap: false,
  sources: [],
  transparent: false,
};

/** Base length 3.5 s; a shot list may ask for 2.5 to 4 s (75 to 120 frames). */
export const SPLIT_BAR_BASE = 105;
export const SPLIT_BAR_MIN = 75;
export const SPLIT_BAR_MAX = 120;
/** Frame (on the base timeline) where every beat is on screen, fill and headline included. */
export const SPLIT_BAR_HERO = 96;

export const splitBarDuration = (requested?: number): number => clampClip(requested, SPLIT_BAR_BASE, SPLIT_BAR_MIN, SPLIT_BAR_MAX);

/** The wide frame: 4K, 30 fps. */
export const SPLIT_BAR_WIDE = {width: 3840, height: 2160, fps: 30} as const;

// ---------------------------------------------------------------------------
// Where the card sits (kept in this file on purpose: no shared helper).

/** The design box the card is laid out in, in vertical-frame pixels. */
const BOX = {w: 1000, h: 824} as const;
/** Vertical: the box sits under the wordmark, inside the text-safe band. */
const V_BOX = {left: (FRAME.width - BOX.w) / 2, top: 400} as const;
/** The two allowed side panels on the wide frame (board rule). */
const PANEL = {left: 192, right: 2340, top: 108, width: 1308, height: 1404} as const;
/** Wide: the box fills the panel's width, so the card is drawn at about 1.3x. */
const W_SCALE = PANEL.width / BOX.w;

const VerticalStage: React.FC<{showSafeZones?: boolean; children: React.ReactNode}> = ({showSafeZones, children}) => {
  const seeThrough = useSeeThrough();
  return (
    <AbsoluteFill style={{fontFamily: FONT_FAMILY, color: COLORS.ink, WebkitFontSmoothing: 'antialiased'}}>
      <Grid />
      {/* Everything is clipped to the text-safe band, so nothing can land in the top 14% or bottom 35%. */}
      <div style={{position: 'absolute', left: 0, right: 0, top: SAFE.top, height: SAFE_HEIGHT, overflow: 'hidden'}}>
        {seeThrough ? null : (
          <div style={{position: 'absolute', left: 0, right: 0, top: WORDMARK.top - SAFE.top, display: 'flex', justifyContent: 'center'}}>
            <Wordmark width={WORDMARK.width} />
          </div>
        )}
        <div style={{position: 'absolute', left: V_BOX.left, top: V_BOX.top - SAFE.top, width: BOX.w, height: BOX.h}}>{children}</div>
      </div>
      {showSafeZones ? <SafeZoneGuide /> : null}
    </AbsoluteFill>
  );
};

const WideZoneGuide: React.FC<{side: SplitBarSide}> = ({side}) => (
  <AbsoluteFill style={{pointerEvents: 'none'}}>
    <div style={{position: 'absolute', left: 1500, width: 840, top: 0, bottom: 0, background: 'rgba(220,38,38,.07)'}} />
    <div style={{position: 'absolute', left: 0, right: 0, top: 1512, bottom: 0, background: 'rgba(220,38,38,.07)'}} />
    <div
      style={{
        position: 'absolute',
        left: side === 'right' ? PANEL.right : PANEL.left,
        top: PANEL.top,
        width: PANEL.width,
        height: PANEL.height,
        border: '6px solid #DC2626',
      }}
    />
  </AbsoluteFill>
);

const WideStage: React.FC<{side: SplitBarSide; showSafeZones?: boolean; children: React.ReactNode}> = ({side, showSafeZones, children}) => (
  <AbsoluteFill style={{fontFamily: FONT_FAMILY, color: COLORS.ink, WebkitFontSmoothing: 'antialiased'}}>
    <Grid />
    {/* The panel clips its contents, so nothing reaches the middle column or the bottom 30%. */}
    <div
      style={{
        position: 'absolute',
        left: side === 'right' ? PANEL.right : PANEL.left,
        top: PANEL.top,
        width: PANEL.width,
        height: PANEL.height,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: (PANEL.height - BOX.h * W_SCALE) / 2,
          width: BOX.w,
          height: BOX.h,
          transformOrigin: '0 0',
          transform: `scale(${W_SCALE})`,
        }}
      >
        {children}
      </div>
    </div>
    {showSafeZones ? <WideZoneGuide side={side} /> : null}
  </AbsoluteFill>
);

// ---------------------------------------------------------------------------
// Timeline (frames on the 105-frame base)

const T = {
  card: 0,
  grow: [8, 32] as const,
  slot: 28,
  missNum: 32,
  pulse: 40,
  chips: 34,
  stream: [42, 74] as const,
  fill: [50, 76] as const,
  shine: [78, 96] as const,
  headNoFill: 48,
  headFill: 72,
} as const;

const CARD_W = 900;
const PAD_X = 56;
const INNER_W = CARD_W - PAD_X * 2; // 788
const BAR_H = 112;
const BAR_GAP = 10;
const NUM_SIZE = 108;
const LABEL_SIZE = 38;
const CHIP_H = 60;

const pct = (v: number) => `${Math.round(v)}%`;

/** Small seeded noise, 0 to 1, so the dots land the same way every render. */
const noise = (i: number, k: number) => {
  const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453;
  return x - Math.floor(x);
};

const Callout: React.FC<{
  value: string;
  label: string | null;
  color: string;
  labelColor: string;
  align: 'left' | 'right';
  progress: number;
}> = ({value, label, color, labelColor, align, progress}) => (
  <div style={{...fadeUp(progress, 20), display: 'flex', flexDirection: 'column', alignItems: align === 'left' ? 'flex-start' : 'flex-end'}}>
    <div
      style={{
        fontSize: NUM_SIZE,
        fontWeight: 800,
        letterSpacing: TRACK.num,
        lineHeight: 1,
        color,
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      {value}
    </div>
    {label ? (
      <div style={{marginTop: 10, fontSize: LABEL_SIZE, fontWeight: 600, letterSpacing: TRACK.body, lineHeight: 1.1, color: labelColor, whiteSpace: 'nowrap'}}>
        {label}
      </div>
    ) : null}
  </div>
);

const SourceChip: React.FC<{text: string; progress: number; lit: number}> = ({text, progress, lit}) => (
  <div
    style={{
      ...fadeUp(progress, 16),
      height: CHIP_H,
      display: 'inline-flex',
      alignItems: 'center',
      gap: 14,
      padding: '0 24px',
      borderRadius: 999,
      background: '#EEF4FE',
      border: `2px solid ${COLORS.accentLine}`,
      boxShadow: `0 3px 0 -1px rgba(61,134,240,.20), 0 0 0 ${lit * 6}px rgba(61,134,240,${0.1 * lit})`,
      fontSize: 30,
      fontWeight: 600,
      letterSpacing: TRACK.body,
      color: COLORS.ink2,
      whiteSpace: 'nowrap',
    }}
  >
    <span style={{width: 12, height: 12, borderRadius: '50%', background: COLORS.accent, flex: '0 0 auto'}} />
    {text}
  </div>
);

const SplitBarCard: React.FC<SplitBarProps & {f: number; fps: number}> = ({
  knownPercent,
  missingPercent,
  knownLabel,
  missingLabel,
  headline,
  fillGap,
  sources,
  f,
  fps,
}) => {
  const known = Math.max(0, knownPercent);
  const missing = Math.max(0, missingPercent);
  const total = known + missing || 1;
  const knownW = ((INNER_W - BAR_GAP) * known) / total;
  const missW = INNER_W - BAR_GAP - knownW;
  const gapCenter = knownW + BAR_GAP + missW / 2;

  const chips = fillGap ? sources.filter((s) => s.trim().length > 0) : [];
  const chipRow = chips.length > 0 ? CHIP_H + 40 : 0;
  const hasMissLabel = Boolean(missingLabel);
  const hasKnownLabel = Boolean(knownLabel);
  const calloutH = NUM_SIZE + (hasMissLabel || hasKnownLabel ? LABEL_SIZE * 1.1 + 10 : 0);
  const tickH = 34;
  const barTop = chipRow + calloutH + tickH;
  const topH = barTop + BAR_H;

  const card = enter(f, fps, T.card, 16);
  const grow = progressBetween(f, T.grow[0], T.grow[1]);
  const knownIn = enter(f, fps, T.grow[0], 14);
  const slotIn = enter(f, fps, T.slot, 14);
  const missIn = enter(f, fps, T.missNum, 14);
  const fill = fillGap ? progressBetween(f, T.fill[0], T.fill[1]) : 0;
  const filled = fillGap ? enter(f, fps, T.fill[1] - 4, 12) : 0; // the color flip once it is full
  // The pulse: a slow breath on the missing slot, until it fills.
  const breath = f < T.pulse ? 0 : (1 - Math.cos(((f - T.pulse) / 18) * Math.PI * 2)) / 2;
  const pulse = breath * (1 - filled);
  const ring = f < T.pulse ? 0 : ((f - T.pulse) % 18) / 18;
  const shine = fillGap ? progressBetween(f, T.shine[0], T.shine[1]) : 0;
  const head = enter(f, fps, fillGap ? T.headFill : T.headNoFill, 16);

  const missColor = filled > 0.5 ? COLORS.accent : TAG.bad.fg;
  const missLabelColor = filled > 0.5 ? COLORS.accent : TAG.bad.fg;

  return (
    <Stage3D f={f} length={SPLIT_BAR_BASE} drift={0.7}>
      <Card3D enter={card} z={30} tilt={{rx: 2, ry: -2}} width={CARD_W} padding={`52px ${PAD_X}px 54px`} elevation={0.85}>
        {/* The spectrum hairline across the top of the card. */}
        <div style={{position: 'absolute', inset: 0, borderRadius: 28, overflow: 'hidden', pointerEvents: 'none'}}>
          <div style={{position: 'absolute', left: 0, right: 0, top: 0, height: 6, background: SPECTRUM, opacity: card}} />
        </div>
        <div style={{position: 'relative', width: INNER_W, height: topH}}>
          {chips.length > 0 ? (
            <div style={{position: 'absolute', right: 0, top: 0, display: 'flex', gap: 16, justifyContent: 'flex-end'}}>
              {chips.map((c, i) => (
                <SourceChip key={c} text={c} progress={enter(f, fps, T.chips + i * 5, 14)} lit={progressBetween(f, T.stream[0], T.stream[0] + 10) * (1 - progressBetween(f, T.stream[1] - 6, T.stream[1] + 8))} />
              ))}
            </div>
          ) : null}

          {/* Numbers above the two parts. */}
          <div style={{position: 'absolute', left: 0, top: chipRow}}>
            <Callout
              value={pct(countUp(f, T.grow[0], T.grow[1], 0, known))}
              label={knownLabel}
              color={COLORS.ink}
              labelColor={COLORS.gray}
              align="left"
              progress={knownIn}
            />
          </div>
          <div style={{position: 'absolute', right: 0, top: chipRow}}>
            <Callout value={pct(missing)} label={missingLabel} color={missColor} labelColor={missLabelColor} align="right" progress={missIn} />
          </div>
          {/* The tick from the missing number down to its slot. */}
          <div
            style={{
              position: 'absolute',
              left: gapCenter - 2,
              top: barTop - tickH + 6,
              width: 4,
              height: (tickH - 12) * missIn,
              borderRadius: 2,
              background: missColor,
              opacity: missIn * 0.75,
            }}
          />

          {/* The bar. */}
          <div style={{position: 'absolute', left: 0, top: barTop, width: INNER_W, height: BAR_H}}>
            {/* the track under both parts */}
            <div style={{position: 'absolute', inset: 0, borderRadius: 26, background: COLORS.soft, boxShadow: 'inset 0 3px 6px rgba(10,10,10,.06)'}} />
            {/* the part they have */}
            <div
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                height: BAR_H,
                width: knownW * grow,
                borderRadius: '26px 10px 10px 26px',
                background: 'linear-gradient(180deg, #3F3F46 0%, #18181B 55%, #0A0A0A 100%)',
                boxShadow: 'inset 0 2px 0 rgba(255,255,255,.14), 0 6px 14px rgba(10,10,10,.16)',
              }}
            />
            {/* the missing part */}
            <div
              style={{
                position: 'absolute',
                left: knownW + BAR_GAP,
                top: 0,
                width: missW,
                height: BAR_H,
                opacity: slotIn,
                transform: `scale(${0.9 + 0.1 * slotIn + 0.03 * pulse})`,
              }}
            >
              <Decor>
                {pulse > 0 ? (
                  <div
                    style={{
                      position: 'absolute',
                      inset: -4 - ring * 14,
                      borderRadius: 10 + 26 + ring * 8,
                      border: `3px solid rgba(180,84,76,${0.4 * (1 - ring) * (1 - filled)})`,
                    }}
                  />
                ) : null}
              </Decor>
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  borderRadius: '10px 26px 26px 10px',
                  background: TAG.bad.bg,
                  backgroundImage: `repeating-linear-gradient(135deg, rgba(180,84,76,${0.1 + 0.08 * pulse}) 0px, rgba(180,84,76,${0.1 + 0.08 * pulse}) 12px, transparent 12px, transparent 26px)`,
                  backgroundPosition: `${f * 1.2}px 0`,
                  border: `4px dashed rgba(180,84,76,${0.55 + 0.45 * pulse})`,
                  overflow: 'hidden',
                }}
              >
                {/* the blue that fills it */}
                <div
                  style={{
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    bottom: 0,
                    width: `${fill * 100}%`,
                    background: 'linear-gradient(180deg, #74ACF8 0%, #3D86F0 60%, #2F72D8 100%)',
                    boxShadow: fill > 0 && fill < 1 ? '6px 0 14px rgba(61,134,240,.55)' : undefined,
                  }}
                />
              </div>
              {filled > 0 ? (
                <div style={{position: 'absolute', inset: 0, borderRadius: '10px 26px 26px 10px', border: `4px solid ${COLORS.accent}`, opacity: filled}} />
              ) : null}
            </div>
            {/* the shine down the full bar once it is whole */}
            {shine > 0 && shine < 1 ? (
              <Decor>
                <div style={{position: 'absolute', inset: 0, borderRadius: 26, overflow: 'hidden'}}>
                  <div
                    style={{
                      position: 'absolute',
                      top: -20,
                      bottom: -20,
                      width: 120,
                      left: -160 + shine * (INNER_W + 200),
                      transform: 'skewX(-18deg)',
                      background: 'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,.45) 50%, rgba(255,255,255,0) 100%)',
                    }}
                  />
                </div>
              </Decor>
            ) : null}
          </div>

          {/* Dots stream from the sources into the missing part. */}
          {chips.length > 0 ? (
            <Decor>
              {Array.from({length: 18}, (_, i) => {
                const start = T.stream[0] + noise(i, 1) * 20;
                const t = (f - start) / 12;
                if (t <= 0 || t >= 1) return null;
                const x0 = INNER_W * (0.42 + 0.56 * noise(i, 2));
                const y0 = CHIP_H / 2;
                const x1 = knownW + BAR_GAP + missW * (0.2 + 0.6 * noise(i, 3));
                const y1 = barTop + BAR_H * 0.5;
                const e = t * t * (3 - 2 * t);
                const x = x0 + (x1 - x0) * e;
                const y = y0 + (y1 - y0) * e - Math.sin(Math.PI * e) * 40;
                const s = 10 + 6 * noise(i, 4);
                return (
                  <div
                    key={i}
                    style={{
                      position: 'absolute',
                      left: x - s / 2,
                      top: y - s / 2,
                      width: s,
                      height: s,
                      borderRadius: '50%',
                      background: COLORS.accent,
                      boxShadow: '0 0 10px rgba(61,134,240,.6)',
                      opacity: Math.sin(Math.PI * t),
                    }}
                  />
                );
              })}
            </Decor>
          ) : null}
        </div>

        {headline ? (
          <div
            style={{
              ...fadeUp(head, 22),
              marginTop: 46,
              fontSize: 56,
              fontWeight: 700,
              letterSpacing: TRACK.h2,
              lineHeight: 1.12,
              color: COLORS.ink,
              textWrap: 'balance',
            }}
          >
            {headline}
          </div>
        ) : null}
      </Card3D>
    </Stage3D>
  );
};

// ---------------------------------------------------------------------------

export const SplitBar: React.FC<SplitBarProps> = (props) => {
  const {f, fps} = useClipTimeline(SPLIT_BAR_BASE, props.durationInFrames, SPLIT_BAR_MIN, SPLIT_BAR_MAX);
  const card = <SplitBarCard {...props} f={f} fps={fps} />;
  const page =
    props.format === 'wide' ? (
      <WideStage side={props.side === 'right' ? 'right' : 'left'} showSafeZones={props.showSafeZones}>
        {card}
      </WideStage>
    ) : (
      <VerticalStage showSafeZones={props.showSafeZones}>{card}</VerticalStage>
    );
  return <SeeThrough on={props.transparent}>{page}</SeeThrough>;
};

const size = (format?: SplitBarFormat) =>
  format === 'wide' ? {width: SPLIT_BAR_WIDE.width, height: SPLIT_BAR_WIDE.height} : {width: FRAME.width, height: FRAME.height};

// Stills:  npx remotion still src/index.ts SplitBar out/split-bar.png --frame=96
//          npx remotion still src/index.ts SplitBarWide out/split-bar-wide.png --frame=96
// Line 2:  --props='{"knownLabel":null,"missingLabel":null,"headline":"That\'s where the other 20% comes from.","fillGap":true,"sources":["thousands of data points","hundreds of files"]}'
export const SplitBarCompositions: React.FC = () => (
  <>
    <Composition
      id="SplitBar"
      component={SplitBar}
      durationInFrames={SPLIT_BAR_BASE}
      fps={FRAME.fps}
      width={FRAME.width}
      height={FRAME.height}
      defaultProps={splitBarDefaults}
      calculateMetadata={({props}) => ({durationInFrames: splitBarDuration(props.durationInFrames), ...size(props.format)})}
    />
    <Composition
      id="SplitBarWide"
      component={SplitBar}
      durationInFrames={SPLIT_BAR_BASE}
      fps={SPLIT_BAR_WIDE.fps}
      width={SPLIT_BAR_WIDE.width}
      height={SPLIT_BAR_WIDE.height}
      defaultProps={{...splitBarDefaults, format: 'wide' as const}}
      calculateMetadata={({props}) => ({durationInFrames: splitBarDuration(props.durationInFrames), ...size(props.format)})}
    />
  </>
);
