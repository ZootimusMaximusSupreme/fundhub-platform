# Slice 4 manifest — customer-data screens (builder S4, repair round)

Branch `prf/s4-data-screens`, cut from `origin/main` (0a2160c97). Tests only. No product code changed.

## The count

- Rows in the slice: 279. All 279 were NOT_PROVED before.
- NOT_PROVED after: 86. So 193 rows now have a real test attached.
- Measured offline with the four lanes (route, display, flow, reads lanes, fake fetch that answers 200 with empty bodies). All 279 sit in `gap-catalog-display`. Script: counts the slice file's row ids that a lane still prints as NOT_PROVED.
- Last round it was 85 and 194. The Banks "Page gate" row went back to NOT_PROVED on purpose (see "Rows I could not attach").

## What the repair round changed

A checker broke the product on purpose and judged the proofs. These are the fixes, in plain words.

1. **A row is now proved by its own assertions.** Before, 23 rows were claimed by an empty `proof.check(..., async () => {})` placed after the real asserts, and one by a bare `proof.claim()`. Now every claim is made inside the callback that asserts it. The bare claim is gone from the harness, and an empty callback is refused (`s4-screen-harness.mjs`). New unit test `s4-harness.test.mjs` proves the tracker: empty callback claims nothing, a failing callback claims nothing, a listed row never run fails the file.
2. **Where a row covers two forms, the claim needs both.** Frame Banks "Add to plan" (per-bank form and free-typed form), frame Accounts "Add a business form and Save business info", frame Plan "Mark done and Mark missed", frame Overview "Connect a bank (header, and again in the empty state)", frame Declines paste form.
3. **Role and gate cases were missing, now present** in the same table-driven files:
   - Banks: a client opening the page and the frame gets none of the staff plan controls (checked inside every staff row).
   - Plan: each mark button shows only when that pin's own `can_mark` lists it (client: none; a pin that allows only done: only Mark done). Both page and frame.
   - Vault: staff controls need a client id AND the server's staff view (three cases). The sort form asks months and date for a statement.
   - Documents Void: owner and admin offered, closer and csm not, signed contract not.
   - Brand Studio Verify: owner and admin get it, partner does not.
   - Pipeline: every staff role stays on the page, a client is sent away.
   - Soft-pull approval now opens with no login at all.
   - Money Accounts: no session goes to the right sign-in page and back.
4. **Half-covered compound rows were finished.** Vault upload labels (all four, one multi-file input, JPG and PNG go through, an expired View link is not followed), Declines paste box (19 and 20 letters, 20,001 cannot be typed, the Social Security number is masked by the real save path over a stand-in table), Overview "Try again" on trends, Credit history from two pulls and UnderwriteIQ sentences, Transfers "who said yes", Finance OS hand-typed note absent when nothing is hand-typed, Brand Studio every box saved as typed (each row asserts the saved brand carries its own box; all three voices), Closer outcome each of the five ticks and five keys, CSM interview for both stages, Inbox hidden tab makes no read, Contracts box fields and signer saved, Content admin each tile row asserts what the one save carried.
5. **No timer waits that depend on a quiet machine.** The helper's 3 second poll now runs on the page's held clock.
6. **Files over 400 lines.** `s4-rows.json` (546 lines) is two files, `s4-rows-money.json` (253) and `s4-rows-screens.json` (295), joined by `s4-rows.mjs`. No S4 file is over 400 lines. The two older big files (`generated.json`, `display-proof-cases.mjs`) are not mine to split.
7. **One copy of the bank-link stub.** `bankLink()` in `s4-money-harness.mjs` replaces two copies of the Plaid script and the two link handlers.
8. **A short queue for browsers.** `s4-browser-slots.mjs`: at most 3 S4 files hold a Chromium at the same time (set `S4_BROWSER_PLACES` to change). The focused proof run starts all 118+ files at once, and the extra Chromiums were crowding out the other browser specs (see "What I ran").

## What I built (unchanged shape)

One shared harness, one row table, one shard, and 27 test files. Every test opens the real page in Chromium, answers `/api` with fake data, clicks the control, and checks the exact request and what the screen then says.

| File (all in `src/pulse/catalog/proofs/`) | What it is |
|---|---|
| `s4-screen-harness.mjs` | Static server for `public/`, one Chromium, fake `/api` |
| `s4-proof-rows.mjs` | The "every listed row was exercised" tracker (no browser) |
| `s4-browser-slots.mjs` | The three-place queue for browsers |
| `s4-money-harness.mjs` | Helpers for the money tabs (page and frame entry, fake `/api/money/<x>`, bank link) |
| `s4-rows.mjs`, `s4-rows-money.json`, `s4-rows-screens.json` | The table: which control rows each test file proves |
| `s4-display-proofs.mjs` | Turns that table into proof cases for the catalog |
| `s4-harness.test.mjs` | Tests the tracker |
| `s4-*.test.mjs` (24 files) | The proofs: pipeline board, money banks, accounts, plan, payments, declines, helper, connections, overview, setup and strategy, panels, vault, FinanceOS frame, finance-os desk, contracts, content admin, consent, soft-pull approval, staff desks (void, interview), closer outcome, lenders, inbox, closer deck, Brand Studio, public forms, contract signing |

A listed row can only attach if its test claimed it (the last test in each file fails if any listed row never ran).

## Shared lines I touched (for the integrator)

- `src/pulse/catalog/proofs/display-proof-cases.mjs`: two lines (import of `S4_DISPLAY_PROOF_CASES`, and `...S4_DISPLAY_PROOF_CASES,` at the end of the plugin list). Unchanged this round.
- `src/pulse/catalog/proofs/display-proof-cases.test.mjs`: the red count is now `865` (was `864` last round, `1_039` on main). It went up by one because the Banks "Page gate" row is no longer attached. When the five slices are merged, re-measure it; it is the sum of everyone's drops.
- No `e2e/` or product file was edited. (I tried a longer wait on `e2e/agent-editor-promote-demote.spec.mjs`, saw it did not help, and put it back.)
- `src/pulse/catalog/generated.json`: regenerated with `node scripts/pulse/compile-catalog.mjs` (a guard test requires it). Re-run the compiler after merging; do not hand-merge this file.

## Rows I could not attach, and why

- **12 rows are exercised by a test but stay NOT_PROVED on purpose.** Their pulse contract is "always red until a saved receipt exists" (`display-saved-result.mjs`), or the product does not do what the row says. They are listed under `notAttached` in the row tables: content admin (4: name box, outcome box, switch, Save changes), contracts (2: Save create, Save edit), consent capture (1: wording/version/status banner), documents (1: Void), soft-pull approve (1: Business fields), lenders (2: Apply button, Apply dialog; see finding 6), money banks (1: Page gate; see finding 7).
- **Not attempted (time):** inquiry-remover 36, client-control-panel 18, client-portal 9, money.html server rows 2 (link-token, link-exchange), money-vault documents-upload server row 1, partner-galaxy 1, social-studio 1, staff-teams 1, shell search 1.
- **Product findings (left red, not fixed):** see the next section.

## Product findings

1. **Contracts, PDF editor: a dragged box does not move on screen.** Drag a box and the saved position changes (x 0.40 to 0.50), but the box on screen stays where it was drawn until something redraws it. Row left NOT_PROVED: "PDF editor: drag on a page to draw a box; click a box to select; drag to move; drag corner to resize".
2. **Climate page has no lead form.** `public/climate/index.html` has no "See how many banks in our book fit your state" button and no four-answers form. No page in `public/` calls `/api/public/climate-match`. Two rows describe controls that are not on the shipped page. Left NOT_PROVED.
3. **Leads list page is not in the repo.** The row names `public/leads/<32-hex>/index.html`; no such folder is committed. Left NOT_PROVED.
4. **Pipeline map text is stale for 46 columns.** The map says every column "shows count and funding est." The page deliberately shows the funding total only on the Sales and Card Stacking rails (owner call 2026-08-28). The proof checks the count, the funding total on those two rails, none on the other five, and the exact drop request. The row text should be fixed in the map. Not a product bug. Left attached on purpose: the proof goes red if the owner's call is undone.
5. **Content admin: Clear leaves the old file's title.** Pick a file, Clear, pick another: the Title box still holds the first file's name. Small. Not tied to a row.
6. **Lenders: one Apply press can start two proxy sessions.** `proxy-apply.js` binds every `data-fh-apply` button when the page finishes loading, and `lenders.html` also binds its own handler to each Apply button it draws. If the list is drawn before the page finishes loading, one press sends two `/api/proxy/launch` requests. Both Apply rows left NOT_PROVED.
7. **Banks: the staff plan forms are switched on by a client id in the address, not by the person's role.** In `money-banks.js` the page draws the staff forms when `?client_id=` is present. A signed-in client who types `?client_id=` sees all ten staff plan controls (measured). The server is the real gate for what they can save (not checked here). The row "Page gate: ... only staff see plan controls" says staff only, so it was returned to NOT_PROVED instead of left green. The other Banks rows prove the controls work and that a client on their own file sees none.
8. **Agent editor: the saved "Escalate to" person can be lost when the staff list answers after the agent row.** In `public/app/agent-editor.html`, `select()` runs `setSelectOrFirst('a_esc', cur.esc)` as soon as the agent row loads. If the staff list has not filled the picker yet, the saved value has no option to land on, comes back empty, and is written back into `cur.esc`; `fillPeople()` then keeps the empty value. Seen as `#a_esc` staying empty for 20 seconds in the proof run above. Leftover card only: not an S4 row, not fixed here.

## What I ran

- Row tables, claims, lines: every claim is inside its own callback (a scan of every `proof.check(` found no callback without an assert or a call to a function that asserts). No S4 file is over 400 lines (largest: `s4-pipeline-board.test.mjs`, 331).
- Break checks: 35 product breaks across 26 product files, one at a time, each restored after its run (git status clean). Every one turned the matching proof RED. They cover: banks staff controls shown to a client; plan Mark missed on a pin that allows only done; vault rejected label, staff view without a client id, sort form without months, expired View link followed; declines 10 letters enough and SSN not masked; trends Try again does nothing; credit change line lost; transfers every approval "practice run"; finance-os note always shown; brand-studio partner offered Verify and technical voice missing; closer-call boxes swapped and key 5 wrong; documents Void to everyone; csm post asks mid questions; messaging hidden tab reads; accounts no sign-in redirect; pipeline funding on every rail and a drop to the wrong stage; content-admin price in dollars; contracts box signer lost; helper polls every 10 seconds and never; frame trends script missing; soft-pull link with no signature and no-server sentence; contract sign without the typed name; payments Talk to a person; consent method always typed; lenders hold minutes as text and save to the wrong row; affiliates SMS consent never sent. The script is not kept.
- Every S4 test file alone, 10 times each: 27 of 27 files, 270 runs, all pass. The three files I changed afterwards (frame, soft-pull approval, Brand Studio) alone 10 times each again: 30 of 30.
- All S4 files at once, 3 times before the last edits and 3 times after: 118 tests each time, 118 pass, 6 of 6 runs (48 to 60 seconds each).
- `npm run lint`: clean (3485 files).
- Catalog and lane suites (`src/pulse/catalog/**`, `gap-catalog*`, `gap-door-batch*`): 1371 tests, 1370 pass, 1 fail. The one failure is the focused proof test "runs every executable test named by every case", and it fails on a nested browser spec that is not an S4 file (see the next paragraph). No S4 test failed in any run. No test was skipped.
- **The focused proof test is flaky under load, on unmodified main too.** Runs of that one test: (1) with S4 and no queue: failed, `e2e/agent-editor-promote-demote.spec.mjs:88` waited 5 seconds for `#a_esc` and took 6.7 seconds; (2) inside the 84-file run: failed, same spec (test 8), same wait; (3) alone, with the queue: failed, the reviewed-read run of the same spec, `#a_esc` still empty after 20 seconds; (4) on a clean checkout of `origin/main` (7d33780fa, no S4 files): failed too, on a different test, "Display EF/Public wave 2" (a careers retry row not exercised in time). Load average was 20 to 100 on 10 cores each time, from the other builders' suites. That spec alone, 10 times: 10 of 10 pass. `display-batch-staff-ui.test.mjs` alone passes (536 seconds). I did not touch the spec: a longer wait did not help (run 3), because the cause is a race in the page (finding 8), not a short timer.

## Environment note

A bare git worktree has no `node_modules`. `display-batch-staff-ui.test.mjs` and `read-reviewed-e2e.test.mjs` fail there for that reason alone ("Playwright CLI is not installed"). Link `node_modules` from the main checkout to run them. This machine was running five builders' suites at once while I measured (load average 20 to 60 on 10 cores), which is the setting the flake showed up in.
