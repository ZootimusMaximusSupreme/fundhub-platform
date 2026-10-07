# Capital Blueprint — 48-hour launch map (2026-10-06)

Owner: "Finish the Blueprint. Map it out now, find what makes it worth $5–10K, push in 48 hours." Welcome kit: parked (TODO). Offer stack in the sales presentation: tomorrow (TODO).
Offer (owner-set): `docs/finance/capital-blueprint-next-2026-09-29.md`. Opinion: `docs/finance/blueprint-value-2026-10-06.md`.

## The map — every offer item, measured against the code (2026-10-06)

Value: ★★★ = moves the client toward funding / the reason they pay $5–10K. ★★ = protects the file. ★ = nice.

| # | Item | Value | State | Evidence |
|---|---|---|---|---|
| 1 | Dispute-round steps + proof to clear | ★★★ | **Built + proven live** (9/30) | waypoint defs `blueprint_dispute_*`; upload `dispute_mail_receipt` closes the step |
| 2 | Accountability agent on the open step | ★★★ | **Built (rules)**; AI brain building now (W6) | `src/nudge/run.mjs` text→email→text→CSM; `src/blueprint/coach-exception.mjs`; STOP→CSM |
| 3 | Monthly soft pull → plan rewrites | ★★★ | **Built, simulated** | `src/finance/finance-os-pull-fulfil.mjs`, `monthly-pull-aftercare.mjs`; live needs `CRS_ALLOW_LIVE` + `FINANCE_OS_SYSTEM_PULL_LIVE` (each pull costs money — owner call) |
| 4 | Ready-for-funding → closer alert | ★★★ | **Built**; client "Ready to get funded" button building now (W5) | `src/blueprint/closer-ready.mjs`, `blueprint-closer-ready-sweeper` |
| 5 | Paydown simulator / payment strategy | ★★★ | **Built** | `src/blueprint/paydown-simulator.mjs`; FinanceOS Strategy tab (W4) |
| 6 | FinanceOS (12 months included) | ★★★ | **Built** (11 tabs; agent + transfers building) | `/app/financeos.html` |
| 7 | Credit partner file (second applicant) | ★★★ | **Built** | `402_credit_partner_link.sql`, `src/blueprint/credit-partner.mjs`, combined approval = sum (owner to confirm rule) |
| 8 | Bank relationship tracker | ★★★ | **Built** | `src/blueprint/bank-relationship.mjs` + FinanceOS Banks tab (W2) |
| 9 | Decline defense (read reason → reconsideration) | ★★★ | **Not built** | nothing in repo |
| 10 | Round-two planner | ★★ | **Half** — date is staff-entered | `src/blueprint/next-funding-sequence.mjs`; no recovery math |
| 11 | New-credit alert (new card / inquiry same day) | ★★ | **Not built** | nothing in repo |
| 12 | Payment timing (pay before statement date) | ★★ | **Half** — math exists, no message goes out | `src/workflows/blueprint-finance-os-alerts.mjs` ("no outbound yet") |
| 13 | Promo tracking (0% ends: 60/30/7 days) | ★★ | **Not built** — no promo-end field | same file: `PROMO_TRACKING_SKIP_REASON` |
| 14 | Payment reserve (cash < 6 months of minimums) | ★★ | **Not built** as a Blueprint alert | FinanceOS has the numbers (overview + strategy) |
| 15 | Application document vault | ★★ | **Half** — uploads exist, no required-docs checklist | `api/documents-upload.mjs` |
| 16 | CSM, one per client | ★★ | **Built** | `401_clients_assigned_csm.sql`, `src/blueprint/assign-csm.mjs` |
| 17 | Letter-mailing upsell (per letter) | ★ | **Guard built, billing not set** | `332_dispute_letter_mail_guard.sql`; Commas title not set (owner) |
| 18 | Welcome kit | ★ | Parked by owner | `src/blueprint/welcome-kit.mjs` exists (money-chain hook) |
| 19 | Quizzes | ★ | TODO (owner idea) | — |
| 20 | Offer stack in sales presentation | ★★★ (sells it) | TODO — tomorrow | `public/app/present.js` already has Blueprint slides |

**Read:** 11 of the ★★★/★★ items are built. The gaps that matter most for "worth $5–10K": decline defense (9), new-credit alert (11), promo + reserve + payment-timing alerts going out (12–14), round-two math (10), document vault checklist (15), and the presentation (20).

## 48-hour build — wave 6 (starts as FinanceOS wave 5 agents free up; cap 5)

| # | Unit | Status | Migration # |
|---|---|---|---|
| B1 | Decline defense: capture the decline (reason, letter upload), match reconsideration steps from the bank book notes, ops task + script, client status | queued | 470 |
| B2 | File-protection alerts that actually send: payment timing, promo end 60/30/7 (promo-end field), cash reserve < 6× minimums, new card / new inquiry the day it shows (Plaid new account + pull diff) | queued | 471 |
| B3 | Document vault: required-docs checklist (statements, returns, ID, business docs), agent chases missing, closer sees "file complete" at ready time | queued | 472 |
| B4 | Round-two planner math: recovery date from repo-documented windows (inquiry age, new-account age, utilization back under target), staff can override | queued | 473 |
| B5 | Offer stack in the presentation (`present.js`): every Blueprint + FinanceOS item with buttons and logic for the rep | tomorrow (owner) | — |

Rules: never invent a bank script, window, or amount — cite the repo source or make it staff-set. Sample clients stay one consistent file.

## Owner decisions still open (do not block the build)
Monthly member fee amount · Commas titles for member fee and per-letter mailing · combined approval rule (sum?) · when to turn on live monthly pulls (cost per pull).
