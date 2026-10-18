# Affiliate page preservation matrix

Owner: page_affiliate. Scope: public/app/affiliate.html and affiliate-ios.css; new e2e/page_affiliate.spec.mjs. No API, shared-file or role edits.

| Existing feature/control | After |
|---|---|
| Shell staff sidebar, collapse/group controls, role-filtered navigation | Original shell markup/handlers retained. Client-only styling activated by shared script. |
| Offer-specific server-built referral URLs, copy link and copy code | Original paintOfferLinks/copy handlers retained; dark iOS hero with readable inputs. |
| Identity, click count, rate spread, first-touch attribution | Original sources/calculations retained, unknown remains dash. |
| Referred/converted/accrued/paid KPI cards and honest tracking caveats | Original authenticated stats source retained; pastel client cards. |
| License/tax hold banners and identity/license chips | Original gate fields and visibility preserved. |
| Partner brain question, answer, approved source links and error/demo guard | Same POST /api/read/company-brain-affiliate; added accessible label/live status. |
| Message Blaster download, authenticated blob, demo guard and status | Same GET /api/gifts/message-blaster; added live status. |
| Referral funnel, tracked conversion denominator | Original source and calculation preserved. |
| Leads/payouts/terms tabs | Same panels/content; ARIA selection plus arrow/Home/End keyboard controls. |
| Status and business filters; unknown commission; known total caveat | Same handlers, server amounts, and NULL preservation; accessible field labels. |
| Payout table sorted date, amount/status/held reason | Original rendering retained. |
| Staff/client own affiliate read | Same bearer GET /api/read/affiliate-portal, no query identity or permission changes. |
| Empty/loading/error/full | Empty tables retained; new honest load status/error + retry. Unenrolled receives clear next step. |

Read AGENTS.md, relevant CLAUDE repo notes, UI/PERF standards, affiliate intended/actual, heartbeat flow, approved HTML. No new API/page/send path; existing heartbeat surface remains.

Verification: node --test src/http/affiliate-screen.test.mjs src/http/affiliates-self-read.test.mjs: 16 passed, 0 skipped. Initial Playwright affiliate-commission suite could not launch because installed browser executable absent; not a pass. Page-specific browser spec added for 1440/390/320, API loading/error/unenrolled/full, NULL commission, filters, keyboard tabs and screenshots. Run pending browser availability/shared foundation. No live customer writes, payments, outbound or bank actions used.

Known original limitation: KPI stats come from /api/read/affiliates; client principal cannot use that API. Their own row read fills referrals/rates/gates, and original KPI unknowns stay honest. Lead notified for any scoped server/demo integration. Client-only theme must be verified after shared script lands. Real referral enrollment persistence and permission proof belongs to lead integration.

## Corrected authenticated-client browser proof

Fixture now supplies actual `principal: client` and enrolled `affiliate.id`; tests assert `data-client-ios`, shared nav visible and old sidebar hidden without forcing attributes. Discovered and repaired legacy CRM sidebar + extra 228px padding at desktop, plus narrow tab wrapping. Page-only CSS hides legacy mobile menu when client nav replaces it; original staff behavior retained.

With PLAYWRIGHT_CHROMIUM=/workspace/scratch/browser-tools/chromium: existing commission browser suite 5/5 passed; corrected page suite 5/5 passed at 1440/390/320 and loading/error/retry/unenrolled/full, controls, keyboard tabs, filter, approved brain answer/source, download refusal. No database skips in these browser mocks; live permission proof remains lead-owned. Current screenshot artifacts page_affiliate-{1440,390,320}.png and -fold.png. Screenshots visually inspected; full-page screenshot fixed mobile nav remains pinned at captured viewport as expected. Client theme activates through real shared session path. No real outbound or download/write actions.
