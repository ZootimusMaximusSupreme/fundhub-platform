# Funding papers — professional layout

Builder: retained `/root/page_money_vault`. Presentation refinement based on Mac WelcomeView: warm neutral paper, restrained borders, rounded system typography, black primary upload, explicit next task. No module/API/schema changes. Read assignment, board, existing vault HTML/CSS/JS, fixtures and tests before editing; previous feature inventory remains valid.

## Before / after preservation

| Before | After |
|---|---|
| GET `/api/money/vault` with exact session/client_id scoping | Unchanged |
| POST `/api/documents-upload`, per-item slot/subtype/entity fields, PDF/JPG/PNG, chooser, multiple documents and validation messages | Unchanged module; safe intercepted PDF POST and error feedback proved |
| Signed file View links, expiry refresh, target/rel safety | Unchanged; all nine fixture links rendered |
| Server-derived ready count, missing / checking / expired / rejected / accepted / waived and completed states | Unchanged; quiet progress panel makes actual next upload explicit |
| Personal/business groups, reasons, reviewed files, other unfiled uploads | Preserved, with neutral grouped document rows |
| Staff accept/reject/classify/add-item forms and client-id forwarding | Unchanged; staff session still sees existing actions and does not get client styling |
| Loading / empty / error / full / no-list and retry | All existing functions retained; four main states browser checked |
| Navigation/back IDs, Money links, shared shell/navigation | Unchanged; root-owned shared header/navigation used |
| Combined FinanceOS module | Same code; CSS scoped only to standalone client money-vault and client `#fos-vault` |

## Files

- `public/app/money-vault-ios.css` — replaced prior blue/purple gradient and large marketing-like title with warm working-product layout; no global `.mbar`, `.mnav`, `main` or vault selectors leaking to FinanceOS panels.
- `e2e/page_money_vault_professional.spec.mjs` — state, keyboard, touch, role and CSS containment proofs.
- `page-money-vault-{1440,390,320}-{full,empty,error,loading}.png` — 12 full-page implementation previews, visually inspected desktop and narrow-phone full state. No issue asserted by these previews.

## Exact checks

`node --test src/http/money-vault-screen.test.mjs`: **24 passed / 0 failed / 0 skipped**.

`PLAYWRIGHT_CHROMIUM=/workspace/scratch/browser-tools/chromium npx playwright test e2e/page_money_vault_professional.spec.mjs --workers=1 --reporter=line`: **4 passed**. Covers 1440/390/320 × full/empty/error/loading; zero horizontal overflow; native chooser via keyboard Enter; intercepted safe PDF upload to original endpoint; error message retained; nine signed-link-shaped View anchors; touch Retry; staff controls and client-style gate. Fourth test verifies `#fos-vault` card changes while an outside `.card` stays untouched.

An initial browser assertion selected both valid aria-busy regions and failed strict locator uniqueness; fixed the test to target first busy region, reran all checks successfully. No product failure concealed. No real records/uploads/download storage/payments/messages/bank writes used. Real DB / live signed download integration and global lint/TypeScript remain root integration checks. No commits, deployment, migration or credential changes.
