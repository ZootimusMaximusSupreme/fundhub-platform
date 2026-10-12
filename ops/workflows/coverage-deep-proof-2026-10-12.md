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
| Display proof | Agent 1 | 427 buttons, 385 screens, 259 forms, 172 links | done — 159 proved, 1,084 honest red |
| Door proof | Agent 2 | 339 routes, 13 jobs, 4 webhooks | done — 12 proved, 344 honest red |
| Flow proof | Agent 3 | 105 journeys, 17 messages, 1 agent | done |
| Read proof | Agent 4 | 40 reads | done — 19 proved, 21 honest red |
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

Done. Serena opened, but its shared TypeScript server cannot see Node, so this lane used normal repo search/read tools as the documented fallback.

- Before: 1,243 monitored-red rows — 427 buttons, 385 screens, 259 forms, 172 links.
- After: 1,084 monitored-red rows — 386 buttons, 348 screens, 235 forms, 115 links.
- Upgraded: 159 exact low-risk result proofs — 41 buttons, 37 screens, 24 forms, 57 links.
- Shared recipe: accepts only `none` or `staffOnly` rows with a named, safe local browser result test. It rejects page-load/smoke proof, live specs, database specs, paused specs, ambiguous test names, and every money/client/message result without an exact saved-result contract.
- Focused Node proof: `node --test src/pulse/catalog/proofs/display-evidence-result.test.mjs src/pulse/catalog/display-recipes.test.mjs` — 9 passed, 0 failed. `node --test src/pulse/coverage/gap-catalog-display.test.mjs` — 7 passed, 0 failed.
- Browser proof: the 41-file candidate run finished 545 passed and 2 failed. The two red files — `e2e/cc-tab-shoot.spec.mjs` and `e2e/teleprompter-take-flow.spec.mjs` — are explicitly refused by the recipe, so no row tied to either file was made green.
- Safety: fake/local browser boundaries only. No live client, message, call, charge, provider send, or production write ran. No production UI file changed.
- Honest leftovers: 442 deep rows still need an exact input-to-saved-result contract. Another 642 low-risk rows still need a safe local browser assertion for the named result. They stay red.
- Changed paths: `src/pulse/catalog/proofs/display-evidence-result.mjs`, `src/pulse/catalog/proofs/display-evidence-result.test.mjs`, `src/pulse/catalog/proofs/display-proof-cases.mjs`, and this Display proof manifest section.

### Door proof

Done. Serena instructions loaded, but its shared TypeScript server could not see Node. This lane used normal repo search/read tools as the documented fallback.

- Before: 356 monitored-red rows — 339 routes, 13 jobs, 4 webhooks.
- After: 344 monitored-red rows — 337 routes, 7 jobs, 0 webhooks.
- New exact result proof: 12 rows — Climate geocode, public RB2B event save, 6 non-empty jobs, and all 4 catalog webhooks.
- Safe proof only: fake databases, fake providers, process-memory files, and read-only handler calls. No live sends, calls, charges, or client writes.
- Tests: `node --test src/pulse/catalog/proofs/door-proof.test.mjs src/pulse/catalog/proofs/door-batch-route-exact.test.mjs src/pulse/catalog/proofs/door-batch-route-result.test.mjs src/pulse/catalog/proofs/door-batch-job-final.test.mjs src/pulse/catalog/proofs/door-batch-job-result.test.mjs src/pulse/catalog/proofs/door-batch-webhook-final.test.mjs src/pulse/catalog/proofs/door-batch-webhook-result.test.mjs src/pulse/catalog/proofs/door-batch-webhook-red.test.mjs src/pulse/coverage/gap-door-batch-routes.test.mjs` — 1,009 passed, 0 failed.
- Checks: `npm run lint` passed. `npx tsc --noEmit` is blocked by the pre-existing out-of-lane error at `src/marketing/filmed-receive.mjs:159`.
- Honest leftovers: 337 route results still need intended-method fake-data assertions. Seven jobs still need non-empty result proof: contract chaser, hiring outreach, instant pulse watch, Meet transcript pull, inquiry bureau call, bureau-response reader, and the ad-video worker.
- Changed paths: `src/pulse/catalog/proofs/door-batch-job-final.test.mjs`, `door-batch-route-exact.mjs`, `door-batch-route-exact.test.mjs`, `door-batch-route-result.test.mjs`, `door-batch-webhook-final.mjs`, `door-batch-webhook-final.test.mjs`, `door-proof.mjs`, `door-proof.test.mjs`, `src/pulse/coverage/gap-door-batch-jobs.mjs`, `gap-door-batch-routes.mjs`, `gap-door-batch-routes.test.mjs`, and `gap-door-batch-webhooks.mjs`.

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

Done. Serena instructions loaded, but the shared TypeScript server could not see Node. This lane used normal repo search/read tools as the documented fallback.

- Before: 40 monitored-red read rows.
- After: 21 monitored-red read rows.
- Upgraded: 19 exact result proofs. They cover agent staff choices and promotion gates, the bank-amount waiting count, portal agreements, the helper poll and bridge fallback, money trends, all three My Numbers blocks, four Ops Admin blocks, both payment-success rules, the Present send lock, and both teleprompter read controls.
- Proof method: controlled fake read values run through the real page functions. No page-load, route-exists, file-exists, schema-only, or HTTP-200 proof was accepted.
- Focused proof: `node --test src/pulse/catalog/proofs/read-result-probes.test.mjs src/pulse/coverage/gap-catalog-reads.test.mjs src/pulse/catalog/proofs/read-proof-cases.test.mjs` — 17 passed, 0 failed, 0 skipped.
- Safety: no live client, message, call, charge, provider send, or production write ran. No production file changed.
- Changed paths: `src/pulse/catalog/proofs/read-result-probes.test.mjs`, `src/pulse/catalog/proofs/read-proof-cases.mjs`, `src/pulse/catalog/proofs/read-proof-cases.test.mjs`, `src/pulse/coverage/gap-catalog-reads.mjs`, `src/pulse/coverage/gap-catalog-reads.test.mjs`, and this Read proof manifest section.
- Honest leftovers: `catalog-read:affiliate-figures`, `affiliate-portal`, `affiliate-license`, `affiliate-tax`, `brand-compliance`, `brand-preview`, `campaign-partners`, `campaign-spend`, `campaign-books`, `campaign-list`, `campaign-fatigue`, `campaign-connections`, `campaign-actions`, `campaign-summary`, `portal-welcome-video`, `portal-referral`, `closer-logbar`, `plaid-link`, `partner-census`, `social-oauth`, and `climate-map`. Each remains red with its exact missing result proof in `gap-catalog-reads.mjs`.

### Integration and ship

Claimed by this session. Baseline six-lane built-bundle pulse passed as a safe runner: 0 skipped rows, 0 timeouts, 0 SQL errors, 0 writes, and 0 provider sends. It reported 1,879 red rows inside the selected lane output. The final folded report had 1,890 red rows because it also includes older company-health reds outside this catalog upgrade. First build pass added 235 stronger proofs, taking the catalog proof-red count from 1,762 to 1,527 before catalog rebuild. Fresh review and the after-count are next.
