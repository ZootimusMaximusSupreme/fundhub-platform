# Connections professional refinement

Single builder: page_money_connections. Inventory read before edits: standalone HTML, section CSS/JS, existing browser and node tests, FinanceOS direction and shared assignment. This surface is merchant Commas / Whop / Open API connections. Plaid bank connection, reconnect and bank unlink controls belong to other modules; none were replaced or removed here.

## Before → after matrix

| Existing surface | Preserved result |
| --- | --- |
| Credentialed GET /api/money/connections, POST create/secret/api_key/sync/disable | Same handler functions, schemas, IDs and authorization |
| Three provider setup forms, entity and pull/webhook mode selectors | Setup opens immediately with no existing connection; additional-business setup uses a labelled native disclosure below existing connections |
| Existing connection identity/status, pending secret/key, disabled state, event counts and timestamps | Primary management area, before optional new setup |
| Pull password field, API suffix, sync, partial/failed sync, secret replacement | Same controls and clearing behavior |
| One-time API-key reveal, webhook/open-API address copying | Same lifecycle and clipboard action |
| Disable confirmation and history retention | Same confirmation, POST and failure handling |
| Four month figures, null dash vs real zero and comparisons | Compact neutral metric group, same numbers |
| Business/aggregate monthly tables and currency notices | Same data, contained table scrolling |
| Loading/empty/error/retry and add-business link | Preserved with quiet neutral panels |
| Portal return and compatibility Money links, staff client_id propagation | Preserved; lead's unified native section picker for verified clients |
| Client/staff gates, read-only provider semantics and server sample guard | No server or financial action changes |
| Embedded FinanceOS section | Same module with CSS scoped also to exact #fos-connections mount; lead must bundle CSS |

Removed pastel backgrounds and large generic title treatment. Neutral 18px panels, 32px page title/metrics, 20px provider heading, 13px supporting copy, 11px controls. Connection management now precedes adding another business. Native disclosures retain keyboard and touch controls.

## Exact checks

- `node --test src/http/money-connections-screen.test.mjs`: 18 passed, zero skipped.
- `node --test src/http/money-connections.test.mjs src/merchant/providers/providers.test.mjs src/merchant/sync.test.mjs src/merchant/store.test.mjs`: 49 passed, zero skipped. In-memory handler/provider proof; not a live database test.
- `PLAYWRIGHT_CHROMIUM=/workspace/scratch/browser-tools/chromium E2E_PORT=43213 npx playwright test e2e/page_money_connections.spec.mjs`: 14 passed, zero skipped.
- Full/loading/empty/error at 1440/390/320: screenshots `page_money_connections-{state}-{width}.png`, no document overflow. Desktop full screenshot visually inspected. Marked reviews `page_money_connections-review-{width}.png` identify the reviewed connection area.
- Actual shared verified-client activation with intercepted session; staff excluded. Keyboard retry, business selection/disclosure, denied create, secret clearing, API-key clearing, sync denial, copy, cancel/accept disable, native picker and touch workspace navigation tested. All APIs intercepted; no actual bank/provider/customer actions.
- Initial browser attempt: 13 passed / 1 failed because the old touch test targeted the removed six-link menu. Updated it to assert native Money section picker and tap workspace action; final run above passes.

No backend/credential/schema changes or real writes. Root owns combined lint/TypeScript and assembled FinanceOS browser verification. Live financial integrations and real-client production account checks remain outside this safe page test scope. No deployment or commit performed.
