# Batch 10 manifest (tier 4, lane gap-catalog-display)

Branch `fin/b10`, built from `fin/base` (`2f4f574a0`). Work folder `.claude/worktrees/fin-b10`. Nothing was pushed or merged.
No product file was changed (not `public/app/shell.js`, not any page). Everything added is a test, a proof table, or a read-only check.

## Final state (repair cycle 1)

An independent checker broke 17 of the batch's rows and each one stayed green. This cycle made each one go red on that exact break,
or held it open with its exact reason. 39 of the batch's 40 rows are attached. One row is held open (NOT_PROVED) because no honest
check exists today.

| | Rows |
|---|---|
| Batch 10 rows | 40 (all `catalog-display`: campaign-manager 10, client-control-panel 13, client-portal 7, closer-call 1, closer-dashboard 5, company-brain 4) |
| Live checks | 7 (5 saved-result SQL checks, 2 link-gate checks that RUN the deployed gate) |
| Practice tests | 32 |
| Held open (not attachable) | 1 (Credit partner links, a real product race, see below) |

Whole display lane, measured offline with `node scripts/pulse/count-not-proved.mjs`: 853 NOT_PROVED on `fin/base`, 813 at the end of
generation 2, 814 now (the one held-open row is back on the list, on purpose).

## The 17 rows the checker broke, and what each one is now

| Row | Outcome | What was wrong, and what holds it now |
|---|---|---|
| campaign-manager / Funnel pages: Sync now button | live-check + practice test | The page's request method and sign-in header were not judged. The test now asserts POST, the `Authorization` header and the JSON content type. The redundant `c.id IS NULL` clause is gone from the SQL (the LEFT JOIN already gives a NULL company and platform). The browser test is now in the row's catalog test list. |
| campaign-manager / Link box: Creative select | practice-test | Creative and number were never saved together, and method and header were not judged. New test saves both in one press and asserts POST and the sign-in header on the save and on the creative read (GET with header). |
| campaign-manager / Link box: Our ad number input | practice-test | Same hole from the other side, same new test. |
| campaign-manager / Spend rail filter | practice-test | New fixture where one limit is over its limit but not breached and one is breached but back under, listed out of scope order. Counts, filters, order, `aria-pressed`. A failed read: no counts, footer and body say why, no headline chip. |
| campaign-manager / Fatigue state rail | practice-test | Failed-read state added for three failure kinds: no numbers beside any state, the footer says what failed, never "0 of 0". |
| campaign-manager / Fatigue row: Label button | practice-test | Label pressed on rows of a later paint (after a rail pick, after a window change). A saved sentence does not stay under another ad. |
| campaign-manager / Reload button | practice-test | Failed then recovered, good then failed (old rows cleared), a held read (the earlier failure line is put away while the new read is out), and exactly one more read per press. |
| client-control-panel / Client picker select | live-check + practice test + door test | New `fin-b10-clients-handler.test.mjs` holds the door (`GET /api/dashboard/clients`: newest first, `LIMIT $2` bound to 200, cap 500, demo hidden unless demo mode, company from the session, staff only, GET only). Page test adds names shown as text (no markup) and the empty choice goes nowhere. Both are in the row's catalog test list. |
| client-control-panel / Credit & Hold Status toggle | practice-test | Each value is read under its own label by position. Both fallbacks (analyzer status, newest round's hold) and their precedence. The `· sample` flag on a sample report, a dash stays a dash, a different report time is not the sample. The "do not quote" note. "Awaiting CRS" cleared once scores are on file. |
| client-control-panel / Blueprint group toggle | practice-test | A failed combined read paints a dash and a sentence (403 not a buyer, 401, 503, 500), never a figure, never `$0`, and no add form. No partner, partner number not worked out, nothing worked out. |
| client-control-panel / Credit partner links | **not-attachable** | See "Held open" below. |
| client-control-panel / More menu: Open Credit Snapshot link | live-check (now RUNS the deployed gate) | The check no longer models the shell. It GETs the deployed shell and the deployed page and runs the real shell for each staff role. Gate CODE that hides a link, a list the check was never told about, one role losing a link, a page that dropped the link or changed its address, and a click guard that refuses a shown link all go red. Still red today: the Closer Deck link is hidden from every role. |
| client-control-panel / Quick launch links | live-check (same runner) + practice test | Pipeline, Messaging and Inquiry Remover are judged for all 8 staff roles, the Closer Deck for owner, admin and closer. The static address of each link (the one a person with no client open presses) is now asserted. Red today for the Closer Deck link only. |
| closer-dashboard / Join call button | live-check + practice test | The SQL judged a different source than the button reads. It now judges what `/api/read/closer-call` returns as `join_url`: the LATEST task of the booked client with a non-blank link, and that link must be a web address. A link on the booking alone no longer turns it green. The task's company and client are pinned. |
| company-brain / 'N waiting' pending badges | live-check + practice test | Two-file cases: one waiting upload with a review does not excuse a second with none; another company's pending review does not count; a waiting Drive file is not counted. |
| company-brain / Add a document | live-check + practice test | All 8 surviving SQL breaks now go red (review status, review decided, review file, review company in each of the three branches). The busy guard is pressed while a file is in flight: disabled, a forced press opens no picker, a second file is not sent. |
| company-brain / Class quiz: 'Which quiz' picker | practice-test | Every quiz in the picker is painted with its own question words (not only the count). Day 5 with 1, 2 and 4 wrong is a Fail with the right "You got N of 5". |

## Held open: Credit partner links (not-attachable, exact reason)

`paintCombined()` in `client-control-panel.html` sets `el.partnerOpen.href` and `el.partnerConsent.href` (the two partner links) but never the
shell's own copy of the address, `data-fh-href`. `shell.js` `gateLinks()` runs twice (once from the cached role, once when the session answers)
and every pass rewrites each link from `data-fh-href`. So when the session answer arrives AFTER the Blueprint read, the second pass puts the
PRIMARY client back on both links: "Open the partner's file" opens the primary's file and "Record the partner's own consent" opens consent
capture for the primary.

Measured in Chromium with the real page and the harness (session answer held 0 ms, then 1.5 s):

| Session answer | Partner file link | Consent link |
|---|---|---|
| at once | `client-control-panel.html?id=<partner>` | `consent-capture.html?client_id=<partner>` |
| after 1.5 s | `client-control-panel.html?id=<primary>` | `consent-capture.html?client_id=<primary>` |

Why it cannot be attached honestly: a test that waits for the session answer is red until one line is fixed (set `data-fh-href` beside each
`href` in `paintCombined`), and the repo's rules forbid a red test and forbid this batch fixing product code. A test that does not wait is green
over the break, which is what the checker found. The pulse cannot see it either: it is the timing of one browser session, not a saved result and
not a deployed list. The row is held in the lane as NOT_PROVED with these words (`OPEN_GAP` in `fin-b10-display-contracts.mjs`).
`fin-b10-rows.test.mjs` reads `paintCombined()` and goes red the day it sets `data-fh-href`, saying the row can now be attached.
The browser test still presses both links (instant session) and stays green.

Product finding for consent capture: until that line is fixed, a closer can be sent to the primary client's consent screen from the partner's
button.

## What was built this cycle

| File | Change |
|---|---|
| `src/pulse/coverage/fin-b10-link-gate.mjs` | REWRITTEN. Two plain GETs (`/app/shell.js`, `/app/client-control-panel.html`), page links lifted out, then the deployed shell is RUN for each of the 8 staff roles in a vm context inside a worker thread (null-prototype sandbox, nothing but strings crossing, script time limits, memory cap, hard stop that waits for the thread to be gone). Reads back, per link: shown, and whether the shell's click guard lets a press through. Judges each contract link: on the page once, points at its screen, shown and pressable for every named role. Anything unreadable or unrunnable is `skip`. |
| `src/pulse/coverage/fin-b10-link-gate.test.mjs` | REWRITTEN, 18 tests. Real shell and real page of the checkout plus copies with one thing broken. |
| `src/pulse/catalog/proofs/fin-b10-display-contracts.mjs` | Join call SQL rewritten to the button's own source. Funnel clause removed. Redundant `IS NOT NULL` removed from Join call. Link-gate contracts name link ids, files, labels and roles. New `OPEN_GAP` always-red contract, `FIN_B10_OPEN_ROWS`, `FIN_B10_COMPILE_CASES`. |
| `src/pulse/catalog/proofs/fin-b10-display-proofs.mjs` | A live row's test list now also names its browser test (and the picker's door test). |
| `src/pulse/catalog/proofs/fin-b10-rows.json` | The partner links row moved to `notAttached`. |
| `src/pulse/catalog/proofs/fin-b10-rows.test.mjs` | Guards: 7 live, 32 practice, 1 held open; each live row lists its browser test; the held-open reason is still true of the page. |
| `src/pulse/catalog/proofs/fin-b10-live-contracts.test.mjs` | 70 tests (was 50): review status/decision/file/company per branch, two-file waiting cases, the Join call rewrite with client and company pins. |
| `src/pulse/catalog/proofs/fin-b10-campaign-manager.test.mjs` | 14 tests (was 12). Method and header judged on every request. |
| `src/pulse/catalog/proofs/fin-b10-client-control-panel.test.mjs` | 12 tests. The oracle is the gate runner (this checkout's shell and page, per role), compared with Chromium for all 8 roles. |
| `src/pulse/catalog/proofs/fin-b10-company-brain.test.mjs` | 5 tests. |
| `src/pulse/catalog/proofs/fin-b10-clients-handler.test.mjs` | NEW, 6 tests: the picker's door. |

## Shared lines I touched (for the integrator)

| File | Change |
|---|---|
| `scripts/pulse/compile-catalog.mjs` | the import and the `staffProofCases` spread now name `FIN_B10_COMPILE_CASES` (the 7 live rows and the 1 held-open row) instead of `FIN_B10_LIVE_CASES`. |
| `src/pulse/coverage/gap-catalog-display.test.mjs` | 10 numbers: contracts 47 to 48, always-red 13 to 14 (the held-open row). `PASS_CAPABLE` stays 32, link-gate stays 2. When other batches add contracts, add the increases together. |
| `src/pulse/catalog/proofs/display-proof-cases.test.mjs` | red count 632 to 633 (+1 for the held-open row). Re-derive after merging all batches. |
| `src/pulse/catalog/generated.json` | regenerated with `npm run pulse:catalog`. Expect a conflict; recompile after merging, do not hand-merge. |
| `src/pulse/coverage/gap-catalog-display.mjs` | one COMMENT edited (it said one GET of the shell; it is two GETs and a run). No code changed. |

`src/pulse/catalog/proofs/display-saved-result.mjs` was not touched this cycle.

## Break checks (each put back, tree restored and checked after each)

| Where | Breaks | Red |
|---|---|---|
| SQL (five live contracts) | 54: every predicate of each contract dropped, loosened or reversed (including the checker's U8 U10 U11 U12 U13 U17 U18 U19 W1 W4 W6 J9 J10) | 54 of 54 (one `IS NOT NULL` was an equivalent mutant: removed from the SQL) |
| `campaign-manager.html` | 40: PUT instead of POST, no `Authorization`, creative dropped with a number, number dropped with a creative, three wrong breached rules, counts on a failed read, scope sort, `aria-pressed`, Label dead after a rail pick or a window change, stale saved sentence, failure sentence kept, old rows kept under a failed read, source marks not reset, Reload wired twice, and more | 40 of 40 |
| `client-control-panel.html` | 40: labels, both fallbacks and their precedence, sample flag, note deleted, `$0` on a failed read, add form on a failed read, partner row, unknown numbers as `$0`, names not escaped, empty choice navigates, asks for 50, five static addresses, links removed, client dropped from links | 40 of 40 |
| `company-brain.html`, `ramp-quizzes.js` | 24: both busy guards, disabled flags, busy never set or cleared, wrong quiz on load, picker not repainting, Day 5 rule (one right, all but one), count doubled, badge words and hiding | 24 of 24 |
| `fin-b10-link-gate.mjs` | 21: shown always true, mark ignored, display ignored, hidden flag ignored, page-hidden ignored, click guard ignored, only first role, link missing ignored, address ignored, GET to POST, failure called PASS, unfinished gating accepted, session branch not required, only owner run, host sandbox object, no time limit, wrong page accepted, sign-out not noticed, replace not noticed, gate style left, thread not stopped | 21 of 21 |
| deployed gate, shell breaks the old check was blind to | list reassigned in code after its literal, `gateLinks` forcing a screen off, the closer branch returning nothing, a new list in `staffTabs`, csm alone, admin alone, role sent away, click guard refusing | all red (in `fin-b10-link-gate.test.mjs`) |
| Browser test cross-check | module `shown` always true: red in Chromium comparison (3 tests) | red |

Escape probes (in the link-gate test, 14 of them, run inside the worker): `process`, `require`, `this.constructor.constructor("return process")()` and
nine more constructor chains. One of them DID leak while the sandbox was a plain `{}` (the first version of the runner, in the test process: the process
exited with code 7); the null-prototype sandbox closed it and the test goes red if the plain object is put back. A `for (;;) {}` shell, a never-ending microtask chain and a shell with an uncaught
rejection are each cut off or contained.

## Product findings (nothing fixed)

1. **Control panel: Open Closer Deck and Open Credit Snapshot are hidden from every role.** Unchanged. `present.html` is on no list in `shell.js`.
   Both rows are RED in the live pulse until it lands, and go green by themselves after. Re-measured live this cycle (`gapChecks`, two GETs):
   all 8 staff roles see Pipeline, Messaging and Inquiry Remover; none sees either deck link.
2. **Control panel: the partner links go to the primary client when the session answer is slow.** See "Held open".
3. **Join call: the button opens the client's latest task link, not the link of the booking in front of the closer.** `join_url` is the newest
   task of the client with a non-blank link, ordered by due time. A client with an old finished call whose link is saved and a new booking whose
   task has no link gets the old call's link behind the button. (Read from `src/sales/cockpit.mjs`, not reproduced.)
4. **Join call: `bookings.meeting_url` is not read by the button at all**, so a booking that carries a link (the ClickFunnels webhook does not
   send one, migration 225) does not turn the button on. The live check now says so.
5. **Control panel: the Open FinanceOS row says "owner, admin, sales_manager only", but a closer sees it too.** Unchanged.
6. **Company Brain: only owner and admin can open the page.** Unchanged.
7. **Control panel: Declines "Use this email" buttons sit inside the Record a decline fold.** Unchanged.
8. **Closer dashboard: Deal breakdown sits inside the shut Payment Calculator fold.** Unchanged.
9. **Campaign Manager: a partner login is sent away from the page**, so its partner-login branches cannot be seen in a browser. Unchanged.

## Commands and results

```
node scripts/pulse/count-not-proved.mjs <out.json>      # 814 open (813 at the end of generation 2, +1 held-open row)
node --test src/pulse/coverage/fin-b10-link-gate.test.mjs                    # 18 of 18
node --test src/pulse/catalog/proofs/fin-b10-live-contracts.test.mjs         # 70 of 70
node --test src/pulse/catalog/proofs/fin-b10-clients-handler.test.mjs        # 6 of 6
node --test src/pulse/catalog/proofs/fin-b10-rows.test.mjs                   # 4 of 4
node --test src/pulse/coverage/gap-catalog-display.test.mjs                  # 11 of 11
node --test src/pulse/catalog/proofs/fin-b10-campaign-manager.test.mjs       # 14 of 14
node --test src/pulse/catalog/proofs/fin-b10-client-control-panel.test.mjs   # 12 of 12
node --test src/pulse/catalog/proofs/fin-b10-company-brain.test.mjs          # 5 of 5
node --test src/pulse/catalog/*.test.mjs src/pulse/catalog/proofs/fin-b10-*.test.mjs src/pulse/coverage/gap-catalog*.test.mjs \
  src/pulse/coverage/gap-door-batch*.test.mjs src/pulse/coverage/modules.test.mjs src/pulse/coverage/fin-b10-link-gate.test.mjs \
  src/http/app-nav-reachability.test.mjs                                    # 274 tests, 274 pass, 0 fail, 0 skipped
npm run pulse:catalog && node scripts/pulse/compile-catalog.mjs --check      # fresh, exit 0
node --test src/pulse/catalog/proofs/display-proof-cases.test.mjs            # 3 of 3 (7.5 minutes: runs every executable test of every display case, all batches)
npm run lint                                                                 # 3,576 files parse clean
```

Live read-only verification (two GETs of the public site, `linkGateState`): both link-gate rows FAIL with the words "Open Closer Deck
(present.html) is hidden from owner, admin and closer (it shows for no staff role)"; the other three Quick launch links show for all 8 roles.
The gate run takes about 45 ms for all 8 roles.

## Risk and not run

- **New capability in the live lane.** The two link-gate rows now execute the company's own deployed `shell.js` inside a worker thread and a
  vm context (see the header of `fin-b10-link-gate.mjs`). A shell that cannot be run, or that does not finish gating, is `skip` with the
  reason, never PASS. If the deployed shell is ever rewritten so the stand-in cannot run it, both rows go to `skip` and stay there (a lasting
  skip is a break in the heartbeat by the repo's own law): the fix is then to teach the stand-in the new API, not to loosen the judge.
- **`npm run pulse:prove` was not run.** It builds the Netlify bundle and needs the production environment, neither of which this worktree has.
  The lane was loaded from a copied `pulse` folder with no repo files (`gap-catalog-display.test.mjs`, passing), and the real deployed site was
  read once (two GETs), as above.
- **The Client picker row's live half is still a re-derivation.** The pulse cannot call the staff-only door, so the SQL reads the clients table
  and holds the same rule as the door. The door and the page are held by their own tests, which are in the row's catalog test list.

## History

- Generation 1: 38 of 40 attached (5 live SQL checks, 33 practice tests), 2 left as not-attachable.
- Generation 2: the two open rows became live link-gate checks that read the deployed shell's lists, all 40 attached.
- Repair cycle 1 (this file): the checker's 17 green-on-break rows. The link-gate checks now run the deployed gate instead of modelling it.
  One row (Credit partner links) is held open with its exact reason.
- Environment note: the session scratch folder is shared by every builder running at once. Keep break-check helpers in a folder named for the batch.
