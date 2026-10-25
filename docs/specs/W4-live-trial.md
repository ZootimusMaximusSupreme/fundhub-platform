# W4 — The Live Trial ($297, seven days)

> **COMPLIANCE REVIEW REQUIRED** — this document puts FundHub's regulated
> consumer-finance advertising under a third party's brand before any partner
> agreement is signed. It is a marker,
> not a recommendation, and nothing here asks anyone to revisit an owner decision.

**Status:** specification only. No code, no migrations, nothing applied.
**Written:** 2026-08-31 · branch `claude/white-label-models-offer-page-31vn4q`
**Depends on:** `docs/specs/W1-money-model.md` (money rules) and W2 (the AI Brain
that writes the hooks and picks the audience). This spec assumes both. It does not
restate them.

---

## Read this first, in one minute

A person pays **$297**. For seven days FundHub builds and runs their first ad
campaign for them — FundHub's pictures, FundHub's words, FundHub's booking page,
but **their** name and logo on the front of it. They watch real phone calls get
booked on a live screen. On day eight they either pay **$10,000** once and become
a partner, or they walk away **keeping every lead the trial produced** and get
paid 20% on the ones FundHub closes.

Nobody wires $10,000 after reading a $27 report. They will wire it after watching
their own name book calls for a week. That is the entire reason this product
exists.

**The one thing that can kill it:** Meta will not run a money-related ad from an
account whose business is not verified, and verification is out of FundHub's
hands. If that check happens after the $297 is taken, FundHub sells seven days it
cannot deliver. See §3.1 — this is the single most important operational point in
this document.

---

## Assumptions (not yet decided)

These are **not** owner decisions. Any one can change without rewriting this
document. They are listed here so nothing below quietly depends on a number
nobody picked.

| # | Assumption | Where it bites |
|---|---|---|
| A1 | Live Trial is **$297**. (Winner's Board $47/mo and Decline Autopsy $27 sit in other specs.) | §7 pricing, §8 worked money |
| A2 | Sub-affiliates run on FundHub's existing rails, auto-deducted from the partner's half | Not used in this spec. Noted so no one adds a second path here. |
| A3 | The trial covers **the machine only**. The person funds their own **$500–$1,000** ad budget, on their own card, in their own ad account | §3, §5, §8. This is the biggest single assumption in the spec. |
| A4 | Zero booked calls earns a **service** remedy, not a cash refund | §4. Recommendation, not owner-set. |
| A5 | The $297 is credited back to a converting partner as a **cash rebate on their first payout**, not as a discount on the $10,000 financed amount | §6.4. Keeps the financed number clean at $10,000 for every credit band. |
| A6 | Trial campaigns run on **`funding` offer type only** in version one — never `credit_repair` | §9. This removes a whole body of law from the critical path. |
| A7 | The seven-day clock starts at the **first ad impression**, not at checkout | §3.2. Otherwise a slow platform review eats the trial the customer paid for. |

---

## Locked owner decisions carried into this spec (2026-08-31)

Recorded as fact. Not re-opened, not commented on.

- **D1.** Entry is **$10,000, one time. There is no monthly fee.**
- **D2.** Entry is **financeable** through FundHub's own rails. Commas finances
  courses only, so the $10,000 must be sold as a training product.
- **D3.** **No credit gate.** FundHub's credit partner funds down to a 405 FICO.
  $10,000 sits under the $17,000 sub-prime cap, so every band carries it.
  FundHub nets roughly **$4,200–$8,500** cash per financed entry depending on band.
- **D4.** Because entry filters nobody out, the **production floor is the only
  partner filter that exists**. It is load-bearing, not a backstop.
- **D5.** Partner share is **50%** on repair services and funding services, front
  end and back end — including the 10% success fee. **E-products are excluded**
  and stay 100% FundHub. **The Live Trial is an e-product.**
- **D6.** **Day 8, no signature:** the person **keeps the leads the trial
  produced**. FundHub fulfils any that convert. The person is paid as an
  affiliate at the standard 20%. Consumers must be told **on day 1** that FundHub
  performs fulfilment.
- **D7.** Ad data is **rented from vendor APIs**. FundHub infrastructure never
  scrapes Meta or Google.
- **D8.** Hiring is not a constraint. Headcount is never a blocker in this spec.

---

## Blocking findings carried forward (do not silently fix)

**F1 — Nothing in production writes partner money, or affiliate money.**
`partner_revenue` has no production writer at all; the only rows that ever exist
come from test fixtures in `src/partners/scope.pg.test.mjs`. On the affiliate
side, `src/affiliates/economics.mjs` exports `convert()` and nothing in
production calls it from a payment event — only `attribute()` is wired, through
`src/workflows/af-02-referral-ownership-capture.mjs`.

**What that means for W4, in plain words: the day-8 promise in D6 cannot be paid
today.** The trial can tag the leads correctly, and this spec says exactly how.
But the money never lands in anyone's account until W1's accrual writer ships.
Do not launch the trial with the affiliate fallback advertised until that is
true. This is a hard dependency, not a nice-to-have.

**F2 — The schema is already right. Build on it.**
`db/migrations/042_partners.sql` gives `partners.revenue_share_pct` (per partner,
default 50), `partner_revenue` rows that freeze `share_pct_applied` at accrual so
a rate change never rewrites history, two idempotency keys, a no-delete trigger
(void with a reason instead), and `partner_payouts` with a database-enforced gate
that refuses any payout unless `agreement_signed_at` is stamped **and** status is
`active`. That gate is why a trial can safely create a `partners` row on day 0:
an unsigned trial partner is structurally unpayable. Do not design a second ledger.

**F3 — No earnings claims anywhere public.**
FundHub's own projection files record **zero measured paid closes**. There is no
measured booked-call rate at any ad spend, for any audience, ever. So the trial
page may describe **what FundHub does** and may show **that person's own live
numbers once they exist**. It may never show a modelled number, a typical
result, a range, or another person's result. See §9.4.

---

## 1. What the $297 actually buys

Four things, and they are all delivered on day 0 whether or not a single call
books:

1. **A branded funnel.** A live web page with their logo, their colours, their
   company name, their support email — running on FundHub's page engine
   (`src/brand/partner-site.mjs`, templates in `src/brand/templates.mjs`).
2. **A built ad set.** FundHub's creative, generated fresh for them, screened for
   compliance, approved by a named human, loaded into their own ad account.
3. **A live dashboard.** Spend, clicks, leads, and booked calls, updating as they
   happen (`src/dashboard/kpis.mjs`, `src/bookings/store.mjs`).
4. **Real fulfilment.** Any lead that books and converts is worked by FundHub's
   actual team — not a demo, not a sandbox.

**It does not buy ad spend.** (A3.) They fund $500–$1,000 themselves. This has to
be stated in the first line of the sales page and again at checkout, because it
is the number one refund argument in every done-for-you trial ever sold.

---

## 2. Why nobody else offers this

Comparable done-for-you programs charge thousands up front with no trial. That is
not greed — it is that almost nobody owns the whole chain. To run this you need
the creative engine, the funnel builder, the ad-account plumbing, the booking
system, the compliance screen, **and** a real fulfilment team on the other end.

FundHub already has all six, in this repository:

| Piece | Where it lives |
|---|---|
| Creative engine | `src/creative/generate.mjs`, `src/creative/runner.mjs`, `src/creative/providers/` |
| Branded funnel | `src/brand/partner-site.mjs`, `src/brand/templates.mjs`, `src/brand/wordmark.mjs`, `src/brand/copy-generate.mjs` |
| Ad-account plumbing | `src/adplatforms/index.mjs`, `src/adplatforms/meta.mjs`, `src/adplatforms/tokens.mjs` |
| Booking capture | `src/bookings/store.mjs`, `api/bookings.mjs` |
| Live numbers | `src/dashboard/kpis.mjs` |
| Compliance screen | `src/compliance/screen.mjs`, `src/compliance/targeting.mjs`, `db/migrations/047_compliance_rules.sql` |
| Fulfilment | the existing client workflows in `src/workflows/` |

The gap is packaging, not capability.

---

## 3. Day 0 — provisioning, hour by hour

Everything below is one working day. The times are elapsed hours from a
successful checkout.

### 3.1 H−0:01 — the eligibility check, BEFORE money changes hands

This runs **before** the pay button, not after.

Meta forces every money-related ad into a Special Ad Category and refuses to run
one from a business that is not verified. `src/partners/onboarding.mjs` already
knows this: `CREDIT_OFFER_TYPES` covers `funding`, `credit_cards` and
`credit_repair`, and `checkLaunchReadiness` raises a `verify_business` blocker
when `platform_verification_state` is anything other than `approved`. The
database backs it up — `db/migrations/046_ad_platforms.sql` will not let a Meta
campaign exist without a `special_ad_category`, resolved through
`meta_category_for` and seeded in `db/migrations/052_config_defaults.sql`.

So the pre-checkout gate asks three questions:

| Question | If no |
|---|---|
| Do you have a Meta ad account? | Show the two-minute setup, hold the sale |
| Is your Meta business verified? | **Sell a held-start trial** (below). Do not sell seven days. |
| Can you fund $500–$1,000 of ad spend this week? | Hold the sale. This is not negotiable. |

**Held-start trial.** If verification is pending, take the $297 but the clock
does not run. The person gets the branded funnel and the built ad set
immediately (real value, delivered), and the seven days begin the day
verification lands. If verification is refused by Meta within 30 days, full cash
refund, automatic. This is the one place a plain cash refund is correct, because
FundHub genuinely cannot deliver.

**UNKNOWN:** how long Meta business verification takes. It is not FundHub's
system and there is no measured number here. Do not put one on the page.

### 3.2 The clock

The seven days start at the **first ad impression served** (A7), recorded from
the platform sync (`api/campaigns/sync.mjs`). Not at checkout. A person who paid
on Friday and whose ads went live Monday gets seven days from Monday.

### 3.3 Hour by hour

| Time | What happens | Auto or human |
|---|---|---|
| **H+0:00** | Checkout clears. `LIVE_TRIAL` offer, 29,700 cents, through `src/payment-links/index.mjs` → Commas. | Auto |
| **H+0:05** | Provisioning fires. Creates: a `partners` row with `status = 'invited'`, `revenue_share_pct = 50`, `agreement_signed_at` **NULL**; an `affiliates` row (`db/migrations/033_affiliates.sql` auto-stamps a tracking id like `AFF-000123` via `trg_affiliates_tracking_id`); a login through `src/auth/account-session.mjs`; a `partner_brand` row in `draft`. Reuse the exact sequence in `api/public/partner-apply.mjs` — it already does all of this for the white-label track. | Auto |
| **H+0:10** | Brand intake. Four fields only: logo (or skip and take a generated wordmark from `src/brand/wordmark.mjs`), two hex colours, legal entity name, support email. `db/migrations/043_partner_brand.sql` validates the colours as hex — it will reject anything else. | Human, 4 minutes, **theirs** |
| **H+0:20** | The AI Brain (W2) writes hooks and picks targeting. Creative jobs go in through `enqueue` in `src/creative/generate.mjs`; `runDue` in `src/creative/runner.mjs` works the queue on cron. Targeting is built and checked by `buildTargeting` and `screenTargeting` in `src/compliance/targeting.mjs`. | Auto |
| **H+1:00** | Assets land as `creative_assets` rows (`db/migrations/045_creative_factory.sql`). Every one is screened by `screenAndRecord` in `src/compliance/screen.mjs`, which **fails closed** — any error at all becomes a block. Blocked assets never reach a person. | Auto |
| **H+2:00** | **THE HUMAN GATE.** One named FundHub reviewer approves the passed set and the branded page. See §9.2. This is the only mandatory human step on day 0 and it is not skippable. | **Human, FundHub** |
| **H+3:00** | Page publishes at `/sites/{partnerId}/{slug}` through `loadPublishedPage` in `src/brand/partner-site.mjs`. Locked legal blocks are present, including the day-1 fulfilment disclosure (§5.4). `partner_brand.approval_status` moves to `approved`. | Auto |
| **H+4:00** | They connect their own ad account (OAuth; tokens encrypted by `src/adplatforms/tokens.mjs`). `checkLaunchReadiness` runs. Any blocker becomes a row in `partner_onboarding_tasks` **and** an internal FundHub task through `src/lib/create-task.mjs` — two surfaces, one trigger, already built. | Human, 3 minutes, **theirs** |
| **H+5:00** | Campaign written through `api/campaigns/write.mjs` → `guardedWrite` in `src/adplatforms/index.mjs`. `approval_state` walks `draft` → `awaiting_approval` → `approved` (with `approved_by` stamped) → `live`. | Auto, gated |
| **H+6:00** | Dashboard goes live. They get one link. | Auto |

**Total human time on their side: about seven minutes.** That is the pitch.

---

## 4. Days 1 to 8

### 4.1 The schedule

| Day | What FundHub does | Automated? |
|---|---|---|
| **1** | First spend. First clicks. First leads. Booking capture live. | Fully automatic — see §4.2 |
| **2** | First optimisation pass. Budget shifts to whichever ad set is working. | Automatic |
| **3** | **Mid-trial check.** One human, ten minutes: is spend actually flowing, is anything blocked, does the funnel look right. | Human, FundHub |
| **4** | Creative refresh if the first set is tiring (`api/campaigns/fatigue.mjs`). | Automatic, human approves new assets |
| **5** | **FundHub starts fulfilling.** Any lead that booked gets worked by the real team. This is the day the trial stops being a demo. | Existing client workflows |
| **6** | Nothing new. The numbers are the pitch now. | — |
| **7** | Trial ends at 23:59 of the seventh live day. Dashboard freezes and stays readable for 30 days. | Automatic |
| **8** | The conversion call. §6. | Human, FundHub |

### 4.2 Day 1 — what is automatic and what is not

This table is the whole reason one operator can run many trials at once.
It assumes W2's Brain is delivering hooks and targeting.

| Task | Auto | Human | Why |
|---|---|---|---|
| Write ad hooks | ✅ | | W2 Brain |
| Pick the audience | ✅ | | W2 Brain + `buildTargeting` |
| Make images and video | ✅ | | `src/creative/generate.mjs` |
| Compliance screen every asset | ✅ | | `screenAndRecord`, fails closed |
| **Approve the screened set** | | ✅ | §9.2. Never automated. |
| Publish the branded page | ✅ | | `src/brand/partner-site.mjs` |
| Push campaign to Meta | ✅ | | `guardedWrite` |
| Watch spend and pacing | ✅ | | `api/campaigns/spend.mjs` |
| Capture a booked call | ✅ | | `upsertBooking` in `src/bookings/store.mjs` |
| Update the dashboard | ✅ | | `computeKpis` in `src/dashboard/kpis.mjs` |
| Shift budget between ad sets | ✅ | | Existing optimiser |
| Raise a blocker to the person | ✅ | | `openOnboardingTask` — two surfaces |
| Answer a blocker they raise | | ✅ | Real support |
| Day 3 check-in | | ✅ | Ten minutes |
| Fulfil a converted lead | | ✅ | Real team, existing workflows |
| Day 8 conversion call | | ✅ | The close |

**Human minutes per trial per week: roughly 45**, split across day 0 approval,
day 3 check-in, day 4 asset approval, and the day 8 call. That is the number that
decides how many trials one operator carries. It is an estimate, not a
measurement — see §11.

---

## 5. The four hard questions

### 5.1 Zero calls book in seven days. What does FundHub owe?

**Recommendation (A4): a service remedy, not a cash refund.** Here is the
reasoning, and then the exact policy.

The $297 buys the machine — the funnel, the creative, the campaign, the
dashboard, the fulfilment promise. All four are delivered on day 0. What it
cannot buy is a booked call, because the number of calls depends on the ad budget
**the person controls** (A3), the market they picked, and the platform's own
delivery. Promising a result FundHub does not control is how a good offer becomes
a refund machine.

**The policy, in the exact words that go on the page:**

> If FundHub does not deliver your branded page, your ad set, your live
> dashboard and your campaign by the end of day one, you get every dollar back,
> automatically, without asking.
>
> If you run the full seven days with at least $500 in spend, your account stays
> active the whole time, and **no call books**, you get:
> 1. a written breakdown of why, at no charge;
> 2. seven more days of the machine, at no charge;
> 3. your $297 credited in full toward the $10,000 if you join within 30 days.

Three deliberate choices in that wording:

- **The day-1 guarantee is unconditional and it is about FundHub's own work.**
  That is defensible, easy to honour, and it is what removes the risk from the
  buy.
- **The zero-call remedy has conditions and they are all measurable from data
  FundHub already holds:** `campaigns.status`, spend from
  `api/campaigns/spend.mjs`, `ad_platform_connections.connection_state`. Nobody
  argues about whether the campaign was paused — the system knows.
- **The remedy is more machine, not money back.** More machine costs FundHub
  almost nothing and keeps the relationship alive. A cash refund ends it.

**What zero calls actually tells you.** One person at zero is noise — wrong
budget, wrong market, paused account. **Ten per cent of trials at zero is not
noise; it is a broken offer, and no amount of trial polish fixes it.** So set a
kill metric before launch: if more than 1 trial in 10 finishes with zero booked
calls across the first 50 trials, stop selling the trial and fix the offer. Put
that number in `docs/workflows/` for the batch and check it weekly.

**Refund mechanics.** A refund is recorded as a `payments` row of kind
`refund` — this already exists and is already understood downstream:
`src/commissions/calculate.mjs` subtracts refunds from cash collected, and
`src/affiliates/economics.mjs` excludes `kind = 'refund'` when computing a
commission basis. **Do not invent a refund table.** I did not find a
customer-facing refund endpoint; refunds today appear to arrive through the
Commas inbox (`src/payments/commas-inbox.mjs`). Whether a refund can be
*initiated* from FundHub, or must be done in the Commas dashboard by hand, is
**UNKNOWN** and needs one person to check before launch.

**OPEN — for the owner, not for an agent to decide:** whether to offer a plain
cash refund on zero calls instead. It closes more trials and it costs the $297
plus the delivery cost on every one that fails. The recommendation above is the
safer default; the owner may prefer the harder guarantee.

### 5.2 Lead ownership — the exact mechanics

Locked (D6): the person keeps the leads, FundHub fulfils the ones that convert,
the person is paid at the standard affiliate 20%, and consumers are told on day 1
that FundHub does the fulfilment.

Here is how that is actually built, and the whole design rests on one decision:

> **Create the `affiliates` row on day 0, not on day 8.**

Why this matters more than it looks. `attribute()` in
`src/affiliates/economics.mjs` writes `affiliate_referrals` with
`ON CONFLICT (client_id, tier) DO NOTHING` — **first writer wins, permanently.**
If FundHub waits until day 8 to create the affiliate and then tries to
back-stamp seven days of leads, any lead already claimed by another path is lost
and the return is silently `{ attributed: false, reason: "owned_by_other" }`.
Creating the affiliate on day 0 removes the race completely.

**The plumbing, using code that already exists:**

1. **Day 0.** Provisioning creates both rows: a `partners` row (`invited`,
   unsigned) and an `affiliates` row. The affiliate's tracking id is stamped
   automatically by the trigger in `db/migrations/033_affiliates.sql`.
2. **Day 0.** Every link on the branded funnel carries `?a1=<tracking id>`.
   That parameter name is not arbitrary — `parseAffiliateClickBody` in
   `api/public/affiliate-click.mjs` accepts `ref`, `code` and `a1`, and
   `src/workflows/af-02-referral-ownership-capture.mjs` reads `a1` and `a2`
   straight off the event payload.
3. **Days 1–7.** Every lead becomes a `clients` row with `partner_id` set to the
   trial's partner (the index `clients_partner_idx` in
   `db/migrations/042_partners.sql` is already there for exactly this).
   `af-02` fires on `entry.captured`, `diagnostic.paid` and `analysis.completed`
   and stamps ownership through `attribute()` with `tier: "direct"`.
   **Zero new attribution code.** Pass `source: "live_trial"` so trial-sourced
   referrals are separable in reporting later.
4. **Day 8, they convert.** The leads become partner leads and pay 50%, not
   affiliate 20%. So the affiliate referrals must be **unwound** — call
   `voidReferral(db, { referralId, reason: "converted_to_partner" })`, which
   already exists in `src/affiliates/economics.mjs`. Never delete.
5. **Day 8, they do not convert.** Nothing changes. The referrals already point
   at their affiliate account. Queue the affiliate welcome (`AF1`) through
   `queueAffiliateTemplate` in `src/affiliates/drip.mjs`, exactly as
   `api/public/partner-apply.mjs` does today. Set the `partners` row to `paused`.
   The payout gate in `db/migrations/042_partners.sql` already refuses to pay an
   unsigned partner, so no cleanup is needed to make that safe.
6. **Money.** Commission accrues through `convert()` when the lead reaches a
   qualifying outcome under the live schedule
   (`db/migrations/260_affiliate_commission_rates_20260824.sql` and
   `db/migrations/261_affiliate_tier1_20pct_20260824.sql`): Tier 1 direct **20%**,
   Tier 2 downline **5%**, on the funding deposit collected or the repair
   enrolment fee. **F1 applies: nothing calls `convert()` in production yet.**

**One precise thing the day-8 script must say honestly.** Under the live
affiliate schedule the basis is `deposit_collected` — the **deposit**, not the
success fee. So a non-converting person earns 20% of a $3,000 deposit and
**nothing at all** on the $7,000–$12,000 success fee. A partner earns 50% of
both. That gap is not a problem to hide; it is the strongest honest argument on
the day-8 call, and §8 puts a number on it.

### 5.3 A lead that never funds

`qualifyingOutcome` in `src/affiliates/economics.mjs` routes on product **code**
and, for funding, additionally requires a funded round. A signed deal that never
funds is not an outcome and earns nothing.

**Write no row.** Per CLAUDE.md, NULL means unknown and must survive — never
default it to 0. An unfunded deal is an absent accrual, not a zero one.

### 5.4 The day-1 consumer disclosure — exact wording and exact placement

Required by D6, and independently required by §9.

**The words:**

> Funding and credit services offered here are provided and performed by
> FundHub. **[Entity name]** is an independent marketing partner and is not the
> provider of these services.

**The three placements, all live from day 1:**

1. **The branded landing page**, in the footer legal block, on every page.
2. **The booking confirmation screen and email**, above the fold.
3. **The first outbound message**, whatever the channel.

**Where it lives in code — this matters.** It goes into `legalBlocks(entityName)`
in `src/brand/templates.mjs` as a **new locked block**. `isLockedSection` in the
same file already stops the AI copywriter from touching locked sections and stops
a PATCH from overwriting them. That is exactly the right home: a disclosure that
an AI can rewrite, or that a partner can delete from their own page editor, is
not a disclosure. **Never let `generateSectionCopy` in
`src/brand/copy-generate.mjs` produce this text.** It is fixed wording.

**Verification:** a test that fails if a published trial page renders without the
block. Test file goes at `src/brand/templates.test.mjs` (it exists) or a new
`src/brand/trial-disclosure.test.mjs` — either runs, because `npm test`'s glob
covers `src/**`.

---

## 6. Day 8 — converting to the $10,000 partner

### 6.1 The offer on the table

$10,000, one time, no monthly (D1). Financed if they want it (D2). No credit gate
(D3) — FundHub's credit partner funds down to a 405 FICO, and $10,000 sits under
the $17,000 sub-prime cap, so every band carries it. Nobody is turned away on
credit.

### 6.2 Because entry filters nobody, the production floor is the filter

D4 says this plainly and W4 is where it becomes real. Since price never blocks
anyone — financing reaches a 405 FICO — the only thing separating a working
partner from a dead one is what they produce after joining. The trial is the **first measurement of that**, and it is
the only evidence FundHub will ever have before taking the $10,000.

So the day-8 record must carry, on the partner row or an attached note: ad spend
actually deployed, leads produced, calls booked, and whether they answered
support inside 24 hours. That is the opening data point for W1 §6's floor
mechanism. **The floor number itself is not set in this spec and must not be
invented here.**

### 6.3 The financed entry, structurally

Commas finances **courses only** (D2). So the $10,000 is sold as a training
product. `src/config/offers.mjs` already has the pattern to copy — `FUNDING_MASTERY`
is `financing: true`, `paymentPurpose: "custom"`, `commasProductTitle:
"Consulting Services Program"`. The new entry offer follows it exactly. See §7.

### 6.4 What happens the moment payment clears

| Step | What | Where |
|---|---|---|
| 1 | `partners.status` `invited` → `active` | `db/migrations/042_partners.sql` |
| 2 | `partners.agreement_signed_at` stamped from the signed agreement | Same. The payout gate trigger reads it. **Until this is stamped, no payout can exist** — the database refuses it. |
| 3 | Every trial `affiliate_referrals` row voided with reason `converted_to_partner` | `voidReferral` in `src/affiliates/economics.mjs` |
| 4 | Leads stay on the partner. `clients.partner_id` was already set on day 0. Nothing moves. | — |
| 5 | The $297 comes back as a **cash rebate on their first payout** (A5), not as a discount on the financed $10,000 | Keeps the financed number at a clean $10,000 across every credit band |
| 6 | If a recruiting partner exists, the one-time **$2,000** recruit bonus is recorded | Rules and timing live in `docs/specs/W1-money-model.md` §5. Not restated here. |
| 7 | Brand Studio unlocks fully; the trial's `partner_brand` row is already `approved` | `api/partner-marketing/enable.mjs` is owner-flipped per partner |

### 6.5 They say no

Set `partners.status` to `paused`. Leave the `affiliates` row active. Queue the
`AF1` affiliate welcome. Freeze the dashboard read-only for 30 days. Revoke the
branded page and the creative licence (§5.5 / §10). Keep the leads on them.

Say it to them exactly like this: *"You keep every lead. We work the ones that
book. You get paid 20% on the deposits. Nothing you built this week disappears."*

---

## 7. Pricing and checkout — the exact changes to `src/config/offers.mjs`

That file is the single source of prices, and its own header says screens read it
rather than hardcoding numbers. Two new entries.

**`LIVE_TRIAL`**

| Field | Value | Why |
|---|---|---|
| `priceCents` | `29700` | $297 (A1) |
| `financing` | `false` | Too small to finance |
| `letters` | `false` | No dispute letters |
| `paymentPurpose` | `"custom"` | Not a diagnostic, deposit or repair |
| `productCode` | `"live-trial"` | Needs a matching `products` row |
| `commasProductTitle` | `"Consulting Services Pilot"` | Consulting language only. Add to `COMMAS_TITLE_BY_PRODUCT_CODE`. |
| `contractTemplateKey` | `"LIVE-TRIAL-TERMS"` | §10 |

**`PARTNER_ENTRY`**

| Field | Value | Why |
|---|---|---|
| `priceCents` | `1000000` | $10,000 (D1) |
| `financing` | `true` | D2 |
| `letters` | `false` | — |
| `paymentPurpose` | `"custom"` | Follows `FUNDING_MASTERY` |
| `productCode` | `"partner-entry"` | Needs a matching `products` row |
| `commasProductTitle` | `"Consulting Services Program"` | Training-product framing per D2 |
| `contractTemplateKey` | `"PARTNER-AGREEMENT"` | Carries `agreement_signed_at` |

**Three things that are easy to miss:**

1. **Both need a `products` row.** `src/affiliates/economics.mjs` routes on
   product **code**. A missing `products` row means no commission rule can ever
   attach to it — which is what you want here, but it must be deliberate rather
   than accidental.
2. **Neither code may ever be added to `FUNDING_PRODUCT_CODES` or
   `REPAIR_PRODUCT_CODES`** in `src/affiliates/economics.mjs`. Both are
   e-products and stay 100% FundHub (D5). The $2,000 recruit bonus is a separate
   one-time mechanism in W1 §5, not an affiliate commission rule.
3. **Checkout runs on the existing rail** — `createPaymentLink` in
   `src/payment-links/index.mjs`, cleared through `markPaid` /
   `markPaidBySession`. No new payment path.

**Route wiring.** `netlify/functions/api.mjs` holds a hardcoded `ROUTES` map and
a handler absent from it 404s both locally and deployed. Every new endpoint in
this spec must be added there in the **same commit** as the handler, or
`src/http/routes.test.mjs` fails. This has shipped broken twice.

---

## 8. The money, end to end, in integer cents

All arithmetic through `src/commissions/money.mjs`. `percentOf` takes percent
units — `20` means 20%. `fromCents` returns a **string**, so never do maths on
its output.

### 8.1 One person who converts

| Event | Cents | Notes |
|---|---|---|
| Trial payment | `+29,700` | E-product. 100% FundHub. **No `partner_revenue` row** (D5, and they are not a signed partner). |
| Their own ad spend | `0` | ~`75,000` on their card, in their ad account. Never touches FundHub's books (A3). |
| Entry fee, financed, sub-prime A band at 42% | `+420,000` | `percentOf(1000000, 42) = 420000` |
| $297 rebate on first payout (A5) | `−29,700` | Cash back, not a discount on the financed principal |
| **FundHub net cash from this person, before delivery cost** | **`419,700`** | `fromCents(419700)` → `"4,197.00"` |

Same person, **prime 680+ band at 85%**: `percentOf(1000000, 85) = 850000`, less
the `29,700` rebate → **`849,700`** cents (`"8,497.00"`). That is the $4,200–$8,500
range in D3, with the trial fee and rebate netting to zero.

If a partner recruited them, subtract the one-time `200,000` cent bonus
(`percentOf(1000000, 20)`), leaving `219,700` in the sub-prime case. Timing and
recording live in W1 §5.

### 8.2 The same person who says no on day 8

Their trial produced 12 booked calls. Two become paying clients.

| Event | Cents | Notes |
|---|---|---|
| Trial payment kept | `+29,700` | Delivered in full |
| Client A pays the funding deposit and the engagement funds | `+300,000` | `FUNDING_DFY` deposit |
| Affiliate Tier 1 on that deposit | `−60,000` | `percentOf(300000, 20)` — basis is `deposit_collected` |
| Client B enrols in repair | `+100,000` | `REPAIR_DFY` |
| Affiliate Tier 1 on the enrolment fee | `−20,000` | `percentOf(100000, 20)` |
| **Paid to the ex-prospect** | **`80,000`** | `fromCents(80000)` → `"800.00"` |
| **FundHub keeps, before delivery cost** | **`349,700`** | `29,700 + 400,000 − 80,000` |

Client A later funds $120,000 and the 10% success fee is `1,200,000` cents, of
which `300,000` was already paid as the deposit, so `900,000` is still invoiced.
**The affiliate earns nothing on any of it** — the live rule's basis is
`deposit_collected`. The full `1,200,000` stays with FundHub.

### 8.3 The number that closes day 8

Same two clients, same funding, but they signed the $10,000 partner agreement.
Partner share is 50% front and back (D5), and it accrues with
`share_pct_applied` frozen at 50 so a later rate change never rewrites it.

| | As affiliate | As partner |
|---|---|---|
| Client A deposit, `300,000` | `60,000` | `150,000` |
| Client A success fee, `1,200,000` total | `0` | `600,000` |
| Client B repair, `100,000` | `20,000` | `50,000` |
| **Total on these two clients** | **`80,000`** = $800.00 | **`800,000`** = $8,000.00 |

**Two clients. Ten times the money. Against a $10,000 one-time entry with no
monthly.** That is the day-8 conversation, and it is arithmetic on FundHub's own
locked terms — **not a projection, not an earnings claim, and it must never
appear on a public page** (F3). It is a private conversation about a specific
person's own trial results.

**One caveat to say out loud on that call:** partner accrual assumes the deal
funds. If it never funds, both columns are zero, and the partner column carries
more of the delivery cost. Do not present the partner column as guaranteed.

---

## 9. Compliance — the gate, and why it is the sharpest edge here

**COMPLIANCE REVIEW REQUIRED.**

### 9.1 What the exposure actually is

The trial puts FundHub's regulated consumer-finance advertising under a third
party's brand **before any partner agreement is signed**. During those seven days
the person is not a partner, not a signatory, and not under any production
standard. Their brand is on the ad. FundHub wrote it, screened it and pushed it.

The precedent is not theoretical. **Credit Repair Cloud and its founder paid $3
million in CFPB penalties in 2024 for assisting other companies' violations.**
The assist theory reaches platforms — providing the tools, the templates and the
funnel was enough. FundHub is doing more than providing tools here: it is
authoring the creative and operating the account. The exposure is larger, not
smaller.

### 9.2 The review gate — mandatory, named, recorded

**No trial creative reaches a live ad account without a named human approving
it.** Three layers, all of which already exist:

1. **Machine screen, fails closed.** `screenAndRecord` in
   `src/compliance/screen.mjs` runs every asset against `compliance_rules`
   (`db/migrations/047_compliance_rules.sql`) and writes a
   `compliance_screenings` row carrying `partner_id`, the screened text and the
   rules version. Any error at all — no database, bad regex, malformed subject —
   becomes a **block**. That behaviour is deliberate and must not be relaxed to
   make the trial faster.
2. **Named human approval, recorded in the database.** `creative_assets` moves
   from `passed` to `approved`. `campaigns.approved_by` is stamped.
   `db/migrations/046_ad_platforms.sql` already enforces that a campaign cannot
   be `approved` or `live` without `approved_at`, and for `credit_repair` cannot
   be without `approved_by`. **For trials, extend that to require `approved_by`
   for every offer type, not just credit repair** — this is the one schema
   change §12 asks for, and it is one line.
3. **Brand approval.** `partner_brand.approval_status` must be `approved` before
   the page publishes. `db/migrations/043_partner_brand.sql` enforces that
   `approved` and `approved_at` are set together. `api/brand/review.mjs` is the
   review surface.

The audit answer to *"who approved a regulated credit ad under someone else's
brand on the third of September?"* is a `compliance_screenings` row plus a named
`approved_by`. That answer must exist for every trial, without exception.

### 9.3 Cut the surface: funding only in version one

**Recommendation (A6): trial campaigns run `offer_type = 'funding'` only.**
Never `credit_repair`.

What that buys, concretely:

- **CROA drops out of the critical path.** `checkLaunchReadiness` in
  `src/partners/onboarding.mjs` requires a linked Consumer Credit File Rights
  disclosure asset for credit-repair campaigns. Not applicable to funding.
- **The credit-repair-specific approval constraint in 046 drops out.**
- **The TikTok prohibition drops out** (`campaigns_tiktok_credit_repair_ck`
  blocks credit repair on TikTok outright).
- One body of law instead of two, on a seven-day product, for an unsigned
  counterparty.

Business verification still applies — `CREDIT_OFFER_TYPES` includes `funding`,
and it always will. That is §3.1's gate, not something A6 avoids.

### 9.4 No earnings claims, ever, on any public surface

F3. The trial sales page may say what FundHub does. It may show that person's own
live numbers once they exist. It may **never** show a modelled figure, a typical
result, a range, or somebody else's result — including "our partners average X".

This is enforceable, not just a rule in a document: `compliance_rules` in
`db/migrations/047_compliance_rules.sql` is a pattern-matching rule set with a
`block` severity, and the trial page copy should be screened through
`screen()` the same way an ad is. Reason codes are documented in
`docs/compliance/creative-block-reasons.md`.

### 9.5 Never draft customer-facing claims about credit outcomes

Standing rule from CLAUDE.md §7. It applies to every asset the Brain generates
for a trial. Since the Brain writes the hooks (W2), the block must live in the
screen, not in the prompt — a prompt is guidance, a screen is a gate.

---

## 10. Abuse — someone buys the $297 to harvest the creative

Assume this happens. Price it in rather than trying to prevent it.

### What they can genuinely take

- **The finished ad image and headline.** They are running in that person's own
  ad account. Screenshots exist. This is unpreventable and pretending otherwise
  is wasted effort.
- **The public funnel page as rendered.** `renderPartnerPageHtml` in
  `src/brand/partner-site.mjs` outputs HTML to a browser. View-source is a
  browser feature.

### What is withheld, structurally

| Withheld | The mechanism that withholds it |
|---|---|
| The creative library and job queue | Every Creative Factory route goes through `src/http/partner-read-api.mjs`, which is `requirePrincipal(["partner","staff"])` plus partner scope, and row-level security in `src/partners/rls.mjs` limits rows to that partner |
| Other partners' assets and pages | `src/partners/scope.mjs` — `PARTNER_SCOPED_TABLES`, `assertCanReadRow`, `clientIdsFor` |
| Other partners' storage objects | `creative_assets` has a database CHECK forcing `storage_key LIKE 'partners/<their id>/%'`. A storage key is a capability; the constraint stops one partner naming another's prefix. |
| The Brain's reasoning — why this hook, why this audience | W2. Never rendered to the partner. |
| The compliance rule set | `compliance_rules` is staff-scoped |
| The editable page source (section JSON, funnel structure) | `api/partner-pages.mjs` is partner-scoped; the trial gets a published page, not the editor |
| Any FundHub ad-platform token | `src/adplatforms/tokens.mjs` stores encrypted tokens per connection. A trial connects **their own** account. Nothing of FundHub's is ever handed over. |
| Lender bands, payout percentages, fulfilment playbooks | Never rendered to a partner or trial at all |

### Why the harvest is worth less than it looks

Every trial's creative is generated fresh through `src/creative/generate.mjs`
against that person's own brand kit. A harvested set is a **snapshot of one
week**, already fatiguing, tied to a brand that is not theirs. The moat is the
chain in §2 — generate, screen, approve, push, book, fulfil — not any one image.
A competitor who copies a headline still has no fulfilment team, and fulfilment
is what the consumer is actually buying.

### What the agreement says

New contract template, key **`LIVE-TRIAL-TERMS`**, sent at checkout through the
existing `contract_templates` mechanism (`resolveContractTemplateKey` in
`src/config/offers.mjs` already routes offer key to template key).

Six clauses:

1. **Limited licence.** Creative, copy and funnel structure are licensed for use
   in this trial, in the buyer's own ad account, for seven days. FundHub owns
   them. The licence is revocable.
2. **No redistribution or resale.** They may not sell, publish, sublicense or
   share the creative or funnel copy — including inside a competing programme.
3. **Ownership is unaffected by payment.** The $297 buys access, not copyright.
4. **Leads are the buyer's** (D6), and **FundHub performs fulfilment**, which is
   disclosed to consumers on day 1 (§5.4).
5. **Non-circumvention.** For leads produced during the trial, the buyer will not
   route them to a competing fulfiler for 12 months. If they convert to
   affiliate, they get paid 20% on them; if to partner, 50%. Either path is
   better for them than circumventing.
6. **Access ends on day 8** unless they convert: page unpublished, ad account
   disconnected, dashboard frozen read-only for 30 days, creative licence ends.

**Practical note:** clause 6 is the one that has real teeth, because it is
enforced by systems rather than by lawyers. The page comes down, the connection
is revoked, the licence lapses. Everything else in that list is a claim someone
would have to sue over — which for a $297 product is not a real remedy, and the
spec should not pretend it is.

---

## 11. What is genuinely unknown

Listed rather than invented. Absence is the finding.

| # | Unknown | Why it matters |
|---|---|---|
| U1 | **How many calls $500–$1,000 books.** There is no measured number for any audience at any spend. Zero measured paid closes on file. | Sets the refund exposure in §5.1 and the honesty of the whole trial. **Do not put a number on the page.** |
| U2 | **Meta business verification turnaround.** Not FundHub's system. | §3.1. Decides how many buyers become held-start trials. |
| U3 | **Whether a refund can be initiated from FundHub**, or must be done by hand in Commas. I found refund handling on the inbound side (`src/payments/commas-inbox.mjs`) and refund-aware maths (`src/commissions/calculate.mjs`), but no outbound refund path. | §5.1's day-1 guarantee promises "automatically, without asking". If it is manual, that word is wrong. |
| U4 | **How many trials one operator can carry.** §4.2's ~45 human minutes per trial per week is an estimate built from the step list, not a measurement. | Decides whether 100 partners is reachable. Measure on the first ten. |
| U5 | **Cost to serve one trial.** The only known figure is the 250,000-token monthly cap tracked by `src/brand/meter.mjs`. Dollar cost per trial is not derived anywhere in this repository. | Decides whether $297 is priced above cost. |
| U6 | **Whether `ad_platform_category_map` is seeded for `meta`/`funding` in the live database.** `db/migrations/052_config_defaults.sql` inserts rows; I did not verify what is live. If the row is missing, the trigger in 046 raises and **every Meta campaign fails at insert**. | Hard launch blocker. One query answers it. |
| U7 | **Which named person holds the day-0 approval gate**, and their coverage. §9.2 requires a named human on every trial. | A gate nobody owns is not a gate. |
| U8 | **The production floor number** (D4, W1 §6). | Not this spec's to set, and not an agent's to invent. |

---

## 12. Build order

Nothing here is code. This is the sequence a build session would follow.

**Blocked until W1 ships the accrual writer (F1).** The trial can be built and
sold before then; the **day-8 affiliate fallback cannot be advertised** until
money can actually be paid.

| # | Unit | Depends on |
|---|---|---|
| 1 | Two offer entries and two `products` rows (§7) | — |
| 2 | The locked disclosure block in `src/brand/templates.mjs` plus its test (§5.4) | — |
| 3 | Pre-checkout eligibility gate and the held-start path (§3.1) | 1 |
| 4 | Day-0 provisioning: `partners` + `affiliates` + login + `partner_brand`, modelled on `api/public/partner-apply.mjs` (§3.3) | 1, 2 |
| 5 | `?a1=` on every trial funnel link so `af-02` captures ownership with no new code (§5.2) | 4 |
| 6 | Trial dashboard view over `computeKpis` and `listBookings` (§1) | 4 |
| 7 | Day-8 conversion: status flip, `agreement_signed_at`, `voidReferral` sweep (§6.4) | 4, W1 |
| 8 | One-line schema supersede requiring `approved_by` on **every** trial campaign, not just credit repair (§9.2). **A new migration file — never edit an applied one, that is a silent no-op.** | — |
| 9 | `LIVE-TRIAL-TERMS` contract template (§10) | 1 |

**Every new handler must be added to the `ROUTES` map in
`netlify/functions/api.mjs` in the same commit**, or it 404s and
`src/http/routes.test.mjs` fails.

**Journeys.** This changes the white-label journey. `docs/journeys/white-label-actual.md`
is updated **in the same commit** as the code, and one line is appended to
`docs/journeys/CHANGELOG.md`. `docs/journeys/white-label-intended.md` is
hand-authored and agents do not edit it — if the trial requires a step the
intended journey does not cover, **stop and ask**.

---

## 13. What a human has to decide before this can be built

Three things, all owner calls, none of them for an agent:

1. **§5.1** — service remedy or cash refund when zero calls book.
2. ~~**§9.3**~~ — **CLOSED. Funding and repair are ONE ecosystem and are always set
   up together. There is no funding-only version.** See `W0-decisions.md`.
3. **U7** — who holds the day-0 approval gate.

Everything else in this document is either locked, specified, or listed as
unknown.
