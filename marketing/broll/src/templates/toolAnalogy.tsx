import React from 'react';
import {Composition} from 'remotion';
import {FRAME} from '../brand';
import {
  FLAT_TIRE_HAMMER_BASE,
  FLAT_TIRE_HAMMER_MAX,
  FLAT_TIRE_HAMMER_MIN,
  FlatTireHammer,
  flatTireHammerDefaults,
} from './FlatTireHammer';
import {JACK_FIX_BASE, JACK_FIX_MAX, JACK_FIX_MIN, JackFix, jackFixDefaults} from './JackFix';
import {TOOL_MATCH_BASE, TOOL_MATCH_MAX, TOOL_MATCH_MIN, ToolMatch, toolMatchDefaults} from './ToolMatch';
import {clampTool} from './toolScene';

// The tool-analogy clips for the two Notes ads (Scripts 3 and 4 in
// marketing/ads/notes-green-screen.md on main). Each has its own length range,
// so they register here instead of in the registry (which clamps to 2-3 s).

const len = (props: Record<string, unknown>, base: number, min: number, max: number) =>
  clampTool(typeof props.durationInFrames === 'number' ? props.durationInFrames : undefined, base, min, max);

export const ToolAnalogyCompositions: React.FC = () => (
  <>
    <Composition
      id="FlatTireHammer"
      component={FlatTireHammer}
      durationInFrames={FLAT_TIRE_HAMMER_BASE}
      fps={FRAME.fps}
      width={FRAME.width}
      height={FRAME.height}
      defaultProps={flatTireHammerDefaults}
      calculateMetadata={({props}) => ({durationInFrames: len(props, FLAT_TIRE_HAMMER_BASE, FLAT_TIRE_HAMMER_MIN, FLAT_TIRE_HAMMER_MAX)})}
    />
    <Composition
      id="JackFix"
      component={JackFix}
      durationInFrames={JACK_FIX_BASE}
      fps={FRAME.fps}
      width={FRAME.width}
      height={FRAME.height}
      defaultProps={jackFixDefaults}
      calculateMetadata={({props}) => ({durationInFrames: len(props, JACK_FIX_BASE, JACK_FIX_MIN, JACK_FIX_MAX)})}
    />
    <Composition
      id="ToolMatch"
      component={ToolMatch}
      durationInFrames={TOOL_MATCH_BASE}
      fps={FRAME.fps}
      width={FRAME.width}
      height={FRAME.height}
      defaultProps={toolMatchDefaults}
      calculateMetadata={({props}) => ({durationInFrames: len(props, TOOL_MATCH_BASE, TOOL_MATCH_MIN, TOOL_MATCH_MAX)})}
    />
  </>
);
