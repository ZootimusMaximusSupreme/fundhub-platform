import React from 'react';
import {
  BackdropStage,
  BrandFrame,
  CARD_EDGE,
  COLORS,
  Card3D,
  Eyebrow,
  GradientDash,
  Coin,
  Decor,
  FlyingBill,
  MoneyGutters,
  P3D,
  Stage3D,
  Tag,
  TRACK,
  cardShadow,
  enter,
  fadeRight,
  useTimeline,
} from '../brand';

export type FileItem = {label: string; tag?: string};

export type FileItemsProps = {
  eyebrow: string;
  docTitle: string;
  /** Small label at the right of the card title. An empty string hides it. */
  docSubtitle: string;
  /** One to five items, in the words of the script line. */
  items: FileItem[];
  /** Chip on every item unless the item sets its own. Null shows no chips. */
  tag: string | null;
  /** Chip color: red "bad" (default) for problems, green "ok" for fixes. */
  tagTone?: 'bad' | 'ok';
  /** "stacked" puts the chip under the item (default); "inline" puts it at the end of the row, for 4 or 5 short items. */
  layout?: 'stacked' | 'inline';
  durationInFrames?: number;
  showSafeZones?: boolean;
};

export const FILE_ITEMS_BASE = 75;
export const FILE_ITEMS_HERO = 72;

// Item words come from the locked ads: Ad 2 "The cards sitting too high ...
// The harmful items", Ad 6 "Personal data that doesn't match across the three
// bureaus". Chip words come from /roadmap step 02: "every item costing you money
// on all three bureaus". Card title is the deliverable's name on /roadmap.
export const fileItemsDefaults: FileItemsProps = {
  eyebrow: 'Everything holding you back',
  docTitle: 'Credit Analysis Report',
  docSubtitle: 'All three bureaus',
  items: [{label: 'Cards sitting too high'}, {label: 'Harmful items'}, {label: "Personal data that doesn't match"}],
  tag: 'Costing you money',
};

/**
 * A blank page under the report, so the report reads as a stack of paper. It
 * flies in locked to the report (same motion and tilt as Card3D's "depth"
 * entrance, always further back), so the two planes never cross mid-flight.
 */
const Sheet: React.FC<{z: number; x: number; y: number; rz: number; progress: number}> = ({z, x, y, rz, progress}) => {
  const q = 1 - progress;
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: '#FFFFFF',
        ...CARD_EDGE,
        borderRadius: 30,
        boxShadow: cardShadow(0.7),
        opacity: progress,
        transform: `translate3d(${x}px, ${y + q * 36}px, ${z - q * 420}px) rotateX(${CARD_TILT.rx + q * 16}deg) rotateY(${CARD_TILT.ry}deg) rotateZ(${rz}deg)`,
      }}
    />
  );
};

const CARD_TILT = {rx: 3, ry: -4, rz: -0.4};

export const FileItems: React.FC<FileItemsProps> = ({
  eyebrow,
  docTitle,
  docSubtitle,
  items,
  tag,
  tagTone = 'bad',
  layout = 'stacked',
  durationInFrames,
  showSafeZones,
}) => {
  const {f, fps} = useTimeline(FILE_ITEMS_BASE, durationInFrames);
  const L = FILE_ITEMS_BASE;
  const shown = items.slice(0, 5);
  const step = shown.length > 3 ? 7 : 9; // rows arrive one after another
  const card = enter(f, fps, 4, 16);
  const inline = layout === 'inline';
  const anyChip = tag !== null || shown.some((i) => i.tag);

  // Money: on a red "costs you money" chip, a bill flies off the chip and out
  // of the report. On a green "fix" chip, a gold coin flips onto the chip.
  // With no chips, bills hang in the side gutters behind the report.
  const bad = tagTone === 'bad';
  const money = !anyChip ? (
    <MoneyGutters f={f} mode="drift" count={8} seed="file-items-drift" size={[160, 240]} depth={[-700, -150]} opacity={0.55} blur={2.5} />
  ) : bad ? (
    <MoneyGutters f={f} mode="fall" count={8} seed="file-items-fall" size={[160, 240]} depth={[-700, -150]} opacity={0.45} blur={2.5} />
  ) : (
    <MoneyGutters f={f} mode="rise" count={10} seed="file-items-rise" size={[160, 240]} depth={[-700, -150]} opacity={0.55} blur={2.5} />
  );

  return (
    <BrandFrame
      showSafeZones={showSafeZones}
      backdrop={
        <BackdropStage f={f} length={L}>
          {money}
        </BackdropStage>
      }
    >
      <Stage3D f={f} length={L}>
        <Eyebrow text={eyebrow} progress={enter(f, fps, 0, 14)} />
        <div style={{height: 48}} />
        <div style={{position: 'relative', width: '100%', ...P3D}}>
          <Sheet z={-70} x={-12} y={30} rz={-1.8} progress={card} />
          <Sheet z={-36} x={14} y={16} rz={1.6} progress={card} />
          <Card3D enter={card} z={24} tilt={CARD_TILT} padding="34px 44px 18px">
            <div
              style={{
                display: 'flex',
                alignItems: 'baseline',
                justifyContent: 'space-between',
                gap: 24,
                paddingBottom: 24,
                borderBottom: `2px solid ${COLORS.line}`,
              }}
            >
              <span style={{fontSize: 40, fontWeight: 700, letterSpacing: TRACK.h2, color: COLORS.ink}}>{docTitle}</span>
              {docSubtitle ? (
                <span
                  style={{
                    fontSize: 24,
                    fontWeight: 600,
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    color: COLORS.gray2,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {docSubtitle}
                </span>
              ) : null}
            </div>
            {shown.map((item, i) => {
              const row = enter(f, fps, 14 + i * step, 14);
              const chip = enter(f, fps, 20 + i * step, 12);
              const chipText = item.tag ?? tag;
              const coin = enter(f, fps, 23 + i * step, 12);
              const fly = (f - (24 + i * step)) / 42; // a calm flight, 42 frames
              const chipEl = chipText ? (
                <div
                  style={{
                    position: 'relative',
                    width: 'fit-content',
                    flex: '0 0 auto',
                    marginTop: inline ? 0 : 14,
                    marginLeft: inline ? 0 : 50,
                    opacity: chip,
                    transform: `scale(${0.94 + chip * 0.06})`,
                    transformOrigin: inline ? 'right center' : 'left center',
                  }}
                >
                  <Tag
                    text={chipText}
                    tone={tagTone}
                    size={22}
                    style={{boxShadow: `0 3px 0 -1px ${bad ? '#EBC6C3' : '#CFE3D4'}, 0 8px 16px rgba(10,10,10,.06)`}}
                  />
                  {bad ? (
                    <Decor>
                      <FlyingBill progress={fly} dx={inline ? 230 : 330} dy={inline ? 10 : 26} width={124} style={{left: 'calc(100% + 10px)', top: -6}} />
                    </Decor>
                  ) : (
                    <Decor>
                      <div style={{position: 'absolute', right: -52, top: '50%', marginTop: -20, opacity: coin, transform: `scale(${0.6 + 0.4 * coin})`}}>
                        <Coin size={40} spin={(1 - coin) * 180} tilt={{rx: 8}} />
                      </div>
                    </Decor>
                  )}
                </div>
              ) : null;
              return (
                <div
                  key={item.label}
                  style={{
                    ...fadeRight(row, 34),
                    padding: inline ? '22px 0' : '26px 0',
                    borderBottom: i < shown.length - 1 ? `2px solid ${COLORS.soft}` : 'none',
                  }}
                >
                  <div style={{display: 'flex', alignItems: 'center', gap: 22}}>
                    <GradientDash size="bullet" />
                    <span
                      style={{
                        flex: inline ? 1 : undefined,
                        fontSize: 42,
                        fontWeight: 600,
                        letterSpacing: TRACK.body,
                        lineHeight: 1.18,
                        textWrap: 'balance',
                        color: COLORS.ink,
                      }}
                    >
                      {item.label}
                    </span>
                    {inline ? chipEl : null}
                  </div>
                  {inline ? null : chipEl}
                </div>
              );
            })}
          </Card3D>
        </div>
      </Stage3D>
    </BrandFrame>
  );
};
