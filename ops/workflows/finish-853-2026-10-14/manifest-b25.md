# Batch 25 manifest (finish the 853), Sonnet builder, lane gap-door-batch-routes

Branch `fin/b25` (worktree `.claude/worktrees/fin-b25`), cut from `fin/base`. Generation 1, repair cycle 1
(2026-10-15, see "Repair cycle 1" below, which supersedes any number above it). Not pushed. Not merged.

## Numbers

| | Count |
|---|---|
| Rows in this batch (all open at the start) | 40 |
| Still open after this branch (batch rows, measured) | 2 (was 0 before repair cycle 1) |
| Whole catalog, before / after (`node scripts/pulse/count-not-proved.mjs`) | 853 / 815 (813 before repair cycle 1) |
| Route lane `gap-door-batch-routes`, before / after | 135 / 97 (95 before repair cycle 1) |
| Route lane per file (routes-0 / 1 / 2 / 3) | 54/36/25/20 to 35/27/22/13 |

Words used on purpose: every attached row is a **practice test**. The real `api/` handler and the real
library under it run over in-memory stand-in tables that answer by the SQL text the code sends. Fake data,
no network, no database. None is a live check. None is called "deep" or "proof". (The catalog stores
`depth: "e2e"` on each plug-in entry; that is the catalog's own field name.) These 40 rows are all
staff-only or no-impact routes, so no money or customer-data row is attached here.

## Every row

| # | Map row | Control (first words) | Outcome | Test that judges it |
|---|---|---|---|---|
| 1 | routes-3 route:marketing/funnels | GET where ads send people and which Meta campaigns belong to each f... | practice-test | `src/http/fin-b25-marketing-funnels.test.mjs` |
| 2 | routes-0 route:marketing/funnels/build | Queue a job that writes (or re-writes) a draft funnel's three pages... | practice-test | `src/http/fin-b25-marketing-funnels.test.mjs` |
| 3 | routes-1 route:marketing/funnels/create | POST {request_id, offer_key, lane, name, path, build} make a draft ... | practice-test | `src/http/fin-b25-marketing-funnels.test.mjs` |
| 4 | routes-0 route:marketing/funnels/rename | Rename a draft funnel's address (path); reads the live ClickFunnels... | practice-test | `src/http/fin-b25-marketing-funnels.test.mjs` |
| 5 | routes-1 route:marketing/funnels/stats | GET marketing numbers by funnel, last 30 Arizona days (page views, ... | practice-test | `src/http/fin-b25-marketing-funnels.test.mjs` |
| 6 | routes-3 route:marketing/health | GET the Command Center health card: clock and worker last runs, que... | practice-test | `src/http/fin-b25-marketing-queue.test.mjs` |
| 7 | routes-0 route:marketing/ideas | Ideas inbox: list ideas; POST saves an idea and may queue a one-ide... | practice-test | `src/http/fin-b25-marketing-ideas-offer.test.mjs` |
| 8 | routes-1 route:marketing/jobs/retry | POST {request_id, job_id} put one failed marketing job back in the ... | practice-test | `src/http/fin-b25-marketing-queue.test.mjs` |
| 9 | routes-0 route:marketing/meta/load-status | How each ad video's Meta load is doing (waiting, loading, loaded, r... | practice-test | `src/http/fin-b25-marketing-queue.test.mjs` |
| 10 | routes-1 route:marketing/offer/generate | POST start the Write offer run (six offers, four judges, one winner... | practice-test | `src/http/fin-b25-marketing-ideas-offer.test.mjs` |
| 11 | routes-3 route:marketing/research | POST {question, depth, sources, max_cost_usd} starts a deep researc... | practice-test | `src/http/fin-b25-marketing-research.test.mjs` |
| 12 | routes-0 route:marketing/research/approve | Approve a finished deep-research report (stamps who and when; re-sa... | practice-test | `src/http/fin-b25-marketing-research.test.mjs` |
| 13 | routes-1 route:marketing/research/brain | POST {id, request_id} save a finished deep-research report into Com... | practice-test | `src/http/fin-b25-marketing-research.test.mjs` |
| 14 | routes-3 route:marketing/research/tweak | POST {id, note} a one-line tweak starts a short re-run of the same ... | practice-test | `src/http/fin-b25-marketing-research.test.mjs` |
| 15 | routes-0 route:marketing/rules | Copy rules screen: read Part 0 rules, banned phrases and recent cha... | practice-test | `src/http/fin-b25-marketing-rules-settings.test.mjs` |
| 16 | routes-0 route:marketing/scripts/approve | Approve and lock an ad script; assigns its ad number once (next_ad_... | practice-test | `src/http/fin-b25-marketing-scripts.test.mjs` |
| 17 | routes-1 route:marketing/scripts/edit | POST {request_id, id, version, body, parts} save a new script versi... | practice-test | `src/http/fin-b25-marketing-scripts.test.mjs` |
| 18 | routes-3 route:marketing/scripts/fix | POST {request_id, id, version, note, make_rule} the Fix button: que... | practice-test | `src/http/fin-b25-marketing-scripts.test.mjs` |
| 19 | routes-0 route:marketing/scripts/order | Set the film order of approved scripts for Shoot Day. | practice-test | `src/http/fin-b25-marketing-scripts.test.mjs` |
| 20 | routes-1 route:marketing/scripts/reject | POST {request_id, id, version, reason} reject a draft script | practice-test | `src/http/fin-b25-marketing-scripts.test.mjs` |
| 21 | routes-3 route:marketing/settings | GET the marketing machine's settings (one row per company; first re... | practice-test | `src/http/fin-b25-marketing-rules-settings.test.mjs` |
| 22 | routes-0 route:marketing/shoot | GET: Shoot Day read (what to film, order, file names, teleprompter ... | practice-test | `src/http/fin-b25-marketing-shoot.test.mjs` |
| 23 | routes-0 route:marketing/shoot | POST: save Shoot Day moves (open or reorder a shoot, plan scripts). | practice-test | `src/http/fin-b25-marketing-shoot.test.mjs` |
| 24 | routes-1 route:marketing/shoot/mark | POST {request_id, shoot_id, root_script_id, mark got_it\|another_ta... | practice-test | `src/http/fin-b25-marketing-shoot.test.mjs` |
| 25 | routes-0 route:ops/weekly-brief | Generate this week's ops brief with a model call and file it into C... | practice-test | `src/http/fin-b25-ops-partner.test.mjs` |
| 26 | routes-0 route:partner-addons | Read a partner's add-on catalog, current plan, history and orders. | practice-test | `src/http/fin-b25-ops-partner.test.mjs` |
| 27 | routes-0 route:partner-marketing/copy-history | GET: version history of a partner page section. POST: restore an ea... | practice-test | `src/http/fin-b25-ops-partner.test.mjs` |
| 28 | routes-0 route:public/ad-video-approve | GET shows the filmed take; POST is the decision: Chris taps Approve... | practice-test | `src/http/fin-b25-public-doors.test.mjs` |
| 29 | routes-1 route:public/eeo-survey | GET ?token= load the voluntary EEO self-ID form (never writes) | practice-test | `src/http/fin-b25-public-doors.test.mjs` |
| 30 | routes-1 route:public/eeo-survey | POST submit the EEO self-ID answers (Postgres submit_eeo_response i... | not-attachable (repair cycle 1) | none: the handler crashes when an optional question is left blank |
| 31 | routes-0 route:public/partner-page | JSON for a published white-label partner page (partner_id plus slug... | practice-test | `src/http/fin-b25-public-doors.test.mjs` |
| 32 | routes-0 route:public/vsl-watch | VSL player beacon: stores watch sessions and position samples (rate... | practice-test | `src/http/fin-b25-public-doors.test.mjs` |
| 33 | routes-2 route:read/ad-books | GET /api/read/ad-books?group_by=lane\|ad_id\|variant\|gate\|entry\|... | practice-test | `src/http/fin-b25-read-doors.test.mjs` |
| 34 | routes-0 route:read/blueprint-combined-approval | Capital Blueprint primary buyer plus credit partner: prequal per fi... | practice-test | `src/http/fin-b25-read-doors.test.mjs` |
| 35 | routes-0 route:read/closer-call | Closer Dashboard live-call payload for one client: cockpit, offers,... | practice-test | `src/http/fin-b25-read-doors.test.mjs` |
| 36 | routes-2 route:read/closer-call | GET /api/read/closer-call?client_id= — the Closer Dashboard live-ca... | practice-test | `src/http/fin-b25-read-doors.test.mjs` |
| 37 | routes-3 route:read/closer-now | GET which call this closer is on and what is next. Scoped to the si... | practice-test | `src/http/fin-b25-read-doors.test.mjs` |
| 38 | routes-1 route:read/company-activity | GET Galaxy presence feed (who is on shift, calls, agent activity) | not-attachable (repair cycle 1) | none: every activity label reads "event" |
| 39 | routes-0 route:read/csm-queue | The CSM's day: clients to talk to today, what they owe (open balanc... | practice-test | `src/http/fin-b25-read-doors.test.mjs` |
| 40 | routes-2 route:read/finance-ask | POST /api/read/finance-ask {question, client_id} — answers three fi... | practice-test | `src/http/fin-b25-read-doors.test.mjs` |

After repair cycle 1: 38 practice tests, 0 live checks, 0 verified N/A, 2 not-attachable (rows 30 and 38). The 20-hex row ids are the ones the
catalog compiler gives (`sha256(file NUL surface NUL control)`); they are listed in
`src/pulse/catalog/proofs/fin-b25-door-contracts.mjs`, and the full row ids are the ones in
`ops/workflows/finish-853-2026-10-14/batch-25.json`.

## How a row is attached

`src/pulse/catalog/proofs/fin-b25-door-contracts.mjs` is a plug-in for the proof chain in `door-proof.mjs`
(same shape as `fin-b08-door-contracts.mjs` and `s3-door-contracts.mjs`). A row leaves the red route
monitor only when its exact file + surface + control words are listed. Its test
(`fin-b25-door-contracts.test.mjs`) fails if an id is not one exact route row, if a listed test file is
missing, skipped, parked, a Postgres test, or does not import the very `api/` handler the row names, if
the words of a row change, or if a row is a money or customer-data row.

## What every practice test does

Each file runs the real handler through the real sign-in and role gate. Every role gate is tried with
**all ten sign-in kinds** (`assertRoleGate` in `src/testing/fin-b25-kit.mjs`): each allowed role must get
past, and every other role (including partner and client) must get a 403 before any statement other than
the sign-in lookup. The company boundary is judged two ways: the stand-in keeps another company's row in
every table and answers by the SQL text's own condition (`rowsWhere`), and the statement text is pinned
(`assertSqlHas`) where the stand-in cannot run a clause. The stand-in refuses what Postgres refuses at
bind time (a value supplied but unused, or used only in an IS NULL test), so a lost condition throws.
Writes are judged by the row the statement says it writes (`insertedRow`, `updatedFields`, and an
INSERT-SELECT reader), never by a canned answer, so a changed column, literal or bound value changes
what the test sees. The request_id replay is judged on every write route that uses it.

## Files added

Tests (`src/http/`): `fin-b25-marketing-funnels`, `fin-b25-marketing-scripts`,
`fin-b25-marketing-rules-settings`, `fin-b25-marketing-shoot`, `fin-b25-marketing-queue`,
`fin-b25-marketing-research`, `fin-b25-marketing-ideas-offer`, `fin-b25-ops-partner`,
`fin-b25-public-doors`, `fin-b25-read-doors` (all `.test.mjs`; 101 tests).

Stand-in helpers (`src/testing/`): `fin-b25-kit.mjs` (call, role sweep, SQL readers),
`fin-b25-script-world.mjs` (in-memory scripts, outbox, voice pairs, queue).

Plug-in: `src/pulse/catalog/proofs/fin-b25-door-contracts.mjs` and `fin-b25-door-contracts.test.mjs`.

This manifest: `ops/workflows/finish-853-2026-10-14/manifest-b25.md`.

## Shared lines touched (smallest possible edits)

| File | Edit |
|---|---|
| `src/pulse/catalog/proofs/door-proof.mjs` | one import line, and `\|\| finB25DoorProof(sourceFile, row)` added at the end of the plug-in chain in `proofForDoor` (the `;` moved one line down) |
| `src/pulse/coverage/gap-door-batch-routes.mjs` | `EXPECTED_ROUTE_GAP_COUNTS` routes-0 54 to 35 (-19), routes-1 36 to 25 (-11), routes-2 25 to 22 (-3), routes-3 20 to 13 (-7) |
| `src/pulse/coverage/gap-door-batch-routes.test.mjs` | the row total 135 to 95 (title and five numbers) |
| `src/pulse/catalog/proofs/door-batch-route-result.test.mjs` | rows 135 to 95; unique routes 115 to 78 (3 of the 40 rows share a route with another row, so 37 routes left) |
| `src/pulse/catalog/generated.json` | regenerated with `npm run pulse:catalog` (40 rows changed; conflict with sibling batches expected, recompile after merge) |

`src/pulse/catalog/proofs/door-proof.test.mjs` was NOT touched: its `exactSafeHandler` regex only matters
for money and customer rows, and none of these 40 is one. The integrator applies each batch's count
change together (this batch: -40 rows, -37 unique routes).

## Mutation checks (broken on purpose, seen red, put back)

372 product-line breaks were made in the `api/` handlers and the libraries under them, each run against the
file's tests, each restored right after (`git status` clean after every run). Kinds: role gate widened,
narrowed or removed; company condition turned into `$N::text IS NOT NULL`; a status, window, ordering or
limit word changed; a guard (stale, closed, live, taken, locked, capped, unverified) switched off; a bound
value swapped; a default changed; a write not queued or a wake dropped; an unknown turned into 0.

| Test file | Breaks | Red first time | Fixed the test and went red | Equivalent (a second layer answers the same) |
|---|---|---|---|---|
| marketing-funnels | 42 | 39 | 2 | 1: rename "own funnels' addresses not counted" (the same address is held in three places) |
| marketing-scripts | 42 | 40 | 2 (the stand-in did the product's job on INSERT-SELECT; it now reads the statement) | 0 |
| marketing-rules-settings | 24 | 21 | 2 | 1: settings "updated_at not required at the door" (saveSettings checks it again) |
| marketing-shoot | 28 | 24 | 2 (and 1 break whose text I had mistyped, redone and red) | 1: "bad film key falls through" (a second check answers the same 404) |
| marketing-queue | 30 | 29 | 1 | 0 |
| marketing-research | 37 | 37 | 0 | 0 |
| marketing-ideas-offer | 28 | 27 | 1 | 0 |
| read-doors | 62 | 59 | 1 (plus 2 more breaks added for the other two money clauses, both red) | 0 |
| ops-partner | 32 | 31 | 1 | 0 |
| public-doors | 47 | 45 | 0 (1 more break added at the door for the default approver, red) | 1: default approver in token.mjs (the handler sets it first) |

Every "fixed the test" row means the first run of that break stayed green, I made the test stronger (a
second company's row, a value that differs between two fields, an exact clause pin, a window edge) and the
same break then went red.

## What these practice tests cannot show

- That the SQL is valid Postgres, that columns exist, that row-level security lets the call see its rows.
  The `.pg.test.mjs` files do that on a scratch database; none was run here (no local Postgres, and
  production is off limits).
- The model call, the embedding call, ClickFunnels, GitHub, Meta and the background workers: each is an
  injected stand-in or refused (`fetch` is replaced and throws on anything unexpected). Their own code is
  judged elsewhere.
- `submit_eeo_response` (the EEO row's atomic "insert and sever the link" is inside Postgres). The route
  half is judged: exactly one statement, the answers in order, and the same reply for a first or a repeat
  submit.

## Product findings (written down, not fixed)

1. `POST /api/public/eeo-survey` crashes when any of the four answers is left out. `pickField` in
   `src/hiring/eeo-selfid.mjs` returns `null` for a blank, and `parseEeoBody` then reads `picked.ok` on
   null (TypeError). The handler calls it outside its try block, so a form that skips one question gets a
   server error, although the file says every field is optional. A form that sends all four (even as
   `decline_to_state`) works, which is what the attached test judges.
2. `POST /api/ops/weekly-brief` saves the brain file row with the brief's content hash before it embeds.
   If embedding fails (no key, no credit), the answer is still `ok: true, chunkCount: 0`, and a re-run of
   the same week sees the same hash and skips as "unchanged", so that brief is never chunked unless its
   words change (`src/company-brain/ingest-generated.mjs`).
3. `POST /api/ops/weekly-brief` is open to every staff role (`ROLE_SETS.STAFF`: setter, csm, closer and
   so on), and it spends a model call and files an owner-tier page. Only owner and admin look intended.
4. `POST /api/read/finance-ask` stamps `as_of` with the UTC date (`today()` in `finance-command.mjs`), so
   between 5pm and midnight Arizona it says tomorrow.

## Commands run and results

- `node scripts/pulse/count-not-proved.mjs` before: `{total 853, routes 135, display 680, flow 23, reads 15}`;
  after: `{total 813, routes 95, display 680, flow 23, reads 15}`; batch rows open 40 before, 0 after.
- `node --test src/http/fin-b25-*.test.mjs src/pulse/catalog/proofs/fin-b25*.test.mjs`: 101 tests, 101 pass,
  three runs in a row, 0 skipped.
- `node --test src/pulse/catalog/*.test.mjs src/pulse/coverage/gap-door-batch*.test.mjs
  src/pulse/catalog/proofs/door-*.test.mjs src/pulse/catalog/proofs/s1-door-contracts.test.mjs
  src/pulse/catalog/proofs/s2-door-contracts.test.mjs src/pulse/catalog/proofs/s3-door-contracts.test.mjs
  src/pulse/catalog/proofs/fin-b25*.test.mjs`: 1,092 tests, 1,092 pass. (The display-lane browser tests
  were not run; this batch touches no display row.)
- `npm run pulse:catalog`: 3975 mapped, 33 repeats, 3942 unique; 3919 wired, 23 red.
- `npm run lint`: 3,576 files parse clean.
- Journeys: no product code changed, so no `-actual.md` journey or changelog line moved. No new live
  page, route, job or send path, so no heartbeat row is owed.

## Repair cycle 1 (2026-10-15)

An independent checker broke 33 of the 40 attached rows in ways the first practice tests did not see (a canned
stand-in answered the SQL, so a dropped clause, a flipped word or a moved window stayed green). This cycle
made each of those breaks go red, or took the row back off the board.

### Outcome of the 33 rows

| Outcome | Rows |
|---|---|
| practice-test, strengthened, every listed break now red | 31 |
| not-attachable (attachment removed, row back on NOT_PROVED) | 2: `route:public/eeo-survey` POST, `route:read/company-activity` GET |

Why the two are not attachable (the exact reason, written so a fresh agent can challenge it):

- `route:public/eeo-survey` POST. `pickField` in `src/hiring/eeo-selfid.mjs` returns `null` for a blank answer
  and `parseEeoBody` then reads `picked.ok` on `null`, outside any try block in the handler. A form that skips
  any one of the four optional questions gets a server error, while the page, the invite mail and the file's
  own header say every question is optional. A test of the promised behavior is red today, and a test that
  only sends all four answers is green on a product that is wrong. Needs a product fix, then the row can be
  attached (the existing tests in `fin-b25-public-doors.test.mjs` stay and will judge it).
- `route:read/company-activity`. `src/galaxy/company-activity.mjs` selects `e.kind AS label` and then reads
  `row.kind`, so every person's activity line shows the word "event". A test that judges the labels is red
  today. The rest of the feed (people, shifts, agents, cash, funded, deposits, client names, the demo rule)
  is judged and stays in `fin-b25-read-doors.test.mjs`.

### What changed in the tests (no product file was touched)

1. A new pin file, `src/testing/fin-b25-sql-pins.mjs`: 170 statements, each the exact text the shipped code
   sends (comments dropped, white space collapsed), captured from the code and read against its source. A
   test calls `assertSent(result, "name")` or `assertOnlySent(result, ...)` (in `src/testing/fin-b25-kit.mjs`).
   They judge the TEXT the code sends: a dropped company clause, a flipped status word, a moved date window, a
   reversed order, a lost join key or a changed column list turns the test red. They do not prove the SQL is
   valid Postgres (the `.pg.test.mjs` files do that on a scratch database; none was run).
2. Stand-ins that used to do the product's SQL job in JS now read the statement: the film-link shoot check,
   the campaign-already-on-another-funnel check, the reject and approve updates, the settings update.
3. New cases for every break the checker named, by row:
   - funnels: the same request id from another company or another route is refused; a sign-in with no
     company is refused on every funnel door; a built funnel's address, lane, offer and book-a-call flag
     cannot be edited; a funnel keeps its own campaign and another company's campaign is not "taken"; two
     presses racing to make one key; the whole new-funnel row (name, offer, book-a-call, tag, utm campaign,
     campaign folder, the three pages in order); a pushed page blocks a rename even while the funnel says
     draft; the redrawn page's fingerprint; the stray-key refusal; the stats statements.
   - health, retry, load-status: every count, window, order, join and cap statement; the drain error shown
     only while rows wait; the retry that loses a race; every load-state branch.
   - ideas, offer: the idea row's own status and kind, the file save op id per idea, the batch cap alone, the
     stuck-run close (16 minutes) and the Arizona day on a run, newest-first reads.
   - research: the defaults left out of a request (quick, web and vault on, own files off), the month cap at
     the edge, the report words, resumable, the approve op id per run and a replay, the tweak's belief and a
     replay.
   - scripts: every carried column of a new version, the checker's words saved on the version, the film key
     (closed shoot, other company's script, expired, no secret), the file name's place and id suffix, the
     reject columns by name, a blank reason, the order write, one-line rule text, bad id and version.
   - settings: all 25 settings, a good and bad value each; the stale compare to the millisecond; 405; no company.
   - shoot: a film key and an unsigned POST cannot plan, reorder or close a shoot; the keep-what-was-saved
     rule for the plan, day and status; the Arizona default day; past shoots; retake readiness.
   - weekly brief: a changed brief re-files over the old file; every connection state other than active is
     "not available"; the YouTube read; the day window's end.
   - partner add-ons: a plan is current only while live (cancelled mid-term, not started, ended); next charge.
   - copy history: the restore write is by page id, a section no longer on the page is put back, the limit
     clamp (called directly: the route never asks for more than 20).
   - public doors: reject and approve on an expired or decided take, name and reason lengths, the 4K warning
     and kind label on the page, the EEO form's exact choices and flags, the VSL ceilings at their edges, a
     curve that arrives unsorted, and no row for a viewing with no curve.
   - read doors: ad-books folding (earliest and latest dates, sort ties, session company only, no company),
     the combined figure's field order and unknown handling, the closer's current call and next call, the
     one funding number's fallbacks, the lender-count gate, the month and day windows, hostile company or
     staff ids in the query string, the CSM queue statement.

### Breaks run in this cycle (each against the file's tests, restored after)

About 240 named breaks (the ones the checker listed, plus the nearby ones for the same line) and an
operator-by-operator sweep over every changed SQL region (each `=` flipped, each `AND` clause dropped, each
`DESC` reversed, each window moved, each `IN` negated, each limit raised). Every one went red except these,
which cannot change what these routes answer:

- `src/marketing/funnel-store.mjs` `savePageBuild`, `markPagePushed`, `markPageAddress`, `funnelJobs` (worker
  and other routes only).
- `src/marketing/ideas-store.mjs` `listBatches`, `src/marketing/offer-store.mjs` claim and finish (not on these
  doors); `src/marketing/clock.mjs` tick statements.
- `src/marketing/model-usage.mjs` `month_capped` (the health card reads dollars, not that flag);
  `src/marketing/metrics.mjs` `maturing` (not in the funnel stats answer).
- `src/brand/copy-generate.mjs` `generateSectionCopy`'s page update (another route).
- `src/marketing/scripts-store.mjs` approve statements (the approve row was not in this repair).
- Comments.

### Shared lines touched this cycle

| File | Edit |
|---|---|
| `src/pulse/catalog/proofs/fin-b25-door-contracts.mjs` | two entries removed (the two not-attachable rows), a comment saying why |
| `src/pulse/catalog/proofs/fin-b25-door-contracts.test.mjs` | `ids.length` 40 to 38 |
| `src/pulse/coverage/gap-door-batch-routes.mjs` | `routes-1.json` 25 to 27 |
| `src/pulse/coverage/gap-door-batch-routes.test.mjs` | the row total 95 to 97 |
| `src/pulse/catalog/proofs/door-batch-route-result.test.mjs` | rows 95 to 97; unique routes 78 to 80 |
| `src/pulse/catalog/generated.json` | regenerated with `npm run pulse:catalog` |

### Numbers

`node scripts/pulse/count-not-proved.mjs`: before this cycle `{total 813, routes 95}`; after
`{total 815, routes 97}`. The two rows that came back are the two above. Batch rows still open: 2.

### Product findings added this cycle (written down, not fixed)

1. `GET /api/read/company-activity`: every person's timeline label reads "event" (query aliases `label`, code
   reads `row.kind`). Same reason as the not-attachable row.
2. `GET/POST /api/partner-marketing/copy-history`: there is no company check. The door lets any owner or admin
   read or restore any partner page by id, because `canAccessPartnerMarketing` only checks the role and no
   row-level policy exists on `partner_pages` or `partner_page_section_versions` (db/migrations 135, 136, 172).
   The attached test judges what it can (role, partner, suite, lock, version scope, restore write by page id)
   and does NOT judge company isolation, because the door does not have it.
3. `GET /api/partner-addons`: a plan that has not started yet (effective_from in the future, not cancelled) is
   shown with status "cancelled" in the catalog, because the status only tests "in the history but not live".
4. `GET /api/read/closer-call`: "today's cash" starts at UTC midnight (`todayCash` in `src/sales/cockpit.mjs`),
   so after 5 pm Arizona it restarts. The month window is also a UTC calendar month.
5. `GET /api/read/closer-now`: the day boundary is `date_trunc('day', ...)` in the database session's time
   zone, not Arizona's.
6. `POST /api/marketing/research` and `/tweak`: a repeated request_id wakes the worker again, because the
   saved answer still says `started: true`. Harmless (the wake is idempotent) but it is not "writes nothing".

### Commands run and results

- `node --test src/http/fin-b25-*.test.mjs`: 138 tests, 138 pass, 0 skipped.
- `node --test src/pulse/catalog/proofs/fin-b25-door-contracts.test.mjs
  src/pulse/coverage/gap-door-batch-routes.test.mjs src/pulse/catalog/proofs/door-batch-route-result.test.mjs`:
  all pass.
- `npm run lint`: 3,577 files parse clean.
- `npm run pulse:catalog`: 3975 mapped, 33 repeats, 3942 unique; 3919 wired, 23 red.
