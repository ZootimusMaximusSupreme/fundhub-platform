# Manifest A — status model, scorecard, summary line, migration (Ship 1)

Branch `build/ZU-A-2026-10-09`, built on `main` at `fbc54d0e` (the worktree started one commit behind the contract, so the branch was cut from `main`; nothing else changed).

**Round 2: branch `build/ZU-A-r2-2026-10-09`** (cut from the first A commit `271ba245`). It fixes the checker's findings on `na-conditions.mjs`, one test line in `scorecard.pg.test.mjs`, and notes one merge for the integrator. See "Round 2 (checker findings)" at the end. Where this file's older text and the Round 2 section differ, Round 2 wins; the older text below has been updated to match.

## Files

| file | what |
|---|---|
| `src/pulse/na-conditions.mjs` | NEW. The closed list of "nothing to judge" codes and `verifyNa`. |
| `src/pulse/na-conditions.test.mjs` | NEW. 32 tests (25 in round 1). |
| `src/pulse/scorecard.mjs` | `na` status, four-status counts, `na_count` save, old-shape fallback, `also` kept. |
| `src/pulse/scorecard.test.mjs` | NEW. 22 tests (incl. the static checks on migration 477). |
| `src/pulse/scorecard.pg.test.mjs` | NEW. Real-Postgres test of migration 477 and `saveScorecard`. **Skips here** (see "Not run"). |
| `src/ops/morning-brief.mjs` | `summarizeSystems` only (+ one import of `TRIPWIRES`, read only). |
| `src/ops/morning-brief.test.mjs` | Lines added at the end (+ one import line at the top). Nothing existing changed. |
| `db/migrations/477_zero_unchecked_na.sql` | NEW. `na_count` + four-status counts-match check. |

Not touched: `db/expected-migrations.mjs`, `src/pulse/tripwires.mjs`, `heartbeats.mjs`, any slice or lane file.

## Exports (exact names and shapes)

### `src/pulse/na-conditions.mjs`
- `NA_CONDITIONS` — frozen `{ [code]: { say(args, now?) -> string, verify, claim(args) -> string, problem(args) -> string|null, rowProblem?, look? } }`.
  - `verify` is `async (args, ctx) -> boolean` for the four core codes, and the literal string `"lane"` for the four lane codes. This is the contract shape and it is unchanged. It does NOT know the row, so it cannot do the "is this proof about this row" check; only `verifyNa` does. Callers should use `verifyNa`.
  - `claim(args)` (the sentence for a true claim), `problem(args)` (is the proof complete), `rowProblem(row, args, ctx) -> string|null` (is the proof about THIS row; core codes only) and `look(args, ctx) -> { held, found }` (core codes only; `found` is what was seen when the claim is not true) are extra fields. Internal to this file and `verifyNa`. Nobody else needs them.
- `NO_DEMAND_MIN_WINDOW_MS` (new export) = one day. A `no-demand` look-back window shorter than this fails.
- `NA_CODES` — frozen array of the eight code names.
- `isNaCode(code) -> boolean` (own keys only; `"toString"` is not a code).
- `naProblem(na) -> string|null` — `null` when `na` is a usable `{ code, args }` (known code, plain-object args that can be saved as JSON, and the code's own required args present). Otherwise one plain reason.
- `naSay(na, now?) -> string` — the code's sentence, or `"Nothing to judge today."`. Never throws.
- `verifyNa(row, ctx) -> Promise<{ ok: boolean, reason: string }>`. `ctx = { db, scope, now, functions, laneNaVerify }`. Never throws.

The eight codes and the args each one needs (a producer that leaves one out gets `ok:false`, and the scorecard turns its row into `not_checked`):

| code | needs | verify is true when |
|---|---|---|
| `no-demand` | `{ names: string[] (not empty), since: ISO text or Date }` | the `events` table has 0 rows for any of `names` since `since`. Reads `events` only. **Row must be `wf:<id>`; `names` must be exactly the event triggers of that function in `ctx.functions`; the window must be at least a day long (`since <= now - 24h`).** |
| `no-trigger` | `{ id }` | the function with that id in `ctx.functions` has no triggers, or `enabled === false`. Id found from `fn.opts.id`. **On a `wf:<x>` row, `id` must be `x`.** |
| `not-registered` | `{ id }` | `ctx.functions` is a non-empty list and the id is not in it. **No list, or an empty list = false.** |
| `monthly-not-due` | `{ cron }` (must be a monthly `M H D * *`) | `min(job_heartbeats.finished_at)` is later than `lastMonthlyFire(cron, ctx.now)`. An empty table = false. **Row must be `job:<name>`, `<name>` must be on `JOBS`, and `cron` must equal that job's cron on `JOBS`.** |
| `no-running-ad`, `low-traffic`, `no-real-lead`, `not-connected` | nothing required (the lane picks its args) | `ctx.laneNaVerify(sliceId, code, args)` returns `true`. `undefined` or no function = false. |

`sliceId` for a lane code is `row.sliceId`, else the part of `row.id` before the first `:`.

Optional args the sentence reads (the producer's own `detail` wins as the stored reason): `low-traffic` `{count, min, what, days}`; `no-real-lead` `{days}`; `not-connected` `{what}`.

**`reason` in the `verifyNa` result is one short sentence** (changed in round 2). It is built to follow piece D's line `Said nothing to judge, but "<row detail>" is not true. <reason>`.
- `ok:false`: what was FOUND instead, never a repeat of the claim. Examples: `3 round.started events came since 10-05.` / `2 round.started and 1 round.funded events came since 10-05.` / `s-00-welcome has 1 trigger and is switched on.` / `The first job receipt is from 09-19. The job was due 09-30, so a run should be there.` / `round.startd does not start s-09.` / `The look-back window is under a day long. That is too short to judge.` / `The lane looked again and found something to judge.` / `The read failed: connection reset.`
- `ok:true`: the claim that still holds, as a sentence. Examples: `No round.started event since 10-05.` / `x has no trigger.` / `No ad is running.`
All of them start with a word, end with a period, and have no sentence over 22 words (a test checks this).

**How `verifyNa` reads (round 2).**
- It reads through `ctx.scope` when there is one, else `ctx.db`. This is the order `gap-handoff` uses, so the verifier sees the rows the producer saw.
- `no-demand` takes ONE grouped read of `events` per run and window: `SELECT name, count(*)::int AS n FROM events WHERE created_at > $1 GROUP BY name`. It asks for every name, so a name nobody listed cannot be missed. The answer is kept in a `WeakMap` keyed by the `ctx` object, so **the audit must pass the same `ctx` object to every `verifyNa` call of a run** (piece D already does: `const ctx = { db, scope, now, functions, laneNaVerify }` once). A new `ctx` reads again, so one run never reuses another run's answer. A failed read fails every row of that run the same way.
- Measured on the live database, read only (`BEGIN READ ONLY`, rolled back): piece B's 60 real `no-demand` and `no-trigger` rows (built from the real bundled list) all verified `ok` in 58 ms with 1 read. The `events` table holds 8,983 rows today; the same grouped read over a 3-day window ran in about 1 ms.

### `src/pulse/scorecard.mjs`
- `toContractCheck(check)` — `na` + a usable `na` object gives `{ id, group, status:"na", reason, na_code, na_args }` (`reason` = the row's `detail`, else the code's sentence; `na_args` is a JSON round trip copy). A `na` row with no usable object gives `status:"not_checked"` with `reason` = `NA_NO_REASON`. A row's `also` array (strings only) is copied onto every status.
- `NA_NO_REASON` (new export) = `"Said nothing to judge but gave no reason the computer can check"`.
- `countChecks(checks) -> { green, red, na, not_checked }`.
- `saveScorecard(db, orgId, card) -> { saved, id, counts }`. Writes `na_count`. On Postgres `42703` or `23514` it saves once more in the old shape (each `na` row written as `not_checked`, no `na_count`, `na_code`/`na_args` dropped), logs one `console.warn` line, and returns `{ saved:true, id, counts:<old-shape counts>, legacy:true, na_downgraded:<n> }`. Any other error is thrown as it was. If the second save fails too, that error is thrown with `.cause` = the first.
- Unchanged: `buildScorecard`, `applyRepeats`, `loadPreviousScorecard`, `phoenixDate`, `GROUPS`, `SCORECARD_TZ`.

### `src/ops/morning-brief.mjs`
- `summarizeSystems(scorecard, opts) -> { status, total, green, red, na, not_checked, reds, line, scorecard }`. (`scorecard` was already on it; the public brief strips it.) `not_checked` no longer includes `na`; anything that is not green, red or na counts as `not_checked`.
- Line: `Systems: 690 of 757 checks green. 3 red: a, b, c. 64 had nothing to judge today.` If `not_checked > 0` it also says `N not checked.` (kept from before) before the nothing-to-judge sentence. `Nothing needs you.` only when red is 0 and not_checked is 0 (na does not stop it). The `(day N)` suffix on a red past day 1 is kept.
- `reds` order: `day_count === 1` first; then money tripwire ids; then customer tripwire ids; then `audit:*`; then the rest; stable inside each. A tripwire id matches the row id or `checkId` exactly, or any part after a colon (so `gap-payments:payments:paid-no-entitlement` matches `payments:paid-no-entitlement`). An id on both money and customer lists ranks as money.

## Migration 477

`db/migrations/477_zero_unchecked_na.sql`: `ADD COLUMN IF NOT EXISTS na_count integer NOT NULL DEFAULT 0 CONSTRAINT pulse_scorecards_na_count_ck CHECK (na_count >= 0)`; `DROP CONSTRAINT IF EXISTS pulse_scorecards_counts_match`; `ADD CONSTRAINT pulse_scorecards_counts_match CHECK (...)` counting `green`, `red`, `not_checked`, `na`, and `green + red + not_checked + na = jsonb_array_length(checks)`. `db/migrate.mjs` runs each file in one transaction, so drop and add are one step. No grant change (table-level grants already cover a new column). Nothing deleted.

Measured on the live database, SELECT only (the read-only helper):
- Both stored cards satisfy the new check with `na_count = 0`: 2026-10-08 (411 green, 0 red, 9 not_checked, 420 rows) and 2026-10-09 (695 green, 14 red, 299 not_checked, 1008 rows). So `ADD CONSTRAINT` will validate.
- The new check expression, evaluated as a plain SELECT over literal cards: a four-status card holds; `na_count` too low fails; an `na` row under the old count fails; an unknown status fails; an old three-status card with `na_count = 0` holds.

## Tests and results

- `node --test src/pulse/na-conditions.test.mjs src/pulse/scorecard.test.mjs src/ops/morning-brief.test.mjs src/pulse/daily-pulse.test.mjs src/pulse/heartbeats.test.mjs src/pulse/tripwires.test.mjs src/http/morning-brief-public.test.mjs`: 97 pass, 0 fail, 0 skipped in round 1; **104 pass, 0 fail, 0 skipped in round 2**.
- Round 2, wider run (`src/pulse/**`, `src/ops/**`, `src/http/health*`, `rls-shape`, `migrations-production-only`): 2594 tests, 2525 pass, 67 skipped (pg files, no `DATABASE_URL`), 2 fail. Both failures are the two already listed below under "Failing tests that are not mine" (1 and 2). `npm run lint` clean. `npx tsc --noEmit`: the same 1 error in `src/marketing/filmed-receive.mjs`.
- Full `npm test` in this worktree (no `DATABASE_URL`): unit 19269 tests, 19230 pass, 16 fail, 23 skipped; pg files 927 tests, 83 pass, 0 fail, 844 skipped (a skipped pg test is not green). The 16 unit failures are listed below; only one is caused by my files.
- Mutation checks (I broke the code on purpose, saw the matching test fail, and restored it): `no-demand` `=== 0` to `>= 0`; `monthly-not-due` `>` to `<`; `no-trigger` `||` to `&&`; `not-registered` inverted; the verify "ok" path made unconditional; `toContractCheck` letting any `na` through; the `23514` fallback code removed; `na_code` left on the old-shape row; `fresh` (new today) ignored; `na` counted into `not_checked`; money and customer rank swapped.
- `npm run lint`: parses clean. `npx tsc --noEmit`: 1 error, `src/marketing/filmed-receive.mjs(159,75)`, not my file and not new.
- Before the full run, a wider run of every `src/pulse`, `src/ops`, `src/workflows`, `src/http/health*`, `src/http/morning-brief-public`, `src/security/rls-shape`, `src/security/migrations-production-only` test showed 3 failures. See "Failing tests that are not mine".

## Failing tests that are not mine

1. `src/http/health-migrations.test.mjs` "the expected list is exactly what db/ holds" fails **because of my new migration file**, on purpose: the contract says not to edit `db/expected-migrations.mjs`. I ran `node scripts/db/expected-migrations.mjs` in this worktree, saw it add exactly one line and the test plus `health.test.mjs` plus `pulse-records.test.mjs` go green (63 of 63), and then restored the file with `git checkout -- db/expected-migrations.mjs`. **Integrator: regenerate it on the merged tree.**
2. `src/pulse/registry.test.mjs` "every registry row names a real handler or desk file": `public/leads/c01cb7592c8bb994130158e897e99bf1/index.html` is gone. That folder is untracked and listed in `.git/info/exclude` of the main checkout, so a fresh worktree does not have it. Not mine.
3. `src/workflows/index.test.mjs` "index serves exactly the workflows on disk": `pulse-instant-watch` is registered but not in `EXPECTED_WORKFLOW_IDS`. Already on `main`. Not mine.
4. The rest of the full-suite failures (all in files I did not touch, and the same tests fail on an extract of `fbc54d0e` in the scratchpad, though that extract was partial so it fails some extra ones for its own reasons): `scripts/daily-pulse.test.mjs` ("--db hands the pulse a db and a staff scope": more `staff` entries than expected), `scripts/diagrams/generate.test.mjs` (`docs/diagrams` README and agent-triggers out of date), `scripts/journeys/generate.test.mjs` (journeys stale), `src/http/climate-match.test.mjs` (climate page wording), `src/http/read-endpoints-org-scope.test.mjs` (`api/read/morning-brief.mjs` has no `org_id = $N`), `src/journeys/runner/index.test.mjs` (3 tests on the workflow registry), `src/lib/no-unfenced-transmit.test.mjs` (`src/pulse/funnel-doors.mjs` and `src/pulse/instant-watch.mjs` call out raw), `src/repo/edit-ops.test.mjs` (2 tests). None import `scorecard.mjs` or `na-conditions.mjs`; the morning-brief one is `api/read/morning-brief.mjs`, a different file from `src/ops/morning-brief.mjs`.
5. `npx tsc --noEmit`: 1 error, `src/marketing/filmed-receive.mjs(159,75)`. Not mine.

## Not run / could not do

- **`src/pulse/scorecard.pg.test.mjs` was not run.** This Mac has no Postgres, and the only reachable database is production, which the file's loopback guard refuses. It prints `SKIP no DATABASE_URL (this runs in CI; a skipped pg test is not green)`. I read it twice for mistakes and it passes `node --check`, but the first time it really runs is CI (`.github/workflows/tests.yml` builds a loopback Postgres and applies every migration). The measured SELECT proofs above stand in for the constraint logic until then.
- I did not run the migration file itself anywhere (DDL cannot run in the read-only helper, and the contract forbids a migration run). Its SQL syntax is therefore proved only by reading it and by CI.
- I did not touch the report page (`public/app/morning-brief.html`): per the critic (#19) the Red / Green / Not checked tiles will not add up to "Out of N checks" once `na` rows exist, because `na` shows only in the text line. That is Chris's open decision 4.

## Requests for others

- **Piece B** (`heartbeats.mjs` monthly branch): emit `monthly-not-due` only when the first-ever receipt is later than `lastMonthlyFire(row.cron, now)`. The existing "too soon" branch also fires for the one-day grace after a due time with older receipts. My `verify` returns false for that case (receipts began before the due time), so the audit would turn the row into `not_checked`. Args: `na: { code: "monthly-not-due", args: { cron: row.cron } }`.
- **Piece B** (`wf:` rows): `no-demand` args must be `{ names: string[], since: ISO text }` and `no-trigger` args `{ id }`. Use `NA_CONDITIONS[code].say(args)` for the `detail` if you want the standard sentence. Ids are matched through `fn.opts.id`.
- **Piece D** (audit): call `verifyNa(row, { db, scope, now, functions, laneNaVerify })`; on `ok:false` put `reason` last in the line: `Said nothing to judge, but "<row detail>" is not true. ${reason}` (round 2: `reason` now says what was found, so it adds a fact instead of repeating the claim). `toContractCheck(row).status` is the right test for `audit:not-checked`: an `na` row with a bad `na` object already lands `not_checked`. `NA_NO_REASON` is exported if you want to name it.
- **Piece G** (lanes): the lane codes need nothing required in `args`, so pick what your `naVerify` needs (`{count, min, what, days}` also feeds the standard sentence). `naVerify` must return `true` to stand.
- **Integrator**: (1) regenerate `db/expected-migrations.mjs` (`npm run migrations:manifest`); (2) the migration goes live only on the production ship (`npm run ship`), and until then `saveScorecard` keeps the morning report by saving the old shape; (3) `docs/journeys/heartbeat-flow.md` and `docs/journeys/CHANGELOG.md` are yours; (4) if another branch also took migration number 477, renumber mine and the two places that name it (`scorecard.test.mjs` constant `FILE` and the `MIGRATION` path in `scorecard.pg.test.mjs`; the migration text and the warn line in `saveScorecard` say "477").

## Round 2 (checker findings)

Branch `build/ZU-A-r2-2026-10-09`. Files touched: `src/pulse/na-conditions.mjs`, `src/pulse/na-conditions.test.mjs`, `src/pulse/scorecard.pg.test.mjs` (one test), this manifest. Nothing else.

| # | severity | finding | what I did | test that proves it |
|---|---|---|---|---|
| 1 | medium | `no-demand` window could be fooled (`since` = now or in the future reads 0 events, so it passes forever) | The verifier now owns a floor: `since` must be at least a day back (`NO_DEMAND_MIN_WINDOW_MS`, against `ctx.now`, else the real clock). A short window fails BEFORE any read. | `no-demand FAILS when the look-back window is under a day` (since = now, 2027, 2099, one minute, one millisecond short of a day all fail with events present; exactly a day stands; no `ctx.now` uses the real clock) |
| 2 | low | args not matched to the row they belong to | `no-demand`: the row must be `wf:<id>`, the id must be in the bundled list, and `names` must equal that function's event triggers exactly (a misspelled name, a name from another workflow, or only some of the function's events all fail). `monthly-not-due`: the row must be `job:<name>`, on `JOBS`, with `cron` equal to its `JOBS` cron. `no-trigger`: on a `wf:<x>` row, `id` must be `x`. `not-registered`: an empty list is no list. | `no-demand FAILS when the proof is about another workflow, or other events`; `monthly-not-due FAILS when the cron is not the job's own cron`; `no-trigger FAILS when the proof names a different workflow than the row`; `not-registered treats an empty list as no list` |
| 3 | low | `reason` repeated the claim, so piece D's line was a jumbled repeat; some claim wording was hard to read | `reason` is now a sentence: on failure, what was found (`3 round.started events came since 10-05.`); on success, the claim. 4th grade wording. See the section above. | `every reason, true or not, is a short plain sentence...` and the exact-text asserts in each FAIL test |
| 4 | low | read order was `db` then `scope`; the producer reads `scope` first | `readRows` reads `ctx.scope` first, then `ctx.db`, the order `gap-handoff` uses. | `no-demand reads through the staff scope when there is no plain db, and prefers it when both are there` |
| 5 | low | one `events` count per `wf:` row, no `org_id` filter, so many reads against a 2.5 s budget | One grouped read per run and window (kept per `ctx`), shared by all rows. I did NOT add an `org_id` filter: piece B's args carry no org, and the index `idx_events_name` leads with `org_id`, so no filter would use it either. One read instead of about 60 is the fix. No change is needed in piece D, as long as it keeps passing one `ctx` object. | `no-demand answers every workflow row of one run with ONE read, and never shares a read between runs` (60 rows, 1 read; a new window or a new `ctx` reads again; a failed read fails every row) |
| 6 | low | pg test `return`ed quietly when the `fundhub_app` role is missing | It now calls `t.skip("no fundhub_app role in this database, so its privileges were not checked")` first. This file still skips as a whole here (no `DATABASE_URL`). | `node --check` clean; the same `t.skip` then `return` pattern as the test below it |
| 7 | low | merge conflict in `src/ops/morning-brief.test.mjs` (main added texting-hours tests and a `runMorningBrief` import at the end of the same file) | **No change in A. Integrator**: keep both blocks at the end of the file and both import changes. `morning-brief.mjs` merges cleanly. 477 is still the next free migration number. | n/a |

Mutation checks for round 2 (I broke the code on purpose, saw a test fail, restored it): window floor removed; `no-demand` row match removed; monthly cron match removed; an empty list counted as a list; `db` read before `scope`; the shared read switched off; `no-trigger` id match removed; a subset of names allowed; a false lane answer allowed to stand; the count of one name ignored. All 10 were caught.

Proof against piece B's real output (scratch only, nothing committed): I took B's `workflow-runs.mjs` from `build/ZU-B-2026-10-09`, ran it on the real bundled `functions` list, and passed every `na` row to the new `verifyNa`. With a fake database: 65 of 65 `wf:` rows verified `ok` with 1 read, and B's 2 monthly job rows (`affiliate-payout-run`, `partner-production-floor`) verified `ok`. With the live database, read only: 60 of 60 verified `ok` in 58 ms with 1 read (the other 5 `wf:` rows are `skip`, because events came). So the tighter checks do not turn any of B's rows red.

### Requests for others (round 2)

- **Piece D / integrator**: build ONE `ctx` object per audit run and pass the same object to every `verifyNa` call (D already does). The one-read saving depends on it. On failure use `res.reason` as the last sentence of the line, as D's `failedNaRow` already does; it now says what was found.
- **Piece B**: your rows already satisfy the new row checks (checked above). Keep `names` equal to ALL of the function's event triggers, keep the row id `wf:<function id>` / `job:<job>`, and keep `cron` equal to the `JOBS` cron. If you ever build a `no-demand` window under a day, it fails.
- **Piece C**: `not-registered` rows must be made with a real bundled list in `ctx.functions` (the audit passes it). An empty list fails.
- **Integrator**: merge note for `src/ops/morning-brief.test.mjs` (finding 7) and the migration number note (still 477).
