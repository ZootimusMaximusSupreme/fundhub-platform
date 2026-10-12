# Coverage deep proof — 2026-10-12

Owner approved the full build. This batch upgrades the 1,762 honest red catalog rows from shallow monitoring to result proof.

## Shared rules

- A green check must prove the stated result, not just a file, route, page load, or HTTP 200.
- Use read-only checks or fake providers. Do not send, charge, call, mail, or change a live client.
- Keep a row red when the result cannot be proved honestly. Write the exact missing proof.
- Reuse proof helpers. Do not create one-off copies when one shared recipe can cover a class.
- Touch only the lane you claimed. Leave unrelated dirty files alone.
- Add focused tests for every proof recipe changed.
- Write changed paths, test commands, counts, and honest leftovers in the lane manifest.

## Workflows

| Lane | Owner | Scope | Status |
|---|---|---:|---|
| Display proof | Agent 1 | 427 buttons, 385 screens, 259 forms, 172 links | pending |
| Door proof | Agent 2 | 339 routes, 13 jobs, 4 webhooks | pending |
| Flow proof | Agent 3 | 105 journeys, 17 messages, 1 agent | done |
| Read proof | Agent 4 | 40 reads | pending |
| Integration and ship | This session | review, combine, full proof, commit, push, live check | claimed |

## Shared context

- Catalog: `src/pulse/catalog/generated.json`
- Proof recipes: `src/pulse/catalog/proofs/`
- Coverage modules: `src/pulse/coverage/`
- Proof command: `npm run pulse:prove`
- Beat proof: `npm run pulse:prove -- --beats`
- System map: `ops/workflows/system-map-2026-08-26.md`
- Intended journey files are source truth and must not be edited.

## Lane manifests

### Display proof

Pending.

### Door proof

Pending.

### Flow proof

Done. Serena was called first. Its TypeScript server could not see Node, so this lane used normal repo search/read tools as the documented fallback.

- Before: 123 honest red rows — 105 journeys, 17 messages, 1 agent.
- After: 78 honest red rows — 60 journeys, 17 messages, 1 agent.
- Upgraded: 45 rows — 40 role-access rows whose intended access count exactly matches the live route gates, plus 5 exact UI/result journeys for SLO connections, Optimize booking, and the multi-business soft-pull flow.
- Proof code: `src/pulse/catalog/proofs/flow-gap-cases.mjs`, `src/pulse/catalog/proofs/flow-result-proofs.mjs`, `src/pulse/catalog/proofs/flow-result-proofs.test.mjs`, `src/pulse/catalog/proofs/flow-batch-role-access-results.test.mjs`, `src/pulse/catalog/proofs/flow-batch-journey-ui-results.test.mjs`, and `src/pulse/coverage/gap-catalog-flow.test.mjs`.
- Focused proof: `node --test --test-force-exit src/pulse/catalog/proofs/flow-result-proofs.test.mjs src/pulse/catalog/proofs/flow-batch-role-access-results.test.mjs src/pulse/catalog/proofs/flow-batch-journey-ui-results.test.mjs src/pulse/coverage/gap-catalog-flow.test.mjs` — 20 passed, 0 failed, 0 skipped.
- Honest leftovers: 50 role-access rows have stale intended counts that do not match live route gates; 5 Climate rows no longer match the deployed Darwin page; 5 FH Consulting rows have no matching live result; all 17 message rows lack final delivery/result proof; the one AI caller accepts caller-supplied prompts and has no fixed live prompt plus judged runtime result.
- Message proof stop: the payment-link fake-provider proof hit the same auth seam twice and returned `503 {"ok":false,"error":"auth_unavailable","db":"down"}`. Per the stuck rule, no third attempt was made and both rows stayed red.
- Safety: no live client, message, call, charge, provider send, or production write ran. No intended or actual journey file changed.

### Read proof

Pending.

### Integration and ship

Claimed by this session. Waiting for the four independent lanes before full proof and ship.
