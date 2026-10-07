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
| 10 | Next funding sequence planner (owner: not "round two" — a sequence has ~6 rounds) | ★★ | **Half** — date is staff-entered | `src/blueprint/next-funding-sequence.mjs`; no recovery math |
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
| B1 | Decline defense: client pastes the decline into the agent → likely reasons → reconsideration steps as a tracked process (agent / ops / client), cited from the bank book; ops task + script | running | 470 |
| B2 | File-protection alerts that actually send: payment timing, promo end 60/30/7 (promo-end field), cash reserve < 6× minimums, new card / new inquiry the day it shows (Plaid new account + pull diff) | **back end done** (Sonnet) — screen next (Opus); manifest below | 471 |
| B3 | Document vault: required-docs checklist (statements, returns, ID, business docs), agent chases missing, closer sees "file complete" at ready time | queued | 472 |
| B4 | Next funding sequence planner math: when the file is ready for the next sequence, from repo-documented windows (inquiry age, new-account age, utilization back under target), staff can override; rename "next round" labels to "next funding sequence" | queued | 473 |
| B5 | Offer stack in the presentation (`present.js`): every Blueprint + FinanceOS item with buttons and logic for the rep | tomorrow (owner) | — |

## Owner calls (2026-10-06, late)
- Decline defense = paste the decline into the agent; it finds the reason and the reconsideration process.
- **Naming:** never "round two". Fundhub runs about six rounds inside one funding sequence. The next one is "the next funding sequence" (Funding Sequence 2).
- **Models:** back end on Sonnet (save tokens), then front end on Opus (make it good). Each unit B2–B4 = Sonnet back-end agent, then an Opus front-end agent.

Rules: never invent a bank script, window, or amount — cite the repo source or make it staff-set. Sample clients stay one consistent file.

## Owner decisions still open (do not block the build)
Monthly member fee amount · Commas titles for member fee and per-letter mailing · combined approval rule (sum?) · when to turn on live monthly pulls (cost per pull).

## B2 manifest — file-protection alerts, back end (2026-10-07)

**Done:** items 11–14 now send. Contract for the screen: `docs/finance/file-protection-alerts.md` + the fixture `src/finance/file-alerts/file-alerts.fixture.json` (a test pins the API to it).

| Item | What goes out | Once per |
|---|---|---|
| 12 payment timing | text 3 days before each card's statement close ("pay … down before Oct 15 — that is the day it reports to the bureaus"), with balance and "pay about $X to get under 10%" | card per cycle |
| 13 promo end | text at 60 / 30 / 7 days with the balance left and a computed payoff line | card per threshold |
| 14 cash cushion | text when personal **or** business cash < 6 × that kind's minimums (cards + loans + Fundhub payment plans); re-arms when cash recovers; never summed | drop |
| 11 new credit | text for a new Plaid card/loan on a linked login, or a new account/inquiry between two stored credit pulls; a CSM task for Blueprint buyers | account / pull |

**Files:** `db/migrations/471_file_protection_alerts.sql` · `src/finance/file-alerts/*` (planners, store, snapshot, run, read, memory-store, sample-payload) · `api/money/alerts.mjs` · `src/workflows/blueprint-finance-os-alerts.mjs` (extended) · `scripts/blueprint-file-alerts-dry-run.mjs` · `netlify/functions/api.mjs` (route `money/alerts`) · `src/pulse/registry.mjs` (API_KEYS) · tests `src/finance/file-alerts/*.test.mjs`, `src/http/money-alerts.test.mjs`, `src/workflows/blueprint-finance-os-alerts.test.mjs`.

**Route:** `GET/POST /api/money/alerts` (client session, or staff `owner/admin/sales_manager` + `client_id`). POST actions: `set_alert`, `set_promo`, `set_statement_close_day`.

**Migration 471 (additive):** promo columns on `account_statement_cycles` (the old "client_cards" skip reason named the wrong table — that one is the payment instrument a client pays Fundhub with); `file_protection_settings`; `file_protection_alerts` (once-only key, one open cash alert per kind); four `SMS-FILE-PROTECT-*` templates. **Not on production until ship.**

**Workflow count:** unchanged. The existing `blueprint-finance-os-alerts` cron was extended (same function id); `REGISTERED` stays at main's value.

**Journeys impacted:** client (alerts the client now receives). `-actual.md` journeys and diagrams were NOT regenerated here (told not to run `npm run journeys`); `diagrams:check` is clean.

**Choices made (named, changeable, in `src/finance/file-alerts/common.mjs`):** lead time 3 days (`FILE_ALERT_PAY_BEFORE_CLOSE_DAYS`, 1–10 — the repo had no rule) · Fundhub payment plans count against personal cash only · a cash balance dated over 30 days old is unknown · a login's first 60 minutes of accounts are the baseline · new credit looks back 3 days.

**Needs from the screen unit:** hand-entered cards have no statement close day, so the pay-before-close text cannot go for them — ask the client for it (`set_statement_close_day`).

**Leftover card (not fixed — outside this hole):** nothing re-reads the Plaid account list or balances after link time (`accounts-sync.mjs` calls the Plaid seam with no token, and `plaid-liabilities.mjs` refuses to create accounts). So a new Plaid card appears only when something writes its row (a re-link), and the cash cushion uses balances as last written. Real banks are sandbox-only until Plaid production is granted.

**Proof:** read-only dry run over test client `f1cb9c27-…` (not in the daily audience — no Finance OS subscription, no paid Blueprint transaction): `node --env-file=.env scripts/blueprint-file-alerts-dry-run.mjs`.

## B2 manifest — file-protection alerts, the screen (2026-10-07)

**Done (on the B2-front worktree branch, not merged):** the client can now see and run the four texts. Each one is a card with its own on/off switch, what it watches, the next text and what it is about, and the texts already sent (the day, the card, the words). Promo: set the end date and rate per card; it shows what is left and the payoff line from the API, plus the 60 / 30 / 7 schedule. Remove asks first. A card with no statement close day is asked for it right in its card, with one sentence why. That is the screen's one filled button. Cash: personal and business are two checks, each against 6 times its own minimums. No added number anywhere; a test checks the three sums never show.

**Files:** `public/app/money-alerts.js` (`window.FinanceOS.sections.alerts`), `public/app/money-alerts.css` (all under `.fh-alerts`), `public/app/money-alerts.html` (thin shell) · lists: `src/pulse/registry.mjs` (DESK_FILES), `public/app/shell.js` (STAFF_MONEY + client), `src/http/app-nav-matches-shell.test.mjs` (NO_SIDEBAR), `src/http/financeos-staff-nav.test.mjs` (MONEY) · test `src/http/money-alerts-screen.test.mjs` (42 tests).

**For the orchestrator (financeos.html / financeos.js not touched):** link `money-alerts.css` and `money-alerts.js`, add the tab `["alerts", "Alerts"]` with panel `#fos-alerts`, and `"money-alerts.html": "alerts"` in PAGE_TAB. Section title "Alerts"; its heading is "File protection alerts".

**Journeys impacted:** client. `-actual.md` not regenerated (told not to run `npm run journeys`).

**Proof:** fixture server = the real `api/money/alerts.mjs` handler and the real payload builder over the sample rows, writes in memory, no database, no login. Its first read equals the pinned fixture. Marked shots at 1440 and 375 (full, empty, error, loading, promo editing and saved, a day saved, a switch off, STOP) are in the B2-front worktree under `ops/workflows/blueprint-launch-2026-10-06-evidence/b2/` (gitignored).

### Orchestrator log (2026-10-07)
- B1 decline defense (470) merged → FinanceOS tab "Applications". B1b (paste a decline into the money helper) running.
- B2 alerts back end (471) + screen merged → tab "Alerts".
- B3 vault back end (472) merged; screen running.
- B4 next funding sequence math merged (no migration). Banks tab labels now say "next funding sequence"; reads `next_sequence`.
- F1 daily Plaid refresh merged; key-rotation AAD bug fixed (would have broken real tokens).
- F2 bank reconnect (update mode) back end running. Presentation offer stack (PS) running as a MARKED DRAFT — merge only when Chris says push.
- Leftover (page-edit law, needs a marked draft): `public/app/client-portal.html` promo copy says "before the next round" — should say "next funding sequence".
