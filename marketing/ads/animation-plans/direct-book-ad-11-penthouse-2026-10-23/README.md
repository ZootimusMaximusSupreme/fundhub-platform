# Direct Book Ad 11 (The penthouse) - animation build, round 4: diagrams (2026-10-23)

Input `~/Downloads/Direct Book Ad 11 — The penthouse (1).mp4` (53.84 s, 1080x1920, 30 fps, 1615 frames, captions burned in). Output `~/Downloads/Direct Book Ad 11 — The penthouse (1) Animated.mp4` (146 MB, not in the repo, overwritten each round). Animations only; the input is never modified. Method: `.cursor/skills/fundhub-video-animation-overlay/SKILL.md`.

## Round 4: Chris rejected the numbered lists ("diagrams, not 1234, on ALL of them")
- Every animation is now a kit diagram from `marketing/broll` with his own words in its props: a joined-row board (ToolMatch), price tags (PriceTag), stamped cards (StampCard) and a link button (new, LinkButton). Zero "01 02 03" discs, zero text-only plates. PathCards and StepPath are gone.
- The 2026-10-22 plan entry for this video (`../2026-10-22.json`, "Direct Book Ad 11 — The penthouse") used PriceTag, StepPath, MoneyClimb, CompanyLine and PathCards. PriceTag is kept (both numbers are his). StepPath and PathCards are the numbered lists Chris rejected, so they were replaced by diagram templates for the same anchors. MoneyClimb and CompanyLine were tried and dropped (too tall for the free space; CompanyLine's headline sits on art and is not readable). The plan's $400,000 anchor says "a year"; he says "a month" in the filmed take, so the tag says "a month".
- JackFix and FlatTireHammer (the car and the tire) were built and looked at. Their captions have no plate in see-through mode and read as black text over the trees, so they were dropped, not shipped.
- New template `LinkButton` (`marketing/broll/src/templates/LinkButton.tsx`, registered in Root.tsx, catalog.json regenerated, test counts 62 -> 63 clips and 35 -> 36 files updated): a blue button with his words, a cursor that presses it, a ring and a down arrow. No numbers, no logo.
- Small optional props added so beats land on his words: `rowAt` on ToolMatch (and earlier `cardAt`, `pop` on PathCards, now unused). Defaults unchanged.

## Animations (width = the whole diagram as % of 1080)
| # | Template | In | Out | Spot | Width | What it shows |
|---|---|---|---|---|---|---|
| 1 | ToolMatch | 3.51 s | 8.80 s | center, over the building B-roll | 86% | Who won't tell you: Your parents / Your friends / Your business partner, each joined to what they do |
| 2 | PriceTag | 11.00 s | 18.85 s | top, left | 46% | Price tag: Penthouse $1,500,000, then the chip "He was struggling" |
| 3 | StampCard | 19.65 s | 24.50 s | top, right | 49% | Credit card "His credit" stamped OPTIMIZED, then "Put it to work alongside investors and credit partners" |
| 4 | PriceTag | 25.25 s | 28.20 s | top, right | 46% | Price tag: His income, over $400,000 a month |
| 5 | StampCard | 28.50 s | 31.30 s | top, left | 44% | Credit card "Your credit" stamped LEVERAGED, with "How to leverage your credit correctly" |
| 6 | StampCard | 34.05 s | 37.30 s | top, right | 57% | Card "Other people's money" under "Run companies and scale businesses", stamped MOST EFFICIENTLY |
| 7 | StampCard | 38.95 s | 41.30 s | top, right | 55% | Card "Credit" under "Give me a lever long enough", stamped THAT LEVER |
| 8 | StampCard | 41.90 s | 44.60 s | top, left | 53% | Card "Only your own cash" stamped SLOWEST (way to build wealth) |
| 9 | LinkButton | 44.60 s | 53.84 s | chest band, in front of him (CTA, stays to the end) | 73% | Button "Click the link below", a cursor presses it, an arrow points down at the link |

No overlaps (each starts on or after the previous ends). Animation 1 starts at 3.51 s, inside the first 10 s (the hook, over the building B-roll; he is on screen from 8.9 s). No "Fundhub" in this cut, so no logo.

## CTA
Animation 9: the button "Click the link below" drops in on "click" (44.8 s), a cursor presses it, an arrow points down at the link. It sits IN FRONT of his body (chest band, under his chin, above the captions) and stays up to the last frame (53.84 s). It is a picture, not a list.

## Payoff against his words (pinned word times, tools/pin.py)
| Anim | Beat on screen | His word | Word starts | Beat lands | Diff |
|---|---|---|---|---|---|
| 1 ToolMatch | row: Your parents - Won't tell you | "your" | 3.76 s | 3.75 s | -0.01 s |
| 1 ToolMatch | row: Your friends - Won't tell you | "your" | 4.92 s | 4.91 s | -0.01 s |
| 1 ToolMatch | row: Your business partner - Maybe not even | "maybe" | 6.22 s | 6.21 s | -0.01 s |
| 2 PriceTag | tag settles: Penthouse $1,500,000 | "million" | 11.30 s | 11.20 s | -0.10 s |
| 2 PriceTag | chip: He was struggling | "he" | 12.65 s | 12.60 s | -0.05 s |
| 3 StampCard | card lands: He moved out of state / His credit | "cut" | 19.60 s | 19.97 s | +0.37 s |
| 3 StampCard | stamp slams: OPTIMIZED | "optimize" | 20.80 s | 20.97 s | +0.17 s |
| 3 StampCard | line: Put it to work alongside investors and credit partners | "put" | 22.10 s | 21.77 s | -0.33 s |
| 4 PriceTag | tag settles: His income, over $400,000 a month | "his" | 25.45 s | 25.47 s | +0.02 s |
| 5 StampCard | card lands: The one thing he figured out / Your credit | "the" | 28.30 s | 28.80 s | +0.50 s |
| 5 StampCard | stamp slams: LEVERAGED | "leverage" | 29.80 s | 29.80 s | +0.00 s |
| 5 StampCard | line: How to leverage your credit correctly | "correctly" | 30.60 s | 30.60 s | +0.00 s |
| 6 StampCard | card lands: Run companies and scale businesses / Other people's money | "and" | 34.50 s | 34.33 s | -0.17 s |
| 6 StampCard | stamp slams: MOST EFFICIENTLY | "most" | 35.35 s | 35.33 s | -0.02 s |
| 7 StampCard | card lands: Give me a lever long enough / Credit | "give" | 37.40 s | 39.23 s | +1.83 s |
| 7 StampCard | stamp slams: THAT LEVER | "credit" | 40.30 s | 40.23 s | -0.07 s |
| 8 StampCard | card lands: Only your own cash | "only" | 42.00 s | 42.20 s | +0.20 s |
| 8 StampCard | stamp slams: SLOWEST way to build wealth | "slowest" | 43.30 s | 43.20 s | -0.10 s |
| 9 LinkButton | button drops in: Click the link below | "click" | 44.75 s | 44.80 s | +0.05 s |
| 9 LinkButton | cursor presses it | "link" | 45.30 s | 46.00 s | +0.70 s |

The payoff beat of each template (tag settled, stamp slammed, row in, button in) was placed on the word it shows, using offsets read off 3-per-second strips of each rendered clip (good to about 0.1 s). Where a template's own order does not match his order the table shows it: animation 3's card lands 0.4 s late and its line 0.3 s early; animation 5's card lands 0.5 s late; animation 7's card lands 1.8 s after "give me a lever" (the stamp THAT LEVER is on "credit is that lever" within 0.1 s); the cursor press on the CTA is 0.7 s after "link".

## Where each one sits and why it is that size
His face fills the middle; the free space is the band above his head (about 390 px tall) and the chest band under his chin (about 260 px). The diagram templates are tall (a stamped card with its chips is 400-700 px tall at full size), so they were scaled to fit that band: 44-57% of the width. The big ones are the hook board (86%, over B-roll, no person on screen) and the CTA button (73%, chest band, in front). Fits are in `tools/fit-search.py` (his head and neck mask below the hairline, 21 px margin).

## Checks
- Duration 53.84 s, 1615 frames, 30 fps, 1080x1920 in both; audio stream copy md5 identical (faa4e7c4d500414567406a2cb097d91a).
- Caption band y 1475-1875 frame by frame: PSNR min 36.5, mean 48.5 (the re-encode plus the button's soft shadow, which ends at about y 1480).
- Every diagram is at least 10 px inside the frame; the lowest edge is y 1454 (CTA), the captions start near y 1565.
- `marketing/broll`: `npx tsc --noEmit` clean; `node --test src/marketing/catalog.test.mjs src/marketing/broll-see-through.test.mjs` 31 pass, 0 fail.
- `contact-sheet-final.jpg`: one frame per animation at its payoff plus two CTA frames, red boxes, legend. Looked at: no numbered lists.

## Weak spots
- Six of nine diagrams are 44-57% wide, not 70-90%: they are tall and the free space around his face is a short band. A close selfie leaves no more room.
- Small chips inside the stamped cards (eyebrows, lines) are about 30 px high on a phone; the stamps, tags and button text are big.
- Animation 7's card ("Credit" under "Give me a lever long enough") lands 1.8 s after he starts the quote; its stamp is on time.
- The held animations (2, 3, 9) are a frozen last frame.
- Not wired into the pipeline.

## Redo
`python3 -I tools/make-plan.py`; render each `props/*.json` from `marketing/broll` (`npx remotion render src/index.ts <Template> <clip>.mov --props=... --codec=prores --prores-profile=4444 --image-format=png --pixel-format=yuva444p10le`; the template name is the part after the number); matte with `tools/matte.swift`; `python3 tools/fit-search.py <id> <top|chest> <scales>`; `python3 -I tools/make-schedule.py`; `python3 -I tools/build-from-schedule.py <clips_dir> <out.mp4> <in.mp4> --behind <masks_dir>`.
