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

The owner reports SOPs and sales scripts already loaded into Company Brain; the shortcut searches role-cleared indexed sources instead of duplicating them. The Documents panel lists only local uploads, not the whole Drive corpus. Existence, approval status and visibility of specific live SOP files cannot be proven using mocked UI tests; live source indexing and staff view still require verification.

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

Current status: **IMPLEMENTED ON FEATURE BRANCH; CI AND LIVE PROOF PENDING.**
