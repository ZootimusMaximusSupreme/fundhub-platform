# Contract — professional layout

Single retained builder: `/root/page_contract`. Page assets/tests only; no shared files, APIs, session behavior or board edited. No live signature, payment, message or customer writes.

## Before / after matrix

| Feature/control/state | Preserved behavior | Presentation after |
|---|---|---|
| Signed public access | Static public activation; no staff shell/assets, session/storage reads or bearer | Warm off-white, restrained thin spectrum, system rounded type |
| Credential/API | Original query intact to GET/POST `/api/contracts/sign`; copy adds `file=1` | No changes |
| Document | Exact server title/body, source and statement | Document beside signing task on desktop; stacked on phone |
| PDF | Vendored PDF.js, sequential canvases, fractional positions, locked/optional/required text/checkbox/signature/initials | Existing overlays and keyboard controls retained |
| Consent/sign | Typed full name + exact consent checkbox + fields gate both Sign controls | Black primary, outlined persistent secondary, clearer task heading |
| Result | Exact signer payload; errors retry; saved signer/time; other signers pending | Same IDs and handlers |
| Copy | All-signed only, exact file endpoint/name, failure feedback | Same control, neutral outlined styling |
| Guards | Incomplete/expired/invalid/409 waiting, verified mismatch, read-only | Accessible status/error text; no invented success |
| Decline | Existing internal function has no visible trigger | Unchanged; no new legal action |
| Loading/empty | Skeleton until answer; missing link explains fresh-link action | Neutral real-layout skeleton and explicit empty-link message |
| Print | Document stays; signing panel/bar/brand/status hidden | Clean single document column |

All HTML IDs, behaviors, APIs and static public activation unchanged in this pass. Only CSS and page test/evidence changed. No payment control exists on this page; nothing was added or removed.

## Verified

- `PLAYWRIGHT_CHROMIUM=/workspace/scratch/browser-tools/chromium npx playwright test e2e/page_contract.spec.mjs`: **5 passed**. Safe intercepted API fixtures only. Includes required-field/consent gates, exact payload/no bearer, signed/download error, expiry/invalid/waiting/read-only/mismatch, PDF keyboard checkboxes/signature/initials, actual touch tap through existing secondary Sign, and print media.
- `node --test src/http/contracts-screen.test.mjs src/contracts/*.test.mjs`: **347 passed, zero skips**. Includes signed-page isolation and signed-link/field security tests.
- Full/loading/error/empty-link screenshots and no-overflow checks at **1440, 390, 320**. Print screenshot included. Full 1440 and 390 images visually reviewed: side-by-side document/task on desktop, readable stacked controls on phone.
- Screens under `contract/page_contract-{1440,390,320}.png`, `contract/page_contract-{loading,error,empty}-{1440,390,320}.png`, `contract/page_contract-print.png`.
- Root owns combined lint/TypeScript/performance. No live session/database acceptance claimed. Mock fixture signatures are not legally binding live actions.

Exact changed source: `public/contract-ios.css`, `e2e/page_contract.spec.mjs`; this note and page screenshots are new evidence. `public/contract.html` needs no change for this presentation pass.
