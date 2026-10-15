# Batch 01 manifest: finish the 853 (tier 1, lane gap-catalog-display, 40 rows)

Branch `fin/b01`, built from `fin/base` at `2f4f574a0`. Worktree `.claude/worktrees/fin-b01`. Nothing was pushed or merged.
Generation 1 built the 34 rows below that are bound to browser specs and live checks and left six rows open as
"not attachable". Generation 2 (this file's top section) challenged all six and closed every one: two with a practice
test, four as verified nothing-to-judge (the controls were removed from the product on purpose). The generation 1
text further down is kept; where it says "not attachable" for these six, the generation 2 section wins.

## Generation 2: the six rows that were left open

Measured with `node scripts/pulse/count-not-proved.mjs` on this branch: the batch had 6 rows open at the start of this
run (819 open in all), and 0 after (813 open in all; display lane 646 to 640). The six are all in this batch, none in
another.

| Row | Generation 1 said | Generation 2 outcome | Why |
|---|---|---|---|
| client-portal.html "Unlock buttons (...; opens modal)" | not attachable: no product has a checkout link | **practice-test** | The page has a written rule for the day a product gets a `checkoutUrl` (paintTile and openUnlock say so). The new spec gives products a fake link the way a later change would and judges that rule in a real page, and it judges the shipped state (no link, no button) too. |
| client-portal.html "Unlock modal: Unlock pay now button (goes to product checkoutUrl)" | not attachable | **practice-test** | Same spec: pay now goes to that product's own link, says it is opening, turns itself off; Close and Escape never go to a checkout link. Six products, six tests. |
| present.html "'$ amount' e-book price box" | not attachable: stale row | **na-verified** | The control was retired on purpose, and the repo pins it twice (`src/http/closer-deck-present.test.mjs`: "has no retired e-book control"; `src/http/closer-deck-endpoints.test.mjs`: "retired ebook action is refused"). A stale row is not a "needs the control built" case. It is nothing to judge, and the pulse re-reads the live files every run. |
| present.html "'Send e-book email' ..." | not attachable: stale row | **na-verified** | Same. |
| optimize.html "Audit intake and Pay for Audit ..." | not attachable | **na-verified** | `docs/journeys/optimize-actual.md`: "The Audit section and the Pay-for-Audit checkout stay removed by owner decision" (2026-08-28) and "nothing calls POST /api/public/optimize". The page only reads its sign-up config. |
| climate/index.html "Gate button: unlock the full list ..." | not attachable | **na-verified** | The page that held the gate was reverted (`f39cec357`, "Revert Claude climate visitor page") and `/climate/` is now Darwin's dashboard (`8547bb72a`), which has no gate. The row was listed from a journey doc, not from the shipped page. |

### How a verified nothing-to-judge works for the four retired controls

`src/pulse/coverage/fin-b01-retired-controls.mjs` lists, per row, the live files to read (GET only) and what must NOT be
in them: an e-book control in `/app/present.html`, `/app/present.js`, `/app/contract-send.js`; Pay for Audit, the
Consulting Services Assessment title or a POST on `/optimize`; the gate, the `$32` text or a call to
`/api/public/optimize` on `/climate/` and the page scripts it names. Each file also has a marker that must be there, so a
blank page or a sign-in page cannot read as "gone".

- All four files and markers present, none of the control: row is `na`, code `catalog-display-retired-control`.
- The control is back in any file: row is `FAIL` and says which file ("The control is back and has no proof attached").
- A file that loads but no longer looks like the page (marker missing, empty body): `FAIL`.
- A file that cannot be read (network, non-200, no GET client): `skip`. Never `na`, never a pass.
- The morning audit re-runs the claim through `naVerify["catalog-display-retired-control"]` in
  `gap-catalog-display.mjs`, so a stale "nothing to judge" becomes "not checked", which is red.

Run once against the live public site by hand (GET only, six requests, each page read once): all four rows `na`.

**Read the offline count honestly.** `count-not-proved.mjs` answers every GET with an empty 200 body. The four retired
rows cannot be proved from an empty body, so offline they print `FAIL` (not `NOT_PROVED`) and drop off the count. On the
live server they read the real files and print `na`. That is the same way the retired Decline Autopsy rows already behave
offline. The 813 is "rows that still say NOT_PROVED", not "rows that are green offline".

### What was broken on purpose in generation 2 (each went red, then was put back)

Practice test, in `public/app/client-portal.html` (`e2e/fin-b01-portal-unlock.spec.mjs`, 13 tests):
| # | Break in `public/app/client-portal.html` | Tests red |
|---|---|---|
| 1 | Unlock button always shown (`unlockBtn.hidden = false`) | 2 (shipped state; one link, one button) |
| 2 | Unlock button never shown (`hidden = true`) | 11 |
| 3 | Button for every product (`canBuy` ignores `checkoutUrl`) | 2 |
| 4 | Pay now always goes to the soft pull's link | 5 (the other five products) |
| 5 | "Opening secure checkout…" text not set | 6 |
| 6 | Pay now never shown in the modal (`go.hidden = true`) | 7 |
| 7 | Pay now says only "Unlock", not "Unlock — price" | 1 |
| 8 | Close no longer closes a View status modal | 1 |
| 9 | Escape handler removed | 1 |
| 10 | An owned product keeps its Unlock attribute | 2 |
| 11 | A finished soft pull is sold again | 1 |
| 12 | Pay now stays pressable while leaving (`disabled` removed) | 6 |
| 13 | Talk button text not changed when a link exists | 1 |
| 14 | "Online checkout is not available" note always shown | 1 |
| 15 | Modal price not painted | 1 |

Each was applied alone, the spec was run, and the file was put back from memory and checked clean against HEAD. Two
breaks were not made because no person can see them: `go.hidden = false` in `openUnlock` (the modal cannot be opened
from an Unlock button that is hidden, so the pay button is never reached without a link), and the "Checkout not
available" branch of the pay button (same reason).

Retired controls, in the real product files (`src/pulse/coverage/fin-b01-retired-controls.test.mjs`, 10 tests; the file
was restored and checked clean against HEAD after each):

| Break | Red |
|---|---|
| `public/app/present.js`: a "Send e-book email" comment appended | 4 tests (shipped-files nothing-to-judge, both e-book rows, lane) |
| `public/app/present.html`: an `fh-ebook` price box appended | 4 tests |
| `public/optimize.html`: a "Pay for Audit" button appended | 3 tests |
| `public/climate/_next/static/chunks/app/page-*.js`: a POST to `/api/public/optimize` appended | 2 tests |

The tests also hold the break in memory: every file is changed one at a time through a fake site that serves the shipped
files (e-book word, `send_ebook`, `fh-ebook`, `ebookDollars`, Pay for Audit, the assessment title, a POST, the gate text,
the `$32` text). "Facebook" is not an e-book control, and a test pins that.

### Generation 2 files added or touched

Added:
- `e2e/fin-b01-portal-unlock.spec.mjs` (13 browser tests, practice test with fake checkout links)
- `src/pulse/coverage/fin-b01-retired-controls.mjs`, `fin-b01-retired-controls.test.mjs`

Touched, shared (smallest edit; the integrator merges these):

| File | Change |
|---|---|
| `src/pulse/coverage/gap-catalog-display.mjs` | 1 import line; new `retiredControlResults()` (about 20 lines) and one line in `gapChecks`' `judge`; one `naVerify["catalog-display-retired-control"]` entry |
| `src/pulse/na-conditions.mjs` | one new code `catalog-display-retired-control` (the closed list goes from 14 to 15) |
| `src/pulse/na-conditions.test.mjs` | closed list (fifteen), lane-code list, sample args |
| `src/pulse/coverage/gap-catalog-display.test.mjs` | 1 import; the "not proved" filter skips the four retired controls |
| `src/pulse/catalog/proofs/fin-b01-display-specs.mjs`, `.test.mjs` | 2 rows added (34 to 36); header comment |
| `src/pulse/catalog/proofs/display-proof-cases.test.mjs` | red count 639 to 637 (the two portal rows are now attached). If other batches lower it too, add the drops together and use the number the test prints |
| `src/pulse/catalog/generated.json` | recompiled; the integrator recompiles after merging |

No `compiler.mjs`, `compile-catalog.mjs`, `door-proof.mjs`, `display-saved-result.mjs` or `display-proof-cases.mjs` line was
touched in generation 2.

### Generation 2 traps

- **Playwright waits for a navigation you started.** A press that sets `location.href` makes `click()` and any locator
  call wait for the new page. The pay page cannot be "held" and read at the same time. The spec reports the pay button out
  of the page with `exposeFunction` and a `MutationObserver`, and uses `click({ noWaitAfter: true })`. `page.evaluate`
  inside the route handler made the navigation abort.
- **`var PRODUCTS = {...}` can be given a checkout link from an init script**: define `window.PRODUCTS` as a configurable
  accessor first, and the page's own assignment goes through the setter. The page text is not changed.
- **`rm -rf` is denied for agents here**, so Playwright's `test-results/` folder is left where it is (it is git-ignored).

### Generation 2 product findings (not fixed, one line each)

1. client-portal `um-go`: `window.location.href = checkout` has no check that the address is http or https. Today the
   address is a constant in the page, so nothing reaches it; a `javascript:` link would run. (The Pay now links on invoices
   do refuse a non-http address.)
2. optimize.html: the intended journey (`docs/journeys/optimize-intended.md`) still says "Pay for Audit opens a Commas
   checkout"; the actual journey says it was removed by owner decision. The two disagree. Not edited (intended files are
   not mine).
3. climate: `docs/journeys/climate-lead-magnet-intended.md` describes a gate and a `$32` unlock that the shipped Darwin
   dashboard does not have. Same kind of gap.
4. The surviving half of the optimize intake (first name, last name, email, phone, SMS box) has only text tests
   (`src/http/optimize-html.test.mjs` pins `sms_consent: sms.checked === true`); no browser test types into it.

### Generation 2 commands run and results

Measured on this Mac while sibling batches were running (load average 8 to 240).

| Command | Result |
|---|---|
| `node scripts/pulse/count-not-proved.mjs` (start of generation 2) | 819 open; 6 of the 40 batch rows open |
| `node scripts/pulse/count-not-proved.mjs` (end) | 813 open (display 646 to 640); 0 of the 40 batch rows open |
| `node scripts/pulse/compile-catalog.mjs` then `--check` | fresh |
| `e2e/fin-b01-portal-unlock.spec.mjs` in Chromium | 13 of 13; 3 repeats at 4 workers 39 of 39 |
| 15 breaks of `public/app/client-portal.html`, one at a time (table above) | every one red, file restored clean |
| `fin-b01-retired-controls.test.mjs`, `gap-catalog-display.test.mjs`, `na-conditions.test.mjs`, `self-audit.test.mjs`, `modules.test.mjs`, `compiler.test.mjs` | 186 of 186 pass |
| 4 breaks of the real product files for the retired controls (table above) | every one red, files restored clean |
| `fin-b01-display-specs.test.mjs` (static check and the portal spec through the runner) | 2 of 2 pass |
| `display-proof-cases.test.mjs` "every display proof case..." and "unmapped display rows..." | pass (red count 637) |
| the four retired-control checks against the live public site, GET only, once | 4 of 4 `na`; 6 GETs, each page read once |
| `npm run lint` | 3,573 files parse clean |
| all non-browser-named pulse tests (265 files, 5,122 tests; node, concurrency 4, no database) | 4,894 pass, 226 skipped (database tests), 2 top-level fail: see below |

The two top-level failures were not in batch 01 files and were load timeouts: `display-proof-cases.test.mjs` "runs every
executable test named by every case" (the 33-minute test that runs every slice's browser specs together; inside it four
specs failed under load average above 100: a slice 1 spec with a 30 second test timeout, two slice browser runners, and
one batch 01 generation 1 test, "with no clipboard on the browser, Copy selects the link and says Press copy", which
then passed 8 of 8 alone) and `flow-result-proofs.test.mjs` "every test named by a flow proof passes..." (a 240 second
timeout). `fin-b01-portal-unlock.spec.mjs` passed inside that group run.

The integrator should run the long `display-proof-cases` test on a quiet Mac after merging.

## Generation 1 text (kept)
## The numbers

| | Rows |
|---|---|
| Open before generation 1 (batch rows that were NOT_PROVED) | 40 of 40 |
| Open after generation 1 | 6 |
| Open after generation 2 | 0 |
| Live check (reads saved results, goes red when one is wrong) | 3 |
| Practice test (fake data, mutation-verified) | 33 (31 from generation 1, 2 from generation 2) |
| Verified nothing-to-judge (control removed on purpose, live files re-read every run) | 4 |
| Not attachable | 0 |

Measured with `node scripts/pulse/count-not-proved.mjs` (offline, stub fetch): the whole list went 853 to 819, so 34 rows
left it: the 33 display rows bound by the plug-in plus the frame row. By lane: display 680 to 646; routes 135, flows 23
and reads 15 did not move (this batch has display rows only).

What "live check" means here, plainly: the three Agent Editor money controls have a SQL contract in
`src/pulse/catalog/proofs/fin-b01-display-contracts.mjs`. The pulse runs it read only against the company's own
`agents.guardrails` and goes red when a saved authority block holds a switch that is not true or false, or a
maximum discount that is not a number from 0 to 100. With no authority block yet it is green and says so
(`emptyAs: "quiet"`). There is no Postgres on this Mac, so the SQL could not be run on a database. It is run instead
by a small SQL runner written for this batch (`fin-b01-sql-mini.mjs`) over made-up rows, and its column names are
checked against `db/schema` and `db/migrations` (`fin-b01-schema-scan.mjs`). Those two tools are test tools; nothing
live imports them.

## Every row

| Surface | Control | Outcome | What proves it |
|---|---|---|---|
| agent-editor.html | Authority switch: May run a soft pull | live-check | LIVE CHECK `fin-b01-display-contracts.mjs` + `e2e/s2-agent-editor-save.spec.mjs`, `e2e/fin-b01-agent-authority.spec.mjs` |
| agent-editor.html | Authority switch: May take a payment | live-check | LIVE CHECK `fin-b01-display-contracts.mjs` + `e2e/s2-agent-editor-save.spec.mjs`, `e2e/fin-b01-agent-authority.spec.mjs` |
| agent-editor.html | Authority: Max discount input (percent) | live-check | LIVE CHECK `fin-b01-display-contracts.mjs` + `e2e/fin-b01-agent-authority.spec.mjs` |
| brand-studio.html | Generation: Turn on for this partner (owner) | practice-test | `e2e/fin-b01-brand-studio-generation.spec.mjs` |
| brand-studio.html | Write page copy button (AI model call, locked legal blocks skipped) | practice-test | `e2e/fin-b01-brand-studio-generation.spec.mjs` |
| climate/index.html#Gate button: unlock … | Gate button: unlock the full list with the $32 assessment (POST /api/public/opt… | na-verified | The gate page was reverted and replaced by a dashboard with no gate. `fin-b01-retired-controls.mjs` reads `/climate/` and its page script live (GET) and goes red if the gate, the `$32` text or the optimize call appears. Test: `fin-b01-retired-controls.test.mjs`. |
| campaign-manager.html | Drawer: New daily budget input and Change daily budget button | practice-test | `e2e/fin-b01-campaign-manager.spec.mjs` |
| campaign-manager.html | Drawer: Start spending again button (resume on Meta, confirm dialog) | practice-test | `e2e/fin-b01-campaign-manager.spec.mjs` |
| campaign-manager.html | Drawer: Stop spending button (pause on Meta, confirm dialog) | practice-test | `e2e/fin-b01-campaign-manager.spec.mjs` |
| campaign-manager.html | Link box: Save this link button | practice-test | `e2e/fin-b01-campaign-manager.spec.mjs` |
| campaign-manager.html | Needs-attention tile: Campaigns with an error on them | practice-test | `e2e/fin-b01-campaign-manager.spec.mjs` |
| campaign-manager.html | Needs-attention tile: Changes that did not go through | practice-test | `e2e/fin-b01-campaign-manager.spec.mjs` |
| campaign-manager.html | Needs-attention tile: Connections that cannot go live | practice-test | `e2e/fin-b01-campaign-manager.spec.mjs` |
| campaign-manager.html | Needs-attention tile: Daily limits already hit | practice-test | `e2e/fin-b01-campaign-manager.spec.mjs` |
| campaign-manager.html | Partner select (changes whose ads every panel shows) | practice-test | `e2e/fin-b01-campaign-manager.spec.mjs` |
| campaign-manager.html | Request Meta agency access: Business ID input, Ad account input, Request access… | practice-test | `e2e/fin-b01-campaign-manager.spec.mjs` |
| campaign-manager.html | Sync Meta now button | practice-test | `e2e/fin-b01-campaign-manager.spec.mjs` |
| client-control-panel.html | Declines: Save outcome button (approved amount, reapply date, notes) | practice-test | `e2e/fin-b01-ccp-pulls-declines.spec.mjs` |
| client-control-panel.html | Pull Equifax button | practice-test | `e2e/fin-b01-ccp-pulls-declines.spec.mjs` |
| client-control-panel.html | Pull Experian button | practice-test | `e2e/fin-b01-ccp-pulls-declines.spec.mjs` |
| client-control-panel.html | Pull TransUnion button | practice-test | `e2e/fin-b01-ccp-pulls-declines.spec.mjs` |
| client-portal.html | FinanceOS card link (Open or Set up FinanceOS) | practice-test | `e2e/fin-b01-client-portal.spec.mjs` |
| client-portal.html | Payments tab: Pay now link per open invoice | practice-test | `e2e/fin-b01-client-portal.spec.mjs` |
| client-portal.html | Refer a friend: Copy button | practice-test | `e2e/fin-b01-client-portal.spec.mjs` |
| client-portal.html | Unlock buttons (Soft pull, Funding DFY, Repair DFY, Repair trial, Deliverables,… | practice-test | `e2e/fin-b01-portal-unlock.spec.mjs` (five tests: shipped state with no link, link gives the button and the modal, one link one button, owned product, soft pull already run). Fake checkout links; no client sees these buttons today. |
| client-portal.html | Unlock modal: Unlock pay now button (goes to product checkoutUrl) | practice-test | `e2e/fin-b01-portal-unlock.spec.mjs` (pay now goes to each of the six products' own link and says it is opening; Close and Escape never go to a checkout link). Fake checkout links. |
| closer-dashboard.html | Deal calculator: Draw amount input | practice-test | `e2e/closer-dashboard-calculators.spec.mjs`, `e2e/fin-b01-closer-dashboard.spec.mjs` |
| closer-dashboard.html | Pay link panel: offer select and downsell/upsell select | practice-test | `e2e/fin-b01-closer-dashboard.spec.mjs`; server half `src/pulse/catalog/proofs/s1-door-closer-deck.test.mjs` |
| closer-dashboard.html | Pay link panel: Send pay link button (mints a checkout link, emails and texts t… | practice-test | `e2e/fin-b01-closer-dashboard.spec.mjs`; server half `src/pulse/catalog/proofs/s1-door-closer-deck.test.mjs` |
| closer-dashboard.html | Send pay link button (opens panel; closers only) | practice-test | `e2e/fin-b01-closer-dashboard.spec.mjs`; server half `src/pulse/catalog/proofs/s1-door-closer-deck.test.mjs` |
| content-admin.html | Locked tile editor: price shown box | practice-test | `e2e/content-admin-clicks.spec.mjs`, `e2e/fin-b01-content-price.spec.mjs` |
| optimize.html#opt | Audit intake and Pay for Audit: first name, last name, email, phone, SMS consent… | na-verified | Pay for Audit was removed by owner decision (`docs/journeys/optimize-actual.md`); the page only reads its config. `fin-b01-retired-controls.mjs` reads `/optimize` live and goes red if Pay for Audit, the assessment title or a POST appears. |
| inquiry-remover.html | Expanded row 'Enroll' button (puts the client in the trial program; sends price… | practice-test | `e2e/fin-b01-inquiry-remover-repair.spec.mjs` |
| inquiry-remover.html | PULL modal: type PULL, Cancel, 'Pull' (three bureau pulls in a row; stops on th… | practice-test | `e2e/fin-b01-inquiry-remover-repair.spec.mjs` |
| marketing-command-center.html | Frame: cost sheet and two-tap confirm sheet drawn before every paid tap (Cancel… | practice-test | `e2e/marketing-command-center.spec.mjs`, `e2e/fin-b01-paid-taps-ideas.spec.mjs`, `e2e/fin-b01-paid-taps-other-tabs.spec.mjs`; server half `src/pulse/catalog/proofs/fin-b01-paid-taps.test.mjs` |
| present.html (+ present.js, contract-se… | '$ amount' e-book price box | na-verified | Retired on purpose (pinned by `src/http/closer-deck-present.test.mjs`). `fin-b01-retired-controls.mjs` reads `/app/present.html`, `present.js`, `contract-send.js` live and goes red if an e-book control comes back. |
| present.html (+ present.js, contract-se… | 'Invoice this client': reads the open invoice, emails it | practice-test | `e2e/fin-b01-present-deck.spec.mjs` |
| present.html (+ present.js, contract-se… | 'Log disposition and close': writes the call outcome (deposit or downsell) and … | practice-test | `e2e/fin-b01-present-deck.spec.mjs` |
| present.html (+ present.js, contract-se… | 'Send agreement + pay link': mints the pay link for the chosen offer, emails an… | practice-test | `e2e/fin-b01-present-deck.spec.mjs`; server half `src/pulse/catalog/proofs/s1-door-closer-deck.test.mjs` |
| present.html (+ present.js, contract-se… | 'Send e-book email': pay link at the typed price, with a placeholder PDF attach… | na-verified | Retired on purpose; the server refuses `send_ebook` (`closer-deck-endpoints.test.mjs`, `s1-door-closer-deck.test.mjs`). Same live read as the price box. |

The six rows generation 1 left open, with its reasons (generation 2 re-read each one and closed it, see the top of this file):

1. **climate Gate button.** `public/climate/index.html` is a static export. Its page chunk
   `public/climate/_next/static/chunks/app/page-b71b32356ee1b98a.js` holds no gate button, no `$32` text and no
   `/api/public/optimize` call (searched the whole `public/climate/_next` folder). The row is listed from
   `docs/journeys/climate-lead-magnet-intended.md`, not from the shipped page.
2. **client-portal Unlock buttons (6).** In `public/app/client-portal.html`, every `data-unlock` button is `hidden` in the
   markup, and the only code that shows one is `paintTile` with `unlockBtn.hidden = !canBuy`. `canBuy` is
   `!!PRODUCTS[key].checkoutUrl`, and no product in `PRODUCTS` has a `checkoutUrl`. So no client ever sees an Unlock
   button. The modal opens only from "View status" (`data-status`), which is a different control.
3. **client-portal Unlock modal: Unlock pay now.** `um-go` is `hidden` unless `PRODUCTS[key].checkoutUrl` exists
   (`openUnlock`), no product has one, and the modal cannot be opened from an Unlock button. A test could only inject a
   field the page never sets, which proves nothing a client can reach.
4. **optimize.html Audit intake and Pay for Audit.** The page's only call is `GET /api/public/optimize` for the sign-up
   config. Form `#opt` has no submit handler and there is no Pay for Audit control. The typed fields are written to
   `sessionStorage` key `fh_opt` only when the SmartCredit or roadmap link is pressed. The row names a POST and a Commas
   checkout the page does not make.
5. **present.html "$ amount" e-book price box.** `present.html`, `present.js` and `contract-send.js` have no e-book
   control (the word `ebook` does not appear in them).
6. **present.html "Send e-book email".** Same files, no such button. The server also refuses `send_ebook` as
   `unknown_action` (`src/pulse/catalog/proofs/s1-door-closer-deck.test.mjs` pins that).

Each of rows 1 to 6 needs a product change (build the control, give products checkout links) or the row rewritten to
what the page really does. Nothing here was faked to make a row leave the list.

## How the practice-test rows are attached

`src/pulse/catalog/proofs/fin-b01-display-specs.mjs` lists, for each row, the browser spec files and the exact test
titles that judge it, and the plain node tests that judge the server half. Its runner
`fin-b01-display-specs.test.mjs` runs only those titles in Playwright and fails if one does not run or does not pass.
It is wired into `display-proof-cases.mjs` with one import and one spread line, the same way slices 1 to 5 were.

The frame row ("cost sheet and two-tap confirm sheet drawn before every paid tap") is bound to three things:
the frame's own sheet test in `e2e/marketing-command-center.spec.mjs` (cost line, month line, Cancel, yes, Escape,
phone size, judged on the real frame), the two new specs `fin-b01-paid-taps-ideas.spec.mjs` (10 taps, each at 3 sheet
answer styles) and `fin-b01-paid-taps-other-tabs.spec.mjs` (6 taps), and a guard
(`fin-b01-paid-taps.test.mjs`) that counts every place a Command Center tab file asks the frame for a sheet. A new
paid tap without a row in its table turns that guard red. Each tap is pressed twice: Cancel must send nothing, then one
yes must send exactly one write.

## Files added

- `e2e/fin-b01-agent-authority.spec.mjs`, `fin-b01-closer-dashboard.spec.mjs`, `fin-b01-content-price.spec.mjs`,
  `fin-b01-campaign-manager.spec.mjs`, `fin-b01-brand-studio-generation.spec.mjs`, `fin-b01-ccp-pulls-declines.spec.mjs`,
  `fin-b01-client-portal.spec.mjs`, `fin-b01-inquiry-remover-repair.spec.mjs`, `fin-b01-present-deck.spec.mjs`,
  `fin-b01-paid-taps-ideas.spec.mjs`, `fin-b01-paid-taps-other-tabs.spec.mjs`
- `src/pulse/catalog/proofs/fin-b01-display-specs.mjs`, `fin-b01-display-specs.test.mjs` (the binding and its runner)
- `src/pulse/catalog/proofs/fin-b01-display-contracts.mjs`, `fin-b01-display-contracts.test.mjs`, `fin-b01-staff-groups.mjs`
- `src/pulse/catalog/proofs/fin-b01-sql-mini.mjs`, `fin-b01-sql-mini.test.mjs`, `fin-b01-schema-scan.mjs` (test tools)
- `src/pulse/catalog/proofs/fin-b01-paid-taps.test.mjs`
- `ops/workflows/finish-853-2026-10-14/manifest-b01.md`

## Shared lines touched (the integrator merges these)

| File | Change |
|---|---|
| `src/pulse/catalog/proofs/display-proof-cases.mjs` | 1 import line + `...FIN_B01_DISPLAY_SPEC_PROOFS,` at the end of the plug-in list |
| `src/pulse/catalog/proofs/display-saved-result.mjs` | 1 import line, `...FIN_B01_DISPLAY_RESULT_CONTRACTS,` at the end of `DISPLAY_RESULT_CONTRACTS`, and two always-red `gap(...)` entries removed ("Deal calculator: Draw amount input", "Locked tile editor: price shown box") |
| `src/pulse/catalog/proofs/display-batch-staff-ui.mjs` | 1 import line + `...FIN_B01_STAFF_UI_GROUPS,` at the end of `STAFF_UI_GROUPS` (this is what lets a contract reach a row: a registry contract only attaches to a row that is bound to a staff spec group) |
| `src/pulse/catalog/generated.json` | recompiled with `node scripts/pulse/compile-catalog.mjs`; the integrator recompiles after merging |
| `src/pulse/catalog/proofs/display-proof-cases.test.mjs` | red count 672 to 639 (33 rows with no proof case are now attached; the frame row was not counted red before). If other batches also lower it, add the drops together and use the number the test prints |
| `src/pulse/coverage/gap-catalog-display.test.mjs` | contracts 40 to 41 (3 added, 2 gaps removed), PASS-capable 27 to 30, always-red 13 to 11, SQL batches 27 to 30, display calls and passes 27 to 30, shipped-data copy 40 to 41 |

No `src/pulse/coverage/gap-catalog-display.mjs`, `compiler.mjs`, `door-proof.mjs` or `na-conditions.mjs` line was touched.

## Traps found (for the integrator and the next agent)

- **A contract in the registry alone does nothing.** `compileDisplayRuntimeData` only attaches a contract to a row that is
  in `STAFF_UI_PROOF_CASES` at depth deep. A new live check therefore needs a staff spec group (a spec that presses the
  control) as well as the registry entry. Tried first with a throwaway contract: generated.json did not change and the
  count stayed 853.
- **Removing an always-red `gap(...)` is required before a plug-in proof can take the row out of the lane.** The row keeps
  its contract in `resultsByKey` while the gap exists.
- **The scratchpad folder is shared by every agent in the run.** Another agent's `mut.py` replaced mine mid-run once. Private
  tools live under `scratchpad/fin-b01-private/`.
- **`git checkout --` after a break can lose a race with a sibling's git lock.** One break stayed in a page for a few seconds
  until it was put back by hand. The tool now restores the file from memory instead of asking git.

## Product findings (not fixed, one line each)

1. client-portal: no product has a `checkoutUrl`, so the six Unlock buttons and the Unlock pay now button can never be seen by a client (row reasons 2 and 3 above).
2. present.html: no e-book price box and no Send e-book email; the server refuses `send_ebook`. Two rows are stale.
3. optimize.html: the page never posts to `/api/public/optimize`; there is no Pay for Audit control.
4. climate: the shipped page has no gate button.
5. Agent Editor "Max discount": the page saves whatever number is typed (150 saves 150), and `api/agents.mjs` does not clamp it. The new live check goes red on such an agent.
6. Specialist desk Enroll: after a successful enroll the desk repaints and removes the open row, so the "Enrolled in trial." line the button just wrote is gone at once.
7. Closer dashboard pay-link panel: with no offers on the call, the boot message "No offers came back with this call" is replaced by "Pick the offer, then send" the moment the panel opens (the select still says "No offers in the catalog" and Send is off).
8. closer-call.js `wirePayLink`: the `if (!clientId) { btn.remove(); panel.remove(); return; }` line is unreachable (`setEmpty` already removes both before it runs).
9. cc-tab-ideas.js `paidTap` has a `"flywheel"` fallback kind that no screen state reaches.

## What was broken on purpose (each one went red, then was put back)

About 120 breaks of the product files, one at a time, each run against the spec that judges it:
Agent Editor 4 · Closer dashboard 8 · Content admin 5 · Campaign manager 24 · Brand Studio 9 · Client control panel 18 ·
Client portal 12 · Specialist desk 12 · Closer deck 14 · Ideas paid taps 10 · Scripts, Launch, Shoot paid taps 6.
Breaks that first stayed green were fixed by adding a test and re-breaking: campaign link box (number key sent blank),
present deck (motion kept for a primary offer; a send guard reached by a script), Scripts promise answer. Breaks that
cannot be seen by a person were left and are not counted: the disabled-button guard in the bureau pull click handler
(a disabled button never receives the click), the unreachable `wirePayLink` line, the `"flywheel"` fallback kind.
The SQL contracts have four statement breaks in `fin-b01-display-contracts.test.mjs` (drop the boolean test, the
company condition, the discount upper bound, the retired filter) and each changes the answer.

## Commands run and results

Measured on this Mac while about 100 other Playwright processes from sibling batches were running (load average 20 to 100).

| Command | Result |
|---|---|
| `node scripts/pulse/count-not-proved.mjs` (before, on `fin/base`) | 853 open; 40 of the 40 batch rows open |
| `node scripts/pulse/count-not-proved.mjs` (after) | 819 open; 6 of the 40 batch rows open (display lane 680 to 646) |
| `node scripts/pulse/compile-catalog.mjs` then `--check` | fresh |
| `npm run lint` (run again after the last edit) | 3,571 files parse clean |
| every `src/pulse/catalog/**` and `gap-catalog*` / `gap-door-batch*` test that does not start a browser | 1,529 tests, 1,529 pass, 0 fail, 0 skipped |
| `src/pulse/catalog/proofs/fin-b01-sql-mini.test.mjs`, `fin-b01-display-contracts.test.mjs`, `fin-b01-paid-taps.test.mjs` | 6 + 7 + 4 pass |
| `src/pulse/coverage/gap-catalog-display.test.mjs` | 11 of 11 pass with the new numbers |
| `display-proof-cases.test.mjs` "every display proof case..." and "unmapped display rows..." | pass (639 red) |
| `display-batch-staff-ui.test.mjs` "maps exact rows to one safe local browser run" | pass |
| `fin-b01-display-specs.test.mjs` (runs the 15 bound spec files in Chromium) | first full run 15 of 16: one drawer test in the campaign spec raced the page's second paint (a test timing fault, not a product fault). Fixed. The campaign drawer tests then ran 36 of 36 with 6 repeats at 2 workers. Final full run on the last commit: 16 of 16 pass (about 7 minutes) |
| the 10 new browser specs other than campaign manager, 2 repeats at 3 workers | 265 of 266 pass; the one failure was a click that waited 30 seconds on a Mac at load average 58 (present deck). Every batch spec now has a 60 second test timeout and the present and content specs then ran 36 of 36 with repeats |

Not run here: the third test in `display-proof-cases.test.mjs` ("runs every executable test named by every case"), which
runs every slice's browser tests together (about 15 minutes and it is the one that flaked under load for slices 1 to 5),
and the browser half of `display-batch-staff-ui.test.mjs` (every staff spec in one run; it now includes
`e2e/fin-b01-agent-authority.spec.mjs`). The integrator runs those after merging.

## Re-check after the Mac restart (2026-10-14, same branch, no product or test file changed)

A fresh agent picked this batch up after the shutdown and re-read it instead of redoing it.

| Check | Result |
|---|---|
| `node scripts/pulse/count-not-proved.mjs` on `fin/b01` | 819 open; the same 6 of the 40 batch rows open (the two Unlock rows, the two e-book rows, optimize.html, the climate gate) |
| `node scripts/pulse/compile-catalog.mjs --check` | exit 0, fresh |
| `gap-catalog-display.test.mjs` + `fin-b01-sql-mini`, `fin-b01-display-contracts`, `fin-b01-paid-taps` tests | 28 of 28 pass |
| Break the live check on purpose (drop the true-or-false test on the switch; let the discount reach 999) | each turned 3 tests red; both put back, files identical to the commit |
| `e2e/fin-b01-agent-authority.spec.mjs` + `e2e/fin-b01-content-price.spec.mjs` in Chromium | 13 of 13 pass |
| The six not-attachable reasons re-read in the files | all six facts were still true, but four were retired controls (nothing to judge) and two were practice-testable; generation 2 closed them: `PRODUCTS` in `public/app/client-portal.html` has no `checkoutUrl` and nothing assigns one; `public/optimize.html` has only the GET at its config call and no POST or Pay for Audit control; `present.html`, `present.js`, `contract-send.js` hold no e-book text; `public/climate` holds no `api/public/optimize`, no "unlock the full" and no `$32` |
