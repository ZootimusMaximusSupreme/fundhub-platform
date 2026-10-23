import React from 'react';
import {useSeeThrough} from './Grid';
import {COLORS} from './tokens';
import {WORDMARK_ASPECT, WORDMARK_GROUP_TRANSFORM, WORDMARK_PATHS, WORDMARK_VIEWBOX} from './wordmark-paths';

/**
 * The lowercase "fundhub." wordmark with the period, drawn from the page's own vector.
 *
 * Owner rule (Chris, 2026-10-23): no logo on the see-through clips laid over his
 * videos; the brand shows in its own logo animation instead. So inside
 * <SeeThrough on> the wordmark draws nothing, unless `keepInSeeThrough` is set
 * (only the logo animation sets it). The page-on look is unchanged.
 */
export const Wordmark: React.FC<{width: number; color?: string; style?: React.CSSProperties; keepInSeeThrough?: boolean}> = ({
  width,
  color = COLORS.ink,
  style,
  keepInSeeThrough = false,
}) => {
  const seeThrough = useSeeThrough();
  if (seeThrough && !keepInSeeThrough) return null;
  return (
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
};
