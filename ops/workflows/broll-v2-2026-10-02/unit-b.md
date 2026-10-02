# Unit B — CompanyLine (companies on an assembly line, each one funded)

## DONE (2026-10-02)

- **Composition id:** `CompanyLine`
- **File:** `marketing/broll/src/templates/CompanyLine.tsx` (registered in `marketing/broll/src/Root.tsx`, one import line and one line in the list)
- **Preview:** `marketing/broll/previews/company-line.png` (frame 62)
- **Sample MP4:** `marketing/broll/out/samples/company-line.mp4` (gitignored; 1080x1920, 30 fps, 90 frames, 3.00 s, H.264 yuv420p bt709, 1.3 MB)

## What it shows

One idea: company after company comes down a 3D assembly line, and each one gets funded.

- A conveyor belt runs across the frame at an angle. It goes back into the distance on the left and comes toward you on the right. The belt has moving slats, turning rollers, a back rail, legs and a soft floor shadow.
- Each company is a real 3D white box (front, side and top) with a small office building on it, its name ("Company 1" and so on), four revenue bars and a status chip.
- A floating funding station with the blue "$" seal hangs over the belt. The belt slows under it (it never fully stops) and speeds up between stops, like an assembly line.
- At the station, cash pours out of the station's slot and lands on top of the box. It builds a strapped cash stack. Then the box's windows light up gold, its revenue bars climb in green, its chip turns green "Funded", and a light sweep crosses the box.
- Funded boxes roll on to the right with their cash. Their stacks keep growing a little as they go (cash keeps coming in). So the companies funded first carry the most cash.
- Faint bills drift in the top zone, and bills and coins rise in the bottom zone. These are decoration only and fade to 32% in those zones.
- Default timing (5 companies): about 16.5 frames per company. Cash starts landing on Company 1 at frame 10, and its chip is green by about frame 18. The last company is fully funded, with its sweep finished, by frame 88.

No dollar figure shows by default. Stacks and bills are pictures, never amounts. Company names are generic unless a prop gives real ones.

## Props

| Prop | Default | What it does |
|---|---|---|
| `eyebrow` | `Company after company` | Spectrum dash + label (Ad 23 sentence 6; /roadmap step 04 "funding company after company after company") |
| `headline` | `From one company to five or ten, each one funded.` | The /roadmap Business Duplication Map line, word for word (also Ad 23 line 2) |
| `count` | `5` | How many companies come down the line, 2 to 8 |
| `labels` | none (shows `Company 1` … `Company N`) | Names on the boxes, in order. A missing one reads `Company <n>`. Never invent business names. |
| `amounts` | none | Optional dollar amount per company, **only from a script line**. Replaces that box's chip and counts up while it is funded, in green. Lands exactly on the value before the clip ends. |
| `total` | none | Optional total, **only from a script line**. Shows on the funding station in place of the "$" seal and counts up as the companies are funded. Lands exactly on the value before the clip ends. |
| `fundedLabel` | `Funded` | The chip word ("each one funded") |
| `durationInFrames` | `90` | 75 to 105 (2.5 to 3.5 s). The whole timeline stretches to fit. This template clamps on its own, because the kit's shared clamp is 60–90. |
| `showSafeZones` | `false` | Review overlay |

## Commands (run inside `marketing/broll/`)

```bash
# preview still
npx remotion still src/index.ts CompanyLine previews/company-line.png --frame=62

# sample video (default 90 frames)
npx remotion render src/index.ts CompanyLine out/samples/company-line.mp4

# with a script line's own numbers (only when the line says them)
npx remotion render src/index.ts CompanyLine out/company-line-amounts.mp4 \
  --props='{"count":3,"amounts":[50000,75000,125000],"total":250000,"durationInFrames":105}'

# text-only render for the safe-zone pixel scan (decoration dropped)
npx remotion render src/index.ts CompanyLine /tmp/cl-textcheck --sequence --image-format=png --props='{"checkTextOnly":true}'

npx tsc --noEmit
```

The test amounts above only prove the layout. They are not from any line. Do not ship them.

## Where it fits

- **$297 Ad 23, line 2:** "Once that setup is right, there's a way to repeat it, from one company to five or ten, each one funded." Use the defaults as they are.
- **$297 Ad 23, sentence 6 (about 0:42):** "Then the free Business Duplication Map shows you how to repeat it, company after company, and you'll never need anyone to fund you again." Use the defaults, or `{"eyebrow":"Free Business Duplication Map"}`. The shot list (`marketing/broll/shot-lists/2026-10-02.md`, Ad 23 clip 2) uses `QualifyToday` here today. CompanyLine is a closer picture of the line. Swapping it is the shot-list owner's call; I did not edit the shot list.
- **/roadmap step 04 "Set up the businesses":** "You can repeat this process, funding company after company after company."
- **/roadmap FREE BONUS Business Duplication Map:** "how you go from one company to five or ten, each one funded."
- **/roadmap subhead:** "You'll never need anyone to fund you again." As a headline prop: `{"headline":"You'll never need anyone to fund you again."}`.
- **VSL:** no VSL script in the repo has a company-after-company line (searched `marketing/vsl/`, `marketing/`, `ops/workflows/`, `docs/`). It fits any VSL beat that says those words.

**Words on screen and their source:** the eyebrow comes from Ad 23 sentence 6 and /roadmap step 04. The headline is the /roadmap bonus line, word for word. "Funded" comes from "each one funded". "Company 1…5" are generic placeholders. There are no other words.

## Checks

- **Type check:** `cd marketing/broll && npx tsc --noEmit` passes (exit 0).
- **Root lint:** `scripts/lint.mjs` only scans `src scripts api netlify db public extension`, not `marketing/`, so it does not cover this file.
- **Text-only safe-zone scan:** I rendered all 90 frames with `checkTextOnly: true` and scanned every pixel in y 0–268 and y 1248–1919. Allowed background is paper (252), a grid line (240) or a grid crossing (229–231), all grey. **0 drawn pixels in the no-text zones on all 90 frames.** Content spans y 303 (the wordmark) to y 1244. Rows 1245–1247 are plain background, so nothing is sliced at the band edge.
- **Looked at:** the preview still, 10 stills across the clip (frames 0–89), 6 frames pulled from the MP4 itself (4, 20, 38, 52, 70, 86), and stills of the variants (3 named companies with amounts and a total at 105 frames, 8 companies, 8 companies with a $1,000,000 total, 75 frames).
- **Fixed after looking:**
  1. **The belt was cut off mid-frame.** Chrome's default renderer drops parts of very wide 3D layers. One 2600 px belt drew fully only with `--gl=angle`/`swangle`. The belt is now built from 260 px segments and renders fully with the default settings, in stills and in the MP4.
  2. The last company's light sweep was still crossing it on the final frame. The sweep is now shorter and earlier, and the timeline has a little more room at the end.
  3. With 8 companies, the amount and total counters finished after the clip ended (the last frame read $999,985). Counters now always land by frame 86.
  4. The total on the station was too big and touched the light strip. The station grows taller with a total, and the number is capped at 46 px.

## Built inside this template (the kit had no piece for it)

- `CompanyBox`: a 3D box with front, side and top faces.
- `Belt`: the segmented conveyor.
- `Station`: the floating funding box.
- The pour: bills that fall onto a moving box and turn into its stack. MoneyField has no "land on a moving target" mode.
- Its own 75–105 frame timeline.

All of it is plain CSS 3D. No `@remotion/three`, no new packages, and no edits to `src/brand/*` or the other templates.

## Leftovers

- Kit `DollarCounter` (Unit A) shows a leading "0" while a count nears the next power of ten. For example, it reads "$0,999,985" for several frames on the way to $1,000,000.
