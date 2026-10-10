# Finish left, 2026-10-09 — T3 manifest

Branch: `fix/T3-2026-10-09` (cut from main at `e58704577`).
Three red tests. Each one went red when a feature landed and nobody ran the test. None of them was a broken product. One touched a live file (one line, same behavior).

## In plain words

- Test 1 (fence): two pulse files were never put on the fence list. Both only read our own pages. They are now listed, with the reason.
- Test 2 (daily pulse): the test said "5 staff reads". The pulse now makes 27, on purpose, because lanes were added. The code is right. The test counted the wrong thing. It now checks the thing the number stood for.
- Test 3 (org scope): the morning-brief read door is scoped to the caller's company. It was never added to the test's list. Now it is, and a new test proves the scoping.

## 1. `src/lib/no-unfenced-transmit.test.mjs` — "nothing reaches the network except through the fence"

**Wrong:** `src/pulse/funnel-doors.mjs` and `src/pulse/instant-watch.mjs` can reach the network and were on neither the fence route nor `ALLOWED_RAW_FETCH`.

**Root cause:** both landed 2026-10-07 in `f5bf6534b` ("Watch both live sites in pulse") and that commit did not touch this test. Neither name appears anywhere in this test's history (`git log -S`).

**What I read, and what is true:**
- `funnel-doors.mjs`: one call, `fetchImpl(url, { headers })`. No method, no body, so it is a GET. Target is `apply.fundhub.ai/roadmap`. Nothing is sent.
- `instant-watch.mjs`: never calls fetch itself. It defaults `fetchImpl = globalThis.fetch` and hands it to (a) the door checks in `daily-pulse.mjs` and `funnel-doors.mjs`, all GET, and (b) the Twilio provider for the one alert text to the owner's own number. That provider sends through `postJsonTo()` with `fence: MESSAGING` (`src/messaging/providers/http.mjs`). `transmit()` checks the fence BEFORE it picks `fetchImpl || globalThis.fetch` (`src/lib/outbound-fetch.mjs` lines 237-240), so an injected fetch does not get around the fence.

**Fix:** two `ALLOWED_RAW_FETCH` entries with those reasons. No code change. The "no entry is stale" test still passes (both files still match a network token).

## 2. `scripts/daily-pulse.test.mjs` — "--db hands the pulse a db and a staff scope, sends nothing, and always closes"

**Wrong:** the test pinned `["staff" x 5, "close"]`. The pulse now makes 27 staff-scoped reads.

**Root cause (the code is right, the count is stale):** each lane below added staff-scoped reads on purpose. Traced with a stack-recording fake `staffScope`:

| Reads | Where | Added in |
|---|---|---|
| 5 machine rows (`meta-sync`, `clickfunnels-night-job`, `meta-server-events`, `dying-ad-scan`, `meet-transcript-sweeper`) | `src/pulse/machine.mjs` | 4 in `33d7840c3`, 5th in `48b47054e` (2026-10-07) |
| marketing heartbeat read | `src/pulse/coverage/slice-03-marketing.mjs` | `8cf8518a1` (2026-10-07); test bumped to 5 in `fa3de5618` |
| ads x4, banks x4, marketing queue, pixels x2, social x5 | `gap-ads/banks/marketing-queue/pixels/social.mjs` | `f2f0e2171` (2026-10-08) |
| handoff, leads x2 | `gap-handoff.mjs`, `gap-leads.mjs` | `803b2fe59` (2026-10-09) |
| run recorder, lane N/A verify | `src/pulse/self-audit.mjs` | `5bc27733e` (2026-10-09) |

The 5th machine row on 2026-10-07 already made the true count 6, so the test has been red since then.

**Why I did not just write 27:** the heartbeat law adds a lane (and a staff read) with every build. A pinned number goes red on every build and proves nothing. It was bumped by hand twice already.

**What the number stood for:** the marketing-machine tables are FORCE row security and read empty on the plain app connection, so each machine and marketing read must go through the staff scope and none through the plain db. The test now records which connection ran each statement and asserts that for all 8 exported SQL constants (`META_SYNC_SQL`, `CF_NIGHT_SQL`, `CAPI_SQL`, `DYING_SCAN_SQL`, `RUNNING_ADS_SQL`, `MEET_SYNC_SQL`, `BEATS_SQL`, `MACHINE_ORG_COUNT_SQL`). It also asserts close ran exactly once and last, with only staff scopes before it. The old assertions on `dryRun`, `sends`, `sms.reason` and `meta-sync` are unchanged.

**Is the new test stricter in the way that matters?** Yes. Mutation proof: I pointed `checkMachine` at `scope: null` in `src/pulse/daily-pulse.mjs`. The new test went red with "META_SYNC_SQL never ran through the staff scope". Mutation reverted (`git checkout`), file clean.

## 3. `src/http/read-endpoints-org-scope.test.mjs` — "every read endpoint scopes to the caller's company"

**Wrong (per the test):** `api/read/morning-brief.mjs` has no `org_id = $N` SQL and is not on `NO_ORG_COLUMN`.

**Is the endpoint really unscoped? No.** I read the handler and the store:
- the handler takes `staff.org_id` from `requireAuth`, 403s if it is not a UUID, and never reads an org from the query string;
- it calls `readMorningBrief()` (`src/ops/morning-brief.mjs:609`), which throws without an org and runs `... FROM morning_briefs WHERE org_id = $1 AND brief_date = $2::date AND kind = $3`.

**Root cause:** the handler landed 2026-10-07 in `d34300968` with its own test, but that commit did not touch this lint.

**Fix (three small changes, no behavior change):**
1. `NO_ORG_COLUMN` gets a `morning-brief.mjs` entry with the reason, the same way its 30 neighbours are written.
2. `api/read/morning-brief.mjs` line 51: `{ orgId, date, kind }` becomes `{ orgId: staff.org_id, date, kind }`. Same value (`const orgId = staff.org_id` three lines up). Reason: the lint's second test requires the literal `orgId: staff.org_id` at the call site of every excused endpoint, and `api/read/ops-pulse.mjs` already writes it this way. I chose this over loosening the detector so the lint stays strict on all 30 other endpoints.
3. Two new tests in `src/http/morning-brief.test.mjs` that prove the claim by running the handler with a SQL-recording stub: (a) with a different org id in the query string, the SQL binds `org_id = $1` and param 0 is the SESSION org, and the other id never reaches the query; (b) a session with no org gets 403 and runs no query.

**Mutation proof:** I changed the call to `orgId: req.query.org_id || staff.org_id`. Three tests went red (the new proof test, the "still passes the session's org" lint, and "no read endpoint takes the company from the query string"). Reverted; the diff is the one line above.

## Proof (all run in this worktree, base = main `e58704577`)

Before: all three red (confirmed first thing).

After:
- `node --test src/lib/no-unfenced-transmit.test.mjs scripts/daily-pulse.test.mjs src/http/read-endpoints-org-scope.test.mjs src/http/morning-brief.test.mjs src/http/routes.test.mjs src/http/auth-gate.test.mjs` → 36 tests, 36 pass, 0 fail, 0 skipped.
- Neighbours: `src/pulse/*.test.mjs`, `src/pulse/coverage/*`, `src/pulse/beats/*`, `src/ops/morning-brief*`, `src/workflows/daily-pulse*`, `src/workflows/evening-brief*`, `scripts/daily-pulse.test.mjs` → 2663 tests, 2607 pass, 1 fail, 55 skipped. The 1 fail is leftover B below and is not caused by this change. The 55 skips are `.pg.test.mjs` files with no `DATABASE_URL` (not run here; none touch these files).
- `npm run lint` → 3217 files parse clean.

## Leftovers (not fixed; not mine)

A. **`scripts/daily-pulse.mjs` `staffScope` is not safe under overlap (Mac `--db` run only).** A probe with a fake db that yields a tick showed 27 staff scopes with up to 4 open at once. The CLI's `staffScope` does `set_config('fundhub.actor','staff',true)` before and `set_config(...,'',true)` after, on ONE connection. When two overlap, the first to finish clears the actor while the other is still reading, so a FORCE-RLS table could read empty and the row would show red or skip for a false reason. Production is not affected (`asStaff` opens its own transaction per call). I did not prove a wrong read on a real Postgres; this is read from the code plus the overlap count. Fix would be a depth counter, or run lanes one at a time in the CLI.

B. **`src/pulse/registry.test.mjs` "every registry row names a real handler or desk file" fails on any fresh checkout.** The registry names `/leads/c01cb7592c8bb994130158e897e99bf1/`, whose file is `public/leads/c01cb7592c8bb994130158e897e99bf1/index.html`. `public/leads/` is excluded by the local `.git/info/exclude` (line 9), so the file exists only in the main checkout. A clean clone or CI does not have it. Not caused by this change.

C. **`npx tsc --noEmit` has 1 error:** `src/marketing/filmed-receive.mjs(159,75)` TS2345 (`(value: any) => void` not assignable to `() => void`). Not touched here.

D. All three tests above were red for 2 days with nothing stopping the commits that broke them (`f5bf6534b`, `d34300968`, `48b47054e`). That is a note about the commit path, not a defect in these files.

## Change manifest

| File | Change |
|---|---|
| `src/lib/no-unfenced-transmit.test.mjs` | + 2 `ALLOWED_RAW_FETCH` entries (funnel-doors, instant-watch) |
| `scripts/daily-pulse.test.mjs` | pinned count replaced with per-statement connection check + close-once-and-last |
| `src/http/read-endpoints-org-scope.test.mjs` | + `NO_ORG_COLUMN` entry for `morning-brief.mjs` |
| `api/read/morning-brief.mjs` | 1 line: `orgId` becomes `orgId: staff.org_id` (same value) |
| `src/http/morning-brief.test.mjs` | + 2 tests proving org binding and the no-org 403 |

Routes affected: none (no routes added or removed). Journeys affected: none, so no `-actual.md` change. Heartbeat: no new live page, job or send path. Nothing shipped, pushed or deployed.
