# Unit H — ProofFlood (a flood of real approvals, vertical + 4K wide)

**Status: done (2026-10-02).**

Chris: "I want a ton of flashy approvals displayed: $74,000, $50,000 (KeyBank), $500,000, $400,000, $100,000. The goal is to create an overwhelming amount of proof." And: "The VSL is horizontal, not vertical. If we create anything for the VSL, it should be horizontal format." ProofWall stays as it is; this is a second, louder proof clip.

| Composition id | Size | Use | Preview | Sample (gitignored) |
|---|---|---|---|---|
| `ProofFlood` | 1080x1920, 30 fps, 6 s | ads | `marketing/broll/previews/proof-flood.png` (frame 172) | `marketing/broll/out/samples/proof-flood.mp4` (5.5 MB) |
| `ProofFloodWide` | 3840x2160 (true 4K), 30 fps, 6 s | the horizontal VSL | `marketing/broll/previews/proof-flood-wide.png` (frame 172, 4K) | `marketing/broll/out/samples/proof-flood-wide.mp4` (21 MB) |

One component, `ProofFlood`, with a `format` prop. The two ids are the same component with `format` set; each lays out for its own frame (the wide one is not a stretched vertical).

## What it shows

- **The flood.** 41 real approval cards fly in out of the depth, turning, and pile up behind, smallest first, climbing to the biggest. Faster as the clip goes on. Each card is the real crop with a footer: green check, the amount, the lender (or the product when the picture names no lender).
- **The headline beats** slam to the front from the camera side, one at a time, with a white flash, a blue shock ring, a short camera shake and bills and coins bursting out from behind the card (always behind it, never across it). A big chip pops under the card: check, amount, lender, product.
  1. **$74,000 Chase** (Ink Business Cash card)
  2. **KeyBank:** the **$50,000** business credit card lands, then the **$50,000** business line of credit, a blue "+" between them, and a sum chip that counts from $50,000 up to **$100,000 — "KeyBank total, 2 approvals."** Two approvals adding up, never one $100,000 approval.
  3. **$400,000** Commercial line of credit
  4. **$500,000** Commercial line of credit (biggest flash, holds to the end)
- After its beat, each headline chip flies up and docks as a trophy chip ($74,000 · $100,000 · $400,000), and its card drops back into the pile, so the earlier wins stay on screen.
- **Running total**, "$X in approvals on screen", climbs as cards land. It adds only the figures on screen: a card's amount joins the moment that card lands. Last frame: **$2,391,400** = the sum of all 46 approvals in the clip.
- Money everywhere it fits: bills and coins falling far behind, bills hanging over the pile, bursts on every slam, a few bills drifting down the side edges.
- Same brand: white page, faint grid, "fundhub." wordmark, eyebrow pill with the spectrum dash ("CLIENT APPROVALS"), Inter, accent blue, green checks from the page's ok tone.

**Vertical layout:** wordmark, eyebrow, trophy row, headline card, chip, total, caption, all between y 269 and 1248. **Wide layout:** wordmark and eyebrow on top, trophies in a left column, headline card center, total and caption in a right panel, the pile across the whole frame, all inside the 5% title-safe margin.

## Readable at a glance (measured)

- **Phone (vertical scaled to 390 px wide):** headline chip text about 32 px ($74,000, $400,000, $500,000), the KeyBank sum about 29 px, each $50,000 chip about 18 px, the total about 22 px, trophy chips about 11 px.
- **Laptop (wide scaled to 1280 px):** headline chip text about 57 px, the $50,000 chips about 32 px, the total about 39 px.
- **How long each one is up** (default 6 s): $74,000 chip fully on about 0.9 s (frames 25–51); each $50,000 chip 1.0–1.2 s, the $100,000 sum about 1.0 s (frames 74–104); $400,000 about 0.9 s (frames 114–140); $500,000 the last 1.0 s; the final total holds the last 1.2 s.

## The approvals (real only): 46 used

Made by `python3 marketing/broll/scripts/proof-flood-approvals.py` into `marketing/broll/public/proof-flood/<id>.jpg` and the generated list `marketing/broll/src/templates/proofFloodApprovals.ts` (each entry says where its figure is read).

- **35 crops from `deck.json`**, copied as they are (already verified, names and account numbers blurred). Amount, lender and product from each entry.
- **10 more from `approvals-manifest.json`**, cut from the screenshot inside Unit D's copies of the win cards (`public/proof-wall/`), so Unit D's blurs carry over (the Citizens chat initials and the Enterprise Bank & Trust business name and card line): BankUnited $16,000, Bank of America $12,000, Umpqua $25,000, PNC $7,500, NIHFCU $5,000, U.S. Bank $10,000, Enterprise Bank & Trust $25,000, SouthState $9,000, Citizens $7,000, FNBO $15,000.
- **The KeyBank line of credit (deck page 37)**, cut from the same picture. Its $50,000 comes from the caption printed on the picture ("$50k Business Line Of Credit Approval") and the deck page / `AMOUNTS.md` ("$50,000 KeyBank business line of credit", half of the page's "$100,000 KeyBank"). The bank's own number on that screen is "$49,764.00 Available Balance."
- The three big lines of credit name no lender, so they are labeled with their product ("Commercial line of credit").
- No name or face added. I looked at every crop; nothing new needed a blur.

**Left out so the total never counts one approval twice:** `d-50k-loc` (same app and same $50,000 "Commercial Line of Credit" as the KeyBank line, so it may be the same account); the win cards that repeat a deck crop (Truist 20k, Highland 25k, KeyBank 50k card, Chase 50k, Chase 74k); the second BankUnited 16k and second Bank of America 12k; chat totals ($70k, FNBO "$45,000 ... in 3 days"); chat lines with no lender (10k, 10k, 15k, 25k); "14k" Chase (may be the $13,800 Chase Freedom); "chase for 45"; the U.S. Bank $5,000 with a soft digit.

**One fact for the total:** the $500,000, $469,800 and $400,000 screenshots come from the same bank app. The deck and the live /watch page list them as three separate wins, and the total follows that. The pictures alone cannot show whether they are three accounts.

## Props

| Prop | Default | What it does |
|---|---|---|
| `format` | `"vertical"` (`ProofFlood`), `"wide"` (`ProofFloodWide`) | Picks the frame size and layout. |
| `approvals` | `"all"` | The flood: ids from `proofFloodApprovals.ts`, in landing order. `"all"` = all 46, smallest first. Headline ids are pulled out of the flood automatically. |
| `headline` | `["t-74k-chase-ink", ["t-50k-keybank", "keybank-50k-loc"], "d-400k-loc", "d-500k-loc"]` | The beats in order. One id = one slam. Two ids = they land together and add up. |
| `showTotal` | `true` | The running total. Off = just the caption. |
| `eyebrow` | `"Client approvals"` | The pill at the top. |
| `caption` | `"Real approvals"` | Under the total (vertical) / in the right panel (wide). |
| `durationInFrames` | 180 | 120 to 180 (4 to 6 s). Shorter squeezes every hold. |
| `showSafeZones` | off | Draws the no-text lines for checking. |

## Commands (run in `marketing/broll`)

**Always add `--gl=angle`.** Without it this Mac's default renderer draws a grey slab across the headline card and puts money in front of the chip (checked on frames 30, 60, 90, 120, 170). With `--gl=angle` every frame is whole.

```
npx remotion still src/index.ts ProofFlood previews/proof-flood.png --frame=172 --gl=angle
npx remotion still src/index.ts ProofFloodWide previews/proof-flood-wide.png --frame=172 --gl=angle
npx remotion render src/index.ts ProofFlood out/samples/proof-flood.mp4 --gl=angle
npx remotion render src/index.ts ProofFloodWide out/samples/proof-flood-wide.mp4 --gl=angle
```

## Checks run

- **Text-only safe zones, every frame, final code:** `python3 scripts/proof-flood-zone-scan.py` on renders with `{"checkTextOnly":true}` (money and flashes drop out). Vertical: 180/180 frames have **0** drawn pixels in the top 14% and bottom 35%. Wide at full 4K: 180/180 frames have **0** drawn pixels in the outer 5% title-safe margin.
- **MP4s:** both H.264, yuv420p, bt709, 30 fps, 180 frames; vertical 1080x1920, wide 3840x2160 (rendered at 4K, not upscaled).
- **Looked at:** contact sheets of every 8th and every 12th frame of both MP4s, full-size frames at the slams and hand-offs (6, 24, 27, 48, 58, 100, 136, 140, 172/173), the phone-size and laptop-size crops above. Fixed after looking: front coins drawn too big and over the wordmark; bursts flying up through the wordmark and in front of the card; card footers peeking out under the big chip; cards in the pile covering the wordmark; exited cards sitting right behind the headline chip; the wide counter panel and edge cards crossing the title-safe line; a card shadow cut off at the vertical band's bottom edge.
- **3D slices:** with `--gl=angle`, no dropped or see-through slices in any frame looked at.
- **Type and lint:** `marketing/broll` `npx tsc --noEmit` passes; root `npm run lint` ("2314 file(s) ... parse clean"); root `npx tsc --noEmit` exit 0.

## Where it fits

- **9/30 /watch thank-you video** (`marketing/ads/reference/vsl-scripts-latest.md`, line 48): "...You can see some of the approvals our clients have gotten right here on this page." → `ProofFloodWide`.
- **9/30 /watch VSL** (line 34): "We've worked hundreds of files and have thousands of data points on what lenders approve." → `ProofFloodWide`.
- Any ad proof beat → `ProofFlood`.

## Manifest (files)

- New: `marketing/broll/src/templates/ProofFlood.tsx` (exports `ProofFlood`, `ProofFloodCompositions`, `proofFloodDefaults`, `PROOF_FLOOD_BASE`, `PROOF_FLOOD_HERO`, `clampProofFlood`, types)
- New (generated): `marketing/broll/src/templates/proofFloodApprovals.ts` (`FLOOD_APPROVALS`, `FLOOD_TOTAL`, `FloodApproval`)
- New: `marketing/broll/scripts/proof-flood-approvals.py`, `marketing/broll/scripts/proof-flood-zone-scan.py`
- New: `marketing/broll/public/proof-flood/` (46 JPGs, 4.0 MB)
- New: `marketing/broll/previews/proof-flood.png`, `marketing/broll/previews/proof-flood-wide.png`
- Edited: `marketing/broll/src/Root.tsx` (one import, one `<ProofFloodCompositions />` line; only those two lines committed)
- Not touched: `src/brand/*`, `remotion.config.ts`, ProofWall, the registry, other units' templates. No new package.

## Leftovers

- The money bills are the kit's pale green/blue style, so the money reads as rich texture rather than loud cash. A louder bill look would be a kit change (Unit A's `money.tsx`), not done here.
- `--gl=angle` is still per command. Setting it once in `remotion.config.ts` would cover every clip (shared file, not changed).
