import React from 'react';
import {Composition} from 'remotion';
import {CONTACT_SHEET, ContactSheet} from './ContactSheet';
import {DEPTH_KIT_DEMO_FRAMES, DepthKitDemo} from './DepthKitDemo';
import {FRAME} from './brand';
import {TEMPLATES} from './templates/registry';
import {OFFER_CTA_COMPOSITIONS} from './templates/offer-cta';
import {LenderMatchingCompositions} from './templates/lenderMatching';
import {companyLineComposition} from './templates/CompanyLine';
import {ProofWallComposition} from './templates/ProofWall';

// The contact sheet is a Composition, not a Still: Remotion clamps every
// frame to the composition's length, and a 1-frame Still would freeze each
// template at frame 0. Render it with `remotion still ... ContactSheet`.
const SHEET_FRAMES = Math.max(...TEMPLATES.map((t) => t.hero)) + 1;

export const RemotionRoot: React.FC = () => (
  <>
    {TEMPLATES.map((t) => t.composition())}
    {companyLineComposition()}
    {OFFER_CTA_COMPOSITIONS}
    <LenderMatchingCompositions />
    <ProofWallComposition />
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
