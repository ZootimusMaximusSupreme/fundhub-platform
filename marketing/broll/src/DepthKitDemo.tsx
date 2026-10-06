import React from 'react';
import {AbsoluteFill, useCurrentFrame} from 'remotion';
import {
  BackdropStage,
  BillFan,
  COLORS,
  Card3D,
  CashStack,
  Coin,
  DEPTH,
  DollarBill,
  DollarCounter,
  Eyebrow,
  FONT_FAMILY,
  Grid,
  Layer,
  MoneyField,
  P3D,
  Wordmark,
  cameraAt,
  cameraTransform,
  enter,
  progressBetween,
} from './brand';

// A reference sheet for the depth kit (not an ad clip, so labels sit anywhere).
// Render: npx remotion still src/index.ts DepthKitDemo previews/depth-kit.png --frame=80

export const DEPTH_KIT_DEMO_FRAMES = 90;

const Label: React.FC<{children: React.ReactNode; style?: React.CSSProperties}> = ({children, style}) => (
  <div
    style={{
      position: 'absolute',
      fontSize: 26,
      fontWeight: 600,
      letterSpacing: '0.04em',
      color: COLORS.gray,
      fontFamily: 'ui-monospace, Menlo, monospace',
      ...style,
    }}
  >
    {children}
  </div>
);

export const DepthKitDemo: React.FC = () => {
  const f = useCurrentFrame();
  const fps = 30;
  const L = DEPTH_KIT_DEMO_FRAMES;
  const grow = progressBetween(f, 6, 50);

  return (
    <AbsoluteFill style={{fontFamily: FONT_FAMILY, color: COLORS.ink}}>
      <Grid />
      <BackdropStage f={f} length={L} zoneOpacity={1}>
        <MoneyField f={f} mode="fall" count={9} seed="demo-rain" area={{x: 0, y: 1380, w: 1080, h: 540}} opacity={0.5} blur={2.5} />
      </BackdropStage>
      <div style={{position: 'absolute', left: 70, top: 60, display: 'flex', alignItems: 'center', gap: 28}}>
        <Wordmark width={200} />
        <div style={{fontSize: 40, fontWeight: 700, letterSpacing: '-0.03em'}}>Depth kit · reference sheet</div>
      </div>
      <div style={{position: 'absolute', inset: 0, perspective: DEPTH.perspective}}>
        <div style={{position: 'absolute', inset: 0, ...P3D, transform: cameraTransform(cameraAt(f / L))}}>
          <Label style={{left: 70, top: 180}}>DollarBill (sheen) · BillFan</Label>
          <Layer x={70} y={240} z={30} rx={8} ry={-14} style={{position: 'absolute', left: 0, top: 0}}>
            <div style={{boxShadow: '0 30px 50px rgba(10,10,10,.12)', borderRadius: 10}}>
              <DollarBill width={440} sheen={progressBetween(f, 10, 70)} />
            </div>
          </Layer>
          <Layer x={600} y={250} z={20} rx={10} style={{position: 'absolute', left: 0, top: 0}}>
            <BillFan spread={enter(f, fps, 8, 30)} width={360} />
          </Layer>

          <Label style={{left: 70, top: 560}}>CashStack (height grows) · Coin (spin) · Coin accent</Label>
          <div style={{position: 'absolute', left: 90, top: 700, ...P3D}}>
            <CashStack width={300} height={20 + 120 * grow} />
          </div>
          <div style={{position: 'absolute', left: 540, top: 660, ...P3D}}>
            <Coin size={180} spin={f * 6} tilt={{rx: 10}} />
          </div>
          <div style={{position: 'absolute', left: 800, top: 680, ...P3D}}>
            <Coin size={150} tone="accent" spin={-20 + f * 2} tilt={{rx: 18}} />
          </div>

          <Label style={{left: 70, top: 950}}>Card3D + DollarCounter (value from props: sample client $199,350)</Label>
          <div style={{position: 'absolute', left: 90, top: 1010, width: 900, ...P3D}}>
            <Card3D enter={enter(f, fps, 2, 18)} z={40} tilt={{ry: -6}}>
              <Eyebrow text="How much you qualify for" align="left" />
              <div style={{marginTop: 14}}>
                <DollarCounter value={199350} f={f} start={8} end={40} size={130} />
              </div>
            </Card3D>
          </div>

          <Label style={{left: 70, top: 1340}}>MoneyField: pour (left) · flow to a point (right) · fall (backdrop)</Label>
          <div style={{position: 'absolute', left: 0, top: 0, width: 1080, height: 1920, ...P3D}}>
            <MoneyField f={f} mode="pour" count={12} seed="demo-pour" from={{x: 270, y: 1440}} start={4} end={70} size={[90, 140]} depth={[-80, 60]} opacity={0.95} stage="backdrop" />
            <MoneyField
              f={f}
              mode="flow"
              count={10}
              seed="demo-flow"
              from={{x: 620, y: 1460}}
              to={{x: 930, y: 1760}}
              start={0}
              end={86}
              travel={26}
              size={[80, 110]}
              depth={[0, 60]}
              opacity={0.95}
              stage="backdrop"
            />
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
