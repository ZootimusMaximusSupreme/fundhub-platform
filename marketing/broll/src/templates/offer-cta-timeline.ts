import {useCurrentFrame, useVideoConfig} from 'remotion';

// Timing for the two Unit C clips (OfferStack, BookCall). Their brief is 2.5 to
// 3.5 seconds, a little longer than the kit's 2 to 3 second rule, because the
// offer stack has six items and a price to land. Same idea as the kit's
// useTimeline: the animation is written against a base length and stretches to
// whatever length the props ask for, so the idea always lands before the end.

export const OFFER_CTA_MIN = 75; // 2.5 s at 30 fps
export const OFFER_CTA_MAX = 105; // 3.5 s at 30 fps

export const clampOfferCta = (frames: number | undefined, fallback: number): number =>
  Math.min(OFFER_CTA_MAX, Math.max(OFFER_CTA_MIN, Math.round(frames ?? fallback)));

export const useOfferCtaTimeline = (base: number, requested?: number): {f: number; fps: number} => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  return {f: (frame * base) / clampOfferCta(requested, base), fps};
};
