# Batch 10 manifest (tier 4, lane gap-catalog-display, generation 1)

Branch `fin/b10`, built from `fin/base` (`2f4f574a0`). Work folder `.claude/worktrees/fin-b10`. Nothing was pushed or merged.
No product file was changed. Everything added is a test, a proof table, or a read-only check.

## Generation 2 (2026-10-14): the two open rows were challenged, and both reasons are exactly true

Start of generation 2, measured with `node scripts/pulse/count-not-proved.mjs` in this worktree: 815 open in all, 2 of the 40 batch rows open
(`openBefore` 2 for this generation; it was 40 at the start of generation 1). End: 815 open in all, the same 2 rows open (`openAfter` 2).
Both stay `not-attachable`. Nothing is faked.

What was re-checked, and how:

| Check | Result |
|---|---|
| Is present.html on the shell's `ALL` list? | No. |
| Can another list hand it to a role? (`CLOSER_DESK_ONLY`, `ADVISOR_ONLY`, `STAFF_MONEY`, `CONSENT_DESK_ONLY`, `SALES_FLOOR_ONLY`, `FINANCE_ONLY`, the `staffTabs()` filter) | No. The string `present.html` appears in `public/app/shell.js` only inside comments (zero mentions in code). |
| Is the hidden link only true of this checkout? | No. A read-only GET of the deployed `https://fundhub.ai/app/shell.js` (140,256 bytes) is byte for byte the repo `public/app/shell.js`, with zero mentions of `present.html`. |
| Does the page un-hide the links after the gate runs? | No. `client-control-panel.html` only sets their `href`s (`href("ccp-link-present", ...)`); `wireFinanceOsLink()` un-hides only the FinanceOS row. The existing practice test measures all 8 staff roles in a real Chromium page: address right, `isVisible()` false. |
| Could a test be attached that is honest? | No. A test that asserts the address only would turn two rows green over links no person can press. A test that asserts "hidden" would be green over a broken control and red the day it is fixed. Both are the "half attached" the row text rules out (the Quick launch row names four links; one is dead). |

What was added (guards only, no product file, no new row proof):

- `fin-b10-rows.test.mjs`: one new test, "shell.js names present.html nowhere in code". The old guard read only the `ALL` list, so a role list could
  hand the link to closers and the guard would have stayed green (break check below). The new one reads the whole shell and fails with the line
  to attach.
- `fin-b10-not-attachable.mjs`: both written reasons now carry the deployed-file measurement and the wider role-list check.

Break checks (each put back; the worktree was clean after each):

| Break | Old `ALL` guard | New whole-file guard | Browser practice test |
|---|---|---|---|
| Add `"present.html"` to `CLOSER_DESK_ONLY` in `public/app/shell.js` | green (this is why it was strengthened) | red | red for the Quick launch and Credit Snapshot checks (`closer: Open Closer Deck is hidden` expected false, actual true) |

Generation 2 numbers: `fin-b10-*.test.mjs` 98 tests, 98 pass (97 before, plus the one new guard). `npm run lint`: 3,574 files parse clean.
`npm run pulse:catalog` then `compile-catalog.mjs --check`: fresh, `generated.json` unchanged. The product fix that would let both rows attach is one
line: add `"present.html"` to the right role list in `public/app/shell.js` (the page's own comment at `client-control-panel.html` line 1354 says the same).
The moment it lands, the new guard and the browser test go red and say "attach now".

## Resume check (2026-10-14, after the Mac restart, run from a fresh agent)

No product or test file changed. Everything was re-measured on this branch (`fd86e967b`, cut from `fin/base` `2f4f574a0`):

| Check | Result |
|---|---|
| `count-not-proved.mjs` on `fin/base` (temp worktree, removed) | 853 open in all, 40 of the 40 batch rows open (`openBefore` 40) |
| `count-not-proved.mjs` on this branch | 815 open in all, 2 of the 40 batch rows open (`openAfter` 2) |
| `node --test src/pulse/catalog/proofs/fin-b10-*.test.mjs` | 98 tests, 98 pass, 0 fail |
| `gap-catalog-display.test.mjs`, `display-proof-cases.test.mjs`, `modules.test.mjs` | 18 tests, 18 pass, 0 fail |
| `npm run lint` | exit 0, 3,574 files parse clean |
| `node scripts/pulse/compile-catalog.mjs --check` | exit 0, catalog fresh |
| Spot break checks, each put back (tree clean after each) | 9 of 9 red: Fatigue Window select without the re-read, signature Clear doing nothing, Which quiz picker always painting the first quiz, Present link without the client, Funding Matrix link with the wrong query name, upload SQL without `uploaded_by`, Join call SQL without `rescheduled`, waiting SQL judging Drive files too (and the page break checks also turn the "every listed row was exercised" guard red) |
| The two `not-attachable` rows, re-read | `public/app/shell.js` names `present.html` nowhere in code, so `gateLinks()` hides both rows for every role (`screenOf("present.html")` is not on `ALL` or any role list). Both reasons are still exactly true. |
| Live contract SQL columns | every table and column named by the five contracts exists in `db/migrations` (`bookings`, `tasks.body` = booking uid, `tasks.meeting_url`, `brain_files.source/size_bytes/uploaded_by/approval_status`, `brain_classification_reviews`, `funnel_page_stats`, `analytics_connections`, `clients.is_demo`) |

## The numbers

| | Rows |
|---|---|
| Batch 10 rows | 40 (all `catalog-display`: campaign-manager 10, client-control-panel 13, client-portal 7, closer-call 1, closer-dashboard 5, company-brain 4) |
| `openBefore` (still NOT_PROVED at the start) | 40 |
| `openAfter` | 2 |
| Live checks | 5 |
| Practice tests | 33 |
| Not attachable | 2 |

Whole display lane, measured offline with `node scripts/pulse/count-not-proved.mjs`: 853 NOT_PROVED before, 815 after (-38). The two rows left are the two `not-attachable` rows below.

## Every row

| Row (page / control) | Outcome | Proved by |
|---|---|---|
| campaign-manager.html / Drawer: metric buttons (spend, impressions, clicks, conversions, and more) | practice-test | fin-b10-campaign-manager.test.mjs |
| campaign-manager.html / Fatigue row: Label button (opens link box) | practice-test | fin-b10-campaign-manager.test.mjs |
| campaign-manager.html / Fatigue state rail (all, refresh, queue, ok, unconfigured) | practice-test | fin-b10-campaign-manager.test.mjs |
| campaign-manager.html / Fatigue Window select (7, 14, 30 days) | practice-test | fin-b10-campaign-manager.test.mjs |
| campaign-manager.html / Funnel pages: Sync now button | live-check | fin-b10-display-contracts.mjs (live) + practice test |
| campaign-manager.html / Link box: Close button | practice-test | fin-b10-campaign-manager.test.mjs |
| campaign-manager.html / Link box: Creative select | practice-test | fin-b10-campaign-manager.test.mjs |
| campaign-manager.html / Link box: Our ad number input | practice-test | fin-b10-campaign-manager.test.mjs |
| campaign-manager.html / Reload button | practice-test | fin-b10-campaign-manager.test.mjs |
| campaign-manager.html / Spend rail filter (all, breached, ok) | practice-test | fin-b10-campaign-manager.test.mjs |
| client-control-panel.html / Agent context toggle and pre block (what the AI sees) | practice-test | fin-b10-client-control-panel.test.mjs |
| client-control-panel.html / Blueprint group toggle | practice-test | fin-b10-client-control-panel.test.mjs |
| client-control-panel.html / Client picker select (200 clients, navigates to ?id=) | live-check | fin-b10-display-contracts.mjs (live) + practice test |
| client-control-panel.html / Credit & Hold Status toggle (credit status, income estimates, hold reason) | practice-test | fin-b10-client-control-panel.test.mjs |
| client-control-panel.html / Credit partner links: Open the partner's file, Record the partner's own consent | practice-test | fin-b10-client-control-panel.test.mjs |
| client-control-panel.html / Declines: Use this email button | practice-test | fin-b10-client-control-panel.test.mjs |
| client-control-panel.html / Details toggle (email, phone, tier, path) | practice-test | fin-b10-client-control-panel.test.mjs |
| client-control-panel.html / More menu: Open Bank Inbox button | practice-test | fin-b10-client-control-panel.test.mjs |
| client-control-panel.html / More menu: Open Credit Snapshot link | not-attachable | fin-b10-not-attachable.mjs |
| client-control-panel.html / More menu: Open Funding Matrix link | practice-test | fin-b10-client-control-panel.test.mjs |
| client-control-panel.html / Open FinanceOS link (owner, admin, sales_manager only) | practice-test | fin-b10-client-control-panel.test.mjs |
| client-control-panel.html / Quick launch links: Open Pipeline, Closer Deck, Messaging, Inquiry Remover | not-attachable | fin-b10-not-attachable.mjs |
| client-control-panel.html / System Facts toggle (last pull, scores, round, funded) | practice-test | fin-b10-client-control-panel.test.mjs |
| client-portal.html / Account drawer tabs: Payments, Agreements, Documents, Activity, Messages | practice-test | fin-b10-client-portal.test.mjs |
| client-portal.html / Course tiles: Open course and expand modules (Funding Mastery, Deliverables) | practice-test | fin-b10-client-portal.test.mjs |
| client-portal.html / Facebook wins group card (external link) | practice-test | fin-b10-client-portal.test.mjs |
| client-portal.html / See exactly where your file stands link (to /progress.html) | practice-test | fin-b10-client-portal.test.mjs |
| client-portal.html / Sign to authorize dispute letters: Clear button | practice-test | fin-b10-client-portal.test.mjs |
| client-portal.html / Staff view: Open this client in Documents link | practice-test | fin-b10-client-portal.test.mjs |
| client-portal.html / What You Own: Open course button | practice-test | fin-b10-client-portal.test.mjs |
| closer-call.html / Redirect page: open Closer Dashboard link and auto-redirect script | practice-test | fin-b10-closer.test.mjs |
| closer-dashboard.html / Belief failed buttons (pain, doubt, cost, desire, money, support, trust, none) | practice-test | fin-b10-closer.test.mjs |
| closer-dashboard.html / Contract panel: Copy link button | practice-test | fin-b10-closer.test.mjs |
| closer-dashboard.html / Deal breakdown details toggle | practice-test | fin-b10-closer.test.mjs |
| closer-dashboard.html / Join call button (opens the booked call link) | live-check | fin-b10-display-contracts.mjs (live) + practice test |
| closer-dashboard.html / Present button (opens present.html?contact= in a new tab) | practice-test | fin-b10-closer.test.mjs |
| company-brain.html / 'N waiting' pending badges (two) | live-check | fin-b10-display-contracts.mjs (live) + practice test |
| company-brain.html / Add a document: '+' button then file picker (PDF, Word, Excel, PowerPoint, text; 25 MB cap) | live-check | fin-b10-display-contracts.mjs (live) + practice test |
| company-brain.html / Answer source list: 'Open in Drive' link and 'Client record' link | practice-test | fin-b10-company-brain.test.mjs |
| company-brain.html / Class quiz: 'Which quiz' picker | practice-test | fin-b10-company-brain.test.mjs |

A "live check" row also has a practice test that presses the control in a real page (extra cover). The five live checks are
judged by the display lane from saved data; the catalog treats a row as one or the other, never both.

## What was built

All new logic is in new `fin-b10-*` files in `src/pulse/catalog/proofs/`.

| File | What it is |
|---|---|
| `fin-b10-kit.mjs` | Row tracker (a row is claimed only inside the callback that asserts it, an empty callback is refused), the shared Chromium helper (on the S4 harness), `waitFor`, `dialogs`. |
| `fin-b10-rows.json` | Which control rows each test file proves, and which are exercised but left out (`notAttached`). |
| `fin-b10-campaign-manager.test.mjs` | 10 controls: drawer metric buttons, spend rail, fatigue rail and Window select, Label button, link box (Close, Creative select, Our ad number), Sync now, Reload. |
| `fin-b10-client-control-panel.test.mjs` | 13 controls: the five folds, client picker, Quick launch links, Open FinanceOS (8 roles), More menu (Funding Matrix, Credit Snapshot, Bank Inbox), credit partner links (with the add-partner flow), Declines Use this email. |
| `fin-b10-client-portal.test.mjs` | 7 controls: Account drawer tabs, course tiles, What You Own Open course, Facebook wins card (never followed), progress link (client and staff), signature Clear (a real drawing), staff Documents link. |
| `fin-b10-closer.test.mjs` | 6 controls: Belief failed buttons (every belief goes out as itself, None as no belief), Join call, Present, Copy link (clipboard and window.open are replaced in the page), Deal breakdown fold, closer-call.html redirect. |
| `fin-b10-company-brain.test.mjs` | 4 controls: N waiting badges, + document button (real file chooser, multipart body), answer source links, Which quiz picker (all 20 quizzes, role filter, Day 5 pass and fail). |
| `fin-b10-display-contracts.mjs` | The five live contracts (one read-only SQL each, `emptyAs: "quiet"`), their map rows, and the deep cases handed to the catalog compiler. |
| `fin-b10-sql-kit.mjs` | Test kit: reads the real column names from `db/schema` and `db/migrations`, runs the contract's exact SQL text on an in-memory SQLite (`node:sqlite`). |
| `fin-b10-live-contracts.test.mjs` | 50 tests: each contract quiet when empty, green on a good result, red once per way it can be wrong, another company's wrong result not counted, old results not judged. |
| `fin-b10-display-proofs.mjs` | Turns the rows table and the live rows into proof cases for the catalog. |
| `fin-b10-not-attachable.mjs` | The two left-out rows and the exact reason. |
| `fin-b10-rows.test.mjs` | Guards: every row is one exact map row; counts (5 live, 33 practice, 2 out); the two reasons are still true. |

### The five live checks (what each judges)

| Control | Read-only SQL judges, per saved result | Goes red when |
|---|---|---|
| Funnel pages: Sync now | `funnel_page_stats` rows of the last 60 days against `analytics_connections` | no connection, another company's connection, a non-ClickFunnels connection, negative views or conversions (NULL is fine), a stat dated after the day it was saved |
| Add a document: + button | `brain_files` uploads (`source = 'upload'`) of the last 60 days with `brain_classification_reviews` | not an `upload:` id, no name, no size, nobody named, approved with no decided approval, turned down but not owner-only or with no review, waiting with no review |
| N waiting badges | `brain_files` uploads still `pending` | a waiting upload has no pending review, so the badge counts a file nobody can approve |
| Join call button | `bookings` (booked or rescheduled, from 2 hours ago to 45 days ahead, not test) with `tasks` | no web link on the booking or on its task |
| Client picker select | non-demo `clients` ranked newest first | the 201st and older (the picker lists 200), or a client with no name and no email |

All five are `emptyAs: "quiet"`: with no saved results the row is green with "no saved results yet, none are wrong" and goes red on the first wrong one.
The Join call check will be red on day one if bookings still carry no link: that is the same fact `calls:booked-no-join-link` already tracks
(migration 225 says the ClickFunnels webhook carries no join link).

## Shared lines I touched (for the integrator)

| File | Change |
|---|---|
| `src/pulse/catalog/proofs/display-saved-result.mjs` | one import line at the top, and `...FIN_B10_RESULT_CONTRACTS,` as the last entry of `DISPLAY_RESULT_CONTRACTS` |
| `src/pulse/catalog/proofs/display-proof-cases.mjs` | one import line and `...FIN_B10_DISPLAY_PROOF_CASES,` in the plug-in list |
| `scripts/pulse/compile-catalog.mjs` | one import line, and `staffProofCases: [...STAFF_UI_PROOF_CASES, ...FIN_B10_LIVE_CASES]` |
| `src/pulse/catalog/proofs/display-proof-cases.test.mjs` | red count 672 to 634 (-38: 5 live + 33 practice). Re-derive after merging all batches: it is 672 minus every attached row. |
| `src/pulse/coverage/gap-catalog-display.test.mjs` | contracts 40 to 45, PASS-capable 27 to 32, SQL batches 27 to 32, db calls 27 to 32, PASS rows 27 to 32, shipped-data check 40 to 45. When other batches add contracts, add the increases together. |
| `src/pulse/catalog/generated.json` | regenerated with `npm run pulse:catalog`. Expect a conflict; recompile after merging, do not hand-merge. |

## Product findings (nothing fixed)

1. **Control panel: Open Closer Deck and Open Credit Snapshot are hidden from every role.** `shell.js` gates each link by its `ALL` list of screens and `present.html` is not on it, so `gateLinks()` sets `display:none` for owner, admin, sales manager, closer, funding advisor, CSM, setter and inquiry specialist (measured). The page's own comment names the one-line fix. Both rows left NOT_PROVED.
2. **Control panel: the Open FinanceOS row says "owner, admin, sales_manager only", but a closer sees it too** (commit `ddcabb294`). The row text is stale. The practice test pins the real list (owner, admin, sales manager, closer) and every other role hidden. The page's own role list and the shell gate are two layers, so the test breaks the shell layer to prove the closer door.
3. **Company Brain: only owner and admin can open the page.** The shell sends closer, funding advisor, inquiry specialist, CSM, setter and sales manager to their own home. So the per-role class quizzes (a closer sees only closer quizzes) cannot be reached by the people they are for. The picker works for owner and admin (all 20).
4. **Control panel: Declines "Use this email" buttons sit inside the Record a decline fold.** When the client already has a decline that fold is shut, so the person must open it before the button can be pressed. (The button's `form.open = true` can never matter.)
5. **Closer dashboard: Deal breakdown sits inside the shut Payment Calculator fold**, so reaching it takes two presses. (Not wrong, only worth knowing.)
6. **Join call: `bookings.meeting_url` is NULL on every ClickFunnels booking** (migration 225), so the button is off for real customers. The new live check says so the moment a booked call is ahead.
7. **Campaign Manager: a partner login is sent away from the page**, so its partner-login branches (Sync now off for a partner) cannot be seen in a browser.

## What was proved and how

- Every new check was broken on purpose and went red, then the file was put back with the original text (the worktree was clean after each one).
  - Page breaks (each one a different line in the product file): 21 on the campaign manager, 42 on the control panel, 17 on the portal, 22 on the closer pages, 18 on company brain. 120 in all.
  - Breaks that first stayed green, and what was done:
    - Control panel, remove the "put away the partner links" branch: no screen path reaches it, so it cannot be seen. The add-partner flow was added (form away, links shown, exact body sent), and the "form away" and "links shown" breaks are red.
    - Control panel, add `csm` to the page's FinanceOS role list: stays green because the shell gate hides the link again. Equivalent change. The closer door was proved red by breaking the shell gate instead.
    - Portal, flip the pad's ink flag in Clear: equivalent (the screen reads the drawing itself). Removing the repaint is red.
    - Closer, Copy link `disabled = false`: green until a test sent a contract that returned no link. Now red.
    - Company brain, drop `setPending(0)` on a failed read: green until a test made a later read fail. Now red.
    - Company brain, change the Day 5 Pass words: green until a test answered all five questions well. Now red.
    - SQL, remove `c.id IS NULL` from the funnel contract: equivalent, the `IS DISTINCT FROM` clause beside it already catches a missing connection.
    - SQL, picker order ascending: green until a test put a nameless newest client beside five old ones. Now red.
  - SQL breaks: 36 on the five contracts (every clause removed one at a time), 35 red and 1 equivalent as written above.
- `fin-b10-*.test.mjs` all together, 3 runs: 97 tests, 97 pass, 0 fail, each time (load average 14 to 33).
- Catalog group (`src/pulse/catalog/*.test.mjs`, `src/pulse/catalog/proofs/*.test.mjs`, `gap-catalog*`, `gap-door-batch*`, `modules.test.mjs`), including the focused proof test that runs every executable test named by every case: 1,784 tests, 1,784 pass, 0 fail, 0 skipped.
- `npm run lint`: 3,574 files parse clean.
- `npm run pulse:catalog` then `node scripts/pulse/compile-catalog.mjs --check`: fresh.
- `node scripts/pulse/count-not-proved.mjs`: total 853 to 815; batch 10 rows 40 to 2.

## Commands

```
node scripts/pulse/count-not-proved.mjs <out.json>           # 853 before, 815 after
node --test src/pulse/catalog/proofs/fin-b10-*.test.mjs      # 97 of 97
node --test src/pulse/catalog/*.test.mjs src/pulse/catalog/proofs/*.test.mjs src/pulse/coverage/gap-catalog*.test.mjs src/pulse/coverage/gap-door-batch*.test.mjs src/pulse/coverage/modules.test.mjs   # 1784 of 1784
npm run lint
npm run pulse:catalog
```

## Environment note

The session scratch folder is shared by every builder running at once. Another builder overwrote a helper file of mine named `mutate.mjs` while I was working. Keep break-check helpers in a folder named for the batch.
