# Banks not on the screen

Lane 7 of 20. This lane owns only banks that are saved but do not show.

Company: Fundhub.

## Checks

Each row is `{ id, status, detail, suggestedFix }`. Status is `PASS`, `FAIL`, or `skip`.

| Id | Fail means |
|---|---|
| `banks-plaid-item-error` | A bank login is in error, so the money screen cannot refresh that bank. |
| `banks-linked-not-on-screen` | An open linked account is in the database, but the money screen read would not return it. The client or company on the account does not match the login. |
| `banks-sync-stale` | A live login exists and the bank sync is late. The job runs every day. It is late after 3 days. A failed last pass counts too. |
| `banks-active-link-no-accounts` | A client has a live bank login and zero accounts under it, so the money screen shows no bank for that login. |

Closed accounts are left off the money screen on purpose. That is not a fail here.

A quiet sync with no live login is a skip. No database is a skip.

## Not this lane

Slice 07 already lists the Finance OS jobs. Slice 08 already lists the bank sync doors and whether the sweeper is on the machine list. This lane does not repeat those lists.

## Rules for the read

- Read-only SQL. No insert, update, or delete.
- Do not call Plaid.
- Do not exchange tokens. The access token column is never selected.
- Recon (AG-07) is the one tripwire. Do not add another watcher.
- Do not edit HTML.

## Files

- `src/pulse/coverage/gap-banks.mjs` — `gapChecks(ctx)`
- `src/pulse/coverage/gap-banks.test.mjs` — fake database, `node:test`
