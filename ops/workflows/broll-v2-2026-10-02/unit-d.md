# Unit D — ProofWall (the real approvals on 3D screens)

**Status: done (2026-10-02). Round 2, phone readability: done.** Composition id **`ProofWall`**. Preview: `marketing/broll/previews/proof-wall.png`. Sample: `marketing/broll/out/samples/proof-wall.mp4` (gitignored, 4 s).

## What it shows

The real client approvals turn past on a 3D carousel of floating screens. Each screen is one approval picture exactly as it is: the branded win card ("CLIENT WIN / Approved for $X" over the real screenshot, "fundhub." mark) from `marketing/landing-pages/slo/client-wins/deck/`.

Built to read on a phone:
- **Three approvals per clip**, each held in front for about a second.
- **The front screen is big and square to the camera.** It grows a little and comes forward while it is in front.
- **The side screens sit at the frame edges.** They are pushed back, faded toward the page and softened, so they never compete with the front one.
- **A chip is pinned to the front screen.** It has a green check, the amount, and the lender, for example "$74,000 | Chase". Both come only from that picture's manifest entry, which is the figure read off the picture. When the manifest has no amount, the chip says "Approved". When it has no lender, the chip shows the amount only. The chip fades as the screen turns away.

Under the carousel the proof lines build up and stay: "A decade", "Hundreds of files", "Thousands of data points" pop in as small chips (spectrum dash on each), then "A little over a million dollars funded for myself" lands big and holds to the end. Green bills drift behind the screens. Same brand: white grid, wordmark, eyebrow with the spectrum dash, Inter, accent blue.

- No client name or face is added. The 7 blurred pictures keep their blurs.
- Plain CSS 3D, no WebGL, no new packages. Only kit pieces committed in `src/brand` are used.
- Length 4 s by default (120 frames). `durationInFrames` takes 90 to 120 (3 to 4 s), so it has its own composition in `Root.tsx` instead of the registry (the registry clamps every clip to 2 to 3 s).

## Phone-size readability test (round 2, Chris: "I can't tell if it's clear or not")

Frames where each front approval is settled, scaled down to 390 px wide (a phone screen).

**Before:**
- The only amount on screen was the card's own headline, about 13 px tall at phone size. You could read it if you looked for it, not at a glance.
- Lender: only Truist's logo could be read. Chase and KeyBank were too small. The $25,000 and $70,000 pictures name no lender at all.
- Each front approval was fully settled for about 0.27 s (the last one about 0.5 s). Five approvals were packed into 3.5 s.
- The side screens were almost as big and bright as the front one and competed with it.

**After:**
- The chip's amount is about 21 px tall at phone size. The lender is about 13 px. Both can be read at a glance.
- The card's own headline still shows above the chip, so the chip matches what the picture says.
- Side screens read as soft background.
- The proof chips are small (about 9 px) but readable. The million line is about 15 px.

**How long each approval can be read** (measured from the timeline, default 4 s clip):

| In front | Screen square to camera | Chip fully on |
|---|---|---|
| $15,000 FNBO | frames 10–44 (1.17 s) | 0.93 s |
| $50,000 KeyBank | frames 53–83 (1.03 s) | 0.97 s |
| $74,000 Chase | frames 92–119 (0.93 s) | 0.90 s |

At `speed: 1.5` (four approvals) each one is up 0.6–0.8 s. At `speed: 2` (five) it drops to 0.4–0.6 s. A 3-second clip (90 frames) shrinks each hold to about 0.7 s.

## Props

| Prop | Default | What it does |
|---|---|---|
| `eyebrow` | `"Client approvals"` | The label over the carousel. |
| `approvals` | the six below | Approval ids from `src/templates/proofWallApprovals.ts`, in carousel order. The first is in front when the clip starts; the last one sits just off to its left. `"all"` uses all 40 in the manifest's order. |
| `proofLines` | `["A decade", "Hundreds of files", "Thousands of data points", "A little over a million dollars funded for myself"]` | Every line but the last pops in as a chip (keep chips short; the three defaults fill one row). The last line lands big and holds. One line = just the big line. These four are the only proof words allowed (no $25 million, no Koi Poke). |
| `speed` | `1` | 1 = three approvals in front, about a second each (two turns). 1.5 = four, 2 = five, with shorter holds. |
| `durationInFrames` | 120 | 90 to 120. |
| `showSafeZones` | off | Draws the no-text zones for checking. |

## Approvals it uses by default

Crisp approvals that each print an amount, whose manifest entry names the lender, and that needed no blur. In front, in order (climbing): **$15,000 FNBO** (big text: "Just got approved for $15,000 0% business credit at FNBO"), **$50,000 KeyBank** (letter with "$50,000 Business Credit Card Approval"), **$74,000 Chase** (email "Welcome to Chase Ink Business Cash", lands last with the million line). Dimmed at the sides: $12,000 Bank of America at the start, $20,000 Truist at the end. $16,000 BankUnited is next in line at higher speeds.

Ids: `win-15000-fnbo`, `win-50000-keybank`, `win-74000-chase`, `win-20000-truist`, `win-16000-bankunited`, `win-12000-bank-of-america-2`.

All 40 are available (`approvals: "all"`, or any list of ids). Long lender names on the chip break into two even lines ("American Express / and Bank of America"); a product note in brackets is dropped ("Chase (Ink Business Unlimited card)" shows as "Chase").

## The approval files

- `marketing/broll/public/proof-wall/<id>.png` — all 40, copied by `python3 marketing/broll/scripts/proof-wall-approvals.py`. 33 are byte-for-byte copies of the deck files.
- 7 got a heavy blur on spots the earlier grey bars missed (the script lists each box):
  - `win-noamount-american-express-p23-1`, `win-7000-citizens`: a client's initials in the chat bubble ("AW").
  - `win-45000-chase`: the sender's name, initials ("DS") and a tiny profile photo in the reaction.
  - `win-10000-lender`: the sender's profile picture, two faint sender-name lines, a tiny profile photo in the reaction.
  - `win-noamount-enterprise-bank-trust-p08-2`, `win-25000-enterprise-bank-trust`: the business name line and the card reference line on the letter.
  - `win-noamount-first-citizens-bank-p04-1`: the banker's name and license number still showing under the black scribble.
- `marketing/broll/src/templates/proofWallApprovals.ts` — generated by the same script: id, size, amount and lender from the manifest, and what was blurred. The chip reads its amount and lender from here.

## Commands (run in `marketing/broll`)

**Always add `--gl=angle`.** Without it, this Mac's default renderer cuts a slice out of a side screen on some frames (the screen goes see-through near its inner edge). With `--gl=angle` every frame is whole.

```
npx remotion still src/index.ts ProofWall previews/proof-wall.png --frame=112 --gl=angle
npx remotion render src/index.ts ProofWall out/samples/proof-wall.mp4 --gl=angle
```

With props, for example the Ad 23 line only:

```
npx remotion render src/index.ts ProofWall out/ad-23/proof-wall-million.mp4 --gl=angle --props='{"proofLines":["A little over a million dollars funded for myself"]}'
```

## Checks run (round 2)

- `npx tsc --noEmit` in `marketing/broll`: passes.
- Safe zone: rendered all 120 frames with `--props '{"checkTextOnly":true}'` and compared the top 14% (y 0–268) and bottom 35% (y 1249–1919) of every frame with the bare grid: **0 drawn pixels in all 120 frames**. Screens, chip and words run from y 413 to y 1238 (the wordmark sits at y 303). Nothing is cut off at the band edge. Only the faint bills pass through the no-text zones in the normal render.
- Phone-size look at the settled frames of the final MP4 (table above).
- Looked at every second frame of the sample MP4 (left and right screens tiled): no cut screens.
- Chip with no amount and long lenders (`win-noamount-american-express-and-b-p05-3`, `win-noamount-enterprise-bank-trust-p08-2`) and with a tall card: fits, clears the proof chips.

## Where it fits (script lines and VSL parts)

- **$297 Ad 23**, the proof line: "I'm Chris, I run Fundhub, and I've funded a little over a million dollars for myself." Use `proofLines: ["A little over a million dollars funded for myself"]`.
- **9/30 /watch thank-you video** (`marketing/ads/reference/vsl-scripts-latest.md`, line 48): "I've been doing this for about a decade. We've worked hundreds of files and have thousands of data points on what lenders approve ... You can see some of the approvals our clients have gotten right here on this page." Use the three chip lines (drop the million line), or the default.
- **9/30 /watch VSL**, Chris's intro (line 14): "I learned the funding game ten years ago, and since then I've funded a little over a million dollars for myself." Default props.
- **9/30 /watch VSL** (line 34): "We've worked hundreds of files and have thousands of data points on what lenders approve." Use `["Hundreds of files", "Thousands of data points"]`.
- **$297 Ad 21**: "I've seen that on hundreds of files." Use `proofLines: ["Hundreds of files"]`.

## Manifest (files touched)

- New: `marketing/broll/src/templates/ProofWall.tsx` (exports `ProofWall`, `ProofWallComposition`, `proofWallDefaults`, `PROOF_WALL_BASE`, `PROOF_WALL_HERO`, `clampProofWall`)
- New (generated): `marketing/broll/src/templates/proofWallApprovals.ts` (exports `PROOF_APPROVALS`, `ProofApproval`)
- New: `marketing/broll/scripts/proof-wall-approvals.py`
- New: `marketing/broll/public/proof-wall/` (40 PNGs)
- New: `marketing/broll/previews/proof-wall.png`
- Edited: `marketing/broll/src/Root.tsx` (one import, one `<ProofWallComposition />` line)
- Round 2 touched only `ProofWall.tsx`, `previews/proof-wall.png` and this file.
- Not touched: `src/brand/*`, the registry, the contact sheet, other units' templates.

## Commit

Round 1: all ProofWall files landed inside Unit E's commit `19517739` (the LenderSlots / FundingRounds commit). Units D and E staged at the same moment in the one shared checkout, and E's commit took both sets. The committed files are exactly mine, and the committed `marketing/broll` tree typechecks on its own. `faf588e4` names the work. Round 2 is committed by path. Nothing was pushed.

## Leftovers

- The kit's default renderer on this Mac draws some 3D screens with a slice missing; `--gl=angle` fixes it. Other templates with turned 3D cards may hit the same thing when rendered without the flag. Setting it once in `remotion.config.ts` would cover every clip (not changed here; that file is shared).
