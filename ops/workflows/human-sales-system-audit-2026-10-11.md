# Human Sales System Audit — 2026-10-11

Owner: Chris Stanbridge
Canonical repo: `ZootimusMaximusSupreme/fundhub-platform`
Branch: `main`

## Task board

| Workflow | Owner | Status | Scope |
|---|---|---|---|
| Drive source audit | Current session | done | Cole Gordon material, human setter/closer scripts, trust assets, CRM source files |
| GitHub/repo audit | Current session | done | Sorting Hat direct-book path, setter/closer system, presentation, e-book offer wiring |
| E-book decommission | Current session | done | Retired the exact e-book CRM offer and refused the old API action |
| Operator gap map | Current session | done | Lead → setter → trust assets → closer → offer → payment → handoff |

## Drive sources found

- Folder: `Cole Gordon Ops n Shit`
- `Fundhub_Closer_Script_FINAL.md` — multiple Drive copies found
- `Back End Sales System`
- `Fundhub.ai SALES Script` — found, but the fetched copy is empty
- `FUNDHUB.AI — SOP 01: Sales Call & Pre-Qualification`
- `Setter Pre Call Best Practices SOP.docx`
- `Setter Systems & Processes` documents
- `Show Rate & Sales Ops Training.docx`
- `Fundhub AI Setter System — Developer Build Spec`

## Change manifest

Changed for this task:

- `public/app/present.js` — removed the e-book price box, button, state, and action.
- `api/closer-deck.mjs` — removed the `send_ebook` action.
- `src/sales/closer-deck.mjs` — removed the placeholder-PDF e-book sender.
- `api/payment-links.mjs` — corrected the closer action comment.
- `src/http/closer-deck-endpoints.test.mjs` — proves the retired action returns `unknown_action`.
- `src/http/closer-deck-present.test.mjs` — proves the Present source has no e-book control.
- `docs/journeys/CHANGELOG.md` — recorded the role-closer change. No route or role gate changed.

Not changed:

- The catalog offers and normal pay-link flow remain.
- The Sorting Hat book/VSL path remains.
- Historical journey entries, the old placeholder asset, and generated pulse files remain as history/support data.

## Operator gap map

| Operator piece | State | Ground truth |
|---|---|---|
| Human setter script | Partial | Drive has setter SOP and process material. Repo has an AI setter, not a complete human setter script. |
| Setter call timing | Partial | Drive has pre-call/show-rate material. Repo has the pre-call launcher, but not one human setter timing card. |
| Setter notes and handoff | Partial | The booking and closer records exist. A single human handoff template is not in the repo. |
| Trust-asset sequence | Partial | Drive has the source material and repo has post-booking trust content. One approved send-by-stage sequence is not yet consolidated. |
| Closer call script | Present | Drive has `Fundhub Closer Script`; repo has the closer playbook, ramp, drills, and Present cockpit. |
| Offer decision tree | Present | The closer playbook and Present offer/pay-link controls cover the current path. The temporary e-book branch is now retired. |
| Objection drills | Present | `docs/sops/company-resources/closer-ai-drills-2026-08-24.md` and the closer playbook cover drills. |
| Daily scorecard | Partial | Sales-manager material names the measures, but one human operator scorecard is not consolidated. |
| Practice loop | Present | The closer ramp, AI drills, and Sarah final gate define the practice path. |

## Blockers / open questions

- `npx tsc --noEmit` still reports one unrelated existing error in `src/marketing/filmed-receive.mjs:159`. It is outside this task and was not changed.
- Browser proof: `npm run test:e2e -- e2e/ccp-present-param-aliases.spec.mjs e2e/crm-flows.spec.mjs` — 41 passed.
- Unit proof: focused closer tests — 63 passed; full suite — 83 passed and 1,005 skipped by the repo's no-`DATABASE_URL` guards.
- `npm run lint` passed. Typecheck has only the unrelated error above.
- No live signed-in browser session was used; the browser proof used the repo's local static test harness.
