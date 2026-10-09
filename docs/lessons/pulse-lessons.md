# Pulse lessons

Every break the hourly pulse finds teaches the next build. When a break is fixed, add one entry here and fill the same four fields on its `pulse_incidents` row (`cause_category`, `cause_note`, `fix_summary`, `guard_added`). Read this file before writing a new fix guide or a new beat.

Newest at the top. One entry per break. Short lines, 4th grade English.

```
## YYYY-MM-DD — <beat id> — <cause_category>
- Cause: <one line>
- Fix: <one line, or "not code: <what Chris must do>">
- Guard added: <test file / beat step / tripwire id, or "none: <reason>">
- Incident: <pulse_incidents id>  PR: <url>
```

The cause categories are the list in `db/migrations/475_pulse_beats_incidents.sql`: code_bug, missing_route, config_or_env, migration_not_applied, schema_or_data, deploy_or_bundle, vendor_down, vendor_changed, bank_site_changed, timeout_or_capacity, pulse_false_alarm, unknown.

What keeps breaking, and is it guarded now (plain SQL, no AI):

```sql
SELECT cause_category, beat_id, count(*) AS breaks,
       count(*) FILTER (WHERE guard_added IS NOT NULL AND guard_added NOT LIKE 'none:%') AS guarded,
       round(avg(extract(epoch FROM closed_at - opened_at) / 3600)::numeric, 1) AS avg_hours_broken
FROM pulse_incidents
WHERE closed_at > now() - interval '90 days'
GROUP BY 1, 2 ORDER BY breaks DESC;
```

## Lessons carried in from before the pulse (2026-10-08)

## 2026-10-08 — pulse coverage — deploy_or_bundle
- Cause: the pulse found its check files with a folder scan. The live bundle carries no folder, so 0 of 70 check files ran and nothing said so.
- Fix: every file is a literal import (`src/pulse/coverage/modules.mjs`, `src/pulse/beats/index.mjs`) and a test fails when disk and list differ.
- Guard added: `src/pulse/coverage/modules.test.mjs`, `src/pulse/beats/beats.test.mjs`, `npm run pulse:prove` builds the real bundle.

## 2026-10-08 — daily pulse — timeout_or_capacity
- Cause: all checks ran in one Inngest step (61 s). Netlify cuts a step at 26 s, so no morning text would have gone out.
- Fix: one step per lane, a fallback text if the pulse or the brief dies.
- Guard added: `npm run pulse:prove` fails any step over 20 s; `src/workflows/daily-pulse.test.mjs`.

## 2026-10-08 — pulse checks — deploy_or_bundle
- Cause: checks that read repo files at run time passed on the laptop and went red on the server.
- Fix: no repo files read at run time; use the route map, the database or the live site.
- Guard added: `npm run pulse:prove` runs from the built bundle.

## 2026-10-08 — heartbeat — code_bug
- Cause: the 5-minute alarm read the database before it texted, and the 6 a.m. pulse threw on a dead database. When the database dies the heartbeat went quiet.
- Fix: a dead database is one red row; the alarm texts at most twice an hour without a database; the job sends a plain text if the brief or the pulse dies.
- Guard added: `src/pulse/instant-watch.test.mjs`, `src/pulse/daily-pulse.test.mjs`, `src/workflows/daily-pulse.test.mjs`, `outside:*` lane.
