# Money Setup professional layout

Retained sole page builder: `/root/page_money_setup`.

## Before / after feature matrix

| Before inventory | After |
|---|---|
| `GET /api/money/setup`; cookies/Bearer token | Same module and request contract, unchanged |
| Real four-step completion/current step/date values | Unchanged, no fabricated progress |
| POST `start_checkout`, checkout resume, paid/entitled reload guard | Unchanged |
| POST `request_soft_pull`, signed approval URL, pending/completed soft pull | Unchanged |
| Unknown price `$X`, no pay action without price, container prices/count | Unchanged; no replacement sample values |
| Accounts add/add-more, Credit and Open Money links | All retained |
| Loading skeleton; offline/database/permission/not-found errors; retry; action busy/error messages | All retained |
| Staff client_id forwarding, staff sign-in and finance desk back link | Unchanged and browser asserted |
| Client navigation | Shared integration owns the 16-option Money selector and workspace link; exact Setup destination asserted |
| Native buttons/links and live regions | Retained; keyboard checkout and touch soft-pull/retry exercised |

## Layout

Warm neutral cards, clear 30px page heading, 18px section headings, numbered setup checklist, black current-step marker and leading rule, black primary checkout, white outlined secondary actions. Cost detail sits beside steps on desktop and stacks on small screens. No gradients/glass/pastel status. All existing data/actions stay in `money-setup.js` unchanged.

Page-specific selectors target `#setup-root` and `#fos-setup`; no bare shared `.card`/`.step`/`.head` selectors. Lead must load this stylesheet on FinanceOS for embedded Setup styling; host integration and header/nav owned by lead. Latest captures use the shared warm client header after lead integration; FinanceOS workspace link is reachable through Account, verified with an open/close interaction.

## Checks

- `node --test src/http/money-setup-screen.test.mjs src/http/money-setup.test.mjs src/finance/money-setup.test.mjs`: **61 pass, 0 failed, 0 skipped**. Mocked DB contracts, not live DB proof.
- `PLAYWRIGHT_CHROMIUM=/workspace/scratch/browser-tools/chromium npx playwright test e2e/page_money_setup.spec.mjs --workers=1 --reporter=line`: **3 passed**, widths1440/390/320, real Chromium, external requests blocked, APIs intercepted, no live writes.
- Browser states: full, unset price/zero containers, all done/entitled, server error/retry, held loading skeleton. Viewport overflow assertion each state. Real server-shaped client session activates shared client foundation; staff session does not activate client theme.
- Keyboard Enter checkout and touch soft-pull/retry use safe failed responses; payload assertions verify exact existing actions. No charge/pull performed.
- Captured full/empty/done/error/loading PNGs at all three widths; inspected1440,320 and latest390 full PNGs.
- Root owns combined lint/TypeScript/full regressions and final shared integration. No performance timing or live DB acceptance claimed.

## Exact changed files

- `public/app/money-setup-ios.css`
- `e2e/page_money_setup.spec.mjs`
- This evidence note and `page-money-setup-{1440,390,320}-{full,empty,done,error,loading}.png` alongside it.

No HTML/JS API edits, deploy or commit by page builder.
