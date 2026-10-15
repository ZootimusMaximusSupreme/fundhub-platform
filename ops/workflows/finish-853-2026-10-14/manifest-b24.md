# Batch 24 manifest — staff doors (route lane, 40 rows)

Branch `fin/b24`, built from `fin/base` at `2f4f574a0`. Nothing was pushed or merged.
Lane: `gap-door-batch-routes`. Product code changed: none.

Four passes are on this branch. The first (commit `e84d7b749`) wrote the 99 handler tests. The second
(`1329b66a2`) broke every refusal inside the 36 handlers one at a time and added 19 tests for the ones no test noticed.
The third (`18d6bef1d`) read every row's own words against what its door really returns, and held back the two rows
whose words name a result the door never returns (see "Third pass"). The fourth, repair cycle 1 (this commit), answers
an independent checker that broke 29 of the attached rows and found a break that stayed green on each (see
"Repair cycle 1"). It adds 54 tests in 9 new `fin-b24-repair-*` files and holds one more row back.

## Numbers

| | Before | After |
|---|---|---|
| Rows of this batch that say NOT_PROVED (`node scripts/pulse/count-not-proved.mjs`, offline, intersected with `batch-24.json`) | 40 | 3 |
| All four lanes, same script | 853 | 816 (route lane 135 to 98) |

Measured on a detached checkout of `fin/base` (40 of 40 open) and on this branch (3 of 40 open: `route:climate/geocode`,
`route:marketing/costs` and `route:inquiry`). Second pass had left only geocode open; the third pass moved costs back on
purpose; repair cycle 1 moved the inquiry row back on purpose (its words say "open", the door lists every status).

## What each row ended as

All 38 attached rows are **practice tests**: the real `api/` handler, fake data, and a stand-in database that
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
| route:climate/geocode | **not-attachable** (held) | `fin-b24-chat-journeys.test.mjs` (state and point only) | see "The two held rows" below |
| route:content/tiles (GET) | practice-test | `fin-b24-content-docs.test.mjs` | tiles with prices and on-off, videos, tier map, products, this company only, unknown price null, only two missing-shape errors forgiven, owner and admin only |
| route:content/welcome-video | practice-test | `fin-b24-content-docs.test.mjs` | mapped or not, bytes in the store or missing or unverified, signed link without storage key, client pinned, signed streaming with no session, HEAD, redirect, forged and expired links are one 404, no key 503 |
| route:creative/generate | practice-test | `fin-b24-creative.test.mjs` | one queued job for the login's partner with who asked, idempotent on key (and on a lost race), suite switch, offer and script checks, provider readiness note, the kind of piece (picture by default, video, copy) saved and asked for |
| route:creative/run | practice-test | `fin-b24-creative.test.mjs` | claim and run up to max jobs (cap 10, default 3), sums and plain notes, ad-checker verdict on copy, `all=1` staff only, local runner leaves copy for the Mac. Claim and run are handed in; no provider is called |
| route:dashboard/kpis | practice-test | `fin-b24-staff-reads.test.mjs` | cash in cents, funded count and amount, show and close rate, cost per funded, new clients, pipeline movement, this company and window (today, 7d, 30d and the quarter-to-date day count on five dates), unknown not zero, shared dashboard key refused 403 |
| route:documents-download | practice-test | `fin-b24-content-docs.test.mjs` | fresh signed link, no storage key, client own file only, one 404 for every refusal, every staff role, partner login refused |
| route:hiring/apply (GET) | practice-test | `fin-b24-hiring.test.mjs` | this company's active roles by name, key name brief only, blank brief null, cache header on success only |
| route:hiring/apply (POST) | practice-test | `fin-b24-hiring.test.mjs` | candidate and application in `applied`, task for a person, nothing decided, same reply for new, returning and bot, burst and per-email limits, protected fields refused |
| route:hiring/apply (POST application) | practice-test | `fin-b24-hiring.test.mjs` | same test as the POST row above |
| route:hiring/decide (routes-1) | practice-test | `fin-b24-hiring.test.mjs` | advance and reject write who decided, from, to and the machine's advice; reason required; body naming the decider refused; closed application 409 |
| route:hiring/decide (routes-2) | practice-test | `fin-b24-hiring.test.mjs` | same tests as the row above, plus feedback task and no email |
| route:inquiry | **not-attachable** (held) | `fin-b24-staff-reads.test.mjs`, `fin-b24-repair-staff.test.mjs` (the door's real behaviour) | see "The three held rows" below |
| route:journeys/ask | practice-test | `fin-b24-chat-journeys.test.mjs` | system and user text to the model with the server-held key, joined text, 502 words, 503 with no key, owner and admin only. The network is a stand-in |
| route:journeys/run (routes-1) | practice-test | `fin-b24-chat-journeys.test.mjs` | the real walk on the success path: a fresh pretend client per path, both lanes of the fork, memory-provider flip inside the transaction, never committed, rolled back, connection released, nothing on the wire |
| route:journeys/run (routes-2) | practice-test | `fin-b24-chat-journeys.test.mjs` | same tests, plus all six seeded journeys (9 paths), text format, unknown journey, owner, admin and sales manager only |
| route:lender-observations | practice-test | `fin-b24-staff-reads.test.mjs` | log: bureau mismatch against what the lender is known to pull, saved for this company, bureau required; review: only this company's row, allowed words; roles |
| route:marketing/ad | practice-test | `fin-b24-marketing-reads.test.mjs` | the drawer row, Meta ads, curve, alerts, diagnoses; this company and number; quiet number is unknown spend; 404, 400 |
| route:marketing/angles | practice-test | `fin-b24-marketing-reads.test.mjs` | spend and leads by angle for 30 Arizona days, script angle beats creative angle, no-angle spend in no row, nothing of another company |
| route:marketing/batches/write-now | practice-test | `fin-b24-marketing-writes.test.mjs` | one batch and one `start_batch` job, ideas taken once, cap refuses and queues nothing, repeat press answered once, validation |
| route:marketing/costs | **not-attachable** (held) | `fin-b24-marketing-reads.test.mjs` (month cap and per-run caps only) | see "The two held rows" below |
| route:marketing/flywheel (GET) | practice-test | `fin-b24-marketing-reads.test.mjs` | campaigns, six steps in plain words, approved vs done, copy waits for offer, partner by default, honest empty card, writes nothing |
| route:marketing/flywheel/approve | practice-test | `fin-b24-marketing-writes.test.mjs` | one front-matter edit `status: approved`, once per press, already-approved flag, refusals say which |
| route:marketing/flywheel/campaign | practice-test | `fin-b24-marketing-writes.test.mjs` | owner-notes file with the `Offer key:` line, 201 vs 200, no wake when nothing queued, key upper-cased |
| route:marketing/flywheel/job | practice-test | `fin-b24-marketing-reads.test.mjs` | one avatar run of this company with status, the sentence in words (running with dollars and searches, failed, done), cost so far, resumable only when failed, another company's run is 404 |
| route:marketing/flywheel/run | practice-test | `fin-b24-marketing-writes.test.mjs` | steps 1 to 6: avatar and market research as their own runs, offer handed on with the avatar's words, copy and strategy as one job each after their approvals, once per step, no key 503, cap 409, step 6 free |
| route:marketing/flywheel/spend-read | practice-test | `fin-b24-marketing-writes.test.mjs` | 30 Arizona days ending yesterday, rows, each of the seven conclusions for the numbers that call for it and the step the page jumps to, the same words and figures in `06-spend.md`, queued in the same transaction, repeat press saves nothing more |
| route:marketing/flywheel/tweak | practice-test | `fin-b24-marketing-writes.test.mjs` | one dated line appended under Notes, step re-run with the note on the job, blocked and no-key reasons, note saved either way |

### The three held rows

All three rows have a test that goes red when the door breaks. They are held back from the catalog because the catalog
writes the row's own words in as the asserted result (`proof.asserts` is the row text, and `door-recipes.test.mjs`
requires it), and the door cannot deliver those words. A green row would say a result is proved that does not exist.
They stay `NOT_PROVED` until Chris picks: change the row's words, or change the door. The tests and titles are ready
(`FIN_B24_HELD_ROWS` in `fin-b24-door-contracts.mjs`), so either way the move into the catalog is one entry.

| Row | Words say | The door returns | What is missing | One-line fix for the words |
|---|---|---|---|---|
| `route:climate/geocode` (`routes-0.json`) | "a state / county" | `ok`, `provider`, `stateCode`, `lat`, `lng`, `formatted` (`api/climate/geocode.mjs` over `geocode()` in `src/climate/connectors.mjs`) | A county. No code path reads Google's county component or the Census geographies lookup, and `/climate` (`public/climate/_next/static/chunks/375-*.js`) reads only `stateCode`, `lat`, `lng`. No spec or journey names a county | "Turn a typed address into a state and a map point for the lending-climate map (no lenders read, no record)." |
| `route:marketing/costs` (`routes-3.json`) | "the month and batch caps" | `month {used_usd, cap_usd, unpriced_calls}`, `run_caps {avatar, ...}`, `kinds.*.run_cap_usd`, `limits` (`api/marketing/costs.mjs` over `readCosts()` in `src/marketing/costs.mjs`) | The batch cap (`marketing_settings.max_batch_cost_usd`, default $40). It is returned by `GET /api/marketing/settings`, never by this door. The design (§3.1) gives this door `month` and `run_caps` only | "GET what each paid job kind cost last time, the month cap and the per-run caps. Every cost line on the Command Center reads this." |
| `route:inquiry` (`routes-0.json`) | "open inquiry-removal cases for the Specialist desk" | every case of the company, newest 100, of ANY status (Queued, Scheduled, In Progress, Completed, Escalated, Blocked, Canceled). It narrows only when `?status=` is sent (`api/inquiry.mjs`) | An "open only" listing. Nothing in the statement keeps a Completed or Canceled case off the desk. A test that pinned "open" would assert the opposite of what the door does, and a test that pinned "every status" contradicts the row's own word | "GET action=cases or status: every inquiry-removal case of the company (newest 100, any status, narrowed when a status is sent) for the Specialist desk, or one outbound call row." |

The guard test (`fin-b24-door-contracts.test.mjs`) keeps all three rows red and checks their tests exist. Three pins
in the handler tests go red the day a held door starts returning the missing result: the geocode answer's key list
(`fin-b24-chat-journeys.test.mjs`), the costs answer's `month`, `run_caps` and "batch" word
(`fin-b24-marketing-reads.test.mjs`), and the inquiry list (`fin-b24-repair-staff.test.mjs`: a Completed and a Canceled
case are on the desk's list today, so the day the door narrows to open work that test goes red and the row is bound).
Each failure message points at the held row.

I did not edit the coverage map (`ops/workflows/coverage-every-surface-2026-10-10/routes-*.json`): changing a row's
words changes its id, and the batch lists and the orchestrator's counts are keyed by id.

## Files added

- `src/pulse/catalog/proofs/fin-b24-door-contracts.mjs` (the 37 bound rows, exact map text, tests and titles; `FIN_B24_HELD_ROWS` lists the 3 held rows with the words that would make them honest)
- `src/pulse/catalog/proofs/fin-b24-door-contracts.test.mjs` (7 tests: binding, titles exist, rows left the red lane, the 3 held rows stay red with real tests)
- `src/pulse/catalog/proofs/fin-b24-staff-reads.test.mjs` (11): lender-observations, inquiry, ad-videos, dashboard/kpis
- `src/pulse/catalog/proofs/fin-b24-content-docs.test.mjs` (10): content/tiles, content/welcome-video, documents-download
- `src/pulse/catalog/proofs/fin-b24-agent-board.test.mjs` (7): agent-call check, adintel/board
- `src/pulse/catalog/proofs/fin-b24-hiring.test.mjs` (9): hiring/apply, hiring/decide
- `src/pulse/catalog/proofs/fin-b24-chat-journeys.test.mjs` (10): chat/messages, chat/ask, journeys/ask, journeys/run, climate/geocode
- `src/pulse/catalog/proofs/fin-b24-creative.test.mjs` (9): creative/generate, creative/run
- `src/pulse/catalog/proofs/fin-b24-analytics.test.mjs` (9): clickfunnels and youtube connect and sync
- `src/pulse/catalog/proofs/fin-b24-campaigns.test.mjs` (9): campaigns/detail, link-asset, sync
- `src/pulse/catalog/proofs/fin-b24-marketing-reads.test.mjs` (8): marketing/ad, angles, costs, flywheel, flywheel/job
- `src/pulse/catalog/proofs/fin-b24-marketing-writes.test.mjs` (14): write-now, flywheel approve, campaign, run, spend-read, tweak
- `ops/workflows/finish-853-2026-10-14/manifest-b24.md` (this file)

- `src/pulse/catalog/proofs/fin-b24-front-guards.test.mjs` (16, second pass): the refusal that stands in front of each door.
  A login that names no company is turned away before any row is read or any vendor is asked (13 doors:
  agent-call, adintel/board, clickfunnels-connect, clickfunnels-sync, youtube-connect, youtube-sync, content/tiles,
  documents-download, content/welcome-video, inquiry, lender-observations, journeys/run, chat/messages), and three
  doors that do work answer a read with 405 (clickfunnels-sync, youtube-connect, journeys/run).
- `src/pulse/catalog/proofs/fin-b24-more-guards.test.mjs` (2, second pass): welcome-video says the signing key is
  not set up (503) on the player's request, and dashboard/kpis maps a refused value to 400 and a real fault to 500.

175 tests in the 22 test files (99 first pass, 19 second pass, 3 third pass, 54 repair cycle 1). No new file is over 700 lines.

Repair cycle 1 files (all in `src/pulse/catalog/proofs/`):

- `fin-b24-repair-kit.mjs`: tests-only helpers. `returned(sql, row)` hands back the columns an INSERT's `RETURNING` list names
  (`RETURNING *` hands back the whole row, secrets included), `assertSqlHas` pins the fragments of a statement that decide a
  number, `flat` and `deepKeys`.
- `fin-b24-repair-board.test.mjs` (3): adintel/board, all five views.
- `fin-b24-repair-analytics.test.mjs` (5): clickfunnels and youtube connect and sync.
- `fin-b24-repair-campaigns.test.mjs` (6): campaigns/detail and campaigns/sync.
- `fin-b24-repair-chat-journeys.test.mjs` (7): chat/messages, chat/ask, journeys/run.
- `fin-b24-repair-content-docs.test.mjs` (5): content/tiles, content/welcome-video, documents-download.
- `fin-b24-repair-creative.test.mjs` (7): creative/generate, creative/run (real claim, run and sweep).
- `fin-b24-repair-staff.test.mjs` (5): dashboard/kpis, lender-observations, inquiry.
- `fin-b24-repair-marketing-reads.test.mjs` (6): marketing/ad, angles, flywheel, flywheel/job.
- `fin-b24-repair-marketing-writes.test.mjs` (10): flywheel approve, campaign, run, tweak, spend-read.

Edited in repair cycle 1 (existing tests changed, none weakened): `fin-b24-agent-board.test.mjs` (the send fence is DOWN in
`beforeEach`, `MESSAGING_DRY_RUN=0`, so a dial that gets past the door lands on the trapped wire),
`fin-b24-analytics.test.mjs` (the connect stand-in answers only the columns the statement's `RETURNING` names; the old
assertion that the connection carried `encrypted_credentials` is gone, it enshrined a leak; the YouTube sync count of 3,
which counted a row that is never written, is no longer pinned),
`fin-b24-door-contracts.mjs` (binds the new titles to 25 entries and moves `route:inquiry` to the held rows),
`fin-b24-door-contracts.test.mjs` (37 bound, 3 held, the inquiry words and proposed words).

Edited in the second pass: `fin-b24-staff-reads.test.mjs` (+1 test: ad-videos with no company, now 10 tests),
`fin-b24-chat-journeys.test.mjs` (the client login case now also checks the refusal came from the sign-in gate, and
a partner login is added), `fin-b24-door-contracts.mjs` (binds the new files and titles to 16 entries).

## Shared lines touched (integrator: please merge these)

| File | Change |
|---|---|
| `src/pulse/catalog/proofs/door-proof.mjs` | one import line (`finB24DoorProof`) after the `s5DoorProof` import, and one `\|\| finB24DoorProof(sourceFile, row)` line at the end of the `plugIn` chain (the `;` moved to it) |
| `src/pulse/coverage/gap-door-batch-routes.mjs` | `EXPECTED_ROUTE_GAP_COUNTS` is now 42 / 26 / 16 / 14 (was 54 / 36 / 25 / 20; total 98, was 135). Subtract this batch's own counts per file if other route batches also merge: routes-0 minus 12 (11 attached, geocode and inquiry held), routes-1 minus 10, routes-2 minus 9, routes-3 minus 6 (costs is held, so it still counts) |
| `src/pulse/coverage/gap-door-batch-routes.test.mjs` | the total, 135 to 98, in five places |
| `src/pulse/catalog/proofs/door-batch-route-result.test.mjs` | `rows.length` 135 to 98, and `targets.length` 115 to 82 (unique route keys still in the lane after this batch) |
| `src/pulse/catalog/proofs/door-proof.test.mjs` | the "known partial rows" sample `route:lender-observations` became `route:read/message-templates` (`/^GET the message copy library/`), because the old sample left the red lane. The "exact route gap monitor" case now changes the control text of its `route:ad-videos` row so no attached test is bound to it (the row is attached now) |
| `src/pulse/catalog/door-recipes.test.mjs` | the sample surface `route:ad-videos` became `route:read/messages` in "route recipes use route methods", for the same reason |
| `src/pulse/catalog/generated.json` | rebuilt with `npm run pulse:catalog`. Expect a conflict; rebuild after merging |

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

## Third pass (generation 2): the row's own words against what the door returns

Method. The catalog writes a row's words in as the asserted result, so a row is only honest if every result the words
name is (a) returned by the door and (b) judged by a test that goes red when it is wrong. I read each of the 39 attached
rows' words against the real handler and its test. Two kinds of finding:

**A named result the door returns but no test judged. Closed with a test, each broken on purpose and seen red:**

| Row | The words | What was not judged | Now judged by |
|---|---|---|---|
| `route:dashboard/kpis` | `period=today\|7d\|30d\|qtd` | `qtd` was only on the "allowed" list; its day count was never checked, so `qtd` could have returned 30 and stayed green | new test in `fin-b24-staff-reads.test.mjs`: time held still on five dates (1 Jan = 1 day, 31 Mar = 90, 1 Jul = 1, 14 Oct = 14, 31 Dec = 92), and the same day count is bound to the cash and funded reads. Broken: `qtd` returned 30, and off by one: both red |
| `route:creative/generate` | "(image, video or copy)" | only `copy` was ever sent; the default kind (`static`, the picture) and `video` were not | new test in `fin-b24-creative.test.mjs`: no kind, `static`, `video`, `assetKind` and `copy`, each saved with that kind and the service asked for that same kind, and a kind nothing can make is saved and says so. Broken: default `static` to `copy`; camelCase key dropped; wrong kind asked: all red |
| `route:creative/run` | "ad-checker verdict on copy" | only the failing line was judged, so a checker that always said "fails" stayed green | `fin-b24-creative.test.mjs`: a plain line passes with no failures and "it passes", the guarantee line fails and says "1 problem". Broken: `ok` always false; the pass words changed: both red |
| `route:marketing/flywheel/job` | "(status, cost so far, sentence)" | the sentence was only `typeof string` | `fin-b24-marketing-reads.test.mjs`: the running sentence with step, dollars and searches; failed says "Could not finish: ..." and is the only state that can resume; done says the result's own sentence. Broken: four edits in `avatarJobView`: all red |
| `route:marketing/flywheel` | "every campaign and its six steps in plain words" | the footer advice was only `typeof string` | same file: names step 2 as next when the avatar is done. Broken: advice words changed: red |
| `route:marketing/flywheel/spend-read` | "writes the conclusion into 06-spend.md" | only the "selling" conclusion existed, and the file was only checked for its stamp | `fin-b24-marketing-writes.test.mjs`: all seven conclusions (selling, opening, offer with no leads, offer with no calls, ask, too early, no spend), the step the page jumps to, and that the file carries the same words twice (answer and review card) and the figures. Broken: five edits in `concludeSpend`: all red |
| `route:marketing/flywheel/run` | "6 spend read: free" | the step-6 test was in the file but not bound to the row | its title is now bound in `fin-b24-door-contracts.mjs` |

**A named result the door never returns. Two rows held back** (see "The three held rows"): `route:climate/geocode`
(county) and `route:marketing/costs` (batch caps). The first was held by the earlier pass for the same reason; the
second was attached by the first pass and is moved back to red here, because the words cannot be asserted.

**Loose words that are not a result (left attached, written down):**

- `route:inquiry` says "open inquiry-removal cases". The SQL has no open-only condition. It lists the company's cases
  of every status, newest 100, and narrows only when `status=` is sent. The test pins exactly that (an "open" and a
  "waiting" case both come back). The real status values are `Queued, Scheduled, In Progress, Completed, Escalated,
  Blocked, Canceled`, so the stand-in's "open" and "waiting" are not real values; the door passes the word through.

Independent break check on the earlier work (a fresh sample, 12 breaks across 8 doors: journeys/run commit instead of
rollback, hiring decide reason guard, lender-observations role set, flywheel approve value, documents-download
refusal code, chat/messages participant and company conditions, youtube-sync no-video skip and connection state,
write-now cap status): every one went red. One stayed green by design: removing `reject()`'s own reason check inside
`src/hiring/pipeline.mjs` while the door's own check is intact (equal outcome, the door refuses first; removing both
goes red).

## Repair cycle 1: 29 rows an independent checker found green on a real break

Method. A fresh checker broke the product on purpose behind each of 29 attached rows (about 330 one-line breaks across the
doors) and reported the ones that left every test green. For each row I (a) strengthened the stand-in so the condition the
break touches is judged, (b) wrote the break again, saw it go red, and put the file back from its copy (no diff is left in
any product file; `git status` was clean of product changes after every set), or (c) where the row's own words cannot be
asserted, removed the attachment.

What made them green, in four kinds:

1. **The stand-in chose its own answer.** An INSERT stand-in that answered a hand-picked row hid `RETURNING *`, a secret at
   the top level and a missing `ok:true`; a statement answered by a canned row hid `sum` turned into `max`, a thirty-day
   window turned into thirty hours, a lost company condition. Now `returned()` cuts the row to the statement's own
   `RETURNING` list, row-level conditions are a stand-in table that keeps a row only while the SQL text carries its
   condition, and the statements that compute a number are pinned (a pin judges what the statement says, it does not run it).
2. **A request that never lied.** No request carried a company, a role or a partner of its own, so "scoped to the session,
   never the request" was untested. Every new request now carries a hostile `org_id` (and `partner_id`, `role`).
3. **Handed-in fakes.** `creative/run` took claim, run and the sweep as fakes, and the journey walk's network trap could not
   see the job cloud, which is reached through its own client. claim, run and the sweep are the real ones now; the job
   cloud's `send` is counted.
4. **Only one value of a field.** One review word, one band, one campaign, one stage. Each is now varied.

### What each of the 29 ended as

| Row | Outcome | Judged by | Breaks that now go red |
|---|---|---|---|
| route:adintel/board | practice-test | `fin-b24-repair-board.test.mjs` | movers: week, rank-not-null, company, own-ads exclusion, order; death watch, new entrants, saturation: company, week, own-ads exclusion; band flipped, platform and angle and risk filters dropped; blocked screen state; company from the address; no `ok:true` |
| route:agent-call (check) | practice-test | `fin-b24-agent-board.test.mjs` (fence down) | a check that also calls `placeCall`, in the client branch and in the agent-only branch |
| route:analytics/clickfunnels-connect | practice-test | `fin-b24-repair-analytics.test.mjs` | key or ciphertext at the top level, `RETURNING *`, no `ok:true`, company from the body |
| route:analytics/clickfunnels-sync | practice-test | `fin-b24-repair-analytics.test.mjs` | views missing or opt-ins missing turned into 0, `statsAvailable` forced true, the answer's `stats_available` a constant, company from the body |
| route:analytics/youtube-connect | practice-test | `fin-b24-repair-analytics.test.mjs` | secret or ciphertext at the top level, `RETURNING *`, no `ok:true`, company from the body |
| route:analytics/youtube-sync | practice-test | `fin-b24-repair-analytics.test.mjs`, `fin-b24-analytics.test.mjs` | unknown views turned into 0, any refresh failure marked expired, company from the body, a wrong count. The count the old test pinned (3, one row never written) is no longer pinned (finding 8) |
| route:campaigns/detail | practice-test | `fin-b24-repair-campaigns.test.mjs` | spend, impressions, clicks and conversions aggregates, the day window, ad sets `OR true`, the action scope, `LIMIT 5000`, `revertible`, `has_disclosure_asset`, `in_learning_phase`, `ad_count` |
| route:campaigns/sync | practice-test | `fin-b24-repair-campaigns.test.mjs` | re-pull overwrite list, ad set budget, ctr and roas, video counts turned into 0, buzz scan not partner scoped, verification word for any word, `not_verified`, written when Meta is silent |
| route:chat/ask | practice-test | `fin-b24-repair-chat-journeys.test.mjs` | role and company from the body, thin forced false in both modes, search handed no database. **Equal outcome, not judged on its own: removing `canQueryBrain` (finding 10)** |
| route:chat/messages | practice-test | `fin-b24-repair-chat-journeys.test.mjs` | no `ok:true` on list, thread and send, unsorted pair key (the other person answers), a customer thread in the list, company from the request |
| route:content/tiles (GET) | practice-test | `fin-b24-repair-content-docs.test.mjs` | no `ok:true`, an unknown size turned into 0, company from the address |
| route:content/welcome-video | practice-test | `fin-b24-repair-content-docs.test.mjs` | a 7-day link, company from the address (staff and client), the join to another company's video, unknown size turned into 0. **Equal outcome, not judged: `client_id` taken from the address (finding 9)** |
| route:creative/generate | practice-test | `fin-b24-repair-creative.test.mjs` | the offer read only from the top level (every Enqueue press 400), `spec.scriptId` not checked, the offer not folded into a spec, formats and variants hardcoded |
| route:creative/run | practice-test | `fin-b24-repair-creative.test.mjs` | claim without the partner, without queued-only, ignoring the cap, a cap counting every partner's running jobs, a run that reports success with nothing stored, the 500 as a 200, no `job_id`, the requeued, none-worked and no-module words, the Mac count for every partner, the all-partners sweep (queued-only, copy exclusion, partner, max per partner) |
| route:dashboard/kpis | practice-test | `fin-b24-repair-staff.test.mjs` | all eight statements pinned whole (cash window, spend window, demo and test clients, pipeline key and window, `count(DISTINCT)`, `SUM(amount_paid)`), company from the address |
| route:documents-download | practice-test | `fin-b24-repair-content-docs.test.mjs` | partner and affiliate principals, a client-less document open to a client, an answer that adds metadata, checksum or signature ref, company from the address, a 7-day link |
| route:inquiry | **not-attachable** | `fin-b24-repair-staff.test.mjs` pins the door's real behaviour | the row says "open"; the door lists every status. The tests for the column lists and the GET-only call row are in, and go red on their breaks (case_status column dropped, `transcript` added, POST accepted) |
| route:journeys/run (routes-1) | practice-test | `fin-b24-repair-chat-journeys.test.mjs` | `skipInngest` removed (the job cloud's `send` is counted, with its key set), the Demo Mode, editor-key and company filters, the headline, the journeys left out, the start findings, the pretend-client mark, the event bus stubbed |
| route:journeys/run (routes-2) | practice-test | same tests | same breaks |
| route:lender-observations | practice-test | `fin-b24-repair-staff.test.mjs` | review always "confirmed", notes dropped, application, round, lender table and lender row each forced null (door and store), the lookup that fills the known bureaus turned off |
| route:marketing/ad | practice-test | `fin-b24-repair-marketing-reads.test.mjs` | all 31 fields of the row, alerts and diagnoses (`<>`, company), script labels company, a number known only by its script, and the ad-number statement (company, window both ends, demo clients, cancelled bookings, failed payments, number filter) |
| route:marketing/angles | practice-test | `fin-b24-repair-marketing-reads.test.mjs` | spend window lower bound, an ad with no ad-day counted, script labels company, ad labels company, the same ad-number statement |
| route:marketing/flywheel | practice-test | `fin-b24-repair-marketing-reads.test.mjs` | every step's state word and sentence (not run, running, needs a redo, stopped at the cap, out of date, waiting, done, approved, every step current), label and step words, gate sentence, document, review card, GitHub link, campaigns' words, advice, the saved-run overlay and its company and campaign |
| route:marketing/flywheel/approve | practice-test | `fin-b24-repair-marketing-writes.test.mjs` | all six steps for two campaigns: the file, the folder, the campaign and step in the answer |
| route:marketing/flywheel/campaign | practice-test | `fin-b24-repair-marketing-writes.test.mjs` | the folder name for four offers, every line of the owner notes, the `## Notes` heading, the date, the words, the company on the folder read |
| route:marketing/flywheel/job | practice-test | `fin-b24-repair-marketing-reads.test.mjs` | the ledger sum for this run only, searches, attempts, step, step number and words, steps total, start time, stopped at the cap, the steps list |
| route:marketing/flywheel/run | practice-test | `fin-b24-repair-marketing-writes.test.mjs` | steps 1 and 2 no key, masked key, month cap in Settings (not the fallback), a run already going; step 3 notes and research; step 5 needs both approvals; the month cap from Settings; the campaign on the job |
| route:marketing/flywheel/spend-read | practice-test | `fin-b24-repair-marketing-writes.test.mjs` | the whole document line for line, the folder and the name of the campaign asked, the version, the input hashes, the ad count, unmatched spend, the Meta purchases (own company only), maturing, cost per lead |
| route:marketing/flywheel/tweak | practice-test | `fin-b24-repair-marketing-writes.test.mjs` | the offer hand-off (notes and the new line), the offer writer's refusal words, the free spend read, step 2's reason, step 1's avatar run (note, cap, key, month cap), who asked, already running, the pipe, the notes path, the campaign on the job |

Break log. Each test file was written, run green on the unbroken product, then every break above was applied one at a time
to the product source (or to the SQL text), the test files named run, red seen, and the file written back from its copy.
All breaks went red except these, which are equal outcomes and not product changes anyone can see:

| Break | Why nothing can change |
|---|---|
| `chat/ask`: remove the `canQueryBrain(staff.role)` guard | the staff gate in front of it admits exactly the roles `canQueryBrain` admits (finding 10) |
| `content/welcome-video`: `clientId = query.client_id \|\| principal.clientId` | `tierCodeForClient` has no rule and ignores the client (finding 9) |
| `youtube-sync`: count only the snapshots written | this is the correct fix for finding 8, not a break |

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

- `node scripts/pulse/count-not-proved.mjs` on a detached checkout of `fin-b24`'s base: 853 total, 40 of this batch open.
  On this branch: 815 total (route lane 97), 2 of this batch open.
- `node --test src/pulse/catalog/proofs/fin-b24-*.test.mjs`: 121 of 121 pass (118 before the third pass).
- Break checks: 17 one-line breaks in the third pass (each new test seen red, then the file restored from its backup copy,
  no diff left in any product file) plus the 12-break sample above.
- `npm run pulse:catalog`: ran; `generated.json` rebuilt (one row changed: `route:marketing/costs` is red again).
- Repair cycle 1: `node scripts/pulse/count-not-proved.mjs` on this branch: 816 total (route lane 98), 3 of this batch
  open (`route:climate/geocode`, `route:marketing/costs`, `route:inquiry`). `node --test src/pulse/catalog/proofs/fin-b24-*.test.mjs`:
  175 of 175 pass. `node --test src/pulse/catalog/proofs/fin-b24-door-contracts.test.mjs src/pulse/coverage/gap-door-batch-routes.test.mjs
  src/pulse/catalog/proofs/door-batch-route-result.test.mjs src/pulse/catalog/proofs/door-proof.test.mjs
  src/pulse/catalog/door-recipes.test.mjs`: 1,008 of 1,008 pass. `npm run pulse:catalog`: ran; `npm run lint`: clean.
  The whole set (`src/pulse/catalog/*.test.mjs`, `src/pulse/catalog/proofs/*.test.mjs`,
  `src/pulse/coverage/gap-catalog*.test.mjs`, `src/pulse/coverage/gap-door-batch*.test.mjs`): 1,858 tests, 1,857 pass, 1
  fail. The one that failed is "every test named by a flow proof passes with fake data or local reads"
  (`flow-result-proofs.test.mjs`), which re-runs other batches' tests and fails only when the Mac is loaded (load average
  15 to 47 while it ran). Run alone it is 9 of 9 (the same under-load failure the third pass recorded).
  About 330 one-line breaks across the 9 break sets (board 20, agent 2, analytics 21, campaigns 20, chat and journeys 21,
  content and documents 13, creative 21, staff 26, marketing reads 58, marketing writes 54), run by a script that writes
  the file back from its copy in a `finally`.
- `node --test` over `src/pulse/catalog/*.test.mjs`, `src/pulse/catalog/proofs/*.test.mjs`,
  `src/pulse/coverage/gap-catalog*.test.mjs` and `src/pulse/coverage/gap-door-batch*.test.mjs`: 1,804 tests, 1,802 pass,
  2 fail. Both fail only under load (the Mac was running dozens of sibling test runs, load average 15 to 47):
  "the focused proof test runs every executable test named by every case" (`display-proof-cases.test.mjs`) and
  "every test named by a flow proof passes with fake data or local reads" (`flow-result-proofs.test.mjs`). Each run alone:
  3 of 3 and 9 of 9 pass.
- `npm run lint`: 3,576 files parse clean (3,586 after repair cycle 1).
- Not run: `npm run pulse:prove` (it reads the live database; this batch is told to stay off it) and any
  `.pg.test.mjs` (there is no local Postgres on this Mac).

## Product findings (not fixed)

1. **`POST /api/hiring/decide` does not check the company when it finds the application.** `advance()` and
   `reject()` in `src/hiring/pipeline.mjs` look the application up by its id only (`WHERE a.id = $1 FOR UPDATE OF a`);
   the company is used only to find the stage. An owner or admin of one company who knows an application id from
   another company could move or reject it. Safe while there is one company; the test does not judge it.
2. **Two catalog rows name a result their door never returns** (above): `route:climate/geocode` (county) and
   `route:marketing/costs` (batch caps). A decision for Chris on each: the words, or the door.
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
6. **`GET /api/inquiry?action=cases` is described as "open" cases but returns every status** (see the held rows). If the
   Specialist desk is meant to see only live work, the list needs a status condition; today Completed and Canceled
   cases are in it (newest 100). A decision for Chris: the words, or the door.
7. **The `/climate` page reads `n.reason` on a failed lookup; the door sends `error`.** In the built page code
   (`public/climate/_next/static/chunks/375-*.js`) a failed answer throws `n.reason || "Failed to geocode"`, while
   `api/climate/geocode.mjs` answers `{ok:false, error:"not_found"}`. The visitor sees "Failed to geocode" for every
   failure, not the door's word. Harmless; written down.
8. **`POST /api/analytics/youtube-sync` says `videos_synced: 3` when it saved 2.** `stats.length` counts a report row with
   no video id, which is skipped and never written. The count is the report's rows, not the snapshots saved. Found by the
   checker; the old test pinned the wrong 3, now only the right count (rows written) is judged and a correction to the
   door's count will not turn anything red.
9. **`content/welcome-video` reads a client id nothing uses.** The client branch takes `?client_id=` for staff and the
   login's own id for a client, then passes it to `tierCodeForClient`, which has no rule and ignores it
   (`tier_reason: no_tier_rule_in_code`). So "client sees own file" cannot be told apart from "any file" today. The test
   pins that no client row is read, so the day a tier rule reads the client this goes red and gets judged.
10. **`chat/ask`'s own `canQueryBrain` check can never fire.** `canQueryBrain(role)` is "the role is in
   `ROLE_SETS.STAFF`", the same set the staff gate in front of it admits, so no role reaches the line and fails it. The
   behaviour (knowledge mode is open to exactly the roles the Company Brain admits) is judged role by role.
11. **`GET /api/analytics/clickfunnels-sync` and the other three analytics doors read the company from the sign-in only.**
   Nothing to fix. Noted because hostile `org_id` values were added to every request in the new tests and none of the
   doors reads them (each test goes red if one starts).

## What these tests cannot see

- The SQL itself is not run by Postgres. The stand-in keeps a row only while the SQL text carries that row's
  condition, so a lost condition is caught, but a typo in a column name is not (the `.pg.test.mjs` files do that).
- `creative/run`'s claim and run are the REAL ones since repair cycle 1, but the creative provider module is a fake that
  writes the same copy every time, so what a vendor really sends back is other tests'.
- `chat/ask` takes the answerers through the handler's seam; the model and retrieval are other tests'.
- A statement pin (`assertSqlHas`, used for campaigns/detail, dashboard/kpis, the ad-number read and a few more) says the
  statement still carries the fragment that decides a number. It does not run the statement. Only a `.pg.test.mjs` on a
  scratch database does that, and there is no local Postgres on this Mac.
- The vendors (ClickFunnels, Google, Meta, ntfy, Anthropic) are stand-ins. Nothing was called and no real key was used.
