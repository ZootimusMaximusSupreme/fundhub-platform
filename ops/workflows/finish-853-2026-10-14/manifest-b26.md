# Batch 26 manifest (finish the 853) — lane gap-door-batch-routes

Branch `fin/b26` (worktree `.claude/worktrees/fin-b26`), cut from `fin/base`. Not pushed. Not merged.
Build: generation 1, Sonnet builder. **Repair cycle 1** (this file): fresh Sonnet repair agent, after an
independent checker broke 14 of the 16 attached rows and found each test stayed green.

## Numbers

| | Count |
|---|---|
| Rows in this batch (all open at the start) | 16 |
| Still open after this branch | 0 |
| Rows the checker named for repair, all still attached after repair | 14 |
| Whole catalog, before / after (`node scripts/pulse/count-not-proved.mjs`) | 853 / 837 |
| Route lane `gap-door-batch-routes`, before / after | 135 / 119 |
| Route lane per file (routes-0 / 1 / 2 / 3) | 54/36/25/20 to 43/35/22/19 |

Words used on purpose: every attached row is a **practice test**. The real `api/` handler and the real
library under it run over in-memory stand-in tables, with fake data, no network and no database. None is
a live check. None is called "deep" or "proof" in what is handed back. Postgres never ran any SQL here.

## What the checker found, and what was wrong

The first build's stand-ins answered a statement by regular expressions and then **built the result
columns themselves** (or unpacked an INSERT by parameter position and never read its column list, or
wrote the new status itself and never read the SET list). So a break that changed only that part of the
statement was invisible. The checker's breaks that stayed green: a column dropped from a SELECT list,
`status = 'posted'` where the SQL said `'queued'`, `attempt = attempt` for `attempt + 1`, a wrong
aggregate (`no_shows` counting downsells), a swapped INSERT column list, a plain-text token, a
`RETURNING` that gave back nothing, a tenant id taken from the address.

## The repair (one new reader, every stand-in rebuilt on it)

`src/testing/fin-b26-sql.mjs` (new, test support only, with its own test `fin-b26-sql.test.mjs`): a small
SQL reader. A stand-in now asks it to **read the product's own statement**:

- `selectList` + `projectRow`: the result row holds ONLY the columns the SELECT names, each worked out
  from the expression the statement writes (`COALESCE`, `CASE`, `(a = 'x')`, `count(*) FILTER (WHERE ...)`,
  `SUM`, `COUNT(*) OVER ()`, `trim(both ' ' FROM concat_ws(...))`, `||`, `::` casts). A column the product
  stops selecting is missing, so the assertion on it goes red.
- `keep` / `whereOf` / `orderOf` / `orderRows`: WHERE evaluated as written (so `OR TRUE` and
  `$n IS NOT NULL` are real), ORDER BY with its direction and NULLS LAST.
- `runInsert`: INSERT placed by its own column list and VALUES list, `ON CONFLICT (...) [WHERE ...]
  DO UPDATE SET ...` (with `EXCLUDED` and the existing row), `DO NOTHING`, `RETURNING`.
- `runUpdate`: the SET list as written, worked out from the old row, the WHERE guard, `RETURNING`.
- Anything it cannot read throws, so a statement changed into an unknown shape is a red test.

## Every row (final outcome)

All 14 stay `practice-test`. 0 live checks, 0 verified N/A, 0 not-attachable. The two rows the checker did
not name (`social/channels`, `social/settings` POST) are unchanged from the first build.

| # | Row | Outcome | Test that judges it |
|---|---|---|---|
| 1 | routes-2 route:read/inbox | practice-test | `src/http/fin-b26-read-inbox-messages.test.mjs` |
| 2 | routes-0 route:read/inquiry-cases | practice-test | `src/http/fin-b26-read-inquiry-cases.test.mjs` |
| 3 | routes-3 route:read/message-templates | practice-test | `src/http/fin-b26-read-message-templates.test.mjs` |
| 4 | routes-0 route:read/messages | practice-test | `src/http/fin-b26-read-inbox-messages.test.mjs` |
| 5 | routes-0 route:read/my-numbers | practice-test | `src/http/fin-b26-read-my-numbers.test.mjs` |
| 6 | routes-0 route:read/portal-contracts | practice-test | `src/http/fin-b26-portal-contracts.test.mjs` |
| 7 | routes-0 route:scripts/write | practice-test | `src/http/fin-b26-scripts-write.test.mjs` |
| 8 | routes-2 route:social/oauth | practice-test | `src/http/fin-b26-social-oauth.test.mjs` |
| 9 | routes-0 route:social/posts (POST) | practice-test | `src/http/fin-b26-social-posts.test.mjs` |
| 10 | routes-0 route:social/posts (GET) | practice-test | `src/http/fin-b26-social-posts.test.mjs` |
| 11 | routes-1 route:social/publish | practice-test | `src/http/fin-b26-social-publish.test.mjs` |
| 12 | routes-0 route:social/settings (GET) | practice-test | `src/http/fin-b26-social-settings.test.mjs` |
| 13 | routes-0 route:training-progress | practice-test | `src/http/fin-b26-training-progress.test.mjs` |
| 14 | routes-2 route:trials/dashboard | practice-test | `src/http/fin-b26-trials-dashboard.test.mjs` |

Full 20-hex ids and which control each is: `src/pulse/catalog/proofs/fin-b26-door-contracts.mjs`.

## What was strengthened, per row (the checker's exact breaks, now red)

- **read/inbox**: stand-in reads the page CTE, client join, last-message lateral, final ORDER BY and all
  16 named columns. Dropping `last_body`, `last_status`, `last_direction`, `channel`, `last_message_id`,
  `last_at`, `summary`, or `m.rendered_body` / `m.created_at` from the lateral, are red. A hostile
  `?org_id=` request is sent; company stays the session's.
- **read/messages**: both statements (thread and blocked list) read from their own SELECT list. The
  blocked branch now asserts no `to_address` / `provider_ref` (adding either is red), `rendered_body`,
  `sender_name`, `blocked_reason`, and the same hostile `?org_id=` on both branches.
- **read/inquiry-cases**: new fixtures: a client with an address paper and a signature but no photo ID
  (`hasId = size > 0` red), a paper of the wrong kind labelled as the ID (kind filter removed red), live
  consents of other kinds (an extra authorization kind red), a client whose newest case is closed (active
  filter `OR TRUE` red), a client with two open cases (`ORDER BY ... ASC` red). `queue_total`, `client_name`,
  `client_email`, `client_first_name` read from the statement (constant / NULL red). Limit ceiling 500,
  floor 1 and default 100 asserted at the door and at `listCases`. Hostile `?org_id=` on all three reads.
- **read/message-templates**: every column from the SELECT list (dropping `template_key`, `channel`,
  `approved_at`, `approved_body_sha`, `body`, `compliance_passed`, or `approved_by_name` -> NULL is red);
  hostile `?org_id=`.
- **read/my-numbers**: aggregates read from the SELECT (`no_shows`, `downsells`, `deposits`, `held`,
  cash) over fixtures where those counts differ (2 no-shows, 1 downsell, 2 deposits); a next-month row
  (month end +2 months red); team table read by its join, roster WHERE, GROUP BY and ORDER BY (cash ASC,
  held counting no-shows, rank always null all red); demo row in its own world; hostile `?org_id=`, and a
  company-less session with a typed company id is still refused.
- **read/portal-contracts**: contract columns, template columns and signer columns read from their
  SELECT lists (dropping `c.status`, `c.sent_at`, `c.signed_at`, `c.template_key`, `c.title`, a signer's
  `client_id` or `status` red). New fixtures: an open agreement whose client already signed
  (`needsSign` without the signer check red), another company's template for the same key first in the
  table (template org `OR TRUE` red), signers stored out of order (ORDER BY removed red), a signed signer
  on a re-linked agreement (signed guard removed red). `listContracts` clamp (200 / floor 1 / default 100)
  asserted. Hostile `?org_id=` and `?client_id=`.
- **scripts/write**: INSERT placed by its own column list and VALUES list, answer built from its own
  RETURNING list (swapped title/body, hook/offer, org/partner, a RETURNING without `id`/`body`/`version`/
  `status`/`angle_key` all red); the archive UPDATE applies its own SET (never-superseded red); the race
  is played honestly so the `AND archived_at IS NULL` guard is judged; label upsert follows its own
  `ON CONFLICT ... WHERE`.
- **social/oauth**: channel upsert read by its own column list, literal state, scopes and `DO UPDATE SET`
  list, with already-connected accounts so a reconnect is judged: new connection `pending` (all three
  channels), reconnect without `connection_state = 'active'`, `last_error` not cleared, scopes emptied,
  Instagram token plain, LinkedIn expiry `now() - interval`, LinkedIn refresh token / expiry missing from
  the update: all red.
- **social/posts**: every UPDATE read by its own SET, WHERE and RETURNING (approve writing `posted`,
  `approved_by` NULL, no RETURNING, guard dropped, discard keyed on `partner_id` all red); the queue read
  from its own SELECT list (dropping `blocked_reasons`, `status`, `id`, `social_post_id` red); a 120-row
  queue proves `LIMIT 100`; a hostile `org_id` on an approval.
- **social/publish**: due read, all-partners read, action-log INSERT and every UPDATE read from their own
  text (`attempt = attempt`, `posted_at` removed, `last_error` not cleared, `external_post_id` NULL, undo
  payload replaced, before/after swapped, all-partners `LIMIT` 100000, due `LIMIT 50` with a 60-post run
  all red). "Logged before it goes out" is asserted from the table state at the moment the adapter is
  called. The onboarding and internal task INSERTs are read by column list too.
- **social/settings (GET)**: all seven named columns read from the statement (each drop red; the fixture
  now has `launch_enabled: true` so dropping it differs from the default); hostile `?org_id=`.
- **training-progress**: the progress upsert is the real `ON CONFLICT ... CASE ...` evaluated against the
  existing row; module join, DISTINCT ON, ORDER BY and catalogue read from their own text. New cases: a
  module only attended does not open a gate, a completion filed under another company does not count,
  second writer is the one recorded, first-time completion date, another company's / partner's decisions
  and catalogue are not read, newest decision wins with its own fields, and the full G1..G4 release
  ladder (supervised needs G1+G2+G3, unsupervised all four).
- **trials/dashboard**: counts and sums read from the SELECT (spend, impressions, clicks, `days_synced`
  each its own), booking columns and the display-name expression from the statement, a lead and a booking
  after the window end, a lead before it, a metric the day before the clock, no-name leads (typed
  attendee, then `Lead`), a booking with no time (NULLS LAST), 120 bookings (cap 100), `trial.live` for
  ended / converted / declined / refunded / provisioned, the not-started note, held-start events, the
  eight-day plan as written, `bookingLimit` bounds at the library.

## Break checks (the product was broken on purpose, the test seen red, the line put back)

A helper (`mut.py`, in the scratchpad, not in the repo) applied one break to a product file, ran the one
test file, and restored the product file with `git checkout`. Final tally of the last full pass: **257
breaks, 257 red, 0 stayed green**, across 12 specs (about 20 per file), including every break the checker
listed. `git status` showed no product edits after any run.

Two breaks stay green on purpose. They change nothing a person can see, so no test can honestly judge
them:

- `my-numbers`: `const orgId = (req.query.org_id) || staff.org_id` in the handler. That variable is only
  used for the "is it a uuid" refusal; the library call uses `staff.org_id`. The variant that matters (the
  value passed to `closerMyNumbers`) is red, and a company-less session with a typed company id is red.
- `scripts/write`: dropping `source` from the parent's `SELECT ... FOR UPDATE` list. The handler never
  reads `parent.source`; the SQL's own `CASE WHEN source = ...` reads the column itself.

Removing only the early `if (parent.archived_at)` check, or only the `AND archived_at IS NULL` guard in
the archive UPDATE, are each covered by the other (both removed is red). `social/oauth` and
`read/portal-contracts`: adding "partner" to the `requirePrincipal` kinds list is covered by the next
line (a partner account has no `role`).

## Files

Added (this cycle): `src/testing/fin-b26-sql.mjs`, `src/testing/fin-b26-sql.test.mjs`.

Changed (this cycle): the 12 test files `src/http/fin-b26-{portal-contracts, read-inbox-messages,
read-inquiry-cases, read-message-templates, read-my-numbers, scripts-write, social-oauth, social-posts,
social-publish, social-settings, training-progress, trials-dashboard}.test.mjs`, and this manifest.
`fin-b26-social-channels.test.mjs`, `src/testing/fin-b26-kit.mjs` and the plug-in
`src/pulse/catalog/proofs/fin-b26-door-contracts.mjs` are unchanged.

No product file was edited. No migration, no env, no secret.

## Shared lines touched

None this cycle. (Build cycle: `door-proof.mjs` one import and one `||` in the chain,
`gap-door-batch-routes.mjs` expected counts, `gap-door-batch-routes.test.mjs` and
`door-batch-route-result.test.mjs` row totals, `generated.json` regenerated. `npm run pulse:catalog` was
re-run this cycle: `generated.json` has no diff.)

## Product findings (written down, not fixed)

1. `social/channels` GET, `social/posts` GET and `social/publish` POST take a partner id from the address
   or body and never compare that partner's company with the signed-in staff member's company. Any staff
   role of any company can read a partner's channels and queue and run its publisher.
2. `social/oauth` start looks up the partner by id with no company check and signs that partner's company
   into the state. The partner-account branch of `writeScope` is dead code (`requirePrincipal(["staff"])`).
3. `read/portal-contracts` is a GET that writes: `mintLinks` updates `link_expires_at` on every signer and
   the contract, and flips a `pending` signer to `sent`, every time the page loads.
4. `read/my-numbers`: the team table's cash (`teamLeaderboard`) has no demo-row exclusion, while the
   closer's own cash line excludes demo rows, so the two numbers on one screen can disagree.
5. `getActiveCaseForClient` orders `requested_at DESC` with no `NULLS LAST`, so an active case with no
   request date is returned ahead of a dated one for the same client (the queue list uses NULLS LAST).
6. `read/inbox`: the last-message lateral is not company-scoped; it relies on conversation ids being unique.
7. `training-progress`: a closer cannot record G3 (the call certification is scored by a closer).
8. (new) `social/oauth` Instagram reconnect does not refresh `handle` (Facebook does). Cosmetic.
9. (new) The catalog row `routes-0.json` `route:read/portal-contracts` is classed `impact: none`, though the
   page row `client-portal.html` in `desks-a.json` is `customerData` and the route hands a client a fresh
   sign link. A `none` row is never asked for a live check. Reclassifying that route row is a catalog data
   edit, not made here.

## Not judged here (written down so nobody reads more into the green than is there)

- `read/my-numbers`: the deposit-to-funded read inside `closerMyNumbers` has an `EXISTS` subselect the
  reader cannot run, so its stand-in is hand-written and its result is not asserted. It is not in the
  row's words (calls, show rate, close rate, cash).
- `social/posts`: the compliance rule read (`FROM compliance_rules`) is answered by company only.

## Commands run (this cycle)

- `node --test src/http/fin-b26-*.test.mjs src/testing/fin-b26-sql.test.mjs
  src/pulse/catalog/proofs/fin-b26-door-contracts.test.mjs`: 151 tests, 151 pass, 0 skipped.
- Mutation pass over 12 specs: 257 red, 0 green apart from the two equivalent breaks above.
- `node --test src/lib/no-unfenced-transmit.test.mjs`: 5 of 5 pass (no outbound call added).
- `node --test src/pulse/catalog/*.test.mjs src/pulse/catalog/proofs/door-*.test.mjs
  .../s1,s2,s3-door-contracts.test.mjs .../fin-b26-door-contracts.test.mjs .../flow-read-contracts.test.mjs
  src/pulse/coverage/gap-door-batch-routes.test.mjs gap-door-batch-keys.test.mjs`: 1,094 tests, 1,094 pass.
- `node scripts/pulse/count-not-proved.mjs`: 837 total, route lane 119 (unchanged by this cycle).
- `npm run pulse:catalog`: 3975 mapped, 3919 wired, 23 red; `generated.json` unchanged.
- `node scripts/lint.mjs`: parses clean.
- Not run: browser suites and `.pg.test.mjs` (no local Postgres; the brief forbids pointing them at production).
