# Bank relationship outreach — approved build

Owner approved the plan and implementation in chat on 2026-10-19. Backend and monitoring come first; dashboards last. UX uses GPT-6.1 Sol. Extra High is reserved for difficult integration/review.

## Ground truth

Launch states AZ, SC, FL, CA. Manual LinkedIn, email and calls. No paid vendor, AI call or automatic external send. Three initial reps through ordinary expandable staff seats. Reps work only their own banker list, never client files. Success is verified lender product data saved in the existing Lenders sheet; no invented quota or client referral workflow. Every touch saves the next action, immediately due unless deliberately scheduled. Verified active partners get monthly check-ins, quiet partners quarterly.

## Ownership and dependencies

| Workflow | Owner | Files | State |
| --- | --- | --- | --- |
| Backend | backend agent, GPT-6.1 Sol High | `db/migrations/483_bank_outreach.sql`, `src/outreach/*`, related new tests | Built; first real PostgreSQL run passed; review corrections awaiting repeat |
| Monitoring | pulse agent, GPT-6 Sol High | new `src/pulse/coverage/gap-bank-outreach*`, `src/pulse/beats/beat-bank-outreach*`, shared pulse registration files | Built; focused PASS/FAIL tests and first real PostgreSQL run passed; amended notes-parity proof awaiting repeat |
| Integration | parent | API routes, auth/nav, workflow, intended journey, CI, final proof and PR | Active |
| UX | UX agent, GPT-6.1 Sol High | `public/app/bank-outreach.*`, `e2e/bank-outreach.spec.mjs` | Built after backend/API proof; 32 browser cases and 8 final affected reruns passed |

Backend and monitoring contract work run together. UI implementation waits until backend/API work is built and tested. Parent owns this board; agents report here through parent to avoid overlap. Existing dirty checkout stays untouched; build base is `origin/main` at `842ebfc6e` in `/private/tmp/fundhub-bank-outreach.0jXudA`.

## Shared backend contract

Single role-scoped workspace `/app/bank-outreach.html`. Read `GET /api/read/bank-outreach`: query `id` returns detail; query `view=team` manager summary; default list/queue with `state`, `status`, `q`, `offset`, `limit` (25 default, 100 max). Every response includes `ok`, `canManage`, `program` and data as appropriate. List: `{items,total,summary,reps}`. Detail: `{account,contacts,activities,products}`. Team: `{summary,byRep,byState,reps}`. Summary fields: `verified_products_week`, `verified_products_previous_week`, `verified_partners`, `missing_next_action`, `due_now`, `total`.

Write `POST /api/bank-outreach` action: `import` (`source:fdic|ncua`, `csv`), `assign` (`id`, `staff_id` nullable), `save_contact` (`account_id`, optional contact `id`, name/title/linkedin_url/email/phone), `log_touch` (`account_id`, `contact_id`, `channel:linkedin|email|call|note`, `outcome`, `note`, `next_action`, optional `next_due_at`, optional `status`), `save_product` (`account_id`, optional product `id`, `product_name`, `lender_table`, `facts`, `evidence`, optional `lender_id`), `verify_product` (`id` product), `set_status` (`id` account, `status`, `next_action`, `next_due_at`, `partner_activity:active|quiet`). Import, assignment, verification are manager-only (`owner`, `admin`, `sales_manager`); rep records scoped by assignment and org. Product verification promotes a product transactionally into existing `lenders`, never arbitrary field writes. Re-verification updates only its own prior promoted row; linking an existing lender needs manager selection and never matches on bank name alone. Touch is append-only; assignment history retained. API errors have `statusCode` and plain `message`.

Storage: `outreach_programs` with key `bank_relationships`, states; `outreach_accounts` one `(org_id,program_id,source,external_id,state)` bank-state target; `outreach_contacts`; `outreach_activities`; `outreach_products`; `outreach_assignments`. All have org scope; related IDs are checked within org/account. Products have `facts` JSON and `evidence` text, `verified_at`, `verified_by`, `lender_id`. Facts keys: `minimum_score`, `minimum_time_in_business_years`, `minimum_revenue_threshold`, `bureaus_pulled`, `inquiry_tolerance`, `stated_income`, `eligible_states`, `application_url`, `paper_application_url`. Require a real answer or explicit `unknown` for each relevant fact, a reachable banker, source evidence and a real application path before verification. Unknowns never become false/zero in Lenders. Existing seven lender product categories are reused; no mortgages.

Exports from `src/outreach/store.mjs`: `readOutreach(db,{staff,query})`, `writeOutreach(db,{staff,body})`, `schedulePartnerCheckins(db,{now})`. `src/outreach/model.mjs` pure validation/constants. Store owns transactions and ownership checks even when invoked directly; handlers still gate role/session. No browser Supabase access. RLS restricted to server role, no anon/authenticated grants.

## Monitoring and proof

Monitoring contracts share actual tables above. Every page, route and job registered, every surface classified; promotion and lender correctness deep tripwire, hourly read-only beat, PASS/FAIL self-tests. Human overdue work is reported in dashboard/daily reminder, never treated as a broken machine on every hourly text. Deep checks catch verified product without live same-org lender/evidence/contact/facts and account with active work but no next action. New scheduled job uses shared Inngest client and leaves receipts.

Required proof: lint; actual configured TypeScript check; focused unit/API tests; disposable PostgreSQL migration, ownership and saved-result tests; browser control/state proof at 1440/390; mobile performance; full scratch E2E; built-bundle morning/hourly proof. Never call skipped or unrun proof green. Reviewable GitHub PR; show marked draft before production publication.

## Copy-paste workflow prompts

Backend: Implement only the approved outreach schema/model/store and meaningful database tests according to this board. Keep all queries org/assignee scoped and promotions transactional. Do not edit parent/API/UI/pulse files.

Monitoring: Implement heartbeat/deep result checks/hourly beat for the contracts here. Register every surface, PASS and FAIL tests, no writes or external sending. Do not edit backend/API/UI files.

UX: Use GPT-6.1 Sol. Inspect current professional CRM and use shared font/brand/shell/sidebar. Build role-scoped bank outreach workspace against this exact API only after parent signals backend/API proof. Include four states, desktop/phone control proof and sample evidence clearly labeled. Do not edit shared shell or backend.

## Evidence and leftovers

Owner rule change: split, then execute; no workflow approval pauses. Shared AGENTS, CLAUDE, Cursor rule and local startup reminders updated. This does not remove production go-live choice or tool permissions.

Reviewable draft PR: https://github.com/ZootimusMaximusSupreme/fundhub-platform/pull/77.

Local proof: full syntax lint, configured TypeScript, focused API/auth/access/workflow and navigation regressions passed. Browser fixtures (not live bank facts): 32/32 plus final affected 8/8. Desktop/phone 1440/390/320, manager and rep full/empty/loading/error, manual touch/contact/product/assignment, native CSV file upload, draft/published controls, retry, escaping, keyboard and Arizona due time in a New York browser. Mobile CDP lab: Slow4G/4x CPU, LCP 1.06s, CLS 0.00186, measured drawer interaction 88ms, JS 194,937 bytes, page 340,330 bytes. This is fixture/local proof, not Lighthouse, field INP, or production response time.

First GitHub scratch run 39375628131 applied all migrations and passed real saved-result/ownership/tripwire tests. Browser step: 25 passed and one exact-menu assertion failed because it still expected the pre-outreach menu; parent updated that assertion and added outbound role coverage. Later steps did not run. Independent review found history default-grant protection, a changed-lender promotion race and missing notes parity; agents repaired all three with regressions. Repeat scratch tests pending.

No production data changed, no live outreach sent and no production deployment claimed. Marked fixture previews live under `ops/workflows/build-evidence/bank-outreach/`.
