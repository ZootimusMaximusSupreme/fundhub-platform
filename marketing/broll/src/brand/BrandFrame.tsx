import React from 'react';
import {AbsoluteFill} from 'remotion';
import {FONT_FAMILY} from './fonts';
import {Grid} from './Grid';
import {SafeZoneGuide} from './SafeZoneGuide';
import {COLORS, CONTENT, MARGIN_X, SAFE, SAFE_HEIGHT, WORDMARK} from './tokens';
import {Wordmark} from './Wordmark';

/**
 * The shared canvas for every template: white page, faint grid, the "fundhub."
 * wordmark, and a content box that sits fully inside the text safe zone
 * (y 269 to 1248). Anything passed as `children` is clipped to that zone, so no
 * word or number can land where Instagram or Facebook draw their buttons.
 * `backdrop` is for full-frame shapes with no text in them.
 */
export const BrandFrame: React.FC<{
  children: React.ReactNode;
  backdrop?: React.ReactNode;
  showSafeZones?: boolean;
}> = ({children, backdrop, showSafeZones = false}) => (
  <AbsoluteFill style={{fontFamily: FONT_FAMILY, color: COLORS.ink, WebkitFontSmoothing: 'antialiased'}}>
    <Grid />
    {backdrop}
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: SAFE.top,
        height: SAFE_HEIGHT,
        overflow: 'hidden',
      }}
    >
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
    {showSafeZones ? <SafeZoneGuide /> : null}
  </AbsoluteFill>
);
