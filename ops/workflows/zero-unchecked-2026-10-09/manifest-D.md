# Manifest D — the self-audit (Ship 1, 2026-10-09)

Round 1 branch `build/ZU-D-2026-10-09`. Round 2 (repair after the independent check) branch `build/ZU-D-r2-2026-10-09`, cut from round 1. Round 1 was built from `main` at `fbc54d0e`.

## Files

| file | what |
|---|---|
| `src/pulse/self-audit.mjs` | new in round 1, repaired in round 2. `auditPulse`, `buildManifest`, and the helpers below |
| `src/pulse/self-audit.test.mjs` | new. 85 tests (70 in round 1, 15 added in round 2) |
| `ops/workflows/zero-unchecked-2026-10-09/manifest-D.md` | this file |

Nothing else was touched. No migration, no write, no new dependency.

## Round 2 — the checker's 11 findings, one by one

| # | severity | finding | what was done | proof |
|---|---|---|---|---|
| 1 | medium | A failed N/A row's line was garbled with A's real `verifyNa` (the row's own sentence in quotes, then A's reason as a loose fragment) | `failedNaRow` now writes exactly `Said nothing to judge, but <reason> is not true.` with the reason `verifyNa` gave. The row's own sentence is used only when no reason came back. D's own three fallback reasons are now conditions in the same shape ("the audit having time left to check it again", "the check giving an answer", "the condition being readable (the read failed: ...)") | Tests: `the line for a failed nothing-to-judge row is the contract sentence for every reason shape verifyNa gives` (six reasons copied from A), `only when verifyNa gives no reason...`, `the three reasons the audit writes itself...`, and `when the real verifyNa is in the tree...` (runs A's real file; I ran it with A's `na-conditions.mjs` + `scorecard.mjs` laid over this tree and it passes, then removed them). Mutation: reverting to the old line is killed |
| 2 | medium | An empty `gapLanes` or empty `functions` list passed green | Both are now `FAIL`: "The list of gap lanes is empty, so nothing could be judged." and "The list of bundled workflows is empty, so nothing could be judged." `null` stays `skip`. The "All 0 ..." line cannot appear any more | Tests: `audit:lanes-ran goes red, not green, when the list of lanes is empty`, `audit:workflow-coverage goes red, not green, when the workflow list is empty`. Both mutations (guard off) are killed |
| 3 | low | The memo could merge two rows that need different answers (lane from `sliceId` only; a Date turned into `{}`) | The key now takes the lane the way A's `verifyNa` does (`sliceId`, else the id before `:`), and puts the args through JSON first (a Date and its ISO text are one key). Args that will not turn into JSON are asked on their own | Tests: `two lane rows with no sliceId are not merged...` (your probe 1), `rows whose times are Dates are not merged when the times differ...` (your probe 2, plus Date = same-instant text merges), `two lane rows in the same lane... asked once`, `args that will not turn into JSON...`. Mutations (lane dropped, lane from `sliceId` only, no JSON step) are all killed |
| 4 | low | Two owners for the `06-briefs:morning-brief` fold | **D is the one owner.** The audit has to do it: `audit:not-checked` and `audit:totals` are judged inside `auditPulse`, so a fold that came after it would leave the claim counted as not checked (red every morning). C's `pointAuditClaims` second fold runs after the audit rows exist, which is too late for this claim. See "Who folds what" below. `audit:totals` now prints the folded count as `folded + what the audit folded`, so that line is right whether or not the pulse adds `audit.folded` to its own count | Tests: `the audit is the one owner of that fold...`, `the morning-brief claim folds into audit:briefs-sent...`. Mutation (totals ignores the audit's own fold) is killed |
| 5 | low | `held_quiet_hours` is not a real status | Removed from `BRIEF_WHY` and its test. The table allows `dry_run`, `sent`, `failed`, `no_number` (migration 431, `morning_briefs_delivery_status_ck`); nothing in `src/` writes `held_quiet_hours`. Any other value gets the generic line | Test: `an unknown delivery status gets the generic line` (also feeds it `held_quiet_hours`). Mutation (put it back) is killed |
| 6 | low | The manifest read only `CHECK_IDS` | New export `laneCheckIds(mod)` reads `CHECK_IDS`, `MSG_CHECK_IDS` (gap-sms), `GAP_DOORS` and `GAP_WIDGET_CHECKS` (gap-funnels). The gap group went from 128 to 160 ids. The leftover card is now 10 lanes with no list (below) | Tests: `laneCheckIds reads ...`, `buildManifest counts the sms and funnels lanes' own id lists...` (a quiet funnels id goes red), and the drift test now runs `laneCheckIds`, so gap-sms and gap-funnels must emit every id they list, even with a dead database. Three mutations (one per list) are killed |
| 7 | low | The "lazy imports protect the pulse" note was wrong after the merge | Note corrected here and in the file header. The code stays lazy, which lets the file run on its own and lets tests inject the helpers. After the merge `scorecard.mjs` (A) imports `na-conditions.mjs` and `run-slices.mjs` (C) imports `link.mjs` at load, and this file imports both, so a syntax error in either still stops the pulse from starting | Comment only. I re-read the imports on A's and C's branches |
| 8 | low | D and B disagreed on what a cron is | D now uses B's rule: a cron is a function with a cron trigger and no event trigger. A function with both gets a `wf:` row, and `audit:workflow-coverage` asks for that row, not for `INNGEST_JOBS`. `buildManifest` follows the same rule | Tests: `a function with a cron and an event is a wf: row like piece B's, not a cron`, `the manifest expects a wf: id for a function with a cron and an event...`. Mutation (any cron counts) is killed. The test on today's real 100-function bundle still passes |
| 9 | low | Unused `AUDIT_ROW_IDS` import in the test | Removed | `node --test` |
| 10 | low | Words that are not 4th grade, or promise run receipts | "threw, or would not load" is now "stopped with an error, or would not load". "not on the shared client, so it skips the run receipts" is now "not built on the shared Inngest client in src/workflows/client.mjs". The "All 0" lines are gone (finding 2) | Tests assert the new wording and that "receipts" is absent. Mutations are killed |
| 11 | note | `audit:totals` is red from day one: four ids sit twice in `PULSE_REGISTRY` | **No code change.** D is right to be red and I did not soften it. See finding 1 under "Findings" | none needed |

## Who folds what (read this, integrator)

- `06-briefs:morning-brief` is folded **inside `auditPulse`**, by D, and nowhere else. `AUDIT_COVERS` is exported only so a test (and a reader) can see which claims the audit owns.
- Do **not** rely on C's `pointAuditClaims` + a second `foldCoverage` for this claim. It would run after the audit and the claim would already have been counted as not checked in `audit:not-checked` and `audit:totals`. If you leave it wired anyway it does no harm: D has already removed the claim, so the second fold finds nothing.
- Add the returned `folded` to the pulse's own folded count (`folded += audit.folded`). If you forget, `audit:totals` still prints the right number (it adds the audit's own fold to the number you passed in); only the stored count would be one short.

## Exports (exact names and argument shapes)

```js
auditPulse({
  checks,            // required: the run's pulse rows, after the slice fold
  folded = 0,        // how many slice claims were folded already (shown in audit:totals; must be a whole number if given)
  manifest = null,   // { ids: Set|Array, byGroup } from buildManifest/loadManifest. Built here when left out
  functions = null,  // the bundled Inngest functions (src/workflows/index.mjs). Needed by audit:workflow-coverage and the wf: ids. [] is red, null is skip
  gapLanes = null,   // GAP_LANES (array of "gap-xxx"). Needed by audit:lanes-ran. [] is red, null is skip
  db = null, scope = null, now = new Date(),
  laneNaVerify = null, // (sliceId, code, args) => Promise<boolean|undefined>; see makeLaneNaVerify
  orgId = null,        // extra, optional: company for the morning-report read; default company when left out
  // wiring that tests inject, the pulse leaves alone:
  verifyNa = null, sharedClient = null, notLiveRows = null, contract = null /* { toContractCheck, countChecks } */, budgetMs = 2500
}) -> Promise<{ checks, rows, folded }>

buildManifest({ registry = PULSE_REGISTRY, jobs = JOBS, functions = [], sliceModules = [], gapModules = [],
                namedIds = NAMED_PULSE_IDS, notLive = [] }) -> { ids: Set<string>, byGroup: { reg, job, wf, slice, gap, named } }   // pure

loadManifest({ functions = [], notLiveRows = null, ...buildManifest args }) -> Promise<manifest>   // loadSliceModules() + loadGapModules() + buildManifest
makeLaneNaVerify({ db, scope, now, gapFiles = GAP_FILES }) -> (sliceId, code, args) => Promise<boolean|undefined>   // calls the lane's naVerify[code](args, { db, scope, now })
notLiveIds(x) -> Set<string>      // NOT_LIVE_ROWS as a list of ids, a list of { id }, a map, or a set
laneCheckIds(mod) -> string[]     // NEW in round 2. CHECK_IDS + MSG_CHECK_IDS + GAP_DOORS ids + GAP_WIDGET_CHECKS ids, strings only, no repeats
```

Also exported: `AUDIT_ROW_IDS`, `AUDIT_COVERS`, `NAMED_PULSE_IDS`, `AUDIT_BUDGET_MS`, `LANE_DIED_CHECK_IDS`, `BRIEFS_SENT_SQL`.

`auditPulse` returns:
- `checks`: the input rows. Every `na` row whose reason failed `verifyNa` is replaced by a `skip` row with the same id (no `na` object, detail `Said nothing to judge, but <reason> is not true.`). The claim `06-briefs:morning-brief` is folded out.
- `rows`: seven `audit:*` rows in this order: `audit:not-checked`, `audit:na-verified`, `audit:totals`, `audit:expected-present`, `audit:lanes-ran`, `audit:workflow-coverage`, `audit:briefs-sent`. Shape: `{ id, kind: "audit", group: "backend", status: "PASS"|"FAIL"|"skip", detail, suggestedFix, customerSees, schedule: null }`. `audit:briefs-sent` also carries `also: ["06-briefs:morning-brief"]` when it folded that claim.
- `folded`: how many claims this call folded (add it to the pulse's `folded`).
- It never throws and never changes the rows it was handed. If it breaks: `{ checks: <input untouched>, rows: [audit:crashed FAIL], folded: 0 }`.

## The rows: red condition and the test that proves it can go red

All in `self-audit.test.mjs`. A clean fixture makes all seven green (`a clean run makes every audit row green`). Mutation checks: 26 deliberate breaks in round 1 and 16 more in round 2 (each fix reverted, wording put back, memo changed, guards turned off). The tests killed all of them (0 survivors). The scripts are in the scratchpad only, not in the repo.

| row | red when | red tests (name starts with) |
|---|---|---|
| `audit:not-checked` | any final row (input rows after N/A replacement, plus the other audit rows) maps to `not_checked` through `toContractCheck`. One row, first 10 ids, "and N more" | `audit:not-checked is red and names the ids`, `...one row, lists only the first ten`, `...counts the audit's own skip rows`, `with no contract given, the real scorecard mapping...` (a PASS with no proof) |
| `audit:na-verified` | an `na` row's `verifyNa` came back not ok, threw, timed out, or gave nothing. The row is replaced by a `skip` row | `goes red when a reason is no longer true`, `an unknown code or missing args`, `a verify that throws`, `never answers is cut off inside the budget` |
| `audit:totals` | two rows share an id; a raw status outside `PASS FAIL skip up down na "not checked"`; a row mapped outside the four stored statuses; the four counts do not add to the row count; `folded` is not a whole number | five tests, one per cause |
| `audit:expected-present` | any manifest id is not an id, not in any `also`, and not a lane's `checkId`. An empty manifest is red. A manifest that cannot be built is `skip` | `goes red and names a check that went missing`, `...when the list itself is empty`, `...is a skip, not a pass, when the list cannot be built`, `builds the live list when none is given`, `buildManifest counts the sms and funnels lanes' own id lists...` |
| `audit:lanes-ran` | **the list of lanes is empty**; a lane in `gapLanes` gave no row; a row with `checkId` `step` / `threw` / `not-listed` / `bad-row`; a `load-error` row; the slice pass or org step died (`coverage-slices`). Names the file. `null` list is `skip` | `...when the list of lanes is empty` (round 2), four tests (one per checkId), the `:step` sliceId test, the load-error test, the slice-pass-died test, the no-rows test |
| `audit:workflow-coverage` | **the list of workflows is empty**; a function with `fn.client !== inngest`; a pure cron (cron trigger, no event trigger) not on `INNGEST_JOBS`; any other function with no `wf:<id>` row. `null` list is `skip` | `...when the workflow list is empty` (round 2), three red tests, one per rule, `a function with a cron and an event...` (round 2), a real-client test, and a test on today's real 100-function bundle (PASS: no false red) |
| `audit:briefs-sent` | no `morning_briefs` row for yesterday (Arizona) with `kind='morning'` and `delivery_status='sent'`. Reason by status: `failed` (+ error), `dry_run`, `no_number`, no row, anything else gets the generic line. Read fails or no db: `skip` | four red tests (no row, failed, dry_run, no_number), the unknown-status test, the Arizona-day test, the read-fails and read-hangs tests (those two are `skip`) |
| `audit:crashed` | the audit itself throws | `if the audit itself breaks...`, `auditPulse never throws, even with nothing` |

Read counts: one `morning_briefs` read (SQL exported as `BRIEFS_SENT_SQL`, `kind = 'morning'` only, default company when no `orgId`), plus whatever `verifyNa` reads (same code + args + lane is asked once; eight at a time; a 2.5 s budget; each call is cut off at the budget). The reads and the manifest build run side by side. Offline what-if on the stored 2026-10-09 rows took 283 ms (round 1).

## Deliberate differences from the contract (read these)

1. **`06-briefs:morning-brief` is folded by the audit itself**, not by the integrator. Reason and rules: "Who folds what" above.
2. **`verifyNa`, `NOT_LIVE_ROWS` and the shared `inngest` client are loaded lazily** (`import()` with a literal path) on first use, and tests inject all three. This lets the file run on its own and keeps the tests free of A and C. It does **not** protect the pulse after the merge (finding 7): A's `scorecard.mjs` and C's `run-slices.mjs` import those files at load.
3. **`kind: "audit"`** on the audit rows (the contract left `kind` open). `formatScorecard` puts a row of this kind in the main table, not the Coverage table.
4. **Named ids include the five machine rows** (`meta-sync`, `clickfunnels-night-job`, `meta-server-events`, `dying-ad-scan`, `meet-transcript-sweeper`), read from `MACHINE_CHECKS`. `pipeline:*` and `live-playwright` are left out because they only run when a company is found. A test runs the real `runDailyPulse` with fakes and fails if any named, `reg:` or `job:` id is not in the run.
5. **Extra exports** the integrator will want: `loadManifest`, `makeLaneNaVerify`, `notLiveIds`, `laneCheckIds`.
6. **An empty list is red, a missing list is a skip** (round 2): `gapLanes` and `functions` follow the same rule as an empty manifest.
7. **A cron is a function with a cron trigger and no event trigger** (round 2), the same rule as B's `checkWorkflowRuns`.

## Measured facts (read-only, live database, 2026-10-09, round 1)

- `morning_briefs`: columns `delivery_status`, `delivery_error`, `kind`, `brief_date`, `org_id`. 2026-10-08 `morning` is `sent`, `dry_run=false`. The default company is `fb789b0b-...` (`orgs.is_default`). The status check on that table allows only `dry_run`, `sent`, `failed`, `no_number`.
- Stored scorecard 2026-10-09: 1008 rows, 695 green, 14 red, 299 not checked. Run through the new audit offline, `audit:not-checked` counts exactly 299.
- **Manifest sizes today (round 2, local load, `notLiveRows: []`)**: reg 393, job 43, wf 65, slice 350, gap **160** (was 128), named 14, 1025 ids in all. Slices 06, 09, 11, 23 read repo files at load in this tree, so their numbers move when C rewrites them.
- **Manifest against the stored 2026-10-09 morning (round 1 numbers)**: reg 1 missing (`reg:morning-brief`, added after that deploy); job 1 missing (`job:pulse-hourly`, same); wf 65 missing (B builds them); slice 10 missing (`09-documents:*` x8 and `11-hiring:*` x2, those slice files did not load on the server); gap 0 missing; named 0 missing. The extra 32 gap ids from sms and funnels were not compared with that stored morning (no live read in round 2); the drift test proves both lanes emit every id they list even with a dead database and dead network.
- The stored 2026-10-09 morning has three `load-error` rows (`slice-09-documents`, `slice-11-hiring`, `slice-23-pages`). `audit:lanes-ran` will be red on those until C ships.

## Findings (not fixed, not mine)

1. **Four ids appear twice in the real registry, so `audit:totals` will be red on day one.** `PULSE_REGISTRY` gives one id to two rows each: `reg:contracts`, `reg:journeys`, `reg:lenders`, `reg:soft-pull-approve` (an `/api/<x>` row and an `/app/<x>.html` desk row share the id). Confirmed in the stored 2026-10-09 and 2026-10-08 cards. D is right to go red and stays strict. Two ways out, both outside D: whoever owns `src/pulse/registry.mjs` gives the desk or api rows distinct ids before ship (touches `registry.test.mjs`, tripwire `checks` lists and any claim alias that points at `reg:<id>`; piece C's alias rule `r.id === row.id -> reg:<r.id>` is ambiguous for these four), or Chris accepts the known red on day one.
2. **Lanes with no id list, so `audit:expected-present` cannot see them go quiet (10)**: `gap-ads`, `gap-auth`, `gap-banks`, `gap-documents` (it has `ID_*` constants but no list), `gap-email`, `gap-inquiry`, `gap-jobs`, `gap-partners`, `gap-portal`, `gap-staff`. Leftover card: each should export `CHECK_IDS` (the other lanes do). `audit:lanes-ran` still catches a lane that dies or gives no rows. **Partial list:** `gap-sms` lists 5 ids (`MSG_CHECK_IDS`) but its journey rows have no list. `gap-funnels` is now fully listed (doors and widget checks); the `funnel:doors` row it sends only when there is no fetch is not on the list on purpose.
3. In a fresh git worktree, `src/pulse/registry.test.mjs` "every registry row names a real handler or desk file" fails on `public/leads/c01cb7592c8bb994130158e897e99bf1/index.html`. That folder is excluded in `.git/info/exclude` (local only), so it exists in the main checkout and not in a worktree. Not caused by this change. Same single failure in round 2.
4. B's `checkWorkflowRuns` gives a `wf:` row to a function with both a cron and an event trigger, and nothing watches that function's cron side as a `job:` row. No such function exists in today's bundle. Not changed here.

## Integrator wiring (what I expect, in order)

```js
// after foldCoverage(...) and before buildScorecard(...)
const audit = await auditPulse({
  checks, folded, functions, gapLanes: GAP_LANES,
  db, scope: staffScope, now, orgId: resolvedOrg,
  laneNaVerify: makeLaneNaVerify({ db, scope: staffScope, now })
});
checks = [...audit.checks, ...audit.rows];
folded += audit.folded;
```

- `functions` cannot be a static import inside `src/pulse/daily-pulse.mjs`: `src/workflows/index.mjs` imports `src/workflows/daily-pulse.mjs`, which imports the pulse (a cycle). Pass it in from `src/workflows/daily-pulse.mjs` with a run-time `await import("./index.mjs")`, or through `runDailyPulse({ functions })`. **If that import fails, do not fall back to `[]`.** An empty list is now a red `audit:workflow-coverage`, which is the right result, but pass `null` if you want it to read as "not given" (a skip, which `audit:not-checked` also catches).
- Do not wire C's `pointAuditClaims` + second fold for `06-briefs:morning-brief` (see "Who folds what").
- Leave `manifest` out and the audit builds it. Or call `loadManifest({ functions })` once and pass it.
- `audit:*` rows are `FAIL`, so `recordAgentRun` will write the AG-07 run as `fail` on a red audit (it already does for any FAIL). Worth knowing for `gap-ai-agents` `failed-runs`.
- Audit rows are not in `TRIPWIRES` or `NOT_CUSTOMER_FACING`: they are check ids, not surfaces.

## Integrator check after merging A and C

- `NOT_LIVE_ROWS` shape: C built it as an object keyed `<sliceId>:<checkId>` with a reason string; `notLiveIds` accepts that (an object keyed by id).
- A's `toContractCheck` returns `status: "na"` for a valid `na` row, and `countChecks` returns `na`. `audit:not-checked` and `audit:totals` use both.
- `verifyNa(row, ctx)` resolves `{ ok, reason }` with `reason` a short condition. I ran D's tests with A's real `na-conditions.mjs` and `scorecard.mjs` laid over this tree (then took them out again): all 85 pass, and the failed-row line reads `Said nothing to judge, but no round.started event since 10-06 is not true.` The test `when the real verifyNa is in the tree...` does nothing until `na-conditions.mjs` exists; after the merge it runs for real.
- Then run `node --test src/pulse/self-audit.test.mjs` and `npm run pulse:prove` (the bundle proof: the three lazy imports must be packed).

## Not done / not verified

- Not run against the built Netlify bundle (`npm run pulse:prove`): needs the integrator's wiring.
- Not run against the real piece B and C files together with D (only A's two files were laid over this tree).
- `npx tsc --noEmit`: the repo has no tsconfig (`scripts/lint.mjs` header says so). `npm run lint` passes (3193 files parse clean).
- `docs/journeys`: no journey changed, so no `-actual.md` or changelog line.
- Hourly pulse, `count-drop`, `never-checks`, `hourly-ran`, `run-recorder`, `tripwire-holes`: out of scope for Ship 1, not built.

## Tests

- `node --test src/pulse/self-audit.test.mjs`: 85 pass, 0 fail, 0 skipped (about 3 s).
- `node --test "src/pulse/**/*.test.mjs"`: 2293 pass, 1 fail (finding 3, not caused by this change), 65 skipped (the `.pg.test.mjs` files, no `DATABASE_URL`, same as before).
- `npm run lint`: clean.
