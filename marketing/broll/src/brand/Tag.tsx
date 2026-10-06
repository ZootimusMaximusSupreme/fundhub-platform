import React from 'react';
import {TAG, type TagTone} from './tokens';

/** A status chip in the page's .tg style (bad / warn / ok / info). */
export const Tag: React.FC<{text: string; tone: TagTone; size?: number; dot?: boolean; style?: React.CSSProperties}> = ({
  text,
  tone,
  size = 26,
  dot = true,
  style,
}) => {
  const t = TAG[tone];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: size * 0.4,
        fontSize: size,
        fontWeight: 600,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        lineHeight: 1,
        whiteSpace: 'nowrap',
        color: t.fg,
        background: t.bg,
        border: `2px solid ${t.border}`,
        borderRadius: size * 0.42,
        padding: `${size * 0.42}px ${size * 0.62}px`,
        ...style,
      }}
    >
      {dot ? <span style={{width: size * 0.32, height: size * 0.32, borderRadius: '50%', background: t.fg}} /> : null}
      {text}
    </span>
  );
};
