# 02 — Escape hatches: what could leak out of a rolled-back, no-send pulse

Area owner: grounding reader 2 of 6. Read-only study, 2026-10-09. Board: `ops/workflows/pulse-layer-2026-10-09.md`.
Every fact has a file and line. "Measured" means I ran it on this Mac against the live database (read-only, always rolled back) or in Node 22.23.2. "Not verified" means I could not prove it from the repo.

## In plain words

A pulse must touch nothing real. There are four doors a pulse could leak out of. Door one is the database. Door two is the network (texts, emails, vendor calls). Door three is events and background jobs. Door four is files and caches.

Good news: each door has one narrow place where all traffic passes. All database traffic passes `pool()` in `src/db.mjs`. Nearly all vendor traffic passes `fenceHold()` in `src/lib/outbound-fetch.mjs`, and the rest passes `globalThis.fetch`. Only one place sends events to Inngest in a way that skips the fetch patch: the Inngest client keeps its own copy of `fetch` from the day it loads.

Bad news: the old "dry-run" switches do NOT protect us. In the `.env` on this Mac both `MESSAGING_DRY_RUN` and `ADAPTERS_DRY_RUN` are `0`, which means "send for real". The fence is open. So the pulse needs its own lock, and the lock must fail CLOSED: if the pulse loses track of itself, the answer must be "refuse", never "send".

The safest plan: run the pulse inside its own Netlify scheduled function (a process that never serves real customers), and install the locks only in that process. Then the live API files do not change at all, and the real site cannot slow down. If we instead send the pulse over HTTP into the live `/api` function, we must edit five live files, the lock can only fail open, and a slip can write or send for real.

## 0. The two ways to run a beat (this decides everything below)

| | Mode A — in-process | Mode B — HTTP into the live `/api` function |
|---|---|---|
| How | `pulse-hourly` imports `netlify/functions/api.mjs` and calls its default export `handler(request, context)` (line 1439) with a `Request` that carries the pulse header, inside `pulseStore.run(...)`. | A beat does `fetch("https://fundhub.ai/api/...")` with the signed header. The live lambda sees the header and starts the pulse context itself. |
| Exercises | Real `ROUTES` map (api.mjs), real auth, real body parsing, real handler. NOT Netlify redirects/edge. | Everything, including redirects and edge. |
| Where locks live | Only in the pulse process (new files). | Inside the shared live lambda (edits to db.mjs, outbound-fetch.mjs, client.mjs, store.mjs, api.mjs). |
| No pulse context | Not applicable to live traffic: nothing is installed in the live process. In the pulse process, "no context" means REFUSE (fail closed). | Must mean "behave as today" — so a lost context silently becomes a REAL write or send (fail open). |
| Cost to live site | Zero. | `getStore()` on every query/fetch, plus async-hook overhead on that instance (section 8). |
| Risk | Cold start of the whole api bundle inside the scheduled function (not measured). | Pulse locks share a process with real customers. |

Recommendation: Mode A for every beat that runs a handler. Keep Mode B only for pure GET reads (bank Apply pages, public pages, `/api/health`), which write nothing and need no lock.

## 1. Database — every path that can write

### 1.1 The map (all measured by grep over `src/ api/ netlify/`, non-test files)

- One pool, built in one place: `src/db.mjs:47` (`new pg.Pool`). `pg` is imported nowhere else in request code (grep: only `src/db.mjs:5` and `src/testing/rls-pool.mjs:30`).
- `DATABASE_URL` is read only at `src/db.mjs:31` in runtime code. (Other hits are error text and the verify harness.)
- The shared handle is `db = { query: (sql, params) => pool().query(sql, params) }` at `src/db.mjs:76-78`. 459 non-test files import `db.mjs`.
- Transactions come from `pool().connect()`. About 20 call sites (grep), all call-time, none at module load: `src/db/with-transaction.mjs:45`, `src/partners/rls.mjs:98` (`withPartnerScope`, default arg `pool = defaultPool` at line 94), `src/banking/{accounts,import,store,plaid-transactions}.mjs`, `src/finance/soft-pulls.mjs:830`, `src/inquiries/work.mjs:333`, `src/auth/authorized-rep.mjs:17`, `src/vsl/watch-store.mjs:90`, `src/ad-videos/token.mjs:107`, `api/commission-rules.mjs:132`, `api/journeys/run.mjs:142`, `api/public/partner-apply.mjs:317,404`, `api/affiliates/refer.mjs:102`, `api/finance/alerts.mjs:536`, `src/demo/simulate-client.mjs:631`.
- Direct `pool()` used as a query handle: `src/banking/plaid-refresh.mjs:260`, `src/liabilities/store.mjs:134`.
- The identity trap: 11 files test `db === sharedDb` and then reach for `pool().connect()` themselves (`src/db/with-transaction.mjs:45`, `src/banking/store.mjs:75`, and nine more). So the choke point must be `pool()` (or the Pool class), NOT `db.query`. Swapping only `db.query` would leave all the `connect()` sites on the real pool.
- The client surface the repo uses is tiny: `query(sql, params)`, `connect()`, `release()`. I grepped for `escapeLiteral`, `.on(`, named/rowMode queries, `COPY`, `LISTEN`: none in request code. A facade needs only those three.
- Second pool: `src/testing/rls-pool.mjs:53` builds `new pg.Pool` from `APP_DATABASE_URL`. Not on the request path: the only non-test file that mentions it is a comment at `src/http/partner-read-api.mjs:66`. `APP_DATABASE_URL` is not in this Mac's `.env`; its Netlify value is not verified.

### 1.2 Choke point for the database

ONE choke point: `pool()` / the `pg.Pool` instance.

Design P (recommended, zero edits to live files): the pulse process patches `pg.Pool.prototype.query` and `pg.Pool.prototype.connect` once at start. Measured: pg is 8.22.0, `Pool.prototype` has no own `query`, assigning one is seen by `new Pool()` instances (test printed `patchedProtoSeenByInstance: true`). About 60 new lines in a new file, 0 lines changed elsewhere.

Design M (needed only for Mode B): `src/db.mjs:29`, function `pool()`. Add one import and `const s = pulseStore.getStore(); if (s?.pool) return s.pool;` as the first line. 3 to 4 lines. No store: falls through to the existing body unchanged.

What the facade does, inside the pulse:
1. At pulse start, take ONE dedicated `pg.Client` (not a pool slot), `BEGIN`, then `SET LOCAL statement_timeout='5s'`, `SET LOCAL lock_timeout='2s'`, `SET LOCAL idle_in_transaction_session_timeout='15s'`, `SET LOCAL transaction_timeout='20s'`. Measured on the live database: PG 17.6, `transaction_timeout` exists but is `0`, and `lock_timeout` is `0`, meaning a pulse blocked on a lock waits forever. Use `SET LOCAL` only: the laptop `DATABASE_URL` is port 6543 (transaction-mode pooler), where a bare `SET` leaks to other clients (known trap, see memory "Pooler SET leaks").
2. `query()` forwards to that one connection. `connect()` returns a thin client on the same connection whose `release()` does nothing.
3. Translate transaction words, never send them: `BEGIN` becomes `SAVEPOINT pulse_n`, `COMMIT` becomes `RELEASE SAVEPOINT`, `ROLLBACK` becomes `ROLLBACK TO SAVEPOINT`. Refuse outright: a `COMMIT`/`END`/`PREPARE TRANSACTION`/`COMMIT PREPARED`/`DISCARD`/`LISTEN`/`COPY` the facade did not translate. Grep found no multi-statement `BEGIN; ... COMMIT;` strings in request code, so a plain first-keyword check is enough.
4. The ONLY `ROLLBACK` sent on the real connection is the runner's own, in a `finally`, and then `client.end()` (destroy, never return to a pool). A crash cannot commit: Postgres rolls back an open transaction when the socket dies.
5. Mark the store `closed = true` before rollback. After that every query on the facade rejects ("pulse closed"). This is what makes work that outlives the beat fail closed (section 6).

### 1.3 Database things the rollback does NOT undo or that the facade distorts

Measured on the live database (read-only probe, all rolled back):

- Local settings survive `RELEASE SAVEPOINT`: `set_config('fundhub.pulse_probe','leaked',true)` was still `leaked` after release. The repo sets four such settings: `fundhub.actor` (11 sites), `fundhub.ad_video_token` (5), `fundhub.vsl_visitor` (1), `fundhub.partner_id` (1). In production each `COMMIT` ends them; in a pulse they would leak into the next "transaction" and a later unscoped query would see staff-level rows: a false green. Fix: when the facade turns the outermost `COMMIT` into a release, also run `SELECT set_config(...,'',true)` for those four names. One extra round trip per logical transaction.
- A caught error poisons the transaction: after `SELECT 1/0` the next plain query failed with `25P02 current transaction is aborted`; `ROLLBACK TO SAVEPOINT` recovered it (measured). 32 sites in `src/` and `api/` catch a specific SQLSTATE (`23505`, `42P01`, `42703`, `42501`) and carry on (for example `src/contracts/templates.mjs`, `src/shifts/store.mjs`, `src/sales/offer-stack.mjs`, `api/finance/subscriptions.mjs`, `api/content/tiles.mjs`, `src/marketing/http.mjs`). Without a savepoint around those statements the pulse reports a false failure. Cost, measured from this Mac: connect 300 ms, `SELECT 1` 44 ms, savepoint-wrapped `SELECT` 133 ms. So about +88 ms per wrapped statement. Wrap writes only; Netlify region and its real round-trip time are not verified.
- Sequences are NOT rolled back. `client_code_seq` (`db/migrations/012_attribution.sql:60`, trigger at 63-71) hands out `FH-000123` on every client insert. A pulse that inserts a client burns a visible number. Same for `affiliate_tracking_seq` (`db/migrations/033_affiliates.sql:123-128`) and `employee_code_seq` (012:26). The trigger skips `nextval` when `NEW.client_code` is already set, so a beat can pass its own `client_code` (for example `FH-PULSE-<run>`) and burn nothing.
- Locks held until rollback block real customers. Eight call sites take `pg_advisory_xact_lock` keyed on the live org id: `src/marketing/clock.mjs:281`, `worker.mjs:191`, `shoot-store.mjs:350`, `http.mjs:176`, `funnel-store.mjs:120`, `flywheel/store.mjs:28`, `src/finance/money-transfers-store.mjs:404`, `src/finance/soft-pulls.mjs:560`. A pulse that runs one of those holds the key for its whole life, and a real request on the same org waits. The same is true of any row a pulse updates and any unique key it inserts. The `lock_timeout` above only bounds the pulse's own waiting, not a real request waiting on the pulse. Keep every pulse transaction under about 3 seconds and give each beat its own identities (email, phone, idempotency key built from the run id).
- Connection pinning: `max_connections` is 60, 17 in use, 5 of them `fundhub_app` (measured). The laptop `DATABASE_URL` goes through a transaction pooler (port 6543). Each open pulse transaction pins one backend. Cap pulse concurrency (I suggest 3 to 4 at once), not "all beats at once", or a pulse can starve real logins. Supavisor pool size is not verified.
- Role is right: the app role is `fundhub_app`, not superuser, no `bypassrls` (measured), so row security applies inside a pulse exactly as for customers. The pulse must connect with the same `DATABASE_URL`.
- Nothing hides in the database itself (measured): extensions are `btree_gist, pg_stat_statements, pg_trgm, pgcrypto, plpgsql, supabase_vault, uuid-ossp, vector`. No `pg_net`, no `dblink`, no `pg_cron`. 341 triggers, none whose body mentions `net.http`, `pg_notify`, or `dblink`. One publication, `supabase_realtime` (WAL based, so it only fires on commit). `db/` has no `pg_notify(` call. Advisory locks in app code are all the transaction-scoped form; no session locks (measured 0 advisory locks now).

## 2. Outbound requests

### 2.1 The map

- The typed choke point is `src/lib/outbound-fetch.mjs`. Both `transmit()` (line 228) and `transmitBinary()` (line 356) call `fenceHold()` (line 206) first, at lines 237 and 365, then pick `fetchImpl || globalThis.fetch` (lines 240, 376). `postJsonTo` (504), `postFormTo` (513) and `postBinaryTo` (469) all end in `transmit`.
- Every message provider routes through it. Checked by reading each file in `src/messaging/providers/`: twilio, twilio-whatsapp, resend, mailgun, ntfy, web-push, bland-voice, mail-letter via `postJson` in `http.mjs:57-78` (fence MESSAGING); clickfunnels-pages, github-repo, google-drive-write, meta-capi, submagic, crs-softview via `transmit/postJsonTo` (fence ADAPTERS). `ghl-relay.mjs`, `internal.mjs`, `memory.mjs` declare `TRANSMITS=false`.
- 27 non-test files import the chokepoint, including `src/adapters/lendflow.mjs`, `src/banking/providers/plaid-http.mjs`, `src/merchant/providers/http.mjs`, `src/hiring/zoho.mjs`, `src/messaging/crm-contacts.mjs`, `src/repair/send.mjs`, `src/repo/outbox.mjs`.
- `INTERNAL` fence (line 52) is NOT held by the dry-run flags and is used by `embed.mjs`, `transcribe.mjs`, `calendar-freebusy.mjs`, `black-report-pdf.mjs` (pinned list at `src/lib/no-unfenced-transmit.test.mjs:286`). `black-report-pdf` sends a client's underwriting data to the render container. A pulse hold must sit above the fence check so it covers INTERNAL too.
- Raw callers that skip the fence: 69 files match the fetch tokens; after removing the 17 `src/pulse/coverage/*` read lanes and the chokepoint, the allow-list in the structural test (`ALLOWED_RAW_FETCH`, `src/lib/no-unfenced-transmit.test.mjs:67-278`) covers the rest. The ones that can change something real: `src/adplatforms/_api.mjs` and `tiktok.mjs` ("UNFENCED SPEND"), `src/creative/providers/_http.mjs` (paid generation), `src/social/adapters.mjs`, `src/social/oauth.mjs`, `src/hiring/linkedin.mjs`, `src/agents/model.mjs` (Anthropic: spends money), `src/workflows/c-06-crs-results-router.mjs` and `ds-02-diy-letters.mjs` (POST letter delivery), `src/marketing/wake.mjs`, `offer-transport.mjs`, `funnel-transport.mjs`, `netlify/functions/ad-video-sweeper.mjs` (POST to our own deploy to wake a worker), `src/adapters/clarity-export.mjs` (capped at 10 calls a day by law; a pulse must never spend that quota).
- Defaults are call-time, not load-time: I grepped for module-level captures of `fetch` (`const f = fetch`, `fetch.bind`, `x === globalThis.fetch`): none in repo code. `wake.mjs:54` is `fetchImpl || globalThis.fetch` inside the function. So replacing `globalThis.fetch` is seen by the repo's own code.
- Not seen by a `globalThis.fetch` patch: the Inngest client. `node_modules/inngest/helpers/env.js:340` does `fetch.bind(globalThis)` and `components/Inngest.js:151` stores it at construction (inngest 3.54.2). `src/workflows/client.mjs:14` constructs it at import. So a later patch does not catch `inngest.send`. Section 3.
- `@netlify/blobs` 10.7.11 reads `this.fetch = fetch ?? globalThis.fetch` when a client is built (`dist/chunk-YAGWSQMB.js:195`), which happens at call time. Fine, but the store level choke (section 4) is safer.
- Non-fetch egress: `src/adapters/oxylabs.mjs:197,226` uses `node:http`/`node:https` (proxy tunnel, reached from `api/proxy/launch.mjs`, not from any beat I can name). `child_process` in six files (`src/ad-videos/merge-takes-media.mjs`, `src/agents/claude-code.mjs`, `src/company-brain/{hormozi-kb,local-whisper,meet-local-whisper}.mjs`, `src/underwrite/black-report-pdf.mjs`): ffmpeg, whisper and the `claude` CLI. None is a request-path door.

### 2.2 Choke points for outbound (layered, because one layer is not enough)

L1 — typed hold, `src/lib/outbound-fetch.mjs`, in `transmit()` after line 237 and `transmitBinary()` after line 365. 2 lines each plus 1 import. If a pulse store is present: record `{url, method, headers, body, fence, what}` on the store, return a fixture result `{ok:true, blocked:false, transmitted:false, captured:true, status, body}`. `transmitted:false` is true by the file's own definition (line 183 comment). No store: unchanged. (Design M only. Not needed in Design P because L2 catches the same calls and returns a richer fake response.)

L2 — the universal backstop, replace `globalThis.fetch` with an ALS-aware function, about 35 lines in a new file. With a store in mode "pulse": record the request, answer from the beat's fixture table (match by host and path, for example Twilio gives `{sid}`), or answer `599` for an unknown host so the beat FAILS LOUD instead of passing silently. Allow a real call only when the beat declared it in `store.allowReads` and the method is GET or HEAD (bank Apply pages, the existing `gap-*` read lanes). With a store in mode "real" (the runner's own text to Chris, its GitHub issue): pass straight through. No store: in the pulse process, refuse; elsewhere this wrapper is never installed. It must return the original promise (no `async` wrapper) so behavior is identical.
  - This covers every fenced caller too, because they end in `doFetch = fetchImpl || globalThis.fetch`. It also covers `wake.mjs`, `offer-transport.mjs`, `funnel-transport.mjs`, `agents/model.mjs`, `climate/connectors.mjs`, the adplatform and social raw callers, `c-06` and `ds-02`.
  - The fence flags are untouched. Do not rely on them: laptop `.env` has both at `0` (open); the production values are not verified.
  - Install order matters: it must run before `src/workflows/client.mjs` loads, or the Inngest copy binds to it by accident. Do not depend on this; section 3 patches `inngest.send` directly anyway.

L3 — the floor, in the pulse process only: replace `net.Socket.prototype.connect`. While a pulse store is active, allow only the database host (parsed from `DATABASE_URL`), refuse everything else. This catches anything that kept its own `fetch`, `node:http(s)` (oxylabs), and any SDK. Caveat: undici may reuse an already-open keep-alive socket and skip `connect()`, so L3 is defense in depth, not a replacement for L2. About 25 lines. Also wrap `http.request/get` and `https.request/get` (about 10 lines) for the same reason.

What the beat sees: an array `store.out = [{url, method, body, fence}]` it can assert on ("the Twilio send would have posted to `/Messages.json` with To=+1555... and this body").

## 3. Events and background jobs

- Event bus, `src/events/bus.mjs`. `emit()` (line 17) inserts into `events` through the `db` it is given (rolled back with the pulse) and then runs every registered handler in-process (`dispatch`, line 112; the call is `await handler(event, db)` at line 120). So real handlers run in a pulse, and any send they trigger must be caught by section 2. The beat can read what was emitted with a plain `SELECT` on `events` inside the same transaction. No change to the bus is needed for capture.
- The only fan-out that leaves the process: `bus.mjs:49-53`, `void inngest.send({...}).catch(() => {})`, gated on `process.env.INNGEST_EVENT_KEY`.
- A second direct sender exists: `api/public/slo-interest.mjs:375-380` (same pattern, used when `deps.fanout` is not supplied). These two are the only `inngest.send` calls in non-test code (grep). `step.sendEvent` appears nowhere outside Inngest function bodies, which run under `/api/inngest`, never in a pulse.
- Choke point: wrap `inngest.send`. Design P: the pulse process does `inngest.send = pulseAwareSend` at start (6 lines, new file). Design M: 5 to 6 lines at `src/workflows/client.mjs:14` (after the `new Inngest` line). With a store: push `{name, data}` on `store.events` and resolve. No store: call the original. Do NOT delete `INNGEST_EVENT_KEY` from the environment, even process-locally: owner law says the key stays on and agents never unset it, and a `delete` is easy to confuse with that.
- Rows that act as queues are safe by construction: `messages` rows are written `queued` and only the dispatcher (cron, `src/workflows/message-dispatch-sweeper.mjs`) sends them. The dispatcher runs on a different connection and cannot see an uncommitted pulse row. 10+ files insert `messages` directly (for example `src/handlers/comms.mjs`, `src/contracts/notify.mjs`, `src/invoices/notify.mjs`); same reasoning. The Commas inbox, marketing outbox and dead-letter rows are the same.
- Wake POSTs (`src/marketing/wake.mjs`, `offer-transport.mjs`, `funnel-transport.mjs`) are plain `globalThis.fetch` calls, so L2 catches them. If one slipped through, the worker would wake, find no row (rolled back) and do nothing, but would burn function minutes.

## 4. Files and caches

- Document store. `src/documents/store.mjs`: `createStore().put` (lines 115-126) and `.del` (line 160) are the choke for object writes; the provider is picked in `providerFromEnv()` at line 413 and `storeFromEnv()` at line 435. The laptop `.env` has `DOCUMENT_STORE_PROVIDER=netlify-blobs` (production value not verified), so an uploaded document in a pulse would be a REAL blob write. Design P: set `process.env.DOCUMENT_STORE_PROVIDER='memory'` in the pulse process only (1 line). This changes only that running process; the stored Netlify variable and `NETLIFY_BLOBS_TOKEN` are untouched. Gap: `storeMemoryObjects()` (line 428) is a process-wide Map that is never cleared (private), so pulse documents pile up in memory for the life of a warm lambda. Harmless to customers, small. Design M: 3 lines in `providerFromEnv`.
- Local disk writes in non-test code: `src/repo/outbox.mjs:552-553` (writes into a repo checkout, the marketing machine, not available on Netlify), `src/marketing/filmed-receive.mjs` (laptop upload server), `src/underwrite/black-report-pdf.mjs:285-304` (temp folder, removed after), `src/deliverables/preview.mjs`, `src/verification/report.mjs`, `src/pulse/daily-pulse.mjs:315-317` (writes a board file; the 6 a.m. pulse, not a beat), `src/company-brain/*`, `src/ad-videos/merge-takes-step.mjs`, `src/adapters/clarity-export.mjs`. None is a door a beat should hit. A lambda disk is private and thrown away, so a stray temp file cannot reach a customer.
- In-memory caches that could keep pulse-only data: very few hold database rows. `_orgCache` in `src/events/bus.mjs:169` and `src/auth/org.mjs:7` hold the default org id (real, fine). `src/compliance/screen.mjs:45` caches compliance rules for 60 s per org: only a problem if a beat seeds rules. `src/messaging/template-usage.mjs:46` scan cache. Rule: a beat must not insert rows that a module cache reads, or it must clear that cache. Rate limits are not memory: `src/auth/login.mjs:7,31-70` counts rows in `auth_attempts`, which roll back (so a pulse login cannot lock anyone out, and it also does not exercise the lockout).
- CDN cache (Mode B only): `api/climate.mjs:6` sets `public, s-maxage=900`. A pulse GET to that URL could be cached and served to real visitors. Add a throwaway query string and `Cache-Control: no-cache` on Mode B reads. It is public climate data, so low risk.

## 5. The choke points, one table

Lines are changed lines in an existing file. "Design P" is the process-local version (my recommendation); "Design M" edits live files and is needed only for Mode B.

| # | Category | Where | Function | Design P (new code, existing files edited) | Design M (existing lines changed) | No pulse context |
|---|---|---|---|---|---|---|
| 1 | DB | `src/db.mjs:29` | `pool()` | patch `pg.Pool.prototype.query` and `.connect`, ~60 new lines, 0 edited | +4 | P: nothing installed outside the pulse process, identical. M: `getStore()` returns undefined (0.7 ns measured), falls through. |
| 2 | Outbound, typed | `src/lib/outbound-fetch.mjs:237,365` | `transmit`, `transmitBinary` | none needed (L2 covers) | +5 (2 per function, 1 import) | unchanged |
| 3 | Outbound, universal | `globalThis.fetch` | wrapper | ~35 new lines | +1 import in `netlify/functions/api.mjs` (installs wrapper), ~35 new lines | P: not installed outside pulse. M: pass-through returning the original promise. |
| 4 | Outbound, floor | `net.Socket.prototype.connect`, `http(s).request` | wrapper | ~35 new lines | not recommended in a live lambda | not installed |
| 5 | Events | `src/workflows/client.mjs:14` | `inngest.send` | `inngest.send = ...`, ~6 new lines, 0 edited | +6 | unchanged |
| 6 | Objects | `src/documents/store.mjs:413` | `providerFromEnv` | 1 line of env in the pulse process | +3 | unchanged |
| 7 | Lifecycle | new `src/pulse/guard/context.mjs` | `pulseStore`, `settle()`, `close()` | ~50 new lines | same | n/a |

Total Design P: 0 existing lines edited, about 190 new lines in 3 new files, plus the pulse-hourly first import. Total Design M: about 24 edited lines in 5 live files plus the same new files.

Required test (either design): a structural test like `src/lib/no-unfenced-transmit.test.mjs` that fails the build if a new module reaches the network by a path L2 would not see (a captured `fetch`, `node:http`, `WebSocket`, `child_process` calling `curl`).

## 6. Does the async context survive? (measured in Node 22.23.2, `scratchpad/als.mjs`)

Inside `als.run(store, ...)`, the store was still visible after: `await`, `Promise.all` over timers, `setTimeout`, `await new Response().text()`, `queueMicrotask`, `AbortSignal.timeout` listeners, a deferred promise resolved from OUTSIDE the context, and a detached `void (async () => ...)()` that finished 30 ms after the run returned.

It was LOST for exactly one pattern: a plain event-emitter listener registered inside the run but fired by `emit()` from outside it (printed `NONE`). Nothing in the repo's request path needs that: handlers are plain awaited calls (`api.mjs:1576` `await route(req, res)` inside the same chain; `bus.mjs:120` `await handler(event, db)`). Not verified: context loss through `pg`'s own internals; the facade avoids this because our code awaits the promise we hold, and a promise continuation keeps the context of the `await`.

Work that outlives the request (real examples):
- `api/public/slo-interest.mjs:110-140` `startCfWrite`: a detached async job that, AFTER the response, calls ClickFunnels (`syncSloClickfunnelsContact`) and then `db.query("UPDATE events ...")`. In a pulse, L2 must have captured the ClickFunnels call (otherwise Chris's real ClickFunnels gets a contact), and the later `UPDATE` must hit the closed facade (fail closed). Also `slo-interest.mjs:375` and `bus.mjs:50` `void inngest.send`.
- The detached promises keep the store (measured), so after close they reach the closed facade and reject. They do not fall through to the real pool, if and only if no code path sees "no store" as "use the real one" (this is why the pulse process must refuse on no-store, section 0).
- The runner must wait for quiet before rolling back: `store.inflight` counts open facade queries and captured calls; `settle()` waits until it is 0 across two `setImmediate` ticks, with a hard cap (about 1.5 s). Then `closed = true`, `ROLLBACK`, `end()`.
- Lambda freeze: on AWS Lambda (which Netlify functions use) the process is frozen when the handler returns and thawed for the next invocation. A detached promise from pulse N can resume during pulse N+1 in the same warm container. It still carries store N (closed), so it fails closed. This is platform behavior, not measured here.
- `api.mjs:1568-1588`: `res.json()` resolves the Response early but `return done` only runs after `await route()` settles, so the handler's own awaited work finishes before the beat sees the answer. Only `void` work outlives it.

## 7. Escapes I could NOT cover with a choke point

1. Lost context in a SHARED process (Mode B). The patch must pass through when there is no store, so lost context becomes a real write or send. Only Mode A can fail closed.
2. Interleaved logical transactions on the one pulse connection. `Promise.all([withTransaction(a), withTransaction(b)])` becomes overlapping savepoints; a `RELEASE` of the outer one destroys the inner one. Rare; not grepped exhaustively. A mutex would deadlock on nested `pool().connect()` (the repo does nest), so I did not recommend one.
3. Sequences: `nextval` is never undone (section 1.3). Only avoidable by giving explicit codes.
4. Lock contention with real customers (advisory keys on the live org, hot rows, unique keys). Bounded by time, not prevented.
5. `fetch` use that does not touch `globalThis.fetch` and is not through `net`: none known. A native module or a wasm network call would escape L2 and L3. None exists in `package.json` (deps are `@netlify/blobs, @pdf-lib/fontkit, inngest, pdf-lib, pdfjs-dist, pg`).
6. Keep-alive socket reuse can skip L3. L2 still catches it, so L3 alone is not enough.
7. `child_process` (ffmpeg, whisper, the `claude` CLI) is not intercepted. Not reachable from a beat today. A structural test should keep it so.
8. Third-party side effects of READ probes. The bank Apply beat does real GETs against 365 sites; a GET can still hit a bot wall, count as a visit, or trip a vendor rate limit. Same for any real read of Commas, Twilio, Resend (`gap-keys.mjs`). The only protection is `allowReads` (GET/HEAD, declared host).
9. Quota-limited reads. `src/adapters/clarity-export.mjs` is capped at 10 requests a day by owner law and must be on the L2 deny list.
10. Server-side effects of reads: some GET handlers may write (touch a "last seen" row). That write is rolled back, but anything they send is only caught if it passes L2.
11. Time-based business effects visible to others: none found, since nothing commits.
12. The pulse header itself: a door that has not opted in must refuse it. That check is in another area's brief; from here the point is that Design M leaves the header-parsing code in the live lambda, which is where a mistake would turn into a real write.

## 8. Cost when nothing is happening (measured, Node 22.23.2)

- `AsyncLocalStorage.getStore()` before any `run()` ever happened: 0.7 ns per call.
- After the first `run()` in that process: 15 ns per call, and every `await` in the whole process costs about 75 ns more (1,000,000 awaits: 40 ms before, 112 ms after). It stays that way after the run finishes. `als.disable()` returns it to 40 ms, but calling `disable()` while any pulse can still be alive makes `getStore()` return undefined, which in Design M means "use the real pool". Never call it.
- A real request does a few hundred awaits, so the overhead is microseconds. The point is that Design P keeps it out of the live API lambda altogether; Design M puts it there from the first pulse until that instance dies.

## 9. Facts to carry forward

- `src/lib/no-unfenced-transmit.test.mjs` FAILS on `main` right now: test 2 lists `src/pulse/funnel-doors.mjs` and `src/pulse/instant-watch.mjs` as raw fetchers on no allow-list (ran it: 4 pass, 1 fail, assertion at line 356). So today's "nothing sends except through the fence" guarantee is already not enforced. I did not fix it (not asked); it needs a decision before the pulse adds its own probes.
- The same test's chokepoint check is loose: `usesChokepoint` is `source.includes("lib/outbound-fetch.mjs")` (line 332), so a file that only mentions the path in a comment counts as fenced.
- Any new outbound GET the pulse adds (bank Apply pages, uptime reads) must either go through a module under `src/messaging/providers/` (CLAUDE.md §12) or get an `ALLOWED_RAW_FETCH` line with a written reason, the way `PULSE_GAP_READS` does.
- `PULSE_SECRET` is not in this Mac's `.env` (names grep). Netlify variable names could not be listed from here (the CLI call returned nothing); values were never read.
- Existing prior art for "this SQL must be read-only": `src/pulse/coverage/gap-sales-manager.mjs:159` (`SIDE_EFFECT_FN` regex for `nextval`, `set_config`, `pg_advisory*`, `pg_notify`, `lo_*`, `dblink*`). Reuse its list for the facade's refuse-list.
- `src/verification/fixtures.mjs:75-76` already sets `MESSAGING_DRY_RUN`/`ADAPTERS_DRY_RUN` to `1` process-wide for the verify harness, and `src/verification/scratch-guard.mjs` refuses to run it against production. The pulse must not reuse that harness against the live database (CLAUDE.md §12).
- Measured numbers came from `fundhub_app` over the laptop `DATABASE_URL`: PG 17.6, port 6543, `max_connections` 60. The Netlify function region and the production `DATABASE_URL` port are not verified.
