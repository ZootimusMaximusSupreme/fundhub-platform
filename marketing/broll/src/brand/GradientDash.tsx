import React from 'react';
import {DASH, DASH_SMALL, SPECTRUM} from './tokens';

/**
 * The small spectrum dash from the page. `size="eyebrow"` is the 16x2 dash in
 * front of section labels; `size="bullet"` is the 10x2 dash on list items.
 * `grow` (0 to 1) draws it in from the left.
 */
export const GradientDash: React.FC<{size?: 'eyebrow' | 'bullet'; grow?: number; style?: React.CSSProperties}> = ({
  size = 'eyebrow',
  grow = 1,
  style,
}) => {
  const d = size === 'eyebrow' ? DASH : DASH_SMALL;
  return (
    <span
      style={{
        display: 'inline-block',
        flex: '0 0 auto',
        width: d.width,
        height: d.height,
        borderRadius: d.radius,
        background: SPECTRUM,
        transform: `scaleX(${grow})`,
        transformOrigin: 'left center',
        ...style,
      }}
    />
  );
};
