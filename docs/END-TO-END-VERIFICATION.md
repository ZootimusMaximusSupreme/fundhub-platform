# End-to-End Verification Report

Generated: 2026-11-01T03:31:46.984Z
Run id: verify-1793503896133
Node: v22.23.2
DATABASE_URL: 127.0.0.1/fundhub_verify_scratch_final2
Stance: skeptical operator / business architect. Prefer SILENTLY-DID-NOTHING and UNVERIFIED over a false pass.

## Operator headline

No FAIL/SILENT/P0 among collected assertions in this local synthetic run. UNVERIFIED rows and live provider paths remain unproven.
1 local synthetic journey verdict FAIL; see §7.

Re-run: `DATABASE_URL=... npm run verify:e2e` (Playwright UI + data-layer). Data only: `node src/verification/run-all.mjs`.

## Collected assertion tallies

Journey verdicts are separate from these assertion counts; see §7.

| Status | Count |
|---|---:|
| PASS | 489 |
| FAIL | 0 |
| SILENTLY-DID-NOTHING | 0 |
| UNVERIFIED | 107 |
| SKIP | 0 |
| **Total** | **596** |
| P0 non-passes | 0 |

## 1. SECURITY (read this first)

No P0 isolation failures recorded in this run. That is not a claim that none exist — only that the attempts below did not succeed.

### Isolation attempts

| Status | Role | Claim | Detail | File |
|---|---|---|---|---|
| PASS | sales_manager | sales_manager is in FINANCE |  | src/http/read-api.mjs |
| PASS | sales_manager | sales_manager is NOT in HIRING |  | src/http/read-api.mjs |
| PASS | closer | closer is NOT in HIRING (applicant PII) |  | src/http/read-api.mjs |
| PASS | closer | closer is NOT in OPS |  | src/http/read-api.mjs |
| PASS | owner | owner may access commissions |  |  |
| PASS | owner | owner may access invoices |  |  |
| PASS | owner | owner may access staff |  |  |
| PASS | owner | owner may access failed-events |  |  |
| PASS | owner | owner may access hiring |  |  |
| PASS | owner | owner may access hiring-write |  |  |
| PASS | owner | owner may access client-dashboard |  |  |
| PASS | owner | owner may access documents |  |  |
| PASS | owner | owner may access tradelines |  |  |
| PASS | owner | owner cannot read other org client (404) |  |  |
| PASS | owner | owner org_id/role query spoof does not elevate (200) |  |  |
| PASS | admin | admin may access commissions |  |  |
| PASS | admin | admin may access invoices |  |  |
| PASS | admin | admin may access staff |  |  |
| PASS | admin | admin may access failed-events |  |  |
| PASS | admin | admin may access hiring |  |  |
| PASS | admin | admin may access hiring-write |  |  |
| PASS | admin | admin may access client-dashboard |  |  |
| PASS | admin | admin may access documents |  |  |
| PASS | admin | admin may access tradelines |  |  |
| PASS | admin | admin cannot read other org client (404) |  |  |
| PASS | admin | admin org_id/role query spoof does not elevate (200) |  |  |
| PASS | sales_manager | sales_manager may access commissions |  |  |
| PASS | sales_manager | sales_manager may access invoices |  |  |
| PASS | sales_manager | sales_manager may access staff |  |  |
| PASS | sales_manager | sales_manager refused failed-events (403) |  |  |
| PASS | sales_manager | sales_manager refused hiring (403) |  |  |
| PASS | sales_manager | sales_manager refused hiring-write (403) |  |  |
| PASS | sales_manager | sales_manager may access client-dashboard |  |  |
| PASS | sales_manager | sales_manager may access documents |  |  |
| PASS | sales_manager | sales_manager may access tradelines |  |  |
| PASS | sales_manager | sales_manager cannot read other org client (404) |  |  |
| PASS | sales_manager | sales_manager org_id/role query spoof does not elevate (200) |  |  |
| PASS | funding_advisor | funding_advisor refused commissions (403) |  |  |
| PASS | funding_advisor | funding_advisor refused invoices (403) |  |  |
| PASS | funding_advisor | funding_advisor refused staff (403) |  |  |
| PASS | funding_advisor | funding_advisor refused failed-events (403) |  |  |
| PASS | funding_advisor | funding_advisor refused hiring (403) |  |  |
| PASS | funding_advisor | funding_advisor refused hiring-write (403) |  |  |
| PASS | funding_advisor | funding_advisor may access client-dashboard |  |  |
| PASS | funding_advisor | funding_advisor may access documents |  |  |
| PASS | funding_advisor | funding_advisor may access tradelines |  |  |
| PASS | funding_advisor | funding_advisor cannot read other org client (404) |  |  |
| PASS | funding_advisor | funding_advisor org_id/role query spoof does not elevate (403) |  |  |
| PASS | closer | closer refused commissions (403) |  |  |
| PASS | closer | closer refused invoices (403) |  |  |
| PASS | closer | closer refused staff (403) |  |  |
| PASS | closer | closer refused failed-events (403) |  |  |
| PASS | closer | closer refused hiring (403) |  |  |
| PASS | closer | closer refused hiring-write (403) |  |  |
| PASS | closer | closer may access client-dashboard |  |  |
| PASS | closer | closer may access documents |  |  |
| PASS | closer | closer may access tradelines |  |  |
| PASS | closer | closer cannot read other org client (404) |  |  |
| PASS | closer | closer org_id/role query spoof does not elevate (403) |  |  |
| PASS | inquiry_specialist | inquiry_specialist refused commissions (403) |  |  |
| PASS | inquiry_specialist | inquiry_specialist refused invoices (403) |  |  |
| PASS | inquiry_specialist | inquiry_specialist refused staff (403) |  |  |
| PASS | inquiry_specialist | inquiry_specialist refused failed-events (403) |  |  |
| PASS | inquiry_specialist | inquiry_specialist refused hiring (403) |  |  |
| PASS | inquiry_specialist | inquiry_specialist refused hiring-write (403) |  |  |
| PASS | inquiry_specialist | inquiry_specialist may access client-dashboard |  |  |
| PASS | inquiry_specialist | inquiry_specialist may access documents |  |  |
| PASS | inquiry_specialist | inquiry_specialist may access tradelines |  |  |
| PASS | inquiry_specialist | inquiry_specialist cannot read other org client (404) |  |  |
| PASS | inquiry_specialist | inquiry_specialist org_id/role query spoof does not elevate (403) |  |  |
| PASS | setter | setter refused commissions (403) |  |  |
| PASS | setter | setter refused invoices (403) |  |  |
| PASS | setter | setter refused staff (403) |  |  |
| PASS | setter | setter refused failed-events (403) |  |  |
| PASS | setter | setter refused hiring (403) |  |  |
| PASS | setter | setter refused hiring-write (403) |  |  |
| PASS | setter | setter may access client-dashboard |  |  |
| PASS | setter | setter may access documents |  |  |
| PASS | setter | setter may access tradelines |  |  |
| PASS | setter | setter cannot read other org client (404) |  |  |
| PASS | setter | setter org_id/role query spoof does not elevate (403) |  |  |
| PASS | closer | Closer refused hiring endpoint (403) |  |  |
| PASS | forged | Forged bearer token is refused |  | src/auth/session.mjs |
| PASS | closer | Session endpoint responds to auth probes (status 401) | Full revoke/expiry matrix also covered by src/auth/*.pg.test.mjs |  |
| PASS | closer | Closer brain access tiers exclude owner; owner includes owner |  | src/company-brain/access.mjs |
| PASS | closer | Closer brain SQL filter excludes owner-tier chunks; owner can see them |  | src/company-brain/retrieve.mjs |
| PASS | closer | Company Brain live retrieve is credential-gated (OPENAI_API_KEY); tier gate verified above | status=401 error=unauthorized | src/company-brain/embed.mjs |
| PASS | affiliate | Affiliate refused internal client (403) |  |  |
| UNVERIFIED | funding_advisor | Proxy session credential isolation between advisors | status=401 |  |
| PASS | sales_manager | sales_manager direct-URL to hiring.html: static HTML may load; API isolation enforced server-side | Static files cannot enforce role. Verified via pg security journey ROLE_SET probes. | public/app/hiring.html |
| PASS | sales_manager | sales_manager direct-URL to ops-admin.html: static HTML may load; API isolation enforced server-side | Static files cannot enforce role. Verified via pg security journey ROLE_SET probes. | public/app/ops-admin.html |
| PASS | closer | closer direct-URL to hiring.html: static HTML may load; API isolation enforced server-side | Static files cannot enforce role. Verified via pg security journey ROLE_SET probes. | public/app/hiring.html |
| PASS | closer | closer direct-URL to ops-admin.html: static HTML may load; API isolation enforced server-side | Static files cannot enforce role. Verified via pg security journey ROLE_SET probes. | public/app/ops-admin.html |
| PASS | closer | closer direct-URL to finance-os.html: static HTML may load; API isolation enforced server-side | Static files cannot enforce role. Verified via pg security journey ROLE_SET probes. | public/app/finance-os.html |
| PASS | funding_advisor | funding_advisor direct-URL to hiring.html: static HTML may load; API isolation enforced server-side | Static files cannot enforce role. Verified via pg security journey ROLE_SET probes. | public/app/hiring.html |
| PASS | funding_advisor | funding_advisor direct-URL to ops-admin.html: static HTML may load; API isolation enforced server-side | Static files cannot enforce role. Verified via pg security journey ROLE_SET probes. | public/app/ops-admin.html |
| PASS | inquiry_specialist | inquiry_specialist direct-URL to hiring.html: static HTML may load; API isolation enforced server-side | Static files cannot enforce role. Verified via pg security journey ROLE_SET probes. | public/app/hiring.html |
| PASS | inquiry_specialist | inquiry_specialist direct-URL to ops-admin.html: static HTML may load; API isolation enforced server-side | Static files cannot enforce role. Verified via pg security journey ROLE_SET probes. | public/app/ops-admin.html |
| PASS | inquiry_specialist | inquiry_specialist direct-URL to products-commissions.html: static HTML may load; API isolation enforced server-side | Static files cannot enforce role. Verified via pg security journey ROLE_SET probes. | public/app/products-commissions.html |
| PASS | setter | setter direct-URL to hiring.html: static HTML may load; API isolation enforced server-side | Static files cannot enforce role. Verified via pg security journey ROLE_SET probes. | public/app/hiring.html |
| PASS | setter | setter direct-URL to ops-admin.html: static HTML may load; API isolation enforced server-side | Static files cannot enforce role. Verified via pg security journey ROLE_SET probes. | public/app/ops-admin.html |
| PASS | setter | setter direct-URL to finance-os.html: static HTML may load; API isolation enforced server-side | Static files cannot enforce role. Verified via pg security journey ROLE_SET probes. | public/app/finance-os.html |
| PASS | affiliate | affiliate direct-URL to pipeline.html: static HTML may load; API isolation enforced server-side | Static files cannot enforce role. Verified via pg security journey ROLE_SET probes. | public/app/pipeline.html |
| PASS | affiliate | affiliate direct-URL to finance-os.html: static HTML may load; API isolation enforced server-side | Static files cannot enforce role. Verified via pg security journey ROLE_SET probes. | public/app/finance-os.html |
| PASS | affiliate | affiliate direct-URL to hiring.html: static HTML may load; API isolation enforced server-side | Static files cannot enforce role. Verified via pg security journey ROLE_SET probes. | public/app/hiring.html |
| PASS | affiliate | affiliate direct-URL to ops-admin.html: static HTML may load; API isolation enforced server-side | Static files cannot enforce role. Verified via pg security journey ROLE_SET probes. | public/app/ops-admin.html |
| PASS | affiliate | affiliate direct-URL to client-control-panel.html: static HTML may load; API isolation enforced server-side | Static files cannot enforce role. Verified via pg security journey ROLE_SET probes. | public/app/client-control-panel.html |
| PASS | partner | partner direct-URL to pipeline.html: static HTML may load; API isolation enforced server-side | Static files cannot enforce role. Verified via pg security journey ROLE_SET probes. | public/app/pipeline.html |
| PASS | partner | partner direct-URL to finance-os.html: static HTML may load; API isolation enforced server-side | Static files cannot enforce role. Verified via pg security journey ROLE_SET probes. | public/app/finance-os.html |
| PASS | partner | partner direct-URL to hiring.html: static HTML may load; API isolation enforced server-side | Static files cannot enforce role. Verified via pg security journey ROLE_SET probes. | public/app/hiring.html |
| PASS | closer | Closer direct-URL to owner screens triggers 403 on gated APIs | denied=8 allowed=22 | e2e/verification-security.spec.mjs |
| PASS | owner | Owner can open ops-admin without console death |  | public/app/ops-admin.html |

## 2. SILENTLY-DID-NOTHING (hunt results)

Code ran. No error. Nothing useful persisted — or the write was empty/zero.
These are more dangerous than hard failures because nothing alerts.

_None recorded in this run._

## 3. Journey accounts (persisted values)

### A. Funding path

**Local synthetic journey: PASS**

Primary client (lead): c4f54ba9-25dc-482b-bd21-65d9893d0904 / e2e_verify.funding.1793503896155@verify.local
Simulated funding client: 3e8c5f0f-b0a5-44e5-9b8d-e7c0a0b556ab / sim+1793503896219@demo.fundhub.local
Sale amount: 3000.00 (want 3000)
Closer front commission: 600.00 (want 600)
Advisor back commission: 125.00 (want 125)
Closeout fee: 5000.00 (want 5000)
The CRM link: dry-ghl-c4f54ba925dc
Contract: 5a8252ef-bdd8-4d01-b7c3-ac7374793fa2
Messages queued: 5

Operator verdict: YES for the money spine; still check the CRM link, contract send, and live webhooks separately.

| Step | Status | Persisted |
|---|---|---|
| Lead captured → client row | PASS | client.id=c4f54ba9-25dc-482b-bd21-65d9893d0904 email=e2e_verify.funding.1793503896155@verify.local |
| The CRM linkage | PASS | dry-ghl-c4f54ba925dc |
| Booking → closer task | PASS | task.id=5e5fb0cb-d88e-44fa-9090-5dac88f4f52c title=Setter: confirm booked strategy call |
| Consent captured | PASS | kind=soft_pull_consent id=dedd37ec-1748-4ce8-8991-b6e0e9199978 |
| CRS → tradelines | PASS | funding_client_tls=4 sim_tls=4 ingested=4 |
| Pipeline card | PASS | card=7eb0ecd3-6f7e-4e18-8468-0fd39b62f8d6 stage=new_lead |
| Sale + $600 closer commission + entitlement | PASS | sales=2 front=600.00 ents=credit-analysis-report,funding-snapshot |
| Contract | PASS | id=5a8252ef-bdd8-4d01-b7c3-ac7374793fa2 status=sent hash=sha256:1d38ea1e754b589534e596992b63d670b5c74b75b2acafda1535a9590d28ca60 |
| Round funded + closeout 10% | PASS | fee=5000.00 balance_due=5000.00 basis=50000.00 |
| Messages queued | PASS | total=5 queued=5 keys=EMAIL-DOC-01-REQUEST,SMS-DOC-01-REQUEST,SMS-ROUND-STARTED-NOTIFY,EMAIL-F07-FUNDING-LOCKED,SMS-F07-FUNDING-LOCKED |

### B. Credit-repair / DIY downsell

**Local synthetic journey: PASS**

Client 17ce4e11-547d-4f17-98c7-e9f324905110
DIY sale: 1000.00
Entitlements: metro2-letter-pack,credit-optimization-roadmap
Ledger rows: 0
Messages: 1
Operator verdict: YES for sale/entitlement separation; letter delivery still vendor-gated.

| Step | Status | Persisted |
|---|---|---|
| DIY sale (not funding) | PASS | diy=1 funding=0 price=1000.00 |
| Letters / delivery message | PASS | EMAIL-DS02-DIY-LETTERS-READY/queued |

### C. Inquiry removal

**Local synthetic journey: PASS**

Inquiry 4db4f194-12fc-45e7-84ae-7c58b1674c72; case 44c7eef2-9ada-4d6f-9b59-de2376529ca8
call_state machine: 11 states exercised
Status bleed on call_state: no
Operator verdict: YES for status separation; real Bland voice still credential-gated.

| Step | Status | Persisted |
|---|---|---|
| Inquiry logged | PASS | id=4db4f194-12fc-45e7-84ae-7c58b1674c72 status=open call_state=not_started |
| Case created | PASS | case=44c7eef2-9ada-4d6f-9b59-de2376529ca8 |
| All 11 call_states without status bleed | PASS | status remained open |
| cleared → inquiry.removed → C-03 | PASS | {"done":true,"branch":"inquiry_done"} |

### D. Agent runtime

**Local synthetic journey: FAIL**

Agents in org: draft=AG-04 shadow=FOS-01 live=VF-LIVE
handleInbound result: {"ok":true,"reason":"no_api_key","agent":"VF-LIVE","shadowed":true,"wouldSend":"[SHADOW — no API key] Model was not called. Inbound: Hi, what are my next steps?"}
Shadow logs: 2; agent outbound: 0
Operator verdict: NO for live client conversations — runtime has never sent a real reply; without ANTHROPIC_API_KEY it shadows. Do not put a client on an agent today.

| Step | Status | Persisted |
|---|---|---|
| Inbound → select → shadow/no-send | PASS | result={"ok":true,"reason":"no_api_key","agent":"VF-LIVE","shadowed":true,"wouldSend":"[SHADOW — no API key] Model was not called. Inbound: Hi, what are my next steps?"} shadows=2 outbound=0 |
| STOP halt | PASS | {"ok":true,"reason":"stop_word","halted":true,"agent":"VF-LIVE"} |

### E. Idempotency, replay, ordering

**Local synthetic journey: PASS**

Operator verdict: YES for double-fire / replay / concurrency on deposit.paid.

| Step | Status | Persisted |
|---|---|---|
| Double deposit.paid | PASS | sales=1 ledger=1 ents=1 |
| Out-of-order round.funded | PASS | no round invented |
| Concurrent identical deposit.paid | PASS | sales=1 |

### F. Negative / adversarial

**Local synthetic journey: PARTIAL / UNVERIFIED**

Adapter signatures fail-closed for commas/clickfunnels in-process. Full webhook HTTP path still depends on Netlify function wiring (see AUDIT-FINDINGS on plain-object req).

| Step | Status | Persisted |
|---|---|---|
| Bad amounts | PASS | salesDelta=0 |
| Signatures / opt-out / unicode / amounts | PASS | see assertions |

### G. Workflow engine

**Local synthetic journey: PASS**

Registered workflows: 106
Reacted: 62
Errored: none
Never invoked this run: 44
Canonical events with no workflow listener: survey.submitted, booking.rescheduled, booking.cancelled, setter.no_answer, decision.rendered, sale.closed, file.finalized, payment.failed, payment.expired, payment.canceled, payment.refunded, payment.disputed, inquiry.gate.raised, inquiry.gate.clear, inquiry.docs.needed, letter.generated, message.queued, message.sent, message.failed, message.blocked, commission.earned, commission.approved, commission.paid, invoice.created, invoice.partially_paid, invoice.paid, invoice.voided, contract.sent, contract.signed, repair.enrolled, repair.docs.needed, repair.docs.complete, repair.analysis.complete, repair.analysis.empty, repair.letters.ready, repair.letters.sent, repair.letters.delivered, repair.response.received, repair.response.parsed, repair.parse.low_confidence, repair.response.retake, repair.item.deleted, repair.item.verified, repair.item.updated, repair.item.unaddressed, repair.round.complete, repair.round.escalated, repair.program.complete, repair.stalled, repair.cancelled, partner.approved, diy.package.requested, diy.package.generating, diy.package.ready, diy.package.delivered, diy.package.downloaded, subscription.started, subscription.renewed, subscription.past_due, subscription.canceled, subscription.completed
Operator note: Inngest does not schedule anything without INNGEST_EVENT_KEY. This run invokes handles directly.

| Step | Status | Persisted |
|---|---|---|
| Drive workflows from canonical events | PASS | reacted=62 errored=0 never=44 orphanEvents=61 |

### PART 3 — Security & isolation

**Local synthetic journey: PASS**

Victim client 3fd0bddd-387a-4f84-ba06-d5fe3a2ae609 in org 8e50816e-c8ae-41fa-ac55-cd9f1d3871e2
Other-org client ccd22073-a272-4979-a9d1-7b9a12925403
Document id: none
Attacker stance: direct URL/API, id swap, org_id spoof, forged token, affiliate reach.

| Step | Status | Persisted |
|---|---|---|
| Role matrix + cross-org + spoof + brain + affiliate | PASS | see SECURITY assertions |

### PART 4 — Cross-cutting

**Local synthetic journey: PASS**

Workflow keys: 102
Missing rows: none
DRAFT keys (blocked by hard guard; rewrite before live send): none
Template table: {"total":181,"drafts":0,"compliant":169}
Canonical orphans (no emit site found): none
Hand-calcs: closer $600 / back $undefined / fee $5000 / hourly $6.25

| Step | Status | Persisted |
|---|---|---|
| Workflow template keys → DB rows | PASS | keys=102 missing=0 drafts=0 |
| Canonical event emit sites | PASS | emitted=82 orphans=0:  |

## 4. Full assertion table

| Status | Section | Journey | Role | Claim | File:line |
|---|---|---|---|---|---|
| PASS | DATA | FUNDING | system | ClickFunnels/entry.captured created a clients row | src/adapters/clickfunnels.mjs |
| PASS | DATA | FUNDING | system | S-01 tagged client lead:new | src/workflows/s-01-new-lead-intake.mjs |
| PASS | DATA | FUNDING | system | Client has ghl_contact_id linkage | src/handlers/client-lifecycle.mjs |
| PASS | DATA | FUNDING | system | Booking created a closer task | src/adapters/clickfunnels.mjs |
| PASS | DATA | FUNDING | system | Soft-pull consent persisted | src/consent/index.mjs |
| PASS | DATA | FUNDING | system | Finance OS loadSimulatedClient created a demo client | src/demo/simulate-client.mjs:103 |
| PASS | DATA | FUNDING | system | CRS ingest stored tradelines for funding client | src/demo/simulate-client.mjs |
| PASS | DATA | FUNDING | system | Tradeline creditorName survived ingest on the Chase account | src/tradelines/store.mjs |
| PASS | DATA | FUNDING | system | Bureau field creditorName accepted by ingest (tradelines written: 4) | src/tradelines/index.mjs |
| PASS | DATA | FUNDING | system | Bureau field currentBalanceAmount accepted by ingest (tradelines written: 4) | src/tradelines/index.mjs |
| PASS | DATA | FUNDING | system | Bureau field creditLimitAmount accepted by ingest (tradelines written: 4) | src/tradelines/index.mjs |
| PASS | DATA | FUNDING | system | Bureau field accountOpenedDate accepted by ingest (tradelines written: 4) | src/tradelines/index.mjs |
| PASS | DATA | FUNDING | system | Bureau field accountIdentifier accepted by ingest (tradelines written: 4) | src/tradelines/index.mjs |
| PASS | DATA | FUNDING | system | Bureau field accountReportedDate accepted by ingest (tradelines written: 4) | src/tradelines/index.mjs |
| PASS | DATA | FUNDING | system | Bureau field accountStatusType accepted by ingest (tradelines written: 4) | src/tradelines/index.mjs |
| PASS | DATA | FUNDING | system | Outcome tier FULL_FUNDING stamped on client | src/demo/simulate-client.mjs |
| PASS | DATA | FUNDING | system | Sales pipeline card exists for simulated funding client | src/demo/simulate-client.mjs |
| PASS | DATA | FUNDING | system | deposit.paid wrote a funding sale | src/handlers/money-chain.mjs |
| PASS | DATA | FUNDING | system | Funding sale agreed_price is $3000 (hand-check) | src/handlers/money-chain.mjs |
| PASS | DATA | FUNDING | system | Closer front-end commission is $600 (20% of collected deposit) | src/handlers/money-chain.mjs |
| PASS | DATA | FUNDING | system | Funding entitlement funding-snapshot granted | src/handlers/money-chain.mjs |
| PASS | DATA | FUNDING | system | Payment link row created | src/payment-links/index.mjs |
| PASS | DATA | FUNDING | system | Contract row persisted | src/contracts/send.mjs |
| PASS | DATA | FUNDING | system | round.started created funding_rounds row | src/handlers/money-chain.mjs |
| PASS | DATA | FUNDING | system | Approved application row exists for the round | api/applications.mjs |
| PASS | DATA | FUNDING | system | Application status change wrote an audit/decision row | src/applications/status.mjs |
| PASS | DATA | FUNDING | system | Round status is funded with amount 50000 | src/handlers/money-chain.mjs |
| PASS | DATA | FUNDING | system | Advisor back-end commission is $125 (50000 × 0.25% hand-calc) | src/handlers/money-chain.mjs |
| PASS | DATA | FUNDING | system | Closer earns no back-end commission on funded amount | src/handlers/money-chain.mjs |
| PASS | DATA | FUNDING | system | Closeout total_fee is $5000 (10% of the $50000 confirmed approvals) | src/funding/closeout.mjs |
| PASS | DATA | FUNDING | system | Closeout balance_due equals total_fee | src/funding/closeout.mjs |
| PASS | DATA | FUNDING | system | Success-fee invoice row exists | src/workflows/f-07-funding-locked.mjs |
| PASS | DATA | FUNDING | system | Messages queued along funding path (5) | src/workflows/messaging.mjs |
| PASS | DATA | FUNDING | system | Template EMAIL-DOC-01-REQUEST resolves to a real non-DRAFT row |  |
| PASS | DATA | FUNDING | system | Template SMS-DOC-01-REQUEST resolves to a real non-DRAFT row |  |
| PASS | DATA | FUNDING | system | Template SMS-ROUND-STARTED-NOTIFY resolves to a real non-DRAFT row |  |
| PASS | DATA | FUNDING | system | Template EMAIL-F07-FUNDING-LOCKED resolves to a real non-DRAFT row |  |
| PASS | DATA | FUNDING | system | Template SMS-F07-FUNDING-LOCKED resolves to a real non-DRAFT row |  |
| PASS | DATA | FUNDING | system | Replay does not duplicate sales | src/events/bus.mjs |
| PASS | DATA | FUNDING | system | Replay does not duplicate commission_ledger | src/events/bus.mjs |
| PASS | DATA | DIY_DOWNSELL | system | DIY path wrote its OWN consulting-package sale | src/handlers/money-chain.mjs |
| PASS | DATA | DIY_DOWNSELL | system | DIY path did NOT write a funding (card-stacking-dfy) sale | src/handlers/money-chain.mjs |
| PASS | DATA | DIY_DOWNSELL | system | DIY entitlement metro2-letter-pack granted (not funding-snapshot) | src/handlers/money-chain.mjs |
| PASS | DATA | DIY_DOWNSELL | system | DIY letters path queued a DIY-keyed message |  |
| PASS | DATA | INQUIRY_REMOVAL | inquiry_specialist | Inquiry logged with business status=open and call_state=not_started |  |
| PASS | DATA | INQUIRY_REMOVAL | inquiry_specialist | Inquiry removal case created |  |
| PASS | DATA | INQUIRY_REMOVAL | inquiry_specialist | call_state=not_started leaves business status=open |  |
| PASS | DATA | INQUIRY_REMOVAL | inquiry_specialist | call_state=queued leaves business status=open |  |
| PASS | DATA | INQUIRY_REMOVAL | inquiry_specialist | call_state=dialing leaves business status=open |  |
| PASS | DATA | INQUIRY_REMOVAL | inquiry_specialist | call_state=navigating_ivr leaves business status=open |  |
| PASS | DATA | INQUIRY_REMOVAL | inquiry_specialist | call_state=on_hold leaves business status=open |  |
| PASS | DATA | INQUIRY_REMOVAL | inquiry_specialist | call_state=talking_to_rep leaves business status=open |  |
| PASS | DATA | INQUIRY_REMOVAL | inquiry_specialist | call_state=transferred_to_human leaves business status=open |  |
| PASS | DATA | INQUIRY_REMOVAL | inquiry_specialist | call_state=completed leaves business status=open |  |
| PASS | DATA | INQUIRY_REMOVAL | inquiry_specialist | call_state=failed leaves business status=open |  |
| PASS | DATA | INQUIRY_REMOVAL | inquiry_specialist | call_state=canceled leaves business status=open |  |
| PASS | DATA | INQUIRY_REMOVAL | inquiry_specialist | call_state=retry_scheduled leaves business status=open |  |
| PASS | DATA | INQUIRY_REMOVAL | inquiry_specialist | Business status cleared only when explicitly set | api/inquiries.mjs |
| PASS | DATA | INQUIRY_REMOVAL | inquiry_specialist | C-03 reacted to inquiry.removed |  |
| PASS | DATA | AGENT_RUNTIME | system | ANTHROPIC_API_KEY unset so runtime stays in shadow/model-dry mode | src/agents/runtime.mjs |
| PASS | DATA | AGENT_RUNTIME | system | With ANTHROPIC_API_KEY unset, agent runtime sent nothing | src/agents/runtime.mjs |
| PASS | DATA | AGENT_RUNTIME | system | Shadow mode logged the intended reply | src/agents/shadow-log.mjs |
| PASS | DATA | AGENT_RUNTIME | system | status=draft agents do nothing (or no live agent selected) | src/agents/runtime.mjs:95 |
| PASS | DATA | AGENT_RUNTIME | system | STOP word halts agent reply (no helpful outbound) | src/agents/guardrails.mjs |
| PASS | DATA | IDEMPOTENCY | system | Identical deposit.paid twice → exactly one sale | src/handlers/money-chain.mjs |
| PASS | DATA | IDEMPOTENCY | system | Identical deposit.paid twice → one front-end ledger row | src/handlers/money-chain.mjs |
| PASS | DATA | IDEMPOTENCY | system | Full bus replay does not duplicate sales | src/events/bus.mjs |
| PASS | DATA | IDEMPOTENCY | system | round.funded before round.started did not invent a funded round | src/handlers/money-chain.mjs |
| PASS | DATA | IDEMPOTENCY | system | Two concurrent identical deposit.paid → one sale | src/handlers/money-chain.mjs |
| PASS | DATA | ADVERSARIAL | attacker | clickfunnels refuses invalid signature | src/adapters/clickfunnels.mjs |
| PASS | DATA | ADVERSARIAL | attacker | clickfunnels accepts valid HMAC | src/adapters/clickfunnels.mjs |
| PASS | DATA | ADVERSARIAL | attacker | commas refuses invalid signature | src/adapters/commas.mjs |
| PASS | DATA | ADVERSARIAL | attacker | commas accepts valid HMAC | src/adapters/commas.mjs |
| PASS | DATA | ADVERSARIAL | attacker | Zero-amount deposit did not create a sale (or no client) |  |
| PASS | DATA | ADVERSARIAL | attacker | Opt-out recorded and isOptedOut returns true | src/lib/opt-out.mjs |
| PASS | DATA | ADVERSARIAL | attacker | Unicode/emoji/quotes name persists without injection error | src/handlers/client-lifecycle.mjs |
| PASS | DATA | ADVERSARIAL | attacker | entry.captured without email fail-closed or created intentionally (no throw) | src/handlers/client-lifecycle.mjs |
| PASS | DATA | ADVERSARIAL | attacker | Expired payment link status is expired | src/payment-links/index.mjs |
| PASS | DATA | ADVERSARIAL | attacker | booking.cancelled emits without throwing | src/events/canonical.mjs |
| PASS | DATA | ADVERSARIAL | attacker | payment.failed emits without creating a sale | src/handlers/money-chain.mjs |
| PASS | DATA | ADVERSARIAL | attacker | String amount coerced safely to 3000 or refused |  |
| PASS | DATA | ADVERSARIAL | attacker | Sent contract has a valid saved integrity anchor before attack | src/contracts/sign.mjs |
| PASS | DATA | ADVERSARIAL | attacker | Database refuses changes to sent contract wording | src/contracts/sign.mjs |
| PASS | DATA | ADVERSARIAL | attacker | Saved wording stays unchanged after refused tamper | src/contracts/sign.mjs |
| PASS | DATA | ADVERSARIAL | attacker | Altered contract wording fails integrity against the saved checksum | src/contracts/sign.mjs |
| UNVERIFIED | DATA | ADVERSARIAL | attacker | Quiet-hours message holds then releases |  |
| PASS | DATA | WORKFLOWS | system | Every registered workflow has a unique nonempty ID | src/workflows/index.mjs |
| PASS | DATA | WORKFLOWS | system | Every registered workflow has an invokable handler | src/workflows/index.mjs |
| PASS | DATA | WORKFLOWS | system | Required workflow s-01-new-lead-intake is registered once with its event | src/workflows/index.mjs |
| PASS | DATA | WORKFLOWS | system | Required workflow s-04-call-booked is registered once with its event | src/workflows/index.mjs |
| PASS | DATA | WORKFLOWS | system | Required workflow c-00-crs-soft-pull-request is registered once with its event | src/workflows/index.mjs |
| PASS | DATA | WORKFLOWS | system | Required workflow c-06-crs-results-router is registered once with its event | src/workflows/index.mjs |
| PASS | DATA | WORKFLOWS | system | Required workflow f-01-funding-intake is registered once with its event | src/workflows/index.mjs |
| PASS | DATA | WORKFLOWS | system | Required workflow f-07-funding-locked is registered once with its event | src/workflows/index.mjs |
| PASS | DATA | WORKFLOWS | system | Required workflow contract-chaser is registered once with its cron | src/workflows/index.mjs |
| PASS | DATA | WORKFLOWS | system | Required workflow message-dispatch-sweeper is registered once with its cron | src/workflows/index.mjs |
| PASS | DATA | WORKFLOWS | system | Required workflow daily-pulse is registered once with its cron | src/workflows/index.mjs |
| PASS | DATA | WORKFLOWS | system | Required workflow evening-brief is registered once with its cron | src/workflows/index.mjs |
| PASS | DATA | WORKFLOWS | system | Required workflow bank-outreach-checkins is registered once with its cron | src/workflows/index.mjs |
| PASS | DATA | WORKFLOWS | system | Workflow af-02-referral-ownership-capture reacted to entry.captured |  |
| PASS | DATA | WORKFLOWS | system | Workflow at-01-first-touch-capture reacted to entry.captured |  |
| PASS | DATA | WORKFLOWS | system | Workflow s-01-new-lead-intake reacted to entry.captured |  |
| PASS | DATA | WORKFLOWS | system | Workflow s-00-welcome reacted to entry.captured |  |
| PASS | DATA | WORKFLOWS | system | Workflow s-02-incomplete-survey-nudge reacted to entry.captured |  |
| PASS | DATA | WORKFLOWS | system | Workflow s-nobook-chase reacted to survey.completed |  |
| PASS | DATA | WORKFLOWS | system | Workflow c-00-crs-soft-pull-request reacted to diagnostic.paid |  |
| PASS | DATA | WORKFLOWS | system | Workflow c-02-inquiry-created reacted to analysis.completed |  |
| PASS | DATA | WORKFLOWS | system | Workflow c-06-crs-results-router reacted to analysis.completed |  |
| PASS | DATA | WORKFLOWS | system | Workflow dpc-01-analyzer-lock reacted to analysis.completed |  |
| PASS | DATA | WORKFLOWS | system | Workflow slo-pack-delivery reacted to analysis.completed |  |
| PASS | DATA | WORKFLOWS | system | Workflow u-02-analyzer-complete-delivery reacted to analysis.completed |  |
| PASS | DATA | WORKFLOWS | system | Workflow u-03-crs-snapshot-sync reacted to analysis.completed |  |
| PASS | DATA | WORKFLOWS | system | Workflow u-04-promote-crs-primary reacted to analysis.completed |  |
| PASS | DATA | WORKFLOWS | system | Workflow u-05-data-health-monitor reacted to analysis.completed |  |
| PASS | DATA | WORKFLOWS | system | Workflow ai-set-01-josh-setter reacted to booking.created |  |
| PASS | DATA | WORKFLOWS | system | Workflow ai-set-04-3way-handoff reacted to booking.created |  |
| PASS | DATA | WORKFLOWS | system | Workflow bs-01-precall-launcher reacted to booking.created |  |
| PASS | DATA | WORKFLOWS | system | Workflow dpc-02-call-outcome-enforcement reacted to booking.created |  |
| PASS | DATA | WORKFLOWS | system | Workflow dpc-05-no-progress-escalation reacted to booking.created |  |
| PASS | DATA | WORKFLOWS | system | Workflow s-04-call-booked reacted to booking.created |  |
| PASS | DATA | WORKFLOWS | system | Workflow s-04b-booking-reminders reacted to booking.created |  |
| PASS | DATA | WORKFLOWS | system | Workflow s-04c-staff-booked-alert reacted to booking.created |  |
| PASS | DATA | WORKFLOWS | system | Workflow s-portal-invite reacted to booking.created |  |
| PASS | DATA | WORKFLOWS | system | Workflow s-05a-no-show-recovery reacted to booking.noshow |  |
| PASS | DATA | WORKFLOWS | system | Workflow ai-set-03-no-answer-cadence reacted to call.completed |  |
| PASS | DATA | WORKFLOWS | system | Workflow ds-01-repair-referral reacted to call.completed |  |
| PASS | DATA | WORKFLOWS | system | Workflow s-08-post-call-funding-declined reacted to call.completed |  |
| PASS | DATA | WORKFLOWS | system | Workflow s-offer-bucket reacted to call.completed |  |
| PASS | DATA | WORKFLOWS | system | Workflow c-02b-inquiry-removal-requested reacted to deposit.paid |  |
| PASS | DATA | WORKFLOWS | system | Workflow s-06-post-call-funding-purchased reacted to deposit.paid |  |
| PASS | DATA | WORKFLOWS | system | Workflow s-doc-collection reacted to deposit.paid |  |
| PASS | DATA | WORKFLOWS | system | Workflow bc-01-customer-responsiveness reacted to round.started |  |
| PASS | DATA | WORKFLOWS | system | Workflow bc-02-customer-friction reacted to round.started |  |
| PASS | DATA | WORKFLOWS | system | Workflow c-05-pre-funding-review reacted to round.started |  |
| PASS | DATA | WORKFLOWS | system | Workflow f-01-funding-intake reacted to round.started |  |
| PASS | DATA | WORKFLOWS | system | Workflow f-02-portal-id-missing reacted to round.started |  |
| PASS | DATA | WORKFLOWS | system | Workflow f-10-client-funding-inbox-provisioner reacted to round.started |  |
| PASS | DATA | WORKFLOWS | system | Workflow round-started-client-notify reacted to round.started |  |
| PASS | DATA | WORKFLOWS | system | Workflow f-03-round-submitted reacted to round.submitted |  |
| PASS | DATA | WORKFLOWS | system | Workflow f-04-round-approvals reacted to round.approved |  |
| PASS | DATA | WORKFLOWS | system | Workflow f-05-inquiry-cleanup-gate reacted to round.approved |  |
| PASS | DATA | WORKFLOWS | system | Workflow sys-01-client-value-calculator reacted to round.approved |  |
| PASS | DATA | WORKFLOWS | system | Workflow f-07-funding-locked reacted to round.funded |  |
| PASS | DATA | WORKFLOWS | system | Workflow f-08-post-funding-monitoring reacted to round.funded |  |
| PASS | DATA | WORKFLOWS | system | Workflow n-06-renewal-second-wave reacted to round.funded |  |
| PASS | DATA | WORKFLOWS | system | Workflow sys-01-ltv-calculator reacted to round.funded |  |
| PASS | DATA | WORKFLOWS | system | Workflow n-04-post-funding-nurture reacted to round.closeout |  |
| PASS | DATA | WORKFLOWS | system | Workflow ds-02-diy-letters reacted to payment.received |  |
| PASS | DATA | WORKFLOWS | system | Workflow slo-paid-form-nudge reacted to payment.received |  |
| PASS | DATA | WORKFLOWS | system | Workflow doc-check reacted to docs.received |  |
| PASS | DATA | WORKFLOWS | system | Workflow repair-bureau-response-reader reacted to docs.received |  |
| PASS | DATA | WORKFLOWS | system | Workflow c-03-inquiry-removed-resume-or-hold reacted to inquiry.removed |  |
| PASS | DATA | WORKFLOWS | system | Workflow dpc-03-inbound-reply-router reacted to message.inbound |  |
| PASS | DATA | WORKFLOWS | system | Workflow slo-genuine-reply reacted to message.inbound |  |
| PASS | DATA | WORKFLOWS | system | Workflow f-06-funding-conditions-missing-docs reacted to mail.response |  |
| PASS | DATA | WORKFLOWS | system | Workflow f-09-funding-declined-no-path reacted to mail.response |  |
| PASS | DATA | WORKFLOWS | system | Workflow f-11-bank-email-event-router reacted to mail.response |  |
| PASS | DATA | WORKFLOWS | system | Workflow ar-collections reacted to invoice.sent |  |
| PASS | DATA | WORKFLOWS | system | Workflow slo-genuine-followup reacted to slo.contact_started |  |
| PASS | DATA | WORKFLOWS | system | Workflow slo-no-reply-197 reacted to slo.contact_started |  |
| PASS | DATA | WORKFLOWS | system | Workflow slo-genuine-checkout-sms reacted to slo.checkout_started |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Workflow n-01-cold-nurture never fired from a live/canonical path in this run | src/workflows/index.mjs |
| UNVERIFIED | DATA | WORKFLOWS | system | Workflow n-02-warm-nurture never fired from a live/canonical path in this run | src/workflows/index.mjs |
| UNVERIFIED | DATA | WORKFLOWS | system | Workflow n-03-hot-nurture never fired from a live/canonical path in this run | src/workflows/index.mjs |
| UNVERIFIED | DATA | WORKFLOWS | system | Workflow cortana-booking-feed never fired from a live/canonical path in this run | src/workflows/index.mjs |
| UNVERIFIED | DATA | WORKFLOWS | system | Workflow bank-outreach-checkins never fired from a live/canonical path in this run | src/workflows/index.mjs |
| UNVERIFIED | DATA | WORKFLOWS | system | Workflow bank-outreach-automation never fired from a live/canonical path in this run | src/workflows/index.mjs |
| UNVERIFIED | DATA | WORKFLOWS | system | Workflow af-01-affiliate-drip never fired from a live/canonical path in this run | src/workflows/index.mjs |
| UNVERIFIED | DATA | WORKFLOWS | system | Workflow blake-lead-watch never fired from a live/canonical path in this run | src/workflows/index.mjs |
| UNVERIFIED | DATA | WORKFLOWS | system | Workflow contract-chaser never fired from a live/canonical path in this run | src/workflows/index.mjs |
| UNVERIFIED | DATA | WORKFLOWS | system | Workflow daily-pulse never fired from a live/canonical path in this run | src/workflows/index.mjs |
| UNVERIFIED | DATA | WORKFLOWS | system | Workflow evening-brief never fired from a live/canonical path in this run | src/workflows/index.mjs |
| UNVERIFIED | DATA | WORKFLOWS | system | Workflow message-dispatch-sweeper never fired from a live/canonical path in this run | src/workflows/index.mjs |
| UNVERIFIED | DATA | WORKFLOWS | system | Workflow hiring-bench-sweeper never fired from a live/canonical path in this run | src/workflows/index.mjs |
| UNVERIFIED | DATA | WORKFLOWS | system | Workflow ops-manager-review never fired from a live/canonical path in this run | src/workflows/index.mjs |
| UNVERIFIED | DATA | WORKFLOWS | system | Workflow hiring-outreach-cadence never fired from a live/canonical path in this run | src/workflows/index.mjs |
| UNVERIFIED | DATA | WORKFLOWS | system | Workflow waypoint-nudge-sweeper never fired from a live/canonical path in this run | src/workflows/index.mjs |
| UNVERIFIED | DATA | WORKFLOWS | system | Workflow blueprint-closer-ready-sweeper never fired from a live/canonical path in this run | src/workflows/index.mjs |
| UNVERIFIED | DATA | WORKFLOWS | system | Workflow finance-os-pull-sweeper never fired from a live/canonical path in this run | src/workflows/index.mjs |
| UNVERIFIED | DATA | WORKFLOWS | system | Workflow finance-os-card-due-reminders never fired from a live/canonical path in this run | src/workflows/index.mjs |
| UNVERIFIED | DATA | WORKFLOWS | system | Workflow finance-os-money-agent never fired from a live/canonical path in this run | src/workflows/index.mjs |
| UNVERIFIED | DATA | WORKFLOWS | system | Workflow plaid-transactions-sweeper never fired from a live/canonical path in this run | src/workflows/index.mjs |
| UNVERIFIED | DATA | WORKFLOWS | system | Workflow merchant-pull-sweeper never fired from a live/canonical path in this run | src/workflows/index.mjs |
| UNVERIFIED | DATA | WORKFLOWS | system | Workflow finance-os-trend-snapshots never fired from a live/canonical path in this run | src/workflows/index.mjs |
| UNVERIFIED | DATA | WORKFLOWS | system | Workflow finance-os-money-transfers never fired from a live/canonical path in this run | src/workflows/index.mjs |
| UNVERIFIED | DATA | WORKFLOWS | system | Workflow blueprint-next-funding-sequence-sweeper never fired from a live/canonical path in this run | src/workflows/index.mjs |
| UNVERIFIED | DATA | WORKFLOWS | system | Workflow blueprint-finance-os-alerts never fired from a live/canonical path in this run | src/workflows/index.mjs |
| UNVERIFIED | DATA | WORKFLOWS | system | Workflow document-vault-chase never fired from a live/canonical path in this run | src/workflows/index.mjs |
| UNVERIFIED | DATA | WORKFLOWS | system | Workflow paid-checkout-expiry-sweeper never fired from a live/canonical path in this run | src/workflows/index.mjs |
| UNVERIFIED | DATA | WORKFLOWS | system | Workflow invoice-checkout-retirement-sweeper never fired from a live/canonical path in this run | src/workflows/index.mjs |
| UNVERIFIED | DATA | WORKFLOWS | system | Workflow invoice-sent-recovery never fired from a live/canonical path in this run | src/workflows/index.mjs |
| UNVERIFIED | DATA | WORKFLOWS | system | Workflow pulse-instant-watch never fired from a live/canonical path in this run | src/workflows/index.mjs |
| UNVERIFIED | DATA | WORKFLOWS | system | Workflow affiliate-payout-run never fired from a live/canonical path in this run | src/workflows/index.mjs |
| UNVERIFIED | DATA | WORKFLOWS | system | Workflow affiliate-payout-autopay never fired from a live/canonical path in this run | src/workflows/index.mjs |
| UNVERIFIED | DATA | WORKFLOWS | system | Workflow meet-transcript-sweeper never fired from a live/canonical path in this run | src/workflows/index.mjs |
| UNVERIFIED | DATA | WORKFLOWS | system | Workflow meta-campaign-sync-sweeper never fired from a live/canonical path in this run | src/workflows/index.mjs |
| UNVERIFIED | DATA | WORKFLOWS | system | Workflow clickfunnels-analytics-sweeper never fired from a live/canonical path in this run | src/workflows/index.mjs |
| UNVERIFIED | DATA | WORKFLOWS | system | Workflow watch-curve-diagnosis-sweeper never fired from a live/canonical path in this run | src/workflows/index.mjs |
| UNVERIFIED | DATA | WORKFLOWS | system | Workflow subscription-billing-sweeper never fired from a live/canonical path in this run | src/workflows/index.mjs |
| UNVERIFIED | DATA | WORKFLOWS | system | Workflow partner-production-floor never fired from a live/canonical path in this run | src/workflows/index.mjs |
| UNVERIFIED | DATA | WORKFLOWS | system | Workflow doc-check-retry-sweeper never fired from a live/canonical path in this run | src/workflows/index.mjs |
| UNVERIFIED | DATA | WORKFLOWS | system | Workflow inquiry-call-sweeper never fired from a live/canonical path in this run | src/workflows/index.mjs |
| UNVERIFIED | DATA | WORKFLOWS | system | Workflow next-action-catch-up never fired from a live/canonical path in this run | src/workflows/index.mjs |
| UNVERIFIED | DATA | WORKFLOWS | system | Workflow slo-infinite-drip never fired from a live/canonical path in this run | src/workflows/index.mjs |
| UNVERIFIED | DATA | WORKFLOWS | system | Workflow meta-campaign-sync-hourly never fired from a live/canonical path in this run | src/workflows/index.mjs |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event survey.submitted has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event booking.rescheduled has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event booking.cancelled has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event setter.no_answer has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event decision.rendered has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event sale.closed has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event file.finalized has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event payment.failed has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event payment.expired has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event payment.canceled has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event payment.refunded has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event payment.disputed has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event inquiry.gate.raised has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event inquiry.gate.clear has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event inquiry.docs.needed has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event letter.generated has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event message.queued has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event message.sent has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event message.failed has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event message.blocked has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event commission.earned has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event commission.approved has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event commission.paid has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event invoice.created has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event invoice.partially_paid has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event invoice.paid has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event invoice.voided has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event contract.sent has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event contract.signed has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event repair.enrolled has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event repair.docs.needed has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event repair.docs.complete has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event repair.analysis.complete has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event repair.analysis.empty has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event repair.letters.ready has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event repair.letters.sent has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event repair.letters.delivered has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event repair.response.received has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event repair.response.parsed has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event repair.parse.low_confidence has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event repair.response.retake has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event repair.item.deleted has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event repair.item.verified has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event repair.item.updated has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event repair.item.unaddressed has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event repair.round.complete has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event repair.round.escalated has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event repair.program.complete has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event repair.stalled has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event repair.cancelled has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event partner.approved has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event diy.package.requested has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event diy.package.generating has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event diy.package.ready has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event diy.package.delivered has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event diy.package.downloaded has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event subscription.started has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event subscription.renewed has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event subscription.past_due has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event subscription.canceled has no workflow listener |  |
| UNVERIFIED | DATA | WORKFLOWS | system | Canonical event subscription.completed has no workflow listener |  |
| PASS | SECURITY | ISOLATION | sales_manager | sales_manager is in FINANCE | src/http/read-api.mjs |
| PASS | SECURITY | ISOLATION | sales_manager | sales_manager is NOT in HIRING | src/http/read-api.mjs |
| PASS | SECURITY | ISOLATION | closer | closer is NOT in HIRING (applicant PII) | src/http/read-api.mjs |
| PASS | SECURITY | ISOLATION | closer | closer is NOT in OPS | src/http/read-api.mjs |
| PASS | SECURITY | ISOLATION | owner | owner may access commissions |  |
| PASS | SECURITY | ISOLATION | owner | owner may access invoices |  |
| PASS | SECURITY | ISOLATION | owner | owner may access staff |  |
| PASS | SECURITY | ISOLATION | owner | owner may access failed-events |  |
| PASS | SECURITY | ISOLATION | owner | owner may access hiring |  |
| PASS | SECURITY | ISOLATION | owner | owner may access hiring-write |  |
| PASS | SECURITY | ISOLATION | owner | owner may access client-dashboard |  |
| PASS | SECURITY | ISOLATION | owner | owner may access documents |  |
| PASS | SECURITY | ISOLATION | owner | owner may access tradelines |  |
| PASS | SECURITY | ISOLATION | owner | owner cannot read other org client (404) |  |
| PASS | SECURITY | ISOLATION | owner | owner org_id/role query spoof does not elevate (200) |  |
| PASS | SECURITY | ISOLATION | admin | admin may access commissions |  |
| PASS | SECURITY | ISOLATION | admin | admin may access invoices |  |
| PASS | SECURITY | ISOLATION | admin | admin may access staff |  |
| PASS | SECURITY | ISOLATION | admin | admin may access failed-events |  |
| PASS | SECURITY | ISOLATION | admin | admin may access hiring |  |
| PASS | SECURITY | ISOLATION | admin | admin may access hiring-write |  |
| PASS | SECURITY | ISOLATION | admin | admin may access client-dashboard |  |
| PASS | SECURITY | ISOLATION | admin | admin may access documents |  |
| PASS | SECURITY | ISOLATION | admin | admin may access tradelines |  |
| PASS | SECURITY | ISOLATION | admin | admin cannot read other org client (404) |  |
| PASS | SECURITY | ISOLATION | admin | admin org_id/role query spoof does not elevate (200) |  |
| PASS | SECURITY | ISOLATION | sales_manager | sales_manager may access commissions |  |
| PASS | SECURITY | ISOLATION | sales_manager | sales_manager may access invoices |  |
| PASS | SECURITY | ISOLATION | sales_manager | sales_manager may access staff |  |
| PASS | SECURITY | ISOLATION | sales_manager | sales_manager refused failed-events (403) |  |
| PASS | SECURITY | ISOLATION | sales_manager | sales_manager refused hiring (403) |  |
| PASS | SECURITY | ISOLATION | sales_manager | sales_manager refused hiring-write (403) |  |
| PASS | SECURITY | ISOLATION | sales_manager | sales_manager may access client-dashboard |  |
| PASS | SECURITY | ISOLATION | sales_manager | sales_manager may access documents |  |
| PASS | SECURITY | ISOLATION | sales_manager | sales_manager may access tradelines |  |
| PASS | SECURITY | ISOLATION | sales_manager | sales_manager cannot read other org client (404) |  |
| PASS | SECURITY | ISOLATION | sales_manager | sales_manager org_id/role query spoof does not elevate (200) |  |
| PASS | SECURITY | ISOLATION | funding_advisor | funding_advisor refused commissions (403) |  |
| PASS | SECURITY | ISOLATION | funding_advisor | funding_advisor refused invoices (403) |  |
| PASS | SECURITY | ISOLATION | funding_advisor | funding_advisor refused staff (403) |  |
| PASS | SECURITY | ISOLATION | funding_advisor | funding_advisor refused failed-events (403) |  |
| PASS | SECURITY | ISOLATION | funding_advisor | funding_advisor refused hiring (403) |  |
| PASS | SECURITY | ISOLATION | funding_advisor | funding_advisor refused hiring-write (403) |  |
| PASS | SECURITY | ISOLATION | funding_advisor | funding_advisor may access client-dashboard |  |
| PASS | SECURITY | ISOLATION | funding_advisor | funding_advisor may access documents |  |
| PASS | SECURITY | ISOLATION | funding_advisor | funding_advisor may access tradelines |  |
| PASS | SECURITY | ISOLATION | funding_advisor | funding_advisor cannot read other org client (404) |  |
| PASS | SECURITY | ISOLATION | funding_advisor | funding_advisor org_id/role query spoof does not elevate (403) |  |
| PASS | SECURITY | ISOLATION | closer | closer refused commissions (403) |  |
| PASS | SECURITY | ISOLATION | closer | closer refused invoices (403) |  |
| PASS | SECURITY | ISOLATION | closer | closer refused staff (403) |  |
| PASS | SECURITY | ISOLATION | closer | closer refused failed-events (403) |  |
| PASS | SECURITY | ISOLATION | closer | closer refused hiring (403) |  |
| PASS | SECURITY | ISOLATION | closer | closer refused hiring-write (403) |  |
| PASS | SECURITY | ISOLATION | closer | closer may access client-dashboard |  |
| PASS | SECURITY | ISOLATION | closer | closer may access documents |  |
| PASS | SECURITY | ISOLATION | closer | closer may access tradelines |  |
| PASS | SECURITY | ISOLATION | closer | closer cannot read other org client (404) |  |
| PASS | SECURITY | ISOLATION | closer | closer org_id/role query spoof does not elevate (403) |  |
| PASS | SECURITY | ISOLATION | inquiry_specialist | inquiry_specialist refused commissions (403) |  |
| PASS | SECURITY | ISOLATION | inquiry_specialist | inquiry_specialist refused invoices (403) |  |
| PASS | SECURITY | ISOLATION | inquiry_specialist | inquiry_specialist refused staff (403) |  |
| PASS | SECURITY | ISOLATION | inquiry_specialist | inquiry_specialist refused failed-events (403) |  |
| PASS | SECURITY | ISOLATION | inquiry_specialist | inquiry_specialist refused hiring (403) |  |
| PASS | SECURITY | ISOLATION | inquiry_specialist | inquiry_specialist refused hiring-write (403) |  |
| PASS | SECURITY | ISOLATION | inquiry_specialist | inquiry_specialist may access client-dashboard |  |
| PASS | SECURITY | ISOLATION | inquiry_specialist | inquiry_specialist may access documents |  |
| PASS | SECURITY | ISOLATION | inquiry_specialist | inquiry_specialist may access tradelines |  |
| PASS | SECURITY | ISOLATION | inquiry_specialist | inquiry_specialist cannot read other org client (404) |  |
| PASS | SECURITY | ISOLATION | inquiry_specialist | inquiry_specialist org_id/role query spoof does not elevate (403) |  |
| PASS | SECURITY | ISOLATION | setter | setter refused commissions (403) |  |
| PASS | SECURITY | ISOLATION | setter | setter refused invoices (403) |  |
| PASS | SECURITY | ISOLATION | setter | setter refused staff (403) |  |
| PASS | SECURITY | ISOLATION | setter | setter refused failed-events (403) |  |
| PASS | SECURITY | ISOLATION | setter | setter refused hiring (403) |  |
| PASS | SECURITY | ISOLATION | setter | setter refused hiring-write (403) |  |
| PASS | SECURITY | ISOLATION | setter | setter may access client-dashboard |  |
| PASS | SECURITY | ISOLATION | setter | setter may access documents |  |
| PASS | SECURITY | ISOLATION | setter | setter may access tradelines |  |
| PASS | SECURITY | ISOLATION | setter | setter cannot read other org client (404) |  |
| PASS | SECURITY | ISOLATION | setter | setter org_id/role query spoof does not elevate (403) |  |
| PASS | SECURITY | ISOLATION | closer | Closer refused hiring endpoint (403) |  |
| PASS | SECURITY | ISOLATION | forged | Forged bearer token is refused | src/auth/session.mjs |
| PASS | SECURITY | ISOLATION | closer | Session endpoint responds to auth probes (status 401) |  |
| PASS | SECURITY | ISOLATION | closer | Closer brain access tiers exclude owner; owner includes owner | src/company-brain/access.mjs |
| PASS | SECURITY | ISOLATION | closer | Closer brain SQL filter excludes owner-tier chunks; owner can see them | src/company-brain/retrieve.mjs |
| PASS | SECURITY | ISOLATION | closer | Company Brain live retrieve is credential-gated (OPENAI_API_KEY); tier gate verified above | src/company-brain/embed.mjs |
| PASS | SECURITY | ISOLATION | affiliate | Affiliate refused internal client (403) |  |
| UNVERIFIED | SECURITY | ISOLATION | funding_advisor | Proxy session credential isolation between advisors |  |
| PASS | CROSS | CROSS_CUTTING | system | Workflow template keys discovered (102; spec said 41) | src/messaging/seed/workflow-keys.mjs |
| PASS | CROSS | CROSS_CUTTING | system | Template EMAIL-AR-01-FIRST-NOTICE exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template EMAIL-AR-02-REMINDER exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template EMAIL-AR-03-FINAL-NOTICE exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template EMAIL-AX07-FUNDING-PAUSED exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template EMAIL-C06-DECLINE exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template EMAIL-DOC-01-REQUEST exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template EMAIL-DPC05-NO-PROGRESS-72H exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template EMAIL-DS01-REPAIR-REFERRAL exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template EMAIL-DS02-DIY-LETTERS-READY exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template EMAIL-F02-ID-PORTAL-NEEDED exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template EMAIL-F02-ID-PORTAL-NEEDED-FOLLOWUP exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template EMAIL-F03-ROUND-SUBMITTED exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template EMAIL-F04-ROUND-APPROVALS exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template EMAIL-F06-MISSING-DOCS exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template EMAIL-F07-FUNDING-LOCKED exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template EMAIL-F10-INBOX-SETUP exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template EMAIL-N01-COLD-NURTURE exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template EMAIL-N02-WARM-NURTURE exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template EMAIL-N03-HOT-NURTURE exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template EMAIL-N04-POST-FUNDING exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template EMAIL-N06-RENEWAL exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template EMAIL-NOBOOK-01 exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template EMAIL-NOBOOK-02 exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template EMAIL-NOBOOK-03 exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template EMAIL-OFFER-FUNDING-DFY exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template EMAIL-OFFER-FUNDING-MASTERY exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template EMAIL-OFFER-NONE exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template EMAIL-OFFER-REPAIR-DFY exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template EMAIL-OFFER-REPAIR-TRIAL exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template EMAIL-OFFER-SOFT-PULL exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template EMAIL-OFFER-UWIQ-DELIVERABLES exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template EMAIL-S00-WELCOME exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template EMAIL-S02-RESUME-1 exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template EMAIL-S02-RESUME-2 exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template EMAIL-S02-RESUME-3 exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template EMAIL-S04-01-CONFIRM exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template EMAIL-S05A-NOSHOW-02 exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template EMAIL-S05A-NOSHOW-03 exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template EMAIL-S05A-NOSHOW-04 exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template EMAIL-S05A-NOSHOW-RECOVERY exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template EMAIL-SLO-197 exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template EMAIL-SLO-COUPON-01 exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template EMAIL-SLO-FIRST5-01 exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template EMAIL-SLO-FIRST5-REPLY exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template EMAIL-SLO-GENUINE-01 exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template EMAIL-SLO-GIFT-01 exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template EMAIL-SLO-PAID-FORM-01 exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template EMAIL-U02-ANALYZER-FUNDING-DELIVERY exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template EMAIL-U02-ANALYZER-REPAIR-DELIVERY exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template SMS-AISET03-MSG1 exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template SMS-AISET03-MSG2 exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template SMS-AISET03-MSG3 exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template SMS-AISET03-OPTIN-1 exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template SMS-AISET03-OPTIN-2 exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template SMS-AISET03-OPTIN-3 exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template SMS-AISET04-HANDOFF exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template SMS-AR-01-FIRST-NOTICE exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template SMS-AR-02-REMINDER exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template SMS-AR-03-FINAL-NOTICE exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template SMS-AX07-FUNDING-PAUSED exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template SMS-BS01-01-BOOKED exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template SMS-BS01-02-PRECALL exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template SMS-BS01-03-DAYOF exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template SMS-C06-DECLINE exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template SMS-DOC-01-REQUEST exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template SMS-DPC04-RESCHEDULE-REBOOKING exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template SMS-DPC05-NO-PROGRESS-72H exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template SMS-DS01-REPAIR-REFERRAL exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template SMS-F02-ID-PORTAL-NEEDED exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template SMS-F03-ROUND-SUBMITTED exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template SMS-F04-ROUND-APPROVALS exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template SMS-F06-MISSING-DOCS exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template SMS-F07-FUNDING-LOCKED exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template SMS-F10-INBOX-SETUP exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template SMS-N01-COLD-NURTURE exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template SMS-N02-WARM-NURTURE exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template SMS-N03-HOT-NURTURE exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template SMS-N04-POST-FUNDING exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template SMS-N06-RENEWAL exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template SMS-NOBOOK-01 exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template SMS-NOBOOK-02 exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template SMS-NOBOOK-03 exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template SMS-ROUND-STARTED-NOTIFY exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template SMS-S00-WELCOME exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template SMS-S02-RESUME-1 exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template SMS-S02-RESUME-2 exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template SMS-S02-RESUME-3 exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template SMS-S04-01-CONFIRM exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template SMS-S04-02-REMIND-24H exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template SMS-S04-03-REMIND-2H exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template SMS-S04-CONFIRM-ACK exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template SMS-S05A-NOSHOW-02 exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template SMS-S05A-NOSHOW-03 exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template SMS-S05A-NOSHOW-04 exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template SMS-S05A-NOSHOW-RECOVERY exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template SMS-SLO-197 exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template SMS-SLO-COUPON-01 exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template SMS-SLO-FIRST5-01 exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template SMS-SLO-FIRST5-REPLY exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template SMS-SLO-GENUINE-01 exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template SMS-SLO-GIFT-01 exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | Template SMS-SLO-PAID-FORM-01 exists (compliance_passed=true) |  |
| PASS | CROSS | CROSS_CUTTING | system | No DRAFT workflow templates in inventory (guard unexercised) | src/messaging/draft-guard.mjs |
| PASS | CROSS | CROSS_CUTTING | system | compliance_passed=false blocks queue/send | src/workflows/messaging.mjs |
| PASS | CROSS | CROSS_CUTTING | system | Hand-calc closer 20% of $3,000 deposit = $600 |  |
| PASS | CROSS | CROSS_CUTTING | system | Hand-calc 0.25% of $50,000 = $125 |  |
| PASS | CROSS | CROSS_CUTTING | system | Hand-calc 10% of $50,000 = $5,000 |  |
| PASS | CROSS | CROSS_CUTTING | system | Advisor hourly rate constant $6.25 (shift pay — not ledger) |  |
| PASS | CROSS | CROSS_CUTTING | system | affiliate.html has no obvious fabricated sample dollars in static markup | public/app/affiliate.html |
| PASS | CROSS | CROSS_CUTTING | system | agent-editor.html has no obvious fabricated sample dollars in static markup | public/app/agent-editor.html |
| PASS | CROSS | CROSS_CUTTING | system | automations.html has no obvious fabricated sample dollars in static markup | public/app/automations.html |
| PASS | CROSS | CROSS_CUTTING | system | bank-outreach.html has no obvious fabricated sample dollars in static markup | public/app/bank-outreach.html |
| PASS | CROSS | CROSS_CUTTING | system | brand-studio.html has no obvious fabricated sample dollars in static markup | public/app/brand-studio.html |
| PASS | CROSS | CROSS_CUTTING | system | calendar.html has no obvious fabricated sample dollars in static markup | public/app/calendar.html |
| PASS | CROSS | CROSS_CUTTING | system | campaign-manager.html has no obvious fabricated sample dollars in static markup | public/app/campaign-manager.html |
| PASS | CROSS | CROSS_CUTTING | system | client-control-panel.html has no obvious fabricated sample dollars in static markup | public/app/client-control-panel.html |
| PASS | CROSS | CROSS_CUTTING | system | client-portal.html has no obvious fabricated sample dollars in static markup | public/app/client-portal.html |
| PASS | CROSS | CROSS_CUTTING | system | closer-call.html has no obvious fabricated sample dollars in static markup | public/app/closer-call.html |
| PASS | CROSS | CROSS_CUTTING | system | closer-dashboard.html has no obvious fabricated sample dollars in static markup | public/app/closer-dashboard.html |
| PASS | CROSS | CROSS_CUTTING | system | company-brain.html has no obvious fabricated sample dollars in static markup | public/app/company-brain.html |
| PASS | CROSS | CROSS_CUTTING | system | consent-capture.html has no obvious fabricated sample dollars in static markup | public/app/consent-capture.html |
| PASS | CROSS | CROSS_CUTTING | system | content-admin.html has no obvious fabricated sample dollars in static markup | public/app/content-admin.html |
| PASS | CROSS | CROSS_CUTTING | system | contracts.html has no obvious fabricated sample dollars in static markup | public/app/contracts.html |
| PASS | CROSS | CROSS_CUTTING | system | creative-factory.html has no obvious fabricated sample dollars in static markup | public/app/creative-factory.html |
| PASS | CROSS | CROSS_CUTTING | system | csm-queue.html has no obvious fabricated sample dollars in static markup | public/app/csm-queue.html |
| PASS | CROSS | CROSS_CUTTING | system | documents.html has no obvious fabricated sample dollars in static markup | public/app/documents.html |
| PASS | CROSS | CROSS_CUTTING | system | finance-os.html has no obvious fabricated sample dollars in static markup | public/app/finance-os.html |
| PASS | CROSS | CROSS_CUTTING | system | financeos.html has no obvious fabricated sample dollars in static markup | public/app/financeos.html |
| PASS | CROSS | CROSS_CUTTING | system | galaxy.html has no obvious fabricated sample dollars in static markup | public/app/galaxy.html |
| PASS | CROSS | CROSS_CUTTING | system | hiring.html has no obvious fabricated sample dollars in static markup | public/app/hiring.html |
| PASS | CROSS | CROSS_CUTTING | system | index.html has no obvious fabricated sample dollars in static markup | public/app/index.html |
| PASS | CROSS | CROSS_CUTTING | system | inquiry-remover.html has no obvious fabricated sample dollars in static markup | public/app/inquiry-remover.html |
| PASS | CROSS | CROSS_CUTTING | system | journeys.html has no obvious fabricated sample dollars in static markup | public/app/journeys.html |
| PASS | CROSS | CROSS_CUTTING | system | lenders.html has no obvious fabricated sample dollars in static markup | public/app/lenders.html |
| PASS | CROSS | CROSS_CUTTING | system | marketing-command-center.html has no obvious fabricated sample dollars in static markup | public/app/marketing-command-center.html |
| PASS | CROSS | CROSS_CUTTING | system | messaging.html has no obvious fabricated sample dollars in static markup | public/app/messaging.html |
| PASS | CROSS | CROSS_CUTTING | system | money-accounts.html has no obvious fabricated sample dollars in static markup | public/app/money-accounts.html |
| PASS | CROSS | CROSS_CUTTING | system | money-alerts.html has no obvious fabricated sample dollars in static markup | public/app/money-alerts.html |
| PASS | CROSS | CROSS_CUTTING | system | money-banks.html has no obvious fabricated sample dollars in static markup | public/app/money-banks.html |
| PASS | CROSS | CROSS_CUTTING | system | money-connections.html has no obvious fabricated sample dollars in static markup | public/app/money-connections.html |
| PASS | CROSS | CROSS_CUTTING | system | money-credit.html has no obvious fabricated sample dollars in static markup | public/app/money-credit.html |
| PASS | CROSS | CROSS_CUTTING | system | money-declines.html has no obvious fabricated sample dollars in static markup | public/app/money-declines.html |
| PASS | CROSS | CROSS_CUTTING | system | money-fundability.html has no obvious fabricated sample dollars in static markup | public/app/money-fundability.html |
| PASS | CROSS | CROSS_CUTTING | system | money-helper.html has no obvious fabricated sample dollars in static markup | public/app/money-helper.html |
| PASS | CROSS | CROSS_CUTTING | system | money-next.html has no obvious fabricated sample dollars in static markup | public/app/money-next.html |
| PASS | CROSS | CROSS_CUTTING | system | money-payments.html has no obvious fabricated sample dollars in static markup | public/app/money-payments.html |
| PASS | CROSS | CROSS_CUTTING | system | money-plan.html has no obvious fabricated sample dollars in static markup | public/app/money-plan.html |
| PASS | CROSS | CROSS_CUTTING | system | money-setup.html has no obvious fabricated sample dollars in static markup | public/app/money-setup.html |
| PASS | CROSS | CROSS_CUTTING | system | money-strategy.html has no obvious fabricated sample dollars in static markup | public/app/money-strategy.html |
| PASS | CROSS | CROSS_CUTTING | system | money-transfers.html has no obvious fabricated sample dollars in static markup | public/app/money-transfers.html |
| PASS | CROSS | CROSS_CUTTING | system | money-vault.html has no obvious fabricated sample dollars in static markup | public/app/money-vault.html |
| PASS | CROSS | CROSS_CUTTING | system | money.html has no obvious fabricated sample dollars in static markup | public/app/money.html |
| PASS | CROSS | CROSS_CUTTING | system | morning-brief.html has no obvious fabricated sample dollars in static markup | public/app/morning-brief.html |
| PASS | CROSS | CROSS_CUTTING | system | my-numbers.html has no obvious fabricated sample dollars in static markup | public/app/my-numbers.html |
| PASS | CROSS | CROSS_CUTTING | system | ops-admin.html has no obvious fabricated sample dollars in static markup | public/app/ops-admin.html |
| PASS | CROSS | CROSS_CUTTING | system | partner-galaxy.html has no obvious fabricated sample dollars in static markup | public/app/partner-galaxy.html |
| PASS | CROSS | CROSS_CUTTING | system | partner-training.html has no obvious fabricated sample dollars in static markup | public/app/partner-training.html |
| PASS | CROSS | CROSS_CUTTING | system | payment-success.html has no obvious fabricated sample dollars in static markup | public/app/payment-success.html |
| PASS | CROSS | CROSS_CUTTING | system | pipeline.html has no obvious fabricated sample dollars in static markup | public/app/pipeline.html |
| PASS | CROSS | CROSS_CUTTING | system | present.html has no obvious fabricated sample dollars in static markup | public/app/present.html |
| PASS | CROSS | CROSS_CUTTING | system | products-commissions.html has no obvious fabricated sample dollars in static markup | public/app/products-commissions.html |
| PASS | CROSS | CROSS_CUTTING | system | sales-floor.html has no obvious fabricated sample dollars in static markup | public/app/sales-floor.html |
| PASS | CROSS | CROSS_CUTTING | system | setter-dashboard.html has no obvious fabricated sample dollars in static markup | public/app/setter-dashboard.html |
| PASS | CROSS | CROSS_CUTTING | system | sidebar.fragment.html has no obvious fabricated sample dollars in static markup | public/app/sidebar.fragment.html |
| PASS | CROSS | CROSS_CUTTING | system | social-studio.html has no obvious fabricated sample dollars in static markup | public/app/social-studio.html |
| PASS | CROSS | CROSS_CUTTING | system | soft-pull-approve.html has no obvious fabricated sample dollars in static markup | public/app/soft-pull-approve.html |
| PASS | CROSS | CROSS_CUTTING | system | staff-teams.html has no obvious fabricated sample dollars in static markup | public/app/staff-teams.html |
| PASS | CROSS | CROSS_CUTTING | system | teleprompter-remote.html has no obvious fabricated sample dollars in static markup | public/app/teleprompter-remote.html |
| PASS | CROSS | CROSS_CUTTING | system | teleprompter.html has no obvious fabricated sample dollars in static markup | public/app/teleprompter.html |
| PASS | CROSS | CROSS_CUTTING | system | message_templates inventory: total=181 drafts=0 compliant=169 |  |
| PASS | UI | ROLE_SCREENS | owner | owner opened pipeline.html with no console errors | public/app/pipeline.html |
| PASS | UI | ROLE_SCREENS | owner | owner opened finance-os.html with no console errors | public/app/finance-os.html |
| PASS | UI | ROLE_SCREENS | owner | owner opened ops-admin.html with no console errors | public/app/ops-admin.html |
| PASS | UI | ROLE_SCREENS | owner | owner opened agent-editor.html with no console errors | public/app/agent-editor.html |
| PASS | UI | ROLE_SCREENS | owner | owner opened brand-studio.html with no console errors | public/app/brand-studio.html |
| PASS | UI | ROLE_SCREENS | owner | owner opened staff-teams.html with no console errors | public/app/staff-teams.html |
| PASS | UI | ROLE_SCREENS | owner | owner opened company-brain.html with no console errors | public/app/company-brain.html |
| PASS | UI | ROLE_SCREENS | owner | owner opened lenders.html with no console errors | public/app/lenders.html |
| PASS | UI | ROLE_SCREENS | owner | owner opened consent-capture.html with no console errors | public/app/consent-capture.html |
| PASS | UI | ROLE_SCREENS | owner | owner opened hiring.html with no console errors | public/app/hiring.html |
| PASS | UI | ROLE_SCREENS | owner | owner opened galaxy.html with no console errors | public/app/galaxy.html |
| PASS | UI | ROLE_SCREENS | admin | admin opened pipeline.html with no console errors | public/app/pipeline.html |
| PASS | UI | ROLE_SCREENS | admin | admin opened finance-os.html with no console errors | public/app/finance-os.html |
| PASS | UI | ROLE_SCREENS | admin | admin opened ops-admin.html with no console errors | public/app/ops-admin.html |
| PASS | UI | ROLE_SCREENS | admin | admin opened agent-editor.html with no console errors | public/app/agent-editor.html |
| PASS | UI | ROLE_SCREENS | admin | admin opened staff-teams.html with no console errors | public/app/staff-teams.html |
| PASS | UI | ROLE_SCREENS | admin | admin opened company-brain.html with no console errors | public/app/company-brain.html |
| PASS | UI | ROLE_SCREENS | admin | admin opened lenders.html with no console errors | public/app/lenders.html |
| PASS | UI | ROLE_SCREENS | admin | admin opened galaxy.html with no console errors | public/app/galaxy.html |
| PASS | UI | ROLE_SCREENS | sales_manager | sales_manager opened pipeline.html with no console errors | public/app/pipeline.html |
| PASS | UI | ROLE_SCREENS | sales_manager | sales_manager opened products-commissions.html with no console errors | public/app/products-commissions.html |
| PASS | UI | ROLE_SCREENS | sales_manager | sales_manager opened staff-teams.html with no console errors | public/app/staff-teams.html |
| PASS | UI | ROLE_SCREENS | sales_manager | sales_manager opened closer-dashboard.html with no console errors | public/app/closer-dashboard.html |
| PASS | SECURITY | DIRECT_URL | sales_manager | sales_manager direct-URL to hiring.html: static HTML may load; API isolation enforced server-side | public/app/hiring.html |
| PASS | SECURITY | DIRECT_URL | sales_manager | sales_manager direct-URL to ops-admin.html: static HTML may load; API isolation enforced server-side | public/app/ops-admin.html |
| PASS | UI | ROLE_SCREENS | closer | closer opened closer-dashboard.html with no console errors | public/app/closer-dashboard.html |
| PASS | UI | ROLE_SCREENS | closer | closer opened pipeline.html with no console errors | public/app/pipeline.html |
| PASS | UI | ROLE_SCREENS | closer | closer opened messaging.html with no console errors | public/app/messaging.html |
| PASS | UI | ROLE_SCREENS | closer | closer opened client-control-panel.html with no console errors | public/app/client-control-panel.html |
| PASS | UI | ROLE_SCREENS | closer | closer opened calendar.html with no console errors | public/app/calendar.html |
| PASS | SECURITY | DIRECT_URL | closer | closer direct-URL to hiring.html: static HTML may load; API isolation enforced server-side | public/app/hiring.html |
| PASS | SECURITY | DIRECT_URL | closer | closer direct-URL to ops-admin.html: static HTML may load; API isolation enforced server-side | public/app/ops-admin.html |
| PASS | SECURITY | DIRECT_URL | closer | closer direct-URL to finance-os.html: static HTML may load; API isolation enforced server-side | public/app/finance-os.html |
| PASS | UI | ROLE_SCREENS | funding_advisor | funding_advisor opened lenders.html with no console errors | public/app/lenders.html |
| PASS | UI | ROLE_SCREENS | funding_advisor | funding_advisor opened client-control-panel.html with no console errors | public/app/client-control-panel.html |
| PASS | UI | ROLE_SCREENS | funding_advisor | funding_advisor opened pipeline.html with no console errors | public/app/pipeline.html |
| PASS | UI | ROLE_SCREENS | funding_advisor | funding_advisor opened messaging.html with no console errors | public/app/messaging.html |
| PASS | SECURITY | DIRECT_URL | funding_advisor | funding_advisor direct-URL to hiring.html: static HTML may load; API isolation enforced server-side | public/app/hiring.html |
| PASS | SECURITY | DIRECT_URL | funding_advisor | funding_advisor direct-URL to ops-admin.html: static HTML may load; API isolation enforced server-side | public/app/ops-admin.html |
| PASS | UI | ROLE_SCREENS | inquiry_specialist | inquiry_specialist opened inquiry-remover.html with no console errors | public/app/inquiry-remover.html |
| PASS | UI | ROLE_SCREENS | inquiry_specialist | inquiry_specialist opened messaging.html with no console errors | public/app/messaging.html |
| PASS | SECURITY | DIRECT_URL | inquiry_specialist | inquiry_specialist direct-URL to hiring.html: static HTML may load; API isolation enforced server-side | public/app/hiring.html |
| PASS | SECURITY | DIRECT_URL | inquiry_specialist | inquiry_specialist direct-URL to ops-admin.html: static HTML may load; API isolation enforced server-side | public/app/ops-admin.html |
| PASS | SECURITY | DIRECT_URL | inquiry_specialist | inquiry_specialist direct-URL to products-commissions.html: static HTML may load; API isolation enforced server-side | public/app/products-commissions.html |
| PASS | UI | ROLE_SCREENS | setter | setter opened pipeline.html with no console errors | public/app/pipeline.html |
| PASS | UI | ROLE_SCREENS | setter | setter opened calendar.html with no console errors | public/app/calendar.html |
| PASS | UI | ROLE_SCREENS | setter | setter opened messaging.html with no console errors | public/app/messaging.html |
| PASS | SECURITY | DIRECT_URL | setter | setter direct-URL to hiring.html: static HTML may load; API isolation enforced server-side | public/app/hiring.html |
| PASS | SECURITY | DIRECT_URL | setter | setter direct-URL to ops-admin.html: static HTML may load; API isolation enforced server-side | public/app/ops-admin.html |
| PASS | SECURITY | DIRECT_URL | setter | setter direct-URL to finance-os.html: static HTML may load; API isolation enforced server-side | public/app/finance-os.html |
| PASS | UI | ROLE_SCREENS | affiliate | affiliate opened affiliate.html with no console errors | public/app/affiliate.html |
| PASS | SECURITY | DIRECT_URL | affiliate | affiliate direct-URL to pipeline.html: static HTML may load; API isolation enforced server-side | public/app/pipeline.html |
| PASS | SECURITY | DIRECT_URL | affiliate | affiliate direct-URL to finance-os.html: static HTML may load; API isolation enforced server-side | public/app/finance-os.html |
| PASS | SECURITY | DIRECT_URL | affiliate | affiliate direct-URL to hiring.html: static HTML may load; API isolation enforced server-side | public/app/hiring.html |
| PASS | SECURITY | DIRECT_URL | affiliate | affiliate direct-URL to ops-admin.html: static HTML may load; API isolation enforced server-side | public/app/ops-admin.html |
| PASS | SECURITY | DIRECT_URL | affiliate | affiliate direct-URL to client-control-panel.html: static HTML may load; API isolation enforced server-side | public/app/client-control-panel.html |
| PASS | UI | ROLE_SCREENS | partner | partner opened partner-galaxy.html with no console errors | public/app/partner-galaxy.html |
| PASS | UI | ROLE_SCREENS | partner | partner opened brand-studio.html with no console errors | public/app/brand-studio.html |
| PASS | UI | ROLE_SCREENS | partner | partner opened social-studio.html with no console errors | public/app/social-studio.html |
| PASS | UI | ROLE_SCREENS | partner | partner opened creative-factory.html with no console errors | public/app/creative-factory.html |
| PASS | SECURITY | DIRECT_URL | partner | partner direct-URL to pipeline.html: static HTML may load; API isolation enforced server-side | public/app/pipeline.html |
| PASS | SECURITY | DIRECT_URL | partner | partner direct-URL to finance-os.html: static HTML may load; API isolation enforced server-side | public/app/finance-os.html |
| PASS | SECURITY | DIRECT_URL | partner | partner direct-URL to hiring.html: static HTML may load; API isolation enforced server-side | public/app/hiring.html |
| PASS | UI | CLOSER_SHIFT | closer | Closer dashboard surfaces clock-in/shift requirement when no open shift | public/app/closer-dashboard.html |
| PASS | UI | CLIENT_PORTAL | client | Client portal loads without console errors | public/app/client-portal.html |
| PASS | UI | PARTNER_BRAND | partner | Partner brand studio does not present internal CRM theming as editable | public/app/brand-studio.html |
| PASS | SECURITY | DIRECT_URL | closer | Closer direct-URL to owner screens triggers 403 on gated APIs | e2e/verification-security.spec.mjs |
| PASS | SECURITY | DIRECT_URL | owner | Owner can open ops-admin without console death | public/app/ops-admin.html |
| PASS | UI | VIEWPORT | owner | pipeline console-clean at 1280px | public/app/pipeline.html |
| PASS | UI | VIEWPORT | owner | pipeline console-clean at 390px | public/app/pipeline.html |

## 5. Collected assertion breaks (FAIL + SILENT) with file and line

_No collected assertion breaks recorded. Journey verdicts are listed in §7._

## 6. Unverifiable without a real external credential

| Check | Credential that unlocks it |
|---|---|
| Real ClickFunnels webhook field paths | Live CF webhook sample + CLICKFUNNELS_WEBHOOK_SECRET |
| Real Commas payment.succeeded payload | COMMAS_WEBHOOK_SECRET + live event sample |
| Twilio inbound SMS + status callbacks | TWILIO_AUTH_TOKEN + real MessageSid |
| Mailgun inbound bank-email parse | MAILGUN_WEBHOOK_SIGNING_KEY + real MIME |
| Bland AI voice call outcome | BLAND_WEBHOOK_SECRET + live call |
| Lendflow application decision webhooks | LENDFLOW_WEBHOOK_SECRET |
| Company Brain live embedding retrieve | OPENAI_API_KEY (or COMPANY_BRAIN_OPENAI_API_KEY) |
| Agent live model replies (non-shadow) | ANTHROPIC_API_KEY |
| Oxylabs residential proxy geo-verify | OXYLABS credentials |
| Actual outbound SMS/email delivery | Twilio/Mailgun send credentials + outbound_enabled=true |
| Inngest-scheduled workflow timing | INNGEST_EVENT_KEY (owner-gated) |
| CRS live soft-pull | CRS / Array vendor credentials |

## 7. Local synthetic journey verdicts

- PASS — system / A. Funding path — money/data spine held in this run
- PASS — system / B. Credit-repair / DIY downsell — money/data spine held in this run
- PASS — system / C. Inquiry removal — money/data spine held in this run
- FAIL — system / D. Agent runtime — see journey account
- PASS — system / E. Idempotency, replay, ordering — money/data spine held in this run
- UNVERIFIED — system / F. Negative / adversarial — partial
- PASS — system / G. Workflow engine — money/data spine held in this run
- PASS — owner / security isolation — no P0 leak in probes
- PASS — admin / security isolation — no P0 leak in probes
- PASS — sales_manager / security isolation — no P0 leak in probes
- PASS — funding_advisor / security isolation — no P0 leak in probes
- PASS — closer / security isolation — no P0 leak in probes
- PASS — inquiry_specialist / security isolation — no P0 leak in probes
- PASS — setter / security isolation — no P0 leak in probes
- PASS — system / PART 3 — Security & isolation — money/data spine held in this run
- PASS — system / PART 4 — Cross-cutting — money/data spine held in this run
- PASS — owner / daily UI screens — screens load under mocked API; live backend not proven here
- PASS — admin / daily UI screens — screens load under mocked API; live backend not proven here
- PASS — sales_manager / daily UI screens — screens load under mocked API; live backend not proven here
- PASS — closer / daily UI screens — screens load under mocked API; live backend not proven here
- PASS — funding_advisor / daily UI screens — screens load under mocked API; live backend not proven here
- PASS — inquiry_specialist / daily UI screens — screens load under mocked API; live backend not proven here
- PASS — setter / daily UI screens — screens load under mocked API; live backend not proven here
- PASS — affiliate / daily UI screens — screens load under mocked API; live backend not proven here
- PASS — partner / daily UI screens — screens load under mocked API; live backend not proven here
- PASS — closer / clock-in gate — shift requirement visible
- PASS — client / portal — static load ok under mock; magic-link + pay + sign need live credentials

## 8. Operator notes

Skeptical operator stance. PASS means a write path was exercised and the persisted value matched.

SILENTLY-DID-NOTHING means the operation returned without error and left no useful row — the recurring Fundhub failure mode.

UNVERIFIED means this run could not honestly prove the claim (missing credential, empty corpus, or UI not run).

Adapters used mock secrets. ANTHROPIC_API_KEY unset. messaging_settings.outbound_enabled=false. Nothing transmitted.

Money checked via src/verification/fixtures.mjs MONEY constants (hand-calc), not by calling commission helpers under test.

## 9. UNVERIFIED inventory

- Quiet-hours message holds then releases — Requires controlling clock + dispatcher drain; dispatcher sends only with provider creds. Exercised in unit tests; not end-to-end here.
- Workflow n-01-cold-nurture never fired from a live/canonical path in this run — No trigger event discovered on the Inngest function object
- Workflow n-02-warm-nurture never fired from a live/canonical path in this run — No trigger event discovered on the Inngest function object
- Workflow n-03-hot-nurture never fired from a live/canonical path in this run — No trigger event discovered on the Inngest function object
- Workflow cortana-booking-feed never fired from a live/canonical path in this run — No trigger event discovered on the Inngest function object
- Workflow bank-outreach-checkins never fired from a live/canonical path in this run — No trigger event discovered on the Inngest function object
- Workflow bank-outreach-automation never fired from a live/canonical path in this run — No trigger event discovered on the Inngest function object
- Workflow af-01-affiliate-drip never fired from a live/canonical path in this run — No trigger event discovered on the Inngest function object
- Workflow blake-lead-watch never fired from a live/canonical path in this run — No trigger event discovered on the Inngest function object
- Workflow contract-chaser never fired from a live/canonical path in this run — No trigger event discovered on the Inngest function object
- Workflow daily-pulse never fired from a live/canonical path in this run — No trigger event discovered on the Inngest function object
- Workflow evening-brief never fired from a live/canonical path in this run — No trigger event discovered on the Inngest function object
- Workflow message-dispatch-sweeper never fired from a live/canonical path in this run — No trigger event discovered on the Inngest function object
- Workflow hiring-bench-sweeper never fired from a live/canonical path in this run — No trigger event discovered on the Inngest function object
- Workflow ops-manager-review never fired from a live/canonical path in this run — No trigger event discovered on the Inngest function object
- Workflow hiring-outreach-cadence never fired from a live/canonical path in this run — No trigger event discovered on the Inngest function object
- Workflow waypoint-nudge-sweeper never fired from a live/canonical path in this run — No trigger event discovered on the Inngest function object
- Workflow blueprint-closer-ready-sweeper never fired from a live/canonical path in this run — No trigger event discovered on the Inngest function object
- Workflow finance-os-pull-sweeper never fired from a live/canonical path in this run — No trigger event discovered on the Inngest function object
- Workflow finance-os-card-due-reminders never fired from a live/canonical path in this run — No trigger event discovered on the Inngest function object
- Workflow finance-os-money-agent never fired from a live/canonical path in this run — No trigger event discovered on the Inngest function object
- Workflow plaid-transactions-sweeper never fired from a live/canonical path in this run — No trigger event discovered on the Inngest function object
- Workflow merchant-pull-sweeper never fired from a live/canonical path in this run — No trigger event discovered on the Inngest function object
- Workflow finance-os-trend-snapshots never fired from a live/canonical path in this run — No trigger event discovered on the Inngest function object
- Workflow finance-os-money-transfers never fired from a live/canonical path in this run — No trigger event discovered on the Inngest function object
- Workflow blueprint-next-funding-sequence-sweeper never fired from a live/canonical path in this run — No trigger event discovered on the Inngest function object
- Workflow blueprint-finance-os-alerts never fired from a live/canonical path in this run — No trigger event discovered on the Inngest function object
- Workflow document-vault-chase never fired from a live/canonical path in this run — No trigger event discovered on the Inngest function object
- Workflow paid-checkout-expiry-sweeper never fired from a live/canonical path in this run — No trigger event discovered on the Inngest function object
- Workflow invoice-checkout-retirement-sweeper never fired from a live/canonical path in this run — No trigger event discovered on the Inngest function object
- Workflow invoice-sent-recovery never fired from a live/canonical path in this run — No trigger event discovered on the Inngest function object
- Workflow pulse-instant-watch never fired from a live/canonical path in this run — No trigger event discovered on the Inngest function object
- Workflow affiliate-payout-run never fired from a live/canonical path in this run — No trigger event discovered on the Inngest function object
- Workflow affiliate-payout-autopay never fired from a live/canonical path in this run — No trigger event discovered on the Inngest function object
- Workflow meet-transcript-sweeper never fired from a live/canonical path in this run — No trigger event discovered on the Inngest function object
- Workflow meta-campaign-sync-sweeper never fired from a live/canonical path in this run — No trigger event discovered on the Inngest function object
- Workflow clickfunnels-analytics-sweeper never fired from a live/canonical path in this run — No trigger event discovered on the Inngest function object
- Workflow watch-curve-diagnosis-sweeper never fired from a live/canonical path in this run — No trigger event discovered on the Inngest function object
- Workflow subscription-billing-sweeper never fired from a live/canonical path in this run — No trigger event discovered on the Inngest function object
- Workflow partner-production-floor never fired from a live/canonical path in this run — No trigger event discovered on the Inngest function object
- Workflow doc-check-retry-sweeper never fired from a live/canonical path in this run — No trigger event discovered on the Inngest function object
- Workflow inquiry-call-sweeper never fired from a live/canonical path in this run — No trigger event discovered on the Inngest function object
- Workflow next-action-catch-up never fired from a live/canonical path in this run — No trigger event discovered on the Inngest function object
- Workflow slo-infinite-drip never fired from a live/canonical path in this run — No trigger event discovered on the Inngest function object
- Workflow meta-campaign-sync-hourly never fired from a live/canonical path in this run — No trigger event discovered on the Inngest function object
- Canonical event survey.submitted has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event booking.rescheduled has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event booking.cancelled has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event setter.no_answer has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event decision.rendered has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event sale.closed has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event file.finalized has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event payment.failed has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event payment.expired has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event payment.canceled has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event payment.refunded has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event payment.disputed has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event inquiry.gate.raised has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event inquiry.gate.clear has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event inquiry.docs.needed has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event letter.generated has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event message.queued has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event message.sent has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event message.failed has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event message.blocked has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event commission.earned has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event commission.approved has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event commission.paid has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event invoice.created has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event invoice.partially_paid has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event invoice.paid has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event invoice.voided has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event contract.sent has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event contract.signed has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event repair.enrolled has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event repair.docs.needed has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event repair.docs.complete has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event repair.analysis.complete has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event repair.analysis.empty has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event repair.letters.ready has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event repair.letters.sent has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event repair.letters.delivered has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event repair.response.received has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event repair.response.parsed has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event repair.parse.low_confidence has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event repair.response.retake has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event repair.item.deleted has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event repair.item.verified has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event repair.item.updated has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event repair.item.unaddressed has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event repair.round.complete has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event repair.round.escalated has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event repair.program.complete has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event repair.stalled has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event repair.cancelled has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event partner.approved has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event diy.package.requested has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event diy.package.generating has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event diy.package.ready has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event diy.package.delivered has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event diy.package.downloaded has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event subscription.started has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event subscription.renewed has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event subscription.past_due has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event subscription.canceled has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Canonical event subscription.completed has no workflow listener — May still have a bus handler in src/handlers/*.mjs — check emitters separately in cross-cutting.
- Proxy session credential isolation between advisors — status=401
