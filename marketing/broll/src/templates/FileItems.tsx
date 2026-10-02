import React from 'react';
import {BrandFrame, COLORS, Eyebrow, GradientDash, Tag, TRACK, enter, fadeRight, fadeUp, useTimeline} from '../brand';

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
  const shown = items.slice(0, 5);
  const step = shown.length > 3 ? 7 : 9; // rows arrive one after another
  const card = enter(f, fps, 4, 16);
  const inline = layout === 'inline';

  return (
    <BrandFrame showSafeZones={showSafeZones}>
      <Eyebrow text={eyebrow} progress={enter(f, fps, 0, 14)} />
      <div style={{height: 48}} />
      <div
        style={{
          ...fadeUp(card, 30),
          width: '100%',
          background: COLORS.white,
          border: `2px solid ${COLORS.line}`,
          borderRadius: 30,
          boxShadow: '0 30px 70px rgba(10,10,10,.08), 0 4px 14px rgba(10,10,10,.04)',
          padding: '34px 44px 18px',
        }}
      >
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
          const chipEl = chipText ? (
            <div
              style={{
                flex: '0 0 auto',
                marginTop: inline ? 0 : 14,
                marginLeft: inline ? 0 : 50,
                opacity: chip,
                transform: `scale(${0.94 + chip * 0.06})`,
                transformOrigin: inline ? 'right center' : 'left center',
              }}
            >
              <Tag text={chipText} tone={tagTone} size={22} />
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
      </div>
    </BrandFrame>
  );
};
