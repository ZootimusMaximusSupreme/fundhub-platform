# Unit E — lender matching: LenderSlots and FundingRounds

## DONE (2026-10-02)

Two templates, one idea each.

| Composition id | File | Preview | Sample MP4s (gitignored) |
|---|---|---|---|
| `LenderSlots` | `marketing/broll/src/templates/LenderSlots.tsx` | `marketing/broll/previews/lender-slots.png` (frame 100) | `out/samples/lender-slots.mp4` (3.5 s), `out/samples/lender-slots-ad22.mp4` (3.0 s, Ad 22 words) |
| `FundingRounds` | `marketing/broll/src/templates/FundingRounds.tsx` | `marketing/broll/previews/funding-rounds.png` (frame 106) | `out/samples/funding-rounds.mp4` (4 rounds, 3.67 s), `out/samples/funding-rounds-6.mp4` (6 rounds, 4.0 s) |

All MP4s: 1080x1920, 30 fps, H.264 yuv420p bt709, 0.8 to 1.1 MB each. Folder: `marketing/broll/out/samples/`.

Other files (all mine):
- `marketing/broll/src/templates/lenderMatching.tsx` — registers both compositions (Root.tsx gets one import line and one `<LenderMatchingCompositions />` line).
- `marketing/broll/src/templates/clipTimeline.ts` — these two clips run 2.5 to 4 s (75 to 120 frames). The kit's shared clamp is 2 to 3 s, so they clamp on their own and stretch their timeline to fit.
- `marketing/broll/src/data/lenders.ts` — the baked lender list (generated, do not hand-edit).
- `marketing/broll/scripts/bake-lenders.mjs` — makes that file from the bank book.

## LenderSlots — what it shows

A three-reel slot machine in a floating white housing. Each reel is a real 3D drum of lender names behind a window.

- Frames 0 to 12: the eyebrow draws in and the machine flies forward. The reels sit still with names showing.
- Frames 12 to 68: the reels spin down fast (names blur along the spin), then slow down one at a time. Names get sharp as they slow. Reel 1 locks at frame 50, reel 2 at 59, reel 3 at 68. Each lock lights a blue frame around the payline name and a light sweep crosses it. The names above and below fade back.
- As the last reel locks, a few bills and coins pop out from behind both sides of the machine (faint, behind everything).
- Frames 72 to 105: "30–50 lenders matched" rises under the machine and holds.
- Faint bills drift down both sides the whole time.

Each reel walks the list in its own order, so two reels never show the same name side by side. No lender is ever shown with an amount. Nothing says "approved"; the reels land and the line says "matched".

### Props

| Prop | Default | What it does |
|---|---|---|
| `eyebrow` | `Matching your file` | Spectrum dash + label (9/30 VSL P4: "it matches your file") |
| `count` | `30–50` | The big blue number. Empty string `""` hides it and shows the words alone, in blue. |
| `countLabel` | `lenders matched` | The words after the number |
| `landOn` | `["Chase", "American Express", "Bank of America"]` | One name per reel to land on. A name that is not in the baked list is ignored, and that reel falls back to its default. |
| `durationInFrames` | `105` | 75 to 120 (2.5 to 4 s). The timeline stretches to fit. |
| `showSafeZones` | `false` | Review overlay |

### Lender list: source and size

- **Source:** `docs/legacy-strong/lenders-legacy-strong.csv`, column `name` (306 rows, 287 different names).
- **Size:** 45 names baked into `src/data/lenders.ts` (45 sits inside "thirty to fifty"). Picked for clean names: no notes in brackets, no "0%" tags, no tip rows, one row per bank, short enough for two lines on a reel. Big national names are mixed with regional banks.
- **The script refuses to write** if any name is not an exact `name` cell in the CSV, or if a landing name is not on the /roadmap sample list.
- **Default landing names** are the first three banks on the /roadmap sample client's Bank & Lender Match List (`ops/workflows/2026-10-02-roadmap-sample-content/w2-lenders.json`: Chase, American Express, Bank of America). So the reel never contradicts the sample people can open on the page.

## FundingRounds — what it shows

One idea: a funding sequence that keeps going round after round, with hard inquiries coming off between rounds, and the cash building up.

- A track of rounds runs across the frame: "Round 1", "Round 2" … (always digits; never spelled out).
- Each round, its node lights blue with a check, and one more strapped cash bundle stacks onto a single 3D cash tower.
- Each round, bills pour down over the tower from just under the eyebrow (more every round), and bills and coins drop onto the tower top from behind. The pour is masked to the tower area, so no money ever crosses the eyebrow, the round labels or the caption.
- Between each round and the next, a red "Inquiries" chip pops up over the track, gets struck through and leaves. Only then does the line draw on to the next round ("goes into the next round clean").
- Under the track, one fixed caption: "Hard inquiries" (struck through in red) "removed between rounds".
- Faint bills drift down both sides.

No dollar figure shows by default. Bundles are equal by default, so nothing implies an amount.

### Props

| Prop | Default | What it does |
|---|---|---|
| `eyebrow` | `Funding sequence` | Spectrum dash + label (9/30 VSL P6) |
| `rounds` | `4` | 3 to 6 rounds |
| `roundLabel` | `Round` | Word before each number ("Round 1") |
| `inquiryChip` | `Inquiries` | The chip that comes off between rounds |
| `captionStruck` | `Hard inquiries` | Caption words that get struck through |
| `captionRest` | `removed between rounds` | The rest of the caption |
| `amounts` | `null` | Optional dollar figure per round, **only from a script line, the page, the sample client or a real approval**. Needs one per round. When given, each figure counts up under its round label and the bundles are sized to the figures. |
| `durationInFrames` | by rounds: 3 → 105, 4 → 110, 5 → 115, 6 → 120 | 75 to 120 (2.5 to 4 s). The timeline stretches to fit. |
| `showSafeZones` | `false` | Review overlay |

## Commands (run inside `marketing/broll/`)

```bash
# lender list (re-bake after editing PICK or LAND in the script)
node scripts/bake-lenders.mjs

# preview stills
npx remotion still src/index.ts LenderSlots previews/lender-slots.png --frame=100
npx remotion still src/index.ts FundingRounds previews/funding-rounds.png --frame=106

# sample MP4s
npx remotion render src/index.ts LenderSlots out/samples/lender-slots.mp4
npx remotion render src/index.ts LenderSlots out/samples/lender-slots-ad22.mp4 --props='{"eyebrow":"Bank and Lender Match List","count":"","countLabel":"Lenders matched to your state","durationInFrames":90}'
npx remotion render src/index.ts FundingRounds out/samples/funding-rounds.mp4
npx remotion render src/index.ts FundingRounds out/samples/funding-rounds-6.mp4 --props='{"rounds":6}'

# text-only safe-zone check (decoration dropped), then scan y 0-268 and y 1249-1919
npx remotion still src/index.ts LenderSlots /tmp/ls-60.png --frame=60 --props='{"checkTextOnly":true}'
```

## Where they fit (script lines and VSL parts)

| Clip | Fits | Props to use |
|---|---|---|
| `LenderSlots` | **9/30 /watch VSL P4** — "Then it matches your file against thousands of lenders to find the thirty to fifty that fit you" | defaults |
| `LenderSlots` | **$297 Ad 22, sentence 6** — "Then your Bank and Lender Match List shows you the banks that approve files like yours, so you apply in the right order." | `{"eyebrow":"Bank and Lender Match List","count":"","countLabel":"Lenders matched to your state"}`. The /roadmap page says "Lenders matched to your state" and gives no 30–50 count, so the count is hidden for the $297 ad. Landing names are the page's own sample list. |
| `FundingRounds` | **9/30 /watch VSL P5–P6** — "removing the hard inquiries between each funding round … that's how a funding sequence keeps going for three to six rounds and builds into substantial capital" | defaults, or `{"rounds":6}` on "three to six rounds" |
| `FundingRounds` | **Sorting-hat Ad 26, sentence 3** — "Your last round left hard inquiries, and we remove them." (and line 2, "before your next funding sequence") | `{"rounds":3}` or defaults. The phrase "round two" never appears; rounds are numbered. |

## Checks

- **Text-only safe-zone scan:** 27 stills with decoration dropped (`checkTextOnly`): LenderSlots every 10 frames 0–104, FundingRounds every 10 frames 0–109, FundingRounds 6 rounds with amounts at frames 50 and 119, and the Ad 22 words at frame 100. Every pixel in y 0–268 and y 1249–1919 is plain page background: **0 drawn pixels** in all 27. Words run from y 303 (wordmark) to y 1203 at most. The same scanner finds 10,000+ pixels of faint money in those zones on the normal previews, so it does see drawn pixels; money there is decoration at 32% and never sits on a word.
- **Side margins:** the widest line ("30–50 lenders matched") runs x 115–960; the Ad 22 label runs x 137–938. Both inside 90–990.
- **Looked at:** both previews, a 15-frame strip of LenderSlots (rest, spin, reel-by-reel lock, result), three mid-spin frames, a 14-frame strip of FundingRounds, a 12-frame strip of 6 rounds, the 3-round-with-amounts still, and the 75- and 90-frame versions (both land before the clip ends). Fixed after looking: squashed name slivers at the drum edges (now fade out), the same name showing on two reels side by side, the tower top touching the eyebrow, the pour passing behind the eyebrow and wordmark (now masked), a pour that was barely visible behind the tower (now a front pour masked to the tower area), coins crowding the pour (now bills), a busy 6-round pour (fewer, softer bills), figures crowding the caption (layout makes room), and a too-wide label on the Ad 22 version.
- **Typecheck:** `cd marketing/broll && npx tsc --noEmit` passes.
- **3D:** plain CSS 3D (real drum faces turned with rotateX, CashStack bundles, the kit's camera). No `@remotion/three`, no new packages.

## Leftovers

- None found.
