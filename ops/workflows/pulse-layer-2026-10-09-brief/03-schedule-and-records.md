# Brief 03 — The clock and the records (2026-10-09)

Area: the hourly clock, the two new tables, and how a new migration shows up in `/api/health`. Read-only grounding. Nothing in the repo was changed except this file. The DDL below was NOT run: this Mac has no Postgres (memory `ship-traps-2026-10-05.md` trap 3), and the one SQL tool is read-only. Check it in CI or a scratch database before it ships.

## In plain words

The hourly clock is easy. The repo already has seven timed jobs on Netlify. We copy the shape of the newest one (`marketing-clock`). Adding `pulse-hourly` touches five places, and four tests will fail until all five are done. That is good: the tests are the checklist.

The clock gets 30 seconds. After that Netlify kills it. So the runner must stop itself at about 20 seconds and still save what it has.

The records are two small tables. They follow the same recipe as `job_heartbeats` and `marketing_heartbeats`. Two things in the board are not what the repo does today:

1. The board says "staff only, same as `job_heartbeats`". `job_heartbeats` is not staff only. Its row rule says "everyone" (`USING (true)`). The real lock is the grant list.
2. On live, the older pulse tables are open to the public web keys (`anon`). The newer `marketing_*` tables close that door with a REVOKE. The new tables must copy the newer recipe. Details in section 2.5.

Number 474 is taken by another unmerged branch. Use 475.

---

## 1. The clock (Netlify scheduled function)

### 1.1 How the two existing sweepers are built

| Fact | Evidence |
|---|---|
| Schedule lives in `netlify.toml` as `[functions."<name>"]` then `schedule = "<cron>"` on the very next line. No `schedule()` wrapper, because that is a new dependency. | `netlify.toml:162-206` (comment at 162-165, blocks at 169-206) |
| Each function file also exports `SWEEP_CRON` with the same string, and a test checks they agree. | `netlify/functions/commas-inbox-sweeper.mjs:54`, `netlify/functions/marketing-clock.mjs:24`, `src/marketing/clock.test.mjs` |
| `marketing-clock` is the cleanest pattern: `export default async function`, try/catch, always returns a 200 `Response`, writes the heartbeat on both the ok and the error path. | `netlify/functions/marketing-clock.mjs:30-41` |
| `commas-inbox-sweeper` has `export async function handler` AND `export default handler`. It works today, but its own comment says Netlify's parser does not count the function form as a handler export. Do not copy this shape. Use default export only. | `netlify/functions/commas-inbox-sweeper.mjs:98-127`; trap 2 in `ship-traps-2026-10-05.md` |
| The heartbeat is one line: `await noteScheduledRun(db, "<name>", result)`. It never throws. | `netlify/functions/commas-inbox-sweeper.mjs:120`, `src/pulse/heartbeats.mjs:154` |
| `noteScheduledRun` writes outcome `error` only when `result.ok === false`. It takes the item count from the first of `count, claimed, processed, sent, ran, merged, posted` that is a whole number. | `src/pulse/heartbeats.mjs:154-175` |
| Time limits: normal functions 26 s, scheduled functions 30 s, background functions 15 min. | `docs/specs/marketing-machine-2026-10-04.md:370`; `netlify/functions/marketing-clock.mjs:4`; `src/lib/no-unfenced-transmit.test.mjs:73-74` ("scheduled function (30 s)") |
| CONTRADICTION: `netlify.toml:188` says "A scheduled function gets 15 minutes." Four other places say 30 s, and the ad-video worker had to move to a background function because 30 s killed it. Treat 30 s as true. The toml comment is wrong. Not fixed here. | `netlify.toml:188` vs the cites above |
| `[functions]` sets `node_bundler = "esbuild"`, but memory says Netlify packs default-export functions with nft. Both are on record. Do not guess: prove the zip (trap 6 method) before ship. | `netlify.toml:99`; `ship-traps-2026-10-05.md` trap 1 |
| Global `included_files` already carries `vendor/underwriteiq-full/**` and excludes `credentials/**` and `*.mp4`. A new function inherits it. | `netlify.toml:100-155` |

### 1.2 What adding `netlify/functions/pulse-hourly.mjs` (cron `0 * * * *`) needs

All five, in the same change. Each is pinned by a test.

1. **The function file.** `export default async function pulseHourly()` only. No `export const handler`, no `export async function handler`. Export `SWEEP_CRON = "0 * * * *"`. Always return `new Response(JSON.stringify(result), { status: 200, headers: { "content-type": "application/json" } })`. Contain the exact text `noteScheduledRun(db, "pulse-hourly"` (the test greps the source for it: `src/pulse/heartbeats.test.mjs:66`).
2. **`netlify.toml`.** Add
   ```
   [functions."pulse-hourly"]
     schedule = "0 * * * *"
   ```
   The `schedule` line must be the line right after the header. A comment between them breaks the regex at `src/http/scheduled-functions-return.test.mjs:36`.
3. **`src/pulse/heartbeats.mjs` `NETLIFY_JOBS`** (lines 52-60): add `["pulse-hourly", "0 * * * *"]`. Three tests need it: `src/pulse/heartbeats.test.mjs:55-70` (list must equal the toml, no extra, none missing), `src/pulse/coverage/gap-jobs.mjs:163-181` (a job that writes a heartbeat but is not listed turns the 6 a.m. pulse red: `job-heartbeats-unlisted`), and `src/pulse/registry.test.mjs:182` (a send path's `watch:` must be a registry key or a JOBS id).
4. **`src/http/scheduled-functions-return.test.mjs:44-57`**: the sorted list of scheduled functions is a literal. Add `"pulse-hourly"` in sorted position (between `marketing-clock` and `social-publish-sweeper`). That test also calls the default export in a child process with NO env (only PATH, HOME, NODE_ENV) at line 94 and requires a `Response` with status 200 (line 104). So with no `DATABASE_URL`, no `PULSE_SECRET`, no `URL`: the runner must return 200 and must make no network call and must not throw at import time.
5. **Heartbeat rule.** `.claude/rules/heartbeat-on-every-build.md` says a new job needs its row in `src/pulse/registry.mjs`. For a scheduled function, the row is the `NETLIFY_JOBS` entry in item 3; `SEND_PATHS` and the registry only cover api handlers, desks and pages. The job goes red if it has not run in 3 x 1 hour (`src/pulse/heartbeats.mjs:67`, `cronIntervalMs("0 * * * *")` = 1 hour at line 92).

### 1.3 Other tests that will bite, depending on what the runner imports

| If the runner or its helpers... | Then | Evidence |
|---|---|---|
| call `fetch(`, `fetchImpl(`, `ctx.fetch` or similar in `src/` or `netlify/` | `src/lib/no-unfenced-transmit.test.mjs` fails until the file is routed through `src/lib/outbound-fetch.mjs` or named in `ALLOWED_RAW_FETCH` with a written reason. Precedent for "POST to our own deploy": `src/marketing/wake.mjs`, `netlify/functions/ad-video-sweeper.mjs` (lines 67-100 of that test). The stale-entry test also fails if an entry no longer calls the network. | `src/lib/no-unfenced-transmit.test.mjs:30-67, 345-366` |
| import `send` from `messaging/providers/{twilio,twilio-whatsapp,resend,mailgun,mail-letter,web-push,ntfy}.mjs` in `src/`, `api/` or `netlify/` | The file must be added to `SEND_PATHS` with `watch: "pulse-hourly"` (valid once item 3 is done) or a 40+ character reason. Cheaper: reuse `textChris`-style code in `src/pulse/notify.mjs`, which is already listed (`src/pulse/registry.mjs:62`). | `src/pulse/registry.test.mjs:151-217`; `src/pulse/registry.mjs:56-71` |
| reach any file that loads `@pdf-lib/fontkit` (for example `src/register-all.mjs` via the letter generator, which a beat that runs real handlers in-process would reach) | The function file must contain a line `import "@pdf-lib/fontkit";`. | `src/payments/sweeper-fontkit-in-zip.test.mjs:32, 76-87`; `netlify/functions/commas-inbox-sweeper.mjs:29-35` |
| build a path from `process.cwd()` that touches `credentials/` | Breaks the nft build (22 GB). Never. | `ship-traps-2026-10-05.md` trap 1 |
| list beats with `readdirSync` + `import()` | Ships empty. Use the literal import list the board already names. | `ship-traps-2026-10-05.md` trap 4 |
| read a repo file at run time (for example `fixGuide` text from a `.md`) | ENOENT on the server. Keep guides as strings inside the beat modules. | `ship-traps-2026-10-05.md` trap 6 |
| add env vars | Fine for a default-export function. The 4 KB env limit only breaks Lambda-style functions (named handler export). Site env is about 110 vars. | `ship-traps-2026-10-05.md` trap 2 |

### 1.4 Design facts the runner author needs

- **What `ok` means in the result.** The 6 a.m. check reads the newest `job_heartbeats` row for each job. If its outcome is `error`, the morning pulse shows that job FAIL (`src/pulse/heartbeats.mjs:248-255`). If the runner returns `ok:false` whenever a beat is red, every broken beat will also turn `job:pulse-hourly` red every morning, a second alarm for the same break. Recommend: `ok` means "the runner itself ran to the end and saved its results". Put the beat outcome in other keys, for example `{ ok: true, ran: 18, failed: 1 }`. `ran` is one of the item-count keys. Set `ok:false` only when the runner crashed, ran out of time with beats unrecorded, or could not write.
- **30 second wall.** Race the whole run against a budget of about 20 s (`Promise.race`), record unfinished beats as `ok=false, step='timeout'`, then write. The pg pool defaults are 5 s connect and 15 s per statement (`src/db.mjs:49-52`), so a hung database alone can eat the budget.
- **Write the records on a separate connection from the rolled-back one.** The board's pulse switch wraps each door in a transaction that is always rolled back. `pulse_beats` and `pulse_incidents` inserts must NOT be inside it or they roll back too. `src/db.mjs:76-77` is a shared pool: `db.query` may land on a different connection each call, so BEGIN or `set_config(..., true)` on it does not hold. Plain one-statement `db.query` for the records is correct and needs no staff scope (the policies are permissive, see 2.4). The always-rolled-back work needs `pool().connect()` and one client.
- **Fast writes.** One multi-row insert for all beats (`INSERT ... SELECT ... FROM unnest(...)`), one select of open incidents, then per-incident work only for changes. About 3 round trips, near 0.3 s at 0.1 s each. Add the heartbeat insert as a 4th.
- **Duplicate runs.** Netlify re-runs a scheduled function that returns a bad value (measured 2026-09-18: 30 runs in 10 minutes instead of 10, `src/http/scheduled-functions-return.test.mjs:5-14`). The partial unique index in 2.3 makes the open-incident insert safe (`ON CONFLICT (org_id, beat_id) WHERE closed_at IS NULL DO NOTHING RETURNING id`: only the winner opens the GitHub issue and sends the first text). For the hourly repeat text, claim before sending: `UPDATE pulse_incidents SET last_alert_at = now(), alerts_sent = alerts_sent + 1 WHERE id = $1 AND (last_alert_at IS NULL OR last_alert_at < now() - interval '50 minutes') RETURNING id`, and send only if a row came back. A failed text then leaves a counted-but-unsent alert; accept that, or undo the claim on a provider error.
- **First run.** Netlify scheduled functions run only on a published production deploy. The first run is the next top of the hour after `npm run ship` finishes. Until then `checkJobHeartbeats` says "no run recorded yet ... too soon" (skip, not fail) for up to 3 hours (`src/pulse/heartbeats.mjs:234-235`).
- **Top of the hour is busy.** Three Inngest jobs already fire at `0 * * * *` (`blueprint-closer-ready-sweeper`, `paid-checkout-expiry-sweeper`, `waypoint-nudge-sweeper`: `src/pulse/heartbeats.mjs:18, 42, 49`). Chris asked for hourly, not for minute 0. An offset such as `7 * * * *` is allowed by every test above (the cron regex only needs a number in the minute field: `cronIntervalMs` returns 1 hour for any single minute value, `heartbeats.mjs:92`). Decision for the contract author; not mine.
- **No HTTP door.** The sweeper comment says a scheduled function cannot be triggered from outside (`commas-inbox-sweeper.mjs:98-100`). A "send a test text now" path has to be a script or a local call, not a URL.

---

## 2. The records

### 2.1 Conventions a new table must follow (measured from 430, 415, 409, 470, 472, 104)

1. **File name and number.** `db/migrations/<NNN>_<snake_case_topic>.sql`. The runner walks `schema/`, `migrations/`, `seed/` in that order, each sorted as plain text (`db/migrate.mjs:163-173`). Each file runs in one transaction and is recorded as `migrations/<file>` in `schema_migrations` (`db/migrate.mjs:191-230`). Gaps (459, 460, 462, 469) and duplicate numbers (431, 433) exist and work, because the key is the whole file name.
2. **Next free number: 475, not 474.**
   - Live max applied under `migrations/` is 473 (applied 2026-10-07 17:03Z); `to_regclass('public.pulse_beats')` and `pulse_incidents` are both NULL (read 2026-10-09).
   - `db/migrations/` on `main` ends at 473.
   - BUT an unmerged branch `worktree-agent-ab01924b6953606d2` (commit `a42edf50`, "FinanceOS F2: a client can fix a broken bank login") holds `474_bank_reconnect_notice.sql`. A duplicate number would still apply, but it is a trap. Re-check before writing: `ls db/migrations` plus `git for-each-ref` scan, then take the next free number.
3. **Idempotent DDL.** `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, policy and trigger creation wrapped in `DO $$ ... IF NOT EXISTS (SELECT 1 FROM pg_policies ...)`. Editing an applied file is a silent no-op (CLAUDE.md section 12), so fix mistakes with a new file.
4. **Schema-qualified names** (`public.<table>`) in the newer files (415, 470, 472). 430 mixes both. Use `public.`.
5. **Constraints in the database, named.** Every CHECK is named `<table>_<what>_ck`. Closed sets are CHECK lists, not app code ("constraints, enums and guards live in the database", CLAUDE.md 3a).
6. **`org_id uuid NOT NULL REFERENCES orgs(id)`** on company-owned rows (430, 431, 470, 472). 415 adds `ON DELETE CASCADE` because a beat "is a status light, not a record" (`415:23-27`). Use cascade for `pulse_beats` (status light), plain for `pulse_incidents` (record).
7. **Row security, always both lines, then a policy.**
   ```
   ALTER TABLE public.<t> ENABLE ROW LEVEL SECURITY;
   ALTER TABLE public.<t> FORCE ROW LEVEL SECURITY;
   DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='<t>' AND policyname='<t>_app_all')
     THEN CREATE POLICY <t>_app_all ON public.<t> USING (true) WITH CHECK (true); END IF; END $$;
   ```
   Evidence: `430:73-96`, `415:52-67`, `470:183-210`. A table with row security on and no policy is locked shut for the app: `src/security/rls-shape.test.mjs` (catalog half) and migration 109/154/201 exist for exactly this.
8. **Grants inside a `pg_roles` guard.** `DO $$ IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='fundhub_app') THEN ... END IF; END $$`. The guard is there because CI builds a plain Postgres (`430:100-108`, `470:229-235`). Default privileges from `104_app_role.sql` hand `fundhub_app` insert, select, update, delete on every new table, so the file REVOKEs what the table must not allow (`430:99-107`). Live default ACL for the creating role also lists `fundhub_app=arwd` (read from `pg_default_acl` 2026-10-09).
9. **Close the public web keys.** Since 409, new tables add the block that does `REVOKE ALL ON public.<t> FROM anon, authenticated`, guarded by `pg_roles` (`409_marketing_jobs.sql:104-115`, `415:80-90`). 430 (and 431, 470, 472) do not have it. See 2.5.
10. **`COMMENT ON TABLE`** one sentence: what a row is, who writes it, who reads it (`430:110-113`, `415:49`). Add `COMMENT ON COLUMN` for any column whose NULL means something.
11. **`updated_at` + trigger** only when rows are edited and the table wants it: `set_updated_at()` guarded by `pg_proc` and `pg_trigger` checks (`470:212-226`). Not needed here (incidents carry `last_alert_at` and `closed_at`).
12. **No `CREATE INDEX CONCURRENTLY`, no statement that cannot run inside a transaction.** `npm run ship` applies each file as one multi-statement request that it proved is one transaction (`scripts/ship.mjs:304-317`), and `db/migrate.mjs` wraps each file in BEGIN/COMMIT.
13. **After the file exists:** run `npm run migrations:manifest` and commit `db/expected-migrations.mjs`. See section 3.

### 2.2 What the older tables really look like on live (read 2026-10-09)

| Table | Row security | Policy | App grants (checked with `has_table_privilege`) |
|---|---|---|---|
| `job_heartbeats` | on, forced | `job_heartbeats_app_all`, `USING (true)`, role `{public}` | select, insert only |
| `pulse_scorecards` | on, forced | `pulse_scorecards_app_all`, `USING (true)` | select, insert, update; no delete |
| `morning_briefs` | on, forced | `morning_briefs_app_all`, `USING (true)` | select, insert, update, delete |
| `marketing_heartbeats` | on, forced (415) | `..._app_all` | all four; **anon and authenticated have no access** |

`job_heartbeats` has 10,159 rows and nothing deletes them. `orgs` has 2 rows; the default one (`is_default`) is `fb789b0b-8d8d-4cdc-8a24-ee6b6659e0b6`, found the same way the morning pulse finds it (`src/pulse/daily-pulse.mjs:323`).

### 2.3 Draft DDL — `db/migrations/475_pulse_beats_incidents.sql`

Not executed (no Postgres here). Reviewed by eye against 430, 415, 470 and the conventions above.

```sql
-- 475_pulse_beats_incidents.sql — the hourly pulse keeps its own record.
--
-- Board: ops/workflows/pulse-layer-2026-10-09.md. Runner: netlify/functions/pulse-hourly.mjs.
--
--   pulse_beats       one row per beat per hourly run. ok or not, where it stopped, how long.
--                     Written once, never changed. Written OUTSIDE the transaction the pulse
--                     door rolls back, or the record would roll back with the signal.
--   pulse_incidents   one row per break. At most one OPEN row per beat (partial unique index).
--                     Counts the texts sent, points at the GitHub issue and the Claude session,
--                     and, once closed, records the cause and the guard that now prevents it.
--
-- 430 made job_heartbeats and pulse_scorecards; 415 is the model for the public-key REVOKE.
-- The row policy is permissive (USING true) like those tables; the grants and the REVOKE are the gate.

CREATE TABLE IF NOT EXISTS public.pulse_beats (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid        NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  run_id       uuid        NOT NULL,
  beat_id      text        NOT NULL
    CONSTRAINT pulse_beats_beat_id_ck CHECK (beat_id ~ '^[a-z0-9][a-z0-9:._/-]{0,79}$'),
  ran_at       timestamptz NOT NULL DEFAULT now(),
  ok           boolean     NOT NULL,
  -- Where it stopped. NULL on a green beat.
  step         text
    CONSTRAINT pulse_beats_step_ck CHECK (step IS NULL OR char_length(step) BETWEEN 1 AND 120),
  detail       text
    CONSTRAINT pulse_beats_detail_ck CHECK (detail IS NULL OR char_length(detail) <= 2000),
  -- NULL = not measured (a beat killed by the time budget). Never defaulted to 0.
  duration_ms  integer
    CONSTRAINT pulse_beats_duration_ck CHECK (duration_ms IS NULL OR duration_ms >= 0),
  -- A red beat always says where and why.
  CONSTRAINT pulse_beats_red_says_where_ck CHECK (ok OR (step IS NOT NULL AND detail IS NOT NULL)),
  -- A retried invocation of the same run cannot double-insert a beat.
  CONSTRAINT pulse_beats_one_per_run UNIQUE (run_id, beat_id)
);

CREATE INDEX IF NOT EXISTS pulse_beats_beat_ran_idx ON public.pulse_beats (org_id, beat_id, ran_at DESC);
CREATE INDEX IF NOT EXISTS pulse_beats_ran_at_idx   ON public.pulse_beats (ran_at);

CREATE TABLE IF NOT EXISTS public.pulse_incidents (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               uuid        NOT NULL REFERENCES orgs(id),
  beat_id              text        NOT NULL
    CONSTRAINT pulse_incidents_beat_id_ck CHECK (beat_id ~ '^[a-z0-9][a-z0-9:._/-]{0,79}$'),
  opened_at            timestamptz NOT NULL DEFAULT now(),
  -- NULL until the first text actually went out, so a failed text is retried next hour.
  last_alert_at        timestamptz,
  -- Texts about the break while it was open. The "fixed" text is not counted.
  alerts_sent          integer     NOT NULL DEFAULT 0
    CONSTRAINT pulse_incidents_alerts_ck CHECK (alerts_sent >= 0),
  closed_at            timestamptz,
  first_detail         text        NOT NULL
    CONSTRAINT pulse_incidents_first_detail_ck CHECK (char_length(first_detail) BETWEEN 1 AND 2000),
  github_issue_number  integer
    CONSTRAINT pulse_incidents_issue_number_ck CHECK (github_issue_number IS NULL OR github_issue_number > 0),
  github_issue_url     text
    CONSTRAINT pulse_incidents_issue_url_ck CHECK (github_issue_url IS NULL OR
      github_issue_url ~ '^https://github\.com/[A-Za-z0-9._-]+/[A-Za-z0-9._-]+/issues/[0-9]+$'),
  claude_session_url   text
    CONSTRAINT pulse_incidents_session_url_ck CHECK (claude_session_url IS NULL OR
      (char_length(claude_session_url) <= 500 AND claude_session_url ~ '^https://[^[:space:]]+$')),

  -- LEARNING. Filled by the fixer or by Chris when the incident closes.
  -- The category list is a PROPOSAL; it is a closed set so lessons can be counted.
  cause_category       text
    CONSTRAINT pulse_incidents_cause_category_ck CHECK (cause_category IS NULL OR cause_category IN (
      'code_change', 'config_or_env', 'vendor_outage', 'vendor_change', 'data',
      'schema_or_migration', 'deploy', 'timeout_or_capacity', 'bad_pulse_signal', 'unknown')),
  cause_note           text
    CONSTRAINT pulse_incidents_cause_note_ck CHECK (cause_note IS NULL OR char_length(cause_note) <= 2000),
  fix_summary          text
    CONSTRAINT pulse_incidents_fix_summary_ck CHECK (fix_summary IS NULL OR char_length(fix_summary) <= 2000),
  -- The test, check, or rule that now prevents it. 'none: <reason>' is allowed, empty is not.
  guard_added          text
    CONSTRAINT pulse_incidents_guard_added_ck CHECK (guard_added IS NULL OR char_length(guard_added) <= 2000),
  closed_by            text
    CONSTRAINT pulse_incidents_closed_by_ck CHECK (closed_by IS NULL OR closed_by IN ('auto', 'claude', 'chris')),

  CONSTRAINT pulse_incidents_closed_pair_ck  CHECK ((closed_at IS NULL) = (closed_by IS NULL)),
  CONSTRAINT pulse_incidents_closed_after_open_ck CHECK (closed_at IS NULL OR closed_at >= opened_at),
  CONSTRAINT pulse_incidents_issue_pair_ck   CHECK ((github_issue_number IS NULL) = (github_issue_url IS NULL)),
  CONSTRAINT pulse_incidents_alert_pair_ck   CHECK ((alerts_sent = 0) = (last_alert_at IS NULL)),
  -- The pulse closes an incident by itself the moment the beat is green again ('auto'); it cannot
  -- know the cause. Closed by Claude or Chris, the four learning fields are required.
  CONSTRAINT pulse_incidents_learned_ck CHECK (
    closed_by IS NULL OR closed_by = 'auto'
    OR (cause_category IS NOT NULL
        AND btrim(coalesce(cause_note, ''))  <> ''
        AND btrim(coalesce(fix_summary, '')) <> ''
        AND btrim(coalesce(guard_added, '')) <> '')
  )
);

-- At most one open incident per beat. A second run that finds the beat still broken updates this row.
CREATE UNIQUE INDEX IF NOT EXISTS pulse_incidents_one_open
  ON public.pulse_incidents (org_id, beat_id) WHERE closed_at IS NULL;
CREATE INDEX IF NOT EXISTS pulse_incidents_beat_idx
  ON public.pulse_incidents (org_id, beat_id, opened_at DESC);

COMMENT ON TABLE public.pulse_beats IS
  'One row per beat per hourly run of the pulse (netlify/functions/pulse-hourly.mjs): did the signal come back, where it stopped, how long it took. Insert-only.';
COMMENT ON TABLE public.pulse_incidents IS
  'One row per break the hourly pulse found. At most one open row per beat. Counts alerts, links the GitHub issue and the Claude session, and records cause and guard when closed.';
COMMENT ON COLUMN public.pulse_beats.duration_ms IS 'Milliseconds the beat took. NULL = not measured (never 0).';
COMMENT ON COLUMN public.pulse_incidents.last_alert_at IS 'When the last "still broken" text went out. NULL = no text has gone out yet.';
COMMENT ON COLUMN public.pulse_incidents.closed_by IS 'auto = the beat went green on its own; claude = the pulse fixer; chris = Chris. Auto-closed rows have no cause yet and are the backlog for the lessons file.';

ALTER TABLE public.pulse_beats     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pulse_beats     FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.pulse_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pulse_incidents FORCE  ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                  AND tablename = 'pulse_beats' AND policyname = 'pulse_beats_app_all') THEN
    CREATE POLICY pulse_beats_app_all ON public.pulse_beats USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                  AND tablename = 'pulse_incidents' AND policyname = 'pulse_incidents_app_all') THEN
    CREATE POLICY pulse_incidents_app_all ON public.pulse_incidents USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 104_app_role.sql's default privileges hand the app full write to every new table. Take back what
-- these must not allow. pulse_beats: written once. pulse_incidents: updated, never deleted.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fundhub_app') THEN
    REVOKE UPDATE, DELETE, TRUNCATE ON public.pulse_beats FROM fundhub_app;
    GRANT SELECT, INSERT ON public.pulse_beats TO fundhub_app;
    -- 30-day cleanup of old beats is NOT granted here. See brief 03 section 2.6.
    -- To allow it later, a new migration runs: GRANT DELETE ON public.pulse_beats TO fundhub_app;
    REVOKE DELETE, TRUNCATE ON public.pulse_incidents FROM fundhub_app;
    GRANT SELECT, INSERT, UPDATE ON public.pulse_incidents TO fundhub_app;
  END IF;
END $$;

-- The public web keys (anon, authenticated) must not touch these tables. The policy above says true
-- for every role, so the grants are the only gate. Same block as 409 and 415.
DO $$
DECLARE r text; t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['pulse_beats', 'pulse_incidents'] LOOP
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
        EXECUTE format('REVOKE ALL ON public.%I FROM %I', t, r);
      END IF;
    END LOOP;
  END LOOP;
END $$;
```

Differences from the board's column list, so nobody is surprised:
- Kept every column the board named. Added no new column. Added constraints only.
- `alerts_sent` and `last_alert_at` must agree (both zero/NULL, or both set). This is what makes "text failed, retry next hour" visible in the data.
- `closed_by` is new in the sense that the board lists it among the learning columns without values. Proposed values: `auto`, `claude`, `chris`. `auto` is needed because the runner closes the incident the moment the beat is green, long before anyone writes a cause.
- The `cause_category` list is mine, not from the repo or from Chris. The contract author or Chris should confirm or change it.

### 2.4 The row rule: permissive, not staff-only

The board says "row security on, staff only, same as `job_heartbeats`". What the repo shows:

- `job_heartbeats`, `pulse_scorecards`, `morning_briefs`, `marketing_heartbeats`, `blueprint_declines` all have `USING (true) WITH CHECK (true)` (queried from `pg_policies`; files `430:80-96`, `415:60-67`, `470:196-210`). Header of 430 says why: "These tables carry no client or partner data, so the policy admits the application; the grants below are what limit it, and the read endpoint binds the caller's org_id" (`430:70-72`).
- A real staff rule exists: `USING (fundhub_is_staff()) WITH CHECK (fundhub_is_staff())` (`db/migrations/398_clarity_insights.sql:28-30`, function in `045_creative_factory.sql:48-50`; it reads the setting `fundhub.actor` = 'staff'). It needs `set_config('fundhub.actor','staff',true)` in the SAME transaction as the query. The shared wrapper `db.query` cannot guarantee that (`src/db.mjs:76-77`), so every runner read and write would need `pool().connect()`, BEGIN, set_config, COMMIT. About 3 more round trips, about 0.3 s more, plus a way to forget it (a forgotten scope returns zero rows with no error: `rls-shape.test.mjs:9-24`).

Recommendation: copy `job_heartbeats` exactly (permissive policy, grants as the gate, public keys revoked). If Chris wants staff-only, swap the two policies for `fundhub_is_staff()` and plan the `connect()` cost. The DDL shape does not otherwise change.

If a staff screen later reads these tables through `api/read/*.mjs`, `src/http/read-endpoints-org-scope.test.mjs` will fail until the query has `WHERE org_id = $caller_org`.

### 2.5 Leftover (one card, not investigated, not fixed)

On live, `has_table_privilege('anon', ..., 'SELECT')` and `'INSERT'` are TRUE for `job_heartbeats`, `pulse_scorecards`, `morning_briefs`, `blueprint_declines` and `document_vault_reviews`, and the row policy on the first three is `USING (true)` for role `public`. `marketing_heartbeats` is closed (all false). So the Supabase public key may be able to read and write the morning-brief text and the heartbeats if the project exposes the `public` schema over its web API. I did not test the web API. This session owns only the clock and the records, so: card for the board, no follow-up here. (`morning_briefs` holds the "Good morning, Chris" text body: `db/migrations/431_morning_briefs.sql`.)

### 2.6 One decision for Chris: deleting old beats

The board says "Kept 30 days (owner can change), then deleted by the runner." That is not in the table of Chris's answers on the board (`ops/workflows/pulse-layer-2026-10-09.md:9-18`), and CLAUDE.md section 11 says anything that deletes data is ask-first. The DDL above therefore does NOT grant DELETE. Size if nothing is deleted: if each beat is one row per hour (about 15 to 30 beats), that is 130,000 to 260,000 rows a year, small. If every one of the 365 bank Apply links were its own beat it would be about 3.2 million rows a year. Recommend one `bank-apply` beat with failures listed in `detail` (capped at 2000 characters by the CHECK). Question for Chris, one line: "OK to delete pulse results older than 30 days, yes or no?" If yes, a later migration adds `GRANT DELETE ON public.pulse_beats TO fundhub_app;`. The index `pulse_beats_ran_at_idx` is already there for it.

### 2.7 Tests: what pins table lists, and what to add

- **No test in the repo pins a list of tables.** Searched `src`, `scripts`, `db` for `job_heartbeats|pulse_scorecards` and for tests reading `db/migrations`: no test enumerates tables, and nothing names `pulse_beats` or `pulse_incidents` (searched `src api netlify scripts docs db ops`, only the board mentions them).
- **Generic catalog guards cover the new tables with no edit:** `src/security/rls-shape.test.mjs` (no table locked shut: needs a policy; live-catalog half skips without a database), `src/compliance/rls-bypass.pg.test.mjs`, `src/security/superuser-guard.test.mjs`, and the production build step `npm run guard:rls` (`netlify.toml:72-87`).
- **Tests that WILL fail until a step is done:**
  - `src/http/health-migrations.test.mjs:70` ("the expected list is exactly what db/ holds") and `scripts/ship.mjs:262` and `.github/workflows/tests.yml:260-267`: run `npm run migrations:manifest` and commit `db/expected-migrations.mjs`.
  - `src/security/migrations-production-only.test.mjs` pins `netlify.toml`'s `[context.production]` command; do not touch that block.
- **Tests to add (new files, same change):**
  - `src/pulse/pulse-records.test.mjs` (source-level, runs without a database): the migration file has ENABLE and FORCE for both tables, both `_app_all` policies, the REVOKE for `anon` and `authenticated`, the partial unique index text `WHERE closed_at IS NULL`, and no `GRANT DELETE` on `pulse_incidents`.
  - `src/pulse/pulse-records.pg.test.mjs` (needs `DATABASE_URL`; skipped locally, so CI only): second open incident for the same beat is refused; closing then reopening is allowed; a red beat without `step` is refused; `closed_by='claude'` without learning fields is refused; `closed_by='auto'` without them is allowed; `alerts_sent=1` with NULL `last_alert_at` is refused. Name it `.pg.test.mjs` under `src/` so the `npm test` glob finds it (CLAUDE.md section 12: a test under `api/` never runs).
  - `src/pulse/pulse-hourly.test.mjs`: `SWEEP_CRON` equals the `netlify.toml` block (copy of `src/marketing/clock.test.mjs` pattern).

---

## 3. How a migration shows in `/api/health` ("pending")

1. `api/health.mjs:51` calls `healthState(db, undefined, undefined, strict)` in `src/http/health.mjs:124`.
2. It reads every key in `schema_migrations` and compares by key against `EXPECTED_MIGRATIONS` from `db/expected-migrations.mjs` (`health.mjs:144`: `expected.filter(k => !applied.has(k))`). Pending = expected keys not applied. Extra applied keys do not count.
3. `EXPECTED_MIGRATIONS` is a generated, checked-in module (not a file walk), because the deployed bundle has no `.sql` files in it. It is made by `npm run migrations:manifest` (`package.json:14`, `scripts/db/expected-migrations.mjs`).
4. Live now (GET https://fundhub.ai/api/health, 2026-10-09T09:29Z): `{"ok":true,"state":"up","migrations":387,"expected":361,"pending":0}`. Applied is larger than expected because older applied files are no longer on disk.
5. After you add 475 and regenerate: the new bundle expects 362.
   - A preview or branch deploy does not migrate (`db/migrate.mjs:48-57`, `netlify.toml:[context.production]`). It reports `state:"behind"`, `pending:1`. That is correct and not a bug to fix.
   - Production: `npm run ship` checks the manifest is complete (`scripts/ship.mjs:254-262`), applies pending SQL through the Supabase API one file per transaction (`scripts/ship.mjs:304-317`), then deploys, then polls health up to 12 times at 5 s for `ok && pending === 0 && expected === EXPECTED_MIGRATIONS.length` (`scripts/ship.mjs:337-346`).
   - Until the ship finishes, the OLD live bundle still says `pending: 0` (its list has 361 entries). So `pending: 0` on live does not prove the migration ran. Prove the tables: `SELECT to_regclass('public.pulse_beats')` is not NULL.
   - `GET /api/health?strict=1` adds `missingMigrations` (the names) and answers 503 when not ok (`health.mjs:158, 213`).
6. The pulse runner should treat "relation pulse_beats does not exist" as a handled error: write the `job_heartbeats` row with `ok:false` and the message, return 200. The first scheduled hour after deploy is after the ship, so this should not happen, but a deploy that landed before its migration would otherwise throw.

---

## 4. Unknowns (looked, not found, or not measurable here)

- Whether Netlify bundles `pulse-hourly` with esbuild or nft: `netlify.toml:99` says esbuild, memory says nft. Not measured. Prove with zip-it-and-ship-it before ship (trap 6).
- Whether Supabase's public web API (PostgREST) exposes the `public` schema for this project, which decides whether 2.5 is a real exposure. Not tested.
- Real Postgres behaviour of the DDL above. Not run. The two regexes in `CHECK`s (`beat_id`, `github_issue_url`) should be tried in a scratch database.
- How many beats there will be and whether bank Apply is one beat or 365. The board's table says "each bank's Apply page opens (365 sites)" and its schema says "one row per beat per hour". Decision for the contract author; the DDL works either way.
- Whether Chris wants minute 0 or an offset for the cron. The board says "0 * * * *" in the task and nothing from Chris on minute.
- Whether `src/pulse/beats/alerts.mjs` will import a Twilio `send` directly (needs a `SEND_PATHS` entry) or go through `src/pulse/notify.mjs` (already listed). Not decided on the board.
