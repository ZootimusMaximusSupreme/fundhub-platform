# Bank outreach — intended

Owner-approved build in chat, 2026-10-19. Success means usable bank product facts in the existing Lenders sheet. Source plan: `docs/specs/bank-outreach-plan-2026-10-14.md`; the manual launch and four launch states supersede its paid sending stack.

## Roles and one job

The outbound rep collects facts from assigned bankers. Their first question is “Who do I work next?” The owner/admin/sales manager assigns work and verifies completed product data. Their first question is “What lender data is the team adding?” One workspace has role-scoped work and team views. Seats use the existing staff invitation system.

## Saved-result journey

1. A manager imports official FDIC/NCUA CSV data. Arizona, South Carolina, Florida and California load first. Institution identifier and state make stable targets; repeating the file never wipes assignments, activities or facts. The same bank in different states remains separate.
2. The manager assigns bank targets to active same-company outbound staff. The rep sees only assigned records, including through direct API URLs. Reassignment leaves a history receipt and removes former-rep access.
3. The rep opens the next target and uses a bank/state/title LinkedIn search link. They save real banker name, title, email, phone and/or LinkedIn profile. Outreach sends happen manually in those tools; Fundhub does not send messages, scrape sites or incur data credits.
4. Every touch appends channel, outcome and note. It saves a next action and due time in the same transaction. The due time defaults to now. The rep may deliberately choose a later time. A save failure retains inputs; a successful save refreshes the queue.
5. The rep saves one product draft per bank product/category, with typed lender facts and source evidence. Unanswered fields remain unanswered or explicitly unknown. Unknown does not mean zero, false, or “all states.” Blank fields cannot masquerade as complete.
6. A manager verifies the product only when required facts have answers or explicit unknowns, source evidence exists, a banker is reachable and a real online/paper application path exists. Verification updates the existing Lenders sheet transactionally. It never chooses a lender row based only on a bank name. Any target lender belongs to this company and the same product category.
7. Repeating verification updates the linked lender product once. Verified products cannot disappear from reporting because of later rep edits; amendments need verification again. Facts used by lender matching remain auditable back to their outreach source.
8. A relationship reaches verified partner only with verified product data. Active partners receive a monthly next-action reminder, quiet partners quarterly. A daily shared-client job fills missing reminder work idempotently without replacing a rep's chosen next action. No automated external sends occur.

## Workspace acceptance

Rep: next due work first, assigned targets, search/state/status filters, paginated rows, editable banker detail, touch history, product facts and next action. Manager: the same work plus team view, import, assignment and verification. Visible controls are usable by the current role. No client files or full lender book are exposed to reps.

Use current `origin/main` professional CRM shell, shared rounded font, tenant brand, semantic statuses and sidebar. At 1440px and 390px show loading, empty, failed read and realistic full states. A table can scroll inside its container; the page cannot scroll sideways. Errors explain what failed and retain unsaved inputs.

Owner's 2026-10-20 dashboard-overhaul alignment request adds the approved shared Astra opt-in, foundation and staff cohort, loaded after legacy page styles. Preserve this workspace's role-first hierarchy rather than substituting a generic dashboard. Phone body and editable controls are16px; captions at least13px; interactive targets at least44px and primary actions preferably48px. Measure native WebKit dropdowns and expanded shared menus/forms at390/440 portrait and838x390 landscape, with768/1024 intermediate views. No sideways page overflow or unreachable bottom actions. Browser profiles are not real-device certification. Shared foundation must be integrated from its exact canonical release, not copied while moving.

KPIs count verified lender products this week compared with last week, verified partners and state coverage. Activity is supporting information. No guessed rep quotas. The observation period determines later targets.

## Monitoring and proof

Every new route/page/job has a registry entry and impact classification from day one. Deep morning checks and an hourly read-only beat inspect verified product → real same-company lender, contact, facts and evidence. Both passing and failing cases are tested. Human waiting/overdue work is shown as work due, never falsely called a dead machine. The scheduled job leaves a heartbeat receipt and is stale after three schedules.

Proof follows the actual saved journey in disposable PostgreSQL and through the real HTTP handlers, including rejection of cross-company and other-rep IDs. Browser fixtures prove controls and four display states, with scope labeled. Lint, TypeScript, focused regressions, full scratch E2E and built-bundle pulse proofs are recorded separately; skipped/unrun work is not a pass. Production publication requires the owner's draft choice.
