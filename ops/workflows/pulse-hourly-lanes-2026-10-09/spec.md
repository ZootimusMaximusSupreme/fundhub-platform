# Hourly deep lanes and door pings — build contract (2026-10-09)

Architect: Claude (Opus). Builders: Sonnet (back end). Integrator: Claude main session.
Reads first: `ops/workflows/pulse-layer-2026-10-09-v1.md` (v1 cut), `ops/workflows/pulse-layer-2026-10-09.md` (board),
`ops/workflows/pulse-layer-2026-10-09-critic.md` (16 issues), `docs/journeys/heartbeat-flow.md`.
If `ops/workflows/pulse-hourly-lanes-2026-10-09/measure.md` exists when you start, its false-alarm rules win over section 6 where they are stricter.

## 0. In plain words

- Today the 41 deep lanes (about 209 checks) and the 396 door pings run once a day, at 6 a.m. A break at noon waits until tomorrow.
- After this build they run every hour at minute 37, in their own sealed run, outside Inngest, with no edit to the live api function.
- They can only read. Postgres refuses writes. The web is GET and HEAD only. The whole run is a separate process, so the walls cover the whole process, not just the code we wrote.
- Chris gets at most one text from this run each hour. Reds that already exist on the first run do not nag him every hour.

## 1. Where the lanes run — DECIDED: a background function woken by a scheduled clock

```
minute 37  netlify/functions/pulse-lanes-clock.mjs        (scheduled, 30 s cut, tiny bundle)
             | one POST to our own deploy, header x-pulse-lanes-secret
             v
           netlify/functions/pulse-lanes-background.mjs   (background, 15 min, its own process)
             -> src/pulse/lanes/main.mjs runLanesPulse()
```

Evidence:
- 41 lanes take about 55 s one after another (finance-os 12 s, crm-links 8-10 s, sales-manager 8 s, owner-tools 7 s; measured in `scratchpad/live/*.json`, laptop). 396 pings at concurrency 8 with a 15 s timeout (`registry.mjs` `checkRegistry`) add 10-30 s. A 26 s or 30 s function cannot hold both plus a text and records.
- `ad-video-sweeper` -> `ad-video-worker-background` is the repo's proven pattern for "a clock that wakes a 15-minute worker" (`netlify/functions/ad-video-sweeper.mjs`, ALLOWED_RAW_FETCH entry in `src/lib/no-unfenced-transmit.test.mjs`). The repo states a background function cannot be put on a clock itself.
- A process that serves ONLY the pulse is the one place we may poison `process.env.DATABASE_URL` and replace `globalThis.fetch` for the whole process. That is how `gap-live.mjs` and `scripts/pulse/prove.mjs` sandbox lanes today (0 escapes, 0 writes, 0 POSTs over 41 lanes). Inside the api function those two moves would hit customers.

Rejected:
- (i) A secret route in `netlify/functions/api.mjs` with a lazy import. Rejected: it edits the customer hot path on launch day; it runs lanes in the same Lambda that serves logins and checkout, so process-wide walls (poisoned DB address, GET-only global fetch) are impossible and lanes that use the global fetch (`documents`, `funnels`, `pixels`, `portal`: 107 global fetches measured) and modules that import `src/db.mjs` directly would run unfenced; and 26 s per call means the clock must fan out many calls inside its own 30 s.
- (ii) New scheduled functions with their own bundle. Rejected: 30 s cut. To fit, the lanes would split across 3-4 functions, and each one bundles the api graph again (`gap-partners` imports `netlify/functions/api.mjs`; `gap-finance-os` imports 7 `api/money/*` handlers), so 3-4 extra 33 MB bundles instead of one.
- (iii) An Inngest function. Rejected: the hourly pulse must not ride Inngest (the morning pulse already does; if Inngest dies, both go blind); each step still runs inside `/api/inngest`, which is the api function (same hot-path and same no-walls problem); about 1,000 extra Inngest steps a day.
- (iv) A background function alone, with no clock. Rejected: it cannot be scheduled.

What the chosen shape costs:
- One more function bundle of about 33 MB (the api graph, pulled by `gap-partners` and the `api/*` handler imports). The `[functions] included_files` excludes (`!**/*.mp4`, `!node_modules/ffmpeg-static/**`, `!credentials/**`) apply to it too. `pulse:prove` prints the zip size and fails above 45 MB.
- Netlify credits (estimate, see open decision 3): about 400 credits a month. Background run about 2 min x 1 GB x 720 runs = 24 GB-hours (10 credits per GB-hour on credit plans); door pings and lane page reads about 360,000 web requests a month (2 credits per 10,000) plus the api compute they cause (about 10 GB-hours). Source: Netlify docs "how credits work" (10 credits per GB-hour functions compute; 2 credits per 10,000 web requests). Not measured on this account.

## 2. The sandbox (all inside the background process)

Done in this order, at the top of `pulse-lanes-background.mjs`, before any lane module is imported (lanes are loaded through the `GAP_FILES` dynamic imports, so nothing lane-side runs before step 5):

1. **Auth.** Header `x-pulse-lanes-secret` must equal `PULSE_LANES_SECRET` (32+ characters, not starting with `*`), compared with `crypto.timingSafeEqual`. Missing or wrong: log one redacted line and return. Nothing else runs. (Same rule as `api/ops/notify-owner.mjs`.)
2. **Capture, then poison.** `const DB_URL = process.env.DATABASE_URL; const realFetch = globalThis.fetch;` then set `process.env.DATABASE_URL` and `process.env.MIGRATION_DATABASE_URL` to `postgres://escape-blocked.invalid:5432/blocked`. Any module that opens its own pool through `src/db.mjs` (created lazily on first `pool()` call) now fails loudly instead of writing. The function must never call `src/db.mjs` `pool()` or `db` itself; it builds its own pool (step 4).
3. **Global fetch wall.** `globalThis.fetch = guardGlobalFetch(realFetch)` (new export in `src/messaging/providers/pulse-probe.mjs`): GET and HEAD pass to `realFetch`; any other method throws `PulseRefused("http", "method_not_allowed", "<METHOD> <host>")` and is counted. It stays installed for the life of the process (warm reuse is safe: this Lambda only ever runs this function). `realFetch` is held ONLY in `src/pulse/lanes/alerts-lanes.mjs` sinks, passed as `fetchImpl` into `twilio.send` and `ntfy.send` (both accept `fetchImpl`; `textMorningBrief` accepts `sendImpl`). No edit to `notify.mjs`, `twilio.mjs` or `ntfy.mjs`.
4. **Own pool.** `new pg.Pool({ connectionString: DB_URL, max: 8, connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000, statement_timeout: 15000 })` with an `error` listener (copy the reason from `src/db.mjs`). `rdb = { query: (s, p) => pool.query(s, p) }` is for the run claim, prefetch, records and the heartbeat ONLY. Lanes never see it.
5. **Per-lane ctx** (`src/pulse/lanes/sandbox.mjs` `makeLaneCtx`):

| key | what the lane gets | same as daily? |
|---|---|---|
| `db` | facade `{ query(sql, params) }` over a read box opened with `openReadBox({ connect, scope: "none", statementTimeoutMs: 8000, maxStatements: 1000 })` | daily: shared pool, plain app role. Same view (plain role, row security applies) |
| `scope` | `(fn) => fn(staffFacade)`, staff facade over a second box with `scope: "staff"` | daily: `asStaff`. Same view |
| `now` | run start `Date` | same |
| `orgId` | default org from prefetch | same |
| `fetchImpl`, `fetch` | `makeReadFetch()` (new export in `pulse-probe.mjs`), a fetch-shaped function, see below | daily: real fetch |
| `baseUrl` | `https://fundhub.ai` (`DEFAULT_BASE_URL`) | same |
| `env` | `Object.freeze({ ...process.env })` taken AFTER step 2 (so `DATABASE_URL` in it is the dead address) | daily: live env |

- Boxes open lazily on the first query, so a lane that only reads the web holds no connection. Both boxes close (`ROLLBACK`, destroy) when the lane ends or is cut (`close({ timedOut: true })`).
- `makeReadFetch({ fetchImpl: realFetch, env })` returns `async (input, init) => Response`. Rules: method GET or HEAD only (else throw `PulseRefused`, counted); every hop checked with `checkProbeTarget` (https only, no IP literal, no private name, default port); redirects followed by hand up to 5 when `init.redirect` is `"follow"` or unset, returned as-is when `"manual"`; body read up to **1 MB** (the beat probe's 64 KB would cut pages and make false reds on content markers); 10 s timeout; user agent `FundhubPulse/1.0 (+https://fundhub.ai)`; through `transmit()` behind the `ADAPTERS` fence like `probeGet`. Returns a real `Response` (status, headers, body, `url` set to the final address).
- **A refused statement or a refused fetch inside a lane:** the lane run is marked `refused` (summary row `ok=false`, `step='refused'`, detail names the first refusal). Its FAIL rows from this run are thrown away: no new incident, no heal. A sandbox refusal is our wall talking, not a business break. The lane is also named in the run heartbeat error, so the minute-7 `lanes-alive` beat (section 3) tells Chris. Proof on the laptop: the 629 lane statements that fit the log were run through `assertReadOnlySql`: 0 refused (288 longer ones were clipped in the log and must be re-checked by the bundle proof, section 8).
- **Escapes.** An error whose message contains `escape-blocked.invalid` in any lane row detail or thrown error counts as an escape. Same handling as a refusal.

## 3. Timing and load

Budgets, all counted from handler entry (internal hard stop 10 min; Netlify kills at 15):

| phase | cap | notes |
|---|---|---|
| auth, sandbox, pool, run claim, prefetch | 10 s | |
| lanes | 300 s | queue, `LANE_CONCURRENCY = 3`, per-lane deadline 60 s |
| confirm lanes | 120 s | re-run once, 45 s after the lanes phase, every lane that had at least one FAIL |
| doors | 120 s | `DOOR_CONCURRENCY = 6`, 10 s per ping |
| confirm doors | 60 s | re-ping once, 20 s later, every door that was down |
| decide + text | 30 s | text BEFORE records |
| records + heartbeat | 30 s | best effort |

Load:
- Peak connections from this run: 3 lanes x 2 boxes + 1 for records = 7, pool max 8. Measured at rest: about 12 of 60 used. Peak about 20 of 60.
- Order of statements inside a box: one at a time (the box queues), so a lane's `Promise.all` cannot interleave savepoints.
- Lanes and doors do not run at the same time (doors after lanes), so the site sees at most 6 pulse pings at once.

When something is cut or does not answer:
- **A lane cut at 60 s, throws, or its box will not open:** summary row `ok=false`, `step` one of `cut`, `threw`, `box`. Its checks are UNKNOWN this run (no new incident, no heal). It never becomes 41 red checks.
- **The database is down at prefetch:** no lanes run, no text from this run, heartbeat `pulse-lanes` outcome `error` (written if the pool can write; otherwise not written, which is also seen). `db-health` at minute 7 already owns "database down".
- **The clock's POST is not answered with 202:** the clock writes its own heartbeat `pulse-lanes-clock` with `outcome='error'` and the reason.
- **The background never finishes** (killed, crashed, not woken): no `pulse-lanes` heartbeat for that hour.
- **Who is told:** a new beat `lanes-alive` in the minute-7 pulse (`src/pulse/beats/beat-lanes-alive.mjs`, kind `infra`, `damp: 2`, `covers: []`). Steps: `ran-recently` (newest `job_heartbeats` row for job `pulse-lanes` finished within 2 h 15 min) and `ran-clean` (that row's `outcome='ok'`; red detail quotes its `error`, which names the cut or refused lanes). Skipped when the lanes kill switch row exists (section 9). So an infra failure becomes ONE beat incident (`lanes-alive`) on the existing text path, never 41 lane reds. Also the clock itself turns its own heartbeat to `error` when the newest `pulse-lanes` finish is older than 70 min, so the 6 a.m. job-clock check shows it too.
- Run outcome rule: heartbeat `pulse-lanes` is `error` when any lane was cut, threw, refused or escaped, or the doors phase did not finish, or an alert was due and reached neither text nor buzz. `item_count` = checks run.

## 4. Results into the pipeline

### 4.1 Keys

- Lane check: `lane:<id>` where `<id>` is the id `runGapChecks` writes (already namespaced by `namespaceGapId`, e.g. `lane:payments:paid-no-entitlement`, `lane:gap-sms:...`, `#2` suffix for repeats). Measured: raw ids up to 36 chars, lower case, only `:` beyond `[a-z0-9-]`.
- Door: `door:<registry id>` (e.g. `door:marketing/scripts/approve`). Measured: up to 44 chars, lower case, `/` and `-`.
- Beat ids never contain `:` (contract `BEAT_ID_RE`), so the three key spaces cannot collide.
- If a key fails the new pattern, use `lane:x-<first 16 hex of sha256(id)>` and log it once. Never drop the row.

### 4.2 Migration `db/migrations/476_pulse_lanes.sql` (use the next free number; `ls db/migrations` first; never edit 475)

```sql
-- pulse_incidents.beat_id: allow lane and door keys. Beat ids keep the old shape.
ALTER TABLE public.pulse_incidents DROP CONSTRAINT IF EXISTS pulse_incidents_beat_id_ck;
ALTER TABLE public.pulse_incidents ADD CONSTRAINT pulse_incidents_beat_id_ck CHECK (
  beat_id ~ '^[a-z0-9][a-z0-9-]{0,43}$' OR beat_id ~ '^(lane|door):[a-z0-9][a-z0-9:/#._-]{0,150}$');

-- Mute: the incident stays open, the hourly reminder skips it, the FIXED text still goes.
ALTER TABLE public.pulse_incidents ADD COLUMN IF NOT EXISTS muted_until timestamptz;
ALTER TABLE public.pulse_incidents ADD COLUMN IF NOT EXISTS muted_note text
  CONSTRAINT pulse_incidents_muted_note_ck CHECK (muted_note IS NULL OR char_length(muted_note) <= 300);
-- Red already on the first hourly pass of its lane (or of the doors). Never set later.
ALTER TABLE public.pulse_incidents ADD COLUMN IF NOT EXISTS baseline boolean NOT NULL DEFAULT false;

-- One lane run per clock hour (the run claim), and the "previous run" pointer. Also the kill switch.
CREATE TABLE IF NOT EXISTS public.pulse_runs (
  run_id      uuid        PRIMARY KEY,
  org_id      uuid        NOT NULL REFERENCES orgs(id),
  kind        text        NOT NULL CHECK (kind IN ('lanes', 'lanes-off')),
  slot        timestamptz NOT NULL,           -- date_trunc('hour', now()); 'infinity' for the kill switch
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  outcome     text        CHECK (outcome IS NULL OR outcome IN ('ok', 'error')),
  detail      text        CHECK (detail IS NULL OR char_length(detail) <= 500),
  CONSTRAINT pulse_runs_one_per_slot UNIQUE (org_id, kind, slot)
);
-- RLS enable + FORCE, permissive _app_all policy, fundhub_app: SELECT, INSERT, UPDATE (no DELETE, no TRUNCATE),
-- REVOKE ALL from anon and authenticated. Copy the three DO blocks of 475 exactly.
```

- `db/expected-migrations.mjs` regenerated in the same change.
- Without 476 applied (the column or table is missing), `runLanesPulse` runs NOTHING and writes heartbeat `error` "migration 476 not applied". Without state it would text every hour about every red, so it must not run.

### 4.3 What is stored each hour (no green rows, no new table for results)

In `pulse_beats` (existing table, existing CHECK `^[a-z0-9][a-z0-9-]{0,43}$` already fits):
- One row per lane: `beat_id = 'lane-<lane short name>'` (longest is `lane-marketing-queue`, 20 chars), `run_id` = the run, `ok` = the lane COMPLETED (not cut, threw, refused, escaped, box), `step` = `done | cut | threw | refused | box | skipped-hourly-no`, `detail` = `"P 7, F 1, S 0, confirmed 1"` (counts), `duration_ms`, `steps` = one entry per non-PASS check: `{ name: "<id within lane>", ok: false }` for a FAIL that held after confirm, `{ name: "skip:<id within lane>", ok: true }` for a skip. PASS rows are not stored.
- One row `beat_id = 'doors-hourly'`: `ok` = the doors phase finished, `detail` = `"up 380, down 3, unknown 1"`, `steps` = the down ids (`{ name: "<registry id>", ok: false }`), max 40 (more than 40 down is a storm; detail keeps the true count).
- In `pulse_runs`: the claim row, finished at the end with `outcome`.
- Volume: 42 rows an hour, about 1,000 a day (v1 beats write 168 a day). No delete grant; retention is still Chris's open decision from v1.

Why damping and healing still work without green rows:
- "Previous run" = newest `pulse_runs` row `kind='lanes'` with `finished_at IS NOT NULL`, other than this run.
- A key was RED in the previous run when that run's summary row for its group has `ok=true` and lists the key with `ok:false`.
- A key was GREEN in the previous run when that summary row has `ok=true` and does not list the key at all.
- A key was UNKNOWN when there is no summary row for its group in that run, or it has `ok=false`.
- A group is on its FIRST PASS when no `pulse_beats` row with that `beat_id` and `ok=true` exists for the org (query: `SELECT b FROM unnest($2::text[]) b WHERE EXISTS (SELECT 1 FROM pulse_beats p WHERE p.org_id=$1 AND p.beat_id=b AND p.ok)`; uses `pulse_beats_beat_ran_idx`).
- Unit tests prove each of the four with rows only (no green rows ever written).

### 4.4 Decide (pure function `decideLanes` in `src/pulse/lanes/alerts-lanes.mjs`)

Status of key k this run: RED (FAIL held after confirm, or a door down twice in the run), GREEN (PASS, or a completed lane no longer returns k), SKIP, UNKNOWN (group not completed).

| this run | open incident? | result |
|---|---|---|
| UNKNOWN or SKIP | any | nothing |
| RED | no, group on first pass | open with `baseline=true`, `muted_until='infinity'`, `muted_note='red when hourly checks started'`. Counted in the one "joined" text. |
| RED | no, same key auto-closed less than 6 h ago | reopen, `muted_until` NULL, NO "BROKEN" line (flap). It shows in the hourly reminder. |
| RED | no | lane key: NEW BREAK (damp 1; the in-run confirm already ran it twice). Door key: NEW BREAK only if the key was also RED in the previous run (damp 2 across runs, on top of the in-run confirm); else DAMPED (no record). |
| RED | yes, muted (`muted_until > now()`) | quiet |
| RED | yes, not muted | REMINDER candidate |
| GREEN | yes | HEALED: close `closed_by='auto'`. Gets a FIXED line even if muted or baseline. A key that vanished from a completed lane is closed with no text. |

- Storm: 4 or more NEW BREAKS in one run = one storm text. Reds that were already open never count toward a storm (the v1 rule counts all reds; that would call 14 old reds "one cause" every hour).
- Ordering inside any list: keys named by a `money` tripwire first, then `customer`, then the rest (`src/pulse/tripwires.mjs` `TRIPWIRES[*].checks` holds 43 such check ids; match on the id within the lane).
- Reminder rule (Chris: "every hour until fixed"): ONE reminder line per run for ALL unmuted open lane and door incidents together, never one text per break. Sent when at least one listed incident has `last_alert_at` older than 50 min (`claimAlert` from `records.mjs`, reused unchanged, takes the incident uuid). Every incident on the line is claimed.

### 4.5 The text (one per run, 480 characters max, ASCII, 4th grade)

Title of a lane key: the lane row's `customerSees` cut to 60, else the id. Fix line: the row's `suggestedFix` line 1 cut to 120. Door title: `Door <path> answers <status>`; door fix: `Restore <path>. Read the api function log on Netlify.` Detail never goes in the text (only in the ntfy buzz, through `scrubDetail`). Reuse `ascii`, `cleanLine`, `scrubDetail`, `MAX_TEXT_CHARS` from `src/pulse/alerts.mjs` (import only; no edit).

| case | words |
|---|---|
| 1 new | `Fundhub BROKEN: <title>. Fix: <fix>.` |
| 2-3 new | `Fundhub BROKEN, 3 new: <A>; <B>; <C>. Fix first: <fix of A>.` |
| storm | `Fundhub BROKEN: 6 new checks went red at once. Likely one cause. First: <title>. Fix: <fix>.` |
| fixed | add `FIXED: <A>; <B>.` (or alone: `Fundhub FIXED: <A>. It was broken 3 h.`) |
| reminder | add `Still broken: 3. Oldest 5 h: <title>. Also: <B>; <C>.` (alone: `Fundhub STILL BROKEN: ...`) |
| first pass | `Fundhub: deep checks now run every hour. 14 were already red. I will not text you about those each hour. You get a text when one is fixed. New breaks text at once.` |

Parts are joined in that order and cut with the same ladder `alerts.mjs` uses; a part that does not fit becomes `And N more.` Sinks: text first; ntfy buzz when the text fails (same rule as `act()`).

### 4.6 Mute and acknowledge

No inbound "reply MUTE" tonight (that edits the inbound text door, a hot path; open decision 5). One SQL line each, run by an agent when Chris says so:

```sql
-- mute one for 7 days
UPDATE pulse_incidents SET muted_until = now() + interval '7 days', muted_note = 'chris: muted' WHERE beat_id = 'lane:payments:paid-no-entitlement' AND closed_at IS NULL;
-- mute every open lane and door break
UPDATE pulse_incidents SET muted_until = 'infinity', muted_note = 'chris: muted all' WHERE closed_at IS NULL AND beat_id ~ '^(lane|door):';
-- unmute (put a baseline red back on the hourly reminder)
UPDATE pulse_incidents SET muted_until = NULL WHERE beat_id = '<key>' AND closed_at IS NULL;
```

### 4.7 Keep the minute-7 pulse blind to lane keys

`src/pulse/records.mjs` `SQL_LIST_OPEN` gains `AND position(':' in beat_id) = 0`. Without it, 200+ open lane or door incidents could push beat incidents past its `LIMIT 200` and the beats would text a new break twice. Beat ids never contain `:`, so this changes nothing for beats today.

## 5. Schedule and de-duplication

| minute (UTC, every hour) | what |
|---|---|
| :00 | three Inngest jobs (unchanged) |
| :07 | `pulse-hourly` beats, now 8 with `lanes-alive` (unchanged otherwise) |
| :15/:30/:45 | `marketing-clock` (unchanged) |
| :37 | `pulse-lanes-clock` -> `pulse-lanes-background` (lanes, then doors) |
| 13:00 (6:00 Arizona) | `daily-pulse` on Inngest (unchanged; it still runs its own lanes and pings for the morning text) |

- 30 minutes apart, so Chris gets at most 2 pulse texts an hour, and only when there is news.
- A break seen by both paths: the door pings skip every registry row whose path equals a `DOORS[*].path` in `src/pulse/beats/beat-doors-live.mjs` (imported, not copied), so `doors-live` owns those 10 doors. Lane keys and beat ids never share a key, and each path only touches its own keys (section 4.7). Infra "database down" is told only by `db-health` (beat); the lane run sends no infra text.
- The morning text stays as is. It may repeat a red the hourly path already texted; that is the daily summary Chris already gets.

## 6. Door pings

- Rows: `PULSE_REGISTRY` (396: 303 api, 57 desk, 36 public static) minus the `doors-live` paths minus `HOURLY_DOOR_SKIP` (section 7). Run through `makeReadFetch` with `GET`, 10 s timeout, concurrency 6, `redirect: "follow"`.
- Up/down: exactly `isUp()` in `registry.mjs` (api: 2xx, 400, 401, 403, 405 up; desk and static: 2xx only). Export `isUp` (or a `classifyDoor(row, status)` wrapper) from `registry.mjs` rather than copying it.
- False-alarm rules (my reading of the code; measure.md wins where stricter):
  - 429, or a network error that names the pulse's own fence (`blocked`, `refused`), is UNKNOWN, never down.
  - 502, 503, 504 and timeouts are down only if the confirm ping 20 s later is also bad, AND the previous run also saw the door RED (damp 2). A deploy mid-run cannot text.
  - A desk page that redirects to the login page and ends 200 is up (same as daily).
  - Known now: `reg:leads-c01cb7592c8bb994130158e897e99bf1-index` points at a page that exists only on the Mac (git-ignored). It will be a first-pass baseline red. Do not fix it here.
- A down door becomes key `door:<id>` in section 4.4.

## 7. The standard: a new lane or door joins the hourly clock with no second list to forget

- The runner reads `GAP_FILES` (`src/pulse/coverage/modules.mjs`, already guarded by `modules.test.mjs`) and `PULSE_REGISTRY` (guarded by `registry.test.mjs`). A new lane or door is picked up the hour after it ships.
- `src/pulse/lanes/manifest.mjs` exports `HOURLY_LANES`: one entry per lane file, `{ hourly: true|false, web: true|false, reason }`, and `HOURLY_DOOR_SKIP`: `{ "<registry id>": "<reason, 40+ chars>" }` (starts empty).
- Runtime: a lane in `GAP_FILES` with no manifest entry still RUNS (coverage fails open) and its summary row says `unclassified`. A lane with `hourly: false` writes a summary row `step='skipped-hourly-no'` and runs only at 6 a.m.
- Guard test `src/pulse/lanes/manifest.test.mjs` fails the build when:
  1. a `GAP_FILES` entry is missing from `HOURLY_LANES`, or `HOURLY_LANES` names a file not in `GAP_FILES`;
  2. `hourly: false` has a reason under 40 characters, or `hourly: true` has a reason under 20;
  3. a lane with `web: false` has `fetch`, `fetchImpl`, `baseUrl` or `globalThis.fetch` in its source;
  4. a `HOURLY_DOOR_SKIP` key is not a `PULSE_REGISTRY` id, or its reason is under 40 characters.
- Default classification (from the measured live run; builder confirms with the bundle proof, section 8): all 41 `hourly: true`. `web: true` for: calls, closer, consent, contracts, crm-links, documents, funnels, inquiry, keys, marketing-queue, owner-tools, partners, payments, pixels, portal, soft-pull, staff, training, webhooks. All others `web: false`. Any lane the bundle proof shows refusing, escaping, POSTing or taking over 45 s becomes `hourly: false` with that measurement as its reason.
- `.claude/rules/heartbeat-on-every-build.md` and `.cursor/rules/heartbeat-on-every-build.mdc` gain one line: "A new gap lane also gets a row in `src/pulse/lanes/manifest.mjs` (hourly yes or no, with a reason)." (Both homes, same change.)

## 8. Proof before ship: `npm run pulse:prove -- --lanes-hourly`

Builds `netlify/functions/pulse-lanes-background.mjs` with zip-it-and-ship-it exactly as `proveBeats()` builds `pulse-hourly` (same `included_files`, `external_node_modules`), unzips it, and runs `runLanesPulse({ mode: "prove" })` from INSIDE the bundle against live data:
- connections come from the harness: `BEGIN READ ONLY`, staff and plain, rolled back; `DATABASE_URL` poisoned; global fetch GET/HEAD only; recording sinks (no text); no records written (`mode: "prove"` writes nothing, like v1).

Must be true, or exit 1:
- zip under 45 MB; cold load of the bundle under 15 s;
- 41 of 41 lanes loaded (0 "Could not load"); every `hourly: true` lane completes (`step='done'`);
- 0 refused statements, 0 refused fetches, 0 escapes, 0 writes, every box `readOnlyAtClose === true`, 0 `commitsSent`;
- peak open boxes 6 or fewer;
- lanes phase under 120 s on the laptop; whole run under 300 s;
- door rows run = 396 minus the `doors-live` paths minus skips, each classified up, down or unknown;
- 0 process crashes, unhandled rejections counted and printed;
- same answers as the daily: run `npm run pulse:prove -- --repo` lanes on the same data; any check that is PASS in one and FAIL in the other is printed; a difference not explained by time fails the proof.

Negative controls (each must make the proof exit 1, so it has teeth): `--fixture=post` (a fixture lane that POSTs), `--fixture=insert` (a fixture lane that INSERTs), `--fixture=hang` (a lane that never returns: cut at 60 s, marked `cut`, no red keys), `--fixture=escape` (a lane that imports `src/db.mjs` and queries).

After ship: watch the first live run at minute 37. Expected: one first-pass text with the baseline count (about 14 lane reds plus about 1 door), `pulse_runs` row finished `ok`, 42 summary rows, heartbeat `pulse-lanes` ok; at minute 7 next hour `lanes-alive` green; at minute 37 next hour no text unless something changed.

## 9. Split and order

Model: Sonnet for A-E (back end from a clear spec). Opus (Claude main) for F and the integration (it touches the live clock and the minute-7 pulse).

Wave 1, all five at the same time (no shared files):

| piece | owns (exclusive) | acceptance |
|---|---|---|
| A sandbox and runners | `src/messaging/providers/pulse-probe.mjs` (add `makeReadFetch`, `guardGlobalFetch`; existing exports unchanged) and `pulse-probe.test.mjs`; `src/pulse/lanes/sandbox.mjs`, `run-lanes.mjs`, `doors.mjs` and their tests | refuses POST/PUT/DELETE/PATCH; 1 MB cap; manual vs follow redirects; lane cut at deadline closes both boxes; refusal and escape mark the lane `refused`; confirm re-run; door confirm and 429 = unknown; a fake lane test AND a `.pg.test.mjs` that runs one real lane read-only through two real boxes |
| B manifest | `src/pulse/lanes/manifest.mjs`, `manifest.test.mjs`; the one line in both heartbeat rule files | the 4 guard failures in section 7, each with a test that makes it fail |
| C records and migration | `db/migrations/476_pulse_lanes.sql`, `db/expected-migrations.mjs`, `src/pulse/lanes/records-lanes.mjs` (+ test, + `.pg.test.mjs` in one rolled-back transaction), the one-line `SQL_LIST_OPEN` change in `src/pulse/records.mjs` (+ its test line) | run claim (second claim in the same hour gets nothing); previous-run and first-pass readers; open lane incident with the new key; baseline mute; reopen; summary rows within every 475 CHECK; app role refused DELETE on `pulse_runs` |
| D alerts | `src/pulse/lanes/alerts-lanes.mjs` (+ test) | every row of the 4.4 table; storm counts only new; reminder is one line, claims each incident; first-pass text; 480 chars ASCII; sinks pass `fetchImpl` to twilio and ntfy; recording sinks in tests |
| E beat | `src/pulse/beats/beat-lanes-alive.mjs` (+ test) and its line in `src/pulse/beats/index.mjs` | v1 beat contract (fix guide 300+ chars, PASS and FAIL tests that break if the logic breaks, SQL tested read-only on live), skip when the kill switch row exists |

Wave 2 (waits for A-D; E can land any time):

| piece | owns | acceptance |
|---|---|---|
| F orchestration (Opus) | `src/pulse/lanes/main.mjs` `runLanesPulse({ mode, env, now, connect, rdb, sinks, budgets, lanes, doors })` + test | phases and caps of section 3 in order; text before records; prove mode writes nothing; 476 missing = runs nothing |
| G integration (Claude main) | `netlify/functions/pulse-lanes-clock.mjs`, `netlify/functions/pulse-lanes-background.mjs`, `netlify.toml`, `src/pulse/heartbeats.mjs`, `src/http/scheduled-functions-return.test.mjs`, `src/lib/no-unfenced-transmit.test.mjs`, `src/pulse/registry.mjs` (SEND_PATHS), `src/pulse/tripwires.mjs`, `scripts/pulse/prove.mjs` (`--lanes-hourly`), `PULSE_LANES_SECRET` in `.env`, `credentials/env.full.snapshot`, Netlify (no `--secret`), `docs/journeys/heartbeat-flow.md` + `docs/journeys/CHANGELOG.md`, the board | section 8 green; `npm run lint`; every new test; `npm test` shows no new failure; ship once; watch minute 37 |

Hot-path files and their switch-off:

| file | change | switch-off |
|---|---|---|
| `netlify/functions/api.mjs` | NONE | n/a |
| `netlify.toml` | `[functions."pulse-lanes-clock"]` `schedule = "37 * * * *"` on the next line | No deploy needed: `INSERT INTO pulse_runs (run_id, org_id, kind, slot) SELECT gen_random_uuid(), id, 'lanes-off', 'infinity' FROM orgs WHERE is_default;` (the background checks for it first and does nothing; `lanes-alive` skips). Full removal: delete the block and the NETLIFY_JOBS row, ship. |
| `src/pulse/heartbeats.mjs` | NETLIFY_JOBS `["pulse-lanes-clock", "37 * * * *"]` (the test demands every scheduled function, and only those) | removed with the toml block |
| `src/pulse/registry.mjs` | SEND_PATHS `"src/pulse/lanes/alerts-lanes.mjs": { watch: "pulse-lanes-clock" }`; export `isUp` | list only, no runtime effect |
| `src/pulse/tripwires.mjs` | NOT_CUSTOMER_FACING `"send:src/pulse/lanes/alerts-lanes.mjs"`: owner-only reason | list only |
| `src/lib/no-unfenced-transmit.test.mjs` | ALLOWED_RAW_FETCH `"netlify/functions/pulse-lanes-clock.mjs"`: one POST to our own deploy with a shared secret, same as ad-video-sweeper | test only |
| `db/migrations/476_pulse_lanes.sql` | widen one CHECK, 3 columns, 1 table | additive; code refuses to run lanes without it |
| `src/pulse/records.mjs` | `SQL_LIST_OPEN` ignores keys with `:` | revert the line; beats are unaffected either way |
| `src/pulse/beats/index.mjs` | + `beat-lanes-alive.mjs` | remove the line and the file |
| `src/http/scheduled-functions-return.test.mjs` | + `pulse-lanes-clock` | test only |

Rules for every builder: same as v1 (no commit, push, stash, checkout, ship; no DB write, no POST, no send, no AI call; read-only SQL for calibration; copy each finished file to `<SCRATCH>/p-backup/<piece>/`; no repo file read at run time; ids unique across `src/pulse/**`; stuck rule; Fundhub; 4th grade English in any text a human reads; money is integer cents; no new dependency; outbound only in `src/messaging/providers/*`).

## 10. Not now

- Slice rows (350, 292 of them "not checked" placeholders) and the 42 job clocks on the hourly clock. The `lanes-alive` beat and the `gap-jobs` lane cover the clocks that matter tonight.
- "Reply MUTE" by text (needs the inbound text door, a hot path).
- The write-through half, GitHub issues, the fixer session (v1 open decisions, unchanged).
- Retention of `pulse_beats` (still Chris's decision).
- Making the morning text list open hourly incidents.
- Per-lane env (each lane sees only the names it declares).

## 11. Decisions only Chris can make (yes or no)

1. On the first hourly run, mute the reds that already exist (about 14) so they do not text every hour, and text you once when each one is fixed?
2. While something new is still broken, one reminder text each hour that lists all of them (not one text per break)?
3. Spend about 400 Netlify credits a month (an estimate, about $3 at overage prices) to run the deep checks and the 396 door pings every hour?
4. Text hourly about every deep check, not only the money and customer ones? (No = owner-only checks wait for the 6 a.m. text.)
5. Later: let you reply "MUTE" to a pulse text? (It needs an edit to the live inbound text door.)
