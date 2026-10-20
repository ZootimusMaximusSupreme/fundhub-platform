# Astra CI triage — 2026-10-20

## Scope and self-contained repair prompt

Root assigned C to inspect GitHub Actions run `39389525618`, pushed SHA
`5e37d1606f18284b2e15f53be41abcad96215edd`, through the GitHub connector.
This is the pre-final-phone-fix build. Read the ten failed unit/Postgres
jobs below; preserve their original red results. A/B continue cross-review
while root owns other display-contract repairs and integration.

Follow-on repair, explicitly assigned by root: own only
`src/pulse/catalog/proofs/fin-b18-partner-galaxy.test.mjs` and this report.
Update the two exact button-label assertions to the approved
`Download Message Blaster`. Repair stale canvas viewport coordinates:
scroll each drawn target into view, re-read the current canvas rectangle,
assert the visible pixel receives the pointer, and use real mouse clicks.
Preserve all five cluster names, their approximately 2× zoom, worker
open/close, empty-space pullback, Escape, role checks, download bytes and
request assertions, and final row-coverage assertions. Do not edit app
code, hooks to fake passing outcomes, config, other tests, Git, databases,
or production. Run the targeted test and lint; root reviews the entire
diff. No deployment or live/customer proof is claimed here.

## Original remote failures (all retained)

[Run 39389525618](https://github.com/ZootimusMaximusSupreme/fundhub-platform/actions/runs/39389525618)
was still in progress when initially inspected. The ten assigned jobs completed
with failure. Each no-database failure also occurred in its Postgres
counterpart. Counts below are TAP leaf-test totals, not suite-wrapper
counts; skipped tests remain unproved.

| Shard | No-database job: pass / fail / skip | Postgres job: pass / fail / skip |
| --- | --- | --- |
| 0 | [118517393164](https://github.com/ZootimusMaximusSupreme/fundhub-platform/actions/runs/39389525618/job/118517393164): 5629 / 2 / 2 | [118517392985](https://github.com/ZootimusMaximusSupreme/fundhub-platform/actions/runs/39389525618/job/118517392985): 5809 / 2 / 0 |
| 2 | [118517393168](https://github.com/ZootimusMaximusSupreme/fundhub-platform/actions/runs/39389525618/job/118517393168): 3902 / 5 / 2 | [118517393176](https://github.com/ZootimusMaximusSupreme/fundhub-platform/actions/runs/39389525618/job/118517393176): 3965 / 5 / 2 |
| 3 | [118517393077](https://github.com/ZootimusMaximusSupreme/fundhub-platform/actions/runs/39389525618/job/118517393077): 5345 / 1 / 0 | [118517393092](https://github.com/ZootimusMaximusSupreme/fundhub-platform/actions/runs/39389525618/job/118517393092): 5371 / 1 / 0 |
| 4 | [118517393215](https://github.com/ZootimusMaximusSupreme/fundhub-platform/actions/runs/39389525618/job/118517393215): 3831 / 1 / 2 | [118517392996](https://github.com/ZootimusMaximusSupreme/fundhub-platform/actions/runs/39389525618/job/118517392996): 3918 / 1 / 0 |
| 5 | [118517393183](https://github.com/ZootimusMaximusSupreme/fundhub-platform/actions/runs/39389525618/job/118517393183): 4740 / 1 / 17 | [118517392961](https://github.com/ZootimusMaximusSupreme/fundhub-platform/actions/runs/39389525618/job/118517392961): 4780 / 1 / 0 |

### Exact failing assertions and narrow targets

1. **Changed Astra display contract — Money cash label.**
   `display-contracts-cd.test.mjs:411–413`, test “every exported Display CD
   key drives the real page and asserts its exact result”: actual begins
   `Cash this month Safe Personal: $315.00…`; expected begins
   `CASH THIS MONTH Safe Personal: $315.00…`. All amounts and following
   wording in the logged comparison match.
   [Assertion](https://github.com/ZootimusMaximusSupreme/fundhub-platform/blob/5e37d1606f18284b2e15f53be41abcad96215edd/src/pulse/catalog/proofs/display-contracts-cd.test.mjs#L411),
   [literal rendered heading](https://github.com/ZootimusMaximusSupreme/fundhub-platform/blob/5e37d1606f18284b2e15f53be41abcad96215edd/public/app/money-strategy.js#L339),
   [Astra removes uppercase](https://github.com/ZootimusMaximusSupreme/fundhub-platform/blob/5e37d1606f18284b2e15f53be41abcad96215edd/public/app/fundhub-astra-client.css#L110).
   Narrow target: exact approved sentence case only; retain amounts and
   all other assertions. Root owns repair.

2. **Changed Astra display contract — campaign recommendation.**
   `door-flow-read-contracts-2.test.mjs:180`: actual `refresh`, expected
   `REFRESH`. The test fixture and rendered recommendation remain
   `refresh`; Astra stops uppercasing badges.
   [Assertion](https://github.com/ZootimusMaximusSupreme/fundhub-platform/blob/5e37d1606f18284b2e15f53be41abcad96215edd/src/pulse/catalog/proofs/door-flow-read-contracts-2.test.mjs#L180),
   [renderer](https://github.com/ZootimusMaximusSupreme/fundhub-platform/blob/5e37d1606f18284b2e15f53be41abcad96215edd/public/app/campaign-manager.html#L1261),
   [Astra badge styling](https://github.com/ZootimusMaximusSupreme/fundhub-platform/blob/5e37d1606f18284b2e15f53be41abcad96215edd/public/app/fundhub-astra-staff.css#L10).
   Narrow target: exact lowercase display, no casing-insensitive waiver.
   Root owns repair.

3. **Changed Astra source allowlist — public signing page.**
   `contracts-screen.test.mjs:173`, “it loads no staff app code beyond
   the isolated type assets”: actual references additionally contain
   `/app/fundhub-astra-client.css` and `/app/fundhub-astra.css`; expected
   only the two font assets. The suite wrapper also fails because this
   one leaf fails.
   [Assertion and isolation checks](https://github.com/ZootimusMaximusSupreme/fundhub-platform/blob/5e37d1606f18284b2e15f53be41abcad96215edd/src/http/contracts-screen.test.mjs#L171),
   [new CSS-only includes](https://github.com/ZootimusMaximusSupreme/fundhub-platform/blob/5e37d1606f18284b2e15f53be41abcad96215edd/public/contract.html#L115).
   Narrow target: explicitly allow only the two reviewed CSS files;
   retain rejection of staff JS, storage/token access, extra `/app/`
   references, and session gates. Root owns repair.

4. **Changed Astra display contract — Message Blaster label.**
   `fin-b18-partner-galaxy.test.mjs:64`: actual
   `Download Message Blaster`, expected `Download`. The first assertion
   stops the download proof before its request/file/result assertions.
   A second old-label assertion at line 76 would also need the same exact
   label after completion.
   [Assertions](https://github.com/ZootimusMaximusSupreme/fundhub-platform/blob/5e37d1606f18284b2e15f53be41abcad96215edd/src/pulse/catalog/proofs/fin-b18-partner-galaxy.test.mjs#L64),
   [approved button text](https://github.com/ZootimusMaximusSupreme/fundhub-platform/blob/5e37d1606f18284b2e15f53be41abcad96215edd/public/app/partner-galaxy.html#L426).
   C owns the exact-label repair, with all download behavior checks kept.

5. **Behavior proof red — all five map clusters.**
   `fin-b18-partner-galaxy.test.mjs:286`: timed out waiting for
   `Inquiry Removal: its own name in the trail`.
   [Failing loop](https://github.com/ZootimusMaximusSupreme/fundhub-platform/blob/5e37d1606f18284b2e15f53be41abcad96215edd/src/pulse/catalog/proofs/fin-b18-partner-galaxy.test.mjs#L271).
   The helper caches a viewport-relative canvas rectangle once at open;
   later raw mouse coordinates do not scroll. The map can now extend
   below the viewport. This is a source-supported geometry hypothesis,
   not a passing behavior result. C must prove the current, visible
   pixels still open all five correct clusters with their original
   zoom and center checks.

6. **Behavior proof red — empty-space pullback.**
   `fin-b18-partner-galaxy.test.mjs:340`: timed out waiting for
   `pulled back by a click in empty space`.
   [Cached lower-corner click](https://github.com/ZootimusMaximusSupreme/fundhub-platform/blob/5e37d1606f18284b2e15f53be41abcad96215edd/src/pulse/catalog/proofs/fin-b18-partner-galaxy.test.mjs#L339).
   Closing the fixed worker panel may also change scroll position.
   Refresh the canvas rectangle and make its lower-corner target visible
   before the real click; keep empty-space and Escape assertions.
   C owns repair and proof.

7. **Downstream coverage failure, not a separate behavior waiver.**
   `fin-b18-partner-galaxy.test.mjs:357`, “every listed row was exercised”,
   reports Download, all-five-clusters and empty-space/Escape rows
   unclaimed because the preceding three checks failed.
   [Coverage guard](https://github.com/ZootimusMaximusSupreme/fundhub-platform/blob/5e37d1606f18284b2e15f53be41abcad96215edd/src/pulse/catalog/proofs/fin-b18-partner-galaxy.test.mjs#L356).
   Keep it unchanged; it must pass only after every row really passes.

8. **Nested browser suite red — three marketing checks.**
   `s5-display-specs.test.mjs:37` reports 178 browser cases passed,
   three failed; wrapper exit was `1`, expected `0`.
   [Wrapper](https://github.com/ZootimusMaximusSupreme/fundhub-platform/blob/5e37d1606f18284b2e15f53be41abcad96215edd/src/pulse/catalog/proofs/s5-display-specs.test.mjs#L28).
   - `marketing-cc-settings.spec.mjs:277`: `#set-time` expected `15px`,
     actual `16px`. The approved phone input size is 16px. This is an
     intended display-expectation change; retain computed-size proof.
     [Assertion](https://github.com/ZootimusMaximusSupreme/fundhub-platform/blob/5e37d1606f18284b2e15f53be41abcad96215edd/e2e/marketing-cc-settings.spec.mjs#L273).
   - `marketing-cc-settings.spec.mjs:314`: card top difference expected
     `<2`, actual `24`. The pushed staff CSS adds `margin-top:24px` to
     adjacent cards, including cards within a grid. This is a likely
     Astra layout regression, not permission to weaken grid alignment.
     [Assertion](https://github.com/ZootimusMaximusSupreme/fundhub-platform/blob/5e37d1606f18284b2e15f53be41abcad96215edd/e2e/marketing-cc-settings.spec.mjs#L308),
     [broad sibling-card margin](https://github.com/ZootimusMaximusSupreme/fundhub-platform/blob/5e37d1606f18284b2e15f53be41abcad96215edd/public/app/fundhub-astra-staff.css#L9).
   - `marketing-command-center.spec.mjs:342`: Copy button bottom expected
     `<=900`, actual `919.6875`. This is a fold/layout requirement still
     red, not merely a label change.
     [Assertion](https://github.com/ZootimusMaximusSupreme/fundhub-platform/blob/5e37d1606f18284b2e15f53be41abcad96215edd/e2e/marketing-command-center.spec.mjs#L340).
   Root owns these repairs. Do not bypass the nested suite or coverage.

9. **Changed Astra source allowlists — four customer entry/result pages.**
   In both shard-0 jobs, `gap-portal.test.mjs:869`, “scripts: read against
   the real pages in public/, the lists are what the map says”, fails
   because portal-login's actual list adds `/app/fundhub-astra.css` and
   `/app/fundhub-astra-client.css` before `/app/client-ios.js`.
   [Exact four lists](https://github.com/ZootimusMaximusSupreme/fundhub-platform/blob/5e37d1606f18284b2e15f53be41abcad96215edd/src/pulse/coverage/gap-portal.test.mjs#L869).
   Source inspection of the pinned SHA confirms the next three lists
   also need those exact CSS assets:
   [portal-login:16](https://github.com/ZootimusMaximusSupreme/fundhub-platform/blob/5e37d1606f18284b2e15f53be41abcad96215edd/public/portal-login.html#L16),
   [reset-password:18](https://github.com/ZootimusMaximusSupreme/fundhub-platform/blob/5e37d1606f18284b2e15f53be41abcad96215edd/public/reset-password.html#L18),
   [progress:207](https://github.com/ZootimusMaximusSupreme/fundhub-platform/blob/5e37d1606f18284b2e15f53be41abcad96215edd/public/progress.html#L207),
   [payment-success:42](https://github.com/ZootimusMaximusSupreme/fundhub-platform/blob/5e37d1606f18284b2e15f53be41abcad96215edd/public/app/payment-success.html#L42).
   Narrow target: exact ordered lists at 869–872, not an open-ended
   `/app/` allowlist; keep named JS, file-existence and page-rule checks.
   Root owns repair.

10. **Duplicate nested browser failures — staff display wrapper.**
    In both shard-0 jobs, `display-batch-staff-ui.test.mjs:60`, “staff
    display batch presses every mapped control and checks its result”,
    reports 395 browser cases passed and two failed: exactly the
    `#set-time` 15px/16px and settings grid-top 24px failures in item 8.
    [Wrapper](https://github.com/ZootimusMaximusSupreme/fundhub-platform/blob/5e37d1606f18284b2e15f53be41abcad96215edd/src/pulse/catalog/proofs/display-batch-staff-ui.test.mjs#L42).
    No additional child failure appears in either wrapper log.
    The no-database shard-0 log additionally shows a separate 73/73
    passing TAP invocation; that does not erase its failed 5633-test
    invocation.

## Baseline and database limits

Remote `main` was read through the connector at
`f1490ce9da5006eca89c3387e575a090a371d1d0`, not inferred from the local
checkout. Whole-file comparisons show identical tests for
`display-contracts-cd`, `door-flow-read-contracts-2`, `contracts-screen`,
`fin-b18-partner-galaxy`, `fin-b18-kit`, `s5-display-specs`, and
`marketing-command-center`, `gap-portal`, and `display-batch-staff-ui`
at main versus the failed SHA.
`marketing-cc-settings` differs. A matching test file does not establish
the same app inputs or a baseline failure: the relevant app pages and
Astra assets changed. No baseline test was executed in this triage, and
none of the failures is claimed pre-existing.

The inspected Postgres jobs successfully reached their test step and
show the same UI/source assertion failures as the no-database jobs.
This does not certify every database path or waive their failed status.
Expected-negative-test database log noise was not mistaken for a TAP
failure. The full run and remaining jobs were not declared green.

## C repair verification

Only the assigned partner test and this report were edited in this
follow-on. The two label checks now name the approved exact label.
The gift handler was inspected and never resets its button text: it
only updates status and `disabled`, with `finally` clearing `disabled`.
No gift handler or app code was changed.

The new `shown(page, drawnPoint)` helper scrolls the requested drawn
point into the viewport, refreshes the current canvas rectangle, and
asserts both in-viewport coordinates and `elementFromPoint(...) === sky`
before the existing real mouse click. Worker-search coordinates and
the empty-space click use the same refreshed helper. Canvas hooks,
app state and hit-test functions are not changed or invoked by the test.
The complete all-five-cluster loop now runs at both 1400×900 and 440×763;
the names, pointer check, breadcrumb, pullback hint, 1.8–2.5× zoom and
45px center thresholds are unchanged.

- First attempt, local sandbox: test server could not bind
  `127.0.0.1` (`listen EPERM`). All six tests canceled before browser
  setup; 0 passed. This is preserved as a failed infrastructure attempt,
  not relabeled a test pass.
- Same targeted command with local-loopback permission:
  `node --test src/pulse/catalog/proofs/fin-b18-partner-galaxy.test.mjs`
  passed 6/6, 0 skipped, 0 canceled, 21.22s with the desktop loop.
- Final strengthened run of the same command, adding the phone-width
  all-five loop: **6/6 passed, 0 failed, 0 skipped, 0 canceled, 32.47s**.
  It covers the real download request/filename and refused answers,
  partner rail and route gates, ten cluster clicks across two layouts,
  worker details, panel close, empty-space pullback, Escape and complete
  proof-row coverage.
- `npm run lint`: **4006 files and inline scripts parse clean**.

These are local Chromium/offline proof results, not native iPhone,
database, remote-CI or live-site certification. Original remote failures
above remain the authoritative pre-repair receipt. Root owns review,
other repair lanes, fresh full-suite/remote checks and release.

## Root follow-up

The three exact display/public-signing contract files now pass46/46 with0
skips. Cash and Plan labels use their exact approved case; campaign refresh
remains the exact returned enum. Public signing allows only the two named
CSS additions and now rejects CSS imports, resource URLs, data and credential
code as well as the existing staff-JS/session checks. The four ordered
customer asset lists are updated without dropping JS/file/page-rule checks;
gap-portal passes79/79 with0 skips. The unchanged S5 registry wrapper passes
2/2 with0 skips after the real Marketing layout fixes and exact16px input
expectations. These do not replace fresh GitHub CI on the final commit.

## Final exact-head read-only lane — 7dcb0aa, 2026-10-20

Assigned scope: only the 13 non-browser jobs in each of [push run 39397341121](https://github.com/ZootimusMaximusSupreme/fundhub-platform/actions/runs/39397341121) and [PR run 39397346454](https://github.com/ZootimusMaximusSupreme/fundhub-platform/actions/runs/39397346454). GitHub run metadata independently confirms both `head_sha` values are `7dcb0aa315b80bc9dadc93426c33a1587f1ba040`, attempt 1. No old-head result is substituted. Root owns the separate `screens (real browser)` jobs, integration and release.

At 09:02 UTC, push had 1/13 non-browser jobs successful and 12 running; PR had 5 running and 8 queued. Both actual shard-0 Lint steps passed. Started Postgres jobs had passed fresh-database migrations and the manifest check, but the blocks jobs' app-role privilege and isolation steps had not yet run. These partial results are **not final approval**.

Important counting boundary: `.github/workflows/tests.yml` sets `FUNDHUB_SUITE_PART=unit` for the twelve unit-shard jobs. `scripts/run-suite.mjs` omits `*.pg.test.mjs` in those jobs; its printed `pg exit 0` therefore does **not** mean PostgreSQL test files ran. The six real-Postgres unit shards run the ordinary test files with a real scratch database available. Only the separate blocks job runs every `*.pg.test.mjs` serially, then the explicit app-role privilege and tenant-isolation proofs. Any TAP skip remains unproved, and the owner-connected main PostgreSQL suite is not relabeled app-role proof.

The audit skill keeps this lane read-only: inspect job/step summaries and relevant logs, append findings here, do not modify application/test/workflow/environment/Git/database state or rerun jobs. Historical failures above remain unchanged.

Checkout logs add an important distinction: the push jobs checked out the literal candidate `7dcb0aa315b80bc9dadc93426c33a1587f1ba040`; PR jobs checked out GitHub's synthetic merge `0e7f37912261d8d164b7f289a5b9b6dff6c8b6f7`, explicitly “Merge 7dcb0aa… into f1490ce9da5006eca89c3387e575a090a371d1d0.” Both are evidence for this candidate, but they are not the same Git object.

At 09:06:56 UTC, push had 11/13 successful; PR had 3/13 successful and no failures. Push [blocks job 118543232923](https://github.com/ZootimusMaximusSupreme/fundhub-platform/actions/runs/39397341121/job/118543232923) completed successfully:

- Fresh database migrations and migration-manifest check both passed.
- Call/Present chain: 3 passed, 0 failed/skipped.
- Serial PostgreSQL files: 4054 passed, 0 failed, **4 skipped**.
- Explicit app-role privilege guard: 3 passed, 0 skipped; log confirms connection as `fundhub_app`, no superuser/BYPASSRLS/CREATEROLE/CREATEDB/replication/schema-create privilege.
- Tenant-isolation suites: 102 passed, 0 skipped. Fixtures use the owner connection; assertions use `fundhub_app`.

The four serial-PG skips are explicit remaining proof limits: two Meta-ad fixture cases whose fixtures are not built; the public `anon`/`authenticated` roles case because those roles do not exist in the scratch database; and the data-layer journey harness because the owner/superuser connection is deliberately refused by `scratch-guard.mjs`. A successful blocks job does not make those four pass.

Real-PG unit shard 2 also reports two skipped leaf cases: its owner-connected privilege assertion (the separate blocks step above really runs as the app role) and the four-PDF printer because WeasyPrint is unavailable. No-DB jobs skip additional SQL suite wrappers even where their final leaf summary says `# skipped 0`; both the omitted PG files and these skipped suite bodies remain outside their pass totals.

### Final non-browser result — 09:11:50 UTC

**Both sets concluded: push 13/13 successful; PR 13/13 successful.** Read all 26 non-browser job logs. No failing assertion appeared in this assigned lane. The corresponding TAP counts match between push and PR:

| Job | Push job evidence | PR job evidence | Passed / failed / skipped leaf tests in each run |
| --- | --- | --- | --- |
| No DB, shard 0 | [118543233558](https://github.com/ZootimusMaximusSupreme/fundhub-platform/actions/runs/39397341121/job/118543233558) | [118543251543](https://github.com/ZootimusMaximusSupreme/fundhub-platform/actions/runs/39397346454/job/118543251543) | 5631 / 0 / 2 |
| No DB, shard 1 | [118543233565](https://github.com/ZootimusMaximusSupreme/fundhub-platform/actions/runs/39397341121/job/118543233565) | [118543251724](https://github.com/ZootimusMaximusSupreme/fundhub-platform/actions/runs/39397346454/job/118543251724) | 4599 / 0 / 0 |
| No DB, shard 2 | [118543233406](https://github.com/ZootimusMaximusSupreme/fundhub-platform/actions/runs/39397341121/job/118543233406) | [118543251852](https://github.com/ZootimusMaximusSupreme/fundhub-platform/actions/runs/39397346454/job/118543251852) | 3907 / 0 / 2 |
| No DB, shard 3 | [118543233359](https://github.com/ZootimusMaximusSupreme/fundhub-platform/actions/runs/39397341121/job/118543233359) | [118543251549](https://github.com/ZootimusMaximusSupreme/fundhub-platform/actions/runs/39397346454/job/118543251549) | 5346 / 0 / 0 |
| No DB, shard 4 | [118543233491](https://github.com/ZootimusMaximusSupreme/fundhub-platform/actions/runs/39397341121/job/118543233491) | [118543251667](https://github.com/ZootimusMaximusSupreme/fundhub-platform/actions/runs/39397346454/job/118543251667) | 3832 / 0 / 2 |
| No DB, shard 5 | [118543233607](https://github.com/ZootimusMaximusSupreme/fundhub-platform/actions/runs/39397341121/job/118543233607) | [118543251652](https://github.com/ZootimusMaximusSupreme/fundhub-platform/actions/runs/39397346454/job/118543251652) | 4741 / 0 / 17 |
| Real PG unit, shard 0 | [118543233335](https://github.com/ZootimusMaximusSupreme/fundhub-platform/actions/runs/39397341121/job/118543233335) | [118543251445](https://github.com/ZootimusMaximusSupreme/fundhub-platform/actions/runs/39397346454/job/118543251445) | 5811 / 0 / 0 |
| Real PG unit, shard 1 | [118543233181](https://github.com/ZootimusMaximusSupreme/fundhub-platform/actions/runs/39397341121/job/118543233181) | [118543251822](https://github.com/ZootimusMaximusSupreme/fundhub-platform/actions/runs/39397346454/job/118543251822) | 4633 / 0 / 0 |
| Real PG unit, shard 2 | [118543233980](https://github.com/ZootimusMaximusSupreme/fundhub-platform/actions/runs/39397341121/job/118543233980) | [118543251584](https://github.com/ZootimusMaximusSupreme/fundhub-platform/actions/runs/39397346454/job/118543251584) | 3970 / 0 / 2 |
| Real PG unit, shard 3 | [118543233394](https://github.com/ZootimusMaximusSupreme/fundhub-platform/actions/runs/39397341121/job/118543233394) | [118543251873](https://github.com/ZootimusMaximusSupreme/fundhub-platform/actions/runs/39397346454/job/118543251873) | 5372 / 0 / 0 |
| Real PG unit, shard 4 | [118543233823](https://github.com/ZootimusMaximusSupreme/fundhub-platform/actions/runs/39397341121/job/118543233823) | [118543251750](https://github.com/ZootimusMaximusSupreme/fundhub-platform/actions/runs/39397346454/job/118543251750) | 3919 / 0 / 0 |
| Real PG unit, shard 5 | [118543233343](https://github.com/ZootimusMaximusSupreme/fundhub-platform/actions/runs/39397341121/job/118543233343) | [118543251687](https://github.com/ZootimusMaximusSupreme/fundhub-platform/actions/runs/39397346454/job/118543251687) | 4781 / 0 / 0 |
| Real PG blocks | [118543232923](https://github.com/ZootimusMaximusSupreme/fundhub-platform/actions/runs/39397341121/job/118543232923) | [118543251484](https://github.com/ZootimusMaximusSupreme/fundhub-platform/actions/runs/39397346454/job/118543251484) | Serial PG 4054 / 0 / 4; separate chain 3 / 0 / 0, app-role guard 3 / 0 / 0, isolation 102 / 0 / 0 |

Both no-DB shard-0 logs additionally show named guards **73/73**, no skips, and lint **4006 files/inline scripts parse clean**. Lint and named-guard steps are intentionally limited to shard 0, not counted as executed on the other five shards. All seven real-PG jobs in each run actually passed fresh-database migrations and migration-manifest checks. Both blocks logs confirm the unprivileged app-role connection and the same four skipped PG cases listed above.

Completed this read-only assignment when both 13-job sets concluded. No job rerun, application/test/workflow edit, environment/database action, commit or release was performed. The old failures and unproved skips remain preserved. **This is not a whole-workflow, browser, deployment or live-customer pass:** root retains those gates.

## Post-merge main observation — f78f6b8, 2026-10-20

Separately assigned read-only observation of [main tests run 39399262837](https://github.com/ZootimusMaximusSupreme/fundhub-platform/actions/runs/39399262837), including all 14 jobs and the browser job. GitHub metadata confirms branch `main`, push event, attempt 1, exact `head_sha` **f78f6b8b95ab4651b1553d942b0e4c8462a5c839**, started at 09:14:45 UTC. At 09:17:28 UTC, all 14 jobs were running; none was counted as passed.

The earlier two candidate runs are not substituted for this actual-main observation. Root owns the separate Ship run and live verification. This lane only reads GitHub job/step/log evidence and appends this receipt; it does not rerun jobs, change source/tests/workflows/environment, access a database, commit or deploy. Existing no-DB, PostgreSQL and platform-specific skip boundaries remain in force.

### Main failure observed — 09:22:51 UTC

- [No-DB shard 2, job 118549593512](https://github.com/ZootimusMaximusSupreme/fundhub-platform/actions/runs/39399262837/job/118549593512): **3906 passed / 1 failed / 2 skipped**; suite exit 1.
- Failed test: `RateLimiter: enforces a floor between requests`, `scripts/marketing/lib/fetch.test.mjs:151`; assertion at line 156.
- Expected: elapsed time `>=240ms` across three waits. Observed: **239ms**, `ERR_ASSERTION`, `testCodeFailure`. Recorded test duration is 239.679123ms.
- This is an actual post-merge red. The discrepancy alone does not establish a harmless timing flake, a product regression cause or a waiver.
- Root received the exact failure immediately. No rerun, assertion change or repair was attempted. At this observation, nine jobs had succeeded and four were still running, including browser and PostgreSQL blocks. Their results remain pending.

The same case passed in the candidate push (test duration 241.518171ms), candidate PR (240.418042ms), and [current-main real-PG shard 2](https://github.com/ZootimusMaximusSupreme/fundhub-platform/actions/runs/39399262837/job/118549593268) (241.928117ms). These are the logged case durations, not substituted elapsed assertions or a diagnosis. The current-main no-DB failure remains red.

At 09:25:06 UTC, all 13 non-browser jobs had concluded: **12 successful, 1 failed**. Main [PostgreSQL blocks 118549592965](https://github.com/ZootimusMaximusSupreme/fundhub-platform/actions/runs/39399262837/job/118549592965) passed migrations/manifest, Call/Present 3/3, serial PG 4054 passed / 4 skipped, actual app-role guard 3/3 and isolation 102/102. The same four PG skip reasons remain. Main [no-DB shard 0](https://github.com/ZootimusMaximusSupreme/fundhub-platform/actions/runs/39399262837/job/118549593363) passed lint 4006 and named guards 73/73. The browser job was still running; no complete-run result is inferred yet.

Root assigned a separate read-only investigation, recorded by A in [rate-limiter-timing.md](rate-limiter-timing.md). Its byte comparison finds the utility and test unchanged from pre-rollout main; its controlled-clock counterexample exposes a missing floor recheck. Its clean local samples and 9/9 local target suite do not clear this remote failure. Root classified the utility repair as a separate leftover and explicitly kept this main red; this CI lane performed no repair or remote retry.

### Final post-merge receipt — observed 09:29:55 UTC

Run `39399262837` concluded **cancelled**, updated at 09:27:33 UTC, still tied to exact main merge `f78f6b8b95ab4651b1553d942b0e4c8462a5c839`. All 14 job conclusions were inspected: **12 successful, 1 failed, 1 cancelled**. Read all 14 job logs; the browser log is incomplete because its job was cancelled.

| Main job | Evidence | Final result |
| --- | --- | --- |
| No DB shard 0 | [118549593363](https://github.com/ZootimusMaximusSupreme/fundhub-platform/actions/runs/39399262837/job/118549593363) | Success: 5631 passed, 2 skipped; additional guards 73/73, lint 4006 |
| No DB shard 1 | [118549593142](https://github.com/ZootimusMaximusSupreme/fundhub-platform/actions/runs/39399262837/job/118549593142) | Success: 4599 passed, 0 leaf skips |
| No DB shard 2 | [118549593512](https://github.com/ZootimusMaximusSupreme/fundhub-platform/actions/runs/39399262837/job/118549593512) | **Failed: 3906 passed, 1 failed, 2 skipped; exact rate-limiter failure above** |
| No DB shard 3 | [118549593413](https://github.com/ZootimusMaximusSupreme/fundhub-platform/actions/runs/39399262837/job/118549593413) | Success: 5346 passed, 0 leaf skips |
| No DB shard 4 | [118549593164](https://github.com/ZootimusMaximusSupreme/fundhub-platform/actions/runs/39399262837/job/118549593164) | Success: 3832 passed, 2 skipped |
| No DB shard 5 | [118549593201](https://github.com/ZootimusMaximusSupreme/fundhub-platform/actions/runs/39399262837/job/118549593201) | Success: 4741 passed, 17 skipped |
| Real PG unit shard 0 | [118549593171](https://github.com/ZootimusMaximusSupreme/fundhub-platform/actions/runs/39399262837/job/118549593171) | Success: 5811 passed, 0 skipped |
| Real PG unit shard 1 | [118549593165](https://github.com/ZootimusMaximusSupreme/fundhub-platform/actions/runs/39399262837/job/118549593165) | Success: 4633 passed, 0 skipped |
| Real PG unit shard 2 | [118549593268](https://github.com/ZootimusMaximusSupreme/fundhub-platform/actions/runs/39399262837/job/118549593268) | Success: 3970 passed, 2 skipped |
| Real PG unit shard 3 | [118549593365](https://github.com/ZootimusMaximusSupreme/fundhub-platform/actions/runs/39399262837/job/118549593365) | Success: 5372 passed, 0 skipped |
| Real PG unit shard 4 | [118549593348](https://github.com/ZootimusMaximusSupreme/fundhub-platform/actions/runs/39399262837/job/118549593348) | Success: 3919 passed, 0 skipped |
| Real PG unit shard 5 | [118549593190](https://github.com/ZootimusMaximusSupreme/fundhub-platform/actions/runs/39399262837/job/118549593190) | Success: 4781 passed, 0 skipped |
| Real PG blocks | [118549592965](https://github.com/ZootimusMaximusSupreme/fundhub-platform/actions/runs/39399262837/job/118549592965) | Success: serial PG 4054 passed / 4 skipped; chain 3/3, app-role 3/3, isolation 102/102 |
| Full browser suite | [118549593180](https://github.com/ZootimusMaximusSupreme/fundhub-platform/actions/runs/39399262837/job/118549593180) | **Cancelled mid-suite; no final test totals or complete-browser pass** |

The browser log's last numbered success is case 1618, followed by `The operation was canceled.` It does not contain a final Playwright summary. That case number is not a completed-suite count, and this lane does not infer the cancellation cause. The already-green candidate browser runs retain their separate existing macOS-only font-skip limits; they do not turn the cancelled main run into a pass.

All main unit/PG skip lists match their corresponding candidate-run lists. No source change, retry, hidden waiver or DB/app-role substitution was made by this lane. Monitoring stopped on conclusion, and root was sent the final result. **Actual main CI is not all-green; production deployment/live verification remains root's separate evidence.**
