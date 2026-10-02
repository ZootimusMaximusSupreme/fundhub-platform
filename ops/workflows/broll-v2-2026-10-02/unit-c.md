# Unit C — offer stack ($297) + book-a-call calendar

**Status: done (2026-10-02).** Two new compositions, `OfferStack` and `BookCall`, built on Unit A's depth kit. Committed on `ad-scripts-2026-10-02`, not pushed.

Price is **$297** (the live /roadmap page and the repo). Chris's note said $397; the board's price line stands.

## OfferStack

**What it shows.** "Your Funding Roadmap". The six things on the /roadmap checkout fly in one row at a time from the right and from depth. Each row carries a small real page from the checkout's own "See a sample" preview, lifted off the card at a slight tilt, so the pages on the left read as a loose stack of paper. A blue tick pops on each row as it lands. Then the $297 card comes in from the camera, a light sweep crosses it, two strapped cash stacks rise on its sides and a burst of bills flies up behind it. Faint bills drift behind the whole thing. 3.5 s (105 frames), preview at frame 96.

**Props.**

| Prop | Default | Notes |
|---|---|---|
| `eyebrow` | `Your Funding Roadmap` | The product name on the page ("Get Your Funding Roadmap · $297") |
| `items` | the six below | `{title, sub?, bonus?, visual?}`. `visual` is a path in `public/`, or null for a plain page with only the title. Row heights and the type size fit 1 to 7 items. |
| `price` | `$297` | Shown as given; a leading "$" is drawn small and blue. |
| `footer` | `null` | One small line under the price, e.g. `If you're not happy with what you get, email us and we'll refund you.` (the ads' refund line, no day count). Wraps to two lines if it has to. |
| `durationInFrames` | 105 | 75 to 105 (2.5 to 3.5 s); the animation stretches to fit. |
| `showSafeZones` | — | Review overlay only. |

Items, in the page's own words and order (`marketing/landing-pages/slo/slo-01-sales.html`, checkout order summary): How Much You Qualify For · Credit Analysis Report · Credit Optimization Roadmap · Dispute Letter Pack (all six rounds) · Bank & Lender Match List · FREE BONUS Business Duplication Map (green chip, the page's `.fh-bonus` color #A8D8B0).

**Where each picture came from.** All five are renders of the live page file's own sample previews (the `P` dictionary behind "See a sample" in `slo-01-sales.html`), opened with the page's own script at phone width and shot at 3x by `marketing/broll/scripts/offer-stack-shots.mjs`. Output: `marketing/broll/public/offer-stack/*.png`. Only the top of each document is shot (what the page shows clearly, above its blur); the lightbox frame, the blur, the unlock box and the SAMPLE watermark are left out. Bank logos come from `public/assets/lenders/` (the same files the page loads from fundhub.ai).

| Item | Picture | From the one /roadmap sample client? |
|---|---|---|
| How Much You Qualify For | `public/offer-stack/snapshot.png` | Yes: $199,350 today, $221,500, $22,150 left on the table, middle score 762 (UnderwriteIQ on the simulated file, `ops/workflows/2026-10-02-roadmap-sample-content.md`) |
| Credit Analysis Report | `public/offer-stack/analysis.png` | Yes: scores 758 / 762 / 770, the three cards |
| Credit Optimization Roadmap | `public/offer-stack/roadmap.png` | Yes: 6-month plan, Month 1 steps |
| Dispute Letter Pack | `public/offer-stack/pack.png` | The page's one complete letter is for a charge-off account from a different (vendor sandbox) file, so the shot hides it. The card shows the pack's six-round list (R1 to R6), which carries no file's numbers. |
| Bank & Lender Match List | `public/offer-stack/lenders.png` | Bank names and logos from the lender book; no client numbers |
| Business Duplication Map | none: plain branded page with only the title | The page's sample names "Rivera Supply LLC, Arizona", which is not the sample client (Denton, TX, no business yet). Shooting it would mix two files, so per the brief it is a title-only page. |

**Fits.** The close of Ads 21, 22 and 23 (`marketing/ads/scripts/2026-10-02.md`): "Click below and grab your $297 Funding Roadmap." (with `footer` set, it also carries the last line "If you're not happy with what you get, email us and we'll refund you."). Also the deliverable lines: Ad 21 "Your roadmap finds all 13 and gives you the fix for each one, with every letter written, all six rounds", Ad 22 "Then your Bank and Lender Match List shows you the banks that approve files like yours", Ad 23 "Then the free Business Duplication Map shows you how to repeat it". On the /roadmap VSL or sales page: the checkout section ("Get Your Funding Roadmap · $297" and the six-item order summary).

## BookCall

**What it shows.** "Free call · Google Meet", then the big line "Hop on a call". A desk calendar with two binder rings flips down into place from its top edge. Left half: a generic month grid (30 days, day 1 on a Wednesday, no month name, no year); open weekdays are soft blue, weekends and early days are gray. Day 15 gets tapped (blue fill and a ring). The time slots slide in on the right ("Pick a time"), 2:30 PM gets tapped. Then the "Booked" card comes forward: a green check draws in, a chip reads "Wed 15 · 2:30 PM", and the line under it reads "Soft pull on the call, zero score impact". The calendar behind softens and steps back (depth of field). Faint bills drift behind. 3.0 s (90 frames), preview at frame 86.

**Props.**

| Prop | Default | Notes |
|---|---|---|
| `eyebrow` | `Free call · Google Meet` | /apply calendar: "Free call", "Your funding advisor meets you on Google Meet" |
| `line` | `Hop on a call` | The sorting-hat ads' last line. Null hides it. |
| `pickDay` | 15 | 1 to 30 on the generic month |
| `times` | `9:00 AM`, `11:30 AM`, `2:30 PM`, `4:00 PM` | Generic times only |
| `pickTime` | 2 | Index into `times` |
| `booked` | `Booked` | |
| `detail` | `Soft pull on the call, zero score impact` | /watch book page: "a live Google Meet, and we run a soft credit pull on the call — zero score impact". Null hides it. |
| `durationInFrames` | 90 | 75 to 105 |
| `showSafeZones` | — | Review overlay only |

No person's name anywhere.

**Fits.** The last sentence of Ads 24, 25 and 26: "Wherever you are in the funding process, Fundhub has a solution for that, so hop on a call and we'll figure it out." Also the line before it ("On the call, your advisor runs a soft pull, zero score impact"). 9/30 VSL **P9 Next step** (pick a time, Google Meet, tri-bureau soft pull, zero impact on your score).

## Commands (run from `marketing/broll`)

```bash
# refresh the sample pictures from the page file
node scripts/offer-stack-shots.mjs

# preview stills
npx remotion still src/index.ts OfferStack previews/offer-stack.png --frame=96
npx remotion still src/index.ts BookCall previews/book-call.png --frame=86

# sample MP4s (out/ is gitignored)
npx remotion render src/index.ts OfferStack out/samples/offer-stack.mp4
npx remotion render src/index.ts OfferStack out/samples/offer-stack-footer.mp4 --props='{"footer":"If you'"'"'re not happy with what you get, email us and we'"'"'ll refund you."}'
npx remotion render src/index.ts BookCall out/samples/book-call.mp4

# shorter or longer cut, e.g. 2.5 s
npx remotion render src/index.ts BookCall out/samples/book-call-75.mp4 --props='{"durationInFrames":75}'

# text-only safe-zone check (money switched off, every frame as PNG, then the pixel scan)
npx remotion render src/index.ts OfferStack out/zone/OfferStack --sequence --image-format=png --props='{"checkTextOnly":true}'
npx remotion render src/index.ts BookCall out/zone/BookCall --sequence --image-format=png --props='{"checkTextOnly":true}'
python3 scripts/offer-cta-zone-scan.py out/zone/OfferStack out/zone/BookCall
```

## Checks run

- `npx tsc --noEmit` in `marketing/broll`: exit 0.
- Text-only scan: OfferStack 105 of 105 frames and BookCall 90 of 90 frames match the bare grid exactly in y 0–268 and y 1248–1919 (0 drawn pixels; the reference zones are grid only). The text-only render also drops the cash stacks and bills, so `Decor` works.
- Looked at the two previews and at frames 0, 6, 14, 22, 30, 38, 50, 58, 62, 66, 68, 70, 72, 80, 84, 96, 104 (OfferStack) and 8, 16, 20, 30, 42, 44, 52, 56, 58, 62, 63, 64, 66, 70, 72, 76, 86, 89 (BookCall) from the MP4s. Fixed on the way: tall card shadows ran past y 1248 and were cut off flat (now short shadows, row-by-row check of y 1236–1252 shows no step); the little pages overlapped into a messy strip (now sized to the row, small tilts); the entering row ran off the right edge; the "Booked" card was see-through and oversized while flying in over the calendar (now opaque fast, shorter flight, calendar blurs behind it).
- The footer variant fits on one line under the price.

## Files (Unit C only)

- `marketing/broll/src/templates/OfferStack.tsx` (new)
- `marketing/broll/src/templates/BookCall.tsx` (new)
- `marketing/broll/src/templates/offer-cta.tsx` (new: the two Compositions)
- `marketing/broll/src/templates/offer-cta-timeline.ts` (new: 2.5–3.5 s timing; the kit's own clamp is 2–3 s)
- `marketing/broll/src/Root.tsx` (two lines: the import and `{OFFER_CTA_COMPOSITIONS}`). Not added to the contact-sheet registry, so Unit A's contact sheet is unchanged.
- `marketing/broll/scripts/offer-stack-shots.mjs`, `marketing/broll/scripts/offer-cta-zone-scan.py` (new)
- `marketing/broll/public/offer-stack/{snapshot,analysis,roadmap,pack,lenders}.png` (new)
- `marketing/broll/previews/offer-stack.png`, `marketing/broll/previews/book-call.png` (new)
- Plain CSS 3D only; no `@remotion/three`, no new packages.

## Leftovers

- The live /roadmap "See a sample" set mixes files: the Dispute Letter Pack letter is for a charge-off from the vendor sandbox file and the Business Duplication Map sample is "Rivera Supply LLC, Arizona", while the other samples are the clean 762 Denton, TX file (`.claude/rules/sample-clients-consistent.md`). Not fixed; the B-roll avoids both.
