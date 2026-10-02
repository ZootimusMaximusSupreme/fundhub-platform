import React from 'react';
import {BrandFrame, COLORS, Eyebrow, GradientDash, Tag, TRACK, enter, fadeRight, fadeUp, useTimeline} from '../brand';

export type FileItem = {label: string; tag?: string};

export type FileItemsProps = {
  eyebrow: string;
  docTitle: string;
  docSubtitle: string;
  /** One to four items, in the words of the script line. */
  items: FileItem[];
  /** Chip under every item unless the item sets its own. */
  tag: string;
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

export const FileItems: React.FC<FileItemsProps> = ({eyebrow, docTitle, docSubtitle, items, tag, durationInFrames, showSafeZones}) => {
  const {f, fps} = useTimeline(FILE_ITEMS_BASE, durationInFrames);
  const shown = items.slice(0, 4);
  const card = enter(f, fps, 4, 16);

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
        </div>
        {shown.map((item, i) => {
          const row = enter(f, fps, 14 + i * 9, 14);
          const chip = enter(f, fps, 20 + i * 9, 12);
          return (
            <div
              key={item.label}
              style={{
                ...fadeRight(row, 34),
                padding: '26px 0',
                borderBottom: i < shown.length - 1 ? `2px solid ${COLORS.soft}` : 'none',
              }}
            >
              <div style={{display: 'flex', alignItems: 'center', gap: 22}}>
                <GradientDash size="bullet" />
                <span style={{fontSize: 42, fontWeight: 600, letterSpacing: TRACK.body, lineHeight: 1.18, color: COLORS.ink}}>
                  {item.label}
                </span>
              </div>
              <div
                style={{
                  marginTop: 14,
                  marginLeft: 50,
                  opacity: chip,
                  transform: `scale(${0.94 + chip * 0.06})`,
                  transformOrigin: 'left center',
                }}
              >
                <Tag text={item.tag ?? tag} tone="bad" size={22} />
              </div>
            </div>
          );
        })}
      </div>
    </BrandFrame>
  );
};
