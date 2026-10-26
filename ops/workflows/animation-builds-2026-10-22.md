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

## Capital Blueprint Ad 1 — Industry call-out (2026-10-25)

- **Owner:** Codex `/root`. **Scope:** one review render only; do not change any other ad, master video, or shared template.
- **Master:** `/Users/chrisstanbridge/Downloads/Fundhub — Post Edit Pre Animation/Capital Blueprint Ad 1 — Industry call-out.mp4` (read-only).
- **Timing check prompt:** `Capital Blueprint Ad 1 only. Match every scheduled animation start to the captioned master, report any mismatch, and do not edit or render.`
- **Placement check prompt:** `Capital Blueprint Ad 1 only. Validate every scheduled overlay against the face, captions, safe bands, and offer. Report defects; do not edit or render.`
- **Output:** a scratch review MP4 plus contact sheet and frame-review evidence. The old Desktop review is not a source of truth.
- **Readability guardrail (2026-10-25):** Every schedule row now names the key things a viewer must see. For a behind clip, the matte check measures each one and blocks the lay-on unless every key item and words box is at least 85% visible in the worst sampled frames. Large diagrams keep all key content inside the top third (y 0–640 on a 1080×1920 ad); they never use the middle or lower two-thirds.

## Active rebuild split — 2026-10-25

- **Capital Blueprint dashboard treatment — owner `/root`:** rebuilt in `BlueprintDashboardReal` as an animated, full-background action sequence behind Chris's cut-out. It progresses through the real offer actions (roadmap, Chase payoff, negative removal, disputes, business one/two, next sequence); no nonsense labels/dates or Sample File badge. Screenshot proof: `/private/tmp/ad1-blueprint-action-placement.png`. Master footage stays untouched.
- **Capital Blueprint Ads 2 and 3 — placement discovery:** completed as screenshot-placement maps only. Reuse the rebuilt dashboard treatment for the long Blueprint explanation; use ChessRightMove/LearnByAction only at their named anchors. Do not render onto masters until each placement is shown.
- **Direct Book Ads 4, 5, and 16 — later lane:** retain only owner-approved visuals, then produce placement proofs before any render. The rejected money-spin/falling-cash assets stay out.

## Finish split — 2026-10-25

- **Ad 1 dashboard readability — owner `/root/ad1_layout`:** `Capital Blueprint Ad 1 only. Rework the modern BlueprintDashboardReal placement so the viewer can read its actions around Chris. Use the top third and open side space; keep Chris in front only where needed. No old DashboardOS, Sample File badge, fake money, or fake approvals. Update the plan and make placement proofs only.`
- **Ads 2 and 3 — owner `/root/ad2_rereview`:** `Capital Blueprint Ads 2 and 3 only. Make their existing plans render-ready using the modern BlueprintDashboardReal and established real templates. Keep Ad 2's removed 'banks tighten every year' copy and raised diagram. No old dashboard, Sample File badge, fake money, or substitutes. Make placement proofs only.`
- **Direct Book Ads 4, 5, 9, and 16 — owner `/root/ad1_timing`:** `Read the saved anchor list and existing plans. Keep real established visuals only. Ad 16 is a surgical cleanup: preserve the good visual language and identify only placement, readability, and audio changes. Make schedules and placement proofs only; do not render final videos.`
- **Final review renders — owner `/root`:** render only after each lane is source-locked, frame-review each final scratch output, then leave the Submagic masters untouched.

## Premade-only nine-ad visual review — 2026-10-26

- **Owner `/root`:** create a review sheet only. Do not edit masters, schedules, or templates. Map the burned-caption anchor words to the existing premade catalog and show one placement screenshot per ad.
- **Batch A:** Capital Blueprint Ads 1, 2, and 3 — anchors, premade-only choices, screenshot mocks.
- **Batch B:** Direct Book Ads 4, 5, and 12 — anchors, premade-only choices, screenshot mocks.
- **Batch C:** Direct Book Ads 13, 14, and 16 — anchors, premade-only choices, screenshot mocks.
- **Excluded from this review:** `BlueprintDashboardReal`, `BlueprintDashboardOS`, `BlueprintDashboardOSAd2`, `SkyPlate`, `SkyDiagram`, `ProofFlood`, `ProofFloodWide`, plus any fake approval, falling-cash, or sample-file visual. Use the catalog's existing assets only; show the choices before any later placement work.

## Shared premade-library cleanup — 2026-10-26

- **Owner `/root`:** remove the Fundhub wordmark from every reusable animation and tighten white cards to the content. The separate `FundhubLogo` composition is removed from the usable catalog rather than used in ads.
- **Logo audit:** locate every shared-frame and one-off wordmark path; confirm the smallest shared removal that covers all templates.
- **Card audit:** identify the shared white-card padding and the templates with their own oversized white plate; render before/after proof stills from representative ads.
- **Must wait:** no video master or overlay export changes. Build only after the shared library visual proof is clean.
- **Completed:** removed the standalone logo composition and stale logo preview; rebuilt the usable catalog (71 templates) and active Ad 14/16 plans; removed the rejected 600+ and 700+ plates; tightened shared and ReturnMultiple white cards. Gallery now has fresh stills for all 73 listed cards with no missing images. No video master or overlay export changed.
- **Owner deletion, 2026-10-26:** removed ProofFlood, ProofFloodWide, SkyPlate, and SkyDiagram from the source, catalog, gallery, previews, and active schedules. The usable catalog now has 67 templates; the gallery has 69 cards including the two non-ad kit tools. No video master or overlay export changed.
