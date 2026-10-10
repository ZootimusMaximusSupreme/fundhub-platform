# M1 — FinanceOS F2 (bank login repair) merged up to current main

Branch: `merge/M1-finance-os-f2-bank-relink-2026-10-09` (made from `finance-os-f2-bank-relink`, draft PR #24).
Main at the last merge: `2d95387f5`. Main is an ancestor of this branch. Nothing was pushed, shipped or merged into main.

## What was wrong

The branch was one commit (`a42edf50b`) on top of an older main. Main moved 205 commits since.

1. One real conflict: `db/expected-migrations.mjs` (the generated list of migrations).
2. One law gap: the new route `banking/relink` had a ping row but no tripwire. `src/pulse/tripwires.test.mjs` failed on it. The new reconnect text had nothing that goes red when a paying client is never told.

## Root cause

1. The branch added migration 474 while main added 475 to 478 on the same lines of the generated list. Git cannot merge two edits to the same generated lines.
2. The branch was written before the heartbeat law grew its tripwire map (owner-set 2026-10-09). The map did not exist when the branch was cut.

## What changed

- `db/expected-migrations.mjs`: regenerated with `node scripts/db/expected-migrations.mjs` (not hand-merged). 474 now sits between 473 and 475.
- Migration number: **no renumber needed.** Main has no file numbered 474. Production has 470 to 473 and 475 to 478 applied, 474 is not applied. The runner (`db/migrate.mjs`) applies any file not yet recorded, in any order, so 474 will apply on the next production deploy.
- New `src/pulse/coverage/gap-bank-relink.mjs` (+ test): one read-only check, `bank-relink-error-login-not-told`. Red when a paying client (active `finance-os` subscription or paid Capital Blueprint) has a bank login in `error` for over 2 days, with a code a reconnect fixes, and `reconnect_notified_at` still empty. Clients who opted out of SMS are left out (the job refuses them and leaves the stamp empty for good, so they would be red forever). Clients with no phone are left out too: nobody can text them, and that failure is the dispatcher's own alarm, not this lane's. A read that fails is a skip with the reason, never a pass.
- `src/pulse/coverage/modules.mjs`: the new lane is on the literal list.
- `src/pulse/tripwires.mjs`: `route:banking/relink` and `job:plaid-transactions-sweeper` are now in `TRIPWIRES` (impact customer). The route names `banks-plaid-item-error` and the new check. The sweeper names `banks-sync-stale` and the new check.
- `src/pulse/tripwires-baseline.json`: `job:plaid-transactions-sweeper` left the baseline (the list only shrinks). `BASELINE_MAX` in `src/pulse/tripwires.test.mjs` went 495 to 494, as that test's own comment says to do.
- The branch's own code was not changed.

## Proof

Run in this worktree. No database was written. No Plaid call. No text.

| What | Result |
|---|---|
| `npm run lint` | clean, 3231 files |
| `node_modules/.bin/tsc --noEmit` | 1 error, in `src/marketing/filmed-receive.mjs`. That file is not in this branch and the error is on main. |
| Branch tests: plaid-item-errors, plaid-relink, plaid-http, bank-reconnect-notice, bank-relink, bank-relink-doc, plaid-transactions-sweeper | all pass |
| New lane test `gap-bank-relink.test.mjs` | 9 of 9 pass (PASS case, FAIL case, skip cases, SQL read-only, drift guard against the job's own query) |
| `src/pulse/*.test.mjs`, `src/pulse/coverage/*.test.mjs`, `src/pulse/beats/*.test.mjs`, `src/workflows/index.test.mjs`, routes, auth-gate, health-migrations | 2792 pass, 2 fail (both fail on pristine main too, see below) |
| Whole suite, no database (`node scripts/run-suite.mjs`, before the second main merge) | 19985 tests, 19947 pass, 15 fail, 23 skipped. Every failing name also fails on pristine main (checked file by file on a `git archive` of main). |
| `npm run pulse:prove` from the built api bundle, read-only, live data | See next section. |
| The lane SQL on the live schema | Ran read-only as the staff role, with only the not-yet-existing column swapped out: parses, joins and permissions work. 3 live logins, all `active`, none in error. |

### pulse:prove, and why it is not "OK" yet

Pristine main: `OK`, exit 0, 45 steps, 626 rows.
This branch: 46 steps, 627 rows. Everything is the same except one row: `bank-relink-error-login-not-told` reads **NOT CHECKED** with "plaid_items.reconnect_notified_at is not on this database yet (migration 474 is not applied)". That is the only "problem" the proof lists, so it exits 1.

That is expected and honest: the live database does not have the column until migration 474 ships. The lane says so in plain words and never says PASS. After `npm run ship` applies 474 and deploys, **run `npm run pulse:prove` again. It must say OK and the row must be green.** Production applies the migration in the build before the new function goes live, so the live server never runs the lane before the column exists.

### Tests that fail on main as well (not caused by this branch)

- `src/pulse/registry.test.mjs` "every registry row names a real handler or desk file": needs `public/leads/...` which is git-ignored and exists only in the main checkout.
- `src/workflows/index.test.mjs` "index serves exactly the workflows on disk": `pulse-instant-watch` is registered but not in `EXPECTED_WORKFLOW_IDS`.
- `src/journeys/runner/index.test.mjs` (3 tests): expects 98 workflows, main has 100.
- `src/http/read-endpoints-org-scope.test.mjs`: `morning-brief.mjs` has no org clause.
- `src/lib/no-unfenced-transmit.test.mjs`: `src/pulse/funnel-doors.mjs` and `src/pulse/instant-watch.mjs`.
- `scripts/diagrams/generate.test.mjs`, `scripts/journeys/generate.test.mjs`: generated docs are out of date.
- `src/http/climate-match.test.mjs`, `scripts/daily-pulse.test.mjs`, `src/repo/edit-ops.test.mjs` (3 tests).

### Could not run here

- `src/banking/plaid-relink.pg.test.mjs` (two suites: "bank-login repair on real tables" and "the reconnect text, end to end"): need a real Postgres (`DATABASE_URL`). There is no local Postgres on this Mac and the live database does not have migration 474. They skipped. They must run once against a scratch database.
- No browser check: nothing under `public/` is in this branch's change (the Reconnect button screen is not built yet; `docs/finance/bank-relink.md` is its contract).
- `scripts/plaid-relink-sandbox-proof.mjs` (a Plaid sandbox run) was not run: it calls Plaid.

## Risk notes

- Customer-facing path: yes. A signed-in client calls `/api/banking/relink`. One SMS per broken login is queued (`SMS-FINANCE-OS-RECONNECT`). It only queues. The dispatcher sends behind the dry-run fence, quiet hours and the opt-out read. Audience: active `finance-os` subscribers and Blueprint buyers only.
- Money: money-adjacent, not money-moving. It reads accounts and balances and makes a Plaid Link token in update mode. It moves nothing.
- Migration: yes, 474. Additive: one nullable column and one template row (`ON CONFLICT DO NOTHING`). It applies on the next production deploy.
- Hot path: it touches `netlify/functions/api.mjs` (one import, one ROUTES entry) and `src/workflows/plaid-transactions-sweeper.mjs` (a daily job). It does not touch `src/workflows/client.mjs` or `src/events/bus.mjs`. Git merged `api.mjs` with no conflict.
- Live external system: Plaid (a link token and `/accounts/get`, only through `src/banking/providers/plaid-http.mjs`). No ClickFunnels, no Meta.
- Playwright (CLAUDE.md section 6): not needed for this merge. No UI file is in the branch.
- Heartbeat: the route has its `reg:` ping (`banking/relink` in `API_KEYS`). The text runs inside the existing job, which already has its `job:` row. The tripwire was missing: now added and on the map (above).
- Shared files other merge builders may also touch, so expect easy conflicts: `src/pulse/tripwires.mjs` (end of `TRIPWIRES`), `src/pulse/tripwires-baseline.json`, the `BASELINE_MAX` line in `src/pulse/tripwires.test.mjs` (set it to the real baseline length), `src/pulse/coverage/modules.mjs`, `db/expected-migrations.mjs` (regenerate, never hand-merge).

## Leftovers (not fixed, on purpose)

1. Run `npm run pulse:prove` after ship. It must say OK.
2. Run `src/banking/plaid-relink.pg.test.mjs` against a scratch Postgres (all migrations applied, run as the database owner like CI). Never against the live database.
3. `npm run journeys` and `npm run diagrams`: main is already stale (both tests fail on main). Regenerate once, after every merge is in.
4. The Reconnect screen (front end) is not built. Flow doc: `docs/journeys/bank-relink-flow.md`.
5. Nothing receives Plaid's own "login repaired" webhook (no Plaid adapter under `api/webhooks`). A login Plaid repaired stays in error until the client taps the button. The branch says this itself.
6. The other FinanceOS jobs and routes are still on the shrinking tripwire baseline (not touched by this branch).
7. `src/pulse/coverage/gap-banks.mjs` and `gap-finance-os.mjs` say "do not add another watcher". The new lane is a different question (was the client told), so it is its own file and does not change those two.
