# Next Steps — professional refinement

Sole assigned builder: /root/page_money_next. Implemented in money-next-ios.css only; no JavaScript, ranking, schemas, APIs, permissions or principal changes. Focused new browser test: e2e/page_money_next_professional.spec.mjs.

## Inventory and preservation matrix

| Before feature | After / proof |
|---|---|
| GET /api/money/tasks; ordered actual recommendation array | Same array, now visually numbered in its returned order; black first marker identifies priority without inventing progress |
| Title, why, due date, Late words, origin, can_do | All retained; clear title → timing/source → reason → assignee hierarchy |
| POST /api/money/tasks {action:do_task, task_id} | Unchanged; keyboard activation, failure recovery and successful server assignment verified |
| Assignment needs_approval / queued / claimed / done / failed / cancelled | Unchanged renderer; exact-amount approval warning preserved; no claim that money moved |
| Self-only step links, person/agent delegation eligibility | Unchanged; existing feature tests cover controls and links |
| GET and POST /api/money/ready-to-fund | Same endpoint/actions; request failure stays inline and cannot show success; successful response shows requested state |
| requested / csm_assigned / done / none status | Preserved; existing feature tests |
| Capital Blueprint owned gate and Book a call href | Preserved; browser verifies exact configured booking URL |
| Loading, empty, partial-source warning, classified errors, retry | Preserved; browser covers loading/empty/error/full at all widths; existing source-warning tests |
| Staff client_id context in links/API and staff return address | Unchanged and browser verified; no client style activation for staff |
| Signed-in client session and account permissions | Real existing auth/session presentation gate; all test API calls intercepted, no local role/attribute override |
| Shared Money section picker | Lead-owned .client-money-navigation retained; no conflicting local nav overrides |
| Standalone and embedded module | Scoped module CSS to #next-root and #fos-next, not other FinanceOS tabs; lead owns adding stylesheet to combined page |

## Visual result

Warm neutral canvas, white 18px cards, 32px desktop / 28px phone title, 18px section headings, 15px task reasoning, 13px metadata. Numbered ordered task list with a single dark first marker, clear action/status column, neutral funding panel, black funding request and white outlined secondary controls. Removed lavender funding panel, 28px cards, chunky pill controls and local chip-navigation rules. Existing late warning is semantic amber with words. No generic marketing headline, artificial step count or fabricated client data.

## Exact verification

- `PLAYWRIGHT_CHROMIUM=/workspace/scratch/browser-tools/chromium npx playwright test e2e/page_money_next_professional.spec.mjs`: 4 passed, 0 failed; full/empty/error/loading at 1440/390/320; no document overflow; native section nav visible; computed title <=32px; task ordering marker; keyboard task delegation; task failure recovery; exact-amount proposal; funding request error cannot show success; successful request; booking href; error retry; staff context and absent client activation.
- `node --test src/http/money-next-screen.test.mjs`: 19 passed, zero skipped.
- Screenshots `page_money_next-initial-{1440,390,320}.png` show original unacted full state. `page_money_next-{full,empty,error,loading}-{1440,390,320}.png` show tested states, full after safe fixture actions. Marked review copies `page_money_next-review-{1440,390,320}.png` outline ordered task/result evidence in red. Desktop full render visually inspected.
- All browser API responses are safe existing sample fixtures; no real account writes, payments, bank actions or messages.
- Combined FinanceOS embedded render, aggregate lint/TypeScript and performance budgets remain lead integration checks. No database test was run or claimed passed. Existing API/module heartbeat and tripwire routes unchanged.
