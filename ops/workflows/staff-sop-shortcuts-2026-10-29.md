# Staff SOP shortcut — scoped acceptance (2026-10-29)

Owner request: on every relevant employee desk, a small document icon should open the **existing Company Brain** to the correct SOP/script context. No duplicate SOP store or fictional procedure, and no new AI product.

## Implementation and ownership
- One shared, accessible document icon is mounted by `public/app/shell.js` **after the authoritative staff session** resolves, in the existing `#fh-workspace-header .fh-workspace-tools` beside Search. It is a normal same-tab link; Back restores the desk.
- Exactly 12 desk/role-context mappings currently exist: setter, Sales Workspace/closer, Sales Floor, Pipeline/onboarding, bank outreach, lender maintenance, inquiry and credit repair, funding Client Control Panel, CSM queue/Blueprint, Operations, Finance OS, and Messaging.
- A finite `?sop=...` key opens the real `company-brain.html` Documents panel, with a descriptive context and a **Find approved instructions** button. That button calls the already-protected Company Brain search; it does not invent hard-coded procedures. Navigation alone sends **no** chat POST.
- Every API retrieval still checks server-side staff role, organization and document tier. The shortcut does not change pricing, permissions, customer data, workflows, consent, email, providers or credit pulls.
- Shortcut HTML files belong to other work lanes and are intentionally **not** edited. This change's only browser files: `shell.js` and `company-brain.html`.
- The accidental `Log Dial` **Undo** belongs to the front-house backlog, not this change.

## Role boundary / known limitation
`outbound_rep` can see only `bank-outreach.html` in the shell and is **NOT in `ROLE_SETS.STAFF`**. The Company Brain search API rejects it. For that role the SOP icon intentionally does **not** appear; showing a dead link or widening confidential knowledge permissions would be unsafe. Authorized owner/admin staff visiting bank outreach see the shortcut. A distinct scoped outbound knowledge access decision would be needed before enabling this role.

The Company Brain Documents panel lists local uploads and quizzes, not necessarily the whole indexed Drive corpus. The contextual Find button searches documents the staff role can actually read and should return citations or a clear no-source response. SOP content completeness and which source files are approved **cannot be proven by UI tests**; inspect live role-specific Drive indexing separately. Do not claim an SOP exists simply because the quick-access button works.

## Acceptance matrix (offline static browser + unit tests)
| Scenario | Expected |
|---|---|
| 12 staff dashboards | Exactly one visible icon, matching topic |
| Setter dashboard | Refresh queue and CRM Search preserved |
| CSM dashboard | Refresh queue preserved |
| Setter -> Company Brain | Documents panel open, proper SOP heading, no POST until explicit Find |
| Find | Existing Company Brain search receives whitelisted topic prompt, gives sourced answer |
| Browser Back | Returns to caller's dashboard with icon |
| 390px phone | At least 44×44 tap target; documents open/close; no horizontal page overflow |
| No uploaded files | Honest empty state; search can still use approved Drive files |
| Unknown/malicious `?sop` | No context rendered; no arbitrary prompt or HTML |
| `outbound_rep`, client, partner | No shortcut / unauthorized access |
| Live | Requires protected merge, full required CI, deployment proof; **NOT LIVE PROVED** while pending |

## Tests
- `src/http/staff-sop-shortcut.test.mjs`: exact page/role/topic inventory, no unapproved role widening, safe URL and explicit Send behavior.
- `e2e/staff-sop-shortcuts.spec.mjs`: offline browser tests with mocked API and fictional user profiles; no production writes.
- Run all required repo checks, including disposable Postgres and Playwright, then protected merge + deployment proof. If any gate fails, leave PR open and record exact failure; do not bypass.

Current status: **IMPLEMENTED ON FEATURE BRANCH; CI AND LIVE PROOF PENDING.**
