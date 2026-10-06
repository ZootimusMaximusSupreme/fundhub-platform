// Fundhub B-roll brand tokens. Every template reads its look from here so the
// whole kit matches. Values are copied from the live /roadmap page CSS
// (marketing/landing-pages/slo/slo-01-sales.html) unless a line says otherwise.

/** Vertical ad frame. */
export const FRAME = {width: 1080, height: 1920, fps: 30} as const;

/**
 * Text safe zone (owner-set 2026-10-02): no words or numbers in the top 14% or
 * the bottom 35% of the frame, where Instagram and Facebook put their buttons
 * and captions. The wordmark counts as text.
 */
export const SAFE = {
  top: Math.round(FRAME.height * 0.14), // 269
  bottom: Math.round(FRAME.height * 0.65), // 1248
} as const;
export const SAFE_HEIGHT = SAFE.bottom - SAFE.top; // 979

/** Side margin for all text and cards. */
export const MARGIN_X = 90;
export const CONTENT_WIDTH = FRAME.width - MARGIN_X * 2; // 900

/**
 * One CSS pixel of the /roadmap page as it appears on a phone (390 CSS px
 * wide), in video pixels. Sizes copied from the page are multiplied by this,
 * so a brand detail keeps the size it has on the page.
 */
export const PX = FRAME.width / 390;

export const COLORS = {
  paper: '#FCFCFC', // page background (--paper)
  white: '#FFFFFF',
  ink: '#0A0A0A', // --ink
  ink2: '#18181B', // --ink2
  gray: '#52525B', // --gray
  gray2: '#8A8A93', // --gray2
  line: '#E4E4E7', // --line
  soft: '#F4F4F5', // --soft
  track: '#D4D4D8', // input borders on the page (#D4D4D8)
  accent: '#3D86F0', // owner-set accent blue for the B-roll kit
  accentSoft: 'rgba(61,134,240,.10)',
  accentLine: 'rgba(61,134,240,.28)',
} as const;

/** Status chips, copied from the page's .tg.bad / .tg.warn / .tg.ok. */
export const TAG = {
  bad: {fg: '#B4544C', border: '#EBC6C3', bg: '#FBF0EF'},
  warn: {fg: '#9A7B00', border: '#EBDDA0', bg: '#FFF8E1'},
  ok: {fg: '#3E8E58', border: '#CFE3D4', bg: '#F6FBF7'},
  info: {fg: COLORS.accent, border: COLORS.accentLine, bg: COLORS.accentSoft},
} as const;
export type TagTone = keyof typeof TAG;

/** The brand spectrum (--spectrum), exactly as the page writes it. */
export const SPECTRUM =
  'linear-gradient(90deg,#F2A69B 0%,#F5CE8F 20%,#F2E39B 40%,#A8D8B0 60%,#A9C6E8 80%,#C4B3E5 100%)';

/**
 * The small gradient dash. Page CSS: `.eyebrow::before{width:16px;height:2px;
 * background:var(--spectrum);border-radius:1px}` and, on list bullets,
 * `width:10px;height:2px;border-radius:1px`. Same colors, same 8:1 and 5:1
 * shapes, scaled by PX.
 */
export const DASH = {width: 16 * PX, height: 2 * PX, radius: 1 * PX} as const;
export const DASH_SMALL = {width: 10 * PX, height: 2 * PX, radius: 1 * PX} as const;

/**
 * Faint grid. Page CSS: `background-color:#FCFCFC; linear-gradient(rgba(10,10,10,.048) 1px,
 * transparent 1px)` both ways, `background-size:44px 44px`. 44 CSS px x PX is
 * about 122 video px; 120 is used so exactly 9 columns and 16 rows fit the frame.
 */
export const GRID = {cell: 120, line: 2, color: 'rgba(10,10,10,.048)'} as const;

/** Wordmark size and spot (inside the text safe zone). */
export const WORDMARK = {width: 236, top: SAFE.top + 34} as const;

/** Type sizes shared by every template, in video px (templates set their own display sizes). */
export const TYPE = {
  eyebrow: 30, // page .eyebrow 11px x PX
} as const;

/** Letter spacing used on the page. */
export const TRACK = {
  eyebrow: '0.16em', // .eyebrow letter-spacing
  h1: '-0.045em', // .hero h1
  h2: '-0.035em', // .h2
  body: '-0.015em', // .srow .t
  num: '-0.04em',
} as const;

/** Where template content sits: below the wordmark, above the bottom safe edge. */
export const CONTENT = {top: SAFE.top + 131, bottom: SAFE.bottom - 24} as const; // 400 to 1224
