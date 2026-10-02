import React from 'react';
import {AbsoluteFill} from 'remotion';
import {COLORS, GRID} from './tokens';

/** White page background with the faint brand grid, full frame. */
export const Grid: React.FC = () => (
  <AbsoluteFill
    style={{
      backgroundColor: COLORS.paper,
      backgroundImage: `linear-gradient(${GRID.color} ${GRID.line}px, transparent ${GRID.line}px), linear-gradient(90deg, ${GRID.color} ${GRID.line}px, transparent ${GRID.line}px)`,
      backgroundSize: `${GRID.cell}px ${GRID.cell}px`,
      // Center the lines on the grid so the left and right edges match.
      backgroundPosition: `${-GRID.line / 2}px ${-GRID.line / 2}px`,
    }}
  />
);
