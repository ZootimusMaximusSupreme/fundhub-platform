# Batch 27 display repair I — rows 1–6

Branch: `codex/heartbeat-display-repair-i`
Base: `cdc22728eaa59ef857a18485590136cc5a9502a5`
Scope: only manifest-b27 rows 1–6. Nothing was pushed, no live/customer data or environment was touched, and the shared catalog was not regenerated.

## Result

All six rows are repaired and attached to exact fake-data browser proof. No assigned blocker remains.

| Row | Result | Product repair | Exact proof |
|---:|---|---|---|
| 1 | fixed | Confirmed Agent Editor discard restores the saved snapshot before another agent opens. | `fin-b09-agent-editor.test.mjs`, `fin-b09-g2-findings.test.mjs` type an edit, confirm discard, return, and verify the saved words and clean state. |
| 2 | fixed | Restored the authenticated `stamp_incorporated` handler; it updates the named in-org business's month, age, and update time. The panel rereads the file and keeps the accepted Saved state visible. | `soft-pull-approve.test.mjs` runs the real route and write helper; `fin-b06-display-browser-2.test.mjs` proves the exact post, reread, saved month, and success state. |
| 3 | fixed | Credit-partner links now update both `href` and the shell-owned `data-fh-href`. | `fin-b10-client-control-panel.test.mjs` delays the session/link-gate pass and proves both links still target the partner. |
| 4 | fixed | Removed the two impossible document states; the filter now offers only states saved rows can hold. | `fin-b12-held-reasons.test.mjs` filters seven real-shaped rows through every offered option and checks the schema cannot hold the removed states. |
| 5 | fixed | Galaxy no longer invents neighbour handoffs or replaces a feed label with a random client. | The Galaxy browser proof shows no route draws no thread, while one supplied route keeps its exact endpoints and label. |
| 6 | fixed | Animation no longer changes saved output/presence. Agent size/activity comes from `agent_runs`; blocked state comes from recent `agent_shadow_log` guardrail records. | The Galaxy browser proof runs two animation minutes without drift, checks palette/census, and the feed tests pin the saved run/block queries. |

## Proof registry

- Removed the six old held/open entries and registered the six exact browser cases.
- Updated the documents map row to its four real statuses and Galaxy's table list to include `agent_runs` and `agent_shadow_log`.
- `gapChecks` accepts an optional in-memory compiled runtime so batch tests execute the full lane without rewriting `generated.json`; production calls are unchanged.
- `fin-b27-display-repair-i.test.mjs` mutation-checks each row: remove any one exact proof and that exact row returns as `NOT_PROVED`.

## Tests

- Focused product, route, SQL-pin, registry, and lane suites: green.
- Chromium proofs: 33/33 green for Agent Editor, partner links, documents, Galaxy legend and Galaxy routes; incorporation stamp 1/1 green.
- Catalog compiler: 13/13 green. Exact display-proof mapping guard: 1/1 green.
- Mutation guard: 2/2 green, covering all six rows.
- `npm run lint`: clean before the final report; rerun at commit time.
- `npm run journeys:check`: reports the same nine generated journey files already stale in this checkout. No route or role gate changed in this batch, so they were not regenerated here.

## Files

- Product: `api/soft-pull-approve.mjs`, `public/app/agent-editor.html`, `public/app/client-control-panel.html`, `public/app/documents.html`, `public/app/galaxy.html`, `src/galaxy/company-activity.mjs`.
- Map/runtime: `ops/workflows/coverage-every-surface-2026-10-10/desks-b.json`, `src/pulse/coverage/gap-catalog-display.mjs`, `src/testing/fin-b25-sql-pins.mjs`.
- Proofs/guards: the changed `fin-b06-*`, `fin-b09-*`, `fin-b10-*`, and `fin-b12-*` files under `src/pulse/catalog/proofs/`, plus `src/pulse/catalog/proofs/fin-b27-display-repair-i.test.mjs`, `src/http/soft-pull-approve.test.mjs`, `src/http/fin-b25-read-doors.test.mjs`, and `src/galaxy/company-activity.test.mjs`.

Integration next step: merge this commit, regenerate the shared catalog once after all repair batches land, then run the shared catalog guards.
