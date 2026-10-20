# Affiliate payout tracking through Plaid — 2026-10-20

Parent: `ops/workflows/set-a-fix-2026-10-20.md` Set B, item B4. Owner: session on branch `claude/nervous-swanson-5eba12`.

Chris (2026-10-20): leave the flagged row for now, but affiliate payout tracking must be built and finished 100%, and it runs through Plaid as an integration we build.

## Split

| Lane | Owns | Status |
|---|---|---|
| R1 research: affiliate + commission code | read only | done |
| R2 research: Plaid + banking code | read only | done |
| R3 research: Codex notes | read only | done |
| Q workflow questions to Chris (one at a time) | this session | claimed |
| B1 schema + migration + write/read path + real-Postgres test (scratch) | this session, after Q | pending |
| B2 tripwire + heartbeat rows + `npm run pulse:prove` | this session, after B1 | pending |
| B3 flow diagram `docs/journeys/affiliate-payout-flow.md` | after B1 | pending |
| B4 staff screen (last) | after B1-B3 | pending |

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

_Recorded as he answers. One question at a time._

## Leftovers (not this task)

- `affiliate.html:368` "Fridays" copy vs monthly run (only fix if Chris's answers touch it).
- `src/affiliates/affiliate-model-open-questions.md` referenced by 033 but missing.
