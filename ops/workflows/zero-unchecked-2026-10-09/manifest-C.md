# Manifest C — fold, aliases, not-live rows, four slices without fs

Builder C, Ship 1 of the zero-not-checked build, 2026-10-09.
Branch `build/ZU-C-2026-10-09`, based on `fbc54d0e` (the contract commit). Main has moved since (fix-batch merges); none of those files are mine (checked: only `slice-03-marketing`, `gap-email` and `daily-pulse.mjs` (3 lines) are near, and none changes what C does).

**Repair round 2 (branch `build/ZU-C-r2-2026-10-09`, on top of the first build).** A checker found five issues. All five are fixed. Read "Repair round 2" below first; it changes four things the text under it still describes in its old form (and the text is corrected in place where it matters):

1. `foldCoverage` is now safe to run twice. `pointAuditClaims` and the integrator's step (4) are GONE (the self-audit folds the morning-brief claim itself).
2. A row that does not claim to be in the registry is never folded into a registry ping (`foldTargetFor` step 2 needs `alreadyInRegistry === true`).
3. A workflow list that fails to load is now named on the rows that needed it (`functionsError`).
4. One wrong sentence in the `proof-does-not-text` reason is fixed.

## What C does, in plain words

A slice row that only says "covered" now carries `foldInto`: the id of the real check that ran. A new pure function, `foldCoverage`, removes the claim once its target is in the run and lists the claim on the target's `also`. A claim whose target did not run stays as a `skip` row (lands `not_checked`) with the reason. Five rows that are not live things leave the scorecard. One switched-off workflow becomes "nothing to judge". Four slice files no longer read repo files, so they load on the server.

## Repair round 2 — what the checker found and what changed

| # | severity | issue | what I did | proof |
|---|---|---|---|---|
| 1 | medium | `foldCoverage` turned every `NOT_REGISTERED` row into `na`, so a second fold undid the self-audit's `skip` row for the clarity workflow | `link.mjs`: only a row whose status is still `"not checked"` is turned. Step (4) of the integrator list is deleted (below). | new test: fold, swap the clarity row for an audit-style `skip` row, fold again: still `skip`, no `na`, detail unchanged; a second fold of the first fold's output is identical. Mutation: guard removed, test red. |
| 2 | medium | `foldTargetFor` could fold a "this door is not pinged" row into a same-named registry ping | `link.mjs`: the registry step (coverage key and row id) needs `row.alreadyInRegistry === true`. Alias, allow-list deep check, job and workflow steps are unchanged. | new tests at three levels: `foldTargetFor`; the runner; and slice 23's own `buildChecks` with `contracts.html` and `lenders.html` dropped, run through `runCoverageSlices` AND `foldCoverage` against all registry pings (neither gap row folds, nothing gets an `also`). Same two rows with `alreadyInRegistry: true` fold into `reg:contracts` / `reg:lenders`, so the test is not vacuous. Real tree: 181 `reg:` folds, all from `alreadyInRegistry: true` rows, counts unchanged. |
| 3 | low | `pointAuditClaims` set `foldInto` on a claim whatever its status | The function is DELETED (checker offered "drop it along with step (4)"). D already folds the claim (`AUDIT_COVERS`). Nothing in the repo imported it. | `grep pointAuditClaims src` is empty. |
| 4 | low | a failed `import` of `src/workflows/index.mjs` was swallowed with no word | `bundledFunctions` now returns `{ list, error }`; `buildFoldIndex` keeps `functionsError`; a row that could have been a workflow row (event or plain row) starts its detail with `Could not load the workflow list (<message>). `. Turning the list off on purpose (`functions: null`) says nothing. | new runner test with a loader that throws, one with no `functions` export, one that loads, one turned off. Mutation: note removed, test red. |
| 5 | low | the `proof-does-not-text` reason said "the proof script" | Reworded to: "This is a rule about this slice file, not a thing that runs. It never sends a text. A test in slice-02-daily-pulse.test.mjs proves it." (still 40+ characters, the not-live reason test passes). | `link.test.mjs` not-live tests. |

I agree with all five. I did not disagree with any. One choice the checker did not spell out: finding 2 says "only when `alreadyInRegistry === true`" and I did exactly that in `foldTargetFor` (not only in the runner), so a direct call with a row that does not claim the registry also gets no ping. That is why four test INPUT rows in `link.test.mjs` carry `alreadyInRegistry: true` now (listed under "Tests added").

## Files touched (only my list)

| file | change |
|---|---|
| `src/pulse/coverage/link.mjs` | NEW. `ALIASES`, `LEFT_TO_AUDIT`, `NOT_LIVE_ROWS`, `NOT_REGISTERED_ROWS`, `foldCoverage`, and helpers |
| `src/pulse/coverage/link.test.mjs` | NEW. 29 tests after repair round 2 (25 first) |
| `src/pulse/coverage/run-slices.mjs` | `evaluateRow` sets `foldInto`; `GAP_STATUSES` gains `na`; `gapResult` carries `na`; `tally` counts `na`; `runCoverageSlices` takes `functions` (and `loadFunctions`, for a test that makes the import fail); a failed workflow-list import is named on the rows that needed it |
| `src/pulse/coverage/run-slices.test.mjs` | +13 tests appended (12 before, 25 now). No existing line changed. |
| `slice-06-briefs.mjs`, `slice-09-documents.mjs`, `slice-11-hiring.mjs`, `slice-23-pages.mjs` | `fs` removed, imports used instead |
| their `.test.mjs` files | tests appended only (no line removed or changed in any existing test) |

Not touched: `slice-03-marketing.mjs`, `gap-sms.mjs`, `daily-pulse.mjs`, `scorecard.mjs`, `registry.mjs`, `tripwires.mjs`, `modules.mjs`, `db/expected-migrations.mjs`. No migration. No new dependency.

## Exports and argument shapes

`src/pulse/coverage/link.mjs`

- `ALIASES` : frozen `{ "<claim id>": "<target id>" }`. Today only `{ "contracts/sign": "contracts:sign-route" }`. `morning-brief` is NOT here (on purpose).
- `LEFT_TO_AUDIT` : frozen `{ "<sliceId>:<checkId>": { target, reason } }`. Today `06-briefs:morning-brief` -> `audit:briefs-sent`. `foldTargetFor` returns null for these, so the page `reg:morning-brief` (same id as the claim) cannot take the claim. This file never points the claim at the audit row: the self-audit (piece D, `AUDIT_COVERS`) folds it into `audit:briefs-sent` itself.
- `NOT_LIVE_ROWS` : frozen `{ "<sliceId>:<checkId>": "<reason, 40+ chars>" }`. Keys are exactly the scorecard ids the runner writes (`<sliceId>:<checkId>`). The 5 rows from the contract.
- `NOT_REGISTERED_ROWS` : frozen `{ "<sliceId>:<checkId>": { id, reason } }`. Today `05-funnels:clarity-insights-sweeper`.
- `isNotLive(sliceId, checkId) -> boolean`
- `notRegisteredFor(sliceId, checkId) -> { detail, na: { code: "not-registered", args: { id } } } | null`
- `buildFoldIndex({ registry, allowed, tripwires, jobs, functions, aliases, functionsError }) -> index` (all optional; defaults are the real imports; `functions` is the bundled Inngest list, with none the workflow step is off; `functionsError` is why the list is missing and comes back as `index.functionsError`, `null` when there is none)
- `foldTargetFor(row, index, sliceId = "") -> string | null` (the fold order below). The registry step needs `row.alreadyInRegistry === true`.
- `countByTargetKind(rows) -> { reg, job, wf, check }`
- `pointAuditClaims` is REMOVED (repair round 2). Nothing imported it. See "Requests for others".
- `foldCoverage(checks) -> { checks, folded, dangling, notLive, notRegistered }` pure (input not changed).
  - `checks`: the new list. A folded claim is gone and its id is on the target's `also` (array of claim ids, deduped, existing `also` kept).
  - `folded`: number of claims removed by a fold (NOT counting not-live rows).
  - `dangling`: claim ids whose target did not run. Each stays in `checks` as `status:"skip"`, `detail:"Claims covered by <target>, but <target> did not run today."`, `foldInto` removed.
  - `notLive`: ids dropped because they are in `NOT_LIVE_ROWS`.
  - `notRegistered`: ids turned into `status:"na"` rows with `na:{ code:"not-registered", args:{ id } }`. Only a row whose status is still `"not checked"` is turned. A row with any other status (the self-audit's `skip` row, a pass, a fail) is left alone.
  - Safe to run twice: a second `foldCoverage(first.checks)` returns the same rows and counts nothing again (tested, including the self-audit swapping the clarity row for a `skip` row between the two).
  - A target is found by row `id`, then by the `checkId` of a gap-lane row (`sliceId` starts `gap-`). A row that is itself a claim (has `foldInto`) is never a target.

`src/pulse/coverage/run-slices.mjs`

- `runCoverageSlices({ ..., functions, loadFunctions })` new optional `functions`: an array = use it; `null`/`false` = no workflow folds (on purpose, no error); omitted = lazy `import("../../workflows/index.mjs")` (a static import would be a loop through the pulse). If that import fails, or the index has no `functions` list, the reason goes on the fold index and each row that could have been a workflow row (an event row or a plain row) starts its detail with `Could not load the workflow list (<message>). `. `loadFunctions` (an async function returning the module) replaces the lazy import; for a test that makes it fail. Rows come back as before, plus `foldInto` on claims. A claim is still `status:"not checked"` until `foldCoverage` runs.
- `tally(rows)` now returns `{ total, pass, red, notChecked, na, other }`.
- A gap lane may return `status:"na"` with `na:{ code, args }`; `gapResult` keeps `na` as plain JSON (`{ code: string, args: object }`), plus `sliceId` and `checkId`. A lane `na` with no usable code stays `status:"na"` with no `na` object, so the scorecard (piece A) lands it `not_checked`.

## The fold order (first hit wins), in `foldTargetFor`

0. `LEFT_TO_AUDIT` -> none.
1. `ALIASES`.
2. A `PULSE_REGISTRY` row: `coverageKey(r) === row.id`, then `r.id === row.id` -> `reg:<r.id>`. **Only for a row with `alreadyInRegistry === true`** (repair round 2). A row that says it is NOT covered (slice 23's "desk missing from PULSE_REGISTRY" rows, `alreadyInRegistry: false`) or says nothing never folds into a ping that shares its name. It can still take steps 1, 3, 4 and 5. Measured on today's tree: all 181 `reg:` folds come from `alreadyInRegistry: true` rows, so the counts did not move.
3. An `ALLOWED_UNMONITORED` key whose `route:<key>` is in `TRIPWIRES` -> that entry's first non-ping check id.
4. An id on `JOBS` -> `job:<id>`.
5. A bundled Inngest function with no cron trigger -> `wf:<id>`.
6. Nothing: a claim (`alreadyInRegistry: true`, not a cron, not an event) says "Claims covered, but no check ran for <id>." Other rows keep their old words.

In `evaluateRow`, three things are never folded (they keep their own evaluation): the marketing clock reads, the AG-07 agent read, and a payout/floor row whose stamp read returned a time (a stamp that finds nothing folds into `job:<id>`). A row whose own evaluation is a real `FAIL` is never given `foldInto` (a real red stays on the scorecard, as it does today).

## Where the 350 slice rows land (measured from a built bundle, see Proof)

| target | rows | distinct target rows |
|---|---|---|
| `reg:` (registry ping) | 181 | 128 |
| `job:` | 57 | 35 |
| `wf:` | 96 | 65 (the same 65 `wf:` rows piece B emits) |
| deep check by alias (`contracts:sign-route`, from the 3 `contracts/sign` rows) | 3 | 1 |
| no fold target | 13 | |
| total | 350 | |

The 181 `reg:` = the 176 registry claims of `slice-link-map.json` (176 of 176 resolve to exactly the `reg:` id the live scorecard had) + 5 rows of `slice-09-documents` (that slice used to fail to load on the server, so those rows were missing from the live card; they return now).

The 13 with no fold target, each with where it ends:

| row | ends as |
|---|---|
| `02-daily-pulse:script-dry-run-default`, `:pulse-never-fixes`, `:proof-does-not-text` | leave the scorecard (`NOT_LIVE_ROWS`) at the fold |
| `03-marketing:page_seen` | leaves (`NOT_LIVE_ROWS`) |
| `16-nurture:n-05-repair-complete-nurture` | leaves (`NOT_LIVE_ROWS`; the workflow does not exist) |
| `02-daily-pulse:ag-07-cron-daily-pulse` | own evaluation (agent_runs read) |
| `03-marketing:clock`, `:worker`, `:outbox_drain` | own evaluation (marketing heartbeat read) |
| `05-funnels:clarity-insights-sweeper` | `na`, code `not-registered`, made by `foldCoverage` |
| `06-briefs:morning-brief` | unchanged (not checked, cron words). Owned by `audit:briefs-sent`; see requests |
| `33-fulfillment:repair-stage-moves` | STAYS NOT CHECKED. Leftover (below) |
| `33-fulfillment:repair.docs.complete` | STAYS NOT CHECKED. Leftover (below) |

The three `partner-production-floor` slice rows fold into `job:partner-production-floor`; the `affiliate-payout-run` rows keep their own evaluation when `affiliate_payouts` returns a time and fold into `job:affiliate-payout-run` when it does not. `n-01`, `n-02`, `n-03` fold into `wf:` rows (piece B gives them `na` / `no-trigger`).

## Tests added

- `link.test.mjs` (29 after repair round 2; 25 in the first build): aliases (and morning-brief not aliased); morning-brief held back from the same-named page ping, with the proof that without the hold it WOULD fold there; the whole fold order with a synthetic index (alias beats registry, registry beats job, allow-list tripwire, job, wf, cron function never a wf, no function list); the order on the real tree; `foldCoverage` target found / target missing / target itself a claim / also list kept and deduped / gap-lane target by check id (and a non-lane row is not a target) / not-live rows leave / not-registered becomes `na` / purity and bad input; the audit-owned claim is left exactly as it is, with or without an audit row in the list; `countByTargetKind`; each `NOT_LIVE_ROWS` entry has a 40+ character reason and still exists in its slice, and the stale check goes red for a fake row; n-05 still not built; the clarity row; the fixture: 176 of 176 `foldInto` equal `linkedScorecardId`, folding them into the registry rows leaves 0 dangling and lands on 127 distinct doors; "every slice row ends somewhere known" (a fixed list of the 13; a new slice row with no target turns it red).
- `run-slices.test.mjs` (+13, the 12 existing untouched; 11 in the first build, 2 added in round 2): claim carries `foldInto` and stays not checked; a claim that points at nothing; cron folds into `job:`; a real red is never folded away (stale and error cases); event workflow folds into `wf:` but a cron workflow does not; payout row keeps its stamp evaluation, and folds when the stamp is empty; agent and marketing rows keep theirs; morning-brief stays as it is; the runner leaves clarity as a plain unchecked row and the fold makes it `na`; `tally` counts `na`; `gapResult` keeps `na` code and args, drops a bad code, never lets a code ride on a PASS; the runner reads no repo file for the fold; (round 2) a workflow list that fails to load is named on the rows that needed it and on no others (import throws, no `functions` export, loads fine, off on purpose); a row that says it is not covered is not folded into a same-named registry ping.
- **Repair round 2 tests (4 new in `link.test.mjs` net, 2 in `run-slices.test.mjs`):** a second fold changes nothing, and does not turn the self-audit's `skip` row for the clarity workflow back into `na` (and a PASS / FAIL / `na` / `skip` status on that row is kept); `buildFoldIndex` keeps `functionsError`; `foldTargetFor` with `alreadyInRegistry` true / false / missing (true folds into the ping; false and missing do not; alias, job and workflow still apply); a desk taken out of the registry (`contracts.html`, `lenders.html`, built through slice 23's own `buildChecks`) is not swallowed by the API ping `reg:contracts` / `reg:lenders`, through the runner AND through `foldCoverage`, with the same two rows saying they are covered as the proof the test is not vacuous.
- **Test lines changed in round 2 (be strict about this one):** `link.test.mjs` is a file this branch created. The test "audit-owned claims: pointed at their audit row, a second fold takes them in..." tested `pointAuditClaims`, which is deleted (the checker allowed it: D folds the claim itself). It is replaced by "audit-owned claims: the fold leaves them as they are, with or without an audit row", which keeps the `LEFT_TO_AUDIT` target check and the first-fold-leaves-it-alone check. Because a registry fold now needs `alreadyInRegistry: true`, four existing assertions got that one field added to their INPUT row (the `to` helper in the fold-order test, `auth/login` on the real tree, and both `morning-brief` lines; the first `morning-brief` line would otherwise pass for the wrong reason, so it carries the field to keep proving the `LEFT_TO_AUDIT` hold). No expected value changed. No test file of another piece, and no existing `run-slices` / slice test, has a line removed or changed.
- The four slice test files (+2, +2, +2, +4 tests): `workflowInIndex`/`wired` are false for something not in the bundled list; the slice source has no `node:fs`, `readFileSync`, `readdirSync` or `existsSync`. Slice 23 also has a drift test: the desk lists the slice carries (copied from `public/app/shell.js` at build time) equal what `shell.js` says now, every desk is on disk, and the test goes red when `shell.js` adds or drops a desk.
- Mutation checks I ran by hand and reverted: removing the "real red is never folded" guard breaks `run-slices.test`; removing the `LEFT_TO_AUDIT` hold breaks 3 tests. Round 2: making the registry step ignore `alreadyInRegistry` breaks 3 tests (fold-order, slice-23 desk, runner); removing the `status === "not checked"` guard on the clarity row breaks the second-fold test; making the list-error note empty breaks the list-error test.

## Proof

- `node --test` on `link`, `run-slices`, `slice-06/09/11/23`, `modules`: after round 2, `link` 29 and `run-slices` 25 pass, 0 fail, 0 skipped (the slice-06/09/11/23 and `modules` tests were not touched in round 2). The existing `run-slices` and slice tests are unchanged lines (git numstat: 0 lines removed from any of them). `link.test.mjs` is new in this branch; round 2 changed it as described under "Test lines changed in round 2".
- Wider: `src/pulse/*.test.mjs src/pulse/coverage/*.test.mjs src/pulse/beats/*.test.mjs src/workflows/*.test.mjs src/lib/no-unfenced-transmit.test.mjs` with `DATABASE_URL` unset: 2935 tests, 2855 pass, 77 skipped (pg tests, no database), 3 fail (first build). Round 2, the same files with `DATABASE_URL` unset: the same 3 and no others (`src/pulse/*.test.mjs` + `src/pulse/coverage/*.test.mjs`: 1820 tests, 1780 pass, 39 skipped, 1 fail = `registry.test`; `src/pulse/beats` + `src/workflows` + `no-unfenced-transmit`: 1121 tests, 1081 pass, 38 skipped, 2 fail = the other two). The 3 are NOT from C and sit in files I never touched: `no-unfenced-transmit` (names `src/pulse/funnel-doors.mjs` and `src/pulse/instant-watch.mjs`), `registry.test` ("leads/c01cb7592c8bb994130158e897e99bf1/index.html is gone": a gitignored page missing from this worktree), `workflows/index.test` (`pulse-instant-watch` is not in `EXPECTED_WORKFLOW_IDS`). Not re-measured on a clean main.
- `npm run lint` (syntax gate): 3193 files parse clean. There is no tsconfig in the repo, so `tsc --noEmit` does not apply.
- From a BUILT bundle: I built the api bundle with the same zip-it-and-ship-it call as `scripts/pulse/prove.mjs` (into the scratchpad, from this worktree), ran from `/private/tmp` with the database address blocked and `fetch` blocked: 33 slices loaded, 0 `load-error` slices; slice 06 gives 2 rows, 09 gives 8, 11 gives 2, 23 gives 0 (on purpose: every scoped desk is already pinged); 350 rows, 0 `load-error` rows; folds reg 181 / job 57 / wf 96 / check 3; the lazy `workflows/index.mjs` import worked inside the bundle (96 wf folds). I did NOT run `npm run pulse:prove` (it opens the live database; I was told live reads go only through the read-only helper). The integrator should run it. Round 2: built the bundle again (same call, from the repair worktree) and ran from `/private/tmp` with the database address and `fetch` blocked: 33 slices, 0 `load-error`, 350 rows, folds reg 181 / job 57 / wf 96 / check 3 (unchanged), 13 rows with no target (unchanged), 0 rows carrying a "Could not load the workflow list" note (the lazy import still works from inside the bundle after the `loadFunctions` change), and `foldCoverage` run twice over the real rows gave identical output.
- I did not read the live database at all: every number above is from the repo and the bundle.

## Findings and judgment calls (read these)

1. **Two repair rows stay NOT CHECKED (leftover).** `33-fulfillment:repair-stage-moves` and `33-fulfillment:repair.docs.complete` are bus handlers, not Inngest functions, so no `wf:` row exists. I read `gap-repair.mjs` and `gap-fulfillment.mjs`. `fulfillment:next-action` reads repair files past their stage clock and whether the screen shows a next step; it does not read stage moves. `repair-case-stuck` (cards parked in intake / awaiting_documents / in_transit / awaiting_response past the clock) and `repair-letter-round` (a file in analysis past its hour, an open case with items and no letter) DO see the damage a dead handler leaves, but only after the clock runs out, and neither reads the handler's own run. I could not confirm they read the stage move itself, so I did not fold (a false green is worse than an honest red). The rows stay `not_checked`, red through `audit:not-checked`. If Chris says the late damage check is enough, the opt-in is two lines in `ALIASES`: `"repair-stage-moves": "repair-case-stuck"` and `"repair.docs.complete": "repair-letter-round"` (both are lane-free check ids, found by the fold's check-id fallback), then remove those two keys from `EXPECTED_UNFOLDED` in `link.test.mjs`. A true fix is a check that compares enrolled/docs-complete events against card stage moves, or reads `failed_events` for the repair handlers. Leftover card: needs one.
2. **`clarity-insights-sweeper` -> `na` is beyond the contract's text.** The contract does not list it in C. Spec 1.2 names `05-funnels:clarity-insights-sweeper` as the user of the `not-registered` code and nobody else produces that row, so without it one `not_checked` red stays forever. I made `foldCoverage` turn it into `status:"na"`, `na:{ code:"not-registered", args:{ id:"clarity-insights-sweeper" } }`. I did it in the fold, not in the runner, so `runCoverageSlices` output and the existing `daily-pulse.test.mjs` assertion ("every slice row is not checked", dry run) stay true. If you do not want it, delete `NOT_REGISTERED_ROWS` in `link.mjs` (and the 3 tests that name it). Piece A's `not-registered` verify MUST read `args.id` and `ctx.functions`.
3. **Duplicate registry ids.** `PULSE_REGISTRY` has four ids twice (an api row and a desk row): `contracts`, `journeys`, `lenders`, `soft-pull-approve`. The scorecard therefore has two rows with the id `reg:contracts` (etc.). `audit:totals` ("no two rows share one id", piece D) will go red on day one for these four. `foldCoverage` folds into the first row with the id. Not fixed here (not my file).
4. **`morning-brief` and the registry.** The registry has a desk page with id `morning-brief`, so the plain `r.id === row.id` rule would have folded the morning-brief claim into the page ping: a ping of the report page proving the brief was sent. That is the exact false green the critic named. `LEFT_TO_AUDIT` blocks it. It is the ONLY row in the tree that matched by id and not by coverage key (checked).
5. **Slice 23 desk lists are a copy.** `slice-23-pages.mjs` cannot read `shell.js` on the server, and `DESK_FILES` is not exported from `registry.mjs`, so the slice carries `SHELL_ALL`, `SHELL_STAFF_MONEY` and `SIDEBAR_SECTION_DESKS` as literals, guarded by a drift test. A desk added to `shell.js` now fails that test until the literal is updated (before: it was picked up live). Slice 06 now answers "is it watched" from `MACHINE_CHECKS` and `INNGEST_JOBS` (a new `jobId` field on each brief row), not from searching pulse source text.
6. A cron row with a real PASS is folded away into its `job:` row (57 job claims). If the `job:` row is missing from a run, the claim becomes a `skip` (red through the aggregate) even though the slice had its own PASS. That is the contract's rule; it is the safe side.

## Requests for others

- **Integrator, order in `runDailyPulse`:** (1) `runCoverageSlices` as now (optionally pass `functions` from the bundle; omitted works); (2) after the registry, `job:`, `wf:` and gap rows all exist: `const f = foldCoverage(checks)`; (3) `auditPulse` on `f.checks`. **There is no step (4).** The first build told the integrator to run a second `foldCoverage(pointAuditClaims(...))` for the morning-brief claim. That is removed: `pointAuditClaims` no longer exists, and piece D's `auditPulse` already folds `06-briefs:morning-brief` into `audit:briefs-sent` itself (`AUDIT_COVERS`). A second `foldCoverage` is harmless now (it gives the same answer; it no longer undoes the audit's `skip` row for the clarity workflow), but it is not needed. Store `f.folded` on the scorecard as the spec says (D reports its own folded count for the morning-brief claim).
- **Integrator:** `src/pulse/daily-pulse.test.mjs` line 102 asserts every slice row in a dry run is "not checked". It still holds today (the runner output did not change), but once the fold is wired into `runDailyPulse` those rows fold or become `skip`/`na`, so that assertion has to be rewritten there (it is not my file).
- **Piece A:** `not-registered` args are `{ id }`. Scorecard must keep a row's `also` array. `na` rows from a gap lane have `na: { code, args }` where `args` is plain JSON.
- **Piece D:** the slice-claim part of the manifest is `${sliceId}:${row.id}` for every row of every `SLICE_FILES` module, minus the keys of `NOT_LIVE_ROWS`; each is present itself or in some `also`. `05-funnels:clarity-insights-sweeper` is present as itself (`na`). `06-briefs:morning-brief` is present as itself after `foldCoverage` (the fold never touches it) and D folds it into `audit:briefs-sent`. `LEFT_TO_AUDIT["06-briefs:morning-brief"].target` is the same id D uses.
- **Piece G:** the existing test "the morning pass runs every gap file..." (`run-slices.test.mjs`) asserts gap rows are only `PASS`/`FAIL`/`skip` in a no-database run. A G row must return `skip` (not `na`) when there is no database, or that test fails.
- **Chris / integrator:** the repair decision in finding 1.
