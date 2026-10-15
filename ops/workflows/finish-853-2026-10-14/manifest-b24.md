# Batch 24 manifest — staff doors (route lane, 40 rows)

Branch `fin/b24`, built from `fin/base` at `2f4f574a0`. Nothing was pushed or merged.
Lane: `gap-door-batch-routes`. Product code changed: none.

Two passes are on this branch. The first pass (commit `e84d7b749`) wrote the 99 handler tests. The second pass
(this commit) re-measured the numbers, then broke every refusal inside the 36 handlers one at a time and listed the
ones no test noticed. It added 19 tests for the ones inside a row's claim (see "Second pass" below).

## Numbers

| | Before | After |
|---|---|---|
| Rows of this batch that say NOT_PROVED (`node scripts/pulse/count-not-proved.mjs`, offline, intersected with `batch-24.json`) | 40 | 1 |
| All four lanes, same script | 853 | 814 (route lane 135 to 96) |

The one row left open is `route:climate/geocode`. Reason below.

## What each row ended as

All 39 attached rows are **practice tests**: the real `api/` handler, fake data, and a stand-in database that
answers by the conditions the SQL text names. They are not live checks. A live check for a route would be a new
read-only gap lane over the saved results; none was built here. Every test was broken on purpose and went red
(see "Break it on purpose").

The "Test file" column names the main file. Every row also runs `fin-b24-front-guards.test.mjs` or
`fin-b24-more-guards.test.mjs` when the second pass added a refusal test for that door (the bound list in
`fin-b24-door-contracts.mjs` is the exact record).

| Row (surface) | Outcome | Test file | What the test judges |
|---|---|---|---|
| route:ad-videos | practice-test | `fin-b24-staff-reads.test.mjs` | this company's takes only, state or ad filter, padded ad id refused, folder name padded and link number not, no write, owner and admin only |
| route:adintel/board | practice-test | `fin-b24-agent-board.test.mjs` | latest rolled-up week, own ads and raw score withheld, do-not-copy flag, filters, five views, empty state, staff must name a partner, client and affiliate refused |
| route:agent-call (check) | practice-test | `fin-b24-agent-board.test.mjs` | ready answer dials nothing and writes nothing, ten refusal reasons, phone key asked last, six contact desks, company on agent and client |
| route:analytics/clickfunnels-connect | practice-test | `fin-b24-analytics.test.mjs` | key proved against ClickFunnels before saving, saved encrypted for this company, no secret returned, refused key saves nothing, subdomain shape |
| route:analytics/clickfunnels-sync | practice-test | `fin-b24-analytics.test.mjs` | one row per page per funnel, unknown numbers NULL not 0, 90-day cap, error recorded with ClickFunnels' words and earlier pages kept, no connection 404 |
| route:analytics/youtube-connect | practice-test | `fin-b24-analytics.test.mjs` | three Google values proved first, saved encrypted with channel id, no secret returned, Google's own refusal words, missing field |
| route:analytics/youtube-sync | practice-test | `fin-b24-analytics.test.mjs` | snapshot per video per day with title, unknown NULL, no-video row skipped, expired vs error state, 365-day cap, this company's connection |
| route:campaigns/detail | practice-test | `fin-b24-campaigns.test.mjs` | campaign, ad sets, daily series (clicks over impressions), actions, days cap 180, scope is the login's partner, staff name a partner, 404, client refused |
| route:campaigns/link-asset | practice-test | `fin-b24-campaigns.test.mjs` | each field only when its key is sent, blank or null clears, number source `manual`, cross-partner and cross-company refused, shape of number, database refusals mapped |
| route:campaigns/sync | practice-test | `fin-b24-campaigns.test.mjs` | rows written for this partner, pending becomes active the moment Meta answers, Meta's verification word written, refusal counts nothing and stays pending, unusable states named, dying-ad buzz once per ad per day, held buzz not recorded |
| route:chat/ask | practice-test | `fin-b24-chat-journeys.test.mjs` | system and knowledge modes, retrieval scoped to the session's company and role, refused search statuses, question limits, staff only. Answerers are handed in; no model is called |
| route:chat/messages | practice-test | `fin-b24-chat-journeys.test.mjs` | own internal threads only, thread messages oldest first for a participant, staff send saved delivered from this person, pair thread made once, idempotency, no compliance gate, refusals |
| route:climate/geocode | **not-attachable** | `fin-b24-chat-journeys.test.mjs` (state and point only) | see below |
| route:content/tiles (GET) | practice-test | `fin-b24-content-docs.test.mjs` | tiles with prices and on-off, videos, tier map, products, this company only, unknown price null, only two missing-shape errors forgiven, owner and admin only |
| route:content/welcome-video | practice-test | `fin-b24-content-docs.test.mjs` | mapped or not, bytes in the store or missing or unverified, signed link without storage key, client pinned, signed streaming with no session, HEAD, redirect, forged and expired links are one 404, no key 503 |
| route:creative/generate | practice-test | `fin-b24-creative.test.mjs` | one queued job for the login's partner with who asked, idempotent on key (and on a lost race), suite switch, offer and script checks, provider readiness note |
| route:creative/run | practice-test | `fin-b24-creative.test.mjs` | claim and run up to max jobs (cap 10, default 3), sums and plain notes, ad-checker verdict on copy, `all=1` staff only, local runner leaves copy for the Mac. Claim and run are handed in; no provider is called |
| route:dashboard/kpis | practice-test | `fin-b24-staff-reads.test.mjs` | cash in cents, funded count and amount, show and close rate, cost per funded, new clients, pipeline movement, this company and window, unknown not zero, shared dashboard key refused 403 |
| route:documents-download | practice-test | `fin-b24-content-docs.test.mjs` | fresh signed link, no storage key, client own file only, one 404 for every refusal, every staff role, partner login refused |
| route:hiring/apply (GET) | practice-test | `fin-b24-hiring.test.mjs` | this company's active roles by name, key name brief only, blank brief null, cache header on success only |
| route:hiring/apply (POST) | practice-test | `fin-b24-hiring.test.mjs` | candidate and application in `applied`, task for a person, nothing decided, same reply for new, returning and bot, burst and per-email limits, protected fields refused |
| route:hiring/apply (POST application) | practice-test | `fin-b24-hiring.test.mjs` | same test as the POST row above |
| route:hiring/decide (routes-1) | practice-test | `fin-b24-hiring.test.mjs` | advance and reject write who decided, from, to and the machine's advice; reason required; body naming the decider refused; closed application 409 |
| route:hiring/decide (routes-2) | practice-test | `fin-b24-hiring.test.mjs` | same tests as the row above, plus feedback task and no email |
| route:inquiry | practice-test | `fin-b24-staff-reads.test.mjs` | cases for this company newest first, status filter, one call row of this company, wrong verb 405, inquiry specialist, admin and owner only |
| route:journeys/ask | practice-test | `fin-b24-chat-journeys.test.mjs` | system and user text to the model with the server-held key, joined text, 502 words, 503 with no key, owner and admin only. The network is a stand-in |
| route:journeys/run (routes-1) | practice-test | `fin-b24-chat-journeys.test.mjs` | the real walk on the success path: a fresh pretend client per path, both lanes of the fork, memory-provider flip inside the transaction, never committed, rolled back, connection released, nothing on the wire |
| route:journeys/run (routes-2) | practice-test | `fin-b24-chat-journeys.test.mjs` | same tests, plus all six seeded journeys (9 paths), text format, unknown journey, owner, admin and sales manager only |
| route:lender-observations | practice-test | `fin-b24-staff-reads.test.mjs` | log: bureau mismatch against what the lender is known to pull, saved for this company, bureau required; review: only this company's row, allowed words; roles |
| route:marketing/ad | practice-test | `fin-b24-marketing-reads.test.mjs` | the drawer row, Meta ads, curve, alerts, diagnoses; this company and number; quiet number is unknown spend; 404, 400 |
| route:marketing/angles | practice-test | `fin-b24-marketing-reads.test.mjs` | spend and leads by angle for 30 Arizona days, script angle beats creative angle, no-angle spend in no row, nothing of another company |
| route:marketing/batches/write-now | practice-test | `fin-b24-marketing-writes.test.mjs` | one batch and one `start_batch` job, ideas taken once, cap refuses and queues nothing, repeat press answered once, validation |
| route:marketing/costs | practice-test | `fin-b24-marketing-reads.test.mjs` | last measured cost and minutes per kind (unknown stays null), month against cap, run caps, avatar line |
| route:marketing/flywheel (GET) | practice-test | `fin-b24-marketing-reads.test.mjs` | campaigns, six steps in plain words, approved vs done, copy waits for offer, partner by default, honest empty card, writes nothing |
| route:marketing/flywheel/approve | practice-test | `fin-b24-marketing-writes.test.mjs` | one front-matter edit `status: approved`, once per press, already-approved flag, refusals say which |
| route:marketing/flywheel/campaign | practice-test | `fin-b24-marketing-writes.test.mjs` | owner-notes file with the `Offer key:` line, 201 vs 200, no wake when nothing queued, key upper-cased |
| route:marketing/flywheel/job | practice-test | `fin-b24-marketing-reads.test.mjs` | one avatar run of this company with cost so far, another company's run is 404 |
| route:marketing/flywheel/run | practice-test | `fin-b24-marketing-writes.test.mjs` | steps 1 to 6: avatar and market research as their own runs, offer handed on with the avatar's words, copy and strategy as one job each after their approvals, once per step, no key 503, cap 409, step 6 free |
| route:marketing/flywheel/spend-read | practice-test | `fin-b24-marketing-writes.test.mjs` | 30 Arizona days ending yesterday, rows, conclusion, `06-spend.md` queued in the same transaction, repeat press saves nothing more |
| route:marketing/flywheel/tweak | practice-test | `fin-b24-marketing-writes.test.mjs` | one dated line appended under Notes, step re-run with the note on the job, blocked and no-key reasons, note saved either way |

### The one `not-attachable` row

`route:climate/geocode` (`routes-0.json`): "Turn a typed address into a state / county for the lending-climate map".
The door (`api/climate/geocode.mjs` over `geocode()` in `src/climate/connectors.mjs`) returns `stateCode`, `lat`,
`lng`, `provider` and `formatted`. It never returns a county, and the page (`/climate`) reads only `stateCode`,
`lat` and `lng`. The state-and-point half is judged by a test that goes red when it breaks (in
`fin-b24-chat-journeys.test.mjs`), but the row's own words name a county, so attaching it would claim a result the
door does not produce. Two ways forward, both outside this batch: change the row's words to "a state and a point",
or make the door return a county. The guard test pins that this row stays red.

## Files added

- `src/pulse/catalog/proofs/fin-b24-door-contracts.mjs` (the 39 bound rows, exact map text, tests and titles)
- `src/pulse/catalog/proofs/fin-b24-door-contracts.test.mjs` (7 tests: binding, titles exist, rows left the red lane, geocode stays red)
- `src/pulse/catalog/proofs/fin-b24-staff-reads.test.mjs` (9): lender-observations, inquiry, ad-videos, dashboard/kpis
- `src/pulse/catalog/proofs/fin-b24-content-docs.test.mjs` (10): content/tiles, content/welcome-video, documents-download
- `src/pulse/catalog/proofs/fin-b24-agent-board.test.mjs` (7): agent-call check, adintel/board
- `src/pulse/catalog/proofs/fin-b24-hiring.test.mjs` (9): hiring/apply, hiring/decide
- `src/pulse/catalog/proofs/fin-b24-chat-journeys.test.mjs` (10): chat/messages, chat/ask, journeys/ask, journeys/run, climate/geocode
- `src/pulse/catalog/proofs/fin-b24-creative.test.mjs` (8): creative/generate, creative/run
- `src/pulse/catalog/proofs/fin-b24-analytics.test.mjs` (9): clickfunnels and youtube connect and sync
- `src/pulse/catalog/proofs/fin-b24-campaigns.test.mjs` (9): campaigns/detail, link-asset, sync
- `src/pulse/catalog/proofs/fin-b24-marketing-reads.test.mjs` (8): marketing/ad, angles, costs, flywheel, flywheel/job
- `src/pulse/catalog/proofs/fin-b24-marketing-writes.test.mjs` (13): write-now, flywheel approve, campaign, run, spend-read, tweak
- `ops/workflows/finish-853-2026-10-14/manifest-b24.md` (this file)

- `src/pulse/catalog/proofs/fin-b24-front-guards.test.mjs` (16, second pass): the refusal that stands in front of each door.
  A login that names no company is turned away before any row is read or any vendor is asked (13 doors:
  agent-call, adintel/board, clickfunnels-connect, clickfunnels-sync, youtube-connect, youtube-sync, content/tiles,
  documents-download, content/welcome-video, inquiry, lender-observations, journeys/run, chat/messages), and three
  doors that do work answer a read with 405 (clickfunnels-sync, youtube-connect, journeys/run).
- `src/pulse/catalog/proofs/fin-b24-more-guards.test.mjs` (2, second pass): welcome-video says the signing key is
  not set up (503) on the player's request, and dashboard/kpis maps a refused value to 400 and a real fault to 500.

118 tests in the 13 test files (99 first pass, 19 second pass). No new file is over 700 lines.

Edited in the second pass: `fin-b24-staff-reads.test.mjs` (+1 test: ad-videos with no company, now 10 tests),
`fin-b24-chat-journeys.test.mjs` (the client login case now also checks the refusal came from the sign-in gate, and
a partner login is added), `fin-b24-door-contracts.mjs` (binds the new files and titles to 16 entries).

## Shared lines touched (integrator: please merge these)

| File | Change |
|---|---|
| `src/pulse/catalog/proofs/door-proof.mjs` | one import line (`finB24DoorProof`) after the `s5DoorProof` import, and one `\|\| finB24DoorProof(sourceFile, row)` line at the end of the `plugIn` chain (the `;` moved to it) |
| `src/pulse/coverage/gap-door-batch-routes.mjs` | `EXPECTED_ROUTE_GAP_COUNTS` is now 41 / 26 / 16 / 13 (was 54 / 36 / 25 / 20; total 96, was 135). Subtract this batch's own counts per file if other route batches also merge: routes-0 minus 13, routes-1 minus 10, routes-2 minus 9, routes-3 minus 7 |
| `src/pulse/coverage/gap-door-batch-routes.test.mjs` | the total, 135 to 96, in five places |
| `src/pulse/catalog/proofs/door-batch-route-result.test.mjs` | `rows.length` 135 to 96, and `targets.length` 115 to 81 (unique route keys still in the lane after this batch) |
| `src/pulse/catalog/proofs/door-proof.test.mjs` | the "known partial rows" sample `route:lender-observations` became `route:read/message-templates` (`/^GET the message copy library/`), because the old sample left the red lane. The "exact route gap monitor" case now changes the control text of its `route:ad-videos` row so no attached test is bound to it (the row is attached now) |
| `src/pulse/catalog/door-recipes.test.mjs` | the sample surface `route:ad-videos` became `route:read/messages` in "route recipes use route methods", for the same reason |
| `src/pulse/catalog/generated.json` | rebuilt with `npm run pulse:catalog` (78 changed lines). Expect a conflict; rebuild after merging |

Samples I picked (`route:read/message-templates`, `route:read/messages`) belong to other route batches (b26) and
may leave the red lane when those merge. If they do, the integrator re-picks a row that is still red.

## Second pass: what the first pass left open

Method. For every handler of this batch: (a) mutate each class of refusal in all 36 handlers at once (no company,
role gate, principal kinds, wrong verb) and read which test titles went red; (b) then mutate one guarded refusal per
handler per round (115 sites, 15 rounds) with `if (cond)` turned into `if (false && (cond))`, and ask whether a test
named for that door went red. Results of (b): 100 of 115 went red, 15 did not. Each of the 15:

| Guard that no test noticed | Verdict |
|---|---|
| `welcome-video`: player asks for bytes and the signing key is not set up (503, not the 404 of a forged link) | gap, closed: `fin-b24-more-guards.test.mjs`, red when the branch is removed |
| `dashboard/kpis`: refused value is a 400, anything else a 500 | gap, closed: `fin-b24-more-guards.test.mjs`, red when the branch is removed |
| `marketing/flywheel/run`: `if (!runner)` (409 not built) | **unreachable today**: steps 1 and 2 (the only steps with no runner) are handed to `STAGE_HANDLERS` first. A test would have to remove a handler from a frozen module constant. Left |
| `adintel/board`: `err.code === "BAD_REQUEST"` to 400 | **unreachable today**: nothing under `src/` throws that code on this path. Left |
| `chat/ask`: `!canQueryBrain(staff.role)` | **redundant today**: every role that passes the staff role gate has at least one brain tier, so this line never fires; the retrieval step refuses the same way. Left |
| `content/tiles`: six POST save refusals (unknown action, nothing to save, no code, no name, bad price, row not found, x2) | **not this row**: the row is the Content screen READ. The save is its own catalog row (`route:content/tiles`, "Content screen save"), batch 08 |
| `inquiry`: `!isUuid(caseId)` and the BureauCallError mapping | **not this row**: both belong to `POST action=launch`, its own catalog row (still open, not in this batch) |
| `agent-call`: placed call with no call id | **not this row**: the row is `action=check` and never dials |

The first class sweep found a pattern: for 12 of the 15 doors with an explicit "no company" refusal, no test noticed
when it was removed (only chat/ask, dashboard/kpis and, after the first fix here, ad-videos). It is defensive today
because a real staff session always carries a company, but the shared dashboard key and a future sign-in kind do not.
Each is now one test. Three doors that do work (clickfunnels-sync, youtube-connect, journeys/run) had no test for the
wrong verb; each now has one.

## Break it on purpose

For every attached door the product (or the SQL) was changed on purpose, the batch's tests were run, red was
seen, and the file was put back with `git checkout`. About 300 breaks were run through `mut.sh`-style one-line
changes. Every one went red except four equal outcomes (below) and a handful that stayed green at first because
the test could not tell (fixed, then red):

- role gate widened by one role, or removed (every door)
- company, client or partner condition dropped from the SQL, or bound to the wrong value (every read and write)
- a status or time-window condition dropped, an order flipped, a cap removed, a unit lost (cents, 100x)
- a required field made optional, a refusal never reached, a refusal turned into a success
- "unknown stays unknown" turned into 0
- a second press made a second row (the unique clause, the early read, the replay)
- a held buzz recorded as sent, a pending connection never promoted, a transaction committed instead of rolled back

Weak spots found by the breaks and strengthened (then red): a foreign row with the same id so a lost company
condition shows (chat messages, angles spend, angles labels, ad ideas), a second week so the default week is
checked, a `text` field on a non-text model block, two companies' ad spend sharing a row id, and a stand-in that
ignored the SQL's own status list.

Four breaks stayed green on purpose, and each is an equal outcome (the layer next to it says the same thing):

| Break | Why nothing changes |
|---|---|
| `hiring/apply`: email lowercased in only one of the two places | The parser and the pipeline both lowercase. Removing both goes red |
| `chat/messages`: add "client" to the kinds the door accepts | The next guard (no staff id on a client login) still answers 403 |
| `creative/generate`: drop the early read of an existing job | The insert's unique clause plus the re-read gives the same answer. The lost-race test pins the clause |
| `content/welcome-video`: change the first value of `fileState` | The store check always assigns it before it is read |

## Commands run

- `node scripts/pulse/count-not-proved.mjs`: before 853 (40 of this batch open), after 814 (1 of this batch open).
- `node --test src/pulse/catalog/proofs/fin-b24-*.test.mjs`: 118 of 118 pass (99 of 99 before the second pass).
- `npm run pulse:catalog`: ran; `generated.json` rebuilt.
- `node --test` over `src/pulse/catalog/*.test.mjs`, `src/pulse/catalog/proofs/*.test.mjs`,
  `src/pulse/coverage/gap-catalog*.test.mjs` and `src/pulse/coverage/gap-door-batch*.test.mjs`: 1,782 tests,
  1,780 pass, 2 fail. Both were looked at:
  - "route recipes use route methods" named `route:ad-videos` as its sample. Fixed (see shared lines); re-run passes.
  - "every test named by a flow proof passes" lost `src/sales/closer-deck.test.mjs` to the 30 s inner timeout on
    a loaded Mac. Same failure the earlier manifests recorded. Run alone: 27 of 27 pass.
- `npm run lint`: 3,576 files parse clean.
- Not run: `npm run pulse:prove` (it reads the live database; this batch is told to stay off it) and any
  `.pg.test.mjs` (there is no local Postgres on this Mac).

## Product findings (not fixed)

1. **`POST /api/hiring/decide` does not check the company when it finds the application.** `advance()` and
   `reject()` in `src/hiring/pipeline.mjs` look the application up by its id only (`WHERE a.id = $1 FOR UPDATE OF a`);
   the company is used only to find the stage. An owner or admin of one company who knows an application id from
   another company could move or reject it. Safe while there is one company; the test does not judge it.
2. **`route:climate/geocode` row says "state / county"; the door returns no county** (above).
3. **The flywheel card never turns on Run for steps 1 and 2.** `GET /api/marketing/flywheel` answers
   `can_run.ok = false` with "Not on this page yet: it ships in slice 5a" for the avatar, and the same for the
   research, because `STAGE_RUNNERS[1]` and `[2]` are still `null` in `src/marketing/flywheel/stages.mjs`, while
   `POST /api/marketing/flywheel/run` does start both. This is the documented "wave 2d" glue, so it is a known gap,
   not a new break. The run tests prove the POST side.
4. **`campaigns/link-asset` lets staff name any partner in any company** (`resolvePartnerId` takes the body's
   `partner_id` as given for staff). The file's own header says this is open on purpose. Noted only because the
   test pins the partner scope to what the caller named.
5. **`campaigns/detail` cross-partner 404 rests on row-level security**, which a stand-in database cannot run. The
   test proves the handler opens the scope for the login's own partner and ignores `partner_id` in the address; the
   policy itself is proved by `src/http/creative-endpoints.pg.test.mjs` on a scratch database (not run here).

## What these tests cannot see

- The SQL itself is not run by Postgres. The stand-in keeps a row only while the SQL text carries that row's
  condition, so a lost condition is caught, but a typo in a column name is not (the `.pg.test.mjs` files do that).
- `creative/run` takes claim and run through the handler's seam; the claim SQL and the providers are other tests'.
- `chat/ask` takes the answerers through the handler's seam; the model and retrieval are other tests'.
- The vendors (ClickFunnels, Google, Meta, ntfy, Anthropic) are stand-ins. Nothing was called and no real key was used.
