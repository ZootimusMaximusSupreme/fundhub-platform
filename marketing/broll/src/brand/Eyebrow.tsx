import React from 'react';
import {GradientDash} from './GradientDash';
import {COLORS, DASH, TRACK, TYPE} from './tokens';

/**
 * The brand signature label: spectrum dash, then an uppercase label with wide
 * tracking (page `.eyebrow`). `progress` 0 to 1 fades and draws it in.
 */
export const Eyebrow: React.FC<{text: string; progress?: number; align?: 'center' | 'left'}> = ({
  text,
  progress = 1,
  align = 'center',
}) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: align === 'center' ? 'center' : 'flex-start',
      gap: DASH.width * 0.56, // page: margin-right 9px next to a 16px dash
      opacity: progress,
    }}
  >
    <GradientDash grow={progress} />
    <span
      style={{
        fontSize: TYPE.eyebrow,
        fontWeight: 600,
        letterSpacing: TRACK.eyebrow,
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
