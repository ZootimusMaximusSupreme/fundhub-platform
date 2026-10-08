# Lane 16 — ad data breakage

Company: Fundhub. Read-only. One tripwire: Recon (AG-07). No second watchdog.

This lane does not change budgets, pause campaigns, or upload video. It does not edit HTML. It does not edit the shared pulse files.

## What this does not copy

- Slice 03 already watches the marketing clock, worker, page read, and outbox drain.
- `machine.mjs` `meta-sync` already watches a Meta save older than 36 hours.
- `machine.mjs` `dying-ad-scan` already watches a running ad that dies before 25%. That scan only sees ads that already have a metrics row.
- ClickFunnels, Meta server events, and Meet stay on the machine rows.

## Checks

`gapChecks(ctx)` in `src/pulse/coverage/gap-ads.mjs`. Each row is `{ id, status, detail, suggestedFix }`. Status is PASS, FAIL, or skip. No database means four skips.

| id | FAIL when |
|---|---|
| `ads-meta-sync-stale` | A Meta account is due and `last_synced_at` is missing or older than 3 hours (3 times the hourly pull). No due account is a skip. The 36 hour nightly row stays on machine `meta-sync`. |
| `ads-spend-day-missing` | A closed Arizona day in the 3-day window has no spend row, and an older spend row shows that day should have synced. Today can still be empty. A save older than 36 hours is a skip. A brand-new account whose first day is today does not fail the empty days before it. |
| `ads-number-unmapped` | An ad with a spend row has no Fundhub ad number (`fundhub_ad_number`). |
| `ads-running-no-metrics` | A running ad created at least 3 hours ago has no `ad_metrics_daily` row, and the Meta connection synced inside 36 hours. |

A FAIL tells Recon to keep reporting it. It does not start another watchdog. It does not change a budget, pause a campaign, or upload a video.

Closed days at 6:00 a.m. Phoenix on 2026-10-06 are 2026-10-04 and 2026-10-05. The ad account day is America/Phoenix.

## Prove

`node --test src/pulse/coverage/gap-ads.test.mjs`

Result: 18 pass, 0 fail. Four checks.
