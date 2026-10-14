# Slice 4 manifest — customer-data screens (builder S4)

Branch `prf/s4-data-screens`, cut from `origin/main` (0a2160c97). Tests only. No product code changed.

## The count

- Rows in the slice: 279. All 279 were NOT_PROVED before.
- NOT_PROVED after: 83. So 196 rows now have a real test attached.
- Measured offline with the four lanes, the way the task said (route, display, flow, reads lanes, fake fetch). All 279 sit in `gap-catalog-display`.

## What I built

One shared helper, one data table, one shard, and 26 test files. Every test opens the real page in Chromium, answers `/api` with fake data, clicks the control, and checks the exact request and what the screen then says.

| File (all in `src/pulse/catalog/proofs/`) | What it is |
|---|---|
| `s4-screen-harness.mjs` | Static server for `public/`, one Chromium, fake `/api`, and the "every listed row was exercised" tracker |
| `s4-money-harness.mjs` | Helpers for the money tabs (page and frame entry, fake `/api/money/<x>`) |
| `s4-rows.json` | The table: which control rows each test file proves |
| `s4-display-proofs.mjs` | Turns that table into proof cases for the catalog |
| `s4-*.test.mjs` (24 files) | The proofs: pipeline board, money banks, accounts, plan, payments, declines, helper, connections, overview, setup and strategy, panels, vault, FinanceOS frame, finance-os desk, contracts, content admin, consent, soft-pull approval, staff desks (void, interview), closer outcome, lenders, inbox, closer deck, Brand Studio, public forms, contract signing |

A listed row can only attach if its test claimed it (the last test in each file fails if any listed row never ran).

## Shared lines I touched (for the integrator)

- `src/pulse/catalog/proofs/display-proof-cases.mjs`: two lines. One import of `S4_DISPLAY_PROOF_CASES`, and one `...S4_DISPLAY_PROOF_CASES,` at the end of the plugin list.
- `src/pulse/catalog/proofs/display-proof-cases.test.mjs`: the red count `1_039` is now `862`. That is the real number measured with only my slice added. When the five slices are merged, re-measure it; it is the sum of everyone's drops.
- `src/pulse/catalog/generated.json`: regenerated with `node scripts/pulse/compile-catalog.mjs` (a guard test requires it). Re-run the compiler after merging; do not hand-merge this file.

## Rows I could not attach, and why

- **9 rows are proved by a test but stay NOT_PROVED on purpose.** Their pulse contract is "always red until a saved receipt exists" (`display-saved-result.mjs`). The screen test cannot replace a database receipt. They are listed under `notAttached` in `s4-rows.json`: content admin (4: name box, outcome box, switch, Save changes), contracts (2: Save create, Save edit), consent capture (1: wording/version/status banner), documents (1: Void), soft-pull approve (1: Business fields).
- **Not attempted (time):** inquiry-remover 36, client-control-panel 18, client-portal 9, money.html server rows 2 (link-token, link-exchange), money-vault documents-upload server row 1, partner-galaxy 1, social-studio 1, staff-teams 1, shell search 1.
- **Product findings (left red, not fixed):** see the next section.

## Product findings

1. **Contracts, PDF editor: a dragged box does not move on screen.** Drag a box and the saved position changes (x 0.40 to 0.50), but the box on screen stays where it was drawn until something redraws it. The mouse-down redraws every box, then the drag moves a box that is already gone. Row left NOT_PROVED: "PDF editor: drag on a page to draw a box; click a box to select; drag to move; drag corner to resize".
2. **Climate page has no lead form.** `public/climate/index.html` is a lending climate dashboard. It has no "See how many banks in our book fit your state" button and no four-answers form. No page in `public/` calls `/api/public/climate-match`. Two rows describe controls that are not on the shipped page. Left NOT_PROVED.
3. **Leads list page is not in the repo.** The row names `public/leads/<32-hex>/index.html`; no such folder is committed, so nothing can be tested. Left NOT_PROVED.
4. **Pipeline map text is stale for 46 columns.** The map says every column "shows count and funding est." The page deliberately shows the funding total only on the Sales, Card Stacking and altfin rails (owner call 2026-08-28, in the page comments). My proof checks the count, no funding total on the other rails, and the exact drop request. The row text should be fixed in the map. Not a product bug.
5. **Content admin: Clear leaves the old file's title.** Pick a file, Clear, pick another: the Title box still holds the first file's name. Small. Not tied to a row.

## What I ran

- Every new test file alone: green, and re-run 2 to 5 times each to check for flakes. Two flakes were found and fixed (a repaint race in content admin, and waits that were too short when 118 files start at once).
- Break checks: for each proof file I broke the page on purpose once (a wrong field, a dropped gate, a changed message), saw the test go red, then restored with `git checkout`. Done for every file; the scripts are not kept.
- `npm run lint`: clean (3481 files).
- Focused proof run (all 118 test files named by display proof cases): 1701 tests; the only failures were two tests that need `node_modules/@playwright/test/cli.js`, which a bare worktree does not have. With `node_modules` linked (ignored by git) they pass (3 of 3).
- Catalog and lane suites: see the commit message / final report.

## Environment note

A bare git worktree has no `node_modules`. `display-batch-staff-ui.test.mjs` and `read-reviewed-e2e.test.mjs` fail there for that reason alone ("Playwright CLI is not installed"). Link `node_modules` from the main checkout to run them.
