# Batch 11 manifest (finish the 853, tier 4, lane gap-catalog-display)

Branch `fin/b11`, built from `fin/base` (2f4f574a0). Nothing was pushed or merged. Tests and test-side files only:
no product page, handler or migration was changed.

## The count

| | Rows |
|---|---|
| Rows in the batch | 40 |
| NOT_PROVED before (`count-not-proved.mjs`, this batch's ids) | 40 |
| NOT_PROVED after | 0 |
| Whole four-lane total before to after | 853 to 813 |

Outcomes after repair cycle 1: 15 live checks, 25 practice tests, 0 not-attachable rows, 0 na-verified.
The Archive row moved from a live check to a practice test (its live half is not attachable, see below).
Every live-check row also has its click pressed by a practice test, so a row can be red for the click or for the saved result.

## Repair cycle 1: what the independent checker found, and what is true now

The checker broke the product 26 ways that stayed green. Each is answered here. "Page" is the practice test in Chromium.
"Handler" is the new `fin-b11-brain-lists.test.mjs`, which runs the real endpoint files over stand-in rows.
"Live SQL" is the read-only query the display lane runs on the server for the company.

| Control (Company Brain unless named) | What was green | What is true now |
|---|---|---|
| Class quiz | Scorer strictness: partial answer, "yes and no", banned phrase, acceptAny count | Page: every one is pressed and each break of the scorer goes red |
| Send question | Waiting line never left, fresh answer lost its files and its copied-note, Enter during the wait sent a second question | Page: the held answer shows the waiting line, Enter sends nothing, then the line leaves and the files and notes show. Live SQL unchanged |
| New chat button | Error words and old highlight survived | Page: opens a missing chat and a loading chat first, then New chat clears words, highlight and loading |
| Past chats list | Reopened chat could lose every question | Page: the questions are in the reopened chat, before their answers. Live SQL unchanged |
| Approve a waiting file | Visible labels could be swapped | Page: buttons found by the words a person reads (Approve, Turn down) in the list and on the file row |
| Turn down a waiting file | Labels swapped, and the live SQL skipped every rejected review with no person | Page: found by words. Live SQL: a file marked rejected whose review names nobody is now read and counted wrong. Handler: the real reject writes who and when |
| Waiting-for-approval panel | List endpoint could show decided reviews or another company's | Handler: decided reviews, auto-closed reviews and another company never come back, oldest first, owner only. Page: raw error code never shows |
| Files you added | List endpoint could show another company's files, count could be wrong | Handler: this company's uploads only, newest first, count is waiting uploads of this company only. Page: failed read leaves no stale waiting count |
| Role badge | "staff" fallback never seen | Page: no role and no saved session reads "staff" and draws no approval side |
| consent-capture Back link | call_recording and marketing_use never opened | Page: both, and an unknown kind, go to the control panel and carry the client |
| Creative Factory: Approve | Always the first creative; every write on partner 0 | Page: a middle creative is approved on partner 1 and on partner 2, cancel sends nothing, the library shows the change |
| Creative Factory: Archive | Cancel ignored, always the last creative, nothing re-read, Reject and Archive not gated | Page: all four closed. Live SQL: removed, not attachable (below) |
| Brand kits | Only the first kit opened, chips counted not filtered, page two not checked | Page: every chip filters, page two holds the 7th kit, a chip from page two goes to page one, the 2nd and 4th kit open as themselves |
| Creative library filters | Only pressed at page 1, most chip values never filtered | Page: every value of every chip, both selects and the size select pressed from page two, exact creatives asserted |
| Enqueue generation | Loading half, a refused enqueue, duplicate batch, wrong partner | Page: held allowance read, refused and duplicate words, second partner, and the markup starts disabled |
| Generate form | Live SQL never judged "What to make" or "Name this batch"; two allowed values never used | Live SQL: judges the form's three keys together and the batch name. Fixtures use credit_repair and resize |
| Jobs size select and pager | Size changed only on page 1 | Page: from page two the new size starts at the first job |
| Job row detail | Only the label and one line | Page: reference, batch name, kit, started, finished, creatives made, error box for all four words |
| contracts: Documents link | A 404 passed | Page: the server answers 200 and the Documents screen is there |
| creative-factory: Brand Studio link | A 404 passed | Page: same |
| Reject | Live SQL could not see a reject that did not block | Live SQL: reads creatives holding a person's reject reason, wrong if not blocked, wrong if several of one partner share one rejection instant |
| Send it back | A lost reason was outside the population | Live SQL: a draft that was sent for review with no reason is read and counted wrong |
| Approve this brand | Approver role and the never-sent bypass unseen | Live SQL: approver must be an owner or admin of the company (90 days), and a person approving a never-sent brand is wrong |
| Reference section | Three panels counted not read | Page: legend counts and words, five AI-label rows tied to the vendor code, 7 settings rows word for word tied to the migration |
| Open the full creative | Clicked row was also the first creative | Page: the second creative opens from the first row, and a second row opens its own |
| Review queue chips, size select, pager | Fixture had four rows so nothing paged | Page: twelve rows, three pages at size five, size select and chips from page two |

## Every row

## Every row

| Screen | Control | Outcome | Live check | Practice test file |
|---|---|---|---|---|
| company-brain.html | Send question (Send button, Enter key; Shift+Enter makes a line) | live check | `brain-turns` (4 conditions) | fin-b11-company-brain.test.mjs |
| company-brain.html | Past chats list: click a chat to reopen it | live check | `brain-past-chats` (3 conditions) | fin-b11-company-brain.test.mjs |
| company-brain.html | Files you added: list and Refresh button | live check | `brain-uploads` (7 conditions) | fin-b11-company-brain.test.mjs |
| company-brain.html | Owner: 'Waiting for your approval' panel and its Refresh button | live check | `brain-review-queue` (5 conditions) | fin-b11-company-brain.test.mjs |
| company-brain.html | Owner: Approve a waiting file (button on the file row and in the review list) | live check | `brain-review-approved` (7 conditions) | fin-b11-company-brain.test.mjs |
| company-brain.html | Owner: Turn down a waiting file | live check | `brain-review-rejected` (6 conditions) | fin-b11-company-brain.test.mjs |
| company-brain.html | Class quiz: answer boxes and 'Check answers' (scored in the browser, nothing saved) | practice test | - | fin-b11-company-brain.test.mjs |
| company-brain.html | Documents button (opens right-hand panel) and its Close button | practice test | - | fin-b11-company-brain.test.mjs |
| company-brain.html | New chat button | practice test | - | fin-b11-company-brain.test.mjs |
| company-brain.html | Page itself: staff-only chat screen loads (shell, ramp-quizzes.js, data.js) | practice test | - | fin-b11-company-brain.test.mjs |
| company-brain.html | Past chats rail toggle (hamburger, narrow screens) | practice test | - | fin-b11-company-brain.test.mjs |
| company-brain.html | Role badge (reads fh_role from localStorage; shows 'owner' or 'staff' and decides whether approval controls draw) | practice test | - | fin-b11-company-brain.test.mjs |
| consent-capture.html | Back link (to Client Control Panel, or to Client Portal for dispute_authorization) | practice test | - | fin-b11-small-pages.test.mjs |
| contracts.html | Cancel button | practice test | - | fin-b11-small-pages.test.mjs |
| contracts.html | Link: 'Documents' (see contracts already sent) | practice test | - | fin-b11-small-pages.test.mjs |
| creative-factory.html | Save this script button | live check | `script-save` (7 conditions) | fin-b11-creative-factory.test.mjs |
| creative-factory.html | Enqueue generation button (disabled until the allowance loads and is on) | live check | `job-enqueued` (5 conditions) | fin-b11-creative-factory.test.mjs |
| creative-factory.html | Generate form: Kind (static / copy / video), What is being sold, What to make, Name this batch | live check | `job-form` (5 conditions) | fin-b11-creative-factory.test.mjs |
| creative-factory.html | Run queued jobs now button | live check | `job-run` (6 conditions) | fin-b11-creative-factory.test.mjs |
| creative-factory.html | Approve button (asks to confirm; marks the creative approved and CLEARS its blocked reasons) | live check | `asset-approved` (4 conditions) | fin-b11-creative-factory.test.mjs |
| creative-factory.html | Reject button (asks to confirm; marks the creative blocked) | live check | `asset-rejected` (5 conditions) | fin-b11-creative-factory.test.mjs |
| creative-factory.html | Archive button (asks to confirm; hides the creative) | practice test | - | fin-b11-creative-factory.test.mjs |
| creative-factory.html | Review queue (brand row): reason box and 'Approve this brand' button (owner/admin only) | live check | `brand-approved` (7 conditions) | fin-b11-creative-factory.test.mjs |
| creative-factory.html | Review queue (brand row): 'Send it back' button with required reason | live check | `brand-sent-back` (7 conditions) | fin-b11-creative-factory.test.mjs |
| creative-factory.html | Monthly writing allowance panel (on/off, used, left, limit) and its enable note | live check | `allowance` (3 conditions) | fin-b11-creative-factory.test.mjs |
| creative-factory.html | Brand kits: state chips, kit card click opens drawer, prev / next | practice test | - | fin-b11-creative-factory.test.mjs |
| creative-factory.html | Creative library: asset card click opens the detail drawer; prev / next pager | practice test | - | fin-b11-creative-factory.test.mjs |
| creative-factory.html | Creative library: state chips, kind chips, format chips, brand kit select, include archived select, 'show' size select | practice test | - | fin-b11-creative-factory.test.mjs |
| creative-factory.html | Decide on one creative: creative picker (select) | practice test | - | fin-b11-creative-factory.test.mjs |
| creative-factory.html | Detail drawer: close button, scrim click, Esc key | practice test | - | fin-b11-creative-factory.test.mjs |
| creative-factory.html | Generation jobs: 'show' size select and prev / next pager | practice test | - | fin-b11-creative-factory.test.mjs |
| creative-factory.html | Generation jobs: row click expands job detail (what went wrong, kit, times) | practice test | - | fin-b11-creative-factory.test.mjs |
| creative-factory.html | Generation jobs: state filter chips (all, queued, running, succeeded, failed; several at once) | practice test | - | fin-b11-creative-factory.test.mjs |
| creative-factory.html | Link: 'Brand Studio' (inside the allowance note when the suite is off) | practice test | - | fin-b11-creative-factory.test.mjs |
| creative-factory.html | Page itself loads (partner or owner/admin; staff roles may use the script card) | practice test | - | fin-b11-creative-factory.test.mjs |
| creative-factory.html | Partner picker (select) and ?partner_id= preselect | practice test | - | fin-b11-creative-factory.test.mjs |
| creative-factory.html | Reference section (4 closed panels: job states, AI labels, why creative gets stopped, engine settings table) | practice test | - | fin-b11-creative-factory.test.mjs |
| creative-factory.html | Review queue: 'Open the full creative' button on a row | practice test | - | fin-b11-creative-factory.test.mjs |
| creative-factory.html | Review queue: state chips (all, blocked, pending, awaiting_approval), 'show' size select, prev / next, row expand | practice test | - | fin-b11-creative-factory.test.mjs |
| creative-factory.html | Script picker list on the Generate form (rebuilt from saved scripts) | practice test | - | fin-b11-creative-factory.test.mjs |

## What the live checks judge, and what they cannot

A live check is one read-only SQL text the display lane runs for the company. It returns `sample_count` and
`bad_count`. All fifteen are `emptyAs: "quiet"`: green with the words "no saved results yet" until the first
wrong result, red on it. Each is a list of named conditions (`FIN_B11_CHECKS` in `fin-b11-display-contracts.mjs`).

Honest limits, one line each:

- **No receipt keeps what a person typed.** The Save script boxes, the four Generate boxes and the brand reason box leave only the saved row. The live check judges that the row is well formed and linked to the right company, partner and script. It cannot say the row equals the typed words. The practice test judges the typed-to-sent half.
- **Archive is not attachable as a live check (removed in cycle 1).** The click writes the archive time on the one creative it names and keeps no record of which creative was meant. A wrong creative archived, or an archive that did not happen, leaves a row no different from a healthy one, and the only thing the old check could see was a corrupted timestamp. The row is a practice test now, and that practice test closes the four holes the checker found.
- **Approve and Reject keep no "who".** `creative_assets` has no approver or rejecter column. `asset-approved` judges cleared reasons, the partner, the words of a written ad and the timestamps. `asset-rejected` now also reads a creative still holding a person's reject reason without being blocked, and several creatives of one partner rejected at the same instant (a Reject that lost "which creative" blocks them all in one statement, so they share one time). It still cannot tell the wrong creative from the right one when only one row changed.
- **Enqueue keeps no "which partner was on screen".** A job saved for the other partner of the same company is a well-formed row, so the live check cannot see it. The practice test judges that the request names the partner on screen.
- **Windows.** Chats, scripts and jobs: last 60 days. Review decisions: last 90 days, and only while the review is still the file's newest and the file was not changed after the decision (a later re-sync does not turn an old approval red). A brand approval is checked for its approver's role only inside 90 days. Jobs must carry an offer only if made since 2026-09-08. A rewrite must have archived its parent only if made since 2026-10-05. An approved written ad must have words only if made since 2026-09-08. Older rows can legitimately lack these.
- **Owner only.** The approve and turn-down checks require the decider to be a staff member of this company with the owner role (owner-set H-3). A decider who was later demoted would read red. A brand approval needs an owner or admin.
- **Auto-closed reviews are told apart by the file.** A review the system closed (a newer proposal replaced it, or the file classified itself) is also `rejected` with nobody named. A person's turn down is the one that leaves the file's classification `rejected`, so the check reads a rejected review with no person only when its file says a person turned it down.
- **The SQL ran on SQLite, not Postgres.** There is no local Postgres on this Mac. The text uses only spellings both engines share, and the test kit turns the few Postgres-only ones (casts, `BTRIM`, `now() - interval`, the jsonb functions) into SQLite. The first real morning run is the Postgres check. If a statement were refused there, the row would show "not read" (skip), never green.
- **Quiet means quiet.** A control nobody has used in the window is green with "no saved results yet". It goes red on the first wrong one.
- **The engine settings table is a typed-in snapshot.** The page says so itself. The practice test ties every word and number in it to the migration it was copied from. It cannot tie it to the running system, because the page never reads that.

## Files added (all new, named fin-b11-*)

- `src/pulse/catalog/proofs/fin-b11-display-contracts.mjs`: the fifteen live checks, the 40-row table, the proof cases
- `src/pulse/catalog/proofs/fin-b11-sql-kit.mjs`: test kit. Real table and column names from `db/schema` and `db/migrations` into a SQLite stand-in (`node:sqlite`), Postgres spellings turned into SQLite
- `src/pulse/catalog/proofs/fin-b11-live-contracts.test.mjs`: 260 tests. Healthy set clean, one break per condition counted wrong, another company never counted, dropping any one condition changes some answer, losing the company condition counts the other company
- `src/pulse/catalog/proofs/fin-b11-brain-lists.test.mjs` (cycle 1): 8 tests. Runs the real `api/company-brain/reviews.mjs` and `upload.mjs` list handlers and the real decide code over stand-in rows, then reads the saved decision with the live SQL
- `src/pulse/catalog/proofs/fin-b11-kit.mjs`: row tracker, one Chromium per file, dialogs, waitFor
- `src/pulse/catalog/proofs/fin-b11-company-brain.test.mjs`, `fin-b11-creative-factory.test.mjs`, `fin-b11-small-pages.test.mjs`: the Chromium practice tests
- `src/pulse/catalog/proofs/fin-b11-rows.test.mjs`: guards for the row table

## Shared lines I touched (the integrator must merge these)

| File | Change |
|---|---|
| `src/pulse/catalog/proofs/display-saved-result.mjs` | one import line (`FIN_B11_RESULT_CONTRACTS`) and one `...FIN_B11_RESULT_CONTRACTS,` line at the end of `DISPLAY_RESULT_CONTRACTS` |
| `src/pulse/catalog/proofs/display-proof-cases.mjs` | one import line and one `...FIN_B11_DISPLAY_PROOF_CASES,` line at the end of the plugin list |
| `scripts/pulse/compile-catalog.mjs` | one import line (`FIN_B11_LIVE_PROOF_CASES`) and `staffProofCases: [...STAFF_UI_PROOF_CASES, ...FIN_B11_LIVE_PROOF_CASES]` |
| `src/pulse/coverage/gap-catalog-display.test.mjs` | lines 50 to 56, 71, 139, 141 and 198: 40 to 55 (contracts, cases, shipped data, sum) and 27 to 42 (pass-capable, SQL batches, reads, passing rows). My increase is +15 each (it was +16 before cycle 1 removed the Archive check). `UNMEASURED_CONTRACT_COUNT` and the 13 not-proved stay |
| `src/pulse/catalog/proofs/display-proof-cases.test.mjs` | red count 672 to 632 (my decrease is 40). If other batches also lower it, add the decreases together and use the number the test prints |
| `src/pulse/catalog/generated.json` | rebuilt with `npm run pulse:catalog`. Rebuild again after merging; do not hand merge |

## Product findings (left as found, nothing fixed)

1. **Company Brain and Creative Factory open for owner and admin only.** `public/app/shell.js` sends a closer, sales manager, CSM, funding advisor, setter and inquiry specialist to their own desk (measured with a fake session for each). So the Company Brain role badge can only ever read "owner" or "admin", and the Creative Factory note "staff roles may use the script card" describes people who cannot reach the page. Only owner, admin and (for Creative Factory) partner reach it.
2. **Company Brain, narrow screen: the open Past chats rail covers its own hamburger.** At 700 px wide, once the rail is open the New chat button sits on top of the button that opened it. The only ways to close it are picking a chat or New chat.
3. **The shell's floating Chat button blocks Refresh at a default window.** At 1280 by 900 the "Chat" button (`#fh-chat-fab`) sat over the Documents panel's Refresh buttons and the browser refused the click ("intercepts pointer events"). A person can scroll the panel; the practice tests remove the button first.
4. **Creative Factory Enqueue accepts an empty "What to make" box.** The job is saved with `prompt: ""`. The live check does not call that red, because the page lets it through on purpose.
5. **A saved monthly writing limit of 0 is shown as 250,000.** `src/brand/meter.mjs` reads `Number(cap) || DEFAULT_TOKEN_CAP`, so 0 means "default", not "none". The `allowance` live check goes red on a saved 0.
6. **Consent capture Back link:** something other than the page's own code adds `&id=<client>` to the Client Control Panel link after load (seen: `client-control-panel.html?client_id=X&id=X`). Harmless, noted.
7. **Company Brain, New chat during a slow chat read:** press a past chat, then New chat before it has loaded. When the slow read finishes it repaints the old chat's title and messages over the new empty chat (measured). The thread id stays empty, so the next question does start a new chat, but the screen still shows the old conversation until then.
8. **Creative Factory Reject writes the same reason for every click.** The page sends no reason, so every rejected creative is saved with the endpoint's default words ("Rejected by reviewer") and the code `human_reject`. The person's own reason for rejecting is never asked for or kept.

## Product breaks (each one made once in the real page, handler or SQL text, the matching test run, then the file put back byte for byte)

Cycle 0 table (41 breaks, all red) is kept in the commit before this one. Cycle 1 added these. A break is "RED" when the named test file fails on it.

| Group | Breaks | Result |
|---|---|---|
| Quiz scorer (`ramp-quizzes.js`) | partial answers pass; "yes and no" passes; acceptAny ignored; banned words ignored | 4 of 4 RED |
| Company Brain page | waiting line never dropped; fresh answer loses files; fresh answer never copied-note; busy guard removed; Shift+Enter sends; answer source lost; New chat keeps error / keeps loading / keeps highlight / keeps thread id; reopened chat loses questions; Approve and Turn down labels swapped (list and file row); raw error code in the panel; role badge says owner; failed read keeps the waiting count | 16 of 16 RED |
| Company Brain handlers (`review.mjs`, `upload.mjs`, `reviews.mjs`) | pending list includes decided reviews; pending list crosses companies; reject loses decided_by; approve loses decided_by; uploads list crosses companies; waiting count counts approved; waiting count crosses companies; waiting count counts Drive files; uploads list includes Drive files; oldest first; unknown size becomes 0; reject leaves the file open; admin may list; list ignores the company | 14 of 14 RED |
| Small pages | consent Back branch sends call_recording to the portal; Documents link target missing | 2 of 2 RED |
| Creative Factory page | approve/any sends options[1]; any sends the last creative; writes go to partner 0; confirm ignored unless approve; library not re-read after archive; gate touches only approve; Reject/Archive markup not disabled; wrong action sent; kit card opens the first kit; draft chip filters active; kit chip keeps page; kit page two shows the first kit; state / kind / format chips keep page; library size, kit and archived selects keep page; video, pending and 1x1 chips filter wrong; kit filter ignored; library card opens first asset; writes on while allowance loads; refusal says Added; duplicate says saved; run refusal not worded; job size keeps page; job kit always dash; started and finished swapped; creatives made always 0; reference cut and batch name blank; error box always "nothing back"; settings status flipped; legend nine tries; legend failed counts succeeded; AI label copy flipped; settings markup 150; open-full opens first asset; queue pager never moves; queue size forced to ten; queue chip keeps page; queue size keeps page; Brand Studio link target missing; brand buttons use partner 0 | 45 of 45 RED |
| Live SQL (`fin-b11-display-contracts.mjs`) | rejected reviews with no person excluded again; marker population dropped; not-blocked condition dropped; same-instant condition dropped; same-instant ignores the partner; credit_repair removed from offers; resize removed from kinds; form-keys condition dropped; prompt not judged; batch-name condition dropped; approver role not judged; never-sent approval allowed; draft-and-sent population dropped; lost reason not judged | 14 of 14 RED (one more, the "no person" half of the turn-down condition, is covered by the test that drops each condition and sees an answer change) |

Total cycle 1: 95 breaks made and put back, 95 caught, 0 left green. `git status` clean for product files after every run.

## Commands run

- `node scripts/pulse/count-not-proved.mjs`: 853 total before the batch. After cycle 1: 813 total, this batch 0 of 40 open (`byLane` display 640).
- `npm run pulse:catalog`: 3975 mapped, 33 repeats, 3942 unique, 3919 wired, 23 red. `generated.json` committed.
- `node --test src/pulse/catalog/proofs/fin-b11-*.test.mjs`: 293 pass, 0 fail, 0 skipped (live 260, row guards 4, brain lists 8, company brain 9, creative factory 9, small pages 3). No database.
- Flake check: the same 293 tests, six more rounds (two runs of three, one of them while another builder's load was on the Mac), all pass.
- `node --test src/pulse/coverage/gap-catalog-display.test.mjs src/pulse/catalog/proofs/display-proof-cases.test.mjs`: 14 pass, 0 fail. That includes "the focused proof test runs every executable test named by every case" and the red count 632.
- `npm run lint`: syntax gate, parses clean.
