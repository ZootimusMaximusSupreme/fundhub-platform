# Manifest D — the self-audit (Ship 1, 2026-10-09)

Branch `build/ZU-D-2026-10-09`. Built from `main` at `fbc54d0e` (the worktree started on an older commit that did not have the contract, so the branch was cut from `main`).

## Files

| file | what |
|---|---|
| `src/pulse/self-audit.mjs` | new. `auditPulse`, `buildManifest`, and the helpers below |
| `src/pulse/self-audit.test.mjs` | new. 70 tests |
| `ops/workflows/zero-unchecked-2026-10-09/manifest-D.md` | this file |

Nothing else was touched. No migration, no write, no new dependency.

## Exports (exact names and argument shapes)

```js
auditPulse({
  checks,            // required: the run's pulse rows, after the slice fold
  folded = 0,        // how many slice claims were folded already (only shown in audit:totals; must be a whole number if given)
  manifest = null,   // { ids: Set|Array, byGroup } from buildManifest/loadManifest. Built here when left out
  functions = null,  // the bundled Inngest functions (src/workflows/index.mjs). Needed by audit:workflow-coverage and the wf: ids
  gapLanes = null,   // GAP_LANES (array of "gap-xxx"). Needed by audit:lanes-ran
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
```

Also exported: `AUDIT_ROW_IDS`, `AUDIT_COVERS`, `NAMED_PULSE_IDS`, `AUDIT_BUDGET_MS`, `LANE_DIED_CHECK_IDS`, `BRIEFS_SENT_SQL`.

`auditPulse` returns:
- `checks`: the input rows. Every `na` row whose reason failed `verifyNa` is replaced by a `skip` row with the same id (no `na` object, detail `Said nothing to judge, but "<its own detail>" is not true. <why>`). The claim `06-briefs:morning-brief` is folded out (see below).
- `rows`: seven `audit:*` rows in this order: `audit:not-checked`, `audit:na-verified`, `audit:totals`, `audit:expected-present`, `audit:lanes-ran`, `audit:workflow-coverage`, `audit:briefs-sent`. Shape: `{ id, kind: "audit", group: "backend", status: "PASS"|"FAIL"|"skip", detail, suggestedFix, customerSees, schedule: null }`. `audit:briefs-sent` also carries `also: ["06-briefs:morning-brief"]` when it folded that claim.
- `folded`: how many claims this call folded (add it to the pulse's `folded`).
- It never throws and never changes the rows it was handed. If it breaks: `{ checks: <input untouched>, rows: [audit:crashed FAIL], folded: 0 }`.

## The rows: red condition and the test that proves it can go red

All in `self-audit.test.mjs`. A clean fixture makes all seven green (`a clean run makes every audit row green`). I also ran a mutation check: 26 deliberate breaks of `self-audit.mjs` (each row made unable to go red, memo removed, timeout removed, concurrency cap removed, input mutated, etc.), and the tests killed all 26 (0 survivors). The script is in the scratchpad only (`d-mutate.mjs`), not in the repo.

| row | red when | red tests (name starts with) |
|---|---|---|
| `audit:not-checked` | any final row (input rows after N/A replacement, plus the other audit rows) maps to `not_checked` through `toContractCheck`. One row, first 10 ids, "and N more" | `audit:not-checked is red and names the ids`, `...one row, lists only the first ten`, `...counts the audit's own skip rows`, `with no contract given, the real scorecard mapping...` (a PASS with no proof) |
| `audit:na-verified` | an `na` row's `verifyNa` came back not ok, threw, timed out, or gave nothing. The row is replaced by a `skip` row | `goes red when a reason is no longer true`, `an unknown code or missing args`, `a verify that throws`, `never answers is cut off inside the budget` |
| `audit:totals` | two rows share an id; a raw status outside `PASS FAIL skip up down na "not checked"`; a row mapped outside the four stored statuses; the four counts do not add to the row count; `folded` is not a whole number | five tests, one per cause |
| `audit:expected-present` | any manifest id is not an id, not in any `also`, and not a lane's `checkId`. An empty manifest is red. A manifest that cannot be built is `skip` | `goes red and names a check that went missing`, `...when the list itself is empty`, `...is a skip, not a pass, when the list cannot be built`, `builds the live list when none is given` |
| `audit:lanes-ran` | a lane in `gapLanes` gave no row; a row with `checkId` `step` / `threw` / `not-listed` / `bad-row`; a `load-error` row; the slice pass or org step died (`coverage-slices`). Names the file | four tests (one per checkId), the `:step` sliceId test, the load-error test, the slice-pass-died test, the no-rows test |
| `audit:workflow-coverage` | a function with `fn.client !== inngest`; a cron function not on `INNGEST_JOBS`; a non-cron function with no `wf:<id>` row | three red tests, one per rule, plus a real-client test, plus a test on today's real 100-function bundle (PASS: no false red) |
| `audit:briefs-sent` | no `morning_briefs` row for yesterday (Arizona) with `kind='morning'` and `delivery_status='sent'`. Reason by status: `held_quiet_hours`, `failed` (+ error), `dry_run`, `no_number`, no row. Read fails or no db: `skip` | five red tests (no row, held_quiet_hours, failed, dry_run, no_number), the Arizona-day test, the read-fails and read-hangs tests (those two are `skip`) |
| `audit:crashed` | the audit itself throws | `if the audit itself breaks...`, `auditPulse never throws, even with nothing` |

Read counts: one `morning_briefs` read (SQL exported as `BRIEFS_SENT_SQL`, `kind = 'morning'` only, default company when no `orgId`), plus whatever `verifyNa` reads (same code + args + lane is asked once; eight at a time; a 2.5 s budget; each call is cut off at the budget). The reads and the manifest build run side by side. Offline what-if on the stored 2026-10-09 rows took 283 ms.

## Deliberate differences from the contract (read these)

1. **`06-briefs:morning-brief` is folded by the audit itself**, not by the integrator. If I had left it, the claim row (still "not checked") would make `audit:not-checked` red every morning, and the audit row that answers it does not exist yet when `foldCoverage` runs. Same meaning as `foldCoverage`: the claim leaves `checks`, its id goes on the audit row's `also`, and `folded` counts it. Only a claim that is still `not checked` / `skip` is folded; one that already has a real answer is kept. `AUDIT_COVERS` is exported (`{ "audit:briefs-sent": ["06-briefs:morning-brief"] }`). The integrator does nothing for it, but must add the returned `folded` to the pulse's count.
2. **`verifyNa`, `NOT_LIVE_ROWS` and the shared `inngest` client are loaded lazily** (`import()` with a literal path) on first use, and tests inject all three. Reason: A and C are built in parallel, and if a static import of a broken file killed this module, it would kill the whole 6 a.m. pulse. A broken `na-conditions.mjs` now shows as red `audit:na-verified` rows, a broken `link.mjs` as a `skip` on `audit:expected-present`. After merge the real files are used. Not tested against the real A and C files (they did not exist in my tree): see "Integrator check" below.
3. **`kind: "audit"`** on the audit rows (the contract left `kind` open). `formatScorecard` puts a row of this kind in the main table, not the Coverage table.
4. **Named ids include the five machine rows** (`meta-sync`, `clickfunnels-night-job`, `meta-server-events`, `dying-ad-scan`, `meet-transcript-sweeper`), read from `MACHINE_CHECKS`. The contract said "read daily-pulse.mjs for the real list"; `checkMachine` always emits those ids. `pipeline:*` and `live-playwright` are left out because they only run when a company is found. A test runs the real `runDailyPulse` with fakes and fails if any named, `reg:` or `job:` id is not in the run.
5. **Extra exports** the integrator will want: `loadManifest`, `makeLaneNaVerify`, `notLiveIds`.

## Measured facts (read-only, live database, 2026-10-09)

- `morning_briefs`: columns `delivery_status`, `delivery_error`, `kind`, `brief_date`, `org_id`. 2026-10-08 `morning` is `sent`, `dry_run=false`. The default company is `fb789b0b-...` (`orgs.is_default`). The new check will be green tomorrow if today's report went out.
- Stored scorecard 2026-10-09: 1008 rows, 695 green, 14 red, 299 not checked. Run through the new audit offline, `audit:not-checked` counts exactly 299.
- **Manifest against that real stored morning** (my local load of the slices; slices 06, 09, 11, 23 read repo files at load, so their numbers move when C rewrites them):
  - reg: 393 unique ids expected, 1 missing (`reg:morning-brief`, added after that morning's deploy)
  - job: 43 expected, 1 missing (`job:pulse-hourly`, added after that deploy)
  - wf: 65 expected, 65 missing (piece B builds them)
  - slice claims: 350 expected, 10 missing (`09-documents:*` x8 and `11-hiring:*` x2: those slice files did not load on the server)
  - gap lane ids: 128 expected, **0 missing**
  - named: 14 expected, **0 missing**
- The stored 2026-10-09 morning has three `load-error` rows (`slice-09-documents`, `slice-11-hiring`, `slice-23-pages`). `audit:lanes-ran` will be red on those until C ships.
- Offline test of all 29 gap lanes that export `CHECK_IDS`, with a database that throws and a fetch that fails: every lane still emits every id it lists. This is now a test (`every gap lane that lists CHECK_IDS emits every one of them`), so a lane that drops an id breaks the build instead of silently shrinking the list.

## Findings (not fixed, not mine)

1. **Four ids appear twice in the real registry, so `audit:totals` will be red on day one.** `PULSE_REGISTRY` gives one id to two rows each: `reg:contracts`, `reg:journeys`, `reg:lenders`, `reg:soft-pull-approve` (an `/api/<x>` row and an `/app/<x>.html` desk row share the id). Confirmed in the stored 2026-10-09 and 2026-10-08 cards (same four ids twice). It is a real defect: both rows write into one `applyRepeats` key, so one can hide the other. The contract says duplicates go red, so I kept it strict. Fix is in `src/pulse/registry.mjs` (give the desk or api rows distinct ids) and it touches `registry.test.mjs`, tripwires `checks` lists and any claim alias that points at `reg:<id>`. Piece C's alias rule (`r.id === row.id -> reg:<r.id>`) is ambiguous for these four. Whoever owns the registry must decide before ship, or `audit:totals` is red every morning.
2. **12 gap lanes export no id list**, so `audit:expected-present` cannot see them go quiet: `gap-ads`, `gap-auth`, `gap-banks`, `gap-documents` (it has `ID_*` constants but no list), `gap-email`, `gap-funnels`, `gap-inquiry`, `gap-jobs`, `gap-partners`, `gap-portal`, `gap-sms`, `gap-staff`. Leftover card: each should export `CHECK_IDS` (the other 29 do). `audit:lanes-ran` still catches a lane that dies or gives no rows.
3. In a fresh git worktree, `src/pulse/registry.test.mjs` "every registry row names a real handler or desk file" fails on `public/leads/c01cb7592c8bb994130158e897e99bf1/index.html`. That folder is excluded in `.git/info/exclude` (local only), so it exists in the main checkout and not in a worktree. Not caused by this change.

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

- `functions` cannot be a static import inside `src/pulse/daily-pulse.mjs`: `src/workflows/index.mjs` imports `src/workflows/daily-pulse.mjs`, which imports the pulse (a cycle). Pass it in from `src/workflows/daily-pulse.mjs` with a run-time `await import("./index.mjs")`, or through `runDailyPulse({ functions })`.
- Leave `manifest` out and the audit builds it. Or call `loadManifest({ functions })` once and pass it.
- `audit:*` rows are `FAIL`, so `recordAgentRun` will write the AG-07 run as `fail` on a red audit (it already does for any FAIL). Worth knowing for `gap-ai-agents` `failed-runs`.
- Audit rows are not in `TRIPWIRES` or `NOT_CUSTOMER_FACING`: they are check ids, not surfaces.

## Integrator check after merging A and C (could not run here)

My tests inject `verifyNa`, `NOT_LIVE_ROWS` and the scorecard `na` mapping. After A and C are merged, one quick proof that the real ones fit:
- `NOT_LIVE_ROWS` shape: C's contract did not give one. `notLiveIds` accepts a list of id strings, a list of `{ id | claim }`, an object keyed by id, a Map, or a Set. If C used another shape, `notLiveIds` needs one line.
- A's `toContractCheck` must return `status: "na"` for a valid `na` row, and `countChecks` must return `na`. `audit:not-checked` and `audit:totals` use both.
- `verifyNa(row, ctx)` must resolve `{ ok, reason }` (it is called with `ctx = { db, scope, now, functions, laneNaVerify }`).
- Then run `node --test src/pulse/self-audit.test.mjs` and `npm run pulse:prove` (the bundle proof: the three lazy imports must be packed).

## Not done / not verified

- Not run against the built Netlify bundle (`npm run pulse:prove`): needs the integrator's wiring.
- `npx tsc --noEmit`: the repo has no tsconfig (`scripts/lint.mjs` header says so). `npm run lint` passes (3193 files parse clean).
- `docs/journeys`: no journey changed, so no `-actual.md` or changelog line.
- Hourly pulse, `count-drop`, `never-checks`, `hourly-ran`, `run-recorder`, `tripwire-holes`: out of scope for Ship 1, not built.

## Tests

- `node --test src/pulse/self-audit.test.mjs`: 70 pass, 0 fail, 0 skipped (about 3 s).
- `node --test "src/pulse/**/*.test.mjs"`: 2278 pass, 1 fail (finding 3, not caused by this change), 65 skipped (the `.pg.test.mjs` files, no `DATABASE_URL`, same as before).
- `npm run lint`: clean.
