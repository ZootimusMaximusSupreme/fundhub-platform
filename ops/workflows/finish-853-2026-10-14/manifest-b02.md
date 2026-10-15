# Finish the 853 — batch 02 manifest (tier 1, lane gap-catalog-display, 14 money rows)

Builder: Sonnet, generation 1 built rows 1 to 11, 13 and 14. Generation 2 (this file's last pass) challenged the two
rows generation 1 left open (rows 7 and 12). Branch `fin/b02`, built from `fin/base` (`2f4f574a0`). Not pushed, not merged.

## The numbers

| | Rows |
|---|---|
| Rows in batch 02 | 14 |
| `openBefore` (NOT_PROVED in this batch, `count-not-proved.mjs` on `fin/base`) | 14 |
| `openAfter` (same script, this branch, after generation 2) | 1 |
| All four lanes together | 853 before, 840 after |

Generation 1 left 2 open (841 in all four lanes). Generation 2 attached one of them (row 12, the hero) and
kept one as not attachable after a real challenge (row 7, the ledger table).

Outcomes: 8 live checks, 5 practice tests, 0 verified N/A, 1 not attachable.

## Every row

| # | Row (control) | Outcome | What judges it |
|---|---|---|---|
| 1 | present.html 'Send soft pull ($32 + approval form)' | live-check | contract `deck-soft-pull-send` in `fin-b02-display-contracts.mjs`. Reads `messages` (`staff:soft-pull-send:<link id>`), `payment_links`, `clients`. Red when the pay link is missing, not diagnostic, not the catalog $32, on another client, or the email has no address or is not an email, or the client has a phone and no text row (`staff:soft-pull-sms:<link id>`) was written. Screen half (one press, one request, held off for a second press, refusal said in words): `fin-b02-present-buttons.test.mjs`. |
| 2 | present.html bridge button (S-19) | practice-test | `fin-b02-present-buttons.test.mjs` (Bridge button, 3 tests) |
| 3 | present.html Descent ladder, 6 buttons | practice-test | `fin-b02-present-buttons.test.mjs` (Descent ladder, 4 tests; all 36 from-to pairs; route buttons after every rung) |
| 4 | present.html 'Amount paid today' box | live-check | contract `repair-amount-paid`. Reads `repair_programs` joined to non-demo `clients`. Red when amount paid is negative or above the price, or the round cap does not match the program (trial 2, full 6). |
| 5 | present.html Route the call (S-07) buttons | practice-test | `fin-b02-present-buttons.test.mjs` (Route the call, 3 tests) |
| 6 | present.html S-23 'Sale motion' select | live-check | contract `deck-sale-motion`. Reads `messages` (`staff:pay-link-send:<link id>`) and `payment_links`. Red when a primary offer's link carries a motion, a non-primary offer's link carries none, or the link is missing or on another client. Screen half (select drawn only for non-primary offers, pick sent, never sent for primary offers): `fin-b02-present-buttons.test.mjs` (Sale motion select, 2 tests). |
| 7 | products-commissions.html Ledger table | not-attachable | see "Not attachable". Generation 2 ran the real page with the real read shape: a row that paid $150 draws Client `—`, Rule version `—`, Basis `$0`, Rate `100%`. Four of nine named columns are wrong, not two. |
| 8 | money-next.html Do task | live-check | the existing `do-task` SQL (`DO_TASK_SQL`, money_agent_log joined to money_agent_tasks) now also owns this exact control text, with `emptyAs: "quiet"`. Tested through `fin-b02-live-contracts.test.mjs` ("do task", 7 tests). The page half is already held by `src/http/money-next-screen.test.mjs`. |
| 9 | money-transfers.html Open the page; 401 sends to sign-in | practice-test | `fin-b02-transfers-open.test.mjs` (7 tests: client read with token and no client id, staff read with `?client_id=`, back link and nav keep it, 401 to `/portal-login.html` or `/login.html?next=`, 403/500/503 never sign out) |
| 10 | ops-admin.html email_invoice_backlog (server) | live-check | contract `invoice-backlog-email`. Reads `invoices` and `messages`. Red when an invoice is stamped emailed with no linked message, the message is another client's, not an email, or has no address, or the client was emailed (`invoice:<id>:sent`) but the invoice still reads never emailed. "Bounded to 200" is held by `src/http/s2-message-routes-outbound.test.mjs` ("the bound is 200"); `fin-b02-live-contracts.test.mjs` pins that the test and the handler line are still there. |
| 11 | pipeline.html Card Stacking 'Funded' column | live-check | contract `card-stacking-funded-column`. Reads `cards`, `pipelines`, `pipeline_stages`, `funding_rounds`, `events`. Red when a card entered Funded in the last 60 days and the client has no funded round with a positive amount, or no `round.funded` receipt. Screen half (count, funding est., the amount box, exact move, Cancel and empty send nothing): `fin-b02-funded-column.test.mjs` (Chromium). |
| 12 | sales-floor.html Hero (deposits, booked, held, rate and target bar) | live-check | contract `sales-floor-hero-deposits` in `fin-b02-display-contracts.mjs` (tested in `fin-b02-hero-live.test.mjs`, 16 tests). Reads `call_outcomes` (every `outcome = 'deposit'` the hero counts), `transactions`, `clients`, `funding_rounds`, `funding_closeout`. Red when a deposit has no cash, the payment belongs to another client, no payment is linked, the payment was refunded or failed, the cash is not what the payment was, one payment is used by two deposits, or the client has a funded round but reads not funded and has no closeout (the rate would miss it). Screen half: `fin-b02-hero-bar.test.mjs` (4 tests, Chromium): the four numbers, a dash and never a zero for a number the read could not give, and an empty bar with the words "no daily target". See "The target bar" below for what is and is not held. |
| 13 | sales-floor.html Page open: the whole floor + write on a GET | practice-test | `fin-b02-sales-floor-open.test.mjs`: Chromium paints all nine panels from one fake read; and `listRecentRecordings` is run against a stand-in database with the real column names (attach by unique name, stamp the latest call without a recording, leave ambiguous, unnamed and already attached files alone, never cross companies, second read changes nothing). |
| 14 | soft-pull-approve.html 'I agree - submit soft-pull approval' | live-check | contract `soft-pull-approve-submit`. Reads `client_consents` (typed, client, not withdrawn), `clients`, `accounts`, `pii_identity`, `payment_links`, `businesses`, `account_magic_links`. Red when the consent has no named client account, blank words, version or name, no identity (SSN and DOB), no diagnostic link at all, an open link that is not $32 + $10 per saved business, or no issued sign-in link. Page half: `s4-soft-pull-approve.test.mjs` already presses the submit and holds the exact request. |

All live checks are `emptyAs: "quiet"` with a 60-day window on message, invoice, card and consent rows (repair programs are small and judged all-time), so an unused control is green with "no saved results yet" and goes red on the first wrong result.

## Not attachable (1), with the exact missing piece

| Row | Why | What a product change must do |
|---|---|---|
| Ledger table (date, person, client, product, rule version, basis, rate, payout, status) | Generation 2 re-read the page and the read, then opened the real page in Chromium with the exact shape `api/read/commissions.mjs` returns (scratch script, not committed). One earned row paying $150 was drawn as: Date `2026-10-02`, Person `Casey Reed`, Client `—`, Product `Funding Bundle`, Rule version `—`, Basis `$0`, Rate `100%`, Payout `$150`, Status `Accrued`. Four of nine columns are wrong. (1) Client and Rule version: `ledgerFromApi` (about line 1032) and `ledgerFromApiLive` (about line 747) hard-code `client: "—"`, `rule: "—"`, `ver: ""`. The read selects `client_id` but no client name or code, and no `rule_id` or `rule_snapshot`. (2) Basis: both functions do `Number(r.basis) \|\| 0`, but `commission_ledger.basis` is the text `front_end` or `back_end` (migration 014 CHECK), so it is always `$0`. The dollars the rate applied to are `base_amount`, which the read does not select. (3) Rate: both functions paint `split_percent`, the share between people (default 100, `src/commissions/calculate.mjs` `applySplit`), not the commission rate. The rate is inside `rule_snapshot`, which the read does not select. Date, Person, Product, Payout and Status are right. No saved-row read can go red for a display that is wrong on every row, and a test of the real table cannot go green honestly. | Make `api/read/commissions.mjs` return client name, `base_amount` and the rule version and rate (from `rule_snapshot`, or a join on `commission_rules`), then paint those in both page functions. The existing spec `e2e/products-commissions-ledger.spec.mjs` feeds `basis: "3000.00"`, which is not what the read returns, so it needs a real-shape row in the same change. After that, this row can take a practice test. |

The row text in `display-saved-result.mjs` (the line the morning report prints for this row) now names all four wrong
columns, not only the two dashes.

## The target bar (row 12)

The row names a "target bar". What exists today: `src/sales/metrics.mjs` `salesFloor()` sets `today.target_cents` to
`null` with the fixed words "No daily deposit target has been set for the sales team yet." (no daily target exists in
`staff_targets` or anywhere else), and `public/app/sales-floor.js` (about lines 227 to 228) sets the bar to `0%` on every
paint and prints that reason under it. The words are true, so the screen half pins them: an empty bar and the reason, and
no dollar figure the read did not give. What is NOT held, because it does not exist: a bar that follows a target. If a
daily target is ever added to the read, this row must be judged again; the page would ignore it today.

The row is a `live-check` for what has a result to judge (the deposits behind "Today" and the funded rate). The bar has
nothing to judge. This is a deliberate split, said here so the morning report line is not read as "the bar follows a
target".

## Files added

- `src/pulse/catalog/proofs/fin-b02-display-contracts.mjs` — the seven new contracts (six from generation 1, the hero from generation 2), the row lists, and the live and practice cases.
- `src/pulse/catalog/proofs/fin-b02-sql-kit.mjs` — test kit: reads the real table and column names from `db/schema` and `db/migrations`, builds an in-memory SQLite stand-in with those columns, runs a contract's exact SQL text (`$1`, `::casts`, `BTRIM`, `now() - interval 'N days'` spelled for SQLite), and a node-postgres-shaped adapter for running a real module against it. Tests only.
- `src/pulse/catalog/proofs/fin-b02-live-contracts.test.mjs` — 73 tests, no browser.
- `src/pulse/catalog/proofs/fin-b02-present-buttons.test.mjs` — 15 tests, runs `public/app/present.js` in a vm.
- `src/pulse/catalog/proofs/fin-b02-transfers-open.test.mjs` — 7 tests, runs `public/app/money-transfers.js` in a vm.
- `src/pulse/catalog/proofs/fin-b02-funded-column.test.mjs` — 3 tests, Chromium, uses the S4 harness.
- `src/pulse/catalog/proofs/fin-b02-sales-floor-open.test.mjs` — 6 tests, 2 in Chromium and 4 on the stand-in database.
- `src/pulse/catalog/proofs/fin-b02-hero-live.test.mjs` — 16 tests, no browser (generation 2). The hero's live check, run as its exact SQL text on a stand-in database with the real column names.
- `src/pulse/catalog/proofs/fin-b02-hero-bar.test.mjs` — 4 tests, Chromium (generation 2). The hero's numbers, dashes and empty bar.
- `ops/workflows/finish-853-2026-10-14/manifest-b02.md` — this file.

## Shared lines touched (the integrator merges these)

| File | Change |
|---|---|
| `src/pulse/catalog/proofs/display-saved-result.mjs` | 1 import line (`FIN_B02_RESULT_CONTRACTS`). `query()` takes a fifth argument `extra = {}` spread into the contract (so a contract can say `emptyAs`). One added entry for the control `Do task (per step the money helper or a person can do)` that reuses `DO_TASK_SQL` with `{ emptyAs: "quiet" }`. One spread line `...FIN_B02_RESULT_CONTRACTS,` at the end of `DISPLAY_RESULT_CONTRACTS`. Generation 2: the `requirement` string of the existing `gap(...)` entry for `Ledger table (date, person, client, product, rule version, basis, rate, payout, status)` now names all four wrong columns (words only; the row stays not proved). |
| `src/pulse/catalog/proofs/display-proof-cases.mjs` | 1 import line and 1 spread line `...FIN_B02_DISPLAY_CASES,` at the end of `PLUGIN_DISPLAY_PROOF_CASES`. |
| `scripts/pulse/compile-catalog.mjs` | 1 import line and `staffProofCases: [...STAFF_UI_PROOF_CASES, ...FIN_B02_LIVE_CASES]` (a row only becomes a lane-judged result case if it is in this list). |
| `src/pulse/coverage/gap-catalog-display.test.mjs` | Guard numbers: contracts and cases 40 to 48 (title, three asserts, unique controls, and the shipped-data test), pass-capable 27 to 35, SQL batches 27 to 34 (the do-task SQL is shared), `db.calls` 27 to 34, focused PASS rows 27 to 35. My increase: +8, +8, +7. Always-red stays 13. (Generation 1 had 47 / 34 / 33 / 33 / 34; generation 2 added the hero: +1 each, SQL batches and `db.calls` +1.) |
| `src/pulse/catalog/proofs/display-proof-cases.test.mjs` | `redCount` 672 to 660 (my decrease: 12; the ops-admin row was already not red in that count; generation 1 left it at 661, the hero row took it to 660). If other batches also move it, add the decreases and use the number the test prints. |
| `src/pulse/catalog/proofs/fin-b02-live-contracts.test.mjs` | One number: `FIN_B02_LIVE_ROWS.length` 7 to 8 (my own batch's file, not shared). |
| `src/pulse/catalog/generated.json` | Recompiled with `npm run pulse:catalog`. Conflicts are expected; recompile after merging, do not hand-merge. |

Row ids that left the lane's tracking list: the 5 practice rows (rows 2, 3, 5, 9, 13) are proved directly and no longer appear in `DISPLAY_TRACKING_CASES` (710 on `fin-b02`'s base, 705 now).

## Product findings (not fixed)

1. Ledger table (row 7), corrected and widened in generation 2: Client and Rule version are hard-coded dashes, Basis is always `$0` (`Number("front_end") || 0`; the real dollars are `base_amount`, not read) and Rate paints `split_percent` (the share between people), not the commission rate. The read selects none of `base_amount`, `rule_id`, `rule_snapshot`, client name. `e2e/products-commissions-ledger.spec.mjs` feeds `basis: "3000.00"`, a shape the read never returns, so its green hid this.
2. Sales floor hero bar (row 12): `today.target_cents` is always null and the bar is always 0% (the page ignores any target). The read also returns `hero.cash_cents` and `hero.target_cents` and the page paints neither. `hero.target_cents` is `staff_targets.target_value * 100`, but that metric is a COUNT of deposits (the closer path says so), so if it were ever painted it would read "$20" for 20 deposits.
2b. Sales floor counts demo calls: `floorFunnel`, `floorFunnelDay` and `depositToFunded` in `src/sales/metrics.mjs` have no `is_demo` filter (the closer stats query does). The new live check skips demo rows on purpose, so it cannot see this.
2c. `logCallOutcome` (`src/sales/call-outcomes.mjs`) saves a `deposit` with cash 0 and no transaction when no paid payment is found in the last 48 hours, and cash is never editable after. The hero then counts a deposit nobody paid. This is what the new hero live check goes red on; nothing stops one being saved.
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
  - on `054bb36e7` (final case list): tests 1 and 2 pass. Test 3 fails on ONE nested test and nothing else: `e2e/teleprompter-touch.spec.mjs:715` "volume buttons, no finger on the glass" (379 of 380 browser tests passed, 764 seconds). That spec is not in this batch and I touched no teleprompter file. Run alone it passes (2 of 2 in this folder). The slice 4 manifest recorded the same test failing under load on clean `origin/main` ("373 of 374 passed"). All five new `fin-b02-*` test files passed inside that run.
- `npm run lint`: 3,569 files parse clean.

## Generation 2: commands and breaks (rows 7 and 12)

All from the worktree `.claude/worktrees/fin-b02`, no database, no network.

- `node scripts/pulse/count-not-proved.mjs` at the start of generation 2: total 841, 2 of 14 batch rows open (rows 7 and 12). After: total 840, 1 of 14 open (row 7).
- `npm run pulse:catalog` and `node scripts/pulse/compile-catalog.mjs --check`: clean.
- `node --test src/pulse/catalog/proofs/fin-b02-hero-live.test.mjs`: 16 of 16 pass. `node --test src/pulse/catalog/proofs/fin-b02-hero-bar.test.mjs`: 4 of 4 pass.
- `node --test src/pulse/coverage/gap-catalog-display.test.mjs`: 11 of 11 pass (guard numbers above).
- `node --test` on the two quick `display-proof-cases.test.mjs` tests: 2 of 2 pass at `redCount` 660.
- `node --test src/pulse/catalog/*.test.mjs src/pulse/coverage/gap-catalog-*.test.mjs src/pulse/coverage/gap-door-batch*.test.mjs` plus `fin-b02-live-contracts`, `fin-b02-hero-live`, `fin-b02-transfers-open`, `fin-b02-present-buttons`: 187 of 187 pass (the focused display runner excluded by name).
- `npm run lint`: 3,571 files parse clean.
- The 55 proof test files with no browser, run together (1,473 tests): 1,472 pass, 1 fail. The one fail was `flow-result-proofs` "every test named by a flow proof passes", which timed out on `src/sales/closer-deck.test.mjs` while `npm run lint` ran beside it (load average 25 to 40). Alone: `flow-result-proofs.test.mjs` 9 of 9 pass (65 seconds), `src/sales/closer-deck.test.mjs` 27 of 27 pass. Same flake slice 1 recorded.
- The focused runner (`display-proof-cases.test.mjs`, "the focused proof test runs every executable test named by every case"), on commit `b72a3409d`, 651 seconds: one nested test failed, `s2-display-contracts` "the browser specs press every named control in a real page", with "http://127.0.0.1:46326/app/messaging.html is already used": another builder's server held the port the runner derives from its process id (`s2-run-specs.mjs`). Alone it passes (2 of 2, 2 minutes 50). All 16 `fin-b02-hero-live` and 4 `fin-b02-hero-bar` tests ran inside that run and passed. Every other nested test passed (no teleprompter flake this time).
- Ledger evidence (row 7): a scratch Chromium script (not committed, in the session scratchpad) opened `/app/products-commissions.html` with a read row in the exact shape `api/read/commissions.mjs` returns. Cells: `2026-10-02 | Casey Reed | — | Funding Bundle | — | $0 | 100% | $150 | Accrued`.

Breaks made alone, test run, file put back (`git status` clean after each loop):

- Hero SQL (`HERO_DEPOSITS_SQL`): 20 breaks (each of the six legs removed; shared-payment leg without the company, and one that counts a deposit against itself; funded leg off, funded leg ignoring the flag, any round status instead of `funded`, closeout excuse removed, closeout excuse not tied to the client; company, outcome (removed and wrong), demo outcome, demo client and 60-day window conditions removed; payment join without the company; `succeeded` dropped from the paid list). 2 stayed green on the first pass (the closeout excuse of another client, and the payment join without the company). Two tests were added for exactly those, then 20 of 20 red.
- `public/app/sales-floor.js` hero paint: 14 breaks (deposits from the funnel; null shown as zero; rate from the close rate; rate floors instead of rounds; booked and held swapped; held null as zero; reason dropped from the line; funded and deposits swapped in "x of y"; the no-count words changed; bar filled to 50%; bar tied to the rate; target mark printing "Target —"; mark fallback emptied; "Today" label changed): 14 of 14 red.

## Break checks, generation 1 (each break made alone, test run, file put back, `git status` clean)

- Live SQL (`fin-b02-display-contracts.mjs`): 24 breaks (a leg or condition removed from each of the six contracts, plus the company condition replaced by `$1 IS NOT NULL` in each): 24 of 24 red, and the six company breaks red on the "another company's wrong result" test.
- `public/app/present.js`: 27 breaks (bridge tier, slide, force_repair and education reset; each rung's flags and rung number; ladder row removed and price label; route button list and `setTier`; primary offer set; sale motion never sent, sent for primary, pick never remembered, select drawn for primary, Upsell option removed; soft pull held-off guard, wrong action, claims sent on refusal): 26 red. One stayed green on purpose: the bridge's `state.edu = false` cannot be reached, because the button is not drawn while education is on.
- `public/app/money-transfers.js`: 12 breaks (both sign-in targets swapped, next drops the query, staff-by-client-id ignored, client role counted as staff, 401 not redirected, 403 redirected, client id dropped from the read, token not sent, back link and nav not keeping the client, staff form shown to a client): 12 of 12 red.
- `public/app/pipeline.html` Funded drop: 5 breaks (amount never sent, amount box skipped, Cancel and empty still send, wrong stage posted): 5 of 5 red.
- `public/app/sales-floor.js` and `src/sales/recordings.mjs`: 20 breaks (hero deposits source, belief hot rules and bars and last-period text, sources cap and unknown and close rate, non-https and non-Drive links, unmatched label, words label, cold days, discipline chip; attach company condition, ambiguous match, stamp overwrite, stamp on the oldest call, re-attach of an attached file, recent-client and file-list company conditions). 15 red on the first pass; 5 stayed green and were fixed by new fixtures (a belief that grew but is under three, an http link on a Drive host, a duplicate file id in another company, a client whose latest call already has a recording, a cross-company call). All 5 red after the fix.
- `public/app/present.js` vm tests were first written with four gaps (bridge education reset, Funding rung from education, a rung that did not jump to S-19, route button keeping a descent pick). All closed with the 36-pair matrix and a rung-then-route matrix.

## Left undone, for the next generation

- Row 7 (the ledger table) needs a product change (see above). Nothing else in batch 02 is open.
- The hero's live check is judged on stand-in rows only. Two legs could fire on real data the stand-in did not model: a deposit logged before its payment landed (cash stays 0 and cannot be edited), and a client flagged funded by an old import. The first is the design's own break; the second is not judged (only the "funded round but flag false" direction is). A first red on live is a finding.
- The focused proof run is slow under load (12 to 13 minutes on this Mac with other builders running) and `e2e/teleprompter-touch.spec.mjs:715` is a known load flake inside it. Re-run it after merging and read that one test alone if it fails again.
- A live check on production data could not be run (no database access by design). The SQL is judged only on stand-in rows with real column names. If a column holds values the stand-in did not model (for example `messages.provider_ref` prefixes written by another path), a first red on live would be a finding, not a surprise to be hidden.

## Generation 3: independent re-check (no code change)

A fresh agent re-measured the branch at `8dbf564bf` and did not change any product or test file. Offline, no database,
no network.

- `node scripts/pulse/count-not-proved.mjs`: total 840. Of the 14 batch rows, 13 are gone from the list and 1 is open
  (the Ledger table, row 7). `openBefore` 14, `openAfter` 1.
- `node scripts/pulse/compile-catalog.mjs --check`: clean (3975 mapped, 3942 unique, 3919 wired, 23 red).
- `node --test` on `fin-b02-live-contracts`, `fin-b02-hero-live`, `fin-b02-transfers-open`, `fin-b02-present-buttons`
  and `gap-catalog-display.test.mjs`: 122 of 122 pass.
- `node --test` on `fin-b02-funded-column`, `fin-b02-sales-floor-open`, `fin-b02-hero-bar` (Chromium): 13 of 13 pass.
- `display-proof-cases.test.mjs` quick tests (case list and unmapped rows): 2 of 2 pass. The 12 minute focused runner
  was not re-run (other builders shared the machine; it passed alone in generation 1 and 2).
- `node --test` on the six catalog recipe and compiler tests plus `modules.test.mjs`: 57 of 57 pass.
- One fresh break: the `repair-amount-paid` contract with the full-program round cap leg removed. The test
  "amount paid today: a full program has the trial round cap goes red" went red (72 of 73). File put back.
- Row 7 challenged again: `public/app/products-commissions.html` still hard-codes `client: "—"` and `rule: "—"` in
  both `ledgerFromApi` and `ledgerFromApiLive`, still does `Number(r.basis) || 0` on the text `front_end` / `back_end`,
  and still paints `split_percent` as the rate. `api/read/commissions.mjs` still selects no client name, no
  `base_amount`, no `rule_snapshot` or `rule_id`. A check that judges saved rows would be red on every real row by
  construction and could never go green after a fix without being rewritten, so it would not be a result check. Left as
  not attachable.

## Generation 4 (workflow generation 2 after resume): row 7 challenged a fourth time, still not attachable

No code or test change. Offline, no database, no network. Measured at `b63ef453b`.

- `node scripts/pulse/count-not-proved.mjs`: total 840. Of the 14 batch rows, 1 is open (the Ledger table). The 13 others
  stay off the list. Batch numbers from `fin/base`: `openBefore` 14, `openAfter` 1.
- Re-read the real handler and page, not the earlier notes:
  - `api/read/commissions.mjs` selects `id, staff_id, staff_name, employee_code, client_id, role, basis, amount, currency,
    status, split_percent, product_name_at_earning, earned_at, approved_at, paid_at, void_reason, created_at`. No client
    name, no `base_amount`, no `rule_id`, no `rule_snapshot`.
  - `public/app/products-commissions.html` `ledgerFromApiLive` (line 747) and `ledgerFromApi` (line 1032) still hard-code
    `client: "—"`, `rule: "—"`, `ver: ""`, still run `Number(r.basis) || 0` on the text `front_end` / `back_end`
    (migration 014 CHECK), and still paint `split_percent` as the rate.
  - `e2e/products-commissions-ledger.spec.mjs` lines 20 to 22 still feed `basis: "3000.00"`, a value the read never
    returns.
  - No other `fin/*` branch and not `main` changed `api/read/commissions.mjs`, `public/app/products-commissions.html` or
    that spec (checked with `git diff --name-only` against `fin/base`, all 27 branches and `main`).
- Options considered and why each fails the honest-outcome rule:
  1. A live check on saved `commission_ledger` rows: it would judge the saved rows (payout, status), not the table. It
     would stay green while four of nine columns on screen are wrong on every row. That is a false green.
  2. A check that runs the page's own mapper on a real-shape row and compares to the saved facts: it is red on every row
     today and cannot be written as a passing test without pinning the wrong paint. Pinning the wrong paint would be a
     test that is green when the product is wrong, which is not allowed.
  3. A practice test on the five correct columns only (date, person, product, payout, status): the row names nine
     columns. Attaching it would call a table with four wrong columns proved.
- Result: not-attachable, same reason, same four columns. Unblock is the product change already written above. When it
  lands, the row takes a practice test fed with a real-shape row (client name, `base_amount`, rule version, rate).
- Commands: `node scripts/pulse/compile-catalog.mjs --check` clean (3975 mapped, 3942 unique, 3919 wired, 23 red);
  `node --test` on `gap-catalog-display.test.mjs`, `fin-b02-live-contracts.test.mjs`, `fin-b02-hero-live.test.mjs`:
  100 of 100 pass. No new check was added, so no new break was needed.
