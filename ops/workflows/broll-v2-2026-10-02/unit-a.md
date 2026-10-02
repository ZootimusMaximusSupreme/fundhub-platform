# Unit A — depth kit + 3D/money upgrade of the 8 templates

## DEPTH KIT READY (2026-10-02)

Units B–E can build on it now. It is committed on `ad-scripts-2026-10-02`.

**Import paths** (both are re-exported from the brand index, so one import line is enough):

```ts
import {Stage3D, BackdropStage, Card3D, Layer, P3D, MoneyField, CashStack, Coin, DollarBill, DollarCounter, BillFan} from '../brand';
```

- `marketing/broll/src/brand/depth.tsx` — the 3D stage and cards
- `marketing/broll/src/brand/money.tsx` — the money pieces
- `marketing/broll/src/DepthKitDemo.tsx` — a reference sheet with every piece; preview at `marketing/broll/previews/depth-kit.png`
  (`npx remotion still src/index.ts DepthKitDemo previews/depth-kit.png --frame=80`)

**The look in one line:** the faint grid stays flat (it is the wall); everything else floats in front of it on a perspective stage with a slow camera drift, layered soft shadows and a lit card edge. Plain CSS 3D, no WebGL, no new packages.

### Depth pieces (`depth.tsx`)

| Piece | What it does | Key props |
|---|---|---|
| `Stage3D` | Fills BrandFrame's children. Centered column (like BrandFrame) inside one 3D space under the drifting camera. | `f`, `length` (the template's `f` from `useTimeline` and its base length), `drift` (0 = still, 1 = default), `perspective` (2400) |
| `BackdropStage` | Full-frame 3D stage for **decoration only**. Goes in BrandFrame's `backdrop`. Same camera. Fades itself to 32% strength in the top 14% and bottom 35%, so money can pass through those zones faintly and never sits on a word. | `f`, `length`, `opacity`, `zoneOpacity` (0.32) |
| `Card3D` | The white floating card: tilt, lift, layered shadow, lit edge. Flies in from depth (or left/right/below). Contents stay flat and crisp. | `enter` (0–1), `from`, `z` (40), `tilt` `{rx, ry, rz}`, `elevation` (0–2), `radius`, `padding`, `width` |
| `Layer` | A wrapper at a depth. Different `z` = parallax as the camera moves. | `z`, `x`, `y`, `rx`, `ry`, `rz`, `scale` |
| `P3D` | Style to spread on any plain wrapper div between `Stage3D` and a 3D child. Without it the child goes flat. | — |
| `cardShadow(e)`, `CARD_EDGE` | The card shadow and lit border, for your own shapes. | `e` 0–2 |
| `GroundShadow` | Soft oval shadow under a floating object. | `width`, `height`, `strength` |
| `Reflect` | Faint mirror image under an object. Money and shapes only, never words. | `gap`, `strength` |
| `Decor` | Wrap pure decoration in it. A render with `--props '{"checkTextOnly":true}'` drops it, so a pixel scan proves no word sits in the no-text zones. `BackdropStage` already wraps itself. | — |
| `cameraAt(t)`, `cameraTransform` | The shared camera move, if you build your own stage. | `t` 0–1, `drift` |

### Money pieces (`money.tsx`)

No piece carries a number or a face. The "$" seal is the only mark.

| Piece | What it does | Key props |
|---|---|---|
| `DollarBill` | One bill (green, from the page's `.tg.ok` tones; or `accent` blue). | `width`, `tone`, `detail` (`full` / `simple`), `sheen` (0–1 light sweep) |
| `CashStack` | A strapped stack of bills as a real 3D block. Animate `height` to stack cash up. Put a second stack on top with `base`. Heights are a picture, never an amount. | `width`, `height`, `base`, `view` `{rx, rz}`, `tone`, `strap`, `shadow` |
| `Coin` | A coin with real thickness. Animate `spin` to spin or flip. `FlatCoin` is the cheap flat one. | `size`, `thickness`, `spin`, `tilt`, `tone` (`gold` / `accent`) |
| `MoneyField` | Many bills or coins moving through depth. Modes: `fall`, `rise`, `drift`, `pour` (falls out of a point), `burst` (flies up, then falls), `flow` (travels from A to B and vanishes there), `recede` (moves away). Same seed = same picture every render. | `f`, `mode`, `count`, `seed`, `area`, `size`, `depth`, `opacity`, `blur`, `kind` (`bill`/`coin`/`mix`), `from`, `to`, `start`, `end`, `travel`, `stage` (`backdrop` default, or `content` inside Stage3D) |
| `DollarCounter` | Counting dollars: rolling-digit counter that lands exactly on `value`. Columns open as the number grows (no leading zeros). `value` must come from props. | `value`, `f`, `start`, `end`, `from`, `size`, `color`, `weight` |
| `BillFan` | A fan of bills opening like cash in a hand. | `spread` (0–1), `count`, `width`, `angle`, `tone` |
| `DollarMark` | The "$" mark as a path. | `height`, `color`, `weight` |

### Usage

```tsx
const {f, fps} = useTimeline(BASE, durationInFrames);
return (
  <BrandFrame
    showSafeZones={showSafeZones}
    backdrop={
      <BackdropStage f={f} length={BASE}>
        <MoneyField f={f} mode="drift" count={8} seed="my-template" opacity={0.4} blur={2} />
      </BackdropStage>
    }
  >
    <Stage3D f={f} length={BASE}>
      <Eyebrow text={eyebrow} progress={enter(f, fps, 0, 14)} />
      <div style={{height: 40}} />
      <Card3D enter={enter(f, fps, 4, 16)} z={40} tilt={{ry: -6}}>
        <DollarCounter value={props.amount} f={f} start={8} end={36} size={120} />
      </Card3D>
      <div style={{...P3D, position: 'relative', width: 300, height: 140}}>
        <CashStack width={260} height={30 + 90 * progressBetween(f, 10, 40)} />
      </div>
    </Stage3D>
  </BrandFrame>
);
```

**Rules that keep 3D working:** opacity, filter, mask and `overflow: hidden` flatten an element's children, so put fades on leaf elements (a card, a line of text), never on a wrapper whose children use `translateZ`. Words go in BrandFrame children only (clipped to y 269–1248); full-frame money goes in `BackdropStage`. Money inside the content box must not cross the band edges (it would be cut off sharply); put anything that travels far in `BackdropStage`.

## Template upgrades

In progress.

## Leftovers
