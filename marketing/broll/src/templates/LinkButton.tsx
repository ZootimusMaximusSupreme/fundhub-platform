import React from 'react';
import {AbsoluteFill, Composition, Easing, interpolate} from 'remotion';
import {COLORS, FRAME, Grid, SAFE, TRACK, cardShadow, enter} from '../brand';
import {SeeThrough} from '../brand/Grid';
import {FONT_FAMILY} from '../brand/fonts';
import {clampClip, useClipTimeline} from './clipTimeline';

// LinkButton: the call to action as a picture. A big blue button drops in and says what to do ("Click the link below"), a cursor glides over, presses it and a ring spreads out; a small arrow points down at the link; an optional line on a white plate comes in under it. Every word is a prop. No numbers, no logo.
//
// Built 2026-10-23 for Direct Book Ad 11 (Chris: "a visual CTA on 'click the link below'", not a list). The clip is 1080x1920 for ads; see-through renders with alpha, the button keeps its own colour and shadow so it reads over film.

export type LinkButtonProps = {
  /** The words on the button ("Click the link below"). */
  label: string;
  /** An optional line on a white plate under the button. Null hides it. */
  note: string | null;
  /** Base-timeline frame (96 = clip end) where the note lands. Default 54. */
  noteAt?: number;
  durationInFrames?: number;
  showSafeZones?: boolean;
  /** See-through: no page and no grid, so the clip renders with alpha (README.md). Default false. */
  transparent?: boolean;
};

export const linkButtonDefaults: LinkButtonProps = {
  label: 'Click the link below',
  note: null,
  noteAt: 54,
  transparent: false,
};

/** Base length 3.2 s; a shot list may ask for 2 to 4 s (60 to 120 frames). */
export const LINK_BUTTON_BASE = 96;
export const LINK_BUTTON_MIN = 60;
export const LINK_BUTTON_MAX = 120;
/** Frame (on the base timeline) where the button, cursor press and note are all on screen. */
export const LINK_BUTTON_HERO = 90;

export const linkButtonDuration = (requested?: number): number =>
  clampClip(requested, LINK_BUTTON_BASE, LINK_BUTTON_MIN, LINK_BUTTON_MAX);

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

const Cursor: React.FC<{size: number}> = ({size}) => (
  <svg width={size} height={size * 1.25} viewBox="0 0 24 30" style={{filter: 'drop-shadow(0 6px 8px rgba(10,10,10,.35))'}}>
    <path d="M3 1.5 L3 23 L8.6 17.8 L12.4 27 L16.2 25.4 L12.4 16.6 L20.2 16.6 Z" fill="#0A0A0A" stroke="#FFFFFF" strokeWidth="2" strokeLinejoin="round" />
  </svg>
);

const Arrow: React.FC<{size: number}> = ({size}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={COLORS.accent} strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3 L12 19" />
    <path d="M5 12 L12 19 L19 12" />
  </svg>
);

const Scene: React.FC<LinkButtonProps & {f: number; fps: number}> = ({f, fps, label, note, noteAt = 54}) => {
  const btnIn = enter(f, fps, 2, 12);
  // cursor: glides in from lower right to the button, presses at f 34
  const glide = interpolate(f, [14, 32], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic)});
  const press = interpolate(f, [32, 36, 42], [0, 1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const ring = interpolate(f, [34, 62], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic)});
  const arrowIn = enter(f, fps, 28, 12);
  const bounce = f > 40 ? Math.sin((f - 40) / 5) * 8 * clamp01((f - 40) / 6) : 0;
  const noteIn = enter(f, fps, noteAt, 12);
  const W = 880;
  const H = 190;
  return (
    <div style={{position: 'relative', width: 1000, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 26}}>
      <div style={{position: 'relative', width: W, height: H, transform: `scale(${(0.82 + 0.18 * btnIn) * (1 - 0.035 * press)})`, opacity: btnIn}}>
        {/* the ring that spreads from the press */}
        <div
          style={{
            position: 'absolute',
            left: W * 0.62,
            top: H * 0.58,
            width: 40,
            height: 40,
            marginLeft: -20,
            marginTop: -20,
            borderRadius: '50%',
            border: `6px solid ${COLORS.accent}`,
            opacity: ring > 0 && ring < 1 ? 0.7 * (1 - ring) : 0,
            transform: `scale(${1 + ring * 9})`,
          }}
        />
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: 44,
            background: 'linear-gradient(180deg, #5B9AF5 0%, #3D86F0 45%, #2C67C2 100%)',
            boxShadow: `0 10px 0 #1F4F9C, 0 22px 34px rgba(31,79,156,.38), inset 0 3px 0 rgba(255,255,255,.35)`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transform: `translateY(${press * 6}px)`,
          }}
        >
          <span style={{fontSize: 78, fontWeight: 800, color: COLORS.white, letterSpacing: TRACK.h2, lineHeight: 1.05, textAlign: 'center', padding: '0 40px'}}>{label}</span>
        </div>
        <div
          style={{
            position: 'absolute',
            left: W * 0.62 + (1 - glide) * 260,
            top: H * 0.58 + (1 - glide) * 150,
            opacity: clamp01(glide * 3),
            transform: `translateY(${press * 5}px)`,
          }}
        >
          <Cursor size={92} />
        </div>
      </div>
      <div style={{opacity: arrowIn, transform: `translateY(${(1 - arrowIn) * -20 + bounce}px)`}}>
        <Arrow size={96} />
      </div>
      {note ? (
        <div
          style={{
            opacity: noteIn,
            transform: `translateY(${(1 - noteIn) * 26}px)`,
            width: 900,
            padding: '28px 40px',
            borderRadius: 30,
            background: 'rgba(255,255,255,.98)',
            boxShadow: cardShadow(0.8),
            textAlign: 'center',
            fontSize: 50,
            fontWeight: 700,
            letterSpacing: TRACK.h2,
            lineHeight: 1.14,
            color: COLORS.ink,
          }}
        >
          {note}
        </div>
      ) : null}
    </div>
  );
};

export const LinkButton: React.FC<LinkButtonProps> = (props) => {
  const {f, fps} = useClipTimeline(LINK_BUTTON_BASE, props.durationInFrames, LINK_BUTTON_MIN, LINK_BUTTON_MAX);
  return (
    <SeeThrough on={props.transparent}>
      <AbsoluteFill style={{fontFamily: FONT_FAMILY, color: COLORS.ink, WebkitFontSmoothing: 'antialiased'}}>
        <Grid />
        <div style={{position: 'absolute', left: 0, right: 0, top: SAFE.top, bottom: FRAME.height - SAFE.bottom, display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
          <Scene {...props} f={f} fps={fps} />
        </div>
      </AbsoluteFill>
    </SeeThrough>
  );
};

// Still:  npx remotion still src/index.ts LinkButton out/link-button.png --frame=90 --props='{"note":"We will walk you through it"}'
export const LinkButtonCompositions: React.FC = () => (
  <Composition
    id="LinkButton"
    component={LinkButton}
    durationInFrames={LINK_BUTTON_BASE}
    fps={FRAME.fps}
    width={FRAME.width}
    height={FRAME.height}
    defaultProps={linkButtonDefaults}
    calculateMetadata={({props}) => ({durationInFrames: linkButtonDuration(props.durationInFrames)})}
  />
);
