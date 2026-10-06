import React, {createContext, useContext} from 'react';
import {AbsoluteFill} from 'remotion';
import {COLORS, GRID} from './tokens';

// See-through switch (spec §9.4; step 1 of the 10/2 saved plan in
// ops/workflows/broll-v2-2026-10-02.md). Every template takes
// `transparent` (default false) and wraps its frame in <SeeThrough>. When it
// is on, the page drops out: no white paper and no grid, so the clip renders
// with an alpha channel and can be laid over filmed video. Cards, words,
// money and shadows stay exactly where they are, words still inside the text
// safe band. When it is off nothing changes, frame for frame.
// Render commands for alpha video are in marketing/broll/README.md.
const SeeThroughContext = createContext(false);

/** Wraps a template's frame. `on` is the template's `transparent` prop. */
export const SeeThrough: React.FC<{on?: boolean; children: React.ReactNode}> = ({on = false, children}) => (
  <SeeThroughContext.Provider value={on === true}>{children}</SeeThroughContext.Provider>
);

/** True inside <SeeThrough on>. A template that paints its own page (the wide 4K formats) skips it when this is true. */
export const useSeeThrough = (): boolean => useContext(SeeThroughContext);

/** White page background with the faint brand grid, full frame. Draws nothing when the clip is see-through. */
export const Grid: React.FC = () => {
  const seeThrough = useSeeThrough();
  if (seeThrough) return null;
  return (
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
};
