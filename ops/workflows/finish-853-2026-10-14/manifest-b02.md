# Finish the 853 — batch 02 manifest (tier 1, lane gap-catalog-display, 14 money rows)

Builder: Sonnet. Generation 1 built rows 1 to 11, 13 and 14. Generation 2 challenged rows 7 and 12. Generations 3 and 4
re-checked row 7. **Repair cycle 1 (this file's newest section)** fixed what an independent checker showed stays green
when the product breaks, across eight ids. Branch `fin/b02`, built from `fin/base` (`2f4f574a0`). Not pushed, not merged.

Words used: "live check" is a read-only query on saved results. "Practice test" is a fake-data test. Neither is called
"proof" or "deep" here.

## The numbers

| | Rows |
|---|---|
| Rows in batch 02 | 14 |
| `openBefore` (NOT_PROVED in this batch, `count-not-proved.mjs` on `fin/base`) | 14 |
| `openAfter` (same script, this branch, after repair cycle 1) | 2 (Ledger table, Hero) |
| All four lanes together | 853 before, 841 after |

Outcomes: 7 live checks (each with the practice tests that press or run what it names), 5 practice tests,
0 verified N/A, **2 not attachable** (Ledger table, Hero).

## Every row

| # | Row (control) | Outcome | What judges it |
|---|---|---|---|
| 1 | present.html 'Send soft pull ($32 + approval form)' | live-check | contract `deck-soft-pull-send`. Per send email: its own $32 diagnostic link for the same client; an address; email status not `failed` or `blocked`; a body that carries the signed approval form for THIS client (`/app/soft-pull-approve.html?` and `client=<id>`) and the pay link's own checkout address; the text row when the client has a phone. Other direction: a client the deck stamped as sent (`closer_deck_soft_pull_link_id`) with no email row. Screen half: `fin-b02-present-buttons.test.mjs`. |
| 2 | present.html bridge button (S-19) | practice-test | `fin-b02-present-buttons.test.mjs` |
| 3 | present.html Descent ladder, 6 buttons | practice-test | `fin-b02-present-buttons.test.mjs` |
| 4 | present.html 'Amount paid today' box | live-check | contract `repair-amount-paid`. All-time: bounds and round cap. Programs made in the last 60 days also: price is the catalog price (trial 200, full 1000) or a repair sale of this client agreed it; amount paid never exceeds the money on file (paid repair pay link, or repair sale payments); a client who had paid the whole price before the program was made is not saved as $0. Page half: `fin-b02-present-buttons.test.mjs` (the real box typed into, vm) and `s4-present-deck.test.mjs` (Chromium, types 500). |
| 5 | present.html Route the call (S-07) buttons | practice-test | `fin-b02-present-buttons.test.mjs` |
| 6 | present.html S-23 'Sale motion' select | live-check | contract `deck-sale-motion`. Screen half: `fin-b02-present-buttons.test.mjs`. |
| 7 | products-commissions.html Ledger table | not-attachable | see "Not attachable". |
| 8 | money-next.html Do task | live-check | contract `do-task-person-leg` (own SQL since repair cycle 1; no longer the shared do-task text). Task row and log agree on key, assignee, idempotency key; a person's step has a CSM task of the same client (source `money-task`, role `csm`) that the row AND the log point at; a money step carries the same amount on row and log. Practice halves: `fin-b02-do-task.test.mjs` (runs the real `doTask`, then the live SQL on what it saved), `src/finance/money-tasks.test.mjs`, `src/http/money-tasks.test.mjs`, `src/http/money-next-screen.test.mjs` (the press). |
| 9 | money-transfers.html Open the page; 401 sends to sign-in | practice-test | `fin-b02-transfers-open.test.mjs`. Since repair cycle 1 it reads the REAL html: the script is the file the `<script src>` names, the stand-in page hands the script only ids the html really has, the nav links are the html's own, and every local script and stylesheet must exist. |
| 10 | ops-admin.html email_invoice_backlog (server) | live-check | contract `invoice-backlog-email`: stamped invoice must link its own email (same client, an address, status not `failed` or `blocked`); an email on file with the invoice still reading never emailed is wrong. Practice halves, both attached since repair cycle 1: `src/http/s2-message-routes-outbound.test.mjs` (the handler: every never-sent invoice emailed once, bound 200) and `fin-b02-invoice-backlog.test.mjs` (the same handler, then the live SQL on what it saved). |
| 11 | pipeline.html Card Stacking 'Funded' column | live-check | contract `card-stacking-funded-column`. Screen half: `fin-b02-funded-column.test.mjs`. |
| 12 | sales-floor.html Hero | **not-attachable** | see "Not attachable". Back to NOT_PROVED in repair cycle 1. |
| 13 | sales-floor.html Page open: the whole floor + write on a GET | practice-test | `fin-b02-sales-floor-open.test.mjs`: Chromium paints all nine panels from one read, and the real `listRecentRecordings` runs against a stand-in database with the real column names. Repair cycle 1 added the insight stamp, both windows, the file with no link, first-or-last name, words and the 240-character excerpt. |
| 14 | soft-pull-approve.html 'I agree - submit soft-pull approval' | live-check | contract `soft-pull-approve-submit`. Consent typed by a client with a named account, words, version and name all non-blank; identity (SSN and DOB); one open or paid diagnostic link at the exact total; and, since repair cycle 1, a sign-in link issued within a day of the consent whose OWN email (`workflow:EMAIL-PORTAL-MAGIC-LINK:magic-link:<link id>`) went to this client and did not fail or get blocked. Page half: `s4-soft-pull-approve.test.mjs`. |

All live checks are `emptyAs: "quiet"` with a 60-day window on message, invoice, card and consent rows (repair
programs: bounds all-time, money legs 60 days; do-task presses all-time), so an unused control is green with "no saved
results yet" and goes red on the first wrong result.

## Repair cycle 1: what the checker found, and what each id ended as

Eight ids. For each: the break the checker made, what changed, and the breaks I made myself to prove the new check is
red (each made alone, test run, file put back; `git status` clean after each loop).

| Id (control) | Outcome | What changed |
|---|---|---|
| 'Amount paid today' box | live-check | SQL now judges price against the catalog or the client's own sale, amount paid against money on file, and the lost-$0 case (see row 4). Attached `s4-present-deck.test.mjs`. Added 5 vm tests that type into the real box (default shows the price; typed `250`, `0`, `$1,200.50`, `  75  `; trial rung; funding deck has no box). |
| Do task | live-check | Own SQL with the person leg, task key and assignee agreement, amount agreement. Attached the press (`money-next-screen`), the route (`money-tasks` route test) and `doTask` (`money-tasks`). New `fin-b02-do-task.test.mjs` runs the real `doTask` against a stand-in that saves what it is told to, then runs the live SQL on the saved rows. |
| Open the page (Transfers) | practice-test | Reads the real html (see row 9). |
| email_invoice_backlog | live-check | Status leg (failed, blocked). Attached the handler test `s2-message-routes-outbound`. New `fin-b02-invoice-backlog.test.mjs` runs the real handler and then the live SQL. The "emails every invoice" claim is held by those two practice tests (a live read cannot tell "not pressed" from "pressed and emailed nobody"; that is said here, not hidden). |
| Hero | **not-attachable** | See below. |
| Send soft pull | live-check | Status, body, form and checkout address legs, and the inverse leg from the deck's own stamp. |
| Page open: the whole floor | practice-test | Fixtures for the 11 breaks (below). |
| 'I agree - submit soft-pull approval' | live-check | Sign-in email half tied to the link's own message; version and name legs now tested alone. |

### Breaks made alone (all red unless noted)

- **Live SQL (`fin-b02-display-contracts.mjs`)**: 67 breaks in the first run, 9 survived, each fixed by a new fixture or
  by removing a redundant leg (`t.staff_task_id IS NULL` was covered by the NOT EXISTS leg, so it was deleted), then all
  9 red. Legs broken: soft pull (status, failed only, blocked only, null body, approval form, client in form, checkout
  null, checkout in body, channel, inverse branch, its window, demo, company, not-exists); repair (price, trial price,
  full price, sale excuse, sale category, sale client, paid-on-file both conjuncts and whole, window, lost payment,
  free price guard, link timing, sale timing, link purpose, link status, both derived tables, sale category);
  invoice (status leg, each word alone); approval (version, name, words, outcome, client, both window edges, mail
  client, channel, direction, status, each word alone, tie to the link's own id); do task (key, assignee, person leg,
  log link, CSM task exists, client, source, role, company, amount null, amount mismatch, money leg); hero over-count
  (leg, rounds client, status, closed).
- **`src/sales/recordings.mjs`**: 26 breaks (insight stamp without client, company, over a link, oldest first; call
  stamp without client, company, over a link; file with no link; each of the three recent-client windows; booking
  name; file window; type filter; first OR last name; last name only; ambiguous match; has_words ignoring words;
  excerpt not cut (file row and call row); transcript not trimmed; 30-day lookback; words by link; words by client;
  update without company; attach never marks attached). 5 survived the first run, all red after new fixtures.
- **`public/app/present.js`**: 9 breaks (paid always 0, price sent as 1, amount always the price, box value ignored,
  price taken from the box, program always full, box drawn without the price, enroll URL changed): 8 red. One stays
  green and is an equivalent mutant: removing `state.amountPaidDollars = paidEl.value` changes nothing, because the
  same function falls back to reading the box. The three that matter were also run on `s4-present-deck.test.mjs`
  (Chromium): 3 of 3 red.
- **`public/app/money-transfers.html`**: 9 breaks (script src to a missing file, script tag removed, defer removed,
  root id, back-link id, nav id, page css missing, brand css missing, root outside main): 9 of 9 red.
- **`src/finance/money-tasks.mjs`, `public/app/money-next.js`**: 14 breaks on the existing tests, 12 red; the two that
  survived (log not linked to the CSM task, task key dropped from the log) were closed by `fin-b02-do-task.test.mjs`,
  then 8 of 8 red there.
- **`src/invoices/notify.mjs`, `api/messages-outbound.mjs`**: 10 breaks (backlog read returns nobody, loop skips the
  first, loop emails only the first, counts without sending, never-sent filter, status filter, bound raised to 5000,
  stamp without the message link, wrong address, void invoice emailed). 9 red on the attached route test alone; the
  stamp-without-link one was only caught by the live SQL, so `fin-b02-invoice-backlog.test.mjs` was added; 10 of 10 red.

## Not attachable (2), with the exact missing piece

| Row | Why | What a product change must do |
|---|---|---|
| Ledger table (date, person, client, product, rule version, basis, rate, payout, status) | Unchanged from generation 2 to 4. The real page with the real read shape draws one earned $150 row as Date `2026-10-02`, Person `Casey Reed`, Client `—`, Product `Funding Bundle`, Rule version `—`, Basis `$0`, Rate `100%`, Payout `$150`, Status `Accrued`. Four of nine columns are wrong: Client and Rule version are hard-coded dashes in `ledgerFromApi` and `ledgerFromApiLive`; Basis does `Number("front_end") \|\| 0`; Rate paints `split_percent`, not the commission rate. A saved-row read cannot go red for a display wrong on every row, and a test of the real table cannot go green honestly. | Make `api/read/commissions.mjs` return client name, `base_amount` and the rule version and rate (from `rule_snapshot` or a join on `commission_rules`), then paint those in both page functions. `e2e/products-commissions-ledger.spec.mjs` feeds `basis: "3000.00"`, a shape the read never returns, so it needs a real-shape row in the same change. |
| **Hero: 'Today' deposits, booked and held, 'Funded, not just sold' rate and target bar** | **Repair cycle 1.** The row names a target bar. `public/app/sales-floor.js` sets the bar to `0%` on every paint and sets the second mark to the "no daily target" words, and `src/sales/metrics.mjs` hard-codes `today.target_cents` to `null`. The same read carries `hero.target_cents` (the monthly sales target, stored times 100) and `hero.cash_cents`; the page paints neither. The checker fed a read with `hero.target_cents` 5,000,000 and `hero.cash_cents` 2,500,000: the bar stayed at 0% with every attached test green. A test that is red on that (assert 50%) cannot be committed, because the product is what is wrong; a test that pins 0% passes whatever the read carries, which is the green-on-break the checker found. A live SQL that goes red whenever a target is saved would be red by construction and could not go green after the bar is built without being rewritten, the same reason the Ledger table is held. Booked and held are counted fresh on every read and leave no saved result. | Make the page set the bar from the read (`hero.cash_cents` over `hero.target_cents`, or deposits over a deposit target; which one is a decision for Chris, finding 2 below says the stored target is a COUNT stored as dollars). Then the row takes back one live check and one screen test, both already written and kept (below). |

### Kept ready for the Hero row (tested, not attached)

- `FIN_B02_HERO_READY_CONTRACT` in `fin-b02-display-contracts.mjs`: the live SQL for the deposit legs, with
  18 tests in `fin-b02-hero-live.test.mjs` (a deposit with no cash, with another client's payment, with no payment,
  refunded, failed, with a different cash, a payment reused by two deposits, a funded round with the flag off, and
  — added in repair cycle 1 — a client flagged funded with no round or closeout, a flag whose only round never
  funded, another client's funded round not excusing the flag). The over-count leg was mutation checked (4 of 4 red,
  one survivor closed by a new fixture).
- `fin-b02-hero-bar.test.mjs` (Chromium, 4 tests): the four numbers, a dash and never a zero, and the empty bar with its
  words. It says nothing about a target bar, and nothing here claims it does.
- Not built: a practice test of `salesFloor()` for booked and held. A probe showed the real function runs on the
  stand-in with only the two `AT TIME ZONE 'America/Phoenix'` day queries (and two LATERAL ones) failing on SQLite; a
  kit translation for those two is the missing piece.

The row's always-red words now state all of the above (`HERO_GAP_REQUIREMENT`), so the morning report prints the
exact reason.

## Files added

- `src/pulse/catalog/proofs/fin-b02-display-contracts.mjs` — the contracts, the row lists, the case lists.
- `src/pulse/catalog/proofs/fin-b02-sql-kit.mjs` — test kit: real column names from `db/schema` and `db/migrations`, an
  in-memory SQLite stand-in, `portableSql` (repair cycle 1 added `table.column ± interval 'N day'`), a node-postgres-shaped
  adapter. Tests only.
- `src/pulse/catalog/proofs/fin-b02-live-contracts.test.mjs` — 128 tests.
- `src/pulse/catalog/proofs/fin-b02-present-buttons.test.mjs` — 20 tests (vm).
- `src/pulse/catalog/proofs/fin-b02-transfers-open.test.mjs` — 10 tests (vm, real html).
- `src/pulse/catalog/proofs/fin-b02-funded-column.test.mjs` — 3 tests (Chromium).
- `src/pulse/catalog/proofs/fin-b02-sales-floor-open.test.mjs` — 13 tests (2 Chromium, 11 on the stand-in database).
- `src/pulse/catalog/proofs/fin-b02-hero-live.test.mjs` — 18 tests (not attached, ready).
- `src/pulse/catalog/proofs/fin-b02-hero-bar.test.mjs` — 4 tests (Chromium).
- `src/pulse/catalog/proofs/fin-b02-do-task.test.mjs` — 5 tests (new, repair cycle 1).
- `src/pulse/catalog/proofs/fin-b02-invoice-backlog.test.mjs` — 4 tests (new, repair cycle 1).
- `ops/workflows/finish-853-2026-10-14/manifest-b02.md` — this file.

## Shared lines touched (the integrator merges these)

| File | Change |
|---|---|
| `src/pulse/catalog/proofs/display-saved-result.mjs` | 1 import line (`FIN_B02_RESULT_CONTRACTS`) and 1 spread line `...FIN_B02_RESULT_CONTRACTS,` at the end of `DISPLAY_RESULT_CONTRACTS`. The `requirement` string of the existing `gap(...)` for the Ledger table names all four wrong columns (words only). Repair cycle 1 REMOVED the generation-1 entry for `Do task (per step the money helper or a person can do)` and the fifth `extra` argument of `query()`: the do-task contract now lives in `FIN_B02_RESULT_CONTRACTS`. Net diff against `fin/base` is the import, the spread and the Ledger words. |
| `src/pulse/catalog/proofs/display-proof-cases.mjs` | 1 import line and 1 spread line `...FIN_B02_DISPLAY_CASES,` at the end of `PLUGIN_DISPLAY_PROOF_CASES`. |
| `scripts/pulse/compile-catalog.mjs` | 1 import line and `staffProofCases: [...STAFF_UI_PROOF_CASES, ...FIN_B02_LIVE_CASES]`. |
| `src/pulse/coverage/gap-catalog-display.test.mjs` | Guard numbers, now: contracts and cases 48 (+8 from `fin/base`'s 40), pass-capable 34 (was 27 on `fin/base`; my +7), always-red 14 (was 13; the Hero's), SQL batches 34, `db.calls` 34, focused PASS rows 34, focused NOT_PROVED rows 14. |
| `src/pulse/catalog/proofs/display-proof-cases.test.mjs` | `redCount` 672 on `fin/base` to 661 (my decrease: 11; the invoice row was already not red in that count; the Hero is red again). If other batches also move it, add the decreases and use the number the test prints. |
| `src/pulse/catalog/generated.json` | Recompiled with `npm run pulse:catalog`. Conflicts are expected; recompile after merging, do not hand-merge. |

Row ids that left the lane's tracking list: the 5 practice rows (2, 3, 5, 9, 13) are held directly by their practice
tests and no longer appear in `DISPLAY_TRACKING_CASES`.

## Product findings (not fixed)

1. Ledger table (row 7): Client and Rule version are hard-coded dashes, Basis is always `$0`, Rate paints `split_percent`. The read selects none of `base_amount`, `rule_id`, `rule_snapshot`, client name. `e2e/products-commissions-ledger.spec.mjs` feeds a shape the read never returns.
2. Sales floor hero bar (row 12): `today.target_cents` is always null and the bar is always 0%; the read also returns `hero.cash_cents` and `hero.target_cents` and the page paints neither. `hero.target_cents` is `staff_targets.target_value * 100`, but that metric is a COUNT of deposits, so painted as money it would read "$20" for 20 deposits. `staff_targets` allows a `daily` period; the read never looks for one and says there is none.
2b. Sales floor counts demo calls: `floorFunnel`, `floorFunnelDay` and `depositToFunded` in `src/sales/metrics.mjs` have no `is_demo` filter (the closer stats query does).
2c. `logCallOutcome` saves a `deposit` with cash 0 and no transaction when no paid payment is found in the last 48 hours, and cash is never editable after. The hero counts a deposit nobody paid.
3. The sales floor read writes on a GET (`listRecentRecordings` updates `brain_files`, `call_outcomes.recording_url` and, per this cycle's fixtures, `customer_insights.recording_url`).
4. Descent ladder: on a deck whose engine tier is REPAIR_ONLY, the "Funding" rung changes nothing, and the pay link still goes out for REPAIR_DFY with route REPAIR_ONLY.
5. Ops & Admin "Email unsent invoices" sends no limit, so one press emails at most 50, while the row and the confirm text promise every invoice; 200 is only the cap if a caller sends a limit.
6. `enrollRepairProgram` accepts an amount paid above the price. The live check goes red on such a row; nothing stops one being saved.
7. The soft-pull email tells the client "optionally add businesses ($10 each, up to 5)" while the approval form allows 20.
8. Pipeline Funded column: after a drop the column's money label is redrawn as "$X est." instead of "$X funding est.".
9. (repair cycle 1) The repair "Amount paid today" box is drawn with the offer's full price in it, and an untouched box sends `amount_paid` equal to the price: "paid in full" with nothing paid.
10. (repair cycle 1) `public/app/inquiry-remover.html` Enroll button posts `program: "trial", price_total: 200, amount_paid: 200` with no payment behind it. The new live check goes red on any such program made in the last 60 days.
11. (repair cycle 1) `doTask` saves the queued row and the "to a person on our team" log even when the CSM task cannot be made (`createTask` answers null), so nobody has a task. The new live SQL goes red on it (`fin-b02-do-task.test.mjs` shows the case).
12. (repair cycle 1) `emailInvoice` stamps `emailed_at` when the message is queued. A message that later fails or is blocked leaves the invoice reading emailed, and the same `provider_ref` blocks a resend with purpose `sent`. The new status leg goes red on it.
13. (repair cycle 1) The soft-pull handler reports `portal_link.sent: false` in its reply when the sign-in link cannot be made or is rate limited, and nothing retries. The new sign-in leg goes red on that consent.

## Commands run

All from the worktree `.claude/worktrees/fin-b02`, no database, no network.

- `node scripts/pulse/count-not-proved.mjs`: before repair cycle 1, total 840, 1 of 14 batch rows open. After: total 841, 2 of 14 open (Ledger table, Hero). On `fin/base`: 853, 14 of 14.
- `npm run pulse:catalog`: clean (3975 mapped, 3942 unique, 3919 wired, 23 red).
- `node --test` on `src/pulse/catalog/*.test.mjs`, `src/pulse/coverage/gap-catalog-*.test.mjs`, `src/pulse/coverage/gap-door-batch*.test.mjs`, the six fast `fin-b02-*` files (live-contracts, hero-live, transfers-open, present-buttons, do-task, invoice-backlog), `modules.test.mjs`, the four attached product tests (`src/finance/money-tasks`, `src/http/money-tasks`, `src/http/money-next-screen`, `src/http/s2-message-routes-outbound`) and `display-contracts-*.test.mjs`: 447 of 447 pass.
- All 109 proof test files under `src/pulse/catalog/proofs/` except the focused runner (1,801 tests, Chromium ones included: funded column, sales floor open, hero bar, s4 present deck, s4 soft-pull approve, the staff runner): 1,801 of 1,801 pass.
- `node --test src/pulse/catalog/proofs/display-proof-cases.test.mjs` (the focused run: every test named by every case, browser ones included), 8 minutes: 3 of 3 pass.
- `npm run lint`: 3,573 files parse clean.

## Left undone, for the next generation

- Ledger table and Hero need the product changes above. Nothing else in batch 02 is open.
- The live SQL is judged on stand-in rows with the real column names only, never on production data (no database access by design). A first red on live would be a finding, not a surprise to hide. The new money legs on the repair row are the most likely to show real history (programs enrolled by hand, trials from the inquiry-remover button, financed sales whose payments live in a table the legs do not read).
- The focused run (`display-proof-cases.test.mjs`, 12 to 13 minutes) was run once at the end of this cycle; `e2e/teleprompter-touch.spec.mjs:715` is a known load flake inside it.
- Unattached but kept: the hero's live SQL and its tests (see above).

## History (compact)

- Generation 1: rows 1 to 11, 13, 14. 24 SQL breaks, 27 `present.js` breaks (26 red, 1 equivalent), 12 `money-transfers.js`, 5 pipeline, 20 sales floor and recordings (15 red, 5 closed by fixtures).
- Generation 2: row 12 attached (20 SQL breaks, 2 closed; 14 page breaks, 14 red); row 7 widened to four wrong columns.
- Generations 3 and 4: independent re-checks of row 7, no code change.
- Repair cycle 1: this file.
