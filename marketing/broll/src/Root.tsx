import React from 'react';
import {Composition} from 'remotion';
import {CONTACT_SHEET, ContactSheet} from './ContactSheet';
import {DEPTH_KIT_DEMO_FRAMES, DepthKitDemo} from './DepthKitDemo';
import {FRAME} from './brand';
import {RegistryWideCompositions, TEMPLATES} from './templates/registry';
import {InquiriesOffWideComposition} from './templates/InquiriesOff';
import {OFFER_CTA_COMPOSITIONS} from './templates/offer-cta';
import {LenderMatchingCompositions} from './templates/lenderMatching';
import {companyLineComposition} from './templates/CompanyLine';
import {ProofWallComposition} from './templates/ProofWall';
import {ProofFloodCompositions} from './templates/ProofFlood';
import {BankPocketsCompositions} from './templates/BankPockets';
import {MoneyClimbCompositions} from './templates/MoneyClimb';
import {ToolAnalogyCompositions} from './templates/toolAnalogy';
import {DeadlineClocksCompositions} from './templates/DeadlineClocks';
import {FundingStackCompositions} from './templates/FundingStack';
import {BureauMatchCompositions} from './templates/BureauMatch';
import {PathCardsCompositions} from './templates/PathCards';
import {SplitBarCompositions} from './templates/SplitBar';
import {IconCountCompositions} from './templates/IconCount';
import {FundabilityMeterCompositions} from './templates/FundabilityMeter';
import {ScoreBadgeCompositions} from './templates/ScoreBadge';
import {TwoPeopleCompositions} from './templates/TwoPeople';
import {ReturnMultipleCompositions} from './templates/ReturnMultiple';
import {CalendarStripCompositions} from './templates/CalendarStrip';
import {StampCardCompositions} from './templates/StampCard';
import {PriceTagCompositions} from './templates/PriceTag';

// The contact sheet is a Composition, not a Still: Remotion clamps every
// frame to the composition's length, and a 1-frame Still would freeze each
// template at frame 0. Render it with `remotion still ... ContactSheet`.
const SHEET_FRAMES = Math.max(...TEMPLATES.map((t) => t.hero)) + 1;

export const RemotionRoot: React.FC = () => (
  <>
    {TEMPLATES.map((t) => t.composition())}
    <RegistryWideCompositions />
    <InquiriesOffWideComposition />
    {companyLineComposition()}
    {OFFER_CTA_COMPOSITIONS}
    <LenderMatchingCompositions />
    <ProofWallComposition />
    <ProofFloodCompositions />
    <BankPocketsCompositions />
    <MoneyClimbCompositions />
    <ToolAnalogyCompositions />
    <DeadlineClocksCompositions />
    <FundingStackCompositions />
    <BureauMatchCompositions />
    <PathCardsCompositions />
    <SplitBarCompositions />
    <IconCountCompositions />
    <FundabilityMeterCompositions />
    <ScoreBadgeCompositions />
    <TwoPeopleCompositions />
    <ReturnMultipleCompositions />
    <CalendarStripCompositions />
    <StampCardCompositions />
    <PriceTagCompositions />
    <Composition
      id="ContactSheet"
      component={ContactSheet}
      durationInFrames={SHEET_FRAMES}
      fps={FRAME.fps}
      width={CONTACT_SHEET.width}
      height={CONTACT_SHEET.height}
    />
    <Composition
      id="DepthKitDemo"
      component={DepthKitDemo}
      durationInFrames={DEPTH_KIT_DEMO_FRAMES}
      fps={FRAME.fps}
      width={FRAME.width}
      height={FRAME.height}
    />
  </>
);
