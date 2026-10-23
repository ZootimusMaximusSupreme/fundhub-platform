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
  TRACK,
  WORDMARK,
  Wordmark,
  enter,
  fadeUp,
  progressBetween,
} from '../brand';
import {SeeThrough, useSeeThrough} from '../brand/Grid';
import {clampClip, useClipTimeline} from './clipTimeline';

// A row of people where only some light up: "1 in 8" as a picture, with the caption under it.
//
// Unit N6 (ops/workflows/animation-builds-2026-10-22.md), Capital Blueprint
// Ads 1 and 2: "Only about 1 in 8 people finish an online course they sign up
// for." The defaults draw 8 people and light 1.
//
// The beat: the card comes forward and "1 in 8" lands at the top; the people
// pop in one by one, gray; a soft light runs across the row; the lit ones turn
// blue, lift a little and glow while the rest fade back; the caption comes
// last. The big line is built from the props ("<lit> in <total>"), so it can
// never disagree with the picture. The caption is a prop and reads on from it.
// Up to 10 people sit in one row; more wrap into even rows (40 at most).
//
// Two formats from one card:
// - vertical 1080x1920 (ads): the card sits inside the text-safe band
//   (y 269-1248), under the wordmark when the page is on.
// - wide 3840x2160 (the sideways 4K VSL and thank-you video): the same card,
//   drawn bigger, in ONE side panel picked by `side` (left x 192-1500, right
//   x 2340-3648, both y 108-1512). Nothing in the middle column (the face) or
//   the bottom 30% (the captions). No wordmark in the wide format.
// See-through (`transparent`): the paper and grid drop out; the card stays, so
// every word sits on solid white and reads over any film. The light sweep and
// the glow are Decor, so a `checkTextOnly` render drops them.

export type IconCountFormat = 'vertical' | 'wide';
export type IconCountSide = 'left' | 'right';

export type IconCountProps = {
  /** "vertical" (1080x1920, ads) or "wide" (3840x2160, the VSL and thank-you video). */
  format?: IconCountFormat;
  /** Wide only: which side panel holds the card. The face is in the middle. Default "left". */
  side?: IconCountSide;
  /** How many people are drawn (1 to 40). */
  total: number;
  /** How many of them light up (0 to total). */
  lit: number;
  /** The words under the people; they read on from the big "<lit> in <total>". Null hides them. */
  caption: string | null;
  durationInFrames?: number;
  showSafeZones?: boolean;
  /** See-through: no page and no grid, so the clip renders with alpha (README.md). Default false. */
  transparent?: boolean;
};

export const iconCountDefaults: IconCountProps = {
  format: 'vertical',
  side: 'left',
  total: 8,
  lit: 1,
  caption: 'people finish an online course they sign up for.',
  transparent: false,
};

/** Base length 3 s; a shot list may ask for 2.5 to 4 s (75 to 120 frames). */
export const ICON_COUNT_BASE = 90;
export const ICON_COUNT_MIN = 75;
export const ICON_COUNT_MAX = 120;
/** Frame (on the base timeline) where every beat is on screen: people lit, caption in. */
export const ICON_COUNT_HERO = 84;

export const iconCountDuration = (requested?: number): number => clampClip(requested, ICON_COUNT_BASE, ICON_COUNT_MIN, ICON_COUNT_MAX);

/** The wide frame: 4K, 30 fps. */
export const ICON_COUNT_WIDE = {width: 3840, height: 2160, fps: 30} as const;

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

const WideZoneGuide: React.FC<{side: IconCountSide}> = ({side}) => (
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

const WideStage: React.FC<{side: IconCountSide; showSafeZones?: boolean; children: React.ReactNode}> = ({side, showSafeZones, children}) => (
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
// Timeline (frames on the 90-frame base)

const T = {
  card: 0,
  ratio: 5,
  people: [10, 34] as const,
  sweep: [34, 52] as const,
  light: 46,
  caption: 56,
} as const;

const CARD_W = 900;
const PAD_X = 56;
const INNER_W = CARD_W - PAD_X * 2; // 788
const ROW_GAP = 16;
const MAX_PER_ROW = 10;
const MAX_ICON_W = 92;
const ICON_RATIO = 1.36; // height / width

/** Which people light up: spread evenly along the row, so 1 of 8 is near the middle. */
export const litIndexes = (total: number, lit: number): Set<number> => {
  const out = new Set<number>();
  for (let i = 0; i < lit; i++) out.add(Math.min(total - 1, Math.round(((i + 0.5) * total) / lit - 0.5)));
  return out;
};

/** A person: round head, rounded shoulders. Drawn in a 100 x 136 box. */
const Person: React.FC<{w: number; fill: string; shade: string}> = ({w, fill, shade}) => (
  <svg width={w} height={w * ICON_RATIO} viewBox="0 0 100 136" style={{display: 'block', overflow: 'visible'}}>
    <circle cx={50} cy={30} r={25} fill={fill} />
    <path d="M8 136 V106 C8 82 27 66 50 66 C73 66 92 82 92 106 V136 Z" fill={fill} />
    <path d="M8 136 V122 C30 130 70 130 92 122 V136 Z" fill={shade} />
  </svg>
);

const IconCountCard: React.FC<IconCountProps & {f: number; fps: number}> = ({total, lit, caption, f, fps}) => {
  const n = Math.max(1, Math.min(40, Math.round(total)));
  const k = Math.max(0, Math.min(n, Math.round(lit)));
  const rows = Math.ceil(n / MAX_PER_ROW);
  const perRow = Math.ceil(n / rows);
  const iconW = Math.min(MAX_ICON_W, (INNER_W - (perRow - 1) * ROW_GAP) / perRow) * (rows > 2 ? 0.8 : 1);
  const lights = litIndexes(n, k);

  const card = enter(f, fps, T.card, 16);
  const ratio = enter(f, fps, T.ratio, 16);
  const sweep = progressBetween(f, T.sweep[0], T.sweep[1]);
  const light = enter(f, fps, T.light, 14);
  const cap = enter(f, fps, T.caption, 16);
  const stagger = n > 1 ? (T.people[1] - T.people[0] - 10) / (n - 1) : 0;

  return (
    <Stage3D f={f} length={ICON_COUNT_BASE} drift={0.7}>
      <Card3D enter={card} z={30} tilt={{rx: 2, ry: -2}} width={CARD_W} padding={`50px ${PAD_X}px 56px`} elevation={0.85}>
        {/* The spectrum hairline across the top of the card. */}
        <div style={{position: 'absolute', inset: 0, borderRadius: 28, overflow: 'hidden', pointerEvents: 'none'}}>
          <div style={{position: 'absolute', left: 0, right: 0, top: 0, height: 6, background: SPECTRUM, opacity: card}} />
        </div>
        <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center'}}>
          {/* The big line: "<lit> in <total>". */}
          <div
            style={{
              ...fadeUp(ratio, 22),
              fontSize: 150,
              fontWeight: 800,
              letterSpacing: TRACK.h1,
              lineHeight: 1,
              color: COLORS.ink,
              fontVariantNumeric: 'tabular-nums',
              whiteSpace: 'nowrap',
            }}
          >
            <span style={{color: COLORS.accent}}>{k}</span> in {n}
          </div>

          {/* The people. */}
          <div
            style={{
              position: 'relative',
              marginTop: 44,
              width: INNER_W,
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'center',
              columnGap: ROW_GAP,
              rowGap: 18,
            }}
          >
            {Array.from({length: n}, (_, i) => {
              const inP = enter(f, fps, T.people[0] + i * stagger, 12);
              const on = lights.has(i);
              const lift = on ? light : 0;
              const dim = on ? 0 : light;
              // Gray while they arrive; the lit ones turn blue, the rest fade back.
              const fill = on && light > 0.5 ? COLORS.accent : dim > 0.5 ? '#E4E4E7' : '#C9C9CF';
              const shade = on && light > 0.5 ? '#2F6FD6' : dim > 0.5 ? '#D9D9DE' : '#B9B9C0';
              return (
                <div
                  key={i}
                  style={{
                    position: 'relative',
                    width: iconW,
                    height: iconW * ICON_RATIO,
                    opacity: inP,
                    transform: `translateY(${(1 - inP) * 26 - lift * 10}px) scale(${0.7 + 0.3 * inP + 0.1 * lift})`,
                    transformOrigin: '50% 100%',
                  }}
                >
                  {on ? (
                    <Decor>
                      <div
                        style={{
                          position: 'absolute',
                          left: -iconW * 0.45,
                          right: -iconW * 0.45,
                          top: -iconW * 0.3,
                          bottom: -iconW * 0.2,
                          borderRadius: '50%',
                          background: 'radial-gradient(closest-side, rgba(61,134,240,.30), rgba(61,134,240,.10) 60%, rgba(61,134,240,0))',
                          opacity: light,
                        }}
                      />
                    </Decor>
                  ) : null}
                  <div style={{position: 'relative'}}>
                    <Person w={iconW} fill={fill} shade={shade} />
                  </div>
                </div>
              );
            })}
            {/* The soft light that runs across the row before they light up. */}
            {sweep > 0 && sweep < 1 ? (
              <Decor>
                <div
                  style={{
                    position: 'absolute',
                    top: -10,
                    bottom: -10,
                    width: 140,
                    left: -140 + sweep * (INNER_W + 140),
                    background: 'linear-gradient(90deg, rgba(61,134,240,0) 0%, rgba(61,134,240,.16) 50%, rgba(61,134,240,0) 100%)',
                    borderRadius: 40,
                  }}
                />
              </Decor>
            ) : null}
          </div>

          {caption ? (
            <div
              style={{
                ...fadeUp(cap, 22),
                marginTop: 46,
                maxWidth: INNER_W,
                fontSize: 54,
                fontWeight: 700,
                letterSpacing: TRACK.h2,
                lineHeight: 1.14,
                color: COLORS.ink,
                textAlign: 'center',
                textWrap: 'balance',
              }}
            >
              {caption}
            </div>
          ) : null}
        </div>
      </Card3D>
    </Stage3D>
  );
};

// ---------------------------------------------------------------------------

export const IconCount: React.FC<IconCountProps> = (props) => {
  const {f, fps} = useClipTimeline(ICON_COUNT_BASE, props.durationInFrames, ICON_COUNT_MIN, ICON_COUNT_MAX);
  const card = <IconCountCard {...props} f={f} fps={fps} />;
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

const size = (format?: IconCountFormat) =>
  format === 'wide' ? {width: ICON_COUNT_WIDE.width, height: ICON_COUNT_WIDE.height} : {width: FRAME.width, height: FRAME.height};

// Stills:  npx remotion still src/index.ts IconCount out/icon-count.png --frame=84
//          npx remotion still src/index.ts IconCountWide out/icon-count-wide.png --frame=84
export const IconCountCompositions: React.FC = () => (
  <>
    <Composition
      id="IconCount"
      component={IconCount}
      durationInFrames={ICON_COUNT_BASE}
      fps={FRAME.fps}
      width={FRAME.width}
      height={FRAME.height}
      defaultProps={iconCountDefaults}
      calculateMetadata={({props}) => ({durationInFrames: iconCountDuration(props.durationInFrames), ...size(props.format)})}
    />
    <Composition
      id="IconCountWide"
      component={IconCount}
      durationInFrames={ICON_COUNT_BASE}
      fps={ICON_COUNT_WIDE.fps}
      width={ICON_COUNT_WIDE.width}
      height={ICON_COUNT_WIDE.height}
      defaultProps={{...iconCountDefaults, format: 'wide' as const}}
      calculateMetadata={({props}) => ({durationInFrames: iconCountDuration(props.durationInFrames), ...size(props.format)})}
    />
  </>
);
