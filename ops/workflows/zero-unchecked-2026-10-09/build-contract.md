# Ship 1 — build contract (2026-10-09, report side only)

This file replaces spec.md section 9 for today. The spec is still the detail source; where the **critic** (`critic.md`) or **this file** says something different, **this file wins**.

Chris's law: "if something's not checked ever, you have to check it." After Ship 1, a live thing on the morning report is green, red, or "nothing to judge today" (with a reason the computer re-checks). Anything else is one red line, `audit:not-checked`.

## What ships today (Ship 1) and what does not

IN: the `na` status and its conditions; folding the 176 slice claims into the real check that ran; four slice files that stop reading repo files; the 7 lane "nothing to judge" rows; the monthly "too soon" rows; `wf:` rows judged from the `events` table only; the cheap audit rows; the migration for `na_count`.

OUT (do not build, do not touch): `run-evidence` middleware, `workflow_runs`, `event_handoffs`, `src/workflows/client.mjs`, `src/events/bus.mjs`, the hourly `pulse-self` beat, the 495-surface sort (`tripwires*`), new money checks, `audit:count-drop / never-checks / hourly-ran / run-recorder / tripwire-holes`.

## Shared rules for every builder

- Work only in your own git worktree and on your own branch `build/ZU-<piece>-2026-10-09` (the workflow gives it to you). Commit to that branch in your worktree when your tests pass. Never touch the main checkout, never `git checkout main`, never push, ship, deploy, stash, or merge.
- No database write, no migration run, no POST/PUT/DELETE, no send, no AI call, no new dependency. Live reads only through the scratchpad `sql.mjs` read-only helper if you need a real fact; never print a secret.
- Do not read repo files at run time (`fs`, `readFileSync`, folder scans) in anything that runs on the server. Import instead. A folder scan ships empty (CLAUDE.md section 12).
- Ids unique across `src/pulse/**` (grep before you add one).
- Touch only the files you own (list below). If you need a change in someone else's file, write it as a request in your manifest. Do not edit it.
- Do not weaken, skip, or delete any existing test.
- Words a human reads (reasons, fixes, details): 4th grade English, short sentences, the company is spelled **Fundhub**.
- Stuck rule: two failed tries at the same fix, stop and report.
- Finish with a manifest written to `ops/workflows/zero-unchecked-2026-10-09/manifest-<piece>.md` inside your worktree (files touched, exports added with their exact names and argument shapes, tests added, what you could not do).

## The shapes every piece agrees on (do not invent others)

**A pulse row** (what checks return, before the scorecard): `{ id, kind, group, status, detail, suggestedFix?, customerSees?, schedule? }`, status one of `PASS`, `FAIL`, `skip`, `up`, `down`, `na`, or the old string `"not checked"`.

**An N/A pulse row** has `status: "na"`, `detail` = one 4th-grade sentence saying why and when it will be judged, and `na: { code, args }`. `code` is a key of `NA_CONDITIONS`; `args` is a plain JSON object (numbers, strings, ISO times).

**A scorecard row** for N/A: `{ id, group, status: "na", reason, na_code, na_args }`. The stored statuses are `green`, `red`, `na`, `not_checked`.

**`NA_CONDITIONS`** (`src/pulse/na-conditions.mjs`) is a frozen object `{ [code]: { say(args) -> string, verify: async (args, ctx) -> boolean | "lane" } }`.
`verifyNa(row, ctx) -> Promise<{ ok: boolean, reason: string }>` is the one door the audit uses. `ctx = { db, scope, now, functions, laneNaVerify }`.
- A code with `verify: "lane"` is answered by the lane file: `ctx.laneNaVerify(sliceId, code, args) -> Promise<boolean | undefined>`. `undefined` means the lane has no verifier, which is `ok:false`.
- A thrown error, an unknown code, or missing args is `ok:false`.
- The codes today: `no-demand`, `no-trigger`, `not-registered`, `monthly-not-due`, `no-running-ad`, `low-traffic`, `no-real-lead`, `not-connected`. No others.

**A gap lane file** that can say "nothing to judge" returns a row with `status:"na"` and `na:{code,args}` from its `gapChecks(ctx)`, and exports `naVerify = { "<code>": async (args, ctx) => boolean }` using the lane's own SQL and its own minimum constant (no copied number). `ctx = { db, scope, now }`.

**Folding** (`src/pulse/coverage/link.mjs`): a slice row that only claims "covered" carries `foldInto: "<target id>"` (a `reg:`, `job:` or `wf:` id). `foldCoverage(checks) -> { checks, folded, dangling }` is pure: for each row with `foldInto`, if a row with that id is in `checks` (and is itself not folded), remove the claim and push the claim's id onto the target's `also` array; if the target is missing, keep the claim as a `skip` row (lands `not_checked`) with the reason "Claims covered by <target>, but <target> did not run today". `folded` is the count removed.

**Audit** (`src/pulse/self-audit.mjs`): `auditPulse({ checks, folded, manifest, functions, db, scope, now, laneNaVerify, gapLanes }) -> Promise<{ checks, rows }>`. `checks` is the input list with every N/A row that failed its `verify` replaced by a `skip` row (so it lands `not_checked`). `rows` are the `audit:*` pulse rows. It never throws: a failure inside is one row `audit:crashed`. `buildManifest(...) -> { ids: Set<string>, byGroup }`, pure, built only from imported constants.

**Event workflow rows** (`src/pulse/workflow-runs.mjs`): `checkWorkflowRuns({ db, scope, now, functions }) -> Promise<row[]>`, one row per bundled function that is not a cron, id `wf:<function id>`, `kind:"coverage"`, `group:"jobs"`.

## Pieces (exclusive files)

### A — status model, scorecard, summary line, migration
Owns: `src/pulse/na-conditions.mjs` (+ `.test.mjs`), `src/pulse/scorecard.mjs` (+ new `scorecard.test.mjs`), `summarizeSystems` in `src/ops/morning-brief.mjs` (+ its test file lines only), `db/migrations/477_zero_unchecked_na.sql` (+ a `.pg.test.mjs` in `src/` if the repo pattern allows; it must skip cleanly with no `DATABASE_URL`, and say so).
Do not edit `db/expected-migrations.mjs`; the integrator regenerates it after the number is final.
Build:
1. `NA_CONDITIONS` + `verifyNa` as in the shapes above. Core verifies: `no-demand` (the `events` table has 0 rows with `name = ANY(args.names)` and `created_at > args.since`; **it reads `events`, never a run-recorder table**), `no-trigger` (the bundled function in `ctx.functions` has no triggers or is disabled), `not-registered` (id not in `ctx.functions`), `monthly-not-due` (`min(job_heartbeats.finished_at)` is later than `lastMonthlyFire(args.cron, now)`; import `lastMonthlyFire` from `src/pulse/heartbeats.mjs`). The four lane codes use `verify: "lane"`. Each code: a PASS test and a FAIL test.
2. `scorecard.mjs`: `toContractCheck` maps `na` with a valid `na` object to the scorecard N/A row; a `na` row with no valid object becomes `not_checked` with reason "Said nothing to judge but gave no reason the computer can check". `countChecks` returns `{ green, red, na, not_checked }`. `saveScorecard` writes `na_count`. If the insert fails with Postgres code `42703` (no column) or `23514` (check), save once more in the old shape (every `na` written as `not_checked`, no `na_count`) and log one line, so the morning report is never lost before the migration is applied. Keep a row's `also` array in the stored JSON.
3. `summarizeSystems`: returns `{ status, total, green, red, na, not_checked, reds, line }`; `not_checked` no longer includes `na`. The line: `Systems: 690 of 757 checks green. 3 red: <first ids>. 64 had nothing to judge today.` "Nothing needs you." only when red is 0 and not_checked is 0. Reds ordered: new today (day_count 1) first, then money tripwire ids, then customer tripwire ids, then `audit:*`, then the rest, stable inside each (tripwire ids come from `TRIPWIRES[*].checks` in `src/pulse/tripwires.mjs`; import read-only, do not edit that file).
4. Migration: add `na_count integer NOT NULL DEFAULT 0 CHECK (na_count >= 0)` to `pulse_scorecards`; replace the counts-match constraint so it counts four statuses (`green_count + red_count + not_checked_count + na_count = jsonb_array_length(checks)` or whatever shape the existing constraint uses; read migration 430). Idempotent (`IF NOT EXISTS`, drop-then-add). Check how the existing earlier rows satisfy the new constraint (na_count defaults to 0, no old row has `na`).
Acceptance: `node --test` on your files green; constraint test or a clear skipped-with-reason; legacy-shape save fallback tested with a fake db that throws `42703`.

### B — event workflow rows, monthly N/A, workflow guard
Owns: `src/pulse/workflow-runs.mjs` (+test), `src/pulse/workflow-coverage.test.mjs`, and in `src/pulse/heartbeats.mjs` only the "too soon" branch of `checkJobHeartbeats` (+ lines in `heartbeats.test.mjs`).
Build:
1. `checkWorkflowRuns`. Event names come from each bundled function's triggers (`functions` is the list exported by `src/workflows/index.mjs`; read how `fn.opts` / triggers are exposed in the installed Inngest 3.54 and in `src/pulse/heartbeats.mjs`/`src/pulse/tripwires.mjs`, which already walk it). Skip crons (they are the `job:` rows). `since = now - 3 days`. One grouped read of `events` (`SELECT name, count(*), min(created_at), max(created_at) ... WHERE name = ANY($1) AND created_at > $2 GROUP BY name`, run through `scope` the way the gap lanes read `events`; check the real column names in `db/schema/001_init.sql`). Rules, first hit wins:
   a. no trigger or `enabled === false`, or in `NOT_LIVE_WORKFLOWS` (each with a reason of 40+ characters; today `n-01-cold-nurture`, `n-02-warm-nurture`, `n-03-hot-nurture`; verify they really have no trigger) -> `na` code `no-trigger`, args `{ id }`.
   b. none of the function's trigger names appears in `events` since `since` -> `na` code `no-demand`, args `{ names, since }`. Detail: "No <names> event came since <date>. Judged the day one comes."
   c. at least one event since `since` -> status `skip` (lands `not_checked`, red through the one aggregate line). Detail: "<n> <name> event(s) came since <date> (first <time>). Nothing records that this workflow ran. Run receipts are not switched on yet." This is on purpose: we handed it work and cannot prove it ran. Never `PASS`, never `na`.
   d. the read failed -> `skip` with the error text.
   Also export `NOT_LIVE_WORKFLOWS` and the `since` helper. One read for all functions, not one per function. Budget under 3 s on the live database.
2. `checkJobHeartbeats` too-soon branch: when the row is monthly (`interval == null`) return `status:"na"` with `na:{ code:"monthly-not-due", args:{ cron: row.cron } }` and the detail "Runs once a month. Its last due time came before receipts began. First judged <date>." Keep the existing `skip` for non-monthly rows exactly as it is. Update the existing tests that expect `skip` for the monthly case and add a case for each.
3. `workflow-coverage.test.mjs`: fails when a bundled function has an event trigger whose name is not in `src/events/canonical.mjs` (unless on a written allow-list with a reason), when a function with no trigger is not in `NOT_LIVE_WORKFLOWS`, or when a cron function is not on `INNGEST_JOBS`. Read the real state first and make the test pass on today's tree without weakening it; list any real finding on the manifest instead of hiding it.
Acceptance: tests green; the 65 rows exist for today's bundle; a fake db with one event gives `skip`, with none gives `na`.

### C — fold, aliases, not-live rows, four slices that stop reading files
Owns: `src/pulse/coverage/link.mjs` (new, +test), `src/pulse/coverage/run-slices.mjs` (+ `run-slices.test.mjs` lines), `slice-06-briefs.mjs`, `slice-09-documents.mjs`, `slice-11-hiring.mjs`, `slice-23-pages.mjs` (+ their tests). Do not touch `slice-03-marketing.mjs` or `gap-sms.mjs` (a fixer is changing them).
Build, from spec section 2 with these changes:
1. `GAP_STATUSES` gains `na`; `gapResult` carries `row.na` through (code + args) and keeps `sliceId` and `checkId`.
2. `evaluateRow` sets `foldInto` for a claim row by this order, first hit wins: `ALIASES` (exported from `link.mjs`; **do not alias `morning-brief`**: leave it to the audit, see D), registry (`PULSE_REGISTRY` row with `coverageKey(r) === row.id` or `r.id === row.id` -> `reg:<r.id>`), `ALLOWED_UNMONITORED` key whose `route:<id>` is in `TRIPWIRES` -> that entry's first non-ping check id, an id in `JOBS` -> `job:<id>`, a bundled Inngest function id -> `wf:<id>`. Rows that have their own real evaluation today (the agent read for `ag-07-cron-daily-pulse`, the marketing heartbeat rows `clock`, `worker`, `outbox_drain`, payout/floor stamps that return a time) keep it. Nothing found: stay `not checked` with "Claims covered, but no check ran for <id>".
3. `NOT_LIVE_ROWS` in `link.mjs`: `02-daily-pulse:script-dry-run-default`, `02-daily-pulse:pulse-never-fixes`, `02-daily-pulse:proof-does-not-text`, `16-nurture:n-05-repair-complete-nurture`, `03-marketing:page_seen`, each with a reason; they leave the scorecard. A test checks each still exists in its slice or is documented as gone (the nurture one does not exist as a file: say so in the reason and have the test accept that). No slice file is edited for these.
4. `foldCoverage` as in the shapes above, with tests: target found, target missing, target itself folded (must not fold into a fold), `also` list, counts.
5. The four slices: replace every `fs`/folder read with imports (`functions` from `src/workflows/index.mjs`, `DESK_FILES`/`PULSE_REGISTRY` from `src/pulse/registry.mjs`, or the right constant), so they load on the server with 0 `load-error` rows. Keep every existing assertion's meaning; tests stay green. Slice 06 rows: the `morning-brief` claim stays as it is today.
6. Use `ops/workflows/zero-unchecked-2026-10-09/slice-link-map.json` as a test fixture for the fold: 176 registry claims must resolve to a `reg:` target. Print which claims land where (counts per target kind) on the manifest.
Acceptance: all slice tests green and unweakened; `modules.test.mjs` green; fold test shows 176 of 176 registry claims have a target.

### D — the self-audit
Owns: `src/pulse/self-audit.mjs` (+test).
Build `auditPulse` and `buildManifest` with these rows only (spec 4.2, narrowed). All `group:"backend"`, one row each, detail names a count and at most the first 10 ids. Each has a PASS test and a FAIL test:
- `audit:not-checked`: red when any final row lands `not_checked` (use `toContractCheck(row).status` from `src/pulse/scorecard.mjs`, read-only import, so a green with no proof counts too). Detail: "<n> checks were not checked: <first 10 ids>. A live thing that is not checked is a break in the heartbeat." Fix line says to convert each to a real check or a verified N/A and names `src/pulse/na-conditions.mjs`.
- `audit:na-verified`: runs `verifyNa` for every `na` row (batch by code); every failed one is replaced in `checks` by a `skip` row with the reason "Said nothing to judge, but <why> is not true", and this row is red naming them.
- `audit:totals`: the report's own numbers add up: counts of final statuses sum to the number of rows, no status outside the four, no two rows share one id.
- `audit:expected-present`: every manifest id is in the run or in some row's `also`. The manifest is built from imports only: `PULSE_REGISTRY` (`reg:<id>`), `JOBS` (`job:<job>`), non-cron bundled functions (`wf:<id>`), every slice claim id not in `NOT_LIVE_ROWS` (present itself or in an `also`), the named ids the pulse always emits (read `src/pulse/daily-pulse.mjs` for the real list), and each gap lane's exported id list where it has one (`CHECKS`/`ids` export; write the list of lanes that do not export one on the manifest as a leftover).
- `audit:lanes-ran`: a gap lane in `gapLanes` produced no row, or produced a row whose `checkId` is `step`, `threw`, `not-listed`, `bad-row`; or a slice produced a `load-error` row. Names the file.
- `audit:workflow-coverage`: a bundled function not built on the shared client (`fn.client !== inngest` from `src/workflows/client.mjs`); a cron function not on `INNGEST_JOBS`; an event function with no `wf:` row.
- `audit:briefs-sent`: one read of `morning_briefs` (look at `src/ops/morning-brief.mjs` for the table and column names): red when there is no row for **yesterday (Arizona date) with `kind='morning'` and `delivery_status='sent'`**. Evening is not judged here. It also covers the `06-briefs:morning-brief` claim, so also export the claim id it covers and let the integrator fold it.
- If the audit itself throws: `auditPulse` returns the input `checks` unchanged plus one red row `audit:crashed` with the error.
Rules: every read is wrapped; under 3 s; reads only; a clean fixture makes every row green; one fixture per row makes it red. Never let `audit:not-checked` flood: it is one row.
Acceptance: tests green; a table in your manifest of each row, its red condition and the test that proves it can go red.

### G — lane "nothing to judge" rows
Owns: `gap-ads.mjs`, `gap-leads.mjs`, `gap-pixels.mjs`, `gap-social.mjs` in `src/pulse/coverage/` (+ their tests). Nothing else.
Build, from spec 1.2 lane codes, only these seven rows (find each in the lane file; they return `skip` today when there is nothing to judge): `gap-ads:ads-spend-day-missing` and `gap-ads:ads-running-no-metrics` -> `no-running-ad`; `gap-leads:lead:pipe-cut-with-traffic`, `gap-leads:lead:clickfunnels-posts-silent`, `gap-pixels:ad-click-stored` -> `low-traffic`; `gap-leads:lead:slo-contact-not-in-clickfunnels` -> `no-real-lead`; `social:video-stats-stale` -> `not-connected`. Each becomes a row with `status:"na"` and `na:{code,args}` only when its own measured condition holds; otherwise it stays a normal PASS/FAIL exactly as before. Each file exports `naVerify` re-using the same SQL and the same minimum constant (export the constant if needed; never copy a number). First confirm each row's current skip reason against the live read-only database and write the measured fact on the manifest.
Acceptance: existing lane tests green and unweakened; a test per code with the condition true (`na`) and false (normal PASS/FAIL, never `na`); `naVerify` tests.

## Integrator (main session, not a builder)
Wires `foldCoverage`, `checkWorkflowRuns`, `auditPulse` into `src/pulse/daily-pulse.mjs` / `src/workflows/daily-pulse.mjs`, regenerates `db/expected-migrations.mjs`, adds `wf:` to `isPingId`, extends `scripts/pulse/prove.mjs`, updates rules, journeys, board; runs the full suite and the bundle proof; ships once.
