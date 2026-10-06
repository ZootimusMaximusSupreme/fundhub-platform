import React from 'react';
import {COLORS} from './tokens';
import {WORDMARK_ASPECT, WORDMARK_GROUP_TRANSFORM, WORDMARK_PATHS, WORDMARK_VIEWBOX} from './wordmark-paths';

/** The lowercase "fundhub." wordmark with the period, drawn from the page's own vector. */
export const Wordmark: React.FC<{width: number; color?: string; style?: React.CSSProperties}> = ({
  width,
  color = COLORS.ink,
  style,
}) => (
  <svg
    width={width}
    height={width / WORDMARK_ASPECT}
    viewBox={WORDMARK_VIEWBOX}
    preserveAspectRatio="xMidYMid meet"
    style={{display: 'block', ...style}}
    aria-label="fundhub."
  >
    <g transform={WORDMARK_GROUP_TRANSFORM} fill={color} stroke="none">
      {WORDMARK_PATHS.map((d) => (
        <path key={d.slice(0, 24)} d={d} />
      ))}
    </g>
  </svg>
);
