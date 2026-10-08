# Banks not on the screen

Lane 7 of 20. This lane owns only banks that are saved but do not show.

Company: Fundhub.

## Checks

Each row is `{ id, status, detail, suggestedFix }`. Status is `PASS`, `FAIL`, or `skip`.

| Id | Fail means |
|---|---|
| `banks-plaid-item-error` | A bank login is in error, so the money screen cannot refresh that bank. |
| `banks-linked-not-on-screen` | An open linked account is in the database, but the money screen read would not return it. The client or company on the account does not match the login. |
| `banks-sync-stale` | A live bank login has not synced in 3 days. Read per login (the older of its transactions read and its balance read), not from the job receipt. |
| `banks-active-link-no-accounts` | A live bank login has no account row under it, or a client with a live login has no open account anywhere. The money screen drops closed accounts, so that client sees no bank. A client who re-linked (old login all closed, new login open) is fine. |

Closed accounts are left off the money screen on purpose. That is not a fail here.

No live login is a skip for the sync check. No database is a skip.

## Not this lane

Slice 07 already lists the Finance OS jobs. Slice 08 already lists the bank sync doors and the `plaid-transactions-sweeper` job. That job is also read by `job:plaid-transactions-sweeper` in `src/pulse/heartbeats.mjs` (red after 3 times its daily schedule), and by the slice 08 sweeper row through the generic cron read in `run-slices.mjs`. This lane does not read the job receipt a third time.

## Rules for the read

- Read-only SQL. No insert, update, or delete.
- Do not call Plaid.
- Do not exchange tokens. The access token column is never selected.
- Recon (AG-07) is the one tripwire. Do not add another watcher.
- Do not edit HTML.

## Files

- `src/pulse/coverage/gap-banks.mjs` — `gapChecks(ctx)`
- `src/pulse/coverage/gap-banks.test.mjs` — fake database, `node:test`

## Review — Claude, 2026-10-08

What was wrong:
- `banks-sync-stale` read the `plaid-transactions-sweeper` receipt in `job_heartbeats`. Two watchers already read that exact receipt with the exact same 3 day rule (`job:plaid-transactions-sweeper` and the slice 08 row). The board said slice 08 only checked "whether the sweeper is on the machine list". That was wrong. It was a duplicate, and it could only add noise.
- The sweeper never throws for the whole pass, and it skips quietly when Plaid is not set up. So its receipt can say "ok" while a login has not synced for days. Nobody was watching that.
- `banks-active-link-no-accounts` counted closed accounts as accounts. A login whose accounts were all closed has rows, but the money screen drops closed rows, so that client sees no bank. It missed that.

What changed:
- `banks-sync-stale` now reads each live login: the older of its `transactions_synced_at` and its newest open `balance_as_of` (falls back to the date it was linked). Red when that is older than 3 days. Mock logins are left out, the same way the refresh leaves them out. No more `job_heartbeats` read.
- `banks-active-link-no-accounts` also fails a client who has a live login and not one open account anywhere. A client who re-linked is not counted. Chris's own sandbox client looks exactly like that in production (two old logins fully closed, one new login with 4 open accounts), and it passes.
- The 4 old stale tests were about the job receipt. They were replaced by 5 tests of the per-login read (late, edge of the 3 day cut, error code named, no live login, never read since linked). Two assertions inside two other tests changed from the receipt to the per-login read. 4 new tests were added for the closed-accounts case. The file went from 12 tests to 17. Nothing was skipped.

Live result after (read only, production): prod 4 PASS / 0 FAIL / 0 skip. Run the same lane from a bundle with no source tree beside it: 4 PASS (no file reads here, so the bundle was never a risk).

Proof the new stale read can fail: the same SQL with the cut moved one day into the future returns 3 of 3 live logins stale. With the real cut it returns 0.

Tests: `node --test src/pulse/coverage/gap-banks.test.mjs` runs 17 tests, 17 pass, 0 fail.
