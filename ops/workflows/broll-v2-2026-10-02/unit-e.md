# Unit E — lender matching: LenderSlots and FundingRounds

## DONE (2026-10-02)

Two templates, one idea each.

| Composition id | File | Preview | Sample MP4s (gitignored) |
|---|---|---|---|
| `LenderSlots` | `marketing/broll/src/templates/LenderSlots.tsx` | `marketing/broll/previews/lender-slots.png` (frame 100) | `out/samples/lender-slots.mp4` (3.5 s), `out/samples/lender-slots-ad22.mp4` (3.0 s, Ad 22 words) |
| `FundingRounds` | `marketing/broll/src/templates/FundingRounds.tsx` | `marketing/broll/previews/funding-rounds.png` (frame 106) | `out/samples/funding-rounds.mp4` (4 rounds, 3.67 s), `out/samples/funding-rounds-6.mp4` (6 rounds, 4.0 s) |
| `LenderMatchScroll` (Chris's "Matching your file" redesign, added later the same day) | `marketing/broll/src/templates/LenderMatchScroll.tsx` | `marketing/broll/previews/lender-match-scroll.png` (frame 116) | `out/samples/lender-match-scroll.mp4` (4.0 s) |

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

## LenderMatchScroll — Chris's "Matching your file" redesign

Chris's words: "Start from the top and go down. Display a list of 50–60 banks with their logos. Pull the bank logos directly from the CRM database … Show each bureau and their status, but blur out the details." LenderSlots stays as it is; this is a new clip.

### What it shows

- A floating white panel with a header: "Bank", then "Experian", "Equifax", "TransUnion", each with a small padlock.
- Under it, a list of **59 real banks** on a 3D drum. Each row: the bank's logo (the CRM's own logo file, on a white tile), its name, a blurred line under the name (its real product type), and three blurred status chips, one per bureau. A green chip means the bank pulls that bureau and a gray chip means it does not, straight from the CRM. The words on the chips and the product line are blurred, so you can tell real data is there but you cannot read it.
- Frames 0 to 10: the eyebrow draws in and the panel flies forward with the top of the list showing (Southside Bank, Chase, Centier Bank, Bank of America …).
- Frames 10 to 98: the list scrolls from the top of the list to the bottom. It speeds up, runs, then slows down. A light motion blur shows only while it is fast, so logos stay recognizable as they pass. Rows curve away at the top and bottom of the window like a real drum.
- Frame 98: it settles near the end of the list (ConnectOne Bank, WesBanco, FVC Bank, FNBO, 1st Source Bank). A few bills and coins pop out from behind both sides of the panel.
- Frames 100 to 120: the clear line lands under the panel: "30–50 lenders matched to your file" (not blurred), and holds.
- Faint bills drift down both sides the whole time.

No amounts, no approval words, and nothing next to a bank says it approves anyone.

### Props

| Prop | Default | What it does |
|---|---|---|
| `eyebrow` | `Matching your file` | Spectrum dash + label (9/30 VSL P4) |
| `bankHeader` | `Bank` | Header over the logo column |
| `bureauHeaders` | `["Experian", "Equifax", "TransUnion"]` | The three bureau column headers |
| `pulledLabel` | `Pulls` | Blurred chip word when the CRM says the bank pulls that bureau |
| `notPulledLabel` | `No pull` | Blurred chip word when it does not |
| `count` | `30–50` | The big blue number on the ending line. Empty string `""` shows the words alone, in blue. |
| `countLabel` | `lenders matched to your file` | The ending line (9/30 VSL P4: "the thirty to fifty that fit you") |
| `durationInFrames` | `120` | 105 to 135 (3.5 to 4.5 s). The timeline stretches to fit. |
| `showSafeZones` | `false` | Review overlay |

### Banks, logos and bureau data: sources

- **Bank count:** 59.
- **Bank and bureau source:** the Fundhub CRM table `public.lenders` (Supabase project `oqpnlusrotpxfenysfxz`). A read-only SELECT of every row that has a logo (661 rows) is saved at `marketing/broll/scripts/data/crm-lenders-with-logos-2026-10-02.json`, with the query inside it. Each bank's name, `logo_path`, `lender_table` and `bureaus_pulled` come from there. The blurred chips are the bank's `bureaus_pulled` (EX, EQ, TU), every product row combined. The blurred line is its `lender_table` in words (for example "Business card, in branch").
- **Logo source:** the CRM's `logo_path` for each bank, for example `/assets/lenders/chase.png`. That is the file the CRM serves from `public/assets/lenders/` at the repo root. `scripts/bake-lender-scroll.mjs` copies each one byte for byte into `marketing/broll/public/lender-logos/`, so Remotion can load it.
- **The script refuses** to write if a bank is not in the CRM snapshot, has no logo or more than one, has no bureau data, if the logo file is missing, or if the logo is under 120 px. Every chosen logo is 120 to 256 px and shows at 56 px, so all of them are crisp.
- **How the 59 were picked:** I looked at every CRM logo of 120 px or more (370 banks). I kept banks whose CRM logo is clearly their own mark, and mixed national names with regional banks. Left out: names with notes in them, all-caps rows, and logos that are not the bank's mark (see Leftovers).

### Commands (inside `marketing/broll/`)

```bash
node scripts/bake-lender-scroll.mjs     # re-bake after editing PICK
npx remotion still src/index.ts LenderMatchScroll previews/lender-match-scroll.png --frame=116
npx remotion render src/index.ts LenderMatchScroll out/samples/lender-match-scroll.mp4
```

I did not need `--gl=angle`: nothing in the panel dropped or sliced in the default render.

### Where it fits

- **9/30 /watch VSL P4:** "Then it matches your file against thousands of lenders to find the thirty to fifty that fit you". Use the defaults.
- **$297 Ad 22:** "Then your Bank and Lender Match List shows you the banks that approve files like yours". Use `{"eyebrow":"Bank and Lender Match List","count":"","countLabel":"Lenders matched to your state"}` (the /roadmap page's words; the page gives no 30–50 count).

### Checks

- **Text-only safe-zone scan:** 14 stills with decoration dropped (every 10 frames, 0 to 119, plus the no-count version at frame 119). **0 drawn pixels** in y 0–268 and y 1249–1919 in all 14. Words run from y 303 to y 1210 at most.
- **Looked at:** the preview, a 15-frame strip of the whole clip, a mid-scroll frame, a slowing frame, and the frame where the longest name (Trustmark National Bank) is centered. The longest names never reach the bureau columns. The logos are crisp at rest. The chips read as hidden real data: green or gray, words unreadable. Fixed after looking: a motion blur so heavy the logos smeared (now light), header labels crowding each other (wider columns), long names running into the chips (long names step down a size), and chip words that were still half readable (blur raised to 7 px).
- **Typecheck:** `cd marketing/broll && npx tsc --noEmit` passes.

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

## Commits

- `19517739` — Unit E's files. **Shared-index race:** Unit D ran `git add` on its own files at the same moment, so this commit also carries Unit D's staged work (ProofWall.tsx, proofWallApprovals.ts, proof-wall-approvals.py, public/proof-wall/*.png, unit-d.md) and Unit D's version of Root.tsx, which dropped Unit E's two lines. Nothing was lost; Unit D's files are committed as Unit D wrote them.
- Follow-up commit — puts Unit E's two Root.tsx lines back (import + `<LenderMatchingCompositions />`), committed by path only.

## Leftovers

- Some CRM `logo_path` files are not the bank's own mark, for example a website-builder "G" icon on several banks, a browser icon, generic ".bank" tiles, an app-store badge, a dog photo, and other companies' logos. I left those banks out of LenderMatchScroll and did not fix the CRM.

- Units share one git index in this worktree, so a `git add` by one unit can land in another unit's commit (happened once, see Commits). Committing with `git commit -- <paths>` avoids it.
