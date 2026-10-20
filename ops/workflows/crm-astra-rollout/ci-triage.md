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
