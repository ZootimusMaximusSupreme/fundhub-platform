import React from 'react';
import {
  BackdropStage,
  BrandFrame,
  CARD_EDGE,
  COLORS,
  GradientDash,
  MoneyGutters,
  P3D,
  Stage3D,
  TRACK,
  Tag,
  cardShadow,
  enter,
} from '../brand';
import {FitEyebrow, easeOut, seg, useToolTimeline} from './toolScene';

// ToolMatch: a 3D tool board. Each credit situation gets its matching tool,
// one row at a time: the situation slides in on the left, a blue tool badge
// pops on the line between, and the tool's card hangs on the board at the
// right. Then one row lifts off the board and the others dim (with an
// optional chip, for example "The hammer"). An optional final card lands in
// front at the end, for example the roadmap and its price.
//
// Every word comes from props. The default rows are Script 3's own lines
// (marketing/ads/notes-green-screen.md on main): "Some files need negative
// items taken off. Some need their names and addresses matched on every
// report, or their cards paid down. Every file needs the right banks in the
// right order." The preview adds its payoff, "a roadmap built from your own
// credit. For $297" (the price on the live /roadmap page too).

export type ToolRow = {situation: string; tool: string};

export type ToolMatchProps = {
  eyebrow: string;
  /** 2 to 4 rows, top to bottom. Extra rows are dropped. */
  rows: ToolRow[];
  /** Row index (0 = top) that lifts at the end, or null for none (the default). */
  highlight?: number | null;
  /** Optional chip on the lifted row, for example "The hammer". Leave out (or null) for none. */
  highlightLabel?: string | null;
  /**
   * Optional card that lands in front at the end. Leave out (or null) for
   * none: the default has none, so no price shows unless a shot list asks.
   */
  finalCard?: {title: string; subtitle?: string | null} | null;
  /** Clip length in frames, 75 to 120 (2.5 to 4 seconds at 30 fps). Default 105. */
  durationInFrames?: number;
  showSafeZones?: boolean;
};

export const TOOL_MATCH_BASE = 105;
export const TOOL_MATCH_MIN = 75;
export const TOOL_MATCH_MAX = 120;
/**
 * The preview frame: with the preview props (4 rows, row 4 lifted, a final
 * card), every row is in and row 4 has lifted; the final card lands just after.
 */
export const TOOL_MATCH_HERO = 75;

export const toolMatchDefaults: ToolMatchProps = {
  eyebrow: 'Credit works the same way',
  rows: [
    {situation: 'Negative items', tool: 'Taken off'},
    {situation: 'Names and addresses', tool: 'Matched on every report'},
    {situation: 'Cards', tool: 'Paid down'},
    {situation: 'Every file', tool: 'The right banks in the right order'},
  ],
  highlight: null,
};

/**
 * The preview: the defaults plus Script 3's payoff, so the still shows every
 * part. Remotion merges a shot list's props over the defaults, which is why
 * the final card (with its price) is not a default.
 */
export const toolMatchPreviewProps: ToolMatchProps = {
  ...toolMatchDefaults,
  highlight: 3,
  finalCard: {title: 'A roadmap built from your own credit', subtitle: '$297'},
};

// --- Layout (content px, inside the 900 x 824 box) ---
const BOARD = {top: 64, w: 900, pad: 30};
const COL = {sit: 330, badge: 84, tool: 426};
const GAP_ROW = 18;

/** Small line icons for the badges (decoration only; the words carry the meaning). */
const ToolIcon: React.FC<{kind: number; size: number}> = ({kind, size}) => {
  const st = {fill: 'none', stroke: '#FFFFFF', strokeWidth: 3.2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const};
  const k = kind % 4;
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" style={{display: 'block'}}>
      {k === 0 ? (
        // open-end wrench
        <path {...st} d="M30.5 9.5a8 8 0 0 0-9.8 10.3L9.6 30.9a3.6 3.6 0 0 0 5.1 5.1L25.8 25a8 8 0 0 0 10.3-9.8l-4.8 4.8-4.4-1.2-1.2-4.4z" />
      ) : k === 1 ? (
        // cross lug wrench
        <>
          <path {...st} d="M10 10 L38 38 M38 10 L10 38" />
          <circle {...st} cx={24} cy={24} r={3.4} />
          {[
            [10, 10],
            [38, 10],
            [10, 38],
            [38, 38],
          ].map(([x, y]) => (
            <circle key={`${x}-${y}`} {...st} cx={x} cy={y} r={3.2} />
          ))}
        </>
      ) : k === 2 ? (
        // screwdriver
        <path {...st} d="M33 7l8 8-6.5 6.5-8-8zM26.5 13.5l8 8-3.5 3.5-8-8zM23 17l8 8-14 14a2.8 2.8 0 0 1-4 0l-4-4a2.8 2.8 0 0 1 0-4z" />
      ) : (
        // scissor jack
        <>
          <path {...st} d="M8 39h32M16 13h16M24 15l-11 10 11 10 11-10z" />
          <path {...st} d="M13 25h24" />
        </>
      )}
    </svg>
  );
};

/** Rough text width for Inter at weight 600-700, used to pick a size that fits. */
const textW = (t: string, fs: number): number => t.length * fs * 0.58;
/** Largest font size (from `max` down to `min`) that fits `t` in `width` within `lines` lines. */
const fitSize = (texts: string[], width: number, lines: number, max: number, min: number): number => {
  for (let fs = max; fs > min; fs -= 2) {
    if (texts.every((t) => Math.ceil(textW(t, fs) / width) <= lines)) return fs;
  }
  return min;
};

export const ToolMatch: React.FC<ToolMatchProps> = ({eyebrow, rows: rowsIn, highlight = null, highlightLabel, finalCard, durationInFrames, showSafeZones}) => {
  const L = TOOL_MATCH_BASE;
  const {f, fps} = useToolTimeline(L, durationInFrames, TOOL_MATCH_MIN, TOOL_MATCH_MAX);
  const rows = (rowsIn ?? []).slice(0, 4);
  const n = Math.max(1, rows.length);
  const hi = typeof highlight === 'number' && highlight >= 0 && highlight < rows.length ? highlight : null;
  const hasFinal = !!finalCard && !!finalCard.title;

  // Timing: rows one after another, then the lift, then the final card.
  const rowStart = 7;
  const rowGap = n >= 4 ? 12 : n === 3 ? 15 : 19;
  const rowsDone = rowStart + (n - 1) * rowGap + 16;
  const liftAt = rowsDone + 1;
  const finalAt = hi !== null ? liftAt + 17 : rowsDone + 4;
  const lift = hi !== null ? easeOut(seg(f, liftAt, liftAt + 10)) : 0;
  const fin = hasFinal ? enter(f, fps, finalAt, 16) : 0;

  // Sizes: the rows share the board height; text shrinks to fit.
  const boardH = 664; // ends well above the band's bottom edge (shadow included), even tilted
  const rowH = Math.min(178, (boardH - BOARD.pad * 2 - GAP_ROW * (n - 1)) / n);
  const sitW = COL.sit - 44;
  const toolW = COL.tool - 54;
  const lines = rowH >= 150 ? 3 : 2;
  const fs = Math.min(
    fitSize(rows.map((r) => r.situation), sitW, lines, 44, 26),
    fitSize(rows.map((r) => r.tool), toolW, lines, 44, 26),
  );
  const rowsTop = BOARD.top + (boardH - (rowH * n + GAP_ROW * (n - 1))) / 2;

  const boardIn = enter(f, fps, 0, 18);
  const boardTransform = `translate3d(0px, ${(40 * (1 - boardIn)).toFixed(1)}px, ${(-380 * (1 - boardIn) - 60 * fin).toFixed(1)}px) rotateX(${(5 + 14 * (1 - boardIn)).toFixed(2)}deg) rotateY(-7deg)`;
  const dimAll = 1 - 0.72 * Math.min(1, fin * 1.6);

  return (
    <BrandFrame
      showSafeZones={showSafeZones}
      backdrop={
        <BackdropStage f={f} length={L}>
          <MoneyGutters f={f} mode="drift" count={8} seed="tool-match-drift" size={[150, 230]} depth={[-700, -150]} opacity={0.45} blur={2.5} />
          {hasFinal ? (
            <MoneyGutters f={f} mode="rise" count={8} seed="tool-match-rise" size={[150, 230]} depth={[-650, -150]} opacity={0.55} blur={2} appear={seg(f, finalAt, finalAt + 12)} />
          ) : null}
        </BackdropStage>
      }
    >
      <Stage3D f={f} length={L}>
        <div style={{position: 'relative', width: 900, height: 824, ...P3D}}>
          <div style={{position: 'absolute', left: 0, right: 0, top: 4, opacity: dimAll}}>
            <FitEyebrow text={eyebrow} progress={enter(f, fps, 0, 14)} />
          </div>

          {/* the tool board: a pegboard leaning back a little; rows hang on it in 3D */}
          <div style={{position: 'absolute', left: 0, top: BOARD.top, width: BOARD.w, height: boardH, ...P3D, transform: boardTransform}}>
            <div
              style={{
                position: 'absolute',
                inset: 0,
                borderRadius: 34,
                ...CARD_EDGE,
                backgroundColor: '#FBFBFC',
                backgroundImage: 'radial-gradient(circle, #E3E3E8 0 3.2px, transparent 3.6px)',
                backgroundSize: '38px 38px',
                backgroundPosition: '19px 19px',
                boxShadow: cardShadow(1),
                opacity: boardIn * (1 - 0.45 * fin),
              }}
            />
            {rows.map((r, i) => {
              const t0 = rowStart + i * rowGap;
              const sitIn = enter(f, fps, t0, 12);
              const lineIn = seg(f, t0 + 4, t0 + 11);
              const badgeIn = enter(f, fps, t0 + 5, 10);
              const toolIn = enter(f, fps, t0 + 8, 13);
              const isHi = hi === i;
              const dim = (hi === null ? 1 : isHi ? 1 : 1 - 0.62 * lift) * dimAll;
              const lz = isHi ? 90 * lift : 0;
              const y = rowsTop - BOARD.top + i * (rowH + GAP_ROW);
              const midY = rowH / 2;
              const glow = isHi ? lift : 0;
              return (
                <div key={i} style={{position: 'absolute', left: BOARD.pad, top: y, width: BOARD.w - BOARD.pad * 2, height: rowH, ...P3D, transform: `translateZ(${lz.toFixed(1)}px) scale(${(1 + 0.03 * glow).toFixed(3)})`}}>
                  {/* the situation, on the left */}
                  <div
                    style={{
                      position: 'absolute',
                      left: 0,
                      top: 0,
                      width: COL.sit,
                      height: rowH,
                      boxSizing: 'border-box',
                      padding: '0 22px',
                      display: 'flex',
                      alignItems: 'center',
                      borderRadius: 22,
                      background: 'linear-gradient(165deg, #FFFFFF, #F6F6F8)',
                      ...CARD_EDGE,
                      boxShadow: cardShadow(0.55),
                      opacity: sitIn * (0.55 + 0.45 * dim),
                      // comes in from the left and from in front, so no part of it ever dips behind the board
                      transform: `translate3d(${(-60 * (1 - sitIn)).toFixed(1)}px, 0px, ${(26 + 120 * (1 - sitIn)).toFixed(1)}px) rotateY(${(16 * (1 - sitIn)).toFixed(1)}deg)`,
                    }}
                  >
                    <span style={{fontSize: fs, fontWeight: 600, letterSpacing: TRACK.body, lineHeight: 1.14, color: COLORS.ink2, textWrap: 'balance', opacity: 0.3 + 0.7 * dim}}>{r.situation}</span>
                  </div>
                  {/* the line between, drawing toward the tool */}
                  <div
                    style={{
                      position: 'absolute',
                      left: COL.sit - 4,
                      top: midY - 2,
                      width: (COL.badge + 8) * lineIn,
                      height: 4,
                      borderRadius: 2,
                      background: COLORS.accentLine,
                      opacity: dim,
                      transform: 'translateZ(14px)',
                    }}
                  />
                  {/* the tool badge */}
                  <div
                    style={{
                      position: 'absolute',
                      left: COL.sit + COL.badge / 2 - 34,
                      top: midY - 34,
                      width: 68,
                      height: 68,
                      borderRadius: '50%',
                      background: 'linear-gradient(150deg, #7FB0F5 0%, #3D86F0 52%, #2F6CC4 100%)',
                      boxShadow: `0 0 0 5px #FFFFFF, 0 8px 18px rgba(47,108,196,.28)`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      opacity: Math.min(1, badgeIn * 1.4) * dim,
                      transform: `translateZ(${(46 + 40 * (1 - badgeIn)).toFixed(1)}px) scale(${(0.5 + 0.5 * badgeIn).toFixed(3)}) rotateZ(${(-120 * (1 - badgeIn)).toFixed(1)}deg)`,
                    }}
                  >
                    <ToolIcon kind={i} size={40} />
                  </div>
                  {/* the tool, hung on the board at the right */}
                  <div
                    style={{
                      position: 'absolute',
                      right: 0,
                      top: 0,
                      width: COL.tool,
                      height: rowH,
                      boxSizing: 'border-box',
                      padding: '0 24px 0 30px',
                      display: 'flex',
                      alignItems: 'center',
                      borderRadius: 22,
                      background: COLORS.white,
                      borderStyle: 'solid',
                      borderWidth: 2,
                      borderColor: glow > 0.01 ? `rgba(61,134,240,${0.35 + 0.65 * glow})` : '#E4E4E7',
                      boxShadow: `${cardShadow(0.7 + 0.8 * glow)}${glow > 0.01 ? `, 0 0 0 ${(6 * glow).toFixed(1)}px rgba(61,134,240,${(0.14 * glow).toFixed(3)})` : ''}`,
                      opacity: toolIn * (0.55 + 0.45 * dim),
                      transform: `translate3d(${(40 * (1 - toolIn)).toFixed(1)}px, ${(-34 * (1 - toolIn)).toFixed(1)}px, ${(36 + 160 * (1 - toolIn)).toFixed(1)}px) rotateZ(${(5 * (1 - toolIn)).toFixed(2)}deg)`,
                    }}
                  >
                    {/* accent bar where it hangs */}
                    <div style={{position: 'absolute', left: 12, top: 18, bottom: 18, width: 5, borderRadius: 3, background: COLORS.accent}} />
                    <span style={{fontSize: fs, fontWeight: 700, letterSpacing: TRACK.body, lineHeight: 1.14, color: COLORS.ink, textWrap: 'balance', opacity: 0.3 + 0.7 * dim}}>{r.tool}</span>
                  </div>
                  {/* the chip on the lifted row */}
                  {isHi && highlightLabel ? (
                    <div
                      style={{
                        position: 'absolute',
                        right: 18,
                        top: -24,
                        opacity: enter(f, fps, liftAt + 5, 10) * dimAll,
                        transform: `translateZ(70px) scale(${(0.7 + 0.3 * enter(f, fps, liftAt + 5, 10)).toFixed(3)})`,
                      }}
                    >
                      <Tag text={highlightLabel} tone="info" size={26} style={{background: COLORS.white, boxShadow: '0 6px 14px rgba(47,108,196,.18)'}} />
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>

          {/* the final card, landing in front */}
          {hasFinal ? (
            <div style={{position: 'absolute', left: 60, right: 60, top: 0, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', ...P3D}}>
              <div
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  padding: '46px 52px 50px',
                  borderRadius: 34,
                  background: 'linear-gradient(165deg, #FFFFFF 0%, #FFFFFF 60%, #FAFAFB 100%)',
                  ...CARD_EDGE,
                  boxShadow: cardShadow(1.8),
                  textAlign: 'center',
                  opacity: Math.min(1, fin * 2.5),
                  transform: `translate3d(0px, ${(-70 * (1 - fin)).toFixed(1)}px, ${(150 + 320 * (1 - fin)).toFixed(1)}px) rotateX(${(-10 * (1 - fin)).toFixed(2)}deg)`,
                }}
              >
                <div style={{display: 'flex', justifyContent: 'center', marginBottom: 22}}>
                  <GradientDash grow={seg(f, finalAt + 4, finalAt + 14)} />
                </div>
                <div style={{fontSize: 56, fontWeight: 700, letterSpacing: TRACK.h2, lineHeight: 1.1, color: COLORS.ink, textWrap: 'balance'}}>{finalCard?.title}</div>
                {finalCard?.subtitle ? (
                  finalCard.subtitle.length <= 9 ? (
                    <div style={{marginTop: 18, fontSize: 132, fontWeight: 800, letterSpacing: TRACK.num, lineHeight: 1, color: COLORS.accent}}>{finalCard.subtitle}</div>
                  ) : (
                    <div style={{marginTop: 18, fontSize: 40, fontWeight: 600, letterSpacing: TRACK.body, lineHeight: 1.2, color: COLORS.gray, textWrap: 'balance'}}>{finalCard.subtitle}</div>
                  )
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </Stage3D>
    </BrandFrame>
  );
};

