import React from 'react';
import {AbsoluteFill, Composition, Easing, OffthreadVideo, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {COLORS, FONT_FAMILY, FRAME, SAFE, SafeZoneGuide, SPECTRUM} from '../brand';
import {SeeThrough} from '../brand/Grid';
import {clampClip} from './clipTimeline';

// BlueprintDashboardReal: the real Capital Blueprint dashboard, from the 6-month sample-file screen recording, playing in a full-width window behind Chris. A camera moves through the recording one waypoint at a time: each shot lands the line that matters in the open strip above his head, and a lens card in the open column right of his head shows one more real piece of the same screen up close (the menu, the next move, a check mark, a balance), with a short chip. Everything on screen is the recorded app, never a mock-up.
//
// Footage: public/blueprint/blueprint-6-month-timelapse.mp4, a link to
// ops/workflows/build-evidence/blueprint-timelapse-2026-10-21/ (one simulated
// sample file run through the real app for six months; the recording carries
// its own "sample file, not a real client" badge, cropped out here, so the
// window carries a "Sample file" tag the whole time: sample-clients-consistent).
//
// Readable on a phone (animation-size-readable, owner-set 2026-10-25). The
// recording is 3840 px wide; a shot's camera is a crop of it (x, y, w in
// recording pixels) and the window is 1032 px wide, so a crop 1100 px wide
// shows the app at 0.94x and its body text near 45 px. The lens shows its crop
// at about 0.8x to 1x. Both zones were measured on the Ad 2 person cut-out:
// the strip above his head is y 272-335, the column right of him x 812-1056.
//
// Timing. `shots` is the whole edit: each shot starts at its own clip frame,
// picks a recording time (`src`, seconds) and a speed (`rate`, 0 holds the
// frame), and a camera (`cam`, eased to `camTo` across the shot). A new shot
// cross-fades in over 8 frames. Base length 4 s, 3 to 4 s in the catalog;
// REMOTION_UNCLAMP=1 with a long durationInFrames for a timed ride.

export type RecordingCrop = {x: number; y: number; w: number; h?: number};

export type BlueprintLens = {
  /** Crop of the recording to show up close (h is required here). */
  crop: Required<RecordingCrop>;
  /** Recording time for the lens, seconds. Null follows the shot's own clock. */
  src: number | null;
  /** Short chip over the lens (about 2 words, never his sentence). Null hides it. */
  label: string | null;
  /** Top of the lens card on the frame. */
  top: number;
  /** Card width, right-aligned to the frame edge. Null uses the column width (240). Wider only high up, where his head is narrow. */
  width: number | null;
};

export type BlueprintShot = {
  /** Clip frame where this shot starts. */
  from: number;
  /** Recording time at the shot's start, seconds. */
  src: number;
  /** Playback speed. 0 holds the frame at `src`. */
  rate: number;
  /** Camera crop at the shot's start. */
  cam: RecordingCrop;
  /** Camera crop at the shot's end (eased). Null keeps `cam`. */
  camTo: RecordingCrop | null;
  /** Accent ring around one spot of the recording (recording pixels). Null draws none. */
  focus: Required<RecordingCrop> | null;
  lens: BlueprintLens | null;
};

export type BlueprintDashboardRealProps = {
  /** Tag in the window's top-right corner while the sample file shows. */
  sampleTag: string | null;
  shots: BlueprintShot[];
  durationInFrames?: number;
  showSafeZones?: boolean;
  /** See-through: no page and no grid, so the clip renders with alpha. Default false. */
  transparent?: boolean;
};

export const BLUEPRINT_RECORDING = 'blueprint/blueprint-6-month-timelapse.mp4';
/** The same file again (one git blob), for every odd shot and for the lens: one decoder asked for two times in one frame returned the wrong page, so two shots in a cross-fade, and a shot and its lens, never share a file. */
export const BLUEPRINT_RECORDING_B = 'blueprint/blueprint-6-month-timelapse-b.mp4';
export const BLUEPRINT_RECORDING_LENS = 'blueprint/blueprint-6-month-timelapse-lens.mp4';
const REC_W = 3840;
const REC_H = 2160;

/** The window, behind Chris. Its top strip sits in the text-safe band, above his head. */
export const WIN = {x: 24, y: SAFE.top + 3, w: 1032, h: 960, radius: 26} as const;
/** The lens column, right of his head on the Ad 2 cut-out. */
export const LENS = {x: 812, w: 240, pad: 12} as const;
const XF = 8;
const HOLD_RATE = 0.0001;

// Capital Blueprint Ad 2, from "exists" (33.29 s) to "making money" (66.9 s):
// 1011 frames. Each shot leads its words by a few frames.
export const blueprintDashboardRealDefaults: BlueprintDashboardRealProps = {
  sampleTag: 'Sample file',
  shots: [
    // "So I built the Capital Blueprint, a dashboard": the client's home and its menu.
    {from: 0, src: 0.7, rate: 0, cam: {x: 500, y: 172, w: 1400}, camTo: {x: 500, y: 176, w: 1360}, focus: null,
      lens: {crop: {x: 50, y: 280, w: 290, h: 400}, src: 0.7, label: 'Your dashboard', top: 400, width: null}},
    // "walks you through it one waypoint at a time": the next move on the progress page.
    {from: 84, src: 1.8, rate: 0, cam: {x: 2680, y: 614, w: 1100}, camTo: {x: 2690, y: 616, w: 1080}, focus: null,
      lens: {crop: {x: 2760, y: 544, w: 190, h: 68}, src: 1.8, label: 'Next waypoint', top: 420, width: null}},
    // "past the exact point where most people quit": the checklist scrolls, steps already ticked.
    {from: 168, src: 2.5, rate: 1, cam: {x: 540, y: 120, w: 1200}, camTo: null, focus: null,
      lens: {crop: {x: 548, y: 1522, w: 290, h: 124}, src: 4.0, label: 'Steps clear', top: 440, width: null}},
    {from: 273, src: 6.0, rate: 0, cam: {x: 540, y: 120, w: 1200}, camTo: null, focus: null, lens: null},
    // "Each waypoint tells you exactly what move to make next": the first open step and its due date.
    {from: 294, src: 4.0, rate: 0, cam: {x: 560, y: 150, w: 1150}, camTo: {x: 575, y: 152, w: 1120}, focus: {x: 548, y: 160, w: 830, h: 125},
      lens: {crop: {x: 720, y: 226, w: 300, h: 50}, src: 4.0, label: 'Due date', top: 396, width: 312}},
    // "which letters to send to optimize your credit": the dispute letters step and its due date.
    {from: 486, src: 4.0, rate: 0, cam: {x: 560, y: 386, w: 1150}, camTo: {x: 575, y: 388, w: 1120}, focus: {x: 548, y: 395, w: 700, h: 125},
      lens: {crop: {x: 720, y: 458, w: 280, h: 52}, src: 4.0, label: 'Letters', top: 396, width: 312}},
    // "which banks to apply to in the exact order": the credit and funding menu.
    {from: 556, src: 12.2, rate: 0, cam: {x: 880, y: 268, w: 1150}, camTo: {x: 890, y: 270, w: 1120}, focus: null,
      lens: {crop: {x: 500, y: 640, w: 300, h: 650}, src: 12.2, label: 'Bank order', top: 400, width: null}},
    // "which banks to open up accounts with ... optimize your business": the credit page plays, cards used and the balance fall.
    {from: 636, src: 12.1, rate: 0.5, cam: {x: 880, y: 268, w: 1150}, camTo: {x: 880, y: 268, w: 1100}, focus: null,
      lens: {crop: {x: 2020, y: 1492, w: 240, h: 170}, src: null, label: 'Balance down', top: 460, width: null}},
    {from: 804, src: 14.9, rate: 0, cam: {x: 880, y: 268, w: 1100}, camTo: null, focus: null, lens: null},
    // "The system holds you accountable and nudges you ... focus on making money": the checklist six months on, every step done, and the money menu.
    {from: 822, src: 15.7, rate: 0, cam: {x: 540, y: 690, w: 1150}, camTo: {x: 540, y: 1060, w: 1150}, focus: null,
      lens: {crop: {x: 500, y: 44, w: 300, h: 540}, src: 14.2, label: 'Alerts on', top: 400, width: null}},
  ],
  transparent: false,
};

/** Base length 4 s; a shot list may ask for 3 to 4 s (90 to 120 frames). REMOTION_UNCLAMP=1 lifts the cap for the timed ride (1011 frames on Ad 2). */
export const BLUEPRINT_DASHBOARD_REAL_BASE = 120;
export const BLUEPRINT_DASHBOARD_REAL_MIN = 90;
export const BLUEPRINT_DASHBOARD_REAL_MAX = 120;

export const blueprintDashboardRealDuration = (requested?: number): number =>
  clampClip(requested, BLUEPRINT_DASHBOARD_REAL_BASE, BLUEPRINT_DASHBOARD_REAL_MIN, BLUEPRINT_DASHBOARD_REAL_MAX);

const ease = Easing.bezier(0.45, 0, 0.25, 1);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** One recording frame, cropped and scaled into a box `boxW` wide. Holds when rate is 0. */
const Recording: React.FC<{src: number; rate: number; crop: RecordingCrop; boxW: number; file?: string}> = ({src, rate, crop, boxW, file = BLUEPRINT_RECORDING}) => {
  const {fps} = useVideoConfig();
  const z = boxW / crop.w;
  const start = Math.round(src * fps);
  // A held frame is a near-zero playback rate from its start: <Freeze> resolves
  // its frame inside the parent Sequence, which clamps a frame past the shot's
  // length and showed the wrong page.
  return (
    <OffthreadVideo
      src={staticFile(file)}
      muted
      trimBefore={start}
      playbackRate={rate > 0 ? rate : HOLD_RATE}
      style={{position: 'absolute', left: -crop.x * z, top: -crop.y * z, width: REC_W * z, height: REC_H * z, maxWidth: 'none'}}
    />
  );
};

const ShotScreen: React.FC<{shot: BlueprintShot; len: number; fadeIn: boolean; file: string}> = ({shot, len, fadeIn, file}) => {
  const frame = useCurrentFrame();
  const t = ease(Math.min(1, Math.max(0, frame / Math.max(1, len))));
  const to = shot.camTo ?? shot.cam;
  const cam = {x: lerp(shot.cam.x, to.x, t), y: lerp(shot.cam.y, to.y, t), w: lerp(shot.cam.w, to.w, t)};
  const z = WIN.w / cam.w;
  const opacity = fadeIn ? interpolate(frame, [0, XF], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}) : 1;
  const ring = shot.focus;
  const pulse = 0.55 + 0.45 * Math.sin((frame / 30) * Math.PI * 1.6);
  return (
    <AbsoluteFill style={{opacity}}>
      <Recording src={shot.src} rate={shot.rate} crop={cam} boxW={WIN.w} file={file} />
      {ring ? (
        <div
          style={{
            position: 'absolute',
            left: (ring.x - cam.x) * z,
            top: (ring.y - cam.y) * z,
            width: ring.w * z,
            height: ring.h * z,
            borderRadius: 18,
            border: `5px solid ${COLORS.accent}`,
            boxShadow: `0 0 0 ${6 + 6 * pulse}px rgba(61,134,240,${0.12 + 0.1 * pulse})`,
            opacity: interpolate(frame, [6, 16], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}),
          }}
        />
      ) : null}
    </AbsoluteFill>
  );
};

const LensCard: React.FC<{lens: BlueprintLens; shot: BlueprintShot; len: number}> = ({lens, shot, len}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const cardW = lens.width ?? LENS.w;
  const inner = cardW - LENS.pad * 2;
  const z = inner / lens.crop.w;
  const h = lens.crop.h * z;
  const pop = spring({frame: frame - 2, fps, config: {damping: 15, stiffness: 160, mass: 0.7}});
  const out = interpolate(frame, [len - 6, len], [1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const recSrc = lens.src ?? shot.src;
  const rate = lens.src == null ? shot.rate : 0;
  return (
    <div style={{position: 'absolute', left: LENS.x + LENS.w - cardW, top: lens.top, width: cardW, opacity: Math.min(1, pop * 1.4) * out, transform: `translateY(${(1 - pop) * 24}px) scale(${0.92 + 0.08 * pop})`, transformOrigin: 'top right'}}>
      {lens.label ? (
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 10,
            marginBottom: 10,
            float: 'right',
            padding: '8px 16px',
            borderRadius: 999,
            background: COLORS.white,
            border: '2px solid #ECECEF',
            boxShadow: '0 6px 16px rgba(10,10,10,.16)',
            fontFamily: FONT_FAMILY,
            fontWeight: 700,
            fontSize: 30,
            lineHeight: 1,
            color: COLORS.ink,
            whiteSpace: 'nowrap',
          }}
        >
          <span style={{width: 18, height: 4, borderRadius: 2, background: SPECTRUM}} />
          {lens.label}
        </div>
      ) : null}
      <div
        style={{
          position: 'relative',
          clear: 'both',
          width: cardW,
          height: h + LENS.pad * 2,
          borderRadius: 22,
          background: COLORS.white,
          border: `3px solid ${COLORS.accent}`,
          boxShadow: '0 16px 36px rgba(10,10,10,.28)',
          overflow: 'hidden',
        }}
      >
        <div style={{position: 'absolute', left: LENS.pad, top: LENS.pad, width: inner, height: h, overflow: 'hidden', borderRadius: 10}}>
          <Recording src={recSrc} rate={rate} crop={lens.crop} boxW={inner} file={BLUEPRINT_RECORDING_LENS} />
        </div>
      </div>
    </div>
  );
};

const Scene: React.FC<BlueprintDashboardRealProps> = (p) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const total = blueprintDashboardRealDuration(p.durationInFrames);
  const shots = [...p.shots].sort((a, b) => a.from - b.from).filter((s) => s.from < total);
  const open = spring({frame, fps, config: {damping: 16, stiffness: 120, mass: 0.8}});
  const close = interpolate(frame, [total - 12, total], [1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  return (
    <AbsoluteFill>
      <div
        style={{
          position: 'absolute',
          left: WIN.x,
          top: WIN.y,
          width: WIN.w,
          height: WIN.h,
          borderRadius: WIN.radius,
          overflow: 'hidden',
          background: '#F7F6F3',
          border: '3px solid #FFFFFF',
          boxShadow: '0 24px 60px rgba(10,10,10,.32)',
          opacity: Math.min(1, open * 1.3) * close,
          transform: `translateY(${(1 - open) * 40}px) scale(${0.94 + 0.06 * open})`,
        }}
      >
        {shots.map((s, i) => {
          const end = i + 1 < shots.length ? shots[i + 1].from : total;
          return (
            <Sequence key={`s${i}`} from={s.from} durationInFrames={Math.max(1, end - s.from + (i + 1 < shots.length ? XF : 0))} layout="none">
              <ShotScreen shot={s} len={end - s.from} fadeIn={i > 0} file={i % 2 ? BLUEPRINT_RECORDING_B : BLUEPRINT_RECORDING} />
            </Sequence>
          );
        })}
        {p.sampleTag ? (
          <div
            style={{
              position: 'absolute',
              right: 14,
              top: 12,
              padding: '8px 14px',
              borderRadius: 999,
              background: COLORS.white,
              border: '2px solid #EBDDA0',
              fontFamily: FONT_FAMILY,
              fontWeight: 700,
              fontSize: 28,
              lineHeight: 1,
              color: '#9A7B00',
              boxShadow: '0 4px 12px rgba(10,10,10,.12)',
            }}
          >
            {p.sampleTag}
          </div>
        ) : null}
      </div>
      {shots.map((s, i) => {
        if (!s.lens) return null;
        const end = i + 1 < shots.length ? shots[i + 1].from : total;
        const from = s.from + 4;
        const len = Math.max(1, end - from);
        return (
          <Sequence key={`l${i}`} from={from} durationInFrames={len} layout="none">
            <div style={{opacity: close}}>
              <LensCard lens={s.lens} shot={s} len={len} />
            </div>
          </Sequence>
        );
      })}
      {p.showSafeZones ? <SafeZoneGuide /> : null}
    </AbsoluteFill>
  );
};

export const BlueprintDashboardReal: React.FC<BlueprintDashboardRealProps> = (props) => (
  <SeeThrough on={props.transparent}>
    <AbsoluteFill style={{backgroundColor: props.transparent ? 'transparent' : COLORS.paper}}>
      <Scene {...props} />
    </AbsoluteFill>
  </SeeThrough>
);

// Still:  npx remotion still src/index.ts BlueprintDashboardReal out/blueprint-real.png --frame=100
export const BlueprintDashboardRealCompositions: React.FC = () => (
  <>
    <Composition
      id="BlueprintDashboardReal"
      component={BlueprintDashboardReal}
      durationInFrames={BLUEPRINT_DASHBOARD_REAL_BASE}
      fps={FRAME.fps}
      width={FRAME.width}
      height={FRAME.height}
      defaultProps={blueprintDashboardRealDefaults}
      calculateMetadata={({props}) => ({durationInFrames: blueprintDashboardRealDuration(props.durationInFrames)})}
    />
  </>
);
