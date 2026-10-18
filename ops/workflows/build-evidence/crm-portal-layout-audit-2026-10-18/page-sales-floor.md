# Sales floor recovery — 2026-10-18

Recovered by the original sole page builder from retained tool-argument history after the executor and scratch filesystem became unavailable. Recovery branch: `codex/recover-sales-floor`. Reconciled against production main `0998ff49969c6e2663a6e1851b4634ab5896113d` using the GitHub connector. The current page HTML/JS were inspected before replaying the page-only patch. Current aside markup remains byte-for-byte unchanged here; root integrates the canonical staff sidebar, shared tokens, header and account from PR71.

## Feature preservation

| Contract | Recovered behavior |
| --- | --- |
| Roles | Existing shared owner/admin/sales-manager access and closer redirect remain unchanged. |
| APIs | Same `FHData.read("sales-floor")` / GET `/api/read/sales-floor`; same POST `/api/marketing-flags` payload and POST `/api/company-brain/sync {}`. No API, schema, money, recording or security writes were made during recovery. |
| Today / conversion | Daily deposits, booked/held, target reason and deposit-to-funded rate/numerator retained. Empty target track remains in DOM but hidden. |
| Funnel | All five original stages, conversions and downsell cash retained; desktop row and phone rows. |
| Team | Every closer, shift/time, calls, close rate, funded rate, cash and next action retained. Phone cards display fields previously hidden by CSS. |
| Closer focus | All name buttons, previous/next wraparound, local no-read selection, closer metrics, action and closer offer stack retained. Keyboard focus and selected state retained after rebuild. |
| Offers | Every offer, units/sold/collected/total, retired code, unknown reason and separate unattributed block retained. Null stays Not recorded; known zero stays zero. Keyboard/touch scroll remains within the table. |
| Objections / sources | This/prior counts, bars/hot signal and eight-source limit retained. Conditional flag keeps exact payload, success/failure dialogs and nothing-sent semantics. |
| Recordings | Name/client, match status, Arizona timestamp, words state and escaped excerpt retained. Only HTTPS Drive/Docs URLs render with new-tab/noopener. Jump and sync controls retain IDs/actions. |
| Operations | Cold deposits, compliance reason, unlogged/unrecorded calls and unavailable discipline reasons retained. Unknown unrecorded count remains a dash. |
| States | In-layout loading, explicit error/retry, honest empty and full views. Refresh failure labels retained numbers. |
| Identity / navigation | Shared header owns identity/account. Local toolbar owns shift count/refresh; team/offers/recordings section anchors added. All original HTML IDs retained. |

## Files recovered

- `public/app/sales-floor.html`
- `public/app/sales-floor.css`
- `public/app/sales-floor.js`
- `e2e/sales-floor-layout.spec.mjs`
- `e2e/s1-sales-floor.spec.mjs` (funding-gap wording assertion only)
- `src/pulse/catalog/proofs/fin-b20-sales-floor.test.mjs` (shared account identity and empty wording)
- `src/pulse/catalog/proofs/fin-b20-repair-floor.test.mjs` (unavailable shift-time wording)
- `src/pulse/catalog/proofs/fin-b02-sales-floor-open.test.mjs` (empty wording)
- This feature evidence note.

## Verification status

**Recovery browser/lint/Node checks have not run.** The executor and filesystem are unavailable. Root must run the integration checks in GitHub Actions after merging this page with PR71. In-memory JavaScript syntax parsing and static original-ID/API/aside preservation checks completed during recovery; these are not browser passes.

Historical pre-loss evidence in this builder's retained conversation recorded 31 Playwright cases, 24 deep floor/read-model proofs, 3 baseline captures, syntax and diff checks passing. Those results are historical only and do not validate the recovery commit. The former 17 marked screenshots were not recovered as binary files and are not claimed as current evidence.

The recovered 17-case layout spec covers 1440/390/320 full, empty, loading and error states; a 27-closer fixture; all visible phone metrics; Enter/Space selection, wraparound and focus; mocked flag payload; safe Drive links; mocked sync; retry/stale-data labeling; touch targets/scroll; and null versus zero. It writes new review screenshots with red boxes/captions when run.

Integration commands:

```sh
npx playwright test e2e/sales-floor-layout.spec.mjs e2e/s1-sales-floor.spec.mjs e2e/sales-dashboards.spec.mjs --grep 'Sales floor|sales-floor|px|keyboard closer|marketing flag|failed load|phone touch|unknown discipline' --reporter=line
node --test src/pulse/catalog/proofs/fin-b20-sales-floor.test.mjs src/pulse/catalog/proofs/fin-b20-repair-floor.test.mjs src/pulse/catalog/proofs/fin-b02-sales-floor-open.test.mjs
node --check public/app/sales-floor.js
npm run lint
```

Local custom Chromium, when applicable: set `PLAYWRIGHT_CHROMIUM=/workspace/scratch/browser-tools/chromium` for Playwright config. The older Node browser kit launches its installed Playwright browser directly. No workflow edits, main ref changes or deployment were made by this recovery builder.
