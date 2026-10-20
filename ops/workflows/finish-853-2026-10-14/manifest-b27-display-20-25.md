# Batch 27 display repair — rows 20–25

Branch: `codex/heartbeat-display-20-25`
Base: `24ccf8e04c191dba88f5fd7ee2a942ba707f9748`
Scope: only manifest-b27 display rows 20–25. Nothing was pushed, no live/customer data or environment was touched, and the shared generated catalog was not rewritten.

## Result

All six assigned rows are repaired and attached to their exact handler, browser, and saved-result proofs.

| Row | Result | Product repair | Exact proof |
|---:|---|---|---|
| 20 | fixed | Banks waits for the signed session and shows plan controls only to owner, admin, sales manager, or closer; `?client_id=` alone grants nothing. | `fin-b07-page-gates.test.mjs` opens the real page as a client with `?client_id=` and as an owner, then checks the controls. `money-banks-screen.test.mjs` pins section behavior. |
| 21 | fixed | `/api/read/inquiries` now uses `ROLE_SETS.SPECIALIST_DESK`. | `fin-b07-page-gates.test.mjs` runs the real handler for all four allowed roles, all other staff roles, and a client, proving refusals happen before a data read. |
| 22 | fixed | Show more adds 25 cases per press and only the final remainder on the last press. | `fin-b13-specialist-desk.test.mjs` proves 25 → 50 → 75 → 80 and the matching button labels. |
| 23 | fixed | Case rows are keyboard-focusable and Enter opens or closes the same drawer as click. | `fin-b13-specialist-desk.test.mjs` presses Enter twice and checks `aria-expanded` plus drawer presence. |
| 24 | fixed | The work queue recognizes the saved `on_hold` enum and renders `Hold` as `live`. | `fin-b13-specialist-desk.test.mjs` paints a real-shaped `on_hold` row. The repaired live contract and `fin-b07-live-cases-work.test.mjs` cover the saved work row. |
| 25 | fixed | Worked now moves only when a row crosses the unworked/worked boundary; confirming an already-attempted row increments Confirmed once without incrementing Worked again. | `fin-b13-specialist-desk.test.mjs` starts from server counts and proves the exact post-write totals. |

## Display proof result

| | Count |
|---|---:|
| Assigned rows | 6 |
| Open before | 6 |
| Open after | 0 |

`fin-b27-display-20-25.test.mjs` compiles all six exact map IDs and confirms none judges `NOT_PROVED`. Its mutation check removes each row's direct proof and, where present, its saved-result contract; every exact row returns red as `NOT_PROVED`.

## Checks

- Exact local handler/browser suite: 41/41 pass (`fin-b07-page-gates`, `fin-b13-specialist-desk`, `fin-b16-money-pages`).
- Saved-result and SQL scenario suite: 81/81 pass (`fin-b07-live-contracts`, `fin-b07-live-cases-work`).
- Six-row compile/mutation guard: 2/2 pass.
- `src/http/money-banks-screen.test.mjs`: 15/15 pass.
- `npx tsc --noEmit`: pass.
- `npm run journeys:check`: pass after regenerating the required route matrices.
- `npm run lint`: blocked before checking changed files by the pre-existing duplicate `stampBusinessIncorporated` declaration at `api/soft-pull-approve.mjs:316`.
- `node scripts/pulse/count-not-proved.mjs /tmp/heartbeat-display-20-25-after.json`: blocked by that same pre-existing parse error. The row-scoped compiler/mutation guard is the exact 6 → 0 proof; no generated catalog or count was edited.

## Files

- Product: `api/read/inquiries.mjs`, `public/app/money-banks.js`, `public/app/inquiry-remover.html`.
- Proof wiring/tests: `src/http/money-banks-screen.test.mjs` and the changed/new `fin-b07-*`, `fin-b13-*`, `fin-b16-money-pages.test.mjs`, and `fin-b27-display-20-25.test.mjs` under `src/pulse/catalog/proofs/`.
- Generated actual journeys: the nine files written by `npm run journeys`, reflecting the narrower `/api/read/inquiries` role gate plus pre-existing route-source drift already present at the base commit.

Integration next step: merge this commit, repair the existing `api/soft-pull-approve.mjs` duplicate declaration in its owning batch, then regenerate the shared catalog once after all display repair batches land.
