import React from 'react';
import {AbsoluteFill, Composition} from 'remotion';
import {
  BrandFrame,
  COLORS,
  Card3D,
  DASH,
  FONT_FAMILY,
  FRAME,
  Grid,
  P3D,
  SPECTRUM,
  Stage3D,
  TAG,
  TRACK,
  TYPE,
  WORDMARK,
  Wordmark,
  cardShadow,
  enter,
  fadeUp,
} from '../brand';
import {SeeThrough, useSeeThrough} from '../brand/Grid';
import {clampClip, useClipTimeline} from './clipTimeline';

// PathCards (Unit N3, animation-builds-2026-10-22). Two or three numbered cards, each a short title and one line, revealed one by one, with an optional highlight on one card. VSL three paths: "If your file is ready, we go get the capital." / "If something on your report is holding you back, we show you exactly what it is, optimize your credit for you, and fund you once your file is ready." / "And if you'd rather do the work yourself, that's the Capital Blueprint." Also the VSL's three mistakes, with tone "bad".
//
// The beat, in order: the eyebrow (if any) lands; card 1 slides in, then card
// 2, then card 3; if `highlight` names a card, it lifts and takes a ring while
// the others dim. Every word is a prop and comes from the script line.
//
// Two formats from one scene:
// - vertical: 1080x1920 for ads. Words stay in BrandFrame's band (y 269-1248).
// - wide: 3840x2160 (4K) for the VSL. Everything sits in ONE side panel chosen
//   by `side` (left x 192-1500, right x 2340-3648, both y 108-1512); nothing in
//   the middle column or the bottom 30%.
//
// No decoration: every pixel is a card or a word, so a render with
// --props '{"checkTextOnly":true}' is the same picture and the safe-zone scan
// checks all of it.

export type PathCardsFormat = 'vertical' | 'wide';
export type PathCardsSide = 'left' | 'right';

export type PathCard = {
  /** A few words, bold. */
  title: string;
  /** One line under the title. Null shows none. */
  line: string | null;
};

export type PathCardsProps = {
  /** "vertical" (1080x1920, ads) or "wide" (3840x2160, the VSL). */
  format?: PathCardsFormat;
  /** Wide only: which side panel holds everything. Default "left". */
  side?: PathCardsSide;
  /** Null hides it. */
  eyebrow: string | null;
  /** Two or three cards (one also works), in script order. */
  cards: PathCard[];
  /** Index of the card to lift after all are in (0, 1 or 2). Null lifts none. */
  highlight: number | null;
  /** "info" (blue, the paths) or "bad" (red, the mistakes). Default "info". */
  tone?: 'info' | 'bad';
  /** "stack" (one under the other, default) or "row" (side by side; best for two cards). */
  layout?: 'stack' | 'row';
  durationInFrames?: number;
  showSafeZones?: boolean;
  /** See-through: no page and no grid, so the clip renders with alpha (README.md). Default false. */
  transparent?: boolean;
};

// Words from the VSL's three paths, cut short.
export const pathCardsDefaults: PathCardsProps = {
  format: 'vertical',
  side: 'left',
  eyebrow: null,
  cards: [
    {title: 'Your file is ready', line: 'We go get the capital.'},
    {title: 'Something is holding you back', line: 'We optimize your credit for you, and fund you once your file is ready.'},
    {title: 'Do the work yourself', line: "That's the Capital Blueprint."},
  ],
  highlight: null,
  tone: 'info',
  layout: 'stack',
  transparent: false,
};

/** Base length 3.2 s; a shot list may ask for 2.5 to 4.5 s (75 to 135 frames). */
export const PATH_CARDS_BASE = 96;
export const PATH_CARDS_MIN = 75;
export const PATH_CARDS_MAX = 135;
/** Frame (on the base timeline) where every card is in and the highlight has landed. */
export const PATH_CARDS_HERO = 90;

export const pathCardsDuration = (requested?: number): number =>
  clampClip(requested, PATH_CARDS_BASE, PATH_CARDS_MIN, PATH_CARDS_MAX);

/** The wide frame (4K, 30 fps) and its two side panels (owner-set caption-safe rule, 2026-10-22). */
export const PATH_CARDS_WIDE = {width: 3840, height: 2160, fps: 30} as const;
const PANEL = {leftX: 192, rightX: 2340, top: 108, width: 1308, height: 1404} as const;
/** Wide size against the vertical design (900 px content width). */
const WIDE_U = 1.24;

// ---------------------------------------------------------------------------
// Timeline (frames on the 96-frame base)

const cardStart = (i: number, n: number): number => 8 + i * (n >= 3 ? 15 : 20);
const highlightStart = (n: number): number => cardStart(Math.max(0, n - 1), n) + 22;

const TONE = {
  info: {
    ring: COLORS.accent,
    stripe: COLORS.accent,
    disc: 'radial-gradient(circle at 34% 28%, #9CC2F8 0%, #3D86F0 52%, #2C67C2 100%)',
    discText: COLORS.white,
    discEdge: 'inset 0 0 0 3px rgba(255,255,255,.22)',
  },
  bad: {
    ring: TAG.bad.fg,
    stripe: TAG.bad.fg,
    disc: `radial-gradient(circle at 34% 28%, #FFFFFF 0%, ${TAG.bad.bg} 55%, #F3DAD7 100%)`,
    discText: TAG.bad.fg,
    discEdge: `inset 0 0 0 3px ${TAG.bad.border}`,
  },
} as const;

// ---------------------------------------------------------------------------
// Small pieces

/** Words over film need a backing: in see-through mode the plate turns white with a soft shadow. Same size either way. */
const Plate: React.FC<{u: number; children: React.ReactNode}> = ({u, children}) => {
  const seeThrough = useSeeThrough();
  return (
    <div
      style={{
        padding: `${16 * u}px ${30 * u}px`,
        borderRadius: 24 * u,
        background: seeThrough ? 'rgba(255,255,255,.97)' : 'transparent',
        boxShadow: seeThrough ? cardShadow(0.6 * u) : 'none',
      }}
    >
      {children}
    </div>
  );
};

const EyebrowU: React.FC<{text: string; u: number; p: number}> = ({text, u, p}) => (
  <div style={{display: 'flex', alignItems: 'center', gap: DASH.width * 0.56 * u, opacity: p}}>
    <span
      style={{
        display: 'inline-block',
        width: DASH.width * u,
        height: DASH.height * u,
        borderRadius: DASH.radius * u,
        background: SPECTRUM,
        transform: `scaleX(${p})`,
        transformOrigin: 'left center',
      }}
    />
    <span
      style={{
        fontSize: TYPE.eyebrow * u,
        fontWeight: 600,
        letterSpacing: TRACK.eyebrow,
        textTransform: 'uppercase',
        color: COLORS.gray,
        lineHeight: 1.2,
        whiteSpace: 'nowrap',
      }}
    >
      {text}
    </span>
  </div>
);

const Disc: React.FC<{n: number; size: number; tone: 'info' | 'bad'; pop: number}> = ({n, size, tone, pop}) => {
  const t = TONE[tone];
  return (
    <div
      style={{
        flex: '0 0 auto',
        width: size,
        height: size,
        borderRadius: '50%',
        background: t.disc,
        boxShadow: `${t.discEdge}, 0 ${size * 0.12}px ${size * 0.22}px rgba(10,10,10,.14)`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size * 0.4,
        fontWeight: 700,
        color: t.discText,
        fontVariantNumeric: 'tabular-nums',
        transform: `scale(${0.7 + 0.3 * pop}) rotate(${(1 - pop) * -40}deg)`,
      }}
    >
      {String(n).padStart(2, '0')}
    </div>
  );
};

// ---------------------------------------------------------------------------
// The scene, drawn at `u` times the vertical design size (900 px wide).

const Scene: React.FC<PathCardsProps & {f: number; fps: number; u: number}> = ({f, fps, u, eyebrow, cards, highlight, tone = 'info', layout = 'stack'}) => {
  const list = cards.slice(0, 3);
  const n = list.length;
  const row = layout === 'row' && n > 1;
  const t = TONE[tone];
  const width = 900 * u;
  const gap = (row ? 24 : 26) * u;
  const cardW = row ? (width - gap * (n - 1)) / n : width;
  const titleSize = (row ? (n >= 3 ? 36 : 44) : 46) * u;
  const lineSize = (row ? (n >= 3 ? 28 : 32) : 34) * u;
  const discSize = (row ? 64 : 76) * u;
  const hi = highlight === null || highlight < 0 || highlight >= n ? -1 : Math.round(highlight);
  const hl = hi >= 0 ? enter(f, fps, highlightStart(n), 16) : 0;

  return (
    <>
      {eyebrow ? (
        <div style={{...fadeUp(enter(f, fps, 0, 14), 20 * u), marginBottom: 34 * u}}>
          <Plate u={u}>
            <EyebrowU text={eyebrow} u={u} p={enter(f, fps, 0, 14)} />
          </Plate>
        </div>
      ) : null}
      <div style={{display: 'flex', flexDirection: row ? 'row' : 'column', alignItems: row ? 'stretch' : 'center', gap, width, ...P3D}}>
        {list.map((card, i) => {
          const start = cardStart(i, n);
          const p = enter(f, fps, start, 16);
          const words = enter(f, fps, start + 4, 14);
          const isHi = i === hi;
          const lift = isHi ? hl : 0;
          // The others dim their words only; the card stays solid so it still reads over film.
          const dim = hi >= 0 && !isHi ? 1 - 0.55 * hl : 1;
          return (
            <Card3D
              key={card.title}
              enter={p}
              from={row ? 'below' : 'right'}
              z={24 + 40 * lift}
              tilt={{rx: 3, ry: row ? (i - (n - 1) / 2) * -4 : -4}}
              elevation={(1 + 0.6 * lift) * u}
              radius={28 * u}
              padding={row ? `${30 * u}px ${30 * u}px ${34 * u}px` : `${30 * u}px ${40 * u}px ${30 * u}px ${46 * u}px`}
              width={cardW}
              style={{
                flex: '0 0 auto',
                opacity: p,
                scale: `${1 + 0.035 * lift}`,
                boxShadow: `0 0 0 ${4 * u * lift}px ${t.ring}, ${cardShadow((1 + 0.6 * lift) * u)}`,
                overflow: 'hidden',
              }}
            >
              {/* tone stripe down the left edge */}
              <div
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: (row ? 0 : 8) * u,
                  background: t.stripe,
                  opacity: 0.85,
                }}
              />
              <div style={{display: 'flex', flexDirection: row ? 'column' : 'row', alignItems: row ? 'flex-start' : 'center', gap: (row ? 22 : 32) * u, opacity: dim}}>
                <Disc n={i + 1} size={discSize} tone={tone} pop={enter(f, fps, start + 3, 14)} />
                <div style={{...fadeUp(words, 14 * u), display: 'flex', flexDirection: 'column', minWidth: 0}}>
                  <div style={{fontSize: titleSize, fontWeight: 800, letterSpacing: TRACK.h2, lineHeight: 1.08, color: COLORS.ink, textWrap: 'balance'}}>
                    {card.title}
                  </div>
                  {card.line ? (
                    <div
                      style={{
                        marginTop: 10 * u,
                        fontSize: lineSize,
                        fontWeight: 500,
                        letterSpacing: TRACK.body,
                        lineHeight: 1.24,
                        color: COLORS.gray,
                        textWrap: 'pretty',
                      }}
                    >
                      {card.line}
                    </div>
                  ) : null}
                </div>
              </div>
            </Card3D>
          );
        })}
      </div>
    </>
  );
};

// ---------------------------------------------------------------------------
// Vertical (ads)

const Vertical: React.FC<PathCardsProps & {f: number; fps: number}> = (props) => (
  <BrandFrame showSafeZones={props.showSafeZones}>
    <Stage3D f={props.f} length={PATH_CARDS_BASE} drift={0.8}>
      <Scene {...props} u={1} />
    </Stage3D>
  </BrandFrame>
);

// ---------------------------------------------------------------------------
// Wide (the VSL), 3840x2160, one side panel

const PanelGuide: React.FC<{left: number}> = ({left}) => (
  <AbsoluteFill style={{pointerEvents: 'none'}}>
    <div style={{position: 'absolute', left: 1500, width: 840, top: 0, bottom: 0, background: 'rgba(220,38,38,.07)'}} />
    <div style={{position: 'absolute', left: 0, right: 0, top: 1512, bottom: 0, background: 'rgba(220,38,38,.07)'}} />
    <div style={{position: 'absolute', left, top: PANEL.top, width: PANEL.width, height: PANEL.height, border: '6px solid #DC2626', boxSizing: 'border-box'}} />
  </AbsoluteFill>
);

const Wide: React.FC<PathCardsProps & {f: number; fps: number}> = (props) => {
  const left = props.side === 'right' ? PANEL.rightX : PANEL.leftX;
  return (
    <AbsoluteFill style={{fontFamily: FONT_FAMILY, color: COLORS.ink, WebkitFontSmoothing: 'antialiased'}}>
      <Grid />
      <div style={{position: 'absolute', left, top: PANEL.top, width: PANEL.width, height: PANEL.height, overflow: 'hidden'}}>
        <div style={{position: 'absolute', left: 0, right: 0, top: 60, display: 'flex', justifyContent: 'center'}}>
          <Wordmark width={WORDMARK.width * 1.5} />
        </div>
        <div style={{position: 'absolute', left: 0, right: 0, top: 190, bottom: 30}}>
          <Stage3D f={props.f} length={PATH_CARDS_BASE} drift={0.8} perspective={2400 * WIDE_U}>
            <Scene {...props} u={WIDE_U} />
          </Stage3D>
        </div>
      </div>
      {props.showSafeZones ? <PanelGuide left={left} /> : null}
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------------------

export const PathCards: React.FC<PathCardsProps> = (props) => {
  const {f, fps} = useClipTimeline(PATH_CARDS_BASE, props.durationInFrames, PATH_CARDS_MIN, PATH_CARDS_MAX);
  const page = props.format === 'wide' ? <Wide {...props} f={f} fps={fps} /> : <Vertical {...props} f={f} fps={fps} />;
  return <SeeThrough on={props.transparent}>{page}</SeeThrough>;
};

const size = (format?: PathCardsFormat) =>
  format === 'wide' ? {width: PATH_CARDS_WIDE.width, height: PATH_CARDS_WIDE.height} : {width: FRAME.width, height: FRAME.height};

// Stills:  npx remotion still src/index.ts PathCards out/path-cards.png --frame=90
//          npx remotion still src/index.ts PathCardsWide out/path-cards-wide.png --frame=90
// PathCards with --props '{"format":"wide"}' is the same as PathCardsWide.
export const PathCardsCompositions: React.FC = () => (
  <>
    <Composition
      id="PathCards"
      component={PathCards}
      durationInFrames={PATH_CARDS_BASE}
      fps={FRAME.fps}
      width={FRAME.width}
      height={FRAME.height}
      defaultProps={pathCardsDefaults}
      calculateMetadata={({props}) => ({durationInFrames: pathCardsDuration(props.durationInFrames), ...size(props.format)})}
    />
    <Composition
      id="PathCardsWide"
      component={PathCards}
      durationInFrames={PATH_CARDS_BASE}
      fps={PATH_CARDS_WIDE.fps}
      width={PATH_CARDS_WIDE.width}
      height={PATH_CARDS_WIDE.height}
      defaultProps={{...pathCardsDefaults, format: 'wide' as const}}
      calculateMetadata={({props}) => ({durationInFrames: pathCardsDuration(props.durationInFrames), ...size(props.format)})}
    />
  </>
);
