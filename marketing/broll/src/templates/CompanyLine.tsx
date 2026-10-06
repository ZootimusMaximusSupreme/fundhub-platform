import React from 'react';
import {Composition, random, useCurrentFrame, useVideoConfig} from 'remotion';
import {
  BackdropStage,
  BrandFrame,
  CARD_EDGE,
  COLORS,
  CashStack,
  Decor,
  DollarBill,
  DollarCounter,
  DollarMark,
  Eyebrow,
  FRAME,
  MoneyField,
  P3D,
  Stage3D,
  TAG,
  TRACK,
  Tag,
  enter,
  fadeUp,
} from '../brand';

// CompanyLine: companies roll down a 3D assembly line, one after another.
// Each one stops under the funding station, cash pours onto it and stacks up
// on top, its windows light up, its revenue bars climb and its chip turns
// "Funded". Then it rolls on, carrying its cash, and the next one comes in.
// It reads "from one company to five or ten, each one funded" (the /roadmap
// page's line for the Business Duplication Map, and $297 Ad 23).
//
// Truth rules: company names are generic ("Company 1" ...) unless the props
// give real ones. No dollar figure shows unless `amounts` or `total` is
// passed from a script line. Stacks and bills are pictures, never amounts.

export type CompanyLineProps = {
  eyebrow: string;
  headline: string;
  /** How many companies roll down the line, 2 to 8 (default 5). */
  count?: number;
  /** Names on the boxes, in order. Missing ones read "Company <n>". */
  labels?: string[];
  /** Optional dollar amount per company, only from a script line. Shown on that box, counting up as it gets funded. */
  amounts?: (number | null)[];
  /** Optional total, only from a script line. Shown on the funding station, counting up as the companies get funded. */
  total?: number;
  /** The chip each box gets once funded. */
  fundedLabel?: string;
  /** Clip length in frames, 75 to 105 (2.5 to 3.5 seconds at 30 fps). */
  durationInFrames?: number;
  showSafeZones?: boolean;
};

export const COMPANY_LINE_BASE = 90;
/** The frame where the idea is fully on screen (company 4 under the station, 1–3 funded). */
export const COMPANY_LINE_HERO = 62;

export const companyLineDefaults: CompanyLineProps = {
  eyebrow: 'Company after company',
  headline: 'From one company to five or ten, each one funded.',
  count: 5,
  fundedLabel: 'Funded',
};

/** This template runs 2.5 to 3.5 seconds (the kit's shared clamp is 2 to 3). */
export const companyLineDuration = (requested?: number): number =>
  Math.min(105, Math.max(75, Math.round(requested ?? COMPANY_LINE_BASE)));

// --- Geometry (scene px; the belt top runs along y = 0, z = 0 is its center line) ---
const BOX = {w: 250, h: 204, d: 150};
const PITCH = 350;
const GATE_X = -170; // the funding station, left of center so funded boxes fill the frame
const BELT = {d: 230, t: 30, slat: 46};
/** Belt segment width and where each one starts (scene x). */
const SEG = 260;
const SEGMENTS = Array.from({length: 9}, (_, k) => -1170 + k * SEG);
const LEG_H = 54;
const STACK = {w: 186, max: 52, grow: 26}; // grow: extra height as cash keeps coming in after funding
const DISP = {h: 78, d: 170, bottom: -318};
const BILLS = 7; // bills poured onto each company
const BILL_W = 126;
/** Scene origin inside the content box (content px). On the frame: x 540, y 1060. */
const ORIGIN = {x: 450, y: 660};
/** The line is turned so it runs away to the left and comes toward you on the right. */
const TILT = {rx: -13, ry: -18};
/** How much the belt slows under the station (0 = steady, 1 = full stop). */
const DWELL = 0.62;
/** Where the belt is at frame 0, in company steps (box 1 is already on screen). */
const U0 = 0.25;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (v: number) => {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
};

const hex = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
/** Blend two #RRGGBB colors. */
const mix = (a: string, b: string, t: number): string => {
  const A = hex(a);
  const B = hex(b);
  const k = clamp01(t);
  return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * k)).join(',')})`;
};

/** The belt's motion. One "step" (u = 1) moves every box one place down the line. */
const lineClock = (n: number) => {
  const uEnd = n + 0.7; // the last company is fully funded and starting to roll on
  const fu = COMPANY_LINE_BASE / (uEnd - U0); // frames per company
  const uAt = (f: number) => U0 + f / fu;
  const fAt = (u: number) => (u - U0) * fu;
  // Smooth "assembly line" pace: slow under the station, quicker between stations. Never a hard stop.
  const travel = (u: number) => PITCH * (u - (DWELL * Math.sin(2 * Math.PI * u)) / (2 * Math.PI));
  const boxX = (i: number, u: number) => GATE_X - PITCH * (i + 1) + travel(u);
  // Bills land on company i while it is under the station (u around i + 1).
  const fall = Math.min(10, fu * 0.6);
  const landing = (i: number, b: number) => fAt(i + 0.84 + (0.4 * b) / (BILLS - 1));
  return {fu, uAt, fAt, travel, boxX, fall, landing};
};

// --- Pieces ---

/** A small office building in line style. Its windows light up gold when the company is funded. */
const Building: React.FC<{size: number; color: string; lit: number}> = ({size, color, lit}) => {
  const win = [
    [16.5, 14],
    [26.5, 14],
    [16.5, 21],
    [26.5, 21],
    [16.5, 28],
    [26.5, 28],
  ];
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" style={{display: 'block'}}>
      <path d="M6 42.5h36" stroke={color} strokeWidth={2.6} strokeLinecap="round" />
      <path d="M12 42.5V10.5a2 2 0 0 1 2-2h20a2 2 0 0 1 2 2v32" stroke={color} strokeWidth={2.6} strokeLinejoin="round" />
      {win.map(([x, y]) => (
        <rect
          key={`${x}-${y}`}
          x={x}
          y={y}
          width={5}
          height={4}
          rx={1}
          fill={lit > 0.02 ? mix('#E9E9EC', '#F5CE8F', lit) : '#ECECEF'}
          stroke={lit > 0.5 ? '#E3AE62' : color}
          strokeOpacity={lit > 0.5 ? 0.9 : 0.55}
          strokeWidth={1.4}
        />
      ))}
      <path d="M21.5 42.5v-7a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v7" stroke={color} strokeWidth={2.2} strokeLinejoin="round" />
    </svg>
  );
};

/** Four revenue bars that climb when the company is funded. A picture of growth, no values. */
const RevenueBars: React.FC<{p: number}> = ({p}) => {
  const shape = [0.36, 0.55, 0.76, 1];
  return (
    <div style={{display: 'flex', alignItems: 'flex-end', gap: 6, height: 50}}>
      {shape.map((k, j) => {
        const g = smooth(p * 1.5 - j * 0.16);
        return (
          <div
            key={j}
            style={{
              width: 12,
              height: 50 * k * (0.26 + 0.74 * g),
              borderRadius: 3,
              background: g > 0.02 ? `linear-gradient(180deg, ${mix('#E4E4E7', '#5DAF77', g)}, ${mix('#DCDCE0', TAG.ok.fg, g)})` : '#E4E4E7',
            }}
          />
        );
      })}
    </div>
  );
};

/** A box face helper: absolute, border-box. */
const face = (s: React.CSSProperties): React.CSSProperties => ({position: 'absolute', boxSizing: 'border-box', ...s});

/** A company: a real 3D box standing on the belt. Front, right side and top faces. */
const CompanyBox: React.FC<{
  x: number;
  label: string;
  funded: number;
  sheen: number;
  fundedLabel: string;
  amount?: React.ReactNode;
}> = ({x, label, funded, sheen, fundedLabel, amount}) => {
  const {w, h, d} = BOX;
  const chip = smooth((funded - 0.35) / 0.4);
  const labelSize = Math.min(34, 212 / Math.max(1, label.length * 0.56));
  return (
    <div style={{position: 'absolute', left: x - w / 2, top: -h, width: w, height: h, ...P3D}}>
      {/* top */}
      <div style={face({left: 0, top: -d / 2, width: w, height: d, transform: 'rotateX(90deg)', background: '#F7F7F9', border: '2px solid #E6E6EA'})} />
      {/* right side, in shade */}
      <div
        style={face({
          left: w,
          top: 0,
          width: d,
          height: h,
          transformOrigin: 'left center',
          transform: `translateZ(${d / 2}px) rotateY(90deg)`,
          background: 'linear-gradient(180deg, #EDEDF1 0%, #E1E1E6 100%)',
          borderTop: '2px solid #F3F3F6',
        })}
      />
      {/* front */}
      <div
        style={face({
          inset: 0,
          transform: `translateZ(${d / 2}px)`,
          background: 'linear-gradient(165deg, #FFFFFF 0%, #FFFFFF 55%, #FAFAFB 100%)',
          ...CARD_EDGE,
          padding: '18px 20px 16px',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        })}
      >
        <div style={{display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', height: 56}}>
          <Building size={56} color={mix(COLORS.gray2, COLORS.accent, funded)} lit={smooth(funded * 1.3)} />
          <RevenueBars p={funded} />
        </div>
        <div
          style={{
            marginTop: 12,
            fontSize: labelSize,
            fontWeight: 700,
            letterSpacing: TRACK.body,
            lineHeight: 1.1,
            whiteSpace: 'nowrap',
            color: mix(COLORS.gray2, COLORS.ink, smooth(funded * 1.6)),
          }}
        >
          {label}
        </div>
        <div style={{position: 'relative', marginTop: 14, height: 40}}>
          {/* waiting: a blank chip */}
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: 2,
              width: 128,
              height: 36,
              borderRadius: 11,
              background: COLORS.soft,
              border: `2px solid ${COLORS.line}`,
              boxSizing: 'border-box',
              opacity: 1 - chip,
              display: 'flex',
              alignItems: 'center',
              padding: '0 14px',
            }}
          >
            <div style={{width: 70, height: 8, borderRadius: 4, background: COLORS.line}} />
          </div>
          {/* funded: the green chip, or the amount when a script line gives one */}
          <div style={{position: 'absolute', left: 0, top: 0, ...fadeUp(chip, 10)}}>
            {amount ?? <Tag text={fundedLabel} tone="ok" size={21} />}
          </div>
        </div>
        {/* a light sweep the moment it is funded */}
        {sheen > 0 && sheen < 1 ? (
          <div
            style={{
              position: 'absolute',
              top: -20,
              bottom: -20,
              left: -160 + (w + 220) * sheen,
              width: 120,
              transform: 'skewX(-18deg)',
              background: 'linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,.6), rgba(255,255,255,0))',
              opacity: Math.sin(sheen * Math.PI),
            }}
          />
        ) : null}
      </div>
    </div>
  );
};

/** The funding station: a floating box with the "$" seal (or the total) and a light strip that glows while it pours. */
const Station: React.FC<{glow: number; width: number; tall?: boolean; children: React.ReactNode}> = ({glow, width, tall, children}) => {
  const {d, bottom} = DISP;
  const h = tall ? DISP.h + 16 : DISP.h;
  return (
    <div style={{position: 'absolute', left: GATE_X - width / 2, top: bottom - h, width, height: h, ...P3D}}>
      <div style={face({left: 0, top: -d / 2, width, height: d, transform: 'rotateX(90deg)', background: '#F8F8FA', border: '2px solid #E6E6EA'})} />
      <div
        style={face({
          left: width,
          top: 0,
          width: d,
          height: h,
          transformOrigin: 'left center',
          transform: `translateZ(${d / 2}px) rotateY(90deg)`,
          background: 'linear-gradient(180deg, #EDEDF1, #E0E0E5)',
        })}
      />
      {/* underside with the slot the bills drop from */}
      <div
        style={face({
          left: 0,
          top: h - d / 2,
          width,
          height: d,
          transform: 'rotateX(90deg)',
          background: '#E3E3E8',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        })}
      >
        <div style={{width: width * 0.62, height: 14, borderRadius: 7, background: '#B9B9C2'}} />
      </div>
      <div
        style={face({
          inset: 0,
          transform: `translateZ(${d / 2}px)`,
          background: 'linear-gradient(165deg, #FFFFFF 0%, #FFFFFF 55%, #F9F9FB 100%)',
          ...CARD_EDGE,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          paddingBottom: tall ? 14 : 8,
          boxShadow: '0 30px 50px -20px rgba(10,10,10,.18)',
        })}
      >
        {children}
        <div
          style={{
            position: 'absolute',
            left: 18,
            right: 18,
            bottom: 8,
            height: 6,
            borderRadius: 3,
            background: 'linear-gradient(90deg, #2F74DA, #3D86F0 30%, #7FB0F5 50%, #3D86F0 70%, #2F74DA)',
            opacity: 0.4 + 0.6 * glow,
            boxShadow: `0 0 ${6 + 18 * glow}px rgba(61,134,240,${0.15 + 0.5 * glow})`,
          }}
        />
      </div>
    </div>
  );
};

/**
 * The conveyor: belt top with moving slats, back rail, front edge with turning
 * rollers, legs, floor shadow. Built from short segments: Chrome's default
 * renderer drops parts of very wide 3D layers (measured 2026-10-02: a single
 * 2600 px belt was cut off mid-frame unless --gl=angle was passed).
 */
const Belt: React.FC<{s: number}> = ({s}) => {
  const {d, t, slat} = BELT;
  const legs = [-1040, -520, 0, 520, 1040];
  const turn = (s / 10) * (180 / Math.PI);
  return (
    <>
      {SEGMENTS.map((x0) => (
        <React.Fragment key={x0}>
          {/* soft shadow on the floor under the line */}
          <div
            style={face({
              left: x0,
              top: LEG_H - d,
              width: SEG + 1,
              height: d * 2,
              transform: 'rotateX(90deg)',
              background: 'linear-gradient(180deg, rgba(10,10,10,0) 0%, rgba(10,10,10,.05) 30%, rgba(10,10,10,.09) 55%, rgba(10,10,10,.04) 80%, rgba(10,10,10,0) 100%)',
            })}
          />
          {/* back rail */}
          <div
            style={face({
              left: x0,
              top: -20,
              width: SEG + 1,
              height: 20,
              transform: `translateZ(${-d / 2}px)`,
              background: 'linear-gradient(180deg, #EFEFF2, #E2E2E7)',
              borderTop: '2px solid #F6F6F8',
            })}
          />
          {/* belt top, slats moving with the line */}
          <div
            style={face({
              left: x0,
              top: -d / 2,
              width: SEG + 1,
              height: d,
              transform: 'rotateX(90deg)',
              backgroundColor: '#F2F2F5',
              backgroundImage: `linear-gradient(180deg, #E7E7EB 0px, #E7E7EB 12px, rgba(0,0,0,0) 12px, rgba(0,0,0,0) ${d - 12}px, #E9E9ED ${d - 12}px), repeating-linear-gradient(90deg, #E4E4E9 0px, #E4E4E9 3px, rgba(0,0,0,0) 3px, rgba(0,0,0,0) ${slat}px)`,
              backgroundPosition: `0 0, ${(((s - x0) % slat) + slat) % slat}px 0`,
            })}
          />
          {/* front edge with rollers */}
          <div
            style={face({
              left: x0,
              top: 0,
              width: SEG + 1,
              height: t,
              transform: `translateZ(${d / 2}px)`,
              background: 'linear-gradient(180deg, #E9E9ED 0%, #DCDCE1 100%)',
              borderTop: '2px solid #F7F7F9',
            })}
          >
            {[65, 195].map((rx) => (
              <div
                key={rx}
                style={{
                  position: 'absolute',
                  left: rx - 10,
                  top: t / 2 - 10,
                  width: 20,
                  height: 20,
                  borderRadius: '50%',
                  background: 'radial-gradient(circle at 40% 35%, #FAFAFB, #D2D2D8)',
                  border: '2px solid #C9C9D0',
                  boxSizing: 'border-box',
                  transform: `rotate(${turn}deg)`,
                }}
              >
                <div style={{position: 'absolute', left: 7, top: 1, width: 2, height: 14, background: '#B5B5BE', borderRadius: 1}} />
              </div>
            ))}
          </div>
        </React.Fragment>
      ))}
      {/* legs: back row, then front row */}
      {legs.map((x) => (
        <div
          key={`b${x}`}
          style={face({left: x - 7, top: t - 2, width: 14, height: LEG_H - t + 2, transform: `translateZ(${-d / 2 + 18}px)`, background: '#D6D6DB'})}
        />
      ))}
      {legs.map((x) => (
        <div
          key={`f${x}`}
          style={face({
            left: x - 8,
            top: t - 2,
            width: 16,
            height: LEG_H - t + 2,
            transform: `translateZ(${d / 2 - 18}px)`,
            background: 'linear-gradient(90deg, #E2E2E6, #CFCFD5)',
          })}
        />
      ))}
    </>
  );
};

/** A soft shadow on the belt under one box (cheap: a gradient, no blur filter). */
const BoxShadow: React.FC<{x: number}> = ({x}) => (
  <div
    style={face({
      left: x - BOX.w * 0.62,
      top: -BOX.d * 0.72,
      width: BOX.w * 1.24,
      height: BOX.d * 1.44,
      transform: 'translate3d(14px, -0.6px, 10px) rotateX(90deg)',
      background: 'radial-gradient(50% 50% at 50% 50%, rgba(10,10,10,.16), rgba(10,10,10,.06) 62%, rgba(10,10,10,0))',
    })}
  />
);

export const CompanyLine: React.FC<CompanyLineProps> = ({
  eyebrow,
  headline,
  count,
  labels,
  amounts,
  total,
  fundedLabel = 'Funded',
  durationInFrames,
  showSafeZones,
}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const L = COMPANY_LINE_BASE;
  const f = (frame * L) / companyLineDuration(durationInFrames);

  const n = Math.max(2, Math.min(8, Math.round(count ?? labels?.length ?? 5)));
  const clock = lineClock(n);
  const u = clock.uAt(f);
  const s = clock.travel(u);

  // The scene settles in: a short push toward the camera and a small turn.
  const settle = enter(f, fps, 0, 24);
  const sceneTransform = `translateZ(${-150 * (1 - settle)}px) rotateX(${TILT.rx}deg) rotateY(${TILT.ry - 7 * (1 - settle)}deg)`;

  // Station glow: on while it pours onto each company.
  let glow = 0;
  for (let i = 0; i < n; i++) glow = Math.max(glow, clamp01(1 - Math.abs(u - (i + 0.82)) / 0.42));
  glow = smooth(glow);

  const hasTotal = typeof total === 'number' && total > 0;
  const stationW = hasTotal ? 340 : 270;
  const totalSize = hasTotal ? Math.min(46, 270 / (0.62 * (String(Math.round(total)).length + 1) + 0.27 * Math.floor((String(Math.round(total)).length - 1) / 3))) : 0;

  const boxes: React.ReactNode[] = [];
  const shadows: React.ReactNode[] = [];
  const stacks: React.ReactNode[] = [];
  const bills: React.ReactNode[] = [];
  const landY = -BOX.h - STACK.max * 0.55;

  for (let i = 0; i < n; i++) {
    const x = clock.boxX(i, u);
    if (x < -1150 || x > 1150) continue;
    const first = clock.landing(i, 0);
    const last = clock.landing(i, BILLS - 1);
    const funded = smooth((f - first) / (last - first + 5));
    const sheen = clamp01((f - last + 4) / 10);
    let landed = 0;
    for (let b = 0; b < BILLS; b++) landed += clamp01((f - clock.landing(i, b)) / 3);
    // The stack: the pour lands it, then it keeps growing while the company rolls on (cash keeps coming in).
    const h = (STACK.max * landed) / BILLS + STACK.grow * smooth((f - last) / 45);
    const amount = amounts?.[i];
    const amountSize = typeof amount === 'number' ? Math.min(40, 205 / (0.62 * (String(Math.round(amount)).length + 1) + 0.27 * Math.floor((String(Math.round(amount)).length - 1) / 3))) : 0;

    shadows.push(<BoxShadow key={`sh${i}`} x={x} />);
    boxes.push(
      <CompanyBox
        key={`box${i}`}
        x={x}
        label={labels?.[i] || `Company ${i + 1}`}
        funded={funded}
        sheen={sheen}
        fundedLabel={fundedLabel}
        amount={
          typeof amount === 'number' && amount > 0 ? (
            <DollarCounter value={amount} f={f} start={first} end={Math.min(last + 8, L - 4)} size={amountSize} color={TAG.ok.fg} />
          ) : undefined
        }
      />,
    );
    if (h > 0.5) {
      const sd = STACK.w / (470 / 200);
      stacks.push(
        <div key={`st${i}`} style={{position: 'absolute', left: x + 6 - STACK.w / 2, top: -BOX.h - sd / 2, ...P3D}}>
          <CashStack width={STACK.w} height={h} view={{rx: 90, rz: -9}} />
        </div>,
      );
    }

    // The pour: bills drop out of the station's slot and land on this company's stack.
    for (let b = 0; b < BILLS; b++) {
      const land = clock.landing(i, b);
      const spawn = land - clock.fall;
      if (f < spawn || f > land + 1) continue;
      const q = clamp01((f - spawn) / clock.fall);
      const r = (k: number) => random(`company-line-bill-${i}-${b}-${k}`);
      const jx = (r(1) - 0.5) * 90;
      const jz = (r(2) - 0.5) * 50;
      const xLand = clock.boxX(i, clock.uAt(land)) + 6 + jx * 0.5;
      const bx = GATE_X + jx + (xLand - GATE_X - jx) * q;
      const by = DISP.bottom + 6 + (landY - DISP.bottom - 6) * q * q;
      const rz = -24 + 48 * r(3) + q * 30 * (r(4) - 0.5);
      const rx = Math.sin(q * Math.PI * 1.4 + r(5) * 6) * 28;
      const ry = Math.cos(q * Math.PI + r(6) * 6) * 22;
      const sc = 0.62 + 0.38 * smooth(q / 0.25);
      const a = Math.min(1, q / 0.12, (1 - q) / 0.12 + 0.15);
      bills.push(
        <div
          key={`bill${i}-${b}`}
          style={{
            position: 'absolute',
            left: bx - BILL_W / 2,
            top: by - BILL_W / (470 / 200) / 2,
            width: BILL_W,
            opacity: clamp01(a),
            transform: `translateZ(${jz}px) rotateZ(${rz}deg) rotateX(${rx}deg) rotateY(${ry}deg) scale(${sc})`,
          }}
        >
          <DollarBill width={BILL_W} detail="simple" />
        </div>,
      );
    }
  }

  return (
    <BrandFrame
      showSafeZones={showSafeZones}
      backdrop={
        <BackdropStage f={f} length={L}>
          {/* faint money above and below the words (the stage fades it in those zones) */}
          <MoneyField f={f} mode="drift" count={5} seed="company-line-top" area={{x: 40, y: 20, w: 1000, h: 300}} size={[150, 220]} depth={[-700, -250]} opacity={0.5} blur={2.5} />
          <MoneyField f={f} mode="rise" count={7} seed="company-line-low" area={{x: 0, y: 1290, w: 1080, h: 640}} size={[160, 240]} depth={[-650, -150]} opacity={0.6} blur={2} kind="mix" />
        </BackdropStage>
      }
    >
      <Stage3D f={f} length={L}>
        <div style={{position: 'relative', width: 900, height: 824, ...P3D}}>
          <div style={{position: 'absolute', left: 0, right: 0, top: 6}}>
            <Eyebrow text={eyebrow} progress={enter(f, fps, 0, 14)} />
          </div>
          <div
            style={{
              ...fadeUp(enter(f, fps, 3, 14), 20),
              position: 'absolute',
              left: 20,
              right: 20,
              top: 64,
              textWrap: 'balance',
              fontSize: 60,
              fontWeight: 700,
              letterSpacing: TRACK.h2,
              lineHeight: 1.1,
              textAlign: 'center',
            }}
          >
            {headline}
          </div>

          <div style={{position: 'absolute', left: ORIGIN.x, top: ORIGIN.y, width: 0, height: 0, ...P3D, transform: sceneTransform}}>
            <Belt s={s} />
            {/* the funding spot on the belt, under the station */}
            <div
              style={face({
                left: GATE_X - 170,
                top: -120,
                width: 340,
                height: 240,
                transform: 'translateY(-1.2px) rotateX(90deg)',
                background: `radial-gradient(50% 50% at 50% 50%, rgba(61,134,240,${0.1 + 0.16 * glow}), rgba(61,134,240,0))`,
              })}
            />
            {shadows}
            <Decor>
              {/* light falling from the station, behind the boxes */}
              <div
                style={face({
                  left: GATE_X - 160,
                  top: DISP.bottom,
                  width: 320,
                  height: -DISP.bottom,
                  transform: `translateZ(${-BELT.d / 2 + 14}px)`,
                  clipPath: 'polygon(28% 0, 72% 0, 100% 100%, 0 100%)',
                  background: `linear-gradient(180deg, rgba(61,134,240,${0.08 + 0.2 * glow}), rgba(61,134,240,0))`,
                })}
              />
            </Decor>
            {boxes}
            <Decor>
              {stacks}
              {bills}
            </Decor>
            <Station glow={glow} width={stationW} tall={hasTotal}>
              {hasTotal ? (
                <DollarCounter value={total as number} f={f} start={clock.landing(0, 0)} end={Math.min(clock.landing(n - 1, BILLS - 1) + 6, L - 4)} size={totalSize} color={COLORS.ink} />
              ) : (
                <div
                  style={{
                    width: 50,
                    height: 50,
                    borderRadius: '50%',
                    background: COLORS.accentSoft,
                    border: `2px solid ${COLORS.accentLine}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <DollarMark height={30} color={COLORS.accent} weight={2.8} />
                </div>
              )}
            </Station>
          </div>
        </div>
      </Stage3D>
    </BrandFrame>
  );
};

/** The composition, for Root.tsx. Length comes from the props (75 to 105 frames). */
export const companyLineComposition = (): React.ReactElement => (
  <Composition
    key="CompanyLine"
    id="CompanyLine"
    component={CompanyLine}
    durationInFrames={COMPANY_LINE_BASE}
    fps={FRAME.fps}
    width={FRAME.width}
    height={FRAME.height}
    defaultProps={companyLineDefaults}
    calculateMetadata={({props}) => ({durationInFrames: companyLineDuration(props.durationInFrames)})}
  />
);
