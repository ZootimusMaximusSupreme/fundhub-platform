import {Composition} from 'remotion';
import {FRAME} from '../brand';
import {BOOK_CALL_BASE, BookCall, bookCallDefaults} from './BookCall';
import {OFFER_STACK_BASE, OfferStack, offerStackDefaults} from './OfferStack';
import {clampOfferCta} from './offer-cta-timeline';

// Unit C's two clips (broll-v2-2026-10-02): the $297 offer stack and the
// book-a-call calendar. Registered in Root.tsx on their own (not in the
// contact-sheet registry) because they run 2.5 to 3.5 seconds, not 2 to 3.
export const OFFER_CTA_COMPOSITIONS = (
  <>
    <Composition
      id="OfferStack"
      component={OfferStack}
      durationInFrames={OFFER_STACK_BASE}
      fps={FRAME.fps}
      width={FRAME.width}
      height={FRAME.height}
      defaultProps={offerStackDefaults}
      calculateMetadata={({props}) => ({durationInFrames: clampOfferCta(props.durationInFrames, OFFER_STACK_BASE)})}
    />
    <Composition
      id="BookCall"
      component={BookCall}
      durationInFrames={BOOK_CALL_BASE}
      fps={FRAME.fps}
      width={FRAME.width}
      height={FRAME.height}
      defaultProps={bookCallDefaults}
      calculateMetadata={({props}) => ({durationInFrames: clampOfferCta(props.durationInFrames, BOOK_CALL_BASE)})}
    />
  </>
);
