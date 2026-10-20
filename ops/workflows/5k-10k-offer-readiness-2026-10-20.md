# $5,000–$10,000 Capital Blueprint readiness — 2026-10-20

Owner: this Codex session. Scope: answer whether the offer works and what proof would establish readiness. Discovery and read-only checks only; no product changes, messages, payments, deployments, or customer writes.

## Work split and dependencies

Workflows A, B, and C run in parallel. Final verdict waits for their evidence. Existing local edits belong to other work and must be preserved.

### A — Offer and delivery promise

Prompt: Work in `/Users/chrisstanbridge/Developer/fundhub-platform`. Read AGENTS.md and CLAUDE.md section 0, `.agents/skills/fundhub-auditor/SKILL.md`, `.agents/skills/fundhub-system-map/SKILL.md`, and the referenced system map. Identify the canonical $5,000–$10,000 Capital Blueprint promises in intended journeys and finance specs. Trace the delivery workflow in current code. Read existing readiness evidence. Do not edit files or run actions that send messages, pull reports, charge money, or change customer data. Report the three strongest readiness gaps with exact file and line pointers; distinguish promise, implementation, and live proof. Send results to the parent agent; parent owns board updates.

### B — Payment, agreement, and entitlement

Prompt: Work in `/Users/chrisstanbridge/Developer/fundhub-platform`. Read AGENTS.md, CLAUDE.md section 0, `.agents/skills/fundhub-auditor/SKILL.md`, `.agents/skills/fundhub-system-map/SKILL.md`, and the referenced map. Read `ops/workflows/cortana-offer-ladder-2026-10-20.md` for prior evidence, then verify the current catalog, closer custom amount, agreement, Commas and Whop callback and entitlement paths for Capital Blueprint $5,000–$10,000. No edits, no outbound provider calls, no charges or customer writes. Report current confirmed code gaps and existing live proof with exact line pointers. Parent owns board updates.

### C — Proof and live-state review (parent)

Prompt: Work in `/Users/chrisstanbridge/Developer/fundhub-platform`. Read the audit and system-map skills and relevant intended journeys. Inspect canonical GitHub state and existing current evidence; use safe read-only live checks where useful. Determine which proofs exist for one buyer from exact-price agreement/payment through portal access, entitlement, monthly cycle, proof-gated coach, staff exceptions, and failure recovery. Do not create tests, change product code, deploy, send messages, pull credit, or move money. Gather agent findings here and answer with a concise verdict and one next action.

## Findings

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

## Build candidate and proof

Implemented price/provider controls, exact agreement price validation, a dedicated Whop purchase/access bridge with durable retry/reconciliation, shared AI/staff CRM context, cross-channel conversation history, tenant-scoped Bland transcripts and late enrichment. Draft migration485 changes only contract clauses1.1/5.1/6.1 to match the12-month system, distinct AI coach/human advisor and no automatic renewal charge. Previously sent/signed agreements stay untouched.

Independent review found and repaired wrong-provider-variant validation, guessed-org reversal attribution, missing Bland company attribution, and late transcripts lost behind event dedupe. Browser proof found and repaired the first agreement click lost on price blur, plus bounded phone history scrolling.

Local proof: pricing/service/contract/context suites passed in focused runs; 4/4 browser cases passed at1440/390 with six red-box/caption drafts. Full syntax lint and TypeScript passed. The two new real-Postgres tests skip locally because no scratch server exists; a local probe found no server and production DATABASE_URL was never used for tests.

Marked drafts: `ops/workflows/build-evidence/blueprint-price-context-2026-10-20/`.

External proof/activation: four local Whop billing config variables are absent (names only checked); real account/product/key/webhook configuration, financing eligibility and controlled payment/access proof are pending. No provider keys, webhooks, charge, credit pull, customer send or deployment was created. The monthly-refresh scheduler defect and live human CSM assignment remain unproved/open.

Shared-worktree leftovers (not changed by this offer job): registry/tripwire checks see concurrent untracked LNR report surfaces and existing branch push/preferences missing their entries. Final offer checks will run in a clean copy from canonical main to keep this task's source and proof isolated.

### Isolated integration

Copied only the65 named Blueprint repair/evidence files into the managed `blueprint-offer-core` worktree from canonical `origin/main`, branch `codex/blueprint-offer-core`. The original `codex/two-ios-apps-launch` working edits were preserved. Generated the manifest here with only migrations482/483/485; other chats'480/484 and their seed changes are excluded.

The isolated heartbeat, module registry, tripwire, route registry and RLS shape checks passed; the unrelated shared-working-copy failures are absent here. The integrated price/contract/Whop/context/Bland/payment-link focused tests passed. PostgreSQL proof still awaits CI. The new UI has four passing fixture-browser cases and six marked drafts; these are not live delivery proof.
