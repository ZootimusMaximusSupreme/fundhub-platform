# Manifest A — status model, scorecard, summary line, migration (Ship 1)

Branch `build/ZU-A-2026-10-09`, built on `main` at `fbc54d0e` (the worktree started one commit behind the contract, so the branch was cut from `main`; nothing else changed).

## Files

| file | what |
|---|---|
| `src/pulse/na-conditions.mjs` | NEW. The closed list of "nothing to judge" codes and `verifyNa`. |
| `src/pulse/na-conditions.test.mjs` | NEW. 25 tests. |
| `src/pulse/scorecard.mjs` | `na` status, four-status counts, `na_count` save, old-shape fallback, `also` kept. |
| `src/pulse/scorecard.test.mjs` | NEW. 22 tests (incl. the static checks on migration 477). |
| `src/pulse/scorecard.pg.test.mjs` | NEW. Real-Postgres test of migration 477 and `saveScorecard`. **Skips here** (see "Not run"). |
| `src/ops/morning-brief.mjs` | `summarizeSystems` only (+ one import of `TRIPWIRES`, read only). |
| `src/ops/morning-brief.test.mjs` | Lines added at the end (+ one import line at the top). Nothing existing changed. |
| `db/migrations/477_zero_unchecked_na.sql` | NEW. `na_count` + four-status counts-match check. |

Not touched: `db/expected-migrations.mjs`, `src/pulse/tripwires.mjs`, `heartbeats.mjs`, any slice or lane file.

## Exports (exact names and shapes)

### `src/pulse/na-conditions.mjs`
- `NA_CONDITIONS` — frozen `{ [code]: { say(args, now?) -> string, verify, claim(args) -> string, problem(args) -> string|null } }`.
  - `verify` is `async (args, ctx) -> boolean` for the four core codes, and the literal string `"lane"` for the four lane codes.
  - `claim` and `problem` are extra fields I added (internal to this file and to `verifyNa`). Nobody else needs them.
- `NA_CODES` — frozen array of the eight code names.
- `isNaCode(code) -> boolean` (own keys only; `"toString"` is not a code).
- `naProblem(na) -> string|null` — `null` when `na` is a usable `{ code, args }` (known code, plain-object args that can be saved as JSON, and the code's own required args present). Otherwise one plain reason.
- `naSay(na, now?) -> string` — the code's sentence, or `"Nothing to judge today."`. Never throws.
- `verifyNa(row, ctx) -> Promise<{ ok: boolean, reason: string }>`. `ctx = { db, scope, now, functions, laneNaVerify }`. Never throws.

The eight codes and the args each one needs (a producer that leaves one out gets `ok:false`, and the scorecard turns its row into `not_checked`):

| code | needs | verify is true when |
|---|---|---|
| `no-demand` | `{ names: string[] (not empty), since: ISO text or Date }` | the `events` table has 0 rows with `name = ANY(names)` and `created_at > since`. Reads `events` only. |
| `no-trigger` | `{ id }` | the function with that id in `ctx.functions` has no triggers, or `enabled === false`. Id found from `fn.opts.id`. |
| `not-registered` | `{ id }` | `ctx.functions` is a list and the id is not in it. No list = false. |
| `monthly-not-due` | `{ cron }` (must be a monthly `M H D * *`) | `min(job_heartbeats.finished_at)` is later than `lastMonthlyFire(cron, ctx.now)`. An empty table = false. |
| `no-running-ad`, `low-traffic`, `no-real-lead`, `not-connected` | nothing required (the lane picks its args) | `ctx.laneNaVerify(sliceId, code, args)` returns `true`. `undefined` or no function = false. |

`sliceId` for a lane code is `row.sliceId`, else the part of `row.id` before the first `:`.

Optional args the sentence reads (the producer's own `detail` wins as the stored reason): `low-traffic` `{count, min, what, days}`; `no-real-lead` `{days}`; `not-connected` `{what}`.

**`reason` in the `verifyNa` result is a short claim, not a sentence**, written to fit the audit's wording: `Said nothing to judge, but ${reason} is not true.` Examples: `no round.started event since 10-05`, `the workflow x having no trigger`, `the job receipts having begun after its last due time`, `no ad running`, `the reason code "foo" being one the computer knows`, `the condition being readable (the read failed: ...)`. It is the same claim text when `ok:true`.

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

- `node --test src/pulse/na-conditions.test.mjs src/pulse/scorecard.test.mjs src/ops/morning-brief.test.mjs src/pulse/daily-pulse.test.mjs src/pulse/heartbeats.test.mjs src/pulse/tripwires.test.mjs src/http/morning-brief-public.test.mjs`: 97 pass, 0 fail, 0 skipped.
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
- **Piece D** (audit): call `verifyNa(row, { db, scope, now, functions, laneNaVerify })`; use `reason` as `Said nothing to judge, but ${reason} is not true.`. `toContractCheck(row).status` is the right test for `audit:not-checked`: an `na` row with a bad `na` object already lands `not_checked`. `NA_NO_REASON` is exported if you want to name it.
- **Piece G** (lanes): the lane codes need nothing required in `args`, so pick what your `naVerify` needs (`{count, min, what, days}` also feeds the standard sentence). `naVerify` must return `true` to stand.
- **Integrator**: (1) regenerate `db/expected-migrations.mjs` (`npm run migrations:manifest`); (2) the migration goes live only on the production ship (`npm run ship`), and until then `saveScorecard` keeps the morning report by saving the old shape; (3) `docs/journeys/heartbeat-flow.md` and `docs/journeys/CHANGELOG.md` are yours; (4) if another branch also took migration number 477, renumber mine and the two places that name it (`scorecard.test.mjs` constant `FILE` and the `MIGRATION` path in `scorecard.pg.test.mjs`; the migration text and the warn line in `saveScorecard` say "477").
