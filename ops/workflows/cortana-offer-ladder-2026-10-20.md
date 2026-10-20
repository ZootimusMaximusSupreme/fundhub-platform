# Cortana + offer ladder — 2026-10-20

## Owner scope

Get the full funnel structure right and prove each lane fires correctly. Keep the free book-a-call funnel separate from paid offers.

- Free book-a-call: `/watch` → `/apply` → `/funding-book-call` → `/thank-you`
- Paid offers: $32, $200, $1,000, $3,000, and variable $5,000–$10,000
- Commas API must work for the paid lanes.
- Whop financing must be available for the variable $5,000–$10,000 lane.
- $3,000 financing is allowed only if verified Clarity Pay terms do not report to personal credit.
- $1,000 financing remains an owner choice after the available provider terms are verified.

No real charge, customer record, outbound message, or production release is authorized by this board alone.

## Split and dependencies

The first four workflows run in parallel. Code changes wait for the verified map. Final live proof waits for provider access and any required live-dollar approval.

| Workflow | Owner | Scope | Status |
|---|---|---|---|
| A — joined funnel map | This session | Join all entrance, route, offer, checkout, webhook, event, and fulfillment paths into one source-backed map. | COMPLETE — BUILD REQUIRED |
| B — Commas + money rail | Agent | Trace Commas products, payloads, links, callbacks, webhook handlers, stored rows, retries, and tests for all five prices. Read-only. | TRACE COMPLETE — $10K PATH MISSING |
| C — Whop + finance rail | Agent | Trace repo wiring and verify current official Whop and Clarity Pay terms. Read-only. | TRACE COMPLETE — WIRING MISSING |
| D — Cortana + reconciliation | Agent | Trace browser/server events, identity, dedupe, and count proof for free booking plus all paid lanes. Read-only. | TRACE COMPLETE — CONTRACT SPECIFIED, WIRING MISSING |
| E — scoped repairs and proof | This session after A–D | Make only the needed fixes, test, commit, push, and verify each authorized non-dollar path. | READY — NO PRODUCT CODE CHANGED BY THIS AUDIT |

## Copy-paste prompts

### Workflow B — Commas + money rail

Work in `/Users/chrisstanbridge/Developer/fundhub-platform` on branch `codex/two-ios-apps-launch`. Read `AGENTS.md`, `CLAUDE.md`, the relevant intended journeys, and `ops/workflows/cortana-offer-ladder-2026-10-20.md`. Do a read-only trace of every Commas/payment path for the $32, $200, $1,000, $3,000, and variable $5,000–$10,000 offers. Search `src/`, `api/`, `scripts/`, `db/`, `docs/`, `public/`, and `marketing/`. Map catalog keys, exact amounts, checkout or invoice creation, API request fields, links, callbacks/webhooks, signature checks, idempotency, database writes, workflow events, retries, and tests. Keep the free book-a-call path separate. Do not edit product code, send messages, create a charge, or change live data. Add concise evidence and file/line pointers to the Workflow B section of this board, then report the exact gaps and what Codex can prove without Chris.

### Workflow C — Whop + finance rail

Work in `/Users/chrisstanbridge/Developer/fundhub-platform` on branch `codex/two-ios-apps-launch`. Read `AGENTS.md`, `CLAUDE.md`, relevant intended journeys, and `ops/workflows/cortana-offer-ladder-2026-10-20.md`. Do a read-only trace for Whop, financing, Clarity Pay, and any other finance provider. Search all repo locations, including env variable names without printing secret values. Use current primary official provider sources to verify: Whop financing support for a variable $5,000–$10,000 purchase, available term/config rules, API/webhook requirements, and whether Clarity Pay reports to personal credit. Separate confirmed facts, repo facts, and inferences. Determine what is already wired and what is missing for $1,000, $3,000, and $5,000–$10,000. Do not edit product code, create applications, submit customer data, or charge money. Add evidence and source links to Workflow C on this board, then report any one true owner decision that remains.

### Workflow D — Cortana + reconciliation

Work in `/Users/chrisstanbridge/Developer/fundhub-platform` on branch `codex/two-ios-apps-launch`. Read `AGENTS.md`, `CLAUDE.md`, tracking specs, intended journeys, and `ops/workflows/cortana-offer-ladder-2026-10-20.md`. Do a read-only trace of DirectROAS/Cortana tracking for two separate systems: (1) the free book-a-call funnel `/watch` → `/apply` → `/funding-book-call` → `/thank-you`, and (2) paid $32, $200, $1,000, $3,000, and variable $5,000–$10,000 lanes. Map tag coverage, exact browser/server events, event IDs and dedupe, identity fields, amount/currency, offer keys, purchase confirmation source, and the count reconciliation needed at every step. Check current tests and provider access already documented on the Cortana boards. Do not edit product code, send events to production, create charges, or change live data. Add file/line evidence and an event matrix to Workflow D on this board, then report exactly what Codex can complete without Chris.

## Workflow B evidence

**Status:** Read-only trace complete on 2026-10-20. The $32, $200, $1,000,
$3,000, and $5,000 Commas code paths exist and their focused unit tests pass.
The requested variable $5,000-$10,000 Capital Blueprint path does not exist:
the closer always mints $5,000, the catalog caps it at $5,000, and there is no
$10,000 test or stored result. No checkout session, charge, customer record,
message, or live-data write was created during this trace.

### Paid-lane matrix

| Lane | Catalog and mint path | Receipt events and fulfillment | Read-only live evidence | Verdict |
|---|---|---|---|---|
| $32 | `SOFT_PULL`, 3,200 cents, `diagnostic`; public mint at `api/public/optimize.mjs:200-218`, closer mint at `src/sales/closer-deck.mjs:510-555`. The approval form can add $10 per selected business. | `payment.received` + `diagnostic.paid` (`src/adapters/commas.mjs:405-408,522-530`). | Production aggregate: four matching $32 succeeded transaction rows. | Built and unit-tested; no fresh live mint/callback proof. |
| $200 | `REPAIR_TRIAL`, 20,000 cents, `repair-trial` (`src/config/offers.mjs:127-136`). The post-pull repair door allows only this or the $1,000 plan and mints the catalog amount (`api/public/slo-repair-checkout.mjs:1-23,70-103`; `src/slo/repair-offer.mjs:27-39,58-116`). The closer can mint it too. | `payment.received` only; the exact link product ID lets money-chain and purchase-routing open the trial repair fulfillment path (`src/adapters/commas.mjs:405-423,522-530,789-854`; `src/handlers/money-chain.mjs:763-815`; `src/handlers/purchase-routing.mjs:84-97`). | No matching $200 transaction or paid link was found in the production aggregates. | Code path and unit tests pass; live receipt/fulfillment is unproved. |
| $1,000 | `REPAIR_DFY`, 100,000 cents, `repair-bundle` (`src/config/offers.mjs:116-125`); same SLO and closer mint paths as above. | `payment.received` only, then exact-product money-chain and full repair enrollment. | One matching $1,000 succeeded transaction; one current `repair-bundle` link remained `created`. | Built and unit-tested; stored history exists, but no fresh customer-path proof. |
| $3,000 | `FUNDING_DFY`, 300,000 cents, `card-stacking-dfy`, plus 10% success fee (`src/config/offers.mjs:104-114`). The closer always passes the catalog amount (`src/sales/closer-deck.mjs:683-724`). | `payment.received` + `deposit.paid`, then the sale/payment rows and funding board routing (`src/adapters/commas.mjs:405-408,522-530`; `src/handlers/money-chain.mjs:763-829`; `src/handlers/purchase-routing.mjs:84-97`). | Eleven matching $3,000 succeeded and one failed transaction rows. Separate historical $500 and $1,500 deposit rows show old variable amounts, not the requested current lane. | Built and unit-tested; history exists, but no fresh customer-path proof. |
| $5,000-$10,000 | `UWIQ_DELIVERABLES` / Capital Blueprint is coded at 500,000 cents with a $1,000-$5,000 range (`src/config/offers.mjs:138-193`). `sendDeckPayLink` ignores that range and always sends `offer.priceCents`, so it can mint only $5,000 (`src/sales/closer-deck.mjs:683-724`). The generic staff payment-link API accepts an arbitrary amount (`api/payment-links.mjs:91-108,163-243`), but the closer funnel does not call it with a custom Blueprint price or enforce a $5,000-$10,000 bound. | `consulting-package` maps to `payment.received` + `sale.closed`; the linked product ID keeps Blueprint money/entitlement routing attached to the exact product (`src/adapters/commas.mjs:405-408,522-530,789-854`). | Live `products` row: $5,000 default, variable, no DB min/max. Two matching $5,000 succeeded transaction rows and one paid $5,000 Blueprint link; no matching $10,000 row. | **FAIL for the requested ladder.** $5,000 works in code/history; variable $5,000-$10,000 does not exist. |

### Canonical provider titles

These are the exact provider-facing checkout and webhook titles. Commas and
Whop must reuse them verbatim; the variable high-ticket lane keeps the same
`Consulting Services Package` title at every allowed amount and must not put the
price in the title.

| Offer key | Amount | Product code | Exact provider title |
|---|---:|---|---|
| `SOFT_PULL` | $32 | `diagnostic` | `Consulting Services Assessment` |
| `REPAIR_TRIAL` | $200 | `repair-trial` | `Consulting Services Trial` |
| `REPAIR_DFY` | $1,000 | `repair-bundle` | `Consulting Services Standard` |
| `FUNDING_DFY` | $3,000 | `card-stacking-dfy` | `Consulting Services Engagement` |
| `UWIQ_DELIVERABLES` | variable $5,000-$10,000 | `consulting-package` | `Consulting Services Package` |

The free book-a-call funnel is separate: none of its `/watch` -> `/apply` ->
`/funding-book-call` -> `/thank-you` steps belong to this paid Commas rail.

### Commas request, callback, storage, and retry trace

- Checkout configuration prefers `CORTANA_COMMAS_API_KEY`, then
  `FANBASIS_CHECKOUT_API_KEY` (`src/payments/commas-api.mjs:194-231`). A
  read-only call to Commas' checkout-transactions endpoint using the current
  Cortana key returned HTTP 200 and the expected transaction-list shape. This
  proves the key can read that API; it does **not** prove `POST
  /checkout-sessions`, session minting, payment, or callback delivery.
- A mint sends `amount_cents`, a controlled product title,
  `type=onetime_non_reusable`, metadata, and the success URL to `POST
  /checkout-sessions` with `x-api-key`; success requires `data.payment_link`
  (`src/payments/commas-api.mjs:286-416`). `createPaymentLink` adds link, client,
  org, product, sale, motion, invoice, and funding-round identity, then stores
  the returned checkout and session only after the provider succeeds
  (`src/payment-links/index.mjs:142-268`).
- Commas calls `/api/webhooks/commas` (`netlify/functions/api.mjs:65,1463-1466`).
  The handler reads `x-webhook-signature` first, verifies HMAC-SHA256 against
  `COMMAS_WEBHOOK_SECRET`, and fails closed (`src/http/router.mjs:53-69`;
  `src/adapters/commas.mjs:45-77,108-128`). It writes exact signed bytes to
  `commas_inbox` before returning 200; an inbox-write failure returns 500
  (`src/adapters/commas.mjs:566-631`).
- Dedupe is payment ID + event type, with exact-body SHA-256 fallback. Queue
  claims use `FOR UPDATE SKIP LOCKED`, retry failed/stale rows up to ten times,
  and retain exhausted bytes and errors (`src/payments/commas-inbox.mjs:35-141`;
  `db/migrations/156_commas_inbox.sql:33-106`). A registered sweep drains up to
  four batches of 25 every minute (`src/workflows/commas-inbox-drain.mjs:41-77`;
  `src/workflows/index.mjs:18,150-161`).
- Receipt processing resolves the exact `payment_links` row by Fundhub ref or
  Commas session, emits idempotent canonical events, marks the link paid,
  inserts a deduped `transactions` row, and then writes the sale/payment,
  commission, entitlement, and routing results (`src/adapters/commas.mjs:634-677,751-854`;
  `src/handlers/payment-links.mjs:35-76`; `src/handlers/client-lifecycle.mjs:335-350`;
  `src/register-all.mjs:30-93`; `src/handlers/money-chain.mjs:763-815`).

### Exact gaps

1. **No variable $5,000-$10,000 Blueprint checkout.** Catalog range, closer
   request, UI, validation, tests, and stored evidence all stop at $5,000.
2. **The preflight gates disagree with the working key selector.** Core checkout
   correctly prefers `CORTANA_COMMAS_API_KEY`, but the closer and generic link
   routes check only `FANBASIS_CHECKOUT_API_KEY` before calling it
   (`src/sales/closer-deck.mjs:519-527,687-695`; `api/payment-links.mjs:211-225`).
   A deployment with only the Cortana key is refused before the working selector
   runs.
3. **Missing-webhook recovery is not automatic.** `reconcilePayment()` exists
   and passes unit tests, but the only non-comment runtime definition is in
   `src/payments/commas-api.mjs:122-182`; no route, job, or workflow calls it.
   Inbox retries recover failures only after a receipt was stored; they cannot
   recover a webhook that never arrived.
4. **No fresh provider write/callback proof.** Historical aggregates are not a
   current real-customer proof and may include controlled simulations. The $200
   lane has no matching stored success, and the $10,000 lane has no path or row.
   A read-only HTTP 200 cannot prove a checkout-session POST.
5. The intended client/closer/funding journey files list doors, not this event
   order. Under the system-map standard, paid-lane intent is therefore
   **UNVERIFIED** even where code and tests agree.

### Smallest exact Commas repair blueprint

No Whop adapter belongs in this repair. A later Whop path must consume the same
canonical titles and offer amount validator rather than create a second ladder.

1. **Make the provider titles one source.** In
   `src/payments/commas-safe-copy.mjs`, export frozen offer-key and product-code
   title maps. `src/config/offers.mjs` must import them instead of defining or
   repeating provider-facing strings. Replace the active duplicate constants in
   `api/public/optimize.mjs`, `src/slo/offer.mjs`,
   `src/finance/money-setup.mjs`, and the fallback in
   `api/soft-pull-approve.mjs` with imports from that file. Keep the five exact
   names in the canonical-title table above; UWIQ stays `Consulting Services
   Package` from $5,000 through $10,000. Pin every key, product code, title, and
   safe-copy check in `src/payments/commas-safe-copy.test.mjs` and
   `src/config/offers.test.mjs`.
2. **Resolve one Blueprint amount once.** In `src/config/offers.mjs`, set
   UWIQ's inclusive bounds to 500,000-1,000,000 cents, leave its default at
   500,000 cents, and export one server validator. It accepts a safe integer in
   that range only for `UWIQ_DELIVERABLES`; an omitted UWIQ amount resolves to
   500,000 for old callers; a non-UWIQ override is rejected. Add `amount_cents`
   to `api/closer-deck.mjs`, and pass an injected `env` on both closer actions.
3. **Show the same choice on both closer screens.** Add a Blueprint-only dollar
   input, prefilled at 5,000 with min 5,000, max 10,000 and step 1, to
   `public/app/closer-dashboard.html` + `public/app/closer-call.js` and to the
   S-23 block/state in `public/app/present.js`. Both browsers convert the display
   value to integer cents, reject an invalid value before send, and post only
   `amount_cents`; the server remains authoritative.
4. **Bind the payment and agreement on the server.** In
   `src/sales/closer-deck.mjs:683-773`, resolve `amount_cents` once and use that
   same local `resolvedAmountCents` for `createPaymentLink` and the Capital
   Blueprint agreement. Resolve the template with
   `getTemplateByKey()` (`src/contracts/templates.mjs`), then call
   `createDraft()` + `send()` (`src/contracts/send.mjs`) internally with
   `{package_fee: formatCents(resolvedAmountCents)}`. The browser must not make a
   second `/api/contracts` write for this combined action; two client writes
   cannot guarantee equal amounts. `src/contracts/send.mjs` must parse and
   range-check any Blueprint `package_fee`, reject a mismatch with a supplied
   amount, and freeze the validated value. Keep `manual_fields=[]`, so typed
   contract fields do not return.
5. **Supersede, never edit, the applied contract migration.** Add the next
   numbered migration after `db/migrations/288_real_contract_text.sql`. Replace
   both full English fixed-price clauses at 288:251 and 288:265 with neutral
   sentences containing `{{field.package_fee}}`; replacing only `$5,000` would
   leave the words “five thousand” contradicting a variable price. Preserve
   `manual_fields='[]'`. Record this fee-only exception beside the older
   do-not-change instruction at
   `docs/finance/capital-blueprint-build-spec-2026-09-29.md:24,49`.
6. **Use the real checkout-key selector everywhere.** Replace the
   `FANBASIS_CHECKOUT_API_KEY`-only preflights in
   `src/sales/closer-deck.mjs`, `api/payment-links.mjs`, and
   `api/partner-addons.mjs` with `checkoutConfig(env).ok` from
   `src/payments/commas-api.mjs`. Preserve the legacy base-URL test fallback.
   Prove Cortana-only, Fanbasis-only, both (Cortana wins), and neither in
   `src/sales/closer-deck.test.mjs`,
   `src/http/closer-deck-endpoints.test.mjs`,
   `src/http/payment-links-endpoints.test.mjs`,
   `src/http/partner-addons.pg.test.mjs`, and the two matching S1 door tests.
7. **Add GET-only missing-webhook recovery.** Add
   `src/payments/commas-reconcile.mjs`. It uses `checkoutConfig`, calls only
   `GET /checkout-sessions/transactions` with `x-api-key`, pages with
   `per_page=100`, and loads only open Commas `payment_links`. A row may enter
   `commas_inbox` as `source='reconcile'` only when its `product.id` or
   `service.id` exactly matches `payment_links.commas_session_id` and its USD
   amount exactly matches `payment_links.amount_cents`; unmatched or mismatched
   rows are reported and never credited. Synthesize the normal webhook envelope
   with the list transaction's stable ID, item ID, buyer, title, and amount, then
   let the existing inbox sweeper do all processing. Make linked successful
   events in `src/adapters/commas.mjs` idempotent by payment-link ID plus
   canonical event name, so a webhook and a poll racing with different provider
   IDs still create one money event. Keep the existing payment-ID key for
   unlinked, refund, failure, and dispute events.
8. **Schedule and monitor it.** Add
   `netlify/functions/commas-reconcile-sweeper.mjs`, schedule it every five
   minutes in `netlify.toml`, and register/note its run in
   `src/pulse/heartbeats.mjs`. A pass with no open links makes no provider call;
   a 401/403/429, malformed response, or page-cap truncation returns a visible
   failed result and enqueues nothing. The job never calls a Commas POST,
   creates a checkout, charges, refunds, or mutates provider data.

The amount/contract test matrix is: omitted UWIQ = 500,000; 500,000 and
1,000,000 accepted; 499,999, 1,000,001, string, and fractional values rejected;
every non-UWIQ override rejected; and one spy assertion proves the exact same
cents reached the payment link and frozen agreement. Cover it in
`src/config/offers.test.mjs`, `src/sales/closer-deck.test.mjs`,
`src/http/closer-deck-endpoints.test.mjs`,
`src/http/closer-deck-present.test.mjs`,
`src/http/present-contract-pick.test.mjs`,
`src/contracts/offer-fee-language.test.mjs`,
`e2e/fin-b01-present-deck.spec.mjs`, and
`e2e/fin-b01-closer-dashboard.spec.mjs`. Cover reconciliation in a new
`src/payments/commas-reconcile.test.mjs`, extend
`src/adapters/commas.test.mjs` and `src/payments/commas-inbox.pg.test.mjs` for
webhook/poll cross-source dedupe, and update
`src/http/scheduled-functions-return.test.mjs` plus
`src/pulse/heartbeats.test.mjs` for the new timed job.

### Proof run and autonomy boundary

`node --test src/config/offers.test.mjs src/payments/commas-api.test.mjs
src/payment-links/index.test.mjs src/adapters/commas.test.mjs
src/workflows/commas-inbox-drain.test.mjs src/sales/closer-deck.test.mjs
src/http/slo-repair-checkout.test.mjs src/handlers/meta-purchase.test.mjs`
passed **208/208** on 2026-10-20.

Codex can repair the variable Blueprint mint, key-gate mismatch, reconciliation
job, and missing tests without Chris. Codex can also re-run unit/DB-safe proofs
and the read-only provider check. Codex cannot honestly call all five lanes live
without an authorized provider-side checkout/payment/callback proof; this board
explicitly authorizes no live write or charge.

## Workflow C evidence

**Status:** Read-only trace and implementation design complete on 2026-10-20.
The live Fhconsulting account is allowed to create checkouts through $10,000 and
has displayed Splitit on a $5,500 one-time checkout. That payment is still
`Incomplete`, so it proves the option was offered/selected, not that a sale was
paid. Fundhub's own Whop checkout, signed billing webhook, fulfillment, and
reconciliation rail do not exist in this repo yet.

### Confirmed provider facts

- Whop financing is for one-time payments. Approved checkout options appear
  automatically and the merchant is paid up front. Whop's published limits
  include Klarna to $10,000, Splitit to $20,000, and ClarityPay to $30,000, so
  the requested $5,000–$10,000 amount is inside the published ranges.
  Sources: [Whop financing application](https://docs.whop.com/payments-and-billing/financing/apply),
  [Whop financing options](https://docs.whop.com/payments-and-billing/financing/all-bnpl-options).
- Published ClarityPay terms are $500–$30,000 for the standard option and
  $500–$15,000 for the no-interest option. Prequalification is a soft check,
  but accepting the loan requires a hard credit inquiry. ClarityPay's official
  privacy notice also allows sharing to credit bureaus for reporting and says
  the customer cannot limit that sharing. The evidence therefore does **not**
  support a promise that ClarityPay stays off personal credit.
  Sources: [Whop's ClarityPay guide](https://whop.com/blog/claritypay/),
  [ClarityPay credit-report authorization](https://www.claritypay.com/cred-report-auth),
  [ClarityPay privacy notice](https://claritypay.com/hubfs/45806885/CP%20GLBA%20Privacy%20Notice%20v2.0.0%20%28v202503%29.pdf?hsLang=en).
- Financing is not automatic for the merchant. Whop requires a verified Whop
  Payments account, business review, sales/dispute thresholds, and an eligible
  product. Its official eligibility page lists credit repair and several
  financial-service categories as ineligible. Capital Blueprint includes
  credit-analysis and dispute deliverables, so actual Whop dashboard approval
  for the product is a required external proof, not an assumption.
  Source: [Whop financing application](https://docs.whop.com/payments-and-billing/financing/apply).
- The Current API can create one buyer-specific checkout configuration with an
  inline one-time variant at the exact `initial_price`. It returns a checkout
  configuration ID (`ch_`), a variant ID (`plan_`), and `purchase_url`; checkout
  metadata is copied onto the later payment. A payment then returns its own
  `pay_` ID plus the `ch_`, `plan_`, product ID, metadata, exact Money object,
  payment method, and financing installment count. This is enough for a strict
  round trip without matching on a person's name or email. Two identical inline
  variants may share a `plan_`, so the buyer identity is the unique `ch_` plus
  Fundhub metadata, never the plan ID alone.
  Sources: [create checkout configuration](https://docs.whop.com/api-reference/beta/checkout-configurations/create-a-checkout-configuration),
  [retrieve payment](https://docs.whop.com/api-reference/beta/payments/retrieve-payment).
- Authenticated Current API `POST`s accept an `Idempotency-Key`; successful
  responses replay for 24 hours. Purchase webhooks use Standard Webhooks
  signatures and at-least-once delivery. Whop requires a raw-body signature
  check, a durable queue, a response in under five seconds, and idempotency.
  Sources: [Whop idempotent requests](https://docs.whop.com/developer/api/idempotency),
  [Whop webhooks](https://docs.whop.com/developer/guides/webhooks).

### Live Whop evidence

- Fhconsulting Settings shows **$10,000 maximum price per checkout today**.
  That proves the whole $5,000–$10,000 target range is inside the account's
  current checkout cap; a financing option still depends on the buyer and the
  provider decision shown at checkout.
- Existing product `prod_liEP35ZzcsAOi` has one $5,500 one-time variant
  `plan_B7Arf7ksDzFeV`. Its checkout reached created and completed with provider
  `splitit`, but the payment status is `Incomplete`. This product/variant is
  evidence only and must not be reused by the code unless its displayed title
  is first verified as the exact safe title below.
- Checkout Links is empty. Developer shows **0 API keys, 0 apps, and 0
  webhooks**. No production API call or signed callback can work until a
  Fundhub-owned key and webhook are created; no live setting was changed in
  this workflow.

### Confirmed repo facts

- The offer catalog's `financing` flag means **Commas financing**, not Whop
  (`src/config/offers.mjs:20-30`). It marks the $1,000 offer financed and the
  $3,000 offer cash-only (`src/config/offers.mjs:104-126`). Capital Blueprint is
  still coded as $5,000 with a $1,000–$5,000 custom range, not the current
  $5,000–$10,000 offer (`src/config/offers.mjs:138-193`).
- The current offer truth is $1,000 full credit optimization, $5,000–$10,000
  Capital Blueprint, and $1,000–$3,000 funding deposit
  (`docs/finance/fundhub-offers-review-2026-10-11.md:8-43,109-125`). The newest
  offer copy says $1,000 financing at 600+ score, Blueprint payable over time,
  and funding-deposit financing for provable income/strong credit
  (`marketing/offers/fundhub-offers-2026-10-10.md:48-72,115-146,190-191`). Those
  older rules conflict with the owner's 2026-10-20 direction and are not proof
  that any provider will approve the transactions.
- Every Whop implementation in `src/merchant/` is for a **client's own** sales
  inside FinanceOS, not Fundhub billing (`api/money/connections.mjs:1-24`,
  `db/migrations/442_merchant_connections.sql:118-176`). Its signed webhook
  writes normalized sale/refund/payout rows to `merchant_events`; it does not
  identify a Fundhub offer, grant the purchased service, or emit Fundhub's
  `payment.received` event (`src/merchant/webhooks.mjs:1-62`,
  `src/merchant/store.mjs:98-184,264-303`).
- Clarity Payments in this repo is Fundhub's internal debt/installment ledger,
  not proof of an external ClarityPay lender integration
  (`docs/journeys/clarity-payments-flow.md:1-9`). Its autopay listener explicitly
  accepts Commas only and says the client-owned Whop webhook never emits
  `payment.received` (`src/handlers/clarity-autopay.mjs:1-55`).
- The checked env files contain Commas keys and the client-merchant encryption
  key, but no Fundhub-owned `WHOP_API_KEY` or `WHOP_WEBHOOK_SECRET` name. Client
  Whop secrets are stored per connection; that does not create a Fundhub billing
  credential.
- `payment_links` already holds the local client, product, sale, amount,
  currency, link reference, closer, and manager identity, but it has only the
  Commas-specific `commas_session_id`. Whop IDs must get their own columns; a
  `pay_`, `plan_`, or `ch_` must never be written into that Commas column
  (`db/migrations/119_payment_links.sql`,
  `db/migrations/247_commission_money_chain_identity.sql`).
- The generic webhook door already preserves the exact raw body and routes
  `/api/webhooks/<provider>` (`api/webhooks/[provider].mjs`,
  `netlify/functions/api.mjs`, `src/http/router.mjs`). The existing Whop
  verifier in `src/merchant/normalize.mjs` is correct but belongs to the
  client-owned merchant path; extract it to one shared neutral module instead
  of copying it.
- The canonical bus and money chain already accept `payment.received`,
  `payment.failed`, `payment.canceled`, `payment.refunded`, and
  `payment.disputed`. A valid `payment.received` carrying the stored payment
  link and product UUID can create the sale payment and grant the existing
  `consulting-package` entitlement. Do not also emit `deposit.paid` or
  `sale.closed`; either would give this one receipt a second sales meaning.
- The intended client/closer/funding-advisor journey docs describe access doors,
  not the financing purchase event order. End-to-end financing fulfillment is
  therefore **UNVERIFIED**, not a journey PASS.

### Lane verdicts

| Lane | Provider fit | Repo state | Current verdict |
|---|---|---|---|
| $1,000 full credit optimization | Inside ClarityPay's amount range, but Whop lists credit repair as ineligible | Commas flag is on; no Fundhub Whop purchase path | **HOLD / cash by default.** Needs actual provider category approval, then the owner choice below. |
| $3,000 funding deposit | Inside provider amount ranges; ClarityPay commitment uses a hard inquiry and its notice permits bureau reporting | Catalog correctly has financing off; no Fundhub Whop purchase path | **Cash-only.** The owner's no-personal-credit-reporting condition is not met by the official ClarityPay evidence. |
| $5,000–$10,000 Capital Blueprint | Amount fits published one-time limits | Catalog stops at $5,000; no Fundhub Whop checkout, purchase callback, fulfillment, refund, or reconciliation path | **Not wired and not proved available.** Requires product approval plus the dedicated rail below. |

### Exact provider-facing names

These strings come verbatim from `commasProductTitle` in
`src/config/offers.mjs`. No provider request, title, description, or product
display name may substitute a restricted or improvised label. Internal
`offer_key` and `product_code` stay in metadata for deterministic routing.

| Price | `offer_key` | `product_code` | Exact provider-facing title |
|---|---|---|---|
| $32 | `SOFT_PULL` | `diagnostic` | `Consulting Services Assessment` |
| $200 | `REPAIR_TRIAL` | `repair-trial` | `Consulting Services Trial` |
| $1,000 | `REPAIR_DFY` | `repair-bundle` | `Consulting Services Standard` |
| $3,000 | `FUNDING_DFY` | `card-stacking-dfy` | `Consulting Services Engagement` |
| $5,000–$10,000 | `UWIQ_DELIVERABLES` | `consulting-package` | `Consulting Services Package` |

The first implementation is hard-gated to the last row only. This design does
not enable Whop for the other four offers.

### Smallest dedicated Capital Blueprint implementation

**Creation route and exact request.** Extend the existing authenticated
`POST /api/payment-links` create action with `provider: "whop"`; do not add a
second staff-facing route. Accept `client_id`, local `product_id`,
`amount_cents`, optional `sale_id`/`sale_motion`, and `currency: "USD"`.
Server-side lookup must require product code `consulting-package`, derive
`offer_key: "UWIQ_DELIVERABLES"`, require 500000–1000000 cents, and reject
caller-supplied provider title/description. Generate the local payment-link UUID
and `link_ref` before the provider call. Call:

```http
POST https://api.whop.com/api/v1/checkout_configurations
Authorization: Bearer <WHOP_API_KEY>
Api-Version-Date: 2026-10-15-1
Idempotency-Key: whop-blueprint:<payment-link-uuid>
Content-Type: application/json
```

```json
{
  "account_id": "<WHOP_ACCOUNT_ID>",
  "mode": "payment",
  "metadata": {
    "fh_schema": "1",
    "fh_payment_link_id": "<uuid>",
    "fh_link_ref": "<opaque-link-ref>",
    "fh_org_id": "<uuid>",
    "fh_client_id": "<uuid>",
    "offer_key": "UWIQ_DELIVERABLES",
    "product_code": "consulting-package",
    "fh_amount_cents": "<500000..1000000>",
    "fh_currency": "USD"
  },
  "plan": {
    "product_id": "<WHOP_CONSULTING_PACKAGE_PRODUCT_ID>",
    "plan_type": "one_time",
    "release_method": "buy_now",
    "initial_price": "<exact amount_cents divided by 100>",
    "currency": "usd",
    "title": "Consulting Services Package",
    "description": "Consulting Services Package",
    "visibility": "hidden"
  }
}
```

Omit `payment_method_configuration` so the account's approved buyer options are
shown automatically. Do not set `split_pay_required_payments`; that creates a
merchant installment plan and is not the financing option being requested. Do
not put customer name, email, phone, notes, or free text in metadata. Store the
response `id` (`ch_`), `plan.id` (`plan_`), and `purchase_url`; the later
payment carries `data.id` (`pay_`) plus those IDs and the copied metadata.

**Schema.** Add `db/migrations/482_whop_blueprint_checkout.sql`:

- add nullable `whop_checkout_configuration_id text`, `whop_plan_id text`, and
  `whop_payment_id text` to `payment_links`;
- add prefix checks, a unique partial index on `(provider,
  whop_checkout_configuration_id)`, a normal lookup index on `whop_plan_id`
  because identical variants can be reused, and a unique partial index on
  `(provider, whop_payment_id)`;
- create `whop_billing_inbox` with `id uuid`, `org_id`, unique
  `(account_id, webhook_id)`, `event_type`, `provider_object_id`, `payment_id`,
  exact `raw_body`, `headers jsonb`, `status` (`pending`, `processing`, `done`,
  `failed`, `ignored`), `attempts`, `last_error`, `received_at`, `claimed_at`,
  and `processed_at`, plus a pending-work index.

The create handler resolves all local context before the provider call, uses the
pre-generated UUID as the provider idempotency anchor, and inserts the returned
IDs with an explicit `payment_links.id`. If the provider returns 200 but the
local insert fails, return no purchase URL. Reconciliation must list recent
checkout configurations/payments, match the copied metadata, and recover the
row before any retry older than Whop's 24-hour idempotency window.

**Webhook and signature.** Add `POST /api/webhooks/whop-billing` as a branch in
`src/http/router.mjs`; do not reuse
`/api/webhooks/merchant-whop/<connection id>`. Extract the existing verifier to
`src/payments/whop-signature.mjs` and import/re-export it from
`src/merchant/normalize.mjs`. Verify the exact raw body with
`WHOP_WEBHOOK_SECRET`: HMAC-SHA256 of
`webhook-id.webhook-timestamp.rawBody`, `v1,<base64>` constant-time comparison,
all three frozen headers required, and timestamp within five minutes. Require
the envelope `account_id` to equal `WHOP_ACCOUNT_ID`, insert the raw delivery in
the inbox, and answer 2xx in under five seconds. The inbox dedupes the same
Whop retry by `webhook_id`; canonical event keys below also dedupe a second
message for the same provider object.

**Strict settlement match.** Before any fulfillment, require all of these to
match the stored row: envelope account, `checkout_configuration_id` (`ch_`),
`plan_id` (`plan_`), provider product ID, all nine metadata values, quantity
one, exact `total.amount` converted from Whop's decimal Money string to integer
cents, and `total.currency = usd`. Then store `data.id` as
`whop_payment_id` and settle through a provider-aware payment-link method; never
write a Whop ID to `commas_session_id`.

**Canonical events.** Process only terminal states:

- `payment.succeeded` -> `payment.received`, idempotency key
  `whop:payment:<pay_id>:received`, `source: "whop"`,
  `providerRef: <pay_id>`, local `paymentLinkId`, `clientId`, `productId`,
  `productCode: "consulting-package"`,
  `productName: "Consulting Services Package"`, amount in major USD units,
  paid time, sale/motion/closer/manager context. Emit no second semantic sale or
  deposit event.
- `payment.failed` -> `payment.failed`, key
  `whop:payment:<pay_id>:failed`; use a failure-specific transaction reference
  so a later recovery with the same `pay_` can still record the successful
  transaction. `payment.canceled` -> `payment.canceled`; neither fulfills nor
  marks the link paid.
- `refund.created` or `refund.updated` -> `payment.refunded` only when the
  refund status is `succeeded`, key `whop:refund:<refund_id>:refunded`, with
  `providerRef: <refund_id>` and `originalProviderRef: <original pay_id>`.
- `dispute.created` -> `payment.disputed`, key
  `whop:dispute:<dispute_id>:disputed`, with the original `pay_` reference and
  provider deadline. Pending/requires-action events are retained as `ignored`.
  Because delivery order is not guaranteed, a reversal received before its
  original payment stays retryable instead of being marked done.

**Exact files.** Change `src/config/offers.mjs` and its test for the $5,000
floor/$10,000 cap; add the migration and
`src/payments/whop-blueprint.mjs`, `src/payments/whop-signature.mjs`,
`src/payments/whop-billing-inbox.mjs`, and
`src/adapters/whop-billing.mjs`; extend `api/payment-links.mjs`,
`src/payment-links/index.mjs`, `src/merchant/normalize.mjs`, and
`src/http/router.mjs`; add `src/workflows/whop-billing-inbox-drain.mjs` plus its
registration in `src/workflows/index.mjs`, a Netlify fallback at
`netlify/functions/whop-billing-inbox-sweeper.mjs`, and heartbeat/route coverage
in `src/pulse/heartbeats.mjs` and `src/pulse/registry.mjs`. Document
`WHOP_API_KEY`, `WHOP_ACCOUNT_ID`,
`WHOP_CONSULTING_PACKAGE_PRODUCT_ID`, and `WHOP_WEBHOOK_SECRET` in
`.env.example`; update the payment-link actual journey after code proof.

**Required tests.** Add request/range/title/metadata/response-ID and provider
error tests for `whop-blueprint`; authorization, Whop-only-product gating,
499999/1000001 rejection, USD-only, and Commas-regression tests for
`api/payment-links`; valid/multiple-signature/mutated-body/missing/stale/future
signature tests; inbox duplicate/concurrent-claim/stale-claim/retry exhaustion
tests including Postgres; adapter identity/amount/currency mismatch, replay,
failed/canceled/refund/dispute, and reversal-before-payment tests; router POST
and GET-405 tests; and a DB money-chain proof that one Whop Blueprint receipt
creates one transaction, sale payment, and entitlement with provider reference
`pay_`. The new scheduled job and pulse registry also need their standard
coverage tests.

Implementation is not a live proof. Before calling this available, run lint,
TypeScript, focused tests, DB tests with a real non-production `DATABASE_URL`,
verify one signed dashboard test delivery, then obtain an explicitly authorized
controlled checkout/payment/refund proof. No application, charge, customer
submission, API key, webhook, or live product was created by Workflow C.

### Proof run

`node --test src/merchant/normalize.test.mjs src/merchant/store.test.mjs src/merchant/providers/providers.test.mjs src/handlers/clarity-autopay.test.mjs`
passed **49/49** on 2026-10-20. This proves the existing client-owned Whop
merchant ingestion and Commas-only Clarity autopay behavior; it does not prove
a Fundhub Whop checkout or financed fulfillment.

### One owner decision

After Whop confirms the actual product category is eligible, decide whether the
**$1,000 full credit optimization offer** should expose financing. Until that
single decision is yes, keep it cash-only. The $3,000 lane is cash-only under
the stated ClarityPay rule, and the $5,000–$10,000 lane remains the required
financing lane once eligibility and wiring are proved.

## Workflow D evidence

**Status:** Read-only trace complete on 2026-10-20. Fundhub has a tested
first-party event stream and browser/server Meta dedupe for the free funnel,
plus a tested server-side Meta Purchase for the six catalog offers. The repo
loads the DirectROAS/Cortana hub tag, but it has **no Fundhub-owned Cortana
custom-event sender, identity call, purchase sender, server feed, stored
DirectROAS receipt, or count reconciliation job**. Therefore none of the five
paid lanes is currently proved to fire a Cortana conversion.

### Tag and provider contract

- The ClickFunnels publisher injects the DirectROAS hub script and removes a
  duplicate page copy when the funnel head already contains it
  (`marketing/landing-pages/tracking-manifest.mjs:193-220,298-307`,
  `scripts/cf-push-custom-html.mjs:175-183,845-923`). The manifest covers
  `/watch`, `/apply`, `/funding-book-call`, and `/thank-you`
  (`marketing/landing-pages/tracking-manifest.mjs:459-560`). The page inventory
  records the tag on all four pages (`docs/tracking/page-inventory.md:27-30`),
  but this trace did not produce fresh live network or dashboard proof.
- The public hub script currently served from
  `https://app.directroas.com/api/hub/v1/cmsdutl8e00mukv041vwuo39w` exposes
  `akTracking` / `CortanaTracking`, `trackEvent(name, data)`,
  `identify({email, phone}, data)`, and conversion calls through
  `corq('track', shortCode, {value, currency})` or
  `akFireConversion(shortCode, options)`. It maintains `ak_tid`, sends Meta
  `_fbc` / `_fbp`, and performs its own time-window dedupe. Its public call does
  not accept Fundhub's event ID, so the current Meta browser/server event-ID
  pattern cannot simply be claimed as Cortana dedupe.
- The same hub script recognizes Stripe and Whop links, not Commas. A Whop link
  needs `data-ak-plan` and `data-ak-connection` for tracked interception;
  otherwise the tag records a link click, not a confirmed purchase. No such
  Fundhub offer markup, conversion short code, or connection mapping exists in
  this repo.
- Existing Cortana boards record working ClickFunnels, GitHub, and read-only DB
  access, but only a DirectROAS sign-in page—not an authenticated dashboard or
  read API (`ops/workflows/cortana-autonomy-assessment-2026-10-20.md:35-47`).
  Conversion source IDs, short codes, received-event rows, and provider counts
  therefore remain unavailable for direct verification.

### Free book-a-call event matrix

| Step | Current Fundhub/browser event | Current server/Meta result | Identity and dedupe | Cortana state and required count |
|---|---|---|---|---|
| `/watch` page | `page_view` | Stored as `funnel.page`; Meta `PageView` plus `ViewContent` | `fh_sid` + sequence; Meta uses `pv.<sid>.<seq>` and `.vc` | Hub tag can make its automatic page/session observation, but no explicit Fundhub `trackEvent`. Compare unique page loads by URL/session after a stored Cortana receipt exists. |
| `/apply` answers | `survey_answer` for every step; final answer carries `last:true` | Every answer maps to Meta `SurveyStep`; final answer also maps to `Lead`; ClickFunnels ingest creates the durable survey/client record | First-party event idempotency is `funnel-track:<fh_sid>:<seq>`; Meta browser/server copies share `<fh_sid>.<seq>`; email/phone enter through the survey/ClickFunnels path | No Cortana answer, Lead, or `identify` call. Reconcile final `survey_answer(last=true)` → one durable `survey.submitted`/client → one Cortana Lead, joined by a stored `ak_tid` and normalized identity. |
| `/funding-book-call` calendar | `calendar_view`, `time_selected`, then `booking_confirmed` from the accepted framed calendar message | `booking_confirmed` maps to Meta `Schedule`; ClickFunnels booking webhook emits the durable `booking.created` fact | Browser event keeps the same session; booking UID plus normalized email/phone is the durable join | No Cortana calendar or Schedule call. Reconcile one accepted `booking_confirmed` → one `booking.created` by booking UID → one Cortana Schedule; do not count calendar views as bookings. |
| `/thank-you` route | `survey_route` with offer `call-booked` or `call` | Maps to Meta custom `SurveyRouted` | Fundhub/Meta use the same `<fh_sid>.<seq>` | No Cortana routed event. Compare one terminal route per session with a stored Cortana event/receipt. |

The exact browser rules are in `public/funnel/fh-events.js:78-104,279-350`;
the survey sends and final-answer marker are in
`marketing/landing-pages/apply-survey.html:378-445`; the accepted calendar
signal is in `marketing/landing-pages/04e-book-confirm.html:47-56,113-146`;
and the thank-you route is in `public/funnel/thankyou-sort.js:457-474`.
The first-party persistence and Meta server copy are in
`src/funnel/track.mjs:367-469`; the matching Meta map and event IDs are in
`src/meta/map.mjs:83-154,162-197` and `docs/tracking/meta-events.md:36-55`.

### Paid-offer event matrix

For a successful Commas callback, the adapter always emits
`payment.received`; it adds `diagnostic.paid`, `deposit.paid`, or `sale.closed`
only for the three recognized product buckets
(`src/adapters/commas.mjs:400-423,426-532`). The callback inbox dedupes on
`<paymentId>:<eventType>` with a database uniqueness constraint
(`src/payments/commas-inbox.mjs:65-111`). The existing Purchase sender is Meta,
not Cortana: it chooses exactly one money event per offer, uses
`purchase.<paymentId>` (then provider/event fallback), takes the actual paid
amount before catalog fallback, fixes currency to USD, and sends hashed
email/phone/client ID plus stored `_fbc` / `_fbp`
(`src/handlers/meta-purchase.mjs:61-142,267-378`).

| Owner lane | Stable catalog key / product code | Purchase confirmation and current Meta trigger | Amount sent today | Cortana status |
|---|---|---|---|---|
| $32 | `SOFT_PULL` / `diagnostic` | Verified Commas success → `diagnostic.paid` | Actual paid amount; $32 catalog fallback, USD | Missing purchase conversion, short code, server receipt, and reconciliation. |
| $200 | `REPAIR_TRIAL` / `repair-trial` | Verified Commas success → `payment.received` | Actual paid amount; $200 fallback, USD | Missing. |
| $1,000 | `REPAIR_DFY` / `repair-bundle` | Verified Commas success → `payment.received` | Actual paid amount; $1,000 fallback, USD | Missing. A custom-priced `UWIQ_DELIVERABLES` can also be $1,000, so amount alone must never choose this lane. |
| $3,000 | `FUNDING_DFY` / `card-stacking-dfy` | Verified Commas success → `deposit.paid` | Actual paid amount; $3,000 fallback, USD | Missing. |
| Current $5,000 Blueprint | `UWIQ_DELIVERABLES` / `consulting-package` | Verified Commas success → `sale.closed` | Actual paid amount; $5,000 fallback, USD | Missing. Catalog custom range is still $1,000–$5,000. |
| Current $5,000 Academy | `FUNDING_MASTERY` / `funding-mastery` | Verified Commas success → `payment.received` | Actual paid amount; $5,000 fallback, USD | Missing. This is a second distinct $5,000 offer and must not share Blueprint's product mapping. |
| Requested variable $5,000–$10,000 | **No canonical current key/product/plan spans this range** | No Fundhub Whop purchase callback enters the canonical payment stream | Not defined through $10,000 | Cannot be reconciled or proved until the money rail supplies one stable offer key, exact-price order ID, provider payment ID, and signed confirmation. |

The catalog values and keys are in `src/config/offers.mjs:91-204`. An amount is
not an offer identity. Every paid conversion must be selected by stable
`offer_key` / `product_code`, then carry the processor payment ID, actual amount,
currency, client ID, and `ak_tid`.

### Proposed exact Cortana contract (`fh-cortana-v1`)

This is the implementation contract, not a claim that the events are live.
Browser calls are observations only. Durable Lead, Schedule, and Purchase
conversions are **server-only**, so a browser retry cannot create a second
conversion. DirectROAS-assigned short codes and source IDs remain explicit
pending values until authenticated provider access returns the real ones.

#### Shared browser envelope

Call `akTracking.trackEvent(event_name, event_data)` (falling back to
`CortanaTracking.trackEvent`) with exactly these fields:

```json
{
  "schema_version": "fh-cortana-v1",
  "event_id": "dr.b.<event_name>.<fh_sid-or-sha256(order_id)[0:32]>",
  "occurred_at": "<UTC ISO-8601>",
  "funnel": "book_call|paid_offer",
  "stage": "<canonical stage>",
  "page_path": "<canonical path>",
  "session_id": "<fh_sid>",
  "ak_tid": "<DirectROAS cookie id when present>",
  "offer_code": "<neutral code when paid>",
  "offer_label": "<neutral label when paid>",
  "quoted_value": "<decimal USD when paid>",
  "currency": "USD",
  "utm_source": "<when present>",
  "utm_medium": "<when present>",
  "utm_campaign": "<when present>",
  "utm_content": "<when present>",
  "utm_term": "<when present>",
  "fbc": "<when present>",
  "fbp": "<when present>"
}
```

Omit paid-only and absent fields; never send them as empty strings. Each
browser `event_id` is first-occurrence-only per session/order and is also saved
on the Fundhub first-party row. DirectROAS's automatic raw page view remains a
separate diagnostic count and is not used as a funnel-stage conversion.

After a valid application submit, call:

```js
akTracking.identify(
  { email: normalizedEmail, phone: e164Phone },
  { schema_version: "fh-cortana-v1", client_id: clientIdWhenKnown, session_id: fhSid, ak_tid }
)
```

The identity join is `client_id` + normalized email/phone + `fh_sid` +
`ak_tid`; omit browser-side `client_id` until Fundhub has returned/resolved it,
then retain it on the server outbox. Keep `_fbc` / `_fbp` as attribution
fields. Do not send survey answers, SSN, card data, or other typed financial
data.

Every authoritative Lead or Schedule uses this Fundhub server-outbox envelope:

```json
{
  "schema_version": "fh-cortana-v1",
  "event_name": "book_call_lead_confirmed|book_call_scheduled",
  "event_id": "<deterministic server event ID from the table below>",
  "occurred_at": "<durable event UTC time>",
  "source_id": "<PENDING_DIRECTROAS_SOURCE_ID>",
  "short_code": "<PENDING_DIRECTROAS_SHORT_CODE>",
  "identity": {
    "client_id": "<Fundhub client UUID>",
    "email": "<normalized email>",
    "phone": "<E.164 phone>",
    "session_id": "<fh_sid when known>",
    "ak_tid": "<when known>",
    "fbc": "<when known>",
    "fbp": "<when known>"
  },
  "context": {
    "funnel": "book_call",
    "stage": "application_submitted|scheduled",
    "booking_uid": "<Fundhub-only Schedule reconciliation field>"
  }
}
```

Omit `booking_uid` for Lead. Free conversions omit `value` and `currency`.

#### Free book-a-call names

| Page/action | Browser custom event | Browser event ID | Authoritative server conversion | Server event ID / trigger | Value |
|---|---|---|---|---|---|
| First `/watch` view | `book_call_watch_view` | `dr.b.book_call_watch_view.<fh_sid>` | None | None | Omit |
| First `/apply` view | `book_call_apply_view` | `dr.b.book_call_apply_view.<fh_sid>` | None | None | Omit |
| First survey answer | `book_call_apply_started` | `dr.b.book_call_apply_started.<fh_sid>` | None | None | Omit |
| Final valid survey submit | `book_call_apply_submitted` | `dr.b.book_call_apply_submitted.<fh_sid>` | `book_call_lead_confirmed` | `dr.s.book_call_lead.<survey_event_uuid>` from the one durable `survey.submitted` event | Omit |
| First calendar render | `book_call_calendar_view` | `dr.b.book_call_calendar_view.<fh_sid>` | None | None | Omit |
| First valid time pick | `book_call_time_selected` | `dr.b.book_call_time_selected.<fh_sid>` | None | None | Omit |
| Accepted calendar submit | `book_call_booking_observed` | `dr.b.book_call_booking_observed.<fh_sid>` | `book_call_scheduled` | `dr.s.book_call_schedule.<sha256(booking_uid)[0:32]>` from the one durable `booking.created` event | Omit |
| First `/thank-you` view | `book_call_thank_you_view` | `dr.b.book_call_thank_you_view.<fh_sid>` | None | None | Omit |

The browser submit/booking events show user experience; they are not revenue or
durable conversions. The two server events are the only Lead and Schedule
optimization events. Their outbox rows must carry `client_id`, normalized
email/phone, `fh_sid`, `ak_tid`, `_fbc`, `_fbp`, event time, and for Schedule
the raw `booking_uid` in Fundhub-only reconciliation metadata.

#### Paid offer names and values

Use the same browser name, `offer_checkout_opened`, and the same server name,
`offer_purchase_confirmed`, for all five lanes. The stable neutral `offer_code`
and separate DirectROAS conversion source distinguish them. Provider-facing
labels stay truthful and neutral; internal catalog keys remain in Fundhub's
outbox/reconciliation row and never get inferred from price.

| Owner lane | Fundhub-only internal key | Provider `offer_code` | Provider `offer_label` | Browser checkout event ID | Server Purchase event ID | Expected value |
|---|---|---|---|---|---|---:|
| $32 | `SOFT_PULL` | `consulting_services_assessment` | `Consulting Services Assessment` | `dr.b.offer_checkout_opened.<sha256(order_id)[0:32]>` | `dr.s.purchase.<provider>.<sha256(payment_id)[0:32]>` | `32.00 USD` |
| $200 | `REPAIR_TRIAL` | `consulting_services_trial` | `Consulting Services Trial` | Same pattern | Same pattern | `200.00 USD` |
| $1,000 | `REPAIR_DFY` | `consulting_services_standard` | `Consulting Services Standard` | Same pattern | Same pattern | `1000.00 USD` |
| $3,000 | `FUNDING_DFY` | `consulting_services_engagement` | `Consulting Services Engagement` | Same pattern | Same pattern | `3000.00 USD` |
| $5,000–$10,000 | `UWIQ_DELIVERABLES` | `consulting_services_package` | `Consulting Services Package` | Same pattern | Same pattern | Actual settled `5000.00`–`10000.00 USD` |

`FUNDING_MASTERY` is not silently folded into the requested variable lane. If
it remains sellable, it needs its own provider code and conversion source.

The checkout observation carries the exact quoted decimal `quoted_value`, but
does not report revenue. Only a verified, successful Commas or Whop payment
callback may create `offer_purchase_confirmed`. Its Fundhub server envelope is:

```json
{
  "schema_version": "fh-cortana-v1",
  "event_name": "offer_purchase_confirmed",
  "event_id": "dr.s.purchase.<provider>.<sha256(payment_id)[0:32]>",
  "occurred_at": "<provider-settled UTC time>",
  "source_id": "<PENDING_DIRECTROAS_SOURCE_ID>",
  "short_code": "<PENDING_DIRECTROAS_SHORT_CODE>",
  "identity": {
    "client_id": "<Fundhub client UUID>",
    "email": "<normalized email>",
    "phone": "<E.164 phone>",
    "session_id": "<fh_sid when known>",
    "ak_tid": "<when known>",
    "fbc": "<when known>",
    "fbp": "<when known>"
  },
  "offer": {
    "code": "<provider-neutral offer_code>",
    "label": "<provider-neutral offer_label>"
  },
  "payment": {
    "provider": "commas|whop",
    "payment_id": "<provider payment ID>",
    "order_id": "<Fundhub order/payment-link ID>",
    "amount_cents": "<positive integer>",
    "value": "<amount_cents / 100 as decimal USD>",
    "currency": "USD",
    "status": "succeeded"
  }
}
```

The DirectROAS adapter must map this outbox envelope into the authenticated
server API after provider access confirms its endpoint, authentication, and
accepted fields. Until then, the server conversions remain pending; do not
replace them with a browser revenue call. The complete envelope and raw
provider IDs stay in Fundhub's outbox/receipt record. A fixed-lane amount
mismatch is an exception to review, not permission to remap the offer by
dollars.

#### Provider assignments — deliberately pending

| Server conversion | DirectROAS short code | DirectROAS source ID | Sender |
|---|---|---|---|
| `book_call_lead_confirmed` | `PENDING_DR_BOOK_CALL_LEAD_SHORT_CODE` | `PENDING_DR_BOOK_CALL_LEAD_SOURCE_ID` | Fundhub server only |
| `book_call_scheduled` | `PENDING_DR_BOOK_CALL_SCHEDULE_SHORT_CODE` | `PENDING_DR_BOOK_CALL_SCHEDULE_SOURCE_ID` | Fundhub server only |
| Purchase — `consulting_services_assessment` | `PENDING_DR_CONSULTING_ASSESSMENT_32_SHORT_CODE` | `PENDING_DR_CONSULTING_ASSESSMENT_32_SOURCE_ID` | Fundhub server only |
| Purchase — `consulting_services_trial` | `PENDING_DR_CONSULTING_TRIAL_200_SHORT_CODE` | `PENDING_DR_CONSULTING_TRIAL_200_SOURCE_ID` | Fundhub server only |
| Purchase — `consulting_services_standard` | `PENDING_DR_CONSULTING_STANDARD_1000_SHORT_CODE` | `PENDING_DR_CONSULTING_STANDARD_1000_SOURCE_ID` | Fundhub server only |
| Purchase — `consulting_services_engagement` | `PENDING_DR_CONSULTING_ENGAGEMENT_3000_SHORT_CODE` | `PENDING_DR_CONSULTING_ENGAGEMENT_3000_SOURCE_ID` | Fundhub server only |
| Purchase — `consulting_services_package` | `PENDING_DR_CONSULTING_PACKAGE_VARIABLE_SHORT_CODE` | `PENDING_DR_CONSULTING_PACKAGE_VARIABLE_SOURCE_ID` | Fundhub server only |

No placeholder above is a provider credential or claimed configured value.

#### Dedupe and exact reconciliation acceptance

- Save every server event first under unique key
  `directroas:<org_id>:<event_id>`. A retry reads the saved success/receipt and
  never performs a second send. A failed send remains retryable with the same
  `event_id`; a new random ID is forbidden.
- **Controlled free-path proof:** custom browser counts for watch, apply view,
  apply start, apply submit, calendar view, booking observed, and thank-you are
  each `1` for the marked session. Server counts must be
  `1 survey.submitted = 1 Lead outbox = 1 Lead sent = 1 DirectROAS Lead received`
  and
  `1 booking.created = 1 Schedule outbox = 1 Schedule sent = 1 DirectROAS Schedule received`.
  The tag's raw page-view count is reported separately because reloads are real.
- **Production free-path report:** for the cohort whose first eligible stage is
  `/watch`, unique-session counts must descend
  `watch >= apply_view >= apply_started >= apply_submitted >= calendar_view >= scheduled`.
  Report browser-to-server loss separately; do not force raw events to equality.
- **Each paid lane:** for the same UTC window and offer code,
  `distinct successful processor payment IDs = distinct canonical payment.received IDs = distinct Purchase outbox event_ids = distinct DirectROAS received event_ids`.
  The four counts must match, duplicate event IDs must be `0`, unsent/failed
  outbox rows must be `0`, and
  `SUM(processor amount_cents) = SUM(outbox amount_cents) = SUM(DirectROAS value * 100)`.
- `diagnostic.paid`, `deposit.paid`, and `sale.closed` are semantic companions,
  not extra Purchases. Refund/dispute events are separate reversals/statuses and
  never increment the Purchase count.

### Required count reconciliation

Use one UTC window and one marked test identity, with staff/demo/agent traffic
excluded. Do not infer equality from aggregate lifetime totals.

1. **Free funnel:** join each Fundhub `funnel.*` row to one DirectROAS row by a
   persisted `ak_tid` plus Fundhub event ID. Compare page → final survey/Lead →
   accepted booking/`booking.created` → thank-you route. Report both distinct
   identities and raw events; repeated answer steps and calendar views are not
   conversions.
2. **Paid funnel:** one unique successful processor payment ID must yield one
   canonical `payment.received`, one offer-specific Purchase, and one
   DirectROAS received conversion. Reconcile row-by-row on payment ID,
   `offer_key` / `product_code`, amount, currency, client ID, and UTC timestamp;
   also compare count and amount sum per offer. Refunds/disputes stay separate
   and never count as a new Purchase.
3. **Dedupe:** persist DirectROAS request/receipt state under a stable internal
   idempotency key such as `directroas:purchase:<paymentId>`. The hub's local
   short-code timer is not durable server/payment dedupe, and `ak_tid` is an
   identity join—not an event ID.

Today Fundhub stores `fh_sid`, UTM attribution, `_fbc` / `_fbp`, normalized
email/phone, booking UID, and processor payment ID, but it does not persist
`ak_tid` on the lead/booking/payment path. Attribution capture is in
`public/funnel/fh-attribution.js:1-89,196-218`; ClickFunnels normalization and
storage are in `src/adapters/clickfunnels.mjs:195-221,254-478,820-1013`.

### Proof run

`node --test src/handlers/meta-purchase.test.mjs src/ads/fh-events-meta.test.mjs src/funnel/track-meta.test.mjs src/adapters/commas.test.mjs src/adapters/clickfunnels.test.mjs src/ads/meta-pixel-snippet.test.mjs`
passed **235/235**, with zero failures and zero skips, on 2026-10-20. This proves
the current Fundhub/Meta mapping, Commas signature/inbox/dedupe behavior, and
all six catalog-offer Meta Purchase triggers. It does **not** prove any Cortana
custom event, identity, purchase, dashboard receipt, or provider count. There
are no DirectROAS-specific custom-event, server-send, or reconciliation tests.

### What Codex can finish without Chris

Codex can add the browser adapter and `identify`, capture and persist `ak_tid`,
add an idempotent server Purchase sender, store request/receipt state, build the
row-level reconciliation report, add tests, push through the existing
ClickFunnels API path, and prove Fundhub-side browser/server behavior. To close
the provider side, Codex still needs authenticated DirectROAS dashboard/read
access plus the configured conversion short codes/source IDs. The requested
$5,000–$10,000 lane also needs Workflow B/C to supply its canonical offer/plan
mapping and signed Whop purchase confirmation before tracking can truthfully be
called complete.

## Joined source-of-truth map

The free book-a-call funnel and paid offer ladder are separate systems. They
share identity and Cortana attribution only after the missing adapter/outbox is
built; a booking is never a purchase and a checkout open is never revenue.

| Lane | Entry and route | Exact offer and customer/provider title | Money and authoritative success | Cortana state | Current verdict |
|---|---|---|---|---|---|
| Free book-a-call | `/watch` -> `/apply` -> `/funding-book-call` -> `/thank-you` | No paid offer | Final survey creates the lead; accepted calendar message plus ClickFunnels webhook creates `booking.created` | Base hub tag is present; explicit events, `identify`, `ak_tid` persistence, server Lead/Schedule, receipts, and reconciliation are missing | **Mapped, not linked** |
| $32 | Public optimize path or closer | `SOFT_PULL` / `diagnostic` / `Consulting Services Assessment` | Commas success -> `payment.received` + `diagnostic.paid`; four historical $32 successes found | Purchase sender and receipt missing | **Code exists; fresh end-to-end proof missing** |
| $200 | Post-pull repair door or closer | `REPAIR_TRIAL` / `repair-trial` / `Consulting Services Trial` | Commas success -> `payment.received`; no matching stored success found | Purchase sender and receipt missing | **Code exists; live success unproved** |
| $1,000 | Post-pull repair door or closer | `REPAIR_DFY` / `repair-bundle` / `Consulting Services Standard` | Commas success -> `payment.received`; one historical success found | Purchase sender and receipt missing | **Cash first; financing stays off until a later explicit yes** |
| $3,000 | Closer | `FUNDING_DFY` / `card-stacking-dfy` / `Consulting Services Engagement` | Commas success -> `payment.received` + `deposit.paid`; eleven historical successes and one failure found | Purchase sender and receipt missing | **Cash-only; the stated ClarityPay condition is not met** |
| $5,000–$10,000 | Closer chooses one exact amount; Commas is the pay-in-full rail and Whop is the financing rail | `UWIQ_DELIVERABLES` / `consulting-package` / `Consulting Services Package` | Both providers must converge on one exact local order, agreement amount, `payment.received`, entitlement, refund/dispute handling, and dedupe | Purchase sender and receipt missing | **Current system stops at fixed $5,000; variable amount and Whop rail are missing** |

`FUNDING_MASTERY` remains a separate $5,000 offer with title `Consulting
Services Program`; it is not part of the requested variable lane.

### Autonomy verdict

Codex can implement the Fundhub-side Commas repair, one server-owned variable
amount, matching agreement amount, Whop checkout/webhook/reconciliation rail,
Cortana browser/server outbox, tests, ClickFunnels publish, and row-level count
proof without another offer decision. The safe defaults are $200 cash, $1,000
cash until later approval, $3,000 cash-only, and Whop financing for the
$5,000–$10,000 package.

Three external proof steps are not autonomous today: authenticated DirectROAS
access to obtain the real short codes/source IDs, action-time confirmation to
create the Whop API key/webhook, and an expressly authorized controlled payment
to prove checkout -> callback -> fulfillment -> Cortana receipt. Until those
three occur, “all lanes fire live” would be an unsupported claim.

## Verification ledger

| Lane | Route mapped | Provider request tested | Callback tested | Stored result checked | Tracking reconciled | Live customer proof |
|---|---|---|---|---|---|---|
| Free book-a-call | Yes | N/A | Current ClickFunnels/Meta code only | Route/storage code checked | **No** | **No fresh marked journey** |
| $32 | Yes | Commas GET/auth only; no mint | Unit-tested; no fresh delivery | Four historical successes | **No** | **No** |
| $200 | Yes | Commas GET/auth only; no mint | Unit-tested; no fresh delivery | No success found | **No** | **No** |
| $1,000 | Yes | Commas GET/auth only; no mint | Unit-tested; no fresh delivery | One historical success | **No** | **No** |
| $3,000 | Yes | Commas GET/auth only; no mint | Unit-tested; no fresh delivery | Eleven historical successes; one failure | **No** | **No** |
| $5,000–$10,000 variable | Partial: $5,000 only | Commas GET/auth plus Whop UI evidence; no API POST | Commas unit-tested; Whop billing callback absent | Historical $5,000 only; no $10,000 | **No** | **No** |

The 208 Commas-focused tests, 49 merchant/Whop-adjacent tests, and 235 current
Fundhub/Meta tracking tests all passed. They prove existing code behavior, not
a live Cortana conversion or a live Whop-financed sale.
