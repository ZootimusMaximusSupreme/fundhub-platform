import React from 'react';
import {Composition} from 'remotion';
import {FRAME} from '../brand';
import {WIDE, wideSize} from '../brand/widePanel';
import {clampClip} from './clipTimeline';
import {FUNDING_ROUNDS_BASE, FundingRounds, fundingRoundsBase, fundingRoundsDefaults} from './FundingRounds';
import {
  LENDER_MATCH_SCROLL_BASE,
  LENDER_MATCH_SCROLL_MAX,
  LENDER_MATCH_SCROLL_MIN,
  LenderMatchScroll,
  lenderMatchScrollDefaults,
} from './LenderMatchScroll';
import {LENDER_SLOTS_BASE, LenderSlots, lenderSlotsDefaults} from './LenderSlots';

// Compositions for the lender-matching clips (Unit E, broll-v2-2026-10-02).
// They run 2.5 to 4 seconds, so they register here with their own length
// clamp instead of the kit's 2-to-3-second registry entry.
//
// Stills:  npx remotion still src/index.ts LenderSlots previews/lender-slots.png --frame=100
//          npx remotion still src/index.ts FundingRounds previews/funding-rounds.png --frame=106
//          npx remotion still src/index.ts LenderMatchScroll previews/lender-match-scroll.png --frame=116
// LenderMatchScroll runs 3.5 to 4.5 s (105 to 135 frames).
// FundingRoundsWide and LenderMatchScrollWide: the same clips at 4K for the
// sideways VSL and thank-you video, the whole scene in one side panel
// ("side": "left" or "right"), clear of the face and the captions.

export const LenderMatchingCompositions: React.FC = () => (
  <>
    <Composition
      id="LenderSlots"
      component={LenderSlots}
      durationInFrames={LENDER_SLOTS_BASE}
      fps={FRAME.fps}
      width={FRAME.width}
      height={FRAME.height}
      defaultProps={lenderSlotsDefaults}
      calculateMetadata={({props}) => ({durationInFrames: clampClip(props.durationInFrames, LENDER_SLOTS_BASE)})}
    />
    <Composition
      id="FundingRounds"
      component={FundingRounds}
      durationInFrames={FUNDING_ROUNDS_BASE}
      fps={FRAME.fps}
      width={FRAME.width}
      height={FRAME.height}
      defaultProps={fundingRoundsDefaults}
      calculateMetadata={({props}) => ({durationInFrames: clampClip(props.durationInFrames, fundingRoundsBase(props.rounds))})}
    />
    <Composition
      id="FundingRoundsWide"
      component={FundingRounds}
      durationInFrames={FUNDING_ROUNDS_BASE}
      fps={WIDE.fps}
      width={WIDE.width}
      height={WIDE.height}
      defaultProps={{...fundingRoundsDefaults, format: 'wide' as const, side: 'left' as const}}
      calculateMetadata={({props}) => ({durationInFrames: clampClip(props.durationInFrames, fundingRoundsBase(props.rounds)), ...wideSize(props.format)})}
    />
    <Composition
      id="LenderMatchScroll"
      component={LenderMatchScroll}
      durationInFrames={LENDER_MATCH_SCROLL_BASE}
      fps={FRAME.fps}
      width={FRAME.width}
      height={FRAME.height}
      defaultProps={lenderMatchScrollDefaults}
      calculateMetadata={({props}) => ({
        durationInFrames: clampClip(props.durationInFrames, LENDER_MATCH_SCROLL_BASE, LENDER_MATCH_SCROLL_MIN, LENDER_MATCH_SCROLL_MAX),
      })}
    />
    <Composition
      id="LenderMatchScrollWide"
      component={LenderMatchScroll}
      durationInFrames={LENDER_MATCH_SCROLL_BASE}
      fps={WIDE.fps}
      width={WIDE.width}
      height={WIDE.height}
      defaultProps={{...lenderMatchScrollDefaults, format: 'wide' as const, side: 'left' as const}}
      calculateMetadata={({props}) => ({
        durationInFrames: clampClip(props.durationInFrames, LENDER_MATCH_SCROLL_BASE, LENDER_MATCH_SCROLL_MIN, LENDER_MATCH_SCROLL_MAX),
        ...wideSize(props.format),
      })}
    />
  </>
);
