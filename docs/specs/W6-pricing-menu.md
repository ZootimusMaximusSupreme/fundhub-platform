# W6 — The pricing menu

> **COMPLIANCE REVIEW REQUIRED** — this document sets fee timing and a recurring
> payment schedule. It is a marker, not a
> recommendation, and nothing here asks anyone to revisit an owner decision.

**Status:** specification only. No code, no migrations, nothing built.
**Owner-set 2026-08-31.** Reads with `W0-decisions.md`, which it extends.

---

## In one minute

A partner pays **$10,000 once** to get in. That is the whole required price — there is
no monthly fee on the base program. Everything else is a **menu** they can add to,
month by month, and drop when they like.

Their **50% never changes.** Not when they stack add-ons, not when FundHub runs their
ads, not when their downline gets deep. Half is half. Everything else is a menu.

---

## The two laws

### Law 1 — the split is fixed

**50% of funding and repair, front end and back end, permanently.** No add-on, package,
or service moves it in either direction.

This is not a simplification, it is the product. A partner can repeat it from memory,
there is nothing to negotiate on a call, and the ledger never has to answer "what was
the split on the 4th of March" — `share_pct_applied` is frozen at accrual anyway
(`db/migrations/042_partners.sql`), so a fixed rate means that column tells one story
forever.

It also extends the rule already set for downlines: FundHub's half does not move when a
partner pays their own affiliates. Same principle, wider scope.

### Law 2 — the ad account connection is free, and required

**Every partner connects their ad account. No exceptions, no charge.**

This is a condition of using FundHub's fulfilment, not a product. It is what makes the
whole channel work:

- FundHub sees what all partners are running, so 100 partners can be kept out of each
  other's interest stacks and lookalikes.
- Layer 3 of the creative intelligence spine (`W2-creative-intelligence.md`) fills up
  from day one — the real spend, CTR and close-rate data that nobody can buy at any
  price. Thin Layer 3 was that spec's cold-start problem; mandatory connection solves it.

**What the connection gives FundHub is telemetry. What the Brain gives the partner is a
paid add-on.** Those are different things and separating them is the point: 100%
coverage of the data, while the intelligence stays sellable.

---

## The base — $10,000, once

| Included | |
|---|---|
| The white-label program | Their brand across the system |
| Training | Curriculum per the curriculum spec |
| Fulfilment | FundHub's team does the client work |
| Their portal | Brand Studio, Social Studio, Creative Factory, Partner Home — **four screens.** NOT the CRM: partners are blocked from it entirely and cannot see or move a client file, pipeline card, contract or payment link. An earlier draft of this row said "CRM" and was wrong |
| The split | 50%, funding and repair, front and back |
| Ad-account connection | Required. Free. Telemetry only |

No monthly. Financeable. Refund window short (`W0-decisions.md`).

---

## The menu — monthly, stack freely, cancel freely

Three add-ons at launch. Each is independent; none is a prerequisite for another.

### 1. Creative Intelligence

The Brain, pointed at them: hooks written for their offer, their segment assigned so
they are not bidding against other partners, the Winner's Board, and their own
performance data read back to them.

**$297/month — SET 2026-08-31 from market research.** Building this themselves needs three
subscriptions: an ad-spy tool (AdSpy $149), an AI creative writer (AdCreative.ai Scale-Up
$149) and campaign read-back (Motion $250) — about $548/month for tools that know nothing
about business funding. Sits mid-band against the vertical software this buyer already
pays for: Credit Repair Cloud $179–$599, DisputeFox $129–$499. Below $150 it reads as a
thin wrapper; above $400 the buy-three-tools-separately saving disappears.

### 2. Done-For-You Marketing

FundHub builds the creative, runs the campaigns, manages the account. The partner still
funds their own ad spend.

**$2,497/month + their ad spend — SET 2026-08-31.** Agencies charge 10–20% of spend; at the
$25,000/month these partners run that is $2,500–$5,000, so this is the literal floor of the
band. It has to be the floor: FundHub already keeps 50% of the revenue those ads produce,
and a full market rate on top is charging twice for the same result. Across the real spend
range it is 12.5% at $20K, 10% at $25K, 8.3% at $30K — it quietly gets cheaper as the
partner scales, which is what real agencies do.

This is the add-on that triggers the creative approval gate in `W4-live-trial.md` — when
FundHub runs the marketing, FundHub signs off on the creative.

### 3. Lead Flow

FundHub hands the partner booked calls.

**$99 per booked call — SET 2026-08-31.** An MCA live transfer runs $75–$150 and a live
transfer is a *worse* product than a call already on the calendar with a screened owner.
Appointment agencies charge $50–$300 per booked meeting with a small-business owner.
FundHub's own cost is ~$33, so $99 is about 3x — enough to cover setters, screening and
rebooking no-shows without a partner calling it gouging. Under $50 it prices like a raw
lead and invites partners to burn calls carelessly.

> **These three prices are SET and SHIPPED**, pinned to the cent in
> `src/config/partner-add-ons.test.mjs` and catalogued in `src/config/offers.mjs`.

---

## How this maps onto the schema

The machinery mostly exists and should be reused rather than rebuilt.

| Need | Existing | Notes |
|---|---|---|
| Recurring arrangement | `subscriptions` (`db/migrations/075_subscriptions.sql`) | Effective-dated. A price change **closes the live row and opens a new one** — `trg_subscriptions_terms_immutable` raises on an UPDATE to tier or price. `subscriptions_no_overlap` prevents two live versions |
| Access gating | `entitlement_catalog` + `src/entitlements/entitlements.mjs` | `forClient()` returns held **and** locked, because "the locked tile is the upsell surface". Exactly the menu's rendering model |
| One-off purchases | `products` (010/015), `src/config/offers.mjs` | The $10,000 entry belongs here |
| Idempotent granting | `grantFromTransaction()` | Replay-safe on a unique index; a repeat payment grants nothing new |
| Nothing hard-deletes | `revoke()` stamps `revoked_at` | A cancelled add-on stays answerable |

**Prices are rows, never code.** `db/migrations/013_commission_rules.sql` sets the rule
the schema is built on — every rate is a row. `subscriptions.price_cents` is nullable and
**NULL means "nobody has recorded what this costs"**, not zero. Do not default it.

### ~~The blocker~~ — RESOLVED

**Fixed by `db/migrations/271_partner_subscriptions_and_addons.sql`** (option 1 below, as
recommended). A partner can now hold a subscription. The migration also closed a real hole:
the old uniqueness rule watched only `client_id`, and Postgres skips that check when the
column is NULL — so without the new rule a partner could have been billed twice for the
same add-on with nothing complaining.

The original analysis follows.


**`subscriptions.client_id` is `NOT NULL REFERENCES clients(id)`. Entitlements are
client-scoped too** — `forClient(db, { orgId, clientId })`, reading `v_client_entitlements`.

**A partner is not a client, so a partner add-on cannot be recorded today.** This must be
resolved before any monthly add-on is sold. Three options, in preference order:

1. **Add a nullable `partner_id` to `subscriptions`** with a check that exactly one of
   `client_id` / `partner_id` is set. Smallest change; keeps one recurring table, one set
   of effective-dating guarantees, one place to look.
2. A parallel `partner_subscriptions` table. Duplicates the no-overlap and immutability
   triggers, which is exactly the kind of divergence that rots.
3. Represent partners as `clients` rows. Cheapest to write, worst to live with — it
   pollutes every client-scoped query and report in the system.

Recommend option 1. Either way, this is a **migration, not a workaround**, and editing an
applied migration is a silent no-op — supersede with a new file.

### The other blocker

**Recording a subscription and collecting money monthly are different things.** The
`subscriptions` table records the arrangement and carries `provider` and `card_id`, but
nothing verified in this repository actually charges a card on a cycle. Before any
monthly add-on launches, confirm the collection path end to end — otherwise a partner can
be marked `active` on a plan that never bills.

---

## Worked example

A partner who takes everything, one month:

```
ONE TIME
  Entry                                    $10,000

MONTHLY
  Creative Intelligence                       $497
  Done-For-You Marketing                    $2,497
  Lead Flow, 20 booked calls @ $197         $3,940
  ─────────────────────────────────────────────────
  Monthly to FundHub                        $6,934
  (their own ad spend is theirs, never on FundHub's books)

AND ON EVERY CLIENT THEY CLOSE
  Split                                    50 / 50
  ...which did not move by a single point.
```

---

## Open

| Item | Note |
|---|---|
| ~~The three prices~~ | **CLOSED — $297 / $2,497 / $99, set from market research and shipped** |
| **Bundling** | Whether Intelligence + Done-For-You sell as a discounted package, or strictly à la carte |
| **Partner subscription scoping** | Option 1 above is recommended but not chosen |
| **Recurring collection** | Must be verified working before anything monthly is sold |
| **More add-ons** | "Licensing" was named by the owner but not defined. Absent — recorded, not invented |
| **Does an add-on lapse affect the partnership?** | A partner who cancels Creative Intelligence still owes the 10-clients-a-month floor. Nothing says whether a lapsed add-on has any other consequence |
