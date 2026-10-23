# Direct Book Ad 11 (The penthouse) - animation build, round 3 (2026-10-23)

Input `~/Downloads/Direct Book Ad 11 — The penthouse (1).mp4` (53.84 s, 1080x1920, 30 fps, 1615 frames, captions burned in). Output `~/Downloads/Direct Book Ad 11 — The penthouse (1) Animated.mp4` (143 MB, not in the repo, overwritten each round). Animations only; the input is never modified (byte compare). Method: `.cursor/skills/fundhub-video-animation-overlay/SKILL.md`.

## Round 3 changes
- **Cadence.** Every card pops on the exact word. The PathCards template got two optional props (`cardAt`, `pop`; `marketing/broll/src/templates/PathCards.tsx`), so each card starts on its own time instead of the even stagger. Each card is 50% visible on its word and fully in about 0.15 s later.
- **Word times pinned three ways** (`tools/pin.py`, `tools/pin2.py`): whisper on the full file, whisper re-run on a 2.4 s chunk around each word, and the audio energy onset. Where they disagree the energy onset and chunk win (examples: "cut" 19.5 / 19.7 / 19.28 -> 19.6; "put" 22.1 / 22.25 / 21.96 -> 22.1).
- **Longer animations.** Each one rides the whole idea (3 to 9 s). A clip is rendered at most 4.5 s (the template limit); its last frame is held to the end of the idea. The CTA is held to the last frame.
- **In front and behind.** Animations 6 and 8 sit in FRONT of his body (chest band, over the shirt, never over face or captions). Animation 1 sits over the building B-roll (he is not on screen until 8.9 s). The others have the plate above his head with the words box also drawn over hair; none reaches his face.
- **CTA added** (animation 10): his closing ask.

## Animations (width = words box as % of 1080)
| # | Template | In | Out | Spot / mode | Width | Words |
|---|---|---|---|---|---|---|
| 1 | PathCards | 3.70 s | 8.80 s | center, over the building B-roll (in front) | 86% | Your parents won't tell you / Your friends won't / Maybe not even your business partner |
| 2 | PriceTag | 10.50 s | 12.45 s | top, left (plate above his head, words box also in front of hair) | 63% | Penthouse $1,500,000 |
| 3 | PathCards | 12.56 s | 18.85 s | top (plate above his head, words box also in front of hair) | 69% | He was struggling / Get his businesses off the ground / Sitting in a penthouse he owned outright |
| 4 | PathCards | 19.54 s | 24.50 s | top, right (plate above his head, words box also in front of hair) | 69% | Cut out the distractions / Optimized his credit / Put it to work alongside investors and credit partners |
| 5 | PriceTag | 25.25 s | 28.20 s | top, right (plate above his head, words box also in front of hair) | 46% | His income, over $400,000 a month |
| 6 | PathCards | 28.25 s | 31.20 s | chest band, in front of him (in front) | 86% | The one thing he figured out is how to leverage your credit correctly |
| 7 | PathCards | 31.22 s | 37.30 s | top (plate above his head, words box also in front of hair) | 77% | Plenty of people up here run companies and scale businesses / Once you do it most efficiently, use other people's money |
| 8 | PathCards | 37.35 s | 40.20 s | chest band, in front of him (in front) | 86% | Give me a lever long enough and I can move the world |
| 9 | PathCards | 40.25 s | 44.60 s | top (plate above his head, words box also in front of hair) | 77% | Credit is that lever / And building with only your own cash is the slowest way to build wealth |
| 10 | PathCards | 44.69 s | 53.84 s | top (CTA, stays to the end) (plate above his head, words box also in front of hair) | 77% | Click the link below / We'll walk you through how to optimize it and how to get your own funding |

No overlaps (the next animation starts on or after the previous one ends). Animation 1 starts at 3.70 s, inside the first 10 s. No "Fundhub" in this cut, so no logo.

## CTA
"Click the link below" pops on "click" at 44.75 s; "We'll walk you through how to optimize it and how to get your own funding" pops on "we'll" at 47.35 s. It stays on screen from 44.69 s to the last frame (53.84 s). The big line is his own words. It is a PathCards plate (the CTA-style BookCall template prints invented times and "Booked", so it was not used).

## Cadence table (word time vs card entrance)
Card 50% visible, measured on the rendered clip (`tools/measure-entrances.py`) and checked on the final video: no change in the card's pixels 0.15 s before the word, card clearly in by +0.05 s.

| Anim | Card (text) | Word | Word starts (pinned) | Card 50% visible | Diff |
|---|---|---|---|---|---|
| 1 PathCards | Your parents won't tell you | "your" | 3.76 s | 3.76 s | +0.00 s |
| 1 PathCards | Your friends won't | "your" | 4.92 s | 4.92 s | +0.00 s |
| 1 PathCards | Maybe not even your business partner | "maybe" | 6.22 s | 6.22 s | +0.00 s |
| 2 PriceTag | Penthouse $1,500,000 | "one" | 10.70 s | 10.70 s | +0.00 s |
| 3 PathCards | He was struggling | "he" | 12.65 s | 12.66 s | +0.01 s |
| 3 PathCards | Get his businesses off the ground | "to" | 14.50 s | 14.51 s | +0.01 s |
| 3 PathCards | Sitting in a penthouse he owned outright | "sitting" | 16.90 s | 16.91 s | +0.01 s |
| 4 PathCards | Cut out the distractions | "cut" | 19.60 s | 19.60 s | -0.00 s |
| 4 PathCards | Optimized his credit | "optimize" | 20.80 s | 20.80 s | -0.00 s |
| 4 PathCards | Put it to work alongside investors and credit partners | "put" | 22.10 s | 22.10 s | -0.00 s |
| 5 PriceTag | His income, over $400,000 a month | "his" | 25.45 s | 25.47 s | +0.02 s |
| 6 PathCards | The one thing he figured out is how to leverage your credit correctly | "the" | 28.30 s | 28.29 s | -0.01 s |
| 7 PathCards | Plenty of people up here run companies and scale businesses | "I" | 31.30 s | 31.31 s | +0.01 s |
| 7 PathCards | Once you do it most efficiently, use other people's money | "and" | 34.55 s | 34.56 s | +0.01 s |
| 8 PathCards | Give me a lever long enough and I can move the world | "give" | 37.40 s | 37.39 s | -0.01 s |
| 9 PathCards | Credit is that lever | "credit" | 40.30 s | 40.29 s | -0.01 s |
| 9 PathCards | And building with only your own cash is the slowest way to build wealth | "and" | 41.25 s | 41.24 s | -0.01 s |
| 10 PathCards | Click the link below | "click" | 44.75 s | 44.76 s | +0.01 s |
| 10 PathCards | We'll walk you through how to optimize it and how to get your own funding | "we'll" | 47.35 s | 47.36 s | +0.01 s |

Pixel check on the final video (changed-pixel share inside each card's rectangle against the input, at word time -0.15 / -0.05 / 0 / +0.05 / +0.15 / +0.35 s) is in `cadence-check.json`. Zero at -0.15 s for every card; the cards are fully in by +0.15 s.

## Checks
- Duration 53.84 s, 1615 frames, 30 fps, 1080x1920 in both; audio stream copy md5 identical (faa4e7c4d500414567406a2cb097d91a).
- Caption band y 1450-1850 frame by frame: PSNR min 38.9, mean 47.7 (re-encode only). The lowest words box edge is y 1442, the captions start near y 1565.
- Every words box is at least 10 px inside the frame (schedule.json asserts it).
- `marketing/broll`: `npx tsc --noEmit` clean; `node --test src/marketing/catalog.test.mjs src/marketing/broll-see-through.test.mjs` 31 pass, 0 fail.
- `contact-sheet-final.jpg`: a frame per animation with every card in, red boxes, legend, plus two CTA frames.

## Weak spots
- Animation 5 (the $400,000 tag) is 46% wide; his head leans left in that stretch and the free corner is small.
- Where one idea follows another at once (5 to 6, 7 to 8, 9 to 10) the earlier animation ends 0.0 to 0.1 s after its last word, not 0.3 to 0.5 s, so the next one can pop on its word without overlapping.
- A held card is a frozen last frame (the 3D drift of the plates stops).
- Cards show their whole text on entrance, so words in a card can be up to 3 s ahead of his voice (the entrance is on the first word).
- Whisper word starts are good to about 0.1 s; the pins above take the median of three methods.
- Not wired into the pipeline.

## Redo
`python3 -I tools/make-plan.py`; render each `props/*.json` from `marketing/broll` (`npx remotion render src/index.ts <Template> <clip>.mov --props=... --codec=prores --prores-profile=4444 --image-format=png --pixel-format=yuva444p10le`); matte with `tools/matte.swift`; `python3 tools/fit-search.py <id> <top|chest> <scales>`; `python3 -I tools/make-schedule.py`; `python3 -I tools/build-from-schedule.py <clips_dir> <out.mp4> <in.mp4> --behind <masks_dir>`.
