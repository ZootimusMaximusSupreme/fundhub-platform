import React from 'react';
import {AbsoluteFill, Composition, Easing, interpolate, useCurrentFrame} from 'remotion';
import {SeeThrough} from '../brand/Grid';
import {FONT_FAMILY} from '../brand/fonts';
import {CARD_EDGE, cardShadow} from '../brand/depth';
import {COLORS, FRAME, SPECTRUM, TAG} from '../brand/tokens';
import {clampClip} from './clipTimeline';

// SkyDiagram: a full-width diagram card for the open sky above a close selfie. Every scene is drawn for that band, so nothing is cropped or squeezed. Each step pops on the frame its word is said (`at`). Scenes: precheck (file, check, then the bank), boxProgram (off-the-shelf program, stale bank data, every score through one funnel), feeds (data feeds count up into the engine, the bank's own approve and deny), heatMap (a tile map of the states warms up, a pin drops on the hot spot), scoreRange (a 400 to 850 gauge fills), threeWays (three ways to work, icons light in turn), fundTypes (cards, SBA, MCA and more), verdict (approved or denied known first, pre-vetted, handed to the bank), bookCall (a button pressed). Words are never smaller than 34 px. The card's lower middle may sit slightly behind his hair; words in the middle column stay above it. Built 2026-10-25 for Direct Book Ad 16. See-through only when transparent is on.

export type SkyDiagramKind =
  | 'precheck'
  | 'boxProgram'
  | 'feeds'
  | 'heatMap'
  | 'scoreRange'
  | 'threeWays'
  | 'fundTypes'
  | 'verdict'
  | 'bookCall';

export type SkyDiagramProps = {
  kind: SkyDiagramKind;
  /** Card top on the 1080x1920 frame. */
  top: number;
  /** Card height. */
  height: number;
  /** Clip frame when each step lands, in the order the scene lists. */
  at: number[];
  /** Short words for the scene, in the order the scene lists. Never his sentence. */
  labels: string[];
  durationInFrames?: number;
  showSafeZones?: boolean;
  transparent?: boolean;
};

export const SKY_DIAGRAM_BASE = 120;
export const SKY_DIAGRAM_MIN = 45;
export const SKY_DIAGRAM_MAX = 330;
export const SKY_DIAGRAM_HERO = 100;
/** Card left edge and width on the 1080 frame. */
export const SKY_DIAGRAM_X = 30;
export const SKY_DIAGRAM_W = 1020;
/** Smallest words in any scene, in video px. */
export const SKY_DIAGRAM_MIN_TEXT = 34;

export const skyDiagramDefaults: SkyDiagramProps = {
  kind: 'threeWays',
  top: 40,
  height: 330,
  at: [10, 40, 70],
  labels: ['Done for you', 'Side by side', 'On your own'],
  transparent: false,
};

export const skyDiagramDuration = (requested?: number): number =>
  clampClip(requested, SKY_DIAGRAM_BASE, SKY_DIAGRAM_MIN, SKY_DIAGRAM_MAX);

// ---------------------------------------------------------------------------
// Small helpers

const GREEN = TAG.ok.fg;
const RED = TAG.bad.fg;
const AMBER = '#C98A06';
const BLUE = COLORS.accent;

const pop = (f: number, at: number | undefined, d = 8) =>
  at == null
    ? 0
    : interpolate(f, [at, at + d], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.back(1.4))});

const ease = (f: number, a: number, b: number) =>
  interpolate(f, [a, b], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic)});

/** Width guess for Inter bold, used to size chips. */
const textW = (s: string, size: number) => s.length * size * 0.6;

const Txt: React.FC<{
  x: number;
  y: number;
  size: number;
  fill?: string;
  weight?: number;
  anchor?: 'start' | 'middle' | 'end';
  o?: number;
  children: React.ReactNode;
}> = ({x, y, size, fill = COLORS.ink, weight = 800, anchor = 'middle', o = 1, children}) => (
  <text x={x} y={y} fontSize={size} fontWeight={weight} fill={fill} textAnchor={anchor} opacity={o} fontFamily={FONT_FAMILY} letterSpacing={-0.4}>
    {children}
  </text>
);

/** A rounded chip centered on (cx, cy). */
const Chip: React.FC<{cx: number; cy: number; text: string; size?: number; tone?: 'ok' | 'bad' | 'warn' | 'info' | 'ink'; s?: number}> = ({
  cx,
  cy,
  text,
  size = 36,
  tone = 'ink',
  s = 1,
}) => {
  const w = textW(text, size) + size * 1.1;
  const h = size * 1.6;
  const c =
    tone === 'ink'
      ? {fg: COLORS.ink, bg: COLORS.soft, border: COLORS.line}
      : tone === 'warn'
        ? TAG.warn
        : TAG[tone];
  if (s <= 0) return null;
  return (
    <g transform={`translate(${cx} ${cy}) scale(${s})`} opacity={Math.min(1, s)}>
      <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={h / 2} fill={c.bg} stroke={c.border} strokeWidth={3} />
      <Txt x={0} y={size * 0.36} size={size} fill={c.fg}>
        {text}
      </Txt>
    </g>
  );
};

/** An arrow from x1 to x2 at height y, drawn to `p` (0 to 1). */
const Arrow: React.FC<{x1: number; x2: number; y: number; p: number; color?: string}> = ({x1, x2, y, p, color = COLORS.gray2}) => {
  if (p <= 0) return null;
  const xe = x1 + (x2 - x1) * p;
  return (
    <g>
      <line x1={x1} y1={y} x2={xe - 10} y2={y} stroke={color} strokeWidth={8} strokeLinecap="round" strokeDasharray="2 18" />
      <path d={`M ${xe - 22} ${y - 18} L ${xe} ${y} L ${xe - 22} ${y + 18}`} fill="none" stroke={color} strokeWidth={8} strokeLinecap="round" strokeLinejoin="round" />
    </g>
  );
};

/** Pop-in group: scales from its center. */
const Pop: React.FC<{cx: number; cy: number; s: number; children: React.ReactNode}> = ({cx, cy, s, children}) =>
  s <= 0 ? null : (
    <g transform={`translate(${cx} ${cy}) scale(${s}) translate(${-cx} ${-cy})`} opacity={Math.min(1, s * 1.2)}>
      {children}
    </g>
  );

// ---------------------------------------------------------------------------
// Icons, centered on (cx, cy)

const FileIcon: React.FC<{cx: number; cy: number; w?: number; h?: number; tint?: string}> = ({cx, cy, w = 110, h = 140, tint = COLORS.white}) => {
  const x = cx - w / 2;
  const y = cy - h / 2;
  const fold = w * 0.28;
  return (
    <g>
      <path
        d={`M ${x} ${y} H ${x + w - fold} L ${x + w} ${y + fold} V ${y + h} H ${x} Z`}
        fill={tint}
        stroke={COLORS.track}
        strokeWidth={4}
        strokeLinejoin="round"
      />
      <path d={`M ${x + w - fold} ${y} V ${y + fold} H ${x + w}`} fill={COLORS.soft} stroke={COLORS.track} strokeWidth={4} strokeLinejoin="round" />
      {[0.38, 0.54, 0.7, 0.84].map((r, i) => (
        <rect key={i} x={x + w * 0.16} y={y + h * r} width={w * (i === 3 ? 0.4 : 0.68)} height={8} rx={4} fill={COLORS.line} />
      ))}
    </g>
  );
};

const BankIcon: React.FC<{cx: number; cy: number; s?: number; color?: string}> = ({cx, cy, s = 1, color = COLORS.ink2}) => (
  <g transform={`translate(${cx} ${cy}) scale(${s})`}>
    <path d="M -78 -30 L 0 -78 L 78 -30 Z" fill={color} />
    {[-54, -18, 18, 54].map((x) => (
      <rect key={x} x={x - 10} y={-22} width={20} height={70} rx={3} fill={color} />
    ))}
    <rect x={-84} y={52} width={168} height={18} rx={4} fill={color} />
  </g>
);

const CheckBadge: React.FC<{cx: number; cy: number; r?: number; ok?: boolean}> = ({cx, cy, r = 34, ok = true}) => (
  <g>
    <circle cx={cx} cy={cy} r={r} fill={ok ? GREEN : RED} />
    {ok ? (
      <path d={`M ${cx - r * 0.42} ${cy + r * 0.02} L ${cx - r * 0.1} ${cy + r * 0.34} L ${cx + r * 0.46} ${cy - r * 0.3}`} fill="none" stroke="#fff" strokeWidth={r * 0.2} strokeLinecap="round" strokeLinejoin="round" />
    ) : (
      <path d={`M ${cx - r * 0.32} ${cy - r * 0.32} L ${cx + r * 0.32} ${cy + r * 0.32} M ${cx + r * 0.32} ${cy - r * 0.32} L ${cx - r * 0.32} ${cy + r * 0.32}`} stroke="#fff" strokeWidth={r * 0.2} strokeLinecap="round" />
    )}
  </g>
);

const Magnifier: React.FC<{cx: number; cy: number}> = ({cx, cy}) => (
  <g>
    <circle cx={cx} cy={cy} r={34} fill="rgba(61,134,240,.12)" stroke={BLUE} strokeWidth={9} />
    <line x1={cx + 24} y1={cy + 24} x2={cx + 54} y2={cy + 54} stroke={BLUE} strokeWidth={14} strokeLinecap="round" />
  </g>
);

const BoxIcon: React.FC<{cx: number; cy: number}> = ({cx, cy}) => (
  <g transform={`translate(${cx} ${cy})`}>
    <path d="M -70 -20 L 0 -50 L 70 -20 L 0 10 Z" fill="#E7C9A0" stroke="#B88A55" strokeWidth={4} strokeLinejoin="round" />
    <path d="M -70 -20 L 0 10 L 0 80 L -70 50 Z" fill="#D9B07D" stroke="#B88A55" strokeWidth={4} strokeLinejoin="round" />
    <path d="M 70 -20 L 0 10 L 0 80 L 70 50 Z" fill="#C99A62" stroke="#B88A55" strokeWidth={4} strokeLinejoin="round" />
    <path d="M -70 -20 L -96 -46 L -26 -76 L 0 -50 Z" fill="#EBD3AF" stroke="#B88A55" strokeWidth={4} strokeLinejoin="round" />
    <path d="M 70 -20 L 96 -46 L 26 -76 L 0 -50 Z" fill="#EBD3AF" stroke="#B88A55" strokeWidth={4} strokeLinejoin="round" />
    <rect x={14} y={20} width={40} height={10} rx={3} fill="#B88A55" transform="skewY(-24)" />
  </g>
);

const EngineIcon: React.FC<{cx: number; cy: number; spin: number}> = ({cx, cy, spin}) => (
  <g transform={`translate(${cx} ${cy})`}>
    <g transform={`rotate(${spin})`}>
      {Array.from({length: 8}, (_, i) => (
        <rect key={i} x={-12} y={-74} width={24} height={30} rx={5} fill={BLUE} transform={`rotate(${i * 45})`} />
      ))}
      <circle r={56} fill={BLUE} />
    </g>
    <circle r={30} fill="#fff" />
    <circle r={14} fill={BLUE} />
  </g>
);

const PersonIcon: React.FC<{cx: number; cy: number; s?: number; color?: string}> = ({cx, cy, s = 1, color = COLORS.ink2}) => (
  <g transform={`translate(${cx} ${cy}) scale(${s})`}>
    <circle cx={0} cy={-26} r={20} fill={color} />
    <path d="M -34 36 C -34 6 -18 -2 0 -2 C 18 -2 34 6 34 36 Z" fill={color} />
  </g>
);

const WrenchIcon: React.FC<{cx: number; cy: number; color?: string}> = ({cx, cy, color = COLORS.ink2}) => (
  <g transform={`translate(${cx} ${cy}) rotate(-45)`}>
    <rect x={-11} y={-6} width={22} height={74} rx={10} fill={color} />
    <path d="M -30 -40 A 32 32 0 1 0 30 -40 L 14 -40 L 14 -62 A 34 34 0 0 1 -14 -62 L -14 -40 Z" fill={color} />
  </g>
);

const CardIcon: React.FC<{cx: number; cy: number}> = ({cx, cy}) => (
  <g transform={`translate(${cx} ${cy})`}>
    <rect x={-72} y={-46} width={144} height={92} rx={14} fill={BLUE} />
    <rect x={-72} y={-24} width={144} height={18} fill={COLORS.ink2} />
    <rect x={-56} y={12} width={30} height={20} rx={4} fill="#F5CE8F" />
    <rect x={-14} y={18} width={60} height={8} rx={4} fill="rgba(255,255,255,.7)" />
  </g>
);

const LoanIcon: React.FC<{cx: number; cy: number}> = ({cx, cy}) => (
  <g>
    <FileIcon cx={cx - 8} cy={cy} w={104} h={124} />
    <circle cx={cx + 36} cy={cy + 36} r={34} fill={GREEN} />
    <Txt x={cx + 36} y={cy + 52} size={44} fill="#fff">
      $
    </Txt>
  </g>
);

const CashIcon: React.FC<{cx: number; cy: number}> = ({cx, cy}) => (
  <g transform={`translate(${cx} ${cy})`}>
    {[24, 8, -8].map((dy, i) => (
      <g key={i} transform={`translate(${i * 6 - 6} ${dy})`}>
        <rect x={-66} y={-30} width={132} height={60} rx={8} fill={i === 2 ? '#86C79A' : '#A8D8B0'} stroke={GREEN} strokeWidth={3} />
        {i === 2 ? <circle r={17} fill="none" stroke={GREEN} strokeWidth={5} /> : null}
      </g>
    ))}
  </g>
);

const PlusIcon: React.FC<{cx: number; cy: number}> = ({cx, cy}) => (
  <g>
    <circle cx={cx} cy={cy} r={54} fill={COLORS.soft} stroke={COLORS.track} strokeWidth={4} />
    <path d={`M ${cx - 26} ${cy} H ${cx + 26} M ${cx} ${cy - 26} V ${cy + 26}`} stroke={COLORS.ink2} strokeWidth={12} strokeLinecap="round" />
  </g>
);

const PinIcon: React.FC<{cx: number; tipY: number; color?: string}> = ({cx, tipY, color = BLUE}) => (
  <g>
    <path d={`M ${cx} ${tipY} C ${cx - 10} ${tipY - 20} ${cx - 34} ${tipY - 40} ${cx - 34} ${tipY - 64} A 34 34 0 1 1 ${cx + 34} ${tipY - 64} C ${cx + 34} ${tipY - 40} ${cx + 10} ${tipY - 20} ${cx} ${tipY} Z`} fill={color} stroke="#fff" strokeWidth={4} />
    <circle cx={cx} cy={tipY - 64} r={13} fill="#fff" />
  </g>
);

const StarBadge: React.FC<{cx: number; cy: number; r?: number}> = ({cx, cy, r = 30}) => {
  const pts = Array.from({length: 10}, (_, i) => {
    const a = (Math.PI / 5) * i - Math.PI / 2;
    const rr = i % 2 === 0 ? r : r * 0.45;
    return `${cx + Math.cos(a) * rr},${cy + Math.sin(a) * rr}`;
  }).join(' ');
  return <polygon points={pts} fill="#F2B705" stroke="#fff" strokeWidth={3} strokeLinejoin="round" />;
};

// ---------------------------------------------------------------------------
// Scenes. W = card width, H = card height, f = frame, a = at, l = labels.

type SceneP = {W: number; H: number; f: number; a: number[]; l: string[]};

/** at: [file, scan, checked, bank, rare]. labels: [checked, bank, rare]. */
const Precheck: React.FC<SceneP> = ({f, a, l}) => {
  const scan = ease(f, a[1], a[2]);
  const scanOn = f >= a[1] && f < a[2] + 6;
  return (
    <g>
      <Pop cx={150} cy={160} s={pop(f, a[0])}>
        <FileIcon cx={150} cy={160} w={130} h={164} />
        {scanOn ? <rect x={90} y={86 + scan * 148} width={120} height={8} rx={4} fill={BLUE} opacity={0.85} /> : null}
      </Pop>
      <Arrow x1={240} x2={400} y={160} p={ease(f, a[1], a[1] + 10)} />
      <Pop cx={500} cy={150} s={pop(f, a[1])}>
        <rect x={420} y={70} width={160} height={160} rx={36} fill={COLORS.soft} stroke={COLORS.line} strokeWidth={4} />
        <Magnifier cx={490} cy={140} />
      </Pop>
      <Pop cx={560} cy={88} s={pop(f, a[2])}>
        <CheckBadge cx={560} cy={88} r={36} />
      </Pop>
      <Chip cx={500} cy={276} text={l[0]} tone="ok" size={38} s={pop(f, a[2])} />
      <Arrow x1={600} x2={760} y={160} p={ease(f, a[3] - 6, a[3] + 6)} />
      <Pop cx={870} cy={150} s={pop(f, a[3])}>
        <BankIcon cx={870} cy={146} s={1.15} />
      </Pop>
      <Txt x={870} y={292} size={40} o={pop(f, a[3])}>
        {l[1]}
      </Txt>
      <Chip cx={230} cy={34} text={l[2]} tone="bad" size={36} s={pop(f, a[4])} />
    </g>
  );
};

/** at: [box, data, stamp, funnel, s1, s2, s3]. labels: [box, data, stamp, funnel, s1, s2, s3]. */
const BoxProgram: React.FC<SceneP> = ({f, a, l}) => {
  const stamp = interpolate(f, [a[2], a[2] + 6], [1.8, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.in(Easing.cubic)});
  const stampOn = f >= a[2];
  const scoreTone = (i: number) => (i === 0 ? GREEN : i === 1 ? RED : AMBER);
  return (
    <g>
      <Pop cx={130} cy={150} s={pop(f, a[0])}>
        <BoxIcon cx={130} cy={150} />
      </Pop>
      <Txt x={135} y={290} size={36} o={pop(f, a[0])}>
        {l[0]}
      </Txt>
      <Pop cx={360} cy={150} s={pop(f, a[1])}>
        <FileIcon cx={360} cy={150} w={150} h={176} tint="#FAFAFB" />
        <BankIcon cx={360} cy={128} s={0.42} color={COLORS.gray2} />
      </Pop>
      <Txt x={360} y={290} size={36} o={pop(f, a[1])}>
        {l[1]}
      </Txt>
      {stampOn ? (
        <g transform={`translate(360 168) rotate(-12) scale(${stamp})`} opacity={Math.min(1, (2 - stamp) * 1.4)}>
          <rect x={-150} y={-36} width={300} height={72} rx={10} fill="rgba(251,240,239,.94)" stroke={RED} strokeWidth={7} />
          <Txt x={0} y={15} size={42} fill={RED}>
            {l[2].toUpperCase()}
          </Txt>
        </g>
      ) : null}
      <line x1={540} y1={40} x2={540} y2={270} stroke={COLORS.line} strokeWidth={4} opacity={pop(f, a[3])} />
      {[0, 1, 2].map((i) => {
        const s = pop(f, a[4 + i]);
        const x = 680 + i * 120;
        const drop = ease(f, a[4 + i] + 6, a[4 + i] + 18);
        return s > 0 ? (
          <g key={i}>
            <Pop cx={x} cy={58} s={s}>
              <rect x={x - 54} y={30} width={108} height={58} rx={29} fill="#fff" stroke={scoreTone(i)} strokeWidth={5} />
              <Txt x={x} y={73} size={38} fill={scoreTone(i)}>
                {l[4 + i]}
              </Txt>
            </Pop>
            <circle cx={x + (800 - x) * drop} cy={96 + drop * 90} r={10} fill={scoreTone(i)} opacity={drop > 0 && drop < 1 ? 1 : 0} />
          </g>
        ) : null;
      })}
      <Pop cx={800} cy={178} s={pop(f, a[3])}>
        <path d="M 680 110 H 920 L 830 196 V 238 H 770 V 196 Z" fill={COLORS.soft} stroke={COLORS.gray2} strokeWidth={5} strokeLinejoin="round" />
        <rect x={770} y={196} width={60} height={42} fill={COLORS.ink2} />
      </Pop>
      <Txt x={800} y={290} size={36} o={pop(f, a[3])}>
        {l[3]}
      </Txt>
    </g>
  );
};

/** at: [engine, f1..f7, bank, approve, deny]. labels: [feeds, engine, sameAsBank, approve, deny]. */
const Feeds: React.FC<SceneP> = ({f, a, l}) => {
  const shown = [1, 2, 3, 4, 5, 6, 7].filter((i) => f >= a[i]).length;
  const nodes = [0, 1, 2, 3, 4, 5, 6].map((i) => {
    const t = (i - 3) / 3;
    return {x: 262 + 34 * (1 - t * t), y: 150 + t * 104};
  });
  return (
    <g>
      <Txt x={110} y={190} size={130} fill={BLUE} o={pop(f, a[1])}>
        {String(Math.max(shown, 1))}
      </Txt>
      <Txt x={110} y={262} size={36} o={pop(f, a[1])}>
        {l[0]}
      </Txt>
      {nodes.map((n, i) => {
        const s = pop(f, a[i + 1]);
        const flow = (f - a[i + 1]) % 24;
        return s > 0 ? (
          <g key={i}>
            <line x1={n.x} y1={n.y} x2={470} y2={150} stroke={COLORS.accentLine} strokeWidth={5} />
            {flow >= 0 ? <circle cx={n.x + (470 - n.x) * (flow / 24)} cy={n.y + (150 - n.y) * (flow / 24)} r={7} fill={BLUE} /> : null}
            <Pop cx={n.x} cy={n.y} s={s}>
              <circle cx={n.x} cy={n.y} r={20} fill="#fff" stroke={BLUE} strokeWidth={6} />
            </Pop>
          </g>
        ) : null;
      })}
      <Pop cx={470} cy={150} s={pop(f, a[0])}>
        <EngineIcon cx={470} cy={150} spin={f * 3} />
      </Pop>
      <Txt x={470} y={282} size={36} o={pop(f, a[0])}>
        {l[1]}
      </Txt>
      <Arrow x1={570} x2={720} y={150} p={ease(f, a[8] - 6, a[8] + 6)} />
      <Chip cx={860} cy={34} text={l[2]} tone="info" size={34} s={pop(f, a[8])} />
      <Pop cx={860} cy={146} s={pop(f, a[8])}>
        <BankIcon cx={860} cy={140} s={1.05} />
      </Pop>
      <Pop cx={790} cy={250} s={pop(f, a[9])}>
        <CheckBadge cx={738} cy={250} r={22} />
        <Txt x={766} y={263} size={36} anchor="start" fill={GREEN}>
          {l[3]}
        </Txt>
      </Pop>
      <Pop cx={790} cy={300} s={pop(f, a[10])}>
        <CheckBadge cx={738} cy={300} r={22} ok={false} />
        <Txt x={766} y={313} size={36} anchor="start" fill={RED}>
          {l[4]}
        </Txt>
      </Pop>
    </g>
  );
};

/** The 50 states plus DC as a tile grid: [row, col]. No names are drawn. */
const TILES: [number, number][] = [
  [0, 0], [0, 10], [1, 9], [1, 10],
  [2, 0], [2, 1], [2, 2], [2, 3], [2, 4], [2, 5], [2, 6], [2, 7], [2, 8], [2, 9], [2, 10],
  [3, 0], [3, 1], [3, 2], [3, 3], [3, 4], [3, 5], [3, 6], [3, 7], [3, 8], [3, 9],
  [4, 0], [4, 1], [4, 2], [4, 3], [4, 4], [4, 5], [4, 6], [4, 7], [4, 8], [4, 9],
  [5, 1], [5, 2], [5, 3], [5, 4], [5, 5], [5, 6], [5, 7], [5, 8],
  [6, 3], [6, 4], [6, 5], [6, 6], [6, 7],
  [7, 0], [7, 3], [7, 8],
];
/** Tiles that run hot, by index in TILES. The first is the hot spot the pin lands on. */
const HOT = [29, 19, 30, 39, 28];
const heatColor = (h: number) => {
  const stops = ['#DCE7F7', '#A9C6E8', '#F5CE8F', '#F2A69B', '#D9534A'];
  const i = Math.max(0, Math.min(stops.length - 1, Math.round(h * (stops.length - 1))));
  return stops[i];
};

/** at: [map, scan, hot, pin]. labels: [hot, cold, hotNow, youGo]. */
const HeatMap: React.FC<SceneP> = ({f, a, l}) => {
  const pitch = 38;
  const ox = 300;
  const oy = 22;
  const scan = ease(f, a[1], a[2]);
  const hot = ease(f, a[2], a[2] + 10);
  const pinDrop = interpolate(f, [a[3], a[3] + 8], [-60, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.bounce)});
  const [hr, hc] = TILES[HOT[0]];
  const hx = ox + hc * pitch + 17;
  const hy = oy + hr * pitch + 17;
  return (
    <g>
      <Pop cx={140} cy={150} s={pop(f, a[0])}>
        <defs>
          <linearGradient id="sky-heat-legend" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" stopColor="#DCE7F7" />
            <stop offset="0.5" stopColor="#F5CE8F" />
            <stop offset="1" stopColor="#D9534A" />
          </linearGradient>
        </defs>
        <rect x={60} y={50} width={36} height={220} rx={18} fill="url(#sky-heat-legend)" />
        <Txt x={116} y={86} size={38} anchor="start" fill={RED}>
          {l[0]}
        </Txt>
        <Txt x={116} y={266} size={38} anchor="start" fill={COLORS.gray}>
          {l[1]}
        </Txt>
      </Pop>
      {TILES.map(([r, c], i) => {
        const s = pop(f, a[0] + ((r + c) % 6), 6);
        const wave = Math.max(0, Math.min(1, scan * 14 - c * 0.9 - (i % 3) * 0.3));
        const flick = 0.25 + 0.2 * Math.sin((f + i * 7) / 6);
        const isHot = HOT.indexOf(i);
        const h = isHot >= 0 ? Math.max(wave * flick, hot * (isHot === 0 ? 1 : 0.78)) : wave * flick;
        return s > 0 ? (
          <rect key={i} x={ox + c * pitch} y={oy + r * pitch} width={34} height={34} rx={7} fill={heatColor(h)} opacity={Math.min(1, s)} />
        ) : null;
      })}
      {hot > 0 ? <circle cx={hx} cy={hy} r={22 + 20 * ((f - a[2]) % 20) / 20} fill="none" stroke={RED} strokeWidth={5} opacity={1 - ((f - a[2]) % 20) / 20} /> : null}
      {f >= a[3] ? (
        <g transform={`translate(0 ${pinDrop})`}>
          <PinIcon cx={hx} tipY={hy + 4} />
        </g>
      ) : null}
      <Chip cx={880} cy={110} text={l[2]} tone="bad" size={36} s={pop(f, a[2])} />
      <Chip cx={880} cy={210} text={l[3]} tone="info" size={36} s={pop(f, a[3])} />
    </g>
  );
};

/** at: [gauge, low, high]. labels: [title, low, high]. */
const ScoreRange: React.FC<SceneP> = ({f, a, l}) => {
  const cx = 510;
  const cy = 290;
  const r = 196;
  const fill = ease(f, a[1] - 4, a[2]);
  const ang = Math.PI * (1 - fill);
  const arc = (p: number) => {
    const e = Math.PI * (1 - p);
    return `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + Math.cos(e) * r} ${cy - Math.sin(e) * r}`;
  };
  const done = pop(f, a[2] + 4);
  return (
    <g>
      <defs>
        <linearGradient id="sky-score-arc" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#D9534A" />
          <stop offset="0.5" stopColor="#F5CE8F" />
          <stop offset="1" stopColor={GREEN} />
        </linearGradient>
      </defs>
      <Txt x={36} y={70} size={40} anchor="start" o={pop(f, a[0])}>
        {l[0]}
      </Txt>
      <Pop cx={cx} cy={cy - r / 2} s={pop(f, a[0])}>
        <path d={arc(1)} fill="none" stroke={COLORS.line} strokeWidth={46} strokeLinecap="round" />
      </Pop>
      {fill > 0.001 ? <path d={arc(fill)} fill="none" stroke="url(#sky-score-arc)" strokeWidth={46} strokeLinecap="round" /> : null}
      {f >= a[1] - 4 ? (
        <g>
          <line x1={cx} y1={cy} x2={cx + Math.cos(ang) * (r - 50)} y2={cy - Math.sin(ang) * (r - 50)} stroke={COLORS.ink2} strokeWidth={12} strokeLinecap="round" />
          <circle cx={cx} cy={cy} r={22} fill={COLORS.ink2} />
        </g>
      ) : null}
      <Pop cx={cx} cy={cy - 90} s={done}>
        <CheckBadge cx={cx} cy={cy - 96} r={40} />
      </Pop>
      <Txt x={cx - r - 40} y={cy + 6} size={76} anchor="end" fill={RED} o={pop(f, a[1])}>
        {l[1]}
      </Txt>
      <Txt x={cx + r + 40} y={cy + 6} size={76} anchor="start" fill={GREEN} o={pop(f, a[2])}>
        {l[2]}
      </Txt>
    </g>
  );
};

/** at: [one, two, three]. labels: [one, two, three]. */
const ThreeWays: React.FC<SceneP> = ({f, a, l}) => {
  const xs = [170, 510, 850];
  return (
    <g>
      {xs.map((x, i) => {
        const s = pop(f, a[i]);
        const live = f >= a[i] && (i === 2 || f < a[i + 1]);
        const tone = live ? BLUE : COLORS.gray2;
        return s > 0 ? (
          <g key={i}>
            <Pop cx={x} cy={130} s={s}>
              <rect x={x - 96} y={36} width={192} height={180} rx={34} fill={live ? COLORS.accentSoft : COLORS.soft} stroke={live ? BLUE : COLORS.line} strokeWidth={5} />
              {i === 0 ? (
                <g>
                  <PersonIcon cx={x - 36} cy={130} s={0.9} color={tone} />
                  <PersonIcon cx={x + 36} cy={130} s={0.9} color={tone} />
                  <PersonIcon cx={x} cy={118} s={1.05} color={tone} />
                  <CheckBadge cx={x + 64} cy={66} r={22} />
                </g>
              ) : i === 1 ? (
                <g>
                  <PersonIcon cx={x - 34} cy={128} s={1.1} color={tone} />
                  <PersonIcon cx={x + 34} cy={128} s={1.1} color={COLORS.ink2} />
                </g>
              ) : (
                <g>
                  <PersonIcon cx={x - 26} cy={128} s={1.1} color={COLORS.ink2} />
                  <WrenchIcon cx={x + 40} cy={116} color={tone} />
                </g>
              )}
            </Pop>
            <Txt x={x} y={276} size={38} o={Math.min(1, s)} fill={live ? COLORS.ink : COLORS.gray}>
              {l[i]}
            </Txt>
          </g>
        ) : null;
      })}
    </g>
  );
};

/** at: [cards, sba, mca, more]. labels: [cards, sba, mca, more]. */
const FundTypes: React.FC<SceneP> = ({f, a, l}) => {
  const xs = [138, 388, 638, 888];
  const icons = [CardIcon, LoanIcon, CashIcon, PlusIcon];
  return (
    <g>
      {xs.map((x, i) => {
        const s = pop(f, a[i]);
        const Icon = icons[i];
        return s > 0 ? (
          <g key={i}>
            <Pop cx={x} cy={140} s={s}>
              <Icon cx={x} cy={140} />
            </Pop>
            <Txt x={x} y={276} size={38} o={Math.min(1, s)}>
              {l[i]}
            </Txt>
          </g>
        ) : null;
      })}
    </g>
  );
};

/** at: [file, approved, denied, bank, prevetted, vip]. labels: [approved, denied, prevetted, vip]. */
const Verdict: React.FC<SceneP> = ({f, a, l}) => {
  const travel = ease(f, a[4] - 2, a[4] + 16);
  const fileX = 110 + (720 - 110) * travel;
  const pill = (y: number, ok: boolean, text: string, s: number) =>
    s > 0 ? (
      <Pop cx={420} cy={y} s={s}>
        <rect x={270} y={y - 38} width={300} height={76} rx={38} fill={ok ? TAG.ok.bg : TAG.bad.bg} stroke={ok ? GREEN : RED} strokeWidth={5} />
        <CheckBadge cx={316} cy={y} r={24} ok={ok} />
        <Txt x={352} y={y + 13} size={38} anchor="start" fill={ok ? GREEN : RED}>
          {text}
        </Txt>
      </Pop>
    ) : null;
  return (
    <g>
      <Pop cx={110} cy={150} s={pop(f, a[0])}>
        <g transform={`translate(${fileX - 110} 0)`} opacity={1 - 0.6 * ease(f, a[4] + 14, a[4] + 20)}>
          <FileIcon cx={110} cy={150} w={120} h={150} />
          {f >= a[4] ? <CheckBadge cx={150} cy={96} r={26} /> : null}
        </g>
      </Pop>
      {f >= a[0] && f < a[1] ? <Magnifier cx={420 + Math.sin(f / 4) * 30} cy={140} /> : null}
      {pill(104, true, l[0], pop(f, a[1]))}
      {pill(196, false, l[1], pop(f, a[2]))}
      <Arrow x1={590} x2={740} y={150} p={ease(f, a[3] - 6, a[3] + 6)} />
      <Pop cx={870} cy={146} s={pop(f, a[3])}>
        <BankIcon cx={870} cy={140} s={1.1} />
      </Pop>
      <Chip cx={480} cy={272} text={l[2]} tone="ok" size={36} s={pop(f, a[4])} />
      <Pop cx={870} cy={280} s={pop(f, a[5])}>
        <StarBadge cx={870 - textW(l[3], 36) / 2 - 30} cy={280} r={26} />
        <Txt x={870 + 14} y={293} size={36}>
          {l[3]}
        </Txt>
      </Pop>
    </g>
  );
};

/** at: [button, press]. labels: [button]. */
const BookCall: React.FC<SceneP> = ({W, H, f, a, l}) => {
  const s = pop(f, a[0]);
  const press = interpolate(f, [a[1] - 2, a[1] + 2, a[1] + 8], [0, 1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const handIn = ease(f, a[0] + 4, a[1] - 2);
  const bw = 760;
  const bh = 130;
  const cx = W / 2;
  const cy = H / 2 - 10;
  return (
    <g>
      <Pop cx={cx} cy={cy} s={s}>
        <g transform={`translate(0 ${press * 8})`}>
          <rect x={cx - bw / 2} y={cy - bh / 2 + 10} width={bw} height={bh} rx={30} fill="#1E5AB4" opacity={1 - press} />
          <rect x={cx - bw / 2} y={cy - bh / 2} width={bw} height={bh} rx={30} fill={BLUE} />
          <Txt x={cx - 20} y={cy + 20} size={58} fill="#fff">
            {l[0]}
          </Txt>
          <path d={`M ${cx + bw / 2 - 64} ${cy - 16} V ${cy + 18} M ${cx + bw / 2 - 82} ${cy + 2} L ${cx + bw / 2 - 64} ${cy + 22} L ${cx + bw / 2 - 46} ${cy + 2}`} fill="none" stroke="#fff" strokeWidth={8} strokeLinecap="round" strokeLinejoin="round" />
        </g>
      </Pop>
      {handIn > 0 ? (
        <g transform={`translate(${cx + 150 + (1 - handIn) * 180} ${cy + 30 + (1 - handIn) * 80 + press * 8})`}>
          <path d="M 0 0 L 0 62 L 16 48 L 28 74 L 40 68 L 28 43 L 50 43 Z" fill="#fff" stroke={COLORS.ink} strokeWidth={5} strokeLinejoin="round" />
        </g>
      ) : null}
    </g>
  );
};

const SCENES: Record<SkyDiagramKind, React.FC<SceneP>> = {
  precheck: Precheck,
  boxProgram: BoxProgram,
  feeds: Feeds,
  heatMap: HeatMap,
  scoreRange: ScoreRange,
  threeWays: ThreeWays,
  fundTypes: FundTypes,
  verdict: Verdict,
  bookCall: BookCall,
};

// ---------------------------------------------------------------------------

export const SkyDiagram: React.FC<SkyDiagramProps> = (props) => {
  const frame = useCurrentFrame();
  const Scene = SCENES[props.kind] ?? ThreeWays;
  const W = SKY_DIAGRAM_W;
  const H = props.height;
  const plateIn = interpolate(frame, [0, 8], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic)});
  return (
    <SeeThrough on={props.transparent}>
      <AbsoluteFill style={{fontFamily: FONT_FAMILY, color: COLORS.ink, WebkitFontSmoothing: 'antialiased'}}>
        <div
          style={{
            position: 'absolute',
            left: SKY_DIAGRAM_X,
            top: props.top,
            width: W,
            height: H,
            borderRadius: 32,
            background: 'rgba(255,255,255,.97)',
            ...CARD_EDGE,
            boxShadow: cardShadow(0.7),
            overflow: 'hidden',
            boxSizing: 'border-box',
            opacity: plateIn,
            transform: `translateY(${(1 - plateIn) * 16}px)`,
          }}
        >
          <div style={{position: 'absolute', left: 0, right: 0, top: 0, height: 6, background: SPECTRUM}} />
          <svg width={W - 4} height={H - 4} viewBox={`0 0 ${W - 4} ${H - 4}`} style={{position: 'absolute', left: 0, top: 0, overflow: 'visible'}}>
            <Scene W={W - 4} H={H - 4} f={frame} a={props.at} l={props.labels} />
          </svg>
        </div>
        {props.showSafeZones ? (
          <div style={{position: 'absolute', left: 0, right: 0, top: 269, height: 2, background: '#DC2626'}} />
        ) : null}
      </AbsoluteFill>
    </SeeThrough>
  );
};

export const SkyDiagramCompositions: React.FC = () => (
  <Composition
    id="SkyDiagram"
    component={SkyDiagram}
    durationInFrames={SKY_DIAGRAM_BASE}
    fps={FRAME.fps}
    width={FRAME.width}
    height={FRAME.height}
    defaultProps={skyDiagramDefaults}
    calculateMetadata={({props}) => ({durationInFrames: skyDiagramDuration(props.durationInFrames)})}
  />
);
