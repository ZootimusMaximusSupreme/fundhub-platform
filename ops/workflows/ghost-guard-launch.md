# Ghost Guard launch — 2026-10-20

## Split

| Workflow | Owner | Status | Dependency |
| --- | --- | --- | --- |
| Ghost Guard launch plan and CRS pitch | this session | active | none |
| Licensed software access research | agent | complete | none |
| Ghost Guard logo | agent | saved and inspected | none |

All three run in parallel. Repository switch waits for Chris to name the destination repository; it does not block the plan, research, or logo.

## Copy-paste prompts

### Licensed software access research

Research a legitimate acquisition plan for commercial bank/financing software licenses and competitor tools for a financing company that does not make loans. Focus on public vendor partner, reseller, enterprise, sandbox, and API paths; do not attempt access to competitors' systems. Give a short, evidence-linked list of likely vendor categories, outreach sequence, and what Ghost Guard needs to validate licensed integrations. Do not edit product code or change any files. Add findings under your workflow row in this board only.

### Ghost Guard logo

Create a project-ready Ghost Guard logo for a red-team testing product. Brand should be serious, clean, and enterprise-safe: a minimal ghost silhouette integrated with a shield; dark charcoal, electric cyan, and a small signal-red accent; no skulls, weapons, locks, hacker clichés, or mock company badges. Provide a transparent raster mark with no text and record the saved file path and exact prompt on this board. Do not alter application code.

### Ghost Guard launch plan and CRS pitch

Define a first-version Ghost Guard offering that uses authorized red-team testing, with CRS as the first vendor integration target. Map the prospect-facing pitch, required permissions, test boundaries, evidence collected, and a short implementation sequence. Read existing CRS materials in this repository, do not change application code, and record verified paths and open decisions on this board.

## Notes

### Licensed software access research — complete

- Start with [CRS Get Started](https://crscreditapi.com/get-started): request a synthetic-data sandbox plus a platform-partner/enterprise consultation. Submit Ghost Guard's legal entity, non-lender business model, intended users, exact reports, volume, data-flow diagram, consent/disclosure flow, and security contact.
- Name the required product precisely: CRS's public LexisNexis reference documents Business InstantID, but it does **not** establish Top Business report entitlement. Ask CRS to confirm the Top Business product/SKU, enabled account entitlement, supported ordering API or portal, recipient/display/export rules, sample JSON/PDF, and pricing/minimums before any integration build. Evidence: [CRS LexisNexis API reference](https://crscreditapi.redoc.ly/openapi/reference/tag/LexisNexis/) and [CRS catalog](https://crscreditapi.com/resources/product-catalog).
- If CRS cannot provide that report and distribution arrangement, use the [LexisNexis Corporate Alliance Program](https://risk.lexisnexis.com/about-us/alliance-partnerships/corporate) for an integrator/reseller route.
- Evaluate companion licensed tools in their own approved environments: [Plaid synthetic-data sandbox](https://plaid.com/docs/sandbox/) for bank-data flows, then [LoanPro trial and partnerships](https://www.loanpro.io/faq/) for a financing-workflow license. Akoya, Mastercard Open Finance, MX, LendAPI and Taktile are documented alternatives in the report.
- For Ghost Guard testing, request a vendor or customer-owned test tenant and a written test scope. A normal product license/API credential is not permission to test other systems.
- Full report: `reports/Licensed finance software access.md`; source notes: `research_notes/Licensed finance software access/vendor_routes.md`. No vendor account, contact, license, or system access was created.

### Ghost Guard logo deliverable

- Selected asset: `assets/ghost-guard/ghost-guard-mark-v1.png` (1254 × 1254 PNG; alpha channel confirmed).
- Generated with the built-in imagegen tool. The selected second version uses a rounded charcoal ghost, cyan shield and eyes, and one red signal dot; no text. Visually inspected. The generated raster retains some edge speckling, so this is a usable concept asset rather than a pristine vector master.
- Original generation prompt:

```text
Use case: logo-brand.
Asset type: production raster logo mark for Ghost Guard, an enterprise red-team testing product.
Primary request: Create one original minimal ghost silhouette integrated seamlessly with a shield. Serious, clean, enterprise-safe identity, recognizable at small sizes.
Style/medium: flat vector-like geometry, crisp smooth edges, strong simple silhouette, restrained detail, balanced professional proportions.
Composition/framing: single centered logo mark on a square canvas with comfortable transparent padding. No presentation sheet or multiple variants.
Color palette: dark charcoal as the main fill, electric cyan as a controlled structural accent, one small signal-red accent.
Scene/backdrop: genuinely transparent background with preserved alpha.
Text: none.
Avoid: skulls, weapons, locks, hacker clichés, mock company badges, letters, words, watermarks, gradients, glow, shadows, textures, 3D rendering, backgrounds.
```

- Exact refinement prompt used for the selected final asset:

```text
Refine this Ghost Guard logo into a very simple enterprise logo. Keep only the ghost integrated with the shield and the charcoal/cyan palette. Replace the entire spiky flowing ghost with one compact rounded-top charcoal ghost with a straight-sided body and three gently rounded scallops at its base. Give it two small neutral round cyan eyes, not angry eyes. Enclose it within one clean continuous cyan shield outline. Add exactly one tiny signal-red circle at the shield's top-right corner. Perfectly smooth closed shapes and clean edges, no texture, distress, splatters, spurs, gradients, or glow. Flat solid colors. No text or other objects. Center the single mark with generous padding on a genuinely transparent background. Calm, serious professional software identity, readable at favicon size.
```

- Current repository branch: `codex/two-ios-apps-launch`.
- The working tree already contains unrelated changes. Do not edit or stage them.
- CRS business-report work exists in this repository; any future build must reuse its established provider boundary.

## Ghost Guard v1 — working plan

### What it sells

Ghost Guard is an authorized red-team service for companies that use licensed finance or bank-data software. It tests the customer's own approved setup and shows where a staff role, session, export, integration, or review step can be misused.

### First module: CRS integration check

The first Ghost Guard module is a **CRS business-report integration check**. It uses only a customer-owned CRS account, an approved sandbox or test file, and written testing scope. It does not use personal-report endpoints or attempt access to any vendor or competitor system.

### Customer pitch

> Ghost Guard pressure-tests the software you already pay for. We run agreed test cases against your own approved CRS setup, show exactly what happened, and give your team a short fix list with proof.

### v1 delivery

1. **Scope card:** customer, named CRS tenant, approved test accounts, start/end time, allowed actions, named stop contact.
2. **Test pack:** sign-in and role checks; report-search and report-order checks; data-export visibility; session timeout; audit-log coverage; failed-action handling.
3. **Evidence pack:** timestamped action log, request/response metadata with sensitive values removed, screenshots, result state, and a plain-English fix list.
4. **Closeout:** retest each fix and mark it proved or still open. No “all clear” result without completed evidence.

### Existing CRS foundation — verified in this repository

- Business search uses `POST /api/top-business-search/top-business-search`.
- The selected-business report uses `POST /api/top-business-report/top-business-report` and requires `seleID`, `orgID`, and `ultID`.
- The existing staff screen is `/app/lnr-business-report.html`; it calls the protected `POST /api/finance/lnr-business-report` endpoint.
- Focused checks were recorded as passing on 2026-10-13. Sandbox vendor proof and browser proof remain red because this environment could not reach the sandbox or bind Playwright's local server.

### Build order

1. Turn the scope card and evidence pack into Ghost Guard records in the destination repository.
2. Add a CRS test-run adapter that permits only the approved test tenant, named test records, and selected test cases.
3. Add the operator screen: start run, show each action, capture evidence, stop immediately, and export a findings report.
4. Run it against CRS sandbox first; live customer testing starts only after the sandbox run produces a complete evidence pack.

### Repo move

Do not move the current dirty Fundhub working tree. Start Ghost Guard in the destination repository once Chris gives its GitHub URL or name; carry only this plan and the final logo asset.
