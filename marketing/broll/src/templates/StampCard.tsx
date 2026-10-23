import React from 'react';
import {AbsoluteFill, Composition, Easing, interpolate, spring} from 'remotion';
import {
  COLORS,
  Decor,
  FONT_FAMILY,
  FRAME,
  Grid,
  SAFE,
  SAFE_HEIGHT,
  SPECTRUM,
  SafeZoneGuide,
  TAG,
  TRACK,
  WORDMARK,
  Wordmark,
  cameraAt,
  formatDollars,
} from '../brand';
import {SeeThrough, useSeeThrough} from '../brand/Grid';
import {clampClip, useClipTimeline} from './clipTimeline';

// StampCard (unit N5, ops/workflows/animation-builds-2026-10-22.md). A document, a card, a file or an invoice lands, and a rubber stamp slams onto it: "Illegal", "Closed", "Approved", "Denied" or "$0". An optional row of bars drains away after the stamp (a closed card losing its history and its limit).
//
// Every word on screen is a prop, so a script line supplies its own words:
//   Direct Book Ad 12 (the defaults): a "Credit sweep" document stamped "Illegal".
//   Direct Book Ad 5: a paid-off card (green check) stamped "Closed", then
//     "Years of history" and "Limit" drain away. No dollar amount unless `amount` is set.
//   Direct Book Ad 16: "Your file" stamped "Approved" (or "Denied", tone "bad").
//   Direct Book Ad 13: an invoice stamped "$0" with "You owe us nothing".
//
// Two formats from one scene, both 30 fps:
// - vertical 1080x1920 (ads): the wordmark, then every word inside y 269-1248.
// - wide 3840x2160 (the sideways 4K VSL and thank-you video): everything in ONE
//   side panel picked by `side` (left x 192-1500, right x 2340-3648, y 108-1512).
//   Nothing in the middle column (the face) or the bottom 30% (the captions).
//   No wordmark in the wide format. Drawn at 4K, never a stretched vertical.
//
// See-through (`transparent: true`): no page and no grid. The words sit on solid
// cards (the object, a white chip, a white plate), so they read over any film.
// Ink specks, the shock ring and the card's sheen are wrapped in Decor, so a
// render with checkTextOnly drops them for the zone scan.

export type StampFormat = 'vertical' | 'wide';
export type StampSide = 'left' | 'right';
export type StampObject = 'document' | 'card' | 'file' | 'invoice';
export type StampTone = 'bad' | 'ok';

export type StampCardProps = {
  /** "vertical" (1080x1920, ads) or "wide" (3840x2160, the VSL and thank-you video). */
  format?: StampFormat;
  /** Wide only: which side panel holds the clip. Default "left". */
  side?: StampSide;
  /** What gets stamped. */
  object: StampObject;
  /** Small label on a chip above the object. Null hides it. */
  eyebrow: string | null;
  /** Words written on the object ("Credit sweep", "Your file"). Null leaves only blank lines. */
  title: string | null;
  /** Whole dollars printed on the object. Null shows no amount. Never filled in by the template. */
  amount: number | null;
  /** A green check lands on the object before the stamp (a paid-off card). */
  paidCheck: boolean;
  /** The stamp's word ("Illegal", "Closed", "Approved", "$0"). */
  stamp: string;
  /** Small second line inside the stamp ("You owe us nothing"). Null hides it. */
  stampSub: string | null;
  /** Red ink ("bad") or green ink ("ok"). */
  tone: StampTone;
  /** Labels of bars that drain to empty after the stamp ("Years of history", "Limit"). Empty hides them. */
  drain: string[];
  /** A line on a white plate under the object. Null hides it. */
  subline: string | null;
  durationInFrames?: number;
  showSafeZones?: boolean;
  /** See-through: no page and no grid, so the clip renders with alpha (README.md). Default false. */
  transparent?: boolean;
};

export const stampCardDefaults: StampCardProps = {
  format: 'vertical',
  side: 'left',
  object: 'document',
  eyebrow: null,
  title: 'Credit sweep',
  amount: null,
  paidCheck: false,
  stamp: 'Illegal',
  stampSub: null,
  tone: 'bad',
  drain: [],
  subline: 'puts your whole file and your freedom at risk',
  transparent: false,
};

/** Base length 3 s; a shot list may ask for 2.5 to 4 s (75 to 120 frames). */
export const STAMP_CARD_BASE = 90;
export const STAMP_CARD_MIN = 75;
export const STAMP_CARD_MAX = 120;
/** Frame (on the base timeline) where every beat is on screen: stamp down, bars drained, subline in. */
export const STAMP_CARD_HERO = 80;

export const stampCardDuration = (requested?: number): number =>
  clampClip(requested, STAMP_CARD_BASE, STAMP_CARD_MIN, STAMP_CARD_MAX);

// ---------------------------------------------------------------------------
// The frame both N5 templates share (StampCard and PriceTag). It lives here, in
// a template file, so no shared helper file is added to the kit.

/** The wide frame: 4K, 30 fps. */
export const STAMP_WIDE = {width: 3840, height: 2160, fps: 30} as const;

/** The allowed side panels on the wide frame (board rule, 2026-10-22). */
export const SIDE_PANEL = {left: 192, right: 2340, width: 1308, top: 108, height: 1404} as const;

/** Where content sits in the vertical frame: under the wordmark, inside the text-safe band. */
const VERTICAL_BOX = {x: 90, y: 396, w: 900, h: 822} as const;
/** Inset from the wide panel edge, so shadows stay inside it. */
const WIDE_INSET = 64;
/** Content is designed 900 units wide; the wide panel draws it this much bigger, at full 4K sharpness. */
const WIDE_U = (SIDE_PANEL.width - WIDE_INSET * 2) / VERTICAL_BOX.w; // about 1.31

/** The box a scene gets: `u` is px per design unit, `w` and `h` are the box size in design units. */
export type PanelBox = {u: number; w: number; h: number};

const WideZoneGuide: React.FC<{side: StampSide}> = ({side}) => (
  <AbsoluteFill style={{pointerEvents: 'none'}}>
    <div
      style={{
        position: 'absolute',
        left: side === 'right' ? SIDE_PANEL.right : SIDE_PANEL.left,
        top: SIDE_PANEL.top,
        width: SIDE_PANEL.width,
        height: SIDE_PANEL.height,
        border: '6px solid #DC2626',
        boxShadow: '0 0 0 9999px rgba(220,38,38,.07)',
      }}
    />
  </AbsoluteFill>
);

/**
 * Page (or no page, see-through), wordmark (vertical only), and a clipped box
 * that keeps every pixel inside the allowed zone. `children` gets the box.
 */
export const PanelFrame: React.FC<{
  format?: StampFormat;
  side?: StampSide;
  showSafeZones?: boolean;
  children: (box: PanelBox) => React.ReactNode;
}> = ({format = 'vertical', side = 'left', showSafeZones = false, children}) => {
  const seeThrough = useSeeThrough();
  const base: React.CSSProperties = {fontFamily: FONT_FAMILY, color: COLORS.ink, WebkitFontSmoothing: 'antialiased'};
  if (format === 'wide') {
    const u = WIDE_U;
    const inner = {w: SIDE_PANEL.width - WIDE_INSET * 2, h: SIDE_PANEL.height - WIDE_INSET * 2};
    return (
      <AbsoluteFill style={base}>
        <Grid />
        <div
          style={{
            position: 'absolute',
            left: side === 'right' ? SIDE_PANEL.right : SIDE_PANEL.left,
            top: SIDE_PANEL.top,
            width: SIDE_PANEL.width,
            height: SIDE_PANEL.height,
            overflow: 'hidden',
          }}
        >
          <div style={{position: 'absolute', left: WIDE_INSET, top: WIDE_INSET, width: inner.w, height: inner.h}}>
            {children({u, w: inner.w / u, h: inner.h / u})}
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
        <div style={{position: 'absolute', left: 0, right: 0, top: WORDMARK.top - SAFE.top, display: 'flex', justifyContent: 'center'}}>
          {seeThrough ? (
            // Over film the wordmark sits on a white pill, or it would not read.
            <div
              style={{
                marginTop: -14,
                padding: '14px 30px',
                borderRadius: 999,
                background: COLORS.white,
                border: '2px solid #ECECEF',
                boxShadow: '0 6px 14px rgba(10,10,10,.12)',
              }}
            >
              <Wordmark width={WORDMARK.width * 0.86} />
            </div>
          ) : (
            <Wordmark width={WORDMARK.width} />
          )}
        </div>
        <div style={{position: 'absolute', left: VERTICAL_BOX.x, top: VERTICAL_BOX.y - SAFE.top, width: VERTICAL_BOX.w, height: VERTICAL_BOX.h}}>
          {children({u: 1, w: VERTICAL_BOX.w, h: VERTICAL_BOX.h})}
        </div>
      </div>
      {showSafeZones ? <SafeZoneGuide /> : null}
    </AbsoluteFill>
  );
};

/** The slow shared camera (depth kit), scaled to the box so the 4K version moves the same. */
export const PanelStage: React.FC<{f: number; length: number; u: number; gap: number; children: React.ReactNode}> = ({
  f,
  length,
  u,
  gap,
  children,
}) => {
  const c = cameraAt(f / length, 0.6);
  return (
    <div style={{position: 'absolute', inset: 0, perspective: 2400 * u, perspectiveOrigin: '50% 50%'}}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          transformStyle: 'preserve-3d',
          transform: `translateZ(${c.z * u}px) rotateX(${c.rx}deg) rotateY(${c.ry}deg)`,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap,
        }}
      >
        {children}
      </div>
    </div>
  );
};

/** Layered soft shadow for a solid card, scaled by `u`. */
export const liftShadow = (u: number, e = 1): string =>
  [
    `0 ${5 * u * e}px 0 ${-1 * u}px #DCDCE1`,
    `0 ${10 * u * e}px ${18 * u * e}px rgba(10,10,10,.06)`,
    `0 ${26 * u * e}px ${40 * u * e}px rgba(10,10,10,.09)`,
    `0 ${46 * u * e}px ${52 * u * e}px ${-22 * u * e}px rgba(10,10,10,.14)`,
  ].join(', ');

/** The eyebrow on a white chip (bare gray type does not read over film). */
export const EyebrowChip: React.FC<{text: string; u: number; progress: number}> = ({text, u, progress}) => {
  const size = Math.min(30, 780 / Math.max(1, text.length * 0.8)) * u;
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 16 * u,
        padding: `${16 * u}px ${30 * u}px`,
        borderRadius: 999,
        background: COLORS.white,
        border: `${2 * u}px solid #ECECEF`,
        boxShadow: `0 ${6 * u}px ${14 * u}px rgba(10,10,10,.10)`,
        opacity: progress,
        transform: `translateY(${(1 - progress) * 22 * u}px)`,
      }}
    >
      <span
        style={{
          width: 42 * u,
          height: 5 * u,
          borderRadius: 3 * u,
          background: SPECTRUM,
          transform: `scaleX(${progress})`,
          transformOrigin: 'left center',
        }}
      />
      <span
        style={{
          fontSize: size,
          fontWeight: 600,
          letterSpacing: '0.16em',
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
};

/** A line of words on a white plate. */
export const SublinePlate: React.FC<{text: string; u: number; progress: number; size?: number}> = ({text, u, progress, size = 46}) => (
  <div
    style={{
      maxWidth: 860 * u,
      padding: `${24 * u}px ${42 * u}px`,
      borderRadius: 28 * u,
      background: COLORS.white,
      border: `${2 * u}px solid #ECECEF`,
      boxShadow: `0 ${8 * u}px ${18 * u}px rgba(10,10,10,.10)`,
      fontSize: size * u,
      fontWeight: 600,
      letterSpacing: TRACK.body,
      lineHeight: 1.2,
      color: COLORS.ink2,
      textAlign: 'center',
      textWrap: 'balance',
      opacity: progress,
      transform: `translateY(${(1 - progress) * 24 * u}px)`,
    }}
  >
    {text}
  </div>
);

/** About how tall a SublinePlate is, in design units (to fit the column). */
export const sublineHeight = (text: string | null, size = 46): number => {
  if (!text) return 0;
  const lines = Math.max(1, Math.ceil((text.length * 0.53 * size) / 760));
  return lines * size * 1.2 + 52;
};

// ---------------------------------------------------------------------------
// Timeline (frames on the 90-frame base)

const T = {
  eyebrow: 0,
  object: 3,
  check: 13,
  stamp: 24,
  slam: 31,
  drain: 40,
  sub: 44,
} as const;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const ease = (f: number, a: number, b: number, fn = Easing.inOut(Easing.cubic)) =>
  interpolate(f, [a, b], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: fn});

const INK = {bad: '#C8372D', ok: '#2E8A4F'} as const;

/** Object sizes in design units. */
const OBJ: Record<StampObject, {w: number; h: number}> = {
  document: {w: 560, h: 640},
  card: {w: 620, h: 391},
  file: {w: 640, h: 500},
  invoice: {w: 560, h: 640},
};

// ---------------------------------------------------------------------------
// Pieces

/** Placeholder lines of text (gray bars, no words). */
const Bars: React.FC<{u: number; widths: number[]; gap: number; height?: number; color?: string}> = ({
  u,
  widths,
  gap,
  height = 16,
  color = '#E8E8EC',
}) => (
  <div style={{display: 'flex', flexDirection: 'column', gap: gap * u}}>
    {widths.map((w, i) => (
      <div key={i} style={{width: `${w}%`, height: height * u, borderRadius: (height / 2) * u, background: color}} />
    ))}
  </div>
);

const titleSize = (text: string, width: number, max: number): number => Math.min(max, width / Math.max(1, text.length * 0.56));

const PaperFace: React.FC<{u: number; w: number; h: number; children: React.ReactNode}> = ({u, w, h, children}) => (
  <div
    style={{
      position: 'absolute',
      inset: 0,
      width: w * u,
      height: h * u,
      borderRadius: 18 * u,
      background: 'linear-gradient(170deg, #FFFFFF 0%, #FFFFFF 62%, #F7F7F9 100%)',
      borderStyle: 'solid',
      borderWidth: 2 * u,
      borderColor: '#EFEFF2 #E4E4E7 #D5D5DA #E4E4E7',
      boxShadow: liftShadow(u),
      overflow: 'hidden',
    }}
  >
    {children}
  </div>
);

const DocumentFace: React.FC<{u: number; title: string | null}> = ({u, title}) => {
  const {w, h} = OBJ.document;
  const pad = 56;
  return (
    <PaperFace u={u} w={w} h={h}>
      <div style={{position: 'absolute', left: 0, right: 0, top: 0, height: 10 * u, background: SPECTRUM}} />
      {/* folded corner, top right */}
      <div
        style={{
          position: 'absolute',
          right: 0,
          top: 0,
          width: 74 * u,
          height: 74 * u,
          background: 'linear-gradient(225deg, rgba(0,0,0,0) 50%, #E9E9ED 50%, #F6F6F8 100%)',
          boxShadow: `${-4 * u}px ${4 * u}px ${8 * u}px rgba(10,10,10,.06)`,
          borderBottomLeftRadius: 8 * u,
        }}
      />
      <div style={{position: 'absolute', left: pad * u, right: (pad + 40) * u, top: 72 * u}}>
        {title ? (
          <div
            style={{
              fontSize: titleSize(title, w - pad * 2 - 40, 64) * u,
              fontWeight: 800,
              letterSpacing: TRACK.h2,
              lineHeight: 1.05,
              color: COLORS.ink,
            }}
          >
            {title}
          </div>
        ) : (
          <div style={{width: '62%', height: 34 * u, borderRadius: 10 * u, background: '#2A2A2E'}} />
        )}
        <div style={{height: 2 * u, background: COLORS.line, margin: `${34 * u}px 0 ${36 * u}px`}} />
        <Bars u={u} widths={[100, 94, 98, 72, 100, 88, 54]} gap={24} />
      </div>
      {/* signature line */}
      <div style={{position: 'absolute', left: pad * u, bottom: 64 * u, width: 200 * u, height: 2 * u, background: COLORS.track}} />
      <div style={{position: 'absolute', right: pad * u, bottom: 58 * u, width: 120 * u, height: 14 * u, borderRadius: 7 * u, background: '#E8E8EC'}} />
    </PaperFace>
  );
};

const InvoiceFace: React.FC<{u: number; title: string | null; amount: number | null}> = ({u, title, amount}) => {
  const {w} = OBJ.invoice;
  const pad = 52;
  const row = (left: number, right: number, key: number, strong = false) => (
    <div
      key={key}
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: `${(strong ? 26 : 22) * u}px 0`,
        borderTop: `${(strong ? 4 : 2) * u}px solid ${strong ? COLORS.ink2 : COLORS.line}`,
      }}
    >
      <div style={{width: `${left}%`, height: (strong ? 22 : 16) * u, borderRadius: 8 * u, background: strong ? '#2A2A2E' : '#E8E8EC'}} />
      <div style={{width: `${right}%`, height: (strong ? 22 : 16) * u, borderRadius: 8 * u, background: strong ? '#2A2A2E' : '#DCDCE1'}} />
    </div>
  );
  // A torn, zigzag bottom edge.
  const teeth = 14;
  const zig = Array.from({length: teeth * 2 + 1}, (_, i) => `${(i / (teeth * 2)) * 100}% ${i % 2 === 0 ? 100 : 97}%`).reverse();
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        filter: `drop-shadow(0 ${10 * u}px ${14 * u}px rgba(10,10,10,.10)) drop-shadow(0 ${24 * u}px ${30 * u}px rgba(10,10,10,.08))`,
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'linear-gradient(170deg, #FFFFFF 0%, #FFFFFF 62%, #F7F7F9 100%)',
          border: `${2 * u}px solid #E4E4E7`,
          borderRadius: `${18 * u}px ${18 * u}px 0 0`,
          clipPath: `polygon(0% 0%, 100% 0%, ${zig.join(', ')})`,
        }}
      >
        <div style={{position: 'absolute', left: 0, right: 0, top: 0, height: 10 * u, background: SPECTRUM}} />
        <div style={{position: 'absolute', left: pad * u, right: pad * u, top: 64 * u}}>
          <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 40 * u}}>
            {title ? (
              <div style={{fontSize: titleSize(title, w - pad * 2 - 150, 58) * u, fontWeight: 800, letterSpacing: TRACK.h2, lineHeight: 1.05}}>{title}</div>
            ) : (
              <div style={{width: 210 * u, height: 34 * u, borderRadius: 10 * u, background: '#2A2A2E'}} />
            )}
            <Bars u={u} widths={[100, 70]} gap={14} height={14} />
          </div>
          {[0, 1, 2, 3].map((i) => row([58, 44, 66, 50][i], [18, 14, 20, 16][i], i))}
          {amount !== null ? (
            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                padding: `${22 * u}px 0`,
                borderTop: `${4 * u}px solid ${COLORS.ink2}`,
                fontSize: 54 * u,
                fontWeight: 800,
                letterSpacing: TRACK.num,
              }}
            >
              {formatDollars(amount)}
            </div>
          ) : (
            row(26, 24, 9, true)
          )}
        </div>
      </div>
    </div>
  );
};

const FileFace: React.FC<{u: number; title: string | null}> = ({u, title}) => {
  const {w, h} = OBJ.file;
  return (
    <div style={{position: 'absolute', inset: 0}}>
      {/* back of the folder with its tab */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: 230 * u,
          height: 80 * u,
          borderRadius: `${22 * u}px ${22 * u}px 0 0`,
          background: 'linear-gradient(180deg, #CFDCF0 0%, #C4D4EC 100%)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 46 * u,
          width: w * u,
          height: (h - 46) * u,
          borderRadius: `0 ${26 * u}px ${26 * u}px ${26 * u}px`,
          background: 'linear-gradient(180deg, #C9D8EE 0%, #BBCDE8 100%)',
          boxShadow: liftShadow(u),
        }}
      />
      {/* a page sticking out */}
      <div
        style={{
          position: 'absolute',
          left: 46 * u,
          top: 78 * u,
          width: (w - 92) * u,
          height: 260 * u,
          borderRadius: 12 * u,
          background: '#FFFFFF',
          border: `${2 * u}px solid #E4E4E7`,
          transform: 'rotate(-2.2deg)',
          padding: `${34 * u}px ${40 * u}px`,
          boxSizing: 'border-box',
        }}
      >
        <Bars u={u} widths={[46, 100, 92]} gap={20} height={14} />
      </div>
      {/* front of the folder */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 168 * u,
          width: w * u,
          height: (h - 168) * u,
          borderRadius: 26 * u,
          background: 'linear-gradient(180deg, #E7EEF9 0%, #D6E2F4 100%)',
          boxShadow: `inset 0 ${3 * u}px 0 rgba(255,255,255,.9), 0 ${-6 * u}px ${16 * u}px rgba(10,10,10,.08)`,
        }}
      >
        {title ? (
          <div
            style={{
              position: 'absolute',
              left: 44 * u,
              top: 36 * u,
              padding: `${14 * u}px ${26 * u}px`,
              borderRadius: 14 * u,
              background: '#FFFFFF',
              border: `${2 * u}px solid #DCE4F0`,
              fontSize: titleSize(title, w - 160, 46) * u,
              fontWeight: 800,
              letterSpacing: TRACK.h2,
              lineHeight: 1.05,
              color: COLORS.ink,
              whiteSpace: 'nowrap',
            }}
          >
            {title}
          </div>
        ) : null}
      </div>
    </div>
  );
};

const CardFace: React.FC<{u: number; title: string | null; amount: number | null; gray: number; strike: number}> = ({
  u,
  title,
  amount,
  gray,
  strike,
}) => {
  const {w, h} = OBJ.card;
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        width: w * u,
        height: h * u,
        borderRadius: 34 * u,
        overflow: 'hidden',
        background: 'linear-gradient(135deg, #5A9CF4 0%, #3D86F0 46%, #2C67C2 100%)',
        boxShadow: liftShadow(u, 1.1),
      }}
    >
      {/* closed: the card goes gray */}
      <div style={{position: 'absolute', inset: 0, background: 'linear-gradient(135deg, #DADADF 0%, #C6C6CC 50%, #B4B4BB 100%)', opacity: gray}} />
      <Decor>
        <div
          style={{
            position: 'absolute',
            left: -120 * u,
            top: -60 * u,
            width: 300 * u,
            height: 600 * u,
            transform: 'rotate(28deg)',
            background: 'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,.22) 50%, rgba(255,255,255,0) 100%)',
          }}
        />
      </Decor>
      {/* chip */}
      <div
        style={{
          position: 'absolute',
          left: 58 * u,
          top: 120 * u,
          width: 92 * u,
          height: 70 * u,
          borderRadius: 14 * u,
          background: 'linear-gradient(135deg, #FCEBC6 0%, #E9C17A 55%, #D9A85A 100%)',
          boxShadow: `inset 0 0 0 ${2 * u}px rgba(140,100,40,.35)`,
        }}
      >
        <svg width={92 * u} height={70 * u} viewBox="0 0 92 70" style={{position: 'absolute', inset: 0}}>
          <path d="M 0 24 H 30 M 0 46 H 30 M 62 24 H 92 M 62 46 H 92 M 30 10 V 60 M 62 10 V 60" stroke="rgba(120,85,30,.45)" strokeWidth={2.4} fill="none" />
        </svg>
      </div>
      {/* contactless mark */}
      <svg width={44 * u} height={56 * u} viewBox="0 0 44 56" style={{position: 'absolute', left: 172 * u, top: 128 * u}}>
        {[10, 20, 30].map((r) => (
          <path key={r} d={`M ${4 + r * 0.3} ${28 - r * 0.8} A ${r} ${r} 0 0 1 ${4 + r * 0.3} ${28 + r * 0.8}`} stroke="rgba(255,255,255,.8)" strokeWidth={4} fill="none" strokeLinecap="round" />
        ))}
      </svg>
      {/* number, as dots only */}
      <div style={{position: 'absolute', left: 58 * u, top: 248 * u, display: 'flex', gap: 30 * u}}>
        {[0, 1, 2, 3].map((g) => (
          <div key={g} style={{display: 'flex', gap: 9 * u}}>
            {[0, 1, 2, 3].map((d) => (
              <div key={d} style={{width: 13 * u, height: 13 * u, borderRadius: '50%', background: 'rgba(255,255,255,.85)'}} />
            ))}
          </div>
        ))}
      </div>
      {title ? (
        <div
          style={{
            position: 'absolute',
            left: 58 * u,
            bottom: 40 * u,
            fontSize: 30 * u,
            fontWeight: 600,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: 'rgba(255,255,255,.95)',
            whiteSpace: 'nowrap',
          }}
        >
          {title}
        </div>
      ) : (
        <div style={{position: 'absolute', left: 58 * u, bottom: 48 * u, width: 190 * u, height: 14 * u, borderRadius: 7 * u, background: 'rgba(255,255,255,.55)'}} />
      )}
      {amount !== null ? (
        <div style={{position: 'absolute', right: 52 * u, top: 44 * u, color: '#FFFFFF', fontSize: 50 * u, fontWeight: 800, letterSpacing: TRACK.num}}>
          {formatDollars(amount)}
          <div
            style={{
              position: 'absolute',
              left: -6 * u,
              right: -6 * u,
              top: '52%',
              height: 6 * u,
              borderRadius: 3 * u,
              background: '#FFFFFF',
              transform: `scaleX(${strike})`,
              transformOrigin: 'left center',
            }}
          />
        </div>
      ) : null}
      {/* a card-thin edge, lit from above */}
      <div style={{position: 'absolute', inset: 0, borderRadius: 34 * u, boxShadow: `inset 0 ${3 * u}px 0 rgba(255,255,255,.28), inset 0 ${-3 * u}px 0 rgba(0,0,0,.12)`}} />
    </div>
  );
};

/** A green check badge that pops onto the object's top-right corner. */
const CheckBadge: React.FC<{u: number; pop: number}> = ({u, pop}) => (
  <div
    style={{
      position: 'absolute',
      right: -22 * u,
      top: -22 * u,
      width: 78 * u,
      height: 78 * u,
      borderRadius: '50%',
      background: 'radial-gradient(circle at 35% 30%, #5DB57A 0%, #3E8E58 70%, #34784A 100%)',
      border: `${5 * u}px solid #FFFFFF`,
      boxShadow: `0 ${6 * u}px ${12 * u}px rgba(10,10,10,.18)`,
      opacity: clamp01(pop * 3),
      transform: `scale(${pop})`,
    }}
  >
    <svg width="100%" height="100%" viewBox="0 0 68 68" style={{display: 'block'}}>
      <path d="M 19 35 L 29 45 L 49 24" fill="none" stroke="#FFFFFF" strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  </div>
);

/** The rubber stamp's imprint: a double border and heavy capitals, with worn ink. */
const StampMark: React.FC<{
  u: number;
  text: string;
  sub: string | null;
  tone: StampTone;
  maxW: number;
  backing: boolean;
  filterId: string;
}> = ({u, text, sub, tone, maxW, backing, filterId}) => {
  const ink = INK[tone];
  const chars = Math.max(1, text.length);
  const size = Math.min(150, (maxW - 96) / (chars * 0.7 + 0.1));
  const subSize = sub ? Math.min(32, (maxW - 96) / Math.max(1, sub.length * 0.74)) : 0;
  // The white under the ink sits outside the worn-ink filter, so it stays solid
  // and the words read over the lines of the page (or any film).
  return (
    <div style={{width: 'max-content', borderRadius: 22 * u, background: backing ? 'rgba(255,255,255,.94)' : 'rgba(255,255,255,.88)'}}>
    <div
      style={{
        padding: `${10 * u}px`,
        border: `${8 * u}px solid ${ink}`,
        borderRadius: 22 * u,
        filter: `url(#${filterId})`,
        whiteSpace: 'nowrap',
      }}
    >
      <div
        style={{
          border: `${3 * u}px solid ${ink}`,
          borderRadius: 12 * u,
          padding: `${(sub ? 10 : 14) * u}px ${30 * u}px ${(sub ? 14 : 14) * u}px`,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          color: ink,
        }}
      >
        <div
          style={{
            fontSize: size * u,
            fontWeight: 800,
            letterSpacing: '0.04em',
            marginRight: '-0.04em',
            textTransform: 'uppercase',
            lineHeight: 1,
          }}
        >
          {text}
        </div>
        {sub ? (
          <div
            style={{
              marginTop: 10 * u,
              fontSize: subSize * u,
              fontWeight: 700,
              letterSpacing: '0.14em',
              marginRight: '-0.14em',
              textTransform: 'uppercase',
              lineHeight: 1.1,
            }}
          >
            {sub}
          </div>
        ) : null}
      </div>
    </div>
    </div>
  );
};

/** Worn-ink texture for the stamp: noise knocks small holes in the ink. Scaled with `u` so 4K matches. */
const InkFilter: React.FC<{id: string; u: number}> = ({id, u}) => (
  <svg width={0} height={0} style={{position: 'absolute'}} aria-hidden>
    <defs>
      <filter id={id} x="-5%" y="-5%" width="110%" height="110%" colorInterpolationFilters="sRGB">
        <feTurbulence type="fractalNoise" baseFrequency={0.55 / u} numOctaves={2} seed={11} result="noise" />
        <feColorMatrix in="noise" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -9 6.1" result="holes" />
        <feComposite in="SourceGraphic" in2="holes" operator="in" />
      </filter>
    </defs>
  </svg>
);

/** Bars that drain to empty after the stamp, on a white card. */
const DrainCard: React.FC<{u: number; f: number; labels: string[]; width: number; enter: number}> = ({u, f, labels, width, enter}) => (
  <div
    style={{
      width: width * u,
      boxSizing: 'border-box',
      padding: `${26 * u}px ${36 * u}px`,
      borderRadius: 26 * u,
      background: COLORS.white,
      border: `${2 * u}px solid #ECECEF`,
      boxShadow: `0 ${8 * u}px ${18 * u}px rgba(10,10,10,.10)`,
      display: 'flex',
      flexDirection: 'column',
      gap: 22 * u,
      opacity: enter,
      transform: `translateY(${(1 - enter) * 24 * u}px)`,
    }}
  >
    {labels.map((label, i) => {
      const start = T.drain + i * 5;
      const left = 1 - ease(f, start, start + 20, Easing.inOut(Easing.quad));
      const red = ease(f, start, start + 8);
      return (
        <div key={label + i} style={{display: 'flex', flexDirection: 'column', gap: 12 * u}}>
          <div
            style={{
              fontSize: 28 * u,
              fontWeight: 600,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: COLORS.gray,
              lineHeight: 1.1,
              whiteSpace: 'nowrap',
            }}
          >
            {label}
          </div>
          <div style={{position: 'relative', height: 20 * u, borderRadius: 10 * u, background: '#EDEDF0', overflow: 'hidden'}}>
            <div style={{position: 'absolute', left: 0, top: 0, bottom: 0, width: `${left * 100}%`, borderRadius: 10 * u, background: COLORS.accent}} />
            <div style={{position: 'absolute', left: 0, top: 0, bottom: 0, width: `${left * 100}%`, borderRadius: 10 * u, background: TAG.bad.fg, opacity: red}} />
          </div>
        </div>
      );
    })}
  </div>
);

const drainHeight = (n: number): number => (n > 0 ? 56 + n * 82 + (n - 1) * 22 : 0);

// ---------------------------------------------------------------------------
// The scene

const Scene: React.FC<StampCardProps & {f: number; fps: number; box: PanelBox}> = (p) => {
  const {f, fps, box} = p;
  const obj = OBJ[p.object];
  const GAP = 34;

  // Fit the column into the box.
  const parts = [p.eyebrow ? 76 : 0, obj.h, drainHeight(p.drain.length), sublineHeight(p.subline)].filter((x) => x > 0);
  const total = parts.reduce((a, b) => a + b, 0) + GAP * (parts.length - 1);
  const k = Math.min(1, (box.h - 30) / total, (box.w - 40) / Math.max(obj.w, 620));
  const u = box.u * k;

  const objIn = spring({frame: f - T.object, fps, durationInFrames: 18, config: {damping: 200}});
  const k0 = f - T.slam;
  const hit = k0 >= 0 ? Math.exp(-k0 / 3.2) : 0;
  const shake = k0 >= 0 ? Math.sin(k0 * 2.3) * hit : 0;

  // The stamp: comes down from in front of the page, slams, squashes, settles.
  const fall = interpolate(f, [T.stamp, T.slam], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.in(Easing.quad)});
  const stampScale = k0 < 0 ? 1 + 1.6 * (1 - fall) : 1 - 0.06 * Math.exp(-k0 / 2.2) * Math.cos(k0 * 1.3);
  const stampOpacity = f < T.stamp ? 0 : k0 < 0 ? clamp01(fall * 2) * 0.96 : 0.96;
  const stampRot = k0 < 0 ? -9 - 12 * (1 - fall) : -9;

  const isCard = p.object === 'card';
  const gray = isCard && p.tone === 'bad' ? ease(f, T.slam, T.slam + 10) : 0;
  const strike = ease(f, T.drain, T.drain + 10);
  const checkPop = p.paidCheck ? spring({frame: f - T.check, fps, durationInFrames: 12, config: {damping: 12, stiffness: 180, mass: 0.6}}) : 0;

  // Where the stamp lands, relative to the object's center.
  const stampY = p.object === 'file' ? 122 : p.object === 'invoice' ? 56 : p.object === 'document' ? 40 : 6;
  const filterId = `stamp-ink-${p.format === 'wide' ? 'w' : 'v'}`;
  const ink = INK[p.tone];

  const face =
    p.object === 'document' ? (
      <DocumentFace u={u} title={p.title} />
    ) : p.object === 'invoice' ? (
      <InvoiceFace u={u} title={p.title} amount={p.amount} />
    ) : p.object === 'file' ? (
      <FileFace u={u} title={p.title} />
    ) : (
      <CardFace u={u} title={p.title} amount={p.amount} gray={gray} strike={strike} />
    );

  const specks = Array.from({length: 14}, (_, i) => {
    const a = ((i * 360) / 14 + ((i * 47) % 19)) * (Math.PI / 180);
    const t = clamp01(k0 / 14);
    const keep = i % 4 === 0;
    const r0 = 150 + ((i * 31) % 40);
    const r = r0 + (keep ? 26 : 70) * (1 - (1 - t) ** 3);
    const size = 5 + ((i * 13) % 7);
    return {x: Math.cos(a) * r * 1.5, y: Math.sin(a) * r * 0.7, size, o: k0 < 0 ? 0 : keep ? 0.85 : (1 - t) * 0.9};
  });

  return (
    <>
      <InkFilter id={filterId} u={u} />
      <PanelStage f={f} length={STAMP_CARD_BASE} u={u} gap={GAP * u}>
        {p.eyebrow ? <EyebrowChip text={p.eyebrow} u={u} progress={spring({frame: f - T.eyebrow, fps, durationInFrames: 14, config: {damping: 200}})} /> : null}
        <div
          style={{
            position: 'relative',
            width: obj.w * u,
            height: obj.h * u,
            flex: '0 0 auto',
            opacity: clamp01(objIn * 1.6),
            transform:
              `translate3d(${shake * 9 * u}px, ${(1 - objIn) * 60 * u}px, ${-(1 - objIn) * 380 * u - hit * 30 * u}px) ` +
              `rotateX(${(1 - objIn) * 18}deg) rotateZ(${-1.2 + shake * 0.7}deg)`,
          }}
        >
          {face}
          {p.paidCheck ? <CheckBadge u={u} pop={checkPop} /> : null}
          {/* the shock ring and ink specks, at the stamp */}
          <Decor>
            <div style={{position: 'absolute', left: '50%', top: `calc(50% + ${stampY * u}px)`, width: 0, height: 0}}>
              {k0 >= 0 && k0 < 12 ? (
                <div
                  style={{
                    position: 'absolute',
                    left: -obj.w * 0.42 * u,
                    top: -110 * u,
                    width: obj.w * 0.84 * u,
                    height: 220 * u,
                    borderRadius: 30 * u,
                    border: `${5 * u}px solid ${ink}`,
                    opacity: 0.35 * (1 - k0 / 12),
                    transform: `rotate(-9deg) scale(${1 + 0.22 * (k0 / 12)})`,
                  }}
                />
              ) : null}
              {specks.map((s, i) => (
                <div
                  key={i}
                  style={{
                    position: 'absolute',
                    left: (s.x - s.size / 2) * u,
                    top: (s.y - s.size / 2) * u,
                    width: s.size * u,
                    height: s.size * u,
                    borderRadius: '50%',
                    background: ink,
                    opacity: s.o,
                  }}
                />
              ))}
            </div>
          </Decor>
          {/* the stamp */}
          <div
            style={{
              position: 'absolute',
              left: '50%',
              top: `calc(50% + ${stampY * u}px)`,
              opacity: stampOpacity,
              transform: `translate(-50%, -50%) rotate(${stampRot}deg) scale(${stampScale})`,
            }}
          >
            <StampMark u={u} text={p.stamp} sub={p.stampSub} tone={p.tone} maxW={obj.w * (p.object === 'file' ? 0.84 : 0.9)} backing={isCard} filterId={filterId} />
          </div>
        </div>
        {p.drain.length > 0 ? (
          <DrainCard u={u} f={f} labels={p.drain} width={Math.max(obj.w, 560)} enter={spring({frame: f - (T.object + 8), fps, durationInFrames: 16, config: {damping: 200}})} />
        ) : null}
        {p.subline ? <SublinePlate text={p.subline} u={u} progress={spring({frame: f - T.sub, fps, durationInFrames: 14, config: {damping: 200}})} /> : null}
      </PanelStage>
    </>
  );
};

export const StampCard: React.FC<StampCardProps> = (props) => {
  const {f, fps} = useClipTimeline(STAMP_CARD_BASE, props.durationInFrames, STAMP_CARD_MIN, STAMP_CARD_MAX);
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

// Stills:  npx remotion still src/index.ts StampCard out/stamp-card.png --frame=80
//          npx remotion still src/index.ts StampCardWide out/stamp-card-wide.png --frame=80
// StampCard with --props '{"format":"wide"}' is the same as StampCardWide.
export const StampCardCompositions: React.FC = () => (
  <>
    <Composition
      id="StampCard"
      component={StampCard}
      durationInFrames={STAMP_CARD_BASE}
      fps={FRAME.fps}
      width={FRAME.width}
      height={FRAME.height}
      defaultProps={stampCardDefaults}
      calculateMetadata={({props}) => ({durationInFrames: stampCardDuration(props.durationInFrames), ...size(props.format)})}
    />
    <Composition
      id="StampCardWide"
      component={StampCard}
      durationInFrames={STAMP_CARD_BASE}
      fps={STAMP_WIDE.fps}
      width={STAMP_WIDE.width}
      height={STAMP_WIDE.height}
      defaultProps={{...stampCardDefaults, format: 'wide' as const}}
      calculateMetadata={({props}) => ({durationInFrames: stampCardDuration(props.durationInFrames), ...size(props.format)})}
    />
  </>
);
