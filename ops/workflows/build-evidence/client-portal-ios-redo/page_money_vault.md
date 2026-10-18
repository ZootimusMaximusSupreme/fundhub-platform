# Funding papers — page_money_vault

Owned page: `public/app/money-vault.html`; page styles: `money-vault-ios.css`. Existing `money-vault.js` and shared section CSS unchanged. Read AGENTS, CLAUDE repo notes, UI/PERF rules, heartbeat, money-helper and repair-document journeys, document-vault contract, approved HTML visual source.

## Before / after feature matrix

| Existing feature / state | After |
|---|---|
| GET `/api/money/vault`, session-scoped client data | Same module and API; no fixture code in shipped page |
| Personal / business grouping, actual server counts, accepted / missing / uploaded / rejected / expired / waived | Preserved render functions, text and gates |
| Multipart `/api/documents-upload`, exact slot fields, PDF/JPG/PNG chooser, multiple documents, retry/validation feedback | Same module / controls / fields; keyboard chooser and intercepted safe upload verified |
| Signed `View` downloads, expiry refresh and new-tab safety | Same module and attributes; signed-link-shaped mock rendered in browser |
| Loading, empty paperwork, error/retry, full and completed state | Existing functions retained; four states at all widths; complete state covered by existing suite |
| Staff accept/reject, file classification, custom-paper form and client-id navigation | Module untouched; staff session does not activate iOS style; suite covers gates and actions |
| Eight money navigation links and back link, client_id forwarding | Original links and IDs retained; shared client navigation added only after verified client session |
| Keyboard, touch, reduced motion, upload/download permissions | Existing actions retained, 44px controls / focus shared styles; permission enforcement remains server-owned |

## Verification

- `node --test src/http/money-vault-screen.test.mjs`: 24 passed, 0 skipped.
- `node ops/workflows/build-evidence/client-portal-ios-redo/page_money_vault-browser.mjs`: passed headless Chromium with actual session activation (no forced client attribute), 1440 / 390 / 320 widths × full / empty / error / loading; zero page overflow.
- Keyboard Enter opens native file chooser. Safe intercepted PDF upload reaches existing POST endpoint. Staff principal remains unstyled. Download anchors rendered from safe signed-link-shaped mock. No real API writes, customer records, files, banking, payments or messages used.
- Screenshots named `page_money_vault-{state}-{width}.png`. These are full-page implementation previews; no issue is asserted or marked. Screenshot inspection found original brand heading token overrode intended large title; fixed by setting the heading's own token, regenerated all shots.
- Browser fixtures demonstrate UI only; database integration not claimed. Global lint / TypeScript and real download storage verification remain lead integration checks.
