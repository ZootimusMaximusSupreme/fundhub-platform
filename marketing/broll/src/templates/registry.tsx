import React from 'react';
import {Composition} from 'remotion';
import {FRAME, clampDuration} from '../brand';
import {KIT_WIDE} from '../brand/KitFrame';
import {FILE_ITEMS_BASE, FILE_ITEMS_HERO, FileItems, fileItemsDefaults} from './FileItems';
import {HIDDEN_DATA_POINTS_BASE, HIDDEN_DATA_POINTS_HERO, HiddenDataPoints, hiddenDataPointsDefaults} from './HiddenDataPoints';
import {INQUIRIES_OFF_BASE, INQUIRIES_OFF_HERO, InquiriesOff, inquiriesOffDefaults} from './InquiriesOff';
import {LENDER_LIST_BASE, LENDER_LIST_HERO, LenderList, lenderListDefaults} from './LenderList';
import {QUALIFY_TODAY_BASE, QUALIFY_TODAY_HERO, QualifyToday, qualifyTodayDefaults} from './QualifyToday';
import {RATES_RISING_BASE, RATES_RISING_HERO, RatesRising, ratesRisingDefaults} from './RatesRising';
import {SOFT_PULL_BASE, SOFT_PULL_HERO, SoftPull, softPullDefaults} from './SoftPull';
import {STEP_PATH_BASE, STEP_PATH_HERO, StepPath, stepPathDefaults} from './StepPath';

export type TemplateEntry = {
  /** Composition id for the CLI. */
  id: string;
  /** Preview file name in previews/. */
  file: string;
  title: string;
  what: string;
  /** Default length in frames (30 fps). Props can ask for 60 to 90. */
  base: number;
  /** The frame where the idea is fully on screen; used for the preview still. */
  hero: number;
  composition: () => React.ReactElement;
  preview: () => React.ReactElement;
};

const entry = <P extends {durationInFrames?: number} & Record<string, unknown>>(e: {
  id: string;
  file: string;
  title: string;
  what: string;
  base: number;
  hero: number;
  component: React.ComponentType<P>;
  defaultProps: P;
}): TemplateEntry => ({
  id: e.id,
  file: e.file,
  title: e.title,
  what: e.what,
  base: e.base,
  hero: e.hero,
  composition: () => (
    <Composition
      key={e.id}
      id={e.id}
      component={e.component}
      durationInFrames={e.base}
      fps={FRAME.fps}
      width={FRAME.width}
      height={FRAME.height}
      defaultProps={e.defaultProps}
      calculateMetadata={({props}) => ({
        durationInFrames: clampDuration(typeof props.durationInFrames === 'number' ? props.durationInFrames : undefined, e.base),
      })}
    />
  ),
  preview: () => React.createElement(e.component, e.defaultProps),
});

/** The kit, in contact-sheet order. */
export const TEMPLATES: TemplateEntry[] = [
  entry({
    id: 'QualifyToday',
    file: 'qualify-today',
    title: 'Qualify today vs once fixed',
    what: 'A floating card: today and once-fixed amounts roll up, each beside a 3D cash stack that grows with it (the gap stacks on top in blue). Bills rise behind.',
    base: QUALIFY_TODAY_BASE,
    hero: QUALIFY_TODAY_HERO,
    component: QualifyToday,
    defaultProps: qualifyTodayDefaults,
  }),
  entry({
    id: 'FileItems',
    file: 'file-items',
    title: 'Items on the credit report',
    what: 'The report floats on a stack of pages. Red chips: a bill flies off each one. Green chips: a gold coin flips in beside each.',
    base: FILE_ITEMS_BASE,
    hero: FILE_ITEMS_HERO,
    component: FileItems,
    defaultProps: fileItemsDefaults,
  }),
  entry({
    id: 'HiddenDataPoints',
    file: 'hidden-data-points',
    title: 'The 13 hidden data points',
    what: 'Thirteen glossy dots light up on a tilted orbit around the count; back dots pass behind it. Bills drift behind the ring. Dots never labeled.',
    base: HIDDEN_DATA_POINTS_BASE,
    hero: HIDDEN_DATA_POINTS_HERO,
    component: HiddenDataPoints,
    defaultProps: hiddenDataPointsDefaults,
  }),
  entry({
    id: 'InquiriesOff',
    file: 'inquiries-off',
    title: 'Inquiries off between rounds',
    what: 'Hard inquiries are struck off a floating card, then bills ride the line down into the next funding round.',
    base: INQUIRIES_OFF_BASE,
    hero: INQUIRIES_OFF_HERO,
    component: InquiriesOff,
    defaultProps: inquiriesOffDefaults,
  }),
  entry({
    id: 'LenderList',
    file: 'lender-list',
    title: 'The lender list, in order',
    what: 'Each lender row is its own floating slab; a gold coin flips in at the end of each. Names stay blank unless a shot list gives real ones.',
    base: LENDER_LIST_BASE,
    hero: LENDER_LIST_HERO,
    component: LenderList,
    defaultProps: lenderListDefaults,
  }),
  entry({
    id: 'StepPath',
    file: 'step-path',
    title: 'The step-by-step path',
    what: 'Thick numbered discs flip from gray to blue as the line runs down the steps. Bills rise up the sides as the path completes.',
    base: STEP_PATH_BASE,
    hero: STEP_PATH_HERO,
    component: StepPath,
    defaultProps: stepPathDefaults,
  }),
  entry({
    id: 'RatesRising',
    file: 'rates-rising',
    title: 'Interest rates going up',
    what: 'On a floating panel a thick line climbs to a Rates chip while a cash stack shrinks. No rate values or dates.',
    base: RATES_RISING_BASE,
    hero: RATES_RISING_HERO,
    component: RatesRising,
    defaultProps: ratesRisingDefaults,
  }),
  entry({
    id: 'SoftPull',
    file: 'soft-pull',
    title: 'Soft pull, score does not move',
    what: 'A scan passes over a thick 3D dial and the score stays put. Bills hang faint and still at the sides.',
    base: SOFT_PULL_BASE,
    hero: SOFT_PULL_HERO,
    component: SoftPull,
    defaultProps: softPullDefaults,
  }),
];

// The wide 4K versions (3840x2160) for the sideways VSL and thank-you video.
// Same component, same words and the same 2 to 3 second clamp as the vertical
// one; `format: 'wide'` puts it all in one side panel and `side` picks the
// panel (left by default), so the face and the captions in the middle stay
// clear. Still: npx remotion still src/index.ts FileItemsWide out/file-items-wide.png --frame=72
export const RegistryWideCompositions: React.FC = () => (
  <>
    <Composition
      id="QualifyTodayWide"
      component={QualifyToday}
      durationInFrames={QUALIFY_TODAY_BASE}
      fps={KIT_WIDE.fps}
      width={KIT_WIDE.width}
      height={KIT_WIDE.height}
      defaultProps={{...qualifyTodayDefaults, format: 'wide' as const, side: 'left' as const}}
      calculateMetadata={({props}) => ({
        durationInFrames: clampDuration(typeof props.durationInFrames === 'number' ? props.durationInFrames : undefined, QUALIFY_TODAY_BASE),
      })}
    />
    <Composition
      id="FileItemsWide"
      component={FileItems}
      durationInFrames={FILE_ITEMS_BASE}
      fps={KIT_WIDE.fps}
      width={KIT_WIDE.width}
      height={KIT_WIDE.height}
      defaultProps={{...fileItemsDefaults, format: 'wide' as const, side: 'left' as const}}
      calculateMetadata={({props}) => ({
        durationInFrames: clampDuration(typeof props.durationInFrames === 'number' ? props.durationInFrames : undefined, FILE_ITEMS_BASE),
      })}
    />
    <Composition
      id="HiddenDataPointsWide"
      component={HiddenDataPoints}
      durationInFrames={HIDDEN_DATA_POINTS_BASE}
      fps={KIT_WIDE.fps}
      width={KIT_WIDE.width}
      height={KIT_WIDE.height}
      defaultProps={{...hiddenDataPointsDefaults, format: 'wide' as const, side: 'left' as const}}
      calculateMetadata={({props}) => ({
        durationInFrames: clampDuration(typeof props.durationInFrames === 'number' ? props.durationInFrames : undefined, HIDDEN_DATA_POINTS_BASE),
      })}
    />
    <Composition
      id="StepPathWide"
      component={StepPath}
      durationInFrames={STEP_PATH_BASE}
      fps={KIT_WIDE.fps}
      width={KIT_WIDE.width}
      height={KIT_WIDE.height}
      defaultProps={{...stepPathDefaults, format: 'wide' as const, side: 'left' as const}}
      calculateMetadata={({props}) => ({
        durationInFrames: clampDuration(typeof props.durationInFrames === 'number' ? props.durationInFrames : undefined, STEP_PATH_BASE),
      })}
    />
    <Composition
      id="SoftPullWide"
      component={SoftPull}
      durationInFrames={SOFT_PULL_BASE}
      fps={KIT_WIDE.fps}
      width={KIT_WIDE.width}
      height={KIT_WIDE.height}
      defaultProps={{...softPullDefaults, format: 'wide' as const, side: 'left' as const}}
      calculateMetadata={({props}) => ({
        durationInFrames: clampDuration(typeof props.durationInFrames === 'number' ? props.durationInFrames : undefined, SOFT_PULL_BASE),
      })}
    />
  </>
);
