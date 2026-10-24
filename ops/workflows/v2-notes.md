# V2 notes — fixes wanted, built later

Started 2026-10-24 (launch weekend). Nothing on this list gets built this weekend.
Chris clicks. The AI writes down what he says. Every fix goes here.

## How to log one

One row per fix. Fill all five boxes.

- **Date** — the day Chris said it
- **What** — the fix, in one short line
- **Where** — the page link or the file
- **Why** — what felt wrong, in his words if he said it
- **Priority** — `V2 — not this weekend`, or `Before Monday` only if a client sees it before ads go on

## The list

| # | Date | What | Where | Why | Priority |
|---|---|---|---|---|---|
| 1 | 2026-10-24 | Ad spend is not landing. The newest ad day saved is Oct 7. The last day with spend is Oct 4 ($120.21). The sync job still runs each night. | Table `ad_metrics_daily`; check `meta-sync` (green) | We can not see cost per booked call in the CRM yet. Ads were off since about Oct 5, so there was no new spend to save. | V2 — not this weekend. Monday: track cost per booked call in Ads Manager. Tuesday 7 a.m.: look for an Oct 26 row. |
| 2 | 2026-10-24 | Money is not connected to the dashboard. | Owner dashboard / money tiles | Chris named it. | V2 — not this weekend |
| 3 | 2026-10-24 | Calendar-host check: retire it, or mark it "expected". Chris is the only host. | Check `closer-setup:calendar-late` (`src/pulse/coverage/gap-closer-setup.mjs`) | Justice Nikkel and Sarah Blankstein were asked Oct 7, due Oct 10, never joined. It stays red every day. | V2 — not this weekend. One-line owner decision. |
| 4 | 2026-10-24 | Stop counting the same break twice. | Scorecard rows `job:finance-os-money-agent` + `07-finance:finance-os-money-agent`; the two commission ledger rows | 7 red rows are really 5 breaks. | V2 — not this weekend |
| 5 | 2026-10-24 | 23 weak catalog points need a real live check (level 3). | `src/pulse/catalog/generated.json` | Their best check today is level 2. List is on the weekend board, section 5. | V2 — not this weekend |
| 6 | 2026-10-24 | Rebuild the catalog. | `src/pulse/catalog/generated.json` (last built Oct 15, commit `676507d3a`) | 8 days old. New pages since then are not in it. | V2 — not this weekend |
| 7 | 2026-10-24 | Playwright desk sweep is stale. | Check `live-playwright:desks` | Last run 375 hours ago (about 15 days). Last result was 41 of 41. | V2 — not this weekend |
| 8 | 2026-10-24 | Money agent times out. | Job `finance-os-money-agent` | Red every morning. | V2 — not this weekend |
| 9 | 2026-10-24 | Commission ledger is empty. | Commission ledger page tiles + table | Red two times on the scorecard for one break. | V2 — not this weekend |
| 10 | 2026-10-24 | One creative-factory script is missing a label. | Creative factory scripts (1 of 35) | Red on the scorecard. | V2 — not this weekend |
| 11 | 2026-10-24 | Ad-to-teleprompter pipeline drift. | Grok's plan: `ops/workflows/drift-free-plan-2026-10-24.md` | Chris named it. Grok owns the plan. | V2 — not this weekend |
| 12 | 2026-10-24 | Cut bank links down to Giovanni's banks only. | `lenders` table (1,106 rows, 1,057 Apply links); shown on `/app/lenders.html`, the lender match list, `/app/money-banks.html` | Chris wants only Giovanni's banks. His list is not in the repo or database yet. | V2 — not this weekend. Needs the list first. |
| 13 | 2026-10-24 | Old ClickFunnels `/order` page can still take a real $297 payment. Nothing links to it. | https://apply.fundhub.ai/order | Landing page cleanup. From `docs/tracking/page-inventory.md` row 9. | V2 — not this weekend |
| 14 | 2026-10-24 | Old $297 pages are still up: `/roadmap/`, `/roadmap/pay.html`, `/roadmap/pull.html` on fundhub.ai. | https://fundhub.ai/roadmap/ | Landing page cleanup. Live traffic uses apply.fundhub.ai/roadmap. | V2 — not this weekend |
| 15 | 2026-10-24 | The "Meeting with Chris" calendar carries none of our tracking. | https://apply.fundhub.ai/schedule/phonecall | Landing page cleanup. Packs and `/optimize` link here. | V2 — not this weekend |
| 16 | 2026-10-24 | Cortana: named funnel events, ad-to-booking ID, and the server feed are still missing. | `ops/workflows/cortana-link-audit-2026-10-20.md` | Pages have the tag. Cortana can not yet match a booking to an ad. | V2 — not this weekend |

Add new rows under row 16 as Chris talks.
