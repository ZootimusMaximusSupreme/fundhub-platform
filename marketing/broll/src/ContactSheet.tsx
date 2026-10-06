import React from 'react';
import {AbsoluteFill, Freeze} from 'remotion';
import {COLORS, FONT_FAMILY, FRAME, SAFE, Wordmark} from './brand';
import {TEMPLATES} from './templates/registry';

// The marked review sheet (CLAUDE.md section 8): every template frozen on its
// preview frame, a red number on each, thin red lines at the 14% and 65%
// safe-zone edges on every frame, and a legend.

const SCALE = 1 / 3;
const TW = FRAME.width * SCALE; // 360
const TH = FRAME.height * SCALE; // 640
const COLS = 4;
const GAP_X = 64;
const PAD = 80;
const HEADER = 210;
const LABEL = 132;
const ROW_GAP = 46;
const LEGEND = 700;
const RED = '#DC2626';

const ROWS = Math.ceil(TEMPLATES.length / COLS);

export const CONTACT_SHEET = {
  width: PAD * 2 + COLS * TW + (COLS - 1) * GAP_X,
  height: HEADER + ROWS * (TH + LABEL) + (ROWS - 1) * ROW_GAP + LEGEND,
} as const;

const Badge: React.FC<{n: number; size: number}> = ({n, size}) => (
  <div
    style={{
      width: size,
      height: size,
      borderRadius: '50%',
      background: RED,
      color: '#FFFFFF',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: size * 0.5,
      fontWeight: 800,
      boxShadow: '0 4px 12px rgba(220,38,38,.35)',
      flex: '0 0 auto',
    }}
  >
    {n}
  </div>
);

export const ContactSheet: React.FC = () => (
  <AbsoluteFill style={{background: COLORS.paper, fontFamily: FONT_FAMILY, color: COLORS.ink}}>
    <div style={{position: 'absolute', left: PAD, top: 64, right: PAD, display: 'flex', alignItems: 'center', gap: 34}}>
      <Wordmark width={210} />
      <div style={{width: 2, height: 52, background: COLORS.line}} />
      <div>
        <div style={{fontSize: 40, fontWeight: 700, letterSpacing: '-0.03em'}}>B-roll kit · Round 2 previews: 3D + money (marked)</div>
        <div style={{marginTop: 6, fontSize: 24, color: COLORS.gray}}>
          2026-10-02 · 1080x1920 · each frame is the still saved as previews/&lt;name&gt;.png · default words and numbers shown
        </div>
      </div>
    </div>

    {TEMPLATES.map((t, i) => {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const left = PAD + col * (TW + GAP_X);
      const top = HEADER + row * (TH + LABEL + ROW_GAP);
      return (
        <div key={t.id} style={{position: 'absolute', left, top, width: TW}}>
          <div
            style={{
              position: 'relative',
              width: TW,
              height: TH,
              overflow: 'hidden',
              borderRadius: 14,
              boxShadow: '0 0 0 2px #D4D4D8, 0 18px 40px rgba(10,10,10,.10)',
            }}
          >
            <div style={{position: 'absolute', left: 0, top: 0, width: FRAME.width, height: FRAME.height, transform: `scale(${SCALE})`, transformOrigin: 'top left'}}>
              <Freeze frame={t.hero}>{t.preview()}</Freeze>
            </div>
            <div style={{position: 'absolute', left: 0, right: 0, top: SAFE.top * SCALE - 1, height: 2, background: RED}} />
            <div style={{position: 'absolute', left: 0, right: 0, top: SAFE.bottom * SCALE - 1, height: 2, background: RED}} />
          </div>
          <div style={{position: 'absolute', left: -22, top: -22}}>
            <Badge n={i + 1} size={58} />
          </div>
          <div style={{marginTop: 18, fontSize: 27, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.2}}>
            <span style={{color: RED}}>{i + 1}</span> · {t.title}
          </div>
          <div style={{marginTop: 6, fontSize: 20, color: COLORS.gray2, whiteSpace: 'nowrap'}}>{t.file}.png</div>
        </div>
      );
    })}

    <div
      style={{
        position: 'absolute',
        left: PAD,
        right: PAD,
        top: HEADER + ROWS * (TH + LABEL) + (ROWS - 1) * ROW_GAP + 20,
        borderTop: `2px solid ${COLORS.line}`,
        paddingTop: 34,
      }}
    >
      <div style={{fontSize: 30, fontWeight: 700, letterSpacing: '-0.02em'}}>Legend</div>
      <div style={{marginTop: 18, display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 56, rowGap: 16}}>
        {TEMPLATES.map((t, i) => (
          <div key={t.id} style={{display: 'flex', alignItems: 'flex-start', gap: 18}}>
            <Badge n={i + 1} size={40} />
            <div style={{fontSize: 23, lineHeight: 1.35, color: COLORS.ink2}}>
              <b>{t.title}.</b> {t.what}
            </div>
          </div>
        ))}
      </div>
      <div style={{marginTop: 26, display: 'flex', alignItems: 'center', gap: 18, fontSize: 23, color: COLORS.ink2}}>
        <div style={{width: 64, height: 3, background: RED, flex: '0 0 auto'}} />
        Red lines on every frame: the text safe-zone edges, 14% from the top (y 269) and 65% down (y 1248). Every word and number sits between them. Money outside the lines is decoration only, faded to a third of its strength.
      </div>
    </div>
  </AbsoluteFill>
);
