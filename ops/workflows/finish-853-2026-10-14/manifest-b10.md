# Batch 10 manifest (tier 4, lane gap-catalog-display)

Branch `fin/b10`, built from `fin/base` (`2f4f574a0`). Work folder `.claude/worktrees/fin-b10`. Nothing was pushed or merged.
No product file was changed (not `public/app/shell.js`, not any page). Everything added is a test, a proof table, or a read-only check.

## Final state (generation 2, the challenge run)

All 40 rows are attached. 7 are live checks, 33 are practice tests, 0 are left as not-attachable.

| | Rows |
|---|---|
| Batch 10 rows | 40 (all `catalog-display`: campaign-manager 10, client-control-panel 13, client-portal 7, closer-call 1, closer-dashboard 5, company-brain 4) |
| `openBefore` on `fin/base` (generation 1 start) | 40 |
| `openBefore` at the start of this run (this branch) | 2 |
| `openAfter` | 0 |
| Live checks | 7 (5 saved-result SQL checks, 2 link-gate checks) |
| Practice tests | 33 |
| Not attachable | 0 |

Whole display lane, measured offline with `node scripts/pulse/count-not-proved.mjs`: 853 NOT_PROVED on `fin/base`, 815 at the start of
this run, 813 after (the two rows below left the count).

## The challenge: why the two "not-attachable" reasons were not exactly true

The two rows, `More menu: Open Credit Snapshot link` and `Quick launch links: Open Pipeline, Closer Deck, Messaging, Inquiry Remover`,
were left unattached because `shell.js` hides the Closer Deck link (`present.html`) from every role. The earlier reasons said no honest
test can attach: a test that asserts "hidden" is green over a broken control, and a test that asserts "visible" is red today.

That mixes up two different things. A test in the suite must stay green, so it cannot assert "visible" today. A live check in the pulse is
SUPPOSED to be red when the result a person gets is wrong. The control leaves a readable result: the deployed link gate. So it is a live
check, and it is red today because the control really is broken. That is the heartbeat doing its job, not a fake pass.

| Fact re-measured this run | Result |
|---|---|
| Deployed `https://fundhub.ai/app/shell.js` (GET, 140,256 bytes) against `public/app/shell.js` | byte for byte the same, zero mentions of `present.html` |
| Is `present.html` on `ALL`, `STAFF_MONEY`, or any role list the roles are built from? | No. `rolesThatCanOpen(lists, "present.html")` is empty for all 8 staff roles |
| The other three Quick launch screens (`pipeline.html`, `messaging.html`, `inquiry-remover.html`) | open for all 8 staff roles |
| Live verdict of the new check against the real site (`gapChecks({})`, one GET) | both rows FAIL: `present.html is hidden from every staff role (owner, closer cannot press it)` |

### What was built for the two rows

- `src/pulse/coverage/fin-b10-link-gate.mjs` (new, pure, imports nothing, reads no repo file at run time). One GET of `/app/shell.js`
  (method GET, redirects not followed, 5 s cap). It lifts the twelve screen lists out of the file with a small scanner that skips
  comments, works out which of the 8 staff roles may open each screen the same way `shell.js` `allowedFor()` and `staffTabs()` do, and
  judges the contract: PASS when every named screen opens for every named role, FAIL naming each screen that does not and who it is
  hidden from. A GET that fails, a non-200, or a shell that no longer declares its lists as plain arrays is `skip` with the reason. It is
  never PASS and never a made-up FAIL.
- Two `link-gate` contracts in `fin-b10-display-contracts.mjs`. Each names its screens and the roles that must be able to open them
  (owner and closer). It goes green by itself the day the screen is added to `shell.js`, with no test to edit.
- The browser practice test `fin-b10-client-control-panel.test.mjs` was changed from "the links are hidden for every role" (which would
  have gone red on the product fix) to "each link is shown exactly when the gate lets that role open the screen", for all 8 roles and all
  four links, and a shown link is pressed and must land on the screen. This ties the live check to what a person sees, in both states.

### Break checks for the new check (each put back, tree clean after each)

| Break | Result |
|---|---|
| Add `present.html` to `ALL` in `public/app/shell.js` (the fix) | live check PASS on both rows; browser test green with the link shown and pressed (twice) |
| Take `messaging.html` off `ALL` | Quick launch row FAIL naming `messaging.html` as well as `present.html`; Credit Snapshot row unchanged |
| Hide `pipeline.html` from the closer only inside `gateLinks()` (a gate change the role model does not know) | browser test RED: `closer: ccp-link-pipeline (pipeline.html) is shown only when the link gate lets this role open it`, expected true, actual false |
| Module: closer loses the closer desk list | 2 tests RED |
| Module: GET becomes POST | 2 tests RED |
| Module: a failed read is called PASS | 2 tests RED |
| Module: line comments not skipped | 8 tests RED |
| Module: roles ignored (any role will do) | 1 test RED |
| Module: redirects followed | 1 test RED |

## Every row

| Row (page / control) | Outcome | Proved by |
|---|---|---|
| campaign-manager.html / Drawer: metric buttons (spend, impressions, clicks, conversions, and more) | practice-test | fin-b10-campaign-manager.test.mjs |
| campaign-manager.html / Fatigue row: Label button (opens link box) | practice-test | fin-b10-campaign-manager.test.mjs |
| campaign-manager.html / Fatigue state rail (all, refresh, queue, ok, unconfigured) | practice-test | fin-b10-campaign-manager.test.mjs |
| campaign-manager.html / Fatigue Window select (7, 14, 30 days) | practice-test | fin-b10-campaign-manager.test.mjs |
| campaign-manager.html / Funnel pages: Sync now button | live-check | fin-b10-display-contracts.mjs (SQL) + practice test |
| campaign-manager.html / Link box: Close button | practice-test | fin-b10-campaign-manager.test.mjs |
| campaign-manager.html / Link box: Creative select | practice-test | fin-b10-campaign-manager.test.mjs |
| campaign-manager.html / Link box: Our ad number input | practice-test | fin-b10-campaign-manager.test.mjs |
| campaign-manager.html / Reload button | practice-test | fin-b10-campaign-manager.test.mjs |
| campaign-manager.html / Spend rail filter (all, breached, ok) | practice-test | fin-b10-campaign-manager.test.mjs |
| client-control-panel.html / Agent context toggle and pre block (what the AI sees) | practice-test | fin-b10-client-control-panel.test.mjs |
| client-control-panel.html / Blueprint group toggle | practice-test | fin-b10-client-control-panel.test.mjs |
| client-control-panel.html / Client picker select (200 clients, navigates to ?id=) | live-check | fin-b10-display-contracts.mjs (SQL) + practice test |
| client-control-panel.html / Credit & Hold Status toggle (credit status, income estimates, hold reason) | practice-test | fin-b10-client-control-panel.test.mjs |
| client-control-panel.html / Credit partner links: Open the partner's file, Record the partner's own consent | practice-test | fin-b10-client-control-panel.test.mjs |
| client-control-panel.html / Declines: Use this email button | practice-test | fin-b10-client-control-panel.test.mjs |
| client-control-panel.html / Details toggle (email, phone, tier, path) | practice-test | fin-b10-client-control-panel.test.mjs |
| client-control-panel.html / More menu: Open Bank Inbox button | practice-test | fin-b10-client-control-panel.test.mjs |
| client-control-panel.html / More menu: Open Credit Snapshot link | live-check | fin-b10-link-gate.mjs (live GET of the deployed shell) + fin-b10-link-gate.test.mjs + browser test. RED today: present.html is hidden from every role |
| client-control-panel.html / More menu: Open Funding Matrix link | practice-test | fin-b10-client-control-panel.test.mjs |
| client-control-panel.html / Open FinanceOS link (owner, admin, sales_manager only) | practice-test | fin-b10-client-control-panel.test.mjs |
| client-control-panel.html / Quick launch links: Open Pipeline, Closer Deck, Messaging, Inquiry Remover | live-check | fin-b10-link-gate.mjs (live GET of the deployed shell) + fin-b10-link-gate.test.mjs + browser test. RED today: Closer Deck (present.html) is hidden from every role; the other three pass |
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
| closer-dashboard.html / Join call button (opens the booked call link) | live-check | fin-b10-display-contracts.mjs (SQL) + practice test |
| closer-dashboard.html / Present button (opens present.html?contact= in a new tab) | practice-test | fin-b10-closer.test.mjs |
| company-brain.html / 'N waiting' pending badges (two) | live-check | fin-b10-display-contracts.mjs (SQL) + practice test |
| company-brain.html / Add a document: '+' button then file picker (PDF, Word, Excel, PowerPoint, text; 25 MB cap) | live-check | fin-b10-display-contracts.mjs (SQL) + practice test |
| company-brain.html / Answer source list: 'Open in Drive' link and 'Client record' link | practice-test | fin-b10-company-brain.test.mjs |
| company-brain.html / Class quiz: 'Which quiz' picker | practice-test | fin-b10-company-brain.test.mjs |

A "live check" row also has a practice test that presses the control in a real page (extra cover). The seven live checks are judged
by the display lane from the live system; the catalog treats a row as one or the other, never both.

## What was built

All new logic is in new `fin-b10-*` files. Generation 1 (practice tests and the five SQL checks) and this run's link-gate check:

| File | What it is |
|---|---|
| `src/pulse/coverage/fin-b10-link-gate.mjs` | NEW this run. The live link-gate check: one GET of the deployed shell, list scanner, role model, judge. |
| `src/pulse/coverage/fin-b10-link-gate.test.mjs` | NEW this run. 11 practice tests: scanner, role model on a stand-in shell, red and green cases, GET shape, unreadable shell is skip, lane integration, real shell is readable. |
| `src/pulse/catalog/proofs/fin-b10-kit.mjs` | Row tracker (a row is claimed only inside the callback that asserts it, an empty callback is refused), the shared Chromium helper, `waitFor`, `dialogs`. |
| `src/pulse/catalog/proofs/fin-b10-rows.json` | Which control rows each test file proves. The two rows left out before are now ordinary rows (no `notAttached`). |
| `src/pulse/catalog/proofs/fin-b10-campaign-manager.test.mjs` | 10 controls (browser). |
| `src/pulse/catalog/proofs/fin-b10-client-control-panel.test.mjs` | 13 controls (browser). Changed this run: the two link rows now follow the gate for all 8 roles in both states. |
| `src/pulse/catalog/proofs/fin-b10-client-portal.test.mjs` | 7 controls (browser). |
| `src/pulse/catalog/proofs/fin-b10-closer.test.mjs` | 6 controls (browser). |
| `src/pulse/catalog/proofs/fin-b10-company-brain.test.mjs` | 4 controls (browser). |
| `src/pulse/catalog/proofs/fin-b10-display-contracts.mjs` | The seven contracts: five query contracts (one read-only SQL each, `emptyAs: "quiet"`) and two `link-gate` contracts, their map rows, the deep cases handed to the catalog compiler. |
| `src/pulse/catalog/proofs/fin-b10-sql-kit.mjs` | Test kit for the five SQL contracts (real column names, in-memory SQLite). |
| `src/pulse/catalog/proofs/fin-b10-live-contracts.test.mjs` | 50 tests for the five SQL contracts. |
| `src/pulse/catalog/proofs/fin-b10-display-proofs.mjs` | Turns the rows table and the live rows into proof cases for the catalog. |
| `src/pulse/catalog/proofs/fin-b10-rows.test.mjs` | Guards: every row is one exact map row, 7 live and 33 practice, none left out, the two link-gate rows are served by the lane and the page still carries every link they judge. |

Removed this run: `fin-b10-not-attachable.mjs` and the two guards that read `shell.js` to hold the reasons true. They would have gone red
the day the product fix landed. The live check replaces them and flips by itself.

### The five SQL live checks (unchanged)

| Control | Read-only SQL judges, per saved result | Goes red when |
|---|---|---|
| Funnel pages: Sync now | `funnel_page_stats` rows of the last 60 days against `analytics_connections` | no connection, another company's connection, a non-ClickFunnels connection, negative views or conversions (NULL is fine), a stat dated after the day it was saved |
| Add a document: + button | `brain_files` uploads (`source = 'upload'`) of the last 60 days with `brain_classification_reviews` | not an `upload:` id, no name, no size, nobody named, approved with no decided approval, turned down but not owner-only or with no review, waiting with no review |
| N waiting badges | `brain_files` uploads still `pending` | a waiting upload has no pending review, so the badge counts a file nobody can approve |
| Join call button | `bookings` (booked or rescheduled, from 2 hours ago to 45 days ahead, not test) with `tasks` | no web link on the booking or on its task |
| Client picker select | non-demo `clients` ranked newest first | the 201st and older (the picker lists 200), or a client with no name and no email |

All five are `emptyAs: "quiet"`. The Join call check will be red on day one if bookings still carry no link: that is the same fact
`calls:booked-no-join-link` already tracks (migration 225 says the ClickFunnels webhook carries no join link).

## Shared lines I touched (for the integrator)

| File | Change |
|---|---|
| `src/pulse/coverage/gap-catalog-display.mjs` | NEW this run: one import line (`fin-b10-link-gate.mjs`); one line in `judgeDisplayResult` (`link-gate` mode goes to the link-gate judge); in `gapChecks` three lines before the retired-page read (start the one GET of the shell) and one line after it (await it), plus one line inside the `judge` closure. No existing line was changed. |
| `src/pulse/coverage/gap-catalog-display.test.mjs` | contracts 40 to 47 (45 from generation 1, +2 link-gate), `PASS_CAPABLE` stays 32, `always-red` stays 13, `link-gate` 2, mode list gains `"link-gate"`, one new assertion that the two link-gate rows say `skip` under the stand-in GET, shipped-data check 40 to 47. When other batches add contracts, add the increases together. |
| `src/pulse/catalog/proofs/display-saved-result.mjs` | one import line at the top, and `...FIN_B10_RESULT_CONTRACTS,` as the last entry of `DISPLAY_RESULT_CONTRACTS` (unchanged this run; the two new contracts ride inside `FIN_B10_RESULT_CONTRACTS`) |
| `src/pulse/catalog/proofs/display-proof-cases.mjs` | one import line and `...FIN_B10_DISPLAY_PROOF_CASES,` in the plug-in list (unchanged this run) |
| `scripts/pulse/compile-catalog.mjs` | one import line, and `staffProofCases: [...STAFF_UI_PROOF_CASES, ...FIN_B10_LIVE_CASES]` (unchanged this run) |
| `src/pulse/catalog/proofs/display-proof-cases.test.mjs` | red count 672 to 632 (-40: 7 live + 33 practice). Re-derive after merging all batches: it is 672 minus every attached row. |
| `src/pulse/catalog/generated.json` | regenerated with `npm run pulse:catalog`. Expect a conflict; recompile after merging, do not hand-merge. |

## Product findings (nothing fixed)

1. **Control panel: Open Closer Deck and Open Credit Snapshot are hidden from every role.** `shell.js` gates each link by its `ALL` list of
   screens and `present.html` is not on it, so `gateLinks()` sets `display:none` for owner, admin, sales manager, closer, funding advisor,
   CSM, setter and inquiry specialist (measured in Chromium, and the deployed `/app/shell.js` is the same file). The page's own comment
   names the one-line fix: add `present.html` to the right role list in `public/app/shell.js`. Both rows are now RED in the live pulse until it lands, and go
   green by themselves after. The "Present" button on the closer dashboard is a different control and works.
2. **Control panel: the Open FinanceOS row says "owner, admin, sales_manager only", but a closer sees it too** (commit `ddcabb294`). The row
   text is stale. The practice test pins the real list (owner, admin, sales manager, closer) and every other role hidden.
3. **Company Brain: only owner and admin can open the page.** The shell sends closer, funding advisor, inquiry specialist, CSM, setter and
   sales manager to their own home. So the per-role class quizzes cannot be reached by the people they are for. The picker works for
   owner and admin (all 20).
4. **Control panel: Declines "Use this email" buttons sit inside the Record a decline fold.** When the client already has a decline that fold
   is shut, so the person must open it before the button can be pressed.
5. **Closer dashboard: Deal breakdown sits inside the shut Payment Calculator fold**, so reaching it takes two presses. (Not wrong, only
   worth knowing.)
6. **Join call: `bookings.meeting_url` is NULL on every ClickFunnels booking** (migration 225), so the button is off for real customers. The
   live check says so the moment a booked call is ahead.
7. **Campaign Manager: a partner login is sent away from the page**, so its partner-login branches (Sync now off for a partner) cannot be
   seen in a browser.

## What was proved and how

Generation 1 (kept, still true):

- Every new check was broken on purpose and went red, then the file was put back. Page breaks: 21 on the campaign manager, 42 on the
  control panel, 17 on the portal, 22 on the closer pages, 18 on company brain (120 in all). SQL breaks: 36 on the five contracts (35 red,
  1 equivalent).
- Breaks that first stayed green were fixed by adding the missing case (partner add flow, Copy link with no link, a failed read clearing the
  badge, Day 5 pass words, picker order), see the history below.

This run:

- Break checks for the link-gate check: see the table above (9 of 9 red or flipped as expected, product file restored each time).
- Tests are listed in the commands section with their results.

## Commands

```
node scripts/pulse/count-not-proved.mjs <out.json>                         # this branch: 815 open before this run, 813 after; batch rows 2 to 0
node --test src/pulse/coverage/fin-b10-link-gate.test.mjs                 # 11 of 11
node --test src/pulse/coverage/gap-catalog-display.test.mjs               # 10 of 10
node --test src/pulse/catalog/proofs/fin-b10-rows.test.mjs src/pulse/catalog/proofs/fin-b10-live-contracts.test.mjs src/pulse/coverage/modules.test.mjs   # 57 of 57
node --test src/pulse/catalog/proofs/fin-b10-client-control-panel.test.mjs  # 12 of 12 in today's state, and 12 of 12 with present.html added to ALL
npm run pulse:catalog
node scripts/pulse/compile-catalog.mjs --check
npm run lint
```

## History

- Generation 1: 38 of 40 attached (5 live SQL checks, 33 practice tests), 2 left as not-attachable.
- Generation 2, first pass and the resume check after the Mac restart: re-read both rows and agreed with the reasons (present.html on no list,
  deployed file identical). The reasons were true as facts. The conclusion was not: a live check can attach to the deployed gate.
- Environment note: the session scratch folder is shared by every builder running at once. Another builder once overwrote a helper file of
  mine named `mutate.mjs`. Keep break-check helpers in a folder named for the batch.
