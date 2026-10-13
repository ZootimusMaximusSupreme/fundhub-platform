# PR #41 retest fixes — 2026-10-13

Branch worktree: `/private/tmp/fundhub-pr41-repair-20261013`

## Workflows

| Workflow | Owner | Status | Evidence |
|---|---|---|---|
| Morning run under about 16 seconds | performance agent | Complete | Definitive three scratch runs: 8.0 s, 7.5 s, 7.4 s |
| Cold-start N/A re-checks finish without 2,500 ms timeouts | self-audit agent | Complete | `audit:na-verified` checked all 304 N/A rows cleanly on all three scratch runs |
| Integrate, run `pulse:prove` three times, update manifest and PR | primary agent | Complete | Three consecutive final `OK` results; manifest updated |

## Boundaries

- No live database.
- No merge, deploy, or push to `main`.
- Do not change the failing screens tests.
- Leave `coverage-gap-fulfillment` alone unless the accepted fix makes it faster incidentally; report its time.

## Results

### Screens CI (report only; no screen code or test changed)

At PR head `4329450cb`, GitHub run `38467806913`, job `115538974303` reported 858 passed and these 4 failures:

1. `e2e/cc-tab-numbers.spec.mjs:405` — `Numbers tab states at 390px › The view switch keeps its place in the URL and every view loads only its own numbers` (`boundingBox()` returned `null`, then the test read `height`).
2. `e2e/company-brain-chat.paused.spec.mjs:70` — `Company Brain — chat, upload, approval gating › upload stays unanswerable until the owner approves it` (upload returned HTTP 502, `embed_failed`).
3. `e2e/company-brain-chat.paused.spec.mjs:123` — `Company Brain — chat, upload, approval gating › a conversation survives a reload` (request returned HTTP 502 instead of 200).
4. `e2e/teleprompter-take-flow.spec.mjs:1076` — `live camera stays unrotated while saved video follows the phone turn` (`page.setViewportSize` failed because Chromium's window was not in a resizable state).

Comparison: main `f367aae3`, GitHub run `38465115587`, job `115530285828` reported 859 passed and the same two Company Brain failures plus the same teleprompter failure. The Numbers-tab failure appeared only in the PR run, so the overall screens job is already red on main; 3 of the PR's 4 exact failures are reproduced on main. No screen files or tests were changed for this work.

### Morning speed profile (no live database)

- `env -u DATABASE_URL ... npm run pulse:prove` stopped safely with `DATABASE_URL is not set`; no `.env` was read or linked.
- Focused fake-data checks: `node --test src/pulse/self-audit.test.mjs src/pulse/daily-pulse.test.mjs src/workflows/daily-pulse.test.mjs` — 124 passed, 0 failed, 6.14 s total. The suite includes two intentional 2 s timeout tests, so this is not the morning-run time.
- A fake empty database produced 2,434 coverage rows in 1.123 s. The whole-morning call took 20 ms when fake reads answered at once.
- With the same fake rows and one serial database client at 500 ms per read, the whole-morning call took 8.084 s and reproduced exactly six `audit:na-verified` timeouts at 2,500 ms.
- Query tracing showed why: six reads are submitted together by the self-audit, but a single `pg.Client` executes them in order. Each timer starts when submitted, not when its queued query starts. The last queued reads expire even though the database is still answering.
- `scripts/pulse/prove.mjs` has no fake or scratch mode. Its only safe existing non-production path is the GitHub `postgres` job in `.github/workflows/tests.yml`, which builds a fresh `fundhub_ci` database and provides the `fundhub_app` connection. Three final OK runs must use that scratch service (or another newly provisioned scratch Postgres), never the repo `.env`.
- `src/pulse/daily-pulse.mjs`: when the earlier Inngest steps hand in `coverageRows`, their N/A proof starts before the health/login/apply/funnel/suggestions HTTP checks. The pulse awaits it before `defaultOrgId` or any later database work, so a transaction-based `staffScope` cannot interleave with those checks. The settled results are reused by the final audit; rows added later are still checked there.
- `src/pulse/daily-pulse.test.mjs`: the real catalog-data N/A verifier is held behind a fake read while the first HTTP check waits. The test proves the read starts before that HTTP check finishes and all N/A reads settle before the first later org query.
- `env -u DATABASE_URL -u NETLIFY_DATABASE_URL node --test src/pulse/self-audit.test.mjs src/pulse/daily-pulse.test.mjs` — 119 passed, 0 failed, 0 skipped, 5.78 s.
- `env -u DATABASE_URL -u NETLIFY_DATABASE_URL node --test src/workflows/daily-pulse.test.mjs` — 10 passed, 0 failed, 0 skipped, 1.34 s.
- The 500 ms serial-client fixture after the integrated fix took 8.053 s with zero timeouts. It did not get faster because its HTTP answers are immediate; the live/scratch speed gain comes from hiding N/A reads behind the real HTTP wait.
- No screen test or coverage lane was changed.

### Final scratch proof

- Built a new disposable local PostgreSQL database, applied all 353 migrations, and ran through the scratch `fundhub_app` role. No repo environment file was read or changed, and no live database was contacted.
- Definitive consecutive `npm run pulse:prove` result 1: final `OK`; whole morning 8.0 s; `audit:na-verified` checked all 304 N/A rows; no SQL error, write, send, or cut-off.
- Definitive consecutive `npm run pulse:prove` result 2: final `OK`; whole morning 7.5 s; `audit:na-verified` checked all 304 N/A rows; no SQL error, write, send, or cut-off.
- Definitive consecutive `npm run pulse:prove` result 3: final `OK`; whole morning 7.4 s; `audit:na-verified` checked all 304 N/A rows; no SQL error, write, send, or cut-off.
- `coverage-gap-fulfillment` was below the printed five-slowest floor on every definitive run; on runs 2 and 3 it was under 0.4 s.
- `env -u DATABASE_URL node --test src/pulse/self-audit.test.mjs src/pulse/na-conditions.test.mjs src/pulse/daily-pulse.test.mjs src/workflows/daily-pulse.test.mjs` — 169 passed, 0 failed, 0 skipped.
- `env -u DATABASE_URL npm run lint` — 3,452 files and inline scripts parse clean.
- `env -u DATABASE_URL npx --no-install tsc --noEmit` — exit 0.
- Final `env -u DATABASE_URL npm test` ran with local test ports allowed and no database: unit 21,932 pass, 0 fail, 23 existing skips; Postgres 83 pass, 0 fail, 1,005 expected no-database skips; runner exits 0/0. No agent-editor file was changed.

### N/A cold-start and queue fix (no live database)

- Cause: lane re-checks started eight 2,500 ms clocks at once, but the bundle proof gives them one serial Postgres client. Later reads spent their clock waiting behind earlier reads and were falsely called timeouts.
- `src/pulse/self-audit.mjs`: lane modules load before per-check clocks. With a database, every N/A check runs in order on the one client; pure no-database checks retain bounded parallel work. A real timeout stops later reads honestly. If the underlying query is still open, the final audit starts zero verifiers or database reads and the morning run starts no later database read or write. A failed or unreadable check stays visible; no false result becomes green.
- `src/pulse/self-audit.test.mjs`: added cold-module PASS proof, exact built-funnels/catalog-data serial-client queue proof, measured-false FAIL proof, early-result reuse proof, and a proof that an early technical timeout is retried rather than reused.
- `env -u DATABASE_URL -u NETLIFY_DATABASE_URL node --test src/pulse/self-audit.test.mjs src/pulse/daily-pulse.test.mjs src/workflows/daily-pulse.test.mjs` — 130 passed, 0 failed, 0 skipped, 5.72 s total. The set includes two intentional 2 s cutoff tests.
- `npm run lint` — clean.
- `git diff --check` — clean.
- Files changed: `src/pulse/self-audit.mjs`, `src/pulse/self-audit.test.mjs`, `src/pulse/daily-pulse.mjs`, `src/pulse/daily-pulse.test.mjs`.
