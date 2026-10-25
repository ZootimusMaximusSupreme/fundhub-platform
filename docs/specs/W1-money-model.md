# W1 — The Money Model (white-label partner channel)

> **COMPLIANCE REVIEW REQUIRED** — this document sets fee timing and payout
> schedule. It is a marker, not a
> recommendation, and nothing here asks anyone to revisit an owner decision.

**Status:** specification only. No code, no migrations, nothing applied.
**Written:** 2026-08-31 · branch `claude/white-label-models-offer-page-31vn4q`
**Depends on:** nothing. Everything else in this batch depends on this.

---

## Read this first, in one minute

A partner pays $10,000 once to join. They then sell FundHub's funding and credit
repair under their own brand. They keep half the money that actually arrives.
FundHub keeps the other half. If the partner has their own referrers, those
referrers get paid out of the partner's half — never out of FundHub's.

The database to do all of this already exists and is good. The code to write the
rows does not exist. That is the whole job.

---

## Assumptions (not yet decided)

These are **not** owner decisions. Any one of them can change without rewriting
this document. They are listed here so nothing further down quietly depends on a
number nobody picked.

| # | Assumption | Where it bites |
|---|---|---|
| A1 | Winner's Board $47/mo · Decline Autopsy $27 · Live Trial $297 | These are e-products (§Locked D2), so they are 100% FundHub and never touch partner_revenue. If any of them is later reclassified as a service, §2 changes. |
| A2 | Sub-affiliates run on FundHub's existing rails and are auto-deducted from the partner's half | §4 waterfall and §7 payout run |
| A3 | Live Trial covers the machine only; the partner funds their own $500–$1,000 test budget | Not a money event in this ledger at all. Noted so no one adds one. |
| A4 | The production floor number itself (see §6) | The mechanism is specified. The threshold is an open question. |
| A5 | Money is recognised on **cash actually received and cleared**, not on sticker price | §1. This is a recommendation this document makes; it is not yet owner-set. |

---

## Locked owner decisions carried into this spec (2026-08-31)

Recorded as fact. Not re-opened, not commented on.

- **D1.** Partner share is **50%** on repair services and funding services, front
  end and back end. The partner earns 50% of the 10% success fee too.
- **D2.** **E-products are excluded.** Courses, education and digital products
  stay 100% FundHub.
- **D3.** **Entry fee is $10,000, one time. There is no monthly fee.**
- **D4.** The entry fee is financeable through FundHub's own rails. Commas
  finances courses only, so the $10,000 is structured as a training product.
  **No credit gate** — the credit partner finances down to a 405 FICO.
- **D5.** Lender remittance to FundHub by band: prime 680+ **85%**, near prime
  600+ **75%**, Lender B **77 / 72 / 62 / 50 / 30%**, Sub Prime A **42%**.
  $10,000 is under the $17,000 subprime cap, so every band can carry it.
- **D6.** Because entry filters nobody out, the **production floor is the only
  partner filter that exists.** Load-bearing, not a backstop.
- **D7.** Partner recruits a partner: **20% of the $10,000 = $2,000, one time.**
  Nothing on the recruit's production. There is no monthly to pay on.
- **D8.** A partner's own affiliates are paid **out of the partner's half.**
  FundHub's 50% never moves.
- **D9.** Live affiliate schedule: **Tier 1 direct 20%**, **Tier 2 downline 5%**,
  on funding deposit collected or repair enrollment fee. Already applied —
  `db/migrations/260_affiliate_commission_rates_20260824.sql` and
  `db/migrations/261_affiliate_tier1_20pct_20260824.sql`.

---

## Blocking findings carried forward (do not silently fix)

**F1 — Nothing in production writes `partner_revenue`.** The only rows ever
inserted come from a test fixture at
`/home/user/fundhub-platform/src/partners/scope.pg.test.mjs` (lines 202–336).
The 50% is hand-arithmetic today. The same hole exists on the affiliate side:
`/home/user/fundhub-platform/src/affiliates/economics.mjs` exports `convert()`
and **no production file calls it from a payment event.** Only `attribute()` is
wired, from
`/home/user/fundhub-platform/src/workflows/af-02-referral-ownership-capture.mjs`.
Section 7 of this spec is the fix.

**F2 — The schema is production-ready. Build on it.**
`/home/user/fundhub-platform/db/migrations/042_partners.sql` already has
everything: `partners.revenue_share_pct` (per-partner, default 50),
`partner_revenue` rows that freeze `share_pct_applied` at accrual so a rate
change never restates history, two idempotency indexes, a trigger that refuses
DELETE (void-with-reason only), and `partner_payouts` with a database-enforced
gate that blocks payout unless `agreement_signed_at` is stamped and status is
`active`. **Do not design a second ledger.**

**F3 — No earnings claims on any public page.** FundHub's own projection files
record zero measured paid closes. Modeled partner earnings must never appear on
a public page. Every number in this document is an internal accounting rule.

---

## 1. The share base — what the 50% is 50% *of*

### The recommendation

**Cash actually received and cleared by FundHub, net of refunds.** Not sticker
price. Not invoiced amount. Not contract value.

### Why this is the only safe answer

Some of what FundHub sells is financed by a credit partner. When it is, the
lender does not send FundHub the sticker price. It sends a slice, and the slice
depends on the client's credit band (D5). At the weakest band the lender remits
**30%** of the contract.

If the partner's half were computed on sticker, FundHub would owe more than
arrived. Here is a $5,000 credit repair sale, in integer cents, both ways:

| Band | Lender remits | 50% of **sticker** (500,000) | 50% of **cash received** | FundHub keeps, sticker basis | FundHub keeps, cash basis |
|---|---|---|---|---|---|
| Prime 680+ (85%) | 425,000 | 250,000 | 212,500 | 175,000 | 212,500 |
| Near prime (75%) | 375,000 | 250,000 | 187,500 | 125,000 | 187,500 |
| Lender B (62%) | 310,000 | 250,000 | 155,000 | 60,000 | 155,000 |
| Sub Prime A (42%) | 210,000 | 250,000 | 105,000 | **−40,000** | 105,000 |
| Lender B (30%) | 150,000 | 250,000 | 75,000 | **−100,000** | 75,000 |

Plain English: on a sticker basis, FundHub **loses one thousand dollars** on a
weak-credit repair sale that looked profitable. On a cash basis FundHub keeps
exactly half of whatever arrived, at every band, forever. The partner is never
worse off than half of real money, and the split is impossible to make negative.

### Which products this actually bites on

Checked against `/home/user/fundhub-platform/src/config/offers.mjs`:

- `FUNDING_DFY` — `financing: false`. The $3,000 deposit is paid in full cash.
  Sticker and cash are the same number. No exposure.
- `REPAIR_DFY` ($1,000) and `REPAIR_TRIAL` ($200) — `financing: true`. **These
  are where the gap opens.**
- The **$10,000 entry fee** is financed by design (D4). Section 5.

### The rule, precise enough to become code

> A `partner_revenue` row's `gross_amount` is the **settled cash amount of one
> `sale_payments` row** belonging to a client whose `clients.partner_id` is set.
> Not the sale's `agreed_price`. Not a projection. One payment row in, one
> accrual row out.

This lines up with the enum already in
`/home/user/fundhub-platform/src/affiliates/economics.mjs` → `basisFor()`, which
already distinguishes `sale_price` (the contract) from `cash_collected` (money
that arrived). The partner ledger uses the cash side.

**A NULL amount means unknown and must survive as unknown.** Per
`/home/user/fundhub-platform/src/commissions/money.mjs`, never default an unknown
to zero. If a payment lands with no resolvable amount, write no accrual and log
it loudly — the same pattern `money-chain.mjs` already uses via
`warnNothingUnlocked()`.

---

## 2. When accrual fires

### The trigger point

There is exactly one durable moment: **a `sale_payments` row is inserted.**

That insert already happens in one place —
`/home/user/fundhub-platform/src/handlers/money-chain.mjs`, function
`ensureSalePayment()` (line 402), which writes to the table defined at
`/home/user/fundhub-platform/db/migrations/011_sales.sql` line 73. That table
already carries replay safety: a unique index on `(org_id, transaction_id)` means
a re-delivered Commas webhook cannot double-count.

**Ride that. Do not add a second listener on the event bus.** The bus
registrations in `money-chain.mjs` `register()` (line 1119) already handle
ordering and replay:

```
diagnostic.paid · deposit.paid · sale.closed · payment.received
round.started · round.funded
```

### What accrues, by payment kind

`sale_payments.kind` is one of four values, checked in the database:

| `kind` | Partner accrual? | Notes |
|---|---|---|
| `deposit` | **Yes** — 50% of the amount | The front-end money |
| `installment` | **Yes** — 50% of the amount | Later payments on the same price |
| `success_fee` | **Yes** — 50% of the amount | The back end. Section 3. |
| `refund` | **No accrual.** Triggers a void. See below. | Stored positive; subtracted in views |

### What never accrues

- Any sale whose client has `clients.partner_id IS NULL` — that is a direct
  FundHub client, not a partner's.
- **E-products (D2).** Courses, education, digital products. The check is on
  `products.code`. `funding-mastery` and any future course code are excluded and
  must be excluded by an explicit allow-list of *service* codes, not by a
  deny-list of course codes — a new course added later must default to excluded,
  not accidentally included. Start from the two codes already named in
  `/home/user/fundhub-platform/src/affiliates/economics.mjs`:
  `FUNDING_PRODUCT_CODES = ["card-stacking-dfy"]` and
  `REPAIR_PRODUCT_CODES = ["repair-bundle"]`, plus `repair-trial`.
- The **$10,000 entry fee itself** — that is money flowing *to* FundHub from the
  partner, not partner earnings. Section 5 covers the one exception (the
  recruiter's bonus).

### Refunds and chargebacks — void, never delete

`partner_revenue` has a trigger that raises an exception on DELETE. It also has
`CHECK (gross_amount >= 0)` and `CHECK (share_amount >= 0)`, so **a negative row
is impossible.** Reversal therefore works like this:

1. **Full refund.** Find the accrual by `transaction_id` or `source_event_id`.
   Set `status = 'void'` and `void_reason = 'refund:<transaction_id>'`. The
   `CHECK (status <> 'void' OR void_reason IS NOT NULL)` constraint makes a
   reason mandatory — good.
2. **Partial refund.** Void the original row in full, then insert a fresh accrual
   for the net amount that survived, carrying the **same** `share_pct_applied`
   the original froze. Never the partner's current rate. This is exactly what
   frozen rates are for.
3. **Already paid out.** Void it anyway. The balance in `v_partner_balance` goes
   down. `partner_payouts.amount` has no `>= 0` check, so the next payout run can
   be reduced to recover it, and a partner whose reversal exceeds the next run
   carries a negative balance forward until it clears.
4. **Chargeback** (`payment.disputed`) behaves identically to a refund, with
   `void_reason = 'chargeback:<transaction_id>'`.

The events already exist in
`/home/user/fundhub-platform/src/events/canonical.mjs`: `payment.refunded`,
`payment.disputed`.

**Known consequence, stated plainly:** a partner can be paid and then have the
money reversed. There is **no hold-back period** — owner-set, see `W0-decisions.md`;
the original text below is retained for the mechanism only. If Chris wants one,
it is a `partner_payouts.status = 'held'` with a `hold_reason` — the schema
already supports it. **Open question O3.**

---

## 3. The success fee — money that may never come

### The problem

The 10% success fee arrives months later, after the client actually funds. **The
fund rate is UNKNOWN.** FundHub's projection files record zero measured paid
closes. This document does not invent a fund rate and no downstream document
should either.

### The rule

> **Nothing accrues until cash lands.** There is no "expected" or "projected"
> `partner_revenue` row. Ever.

A partner's balance is only ever money that arrived. `v_partner_balance` already
works this way — it sums real rows filtered by status. Leave it alone.

### How the deposit credit works (this is the part people get wrong)

The $3,000 deposit **counts toward** the 10%. It is not additional. So on a
$120,000 funded deal the client owes $12,000 total, of which $3,000 is already
paid, leaving $9,000 to invoice. The partner's entitlement follows the same
arithmetic and must not double-count:

| Moment | Cash event | Partner accrues | Running partner total |
|---|---|---|---|
| Day 0 | deposit, 300,000¢ | 150,000¢ | 150,000¢ |
| Day 90 | success-fee balance, 900,000¢ | 450,000¢ | **600,000¢** |

600,000¢ is exactly 50% of the 1,200,000¢ total fee. No double count, and it
falls out of the "one payment row, one accrual row" rule with no special case.

### If the client never funds

Nothing to void. Nothing was ever accrued. The deposit accrual stands, because
the deposit was really collected and the partner really earned half of it.

### If the fee arrives in pieces

Each `sale_payments` row accrues its own 50% at receipt. A client who pays the
$9,000 balance in three $3,000 instalments produces three accruals of 150,000¢.
Same total, no reconciliation step.

### What the partner portal may show

A **forecast** may appear in the partner portal, but only:

- labelled *"not yet earned"*, visually separate from the balance,
- built from real signed contracts and real funded rounds, never from a modeled
  conversion rate,
- **never on a public page** (F3), and never in `balance_accrued`.

**UNKNOWN, recorded as unknown:** what percentage of deposits ever reach a
funded round. Do not fill this in. The absence is the finding.

---

## 4. The full waterfall, in integer cents

All arithmetic below uses
`/home/user/fundhub-platform/src/commissions/money.mjs`:
`applySplit(cents, 50)` for the partner half, `percentOf(cents, 20)` for the
affiliate (percent units — `20` means 20%), `fromCents()` for display only.

### (a) A $3,000 deposit — 300,000¢

Partner has one direct affiliate who referred the client, and that affiliate was
themselves recruited by someone (so a Tier 2 override applies too).

| Step | Cents | Dollars | Paid out of |
|---|---|---|---|
| Cash collected | 300,000 | $3,000.00 | — |
| **FundHub half** — `applySplit(300000, 50)` | **150,000** | **$1,500.00** | fixed |
| Partner half — `applySplit(300000, 50)` | 150,000 | $1,500.00 | — |
| — Tier 1 affiliate, `percentOf(300000, 20)` | 60,000 | $600.00 | partner's half |
| — Tier 2 override, `percentOf(300000, 5)` | 15,000 | $150.00 | partner's half |
| **Partner net** | **75,000** | **$750.00** | — |
| Check: 150,000 + 60,000 + 15,000 + 75,000 | 300,000 | $3,000.00 | ✓ |

**FundHub's half is 150,000¢ regardless of how many people sit under the
partner.** Add a Tier 3, a Tier 4, a house split inside the partner's own
agency — every one of them comes out of the partner's 150,000¢. The only way
FundHub's number moves is if Chris changes `partners.revenue_share_pct` on that
partner's row, and even then it only affects accruals written **after** the
change, because `share_pct_applied` is frozen on every historical row.

**Timing edge, stated not hidden.** The live affiliate rules (D9, migration 261)
have `amount_basis = 'deposit_collected'` but
`/home/user/fundhub-platform/src/affiliates/economics.mjs` → `qualifyingOutcome()`
only converts a funding referral on a **funded engagement**. So the affiliate's
$600 is calculated on the deposit but crystallises months later, at funding. The
partner's $1,500 accrues at the deposit. **The partner can therefore be paid
before the deduction exists.** Two clean handling options — **open question O2**:

- **O2-a (recommended):** hold 20% + 5% of any partner accrual that has an
  *attributed but not yet converted* affiliate referral against it, released when
  the referral converts or is voided. Uses `partner_payouts.status = 'held'`,
  which the schema already supports.
- **O2-b:** pay the partner gross and recover the affiliate share from a later
  payout run. Simpler, but can leave a partner with a negative balance.

### (b) A $12,000 success fee — 1,200,000¢ total, 900,000¢ still to invoice

| Step | Cents | Dollars |
|---|---|---|
| Total 10% fee on $120,000 funded | 1,200,000 | $12,000.00 |
| Less deposit already credited | −300,000 | −$3,000.00 |
| **Balance actually invoiced and collected** | **900,000** | **$9,000.00** |
| FundHub half — `applySplit(900000, 50)` | **450,000** | **$4,500.00** |
| Partner half — `applySplit(900000, 50)` | 450,000 | $4,500.00 |
| — Tier 1 affiliate on the back end | **0** | **$0.00** |
| — Tier 2 override on the back end | **0** | **$0.00** |
| **Partner net** | **450,000** | **$4,500.00** |

**Why the affiliate gets nothing here, verified not assumed.** Migrations 260 and
261 set the funding affiliate rules to `amount_basis = 'deposit_collected'` — the
deposit, once. There is no back-end affiliate rule in the database. So the
partner's back-end half is undiluted. If Chris later wants affiliates paid on the
success fee, that is a **new rule row** on the existing `affiliate_commission_rules`
table (close the old row, open a new one — never `UPDATE` a live percent, which
is the pattern 261 already follows). **Open question O4.**

### Lifetime totals on one $120,000 deal

| Party | Cents | Dollars |
|---|---|---|
| FundHub | 600,000 | $6,000.00 |
| Partner (before their affiliates) | 600,000 | $6,000.00 |
| Partner's Tier 1 affiliate | 60,000 | $600.00 |
| Partner's Tier 2 override | 15,000 | $150.00 |
| Partner net | 525,000 | $5,250.00 |
| **Total client paid** | **1,200,000** | **$12,000.00** |

---

## 5. The $10,000 entry fee — the sharpest edge in the model

### What actually happens, in order

1. Prospect agrees to become a partner. Price is 1,000,000¢ ($10,000), one time
   (D3).
2. Because Commas finances **courses only** (D4), the $10,000 is structured and
   titled as a training product. `/home/user/fundhub-platform/src/config/offers.mjs`
   already centralises the vendor-facing titles through `commasProductTitleFor()`
   and `COMMAS_TITLE_BY_PRODUCT_CODE`. **Add the entry-fee title there. Do not
   hardcode a title anywhere else.**
3. There is **no credit gate** (D4). Financing is a payment option on the entry
   fee, not a qualification: the lender never decides who becomes a partner. The
   review call does. Price simply never blocks a sale.
4. The lender approves at some band and remits a **partial** amount to FundHub
   (D5). That remittance is the cash event.
5. If a partner recruited this partner, that recruiter is owed **$2,000** (D7).

### How the partial remittance is recorded

The lender's payment is FundHub's own revenue, not partner revenue. It lands in
`transactions` (defined at `/home/user/fundhub-platform/db/schema/001_init.sql`
line 152) exactly like any other Commas payment, with `amount_paid` set to **what
actually arrived**, and the sticker price carried in `raw_payload`. That keeps
FundHub's books honest: cash in is cash in.

| Band (D5) | Remit % | Cents received | Dollars |
|---|---|---|---|
| Prime 680+ | 85% | 850,000 | $8,500.00 |
| Lender B tier 1 | 77% | 770,000 | $7,700.00 |
| Near prime 600+ | 75% | 750,000 | $7,500.00 |
| Lender B tier 2 | 72% | 720,000 | $7,200.00 |
| Lender B tier 3 | 62% | 620,000 | $6,200.00 |
| Lender B tier 4 | 50% | 500,000 | $5,000.00 |
| Sub Prime A | 42% | 420,000 | $4,200.00 |
| Lender B tier 5 | 30% | 300,000 | $3,000.00 |

### The recruit bonus — the edge

D7 is locked: **20% of the $10,000 entry fee = $2,000, one time.** That is
200,000¢, and it is a fixed number set against the **sticker**, not against the
remittance. The remittance varies; the promise does not.

That means FundHub's net on a financed entry is remittance minus 200,000¢:

| Band | Remit ¢ | Recruit bonus ¢ | **FundHub net ¢** | FundHub net $ |
|---|---|---|---|---|
| Prime 680+ (85%) | 850,000 | 200,000 | 650,000 | $6,500.00 |
| Lender B (77%) | 770,000 | 200,000 | 570,000 | $5,700.00 |
| Near prime (75%) | 750,000 | 200,000 | 550,000 | $5,500.00 |
| Lender B (72%) | 720,000 | 200,000 | 520,000 | $5,200.00 |
| Lender B (62%) | 620,000 | 200,000 | 420,000 | $4,200.00 |
| Lender B (50%) | 500,000 | 200,000 | 300,000 | $3,000.00 |
| Sub Prime A (42%) | 420,000 | 200,000 | 220,000 | $2,200.00 |
| **Lender B (30%)** | **300,000** | **200,000** | **100,000** | **$1,000.00** |

**The finding, stated once and then dropped:** at the 30% band a recruited entry
nets FundHub $1,000, and two thirds of the cash that arrived walks straight back
out. It is still positive at every band. It is not negative anywhere. But a
chargeback on a 30%-band financed entry after the recruiter has been paid leaves
FundHub down $2,000 on that partner. That is why the bonus **accrues on cash
received, not on contract signature** — see the timing rule below.

### How the bonus is recorded — it fits the existing schema exactly

The recruit bonus is a `partner_revenue` row on the **recruiting** partner:

| Column | Value | Why |
|---|---|---|
| `partner_id` | the **recruiter** | who gets paid |
| `client_id` | `NULL` | there is no client; this is partner-to-partner |
| `gross_amount` | `10000.00` (1,000,000¢) | the sticker entry fee |
| `share_pct_applied` | `20` | **not** the partner's 50 — a different rate for a different event, frozen forever on this row |
| `share_amount` | `2000.00` (200,000¢) | `percentOf(1000000, 20)` |
| `transaction_id` | the lender's remittance transaction | idempotency, and the audit trail back to real cash |
| `source_event_id` | the `payment.received` event | second idempotency path |
| `status` | `accrued` | released on the next payout run |

`share_pct_applied` is `numeric(9,5)` with `CHECK (>= 0 AND <= 100)`, so 20 is
valid. `share_amount / gross_amount` reconciles to `share_pct_applied` exactly,
which keeps the ledger self-checking. **No new table. No new column.**

### Timing rule for the bonus

> The recruit bonus accrues **when the lender's remittance lands and clears**,
> not when the partner signs, and not when the loan is approved.

If the entry is paid in cash rather than financed, the trigger is the same — the
cash landing. One rule, both paths.

It then pays on the next payout run, subject to the existing database gate: the
**recruiter** must have `agreement_signed_at` stamped and `status = 'active'`, or
the payout trigger in `042_partners.sql` raises an exception. That gate is free
and already enforced. Do not re-implement it in application code.

### One thing this section does not cover

**The $10,000 is not refunded on downgrade (§6).** It buys the seat. Whether it
is refundable at all in the first 30 days is **open question O5** — the schema
handles a refund fine (void the recruit bonus with
`void_reason = 'entry_refund:<tx>'`), but the commercial policy is not set.

---

## 6. Production floors — now the only partner filter

Entry no longer screens anyone (D4, D6). So this section is the entire quality
control on the partner base. Treat it as load-bearing.

### The measurement

| Setting | Value | Reason |
|---|---|---|
| **What is measured** | Sum of `partner_revenue.gross_amount` for rows with `status IN ('accrued','paid')` and `occurred_at` inside the window | This is real cash from real clients. It cannot be gamed by self-reported ad spend, and it needs no new table. |
| **Window** | Rolling **90 days**, half-open `[start, end)` | Matches the half-open period convention already used by `partner_payouts.period_start / period_end`. |
| **Grace** | First **90 days** after `partners.status` becomes `active` | Ad accounts take weeks to season. A partner is not judged on their ramp. |
| **First evaluation** | Day **180** after activation (90-day grace, then one full 90-day window) | The first score is over a complete window, never a partial one. |
| **Cadence** | Evaluated on the **1st of each month** | Predictable. One job, one day. |

### The ladder

| State | Trigger | What happens | Partner sees |
|---|---|---|---|
| **Good standing** | Window total ≥ floor | Nothing | Nothing |
| **Warning** | **1** window below floor | Email + a banner in the partner portal, naming the number and the date of the next check | "You are below the production minimum. You have until [date]." |
| **Final notice** | **2 consecutive** windows below floor | Second email, 30-day cure period, stated plainly | "One more month below the minimum moves you to the referral schedule." |
| **Downgrade** | **3 consecutive** windows below floor | `UPDATE partners SET revenue_share_pct = 20` | "Your share is now 20% on new business. Everything already earned is unchanged." |
| **Restored** | One full window at or above floor after downgrade | `UPDATE partners SET revenue_share_pct = 50` | "You are back to 50% on new business." |

### Why this cannot restate history — and this is the whole reason 042 exists

Every `partner_revenue` row froze `share_pct_applied` at the moment it was
written. Changing `partners.revenue_share_pct` from 50 to 20 changes **only what
future accruals compute.** Not one historical row moves. Not one already-issued
payout changes. The partner's past statements stay exactly as they were printed.

Reversal works the same way, which is what makes the ladder safe to run
automatically: a partner who recovers is not retroactively made whole, and a
partner who slips is not retroactively docked.

`partners.status` stays `'active'` through a downgrade. Do **not** flip it to
`'paused'` — that status blocks payouts entirely (the database trigger enforces
it), which would withhold money the partner genuinely earned.

### What "downgraded to 20" means in practice

The partner is now on the referral schedule: **20% direct, 5% downline** (D9).

**A deliberate, documented simplification:** keeping them on the partner rails at
`revenue_share_pct = 20` computes 20% of **cash collected**, whereas the live
affiliate rules compute 20% of `deposit_collected` / `sale_price`. On a
fully-paid funding deposit these are the same number. On a financed repair they
are not — cash-collected is smaller, so a downgraded partner earns slightly less
than a pure affiliate would on the same financed sale. This is accepted because
the alternative — migrating a partner's whole book onto the affiliate tables —
means moving client ownership across a tenancy boundary that
`/home/user/fundhub-platform/src/partners/scope.mjs` exists specifically to
prevent. **One ledger wins.** Recorded here so nobody "discovers" it later as a
bug. **Open question O6** if Chris wants exact parity instead.

The partner keeps their book, their brand, and their clients. Their 5% downline
override continues to work through the existing affiliate tables if they recruited
anyone.

### The floor number itself — OPEN, not invented

**This document does not set the number.** Here is the arithmetic Chris needs and
nothing more:

- A partner deploying $25K–$100K in ad spend over a quarter.
- Each funded funding client produces at least 300,000¢ ($3,000) in front-end
  cash, and — if it funds — a further 900,000¢ ($9,000) at the average $120,000
  funded (D-context: owner-set average funded is $100K–$150K).
- So **one funded funding client per quarter** is a 300,000¢ floor on the front
  end alone. **Three** is 900,000¢. **Five** is 1,500,000¢.

**Genuinely unknown, recorded as unknown:** what a partner deploying $25K of ad
spend actually produces in 90 days. FundHub has zero measured partners. There is
no historical number to anchor to, so any threshold picked now is a judgement
call, not a measurement. **Open question O1 — Chris picks; the mechanism above
works with whatever he picks.**

---

## 7. The accrual writer — the missing production code

This is the fix for finding F1.

### New file

**`/home/user/fundhub-platform/src/partners/revenue.mjs`** — the only new module.

Proposed exports:

| Export | Job |
|---|---|
| `accrueForPayment(db, { orgId, saleId, salePaymentId, transactionId, sourceEventId, now })` | Writes one `partner_revenue` row for one settled payment, or returns a reason it wrote nothing. |
| `accrueRecruitBonus(db, { orgId, recruiterPartnerId, transactionId, sourceEventId, now })` | Section 5's $2,000 row. |
| `voidForRefund(db, { orgId, transactionId, reason, netRemainingCents })` | Voids and, on a partial, re-accrues the net at the frozen rate. |
| `PARTNER_SHARE_PRODUCT_CODES` | The **allow-list** of service product codes that share. E-products are excluded by not being on it. |

### Where it hooks in

`/home/user/fundhub-platform/src/handlers/money-chain.mjs`, immediately after
`ensureSalePayment()` returns the new payment row id, inside the existing
handlers:

- `onDepositPaidMoney` (line 672)
- `onPaymentReceivedMoney` (line 706)
- `onRoundFundedMoney` (line 991) — for the success-fee path
- `onSaleClosedMoney` (line 679) — only where it produces a payment row

**Do not register a new bus listener.** `register()` at line 1119 already binds
these six events, and `money-chain.mjs` already carries the
`COMPLIANCE REVIEW REQUIRED: payment rails + fee/commission timing` header. Riding
it keeps ordering, replay and the compliance marker in one place.

### Reuse — nothing here gets rewritten

| Reuse this | From | For |
|---|---|---|
| `applySplit`, `percentOf`, `toCents`, `fromCents`, `roundHalfUp` | `/home/user/fundhub-platform/src/commissions/money.mjs` | all arithmetic. Integer cents in, 2dp string out. `percentOf` takes percent units (`20` = 20%). |
| `ensureSalePayment` | `/home/user/fundhub-platform/src/handlers/money-chain.mjs` (line 402) | the payment row and its transaction link |
| `resolveClient` | `/home/user/fundhub-platform/src/handlers/client-lifecycle.mjs` | client identity from the event |
| `convert` | `/home/user/fundhub-platform/src/affiliates/economics.mjs` (line 233) | **the affiliate half of F1.** It exists, it is correct, and nothing calls it. Call it from the same hook. Do not write a second commission calculator. |
| `basisFor` | same file (line 202) | the `cash_collected` / `deposit_collected` basis formulas |
| `scopeFor`, `partnerPrincipal`, `where` | `/home/user/fundhub-platform/src/partners/scope.mjs` | every partner-facing read. The tenancy boundary. |
| `v_partner_balance` | `/home/user/fundhub-platform/db/migrations/042_partners.sql` | balances. Do not write a new aggregate. |
| `commasProductTitleFor` | `/home/user/fundhub-platform/src/config/offers.mjs` | the entry fee's vendor-facing title |

### Idempotency — use what the schema gives you

`042_partners.sql` has **two** partial unique indexes on `partner_revenue`:

```
partner_revenue_event_uniq  (org_id, source_event_id, partner_id) WHERE source_event_id IS NOT NULL
partner_revenue_tx_uniq     (org_id, transaction_id,  partner_id) WHERE transaction_id  IS NOT NULL
```

Rule: **set both columns whenever both are known**, and insert with a bare
`ON CONFLICT DO NOTHING` (no conflict target), which in Postgres covers every
unique index on the table. Same event replayed twice → one row. A backfill re-run
over the same transaction → one row. Both paths covered, no application-side
locking.

If the insert affects zero rows, that is a **successful no-op**, not an error.
Return `{ accrued: false, reason: "already_accrued" }`.

### Tests that prove it

**The glob trap, restated:** `npm test` globs `src/**` and `scripts/**` only. **A
test placed under `api/` silently never runs.** Endpoint tests live at
`src/http/<name>.pg.test.mjs` and import the `api/` handler.

| Test file | Proves |
|---|---|
| `/home/user/fundhub-platform/src/partners/revenue.test.mjs` | Pure math, no database. The §4 waterfall to the cent. Rounding on odd amounts. `percentOf` percent-units are not misread as fractions. A NULL amount stays NULL and never becomes 0. |
| `/home/user/fundhub-platform/src/partners/revenue.pg.test.mjs` | Against real Postgres: one payment → one row with `share_pct_applied` copied from the partner. **Same event twice → still one row** (both indexes). Refund → `status='void'` with a reason. Partial refund → void + net re-accrual at the *frozen* rate. Changing `partners.revenue_share_pct` after accrual → historical `share_amount` unchanged. A client with `partner_id IS NULL` → no row. An e-product code → no row. |
| `/home/user/fundhub-platform/src/partners/scope.pg.test.mjs` (extend) | The existing cross-tenant attacks still pass against real accruals, not just fixtures. Partner A's payout can never settle Partner B's revenue — already covered at line 202; extend it to rows the writer produced. |
| `/home/user/fundhub-platform/src/affiliates/economics.pg.test.mjs` (extend) | `convert()` is now reached from a payment event. Tier 1 20% and Tier 2 5% land on `affiliate_referrals.commission_due` and come out of the partner's half, never FundHub's. |
| `/home/user/fundhub-platform/src/partners/floors.pg.test.mjs` (new) | §6 ladder: warning at one window, final at two, downgrade at three, restore after one good window, and — the important one — **no historical row changes on downgrade.** |
| `/home/user/fundhub-platform/src/http/routes.test.mjs` (existing, keep green) | Any new handler must be in the hardcoded `ROUTES` map in `/home/user/fundhub-platform/netlify/functions/api.mjs`. A handler absent from it 404s locally and deployed. This has shipped broken twice. |

### Journey documentation (CLAUDE.md §4)

`/home/user/fundhub-platform/docs/journeys/white-label-actual.md` must be updated
**in the same commit** as the code, generated from the code and not from this
spec. `/home/user/fundhub-platform/docs/journeys/white-label-intended.md` is
hand-authored and **agents do not edit it.** If the accrual writer needs a step
that is not in the intended journey, **stop and ask** — do not add the step and
do not edit the intended file. One line appended to
`/home/user/fundhub-platform/docs/journeys/CHANGELOG.md`, newest at top.

---

## Open questions — Chris decides, nothing is blocked from starting

| # | Question | Why it matters |
|---|---|---|
| ~~O1~~ | **CLOSED — the floor is 10 CLIENTS PER MONTH**, not a dollar figure. See `W0-decisions.md`. The §6 mechanism stands; the threshold is a client count. |
| **O2** | When a partner's affiliate is attributed but has not converted yet, do we **hold** the affiliate's share from the partner's payout (O2-a), or pay gross and recover later (O2-b)? | §4. Affects whether a partner can go negative. |
| ~~O3~~ | **CLOSED — NO hold-back.** Pay as fast as possible. A post-payment reversal is FundHub's loss and is not recovered from the partner. See `W0-decisions.md`. |
| **O4** | Should a partner's affiliates earn anything on the **success fee**? Today the live rules say no — deposit only. | §4(b). A new rule row, not a code change. |
| **O5** | Is the **$10,000 entry fee refundable**, and in what window? | §5. Schema handles it either way. |
| **O6** | On downgrade, accept the small basis difference (cash-collected vs deposit-collected) or build exact affiliate-schedule parity? | §6. Recommend accepting it; one ledger. |

## Genuinely unknown — recorded, not invented

- **The fund rate.** What share of paid deposits reach a funded round. Zero
  measured paid closes on record. No number appears anywhere in this document.
- **Partner production per dollar of ad spend.** No partner has ever launched.
- **Band mix on financed entries.** With no credit gate (D4), the split across
  the eight remittance bands is unknown, so FundHub's blended cash per entry is
  unknown. The per-band table in §5 is complete; the weighting is not.
- **Chargeback rate on financed entries.** Unknown.

These four absences are the finding. Do not let a downstream document fill them
in with a plausible-looking number.
