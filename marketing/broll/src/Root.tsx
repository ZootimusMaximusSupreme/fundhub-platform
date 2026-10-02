import React from 'react';
import {Composition} from 'remotion';
import {CONTACT_SHEET, ContactSheet} from './ContactSheet';
import {FRAME} from './brand';
import {TEMPLATES} from './templates/registry';

// The contact sheet is a Composition, not a Still: Remotion clamps every
// frame to the composition's length, and a 1-frame Still would freeze each
// template at frame 0. Render it with `remotion still ... ContactSheet`.
const SHEET_FRAMES = Math.max(...TEMPLATES.map((t) => t.hero)) + 1;

export const RemotionRoot: React.FC = () => (
  <>
    {TEMPLATES.map((t) => t.composition())}
    <Composition
      id="ContactSheet"
      component={ContactSheet}
      durationInFrames={SHEET_FRAMES}
      fps={FRAME.fps}
      width={CONTACT_SHEET.width}
      height={CONTACT_SHEET.height}
    />
  </>
);
