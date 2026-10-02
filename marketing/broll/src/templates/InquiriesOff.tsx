import React from 'react';
import {BrandFrame, COLORS, Eyebrow, TAG, Tag, TRACK, enter, fadeRight, progressBetween, useTimeline} from '../brand';

export type InquiriesOffProps = {
  eyebrow: string;
  fromLabel: string;
  itemLabel: string;
  beforeTag: string;
  afterTag: string;
  toLabel: string;
  toNote: string;
  durationInFrames?: number;
  showSafeZones?: boolean;
};

export const INQUIRIES_OFF_BASE = 90;
export const INQUIRIES_OFF_HERO = 86;

// Words from the 9/30 /watch VSL: "removing the hard inquiries between each
// funding round ... so your file goes into the next round clean."
export const inquiriesOffDefaults: InquiriesOffProps = {
  eyebrow: 'Between each funding round',
  fromLabel: 'This funding round',
  itemLabel: 'Hard inquiries',
  beforeTag: 'On your report',
  afterTag: 'Removed',
  toLabel: 'Next funding round',
  toNote: 'Goes in clean',
};

const DIAGRAM_W = 700; // centered in the content box
const LINE_X = 44; // timeline x inside the diagram
const NODE = 60;
const A_Y = 0; // node centers, relative to the diagram top
const CARD_TOP = 120;
const CARD_H = 250;
const B_Y = CARD_TOP + CARD_H + 120;

const Node: React.FC<{y: number; filled: number; scale: number; opacity: number}> = ({y, filled, scale, opacity}) => (
  <div
    style={{
      position: 'absolute',
      left: LINE_X - NODE / 2,
      top: y - NODE / 2,
      width: NODE,
      height: NODE,
      borderRadius: '50%',
      background: filled > 0.01 ? `rgba(61,134,240,${filled})` : COLORS.white,
      border: `4px solid ${filled > 0.5 ? COLORS.accent : COLORS.ink2}`,
      boxShadow: `0 0 0 ${12 * filled}px rgba(61,134,240,${0.12 * filled})`,
      transform: `scale(${scale})`,
      opacity,
    }}
  />
);

export const InquiriesOff: React.FC<InquiriesOffProps> = ({
  eyebrow,
  fromLabel,
  itemLabel,
  beforeTag,
  afterTag,
  toLabel,
  toNote,
  durationInFrames,
  showSafeZones,
}) => {
  const {f, fps} = useTimeline(INQUIRIES_OFF_BASE, durationInFrames);
  const aIn = enter(f, fps, 4, 12);
  const line1 = progressBetween(f, 10, 24);
  const card = enter(f, fps, 16, 14);
  const strike = progressBetween(f, 34, 46);
  const tagOut = progressBetween(f, 37, 41); // the old chip leaves first,
  const tagIn = progressBetween(f, 41, 48); // then the new one arrives
  const line2 = progressBetween(f, 46, 60);
  const bFill = enter(f, fps, 56, 10);
  const bText = enter(f, fps, 58, 12);
  const note = enter(f, fps, 64, 12);
  const diagramH = B_Y + 120;

  return (
    <BrandFrame showSafeZones={showSafeZones}>
      <Eyebrow text={eyebrow} progress={enter(f, fps, 0, 14)} />
      <div style={{height: 80}} />
      <div style={{position: 'relative', width: DIAGRAM_W, alignSelf: 'center', height: diagramH, marginTop: NODE / 2}}>
        {/* track, then the drawn segments */}
        <div style={{position: 'absolute', left: LINE_X - 2, top: A_Y, width: 4, height: B_Y - A_Y, background: COLORS.line, opacity: aIn}} />
        <div style={{position: 'absolute', left: LINE_X - 2, top: A_Y, width: 4, height: (CARD_TOP + CARD_H / 2) * line1, background: COLORS.ink2}} />
        <div
          style={{
            position: 'absolute',
            left: LINE_X - 2,
            top: CARD_TOP + CARD_H / 2,
            width: 4,
            height: (B_Y - CARD_TOP - CARD_H / 2) * line2,
            background: COLORS.accent,
          }}
        />
        <Node y={A_Y} filled={0} scale={0.8 + 0.2 * aIn} opacity={aIn} />
        <div
          style={{
            ...fadeRight(enter(f, fps, 6, 12), 24),
            position: 'absolute',
            left: LINE_X + 60,
            top: A_Y - 30,
            fontSize: 50,
            fontWeight: 700,
            letterSpacing: TRACK.h2,
            lineHeight: 1.2,
          }}
        >
          {fromLabel}
        </div>

        {/* the report card in between */}
        <div
          style={{
            ...fadeRight(card, 34),
            position: 'absolute',
            left: LINE_X + 60,
            top: CARD_TOP,
            minWidth: 500,
            height: CARD_H,
            background: COLORS.white,
            border: `2px solid ${COLORS.line}`,
            borderRadius: 28,
            boxShadow: '0 30px 70px rgba(10,10,10,.08), 0 4px 14px rgba(10,10,10,.04)',
            padding: '34px 64px 34px 40px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
          }}
        >
          <div style={{position: 'relative', alignSelf: 'flex-start'}}>
            <span
              style={{
                fontSize: 60,
                fontWeight: 800,
                letterSpacing: TRACK.num,
                lineHeight: 1.1,
                color: strike > 0.5 ? COLORS.gray2 : COLORS.ink,
              }}
            >
              {itemLabel}
            </span>
            <div
              style={{
                position: 'absolute',
                left: -6,
                top: '54%',
                height: 6,
                borderRadius: 3,
                width: `calc(${strike * 100}% + ${strike * 12}px)`,
                background: TAG.bad.fg,
              }}
            />
          </div>
          <div style={{position: 'relative', marginTop: 26, height: 50}}>
            <div style={{position: 'absolute', left: 0, top: 0, opacity: 1 - tagOut}}>
              <Tag text={beforeTag} tone="bad" size={24} />
            </div>
            <div style={{position: 'absolute', left: 0, top: 0, opacity: tagIn, transform: `translateY(${(1 - tagIn) * 10}px)`}}>
              <Tag text={afterTag} tone="ok" size={24} />
            </div>
          </div>
        </div>

        <Node y={B_Y} filled={bFill} scale={0.8 + 0.2 * Math.max(aIn, bFill)} opacity={aIn} />
        <div style={{...fadeRight(bText, 24), position: 'absolute', left: LINE_X + 60, top: B_Y - 30}}>
          <div style={{fontSize: 50, fontWeight: 700, letterSpacing: TRACK.h2, lineHeight: 1.2}}>{toLabel}</div>
          <div style={{marginTop: 14, opacity: note, fontSize: 40, fontWeight: 600, color: COLORS.accent, letterSpacing: TRACK.body}}>
            {toNote}
          </div>
        </div>
      </div>
    </BrandFrame>
  );
};

