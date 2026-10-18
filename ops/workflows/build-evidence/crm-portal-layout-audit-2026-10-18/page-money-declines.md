# Applications / decline defense — professional layout

Retained builder: `/root/page_money_declines`. Inventory completed from existing shell, module and tests before edits. Read assignment, board, AGENTS.md and Swift WelcomeView. Behavior stays in the unchanged money-declines.js module.

Changed files:
- `public/app/money-declines-ios.css`: replaced pastel presentation with warm canvas, white neutral cards, 28–30px page heading, restrained dividers, black primary action; desktop pairs active decline work with letter submission, phone keeps single reading order. Scoped to standalone body/root and embedded `#fos-declines`; no global/shared edits.
- `scripts/page_money_declines-browser.mjs`: current shared Money picker semantics, safe mocked four-state proof, keyboard/touch controls and embedded styling check.

| Feature | Before | After |
|---|---|---|
| Applications / bank / status | GET `/api/blueprint/declines` server view | Same module/schema, full fixture asserted |
| Reasons / quote / unknown text | Escaped server fields and human-review notice | Same content and escaping, readable neutral sections |
| Client steps / Fundhub steps | Done/open/skipped words; native disclosure | Preserved, keyboard Enter and touch disclosure verified |
| Letter editor / another bank | Existing labeled controls and application selector | IDs and handlers unchanged, other-bank input verified |
| Submit letter | POST same endpoint, `{action:'paste',text,bank/application_id,client_id?}` | Untouched; rejected mock produces error and no success flash |
| Entitlement | `can_paste` gate | Locked empty fixture has no editor |
| Loading / empty / error / retry | Existing honest states | All rendered at 1440/390/320; retry Enter causes one new read |
| Scope / navigation | Server client scope; explicit staff `client_id`; sign-in routing | Module unchanged, staff theme gate and scoped back link verified; shared complete 16-section picker selected Applications |
| Embedded FinanceOS | Same section mount | CSS also scoped to `#fos-declines`; renamed-root isolation check and screenshots passed |

Executed checks:
- `node scripts/page_money_declines-browser.mjs`: all 3 widths passed; no document overflow; full/empty/error/loading; Enter retry and submit; touch disclosure; failed-submit honesty; staff client-id back; embedded scoped style.
- `node --test src/http/money-declines-screen.test.mjs`: 18 passed, 0 failed, 0 skipped.
- Reviewed desktop full screenshot visually: paired working columns, visible reason/steps/form; no duplicate logo/account added.

Screenshots: `page_money_declines-{full,empty,error,loading,embedded}-{1440,390,320}.png` alongside this note. Embedded screenshots are a section isolation fixture, not the complete live FinanceOS frame. Shared lead must include this stylesheet in the Money frame. Clean screenshots are design review evidence, no defect box is asserted.

Unrun/limits: no live writes or DB tests; all API requests mocked. Root owns combined lint, TypeScript, performance and integrated FinanceOS checks. Existing success/duplicate, auth and escaping behavior receives existing render tests; no new backend claim. No deploy or commit.
