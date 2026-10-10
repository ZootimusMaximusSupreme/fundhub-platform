# M4: mm-gl-blueprint-glue merged with current main (2026-10-09)

Merge builder M4. Branch `mm-gl-blueprint-glue` (draft pull request #26, unit GL: the Blueprint
flywheel chain runs end to end with no GitHub token). Work branch:
`merge/M4-mm-gl-blueprint-glue-2026-10-09`. Nothing was merged into main, pushed, shipped or run
against a database.

## What was wrong

1. The branch was 342 commits behind main. Merging main gave one real text conflict:
   `docs/journeys/marketing-dashboard-flow.md` (both sides appended a section at the same spot).
2. After the merge, the branch's own tests failed in four places, and three pg tests would have
   failed in GitHub CI. The branch did not break; main moved under it.

## Root cause of the test failures

Main's commit `ae3c014cd` (2026-10-08, "marketing: ad registry entries, machine scripts, capital
blueprint flywheel") committed the folder `marketing/flywheel/capital-blueprint/` (owner notes, an
avatar, seven research files). The GL tests used `capital-blueprint` as a stand-in for "a brand-new
campaign with no committed files". It is not new any more. The site's built-in copy now holds it,
so:

- a probe for "nothing is on file anywhere" found the committed file instead of "missing";
- "Start a flywheel" for the Capital Blueprint now answers 200 `created: false` and queues nothing
  (the folder already exists), and a second company can read the folder.

The committed `01-avatar.md` reads FAILED in the checker ("languageEntries is 56, needs at least
100"), so a read of the real folder shows row 1 as "Needs a redo", not "Not run yet".

## What changed

Conflict and merge:

- `docs/journeys/marketing-dashboard-flow.md`: kept both sections, GL first, then main's U35 clock
  section and the run queue bridge section. No wording changed.
- `docs/journeys/CHANGELOG.md`: auto-merged, but the three GL lines landed above main's newer
  2026-10-09 lines. Moved them into date order, at the top of the 2026-10-06 block (newest at top).
- Migrations: the branch has none. `db/expected-migrations.mjs` is untouched (main's copy).
- Main moved once during the session (`3e739e046`, teleprompter files only). Merged it too, no
  conflict. After it: lint clean, and the marketing, ui and marketing-http tests 1594 of 1594 pass.
  The full `npm test` numbers below were taken one commit earlier; that commit touches no file this
  branch changed.

Test fixes (code under test is unchanged; the behavior is the branch's design):

| File | Change |
|---|---|
| `src/marketing/flywheel/stage-inputs.test.mjs` | New constant `NO_FILES = "no-committed-files"`. The "path in the avatar's shape is missing" probe and the "no company, no saves read" test use that campaign folder. |
| `src/marketing/research/research-lib.test.mjs` | The "no company, nothing read" probe uses `no-committed-files`. |
| `src/marketing/avatar/run.test.mjs` | The "step 1 reads the owner notes from the company's waiting saves" test runs in the `no-committed-files` campaign (every assertion kept). |
| `src/http/marketing-flywheel.pg.test.mjs` | New `bare = { reader: { bundleRoots: [<missing dir>] } }` (the reader's own test hook) passed to the three "Start a flywheel" calls and the two "new flywheel reads from its pending save for this company only" reads. Every assertion kept. |

No expectation was weakened, skipped or deleted. Each probe still asserts the same thing ("missing",
"MISSING x6", "Not run yet", 404 for the other company); only the folder it is aimed at has no
committed copy, which is what the test always meant. The reason is proved by main commit
`ae3c014cd` (`git log -- marketing/flywheel/capital-blueprint` shows only that commit).

## Proof

- `npm run lint`: 3222 files parse clean.
- Marketing, ui and marketing-http tests (`src/marketing/**`, `src/ui/*`, `src/http/marketing-*`):
  1591 tests, 1591 pass, 0 fail (before my four test edits: 4 failed, the ones listed above).
- Playwright `e2e/cc-tab-ideas.spec.mjs`: 38 of 38 pass at 390px and 1280px, including the GL
  "a finished offer waits on row 3" test (CLAUDE.md section 6 item 4).
- Full `npm test`, run from this worktree after the edits. Unit phase: 19861 tests, 19823 pass,
  15 fail, 23 skipped. pg phase: 927 tests, 83 pass, 0 fail, 844 skipped (no database).
- The 15 failing unit tests are not this branch's. The same 15 fail on a plain copy of main
  (`git archive main` run in the scratchpad): daily-pulse `--db`, docs/diagrams stale,
  docs/journeys stale, climate page claim scan, read-endpoints org scope (morning-brief.mjs),
  three workflow registry acceptance tests, outbound fetch fence (src/pulse/funnel-doors.mjs and
  instant-watch.mjs), pulse registry (a gitignored `leads/` file is gone), registry_add_ad (3
  subtests), dispatch and checks, workflows index count. None touches a file this branch changed.
- A no-database dry run of the edited pg test's reads (`readCampaign` with a stand-in db): with the
  bare bundle the row states are MISSING x6, row 1 "Not run yet", can_run ok on rows 1 and 2, not
  on row 3, and the other company gets no such campaign (404). With the real bundle (what the old
  test read) the same reads give FAILED, "Needs a redo", row 3 can run, and the other company sees
  the campaign. So the edit is needed and it restores exactly what the test asserts.
- `npx tsc --noEmit`: one error, `src/marketing/filmed-receive.mjs(159,75)` (main's file, not the
  branch's). Pre-existing.

## Could not run here

- Every `*.pg.test.mjs` (no Postgres on this Mac, no `DATABASE_URL`): 844 skipped. That includes
  `marketing-flywheel.pg.test.mjs` "unit GL: the Blueprint chain with no GitHub token" and
  `marketing-flywheel-avatar.pg.test.mjs`. GitHub CI is the proof for those. By reading, the GL
  chain tests save their own copies of steps 1 to 5 in the outbox, which lay on top of the bundle,
  so they do not depend on the committed Blueprint files.
- No live browser walk (this is a merge task; the Playwright run above is the mocked-browser check).

## Risk notes

- Customer-facing path: no. Staff-only Command Center (Ideas tab, `api/marketing/*`).
- Money: no customer money. It changes the cost lines the owner reads (`GET marketing/costs`) and
  Approve on step 3. The month cap check in `api/marketing/flywheel/run.mjs` is unchanged.
- Migration: none.
- Hot path (`src/workflows/client.mjs`, `src/events/bus.mjs`, `netlify/functions/api.mjs`): not
  touched.
- Live external system: no new call. Tweak on step 2 now starts a market research run (a model
  call, behind the existing key and month cap checks, and `MARKETING_AI_RUNNER=local` leaves it
  queued for the Mac). GitHub reads happen only when `GITHUB_REPO_TOKEN` works, as before.
- Playwright check (section 6): needed because `public/app/cc-tab-ideas.js` changed. Done, 38 of 38.
- Heartbeat row: not needed. The branch adds no page, route, job kind or send path (new files are
  two library modules and tests). No tripwire entry needed; the pulse tests that check the map pass.

## Leftovers (not fixed, not asked for)

- `marketing/flywheel/capital-blueprint/01-avatar.md` on main fails the checker (languageEntries is
  56, needs at least 100), so row 1 on the card reads "Needs a redo". It is the owner's saved run.
- On a site with `MARKETING_AI_RUNNER=local`, Tweak on step 3 answers `rerun.started: false` with
  `reason: null` (the offer route says `waiting_for: "mac"` and a message; tweak.mjs only reads
  `already_running`). The Ideas tab does not read `rerun`, so nothing is shown wrong today.
- The 15 pre-existing failing unit tests and the one tsc error above are main's.
- `docs/journeys/*-actual.md` and `docs/diagrams` are stale on main (generator tests fail); not
  regenerated here.
