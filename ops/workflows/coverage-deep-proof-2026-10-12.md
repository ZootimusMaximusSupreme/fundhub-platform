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
| Display proof | Agent 1 | 427 buttons, 385 screens, 259 forms, 172 links | done — 0 new proof, 1,243 honest red |
| Door proof | Agent 2 | 339 routes, 13 jobs, 4 webhooks | done — 11 proved, 345 honest red |
| Flow proof | Agent 3 | 105 journeys, 17 messages, 1 agent | done — 0 new proof, 123 honest red |
| Read proof | Agent 4 | 40 reads | done — 13 proved, 27 honest red |
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

Second and final pass done. Serena was called first. Its shared TypeScript server could not see Node, so this lane used normal repo search/read tools as the approved fallback.

- Review correction: all 159 first-pass promotions were removed. A map note naming a browser spec does not prove that spec performs the named action and observes the named result.
- Before correction: 1,084 monitored-red rows — 386 buttons, 348 screens, 235 forms, 115 links.
- After correction: 1,243 monitored-red rows — 427 buttons, 385 screens, 259 forms, 172 links.
- Restored to red: all 159 heuristic promotions — 41 buttons, 37 screens, 24 forms, 57 links. Existing hand-built exact Display proofs were not changed.
- Guard added: every tracked Display row without an exact proof-case contract must stay red and point to `src/pulse/coverage/gap-catalog-display.mjs`. The guard fixes the red total at 1,243 so future changes require an explicit review.
- Removed weak proof files: `src/pulse/catalog/proofs/display-evidence-result.mjs` and `src/pulse/catalog/proofs/display-evidence-result.test.mjs`.
- Focused proof: `node --test --test-name-pattern='unmapped display rows' src/pulse/catalog/proofs/display-proof-cases.test.mjs` — 1 passed, 0 failed, 0 skipped. `node --test src/pulse/catalog/display-recipes.test.mjs src/pulse/coverage/gap-catalog-display.test.mjs` — 14 passed, 0 failed, 0 skipped.
- Candidate browser rerun completed before the correction: 183 passed across 13 safe local files. It promoted no rows because passing a file is not an exact control-to-result contract.
- Honest leftovers: 442 deep rows still need exact input-to-saved-result proof. The 801 low-risk rows need exact browser action-and-observed-result proof. All stay red.
- Safety: no live client, message, call, charge, provider send, production write, or production UI change ran. Nothing was staged, committed, or pushed.
- Changed paths: `src/pulse/catalog/proofs/display-proof-cases.mjs`, `src/pulse/catalog/proofs/display-proof-cases.test.mjs`, removal of the two weak proof files above, and this Display proof manifest section.

### Door proof

Done after the second and final review. Serena instructions loaded, but its shared TypeScript server could not see Node. This lane used normal repo search/read tools as the documented fallback.

- Before the first pass: 356 monitored-red rows — 339 routes, 13 jobs, 4 webhooks.
- Final result: 345 monitored-red rows — 338 routes, 7 jobs, 0 webhooks. Eleven rows have exact result proof.
- Review correction: Climate geocode returned state and coordinates but no county. Its control promises state and county, so it is red again. Exact missing proof: the real handler result must include and test a county value.
- Corrected exact proofs: affiliate payouts store both pending and held runs; merchant sync uses the real sync path, decrypts a fake key, reads a fake Commas response, and stores exact sale, fee, and refund rows; Blueprint uses its full file-math readiness and alert suite; Hubstaff stores both activity and screenshot events; marketing runs the real offer job with three fake model replies and checks the saved winner and review card; contract signing proves GET, POST, changed-word refusal with no signature write, and missing-secret refusal before database access; document download proves saved fake bytes and missing-secret refusal before database access.
- Other first-pass greens kept: public RB2B event save, paid-checkout expiry, Twilio status receipt, and Mailgun delivery receipt.
- Safe proof only: fake databases, fake providers, process-memory files, and read-only handler calls. No live sends, calls, charges, or client writes.
- Focused correction test: `node --test src/pulse/catalog/proofs/door-batch-route-exact.test.mjs src/pulse/catalog/proofs/door-batch-route-result.test.mjs src/pulse/catalog/proofs/door-batch-job-final.test.mjs src/blueprint/next-sequence-plan.test.mjs src/pulse/catalog/proofs/door-batch-webhook-final.test.mjs src/pulse/coverage/gap-door-batch-routes.test.mjs` — 38 passed, 0 failed, 0 skipped.
- Full Door test: `node --test src/pulse/catalog/proofs/door-proof.test.mjs src/pulse/catalog/proofs/door-batch-route-exact.test.mjs src/pulse/catalog/proofs/door-batch-route-result.test.mjs src/pulse/catalog/proofs/door-batch-job-final.test.mjs src/pulse/catalog/proofs/door-batch-job-result.test.mjs src/pulse/catalog/proofs/door-batch-webhook-final.test.mjs src/pulse/catalog/proofs/door-batch-webhook-result.test.mjs src/pulse/catalog/proofs/door-batch-webhook-red.test.mjs src/pulse/coverage/gap-door-batch-routes.test.mjs src/blueprint/next-sequence-plan.test.mjs` — 1,032 passed, 0 failed, 0 skipped.
- Honest leftovers: 338 route results still need full intended-method fake-data assertions, including Climate county. Seven jobs still need non-empty result proof: contract chaser, hiring outreach, instant pulse watch, Meet transcript pull, inquiry bureau call, bureau-response reader, and the ad-video worker.
- Changed paths in this final review: `src/pulse/catalog/proofs/door-batch-job-final.test.mjs`, `door-batch-route-exact.mjs`, `door-batch-route-exact.test.mjs`, `door-batch-route-result.test.mjs`, `door-batch-webhook-final.test.mjs`, `src/pulse/coverage/gap-door-batch-jobs.mjs`, `gap-door-batch-routes.mjs`, `gap-door-batch-routes.test.mjs`, and this Door proof manifest section.
- Git: nothing staged, committed, or pushed. Integration owns git.

### Flow proof

Second and final pass done. Serena was called first. Its TypeScript server could not see Node, so this lane used normal repo search/read tools as the approved fallback.

- Review correction: all 45 first-pass upgrades were removed. Route parsing does not prove a signed-in request, and HTML text scans do not prove a rendered click, submit, saved row, payment link, or loaded business.
- Second-pass before: 78 honest red rows — 60 journeys, 17 messages, 1 agent.
- Second-pass after: 123 honest red rows — 105 journeys, 17 messages, 1 agent. The monitor owns 283 rows total, including 160 checked nothing-to-judge rows.
- Journeys: all 90 role rows stay red until a signed-in allowed or denied route request proves the named result. The five rejected UI rows stay red until observable render, click, submit, stored-result, and reload proof exists. The other 10 Climate and FH Consulting rows still do not match the live result.
- Messages: all 17 stay red. None has a path-specific fake-provider final receipt that proves its full named trigger, gates, copy, placeholders, and delivery result. The payment-link path already failed twice at the auth/database seam, so the stuck rule bars a third attempt.
- Agent: `ai-caller:api/journeys/ask.mjs` stays red. It accepts caller-supplied system and user prompts, so there is no fixed live prompt source to run and judge.
- Removed weak proof files: `src/pulse/catalog/proofs/flow-batch-role-access-results.test.mjs` and `src/pulse/catalog/proofs/flow-batch-journey-ui-results.test.mjs`.
- Focused proof: `node --test --test-force-exit src/pulse/catalog/proofs/flow-result-proofs.test.mjs src/pulse/coverage/gap-catalog-flow.test.mjs` — 18 passed, 0 failed, 0 skipped.
- Safety: no live client, message, call, charge, provider send, or production write ran. No intended or actual journey file changed. Nothing was staged, committed, or pushed in this pass.

### Read proof

Done after the second and final strict review. Serena instructions loaded, but the shared TypeScript server could not see Node. This lane used normal repo search/read tools as the documented fallback.

- Before: 40 monitored-red read rows.
- After final review: 27 monitored-red read rows.
- Strict green: 13. The Money Helper bridge is the accepted module-result proof. Real Chromium proof covers the bank-amount waiting count, portal referral card, two affiliate reads, two Brand Studio reads, and six Campaign Manager reads.
- Corrected: 21 first-pass promotions went back to red. Raw file text, extracted page functions, helper math, string checks, and partial panel checks are not counted as result proof.
- Proof method: controlled fake source values go through the actual rendered page, or through the accepted Money Helper module path. The browser checks assert exact values, filters, money display, empty/refusal behavior already covered by the reused specs, and role scope. No page-load, route-exists, file-exists, schema-only, or HTTP-200 proof was accepted.
- Focused checks: `node --test src/pulse/catalog/proofs/read-reviewed-e2e.test.mjs src/pulse/catalog/proofs/read-second-pass-browser.test.mjs` — 4 passed, 0 failed, 0 skipped. `node --test src/pulse/coverage/gap-catalog-reads.test.mjs` — 3 passed, 0 failed, 0 skipped. `node --test src/pulse/catalog/proofs/read-proof-cases.test.mjs` — 3 passed, 0 failed, 0 skipped; its proof run executed all 57 green read rows.
- Safety: no live client, message, call, charge, provider send, production write, stage, commit, or push ran.
- Changed paths: `src/pulse/catalog/proofs/read-reviewed-e2e.test.mjs`, `src/pulse/catalog/proofs/read-second-pass-browser.test.mjs`, `src/pulse/catalog/proofs/read-proof-cases.mjs`, `src/pulse/coverage/gap-catalog-reads.mjs`, and this Read proof manifest section.
- Honest leftovers: 27 remain red. The six final-review returns are both Agent Editor reads, both affiliate gate chips, the Campaign fatigue label, and both can-launch values in the Connections result. The other 21 are listed in `gap-catalog-reads.mjs`. Every row names its exact missing real-page or real-module result.

### Integration and ship

Claimed by this session. Baseline six-lane built-bundle pulse passed as a safe runner: 0 skipped rows, 0 timeouts, 0 SQL errors, 0 writes, and 0 provider sends. It reported 1,879 red rows inside the selected lane output. The final folded report had 1,890 red rows because it also includes older company-health reds outside this catalog upgrade. Fresh review rejected 211 weak first-pass promotions. Final pre-rebuild gain is 24 strict result proofs: 11 Door and 13 Read. Honest catalog red count is expected to move from 1,762 to 1,738. Final catalog rebuild, full proof, and ship remain.

## Wave 3 — plug-in proof shards

Owner direction: keep going until every catalog row has real result proof. Each shard adds small row proof keys backed by one shared real runner. No test-name inference and no fake green.

| Shard | Scope | Status |
|---|---|---|
| Display AB | `desks-a.json`, `desks-b.json` red controls | pending |
| Display CD | `desks-c.json`, `desks-d.json` red controls | pending |
| Display EF/Public | `desks-e.json`, `desks-f.json`, `public-pages.json` red controls | pending |
| Door 01 | `routes-0.json`, `routes-1.json` red routes | pending |
| Door 23 | `routes-2.json`, `routes-3.json`, seven red jobs | pending |

Shard rule: create a disjoint proof-key module and its real result test. Do not edit the shared aggregator. Integration imports reviewed shards after all five return.

## Wave 3 and 4 strict result

- Fresh review accepted 30 Display AB, 32 Display CD, 44 Display EF/Public, 12 Flow/Read, 4 Door 01, and 8 Door 23 contracts.
- Second wave accepted 25 more Display AB, 23 more Display EF/Public, and 10 more Door 01 contracts.
- Seven second-wave Display claims were rejected and returned to red. The unfinished Display CD second shard failed its browser result and was removed.
- Plug-in wiring now overlays an exact row key only. A missing plug-in stays on the existing red monitor.
- Current honest red count before the catalog rebuild: Display 1,095; Door 323; Flow 121; Read 14; total 1,553.
- Total strict gain from the original 1,762 red rows: 209. This batch added 185 on top of the earlier 24.
- Focused green checks: AB wave 2 27/27; EF/Public wave 2 8/8; Door 01 wave 2 11/11; Display catalog guards 2/2; Door aggregate 989/989; Flow aggregate 9/9; Read executable proof run 2/3 with the metadata guard corrected and rerun green.
- The combined Display mega-run was stopped after its child launched every browser proof at once and did not exit. Individual browser shards and the exact catalog guards are green.
- Remaining 1,553 rows stay red. They were not renamed, hidden, or inferred green.
- Current strict batch is merged into GitHub `main` and live through the normal ship chain.

## Final post-merge check — 2026-10-12

- `main` matched `origin/main` at `2314782f6` before this note. The strict proof commits are in that history.
- Catalog rebuild: 3,942 unique rows; 3,919 mapped to an executable check; 23 are still unmapped/red.
- The catalog mapping count is not the business-result count. The safe built-bundle pulse is the honest result: 2,357 final rows, 465 green, 1,696 red, 189 verified nothing-to-judge, and 7 not checked.
- Safe runner proof: exit 0, no skipped selected rows, no step over 20 seconds, no SQL error, no write, and no provider send.
- Exact proof guards: Display 2/2 green and Door 989/989 green. Flow 8/9 green; its real rendered-page run passed, but one metadata guard still expects every 12-row shard entry to stay red while the rebuilt catalog now has mixed wired/red truth. Two small fixes did not model both states, so the stuck rule stopped a third try and the guard remains open.
- Lint: 3,403 files and inline scripts parse clean.
- Type check still has the known unrelated error at `src/marketing/filmed-receive.mjs:159`.
- Honest state: this proof batch is shipped. The company is not fully green. The 1,696 runtime reds remain the work list; they were not renamed, hidden, or counted as proven.

## Wave 5 — Sol lead with Luna proof workers

Owner said proceed on 2026-10-12. Sol owns shared files, final review, git, and ship. Luna workers may only add their named shard files. No worker may edit an aggregator, generated catalog, existing passing test, journey, live provider, or app code.

| Lane | Model | Exact scope | Status |
|---|---|---|---|
| Display AB3 | Luna Medium | exact result contracts for remaining `desks-a.json` and `desks-b.json` rows; new `display-contracts-ab-3.*` files only | done — 1 exact result |
| Display CD2 | Luna Medium | exact result contracts for remaining `desks-c.json` and `desks-d.json` rows; new `display-contracts-cd-2.*` files only | done — 1 exact result |
| Display EF/Public3 | Luna Medium | exact result contracts for remaining `desks-e.json`, `desks-f.json`, and `public-pages.json` rows; new `display-contracts-ef-public-3.*` files only | done — 1 exact result |
| Door/Flow/Read2 | Luna Medium | exact result contracts for remaining route, job, journey, message, agent, and read rows; new `door-flow-read-contracts-2.*` files only | done — 1 new Door result and 1 stronger existing Read result |
| Integration | Sol High | fresh review, exact-key imports, catalog rebuild, safe pulse, lint, type check, commit, push, live ship | claimed |

Budget fact: the account was 86% used when Wave 5 began. This wave checkpoints and ships honest gains before the remaining limit is exhausted.

### Wave 5 manifest

- Fresh Sol review rejected the all-groups sidebar claim and the mismatched health-label claim. They stay red.
- New honest green rows: sidebar burger; Commas/Whop/Open API connection actions; teleprompter Mirror/Turn; finance entity list plus business create, personal create, rename, and archive.
- The campaign fatigue row received a stronger rendered proof, but it was already counted green, so it is not counted as a new gain.
- Net strict gain: 4 rows. Display red moved from 1,095 to 1,092. Door red moved from 323 to 322. Flow stays 121. Read stays 14. Strict catalog total moved from 1,553 to 1,549.
- Focused tests: AB3 3/3, CD2 2/2, EF/Public3 1/1, Door/Flow/Read2 1/1. Display guard 2/2. Door aggregate 989/989. Read metadata guard 2/2.
- Catalog rebuild: 3,942 unique; 3,919 mapped/wired; 23 unmapped red. This map count is not the runtime result count.

## Wave 6 — focused low-risk UI groups

| Lane | Model | Exact scope | Status |
|---|---|---|---|
| Shared shells | Luna Medium | remaining controls on `sidebar.fragment.html`, staff `shell.js`, and public app `shell.js`; new `display-contracts-shells-1.*` only | done — 6 exact results |
| Teleprompter | Luna Medium | remaining `desks-f.json` teleprompter controls; new `display-contracts-teleprompter-4.*` only | done — 2 exact results |
| Money connections/plan | Luna Medium | remaining controls on `money-connections.html` and `money-plan.html`; new `display-contracts-money-2.*` only | done — 16 exact results |
| Teams/social | Luna Medium | remaining controls on `staff-teams.html` and `social-studio.html`; new `display-contracts-teams-social-1.*` only | done — 29 net-new exact results |
| Integration | Sol High | fresh review, imports, counts, focused tests, and checkpoint commit | done through local verification; ship pending |

Rule: real rendered action plus observed result only. Existing page loads, selectors, text, and fake green claims stay red.

### Wave 6 manifest

- Fresh Sol review sent back compound claims that proved only part of a row. The final Teams/Social shard removed three weak claims and added the missing actions and results for the accepted rows.
- New honest green rows: 53 unique Display rows. Shared shells added 6, teleprompter added 2, money connections/plan added 16, and Teams/Social added 29 net-new rows.
- Display red moved from 1,092 to 1,039. Door stays 322, Flow stays 121, and Read stays 14. Strict total moved from 1,549 to 1,496.
- Focused rendered-browser tests: 13 passed, 0 failed. Exact map and unmapped-red guards: 2 passed, 0 failed.
- Catalog rebuild: 3,942 unique; 3,919 mapped/wired; 23 unmapped red. The two deep social actions remain wired because their proof depth is deep, not page-load-only.
- The combined Display mega-run was stopped after its old `display-batch-staff-ui.test.mjs` child did not exit after six minutes. All four new shards and both exact catalog guards passed on their own.
- Safe selected-lane pulse built and ran without a live send or write. It reported 1,985 final rows: 465 green, 1,323 red, 189 verified nothing-to-judge, and 8 not checked. This selected-lane total is not directly comparable to the earlier 2,357-row full pulse.
- The pulse exit is red because `routes-2.json` now has 64 rows while the route monitor still expects 65. Per owner direction, this unrelated drift is recorded and was not fixed in this proof batch.
- Lint passed: 3,418 files and inline scripts parse clean.
- Type check still has the known unrelated error at `src/marketing/filmed-receive.mjs:159`; this batch did not touch that file.
