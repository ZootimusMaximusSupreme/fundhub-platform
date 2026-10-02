import type {CSSProperties} from 'react';
import {Easing, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {clampDuration} from './format';

// Motion rules for the kit: smooth and quick, one idea per clip, no bounce.
// Springs are critically damped (damping 200) so nothing overshoots.

/**
 * Every template is timed against a base length (its default duration). When a
 * shot list asks for a longer or shorter clip (2 to 3 seconds), the timeline
 * stretches to fit, so the idea always lands before the clip ends. The length
 * comes from the props, not from useVideoConfig(), so a template frozen inside
 * the contact sheet keeps its own timing.
 */
export const useTimeline = (baseDurationInFrames: number, requested?: number): {f: number; fps: number} => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  return {f: (frame * baseDurationInFrames) / clampDuration(requested, baseDurationInFrames), fps};
};

/** 0 to 1, a no-overshoot spring that starts at `delay` and settles in `duration` frames. */
export const enter = (frame: number, fps: number, delay: number, duration = 16): number =>
  spring({frame: frame - delay, fps, durationInFrames: duration, config: {damping: 200}});

/** Fade in while sliding up a short distance. */
export const fadeUp = (progress: number, distance = 26): CSSProperties => ({
  opacity: progress,
  transform: `translateY(${(1 - progress) * distance}px)`,
});

/** Fade in while sliding in from the left a short distance. */
export const fadeRight = (progress: number, distance = 30): CSSProperties => ({
  opacity: progress,
  transform: `translateX(${(1 - progress) * -distance}px)`,
});

/** A number that counts from `from` to `to` between two frames, easing out. */
export const countUp = (frame: number, start: number, end: number, from: number, to: number): number =>
  interpolate(frame, [start, end], [from, to], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });

/** Plain 0 to 1 progress between two frames, easing in and out. */
export const progressBetween = (frame: number, start: number, end: number): number =>
  interpolate(frame, [start, end], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.inOut(Easing.cubic),
  });
