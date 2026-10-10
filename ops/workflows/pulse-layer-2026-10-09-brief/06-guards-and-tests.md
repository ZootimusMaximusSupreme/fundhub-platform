# 06 — Guards and tests (pulse layer, 2026-10-09)

Area: what the old guards will do when we build the hourly pulse, and what new guards the "every build ships with its pulse" rule needs. Read-only grounding. Nothing in the repo was changed except this file.

## In plain words

We have many guards already. A guard is a test that turns red when someone forgets a step. Most of them will turn red when we add the pulse, and that is good. They tell the builder what is missing. I found 3 things that need care. First, one guard is already red on main today. Second, the plan says a wrong signature is "a normal request". That is unsafe. A mix-up in the secret would make the fake customer real, and it would text a real phone. The door must refuse any request that carries the pulse header and fails the check. Third, "rolled back" is not enough. Some code saves things on a side door that a rollback cannot reach, such as a second database connection, the job cloud, the document store and a number counter. The new guards below close those doors. They also stop a build from shipping without its beat. The new rule starts with 26 old surfaces on a list that can only get shorter, so tonight's build does not go red.

## 1. Facts found (all measured 2026-10-09 on main, clean tree)

| # | Fact | Evidence |
|---|---|---|
| F1 | A guard is red on main right now. `fence: nothing reaches the network...` fails for `src/pulse/funnel-doors.mjs` and `src/pulse/instant-watch.mjs`. Neither is on `ALLOWED_RAW_FETCH`. Ran 11 guard files: 78 tests, 77 pass, 1 fail. | `src/lib/no-unfenced-transmit.test.mjs:348-362`; list at `:67-283`; commits 803b2fe5 and f5bf6534 added the files |
| F2 | Today a request carrying `x-fundhub-pulse` is an ordinary request for every route. I replaced all 323 ROUTES values with a spy, sent a bogus header, and got 323 handler calls and 323 status 200. The header name appears nowhere in the repo except the board. | `netlify/functions/api.mjs:1439-1560` never reads it; scratch run `/private/tmp/.../scratchpad/g3.mjs` |
| F3 | The tripwire guard cannot see the Commas payment webhook. `surfaces()` only lists keys of `ROUTES`. `webhooks/[provider]`, `documents/[id]` and `inngest` are reached by prefix, not by key. No `route:webhooks/...` row exists in `TRIPWIRES`, `NOT_CUSTOMER_FACING` or the baseline. | `src/pulse/tripwires.test.mjs:30-42`; `src/http/routes.test.mjs:46-51`; `netlify/functions/api.mjs:1458-1461`; grep of `tripwires.mjs` and `tripwires-baseline.json` finds none |
| F4 | The "check id is real" test cannot fail for ids that live only in `tripwires.mjs`. `pulseSource()` reads every non-test `.mjs` under `src/pulse`, and that includes `tripwires.mjs`. I re-ran it with that file excluded: all 43 ids still resolve, so nothing is wrong today. The hole is latent. | `src/pulse/tripwires.test.mjs:44-48`, `:84-96` |
| F5 | `TRIPWIRES` holds 37 rows: 16 route, 14 job, 5 page, 2 desk. 43 distinct check ids. 496 surfaces still sit on `tripwires-baseline.json` and `BASELINE_MAX = 496`. | `src/pulse/tripwires.mjs:35-75`; `tripwires.test.mjs:22`; `tripwires-baseline.json` |
| F6 | The database seam is two functions: `db.query` (`src/db.mjs:76-78`) and `pool()` (`src/db.mjs:29`). 21 non-test files import `pool` and open their own connections. About 34 non-test files contain a real `COMMIT`. `withTransaction(db, fn)` reaches past the shared `db` to `pool().connect()` and commits at `src/db/with-transaction.mjs:55`. So wrapping `db.query` alone does not stop a commit. | grep results; `src/db/with-transaction.mjs:41-62` |
| F7 | Most doors do not accept an injected db. `api/webhooks/[provider].mjs:54-75` passes `{ db }` to `handleWebhook` (`src/http/router.mjs:300`). `api/public/slo-checkout.mjs:498` and `survey-submit.mjs:116` take a `deps` argument. `bookings.mjs:39`, `auth/magic-link.mjs:47` and `slo-interest` import the module-level `db` and take no deps. | file heads |
| F8 | Side doors a rollback cannot recall: (a) the job cloud, `src/events/bus.mjs:49-53` (`void inngest.send`, on whenever `INNGEST_EVENT_KEY` is set); (b) about 40 modules on `ALLOWED_RAW_FETCH` that call the network without the fence, including `src/agents/model.mjs` (a paid model call) and `src/adplatforms/*` ("UNFENCED SPEND"); (c) Netlify Blobs in `src/documents/store.mjs` (the `documents-upload` route is a tripwire surface); (d) own-deploy wake POSTs such as `src/marketing/wake.mjs`; (e) number counters. `assign_client_code()` calls `nextval('client_code_seq')` and builds `FH-000123`. Four plpgsql functions use `nextval`. Every pulse that makes a client burns a client code. Gaps will show up in customer-facing codes. | `bus.mjs:49`; `no-unfenced-transmit.test.mjs:67-283`; read-only SQL on `pg_proc` |
| F9 | No database trigger can call out. The extension list is btree_gist, pg_stat_statements, pg_trgm, pgcrypto, plpgsql, supabase_vault, uuid-ossp, vector. There is no `pg_net` and no `dblink`. One publication exists. | read-only SQL on `pg_extension`, `pg_publication` |
| F10 | The Journey Runner is the precedent. It runs real handlers in a transaction with no commit path (`api/journeys/run.mjs:215-225`), flips routing to the `memory` provider inside it (`:150-160`), and passes `skipInngest: true` because of the exact leak in F8(a) (`src/journeys/runner/index.mjs:151-176`). It still warns that `src/workflows/messaging.mjs:165` emits `message.queued` without `skipInngest`. | those lines |
| F11 | `PULSE_SECRET` is not in the laptop `.env` and not in `.env.example`. `PULSE_SMS_TO`, `GITHUB_TOKEN`, `MESSAGING_DRY_RUN` and `ADAPTERS_DRY_RUN` are in `.env` (names only). Unknown whether `PULSE_SECRET` is on Netlify. | grep of `.env` names |
| F12 | Only the 6 a.m. job reads `job_heartbeats`. `src/pulse/instant-watch.mjs` does not. A dead `pulse-hourly` goes red only after 3 hours of silence and is only read the next morning. | `src/pulse/daily-pulse.mjs:417`; grep of `instant-watch.mjs` finds no heartbeat read |
| F13 | There is no test that fails when a new table has row security off. `rls-shape.test.mjs` static half names only the 6 dispute tables (`:60-68`, `:73-100`). Its catalog half only finds "RLS on, zero policies" and only with a database (`:109-137`). `rls-bypass.pg.test.mjs` demands ENABLE and FORCE only where a policy exists. `invariants.pg.test.mjs` covers partner-module tables. | those files |

## 2. What each existing guard pins, and what a new thing trips

| Guard | Pins (file:line) | New thing it trips |
|---|---|---|
| `src/http/routes.test.mjs` | Every `api/**/*.mjs` is a ROUTES key, a SPECIAL_CASES entry or `ALLOWED_UNROUTED` (`:99-112`). No dangling key (`:114-122`). Every value is a function (`:124-131`). Both URL shapes round-trip (`:167-176`). No exact key under `webhooks/` or `documents/` (`:239-247`). `config.path === "/api/*"` (`:249-253`). | A new `api/` file (for example a staff read of pulse results) fails until it is in `ROUTES`. A pulse door named `webhooks/pulse` cannot be an exact key. |
| `src/pulse/registry.test.mjs` | Every handler key, desk and public page is in `PULSE_REGISTRY` or `ALLOWED_UNMONITORED` with a 40+ character reason (`:54-99`). Every api row is routed (`:114-124`). Every file that imports `send` from `twilio\|twilio-whatsapp\|resend\|mailgun\|mail-letter\|web-push\|ntfy` is in `SEND_PATHS`, with a `watch` or a 40+ character reason, never both (`:151-208`). | A new route needs an `API_KEYS` row (`registry.mjs:73`). A POST-only pulse door answering 405 to a GET ping counts as up (`isUp`, `registry.mjs:664`). A new file importing `send` needs a `SEND_PATHS` row. `src/pulse/notify.mjs` is already listed (`registry.mjs:64`), so reuse it for the text to Chris. `github-issues.mjs` is not in the provider regex, so it would not trip. Add it to the regex when it exists. |
| `src/pulse/heartbeats.test.mjs` | `INNGEST_JOBS` equals the registered crons (`:42-53`). `NETLIFY_JOBS` equals the `[functions."x"] schedule` blocks in `netlify.toml`, same cron, and each file contains the literal `noteScheduledRun(db, "<name>"` (`:55-69`). `cronIntervalMs("0 * * * *")` is one hour, so red after 3 hours (`:10-36`). | `pulse-hourly` needs all four: a `netlify.toml` block, a `NETLIFY_JOBS` row (`heartbeats.mjs:52`), the literal `noteScheduledRun(db, "pulse-hourly"` in the file, and the same cron in both. |
| `src/pulse/heartbeat-law.test.mjs` | Both rule files (`.cursor/rules/heartbeat-on-every-build.mdc`, `.claude/rules/heartbeat-on-every-build.md`) contain the text "3 times its schedule" (`:16-33`). Every Inngest workflow id appears in `coverage/INDEX.md` (`:35-48`). | Editing the standard rule must keep that phrase in both files. An Inngest function would need an INDEX line. `pulse-hourly` is outside Inngest, so it does not trip. |
| `src/pulse/tripwires.test.mjs` | Every surface is in `TRIPWIRES`, `NOT_CUSTOMER_FACING` or the baseline (`:52-60`). Each in exactly one place (`:62-70`). No stale entry (`:72-76`). Baseline length <= 496 (`:78-82`). Every `TRIPWIRES` row has a valid impact, at least one non-ping check id, and each id written in a `src/pulse` file (`:84-96`). `NOT_CUSTOMER_FACING` reasons >= 40 characters (`:98-102`). | A new route, page, desk, Inngest job or `SEND_PATHS` file must be sorted into `TRIPWIRES` or `NOT_CUSTOMER_FACING` in the same change. It cannot go on the baseline (the count is capped). A new pulse route is "staff or internal", so `NOT_CUSTOMER_FACING` with a reason. |
| `src/pulse/coverage/modules.test.mjs` | Disk = list for `slice-*.mjs` and `gap-*.mjs` in `coverage/` only, each as a literal `import("./name")` (`:17-36`). Header explains why: a folder scan ships empty (`modules.mjs:1-11`). | A `src/pulse/beats/` folder is outside this scan. The same trap applies to it, so it needs its own list and its own disk-equals-list test (guard 2 below). |
| `src/lib/no-unfenced-transmit.test.mjs` | Tokens that mean "can reach the network": `await fetch(`, `globalThis.fetch`, `fetchImpl(`, `fetchFn(`, `doFetch(`, `ctx.fetch`, and a bare `fetch("https://...")` (`:36-45`). Every such file under `src`, `api`, `netlify` must use `src/lib/outbound-fetch.mjs` or sit on `ALLOWED_RAW_FETCH` with a reason (`:348-362`). No stale entry (`:364-377`). Only 4 modules may say `fence: INTERNAL` (`:286-293`, `:379-393`). Providers with `TRANSMITS = true` must call `postJson` (`:395-408`). | `pulse-hourly` firing signals by HTTP trips it. The beat transport trips it. The GitHub issue provider must call `transmit()` with `ADAPTERS`. A beat that uses `ctx.fetch` trips it per file. Do not use `fence: INTERNAL`. Also see F1. |
| `src/workflows/index.test.mjs` | Every `inngest.createFunction` id in `src/workflows/*.mjs` is served or in `DELIBERATELY_UNSERVED` (`:185-198`). The served list equals `EXPECTED_WORKFLOW_IDS` (`:66`, `:365-390`). | Not hit if the runner is a Netlify function. Do not put pulse files in `src/workflows/`. |
| `src/http/scheduled-functions-return.test.mjs` | The exact set of scheduled names in `netlify.toml` is hard-coded (`:41-57`). Each default export is run in a child with no `DATABASE_URL` and no keys, and must return a `Response` or nothing, with status 200 (`:60-107`). | Adding `pulse-hourly` to `netlify.toml` fails this until the name is added to the list. The runner must do nothing at all, with no network, when env is missing. |
| `src/payments/sweeper-fontkit-in-zip.test.mjs` | Any `netlify/functions/*.mjs` whose static imports reach a file that loads `@pdf-lib/fontkit` must itself `import "@pdf-lib/fontkit"` (`:60-90`). | If the runner imports the `api.mjs` handler in-process, it needs `import "@pdf-lib/fontkit"` and `import "pg"` as `api.mjs:32-33` does. |
| `src/security/migrations-production-only.test.mjs` | Only `[context.production]` migrates. Every `[context]` build command contains `guard:db`. `pg` stays in `external_node_modules` (rest of file). | A new function must not change the build commands. Pulse tables are live only after a production ship. |
| `src/http/health-migrations.test.mjs` plus `api/health.mjs` | `EXPECTED_MIGRATIONS` (`db/expected-migrations.mjs`, 361 keys today) must equal the files in `db/schema`, `db/migrations`, `db/seed` (last test). Health says "behind" until all are applied (`src/http/health.mjs:124-165`). | The pulse migration needs `npm run migrations:manifest` in the same change. Expected becomes 362 and `pending` reads 1 until the production ship. Next free number is 474. Another session may take it first. Check `ls db/migrations` right before writing. |
| `src/security/rls-shape.test.mjs`, `superuser-guard.test.mjs` | See F13. | New tables get no static check. Guard 7 below adds one. |
| `src/http/read-endpoints-org-scope.test.mjs` | Every `api/read/*.mjs` reads scoped to the caller's company (`:1-50`). | A staff read at `api/read/pulse*.mjs` must scope by org. Beat rows carry `org_id`. |
| `src/http/auth-gate.test.mjs` | No caller passes `roles` to `requireAuth` (`:50-70`). | A new staff route must use `requireAuth` then `requireRole`. |
| `scripts/lint.mjs` | Syntax parse of every `.mjs` under `src scripts api netlify db public extension`. No style rules. | Nothing, other than a syntax error. |
| `.claude/settings.json` | Deny: `Edit/Write(docs/journeys/*-intended.md)`, `git push --force*`, `git push -f*`, `git reset --hard*`, `git clean -fd*`, `rm -rf*`, `npm publish*`, `vercel --prod*`. A PreToolUse hook blocks `*-intended.md`. A Stop hook runs `npm run lint` (and `tsc` if typescript is a dependency) and returns exit 2 if they fail. A SessionStart hook injects "MANDATORY FIRST STEP... propose a split... STOP and wait for approval". `.claude/settings.local.json` allows Bash, Read, Write, Edit. | See risk R3 for the fixer session. |
| `.github/workflows/tests.yml` | Runs `npm run lint`, `npm test`, a named-guards step (`:127-140`), and the `fundhub_app` guards. | Add the new guard files to the named-guards step so a failure names its class. |

## 3. The guards the new standard needs

Naming rule that fixes a clash with the board's file table: a beat file is `src/pulse/beats/beat-<id>.mjs`. Helpers in the same folder (`alerts.mjs`, `transport.mjs`, `coverage.mjs`, `index.mjs`) do not start with `beat-`. The disk-equals-list test then scans on the `beat-` prefix, exactly like `modules.test.mjs:11-15` does for `slice-` and `gap-`.

### Guard 1. Every money or customer surface names a beat (or a written reason)

Files:
- `src/pulse/beats/coverage.mjs` exports `BEAT_COVERAGE` (surface key to `{ beat: "<id>" }`) and `NO_BEAT` (surface key to a reason of 40+ characters).
- `src/pulse/beats/coverage-baseline.json`: the `TRIPWIRES` keys not yet decided.
- `src/pulse/beats/coverage.test.mjs`: the test. Same pattern as `tripwires.test.mjs`.

Why a separate file and not a new field on the 37 rows: no edit to existing data, and the baseline pattern copies `tripwires-baseline.json` plus `BASELINE_MAX`.

Assertions:
1. Every key of `TRIPWIRES` is in exactly one of `BEAT_COVERAGE`, `NO_BEAT`, or the baseline.
2. Every beat id in `BEAT_COVERAGE` exists in `BEATS` (from `index.mjs`), and that beat lists the surface in its `surfaces`. The reverse is also checked, so the two sides cannot disagree.
3. Baseline keys all exist in `TRIPWIRES` (no stale), and none also has a beat or a reason.
4. `BEAT_BASELINE_MAX = 26`. Never raise it. A new `TRIPWIRES` row that is not in the baseline fails until it has a beat or a reason. Putting it on the baseline would exceed 26.
5. `NO_BEAT` reasons are 40+ characters and name why a beat cannot run, not "later".

Known loophole, same as the existing baseline: someone can drop one entry and add another and the count stays 26. Cheap fix: freeze the 26 starting keys as a literal array in the test and require baseline is a subset of it.

Phase-in tonight, without failing 37 entries. 11 get a beat now, 26 go on the baseline:

| Beat (board's first list) | Surfaces named now |
|---|---|
| `commas-webhook` | `job:commas-inbox-drain` (and the new door key from Guard 1b) |
| `lead-capture` | `route:public/survey-submit`, `route:public/slo-interest` |
| `checkout-mint` | `route:public/slo-checkout`, `route:payment-links` |
| `booking` | `route:bookings` |
| `sign-in-link` | `route:auth/magic-link`, `route:auth/magic-link-verify`, `route:auth/send-portal-link`, `page:portal-login.html` |
| `send-path` | `job:message-dispatch-sweeper` |

Baseline (26): pages `roadmap/pay.html`, `roadmap/index.html`, `roadmap/pull.html`, `progress.html`; desks `soft-pull-approve.html`, `client-portal.html`; routes `soft-pull-approve`, `public/slo-pull`, `read/portal-summary`, `read/client-progress`, `read/entitlements`, `contracts/sign`, `documents-upload`, `consent/capture`; 12 jobs (`s-01`, `s-02`, `slo-genuine-followup`, `slo-no-reply-197`, `slo-genuine-checkout-sms`, `slo-infinite-drip`, `c-00-crs-soft-pull-request`, `slo-paid-form-nudge`, `slo-pack-delivery`, `s-00-welcome`, `s-04-call-booked`, `s-04b-booking-reminders`).

Ratchet order for later: static pages and read routes first (a GET plus a content check, cheap), then the Inngest jobs. Jobs fired by an event run in the job cloud, outside any rollback. Decide per job whether it gets a `NO_BEAT` reason or a beat that calls the job's own `handle` against the rolled-back client, as the Journey Runner does (F10).

Guard 1b (needed so the first beat is not invisible, F3): extend `surfaces()` (copy it into `src/pulse/surfaces.mjs` and import it from both tests, so two copies cannot drift) with `route:webhooks/<provider>` for each provider in the router's table. Sort each new key into `TRIPWIRES` (Commas: checks `payments:commas-inbox-waiting`, `payments:paid-no-entitlement`) or `NOT_CUSTOMER_FACING`. Today this fails on every provider key until sorted.

Guard 1c (F4): in `tripwires.test.mjs:44-48`, exclude `tripwires.mjs` from `pulseSource()`. One line, and the id-exists test starts meaning something. Not part of tonight's scope unless Chris wants it; I only report it.

What it fails on today: the module does not exist, so the file fails at import. Once written with the table above, it passes tonight (26 baseline, 11 sorted). It fails on the first new `TRIPWIRES` row without a beat.

### Guard 2. Every beat is complete, unique and on the literal list

Files: `src/pulse/beats/index.mjs` (the literal list) and `src/pulse/beats/beats.test.mjs`.

`index.mjs` shape, copying `coverage/modules.mjs`:
```js
export const BEAT_FILES = Object.freeze([
  ["beat-commas-webhook.mjs", () => import("./beat-commas-webhook.mjs")],
  // one line per beat, literal import, so the bundler packs it
]);
```
Each beat module exports: `id`, `surfaces` (array of surface keys), `doors` (route keys it fires, for Guard 3), `steps` (array of step names), `fixGuide`, `run(ctx)`, and `selfTest = { pass(), fail() }` (each returns a fake `ctx`).

Assertions, all in one file, no database:
1. Disk = list: files starting `beat-` equal `BEAT_FILES` names, each a literal `() => import("./name")` (same two checks as `modules.test.mjs:17-36`).
2. `id` matches `/^[a-z0-9-]+$/`, equals the file name between `beat-` and `.mjs`, is unique across beats, and does not start with `reg:` or `job:` or equal an existing job name in `JOBS` (it is the key of `pulse_incidents`, and the ping ids use those prefixes in `tripwires.mjs:31-33`).
3. `fixGuide`: a string of at least 300 characters, with the words "Likely causes" and "Steps" present, at least 2 bullet lines under each, and at least one repo path matching `/(src|api|netlify)\/[\w./-]+\.mjs/`. A length floor alone passes filler. The structure forces a real guide.
4. A PASS test and a FAIL test, enforced for every beat by a generic harness:
   - `await run(selfTest.pass())` returns `{ ok: true }`.
   - `await run(selfTest.fail())` returns `{ ok: false, step, detail }` with `step` in `steps` and `detail` non-empty.
   - Each run resolves in under 2 seconds against its fake context (speed budget).
   - A sibling `beat-<id>.test.mjs` file exists (fs check), so the beat also has its own deeper tests.
   Reason for the harness: a beat that cannot go red is a dead alarm. This is the single most important check in this guard.
5. A green needs proof. The FAIL fixtures must include "door answers 200 but returns no pulse receipt" and "door answers 200 and receipt says `committed > 0`". Both must be red. Otherwise a refused or live-processed request looks green.
6. Every surface in `surfaces` exists in `surfaces()` (no stale), and every `doors` entry is a `ROUTES` key or a provider key.
7. The runner imports the list: `netlify/functions/pulse-hourly.mjs` source contains `../../src/pulse/beats/index.mjs`. A folder scan would ship empty (ship trap 4).
8. Beats do no I/O of their own: no `fetch(`, `fetchImpl(`, `ctx.fetch`, `pool(`, `import ... db.mjs` in any `beat-*.mjs`. Everything goes through `ctx.http` and `ctx.db` (see Guard 6).

What it fails on today: import error (no `index.mjs`). The first time a builder adds a beat without a FAIL fixture, it fails at assertion 4.

### Guard 3. A door refuses the pulse header unless it opted in

Files: `src/http/pulse-switch.mjs` (the verifier and `PULSE_DOORS`, a literal map of opted-in route keys) and `src/http/pulse-switch.test.mjs`.

Design change from the board (line 51 says a wrong or old signature is "a normal request"): any request that carries `x-fundhub-pulse` and does not verify is refused (401, `pulse_signature_invalid`) and the handler never runs. Same if `PULSE_SECRET` is unset on the door. Reason: the runner's signal is made up. If the secret drifts between the runner and the door (rotated on one side, missing in a deploy context), "treat it as normal" would store a fake lead and send a real text to the fake person's phone. Refusing makes that drift a red beat, which is the right outcome.

The gate must sit in `netlify/functions/api.mjs` before the route lookup, and before the `path === "inngest"` short circuit at `:1448`. Otherwise `/api/inngest` and the prefix routes slip past it.

Tests (unit, no database; set `process.env.PULSE_SECRET` in the test):
1. Walk every key of `ROUTES` (323 today) plus `inngest`, `webhooks/commas`, `documents/x`. Replace each `ROUTES[key]` with a spy (the table is a mutable object and is read at call time, which is how my scratch run proved F2). Send a correctly signed header with POST and with GET. For keys not in `PULSE_DOORS`: assert the spy was never called, status is 4xx, and body error is `pulse_not_supported`.
2. Walk the same set with bad headers: wrong signature, signed 6 minutes ago, signed 10 minutes in the future, empty value, secret unset. Assert zero spy calls on every route, opted-in ones included, and 401.
3. Bind the signature to what it authorizes. Sign over `${ts}.${METHOD}.${path}.${sha256(body)}`. A header signed for door A, replayed at door B or with a changed body, is refused.
4. The handler never sees the header: for a non-pulse request nothing changes, and `req.headers["x-fundhub-pulse"]` is removed before an opted-in handler is called, so a handler cannot read it as a flag.
5. Two-way list: every `PULSE_DOORS` key is a real route and is named in some beat's `doors`. Every beat `doors` entry is in `PULSE_DOORS`. An opted-in door with no beat is dead surface. A beat aimed at a closed door is always red.
6. Opt-in is explicit and reviewed: `PULSE_DOORS` values carry `{ reason, db: "ctx"|"deps"|"pool-seam" }`, and each reason is 40+ characters (same style as `ALLOWED_UNROUTED`, `routes.test.mjs:146-153`).

What it fails on today: all of it. F2 shows 323 of 323 routes call the handler when the header is present, so assertion 1 would report 323 failures against the current adapter.

### Guard 4. Pulse mode cannot persist (cannot save, cannot send)

Files: `src/http/pulse-no-persist.test.mjs` and a fake kit `src/pulse/fake-sinks.mjs` (fake pool, fake outbound, fake job cloud).

What the code must provide so this can be tested (the seam). One request-scoped store (AsyncLocalStorage, no new dependency) set by the pulse switch. When it is on:
- `pool()` (`src/db.mjs:29`) returns one checked-out client for the whole request, started with `BEGIN`. `db.query` (`:76`) uses that client. Any `COMMIT` text is turned into a no-op that logs, never sent. `ROLLBACK` runs in a `finally`, and the client is released with `release(true)` if the rollback itself fails. This covers `withTransaction` (F6), because it asks `pool().connect()`.
- `src/events/bus.mjs:49` treats pulse mode as `skipInngest` (F8a). Messages go to the capture list.
- `src/lib/outbound-fetch.mjs` `fenceHold` (`:206`) returns `held("pulse")` and records `{ url, method, fence }`, so the fenced providers capture instead of send.
- `globalThis.fetch` is wrapped once at load. In pulse mode it records and throws `PulseNetworkRefused`. This is the safety net for the ~40 raw-fetch modules and for Blobs and wake POSTs (F8b-d).
- The runner writes its own result rows (`pulse_beats`, `pulse_incidents`) on a separate, committed connection. The door's rolled-back client never receives them.

Assertions, for every key in `PULSE_DOORS`, with a request built by the door's beat `selfTest`:
1. Statement log: exactly one client; first statement `BEGIN`; no `COMMIT`; last statement `ROLLBACK`; the client was released once.
2. Every `SET` is `SET LOCAL` or `set_config(..., true)`. A bare `SET` fails (it leaks across the shared pooler; see memory `pooler-session-set-leaks`).
3. Real network calls: 0. The global fetch is replaced by a throwing spy and must record 0 real calls. Captured sends are allowed and counted. For the send doors (`auth/magic-link`, `slo-checkout`) at least 1 captured send is expected, which proves capture works.
4. `inngest.send` spy: 0 calls, with `INNGEST_EVENT_KEY` set to a dummy for the test (that is the production condition).
5. After the response: await a few `setImmediate` turns plus the pulse context's `settled()` promise, then re-assert 1-4. Doors fire work after answering (`slo-interest` starts a ClickFunnels write and a Meta call in the background, `api/public/slo-interest.mjs:110-139`). A leak after the response is the likely one.
6. Negative control, so the test cannot pass by being blind: a fixture "leaky door" that commits through `pool().connect()`, one that calls `withTransaction(db, ...)`, one that calls raw `fetch`, and one that sends an Inngest event. Each must be caught: `PulseCommitRefused`, `PulseNetworkRefused`, or an assertion failure. If the harness passes a leaky fixture, the test fails.
7. Throw path: a handler that throws still ends with `ROLLBACK` and a released client.
8. Static pins (they make a new bypass a reviewed decision):
   - `new Pool(` / `new Client(` only in `src/db.mjs` and `src/testing/rls-pool.mjs` (2 files today).
   - The set of files importing `pool` from `db.mjs` equals a literal list (21 today). A new importer must be added by name.
   - `@netlify/blobs` only in `src/documents/store.mjs` and `src/documents/wire-netlify-blobs-runtime.mjs` (plus `src/verification/fixtures.mjs`), and any door that reaches it is not opted in until Blobs has a pulse trap.
9. A pg test (skips without `DATABASE_URL`, runs in CI): fire an opted-in door in pulse mode against the scratch database as `fundhub_app`. Count rows in every table before and after: 0 difference. Sequences are the one expected change (F8e). The test records `client_code_seq` and asserts only that the known list of `nextval` functions (4 today) has not grown. It must not run against production (`scratch-guard.mjs` rule, CLAUDE.md section 12).

What it fails on today: nothing exists to run, so it fails at import. Against the current code, assertions 1, 4 and 6 would fail on `withTransaction` doors and on `slo-interest`, which proves the seam has to reach `pool()` and the job cloud, not just `db.query`.

### Guards that follow from the first four

5. Runner contract. `src/pulse/hourly.test.mjs`: with no `PULSE_SECRET` and no `DATABASE_URL`, the default export fires no request and returns a `Response` 200 or nothing (the existing `scheduled-functions-return.test.mjs:60-107` child run enforces part of this once the name is added to its list at `:41-57`). Default export only (no `export const handler`; no `netlify/functions/*.mjs` has one today, and a named const handler fails function creation when site env passes 4 KB). A crash calls `noteScheduledRun(db, "pulse-hourly", { ok: false })`. Calling the runner twice in the same hour sends one text per beat (Netlify retries a failed scheduled run, `scheduled-functions-return.test.mjs:1-20`); key the alert on `(beat_id, hour bucket)`.
6. One transport. Only `src/pulse/beats/transport.mjs` may fetch. Test greps all `src/pulse/beats/*` and `netlify/functions/pulse-hourly.mjs` for the `NETWORK_TOKENS` list and fails on any other file. The transport has one `ALLOWED_RAW_FETCH` entry with a reason (copy `ad-video-sweeper`, `no-unfenced-transmit.test.mjs:68-76`). Its tests: host is in `{fundhub.ai, apply.fundhub.ai}` for pulse POSTs; bank Apply checks are GET or HEAD only; a POST without the signed header is refused. Beats call `ctx.http`, not `fetch`.
7. Pulse tables. A static test (`src/pulse/pulse-tables.test.mjs`) reads the migration SQL: each new table has `ENABLE ROW LEVEL SECURITY`, `FORCE ROW LEVEL SECURITY`, `CREATE POLICY`, `org_id` not null, and the staff scope the other tables use. A pg twin checks the catalog. The unique index "one open incident per beat" exists. Closing an incident requires `cause_category` and `fix_summary`; allowed values include `unknown` and `transient`. A closed incident with `unknown` older than a day is listed in the morning pulse. `docs/lessons/` does not exist today, so the fixer's first PR creates `docs/lessons/pulse-lessons.md`.
8. Standard and wiring. Add the beat clause to `.claude/rules/heartbeat-on-every-build.md` and `.cursor/rules/heartbeat-on-every-build.mdc` (both must keep "3 times its schedule", `heartbeat-law.test.mjs:21`), plus one owner-set line in `CLAUDE.md`. Add `PULSE_SECRET` to `.env.example` by name. Add the new test files to the named-guards step in `.github/workflows/tests.yml`.
9. Watchdog for the watcher. Nothing outside the 6 a.m. job reads `pulse-hourly`'s own heartbeat (F12). `pulse-instant-watch` (every 5 minutes) should read the newest `pulse_beats.ran_at` and text if older than 3 hours, with a test for it.

## 4. Order that avoids a red build mid-way

1. Fix or ack F1 first (that is not this area's job; `ALLOWED_RAW_FETCH` entries for the two pulse files). Otherwise every pulse change inherits a red guard and nobody can tell old red from new red.
2. Contract (workflow 0): `pulse-switch.mjs`, the db/bus/outbound seam, the migration plus `npm run migrations:manifest`, `PULSE_DOORS`, `index.mjs` with an empty list, and Guards 2, 3, 4 and 7 written first against fakes. An empty `BEAT_FILES` is valid.
3. Each beat agent adds one `beat-*.mjs`, one test file, one `index.mjs` line, one `BEAT_COVERAGE` row, one `PULSE_DOORS` row.
4. Runner (workflow 1): `netlify.toml` block, `NETLIFY_JOBS` row, name in `scheduled-functions-return.test.mjs:41-57`, `noteScheduledRun` literal, the `ALLOWED_RAW_FETCH` entry for the transport, and `SEND_PATHS` untouched if it reuses `notify.mjs`.
5. Last: Guard 1 with the 26-key baseline, then the rule text.

## 5. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| R1. A wrong signature treated as a normal request makes the fake lead real and texts a real phone | high | Refuse any request that carries the header and fails (Guard 3, assertion 2). Change board line 51. |
| R2. Rollback cannot recall side doors: second connection (`pool()`, 21 importers), job cloud, raw fetch, Blobs, own-deploy wake, sequences | high | Seam on `pool()` and `bus.mjs:49`, global fetch trap, negative-control fixtures, static pins (Guard 4). Do not opt in `documents-upload` until Blobs is trapped. |
| R3. A fixer session started by a GitHub issue gets the SessionStart text "propose a split... STOP and wait for approval" (`.claude/settings.json` hook), and `CLAUDE.md` section 0 and section 3 say wait for a go. It would stall on its own prompt. The Stop hook also blocks ending the turn while lint fails. | high | The routine prompt must say the owner has pre-approved the pulse-fixer flow. Only Chris can waive section 0 for it; that is his call, not mine. The fixer must not use `scripts/github-push-whole-repo.mjs` (it pushes main with `--force-with-lease`, board leftover). |
| R4. Every pulse that makes a client burns an `FH-` client code | medium | Beats pass an explicit `client_code` such as `FH-PULSE`, if the door allows it; otherwise accept the gap and say so. The pg test pins the count of `nextval` functions. |
| R5. `no-unfenced-transmit.test.mjs` is red on main (F1) | medium | Someone owns adding the two pulse files to `ALLOWED_RAW_FETCH` with reasons. |
| R6. Tripwire check-id test is partly vacuous (F4) and the payment webhook door has no tripwire row (F3) | medium | Guard 1b and 1c. |
| R7. Netlify retries a failed scheduled run, so a crash can text twice | medium | Alert key on `(beat_id, hour)`; runner always answers 200. |
| R8. Pulse death is only seen at 6 a.m. (F12) | medium | Guard 9. |
| R9. Migration number collision on 474 with a parallel session | low | `ls db/migrations` right before writing; run `npm run migrations:manifest`. |

## 6. Unknowns (looked, could not settle)

- Whether `PULSE_SECRET` exists on Netlify. Names only can be listed; it is not in the laptop `.env` or `.env.example`.
- Whether production has `ADAPTERS_DRY_RUN` set to an off value. If unset, the fence holds the GitHub issue provider and the pulse text path using `ADAPTERS` (`src/lib/dry-run.mjs`: unset means blocked). The name exists in the laptop `.env`; the value was not read.
- The board says pulse rows are "kept 30 days" and deleted by the runner. Migration 430's header says retention is a "delete data" decision nobody made, and section 11 says delete-data asks first. The Owner answers table has no retention answer. Treat 30 days as unconfirmed.
- Whether the runner calls doors over HTTP (real edge, costs `ALLOWED_RAW_FETCH` plus transport guards) or imports the `api.mjs` handler in-process (faster; needs the fontkit and pg imports, and no real routing). Guards 3 and 4 work for both. Guard 6 only applies to the HTTP case.
- Whether any other door calls `withTransaction` on the shared db in a way that matters for a first-night beat. I counted files, not call graphs. The negative-control fixtures and the per-door run in Guard 4 settle it for each opted-in door.
