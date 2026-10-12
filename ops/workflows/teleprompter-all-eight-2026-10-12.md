# Teleprompter all-eight build and proof — 2026-10-12

## Scope

Chris approved all eight units. Touch only the teleprompter, its script-edit route/store, focused tests, and the actual journey record.

## Shared context

- Live page: `/app/teleprompter.html`
- Front end: `public/app/teleprompter.html`, `public/app/teleprompter.css`, `public/app/teleprompter.js`
- Edit route: `api/marketing/scripts/edit.mjs`
- Database write: `editScript` in `src/marketing/scripts-store.mjs`
- Existing browser coverage: `e2e/teleprompter-touch.spec.mjs`, `e2e/teleprompter-take-flow.spec.mjs`, `e2e/teleprompter-remote-clicks.spec.mjs`
- Existing journey: `docs/journeys/shoot-flow.md`. It is the actual flow and points to the intended specs because no `shoot-intended.md` exists.
- Owner rules: speed stays 130–320 WPM in steps of 5. Do not change client or league-call-list pages.
- The Serena TypeScript map could not start because Node was missing from its PATH. Chris approved normal repo tools as the fallback.

## Workflows

| # | Unit | Owner | Status | Dependency |
|---|---|---|---|---|
| 1 | Real ad numbers/names, current row highlight, clear Complete target | parallel worker | done | none |
| 2 | Top-left front/rear camera button and repeat switch | parallel worker | done | none |
| 3 | Small non-blocking video save indicator | parallel worker | done | none |
| 4 | Integrate and prove all three build changes | this session | done | 1–3 |
| 5 | Browser edit/save checks for every teleprompter text shape | parallel worker | done | none |
| 6 | Trace and prove route → store → database persistence | this session | done | none |
| 7 | Reload/reopen persistence proof with controlled data and cleanup | this session | done | 5–6 |
| 8 | Full focused regression, live proof, commit, push, and ship check | this session | claimed | 1–7 |

## Ground truth

1. A saved edit posts the whole current body to `marketing/scripts/edit` with the script id and version.
2. The server creates a new `ad_scripts` version, supersedes the prior version, and returns the saved row.
3. Ads, VSLs, thank-you scripts, and their variants must use the same edit path when they are in the shoot.
4. A reload must read the new database version. Browser-only state is not proof.
5. The filming list must show the system ad number and real script name, and mark the current script with text plus a visible style.
6. Complete must name the current script before confirmation.
7. Camera switch must move between `user` and `environment`, then back, without stopping the recording flow.
8. Video save feedback must be small, in a top corner, and show saving, saved, and failed states.

## Change manifests

- Queue and Complete: `public/app/teleprompter.js`, `public/app/teleprompter.css`.
- Camera switch and upload chip: `public/app/teleprompter.html`, `public/app/teleprompter.css`, `public/app/teleprompter.js`.
- Browser proof: `e2e/teleprompter-take-flow.spec.mjs`, `e2e/teleprompter-touch.spec.mjs`.
- Unit and Postgres proof: `src/ui/teleprompter.test.mjs`, `src/http/marketing-scripts.pg.test.mjs`.
- Actual journey: `docs/journeys/shoot-flow.md`, `docs/journeys/CHANGELOG.md`.
- Pulse map and generated catalog: `ops/workflows/coverage-every-surface-2026-10-10/desks-f.json`, `ops/workflows/coverage-every-surface-2026-10-10/routes-1.json`, `src/pulse/catalog/proofs/display-batch-staff-ui.mjs`, `src/pulse/catalog/generated.json`.

## Evidence

- 49 teleprompter unit checks passed.
- 75 focused teleprompter unit checks passed across the related unit files.
- 11 take-flow browser checks passed, including camera switch, queue labels, Complete target, and save chip.
- 6 type-by-type browser save/reload checks passed: Ad, Ad variant, VSL, VSL variant, Thank You, Thank You variant.
- The full teleprompter browser suite passed: 73 of 73 before the added failed-upload state; the final take-flow suite passed 12 of 12 with saving, saved, and failed states.
- The Postgres test now checks the same six shapes against `ad_scripts`, old-row superseding, and a fresh API read. It needs the clean CI Postgres service; the laptop has no Docker, Postgres, or safe test `DATABASE_URL`.
- The existing registry heartbeat rows cover the teleprompter page, script-edit route, and take-upload route. The catalog now has wired proof rows for offer-stack/current labels, Record/Stop, camera flip, all-shape script edits, and the small save chip. The clean catalog build reports 3,975 mapped rows, 3,942 unique rows, 3,864 wired, and 78 red.

## Blockers

- Chris approved normal repo tools after the Serena map failed.
- `npx tsc --noEmit` has an existing error in `src/marketing/filmed-receive.mjs:159`. The same line is on `origin/main`; it is outside this task and was not changed.
- The full local `npm test` wrapper hit the separate pulse-proof work already open in this checkout. Focused teleprompter and pulse-map checks are green; GitHub CI will run from this commit without those unstaged files.
