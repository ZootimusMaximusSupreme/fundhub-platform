import {useCurrentFrame, useVideoConfig} from 'remotion';

// Timing for the lender-matching clips (LenderSlots, FundingRounds,
// LenderMatchScroll). Same idea as the brand's useTimeline, but these clips run
// 2.5 to 4 seconds (75 to 120 frames at 30 fps) instead of the kit's 2 to 3,
// because a reel needs time to spin and land, and a funding sequence needs time
// to run its rounds. A clip can pass its own range (LenderMatchScroll: 3.5 to
// 4.5 s).

export const CLIP_MIN = 75;
export const CLIP_MAX = 120;

/** Clamp a requested clip length to 2.5 to 4 seconds at 30 fps (or a clip's own range). */
export const clampClip = (frames: number | undefined, fallback: number, min = CLIP_MIN, max = CLIP_MAX): number =>
  Math.min(max, Math.max(min, Math.round(frames ?? fallback)));

/**
 * The template's own frame `f`, stretched so the idea lands before the clip
 * ends at any length from 2.5 to 4 seconds. The length comes from props, not
 * useVideoConfig(), so a frozen preview keeps its own timing.
 */
export const useClipTimeline = (base: number, requested?: number, min = CLIP_MIN, max = CLIP_MAX): {f: number; fps: number} => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  return {f: (frame * base) / clampClip(requested, base, min, max), fps};
};
