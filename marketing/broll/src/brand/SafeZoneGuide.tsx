import React from 'react';
import {AbsoluteFill} from 'remotion';
import {FRAME, SAFE} from './tokens';

/**
 * Review overlay only (never in a delivered clip): shades the no-text zones and
 * draws a thin red line at the 14% and 65% edges.
 */
export const SafeZoneGuide: React.FC<{lineWidth?: number; shade?: boolean}> = ({lineWidth = 3, shade = true}) => (
  <AbsoluteFill style={{pointerEvents: 'none'}}>
    {shade ? (
      <>
        <div style={{position: 'absolute', left: 0, right: 0, top: 0, height: SAFE.top, background: 'rgba(220,38,38,.07)'}} />
        <div
          style={{position: 'absolute', left: 0, right: 0, top: SAFE.bottom, height: FRAME.height - SAFE.bottom, background: 'rgba(220,38,38,.07)'}}
        />
      </>
    ) : null}
    <div style={{position: 'absolute', left: 0, right: 0, top: SAFE.top - lineWidth / 2, height: lineWidth, background: '#DC2626'}} />
    <div style={{position: 'absolute', left: 0, right: 0, top: SAFE.bottom - lineWidth / 2, height: lineWidth, background: '#DC2626'}} />
  </AbsoluteFill>
);
