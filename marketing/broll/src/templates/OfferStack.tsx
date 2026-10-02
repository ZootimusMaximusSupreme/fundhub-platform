import React from 'react';
import {Img, interpolate, staticFile} from 'remotion';
import {
  BackdropStage,
  BrandFrame,
  CARD_EDGE,
  COLORS,
  CONTENT,
  CONTENT_WIDTH,
  CashStack,
  Decor,
  Eyebrow,
  GradientDash,
  MoneyField,
  P3D,
  STAGE_CENTER,
  Stage3D,
  TRACK,
  cardShadow,
  enter,
  progressBetween,
} from '../brand';
import {useOfferCtaTimeline} from './offer-cta-timeline';

// OfferStack: the six things in the $297 Funding Roadmap stack up in 3D, one
// row at a time, each with a real page from the /roadmap checkout's own "See a
// sample" previews, then the price lands with cash behind it.

export type OfferItem = {
  /** The item's name, as the /roadmap checkout writes it. */
  title: string;
  /** Lighter words after the name on the same line, e.g. "(all six rounds)". */
  sub?: string;
  /** A chip in front of the name, e.g. "FREE BONUS" (the page's green .fh-bonus chip). */
  bonus?: string;
  /** A picture in public/, e.g. "offer-stack/snapshot.png". Null draws a plain page with only the title. */
  visual?: string | null;
};

export type OfferStackProps = {
  eyebrow: string;
  items: OfferItem[];
  /** Shown exactly as given, e.g. "$297". */
  price: string;
  /** One small line under the price, or null. Never a day count. */
  footer: string | null;
  durationInFrames?: number;
  showSafeZones?: boolean;
};

export const OFFER_STACK_BASE = 105;
export const OFFER_STACK_HERO = 96;

// The six items in the page's own words and order (marketing/landing-pages/slo/
// slo-01-sales.html, checkout order summary). Pictures are renders of the
// page's sample previews (scripts/offer-stack-shots.mjs). The Business
// Duplication Map has no picture on purpose: the page's sample names a
// business and state that are not the /roadmap sample client's, so it would
// mix two files (.claude/rules/sample-clients-consistent.md).
export const offerStackDefaults: OfferStackProps = {
  eyebrow: 'Your Funding Roadmap',
  items: [
    {title: 'How Much You Qualify For', visual: 'offer-stack/snapshot.png'},
    {title: 'Credit Analysis Report', visual: 'offer-stack/analysis.png'},
    {title: 'Credit Optimization Roadmap', visual: 'offer-stack/roadmap.png'},
    {title: 'Dispute Letter Pack', sub: '(all six rounds)', visual: 'offer-stack/pack.png'},
    {title: 'Bank & Lender Match List', visual: 'offer-stack/lenders.png'},
    {title: 'Business Duplication Map', bonus: 'FREE BONUS', visual: null},
  ],
  price: '$297',
  footer: null,
};

// Layout, in content-box px (900 wide, 824 tall).
const BOX_H = CONTENT.bottom - CONTENT.top; // 824
// Empty space under the price: the camera looks down a little, so the bottom of
// the column sits lower and nearer on screen; this keeps the price card's
// shadow clear of the safe-zone edge.
const BOTTOM_AIR = 56;
const EYEBROW_H = 37;
const GAP_EYEBROW = 30;
const GAP_PRICE = 34;
const PRICE_H = 124;
const FOOTER_LINE = 34;
const FOOTER_SIZE = 26;
const GAP_FOOTER = 18;
const ROW_GAP = 12;
const THUMB_LEFT = 26;
const CHECK = 46;
const BONUS_GREEN = '#A8D8B0'; // page .fh-bonus background (spectrum green)

// Timing (base frames).
const ROW_START = 8;
const ROW_STEP = 8;
const PRICE_AT = 62;

/** Resting tilt of each little page, so the column reads as a loose stack of paper. */
const PAGE_TILT = [-2.5, 2, -2, 2.5, -1.5, 2, -2];

/** Rough text width for Inter at a weight near 700 (used only to pick one font size that fits every row). */
const textWidth = (s: string, size: number, k = 0.56) => s.length * size * k;

const Check: React.FC<{size: number; pop: number}> = ({size, pop}) => (
  <div
    style={{
      width: size,
      height: size,
      borderRadius: '50%',
      background: COLORS.accent,
      boxShadow: '0 4px 0 -1px #2F6CC4, 0 10px 18px rgba(61,134,240,.28)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      opacity: Math.min(1, pop * 1.6),
      transform: `scale(${0.4 + 0.6 * pop})`,
      flex: '0 0 auto',
    }}
  >
    <svg width={size * 0.5} height={size * 0.5} viewBox="0 0 24 24">
      <path
        d="M5 12.5 L10 17.5 L19 7"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth={3.4}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={24}
        strokeDashoffset={24 * (1 - Math.min(1, Math.max(0, pop * 1.4 - 0.3)))}
      />
    </svg>
  </div>
);

/** A small sheet of paper: a real sample page, or a plain branded page with only the title. */
const Page: React.FC<{item: OfferItem; w: number; h: number}> = ({item, w, h}) => (
  <div
    style={{
      width: w,
      height: h,
      borderRadius: 8,
      background: '#FFFFFF',
      border: '2px solid #E4E4E7',
      boxShadow: '0 3px 0 -1px #DCDCE1, 0 10px 20px rgba(10,10,10,.10), 0 22px 34px -14px rgba(10,10,10,.18)',
      overflow: 'hidden',
      position: 'relative',
    }}
  >
    {item.visual ? (
      <Img src={staticFile(item.visual)} style={{width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top center', display: 'block'}} />
    ) : (
      <div style={{position: 'absolute', inset: 0, padding: `${h * 0.14}px ${w * 0.12}px`, display: 'flex', flexDirection: 'column', gap: h * 0.07}}>
        <GradientDash size="bullet" />
        <div style={{fontSize: w * 0.15, fontWeight: 800, lineHeight: 1.08, letterSpacing: '-0.03em', color: COLORS.ink}}>{item.title}</div>
      </div>
    )}
  </div>
);

export const OfferStack: React.FC<OfferStackProps> = ({eyebrow, items, price, footer, durationInFrames, showSafeZones}) => {
  const {f, fps} = useOfferCtaTimeline(OFFER_STACK_BASE, durationInFrames);
  const L = OFFER_STACK_BASE;
  const n = Math.max(1, items.length);

  // Fit the rows to the space left after the eyebrow, the price and the footer.
  const footerLines = footer ? Math.min(2, Math.ceil(textWidth(footer, FOOTER_SIZE, 0.47) / (CONTENT_WIDTH - 40))) : 0;
  const footerH = footer ? footerLines * FOOTER_LINE + GAP_FOOTER : 0;
  const avail = BOX_H - BOTTOM_AIR - EYEBROW_H - GAP_EYEBROW - GAP_PRICE - PRICE_H - footerH;
  const rowH = Math.min(100, Math.floor((avail - ROW_GAP * (n - 1)) / n));
  const thumbH = rowH + 12;
  const thumbW = Math.round(thumbH * 0.77);
  const textLeft = THUMB_LEFT + thumbW + 30;
  const textMax = CONTENT_WIDTH - textLeft - CHECK - 30;
  const fit = (it: OfferItem) => {
    const chip = it.bonus ? textWidth(it.bonus, 20, 0.72) + 34 + 16 : 0;
    const words = textWidth(it.title, 1) + (it.sub ? textWidth(` ${it.sub}`, 0.92, 0.5) : 0);
    return (textMax - chip) / words;
  };
  const titleSize = Math.max(28, Math.min(38, ...items.map(fit)));

  // Price lands: from the camera, then settles.
  const pIn = enter(f, fps, PRICE_AT, 18);
  const pShine = progressBetween(f, PRICE_AT + 14, PRICE_AT + 34);
  const stackGrow = enter(f, fps, PRICE_AT + 2, 26);
  const footIn = enter(f, fps, PRICE_AT + 14, 14);

  // Screen spot of the price card on the full frame (for the bills that fly out behind it).
  const rowsH = n * rowH + (n - 1) * ROW_GAP;
  const columnH = EYEBROW_H + GAP_EYEBROW + rowsH + GAP_PRICE + PRICE_H + footerH + BOTTOM_AIR;
  const priceCenterY = CONTENT.top + (BOX_H - columnH) / 2 + EYEBROW_H + GAP_EYEBROW + rowsH + GAP_PRICE + PRICE_H / 2;

  const dollar = price.startsWith('$');
  const priceDigits = dollar ? price.slice(1) : price;

  return (
    <BrandFrame
      showSafeZones={showSafeZones}
      backdrop={
        <BackdropStage f={f} length={L}>
          <MoneyField f={f} mode="drift" count={9} seed="offer-stack-drift" size={[170, 250]} depth={[-900, -260]} opacity={0.34} blur={2.5} />
          <MoneyField
            f={f}
            mode="burst"
            count={11}
            seed="offer-stack-burst"
            from={{x: STAGE_CENTER.x, y: priceCenterY}}
            start={PRICE_AT + 6}
            end={PRICE_AT + 16}
            size={[150, 220]}
            depth={[-520, -140]}
            opacity={0.5}
            blur={1.5}
            speed={0.9}
          />
        </BackdropStage>
      }
    >
      <Stage3D f={f} length={L}>
        <Eyebrow text={eyebrow} progress={enter(f, fps, 0, 14)} />
        <div style={{height: GAP_EYEBROW}} />

        <div style={{...P3D, position: 'relative', width: CONTENT_WIDTH, display: 'flex', flexDirection: 'column', gap: ROW_GAP}}>
          {items.map((it, i) => {
            const t = ROW_START + i * ROW_STEP;
            const e = enter(f, fps, t, 16);
            const ePage = enter(f, fps, t + 3, 15);
            const pop = enter(f, fps, t + 9, 10);
            const q = 1 - e;
            const tilt = PAGE_TILT[i % PAGE_TILT.length];
            return (
              <div
                key={`${it.title}-${i}`}
                style={{
                  ...P3D,
                  position: 'relative',
                  height: rowH,
                  zIndex: i + 1,
                  transform: `translate3d(${q * 110}px, ${q * 26}px, ${-q * 380}px) rotateY(${-3 - q * 20}deg)`,
                }}
              >
                {/* the card */}
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    borderRadius: 22,
                    background: 'linear-gradient(165deg, #FFFFFF 0%, #FFFFFF 55%, #FAFAFB 100%)',
                    ...CARD_EDGE,
                    boxShadow: cardShadow(0.7),
                    opacity: e,
                  }}
                />
                {/* the sample page, lifted off the card */}
                <div
                  style={{
                    position: 'absolute',
                    left: THUMB_LEFT,
                    top: (rowH - thumbH) / 2,
                    opacity: Math.min(1, ePage * 1.5),
                    transform: `translateZ(${30 + (1 - ePage) * 160}px) rotateZ(${tilt * (0.4 + 0.6 * ePage)}deg) rotateX(${(1 - ePage) * 24}deg)`,
                  }}
                >
                  <Page item={it} w={thumbW} h={thumbH} />
                </div>
                {/* the name */}
                <div
                  style={{
                    position: 'absolute',
                    left: textLeft,
                    right: CHECK + 30,
                    top: 0,
                    bottom: 0,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 16,
                    opacity: e,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {it.bonus ? (
                    <span
                      style={{
                        flex: '0 0 auto',
                        background: BONUS_GREEN,
                        color: COLORS.ink,
                        fontSize: 20,
                        fontWeight: 800,
                        letterSpacing: '0.14em',
                        padding: '9px 17px',
                        borderRadius: 999,
                        lineHeight: 1,
                      }}
                    >
                      {it.bonus}
                    </span>
                  ) : null}
                  <span style={{fontSize: titleSize, fontWeight: 700, letterSpacing: TRACK.body, color: COLORS.ink, lineHeight: 1.1}}>
                    {it.title}
                    {it.sub ? <span style={{fontWeight: 500, color: COLORS.gray2, fontSize: titleSize * 0.92}}> {it.sub}</span> : null}
                  </span>
                </div>
                {/* the tick */}
                <div style={{position: 'absolute', right: 26, top: (rowH - CHECK) / 2}}>
                  <Check size={CHECK} pop={pop} />
                </div>
              </div>
            );
          })}
        </div>

        <div style={{height: GAP_PRICE}} />

        {/* the price, with cash on both sides */}
        <div style={{...P3D, position: 'relative', width: CONTENT_WIDTH, height: PRICE_H, display: 'flex', justifyContent: 'center'}}>
          <Decor>
            {[-1, 1].map((side) => (
              <div
                key={side}
                style={{
                  ...P3D,
                  position: 'absolute',
                  left: CONTENT_WIDTH / 2 + side * 300 - 110,
                  top: PRICE_H / 2 - 40,
                  transform: `translateZ(${-30 + (1 - stackGrow) * -200}px)`,
                  opacity: Math.min(1, stackGrow * 2),
                }}
              >
                <CashStack width={220} height={8 + 66 * stackGrow} view={{rx: 60, rz: side * -22}} />
              </div>
            ))}
          </Decor>
          <div
            style={{
              position: 'relative',
              height: PRICE_H,
              minWidth: 380,
              padding: '0 64px',
              borderRadius: 30,
              background: 'linear-gradient(165deg, #FFFFFF 0%, #FFFFFF 55%, #FAFAFB 100%)',
              border: `2px solid ${COLORS.accentLine}`,
              // A short shadow: a tall one would run past the safe-zone edge and be cut off flat.
              boxShadow: `0 5px 0 -1px #D7E3F7, 0 14px 24px rgba(10,10,10,.08), 0 26px 40px -18px rgba(10,10,10,.18), 0 0 0 8px rgba(61,134,240,${0.07 * pIn})`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
              opacity: Math.min(1, pIn * 1.8),
              transform: `translate3d(0, ${(1 - pIn) * -40}px, ${60 + (1 - pIn) * 720}px) rotateX(${(1 - pIn) * -26}deg)`,
            }}
          >
            <div style={{display: 'flex', alignItems: 'flex-start', color: COLORS.ink, fontWeight: 800, letterSpacing: TRACK.num, lineHeight: 1}}>
              {dollar ? <span style={{fontSize: 60, marginTop: 9, marginRight: 4, color: COLORS.accent}}>$</span> : null}
              <span style={{fontSize: 104, fontVariantNumeric: 'tabular-nums'}}>{priceDigits}</span>
            </div>
            {/* one light sweep as it lands */}
            <div
              style={{
                position: 'absolute',
                top: -20,
                bottom: -20,
                width: 120,
                left: interpolate(pShine, [0, 1], [-160, 560]),
                background: 'linear-gradient(90deg, rgba(255,255,255,0), rgba(61,134,240,.10), rgba(255,255,255,0))',
                transform: 'skewX(-18deg)',
                opacity: pShine > 0 && pShine < 1 ? 1 : 0,
              }}
            />
          </div>
        </div>

        {footer ? (
          <>
            <div style={{height: GAP_FOOTER}} />
            <div
              style={{
                maxWidth: CONTENT_WIDTH - 40,
                height: footerLines * FOOTER_LINE,
                fontSize: FOOTER_SIZE,
                fontWeight: 500,
                color: COLORS.gray,
                letterSpacing: TRACK.body,
                lineHeight: `${FOOTER_LINE}px`,
                textAlign: 'center',
                textWrap: 'balance',
                opacity: footIn,
                transform: `translateY(${(1 - footIn) * 14}px)`,
              }}
            >
              {footer}
            </div>
          </>
        ) : null}
        <div style={{height: BOTTOM_AIR}} />
      </Stage3D>
    </BrandFrame>
  );
};
