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

---

# Round 2 repair (branch `merge/M1-finance-os-f2-bank-relink-2026-10-09-r2`)

An independent checker read the merge branch (`56dd12e8c`) and found 6 things. This round fixes them.
Nothing was pushed, shipped or merged into main. No database write. No Plaid call. No text.

## The 6 findings, and what was done

| # | Severity | Finding | Result |
|---|---|---|---|
| 1 | high | The text tells a paying client to "tap Reconnect". No Reconnect button exists on any page. Migration 474 seeded the text as approved, so the daily job would really send it the day this ships. | **Fixed by holding the text.** 474 now seeds `SMS-FINANCE-OS-RECONNECT` with `compliance_passed = false`. The button is still not built. See "The one decision" below. |
| 2 | medium | The 12 real-database tests have never been seen to pass. | **Not fixable from here.** No Postgres, and the rules forbid a push. Static proof added (below). The branch must be pushed so CI runs them, or the file run against a scratch database. **This is a merge blocker.** |
| 3 | low | When Plaid answered but our write was refused (`write_failed`), the "we texted you" stamp was left set. | **Fixed.** `finishRelink` now clears the stamp in that branch too (best effort; it never turns the answer into a 500). |
| 4 | low | The daily batch of 200 takes the oldest broken logins. Logins of clients who do not pay, or who opted out, are never stamped, so they stay at the front. | **Fixed.** The candidate query now leaves them out in SQL. |
| 5 | low | `docs/journeys` had no line for the new door or the new text. | **Partly fixed.** The CHANGELOG line is added. The generated `-actual.md` files are NOT regenerated (leftover 3). |
| 6 | low | `npm run pulse:prove` does not say OK on this branch (the lane reads "not checked" until 474 is applied). | **Not fixable before ship.** That is the correct honest answer until the column exists. Run it right after ship (leftover 4). |

## The one decision (Chris picks; a safe default is in place)

The checker listed three ways to stop the text going out before the button exists and said Chris picks:
(a) build the Reconnect screen in the same merge, (b) seed the text not approved, (c) keep the step out of the sweeper.

I could not ask. I took **(b)** because it is the smallest change, it cannot send anything, and it is undone by one
line later:

- It uses the gate every text in the system already has (`compliance_passed`, refused by `sendTemplated` as
  `template_pending`; about 32 other templates sit in that state today).
- 474 is not applied on any database (checked live, read-only: the column and the template row are both absent;
  470 to 473 and 475 to 478 are applied), so editing the seed is safe. Nothing needs superseding.
- (a) is a front-end build that I cannot prove here (a Plaid Link update screen needs a browser and Plaid's sandbox),
  and the page-edit law wants Chris to see a marked draft first. (c) leaves the template approved, so any other
  caller could still send it.

What it does today: the daily job finds the waiting logins, asks `sendTemplated`, is told `template_pending`, queues
nothing, writes no message, and leaves every login unstamped. The pulse lane `bank-relink-error-login-not-told` still
goes red the day a paying client's login has been broken for 2 days with nobody told, and its fix line now says the
text is held on purpose. So the hold cannot hide a stuck client.

**To turn it on:** the change that ships the Reconnect screen adds a new migration that sets
`compliance_passed = true` for `SMS-FINANCE-OS-RECONNECT` and nothing else. The first 07:00 UTC pass after that
texts every paying client whose login is still broken, once.

A test now fails if a later migration names the template while no page under `public/app/` calls
`/api/banking/relink`. So the approval and the button have to ship together.

## Root cause

1. The branch seeded the text approved on the day it was written, when the screen was planned but not built. The
   back end, the text and the screen were meant to ship together; only two of the three did.
2. The candidate query was written as "everything waiting", with the audience checked afterward in code. A login
   that is never texted is never stamped, so it never leaves the query.
3. `write_failed` was reasoned about as "the login stays active" and the stamp was forgotten in that one branch.

## What changed (files)

- `db/migrations/474_bank_reconnect_notice.sql`: seeds the template `false`; the header explains why and how to turn it on. (A value and comments. No schema change.)
- `src/finance/bank-reconnect-notice.mjs`: the candidate query adds the opt-out read and the audience (finance-os subscription or paid Blueprint) in SQL, the same text the pulse lane uses. New params `$3..$6` after the existing `$1` codes and `$2` limit. The JS gates stay as the second line. Header explains the hold.
- `src/banking/plaid-relink.mjs`: the `write_failed` branch clears the stamp (`END_EPISODE_SQL`), wrapped so a refusal still returns `write_failed`.
- `src/pulse/coverage/gap-bank-relink.mjs`: the fix line and header say the text is held on purpose. The check logic is unchanged.
- `src/workflows/plaid-transactions-sweeper.mjs`: one comment line saying the step is held.
- `docs/finance/bank-relink.md` (sections 7 and 8), `docs/journeys/bank-relink-flow.md`, `docs/journeys/CHANGELOG.md`: say the text is held and how it is turned on; one new CHANGELOG line.
- Tests: `src/finance/bank-reconnect-notice.test.mjs`, `src/banking/plaid-relink.test.mjs`, `src/pulse/coverage/gap-bank-relink.test.mjs`, `src/banking/plaid-relink.pg.test.mjs`.

## Test expectations that changed, and why (none removed, skipped or weakened)

Behaviour changed on purpose in this round's commit (the seed value, and the candidate query), so these moved with it:

1. `bank-reconnect-notice.test.mjs`: "seeded the way 433, 444 and 471 seed theirs ... compliance passed" became "seeded as SMS and NOT approved". The regex now requires `false`. It is stricter: it fails if anyone flips the seed to `true`.
2. `plaid-relink.pg.test.mjs` (real database; I could not run it, see below):
   - "one pass": `checked` 3 to 1, `notEntitled` 1 to 0, `notQueued` `[{B, opted_out}]` to `[]`. The opted-out client B and the non-subscriber C are now kept out by the query, so they are not examined at all. A is still texted. Every stamp it asserts for A, B, C and the ITEM_NOT_FOUND login is unchanged.
   - "next morning": `checked` 2 to 0, for the same reason. `queued` 0 and one message for A are unchanged.
   - The two later tests (a pass that died between text and stamp, and the second break months later) are unchanged.

New tests, each shown to fail without its fix:
- `bank-reconnect-notice.test.mjs`: the template 474 seeds is refused by the REAL `sendTemplated` (`template_pending`, no write); a whole daily pass over two logins queues nothing and stamps nothing; the day it is approved each waiting login is texted once; no later migration may name the template unless a page under `public/app/` calls `/api/banking/relink` (probed with a throwaway migration file, then removed); the candidate query has the opt-out and audience predicates and all six parameters are bound. Flipping 474 to `true` makes 3 of these fail (run, then restored).
- `plaid-relink.test.mjs`: `write_failed` clears the stamp (fails without the fix); a refused clear still answers `write_failed`.
- `gap-bank-relink.test.mjs`: the job's candidate query carries the same opt-out and audience block as the lane (changing `'sms'` to `'email'` in the job makes it fail; run, then restored); the red's fix line says it is held on purpose.

## Proof

Run in this worktree. No database write. No Plaid call. No text.

| What | Result |
|---|---|
| `npm run lint` | clean, 3231 files |
| `node_modules/.bin/tsc --noEmit` | 1 error, in `src/marketing/filmed-receive.mjs`. Not in this branch; the same error is on main (same as round 1). |
| The touched tests and neighbours (plaid-item-errors, plaid-relink, plaid-http, bank-reconnect-notice, bank-relink, bank-relink-doc, sweeper, gap-bank-relink, tripwires, modules) | 207 of 207 pass (before the last guard test was added; `bank-reconnect-notice.test.mjs` alone is now 37 of 37) |
| Whole suite, no database (`node scripts/run-suite.mjs`) | 19996 tests, 19958 pass, 15 fail, 23 skipped. Round 1 was 19985 / 19947 / 15 / 23: this round adds 11 tests, all passing. The same 15 failures as round 1 (the names are the ones listed under "Tests that fail on main as well"); none is in a file this branch touches. The pg half: 928 tests, 83 pass, 845 skipped (no `DATABASE_URL`), 0 fail. |
| The new candidate query on the LIVE schema | Read-only as the staff role, with only the not-yet-existing column swapped for a same-type stand-in: it parses, the joins, `resolve_product_id` and the permissions work. 0 rows (no login is in `error` live). |
| The claim and put-back updates on the LIVE schema | `EXPLAIN` only, inside a read-only transaction (it plans and executes nothing): both parse, both use an index. |
| The status read and the login read on the LIVE schema | Ran as SELECT with throwaway ids: both return 0 rows with no error. |
| Constraints on `plaid_items` | Only `link_state` in (unlinked, pending, active, error, revoked), two foreign keys, the primary key. No trigger. So claim, put-back and end-episode cannot trip a guard. |
| The pg test's fixtures against the LIVE schema | Every table and column it inserts into exists; every NOT NULL column without a default is supplied; the `subscriptions` no-overlap rule is not hit (A and B are different clients); the `bank_accounts` checks (entity kind and its source, provider and item) are met. |

### What was NOT proved (finding 2 is still open)

`src/banking/plaid-relink.pg.test.mjs` did not run: there is no Postgres on this Mac, and the rules forbid pointing it at
the live database or pushing. The static checks above lower the risk of a plain mistake. They are not a pass.
**Merge only when both suites ("bank-login repair on real tables" and "the reconnect text, end to end") show passing
in a real run**, either the CI Postgres job on the pushed branch or a scratch database with every migration applied.
I also changed two pg expectations without being able to run them (above); a reviewer should read those two edits first.

The Blueprint-buyer half of the new candidate query has no real-database test (neither did the JS version of it).
The finance-os half is covered by the pg end-to-end test.

## Leftovers (not fixed, on purpose)

1. **Chris decides:** when the Reconnect screen is built. The text stays held until then. Plan: the screen is a change to `public/app/money-accounts.js` (the Accounts screen), contract in `docs/finance/bank-relink.md`, shown as a marked draft first (the page-edit law), proven in the browser and against Plaid's sandbox, and shipped together with the migration that approves the text.
2. Push the branch (or run the pg file on a scratch database). Required before merge. See "What was NOT proved".
3. `npm run journeys` and `npm run diagrams`: regenerate once, after every merge is in. I ran the generator here and it changed 9 generated files, most of it other people's drift (a new `/api/ops/notify-owner` route, one more marketing and one more read route). Mixing that into this branch would conflict with every other merge builder, so it was reverted. The new door `/api/banking/relink` will show up in `client-actual.md` when it is regenerated.
4. `npm run pulse:prove` right after ship. It must say OK and `bank-relink-error-login-not-told` must be green. If it is not, treat it as a red. (Not re-run in this round: the only change to the lane is its fix text, and it cannot say OK before 474 is applied.)
5. `src/banking/plaid-link.mjs` `completeLink` has the same stamp gap on its `ON CONFLICT ... DO UPDATE` (it sets the login `active` and leaves `reconnect_notified_at`). Not fixed on purpose: that is the live link-exchange path, and naming a column there that does not exist yet would break every bank link on any deploy that runs before 474 is applied (a preview deploy hits the same database and does not migrate). It also needs a real conflict, and a normal re-link of the same bank makes a new Plaid item, not a conflict. Fix it in the change that ships the screen, after 474 is live.
6. Nothing receives Plaid's own "login repaired" webhook. A login Plaid repaired on its own stays in error until the client taps the button. (Unchanged from round 1.)
7. While the text is held, a client whose login breaks hears nothing and has no button. That is true of every client today. The lane goes red if a paying one stays that way for 2 days.
