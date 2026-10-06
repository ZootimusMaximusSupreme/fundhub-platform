# Unit I — BankPockets (rates rise, the bank pulls its pockets out)

**Status: DONE (2026-10-02).**

Chris: "When interest rates rise, we should show it like a bank pulling out its pockets, as if they have no money to lend out. That's a big one." And: "The VSL is horizontal, not vertical. If we create anything for the VSL, it should be horizontal format."

## What it is

A new animation, `BankPockets`. A white columned bank with "BANK" on it and a blue "$" seal in the roof. In about three seconds:

1. A small "↑ Rates" chip climbs three steps. The bank flinches a little at each step.
2. The bank's blue doors swing open. Behind them, the vault door hangs open and the shelves are bare.
3. Two cloth pockets pop out of the bank's sides, turned inside out, and swing once.
4. A puff of dust and a moth come out of one pocket. One coin slips out of the other, hops once and rolls away out of the frame.

No rate values, no dates on the chip, no dollar amounts, no faces. Same colors, grid, wordmark, gradient dash and Inter as the rest of the kit. Plain CSS 3D, no new packages.

## Two formats

| Composition id | Size | For | Layout |
|---|---|---|---|
| `BankPockets` | 1080x1920, 30 fps | Ads | Words in the safe band (nothing in the top 14% or bottom 35%), bank in the middle |
| `BankPocketsWide` | 3840x2160 (4K), 30 fps | The horizontal VSL | Words on the left, the bank on the right, everything inside the 5% title-safe margin. Drawn at 4K, not a stretched or upscaled vertical |

`BankPockets` with `"format": "wide"` gives the same 4K frame as `BankPocketsWide`.

**Props:** `eyebrow` (default "Interest rates"), `headline` (default "Rates went up. Banks tightened."), `subline` (optional; default "Money gets harder to get.", `null` hides it), `durationInFrames` (75 to 105, that is 2.5 to 3.5 s; default 96 = 3.2 s), `format` ("vertical" or "wide").

**Always render with `--gl=angle`.** Measured: this Mac's default renderer cut slices out of the pockets on 45 of 96 frames. With `--gl=angle` every frame matches a software render (see Checks).

## Swapped into the ads

The two RatesRising clips in `marketing/broll/shot-lists/2026-10-02.md` are now BankPockets. Same start times, words from each line, 3.5 s each. RatesRising itself is unchanged.

| Ad | Starts | On screen | New file |
|---|---|---|---|
| 22, clip 1 | 0:05 (5.6 s) | The Fed raised interest rates · When rates go up, banks tighten. · Money gets harder to get. | `marketing/broll/out/ad-22/ad22-01-bank-pockets-0m05s.mp4` |
| 26, clip 2 | 0:12 (12.0 s) | First time since 2023 · The Fed raised rates in September · Banks tighten. | `marketing/broll/out/ad-26/ad26-02-bank-pockets-0m12s.mp4` |

The old `ad22-01-rates-rising-0m05s.mp4` and `ad26-02-rates-rising-0m12s.mp4` were deleted (gitignored render output). The 22 shot-list clips now total 10,303,056 bytes (10.3 MB); the shot list says so.

## Files

- Template: `marketing/broll/src/templates/BankPockets.tsx` (registered in `marketing/broll/src/Root.tsx`, two lines)
- Previews: `marketing/broll/previews/bank-pockets.png` (1080x1920, frame 76) and `marketing/broll/previews/bank-pockets-wide.png` (3840x2160, frame 76)
- Samples (gitignored): `marketing/broll/out/samples/bank-pockets.mp4` and `marketing/broll/out/samples/bank-pockets-wide.mp4`
- Shot list: `marketing/broll/shot-lists/2026-10-02.md` (Ad 22 clip 1, Ad 26 clip 2, the template table, the size line, a `--gl=angle` note)

## Commands (inside `marketing/broll/`)

```
npx remotion still src/index.ts BankPockets previews/bank-pockets.png --frame=76 --gl=angle
npx remotion still src/index.ts BankPocketsWide previews/bank-pockets-wide.png --frame=76 --gl=angle
npx remotion render src/index.ts BankPockets out/samples/bank-pockets.mp4 --codec=h264 --gl=angle
npx remotion render src/index.ts BankPocketsWide out/samples/bank-pockets-wide.mp4 --codec=h264 --gl=angle
npx remotion render src/index.ts BankPockets out/ad-22/ad22-01-bank-pockets-0m05s.mp4 --codec=h264 --gl=angle --props=props.json
```

(The Ad 22 and Ad 26 props blocks are in the shot list.)

## Checks

- **MP4s probed:** all four are H.264, yuv420p, bt709 tags, 30 fps. Vertical sample 1080x1920, 96 frames (639 KB). Wide sample **3840x2160**, 96 frames (1.9 MB). Ad 22 and Ad 26 clips 1080x1920, 105 frames each (694 KB, 661 KB).
- **Text safe zones, vertical:** every frame rendered with decoration off (`"checkTextOnly": true`, which drops the coin, moth and dust) for the default props, Ad 22 and Ad 26, then `scripts/offer-cta-zone-scan.py`: 96 + 105 + 105 frames, **0** drawn pixels in the top 14% or the bottom 35%.
- **Title-safe, wide:** every frame of the 4K render with decoration off, scanned for anything that is not bare grid outside the 5% box (x 192–3647, y 108–2051): **0** frames. Everything drawn sits in x 220–3588, y 178–1700.
- **Dropped 3D slices:** the vertical clip was rendered three ways (`--gl=angle`, `--gl=swangle` software, and the default) and compared frame by frame, allowing 2 px of placement and edge-smoothing noise. Angle vs software: **0** of 96 frames differ. Default vs software: 45 of 96 frames have a missing strip (a slice cut out of a pocket, about 8 px wide). So every delivered file uses `--gl=angle`. Wide 4K, angle vs software: **0** of 96 frames differ.
- **Looked at:** motion strips of both formats at every beat, full-size crops of the pockets, vault and coin, the 4K detail (the "BANK" lettering, column fluting and vault wheel are sharp at 4K), and frames decoded back out of all four delivered MP4s. Fixed after looking: the first pockets read as cups, so they became limp cloth bags hanging out of a dark slit; the coin showed through a pocket, so it now starts hidden behind the cloth and drops past the end of the steps; the dust looked like stains on the cloth, so it now billows from behind the pocket; the wide rate chip sat 12 px from the title-safe line, so the bank moved left.
- **Type and lint:** `cd marketing/broll && npx tsc --noEmit` exit 0; root `npm run lint` ("2314 file(s) and inline script(s) parse clean"); root `npx tsc --noEmit` exit 0.

## Leftovers

- `BankPockets` is not in the kit's registry or the contact sheet (same as the other round-2 templates, which register on their own).
