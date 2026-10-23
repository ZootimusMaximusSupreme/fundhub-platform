import React from 'react';
import {AbsoluteFill} from 'remotion';
import {BrandFrame} from './BrandFrame';
import {FONT_FAMILY} from './fonts';
import {useSeeThrough} from './Grid';
import {SafeZoneGuide} from './SafeZoneGuide';
import {COLORS, CONTENT, FRAME, GRID, MARGIN_X, SAFE, SAFE_HEIGHT, WORDMARK} from './tokens';
import {Wordmark} from './Wordmark';

// KitFrame: BrandFrame with a wide 4K format and a see-through card.
//
// A template that used BrandFrame can use KitFrame with the same backdrop and
// children, plus `format` and `side`:
//
// - vertical, page on (the default): it IS BrandFrame. Same elements, same
//   pixels, frame for frame.
// - vertical, see-through: the page becomes one floating white card (the
//   "plate") inside the text-safe band (y 269-1248). The wordmark, the words,
//   the cards and the money all sit on it, so every word reads over any film.
//   Nothing is drawn outside the plate; nothing in the top 14% or bottom 35%.
// - wide (3840x2160, the sideways 4K VSL and thank-you video): the same page,
//   scaled up, sits in ONE side panel chosen by `side`. Chris's face fills the
//   middle and Submagic's captions sit low in the middle, so nothing is drawn
//   in the middle column (x 1500-2340) or the bottom 30% (y > 1512).
//   Left panel x 192-1500, right panel x 2340-3648, both y 108-1512.
//   With the page on, the 4K paper and grid fill the frame; see-through, only
//   the plate and what is on it remain.

export type KitFormat = 'vertical' | 'wide';
export type KitSide = 'left' | 'right';

/** The wide frame: 4K, 30 fps. */
export const KIT_WIDE = {width: 3840, height: 2160, fps: 30} as const;

/** The two allowed side panels on the wide frame (board rule, ops/workflows/animation-builds-2026-10-22.md). */
export const WIDE_PANEL = {
  left: 192,
  right: 2340,
  width: 1308, // 192-1500 or 2340-3648
  top: 108,
  height: 1404, // 108-1512
} as const;

/** The see-through plate, in vertical frame pixels. Its shadow stays inside the text-safe band. */
export const PLATE = {left: 36, right: FRAME.width - 36, top: 277, bottom: 1222, radius: 40} as const;
const PLATE_W = PLATE.right - PLATE.left; // 1008
const PLATE_H = PLATE.bottom - PLATE.top; // 945

/** Room left between the plate and the panel edge for the plate's shadow, in 4K pixels. */
const WIDE_SHADOW_ROOM = 40;
/** How much bigger the vertical page is drawn in the wide panel. */
export const WIDE_SCALE = (WIDE_PANEL.width - WIDE_SHADOW_ROOM * 2) / PLATE_W; // about 1.218

// Reaches at most 26 px below the plate (8 + 18), so it ends at y 1248, the
// bottom of the text-safe band.
const PLATE_SHADOW = [
  '0 0 0 1px rgba(10,10,10,.05)',
  '0 5px 0 -2px #DCDCE1',
  '0 8px 18px rgba(10,10,10,.16)',
  '0 2px 6px rgba(10,10,10,.06)',
].join(', ');

const Plate: React.FC = () => (
  <div
    style={{
      position: 'absolute',
      left: PLATE.left,
      top: PLATE.top - SAFE.top,
      width: PLATE_W,
      height: PLATE_H,
      borderRadius: PLATE.radius,
      background: 'linear-gradient(170deg, #FFFFFF 0%, #FFFFFF 60%, #FAFAFB 100%)',
      border: '2px solid #ECECEF',
      boxShadow: PLATE_SHADOW,
    }}
  />
);

/** Soft edges for the money behind the page in the wide paper format, so bills fade out before the panel edge. */
const softRect = (fade: number): React.CSSProperties => {
  const x = `linear-gradient(to right, transparent ${PLATE.left}px, #000 ${PLATE.left + fade}px, #000 ${PLATE.right - fade}px, transparent ${PLATE.right}px)`;
  const y = `linear-gradient(to bottom, transparent ${PLATE.top}px, #000 ${PLATE.top + fade}px, #000 ${PLATE.bottom - fade}px, transparent ${PLATE.bottom}px)`;
  return {
    WebkitMaskImage: `${x}, ${y}`,
    maskImage: `${x}, ${y}`,
    WebkitMaskComposite: 'source-in',
    maskComposite: 'intersect',
  } as React.CSSProperties;
};

/**
 * The vertical page without its paper: backdrop, wordmark and the content box,
 * laid out exactly as BrandFrame lays them out (1080x1920 pixels). `plate`
 * puts the see-through card under it all and keeps the money on the card.
 */
const Page: React.FC<{plate: boolean; soft: boolean; backdrop?: React.ReactNode; children: React.ReactNode}> = ({plate, soft, backdrop, children}) => (
  <>
    {!plate && backdrop ? <AbsoluteFill style={soft ? softRect(140) : undefined}>{backdrop}</AbsoluteFill> : null}
    <div style={{position: 'absolute', left: 0, right: 0, top: SAFE.top, height: SAFE_HEIGHT, overflow: 'hidden'}}>
      {plate ? <Plate /> : null}
      {plate && backdrop ? (
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: -SAFE.top,
            width: FRAME.width,
            height: FRAME.height,
            clipPath: `inset(${PLATE.top}px ${FRAME.width - PLATE.right}px ${FRAME.height - PLATE.bottom}px ${PLATE.left}px round ${PLATE.radius}px)`,
          }}
        >
          {backdrop}
        </div>
      ) : null}
      <div style={{position: 'absolute', left: 0, right: 0, top: WORDMARK.top - SAFE.top, display: 'flex', justifyContent: 'center'}}>
        <Wordmark width={WORDMARK.width} />
      </div>
      <div
        style={{
          position: 'absolute',
          left: MARGIN_X,
          right: MARGIN_X,
          top: CONTENT.top - SAFE.top,
          height: CONTENT.bottom - CONTENT.top,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {children}
      </div>
    </div>
  </>
);

/** The wide page: paper and the faint grid at the 4K scale (same look as BankPocketsWide). Draws nothing when see-through. */
const WidePaper: React.FC = () => {
  const seeThrough = useSeeThrough();
  const line = 3;
  if (seeThrough) return null;
  return (
    <AbsoluteFill
      style={{
        backgroundColor: COLORS.paper,
        backgroundImage: `linear-gradient(${GRID.color} ${line}px, transparent ${line}px), linear-gradient(90deg, ${GRID.color} ${line}px, transparent ${line}px)`,
        backgroundSize: `${GRID.cell}px ${GRID.cell}px`,
        backgroundPosition: `${-line / 2}px ${-line / 2}px`,
      }}
    />
  );
};

/** Review overlay only: the allowed panel in a red box, the rest shaded. */
const WideZoneGuide: React.FC<{side: KitSide}> = ({side}) => (
  <AbsoluteFill style={{pointerEvents: 'none'}}>
    <div
      style={{
        position: 'absolute',
        left: side === 'right' ? WIDE_PANEL.right : WIDE_PANEL.left,
        top: WIDE_PANEL.top,
        width: WIDE_PANEL.width,
        height: WIDE_PANEL.height,
        border: '6px solid #DC2626',
        boxShadow: '0 0 0 9999px rgba(220,38,38,.07)',
      }}
    />
  </AbsoluteFill>
);

/** Where the vertical page sits inside the wide panel: the plate centered, scaled by WIDE_SCALE. */
const widePlacement = (): {x: number; y: number} => {
  const cx = (PLATE.left + PLATE.right) / 2;
  const cy = (PLATE.top + PLATE.bottom) / 2;
  return {x: WIDE_PANEL.width / 2 - cx * WIDE_SCALE, y: WIDE_PANEL.height / 2 - cy * WIDE_SCALE};
};

export const KitFrame: React.FC<{
  format?: KitFormat;
  side?: KitSide;
  showSafeZones?: boolean;
  backdrop?: React.ReactNode;
  children: React.ReactNode;
}> = ({format = 'vertical', side = 'left', showSafeZones = false, backdrop, children}) => {
  const seeThrough = useSeeThrough();
  if (format !== 'wide') {
    if (!seeThrough) {
      return (
        <BrandFrame showSafeZones={showSafeZones} backdrop={backdrop}>
          {children}
        </BrandFrame>
      );
    }
    return (
      <AbsoluteFill style={{fontFamily: FONT_FAMILY, color: COLORS.ink, WebkitFontSmoothing: 'antialiased'}}>
        <Page plate soft={false} backdrop={backdrop}>
          {children}
        </Page>
        {showSafeZones ? <SafeZoneGuide /> : null}
      </AbsoluteFill>
    );
  }
  const at = widePlacement();
  return (
    <AbsoluteFill style={{fontFamily: FONT_FAMILY, color: COLORS.ink, WebkitFontSmoothing: 'antialiased'}}>
      <WidePaper />
      <div
        style={{
          position: 'absolute',
          left: side === 'right' ? WIDE_PANEL.right : WIDE_PANEL.left,
          top: WIDE_PANEL.top,
          width: WIDE_PANEL.width,
          height: WIDE_PANEL.height,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: FRAME.width,
            height: FRAME.height,
            transformOrigin: '0 0',
            transform: `translate(${at.x}px, ${at.y}px) scale(${WIDE_SCALE})`,
          }}
        >
          <Page plate={seeThrough} soft backdrop={backdrop}>
            {children}
          </Page>
        </div>
      </div>
      {showSafeZones ? <WideZoneGuide side={side} /> : null}
    </AbsoluteFill>
  );
};
