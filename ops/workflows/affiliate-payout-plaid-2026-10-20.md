# Affiliate payout tracking through Plaid — 2026-10-20

Parent: `ops/workflows/set-a-fix-2026-10-20.md` Set B, item B4. Owner: session on branch `claude/nervous-swanson-5eba12`.

Chris (2026-10-20): leave the flagged row for now, but affiliate payout tracking must be built and finished 100%, and it runs through Plaid as an integration we build.

## Split

| Lane | Owns | Status |
|---|---|---|
| R1 research: affiliate + commission code | read only | done |
| R2 research: Plaid + banking code | read only | done |
| R3 research: Codex notes | read only | done |
| Q workflow questions to Chris (one at a time) | this session | done (see answers) |
| B1 schema + migration + write/read path + real-Postgres test (scratch) | this session | done — PR #92 |
| B2 tripwire + heartbeat rows + `npm run pulse:prove` | this session | done in code; prove run recorded below |
| B3 flow diagram `docs/journeys/affiliate-payout-flow.md` | this session | done |
| B4 screens (last) | this session | done |

Dependency: every build lane waits on Q. B1 → B2/B3 can run together → B4 last.

## What already exists (do not rebuild)

- Tables (`db/migrations/033_affiliates.sql`): `affiliate_referrals` (attributed→converted→paid|void, `commission_due`), `affiliate_payouts` (pending|held|processing|paid|void, method, external_ref, paid_at, idempotency_key), `affiliate_payout_lines` (commission|clawback|adjustment, one commission line per referral = double-pay guard).
- DB guard `affiliate_payouts_guard`: allowed moves pending→held/processing/void, held→pending/processing/void, processing→paid/pending/held/void. Refuses processing/paid with no `partner_license_signed_at`. Paid runs are frozen.
- Rates (owner-set): 20% direct, 5% downline; also earns on the 10% success fee (`src/affiliates/economics.mjs`).
- Monthly run `src/affiliates/payouts.mjs` + Inngest `affiliate-payout-run` cron `0 3 1 * *`: previous month, $50 minimum, held if license unsigned or tax form missing. Writes pending/held only. Moves no money.
- Portal read `api/read/affiliate-portal.mjs` + `public/app/affiliate.html` Payouts tab (read only).
- Pulse: `trip:partner` (`src/pulse/beats/lib/trip-partner-*.mjs`) and `partners:commission-payable` / `partners:payout-stuck` (`src/pulse/coverage/gap-partners.mjs`).
- Plaid (clients only, sandbox): `src/banking/providers/plaid-http.mjs` (link, exchange, accounts, transactions/sync, Transfer), `plaid_items`, `bank_accounts`, `bank_transactions`, `money_transfers`; Transfer gated by `PLAID_ENV=production` + `FINANCE_OS_TRANSFERS_LIVE=1`. Plaid production access not granted yet (docs/finance/finance-os-direction-2026-10-06.md:36).

## What is missing

1. Nothing moves a payout to processing or paid, or records method / reference / paid date.
2. Nothing sets `affiliate_referrals.status='paid'` when its payout is paid.
3. Nothing sets `partner_license_signed_at` or `tax_form_received_at` on a real affiliate, so every real run is held.
4. No affiliate bank link (affiliate bank is only a text label `payout_method_ref`). No Plaid use for affiliates.
5. No staff screen to release / mark paid / void a payout run.
6. No `affiliate.payout.paid` event or notice.
7. No tripwire for "payout run past its due date and still not paid".
8. `affiliate.html:368` says "Fridays, ACH"; the run is monthly.

## Owner answers (Chris)

- **Q1 (2026-10-20): "What should Plaid do for affiliate payouts?"** Options: check the affiliate's bank / watch our bank / Plaid sends the money / watch client payments. **Chris: "No preference."**
  Recorded like the 2026-09-21 payout numbers: Chris let the agent pick. The picks (agent-set, 2026-10-20):
  1. The affiliate links their own bank with Plaid Link (product `transfer`). Proves the account is real and theirs.
  2. Finance staff (owner, admin, sales manager) press Send; Plaid Transfer pays the run out of Fundhub's Plaid Ledger (credit leg). Same switches as client transfers: sandbox unless `PLAID_ENV=production` and `FINANCE_OS_TRANSFERS_LIVE=1`.
  3. Every 15 minutes we ask Plaid: settled → paid (transfer id is the reference); failed/returned → back to pending with the reason.
  4. Until Plaid gives live access, real affiliates are paid by hand and staff Mark paid with a method and reference.
  5. Test money (sandbox) can pay only a test (demo) affiliate. Enforced in code and in the database.
  6. Due day: the 15th of the month after the month earned. The tripwire goes red after that.
  7. "Watch client payments" was not built: commission already earns on recorded payments (economics.mjs).

- **Q2 answer (2026-10-20, relayed from the coordinator chat in Chris's words):** "Plaid's going to take care of everything. That makes sure all the above is your question or your answer to your question. I'm going to say it. Paid them out immediately upon receiving the money. Once it clears, we just pay it."
  **OWNER-SET.** Supersedes picks 2, 6 and the monthly cadence above for these payouts:
  - Paid as soon as the client's payment clears. "Cleared" = the processor's payment is saved (sale_payments) and convert() sets commission_due. Commission is set once on the first qualifying payment and never grows, so paying then is safe.
  - Autopay job `affiliate-payout-autopay` (every 15 min): build one run per earned commission (no $50 minimum, due the next day), send through Plaid Transfer with no approval click, sync Plaid's answer.
  - Held only on the affiliate: license, tax form, or no bank linked; released by itself when done.
  - Still true: test money pays only test affiliates. Real affiliates wait for Plaid production access, with the reason on the run; staff can Mark paid by hand.
  - The monthly `affiliate-payout-run` stays registered as a backstop; it finds nothing once autopay has lined everything.

## Manifest (PR #92, branch claude/nervous-swanson-5eba12)

- `db/migrations/495_affiliate_payout_rail.sql` — `affiliate_payout_accounts`; payout columns (`due_on`, approver, bank, Plaid ids/status, `rail_attempts`); rules: paid needs method + reference, sandbox never pays a real affiliate, processing needs a tax form; paid run marks its referrals paid.
- `src/affiliates/payout-rail.mjs`, `src/affiliates/payout-due.mjs` — the rail.
- Routes: `affiliates/payouts` (POST, finance), `affiliates/payout-account` (POST, affiliate/light-affiliate client), `read/affiliate-payouts` (GET, finance). `read/affiliate-portal` adds `dueOn`, `reference`, `transferStatus`, `payoutBank`.
- Job: `affiliate-payout-autopay` `*/15 * * * *` — build, send, sync (heartbeat row, tripwire row, trip:partner beat covers it).
- Checks: `partners:payout-overdue`, `partners:payout-returned` in `src/pulse/coverage/gap-partners.mjs`; tripwire map rows for the 3 routes and the job.
- Screens: Affiliate payouts tab on `products-commissions.html` (`#affiliate-payouts`); Payout bank block on `affiliate.html`; schedule copy fixed ("Fridays" → monthly, due the 15th).
- Tests: `payout-rail.test.mjs`, `payout-rail.pg.test.mjs` (scratch Postgres in CI), `affiliate-payouts-doors.test.mjs`, new gap-partners cases.
- Docs: `docs/journeys/affiliate-payout-flow.md`, actual journeys regenerated, changelog.

## Merge order

- Migration is **495**. Set A (`claude/set-a-fix-2026-10-20`) holds 492–494 and lands on main first. After it lands, merge `origin/main` into PR #92 and rerun `npm run migrations:manifest` so `db/expected-migrations.mjs` lists 492–495 in order.

## Leftovers (not this task)

- `src/affiliates/affiliate-model-open-questions.md` referenced by 033 but missing.
- `affiliate-intended.md` has no payout or bank-link step. The affiliate now reaches `affiliates/payout-account`. Chris records the intended step (agents do not edit `-intended.md`).
- Nothing sends an affiliate a PARTNER-LICENSE with `merge_values.affiliate_id`; `stamp_license` reads one when it exists. Until then a license stamp needs that contract.
- No "your payout was paid" message to the affiliate (would be a new send path with its own heartbeat).
- Plaid production access for Transfer is still not granted (docs/finance/finance-os-direction-2026-10-06.md:36).
- The 2026-10-20 flagged row (one eligible affiliate, no payout record) is left as Chris said. **When this ships, autopay will write a payout record for it** (pending, or held on paperwork/bank). No money moves while Plaid is on test money. `partners:payout-overdue` will show it red after a day — that is true, not a false alarm. Chris decides if it should be left out.
- The affiliate terms still say "A refund inside 30 days reverses the commission on the next run". With pay-on-clear there may be no next run to net it against (open question 7a in commission-model-open-questions.md). Not changed here.
