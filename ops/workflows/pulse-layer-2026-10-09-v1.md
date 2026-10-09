# Pulse v1 — tonight's scope: the read-only half (2026-10-09)

This file CUTS `pulse-layer-2026-10-09-contract.md`. Where the two disagree, this file wins. The contract stays the reference for interfaces, DDL, timeouts, words and states; builders read both.

## Why a cut

The Opus critic (verdict go-with-changes) found 7 high issues. Launch is today. The half of the contract that sends signals through doors that SAVE data needs locks inside the Node process (patched `pg.Pool`, patched `fetch`, Inngest guard, socket floor). It has never run on a real Postgres, and its first run would be against production. So tonight we ship only the part that cannot write or send:

- every beat is `box: false`
- a beat reads data only through `ctx.read`, a facade where Postgres itself refuses writes (`BEGIN READ ONLY`), or reads the web only through `ctx.http` (GET and HEAD)
- no beat can reach a database module, a fetch, a sender or a token

The write-through half (box beats: `lead-survey`, `checkout-mint`, `sign-in-link` round trip, `lead-cf-hook`, a signed receipt through the Commas door) waits until the box is proven on a scratch Postgres and Chris has watched one first run.

## What does NOT happen tonight

- ZERO edits to: `netlify/functions/api.mjs`, `src/db.mjs`, `src/events/bus.mjs`, `src/lib/outbound-fetch.mjs`, `src/adapters/commas.mjs`, `src/pulse/instant-watch.mjs`, `src/pulse/daily-pulse.mjs`, any `api/**` door. No `x-fundhub-pulse` header, no `PULSE_SECRET`, no `PULSE_DOORS`, no `pulse-switch`, no `src/pulse/guard/*`.
- No GitHub issues, no GitHub token, no fixer routine, no GitHub Action. (Open decision for Chris: Issues on a PUBLIC repo are unsafe; pulse issues belong in a private repo.) The alert text carries the fix line instead.
- No deletes. No retention job.
- No new dependency.

## What ships tonight

| Piece | Files |
|---|---|
| F foundation | `src/pulse/beats/contract.mjs`, `ctx.mjs`, `readbox.mjs`, `index.mjs` (literal list), `beats.test.mjs` (Guard 2), `src/messaging/providers/pulse-probe.mjs` (GET/HEAD only), `src/pulse/fake-sinks.mjs`, `scripts/pulse/run-beat.mjs`, tests for each |
| R1 records | `db/migrations/475_pulse_beats_incidents.sql` (or the next free number), `db/expected-migrations.mjs` regenerated, `src/pulse/records.mjs`, tests |
| R2 runner and alerts | `netlify/functions/pulse-hourly.mjs`, `netlify.toml` block, `src/pulse/heartbeats.mjs` NETLIFY_JOBS row, `src/http/scheduled-functions-return.test.mjs`, `src/pulse/runner.mjs`, `src/pulse/alerts.mjs`, `src/pulse/pulse-hourly.test.mjs`, `runner.test.mjs`, `alerts.test.mjs`, `src/pulse/registry.mjs` SEND_PATHS row, `src/pulse/tripwires.mjs` NOT_CUSTOMER_FACING row, `scripts/pulse/prove.mjs` (`--beats`) |
| B1 | `beat-apply-links.mjs`, `lib/bank-classify.mjs` (+ tests) |
| B2 | `beat-pay-webhook.mjs`, `beat-vendor-keys.mjs` (+ tests) |
| B3 | `beat-text-path.mjs`, `beat-email-path.mjs`, `lib/send-path.mjs` (+ tests) |
| B4 | `beat-doors-live.mjs`, `beat-db-health.mjs` (+ tests) |

Nobody except the integrator (Claude, main session) edits `src/pulse/beats/index.mjs` after F. Beat agents test their beat directly and with `scripts/pulse/run-beat.mjs`; the integrator adds the literal-list lines.

## Interface deltas to the contract

1. **`ctx.read(sql, params)`** replaces `ctx.db` / box. One shared read connection per run (not per beat) so the pooler holds ONE slot: `BEGIN READ ONLY`, `SET LOCAL statement_timeout = '4s'`, staff scope (`set_config('fundhub.actor','staff',true)`, `set_config('fundhub.partner_id','',true)`, same as `asStaff`) because many tables are FORCE row security; every statement in its own SAVEPOINT; statements run one at a time (queue); at the end `ROLLBACK`. Allow-list: a single `SELECT`, `WITH ... SELECT`, `SHOW`; refuse any `;` followed by non-space, `pg_advisory`, `pg_sleep`, `set_config`, `dblink`, `lo_`, `copy`, `nextval`, `LISTEN`, `NOTIFY`; refuse non-string forms (turn `{text,values}` into string + params first). A refusal is a red with the refused thing named. On a hung statement: wait out `statement_timeout`, send `ROLLBACK` with a 1 s cap, then `release(true)` (destroy). Returns `{ rows, rowCount }`.
2. **`ctx.live`** boolean: true when `AWS_LAMBDA_FUNCTION_NAME` or `NETLIFY` is set. **`ctx.skipStep(name, why)`**: records the step as ok with `skipped: true` and never makes the beat red. Use it for steps that need a live-only secret when `ctx.live` is false or the secret is a mask (a value starting with `*`, or 4+ asterisks). On the laptop, secrets are masks; that is not a break.
3. **`ctx.dbSettings()`**: one plain pooled query (NOT inside the read-only box) run by the harness, returning `{ ok, ms, transaction_read_only, default_transaction_read_only, in_recovery }`. Used by `db-health` to catch a pooled connection stuck read-only (memory: pooler-session-set-leaks).
4. **`ctx.http.get(url, { headers })` / `head`** through `pulse-probe.mjs` (`transmit()` with the `ADAPTERS` fence, GET and HEAD only). Beat declares `reads: [{ host, methods }]`; `"SITE"` = host of `process.env.URL`; `"*"` only for `apply-links`. The provider refuses: other methods, literal IP hosts, `localhost`, `*.internal`, non-https (except SITE), more than 64 KB read, more than 5 hand-followed redirects. Honest user agent `FundhubPulse/1.0 (+https://fundhub.ai)`. Never throws; returns `{ ok, status, ms, finalHost, bodySnippet (<=2 KB), error, class }`.
5. **No `kind: "door"`.** Kinds tonight: `probe`, `send` (read-only), `infra`.
6. **`damp`** (number, default 1): consecutive red runs before an alert. `vendor-keys`, `doors-live`, `apply-links`: 2. All others: 1. The runner reads each beat's previous result from `pulse_beats` (new `lastResults(rdb, { orgId, beatIds })` in `records.mjs`, returns the last 2 rows per beat). If the database cannot be read, no damping (alert on the first red).
7. **Alerts: text only.** `act` = text (+ ntfy second road if the provider is configured), no issues. Wording from contract 5.3, with the issue part dropped: `Fundhub BROKEN: <title>. It stopped at "<step>". Fix: <fixGuide line 1>.` Still broken: `Fundhub STILL BROKEN, hour <N>: ...`. Fixed: `Fundhub FIXED: <title>. It was broken <N> h.` One text per run, 480 characters max, ASCII only.
8. **Order inside the 22 s budget, counted from handler entry** (critic issue 3): read open incidents (2 s cap) → run beats (13 s cap) → decide → SEND THE TEXT (6 s reserved, before records) → write records (2.5 s cap, best effort). If the database is slow or down, skip the state read and text on the first red every hour.
9. **No runner state in a "real" store** (critic issue 1): there is no pulse context tonight, so there is nothing to fall back to. The read facade is the only thing a beat holds.
10. **`process.on('unhandledRejection')`** in `pulse-hourly.mjs`: log a redacted message and carry on (critic issue 2). A late rejection from a cut beat must never kill the run.
11. **Run claim** (critic: denial): `pulse_runs`-free version: the runner skips writing records twice for the same `run_id` (unique `(run_id, beat_id)`), and `alerts` uses the 50-minute `claimAlert`. If Netlify retries the function the texts are de-duplicated by `claimAlert`. (No new table.)
12. **Records tables** exactly as contract 4.1 (`pulse_beats`, `pulse_incidents` with the learning columns and the partial unique index, `pulse_bank_links`). Keep the GitHub columns (they stay NULL). `last_alert_at` is the state for "text every hour".

## The beats tonight (all `box: false`)

| id | kind | damp | covers (surface keys must exist in `surfaces()` in `src/pulse/tripwires.test.mjs`) | steps |
|---|---|---|---|---|
| `apply-links` | probe | 2 | `route:lenders`, `desk:lenders.html`, `desk:client-control-panel.html` | `url-shape`, `pick`, `fetch`, `classify`, `confirm`, `verdict` |
| `pay-webhook` | infra | 1 | `job:commas-inbox-drain`, `webhook:commas` | `secret-present`, `door-mounted` (live GET `SITE/api/webhooks/commas` answers 405), `verifier-accepts` (a body signed with the real secret passes the real verifier function, pure, no storage), `sweeper-alive` (job_heartbeats for commas-inbox-sweeper newer than 3x its schedule), `inbox-not-stuck` (no pending row older than 10 min with attempts left; no exhausted row in 24 h) |
| `vendor-keys` | probe | 2 | `[]` | `twilio-key`, `resend-key`, `commas-key` (read-only GETs; skip on a mask) |
| `text-path` | send | 1 | `job:message-dispatch-sweeper` | `fence-open`, `template-ready`, `dispatcher-alive` (job_heartbeats for message-dispatch-sweeper newer than 15 min), `queue-moving` (no sms queued over 15 min, none sending over 10 min), `failures-recent`, `receipts-moving` (amber, never red alone), `opt-out-readable` |
| `email-path` | send | 1 | `job:message-dispatch-sweeper` | same shape for email, plus `unsubscribe-secret` (live only) |
| `doors-live` | probe | 2 | `[]` | GET SITE doors and pages with an expected status and a content marker: `/api/health?strict=1` (ok true, pending 0), `/roadmap`, `/roadmap/pay.html`, `/portal-login.html`, `/api/webhooks/commas` and `/api/webhooks/clickfunnels` (405), `/api/public/survey-submit` (405), `/api/public/slo-interest` (200), `/api/public/slo-checkout` (405), `/api/auth/magic-link` (405) |
| `db-health` | infra | 1 | `[]` | `query-ok` (under 1.5 s), `pool-writable` (`ctx.dbSettings()`: transaction_read_only off), `grants` (has_table_privilege INSERT on clients, events, messages, commas_inbox, webhook_captures, account_magic_links, payment_links, transactions, job_heartbeats, pulse_beats), `health-endpoint`, `pool-pressure` (info; red only above 90% of max_connections; skip on denied) |

Each beat's `fixGuide` follows contract 2.4 (line 1 <= 120 chars, 300+ chars total, likely causes, steps, files; no secrets, no customer data). Before writing a fix guide read `docs/lessons/pulse-lessons.md` if it exists.

## Rules for every agent

- Ownership is exclusive (table above). Read a file right before editing it. Never overwrite newer work.
- No git commit, push, stash, checkout, branch switch, ship, deploy. The integrator commits. Other sessions edit this checkout live and have stashed uncommitted work before: after you finish each file, copy it to `<SCRATCH>/p-backup/<piece>/`.
- No write to the database, no POST, no send, no AI call, no Plaid, no credit pull, no card charge. Read-only SQL for calibration: `node --env-file=<repo>/.env <SCRATCH>/sql.mjs "SELECT ..." [--staff]`.
- No repo files read at run time inside a beat or the runner (the live bundle has none). Strings live in code.
- Every check id and beat id is unique across `src/pulse/**` (grep first).
- Every beat: a PASS test and a FAIL test that would break if the logic broke (a fake that answers any query with canned rows proves nothing about the SQL; test the SQL on the live database read-only, and say so).
- Stuck rule: two failed attempts at the same fix, stop and report.
- Company name: Fundhub. 4th grade English for text a human reads.

## Acceptance (integrator runs these)

`npm run lint`; every new test file; `npm test` shows no new failure against the 12 known before tonight; `npm run pulse:prove` OK; `npm run pulse:prove -- --beats` OK (builds the `pulse-hourly` bundle, runs `runPulse({ mode: "prove" })` from inside it against live data, read-only, fake sinks); a forced red per beat names the right step; then ship, then watch the first live run at minute 7.
