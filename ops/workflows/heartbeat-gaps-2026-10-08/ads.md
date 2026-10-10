# Lane 16 — ad data breakage

Company: Fundhub. Read-only. One tripwire: Recon (AG-07). No second watchdog.

This lane does not change budgets, pause campaigns, or upload video. It does not edit HTML. It does not edit the shared pulse files.

## What this does not copy

- Slice 03 already watches the marketing clock, worker, page read, and outbox drain.
- `machine.mjs` `meta-sync` already watches a Meta save older than 36 hours.
- `machine.mjs` `dying-ad-scan` already watches a running ad that dies before 25%. That scan only sees ads that already have a metrics row.
- Slice 04 and the job heartbeats watch that the hourly cron ran (`meta-campaign-sync-hourly`, red after 3 hours with no run). `ads-meta-sync-stale` is different: it reads the stamp the sync writes only after Meta answered, so a cron that fires while Meta refuses the token still turns it red.
- ClickFunnels, Meta server events, and Meet stay on the machine rows.

## Checks

`gapChecks(ctx)` in `src/pulse/coverage/gap-ads.mjs`. Each row is `{ id, status, detail, suggestedFix }`. Status is PASS, FAIL, or skip. No database means four skips. Reads go through `ctx.scope` (staff). `ads`, `ad_sets`, `campaigns`, `ad_metrics_daily` and `ad_platform_connections` read as empty on the plain app role.

"Running" means the ad, its ad set, and its campaign are all `ACTIVE`. Pausing a campaign leaves its ads `ACTIVE` on the ad itself, and Meta sends no row for them.

| id | FAIL when |
|---|---|
| `ads-meta-sync-stale` | A Meta account is due and `last_synced_at` is missing or older than 3 hours (3 times the hourly pull). No due account is a skip. The 36 hour nightly row stays on machine `meta-sync`. |
| `ads-spend-day-missing` | A closed Arizona day in the 3-day window has no spend row, an older spend row shows that day should have synced, an ad is running, **and ads spent money on a day before the gap and a day after it (today counts)**. With every ad paused Meta sends no row, so an empty day is a skip. Ads switched back on this morning have no spend after the gap yet, so that is a skip too. A save older than 36 hours is a skip. |
| `ads-number-unmapped` | An ad that **spent money in the last 28 days** has no Fundhub ad number (`fundhub_ad_number` empty). Old paused test ads are not looked at. |
| `ads-running-no-metrics` | A running ad created at least **24 hours** ago has no `ad_metrics_daily` row, and the Meta connection synced inside 36 hours. (24 hours because Meta can hold a new ad in review for a day.) |

A FAIL tells Recon to keep reporting it. It does not start another watchdog. It does not change a budget, pause a campaign, or upload a video.

Closed days at 6:00 a.m. Phoenix on 2026-10-06 are 2026-10-04 and 2026-10-05. The ad account day is America/Phoenix.

## Prove

`node --test src/pulse/coverage/gap-ads.test.mjs`

Result: 32 pass, 0 fail, 0 skipped. Four checks.

## Review — Claude, 2026-10-08

**What was wrong**

- `ads-spend-day-missing` would have cried wolf. All 7 ads are PAUSED, so Meta sends no rows. 2026-10-05 has no row at all. On the morning of 2026-10-06 the old check would have said FAIL. It passed today only because one paused ad (SLO4) still gets a zero row each day.
- `ads-number-unmapped` was red forever. Three August test ads ("oVid: 1", "oVid: 2", "oVid: 3", paused drafts, last spend 2026-08-20) have no number and no way to get one from their names. The check counted them every day.
- `ads-running-no-metrics` only looked at the ad. An ad can say ACTIVE while its campaign is paused. It also gave a new ad only 3 hours, but Meta review can take a day.
- The tests only checked the code after the database answered. Nothing checked the SQL text.

**What changed**

- Spend day: needs a running ad before it can FAIL. No running ad is a skip, with the days named.
- Number: only ads that spent money in the last 28 days count.
- Running: ad, ad set, and campaign must all be ACTIVE. Grace is 24 hours.
- Tests pin the SQL (the three ACTIVE tests, the 28 day window, the 24 hour grace) and add the paused case, the one-running-ad case, and the new-ad case.

**Live proof (read-only, as `fundhub_app` inside `BEGIN READ ONLY`)**

- Prod mode: 3 PASS, 0 FAIL, 1 skip. The skip is `ads-running-no-metrics`: no ad is running. Staff mode and bare mode match. No SQL errors. No writes.
- The SQL was also run on real rows. With the window set back to 2026-08-01 the number check finds exactly the 3 August ads. With the 28 day window it finds 0 of the 4 ads that spent. For 2026-10-04 and 2026-10-05 the day query shows 4 rows and 0 rows with 0 running ads, which is the old false alarm, now a skip. With the status test relaxed the join counts 7 ads, so the joins read real data.

**Left for Chris (not a check problem)**

- The 3 August test ads still have no number and carry $647 of old spend. They no longer turn the pulse red. Set `fundhub_ad_number` on them only if that old spend matters to a report.

### Round 2 — Claude, 2026-10-08 (second checker)

**What was wrong**

- `ads-spend-day-missing` could still cry wolf on the morning after ads are switched back on. "Running" was read from the ad status right now, not from the day that was empty. A day with no rows while every ad was paused then looked like a missed sync. I proved it on real rows: with the 7 paused ads treated as ACTIVE and the clock at 6:00 a.m. Phoenix on 2026-10-06, the old check said FAIL for 2026-10-05.
- I could not use `ads.updated_at` to see when an ad went live. The sync stamps it on every run.

**What changed**

- The query now also returns `spent_days`: the days from the day before the gap to today on which any ad spent money (spend above zero).
- A missing day is a FAIL only when an ad is running **and** ads spent before the gap **and** ads spent after it. Otherwise it is a skip that says which side had no spend.
- 8 new tests: the SQL text, the relaunch morning, no spend before, no spend on either side, a missing answer, the older day empty, both days empty, and an array answer. I broke the code four ways on purpose and the tests caught each one.

**Live proof (read-only, as `fundhub_app` inside `BEGIN READ ONLY`)**

- Relaunch replay on real rows: now a skip ("No ad spent money after it"). Real `spent_days` for the window is 2026-10-03 and 2026-10-04 only.
- Real gap replay: ads treated as ACTIVE, clock on 2026-10-04, Oct 3 rows hidden. The real SQL runs and the result is FAIL for 2026-10-03.
- Live tool: prod 3 PASS, 0 FAIL, 1 skip. Staff mode and bare mode match. 0 SQL errors, 0 writes.
- Tests: `node --test src/pulse/coverage/gap-ads.test.mjs` is 32 pass, 0 fail, 0 skipped.

**Left as is**

- One narrow false alarm remains. If every ad is off for exactly one full Arizona day, and is switched back on and spends before 6:00 a.m. the next day, the check says FAIL. Data alone cannot tell that from a missed sync.
- The skip text on `ads-running-no-metrics` says "No running ad is older than 24 h" even when every ad is paused. Wrong words, harmless. Not changed (low).

