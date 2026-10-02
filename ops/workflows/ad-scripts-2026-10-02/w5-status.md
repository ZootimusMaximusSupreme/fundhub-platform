# W5 status — B-roll kit (Remotion)

**PHASE 1 DONE** (2026-10-02). **PHASE 2 DONE** (2026-10-02): see the last section.

Owns: `marketing/broll/`, this file, and (phase 2) one line in the root `.gitignore`. Nothing else was edited.

## 1. License — what Fundhub has to pay

- **Tier:** Company License, the **"Remotion for Creators"** option. Fundhub has more than 3 people, so the free license does not cover it. The free license covers only individuals, companies of up to 3 people, non-profits, and evaluating before any commercial use.
- **Cost:** the pricing page says **"$25/mo per seat"**. A seat is one person who makes videos with Remotion, by writing code or by using an agent such as Claude Code (that is how the FAQ and terms define it). No per-render fee on this option. No minimum when Creators is bought on its own.
- **For Fundhub today: 1 seat = $25 a month** (Chris, with agents doing the work). I set the live price calculator on remotion.pro to Creators only (checked 2026-10-02). It shows "Total $25/month" for 1 seat, $50 for 2, and $75 for 3.
- **When it would cost more:** if we build code that renders clips by itself (a pipeline that calls Remotion's render functions or runs `npx remotion render` from code), that counts as an automation. Automation is the "Remotion for Automators" option: $0.01 per render, with a $100 a month minimum. The kit has no render script on purpose. Every render is one command typed at the terminal, by Chris or his agent, so it stays on Creators.
- **When to buy:** building and previewing counts as evaluating. The seat is needed once these clips run in paid ads. Nothing was bought.
- **Coming change:** Remotion 5.0 will change the terms. The upcoming terms keep Creators at $25 per seat per month with no minimum. They make usage reporting (telemetry) mandatory for Automators only.
- **Links:**
  - License: https://www.remotion.dev/license (redirects to https://github.com/remotion-dev/remotion/blob/main/LICENSE.md)
  - Pricing and buy page: https://www.remotion.pro/license
  - License FAQ: https://www.remotion.dev/docs/license/faq
  - Terms for v5.0 (upcoming): https://www.remotion.dev/docs/license/terms
  - Current terms (v4.0): https://www.remotion.pro/terms-4-0

## 2. Setup

- `marketing/broll/` is its own Remotion project with its own `package.json`, `package-lock.json` and `node_modules`. Nothing was added to the root `package.json`.
- Packages: remotion 4.0.532, @remotion/cli 4.0.532, @remotion/google-fonts 4.0.532 (Inter), react 19.2.8, react-dom 19.2.8. Dev: typescript 5.9.3, @types/react 19.2.18.
- `marketing/broll/node_modules` (701 MB) is already ignored. The root `.gitignore` line `node_modules` matches folders at any depth. `git check-ignore` confirms it, so no edit was needed.
- **Root checks did not break and needed no edits.** `npm run lint`: "2314 file(s) and inline script(s) parse clean". `npx tsc --noEmit`: exit 0. `tsc --listFilesOnly` shows 0 files from `marketing/broll`. Lint only scans `src scripts api netlify db public extension`, and the root tsconfig only includes `.mjs` files under `src api scripts db`.
- Kit type check: `cd marketing/broll && npx tsc --noEmit`, exit 0.

## 3. Tally — which visual moments repeat most

**What I counted:** 67 distinct scripts.
- 8 locked $297 ads, the locked bullet VSL, and the 7 shorts (`marketing/ads/reference/locked-ads-2026-09.md`).
- The 9/30 /watch VSL and thank-you video (`marketing/ads/reference/vsl-scripts-latest.md`).
- The two 9/20 SLO VSLs.
- In `marketing/ads/slo/fundhub-297/`: the Final Ten H1–H5, S1–S5 and M1–M5; v2 ads 1–10 and the v2 VSL; 9/18 A1–A5, B1–B5 and that VSL; and the two older versions of Ad 4 and Ad 5.
- The 8 live book-a-call controls (`marketing/ads/CONTROLS.md`).

Word-for-word repeats were counted once: v2 S1–S4, older Ads 1–3, 6 and 7, and `FundHub-VSL-Scripts.md`. The "prop ads 9–20" are not in the repo (W1 found the same), so they are not counted. `CONCEPTS.md` holds hooks, not scripts, so it was left out.

**How I counted:** for each moment, a set of word patterns. A script counts once per moment if it says it at least once. The soft-pull close line ("soft inquiry", "no hard inquiry") was taken out before counting inquiries, so the close does not inflate that row.

| Rank | Visual moment | Scripts (of 67) | Times said | In the six new ads (Chris's ask and the Brief) | Built |
|---|---|---|---|---|---|
| 1 | The step-by-step path (the order, month by month) | 55 | 141 | /roadmap step 5 "Apply in the right order", which the $297 ads must match | **Yes: StepPath** |
| 2 | Soft pull, zero impact on your score | 54 | 87 | All 6: the checker fails any script without the soft-pull close | **Yes: SoftPull** |
| 3 | How much you qualify for today vs once fixed | 49 | 148 | The /roadmap promise and the 9/30 VSL call outcome | **Yes: QualifyToday** |
| 4 | $297 price, vs a five-figure course | 46 | 99 | The 3 $297 ads end on it | No: a price tag, not a visual moment |
| 5 | Items on the credit report holding the file back | 36 | 111 | 9/30 VSL "small details in your file" | **Yes: FileItems** |
| 6 | The lender list (banks that approve, in order) | 36 | 63 | /roadmap step 5 and the 9/30 VSL lender match | **Yes: LenderList** |
| 7 | Proof (ten years, hundreds of files, data points) | 33 | 85 | Proof line on the $297 ads | No: next in line |
| 8 | Dispute letters, six rounds | 32 | 74 | A deliverable line | No |
| 9 | All three bureaus | 27 | 28 | — | No |
| 10 | Inquiries stacking up, or coming off between rounds | 14 (3 name the removal) | 27 | All 3 call ads must match the 9/30 VSL, whose key step is removing inquiries between rounds | **Yes: InquiriesOff** |
| 11 | Personal and business, company after company | 13 | 27 | One $297 ad (company after company) | No |
| 12 | Approvals | 7 | 13 | — | No: lowest of Chris's candidates. It needs a real approval screenshot per clip, which is the proof-card pipeline's job |
| 13 | Three paths (ready, needs work, do it yourself) | 2 | 4 | All 3 call ads end on "Fundhub has a solution for that" | No |
| 14 | The 13 hidden data points | 1 (plus the /roadmap page, 2 times) | 1 | All 3 $297 ads: Chris's hook direction | **Yes: HiddenDataPoints** |
| 15 | Interest rates going up | 0 | 0 | At least 2: one $297 ad and at least one call ad must use it | **Yes: RatesRising** |

**Why these 8:** the five moments the old scripts say most that are real visuals (ranks 1, 2, 3, 5, 6), plus the three that carry the six new ads: the 13 data points, rising rates, and inquiries off between rounds. The W2 and W3 drafts so far (not final, read at 11:08) already lean on these three. Left out: the $297 price (a price tag), proof (next in line), and approvals (rank 12, and it needs real screenshots).

## 4. The templates

All are 1080x1920 at 30 fps. Each is 2.5 or 3 seconds, and a shot list can ask for 60 to 90 frames. Every word and number comes from props. The defaults use honest values: script words, the /roadmap page, or the one /roadmap sample client. The sample client is the simulated file run through UnderwriteIQ, from `ops/workflows/2026-10-02-roadmap-sample-content.md`.

| # | Composition id | What it shows | Props (default, and where it comes from) | Length / preview frame |
|---|---|---|---|---|
| 1 | `QualifyToday` | Today's amount counts up. The once-fixed amount climbs from it. A bar and a chip show the gap. | `eyebrow` "How much you qualify for" · `today` {label "Today", value 199350} · `after` {label "Once your file is fixed", value 221500} · `gapLabel` "left on the table" (shows "$22,150 left on the table"). Amounts come from the sample client. An amount can be `text` instead of `value` for lines like "Several hundred thousand". The bar only shows when both are numbers. | 75 / 72 |
| 2 | `FileItems` | A Credit Analysis Report card. The items holding the file back slide in, each with a red chip. | `eyebrow` "Everything holding you back" · `docTitle` "Credit Analysis Report" · `docSubtitle` "All three bureaus" · `items` (1 to 4) "Cards sitting too high", "Harmful items", "Personal data that doesn't match" (locked Ads 2 and 6) · `tag` "Costing you money" (/roadmap step 02) | 75 / 72 |
| 3 | `HiddenDataPoints` | 13 dots light up around a count from 1 to 13. The dots are never labeled, because the repo does not list all 13. | `eyebrow` "Even with perfect credit" · `count` 13 · `label` "hidden data points" · `subline` "An additional $100,000+ in low-interest funding" (/roadmap step 01) | 90 / 86 |
| 4 | `InquiriesOff` | A timeline: this funding round, then "Hard inquiries" struck out with "On your report" turning to "Removed", then the next round lights up. | `eyebrow` "Between each funding round" · `fromLabel` "This funding round" · `itemLabel` "Hard inquiries" · `beforeTag` "On your report" · `afterTag` "Removed" · `toLabel` "Next funding round" · `toNote` "Goes in clean" (all from the 9/30 /watch VSL) | 90 / 86 |
| 5 | `LenderList` | A numbered list of banks, 1 to 5, with a bank icon and blank name bars. No lender is ever made up. | `eyebrow` "Bank & Lender Match List" · `headline` "The banks that approve files like yours" · `footer` "Apply in that order" (/roadmap step 05) · `rows` 5 · `names` [] (real names only when a real source gives them) | 75 / 72 |
| 6 | `StepPath` | Numbered steps light up in order as a blue line runs down them. | `eyebrow` "The order to do it in" (locked Ad 1) · `steps` (2 to 6): the five /roadmap How It Works titles. Step 2 says "fix" in place of "optimize", because the ad rules ban that word. | 90 / 86 |
| 7 | `RatesRising` | A blue line climbs to a "Rates" chip. It is a picture of going up, with no axis, no dates and no rate values. | `eyebrow` "Interest rates" · `headline` "Rates are going up." · `subline` "When rates rise, banks tighten." · `chipLabel` "Rates" (Chris's 10-02 economy angle) | 75 / 72 |
| 8 | `SoftPull` | A score gauge. A light scan sweeps the arc and the score does not move. | `eyebrow` "Soft pull only" · `score` 762 (the sample client's middle score, 762 / 770 / 758) · `scoreLabel` "Credit score" · `headline` "Zero impact on your score." · `chip` "Score doesn't move" (the close on every locked ad and the 9/30 VSL) | 75 / 72 |

Every template also takes `durationInFrames` (60 to 90; the animation stretches to fit) and `showSafeZones` (a red review overlay, never in a delivered clip).

**Shared brand pieces (one place):** `marketing/broll/src/brand/`
- `tokens.ts`: colors, spectrum, dash sizes, grid, safe zones, type, letter spacing.
- `Wordmark.tsx` and `wordmark-paths.ts`: the "fundhub." vector, copied path for path from `public/assets/fundhub-wordmark.svg`. That file is byte-identical to the /roadmap header logo.
- `Grid.tsx`, `GradientDash.tsx`, `Eyebrow.tsx`, `Tag.tsx`.
- `BrandFrame.tsx`: the canvas, the wordmark, and the safe-zone clip.
- `SafeZoneGuide.tsx`, `motion.ts`, `fonts.ts`.

**Brand details, copied from the page CSS, not guessed:**
- **Dash:** the page's `.eyebrow::before` is 16px by 2px with a 1px radius, filled with the page's spectrum: `linear-gradient(90deg,#F2A69B 0%,#F5CE8F 20%,#F2E39B 40%,#A8D8B0 60%,#A9C6E8 80%,#C4B3E5 100%)`. List bullets use 10px by 2px. Both are scaled by 1080/390, a phone-width page in video pixels.
- **Grid:** the page uses `#FCFCFC` with `rgba(10,10,10,.048)` lines every 44px. The kit uses 120px cells (9 across, 16 down) with 2px lines.
- **Rest:** Inter 400 to 800, accent `#3D86F0`, and chip colors from the page's `.tg.bad` and `.tg.ok`.

**Safe zones, proved two ways:**
1. Every word sits in a box clipped to y 269–1248.
2. A pixel scan of all 8 previews found **0** drawn pixels in y 0–268 and y 1249–1919. Content runs from y 303 (the wordmark) to y 1221 at most.

**Motion:** springs that settle without overshoot (damping 200), short fades and slides, and numbers that count up with an ease-out. Each template was rendered to a test video in the scratchpad (not the repo) and checked frame by frame. Fixed before preview:
- a "0" flash on the data-point count
- nodes and track lines showing on frame 0
- two chips overlapping mid-swap
- hard top and bottom edges on the soft-pull scan

## 5. Previews (all marked-up review per CLAUDE.md §8 is on the contact sheet)

- `marketing/broll/previews/qualify-today.png`
- `marketing/broll/previews/file-items.png`
- `marketing/broll/previews/hidden-data-points.png`
- `marketing/broll/previews/inquiries-off.png`
- `marketing/broll/previews/lender-list.png`
- `marketing/broll/previews/step-path.png`
- `marketing/broll/previews/rates-rising.png`
- `marketing/broll/previews/soft-pull.png`
- `marketing/broll/previews/contact-sheet-marked.png`: all 8 side by side, a red number on each, a legend, and thin red lines at the 14% and 65% edges on every frame.

## 6. Commands (run inside `marketing/broll/`)

```bash
npm install                      # first time only
npm run studio                   # live preview in the browser (previews are not renders)
npx tsc --noEmit                 # type check

# a still
npx remotion still src/index.ts QualifyToday previews/qualify-today.png --frame=72

# a still with the line's own words and numbers
npx remotion still src/index.ts QualifyToday out/check.png --frame=72 \
  --props='{"eyebrow":"What your file is worth","today":{"label":"Today","text":"$50,000"},"after":{"label":"Once your file is fixed","text":"Several hundred thousand"},"gapLabel":null}'

# a video (1080x1920, 30 fps, H.264)
npx remotion render src/index.ts QualifyToday out/qualify-today.mp4 --props='{"durationInFrames":75}'

# the marked contact sheet
npx remotion still src/index.ts ContactSheet previews/contact-sheet-marked.png --frame=0

# review overlay on any template
npx remotion still src/index.ts SoftPull out/safe.png --frame=72 --props='{"showSafeZones":true}'
```

Preview frames are 72 for the 75-frame templates and 86 for the 90-frame ones (HiddenDataPoints, InquiriesOff, StepPath). `out/` holds the phase 2 MP4s and is in `.gitignore` (root line `marketing/broll/out/`). Rendering one clip took about 5 seconds on this Mac.

## 7. Root lint and type check

Nothing broke and no config was edited (see section 2).

## PHASE 2 DONE — shot lists and MP4s (2026-10-02)

- **Shot lists:** `marketing/broll/shot-lists/2026-10-02.md`, built from the final scripts only (`marketing/ads/scripts/2026-10-02.md`, commit e467a5fc). The W2 and W3 drafts were not used. For each clip it lists the exact line, the template, the exact props, the start time at 150 words a minute, the length, and the MP4 name.
- **Clips per ad:** Ad 21: 4 · Ad 22: 4 · Ad 23: 3 · Ad 24: 3 · Ad 25: 4 · Ad 26: 4. That is **22 clips**.
- **MP4 folder:** `marketing/broll/out/ad-21/` to `marketing/broll/out/ad-26/` (full path `/Users/chrisstanbridge/Developer/fundhub-platform/.claude/worktrees/ad-scripts-2026-10-02/marketing/broll/out/`).
- **Total size:** 3,854,329 bytes (3.9 MB). All 22 were probed: H.264, 1080x1920, 30 fps, yuv420p with bt709 tags, and the exact frame count in the shot list (75 or 90).
- **Pexels:** `PEXELS_API_KEY` is not in `/Users/chrisstanbridge/Developer/fundhub-platform/.env`, and no env file has any Pexels name. Nothing was pulled. The shot list gives three search keywords per script, each tied to the line it fits, and says to pick clips with no faces, logos or bank names.
- **Git:** one line added to the root `.gitignore`: `marketing/broll/out/`. MP4s never go in git.
- **How the renders were run:** one `npx remotion render` command per clip, typed at the terminal. No render script or pipeline was saved, so usage stays on the $25 a month Creators option.

**Template changes.** All are additive. The defaults are unchanged: the four touched templates re-render pixel-identical to the approved phase-1 previews.
- `SoftPull`: `score` can be null, which shows no number. No ad line says a score, so the sample client's 762 never sits over one. The label then sits large inside the gauge.
- `FileItems`: chips are optional (`tag: null`), plus a green chip tone (`tagTone: "ok"`), an inline row layout (`layout: "inline"`), up to 5 items, and an optional subtitle.
- `QualifyToday`: a words-only chip when the two amounts are words instead of numbers (used for "From one company / To five or ten / Each one funded").
- `RatesRising`: optional `headlineSize`, and balanced line breaks on the headline and subline.
- `remotion.config.ts`: bt709 color tags, so the MP4s come out as standard yuv420p. Without it they came out full-range yuvj420p, which some players and uploaders show with shifted colors.

**Checks.**
- A still of every clip, scanned: 0 drawn pixels in the top 14% or bottom 35%, and nothing past the side margins.
- I looked at every still, then one frame from an MP4 of each of the 8 templates, then a motion strip of two clips. Two layouts were fixed after looking: the soft-pull label was crowding the gauge, and the Ad 22 rates subline left "to get." alone on its second line.
- **Words on screen:** a word-by-word check listed every on-screen word that is not in its own line. Two had no source and were changed: Ad 21 clip 1 "On a 760 file" became "A 760 file", and Ad 21 clip 3 "a fix for each one" became "the fix for each one". Each remaining one is named under its table in the shot list:
  - the same sentence (Ad 22 clip 1)
  - the /roadmap page for the same idea (Ad 21 clip 2's card title; Ad 23 clip 2's "from one company to five or ten, each one funded")
  - the 9/30 /watch VSL for the same step (Ad 26 clip 1's "On your report")
  - or the ad's own loop sentence that the line pays off (Ad 24 clip 2, Ad 25 clips 2 and 3, Ad 26 clip 1)

**What didn't get a clip** (it stays on Chris):
- the price and call-to-action lines in every ad
- "funded again and again" in Ad 21 and "funding forever" in Ad 22
- the proof line in Ad 23
- "one file is ready in a month and another takes six" in Ad 24. The two-row layout would color "takes six" blue, as if it were the better result.
- "Wherever you are in the funding process..." on the three call ads (no three-paths template was built)
- Ad 22's rates clip starts at "when rates go up" (0:05), so the Fed news line opens on Chris's face.

## Leftovers

- The live /roadmap "See a sample" dispute letter comes from the vendor sandbox file, while the sample's amounts come from the simulated file. Per `ops/workflows/2026-10-02-roadmap-sample-content.md` (W1 and W3 manifest), that is two files in one sample set, which the 2026-10-02 sample-clients rule forbids. Not touched, not verified.
- Phase 2: none.
