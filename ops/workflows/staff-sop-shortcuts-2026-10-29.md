# Staff SOP shortcut — scoped acceptance (2026-10-29)

Owner request: on every relevant employee desk, a small document icon should open the **existing Company Brain** to the correct SOP/script context. No duplicate SOP store or fictional procedure, and no new AI product.

## Implementation and ownership
- One shared, accessible document icon is mounted by `public/app/shell.js` **after the authoritative staff session** resolves, in the existing `#fh-workspace-header .fh-workspace-tools` beside Search. It is a normal same-tab link; Back restores the desk.
- Exactly 12 desk/role-context mappings currently exist: setter, Sales Workspace/closer, Sales Floor, Pipeline/onboarding, bank outreach, lender maintenance, inquiry and credit repair, funding Client Control Panel, CSM queue/Blueprint, Operations, Finance OS, and Messaging.
- A finite `?sop=...` key opens the real `company-brain.html` Documents panel, with a descriptive context and a **Find approved instructions** button. That button calls the already-protected Company Brain search; it does not invent hard-coded procedures. Navigation alone sends **no** chat POST.
- Every API retrieval still checks server-side staff role, organization and document tier. The shortcut does not change pricing, permissions, customer data, workflows, consent, email, providers or credit pulls.
- Shortcut HTML files belong to other work lanes and are intentionally **not** edited. This change's only browser files: `shell.js` and `company-brain.html`.
- The accidental `Log Dial` **Undo** belongs to the front-house backlog, not this change.

## Role boundary / approved STAFF access
The existing Company Brain search, thread and uploaded-document APIs already use `ROLE_SETS.STAFF`, whose documented members are owner, admin, funding advisor, closer, inquiry specialist, setter, sales manager and CSM. The shared shell previously listed `company-brain.html` under `OWNER_ADMIN_ONLY`, hiding a server-authorized search surface from actual employees. This PR removes only that redundant **navigation-only** restriction; it does not change any staff permissions or backend routes. All mapped employee desks now use the same server-enforced Company Brain tiers: `public`, `sales`, `staff`. The `owner` document tier remains available only to owner/admin, and owner-only review approvals remain owner-only. Source: `src/company-brain/access.mjs`, `api/read/company-brain.mjs`, `api/company-brain/upload.mjs`, `api/company-brain/reviews.mjs`.

`outbound_rep` is **NOT in** `ROLE_SETS.STAFF` and has no Company Brain read permission. It remains excluded; customer, affiliate and partner portals are also excluded. No synthetic document or newly created SOP is claimed.

The owner reports SOPs and sales scripts already loaded into Company Brain; the shortcut searches role-cleared indexed sources instead of duplicating them. The Documents panel lists only local uploads, not the whole Drive corpus. To avoid showing regular employees owner-tier *upload names* from the existing org-wide upload inventory, the panel hides that inventory and never calls its GET endpoint for standard STAFF users; owner/admin inventory remains unchanged. Role-filtered search remains the path for staff SOP documents. Existing server-level inventory scoping is a separate hardening issue. Existence, approval status and visibility of specific live SOP files cannot be proven using mocked UI tests; live source indexing and staff view still require verification.

## Acceptance matrix (offline static browser + unit tests)
| Scenario | Expected |
|---|---|
| 12 staff dashboards | Owner/admin session: exactly one visible icon, matching topic |
| Setter dashboard | Refresh queue and CRM Search preserved |
| CSM dashboard | Refresh queue preserved |
| Owner viewing Setter desk -> Company Brain | Documents panel open, proper SOP heading, no POST until explicit Find |
| Find | Existing Company Brain search receives whitelisted topic prompt, gives sourced answer |
| Browser Back | Returns to caller's dashboard with icon |
| 390px phone | At least 44×44 tap target; documents open/close; no horizontal page overflow |
| No uploaded files | Honest empty state; search can still use approved Drive files |
| Unknown/malicious `?sop` | No context rendered; no arbitrary prompt or HTML |
| Setter, closer, advisor, CSM, specialist, manager | Role-specific shortcut visible; real Company Brain API tiers preserved |\n| `outbound_rep`, client, partner, affiliate | No SOP shortcut; no access to internal Company Brain |
| Live | Requires protected merge, full required CI, deployment proof; **NOT LIVE PROVED** while pending |

## Tests
- `src/http/staff-sop-shortcut.test.mjs`: exact page/role/topic inventory, no unapproved role widening, safe URL and explicit Send behavior.
- `e2e/staff-sop-shortcuts.spec.mjs`: offline browser tests with mocked API and fictional user profiles; no production writes.
- Run all required repo checks, including disposable Postgres and Playwright, then protected merge + deployment proof. If any gate fails, leave PR open and record exact failure; do not bypass.

Current status: **IMPLEMENTED ON FEATURE BRANCH; EXACT-HEAD CI PASSED; REVIEW, MERGE AND LIVE PROOF PENDING.**

## October 30 follow-up — action-level SOP links and discovery

**Why owner could not find the requested help:** PR #257 was merged (merge commit `7c2c9a0`) and its dedicated agent reported a successful production release, but it added a document **icon only in the shared header**. It did not visibly say "SOPs" or place small help links beside staff workflow steps. The owner specifically requested both role coverage and instructions at the place the employee works. This is a UI placement/coverage gap, not grounds to invent new SOP documents.

**This repair lane:** branch `fix/staff-sop-workstep-shortcuts-20261030`; owner of only `public/app/shell.js`, `public/app/company-brain.html`, existing SOP test files, and this board. All front-house, payment, Blueprint, fulfillment and Pulse agents retain their separate code ownership. No independent agent spawn capability in this chat, so this branch makes the fix directly.

- Existing 12 staff desktops plus Calendar, Documents, My Numbers, Staff & Access, Contract Templates and Consent are mapped (18 relevant staff workspaces). The header shortcut now says **SOPs** on desktop and retains the existing accessible icon at phone width.
- **29 small, contextual SOP links** are mapped to actual workflow headings: setter dial/triage/confirmation/handoff, closer funding/sales call, funding and credit tabs, CSM follow-up, inquiry/repair queue, lender and bank outreach, Sales Floor coaching, Pipeline handoff, Operations, Finance OS, Messaging, Calendar, Documents, performance, staff roles, agreement templates and consent. Setter and Finance OS dynamically refreshed sections are watched only inside their own container.
- Each link opens the same authenticated Company Brain Documents panel with a finite `?sop=` topic and **Find approved instructions**. No automatic AI send, no client IDs in links, no new SOP source store, no invented SOP contents. Searches still use existing role- and document-tier-restricted retrieval and source citations; unindexed or unapproved sources remain unverified and must not be treated as present.
- Existing employee role restrictions remain. The `outbound_rep` role, clients and partners do **not** gain Company Brain access or shortcuts. The Owner-only document approval boundary is unchanged.
- Regression tests extended to all 18 pages, topic whitelist, task links, setter redraw, funding / credit workflows and forbidden external staff. Required exact-head GitHub Actions 14 jobs, independent review, protected merge, main deploy and authenticated real-role / real-Company-Brain query are **not yet verified** in this code-only update. No production data, money, messages, consent or backend permissions were changed.

**How to accept after deploy:** open `/app/client-control-panel.html` as a funding advisor or owner, find **SOPs** near global Search, and **Funding SOP** beside the Funding tab section. Click it, then **Find approved instructions**. It must either return a cited approved SOP from Company Brain or explicitly say source unavailable, never a made-up procedure. Test the same at the Setter and Inquiry desks. If no indexed material appears despite prior uploads, check the Company Brain document approval/indexing separately; UI links do not prove index contents.

### October 30 exact-head repair and merge notes
- Reconciled the branch with the current main Knowledge Base (Ask/Training/Manage files), preserving approved-index UI and the recent timer stub for isolated navigation tests.
- Consent SOP is a sibling of the real heading, so exact authorization text survives. Documents SOP uses title whitespace, keeping the phone's first library row above the fold.
- The 320px closer funding header reclaims 15px of margin without reducing 44px button targets. Back preserves the funding-tab hash.
- Actual production approved source retrieval: NOT LIVE PROVED without a read-only authenticated employee session.

### November 1 independent exact-head audit
- PR #312 remains open at `c1ab9a112f2d5198527a900859d915b46c0db2ec`, mergeable, with zero submitted reviews. The exact-head [Actions run](https://github.com/ZootimusMaximusSupreme/fundhub-platform/actions/runs/41154545508) passed all 14 jobs. Its browser job passed all 16 staff SOP cases within 1,885 Playwright cases; the browser tests use mocked APIs.
- At 00:24 UTC, `main` was `7a15bf43fe806b96f50f1af59f12f3ca33d268a6`; #312 had not merged. Therefore this PR has no main deployment or live staff-path proof. A direct live asset read was unavailable because `fundhub.ai` did not resolve from this environment.
- No concrete source defect was found in the five changed files. Remaining release path: independent exact-head review, protected merge and successful Ship run, then authenticated employee checks of SOP placement and one approved-source search at Funding, Setter and Inquiry. The Find action writes Company Brain chat history, so that live query is excluded from the current no-live-writes audit.

### November 1 local candidate integration
- Candidate `69ffa0878c088032d83d8a703b75ca4b7d92c141` merged cleanly into this isolated #312 checkout. The merge changed no SOP-owned source or test file relative to the #312 branch.
- Focused proof on the combined tree: 7/7 SOP unit tests, 16/16 offline Chromium SOP browser tests on isolated port 43712, TypeScript `--noEmit`, and lint across 4,462 files and inline scripts passed. This local merge is not a GitHub update or live proof.
