# 08 — Adversarial review of the pulse contract (2026-10-09)

Reviewer: Claude (Opus), read-only. Read: the board, `pulse-layer-2026-10-09-contract.md`, briefs 01-07, and the code they cite. Queries were read-only (BEGIN READ ONLY, rolled back).

## Verdict for Chris

**Go with changes.** Tonight, ship only the safe half. The probe beats and the read-only checks can go. The beats that write inside a rolled-back box wait. They have never run on a real database, and the first run would be unattended against the live database on launch night.

## Facts measured for this review

- `x-fundhub-pulse` is read nowhere in `src/`, `api/` or `netlify/` today (grep: 0 hits). A pulse header sent to the live site today is an ordinary request. Nobody gets anything extra from it.
- Laptop `DATABASE_URL` is `aws-1-us-west-2.pooler.supabase.com:6543`, so it goes through the Supavisor transaction pooler. PG 17.6, `max_connections` 60. The production URL port was not verified.
- Extensions: btree_gist, pg_stat_statements, pg_trgm, pgcrypto, plpgsql, supabase_vault, uuid-ossp, vector. **No dblink, pg_net or http.** So a trigger cannot send anything out from inside a rolled-back transaction.
- `nextval` shows up in 4 functions (`assign_affiliate_tracking_id`, `assign_client_code`, `assign_employee_code`, `yd_invoices_before_insert`). `next_ad_number` uses an advisory lock. Only `money_transfer_events` and `repo_outbox` have serial or identity columns. No tonight door touches those.
- `main` on GitHub has `protected: false`. The repo is `private: false`, `fork: true`, `has_issues: false` (GitHub API, 2026-10-09).
- `pg` 8.22.0: `pg.Pool.prototype` owns only `constructor`. `connect` and `query` live on the parent prototype. pg-pool's own `query` calls `this.connect(cb)` in callback form (`node_modules/pg-pool/index.js:449`).
- `new Request(url)` in Node 22 has **no** headers at all: no host, no x-forwarded-for, no user-agent.
- Lenders: 987 distinct Apply URLs (the board says 365). 335 are on `creditcardlearnmore.com` with `ecid=` campaign codes, 176 on `mycommunitycc.com` with `merchantId=`, and 60 on `mycardapply.com`.

## Issues, worst first

### H1. The whole runner runs inside the "real" store, so a lost context means REAL database and REAL web
Contract §3.1 (lines 434-441) wraps `runPulse` in `runReal(...)`. Every beat is nested inside that. In the async context system, a callback that loses the beat's context falls back to the nearest outer store. Here that is `real`, not "no store", so it gets the original pool and the original `fetch`. This undoes the fail-closed promise in §1.1 (line 40). §1.2 (line 98) admits that event-emitter listeners lose context.
**Fix:** start beats from a root with no store. Wrap only `defaultOrgId`, `loadState`, `persist`, `writeBeatResults`, `act` and `noteScheduledRun` in their own `runReal`. Test: a listener added inside a beat and fired from runner code must hit `pulse_no_store`.

### H2. A late refused promise with no catch crashes the pulse function
§1.7 expects late work to be refused after close. Nothing in the contract catches the rejections that follow (grep for `unhandledRejection`: none in the contract or in `src/`). On Node 22, an unhandled rejection ends the process. A crashed run writes no records and sends no text, and Netlify retries a failed timed run twice more (`src/http/scheduled-functions-return.test.mjs:5-16`).
**Fix:** `install.mjs` adds `process.on("unhandledRejection")`. It swallows `PulseRefused` and counts it as `closedLate`, and it records any other rejection on the run. Prove it in the child-process install test.

### H3. The time plan does not fit 30 seconds, and the text comes last
The phase caps add up to 2.5 + 2 + 13 + 2 + 2.5 + 6 = **28 s**, but `RUN_BUDGET_MS` is 22 s (§2.7, §3.2). Cold start of the whole api graph inside the function has not been measured (§10, line 1056). When the database is slow, which is exactly when things break, the records eat the time, the function is killed before the alert, and Netlify retries.
**Fix:** use one deadline counted from the handler's start. Order the work as beats, then the text, then records. Keep 6 s for the text. Measure cold start in `prove`.

### H4. GitHub comments on a PUBLIC repo are trusted
- The runner closes incidents from any `pulse-lesson` block (§4.4 step 1).
- It stores any `pulse-fixer: session <url>` line and texts that link to Chris (§5.2 step 2, §6.1 step 3, §5.3).
- The fixer stops on any `pulse-fixer: claimed` comment (§6.3 step 0).

Anyone on GitHub can comment on a public issue. So an outsider could poison the lessons, plant a link that gets texted to Chris, or keep the fixer from ever starting. Public issues would also show live outage details, plus real payment ids or amounts. The scrub in §5.5 does not block those.
**Fix:** keep pulse issues in a **private** repo. Also accept comments only from the token owner and the Action bot.

### H5. Nothing stops the fixer from pushing to `main`
`main` is not protected. Brief 05 line 45 says the GitHub proxy does not limit which branch a session pushes. The only guard is a line in the prompt, and that prompt reads bank pages and issue text that outsiders can shape. A pushed branch that carries a workflow file can also read the repo secrets (`PULSE_FIXER_TOKEN`).
**Fix:** before the routine is turned on:
- Add a rule on `main` that only the owner can push. Let the owner admin bypass it, so `scripts/github-push-whole-repo.mjs` still works.
- Limit the routine to `claude/` branches.
- Check that the app cannot write workflow files.
- In the Action, pass the issue text through `env:`. Never put `${{ github.event.issue.* }}` inside `run:`.

### H6. The `api.mjs` edit is a launch-night hot-path change that adds no safety tonight
No handler reads the header (measured). In Mode A, `ctx.door` is the only thing that calls `api.mjs`, so the signature and opt-in checks can live in `ctx.door`. As written, the gate has no off switch except a redeploy.
**Fix:** tonight, make **zero** edits to `api.mjs`, `db.mjs`, the bus, `outbound-fetch`, the Commas door and `instant-watch`. Do the gate in `ctx.door`. After launch, if the live 403 is still wanted, add it this way:
- 3 lines that run in order, with no new imports, keyed on `globalThis[Symbol.for("fundhub.pulse.process")]`.
- An env kill switch.
- The no-header spy test.
- Netlify instant rollback named as the way back.

### H7. The first box run on real Postgres would be unattended, against production
- The pg twin (Guard 4.9) runs in CI only.
- The Mac has no Postgres.
- CI on main is already red (§10).
- `prove --beats` runs box beats against live data from the laptop.
- §1.3 close step 3 says "Postgres rolls back an open transaction when the socket dies." Through Supavisor on port 6543, the Postgres socket does **not** die when the client socket closes. What Supavisor does with a server connection still inside a transaction is not measured.

**Fix:**
- Tonight, ship only beats with no box, plus checks that use `BEGIN READ ONLY`. In read-only mode Postgres itself refuses writes and `nextval`.
- The door beats that write go live only after the pg twin is green on that commit, and only after a first run Chris watches and says go.
- On timeout, wait out `statement_timeout`, then send `ROLLBACK`, then destroy the connection.
- Measure Supavisor's behaviour when a client drops in the middle of a transaction, using a harmless read-only transaction.

### M1. The facade sorts SQL by its first word only
`query("SELECT 1; COMMIT; ...")`, or the object form `query({ text: "COMMIT" })`, would commit the box. No such caller exists today (grep: 0), but nothing refuses one.
**Fix:**
- Refuse text where a `;` is followed by anything that is not a space. This is the rule at `src/pulse/coverage/gap-sales-manager.mjs:168`.
- Turn `{ text, values }` into plain text and values. Refuse every other non-string first argument.
- Scan every word for the transaction keywords (COMMIT, END, ROLLBACK, BEGIN, SAVEPOINT, RELEASE), not just the first.
- Also fix a clash: `SIDE_EFFECT_FN` matches `pg_advisory\w*`, but §1.3 says the `_xact_` forms are allowed. Say which one wins.

### M2. Alerts flap
There is no confirm run. Beats include live vendor GETs (8 s timeout, `gap-keys.mjs:94`). One blip means a BROKEN text, a new issue, a fixer session and a FIXED text. Each flap opens a new incident and a new issue.
**Fix:**
- Require 2 red runs in a row for steps that depend on a vendor or network read.
- Alert at once only for gate, door, `rolled-back` and `no-unexpected-send` failures.
- Reopen an incident closed less than 6 h ago instead of opening a new issue.

### M3. Each box holds a pooler slot for the whole beat
Each box pins one Supavisor server connection for its whole life. That includes vendor GETs run while the transaction is open. `BOX_CONCURRENCY` is 4, and the pool size is unknown (brief 02 line 65).
**Fix:**
- Use 2 boxes at once for launch week.
- Do vendor reads before the box opens.
- Send `BEGIN` and the `SET LOCAL` lines in one round trip.
- Measure the pooler's pool size.

### M4. Alerts can fail silently
The L3 socket floor in "no store" mode allows only the database host. If the alert's fetch loses its context inside undici, the socket is destroyed and no text goes out. Also, `ok` stays true when the text failed (§3.2 step 8), so `job:pulse-hourly` reads green.
**Fix:** let L3 refuse only while a pulse store is active. Set `ok = false` when a needed alert reached neither SMS nor ntfy.

### M5. The new-lead path is never tested
The pre-made client (K12) means `resolveClient` creating a client and `assign_client_code` never run. That is the path every launch customer takes. lead-survey, checkout-mint and lead-cf-hook stay green while it could be broken.
**Fix:** state this limit plainly on the board and in the beat titles. Open decision 4: a daily new-client variant.

### M6. Some beats call I/O code directly, which the beat rules forbid
`processCommasInboxRow`, `sendTemplated` and `dispatchOne` all do I/O, which breaks §2.3. Guard 2(8) checks only the beat file's own imports, so it misses this. If text-path ever calls `claimDue` or `dispatchDue` (`src/messaging/dispatch.mjs:199,806`), it would lock real customers' queued texts (SKIP LOCKED) and capture their phone numbers and message bodies.
**Fix:** add a static pin. text-path may not reference `claimDue` or `dispatchDue`. It must pass its own message id.

### M7. Nobody checked whether the timed function can be called by URL
Each call means 4 box connections, 40 bank GETs, and possible issues.
**Fix:** allow one run per 50 minutes (a `pulse_runs` claim or an advisory transaction lock). Also check whether `/.netlify/functions/pulse-hourly` answers on live.

### L1. Bank pages
Hourly bot GETs on partner URLs with campaign codes count as fake visits for credit unions, and they will hit bot walls from AWS addresses.
**Fix:** check Apply links once a day. Refuse fundhub.ai hosts and private addresses in the `"*"` reads.

### L2. In-process requests have no headers
They have no host, x-forwarded-for or user-agent. `api/webhooks/[provider].mjs:61` builds the URL from the host header.
**Fix:** `ctx.door` sets these headers the way Netlify does.

## Smallest safe version tonight

1. New files only:
   - context, sign, the guard, ctx, the runner, records, alerts and the migration.
   - `netlify.toml` gets the `pulse-hourly` block.
   - The `NETLIFY_JOBS` row.
2. Beats: `apply-links` (daily), `pulse-gate-live` (rewritten as a live GET that reads 200 and checks no handler reads the header), the vendor key reads, `door-mounted` GETs, and checks that `sweeper-alive` and `queue-moving` read through `BEGIN READ ONLY`.
3. No write box, no `api.mjs` edit, no `instant-watch` edit, no GitHub issues, no fixer.
4. Texts only, with the 2-in-a-row confirm and the unhandled-rejection catch.

## What must wait

The write-box door beats (after the pg twin is green and Chris watches a first run). The `api.mjs` live gate. The fixer routine (after a private issues repo, branch protection and comment author filtering). The dead-man edit to `instant-watch`.
