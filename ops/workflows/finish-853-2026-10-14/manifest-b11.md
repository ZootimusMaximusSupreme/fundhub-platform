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

Outcomes: 16 live checks, 24 practice tests, 0 not-attachable, 0 na-verified.
Every live-check row also has its click pressed by a practice test, so a row can be red for the click or for the saved result.

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
| creative-factory.html | Generate form: Kind (static / copy / video), What is being sold, What to make, Name this batch | live check | `job-form` (3 conditions) | fin-b11-creative-factory.test.mjs |
| creative-factory.html | Run queued jobs now button | live check | `job-run` (6 conditions) | fin-b11-creative-factory.test.mjs |
| creative-factory.html | Approve button (asks to confirm; marks the creative approved and CLEARS its blocked reasons) | live check | `asset-approved` (4 conditions) | fin-b11-creative-factory.test.mjs |
| creative-factory.html | Reject button (asks to confirm; marks the creative blocked) | live check | `asset-rejected` (3 conditions) | fin-b11-creative-factory.test.mjs |
| creative-factory.html | Archive button (asks to confirm; hides the creative) | live check | `asset-archived` (3 conditions) | fin-b11-creative-factory.test.mjs |
| creative-factory.html | Review queue (brand row): reason box and 'Approve this brand' button (owner/admin only) | live check | `brand-approved` (6 conditions) | fin-b11-creative-factory.test.mjs |
| creative-factory.html | Review queue (brand row): 'Send it back' button with required reason | live check | `brand-sent-back` (6 conditions) | fin-b11-creative-factory.test.mjs |
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
`bad_count`. All sixteen are `emptyAs: "quiet"`: green with the words "no saved results yet" until the first
wrong result, red on it. Each is a list of named conditions (`FIN_B11_CHECKS` in `fin-b11-display-contracts.mjs`).

Honest limits, one line each:

- **No receipt keeps what a person typed.** The Save script boxes, the four Generate boxes and the brand reason box leave only the saved row. The live check judges that the row is well formed and linked to the right company, partner and script. It cannot say the row equals the typed words. The practice test judges the typed-to-sent half.
- **Archive and Approve leave almost nothing.** `creative_assets` has no who and no when for either click. `asset-archived` is the weakest of the sixteen: it judges only the archive time against created and last-changed, and the partner's company. `asset-approved` judges cleared reasons, the partner, the words of a written ad and the timestamps, not who approved.
- **Windows.** Chats, scripts and jobs: last 60 days. Review decisions: last 90 days, and only while the review is still the file's newest and the file was not changed after the decision (a later re-sync does not turn an old approval red). Jobs must carry an offer only if made since 2026-09-08. A rewrite must have archived its parent only if made since 2026-10-05. An approved written ad must have words only if made since 2026-09-08. Older rows can legitimately lack these.
- **Owner only.** The approve and turn-down checks require the decider to be a staff member of this company with the owner role (owner-set H-3). A decider who was later demoted would read red.
- **The SQL ran on SQLite, not Postgres.** There is no local Postgres on this Mac. The text uses only spellings both engines share, and the test kit turns the few Postgres-only ones (casts, `BTRIM`, `now() - interval`, the jsonb functions) into SQLite. The first real morning run is the Postgres proof. If a statement were refused there, the row would show "not read" (skip), never green.
- **Quiet means quiet.** A control nobody has used in the window is green with "no saved results yet". It goes red on the first wrong one.

## Files added (all new, named fin-b11-*)

- `src/pulse/catalog/proofs/fin-b11-display-contracts.mjs`: the sixteen live checks, the 40-row table, the proof cases
- `src/pulse/catalog/proofs/fin-b11-sql-kit.mjs`: test kit. Real table and column names from `db/schema` and `db/migrations` into a SQLite stand-in (`node:sqlite`), Postgres spellings turned into SQLite
- `src/pulse/catalog/proofs/fin-b11-live-contracts.test.mjs`: 249 tests. Healthy set clean, one break per condition counted wrong, another company never counted, dropping any one condition changes some answer, losing the company condition counts the other company
- `src/pulse/catalog/proofs/fin-b11-kit.mjs`: row tracker, one Chromium per file, dialogs, waitFor
- `src/pulse/catalog/proofs/fin-b11-company-brain.test.mjs`, `fin-b11-creative-factory.test.mjs`, `fin-b11-small-pages.test.mjs`: the Chromium practice tests
- `src/pulse/catalog/proofs/fin-b11-rows.test.mjs`: guards for the row table

## Shared lines I touched (the integrator must merge these)

| File | Change |
|---|---|
| `src/pulse/catalog/proofs/display-saved-result.mjs` | one import line (`FIN_B11_RESULT_CONTRACTS`) and one `...FIN_B11_RESULT_CONTRACTS,` line at the end of `DISPLAY_RESULT_CONTRACTS` |
| `src/pulse/catalog/proofs/display-proof-cases.mjs` | one import line and one `...FIN_B11_DISPLAY_PROOF_CASES,` line at the end of the plugin list |
| `scripts/pulse/compile-catalog.mjs` | one import line (`FIN_B11_LIVE_PROOF_CASES`) and `staffProofCases: [...STAFF_UI_PROOF_CASES, ...FIN_B11_LIVE_PROOF_CASES]` |
| `src/pulse/coverage/gap-catalog-display.test.mjs` | lines 50 to 56, 71, 139, 141 and 198: 40 to 56 (contracts, cases, shipped data, sum) and 27 to 43 (pass-capable, SQL batches, reads, passing rows). My increase is +16 each. `UNMEASURED_CONTRACT_COUNT` and the 13 not-proved stay |
| `src/pulse/catalog/proofs/display-proof-cases.test.mjs` | red count 672 to 632 (my decrease is 40). If other batches also lower it, add the decreases together and use the number the test prints |
| `src/pulse/catalog/generated.json` | rebuilt with `npm run pulse:catalog`. Rebuild again after merging; do not hand merge |

## Product findings (left as found, nothing fixed)

1. **Company Brain and Creative Factory open for owner and admin only.** `public/app/shell.js` sends a closer, sales manager, CSM, funding advisor, setter and inquiry specialist to their own desk (measured with a fake session for each). So the Company Brain role badge can only ever read "owner" or "admin", and the Creative Factory note "staff roles may use the script card" describes people who cannot reach the page. Only owner, admin and (for Creative Factory) partner reach it.
2. **Company Brain, narrow screen: the open Past chats rail covers its own hamburger.** At 700 px wide, once the rail is open the New chat button sits on top of the button that opened it. The only ways to close it are picking a chat or New chat.
3. **The shell's floating Chat button blocks Refresh at a default window.** At 1280 by 900 the "Chat" button (`#fh-chat-fab`) sat over the Documents panel's Refresh buttons and the browser refused the click ("intercepts pointer events"). A person can scroll the panel; the practice tests remove the button first.
4. **Creative Factory Enqueue accepts an empty "What to make" box.** The job is saved with `prompt: ""`. The live check does not call that red, because the page lets it through on purpose.
5. **A saved monthly writing limit of 0 is shown as 250,000.** `src/brand/meter.mjs` reads `Number(cap) || DEFAULT_TOKEN_CAP`, so 0 means "default", not "none". The `allowance` live check goes red on a saved 0.
6. **Consent capture Back link:** something other than the page's own code adds `&id=<client>` to the Client Control Panel link after load (seen: `client-control-panel.html?client_id=X&id=X`). Harmless, noted.

## Product breaks (each one made once in the real page, the matching practice test run, then `git checkout`)

| Break | Result |
|---|---|
| brain send: thread id dropped | RED (good) |
| brain send: Shift+Enter sends | RED (good) |
| brain new chat: thread kept | RED (good) |
| brain past chats: wrong read | RED (good) |
| brain rail toggle: dead | RED (good) |
| brain documents: dead toggle | RED (good) |
| brain documents: Close opens | RED (good) |
| brain files: Refresh dead | RED (good) |
| brain role badge: everyone is owner | RED (good) |
| brain review: Turn down approves | RED (good) |
| brain review: Refresh dead | RED (good) |
| brain quiz: marks swapped | RED (good) |
| brain page: quiz script missing | RED (good) |
| cf picker: reads not re-issued | RED (good) |
| cf allowance: left shows used | RED (good) |
| cf brand studio link: wrong place | RED (good) |
| cf enqueue: no offer still sends | RED (good) |
| cf generate: kind not sent | RED (good) |
| cf run: ten jobs | RED (good) |
| cf decide: no question asked | RED (good) |
| cf decide: action always approve | RED (good) |
| cf script save: lane dropped | RED (good) |
| cf script picker: label without version | RED (good) |
| cf jobs: one chip at a time | RED (good) |
| cf jobs: size select ignored | RED (good) |
| cf jobs: row does not expand | RED (good) |
| cf library: kind filter ignored | RED (good) |
| cf library: card click dead | RED (good) |
| cf drawer: Esc dead | RED (good) |
| cf drawer: scrim dead | RED (good) |
| cf queue: awaiting drops brands | RED (good) |
| cf queue: Open the full creative dead | RED (good) |
| cf kits: page size three | RED (good) |
| cf reference: first panel open | RED (good) |
| cf reference: a code renamed | RED (good) |
| cf script card: shown to a partner | RED (good) |
| cf brand: reason not required | RED (good) |
| cf brand: approve sends a reason | RED (good) |
| consent back: wrong place | RED (good) |
| contracts cancel: selection kept | RED (good) |
| contracts documents link: wrong place | RED (good) |

A "BAD BREAK" would mean the text to change was not found exactly once. There were none. After every run the file was put back with `git checkout -- <file>` and `git status` was clean at the end (no product file changed in the commits). The live checks are broken a different way: every named condition has a stand-in row that makes only it fail (counted as exactly one wrong result), and the test drops each condition from the SQL text and sees some row's answer change (249 tests).

## Commands run

- `node scripts/pulse/count-not-proved.mjs` before: 853 total, this batch 40 of 40 open. After: 813 total, this batch 0 of 40 open (`byLane` display 680 to 640).
- `npm run pulse:catalog`: 3975 mapped, 33 repeats, 3942 unique, 3919 wired, 23 red. `generated.json` committed.
- `node --test fin-b11-live-contracts.test.mjs`: 249 pass, 0 fail (no database).
- Chromium practice tests, `S4_BROWSER_PLACES=12` (the shared queue held by other builders): company brain 8 tests, creative factory 9, small pages 3, all pass. Break run: 41 of 41 red (table above).
- Flake check, three rounds of the three browser files plus the live and row tests: 3 rounds x 273 tests (live 249, row guards 4, company brain 8, creative factory 9, small pages 3): 273 of 273 pass in every round, 0 fail, 0 skipped
- `node --test src/pulse/coverage/gap-catalog-display.test.mjs`: 11 pass. `src/pulse/catalog/*.test.mjs` + gap-catalog lane tests + `modules.test.mjs`: 75 pass. `display-proof-cases.test.mjs` "names one exact map row": pass. "unmapped display rows stay red": pass at 632.
- `npm run lint`: 3570 files and inline scripts parse clean
- Group run (display-proof-cases focused test, runs every named test): 3 of 3 pass, including 'the focused proof test runs every executable test named by every case' (every test file named by every display proof case, mine among them), 0 fail, run once on a Mac with load average 10 to 30 from other builders
