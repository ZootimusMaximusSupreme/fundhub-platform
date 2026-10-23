import React from 'react';
import {AbsoluteFill, Composition, interpolate} from 'remotion';
import {
  COLORS,
  Card3D,
  CashStack,
  Decor,
  DollarCounter,
  Eyebrow,
  FONT_FAMILY,
  FRAME,
  Grid,
  P3D,
  SAFE,
  SAFE_HEIGHT,
  SafeZoneGuide,
  Stage3D,
  TAG,
  TRACK,
  WORDMARK,
  Wordmark,
  enter,
  fadeUp,
  progressBetween,
} from '../brand';
import {SeeThrough, useSeeThrough} from '../brand/Grid';
import {clampClip, useClipTimeline} from './clipTimeline';

// TwoPeople (Unit N7, ops/workflows/animation-builds-2026-10-22.md): two people side by side and what each one walks out of the bank with, or one highest-limit card and the new approvals banks size from it.
//
// Two modes, one template:
// - "compare" (the default, Direct Book Ad 9): "A guy making three hundred
//   thousand dollars a year ... gets approved for eight thousand dollars, while
//   his buddy making half that walks out of the same bank the same week with
//   eighty." Two person cards side by side. Each amount rolls up and a bar and
//   a cash stack grow to its size, so the gap is plain to see. The last beat is
//   the footer: "One thing on their credit reports".
// - "highestLimit" (Direct Book Ad 9): "It's your highest limit card. Banks look
//   at the biggest limit another bank has already given you, and they'll
//   approve you for one to two times that amount depending on the bank." One
//   dark card (the highest limit), then two new approval cards sized 1x and 2x
//   of it. No dollar amount appears unless `card.limit` is passed.
//
// Every word on screen comes from props. The default props are the compare
// line's exact words.
//
// Two formats from one scene:
// - vertical 1080x1920 (ads): the wordmark and the content sit in the
//   text-safe band (y 269-1248).
// - wide 3840x2160 (the sideways 4K VSL and thank-you video): everything sits
//   in ONE side panel picked by `side` (left x 192-1500, right x 2340-3648,
//   both y 108-1512). The middle column (the face) and the bottom 30% (the
//   captions) stay empty. No wordmark in the wide format.
// See-through (`transparent`): no page and no grid; every word and card sits
// on one white plate inside the allowed zone, so it reads over any film.
// Cash stacks and the sheen are wrapped in Decor, so a checkTextOnly render
// keeps only the plate, cards and words.

export type TwoPeopleFormat = 'vertical' | 'wide';
export type TwoPeopleSide = 'left' | 'right';
export type TwoPeopleMode = 'compare' | 'highestLimit';

/** One person in the compare mode. `amount` rolls up; bars and stacks are drawn to scale against the other person. */
export type TwoPeoplePerson = {
  who: string;
  earnsLabel: string;
  earns: string;
  outcomeLabel: string;
  amount: number;
};

export type TwoPeopleProps = {
  /** "compare" (two people side by side) or "highestLimit" (one card, then 1x and 2x approvals). */
  mode: TwoPeopleMode;
  /** The label over the scene. Null hides it. */
  eyebrow: string | null;
  /** compare: the left person (the smaller result). */
  left: TwoPeoplePerson;
  /** compare: the right person (the bigger result, in blue). */
  right: TwoPeoplePerson;
  /** highestLimit: the dark card: `label` under it, `tag` on it. `limit` shows on the card only when passed (no amount is ever made up). */
  card: {label: string; tag: string; limit: number | null};
  /** highestLimit: the line over the new cards, and the low and high multiples drawn as 1x and 2x cards. */
  approvals: {label: string; low: number; high: number};
  /** The last line, in a chip under the scene. Null hides it. */
  footer: string | null;
  /** "vertical" (1080x1920, ads; the default) or "wide" (3840x2160, the sideways 4K VSL and thank-you video). */
  format?: TwoPeopleFormat;
  /** Wide only: the side panel everything sits in, so the face and the captions in the middle stay clear. Default "left". */
  side?: TwoPeopleSide;
  durationInFrames?: number;
  showSafeZones?: boolean;
  /** See-through: no page and no grid, so the clip renders with alpha (README.md). Default false. */
  transparent?: boolean;
};

export const twoPeopleDefaults: TwoPeopleProps = {
  mode: 'compare',
  eyebrow: 'Same bank, same week',
  left: {who: 'A guy', earnsLabel: 'Making', earns: '$300,000 a year', outcomeLabel: 'Approved for', amount: 8000},
  right: {who: 'His buddy', earnsLabel: 'Making', earns: 'Half that', outcomeLabel: 'Walks out with', amount: 80000},
  card: {label: 'Your highest limit card', tag: 'Highest limit', limit: null},
  approvals: {label: 'One to two times that amount', low: 1, high: 2},
  footer: 'One thing on their credit reports',
  format: 'vertical',
  side: 'left',
  transparent: false,
};

/** Base length 3.5 s; a shot list may ask for 3 to 4 s (90 to 120 frames). */
export const TWO_PEOPLE_BASE = 105;
export const TWO_PEOPLE_MIN = 90;
export const TWO_PEOPLE_MAX = 120;
/** Frame (on the base timeline) where every beat is on screen. */
export const TWO_PEOPLE_HERO = 96;

export const twoPeopleDuration = (requested?: number): number =>
  clampClip(requested, TWO_PEOPLE_BASE, TWO_PEOPLE_MIN, TWO_PEOPLE_MAX);

// ---------------------------------------------------------------------------
// Frame: vertical band or one wide side panel, with the see-through plate.

const WIDE = {width: 3840, height: 2160, fps: 30} as const;
const PANEL = {left: 192, right: 2340, top: 108, width: 1308, height: 1404} as const;
/** The scene is laid out in this box (design px). Vertical draws it 1:1 at y 400; wide scales it into the panel. */
const BOX = {w: 900, h: 800} as const;
const PLATE_PAD = 50;
const SHADOW_ROOM = 40;
const WIDE_SCALE = (PANEL.width - SHADOW_ROOM * 2) / (BOX.w + PLATE_PAD * 2); // 1.228
const VERTICAL_PLATE = {left: 36, top: 277, width: 1008, height: 945} as const; // y 277-1222, inside 269-1248
const VERTICAL_BOX_TOP = 400;

const PLATE_SHADOW = ['0 0 0 1px rgba(10,10,10,.05)', '0 5px 0 -2px #DCDCE1', '0 8px 18px rgba(10,10,10,.16)', '0 2px 6px rgba(10,10,10,.06)'].join(', ');

const Plate: React.FC<{style: React.CSSProperties}> = ({style}) => (
  <div
    style={{
      position: 'absolute',
      borderRadius: 40,
      background: 'linear-gradient(170deg, #FFFFFF 0%, #FFFFFF 60%, #FAFAFB 100%)',
      border: '2px solid #ECECEF',
      boxShadow: PLATE_SHADOW,
      ...style,
    }}
  />
);

const WideZoneGuide: React.FC<{side: TwoPeopleSide}> = ({side}) => (
  <AbsoluteFill style={{pointerEvents: 'none'}}>
    <div
      style={{
        position: 'absolute',
        left: side === 'right' ? PANEL.right : PANEL.left,
        top: PANEL.top,
        width: PANEL.width,
        height: PANEL.height,
        border: '6px solid #DC2626',
        boxShadow: '0 0 0 9999px rgba(220,38,38,.07)',
      }}
    />
  </AbsoluteFill>
);

const Frame: React.FC<{format?: TwoPeopleFormat; side?: TwoPeopleSide; showSafeZones?: boolean; children: React.ReactNode}> = ({
  format = 'vertical',
  side = 'left',
  showSafeZones = false,
  children,
}) => {
  const seeThrough = useSeeThrough();
  const base: React.CSSProperties = {fontFamily: FONT_FAMILY, color: COLORS.ink, WebkitFontSmoothing: 'antialiased'};
  if (format === 'wide') {
    const plateW = (BOX.w + PLATE_PAD * 2) * WIDE_SCALE;
    const plateH = (BOX.h + PLATE_PAD * 2) * WIDE_SCALE;
    const plateX = (PANEL.width - plateW) / 2;
    const plateY = (PANEL.height - plateH) / 2;
    return (
      <AbsoluteFill style={base}>
        <Grid />
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
          {seeThrough ? <Plate style={{left: plateX, top: plateY, width: plateW, height: plateH}} /> : null}
          <div
            style={{
              position: 'absolute',
              left: plateX + PLATE_PAD * WIDE_SCALE,
              top: plateY + PLATE_PAD * WIDE_SCALE,
              width: BOX.w,
              height: BOX.h,
              transformOrigin: '0 0',
              transform: `scale(${WIDE_SCALE})`,
            }}
          >
            {children}
          </div>
        </div>
        {showSafeZones ? <WideZoneGuide side={side} /> : null}
      </AbsoluteFill>
    );
  }
  return (
    <AbsoluteFill style={base}>
      <Grid />
      <div style={{position: 'absolute', left: 0, right: 0, top: SAFE.top, height: SAFE_HEIGHT, overflow: 'hidden'}}>
        {seeThrough ? (
          <Plate
            style={{left: VERTICAL_PLATE.left, top: VERTICAL_PLATE.top - SAFE.top, width: VERTICAL_PLATE.width, height: VERTICAL_PLATE.height}}
          />
        ) : null}
        <div style={{position: 'absolute', left: 0, right: 0, top: WORDMARK.top - SAFE.top, display: 'flex', justifyContent: 'center'}}>
          <Wordmark width={WORDMARK.width} />
        </div>
        <div
          style={{
            position: 'absolute',
            left: (FRAME.width - BOX.w) / 2,
            top: VERTICAL_BOX_TOP - SAFE.top,
            width: BOX.w,
            height: BOX.h,
          }}
        >
          {children}
        </div>
      </div>
      {showSafeZones ? <SafeZoneGuide /> : null}
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------------------
// Pieces

const SMALL_CAPS: React.CSSProperties = {
  fontSize: 21,
  fontWeight: 600,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: COLORS.gray2,
  lineHeight: 1.2,
};

/** A plain person glyph (head and shoulders), no face. */
const PersonGlyph: React.FC<{size: number; tone: 'gray' | 'accent'}> = ({size, tone}) => {
  const bg = tone === 'accent' ? 'linear-gradient(160deg, #5C9BF3 0%, #3D86F0 100%)' : 'linear-gradient(160deg, #E4E4E7 0%, #D4D4D8 100%)';
  const fg = tone === 'accent' ? 'rgba(255,255,255,.95)' : '#A1A1AA';
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: bg,
        overflow: 'hidden',
        flex: '0 0 auto',
        boxShadow: tone === 'accent' ? '0 8px 18px rgba(61,134,240,.28)' : '0 6px 14px rgba(10,10,10,.08)',
      }}
    >
      <svg width={size} height={size} viewBox="0 0 100 100">
        <circle cx="50" cy="40" r="17" fill={fg} />
        <path d="M14 100 C14 74 30 62 50 62 C70 62 86 74 86 100 Z" fill={fg} />
      </svg>
    </div>
  );
};

const PersonCard: React.FC<{
  person: TwoPeoplePerson;
  tone: 'gray' | 'accent';
  ratio: number;
  f: number;
  fps: number;
  at: number;
  from: 'left' | 'right';
}> = ({person, tone, ratio, f, fps, at, from}) => {
  const inP = enter(f, fps, at, 16);
  const grow = progressBetween(f, 26, 60);
  const accent = tone === 'accent';
  return (
    <Card3D enter={inP} from={from} z={accent ? 60 : 30} tilt={{ry: from === 'left' ? 4 : -4}} width={420} padding="34px 34px 30px" radius={32}>
      <PersonGlyph size={84} tone={tone} />
      <div style={{marginTop: 18, fontSize: 40, fontWeight: 800, letterSpacing: TRACK.h2, lineHeight: 1.05, whiteSpace: 'nowrap'}}>{person.who}</div>
      <div style={{marginTop: 26, ...SMALL_CAPS}}>{person.earnsLabel}</div>
      <div style={{marginTop: 8, fontSize: 38, fontWeight: 700, letterSpacing: TRACK.h2, lineHeight: 1.1, color: COLORS.ink2, whiteSpace: 'nowrap'}}>
        {person.earns}
      </div>
      <div style={{height: 2, background: COLORS.line, margin: '28px 0 24px'}} />
      <div style={SMALL_CAPS}>{person.outcomeLabel}</div>
      <div style={{marginTop: 6, height: 92, display: 'flex', alignItems: 'center', color: accent ? COLORS.accent : COLORS.ink}}>
        <DollarCounter value={person.amount} f={f} start={22} end={56} size={84} color={accent ? COLORS.accent : COLORS.ink} />
      </div>
      <div style={{marginTop: 18, height: 16, borderRadius: 8, background: COLORS.soft, overflow: 'hidden'}}>
        <div
          style={{
            width: `${Math.max(3, ratio * 100 * grow)}%`,
            height: '100%',
            borderRadius: 8,
            background: accent ? 'linear-gradient(90deg, #6FA6F5 0%, #3D86F0 100%)' : '#A1A1AA',
          }}
        />
      </div>
    </Card3D>
  );
};

/** The last line: a chip with the brand dash. */
const FooterChip: React.FC<{text: string; p: number}> = ({text, p}) => (
  <div
    style={{
      ...fadeUp(p, 24),
      display: 'inline-flex',
      alignItems: 'center',
      gap: 16,
      padding: '18px 30px',
      borderRadius: 999,
      background: TAG.info.bg,
      border: `2px solid ${TAG.info.border}`,
      boxShadow: '0 10px 24px rgba(61,134,240,.14)',
      fontSize: 32,
      fontWeight: 700,
      letterSpacing: TRACK.body,
      color: COLORS.ink,
      whiteSpace: 'nowrap',
    }}
  >
    <span style={{width: 14, height: 14, borderRadius: '50%', background: COLORS.accent, flex: '0 0 auto'}} />
    {text}
  </div>
);

const Compare: React.FC<TwoPeopleProps & {f: number; fps: number}> = ({f, fps, eyebrow, left, right, footer}) => {
  const top = Math.max(1, left.amount, right.amount);
  const grow = progressBetween(f, 26, 60);
  return (
    <Stage3D f={f} length={TWO_PEOPLE_BASE} drift={0.6} style={{justifyContent: 'flex-start'}}>
      {eyebrow ? (
        <div style={{...fadeUp(enter(f, fps, 0, 14)), height: 40}}>
          <Eyebrow text={eyebrow} progress={enter(f, fps, 0, 14)} />
        </div>
      ) : null}
      <div style={{...P3D, display: 'flex', gap: 40, marginTop: 40, alignItems: 'flex-end'}}>
        <div style={{...P3D, position: 'relative'}}>
          <PersonCard person={left} tone="gray" ratio={left.amount / top} f={f} fps={fps} at={4} from="left" />
          <StackOnCard ratio={left.amount / top} grow={grow} tone="green" />
        </div>
        <div style={{...P3D, position: 'relative'}}>
          <PersonCard person={right} tone="accent" ratio={right.amount / top} f={f} fps={fps} at={10} from="right" />
          <StackOnCard ratio={right.amount / top} grow={grow} tone="accent" />
        </div>
      </div>
      {footer ? (
        <div style={{marginTop: 46}}>
          <FooterChip text={footer} p={enter(f, fps, 66, 16)} />
        </div>
      ) : null}
    </Stage3D>
  );
};

/** A cash stack on the card's top-right corner, as tall as the person's amount (a picture of size, never a number). */
const StackOnCard: React.FC<{ratio: number; grow: number; tone: 'green' | 'accent'}> = ({ratio, grow, tone}) =>
  grow > 0 ? (
    <Decor>
      <div style={{position: 'absolute', right: 30, top: 26, width: 150, height: 110, ...P3D, transform: 'translateZ(70px)'}}>
        <div style={{position: 'absolute', left: 0, bottom: 0, ...P3D}}>
          <CashStack width={140} height={4 + 76 * ratio * grow} tone={tone} view={{rx: 58, rz: -24}} shadow={false} />
        </div>
      </div>
    </Decor>
  ) : null;

// --- highestLimit mode ------------------------------------------------------

/** A payment card. `dark` is the highest-limit card; the light ones are the new approvals. */
const PayCard: React.FC<{width: number; dark: boolean; sheen: number; children?: React.ReactNode}> = ({width, dark, sheen, children}) => {
  const h = width / 1.586;
  return (
    <div
      style={{
        position: 'relative',
        width,
        height: h,
        borderRadius: width * 0.06,
        overflow: 'hidden',
        background: dark
          ? 'linear-gradient(135deg, #27272A 0%, #0A0A0A 55%, #18181B 100%)'
          : 'linear-gradient(135deg, #7EB0F7 0%, #3D86F0 60%, #2F6FD0 100%)',
        boxShadow: dark
          ? '0 3px 0 -1px #3F3F46, 0 18px 34px rgba(10,10,10,.22), 0 40px 60px -20px rgba(10,10,10,.28)'
          : '0 3px 0 -1px #2F6FD0, 0 14px 28px rgba(61,134,240,.24), 0 30px 46px -18px rgba(10,10,10,.2)',
      }}
    >
      {/* chip */}
      <div
        style={{
          position: 'absolute',
          left: width * 0.09,
          top: h * 0.3,
          width: width * 0.13,
          height: width * 0.1,
          borderRadius: width * 0.018,
          background: 'linear-gradient(135deg, #F5DFA0 0%, #D9B45A 50%, #F1D58A 100%)',
          boxShadow: 'inset 0 0 0 1px rgba(120,90,20,.35)',
        }}
      />
      {/* contactless arcs */}
      <svg style={{position: 'absolute', left: width * 0.26, top: h * 0.3}} width={width * 0.08} height={width * 0.1} viewBox="0 0 20 26">
        {[5, 10, 15].map((r) => (
          <path key={r} d={`M${2 + r * 0.25} ${13 - r * 0.7} Q${2 + r * 0.7} 13 ${2 + r * 0.25} ${13 + r * 0.7}`} stroke="rgba(255,255,255,.55)" strokeWidth="2" fill="none" strokeLinecap="round" />
        ))}
      </svg>
      {children}
      {/* sheen sweeping across once */}
      <div
        style={{
          position: 'absolute',
          top: -h,
          bottom: -h,
          width: width * 0.35,
          left: interpolate(sheen, [0, 1], [-width * 0.5, width * 1.2]),
          transform: 'rotate(18deg)',
          background: 'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,.22) 50%, rgba(255,255,255,0) 100%)',
        }}
      />
    </div>
  );
};

const MultipleBadge: React.FC<{text: string}> = ({text}) => (
  <div
    style={{
      position: 'absolute',
      right: 16,
      top: 14,
      padding: '6px 16px',
      borderRadius: 999,
      background: 'rgba(255,255,255,.95)',
      color: COLORS.accent,
      fontSize: 34,
      fontWeight: 800,
      letterSpacing: TRACK.num,
      lineHeight: 1.1,
    }}
  >
    {text}
  </div>
);

const formatMultiple = (n: number): string => `${Number.isInteger(n) ? n : Math.round(n * 10) / 10}x`;

const HighestLimit: React.FC<TwoPeopleProps & {f: number; fps: number}> = ({f, fps, eyebrow, card, approvals, footer}) => {
  const low = Math.max(0.1, approvals.low);
  const high = Math.max(low, approvals.high);
  const BASE_W = 250; // the 1x card's width; the other card's area grows with the multiple
  const wLow = BASE_W;
  const wHigh = Math.min(380, BASE_W * Math.sqrt(high / low));
  const arrow = progressBetween(f, 28, 40);
  return (
    <Stage3D f={f} length={TWO_PEOPLE_BASE} drift={0.6} style={{justifyContent: 'flex-start'}}>
      {eyebrow ? (
        <div style={{...fadeUp(enter(f, fps, 0, 14)), height: 40}}>
          <Eyebrow text={eyebrow} progress={enter(f, fps, 0, 14)} />
        </div>
      ) : null}
      <div style={{...P3D, marginTop: 28, display: 'flex', flexDirection: 'column', alignItems: 'center'}}>
        <div style={{...P3D, transform: `translateZ(${40 + 30 * (1 - enter(f, fps, 4, 18))}px) rotateX(${8 * (1 - enter(f, fps, 4, 18))}deg)`, opacity: enter(f, fps, 4, 14)}}>
          <PayCard width={380} dark sheen={progressBetween(f, 14, 34)}>
            <div
              style={{
                position: 'absolute',
                right: 30,
                top: 26,
                fontSize: 20,
                fontWeight: 700,
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
                color: 'rgba(255,255,255,.78)',
              }}
            >
              {card.tag}
            </div>
            {card.limit !== null ? (
              <div style={{position: 'absolute', left: 34, bottom: 26, color: '#FFFFFF'}}>
                <DollarCounter value={card.limit} f={f} start={10} end={30} size={50} color="#FFFFFF" />
              </div>
            ) : null}
          </PayCard>
        </div>
        <div style={{...fadeUp(enter(f, fps, 14, 14)), marginTop: 22, fontSize: 36, fontWeight: 800, letterSpacing: TRACK.h2, lineHeight: 1.1}}>
          {card.label}
        </div>
      </div>
      <div style={{marginTop: 22, display: 'flex', alignItems: 'center', gap: 18, opacity: arrow}}>
        <svg width={36} height={44} viewBox="0 0 36 44" style={{transform: `translateY(${(1 - arrow) * -10}px)`}}>
          <path d="M18 2 V36 M6 26 L18 40 L30 26" stroke={COLORS.accent} strokeWidth="5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <div style={{...SMALL_CAPS, fontSize: 25, color: COLORS.gray}}>{approvals.label}</div>
      </div>
      <div style={{...P3D, marginTop: 26, display: 'flex', alignItems: 'flex-end', gap: 34}}>
        {[
          {w: wLow, text: formatMultiple(low), at: 38},
          {w: wHigh, text: formatMultiple(high), at: 46},
        ].map((c) => {
          const p = enter(f, fps, c.at, 16);
          return (
            <div key={c.text} style={{...P3D, opacity: p, transform: `translate3d(0, ${(1 - p) * 60}px, ${50 - (1 - p) * 200}px) rotateX(${(1 - p) * 14}deg)`}}>
              <PayCard width={c.w} dark={false} sheen={progressBetween(f, c.at + 10, c.at + 30)}>
                <MultipleBadge text={c.text} />
              </PayCard>
            </div>
          );
        })}
      </div>
      {footer ? (
        <div style={{marginTop: 34}}>
          <FooterChip text={footer} p={enter(f, fps, 64, 16)} />
        </div>
      ) : null}
    </Stage3D>
  );
};

// ---------------------------------------------------------------------------

export const TwoPeople: React.FC<TwoPeopleProps> = (props) => {
  const {f, fps} = useClipTimeline(TWO_PEOPLE_BASE, props.durationInFrames, TWO_PEOPLE_MIN, TWO_PEOPLE_MAX);
  const scene = props.mode === 'highestLimit' ? <HighestLimit {...props} f={f} fps={fps} /> : <Compare {...props} f={f} fps={fps} />;
  const page = (
    <Frame format={props.format} side={props.side} showSafeZones={props.showSafeZones}>
      {scene}
    </Frame>
  );
  return <SeeThrough on={props.transparent}>{page}</SeeThrough>;
};

const size = (format?: TwoPeopleFormat) => (format === 'wide' ? {width: WIDE.width, height: WIDE.height} : {width: FRAME.width, height: FRAME.height});

// Stills:  npx remotion still src/index.ts TwoPeople out/two-people.png --frame=96
//          npx remotion still src/index.ts TwoPeopleWide out/two-people-wide.png --frame=96
export const TwoPeopleCompositions: React.FC = () => (
  <>
    <Composition
      id="TwoPeople"
      component={TwoPeople}
      durationInFrames={TWO_PEOPLE_BASE}
      fps={FRAME.fps}
      width={FRAME.width}
      height={FRAME.height}
      defaultProps={twoPeopleDefaults}
      calculateMetadata={({props}) => ({durationInFrames: twoPeopleDuration(props.durationInFrames), ...size(props.format)})}
    />
    <Composition
      id="TwoPeopleWide"
      component={TwoPeople}
      durationInFrames={TWO_PEOPLE_BASE}
      fps={WIDE.fps}
      width={WIDE.width}
      height={WIDE.height}
      defaultProps={{...twoPeopleDefaults, format: 'wide' as const}}
      calculateMetadata={({props}) => ({durationInFrames: twoPeopleDuration(props.durationInFrames), ...size(props.format)})}
    />
  </>
);
