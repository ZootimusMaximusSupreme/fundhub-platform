# Finish the 853, batch 17 (tier 4, lane gap-catalog-display, 40 rows)

Branch `fin/b17`, built from `fin/base` (`2f4f574a0`). Worktree `.claude/worktrees/fin-b17`. Nothing was pushed or merged.
Generation 1 of 3. No product file was changed (page scripts, handlers and tables are exactly as they were).

## The numbers

| | Rows |
|---|---|
| Rows in the batch | 40 |
| Still NOT_PROVED before | 40 (`node scripts/pulse/count-not-proved.mjs`, offline) |
| Still NOT_PROVED after | 0 |
| The whole lane count | 853 before, 813 after |

Outcomes: 6 live-check, 34 practice-test, 0 na-verified, 0 not-attachable.

`live` = a read-only SQL contract the display lane runs on the real saved rows (red on the first wrong one; green with "no saved results yet" until the first result, except the sample client, which must exist), or the closer desk lane's own live GET. `practice` = the real page script (a vm, or Chromium) with fake answers; it reads no live data.

## Every row and its outcome

| # | Row | Outcome | Where |
|---|---|---|---|
| 1 | desks-f.json / Back and Next screen buttons, ArrowLeft and ArrowRight keys (Next steps over the 06 Blueprint section, skips S-11..S-16 on the education route) | practice-test | `src/pulse/catalog/proofs/fin-b17-present.test.mjs`: real present.js and contract-send.js in a vm over fake answers |
| 2 | desks-f.json / Client screen only / Show cockpit toggle | practice-test | `src/pulse/catalog/proofs/fin-b17-present.test.mjs`: real present.js and contract-send.js in a vm over fake answers |
| 3 | desks-f.json / contract-send.js and data.js are served (the deck needs both to send a contract and to read or write anything) | live-check | `src/pulse/coverage/gap-closer.mjs`: closer:desk-pages now also GETs /app/contract-send.js and /app/data.js (FAIL when either is missing or not the file); present test runs the lane over the real files and the vm over both scripts |
| 4 | desks-f.json / Discovery: 'Their monthly cost of inaction' text box | practice-test | `src/pulse/catalog/proofs/fin-b17-present.test.mjs`: real present.js and contract-send.js in a vm over fake answers |
| 5 | desks-f.json / Discovery: 7 belief checkboxes (Pain, Desire, Doubt, Cost, Support, Money, Trust) | practice-test | `src/pulse/catalog/proofs/fin-b17-present.test.mjs`: real present.js and contract-send.js in a vm over fake answers |
| 6 | desks-f.json / Error wall links: 'Back to Closer Dashboard' and 'Sign in as someone else' | practice-test | `src/pulse/catalog/proofs/fin-b17-present.test.mjs`: real present.js and contract-send.js in a vm over fake answers |
| 7 | desks-f.json / Objections: 6 buttons (Think about it, $3K is a lot, What if it fails, Spouse, Burned before, DIY), Back, and the jump button | practice-test | `src/pulse/catalog/proofs/fin-b17-present.test.mjs`: real present.js and contract-send.js in a vm over fake answers |
| 8 | desks-f.json / Phase strip button 01: 01 Intro (S-01..S-02) | practice-test | `src/pulse/catalog/proofs/fin-b17-present.test.mjs`: real present.js and contract-send.js in a vm over fake answers |
| 9 | desks-f.json / Phase strip button 02: 02 Discovery (S-03..S-04) | practice-test | `src/pulse/catalog/proofs/fin-b17-present.test.mjs`: real present.js and contract-send.js in a vm over fake answers |
| 10 | desks-f.json / Phase strip button 03: 03 Soft pull (S-05..S-07) | practice-test | `src/pulse/catalog/proofs/fin-b17-present.test.mjs`: real present.js and contract-send.js in a vm over fake answers |
| 11 | desks-f.json / Phase strip button 04: 04 Pitch (S-08..S-16) | practice-test | `src/pulse/catalog/proofs/fin-b17-present.test.mjs`: real present.js and contract-send.js in a vm over fake answers |
| 12 | desks-f.json / Phase strip button 05: 05 Commit (S-17..S-22) | practice-test | `src/pulse/catalog/proofs/fin-b17-present.test.mjs`: real present.js and contract-send.js in a vm over fake answers |
| 13 | desks-f.json / Phase strip button 06: 06 Blueprint (B-01..B-06, the offer stack) | practice-test | `src/pulse/catalog/proofs/fin-b17-present.test.mjs`: real present.js and contract-send.js in a vm over fake answers |
| 14 | desks-f.json / Phase strip button 07: 07 Close (S-23..S-24) | practice-test | `src/pulse/catalog/proofs/fin-b17-present.test.mjs`: real present.js and contract-send.js in a vm over fake answers |
| 15 | desks-f.json / present.js is served and wired (posts log_disposition, calls /api/closer-deck) | live-check | `src/pulse/coverage/gap-closer.mjs`: closer:desk-pages (live GET of present.js, red when log_disposition or /api/closer-deck is gone); present test runs the lane words over the real file and presses Log disposition in a vm |
| 16 | desks-f.json / Reframing patterns button and Back | practice-test | `src/pulse/catalog/proofs/fin-b17-present.test.mjs`: real present.js and contract-send.js in a vm over fake answers |
| 17 | desks-f.json / S-18 'Their number' 1 to 10 buttons | practice-test | `src/pulse/catalog/proofs/fin-b17-present.test.mjs`: real present.js and contract-send.js in a vm over fake answers |
| 18 | desks-f.json / Section 06 'Leave the stack: back to <slide>' | practice-test | `src/pulse/catalog/proofs/fin-b17-present.test.mjs`: real present.js and contract-send.js in a vm over fake answers |
| 19 | desks-f.json / Section 06 'Reset to this file' | practice-test | `src/pulse/catalog/proofs/fin-b17-present.test.mjs`: real present.js and contract-send.js in a vm over fake answers |
| 20 | desks-f.json / Section 06 FinanceOS demo links: 16 tabs open the sample client in a new tab (owner, admin, sales_manager, closer only) | live-check | `src/pulse/catalog/proofs/fin-b17-display-contracts.mjs`: live check: the sample client exists in the company with a container, an open bank account, a credit file and tradelines (not quiet: missing is red); present test presses the sixteen links by role |
| 21 | desks-f.json / Section 06 move buttons: 'Not ready: show FinanceOS', 'Ready later? Show the path up', 'Back to the Blueprint price', 'Back to FinanceOS' | practice-test | `src/pulse/catalog/proofs/fin-b17-present.test.mjs`: real present.js and contract-send.js in a vm over fake answers |
| 22 | desks-f.json / Section 06 stack: 13 on/off toggles (disputes, helper, money helper, pull, ready, paydown, FinanceOS, alerts, partner, banks, declines, vault, next sequence) | practice-test | `src/pulse/catalog/proofs/fin-b17-present.test.mjs`: real present.js and contract-send.js in a vm over fake answers |
| 23 | desks-f.json / Soft pull panel: consent / paid / pull-status lines (display) | live-check | `src/pulse/catalog/proofs/fin-b17-display-contracts.mjs`: live check on the rows behind the three lines (finished request with no stored result, request pointing at another client or company result, diagnostic link with no amount or disagreeing paid fields); present test paints the panel; fin-b17-soft-pull-status.test.mjs judges the server half |
| 24 | desks-f.json / Two walls: no client on the link ('Pick a client first') and refused account ('This account cannot open the client deck') | practice-test | `src/pulse/catalog/proofs/fin-b17-present.test.mjs`: real present.js and contract-send.js in a vm over fake answers |
| 25 | desks-f.json / '+ Add product' (opens the empty editor) | practice-test | `src/pulse/catalog/proofs/fin-b17-products.test.mjs`: real page in Chromium over fake /api answers |
| 26 | desks-f.json / 'View payout ledger ->' and '<- Back to rules' | practice-test | `src/pulse/catalog/proofs/fin-b17-products.test.mjs`: real page in Chromium over fake /api answers |
| 27 | desks-f.json / Commission rule 'See these payouts ->' (opens the ledger filtered to the people the rule pays) | practice-test | `src/pulse/catalog/proofs/fin-b17-products.test.mjs`: real page in Chromium over fake /api answers |
| 28 | desks-f.json / Commission rule header click (expand a rule) and 'Rate history' disclosure | practice-test | `src/pulse/catalog/proofs/fin-b17-products.test.mjs`: real page in Chromium over fake /api answers |
| 29 | desks-f.json / Ledger filters: person select and status select (Accrued, Approved, Paid) | practice-test | `src/pulse/catalog/proofs/fin-b17-products.test.mjs`: real page in Chromium over fake /api answers |
| 30 | desks-f.json / Page open: who am I (shows the SLO connections tab for owner and admin only) | practice-test | `src/pulse/catalog/proofs/fin-b17-products.test.mjs`: real page in Chromium over fake /api answers |
| 31 | desks-f.json / Product editor 'Cancel', close X, click outside | practice-test | `src/pulse/catalog/proofs/fin-b17-products.test.mjs`: real page in Chromium over fake /api answers |
| 32 | desks-f.json / Product row click (opens the editor for that product) | practice-test | `src/pulse/catalog/proofs/fin-b17-products.test.mjs`: real page in Chromium over fake /api answers |
| 33 | desks-f.json / Products table 'Rails' column (always a dash: nothing records which funnels a product sits on) | practice-test | `src/pulse/catalog/proofs/fin-b17-products.test.mjs`: real page in Chromium over fake /api answers |
| 34 | desks-f.json / SLO connections 'Cancel' | practice-test | `src/pulse/catalog/proofs/fin-b17-products.test.mjs`: real page in Chromium over fake /api answers |
| 35 | desks-f.json / Tabs: Products, Commission rules, SLO connections (owner/admin only) | practice-test | `src/pulse/catalog/proofs/fin-b17-products.test.mjs`: real page in Chromium over fake /api answers |
| 36 | desks-e.json / Ask system / Knowledge: type a question and press Ask or Enter | practice-test | `src/pulse/catalog/proofs/fin-b17-chat.test.mjs`: real chat-widget.js in Chromium over fake /api answers |
| 37 | desks-e.json / Chat button (opens and closes the panel) and close x | practice-test | `src/pulse/catalog/proofs/fin-b17-chat.test.mjs`: real chat-widget.js in Chromium over fake /api answers |
| 38 | desks-e.json / Message > Staff (internal): pick a teammate and send | live-check | `src/pulse/catalog/proofs/fin-b17-display-contracts.mjs`: live check on saved internal messages (outbound staff message on the internal channel, sender is one of the two people, words, no client, delivered, two-person thread with a pair key); chat test presses pick-and-send, thread open and the 4 second read in Chromium |
| 39 | desks-e.json / Mode tabs: Ask system / Knowledge / Message | practice-test | `src/pulse/catalog/proofs/fin-b17-chat.test.mjs`: real chat-widget.js in Chromium over fake /api answers |
| 40 | desks-d.json / Connection status lines (last sale or payout, event count, last synced, last sync error, still-reading note) | live-check | `src/pulse/catalog/proofs/fin-b17-display-contracts.mjs`: live check on merchant_connections vs merchant_events (last event time, last synced time, still-reading promise, error length); money-connections test runs the server shape and the page render over fake rows |

## Files added (all new, all `fin-b17-*`)

`src/pulse/catalog/proofs/`: `fin-b17-kit.mjs` (row tracker), `fin-b17-browser-kit.mjs` (Chromium and dialog helpers over the S4 harness), `fin-b17-rows.json` (the 40 rows by test file), `fin-b17-rows.test.mjs` (row guards), `fin-b17-display-contracts.mjs` (four live SQL contracts), `fin-b17-live-contracts.test.mjs` (runs each contract over stand-in rows), `fin-b17-sql-kit.mjs` (stand-in Postgres text on SQLite, copied from batch 16 so this batch does not wait on it), `fin-b17-display-proofs.mjs` (attaches the rows), `fin-b17-present.test.mjs` (24 Present rows), `fin-b17-soft-pull-status.test.mjs` (server half of the soft pull panel), `fin-b17-products.test.mjs` (11 rows), `fin-b17-chat.test.mjs` (4 rows), `fin-b17-money-connections.test.mjs` (1 row).
`ops/workflows/finish-853-2026-10-14/manifest-b17.md`.

## Shared lines touched (the integrator merges these)

| File | Change |
|---|---|
| `src/pulse/coverage/gap-closer.mjs` | `PAGES` gets two entries (`/app/contract-send.js`, `/app/data.js`, both `reg: null`, each with an `effect` sentence), and the "down" sentence uses `page.effect` when a page has one. Not shared with any other batch (no `fin/b*` branch touches it). |
| `src/pulse/coverage/gap-closer.test.mjs` | `GOOD` map gets the two scripts, counts 3 to 5 (`seen.length`, `read`), 2 to 4 for the half-down cases, and one new test for the two new pages. Stronger, nothing removed. |
| `src/pulse/catalog/proofs/display-saved-result.mjs` | 1 import line + `...FIN_B17_RESULT_CONTRACTS,` at the end of `DISPLAY_RESULT_CONTRACTS` |
| `src/pulse/catalog/proofs/display-proof-cases.mjs` | 1 import line + `...FIN_B17_DISPLAY_PROOF_CASES,` at the end of the plug-in list |
| `scripts/pulse/compile-catalog.mjs` | 1 import line + `...FIN_B17_LIVE_CASES` spread into `staffProofCases` |
| `src/pulse/coverage/gap-catalog-display.test.mjs` | contracts 40 to 44, pass-capable 27 to 31, SQL batches 27 to 31, calls 27 to 31, PASS 27 to 31, shipped cases 40 to 44 (my change: +4 each) |
| `src/pulse/catalog/proofs/display-proof-cases.test.mjs` | red count 672 to 632 (my change: -40) |
| `src/pulse/catalog/generated.json` | recompiled with `npm run pulse:catalog` (a conflict is expected; run it again after merging) |

## Every check can go red (break the product or the SQL, see red, put it back)

Each break was made in the product file (or the SQL text), the test run, then the file put back byte for byte by the runner. `git status` shows no product file changed.

| What | Breaks tried | Red |
|---|---|---|
| Present deck (public/app/present.js, present.html, contract-send.js, data.js): Back/Next and arrow keys (stack and education skips, typing guard, disabled ends), Client screen only, cost box and beliefs, walls and their links, objections, reframes, S-18 numbers, the seven phase buttons, Leave the stack, Reset, the 13 toggles and their defaults, the move buttons, demo link roles, tab and sample client, soft pull lines, Log disposition, script tags and globals | 82 | 82 of 82 |
| Products & Commissions page (public/app/products-commissions.html): add product, editor reset, Cancel / X / outside, row click, Rails column, ledger link and back, See these payouts, ledger filters and total, rule header, Rate history, tabs, who-am-I gate, SLO Cancel | 48 | 46 of 48 (2 changed nothing a person can see, see below) |
| Staff chat widget (public/app/chat-widget.js): button, close x, tabs, Ask and Enter, Shift+Enter, empty box, answer and sources, internal send body, pick-first guard, thread lookup, my bubble, refused send, 4 second read, no reads while closed | 25 | 23 of 25 (2 changed nothing a person can see, see below) |
| Money connection status lines (public/app/money-connections.js and src/merchant/store.mjs publicConnection) | 19 | 19 of 19 |
| Soft pull server half (src/sales/closer-deck.mjs softPullStatus) | 11 | 11 of 11 (against the existing closer-deck.test.mjs alone, 3 of the first 8 went red and 5 stayed green, which is why fin-b17-soft-pull-status.test.mjs was added) |
| Live SQL texts (fin-b17-display-contracts.mjs): filters, other company, demo rows, every condition dropped one at a time | 23 | 23 of 23 (two stayed green on the first try, because one other-company case and one wrong target were missing; a test was added for each and both went red) |

## Breaks that changed nothing a person can see (kept honest)

1. Products page, `.vhist summary` stopPropagation removed: the Rate history `<details>` sits in the rule body, not inside the clickable header, so the click never reaches the header handler. Nothing changes for a person.
2. Products page, `w.classList.remove('on-ledger')` in the tab handler removed: the tab row is hidden while the ledger is open, so a tab cannot be pressed in that state. The test asserts the tabs are out of the way instead.
3. Chat widget, the open-check inside the 4 second timer, removed alone: closing the panel already clears the timer, so no read happens. Chat widget, clearInterval on close, removed alone: the open-check inside the timer stops every read. Each alone changes nothing anyone sees. Both removed together makes the widget read while closed, and the test goes red.

## Product findings (nothing was fixed)

1. Products & Commissions editor: a product whose saved category is lowercase (the seed has funding, diagnostic, inquiry_removal, consulting) opens with a blank Category box, because the box's words are Diagnostic, Funding, Repair, Inquiry Removal, Partner and a select with no matching word has no value. Pressing Save then sends category "", and api/products.mjs stores an empty category as null. Checked in Chromium (value "", selectedIndex -1) and in api/products.mjs. The practice tests use the capitalised words the box offers, so they do not rest on this.
2. Products & Commissions: 'See these payouts' can only narrow the ledger when a ledger row names the rule. The live ledger rows carry no rule id (the Rule version column is a dash, the existing finding), so on live data the button always opens the ledger on Everyone. The narrowing path was pressed by putting rule ids on the page's own ledger rows.
3. Chat widget: the row says there is no request until Send, but opening the Message tab reads /api/chat/peers at once, and picking a teammate reads the thread list. Row words are stale; the test judges the real requests (nothing is posted until Send).
4. Chat widget: words typed in the question box are cleared when the panel is closed and opened again (opening repaints the foot). Small. The test does not rest on it.
5. Products & Commissions: the page's own whoami fetch and the staff shell both read /api/auth/session, and the shell sends any login that is not owner, admin or sales manager away from this page. A failed session read therefore sends the person to sign in rather than leaving the tab hidden, so the page's own catch branch cannot be reached on its own.
6. closer desk lane: contract-send.js and data.js were not read live by anything (closer:desk-pages read present.html and present.js only). Not a product break, so the lane was extended (two entries in PAGES); a missing script now turns closer:desk-pages red and names what stops working.
7. Soft pull panel: a diagnostic payment link row with no amount comes back from buildCloserDeck (src/sales/closer-deck.mjs) as diagnostic_amount_cents 0 (Number(null)), and the panel prints $0.00. The new live check goes red on such a row; nothing was changed.

## Commands I ran, and their results

- `node scripts/pulse/count-not-proved.mjs (before, in the worktree)`: 853 open, 40 of them this batch
- `npm run pulse:catalog, then node scripts/pulse/count-not-proved.mjs`: 813 open, 0 of this batch; the compiled catalog is fresh (`--check` passes)
- `node --test fin-b17-present, -money-connections, -live-contracts, -rows, -soft-pull-status, -products, -chat, gap-closer.test.mjs, gap-catalog-display.test.mjs, src/sales/closer-deck.test.mjs, display-contracts-ab.test.mjs`: 181 tests, 181 pass, 0 fail
- `node --test fin-b17-products.test.mjs fin-b17-chat.test.mjs, three runs in all (one inside the 181 above)`: 18 of 18 pass each time
- `node --test --test-name-pattern='names one exact map row|unmapped display rows' display-proof-cases.test.mjs`: 2 of 2 pass (red count 632)
- `node --test src/pulse/catalog/*.test.mjs`: 83 of 83 pass
- `node scripts/lint.mjs`: 3574 files and inline scripts parse clean
