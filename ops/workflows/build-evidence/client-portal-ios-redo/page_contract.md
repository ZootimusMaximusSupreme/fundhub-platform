# page_contract — dedicated signed-link document page

Assigned ownership: `public/contract.html`, `public/contract-ios.css`, `e2e/page_contract.spec.mjs`, this evidence. No shared assets, API, board or existing tests changed.

## Before / after feature matrix

| Existing feature or state | Before | After |
|---|---|---|
| Access | Root unauthenticated page; no staff shell or bearer token | Preserved; page-owned CSS only, static public activation; no `/app/` imports |
| Link credential | Complete original query passed to GET/POST `/api/contracts/sign`; file adds `file=1` | Unchanged |
| Link errors | Incomplete, expired 410, invalid 404, server/network failure | Same guarded messaging; accessible alert |
| Sequential signers | 409 not-your-turn; signer names/roles/status only | Unchanged; responsive chips |
| Text document | Server title/body, prewrapped text | Same content/IDs; readable rounded card |
| PDF | Vendored PDF.js/worker, sequential canvases, fractional overlays | Unchanged rendering and fractional positions |
| PDF input | Locked values; required/optional text/checkbox/signature/initials | Preserved; text labels and keyboard checkbox/signature activation added |
| Consent | Exact server statement; typed name; checkbox; required fields gate both Sign controls | Unchanged |
| Submit | POST signer_name, agreed, field_values; duplicate disabled while signing; errors retry | Unchanged |
| Signed | Own/all signers signed; saved name/time, pending other signatures | Unchanged |
| Copy | Download shown only all-signed; signed file GET; PDF filename; failure feedback | Unchanged |
| Verification refusal | Changed document cannot be signed | Unchanged |
| Read-only | No signing controls when can_sign false | Unchanged |
| Decline | Existing internal `decline()` function has no visible trigger | Preserved as-is; no new action invented |
| Print | Hide signing panel/bar/status; readable document | Preserved |
| Loading | Loading title | Loading title plus reduced-motion-aware document skeleton |
| Empty | Missing/incomplete link is explicit error; server empty body renders faithfully | Preserved; no sample document injected |

No navigation or account session added to this security-sensitive signed-link surface. Existing isolation test required zero `/app/` imports: shared assets were removed and the dedicated public body activates page CSS statically without storage/session access. No real records/writes used. Existing 30-day link notice and portal Agreements path text retained.

## Verification

- PASS: 77 non-database tests, `node --test src/contracts/signed-link.test.mjs src/contracts/fields.test.mjs src/contracts/render.test.mjs`. No skips. Includes forged/expired/cross-document signatures and signer-owned fields.
- Browser proof authored: responsive 1440/390/320 full-page screenshots, exact mocked submit payload/no bearer, consent gate, signed/download failure, 410/404/409/read-only/mismatch/incomplete states, actual vendored PDF canvas and keyboard checkbox/signature/initials.
- PASS: `node --test src/http/contracts-screen.test.mjs src/contracts/*.test.mjs`: 347 tests, zero failures/skips. Includes public-page isolation and signed-link security.
- PASS: browser proof rerun with cloud executable `/workspace/scratch/browser-tools/chromium`: 4 tests. Actual vendored PDF renders; exact consent payload, no bearer, keyboard fields, guarded states, 1440/390/320 overflow checks pass.
- Screenshots captured: `page_contract-{1440,390,320}.png`, `page_contract-loading-{1440,390,320}.png`, `page_contract-error-{1440,390,320}.png`. Reviewed 390px full state: readable document, consent and both sign controls, no horizontal overflow. Earlier missing-browser run is superseded by successful cloud execution.
- PASS: `node --check e2e/page_contract.spec.mjs` and scoped `git diff --check`.
- Lead owns full lint/type/performance integration. No backend behavior changed. Database signing proof was not run and is not claimed.
