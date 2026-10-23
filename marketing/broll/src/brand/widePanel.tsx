import React from 'react';
import {AbsoluteFill} from 'remotion';
import {SeeThrough, useSeeThrough} from './Grid';
import {COLORS, FRAME, GRID, SAFE} from './tokens';

// Wide side panel: the 4K format for the sideways VSL and the thank-you video
// (animation-builds-2026-10-22, W2). Chris's face sits in the middle of the
// frame and Submagic's captions sit low in the middle, so every piece of the
// animation lives in ONE side panel, picked by `side`:
//   left  panel: x 192-1500, y 108-1512
//   right panel: x 2340-3648, y 108-1512
// Nothing in the middle column (x 1500-2340) and nothing in the bottom 30%
// (y > 1512).
//
// The panel shows a template's own vertical scene (its words band, y 269-1248,
// plus a little room above and below for decoration), redrawn 1.21x larger by
// the browser, so the words and the look are the vertical ones. Its edges fade
// out softly, so a bill drifting past the edge melts away instead of being cut
// flat over the film.

/** The wide frame: 4K, 30 fps. */
export const WIDE = {width: 3840, height: 2160, fps: 30} as const;

export type WideFormat = 'vertical' | 'wide';
export type WideSide = 'left' | 'right';

/** Where content may sit on the wide frame (the board's caption-safe rule). */
export const WIDE_PANEL = {
  left: {x0: 192, x1: 1500},
  right: {x0: 2340, x1: 3648},
  y0: 108,
  y1: 1512,
} as const;

const PANEL_W = WIDE_PANEL.left.x1 - WIDE_PANEL.left.x0; // 1308
const PANEL_H = WIDE_PANEL.y1 - WIDE_PANEL.y0; // 1404
/** How much larger the vertical scene is drawn in the panel. */
export const WIDE_SCALE = PANEL_W / FRAME.width; // 1.211
/** Vertical-frame rows the panel shows: the words band plus equal room above and below. */
const CROP_H = PANEL_H / WIDE_SCALE; // 1159
const CROP_TOP = (SAFE.top + SAFE.bottom) / 2 - CROP_H / 2; // 179
/** Soft edge, in vertical-frame px: the room above and below the band, and a strip at each side (words keep a 90 px margin). */
const FADE_Y = SAFE.top - CROP_TOP; // 90
const FADE_X = 70;

/** Composition size for a format (used by the <Id>Wide compositions' calculateMetadata). */
export const wideSize = (format?: WideFormat) =>
  format === 'vertical' ? {width: FRAME.width, height: FRAME.height} : {width: WIDE.width, height: WIDE.height};

const edgeMask = (): string => {
  const fy = (FADE_Y / CROP_H) * 100;
  const fx = (FADE_X / FRAME.width) * 100;
  const v = `linear-gradient(to bottom, transparent 0%, #000 ${fy}%, #000 ${100 - fy}%, transparent 100%)`;
  const h = `linear-gradient(to right, transparent 0%, #000 ${fx}%, #000 ${100 - fx}%, transparent 100%)`;
  return `${v}, ${h}`;
};

/** The wide page: paper and the faint grid at the 4K scale. Draws nothing when the clip is see-through. */
const WidePage: React.FC = () => {
  const seeThrough = useSeeThrough();
  const line = 3;
  if (seeThrough) return null;
  return (
    <AbsoluteFill
      style={{
        background: COLORS.paper,
        backgroundImage: `linear-gradient(${GRID.color} ${line}px, transparent ${line}px), linear-gradient(90deg, ${GRID.color} ${line}px, transparent ${line}px)`,
        backgroundSize: `${GRID.cell}px ${GRID.cell}px`,
        backgroundPosition: `${-line / 2}px ${-line / 2}px`,
      }}
    />
  );
};

/** Review overlay only: the chosen panel in red, the middle column and the bottom 30% shaded. */
const WidePanelGuide: React.FC<{side: WideSide}> = ({side}) => {
  const p = WIDE_PANEL[side];
  const shade = 'rgba(220,38,38,.08)';
  return (
    <AbsoluteFill style={{pointerEvents: 'none'}}>
      <div style={{position: 'absolute', left: WIDE_PANEL.left.x1, width: WIDE_PANEL.right.x0 - WIDE_PANEL.left.x1, top: 0, height: WIDE_PANEL.y1, background: shade}} />
      <div style={{position: 'absolute', left: 0, right: 0, top: WIDE_PANEL.y1, bottom: 0, background: shade}} />
      <div
        style={{
          position: 'absolute',
          left: p.x0,
          top: WIDE_PANEL.y0,
          width: p.x1 - p.x0,
          height: PANEL_H,
          border: '6px solid #DC2626',
          boxSizing: 'border-box',
        }}
      />
    </AbsoluteFill>
  );
};

/**
 * See-through look: when `on`, a thin white halo goes around every word, card
 * and object (a sticker edge), so dark words still read over dark film. Off,
 * it adds no element and changes nothing. `band` (the vertical format) keeps
 * the halo inside the words band, y 269-1248: the glow cannot spill into the
 * caption zones, and the faint bills there drop out of the see-through clip.
 * The wide panel needs no band: its own soft edge does that job.
 */
export const Sticker: React.FC<{on?: boolean; band?: boolean; children: React.ReactNode}> = ({on = false, band = false, children}) =>
  on ? (
    <AbsoluteFill
      style={{
        filter: 'drop-shadow(0 0 1.5px rgba(255,255,255,.95)) drop-shadow(0 0 7px rgba(255,255,255,.55))',
        clipPath: band ? `inset(${SAFE.top}px 0 ${FRAME.height - SAFE.bottom}px 0)` : undefined,
      }}
    >
      {children}
    </AbsoluteFill>
  ) : (
    <>{children}</>
  );

/**
 * The wide 4K frame around a template's vertical scene. `children` is the
 * template's own vertical page (its BrandFrame); it is shown in the chosen
 * side panel. The 4K page (paper and grid) is drawn here, and only when the
 * clip is not see-through; the vertical page's own grid never draws inside.
 */
export const WidePanel: React.FC<{side?: WideSide; showSafeZones?: boolean; children: React.ReactNode}> = ({side = 'left', showSafeZones, children}) => {
  const p = WIDE_PANEL[side === 'right' ? 'right' : 'left'];
  const mask = edgeMask();
  return (
    <AbsoluteFill>
      <WidePage />
      <div
        style={{
          position: 'absolute',
          left: p.x0,
          top: WIDE_PANEL.y0,
          width: PANEL_W,
          height: PANEL_H,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: FRAME.width,
            height: CROP_H,
            overflow: 'hidden',
            transform: `scale(${WIDE_SCALE})`,
            transformOrigin: '0 0',
            WebkitMaskImage: mask,
            maskImage: mask,
            WebkitMaskComposite: 'source-in',
            maskComposite: 'intersect',
          }}
        >
          <div style={{position: 'absolute', left: 0, top: -CROP_TOP, width: FRAME.width, height: FRAME.height}}>
            <SeeThrough on>{children}</SeeThrough>
          </div>
        </div>
      </div>
      {showSafeZones ? <WidePanelGuide side={side} /> : null}
    </AbsoluteFill>
  );
};
