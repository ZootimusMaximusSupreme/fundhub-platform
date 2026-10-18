# money-transfers — page preservation and proof

Single builder: page_money_transfers. Dedicated standalone route retained; no new endpoint, redirect, role rule, or transfer behavior. Client presentation follows approved pale canvas, rounded cards, dark summary, shared sidebar/phone navigation. Staff receives original styling because activation requires the real session response `principal: client`.

| Before feature | After |
|---|---|
| GET `/api/money/transfers`, own client session; staff `?client_id=` | Original module unchanged |
| Back to portal; staff back to Finance OS; seven FinanceOS hash links with client ID propagation | Original IDs, destinations and logic retained |
| Loading skeleton; auth redirect; forbidden/offline/not found/database/error + retry | Original module unchanged; loading/full/empty/503 retry exercised |
| Sandbox/off/live banner and transfer limits | Original truth and state words retained |
| Waiting proposals, amount/date/destination/reason, blocked card/loan transfers | Original render retained; full fixture and blocked card exercised |
| Source account selector/hidden single account; review → exact sentence → explicit approval; go back | Original controls retained; keyboard review, back, rejected approval exercised |
| Not now / stop with native confirmation; POST cancel | Original handlers retained; no live writes performed |
| History, status steps, timeline details, approval terms | Original render retained; timeline expand exercised |
| Staff propose/cancel; staff cannot approve | Original module unchanged; staff with client ID verified no review control and no client theme |

Files: `public/app/money-transfers.html`, `public/app/money-transfers-ios.css`, `scripts/page_money_transfers-browser.mjs`, this evidence and `page_money_transfers-*` screenshots/JSON.

Verification: `node --test src/http/money-transfers-screen.test.mjs`: 22 passed, no skips. Browser script passed at 1440, 390 and 320px; verified actual session-based activation, all four UI states, no whole-page overflow, keyboard Enter, exact confirmation visibility, safe mocked POST failure message, retry recovery, expanded history and staff theme isolation. Twelve screenshots generated (four states per width). Visually inspected 390px full capture; no clipping observed. Screenshots are approval drafts with synthetic existing repository test fixture, not production data or proof of successful bank movement. No observed issue requiring a red-box correction screenshot.

Limitations: successful real approval/cancel/propose and account authorization require scratch database/service checks, not this mocked browser run. No bank writes or real money movement. Full lint/TypeScript/performance budgets delegated to lead; no production Slow 4G/CPU performance claim. No shared module/API edits or board edits.
