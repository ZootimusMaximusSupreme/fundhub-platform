# $5,000–$10,000 Capital Blueprint readiness — 2026-10-20

Owner: this Codex session. Current scope: the approved Blueprint build, required repairs, review and GitHub checks, plus the separately approved Whop key/server settings and disabled webhook setup. No merge, deployment, live SQL activation, customer sends/calls, credit pulls or money changes are included without their separate authority. The initial read-only discovery and successive owner-approved scopes below are retained as history; latest N/O/L evidence governs current build status.

## Work split and dependencies

Workflows A, B, and C run in parallel. Final verdict waits for their evidence. Existing local edits belong to other work and must be preserved.

### A — Offer and delivery promise

Prompt: Work in `/Users/chrisstanbridge/Developer/fundhub-platform`. Read AGENTS.md and CLAUDE.md section 0, `.agents/skills/fundhub-auditor/SKILL.md`, `.agents/skills/fundhub-system-map/SKILL.md`, and the referenced system map. Identify the canonical $5,000–$10,000 Capital Blueprint promises in intended journeys and finance specs. Trace the delivery workflow in current code. Read existing readiness evidence. Do not edit files or run actions that send messages, pull reports, charge money, or change customer data. Report the three strongest readiness gaps with exact file and line pointers; distinguish promise, implementation, and live proof. Send results to the parent agent; parent owns board updates.

### B — Payment, agreement, and entitlement

Prompt: Work in `/Users/chrisstanbridge/Developer/fundhub-platform`. Read AGENTS.md, CLAUDE.md section 0, `.agents/skills/fundhub-auditor/SKILL.md`, `.agents/skills/fundhub-system-map/SKILL.md`, and the referenced map. Read `ops/workflows/cortana-offer-ladder-2026-10-20.md` for prior evidence, then verify the current catalog, closer custom amount, agreement, Commas and Whop callback and entitlement paths for Capital Blueprint $5,000–$10,000. No edits, no outbound provider calls, no charges or customer writes. Report current confirmed code gaps and existing live proof with exact line pointers. Parent owns board updates.

### C — Proof and live-state review (parent)

Prompt: Work in `/Users/chrisstanbridge/Developer/fundhub-platform`. Read the audit and system-map skills and relevant intended journeys. Inspect canonical GitHub state and existing current evidence; use safe read-only live checks where useful. Determine which proofs exist for one buyer from exact-price agreement/payment through portal access, entitlement, monthly cycle, proof-gated coach, staff exceptions, and failure recovery. Do not create tests, change product code, deploy, send messages, pull credit, or move money. Gather agent findings here and answer with a concise verdict and one next action.

## Initial read-only findings — 2026-10-20 09:22 UTC (historical)

Verdict: **NOT READY for the complete $5,000–$10,000 offer.** This is discovery, not a full live buyer test. No payment, message, customer write, credit pull, release, or new test was performed.

Canonical state checked: GitHub main `f78f6b8b95ab4651b1553d942b0e4c8462a5c839` (remote API read). Cited catalog, closer service/API, agreement migration, payment/merchant handlers and monthly-cycle code match `origin/main`; existing unrelated local edits were preserved.

### A — Promised delivery vs current code

Promise: `docs/finance/capital-blueprint-build-spec-2026-09-29.md:12` describes 12 months, monthly soft pulls, proof-gated accountability, a CSM, FinanceOS, credit partner, next funding sequence and welcome kit. `docs/journeys/client-intended.md` describes access doors, not the complete Blueprint event order. A full offer sequence cannot be scored PASS from that document alone.

Core purchase provisioning exists in code: checklist, CSM assignment, included FinanceOS and kit task. That is implementation evidence, not proof that a buyer received all delivery.

Advisor assignment is not guaranteed to reach real staff: `src/blueprint/assign-csm.mjs:15-27,57-58` accepts an active demo CSM and returns `no_active_csm` when no active CSM exists. The recorded September proof used a demo CSM (`ops/workflows/capital-blueprint-build-2026-09-29.md:85-99`). A controlled buyer must prove a real assignment, received exception task and follow-up.

Confirmed monthly-cycle defect: `src/finance/finance-os-entitlement.mjs:99-111` gives the included subscription a 12-month period; `src/subscriptions/store.mjs:298-310` stores those dates; `src/workflows/finance-os-pull-sweeper.mjs:55-62` allows one system request per subscription period. Thus the included year permits one request, not the promised monthly cycle. The fulfillment path also defaults to simulation unless explicitly enabled (`src/finance/finance-os-pull-fulfil.mjs:10-17`). Production flag state was not freshly read in this review.

Do not reuse stale claims that bank linking is absent: runtime now has Plaid link/refresh paths. Its live customer success was not proved here.

### B — Price, agreement and payments

1. Variable price missing: `src/config/offers.mjs:160-162` has a $5,000 default, $1,000 floor, $5,000 ceiling. `src/sales/closer-deck.mjs:683-724` sends `offer.priceCents`; `api/closer-deck.mjs:78-87` accepts no custom amount. The agreement source still hardcodes $5,000 at `db/migrations/288_real_contract_text.sql:251,265`. The live stored contract text was not freshly read.
2. Whop financing is not connected to a Fundhub Blueprint purchase and entitlement. Existing Whop processing is for a client's merchant ledger (`src/merchant/webhooks.mjs:1-4,55-62`).
3. Missing-callback recovery is incomplete: `src/payments/commas-api.mjs:122-182` defines reconciliation, but the read-only trace found no runtime caller. A reliable purchase needs a recoverable receipt even when its first callback is lost.

Prior same-day read-only evidence is in `ops/workflows/cortana-offer-ladder-2026-10-20.md:45-59,938-951`: historical $5,000 successes exist, but no fresh complete $5,000–$10,000 buyer proof, no $10,000 stored result, no live Whop purchase/fulfillment proof. Those aggregates were not re-queried in this review.

History may include simulations (`ops/workflows/cortana-offer-ladder-2026-10-20.md:122-125`); a stored success alone does not prove a real charge. Also, `public/app/present.js:1766` reports agreement and link sent while `sendDeckPayLink` only creates/sends the payment link (`src/sales/closer-deck.mjs:683-773`). Agreement delivery requires separate proof.

### C — Fresh live read and required proof

Live `GET https://fundhub.ai/api/health` returned `ok:true`, `db:up`, `pending:0`, checkedAt `2026-10-20T09:22:38.584Z`. This proves availability only.

Acceptance proof after the named gaps are repaired:

- Exact amount is preserved through closer selection, agreement, checkout, provider receipt and local order. Cover $5,000, one middle price and $10,000, plus refused amounts outside the range.
- Commas and Whop confirmations each create exactly one correct purchase and entitlement; duplicate, delayed and missing callbacks recover without a double grant or missed buyer. Failed payments do not grant access. Refund/dispute records reconcile correctly without a real refund unless separately authorized.
- One controlled buyer reaches a usable sign-in, correct portal, promised files, checklist, real assigned CSM, included FinanceOS and kit fulfillment record. Match receipts to saved rows and customer-visible results.
- A monthly-cycle test proves a second eligible refresh during the included year, a real provider result under authorized conditions, updated plan/letters, proof-to-clear and staff escalation. Time advancement belongs in safe test data, not production subscription changes.
- Monitoring detects a paid buyer missing access or delivery and proves an alert reaches the operator. A green catalog, unit suite or health endpoint is insufficient.

Next action: repair the price/agreement, financing, monthly-cycle and recovery gaps, then run the controlled buyer acceptance path. A live charge, credit pull, customer send or publish remains a separate explicit action; none was attempted by this review.

## Owner follow-up — implementation scope

Owner requested: payment link variable $5,000–$10,000; repair financing-to-Blueprint access; explain the monthly refresh defect; distinguish AI advisors from real advisors; confirm CSM assignment and offer details. "Bingman" provider name is awaiting clarification; previous provider was Whop. Interpret "CSM = visor" as CSM is the assigned advisor, pending any correction. No monthly-cycle product change is inferred from a request to clarify it. No production publish, charge, credit pull, customer send or live staff reassignment is authorized by this section.

### D — Variable pricing implementation

Prompt: Work in `/Users/chrisstanbridge/Developer/fundhub-platform`, branch `codex/two-ios-apps-launch`. Read AGENTS.md, CLAUDE.md section 0, fixer/builder skills, this board, relevant intended journeys and pricing specs. Implement only the named closer Capital Blueprint variable payment link from $5,000 through $10,000 in whole dollars, using one server-validated amount, default $5,000, with the same Consulting Services Package product. Own `src/config/offers.mjs`, `src/sales/closer-deck.mjs`, `api/closer-deck.mjs`, `public/app/present.js` and focused tests for those files. Preserve existing edits; do not edit agreements, migrations, docs, financing routes or board. Inspect agreement flow and report how to preserve exact-price agreement consistency to parent. Tests must prove boundaries, custom amount propagation and unchanged other offers. No live sends, provider session mint, charge, publish, commit or push. Parent integrates and handles GitHub. Report files and tests.

### E — Financing bridge implementation preparation

Prompt: Work in `/Users/chrisstanbridge/Developer/fundhub-platform`, branch `codex/two-ios-apps-launch`. Read AGENTS.md, CLAUDE.md, fixer/builder skills, this board and same-day Cortana offer-ladder board. Parent is clarifying whether "Bingman" means Whop. Until clarified, do read-only preparation: identify exact existing order/payment/entitlement contracts and safe smallest new financing bridge that feeds canonical purchase flow; official provider API details only. Own no existing files shared with Workflow D, money-chain or route registry; propose precise files/tests and external prerequisites to parent before edits. Do not send customer data, create provider keys/webhooks, applications, checkout sessions, charges or production changes. Parent owns board, shared handlers/registry, docs, final proof and GitHub.

### F — Offer details and roles (parent)

Confirm current owner-set 12-month package and post-year fee status from source docs. Explain annual-period bug in plain words. Keep AI coach/AI advisor separate from human CSM advisor. Inspect current assignment read-only; do not invent a staff assignment or change live rows. Resolve exact agreement amount as needed for variable-price coherence. Join verification and reviewable GitHub changes.

## Owner additions — AI accountability and CRM integration

Whop was confirmed by owner reply. Owner then named the AI Advisor Core: durable progress/accountability data, SMS and Bland reminders, context preserved across conversations, Blueprint contract creation, and the same data on closer dashboard and Present. Reuse the CRM's client/waypoint/message/call/task/contract stores and `fetchContext`; do not add a competing database.

Ground truth before implementation: `docs/journeys/capital-blueprint-intended.md`, CB-01 through CB-10. The owner directly supplied the price, roles, communication, contract and CRM integration requirements. The documented monthly-cycle defect remains open; no live pull activation is inferred.

Builder plan: role is closer (customer advisor context read is staff-scoped); one job is see and act on the same Blueprint file in dashboard and Present. First question is what this client needs next. Reuse existing deck, contract sender, payment-link route, event bus, checklist and context fetcher. Data is saved CRM state plus provider-specific signed payment receipts. Files are Workflow D/E lists plus `src/contracts/send.mjs`, `api/contracts.mjs`, `public/app/contract-send.js`, migration483, shared payment-link/router/workflow/pulse integration, and the exact AI/context consumer files named after discovery. Risk is wrong price, wrong access or lost conversation; boundary, signature/replay, saved-context and rendered-page assertions must prove each. No new dependency.

## Initial build candidate and proof — 2026-10-20, before G/H (historical)

Implemented price/provider controls, exact agreement price validation, a dedicated Whop purchase/access bridge with durable retry/reconciliation, shared AI/staff CRM context, cross-channel conversation history, tenant-scoped Bland transcripts and late enrichment. Draft migration485 changes only contract clauses1.1/5.1/6.1 to match the12-month system, distinct AI coach/human advisor and no automatic renewal charge. Previously sent/signed agreements stay untouched.

Independent review found and repaired wrong-provider-variant validation, guessed-org reversal attribution, missing Bland company attribution, and late transcripts lost behind event dedupe. Browser proof found and repaired the first agreement click lost on price blur, plus bounded phone history scrolling.

Local proof: pricing/service/contract/context suites passed in focused runs; 4/4 browser cases passed at1440/390 with six red-box/caption drafts. Full syntax lint and TypeScript passed. The two new real-Postgres tests skip locally because no scratch server exists; a local probe found no server and production DATABASE_URL was never used for tests.

Marked drafts: `ops/workflows/build-evidence/blueprint-price-context-2026-10-20/`.

External proof/activation: four local Whop billing config variables are absent (names only checked); real account/product/key/webhook configuration, financing eligibility and controlled payment/access proof are pending. No provider keys, webhooks, charge, credit pull, customer send or deployment was created. The monthly-refresh scheduler defect and live human CSM assignment remain unproved/open.

Shared-worktree leftovers (not changed by this offer job): registry/tripwire checks see concurrent untracked LNR report surfaces and existing branch push/preferences missing their entries. Final offer checks will run in a clean copy from canonical main to keep this task's source and proof isolated.

### Isolated integration

Copied only the65 named Blueprint repair/evidence files into the managed `blueprint-offer-core` worktree from canonical `origin/main`, branch `codex/blueprint-offer-core`. The original `codex/two-ios-apps-launch` working edits were preserved. Generated the manifest here with only migrations482/483/485; other chats'480/484 and their seed changes are excluded.

The isolated heartbeat, module registry, tripwire, route registry and RLS shape checks passed; the unrelated shared-working-copy failures are absent here. The integrated price/contract/Whop/context/Bland/payment-link focused tests passed. PostgreSQL proof still awaits CI. The new UI has four passing fixture-browser cases and six marked drafts; these are not live delivery proof.

## Finish-today scope — owner request

Owner requested all Blueprint agents and delivery completed today for tomorrow's launch (2026-10-21 Arizona), plus one-at-a-time offer questions. This supersedes the earlier clarification-only limit on the monthly-cycle repair. Reuse existing agents, CRM and workflows; "all agents" means the named Blueprint accountability and delivery chain, not unrelated Fundhub products. Production publishing, real charges, credit pulls, customer sends, credential creation and staff reassignment retain their existing action gates. Pending owner question: same 12-month package at closer-selected price, or different services at higher prices?

All work below runs in `/Users/chrisstanbridge/.codex/worktrees/blueprint-offer-core/fundhub-platform`, branch `codex/blueprint-offer-core`, PR83. Do not edit the original dirty `codex/two-ios-apps-launch` checkout. Parent owns this board, joins changes, commits/pushes, and final launch proof. Workflows G/H/I run together; final proof waits for their checks.

Owner answer: same 12-month package at all allowed prices; closer chooses price. No extra service tiers. Next question: stop after included year unless separately renewed, or paid monthly continuation (price still to be set)? Existing no-invented-charge guard stays.

Owner answer: no automatic renewal or charge after12months; separate client agreement required to renew. Owner requested API access, then corrected naming and instructed checking the existing Cortana/other-chat work first. New Whop key form was canceled without creation; prior pending key-approval prompt is withdrawn. Existing provider product is exactly `Consulting Services Package` (`prod_liEP35ZzcsAOi` in Fhconsulting); do not create a duplicate or use the rejected improvised billing name.

Cross-chat boundary checked: `Find Cortana linking requirements` (`01a15866-babc-7032-ad16-012790734a8b`) owns Cortana browser/native Commas linking and per-round fee invoice work; current board `ops/workflows/funding-fee-invoices-cortana-2026-10-20.md`. That chat already renamed the Whop product, explicitly left keys/webhooks unchanged, and is working on Cortana's existing Commas source. This chat owns variable Blueprint payment/access and its agents. Do not duplicate Cortana payment sources or copy the other chat's unfinished root changes into PR83.

Fresh read-only live inventory: existing AG-01..AG-09 and named FOS-01/VF/DOC agents were inspected; no Blueprint/coach identity exists. FOS-01 FinanceOS Money Helper is shadow with a5148-character prompt and must be inspected before adding a competing coach identity. One active non-demo CSM exists; demo staff also exists and must never count as assigned human proof. No customer/staff writes were performed.

### G — AI accountability runtime (payment_path)

Prompt: In the clean worktree above, read AGENTS.md, builder/fixer/system-map skills and Blueprint intended journey. Finish the owner-named Blueprint AI accountability chain using existing persisted tasks, agent registry, SMS runtime, Bland dispatcher and shared fetchContext. Discover exact missing prompt/action/scheduling pieces before changing them. Own Blueprint coach runtime/prompt/action files and focused tests only; do not edit monthly pull, CSM assignment, Whop, payment, contract, shared context, registry or workflow index files without coordinating exact edits with parent. Send parent a file plan immediately, then implement named gaps and focused proof. No new dependency, no provider call, live message/call, prompt activation or deployment. No commit/push; parent integrates. Preserve all existing edits. Report working vs unproved and any owner-only product decision.

### H — Monthly delivery and human advisor (offer_delivery)

Prompt: In the clean worktree above, read AGENTS.md, fixer/builder/system-map and database skills, Blueprint intended journey and finance specs. Repair the named monthly-refresh defect so a 12-month included entitlement allows monthly requests, not one request per year; preserve consent, entitlement, proof, provider and cost gates. Make the existing CSM picker exclude demo/disabled staff and preserve an observable exception when no real advisor is available. Own finance-os-pull-sweeper and its focused tests, finance entitlement helper only if required, assign-csm and focused tests. Send parent exact file plan immediately. No schema, contract, coach, provider flag or production data change without coordination. Use safe unit/scratch tests only; no real credit pull, staff reassignment, customer send or deployment. Parent owns board/commit/push.

### I — Payment proof and CI (financing_bridge)

Prompt: In the clean worktree above, read AGENTS.md and this board. Own Whop payment proof and required CI repair: inspect PR83 CI and resolve failures attributable to this candidate, especially real-Postgres Whop and Bland webhook fixtures that now require verified dispatch attribution. Read actual schema and keep assertions strong. Own new Whop PG tests and existing webhook PG fixtures; coordinate before changing shared implementation or files owned by G/H. Prepare exact real Whop activation prerequisites without creating keys/webhooks or moving money. No production DB tests, provider writes, messages, credentials, deployment, commit or push. Parent owns live browser setup and board. Report exact tests and remaining external proof.

### J — Integration and offer decisions (parent)

Own offer questions, intended/actual truth, shared workflow/heartbeat wiring, exact-price agreement, complete required checks, marked UI review, GitHub PR83, and action-gated live activation/proof. Draft PR83 contains commit8cfbe91 and is not deployed. Resolve dependencies from G/H/I, keep failed proof visible, and continue safe authorized work until only genuine owner/external gates remain.

### K — Reviewable agent/template registration (offer_delivery after H)

Prompt: In the clean Blueprint worktree, read current agent registry/schema, coach prompt/helper/nudge modules and this board. Migration488 is reserved for this chat;486/487 belong to the invoice/Cortana chat. Create `db/migrations/488_blueprint_coach_agents.sql` and focused source/PG tests as needed to register BP-COACH (Capital Blueprint AI Coach, sms_email, internal runtime) and BP-COACH-VOICE (Capital Blueprint AI Coach — Voice, voice, bland) as DRAFT ONLY in the Fundhub org. Use stable uppercase code/name separation and keep FOS-01 unchanged. Include substantive reviewable AI-not-human/current-saved-step/proof-only/12month/noautorenew prompts, existing structured guardrails and no provider IDs invented. Add exact reminder keys from coach-nudge with `{{coach.reminder}}`, email subject, correct channel, and compliance_passed=false. ON CONFLICT DO NOTHING preserves existing owner definitions/status/approvals. No live SQL, activation, provider call, message, credentials or deployment. Parent owns manifest, board, commit/push and activation/proof. Report source tests and schema compatibility.

G scope extended to runtime/select, existing nudge run adapter, voice context and safe local-only coach PG tests. Independent review found false model completion claims, unsent nudge-rung consumption and SMS-only email eligibility; G repaired these with adversarial/recovery/race tests. Real PG execution awaits CI. H repaired30-day refresh, real advisor assignment and aftercare failure propagation;170focused tests passed and3PG checks were honestly skipped locally. H also added two scoped aggregate Blueprint delivery/advisor monitor checks; parent integrates module list. New keys still not created: correct-name approval received, then browser action held for explicit refund-change/dispute-read scope approval. That two-scope question is pending; no workaround used.

### Integration handoff — 2026-10-20 10:31 UTC

Parent delegated clean-branch integration, commit/push and required CI repair to financing_bridge while completing the separately approved Whop server setup. No merge, deploy, live database or credential work is part of this lane. G's files are frozen after17/17 fixture-browser cases and1/1 nested bound proof. K's migration488 registers draft-only agents and unapproved reminder templates; existing owner rows and FOS-01 are unchanged.

Independent review rechecked all three coach findings. Free model wording was replaced with a closed four-intent schema and server-owned questions/results, including a fresh saved-step read after evidence verification. Preclaim eligibility, known-unsent claim release and actual channel compatibility preserve the existing nudge cadence. No new P1 remains in that reviewed path.

Local integration proof: lint4038 files/inline scripts clean; TypeScript exit0;205focused tests passed and13safe scratch-database tests skipped (not database proof). Route/module/RLS-shape/heartbeat/fence/diagram checks passed apart from an explicit Whop workflow-name pin, repaired and rerun13/13. The manifest now lists372migrations including488. Source diagrams regenerated. Two Blueprint deep checks are being connected to the real advisor queue and monthly pull job with a minimal read-only hourly beat. The coverage catalog must be regenerated after that beat is registered. Fixture browser proof requiring a local server is rerun with localhost permission after the default sandbox refused listen; no failed assertion was removed.

Canonical `origin/main` was refreshed to2111e0424 (PR82 Team/Social fixes). Its changed files do not overlap this integration's source or migration manifest. This branch remains unmerged; no main-branch or production write was made. Live financing checkout/access, provider refresh, customer delivery and operator alert receipt remain separate observable proof gates.

Parent subsequently completed explicit per-action approved provider setup: the key is named exactly `Consulting Services Package`, with7narrow permissions (checkout Read/Create, plans Read/Create, payments Read, refund changes Read, disputes Read). `WHOP_API_KEY`, `WHOP_ACCOUNT_ID`, `WHOP_CONSULTING_PACKAGE_PRODUCT_ID` and `WHOP_WEBHOOK_SECRET` were saved to production Functions only. The new v1 billing webhook has payment.succeeded/payment.failed/payment.canceled/refund.created/refund.updated/dispute.created and remains **DISABLED** per approval. Parent retained action screenshots separately; no local credential file, checkout, charge, customer receipt or deploy was created. Remaining gates: GitHub proof, deployment approval, provider financing eligibility and the controlled customer payment/access path.

Final pre-push integration: both hourly beats are registered; route/module/RLS-shape/heartbeat/fence/diagram/workflow pins and beat guards pass121/121. The coverage catalog is regenerated and its freshness check passes. Present fixture checks pass38/38 after granting the localhost permission their test servers require. No assertions were weakened. The broader nested browser proof is still running and is not reported as passed. Database skips remain unproved locally; the next GitHub run must execute them.

Provider setup PNGs were copied unchanged to the local ignored folder `ops/workflows/build-evidence/blueprint-provider-setup-2026-10-20/`: `whop-production-settings-saved.png` (four setting names, no values) and `whop-disabled-webhook-created.png` (disabled status, six events and masked provider secrets). The tool approval guard refused committing these originals because masked secret/configuration fragments would persist on GitHub without explicit disclosure approval. They remain local and are excluded from this commit; the names-only setup record above is the repository evidence. Whop's global payment-method screen lists ClarityPay and3/6/12-month card installments with a$10,000maximum; that does not prove this buyer/product is finance-eligible. Automatic coach calls have not been scheduled; their cadence remains an owner choice.

### L — Joined verification and GitHub (financing_bridge after review)

Prompt: In clean Blueprint worktree/PR83 only, independently confirm the structural closed-intent coach reply fix. Integrate existing Blueprint monitor tripwires/hourly coverage as required, regenerate migration manifest and diagrams from source, update Blueprint actual/changelog/this board truthfully, run required checks, and commit/push only this task's clean-branch edits. Coordinate G's final Present browser-fixture repair and K's migration488 before staging. Follow CI to required checks; repair failures without weakening assertions. No merge, deployment, production SQL, credentials, customer messages or provider writes. Parent owns Whop server/browser setup and owner action gates. Do not touch original dirty checkout.

Whop action update: owner explicitly approved all7scopes and exact key name `Consulting Services Package`. Key created successfully in Fhconsulting and saved directly to Fundhub Netlify project `5905dba4-9942-480c-a510-813a3fe2b073` as secret `WHOP_API_KEY`, Functions scope, production context only. No local credential file was created: that temporary storage attempt was rejected and the approved server UI was used instead. Existing product remains unchanged. All four server settings are saved and the signed billing webhook is created but remains disabled, as recorded above. No checkout, charge or live customer event has been sent.

### L continuation — final GitHub checks (finish_blueprint_ci)

Prompt: Resume only the approved Blueprint integration in `/Users/chrisstanbridge/.codex/worktrees/blueprint-offer-core/fundhub-platform`, branch `codex/blueprint-offer-core`, PR83. Read this board and required repair/system-map instructions. Verify the completed commit and push it only to its existing branch, then follow required GitHub checks including real scratch-Postgres tests. Diagnose and repair required check failures with the smallest scoped diff; never weaken, skip or delete assertions. Commit and push scoped repairs, and record exact run links and results here. No merge, deploy, production database, credentials, live messages/calls, credit pulls or money. Provider setup PNGs remain local ignored files and must not be uploaded. Do not touch the original dirty checkout. Parent owns launch and all owner-only decisions. This lane can run alongside the parent's launch review; live release proof depends on the final checks.

Current evidence: clean source commit `45db38d4145c520b8fed8778c64d2a97361d4742` was pushed successfully to GitHub on the existing PR83 branch. Its required [GitHub test run39414546347](https://github.com/ZootimusMaximusSupreme/fundhub-platform/actions/runs/39414546347) is queued. Old run39404034078 failed at the previous commit and is not evidence for this new head. No merge or deployment was performed.

Parent's fresh production flag read confirmed `CRS_ALLOW_LIVE=1`, `FINANCE_OS_SYSTEM_PULL_LIVE=unset`, `ADAPTERS_DRY_RUN=0` and `MESSAGING_DRY_RUN=0`. The monthly system-pull source requires both live flags explicitly on, so current monthly provider execution remains simulated. This is a live activation/proof gate, not a completed paid-provider refresh. No flag was changed.

New-head CI remains red while checks continue: [no-database shard1](https://github.com/ZootimusMaximusSupreme/fundhub-platform/actions/runs/39414546347/job/118600251237) passed4636 tests and failed one stale SQL-shape assertion in `src/http/finance-os-suggestions.test.mjs`. It expected the old entitlement query without the newly required paid-period start/end bounds. The assertion now requires the full stronger predicate, including both period bounds; no condition was removed. Local focused suggestions/entitlement tests pass17/17. Remaining required jobs are still running or queued, so no final green claim is made.

Completed scratch-Postgres evidence at45db38d41: all13 new `.pg` cases executed and passed:4coach actual writes/claim race/stale-proof/task replay,3monthly/advisor/saved-result delivery cases,4Whop canonical exact-price/inbox cases and2verified Bland transcript/unknown-dispatch cases. The full [PG blocking job](https://github.com/ZootimusMaximusSupreme/fundhub-platform/actions/runs/39414546347/job/118600250736) remains **RED**:4065pass,2fail,4skipped. Its two failures are the registry's old23total/21draft inventory pins after migration488 adds two draft coaches. Local assertions now require25total/23draft, preserve the two-live-agent list, and explicitly verify both draft Blueprint identities/channels. No local database proof is claimed for that repair.

Other required fixture repairs are ready for the joined push: the saved SQL-template inventory was regenerated to145keys, retaining the three new templates as unapproved (freshness1/1); the noncoach call fixture now supplies the same scoped client context the real call path reads, and retired-runtime fixtures answer the separate scoped BP-COACH lookup as absent (9/9focused tests pass). Contract send-lock proof now waits for its held draft request before pressing the stable disabled button, avoiding the template-lookup render race while adding an explicit no-extra-draft assertion (8/8browser checks pass). Lint4040andTypeScriptpassed before the new N/O edits. No check was weakened. Final commit/push waits for N/O join as directed.

Two more actual scratch-DB proofs passed in [real-PG unit shard5](https://github.com/ZootimusMaximusSupreme/fundhub-platform/actions/runs/39414546347/job/118600251553): migration488 executes against migrated constraints, scopes to Fundhub and replays without overwriting owner changes; Blueprint monitor SQL catches demo/disabled/cross-org advisors and unresolved delivery. That job passed4808tests with0failures/0skips. These are real scratch database checks, not live production delivery or a green overall run.

The complete [real-browser job](https://github.com/ZootimusMaximusSupreme/fundhub-platform/actions/runs/39414546347/job/118600251125) at45db38d41completed successfully:1697passed,3skipped,0failed. The old-head run is still red on the fixture failures above and one real-PG unit shard is still running. New N/O source is not covered by that completed browser job and must join the next checked candidate.

### L2 — Contract send-lock proof repair (finish_blueprint_ci)

Prompt: Work only in the clean Blueprint worktree `/Users/chrisstanbridge/.codex/worktrees/blueprint-offer-core/fundhub-platform`. Read the existing intended Blueprint journey and fixer instructions. Required GitHub run39414546347 real-Postgres unit shard3 failed one nested browser proof: `src/pulse/catalog/proofs/fin-b23-present-send-lock.test.mjs:243`, second click resolved disabled `Sending…` button but reported not visible. Own only this proof file; inspect the real Present contract interaction and diagnose the deterministic cause. Make the smallest justified repair that retains the locked-send, exact chosen-offer agreement and repeat-count assertions; do not weaken or skip assertions or hide the failure with reruns. Run this proof with localhost permission if needed and report exact evidence. Do not edit app source without coordinating a named defect, or change the board, commit/push, deploy, database, provider or customer state. Parent finishes CI and GitHub. This can run in parallel with the ongoing required checks and suggestions assertion repair; final push waits for both.

### Owner addition — agentic text and automatic calls

Owner approved automatic coach calls after two unanswered SMS reminders, then requested text workflows and call flows completed now as agentic communication. This settles the earlier cadence question; do not ask it again. No live activation, call, send, credit pull, payment or go-live authority is inferred.

Builder plan: role is a paid Blueprint client; one job is context-aware follow-through across SMS replies and calls; first question is "What do I need to do next?" Reuse CRM `fetchContext`, coach/nudge, dispatch/Bland, existing claims and the hourly sweeper. Data is saved paid access, current step, SMS receipts, inbound replies and ready voice-agent state. Files are the N/O scopes below plus parent's intended/actual/changelog and migration488 prompt if required; pulse tripwire/beat changes only when required. Risks are false proof, duplicate calls and stale escalation. Prove adversarial claims, exact sent counts and reply reset, atomic claim/recovery, real Postgres and focused tests. No new UI, dependency or delivery activation. Final commit waits for N/O join.

### N — Agentic text workflow (agentic_text)

Prompt: In the clean Blueprint worktree, read the current Blueprint intended/actual journeys, this board, builder/fixer and relevant agent instructions. Finish the owner-approved agentic text accountability workflow using saved CRM context, real current-step/proof state, structured coach actions, existing outbox and contact protections. Own `src/blueprint/coach.mjs`, `coach-prompt.mjs`, `coach-nudge.mjs`, affected agent runtime logic and their focused tests. Preserve server-owned truthful outcomes and proof-only completion; do not restore unrestricted model claims. Coordinate shared interfaces with the automatic-call workflow and parent before editing other owners' files. No new provider credentials, live SQL, agent/template activation, message/call, charge or deployment. Parent owns docs, migration prompt, monitoring, integration, board and GitHub. Run alongside O and L; final integration waits for all proofs.

### O — Agentic automatic call workflow (agentic_calls)

Prompt: In the clean Blueprint worktree, read the current Blueprint intended/actual journeys, this board, builder/fixer and relevant voice instructions. Build the approved automatic Bland coach escalation after two unanswered SMS reminders, reusing existing dispatch attribution, saved context, ready voice-agent gates, contact/quiet-hours rules and dedupe/retry machinery. Own the new Blueprint coach-call module plus `src/nudge/run.mjs` integration and focused tests. Coordinate reminder-state interface with N and parent before shared edits. Prove no call before two unanswered texts, answered/progressed/closed/expired clients are not called, and duplicate runs do not duplicate a call. No live call, provider write, credential, SQL activation, message, payment or deployment. Parent owns docs, migration prompt, monitoring, integration, board and GitHub. Run alongside N and L; final push waits for the joined candidate.

O scope was extended by parent to reserved migration489 and its real-Postgres constraint proof: extend the existing waypoint ledger with a Blueprint-only step5voice-call receipt, not a new timer/rung. Legacy `STEPS`/`FINAL_STEP=4` remain unchanged. Reuse atomic daily/destination uniqueness rather than a check-then-claim race. Parent verified489is unreserved by other chats and owns the final373migration manifest. Never copy other chat migrations486/487from the original dirty checkout. L regenerates the SQL-template inventory after parent's final488prompt sync.

Parent synced migration488's SMS prompt to N's current exported definition (6source checks passed,1scratch-PG check skipped locally). Parent also added a third `coach-call-delivery` deep/hourly check to the existing Blueprint monitor/beat and covered the existing waypoint job, removing only its corresponding now-covered baseline entry (11focused checks passed,1scratch-PG check skipped locally). The check reads Blueprint step5voice-call claims, accepted message/verified dispatch receipts and open call exceptions; it does not dial. L owns final manifest/catalog/inventory generation once O489is ready. Parent's provider key-name read found Bland API/webhook and model keys present but redacted; redaction is not proof that a secret is invalid. No provider key or flag was changed.

O froze the489/call module/unit/PG files after84joined local tests passed with3scratch-PG skips; its TypeScript check exited0. Parent owns the final nudge loop and reviewed gates. Generation completed:373migrations,145SQL-template keys,3942unique/wired catalog entries, and current source diagrams. A required fence guard caught the new caller's `globalThis.fetch` default; parent removed that caller default so the existing model adapter owns it, without adding an exemption (27text/workflow/fence checks passed). Parent is repairing a separately reviewed pre-model/stale-context inbound race before final freeze; do not treat this candidate as fully checked or push it before that joins.

Parent's inbound freshness repair passed20runtime/durable-workflow checks: explicit live model mode, bounded planner call and fresh paid access/scope/step/advisor/assignment/opt-out/DND before actions and replies, with fresh context after successful writes. The hourly nudge runner now uses the actual delivery clock and drops stale planned rungs. Independent review requested one last pre-dial phone/time-zone reread; O owns that narrow repair and proof. Final joined lint, TypeScript and route/module/RLS/heartbeat/fence/workflow guards have started; commit still waits for review clear.

Final local joined checks:150focused tests passed with0failures/9scratch-DB skips,90source guard assertions passed (the live RLS-catalog suite is not local DB proof),13catalog compiler checks passed and SQL-template freshness passed. Full lint parsed4043files/inline scripts clean. Parent's last acknowledgement/runtime repair also passed its final12runtime checks plus a direct final syntax check; final TypeScript refresh exited0 and the nested flow-proof aggregate is still running. O's final phone/zone reread repair passed16call-unit checks with3scratch-PG cases still skipped locally. Independent review cleared the frozen source below. No live delivery result is inferred.

Independent final review is closed on the frozen source: no remaining concrete P1/P2 finding;107tests across9files passed with0failures/2local scratch-PG skips, including reproduced quiet-clock, inbound freshness, phone freshness and acknowledgement races. Parent authorized the scoped joined commit/push to PR83. No merge, deployment or activation is authorized. The new489three-case PG proof and third call-delivery monitor SQL must execute in the fresh required scratch-CI run; local skips remain unproved.

Joined source is saved in commit `8445dbbe8` (33scoped files, no provider PNGs). The final TypeScript refresh exited0. The previously failing nested flow-proof aggregate now passes15/15with0skips, including all its mapped local/fake-data child proofs. Final required GitHub checks on this joined candidate are still pending; source/local proof is not deployment or live customer proof.

### Owner release decision — conditional on final checks

Owner replied "get it all done" to the exact conditional approval: after the final required checks pass, deploy PR83 and activate the text/voice coaches and reminder templates for eligible paid Blueprint clients. This includes real texts and Bland calls. The Whop billing webhook and monthly live credit-pull setting stay OFF. Parent owns release/activation; L owns CI and must not merge, deploy or activate. Approval does not make pending checks pass or prove live customer delivery.

### P — Activation preflight (parent, read-only until green)

Prompt: In the approved Blueprint worktree and accessible production configuration, prepare the parent's release/activation plan while L follows PR83's exact final-head checks. Read the intended/actual Blueprint journey, current migration/coach/template definitions and this board. Verify existing production identities, agent/template states, required provider-setting names and current safety flags without exposing secrets. Confirm no owner-edited definition would be overwritten, eligibility targets only paid active Blueprint clients, and required real human advisor handling remains honest. Keep Whop's billing webhook and monthly live pull OFF. Do not merge, deploy, apply live SQL, promote agents/templates or send/call while any final required check is pending/red. Parent alone may carry out the already approved release/activation after all required checks pass; L only reports exact CI evidence and required repairs. No duplicate product/key/webhook creation or cross-chat Cortana/payment-source changes.

### M — Remaining offer decisions (remaining_offer_decisions, read-only)

Prompt: Review the approved Blueprint owner requests against `docs/journeys/capital-blueprint-intended.md`, `capital-blueprint-actual.md` and this board in the clean Blueprint worktree. Distinguish genuinely unbuilt automatic Bland call scheduling from implemented but inactive agents, reminders, payments and delivery. Return at most three unanswered owner decisions; do not reopen the settled same-package price range,12-month term, no-auto-renewal or provider naming. Read-only: no file edits, external writes, activation, sends, calls, payments or production changes. Parent owns the final questions. Run alongside Workflow L and the parent's readiness check; the final answer waits for the evidence to join.

Decision review at M, before the owner's N/O addition: the clear unbuilt requested piece was automatic Bland coach-call scheduling. The existing staff-started AI call path was built; no automatic cadence was assumed. Parent then asked whether calls should start after two unanswered text reminders or only when staff starts one. That question was subsequently answered in the owner addition below and is settled. The actual human advisor identity still needs the owner's decision. Other CB-01 through CB-10 behavior is implemented candidate code, not live customer proof.
