import React from 'react';
import {AbsoluteFill, Composition, interpolate, interpolateColors} from 'remotion';
import {
  BrandFrame,
  COLORS,
  Card3D,
  DASH,
  Decor,
  FONT_FAMILY,
  FRAME,
  Grid,
  P3D,
  SPECTRUM,
  Stage3D,
  TAG,
  TRACK,
  TYPE,
  WORDMARK,
  Wordmark,
  cardShadow,
  enter,
  fadeUp,
} from '../brand';
import {SeeThrough, useSeeThrough} from '../brand/Grid';
import {clampClip, useClipTimeline} from './clipTimeline';

// BureauMatch (Unit N3, animation-builds-2026-10-22). Three credit reports side by side, and three banks under them: when one report does not match, only some banks light up; when all three match, more banks light up. Thank-you video: "Different banks pull different bureaus, so your information has to match on every report. When it doesn't match, only 1 in 3 banks approve you. When it MATCHES, it's 2 in 3, and sometimes 3 out of 3." Direct Book Ad 14: "A mismatch on one of your three credit reports cuts your approvals in HALF".
//
// The beat, in order: the eyebrow and headline land; the three report cards fly
// in (Experian, Equifax, TransUnion by default); the flagged report sits off
// the line with a red chip; the result card shows the banks that approve. Then
// each later stage plays: the flagged report snaps into line (green chips), and
// the bank tiles light one by one while the count swaps.
//
// Every word is a prop. The stages choose the state ("mismatch" or "match"),
// how many of the three banks are lit, and the count words, so Ad 14 can run
// match -> mismatch with "Cuts your approvals in half". No bank names: the
// scripts name none.
//
// Two formats from one scene:
// - vertical: 1080x1920 for ads. Words stay in BrandFrame's band (y 269-1248).
// - wide: 3840x2160 (4K) for the VSL and the thank-you video. Everything sits in
//   ONE side panel chosen by `side` (left x 192-1500, right x 2340-3648, both
//   y 108-1512); nothing in the middle column or the bottom 30%.
//
// The alignment line between the reports and the glow behind lit banks are
// wrapped in Decor, so a render with --props '{"checkTextOnly":true}' drops them
// for the safe-zone scan.

export type BureauMatchFormat = 'vertical' | 'wide';
export type BureauMatchSide = 'left' | 'right';

export type BureauMatchStage = {
  /** "mismatch": the flagged report sits off the line with the red chip. "match": all three line up. */
  state: 'mismatch' | 'match';
  /** How many of the three bank tiles are lit, 0 to 3. */
  approved: number;
  /** Small line above the count ("Only", "Sometimes"). Null shows none. */
  kicker: string | null;
  /** The big words ("1 in 3"). Null shows none. */
  count: string | null;
  /** Small line under the count ("banks approve you"). Null shows none. */
  label: string | null;
};

export type BureauMatchProps = {
  /** "vertical" (1080x1920, ads) or "wide" (3840x2160, the VSL and the thank-you video). */
  format?: BureauMatchFormat;
  /** Wide only: which side panel holds everything. Default "left". */
  side?: BureauMatchSide;
  /** Null hides it. */
  eyebrow: string | null;
  /** Null hides it. */
  headline: string | null;
  /** The three report names, left to right. */
  bureaus: string[];
  /** Which report (0, 1 or 2) does not match in a "mismatch" stage. */
  flagged: number;
  /** Red chip on the flagged report in a "mismatch" stage. Null shows none. */
  mismatchTag: string | null;
  /** Green chip on every report in a "match" stage. Null shows none. */
  matchTag: string | null;
  /** One to three stages, played in order. */
  stages: BureauMatchStage[];
  durationInFrames?: number;
  showSafeZones?: boolean;
  /** See-through: no page and no grid, so the clip renders with alpha (README.md). Default false. */
  transparent?: boolean;
};

// Words from the thank-you video's three-bureau line. Bureau names are the
// three bureaus the line refers to.
export const bureauMatchDefaults: BureauMatchProps = {
  format: 'vertical',
  side: 'left',
  eyebrow: 'All three bureaus',
  headline: 'Your information has to match on every report',
  bureaus: ['Experian', 'Equifax', 'TransUnion'],
  flagged: 1,
  mismatchTag: "Doesn't match",
  matchTag: 'Matches',
  stages: [
    {state: 'mismatch', approved: 1, kicker: 'Only', count: '1 in 3', label: 'banks approve you'},
    {state: 'match', approved: 2, kicker: 'When it matches', count: '2 in 3', label: 'banks approve you'},
    {state: 'match', approved: 3, kicker: 'Sometimes', count: '3 out of 3', label: 'banks approve you'},
  ],
  transparent: false,
};

/** Base length 4 s; a shot list may ask for 3 to 4.5 s (90 to 135 frames). */
export const BUREAU_MATCH_BASE = 120;
export const BUREAU_MATCH_MIN = 90;
export const BUREAU_MATCH_MAX = 135;
/** Frame (on the base timeline) where every beat is on screen: last stage landed, all tiles settled. */
export const BUREAU_MATCH_HERO = 112;

export const bureauMatchDuration = (requested?: number): number =>
  clampClip(requested, BUREAU_MATCH_BASE, BUREAU_MATCH_MIN, BUREAU_MATCH_MAX);

/** The wide frame (4K, 30 fps) and its two side panels (owner-set caption-safe rule, 2026-10-22). */
export const BUREAU_WIDE = {width: 3840, height: 2160, fps: 30} as const;
const PANEL = {leftX: 192, rightX: 2340, top: 108, width: 1308, height: 1404} as const;
/** Wide size against the vertical design (900 px content width). */
const WIDE_U = 1.24;

const BANKS = 3;
/** Grey bars standing in for the lines of each report; the flagged row is the one that can disagree. */
const ROWS = [0.84, 0.62, 0.74] as const;
const FLAG_ROW = 1;

// ---------------------------------------------------------------------------
// Timeline (frames on the 120-frame base)

const T = {
  eyebrow: 0,
  headline: 3,
  reports: [8, 12, 16],
  result: 26,
  firstStage: 30,
  lastStage: 88,
  change: 14,
} as const;

const stageStarts = (n: number): number[] =>
  n <= 1 ? [T.firstStage] : Array.from({length: n}, (_, i) => T.firstStage + (i * (T.lastStage - T.firstStage)) / (n - 1));

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

// ---------------------------------------------------------------------------
// Small pieces

/** Words over film need a backing: in see-through mode the plate turns white with a soft shadow. Same size either way. */
const Plate: React.FC<{u: number; children: React.ReactNode}> = ({u, children}) => {
  const seeThrough = useSeeThrough();
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: `${14 * u}px ${36 * u}px`,
        borderRadius: 28 * u,
        background: seeThrough ? 'rgba(255,255,255,.97)' : 'transparent',
        boxShadow: seeThrough ? cardShadow(0.7 * u) : 'none',
      }}
    >
      {children}
    </div>
  );
};

const EyebrowU: React.FC<{text: string; u: number; p: number}> = ({text, u, p}) => (
  <div style={{display: 'flex', alignItems: 'center', gap: DASH.width * 0.56 * u, opacity: p}}>
    <span
      style={{
        display: 'inline-block',
        width: DASH.width * u,
        height: DASH.height * u,
        borderRadius: DASH.radius * u,
        background: SPECTRUM,
        transform: `scaleX(${p})`,
        transformOrigin: 'left center',
      }}
    />
    <span
      style={{
        fontSize: TYPE.eyebrow * u,
        fontWeight: 600,
        letterSpacing: TRACK.eyebrow,
        textTransform: 'uppercase',
        color: COLORS.gray,
        lineHeight: 1.2,
        whiteSpace: 'nowrap',
      }}
    >
      {text}
    </span>
  </div>
);

const Chip: React.FC<{text: string; tone: 'bad' | 'ok'; u: number; style?: React.CSSProperties}> = ({text, tone, u, style}) => {
  const t = TAG[tone];
  const size = 19 * u;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: size * 0.4,
        fontSize: size,
        fontWeight: 700,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        lineHeight: 1,
        whiteSpace: 'nowrap',
        color: t.fg,
        background: t.bg,
        border: `${2 * u}px solid ${t.border}`,
        borderRadius: size * 0.5,
        padding: `${size * 0.45}px ${size * 0.6}px`,
        boxShadow: `0 ${3 * u}px 0 -1px ${t.border}`,
        ...style,
      }}
    >
      <span style={{width: size * 0.34, height: size * 0.34, borderRadius: '50%', background: t.fg}} />
      {text}
    </span>
  );
};

/** A plain bank building: roof, beam, three columns, step. No name on it. */
const BankGlyph: React.FC<{w: number; color: string}> = ({w, color}) => {
  const h = w * 0.86;
  return (
    <div style={{position: 'relative', width: w, height: h}}>
      <div style={{position: 'absolute', left: 0, right: 0, top: 0, height: h * 0.3, background: color, clipPath: 'polygon(50% 0, 100% 100%, 0 100%)'}} />
      <div style={{position: 'absolute', left: w * 0.05, right: w * 0.05, top: h * 0.34, height: h * 0.08, background: color, borderRadius: w * 0.02}} />
      {[0.15, 0.44, 0.73].map((x) => (
        <div key={x} style={{position: 'absolute', top: h * 0.46, height: h * 0.34, left: w * x, width: w * 0.12, background: color, borderRadius: w * 0.02}} />
      ))}
      <div style={{position: 'absolute', left: 0, right: 0, bottom: 0, height: h * 0.12, background: color, borderRadius: w * 0.02}} />
    </div>
  );
};

/** One bank tile; `lit` 0 to 1 turns it on with a green check. */
const BankTile: React.FC<{lit: number; u: number}> = ({lit, u}) => {
  const w = 104 * u;
  const badge = 38 * u;
  return (
    <div style={{position: 'relative', width: w, height: 112 * u}}>
      <Decor>
        <div
          style={{
            position: 'absolute',
            left: -30 * u,
            right: -30 * u,
            top: -24 * u,
            bottom: -30 * u,
            borderRadius: '50%',
            background: 'radial-gradient(closest-side, rgba(62,142,88,.22), rgba(62,142,88,0))',
            opacity: lit,
          }}
        />
      </Decor>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: 22 * u,
          background: interpolateColors(lit, [0, 1], ['#FAFAFB', '#FFFFFF']),
          border: `${2 * u}px solid ${interpolateColors(lit, [0, 1], [COLORS.line, TAG.ok.border])}`,
          boxShadow: `0 ${4 * u}px 0 -1px ${interpolateColors(lit, [0, 1], ['#DCDCE1', TAG.ok.border])}, 0 ${12 * u}px ${20 * u}px rgba(10,10,10,${0.05 + 0.05 * lit})`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transform: `translateY(${-4 * u * lit}px)`,
        }}
      >
        <BankGlyph w={58 * u} color={interpolateColors(lit, [0, 1], ['#C9C9CF', COLORS.ink2])} />
      </div>
      <div
        style={{
          position: 'absolute',
          right: -badge * 0.32,
          top: -badge * 0.32,
          width: badge,
          height: badge,
          borderRadius: '50%',
          background: TAG.ok.fg,
          boxShadow: `0 ${4 * u}px ${8 * u}px rgba(62,142,88,.35)`,
          opacity: lit,
          transform: `scale(${0.5 + 0.5 * lit})`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <svg viewBox="0 0 24 24" width={badge * 0.64} height={badge * 0.64}>
          <path d="M5 12.6l4.3 4.3L19 7.2" fill="none" stroke="#FFFFFF" strokeWidth={3.4} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    </div>
  );
};

// Report card geometry (design px, x u).
const RC = {padTop: 24, head: 34, headGap: 14, rule: 2, ruleGap: 18, bar: 14, barGap: 16, chipGap: 18, chip: 40, padBottom: 22} as const;
/** Center of the flagged row, from the card's top edge. */
const FLAG_ROW_Y = RC.padTop + RC.head + RC.headGap + RC.rule + RC.ruleGap + FLAG_ROW * (RC.bar + RC.barGap) + RC.bar / 2;

const ReportCard: React.FC<{
  name: string;
  u: number;
  width: number;
  enterP: number;
  /** 0 = lined up, 1 = off the line (only on the flagged card). */
  off: number;
  flagged: boolean;
  /** 0 to 1 the "match" look (green row, green chip). */
  matched: number;
  mismatchTag: string | null;
  matchTag: string | null;
  tilt: number;
}> = ({name, u, width, enterP, off, flagged, matched, mismatchTag, matchTag, tilt}) => {
  const rowColor = (i: number) => {
    if (i !== FLAG_ROW) return COLORS.line;
    const base = interpolateColors(matched, [0, 1], [COLORS.line, '#A8D8B0']);
    return flagged ? interpolateColors(off, [0, 1], [base, '#E9A9A2']) : base;
  };
  const rowWidth = (i: number) => (i === FLAG_ROW && flagged ? interpolate(off, [0, 1], [ROWS[i], 0.34]) : ROWS[i]);
  const badChip = flagged ? off : 0;
  return (
    <Card3D
      enter={enterP}
      z={24}
      tilt={{rx: 3, ry: tilt, rz: -3 * off}}
      elevation={1 * u}
      radius={24 * u}
      padding={`${RC.padTop * u}px ${26 * u}px ${RC.padBottom * u}px`}
      width={width}
      style={{
        flex: '0 0 auto',
        // Off the line: the flagged report drops below the others (composes with Card3D's own transform).
        translate: `0 ${22 * u * off}px`,
        ...(flagged ? {borderColor: interpolateColors(off, [0, 1], ['#EFEFF2', '#EBC6C3'])} : {}),
      }}
    >
      <div style={{height: RC.head * u, display: 'flex', alignItems: 'center', fontSize: 29 * u, fontWeight: 700, letterSpacing: TRACK.h2, color: COLORS.ink}}>
        {name}
      </div>
      <div style={{marginTop: RC.headGap * u, height: RC.rule * u, background: COLORS.line}} />
      <div style={{marginTop: RC.ruleGap * u, display: 'flex', flexDirection: 'column', gap: RC.barGap * u}}>
        {ROWS.map((w, i) => (
          <div key={w} style={{height: RC.bar * u, width: `${rowWidth(i) * 100}%`, borderRadius: RC.bar * u, background: rowColor(i)}} />
        ))}
      </div>
      <div style={{position: 'relative', marginTop: RC.chipGap * u, height: RC.chip * u}}>
        {mismatchTag ? (
          <div style={{position: 'absolute', left: 0, top: 0, opacity: badChip, transform: `scale(${0.9 + 0.1 * badChip})`, transformOrigin: 'left center'}}>
            <Chip text={mismatchTag} tone="bad" u={u} />
          </div>
        ) : null}
        {matchTag ? (
          <div style={{position: 'absolute', left: 0, top: 0, opacity: matched, transform: `scale(${0.9 + 0.1 * matched})`, transformOrigin: 'left center'}}>
            <Chip text={matchTag} tone="ok" u={u} />
          </div>
        ) : null}
      </div>
    </Card3D>
  );
};

const countSize = (text: string): number => (text.length <= 6 ? 92 : text.length <= 10 ? 78 : 50);

// ---------------------------------------------------------------------------
// The scene, drawn at `u` times the vertical design size (900 px wide).

const Scene: React.FC<BureauMatchProps & {f: number; fps: number; u: number}> = ({
  f,
  fps,
  u,
  eyebrow,
  headline,
  bureaus,
  flagged,
  mismatchTag,
  matchTag,
  stages,
}) => {
  const list = stages.slice(0, 3);
  const starts = stageStarts(list.length);
  // Progress of each stage's change (stage 0 is the opening state).
  const change = list.map((_, i) => (i === 0 ? 1 : enter(f, fps, starts[i], T.change)));
  const isMis = (i: number) => (list[i].state === 'mismatch' ? 1 : 0);
  let off = list.length ? isMis(0) : 0;
  for (let i = 1; i < list.length; i++) off += change[i] * (isMis(i) - isMis(i - 1));
  off = clamp01(off);
  const matched = 1 - off;

  const width = 900 * u;
  const gap = 30 * u;
  const cardW = (width - gap * 2) / 3;
  const names = bureaus.slice(0, 3);
  const flag = Math.max(0, Math.min(2, Math.round(flagged)));

  const tileLit = (j: number) => {
    const appear = enter(f, fps, T.result + 4 + j * 3, 12);
    let lit = list.length && j < list[0].approved ? appear : 0;
    for (let i = 1; i < list.length; i++) {
      const prev = j < list[i - 1].approved ? 1 : 0;
      const next = j < list[i].approved ? 1 : 0;
      lit += enter(f, fps, starts[i] + 2 + j * 4, 12) * (next - prev);
    }
    return clamp01(lit);
  };

  const result = enter(f, fps, T.result, 16);
  const headSize = headline ? (headline.length <= 28 ? 64 : headline.length <= 50 ? 54 : 46) : 0;

  return (
    <>
      {eyebrow || headline ? (
        <div style={{...fadeUp(enter(f, fps, T.eyebrow, 14), 22 * u)}}>
          <Plate u={u}>
            {eyebrow ? <EyebrowU text={eyebrow} u={u} p={enter(f, fps, T.eyebrow, 14)} /> : null}
            {headline ? (
              <div
                style={{
                  ...fadeUp(enter(f, fps, T.headline, 14), 20 * u),
                  marginTop: eyebrow ? 16 * u : 0,
                  maxWidth: 820 * u,
                  fontSize: headSize * u,
                  fontWeight: 800,
                  letterSpacing: TRACK.h1,
                  lineHeight: 1.04,
                  textAlign: 'center',
                  textWrap: 'balance',
                  color: COLORS.ink,
                }}
              >
                {headline}
              </div>
            ) : null}
          </Plate>
        </div>
      ) : null}

      {/* The three reports, with the line their rows should sit on */}
      <div style={{position: 'relative', marginTop: 24 * u, width, display: 'flex', gap, ...P3D}}>
        <Decor>
          <div
            style={{
              position: 'absolute',
              left: -12 * u,
              right: -12 * u,
              top: FLAG_ROW_Y * u - 2 * u,
              height: 4 * u,
              borderRadius: 2 * u,
              backgroundImage: `linear-gradient(90deg, ${interpolateColors(matched, [0, 1], ['#E9A9A2', '#8CC79E'])} 60%, transparent 60%)`,
              backgroundSize: `${22 * u}px ${4 * u}px`,
              opacity: enter(f, fps, T.reports[2] + 6, 12),
            }}
          />
        </Decor>
        {names.map((name, i) => (
          <ReportCard
            key={name}
            name={name}
            u={u}
            width={cardW}
            enterP={enter(f, fps, T.reports[i], 16)}
            off={i === flag ? off : 0}
            flagged={i === flag}
            matched={matched}
            mismatchTag={mismatchTag}
            matchTag={matchTag}
            tilt={-2}
          />
        ))}
      </div>

      {/* The banks that approve, and the count */}
      <Card3D
        enter={result}
        from="below"
        z={80}
        tilt={{rx: 2}}
        elevation={0.75 * u}
        radius={30 * u}
        padding={`${24 * u}px ${40 * u}px`}
        width={width}
        style={{marginTop: 30 * u}}
      >
        <div style={{display: 'flex', alignItems: 'center', gap: 40 * u}}>
          <div style={{display: 'flex', gap: 22 * u, flex: '0 0 auto', paddingTop: 10 * u}}>
            {Array.from({length: BANKS}, (_, j) => (
              <BankTile key={j} lit={tileLit(j)} u={u} />
            ))}
          </div>
          <div style={{position: 'relative', flex: 1, height: 150 * u}}>
            {list.map((s, i) => {
              const inP = i === 0 ? result : change[i];
              const outP = i + 1 < list.length ? change[i + 1] : 0;
              const vis = clamp01(inP - outP);
              if (vis <= 0.001 || (!s.kicker && !s.count && !s.label)) return null;
              const tone = s.state === 'mismatch' ? TAG.bad.fg : TAG.ok.fg;
              return (
                <div
                  key={i}
                  style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center',
                    opacity: vis,
                    transform: `translateY(${(1 - inP) * 26 * u - outP * 26 * u}px)`,
                  }}
                >
                  {s.kicker ? (
                    <div style={{fontSize: 25 * u, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: tone, lineHeight: 1.2}}>
                      {s.kicker}
                    </div>
                  ) : null}
                  {s.count ? (
                    <div
                      style={{
                        marginTop: s.kicker ? 6 * u : 0,
                        fontSize: countSize(s.count) * u,
                        fontWeight: 800,
                        letterSpacing: TRACK.num,
                        lineHeight: 1.02,
                        color: COLORS.ink,
                        textWrap: 'balance',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {s.count}
                    </div>
                  ) : null}
                  {s.label ? (
                    <div style={{marginTop: 8 * u, fontSize: 32 * u, fontWeight: 600, letterSpacing: TRACK.body, color: COLORS.gray, lineHeight: 1.2}}>
                      {s.label}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </Card3D>
    </>
  );
};

// ---------------------------------------------------------------------------
// Vertical (ads)

const Vertical: React.FC<BureauMatchProps & {f: number; fps: number}> = (props) => (
  <BrandFrame showSafeZones={props.showSafeZones}>
    <Stage3D f={props.f} length={BUREAU_MATCH_BASE} drift={0.8} style={{paddingBottom: 70}}>
      <Scene {...props} u={1} />
    </Stage3D>
  </BrandFrame>
);

// ---------------------------------------------------------------------------
// Wide (the VSL and the thank-you video), 3840x2160, one side panel

const PanelGuide: React.FC<{left: number}> = ({left}) => (
  <AbsoluteFill style={{pointerEvents: 'none'}}>
    <div style={{position: 'absolute', left: 1500, width: 840, top: 0, bottom: 0, background: 'rgba(220,38,38,.07)'}} />
    <div style={{position: 'absolute', left: 0, right: 0, top: 1512, bottom: 0, background: 'rgba(220,38,38,.07)'}} />
    <div style={{position: 'absolute', left, top: PANEL.top, width: PANEL.width, height: PANEL.height, border: '6px solid #DC2626', boxSizing: 'border-box'}} />
  </AbsoluteFill>
);

const Wide: React.FC<BureauMatchProps & {f: number; fps: number}> = (props) => {
  const left = props.side === 'right' ? PANEL.rightX : PANEL.leftX;
  return (
    <AbsoluteFill style={{fontFamily: FONT_FAMILY, color: COLORS.ink, WebkitFontSmoothing: 'antialiased'}}>
      <Grid />
      <div style={{position: 'absolute', left, top: PANEL.top, width: PANEL.width, height: PANEL.height, overflow: 'hidden'}}>
        <div style={{position: 'absolute', left: 0, right: 0, top: 60, display: 'flex', justifyContent: 'center'}}>
          <Wordmark width={WORDMARK.width * 1.5} />
        </div>
        <div style={{position: 'absolute', left: 0, right: 0, top: 170, bottom: 90}}>
          <Stage3D f={props.f} length={BUREAU_MATCH_BASE} drift={0.8} perspective={2400 * WIDE_U}>
            <Scene {...props} u={WIDE_U} />
          </Stage3D>
        </div>
      </div>
      {props.showSafeZones ? <PanelGuide left={left} /> : null}
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------------------

export const BureauMatch: React.FC<BureauMatchProps> = (props) => {
  const {f, fps} = useClipTimeline(BUREAU_MATCH_BASE, props.durationInFrames, BUREAU_MATCH_MIN, BUREAU_MATCH_MAX);
  const page = props.format === 'wide' ? <Wide {...props} f={f} fps={fps} /> : <Vertical {...props} f={f} fps={fps} />;
  return <SeeThrough on={props.transparent}>{page}</SeeThrough>;
};

const size = (format?: BureauMatchFormat) =>
  format === 'wide' ? {width: BUREAU_WIDE.width, height: BUREAU_WIDE.height} : {width: FRAME.width, height: FRAME.height};

// Stills:  npx remotion still src/index.ts BureauMatch out/bureau-match.png --frame=112
//          npx remotion still src/index.ts BureauMatchWide out/bureau-match-wide.png --frame=112
// BureauMatch with --props '{"format":"wide"}' is the same as BureauMatchWide.
export const BureauMatchCompositions: React.FC = () => (
  <>
    <Composition
      id="BureauMatch"
      component={BureauMatch}
      durationInFrames={BUREAU_MATCH_BASE}
      fps={FRAME.fps}
      width={FRAME.width}
      height={FRAME.height}
      defaultProps={bureauMatchDefaults}
      calculateMetadata={({props}) => ({durationInFrames: bureauMatchDuration(props.durationInFrames), ...size(props.format)})}
    />
    <Composition
      id="BureauMatchWide"
      component={BureauMatch}
      durationInFrames={BUREAU_MATCH_BASE}
      fps={BUREAU_WIDE.fps}
      width={BUREAU_WIDE.width}
      height={BUREAU_WIDE.height}
      defaultProps={{...bureauMatchDefaults, format: 'wide' as const}}
      calculateMetadata={({props}) => ({durationInFrames: bureauMatchDuration(props.durationInFrames), ...size(props.format)})}
    />
  </>
);
