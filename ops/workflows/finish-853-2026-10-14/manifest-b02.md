# Finish the 853 — batch 02 manifest (tier 1, lane gap-catalog-display, 14 money rows)

Builder: Sonnet, generation 1. Branch `fin/b02`, built from `fin/base` (`2f4f574a0`). Not pushed, not merged.

## The numbers

| | Rows |
|---|---|
| Rows in batch 02 | 14 |
| `openBefore` (NOT_PROVED in this batch, `count-not-proved.mjs` on `fin/base`) | 14 |
| `openAfter` (same script, this branch) | 2 |
| All four lanes together | 853 before, 841 after |

Outcomes: 7 live checks, 5 practice tests, 0 verified N/A, 2 not attachable.

## Every row

| # | Row (control) | Outcome | What judges it |
|---|---|---|---|
| 1 | present.html 'Send soft pull ($32 + approval form)' | live-check | contract `deck-soft-pull-send` in `fin-b02-display-contracts.mjs`. Reads `messages` (`staff:soft-pull-send:<link id>`), `payment_links`, `clients`. Red when the pay link is missing, not diagnostic, not the catalog $32, on another client, or the email has no address or is not an email, or the client has a phone and no text row (`staff:soft-pull-sms:<link id>`) was written. Screen half (one press, one request, held off for a second press, refusal said in words): `fin-b02-present-buttons.test.mjs`. |
| 2 | present.html bridge button (S-19) | practice-test | `fin-b02-present-buttons.test.mjs` (Bridge button, 3 tests) |
| 3 | present.html Descent ladder, 6 buttons | practice-test | `fin-b02-present-buttons.test.mjs` (Descent ladder, 4 tests; all 36 from-to pairs; route buttons after every rung) |
| 4 | present.html 'Amount paid today' box | live-check | contract `repair-amount-paid`. Reads `repair_programs` joined to non-demo `clients`. Red when amount paid is negative or above the price, or the round cap does not match the program (trial 2, full 6). |
| 5 | present.html Route the call (S-07) buttons | practice-test | `fin-b02-present-buttons.test.mjs` (Route the call, 3 tests) |
| 6 | present.html S-23 'Sale motion' select | live-check | contract `deck-sale-motion`. Reads `messages` (`staff:pay-link-send:<link id>`) and `payment_links`. Red when a primary offer's link carries a motion, a non-primary offer's link carries none, or the link is missing or on another client. Screen half (select drawn only for non-primary offers, pick sent, never sent for primary offers): `fin-b02-present-buttons.test.mjs` (Sale motion select, 2 tests). |
| 7 | products-commissions.html Ledger table | not-attachable | see "Not attachable" |
| 8 | money-next.html Do task | live-check | the existing `do-task` SQL (`DO_TASK_SQL`, money_agent_log joined to money_agent_tasks) now also owns this exact control text, with `emptyAs: "quiet"`. Tested through `fin-b02-live-contracts.test.mjs` ("do task", 7 tests). The page half is already held by `src/http/money-next-screen.test.mjs`. |
| 9 | money-transfers.html Open the page; 401 sends to sign-in | practice-test | `fin-b02-transfers-open.test.mjs` (7 tests: client read with token and no client id, staff read with `?client_id=`, back link and nav keep it, 401 to `/portal-login.html` or `/login.html?next=`, 403/500/503 never sign out) |
| 10 | ops-admin.html email_invoice_backlog (server) | live-check | contract `invoice-backlog-email`. Reads `invoices` and `messages`. Red when an invoice is stamped emailed with no linked message, the message is another client's, not an email, or has no address, or the client was emailed (`invoice:<id>:sent`) but the invoice still reads never emailed. "Bounded to 200" is held by `src/http/s2-message-routes-outbound.test.mjs` ("the bound is 200"); `fin-b02-live-contracts.test.mjs` pins that the test and the handler line are still there. |
| 11 | pipeline.html Card Stacking 'Funded' column | live-check | contract `card-stacking-funded-column`. Reads `cards`, `pipelines`, `pipeline_stages`, `funding_rounds`, `events`. Red when a card entered Funded in the last 60 days and the client has no funded round with a positive amount, or no `round.funded` receipt. Screen half (count, funding est., the amount box, exact move, Cancel and empty send nothing): `fin-b02-funded-column.test.mjs` (Chromium). |
| 12 | sales-floor.html Hero (deposits, booked, held, rate and target bar) | not-attachable | see "Not attachable" |
| 13 | sales-floor.html Page open: the whole floor + write on a GET | practice-test | `fin-b02-sales-floor-open.test.mjs`: Chromium paints all nine panels from one fake read; and `listRecentRecordings` is run against a stand-in database with the real column names (attach by unique name, stamp the latest call without a recording, leave ambiguous, unnamed and already attached files alone, never cross companies, second read changes nothing). |
| 14 | soft-pull-approve.html 'I agree - submit soft-pull approval' | live-check | contract `soft-pull-approve-submit`. Reads `client_consents` (typed, client, not withdrawn), `clients`, `accounts`, `pii_identity`, `payment_links`, `businesses`, `account_magic_links`. Red when the consent has no named client account, blank words, version or name, no identity (SSN and DOB), no diagnostic link at all, an open link that is not $32 + $10 per saved business, or no issued sign-in link. Page half: `s4-soft-pull-approve.test.mjs` already presses the submit and holds the exact request. |

All live checks are `emptyAs: "quiet"` with a 60-day window on message, invoice, card and consent rows (repair programs are small and judged all-time), so an unused control is green with "no saved results yet" and goes red on the first wrong result.

## Not attachable (2), with the exact missing piece

| Row | Why | What a product change must do |
|---|---|---|
| Ledger table (date, person, client, product, rule version, basis, rate, payout, status) | `public/app/products-commissions.html` `ledgerFromApi` (about line 1032) and `ledgerFromApiLive` (about line 747) set `client: "—"`, `rule: "—"` and `ver: ""` for every row, so two of the nine named columns can never show a value. The read behind it (`api/read/commissions.mjs`) returns `client_id` but no client name or code and no `rule_id` or `rule_snapshot`. | Return client name and rule version from `api/read/commissions.mjs` and paint them in both functions. Until then no test can show "client" or "rule version" on the table. |
| Hero: 'Today' deposits, booked and held, 'Funded, not just sold' rate and target bar | The target bar has no target and is never drawn: `src/sales/metrics.mjs` `salesFloor()` sets `today.target_cents: null` with a constant reason string (there is no daily deposit target to read), and `public/app/sales-floor.js` line 227 to 228 sets the bar width to `"0%"` every time. The other half of the row (deposits, booked, held, rate) is painted and is held by row 13's test and by `e2e/s1-sales-floor.spec.mjs`. | Give the sales team a daily deposit target the read can return, and draw the bar from it. Then add the bar to the page test. |

## Files added

- `src/pulse/catalog/proofs/fin-b02-display-contracts.mjs` — the six new contracts, the row lists, and the live and practice cases.
- `src/pulse/catalog/proofs/fin-b02-sql-kit.mjs` — test kit: reads the real table and column names from `db/schema` and `db/migrations`, builds an in-memory SQLite stand-in with those columns, runs a contract's exact SQL text (`$1`, `::casts`, `BTRIM`, `now() - interval 'N days'` spelled for SQLite), and a node-postgres-shaped adapter for running a real module against it. Tests only.
- `src/pulse/catalog/proofs/fin-b02-live-contracts.test.mjs` — 73 tests, no browser.
- `src/pulse/catalog/proofs/fin-b02-present-buttons.test.mjs` — 15 tests, runs `public/app/present.js` in a vm.
- `src/pulse/catalog/proofs/fin-b02-transfers-open.test.mjs` — 7 tests, runs `public/app/money-transfers.js` in a vm.
- `src/pulse/catalog/proofs/fin-b02-funded-column.test.mjs` — 3 tests, Chromium, uses the S4 harness.
- `src/pulse/catalog/proofs/fin-b02-sales-floor-open.test.mjs` — 6 tests, 2 in Chromium and 4 on the stand-in database.
- `ops/workflows/finish-853-2026-10-14/manifest-b02.md` — this file.

## Shared lines touched (the integrator merges these)

| File | Change |
|---|---|
| `src/pulse/catalog/proofs/display-saved-result.mjs` | 1 import line (`FIN_B02_RESULT_CONTRACTS`). `query()` takes a fifth argument `extra = {}` spread into the contract (so a contract can say `emptyAs`). One added entry for the control `Do task (per step the money helper or a person can do)` that reuses `DO_TASK_SQL` with `{ emptyAs: "quiet" }`. One spread line `...FIN_B02_RESULT_CONTRACTS,` at the end of `DISPLAY_RESULT_CONTRACTS`. |
| `src/pulse/catalog/proofs/display-proof-cases.mjs` | 1 import line and 1 spread line `...FIN_B02_DISPLAY_CASES,` at the end of `PLUGIN_DISPLAY_PROOF_CASES`. |
| `scripts/pulse/compile-catalog.mjs` | 1 import line and `staffProofCases: [...STAFF_UI_PROOF_CASES, ...FIN_B02_LIVE_CASES]` (a row only becomes a lane-judged result case if it is in this list). |
| `src/pulse/coverage/gap-catalog-display.test.mjs` | Guard numbers: contracts and cases 40 to 47 (title, three asserts, unique controls, and the shipped-data test), pass-capable 27 to 34, SQL batches 27 to 33 (the do-task SQL is shared), `db.calls` 27 to 33, focused PASS rows 27 to 34. My increase: +7, +7, +6. Always-red stays 13. |
| `src/pulse/catalog/proofs/display-proof-cases.test.mjs` | `redCount` 672 to 661 (my decrease: 11; the ops-admin row was already not red in that count). If other batches also move it, add the decreases and use the number the test prints. |
| `src/pulse/catalog/generated.json` | Recompiled with `npm run pulse:catalog`. Conflicts are expected; recompile after merging, do not hand-merge. |

Row ids that left the lane's tracking list: the 5 practice rows (rows 2, 3, 5, 9, 13) are proved directly and no longer appear in `DISPLAY_TRACKING_CASES` (710 on `fin-b02`'s base, 705 now).

## Product findings (not fixed)

1. Ledger table: Client and Rule version are hard-coded dashes, and the read does not return them (row 7).
2. Sales floor: `today.target_cents` is always null and the hero bar is always 0% (row 12).
3. Sales floor read writes on a GET (`listRecentRecordings` updates `brain_files` and `call_outcomes.recording_url`). Already finding 6 in slice 1; now covered by a practice test but still a write on a read.
4. Descent ladder: on a deck whose engine tier is REPAIR_ONLY, the "Funding" rung changes nothing (`isFunding()` also needs a funding tier), and the pay link still goes out for REPAIR_DFY with route REPAIR_ONLY. The ladder proof holds the Funding rung on funding-tier decks only.
5. Ops & Admin "Email unsent invoices" sends no limit, so one press emails at most 50, while the row and the confirm text promise every invoice; 200 is only the cap if a caller sends a limit.
6. `enrollRepairProgram` (`src/repair/enroll.mjs`) accepts an amount paid above the price. The new live check goes red on such a row; nothing stops one being saved.
7. The soft-pull email tells the client "optionally add businesses ($10 each, up to 5)" while the approval form allows 20 (`SOFT_PULL_MAX_BUSINESSES`). Same note as in the map evidence.
8. Pipeline Funded column: after a drop the column's money label is redrawn as "$X est." instead of "$X funding est." (the page's own `bump` helper). The funded-column test holds the number only.

## Commands run

All from the worktree `.claude/worktrees/fin-b02`, no database, no network.

- `node scripts/pulse/count-not-proved.mjs` before: total 853, 14 of 14 batch rows open. After: total 841, 2 of 14 open (rows 7 and 12).
- `npm run pulse:catalog` and `node scripts/pulse/compile-catalog.mjs --check`: clean.
- `node --test` on the five new test files: 73, 15, 7, 3 and 6 tests, all pass.
- `node --test src/pulse/catalog/*.test.mjs src/pulse/coverage/gap-catalog-*.test.mjs src/pulse/coverage/gap-door-batch*.test.mjs` plus the three fast new files: 171 tests, 171 pass.
- `node --test src/pulse/*.test.mjs src/pulse/coverage/modules.test.mjs`: 716 pass (the `.pg.test.mjs` files skip: no `DATABASE_URL` in this shell).
- `node --test src/pulse/catalog/proofs/display-contracts-*.test.mjs` and the door and flow contract tests that read `generated.json`: 215 pass.
- `node --test src/pulse/catalog/proofs/display-proof-cases.test.mjs` (the focused run that executes every test named by every case, browser ones included), twice:
  - on `ec6010f37` (before the funded-column and sales-floor tests were added to the cases): 3 of 3 pass, 12 minutes 41 seconds.
  - on `054bb36e7` (final case list): tests 1 and 2 pass. Test 3 fails on ONE nested test and nothing else: `e2e/teleprompter-touch.spec.mjs:715` "volume buttons, no finger on the glass" (379 of 380 browser tests passed, 764 seconds). That spec is not in this batch and I touched no teleprompter file. The slice 4 manifest recorded the same test failing under load on clean `origin/main` ("373 of 374 passed"). All five new `fin-b02-*` test files passed inside that run.
- `npm run lint`: 3,569 files parse clean.

## Break checks (each break made alone, test run, file put back, `git status` clean)

- Live SQL (`fin-b02-display-contracts.mjs`): 24 breaks (a leg or condition removed from each of the six contracts, plus the company condition replaced by `$1 IS NOT NULL` in each): 24 of 24 red, and the six company breaks red on the "another company's wrong result" test.
- `public/app/present.js`: 27 breaks (bridge tier, slide, force_repair and education reset; each rung's flags and rung number; ladder row removed and price label; route button list and `setTier`; primary offer set; sale motion never sent, sent for primary, pick never remembered, select drawn for primary, Upsell option removed; soft pull held-off guard, wrong action, claims sent on refusal): 26 red. One stayed green on purpose: the bridge's `state.edu = false` cannot be reached, because the button is not drawn while education is on.
- `public/app/money-transfers.js`: 12 breaks (both sign-in targets swapped, next drops the query, staff-by-client-id ignored, client role counted as staff, 401 not redirected, 403 redirected, client id dropped from the read, token not sent, back link and nav not keeping the client, staff form shown to a client): 12 of 12 red.
- `public/app/pipeline.html` Funded drop: 5 breaks (amount never sent, amount box skipped, Cancel and empty still send, wrong stage posted): 5 of 5 red.
- `public/app/sales-floor.js` and `src/sales/recordings.mjs`: 20 breaks (hero deposits source, belief hot rules and bars and last-period text, sources cap and unknown and close rate, non-https and non-Drive links, unmatched label, words label, cold days, discipline chip; attach company condition, ambiguous match, stamp overwrite, stamp on the oldest call, re-attach of an attached file, recent-client and file-list company conditions). 15 red on the first pass; 5 stayed green and were fixed by new fixtures (a belief that grew but is under three, an http link on a Drive host, a duplicate file id in another company, a client whose latest call already has a recording, a cross-company call). All 5 red after the fix.
- `public/app/present.js` vm tests were first written with four gaps (bridge education reset, Funding rung from education, a rung that did not jump to S-19, route button keeping a descent pick). All closed with the 36-pair matrix and a rung-then-route matrix.

## Left undone, for the next generation

- Rows 7 and 12 need a product change (see above). Nothing else in batch 02 is open.
- The focused proof run is slow under load (12 to 13 minutes on this Mac with other builders running) and `e2e/teleprompter-touch.spec.mjs:715` is a known load flake inside it. Re-run it after merging and read that one test alone if it fails again.
- A live check on production data could not be run (no database access by design). The SQL is judged only on stand-in rows with real column names. If a column holds values the stand-in did not model (for example `messages.provider_ref` prefixes written by another path), a first red on live would be a finding, not a surprise to be hidden.
