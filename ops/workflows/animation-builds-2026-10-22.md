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

**No logo on see-through (owner-set 2026-10-23).** Chris: remove the logo from the see-through animations; the brand shows in ONE logo animation (`FundhubLogo` / `FundhubLogoWide`). `Wordmark` draws nothing inside `<SeeThrough on>`. Page-on renders are unchanged.

**The logo plays only where the script says Fundhub (owner-set 2026-10-23).** `validateAnimationPlan` refuses `FundhubLogo*` on any other line (`logo_not_on_fundhub`).

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
| W1 | Wide + see-through-ready versions of FileItems, HiddenDataPoints, SoftPull, StepPath, QualifyToday | VSL, thank-you | done, merged |
| W2 | Wide versions of InquiriesOff, FundingRounds, LenderMatchScroll, ProofWall, BookCall | VSL, thank-you | done, merged |
| N1 | New: MoneyClimb (amounts stepping up, a range, a monthly ladder) | VSL, Ad 13, Ad 10, Ad 11 | done, merged |
| N2 | New: DeadlineClocks and FundingStack | VSL, Ad 13, Ad 14, Ad 16 | done, merged |
| N3 | New: BureauMatch and PathCards | thank-you, VSL, Ad 14 | done, merged |
| N4 | New: FundabilityMeter and ScoreBadge | VSL, Blueprint Ad 3, Ad 16 | done, merged |
| N5 | New: StampCard and PriceTag | Ads 12, 5, 16, 13, Blueprint Ad 1 | done, merged |
| N6 | New: SplitBar and IconCount | Ad 12, Blueprint Ads 1 and 2 | done, merged |
| N7 | New: TwoPeople, ReturnMultiple, CalendarStrip | Ads 9, 4 | done, merged |
| Merge | Merge branches, rebuild catalog, re-plan VSL and thank-you densely | — | done: PR #129 (branch `animations-2026-10-22`). 110 planned animations, all pass the checker |

No dependencies between W1, W2, N1, N2, N3. Merge waits on them. Batch 2 starts when slots free up (5 builders at a time).

## Merge notes

- `src/marketing/broll-see-through.test.mjs` hard-codes the catalog count (22). Set it to the final count at merge.
- W1: add `QualifyTodayWide` to `DATA_TIED` in `src/marketing/animation-plan.mjs` and to the list at `src/marketing/catalog.test.mjs` line ~114, then rebuild the catalog.
- W1 changed the see-through look of its five templates: content now sits on one white card inside the safe band (page-on look unchanged, 15/15 pixel-identical).
- `Root.tsx` and `catalog.json` will clash across branches; resolve by keeping every registration, then rebuild the catalog.
- Builder worktrees start from origin/main, not the local working branch. Merge them on `animations-2026-10-22` (also based on origin/main), never into the main checkout.
- N3 put the Fundhub wordmark at the top of its wide side panel (not a script word). Later builders were told not to. Decide at review.
- Done at merge: `QualifyTodayWide` added to `DATA_TIED` and to the catalog test.
- N6: IconCount shows "1 in 8" without the script's "Only about" (the stat is 12.6%). Check at review.
- W1 and W2 added a white card / white edge behind words in see-through mode so they read over dark film. Page-on look unchanged.
- Wide layout code exists in three places (KitFrame.tsx, sidePanel.tsx, widePanel.tsx) plus inline copies. Fold into one helper in a later refactor.
- Dense re-plan of the VSL and thank-you video started (Sonnet, read-only), using only the wide templates.

## Proof on branch animations-2026-10-22 (after all 9 builders merged)

- 60 catalog entries (34 template files). `catalog.mjs --check` up to date.
- `npx tsc --noEmit` in marketing/broll: clean. Repo `npx tsc --noEmit`: clean. `npm run lint`: 4298 files clean.
- `npm test`: 29,241 tests, 0 fail, 27 skipped (main suite); database suite 1,130 tests, 0 fail, 1,047 skipped (no DATABASE_URL in this worktree; this branch touches no database code).
- 2026-10-23: logo removed from every see-through animation (commit 826a1fcdd); `FundhubLogo` added (merged from worktree-agent-ab8025292055057d2); all 24 proof sheets rebuilt without the logo (b5c863936). Sheet builders for MoneyClimb and the W2 wide panels added to `marketing/broll/scripts/`.
- 2026-10-23: the Fundhub logo is placed on all 6 "Fundhub" lines (VSL x2, Ads 13, 14, 16, 9), 2 seconds each; 4 animations that sat too close were dropped. 112 placements, all pass.
