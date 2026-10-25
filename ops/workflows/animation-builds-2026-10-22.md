# Animation builds — 2026-10-22

Chris: make the animations only. **Nothing is laid over any video yet.** Each animation is a clean, see-through (PNG-style, alpha) clip that can be laid over the edited videos later.

Pipeline (Chris, 2026-10-22): film in BigVU → Submagic edits and adds captions → Chris downloads → we add the animations. So every animation must stay clear of the captions.

Builders: Opus 5.5, high effort, one per unit, each in its own git worktree. This session merges.

## Shared rules for every builder

**Kit.** `marketing/broll` (Remotion). Read `marketing/broll/README.md` first. Brand pieces are in `marketing/broll/src/brand/`. Match the look of the existing templates. `BankPockets.tsx` is the pattern for a template with a vertical and a wide format.

**Packages.** In your worktree run, from the worktree root:
`ln -s /Users/chrisstanbridge/Developer/fundhub-platform/marketing/broll/node_modules marketing/broll/node_modules`
(gitignored, never commit it).

**Every template you build or change must:**
1. Take `transparent` (default `false`) and wrap its frame in `<SeeThrough on={transparent}>`. When on: no paper, no grid, no full-frame tint. What remains are solid cards, words and objects with a soft shadow, so they read cleanly over any footage (a sticker / clean PNG feel).
2. Have two formats: vertical 1080×1920 (ads) and wide 3840×2160 (the VSL and the thank-you video, which are filmed sideways in 4K). 30 fps. Register both compositions (`<Id>` and `<Id>Wide`) the way `BankPocketsCompositions` does in `src/Root.tsx`.
3. **Stay clear of the captions and the face.**
   - Vertical: every word inside y 269–1248. Nothing but faint decoration in the top 14% (y < 269) or the bottom 35% (y > 1248). This is the existing kit rule.
   - Wide (new rule, set here): the face sits in the middle and Submagic's captions sit low in the middle. All content sits in ONE side panel chosen by a `side` prop, `'left' | 'right'`, default `'left'`. Left panel: x 192–1500. Right panel: x 2340–3648. Both panels: y 108–1512. Nothing in the middle column (x 1500–2340), and nothing in the bottom 30% (y > 1512).
4. Keep `showSafeZones` (draws the zones for review) and honor `checkTextOnly` (see `src/brand/depth.tsx`) so a pixel scan can check the words alone.
5. Declare its length range the way the catalog reads it (`src/marketing/catalog.mjs` header: the composition's calculateMetadata clamp) and `durationInFrames` in its props.

**Words.** Only the script words named in your brief. Never invent a number, a bank, a name or a claim. Company name: **Fundhub**. Certain words only: never "we think", "might", "maybe", "could", "likely".

**Proof before you finish (all of it):**
- `cd marketing/broll && npx tsc --noEmit` passes.
- Render stills for each of your compositions, normal and `{"transparent":true}`, with `--image-format=png`, at a frame where everything is on screen. On the transparent ones, the four corners and the middle column (wide) must have alpha 0.
- Pixel-scan a `{"transparent":true,"checkTextOnly":true}` render: no pixel with alpha > 0 outside the allowed zone above. Copy the approach of `marketing/broll/scripts/offer-cta-zone-scan.py`. Say the numbers you got.
- Save ONE marked proof sheet per template to `marketing/broll/previews/<id>-overlay.png`: the vertical and wide transparent stills over a checkerboard, with red boxes on the allowed zones and a short legend on the image.
- From the worktree root: `node marketing/broll/scripts/catalog.mjs`, then `node --test src/marketing/catalog.test.mjs src/marketing/broll-see-through.test.mjs` passes.

**Never:** open, cut, render onto, or overlay any filmed video; touch the database; push; edit files outside `marketing/broll/` (plus the regenerated `marketing/broll/catalog.json`); change a template you were not assigned. Commit your work on your worktree's branch with a clear message, and report the branch name, the files changed, and the proof numbers.

## Units

| Unit | What | Serves | Status |
|---|---|---|---|
| W1 | Wide + see-through-ready versions of FileItems, HiddenDataPoints, SoftPull, StepPath, QualifyToday | VSL, thank-you | done (branch worktree-agent-a9b7eda08b78fa061, b1075e019) |
| W2 | Wide versions of InquiriesOff, FundingRounds, LenderMatchScroll, ProofWall, BookCall | VSL, thank-you | claimed |
| N1 | New: MoneyClimb (amounts stepping up, a range, a monthly ladder) | VSL, Ad 13, Ad 10, Ad 11 | claimed |
| N2 | New: DeadlineClocks and FundingStack | VSL, Ad 13, Ad 14, Ad 16 | claimed |
| N3 | New: BureauMatch and PathCards | thank-you, VSL, Ad 14 | claimed |
| N4 | New: FundabilityMeter and ScoreBadge | VSL, Blueprint Ad 3, Ad 16 | claimed |
| N5 | New: StampCard and PriceTag | Ads 12, 5, 16, 13, Blueprint Ad 1 | pending |
| N6 | New: SplitBar and IconCount | Ad 12, Blueprint Ads 1 and 2 | pending |
| N7 | New: TwoPeople, ReturnMultiple, CalendarStrip | Ads 9, 4 | pending |
| Merge | Merge branches, rebuild catalog, re-plan VSL and thank-you densely | — | pending (this session) |

No dependencies between W1, W2, N1, N2, N3. Merge waits on them. Batch 2 starts when slots free up (5 builders at a time).

## Merge notes

- `src/marketing/broll-see-through.test.mjs` hard-codes the catalog count (22). Set it to the final count at merge.
- W1: add `QualifyTodayWide` to `DATA_TIED` in `src/marketing/animation-plan.mjs` and to the list at `src/marketing/catalog.test.mjs` line ~114, then rebuild the catalog.
- W1 changed the see-through look of its five templates: content now sits on one white card inside the safe band (page-on look unchanged, 15/15 pixel-identical).
- `Root.tsx` and `catalog.json` will clash across branches; resolve by keeping every registration, then rebuild the catalog.
