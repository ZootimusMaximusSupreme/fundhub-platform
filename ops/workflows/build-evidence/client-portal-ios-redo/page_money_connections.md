# Connections — page implementation and feature matrix

Owner: page_money_connections. Files: public/app/money-connections.html and money-connections-ios.css. Shared module and all API handlers unchanged.

The before inventory was read from the standalone shell, money-connections.js, money-connections.css, and the FinanceOS direction document before editing. The standalone shell mounts the same module used inside FinanceOS. This update adds the shared verified-client foundation and a page-only skin; staff without the verified client attribute keep the original shell.

| Existing feature/control/state | After |
| --- | --- |
| Back to my portal, six Money navigation links, active Connections tab, client_id query forwarding | Same anchors, IDs, order and module forwarding |
| GET /api/money/connections; credentialed authentication, client resolution and forbidden/not-found states | Unchanged module and server authorization |
| Four totals, cents formatting, unknown dashes, prior-month comparison | Same rendering; pastel cards, larger readable figures |
| Commas, Whop, Open API provider cards; per-business selector | Same controls and data |
| Pull API-key/webhook mode selector; create connection | Same selectors and POST action create |
| Password key entry, save key, key suffix, sync, last-sync and partway/error reporting | Same handlers; POST actions api_key/sync, no stored-secret reveal |
| Webhook secret input, Save secret, copy webhook address | Same handlers; POST action secret and clipboard behavior |
| Open API one-time key reveal and copy | Same reveal lifecycle and copy action |
| Turn off confirmation, disabled state and failure feedback | Same handler and POST action disable |
| Per-business and aggregate month tables; foreign-currency notice | Same table contents; table-contained horizontal scroll |
| Loading skeletons, no businesses/Add a business, no processor, error/retry | Same render functions and controls; scoped card styling |
| Staff client context and FinanceOS embedded module | No module, API or embedded style edits |
| Keyboard/touch and reduced motion | Existing native controls retained; shared focus ring, 44px controls, reduced-motion rules |

Verified: `node --test src/http/money-connections-screen.test.mjs`: 17 pass, 0 fail, 0 skipped. This includes render states, provider controls, key security, context mounting and existing shell navigation. `git diff --check` passed for page files.

Browser follow-up: Chromium became available at `/workspace/scratch/browser-tools/chromium`. Ran `PLAYWRIGHT_CHROMIUM=/workspace/scratch/browser-tools/chromium npx playwright test e2e/page_money_connections.spec.mjs`: **14 passed, 0 skipped**. Full/loading/empty/error states at 1440, 390 and 320 pixels all have no document overflow. Twelve full-page PNGs are saved alongside this file as `page_money_connections-{state}-{width}.png`. Inspected the 390px full-page screenshot: processor controls and tables remain available, with table-contained scrolling.

The tests activate the actual shared script with an intercepted session `{ok:true, principal:'client'}`; no forced client attributes. Staff session remains unstyled and retains client_id propagation. Safe intercepted browser actions cover keyboard Enter on retry, business selection, create denial, save-secret clearing, API-key clearing, sync denial, copying an address, cancelling and confirming disable, and touch navigation to the existing FinanceOS connections tab. No real bank/provider or customer writes occur. All POSTs return a deliberate denial to verify no false success.

Not proved here: live provider integrations, production account authorization, real account datasets and integration lint/TypeScript (lead-owned). Existing shared/server checks continue to own those proofs. No page fix was needed from these observed browser results.
