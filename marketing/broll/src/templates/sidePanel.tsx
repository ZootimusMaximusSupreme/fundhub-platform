import React from 'react';
import {AbsoluteFill} from 'remotion';
import {COLORS, FONT_FAMILY, Grid} from '../brand';

// The wide 4K frame with one side panel (animation-builds-2026-10-22, shared
// rules). The VSL and the thank-you video are filmed sideways in 4K: the face
// sits in the middle and Submagic's captions sit low in the middle. So all of a
// wide clip's content sits in ONE side panel, picked by a `side` prop:
//   left  x 192-1500, right x 2340-3648, both y 108-1512.
// Nothing in the middle column (x 1500-2340) and nothing in the bottom 30%
// (y > 1512). The panel clips its children, so not even a card's shadow can
// reach those zones.

export const WIDE_FRAME = {width: 3840, height: 2160, fps: 30} as const;

export type WideSide = 'left' | 'right';

/** The allowed rectangle for each side, in frame pixels. */
export const SIDE_PANEL = {
  left: {x0: 192, x1: 1500},
  right: {x0: 2340, x1: 3648},
  y0: 108,
  y1: 1512,
} as const;

/** Tight inset around the actual side-panel content. */
export const PANEL_CONTENT_TOP = 40;

/** Review overlay: the allowed panel in red, the banned middle column and bottom 30% shaded. */
const SidePanelGuide: React.FC<{side: WideSide}> = ({side}) => {
  const p = SIDE_PANEL[side];
  const shade = 'rgba(220,38,38,.10)';
  return (
    <AbsoluteFill style={{pointerEvents: 'none'}}>
      <div style={{position: 'absolute', left: SIDE_PANEL.left.x1, width: SIDE_PANEL.right.x0 - SIDE_PANEL.left.x1, top: 0, bottom: 0, background: shade}} />
      <div style={{position: 'absolute', left: 0, right: 0, top: SIDE_PANEL.y1, bottom: 0, background: shade}} />
      <div
        style={{
          position: 'absolute',
          left: p.x0,
          top: SIDE_PANEL.y0,
          width: p.x1 - p.x0,
          height: SIDE_PANEL.y1 - SIDE_PANEL.y0,
          border: '6px solid #DC2626',
          boxSizing: 'border-box',
        }}
      />
    </AbsoluteFill>
  );
};

/**
 * The wide page: paper and grid (dropped when see-through, through the brand
 * Grid), the wordmark at the top of the panel, and `children` laid out in a
 * centered column under it. Everything is clipped to the panel.
 */
export const SidePanelFrame: React.FC<{side?: WideSide; showSafeZones?: boolean; children: React.ReactNode}> = ({
  side = 'left',
  showSafeZones = false,
  children,
}) => {
  const p = SIDE_PANEL[side];
  return (
    <AbsoluteFill style={{fontFamily: FONT_FAMILY, color: COLORS.ink, WebkitFontSmoothing: 'antialiased'}}>
      <Grid />
      <div
        style={{
          position: 'absolute',
          left: p.x0,
          top: SIDE_PANEL.y0,
          width: p.x1 - p.x0,
          height: SIDE_PANEL.y1 - SIDE_PANEL.y0,
          overflow: 'hidden',
        }}
      >
        <div style={{position: 'absolute', left: 0, right: 0, top: PANEL_CONTENT_TOP, bottom: 40}}>{children}</div>
      </div>
      {showSafeZones ? <SidePanelGuide side={side} /> : null}
    </AbsoluteFill>
  );
};
