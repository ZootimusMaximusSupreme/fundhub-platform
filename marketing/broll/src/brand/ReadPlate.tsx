import React from 'react';
import {useSeeThrough} from './Grid';

/**
 * Words that float over film (see-through clips) sit on a small white plate so thin gray or
 * blue text stays readable over trees and faces. Page-on (not see-through) it draws nothing:
 * the children render exactly as before, pixel for pixel.
 */
export const ReadPlate: React.FC<{gap?: number; children: React.ReactNode}> = ({gap = 0, children}) => {
  const seeThrough = useSeeThrough();
  if (!seeThrough) return <>{children}</>;
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap,
        padding: '14px 28px',
        borderRadius: 22,
        background: '#FFFFFF',
        border: '2px solid #ECECEF',
        boxShadow: '0 5px 0 -2px #DCDCE1, 0 8px 18px rgba(10,10,10,.14)',
      }}
    >
      {children}
    </div>
  );
};
