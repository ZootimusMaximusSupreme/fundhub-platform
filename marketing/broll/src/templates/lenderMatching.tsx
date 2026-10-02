import React from 'react';
import {Composition} from 'remotion';
import {FRAME} from '../brand';
import {clampClip} from './clipTimeline';
import {FUNDING_ROUNDS_BASE, FundingRounds, fundingRoundsBase, fundingRoundsDefaults} from './FundingRounds';
import {LENDER_SLOTS_BASE, LenderSlots, lenderSlotsDefaults} from './LenderSlots';

// Compositions for the lender-matching clips (Unit E, broll-v2-2026-10-02).
// They run 2.5 to 4 seconds, so they register here with their own length
// clamp instead of the kit's 2-to-3-second registry entry.
//
// Stills:  npx remotion still src/index.ts LenderSlots previews/lender-slots.png --frame=100
//          npx remotion still src/index.ts FundingRounds previews/funding-rounds.png --frame=106

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
  </>
);
