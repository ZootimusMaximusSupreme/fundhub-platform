/** Whole dollars with commas: 199350 -> "$199,350". */
export const formatDollars = (value: number): string =>
  `$${Math.round(value).toLocaleString('en-US')}`;

/** Clamp a requested clip length to the kit's 2 to 3 second rule at 30 fps. */
export const clampDuration = (frames: number | undefined, fallback: number): number => {
  const f = Math.round(frames ?? fallback);
  // Timed-to-speech renders (animation plans) stretch a clip past its 2-3 s range: REMOTION_UNCLAMP=1 lifts the cap. Off by default.
  if (typeof process !== 'undefined' && process.env.REMOTION_UNCLAMP === '1') return Math.max(30, f);
  return Math.min(90, Math.max(60, f));
};
