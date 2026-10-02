import React from 'react';
import {interpolate} from 'remotion';
import {
  BackdropStage,
  BrandFrame,
  CARD_EDGE,
  COLORS,
  CONTENT_WIDTH,
  Eyebrow,
  MoneyField,
  P3D,
  Stage3D,
  TAG,
  TRACK,
  enter,
  progressBetween,
} from '../brand';
import {useOfferCtaTimeline} from './offer-cta-timeline';

// BookCall: the call to action for the book-a-call funnel (/watch). A 3D
// calendar flips down into place, a day gets picked, time slots appear, one is
// picked, and a "Booked" card lands in front. Generic days and times only: no
// month name, no year, no person's name.

export type BookCallProps = {
  eyebrow: string;
  /** Big line over the calendar, e.g. "Hop on a call". Null hides it. */
  line: string | null;
  /** The day that gets picked (1 to 30 on the generic month grid). */
  pickDay: number;
  /** Time slots shown after the day is picked. Generic times only. */
  times: string[];
  /** Which slot gets picked (index into times). */
  pickTime: number;
  /** The confirmation word. */
  booked: string;
  /** One small line under the confirmation, or null. */
  detail: string | null;
  durationInFrames?: number;
  showSafeZones?: boolean;
};

export const BOOK_CALL_BASE = 90;
export const BOOK_CALL_HERO = 86;

// Words from the funnel: the /apply calendar ("Free call", "Your funding
// advisor meets you on Google Meet", "Soft pull only, zero score impact"), the
// /watch book page ("a live Google Meet, and we run a soft credit pull on the
// call, zero score impact") and the sorting-hat ads' last line ("hop on a call
// and we'll figure it out", marketing/ads/scripts/2026-10-02.md, Ads 24 to 26).
export const bookCallDefaults: BookCallProps = {
  eyebrow: 'Free call · Google Meet',
  line: 'Hop on a call',
  pickDay: 15,
  times: ['9:00 AM', '11:30 AM', '2:30 PM', '4:00 PM'],
  pickTime: 2,
  booked: 'Booked',
  detail: 'Soft pull on the call, zero score impact',
};

// Generic month: 30 days, day 1 on a Wednesday (Monday-first grid). No month name.
const DAYS = 30;
const FIRST_COL = 2;
const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const WEEKDAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const OPEN_FROM = 8; // days before this read as already gone

// Card geometry (content-box px).
const CARD_W = CONTENT_WIDTH; // 900
const HEAD_H = 92;
const LEFT_W = 540;
const CELL_W = 68;
const CELL_H = 60;
const PAD = 32;

// Timing (base frames).
const FLIP_AT = 4;
const DAY_AT = 28;
const SLOTS_AT = 36;
const TIME_AT = 54;
const BOOKED_AT = 64;

// Shadows kept short: the kit's tall card shadow would run past the safe-zone
// edge under the calendar and be cut off flat there.
const SHORT_SHADOW = '0 5px 0 -1px #DCDCE1, 0 12px 22px rgba(10,10,10,.07), 0 28px 40px -16px rgba(10,10,10,.16)';
const FRONT_SHADOW = '0 6px 0 -1px #DCDCE1, 0 16px 28px rgba(10,10,10,.10), 0 34px 46px -18px rgba(10,10,10,.22)';

const Ring: React.FC<{x: number; y: number; p: number; size: number}> = ({x, y, p, size}) =>
  p > 0 && p < 1 ? (
    <div
      style={{
        position: 'absolute',
        left: x - size / 2,
        top: y - size / 2,
        width: size,
        height: size,
        borderRadius: '50%',
        border: `3px solid ${COLORS.accent}`,
        opacity: 0.55 * (1 - p),
        transform: `scale(${0.7 + 1.1 * p})`,
      }}
    />
  ) : null;

const BinderRing: React.FC<{left: number}> = ({left}) => (
  <div
    style={{
      position: 'absolute',
      top: -26,
      left,
      width: 22,
      height: 58,
      borderRadius: 11,
      background: 'linear-gradient(90deg, #C9CDD6, #F4F5F8 45%, #B9BEC9)',
      boxShadow: '0 3px 6px rgba(10,10,10,.18)',
    }}
  />
);

export const BookCall: React.FC<BookCallProps> = ({eyebrow, line, pickDay, times, pickTime, booked, detail, durationInFrames, showSafeZones}) => {
  const {f, fps} = useOfferCtaTimeline(BOOK_CALL_BASE, durationInFrames);
  const L = BOOK_CALL_BASE;

  const flip = enter(f, fps, FLIP_AT, 22);
  const dayPick = progressBetween(f, DAY_AT, DAY_AT + 6);
  const dayRing = progressBetween(f, DAY_AT, DAY_AT + 14);
  const timePick = progressBetween(f, TIME_AT, TIME_AT + 6);
  const timeRing = progressBetween(f, TIME_AT, TIME_AT + 14);
  const bIn = enter(f, fps, BOOKED_AT, 18);
  const checkDraw = progressBetween(f, BOOKED_AT + 8, BOOKED_AT + 20);
  // As the booking comes forward, the calendar behind it softens (depth of field).
  const back = progressBetween(f, BOOKED_AT + 2, BOOKED_AT + 16);
  const backFilter = back > 0.02 ? `blur(${(3.5 * back).toFixed(2)}px)` : undefined;
  const backDim = 1 - 0.4 * back;

  const day = Math.max(1, Math.min(DAYS, Math.round(pickDay)));
  const slot = Math.max(0, Math.min(times.length - 1, Math.round(pickTime)));
  const rows = Math.ceil((FIRST_COL + DAYS) / 7);
  const gridW = CELL_W * 7;
  const gridLeft = (LEFT_W - gridW) / 2;
  const cellOf = (d: number) => {
    const k = FIRST_COL + d - 1;
    return {col: k % 7, row: Math.floor(k / 7)};
  };
  const pc = cellOf(day);
  const pickX = gridLeft + pc.col * CELL_W + CELL_W / 2;
  const pickY = 44 + pc.row * CELL_H + CELL_H / 2;

  const rightW = CARD_W - LEFT_W;
  const slotH = 66;
  const slotGap = 14;
  const bodyH = 44 + rows * CELL_H + PAD;

  return (
    <BrandFrame
      showSafeZones={showSafeZones}
      backdrop={
        <BackdropStage f={f} length={L}>
          <MoneyField f={f} mode="drift" count={7} seed="book-call-drift" size={[160, 230]} depth={[-950, -320]} opacity={0.26} blur={3} />
        </BackdropStage>
      }
    >
      <Stage3D f={f} length={L}>
        <Eyebrow text={eyebrow} progress={enter(f, fps, 0, 14)} />
        {line ? (
          <div
            style={{
              marginTop: 22,
              fontSize: 76,
              fontWeight: 800,
              letterSpacing: TRACK.h2,
              lineHeight: 1.05,
              color: COLORS.ink,
              textAlign: 'center',
              opacity: enter(f, fps, 4, 16),
              transform: `translateY(${(1 - enter(f, fps, 4, 16)) * 24}px)`,
            }}
          >
            {line}
          </div>
        ) : null}
        <div style={{height: 54}} />

        <div style={{...P3D, position: 'relative', width: CARD_W, height: HEAD_H + bodyH}}>
          {/* the calendar: flips down from its top edge, then steps back when the booking lands */}
          <div
            style={{
              ...P3D,
              position: 'absolute',
              inset: 0,
              transformOrigin: '50% 0%',
              transform: `translate3d(0, ${(1 - flip) * -30}px, ${(1 - flip) * -260 - bIn * 90}px) rotateX(${(1 - flip) * -96 + bIn * 4}deg) rotateY(${-3}deg)`,
            }}
          >
            <div
              style={{
                position: 'absolute',
                inset: 0,
                borderRadius: 30,
                background: '#FFFFFF',
                ...CARD_EDGE,
                boxShadow: SHORT_SHADOW,
                opacity: Math.min(1, flip * 2.2) * backDim,
                filter: backFilter,
              }}
            >
              {/* header band */}
              <div
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  top: 0,
                  height: HEAD_H,
                  borderRadius: '28px 28px 0 0',
                  background: 'linear-gradient(180deg, #4C91F3 0%, #3D86F0 60%, #3479E0 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  color: '#FFFFFF',
                  fontSize: 25,
                  fontWeight: 700,
                  letterSpacing: '0.14em',
                  textTransform: 'uppercase',
                }}
              >
                <div style={{width: LEFT_W, textAlign: 'center'}}>Pick a day</div>
                <div style={{width: rightW, textAlign: 'center', opacity: progressBetween(f, SLOTS_AT - 4, SLOTS_AT + 6)}}>Pick a time</div>
              </div>
              <BinderRing left={150} />
              <BinderRing left={CARD_W - 172} />

              {/* left: the month grid */}
              <div style={{position: 'absolute', left: 0, top: HEAD_H, width: LEFT_W, height: bodyH}}>
                {WEEKDAYS.map((w, i) => (
                  <div
                    key={i}
                    style={{
                      position: 'absolute',
                      left: gridLeft + i * CELL_W,
                      top: 10,
                      width: CELL_W,
                      textAlign: 'center',
                      fontSize: 21,
                      fontWeight: 700,
                      letterSpacing: '0.08em',
                      color: COLORS.gray2,
                    }}
                  >
                    {w}
                  </div>
                ))}
                {Array.from({length: DAYS}, (_, i) => {
                  const d = i + 1;
                  const {col, row} = cellOf(d);
                  const weekend = col >= 5;
                  const open = !weekend && d >= OPEN_FROM;
                  const picked = d === day;
                  const fill = picked ? dayPick : 0;
                  return (
                    <div
                      key={d}
                      style={{
                        position: 'absolute',
                        left: gridLeft + col * CELL_W + (CELL_W - 52) / 2,
                        top: 44 + row * CELL_H + (CELL_H - 52) / 2,
                        width: 52,
                        height: 52,
                        borderRadius: '50%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 25,
                        fontWeight: open ? 700 : 500,
                        fontVariantNumeric: 'tabular-nums',
                        color: picked && fill > 0.5 ? '#FFFFFF' : open ? COLORS.accent : '#B8B8BF',
                        background: picked
                          ? `rgba(61,134,240,${0.1 + 0.9 * fill})`
                          : open
                            ? COLORS.accentSoft
                            : 'transparent',
                        boxShadow: picked && fill > 0 ? `0 6px 14px rgba(61,134,240,${0.3 * fill})` : 'none',
                        transform: picked ? `scale(${1 + 0.12 * Math.sin(Math.PI * fill)})` : undefined,
                      }}
                    >
                      {d}
                    </div>
                  );
                })}
                <Ring x={pickX} y={pickY} p={dayRing} size={64} />
              </div>

              {/* divider */}
              <div style={{position: 'absolute', left: LEFT_W, top: HEAD_H + 22, width: 2, height: bodyH - 44, background: COLORS.soft}} />
            </div>

            {/* right: time slots, each lifted a little off the calendar */}
            <div style={{...P3D, position: 'absolute', left: LEFT_W, top: HEAD_H, width: rightW, height: bodyH}}>
              {times.map((t, i) => {
                const e = enter(f, fps, SLOTS_AT + i * 3, 13);
                const picked = i === slot;
                const fill = picked ? timePick : 0;
                const top = 30 + i * (slotH + slotGap);
                return (
                  <div
                    key={`${t}-${i}`}
                    style={{
                      position: 'absolute',
                      left: 34,
                      right: 34,
                      top,
                      height: slotH,
                      borderRadius: 16,
                      border: `2px solid ${picked && fill > 0 ? COLORS.accent : COLORS.accentLine}`,
                      background: picked ? `rgba(61,134,240,${fill})` : '#FFFFFF',
                      color: picked && fill > 0.5 ? '#FFFFFF' : COLORS.accent,
                      boxShadow: picked && fill > 0 ? `0 8px 18px rgba(61,134,240,${0.3 * fill})` : '0 2px 0 -1px #DCE6F7',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 29,
                      fontWeight: 700,
                      letterSpacing: '-0.01em',
                      fontVariantNumeric: 'tabular-nums',
                      opacity: Math.min(1, e * 1.4) * Math.min(1, flip * 2) * backDim,
                      filter: backFilter,
                      transform: `translate3d(${(1 - e) * 70}px, 0, ${14 + (1 - e) * 60 + (picked ? 10 * Math.sin(Math.PI * fill) : 0)}px) rotateY(${(1 - e) * 28}deg)`,
                    }}
                  >
                    {t}
                  </div>
                );
              })}
              <div style={{position: 'absolute', left: 0, top: 0, width: rightW, height: bodyH}}>
                <Ring x={rightW / 2} y={30 + slot * (slotH + slotGap) + slotH / 2} p={timeRing} size={90} />
              </div>
            </div>
          </div>

          {/* the confirmation, landing in front */}
          <div
            style={{
              position: 'absolute',
              left: (CARD_W - 700) / 2,
              width: 700,
              top: HEAD_H + 22,
              padding: '38px 40px 36px',
              borderRadius: 30,
              background: 'linear-gradient(165deg, #FFFFFF 0%, #FFFFFF 60%, #FAFAFB 100%)',
              ...CARD_EDGE,
              boxShadow: `${FRONT_SHADOW}, 0 0 0 8px rgba(62,142,88,${0.06 * bIn})`,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              opacity: Math.min(1, bIn * 5),
              transform: `translate3d(0, ${(1 - bIn) * 40}px, ${150 + (1 - bIn) * 380}px) rotateX(${(1 - bIn) * 20}deg)`,
            }}
          >
            <div style={{display: 'flex', alignItems: 'center', gap: 26}}>
              <div
                style={{
                  width: 92,
                  height: 92,
                  borderRadius: '50%',
                  background: TAG.ok.bg,
                  border: `3px solid ${TAG.ok.border}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flex: '0 0 auto',
                }}
              >
                <svg width={50} height={50} viewBox="0 0 24 24">
                  <path
                    d="M5 12.5 L10 17.5 L19 7"
                    fill="none"
                    stroke={TAG.ok.fg}
                    strokeWidth={3}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeDasharray={24}
                    strokeDashoffset={24 * (1 - checkDraw)}
                  />
                </svg>
              </div>
              <div style={{fontSize: 84, fontWeight: 800, letterSpacing: TRACK.h1, color: COLORS.ink, lineHeight: 1}}>{booked}</div>
            </div>
            {/* the day and time that were picked */}
            <div
              style={{
                marginTop: 24,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 14,
                padding: '12px 24px',
                borderRadius: 999,
                background: COLORS.accentSoft,
                border: `2px solid ${COLORS.accentLine}`,
                color: COLORS.accent,
                fontSize: 30,
                fontWeight: 700,
                letterSpacing: '-0.01em',
                fontVariantNumeric: 'tabular-nums',
                whiteSpace: 'nowrap',
              }}
            >
              <svg width={30} height={30} viewBox="0 0 24 24" fill="none" stroke={COLORS.accent} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                <rect x={3.5} y={5} width={17} height={15.5} rx={3} />
                <path d="M3.5 10 H20.5 M8 3 V7 M16 3 V7" />
              </svg>
              {`${WEEKDAY_NAMES[pc.col]} ${day} · ${times[slot] ?? ''}`}
            </div>
            {detail ? (
              <div
                style={{
                  marginTop: 20,
                  fontSize: 28,
                  fontWeight: 500,
                  color: COLORS.gray,
                  letterSpacing: TRACK.body,
                  textAlign: 'center',
                  lineHeight: 1.3,
                  textWrap: 'balance',
                  opacity: interpolate(bIn, [0.5, 1], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}),
                }}
              >
                {detail}
              </div>
            ) : null}
          </div>
        </div>
      </Stage3D>
    </BrandFrame>
  );
};
