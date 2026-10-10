# finish-left 2026-10-09 — T1: generated docs are stale (diagrams, journeys)

Branch: `fix/T1-2026-10-09` (cut from main at `e58704577`). Not pushed. Not merged.
Status: done. Both named tests are green.

## What was wrong

Two tests were red:

1. `scripts/diagrams/generate.test.mjs` — "docs/diagrams is in sync with the code"
2. `scripts/journeys/generate.test.mjs` — "the journeys are not stale"

Both compare the files in `docs/` with what the generator makes from the code today. The code had
moved on. The files had not been regenerated.

## Root cause

Nobody ran `npm run diagrams` and `npm run journeys` after these code commits.

| Drift | Caused by | Shows up as |
|---|---|---|
| 2 new workflows (`eveningBrief`, `pulseInstantWatch`) in `src/workflows/index.mjs` | `8cf8518a1` (2026-10-07), `eee0270dd` (2026-10-07) | diagrams say 98 workflows, code has 100 |
| `POST /api/ops/notify-owner` | `12f052c31` (2026-10-09) | journeys: routes 323 to 327 |
| `GET /api/public/morning-brief` and `GET /api/read/morning-brief` | `2248d6354` (2026-10-09) | same |
| `POST, PUT /api/marketing/shoot/take` | `b4919a95a` (2026-10-07) | same |

Last regeneration: diagrams at `17c9a2b54` (2026-10-06), journeys at `ddcabb294` (2026-10-06).
Both generators ran clean. Neither crashed. Neither produced nonsense in structure. The output is
deterministic (the existing determinism test passes).

## What changed

Only generated docs and the changelog. No code, no test, no generator, no `-intended.md` file.

- `docs/diagrams/README.md`, `docs/diagrams/agent-triggers.md` — "98" became "100" (2 lines).
- `docs/journeys/README.md` plus the 8 `-actual.md` files: client, role-owner, role-sales-manager,
  role-closer, role-funding-advisor, role-inquiry-remover, affiliate, white-label.
  The diffs are the 4 new routes and the counts that follow from them (323 to 327, "32 genuinely open").
- `docs/journeys/CHANGELOG.md` — one line at the top, as CLAUDE.md section 4 requires.

I read every hunk. Each added line traces to one of the four routes above, or is a count that follows
from them. The four routes are real in `netlify/functions/api.mjs` (ROUTES map lines 647, 650, 857, 1399).

## Proof

Run in this worktree, no database, nothing live touched:

- `node --test scripts/diagrams/generate.test.mjs scripts/journeys/generate.test.mjs` — 43 tests, 43 pass, 0 fail, 0 skipped.
- Before the write: `node scripts/diagrams/generate.mjs --check` said 2 files outdated, and
  `node scripts/journeys/generate.mjs --check` said 9 files outdated. After the write both exit 0
  ("docs/diagrams is up to date (11 files)", "docs/journeys is up to date (9 files)").
- `npm run lint` — 3217 files parse clean.
- Neighbour run: `src/workflows/index.test.mjs`, `src/repo/allow-list.test.mjs`, `src/repo/outbox.test.mjs`,
  `src/pulse/coverage/slice-40-more.test.mjs` — 43 of 44 pass. The one failure is NOT from this change:
  my diff is docs only and that test reads `src/workflows/index.mjs`. See leftover L1.
- Intended files: `grep` for route counts and the four new routes in every `docs/journeys/*-intended.md`
  found nothing. No regenerated `-actual` page contradicts an `-intended` page. None were touched.

## Findings — the regenerated pages draw three gates wrongly (NOT fixed, on purpose)

The generator reads each handler for a gate and falls back to "open" when it does not recognise the
shape. Three of the four new routes hit that blind spot. Each row below is what the page says, and
what the handler really does.

| Route | Page says | Handler really does | Direction of the error |
|---|---|---|---|
| `/api/ops/notify-owner` | "anyone", listed under "genuinely open" | Needs the header `x-ops-notify-secret` to equal `OPS_NOTIFY_SECRET` (32+ chars), else 401 or 503. `api/ops/notify-owner.mjs` lines 24-50. | Page says more open than it is |
| `/api/public/morning-brief` | "anyone", listed under "genuinely open" | Needs the signed code `k=` from the text link (`verifyBriefToken`), else a flat 404. `api/public/morning-brief.mjs` lines 26, 128, 134. The extractor's signed-link check at `scripts/journeys/extract.mjs:359` needs the words `sig` and `exp` in the handler file, which this one keeps in `src/ops/brief-link.mjs`. | Page says more open than it is |
| `/api/marketing/shoot/take` | "owner, admin" | Three doors: a staff session (owner, admin), a film key, or no credentials at all (`openTake`, `api/marketing/shoot/take.mjs` lines 44-45). The code header and the 2026-10-07 changelog line both say "No sign-in wall" on purpose. | Page says LESS open than it is |

Why I did not fix the generator in this task:

- It is an older blind spot, not something these commits created. In the committed docs before my
  change, `/api/public/rb2b-webhook` (gated by `?secret=` at `api/public/rb2b-webhook.mjs:170-175`) is
  already drawn "anyone", and `/api/marketing/shoot` has the same no-sign-in read and is drawn
  "owner, admin". So the three new rows are consistent with how the generator already treats this class.
- A real fix means new gate kinds in the extractor, new words in `scripts/journeys/render.mjs`
  (the sentence at line 384 and the one at line 248 are fixed text), new tests, and it would
  change the labels of older routes too. That is its own piece of work, not "make two tests green".
- The test that caught the older rule ("a signature-verified route is never described as reachable by
  anyone") only looks at routes the extractor already classed as verified, so it cannot see these.

Please read the three rows above before anyone quotes the journey pages on who can reach what.

## Leftovers (not fixed, not mine)

- **L1. `src/workflows/index.test.mjs` "index serves exactly the workflows on disk, and the count is pinned" is red.**
  `pulse-instant-watch` is registered in `src/workflows/index.mjs` (import line 34, entry line 292) but is not
  in `EXPECTED_WORKFLOW_IDS` (line 66 of the test). The test says to add the id "in the same commit, so the
  decision is written down". It is the other half of the 98 to 100 jump. It is a one-line owner decision about
  letting a job run in production, so I left it alone.
- **L2. Generator gate blind spots** — the three rows in the table above, plus `/api/public/rb2b-webhook` and
  `/api/marketing/shoot` (older). Needs a design call: how to name "shared secret" and "partly open" on the pages.
- **L3. Static sentence in the journeys README** — "These are the sign-in routes and the health check" (render.mjs:248,
  repeated in every `-actual.md`) is already untrue: the list holds public forms, a checkout, and webhooks.
  Not changed.

## Change manifest

- Files touched: 12 under `docs/` (listed above) plus this board file.
- Exports added or changed: none.
- Routes affected: none changed. Four now drawn.
- Journeys impacted: the 8 tracked `-actual.md` journeys (generated). No `-intended.md`.
- Journeys changelog: line added.
- Database, migration, live call, send, deploy, push, new dependency: none.
- Tests removed, skipped or weakened: none.
