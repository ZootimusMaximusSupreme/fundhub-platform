# File protection alerts — page_money_alerts

Owned page: `public/app/money-alerts.html`. Added scoped page stylesheet; original `money-alerts.js` and `money-alerts.css` unchanged. Approved visual reference: `company-ux-refresh-2026-10-18/client-portal-home-preview.html`. Styling activates only through shared session check for principal `client`; staff retains previous page appearance.

## Before / after feature inventory

| Existing feature / conditional state | Preserved implementation |
| --- | --- |
| Read own alerts; staff selected client file | GET `/api/money/alerts`; existing module and client context unchanged |
| Four protection switches: payment timing, promo ending, cash reserve, new credit | Existing `role=switch`, On/Off wording; POST `set_alert` kind/enabled |
| Missing statement day, save multiple days, change day, cancel, validation and saving/error feedback | Existing controls; POST `set_statement_close_day` account_id/day; server re-read |
| Add/change promo with end-date and APR fields; input validation | Existing form; POST `set_promo` account_id/ends_on/apr_pct; server re-read |
| Remove promo confirmation / keep it | Existing named confirmation and null ends_on write |
| Upcoming texts, promo schedule, separate business/personal reserve, recent texts / show all / show fewer | Existing data rendering, thresholds, history and expand control |
| No account; unknown/null amounts; unenrolled; STOP; disabled alert | Existing empty state, notices, honest amounts and blocked next-text labels |
| Loading, offline/database/server/forbidden/not-found/bad-request errors, retry | Existing module, skeletons, worded errors and retry control |
| Session expiry sign-in handoff | Existing 401 behavior |
| Portal back; seven Money navigation links; staff client_id carried through links | IDs/hrefs and existing initialization unchanged; Alerts current-page marker retained |
| Links/jumps to accounts/setup/needs-day/cash sections | Existing generated links, buttons and anchors retained |
| Touch/keyboard, focus, status announcements and form labels | Existing semantics retained; client controls have 44px floor and shared focus ring |

Visual changes: soft canvas, rounded cards, pastel summary tiles, segmented Money navigation, shared sidebar/mobile dock, native system typography. No new APIs or outbound operations. No demo data introduced here; screenshots use repository fixture via intercepted API.

## Verification

- `node --test src/http/money-alerts-screen.test.mjs`: 42 tests pass, zero skips. Includes all writes, invalid date/day, failure handling, remove confirmation, null amounts, staff scoping and 401.
- `PLAYWRIGHT_CHROMIUM=/workspace/scratch/browser-tools/chromium npx playwright test e2e/page_money_alerts.spec.mjs --workers=1`: 4 passed (8.0s), zero skips. three client widths, four states, keyboard switch writes and promo editor/cancel; separate staff context/style proof. Browser API mocks only, no real records or messages.
- Screenshots: `page_money_alerts-{full,empty,error,loading}-{1440,390,320}.png`.
- Full lint/TypeScript/performance and real database authorization proof belong to lead's integrated verification; this page's scoped browser tests do not claim database proof.
