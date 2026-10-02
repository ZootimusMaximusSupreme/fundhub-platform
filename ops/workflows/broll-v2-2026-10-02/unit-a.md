# Unit A — depth kit + 3D/money upgrade of the 8 templates

**Status: DONE (2026-10-02).** Kit, 8 upgraded templates, previews, marked contact sheet, 22 clips re-rendered, checks passed. Commits: `0c90530f` (kit), `75962b7f` (six templates + kit additions), and the final commit named at the bottom.

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
| `MoneyGutters` | Two MoneyFields down the left and right edges of the frame, so money peeks out from behind cards and stays out from behind words. Inside `BackdropStage`. *(added after the first kit commit)* | same as MoneyField, plus `gutter` (width, default 250) |
| `FlyingBill` | One bill that flies off from where it is placed (money leaving): pops in, travels by `dx`/`dy` while it tumbles toward the camera, fades out. *(added after the first kit commit)* | `progress` (0–1), `dx`, `dy`, `width`, `tone`, `turn` |

**Kit changes after the first commit (all additive):** `Card3D` now carries its own perspective, so a 3D piece placed on a card (a cash stack, a coin) keeps its depth while the card fades in. `MoneyField` gained `spread` (a pour or flow can start across a width), `arc` (how far a flowing piece may bow off its line; small keeps it on the line), and flowing pieces shrink as they arrive. `recede` now starts at `start` and stays faintly visible until `end`.

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

## Template upgrades — done

Same props as round 1 (every shot list still works), same colors, wordmark, grid, gradient dash and Inter. Every template sits on the shared 3D stage with the slow camera drift.

| Template | 3D | Money |
|---|---|---|
| `QualifyToday` | Amounts on a floating card; amounts roll up like an odometer | A 3D cash stack beside each amount grows as it counts; the gap stacks on top of the second one in blue. Bills rise in the side gutters behind the card. With words instead of numbers, the "after" stack is just the taller one. |
| `FileItems` | The report floats on a stack of pages, flies in from depth | Red chips ("costs you money"): a bill flies off each chip and out of the report, plus a faint fall in the gutters. Green chips ("fix"): a gold coin flips in beside each chip, bills rise in the gutters. No chips: bills hang in the gutters. |
| `HiddenDataPoints` | The dots are glossy spheres on a tilted orbit around the count; back dots pass behind the number | Bills drift in the gutters behind the ring ends. Dots are never labeled. |
| `InquiriesOff` | Floating card, glossy timeline nodes | Once the inquiries are struck off, bills ride the blue line down into "Next funding round" and shrink into the node. |
| `LenderList` | Each lender row is its own floating slab arriving from depth | A gold coin flips in at the end of each row; faint bills in the gutters. Names stay blank unless a shot list gives real ones. |
| `StepPath` | Thick numbered discs flip from gray to blue as the line reaches them; the list leans back a little | Bills rise up the side gutters as the path completes. |
| `RatesRising` | The chart is on a floating panel; the line is a thick ribbon with a glossy tip | A cash stack in the chart shrinks as the line climbs (money gets harder to get). No rate values or dates. |
| `SoftPull` | The gauge is a thick 3D dial band leaning back, glossy marker, shadow under it | Only faint, still bills in the gutters: the point of this clip is that nothing moves. |

**Truth:** no bill or coin carries a number or a face. Every dollar figure on screen is still a prop (script line, page, or the /roadmap sample client defaults). `DollarCounter` only counts up to the value passed in.

**No new packages.** Everything is CSS 3D transforms and SVG. `@remotion/three` was not needed and was not added; `marketing/broll/package.json` and the root `package.json` are unchanged.

**Kit bug fixed (from Unit B):** `DollarCounter` showed a leading "0" as a count neared the next power of ten ("$0,999,985" on the way to $1,000,000). A place-value column now opens only when the count reaches it. Checked with a scratch render: "$999,92…" then "$1,000,000". `QualifyToday` also drops to a smaller size for 7-digit amounts so they clear the cash stack (no current shot list has one).

### Files

- Kit: `marketing/broll/src/brand/depth.tsx`, `marketing/broll/src/brand/money.tsx` (exported from `src/brand/index.ts`)
- Templates: `marketing/broll/src/templates/{QualifyToday,FileItems,HiddenDataPoints,InquiriesOff,LenderList,StepPath,RatesRising,SoftPull}.tsx`; descriptions in `registry.tsx`
- Reference sheet: `marketing/broll/src/DepthKitDemo.tsx` → `previews/depth-kit.png`
- Previews: `marketing/broll/previews/{qualify-today,file-items,hidden-data-points,inquiries-off,lender-list,step-path,rates-rising,soft-pull}.png`
- Marked contact sheet: `marketing/broll/previews/contact-sheet-marked.png` (red numbers, legend, red safe-zone lines on every frame)
- Clips: `marketing/broll/out/ad-21/` … `out/ad-26/`, the same 22 file names as the shot list (not in git)

### Checks

- **Text safe zones:** for all 22 clips and the 8 defaults, the hero frame was rendered with money switched off (`--props` with `"checkTextOnly": true`). The top 14% and bottom 35% hold only the plain grid: the only non-paper pixels were the grid's own line crossings (gray 231). So **0** word, number or card pixels sit in either zone. Words are also clipped to y 269–1248 by `BrandFrame` itself.
- **Money in the zones:** measured at 3 frames per clip (start, middle, hero). The strongest money pixel in either zone is **0.22** of full strength (most clips 0.10–0.13; the zones fade money to a third). Money never draws on top of words: backdrop money paints behind all content, and in-card money (flying bills, coins, flow) was placed and checked so it never crosses a line of text.
- **Looked at:** every preview, all 22 clip stills with their own words, motion strips of every template, and one frame from each template's MP4. Fixed after looking: a coin covering the last letter of "EXACT FIX", a flowing bill grazing "Next funding round", a gray box behind the step discs, a bill behind the eyebrow, the orbit dots crossing the number, a word wrap in "One company", and the legend running off the contact sheet.
- **MP4s:** all 22 probed: H.264, 1080x1920, 30 fps, yuv420p with bt709 tags, exact frame counts (75 or 90). Total 9,848,451 bytes (9.8 MB). One `npx remotion render` command per clip; no render script saved.
- **Type and lint:** root `npm run lint` ("2314 file(s) and inline script(s) parse clean"), root `npx tsc --noEmit` exit 0, `cd marketing/broll && npx tsc --noEmit` exit 0.

## 3D slice check (coordinator note, 2026-10-02)

Other units saw Remotion's default renderer drop slices of turned 3D cards on this Mac. Checked all 22 clips, every frame:

- **How:** each clip was also rendered with `--gl=angle` into scratch (not delivered), and every frame of the delivered MP4 was compared with the angle copy. A plain comparison flags edge-smoothing noise, so the final pass allows each pixel to match within 2 pixels (renderers place 3D cards up to about 3 px apart) and then looks for any area that still differs. The worst frame of every clip was also looked at side by side.
- **Result: no dropped slices or blank strips with the default renderer in any of the 22 clips.** 20 clips match at every frame; the other 2 (Ad 23 clip 1, Ad 25 clip 3) differ only where a card sits about 3 px apart, with the same content.
- **One real defect found, in both renderers, fixed in the geometry:** in `FileItems`, the report crossed through the blank pages behind it while flying in, so a slanted band of the card (for example "Two paths") looked washed out for a few frames. The pages now fly in locked to the report and always stay behind it. The five FileItems clips (ad21-02, ad23-01, ad24-02, ad25-02, ad25-03), the FileItems preview and the contact sheet were re-rendered after the fix; their entrance frames were checked one by one.
- **`--gl=angle` was not needed and was not used.** `remotion.config.ts` is unchanged.

## Leftovers

- `marketing/broll/shot-lists/2026-10-02.md` still says the 22 clips total 3.9 MB; after the 3D upgrade they total 9.8 MB. Not edited (not my file to change).

## Final commit

`74197098` — rates, step path and soft pull upgraded; DollarCounter leading-zero fix; previews, marked contact sheet, this status file.
