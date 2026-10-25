# W3 — Decline Autopsy ($27 self-liquidating offer)

**COMPLIANCE REVIEW REQUIRED** — this touches consumer data that belongs to
somebody else's customers, it touches credit-pull type (by forbidding one), and
it touches fee timing.

**Status: SHELVED — OWNER DECISION 2026-08-31. DO NOT BUILD.**

Chris put this offer under construction. The idea is good and is being kept; it is
the delivery that needs rethinking, and he did not want it half-built in the
meantime. **No thread should implement any part of this spec until he lifts the
shelf.** There is nothing to disable and no demo flag to set — no code was ever
written, so shelving means leaving it unbuilt.

Where it stands in the funnel: W5 lists Decline Autopsy as one of three front
doors into the white-label offer. **That door does not exist.** Anyone building the
W5 offer page ships it with two doors, not three.

### What has to be solved before it is unshelved

Worked out with Chris on 2026-08-31. The product logic is sound; the delivery is
not.

1. **The phone kills the current design.** Most traffic arrives on a phone. Nobody
   types twenty rows, and nobody uploads twenty credit reports, on a phone.
   "Save this link and upload later" means it never happens.

2. **Sell one deal, not the drawer.** The refinement Chris landed on: ask for his
   single biggest decline — "the one that got away". Six dropdowns, about ninety
   seconds, finished in the moment while the ad is still warm. The twenty-row
   upload becomes step two, on a computer, after he has already seen it work once.

3. **Credit-report upload is the wrong direction for this step.** It was
   considered and rejected: it is *more* friction, not less, and it destroys the
   thing that makes this offer legally clean — that names never cross the
   boundary (§5.1). Real reports mean holding third-party consumer credit files
   nobody consented to give FundHub. That belongs in an affiliate portal where a
   relationship and a consent form exist, not on a cold landing page.

4. **The price is not the problem; the effort-to-price ratio is.** $27 stays paid —
   owner rule: nothing is given away free until the market saturates, and only then
   does the price come down. But twenty rows of work at a curiosity price does not
   balance. One deal at $27 plausibly does.

Everything below this line is the original specification, unchanged, and remains
accurate about the engine and the data boundary. It is the front end that changes.

---

**Original status:** specification only. No code exists. Nothing here has been built.

---

## 1. The one-paragraph version, for Chris

A loan broker has a drawer full of deals that got turned down. He paid real money
to find each of those people and got nothing back. For $27 he hands us a list of
his last twenty turn-downs — with the names taken off — and we tell him which ones
our funding program would actually have worked for, roughly how much money was
sitting there, and what his cut would have been. Then we show him two doors: become
a partner and keep half, or just send us the deals and get paid as an affiliate.
The $27 pays for the ad that found him. The real prize is that we now know exactly
how much business he has, before anyone gets on a call with him.

**The single most important rule in this whole document:** the people on that list
never agreed to give us anything. So we never learn their names. The broker strips
them before he uploads. We score the numbers, not the people. That one decision
removes almost every legal problem this offer would otherwise have.

---

## 2. Assumptions (not yet decided)

These are **defaults**, not owner decisions. Any of them can change without
rewriting this spec.

| # | Assumption | Where it bites if it changes |
|---|---|---|
| A1 | Price is **$27** (2,700 cents), one time, no subscription. | §7 checkout, `src/config/offers.mjs` entry |
| A2 | The upload cap is **25 rows**. Marketing says "your last 20". | §5 limits |
| ~~A3~~ | **SUPERSEDED (owner-set 2026-08-31): uploaded rows are RETAINED IN FULL. No purge.** Register the retention class without a purge schedule. See `W0-decisions.md`. | §8 retention |
| A4 | Version 1 accepts **CSV and manual typing only**. PDF turn-down letters are accepted as attachments but **not read by machine**. | §5, §12 (this is the biggest scope lever) |
| A5 | The report is delivered **on screen plus a PDF**, no email required. | §6 |
| A6 | Sister offers in the same ladder: Winner's Board $47/mo, Live Trial $297. Named here only so the report's "next step" copy is consistent. | §9 |
| A7 | Sub-affiliates run on FundHub rails and come out of the partner's half automatically. | §9 |
| A8 | The Live Trial covers the machine only — the partner funds their own $500–$1,000 test budget. | §9 |

---

## 3. Locked owner decisions this spec obeys

Recorded as fact. Not re-opened, not reviewed, not commented on.

- Partner share is **50%** on repair services and funding services, front end and
  back end — including half of the 10% success fee.
- **E-products are excluded** from the split. Courses, education and digital
  products stay 100% FundHub. **The Decline Autopsy report is an e-product.**
  See §9.4 — the $27 itself never splits.
- Entry fee is **$10,000, one time. There is no monthly fee.**
- Entry is financeable through FundHub's own rails, structured as a training
  product. **No credit gate.**
- The production floor is the only partner filter that exists.
- Partner-recruits-partner pays **$2,000** (20% of entry), one time, on entry
  only.
- A partner's own affiliates are paid **out of the partner's half**. FundHub's
  50% never moves.
- Live affiliate schedule: **Tier 1 direct 20%, Tier 2 downline 5%**, on funding
  deposit collected or repair enrolment fee
  (`db/migrations/260_affiliate_commission_rates_20260824.sql`,
  `db/migrations/261_affiliate_tier1_20pct_20260824.sql` — both already applied).
- Ad data is **rented from vendor APIs**. Nothing scrapes Meta or Google from
  FundHub infrastructure.
- Hiring is not a constraint.

---

## 4. What has to be true before anyone writes code

Three findings that are carried, not fixed here.

### 4.1 Nothing in production writes `partner_revenue`

The partner ledger tables are real and well built. But the only rows ever inserted
are test fixtures at `src/partners/scope.pg.test.mjs` lines 202–336. **The 50% is
hand arithmetic today.** The affiliate side has the same hole:
`src/affiliates/economics.mjs` exports `convert()`, and nothing in production calls
it from a payment event — only `attribute()` is wired, through
`src/workflows/af-02-referral-ownership-capture.mjs`.

**Effect on this offer:** the Decline Autopsy can *recruit* partners and affiliates
today. It cannot *pay* them automatically. Someone must be told that, plainly,
before recruiting at volume.

### 4.2 The ledger schema is finished — build on it

`db/migrations/042_partners.sql` already gives us everything: `revenue_share_pct`
on the partner row (default 50), `partner_revenue` rows that freeze
`share_pct_applied` at the moment of accrual so a later rate change never rewrites
history, dual idempotency, a trigger that refuses deletes (void with a reason
instead), and `partner_payouts` with a database-level gate that blocks any payout
unless `agreement_signed_at` is stamped and the partner is `active`.

**Do not design a second ledger.** Anything this offer earns lands there.

### 4.3 No earnings claims anywhere public

FundHub's own projection files record **zero measured paid closes**. So:

- The report is a **paid, private document** shown to one buyer about his own
  uploaded deals. Every dollar in it is labelled an estimate, with the arithmetic
  shown.
- **No modelled partner earnings appear on any public page** — not the sales page,
  not the ads, not the thank-you page, not a testimonial graphic.
- Nothing in the report is ever aggregated into a public claim ("brokers find an
  average of $X").
- No customer-facing sentence anywhere claims a credit outcome.

---

## 5. Upload and parsing

### 5.1 The hard boundary: identity never crosses it

The broker's declined clients are **third-party consumers**. They never agreed to
share anything with FundHub. So the product is built so that FundHub cannot learn
who they are, even if the broker is careless.

**Fields FundHub accepts** (all optional except where marked):

| Field | Required? | Why we need it | Notes |
|---|---|---|---|
| `row_label` | **yes** | So the broker can match our answer back to his own list | Free text, 32 chars, e.g. `A-14`, `Jones file`. **He owns the key. We never see it join to a person.** |
| `fico_band` | **yes** | Drives everything | A band, not a score: `<560`, `560-599`, `600-639`, `640-679`, `680-719`, `720+`, `unknown`. Bands, not exact scores, so this is not a credit-file value. |
| `state` | no | Lender eligibility | Two letters |
| `business_age_months` | no | Business-side capacity | Whole months |
| `annual_revenue_usd` | no | Context only in v1 | |
| `requested_amount_usd` | no | What he was trying to place | |
| `declined_by` | no | Which lender said no | Free text, matched loosely to our lender list |
| `decline_reason` | no | Grouping in the report | Picked from a list, plus "other" |
| `declined_on` | no | Age of the deal | Month and year only, **never a full date** |
| `bureaus_pulled` | no | Inquiry sensitivity | e.g. `EX, TU` |
| `open_tradelines` | no | Capacity input | Whole number |
| `revolving_utilization_pct` | no | Capacity input | 0–100 |

**Fields FundHub refuses, at the boundary, in code:** name, Social Security number,
date of birth, street address, e-mail, phone, account numbers, full credit report
text.

The refusal is not a note in the terms. It is a validator:

- **Header rejection.** Any CSV column whose name matches `name`, `ssn`, `social`,
  `dob`, `birth`, `address`, `email`, `phone`, `mobile`, `account` is dropped
  before the file is stored, and the count of dropped columns is shown back to the
  broker.
- **Value rejection.** Any cell matching an SSN shape (`\d{3}-?\d{2}-?\d{4}`), an
  e-mail shape, or a 10-or-11-digit phone shape causes the whole upload to be
  refused with a plain-English message: *"We found what looks like personal
  details in column 4. Take those out and upload again — we only need the
  numbers."*
- **No free-text notes column.** Because a notes column is where a name always
  ends up.
- The refusal happens **before** the bytes are written to storage. A refused
  upload leaves nothing behind but a counter.

This is the whole compliance argument in one sentence: **we cannot mishandle data
we never took.**

### 5.2 Three ways in

**1. CSV (the main path).**
Reuse, do not rewrite. `src/lenders/csv.mjs` already contains a correct
quote-aware line splitter, `splitCsvLine` (line 18), used by `parseLenderCsv`
(line 65). It is currently module-private.
**Action: export `splitCsvLine` from `src/lenders/csv.mjs` and import it.** Adding
a second CSV splitter to this repo is exactly the "two functions doing the same
thing" bug CLAUDE.md §8 warns about.

**2. Manual entry.**
A grid on the page, same fields, same validators, capped at A2 rows. This is the
fallback for a broker whose CRM will not export, and it is also the path a sales
rep can drive on a call.

**3. PDF turn-down letters — accepted, not read (v1).**
There is **no PDF text extraction anywhere in this repo.** `src/underwrite/` and
`scripts/black-reports/` only *generate* PDFs (WeasyPrint, via
`src/underwrite/black-report-pdf.mjs`). Reading one would mean a new dependency,
which CLAUDE.md §8 says I do not add without asking.

So v1: a PDF may be attached as evidence and stored, but the broker still types
that row's fields. The page says so before he uploads. Machine reading of denial
letters is a v2 question and a separate decision (§12, Q4).

### 5.3 Storage mechanics — reuse what shipped

`docs/UPLOADS-SPEC.md` describes the file pipeline that already works. Reuse these
pieces as libraries:

- `src/documents/upload-validate.mjs` — `sniffMimeType()` checks the real first
  bytes (`%PDF`, PNG header, `FF D8 FF`), so a text file renamed `.pdf` is
  rejected. `validateUpload()` applies the size cap
  (`DOCUMENT_UPLOAD_MAX_BYTES`, default 10 MB).
- `src/documents/store.mjs` — `storeFromEnv()` / `netlifyBlobsProvider()`.
  `storage_key` stays an opaque `netlify-blob://…`, never a public URL.
- `netlify/functions/api.mjs` already routes multipart bodies through
  `request.formData()` rather than `request.text()` — that fix is in and must not
  be undone.

**But `api/documents-upload.mjs` itself does not fit, and here is why.** It gates
on `requirePrincipal(req, res, ["staff", "client"])` and every row it writes hangs
off a `client_id`. A $27 buyer is a stranger — not staff, not a client, with no
client record. And `sniffMimeType()` accepts only jpg, png and pdf, so a CSV is
rejected today.

**Therefore:** a new public endpoint, reusing the validators and the store, writing
to its own table. **Do not widen `api/documents-upload.mjs`'s principal set** —
that endpoint's tenancy rules are load-bearing and letting a stranger in through
it would be the wrong door.

Two consequences to honour:

- `sniffMimeType()` must learn `text/csv`. A CSV has no magic number, so the check
  is: the first 8 KB decode cleanly as UTF-8, contain no NUL byte, and the first
  line contains at least one comma. Add it as a named, separately-tested branch —
  do not loosen the existing jpg/png/pdf rules that other callers depend on.
- **A handler file is not a route.** `netlify/functions/api.mjs` holds a hardcoded
  `ROUTES` map (see `"public/partner-apply": publicPartnerApply` at line 593). A
  handler that is not in that map 404s locally *and* deployed.
  `src/http/routes.test.mjs` fails if a handler is neither routed nor allow-listed.
  Keep the route keys **flat** — `public/decline-autopsy`, not
  `public/decline-autopsy/upload` — because the `documents/` prefix branch already
  caused this exact problem once.

### 5.4 New table (schema described, not written)

One table, `decline_autopsy_uploads`, plus one child `decline_autopsy_rows`.

- Scoped by `org_id` and by a random `autopsy_id`. **Never joined to `clients`.**
- Carries the buyer's e-mail (the buyer *did* consent — he bought), the paid
  `payment_link_ref`, the attestation stamp from §8.1, `created_at`, `expires_at`,
  `deleted_at`.
- `decline_autopsy_rows` carries only the fields in §5.1 plus a computed score.
  No contact columns exist on it at all, so there is nothing to leak.
- Follow the `042_partners.sql` posture: no hard deletes of scored history except
  by the retention purge or the buyer's own delete button; both stamp a reason.

---

## 6. Fundability scoring — reuse the engine we have

**There is no `src/underwriting/`. The real directory is `src/underwrite/`, and it
already contains FundHub's approval and capacity model.** Nothing new gets built.

### 6.1 What already exists and gets reused

| Module | What it gives us |
|---|---|
| `src/underwrite/engine.mjs` | `computeUnderwrite` — the capacity model itself, re-exported from `src/underwrite/vendor/underwriter.cjs`. Also `normalizeBureau`, `getNumberField`, `buildSuggestions`. |
| `src/underwrite/adapter.mjs` | `toBureaus()` — turns our stored data into the shape the engine eats. `clientUtilizationPct()`, `toEngineTradelines()`. |
| `src/underwrite/business-funding.mjs` | `businessAgeMultiplier()`, `businessFundingDollars()`, `stackedBusinessFunding()`, `finiteAgeMonths()` — business-side capacity from business age. This is the piece a broker's file feeds best. |
| `src/underwrite/report.mjs` | `buildReport()`, `annotateSuggestions()`, `SUGGESTION_CATALOGUE`, `DEPENDENCY_FIELDS` — the report shape, already written. |
| `src/lenders/match.mjs` | `matchLenders()`, `parseBureaus()`, `stateEligible()`, `sensitiveBureaus()`, `lenderMatchCount()`. Its own header says it invents nothing: unknown lender states mean "include", never a made-up restriction. |
| `src/lenders/store.mjs` | `listLenders()`, `matchForClient()` — the live lender list. |
| `src/commissions/money.mjs` | `percentOf()`, `applySplit()`, `fromCents()`, `toCents()`, `clampAmount()`. |

### 6.2 The honest gap, stated rather than papered over

`toBureaus()` expects tradelines, liabilities and CRS results — a real credit file.
**The Decline Autopsy will never have one.** We are not pulling credit (§8.2), and
the broker is not sending us a report.

So the autopsy runs a **reduced-input path into the same engine**, not a second
engine:

1. Build a minimal bureau shape from what the broker actually gave us: FICO band
   midpoint, open tradelines count, revolving utilisation.
2. Feed it to the **same** `computeUnderwrite`.
3. Layer business-side capacity with `businessFundingDollars()` /
   `stackedBusinessFunding()` using `business_age_months`.
4. Ask `matchLenders()` which lenders would have been eligible on state and bureau
   sensitivity.

**Every assumption used to fill a gap is printed in the report, next to the number
it produced.** That is the difference between an estimate and a guess.

**NULL survives.** `src/commissions/money.mjs` treats NULL as unknown and it must
stay unknown. A row with no FICO band gets `estimated_capacity = NULL`, is shown
as **"Not enough information"**, and is **excluded from every total** — with the
excluded count printed. It never silently becomes zero and it never silently
becomes an average.

`src/crs/snapshot-negatives.mjs` is **not** used here. Its functions
(`negativeKeysFromResult`, `bureauStatusFromResult`) need a real CRS result, and
there isn't one. Naming it as reuse would be pretending.

### 6.3 The four buckets

Each row lands in exactly one:

1. **Fundable now** — the model gives real capacity and at least one live lender
   matches on state and bureaus.
2. **Fundable after repair** — capacity is blocked by the FICO band, and the
   decline reason points at a fixable file. Leads to the repair offer.
3. **Not fundable through our stack** — capacity is genuinely absent.
4. **Not enough information** — required fields missing. Counted, never estimated.

---

## 7. Price and checkout

### 7.1 Where the price lives

`src/config/offers.mjs` says it plainly at the top: prices, names and financing
flags live **there**, not in HTML or JavaScript. Add one frozen entry to `OFFERS`:

```
DECLINE_AUTOPSY: {
  key: "DECLINE_AUTOPSY",
  name: "Decline Autopsy",
  priceCents: 2700,          // A1
  financing: false,          // $27 — nothing to finance
  letters: false,            // must be false; this must never trigger DS-02
  paymentPurpose: "custom",
  productCode: "decline-autopsy",
  commasProductTitle: <SEE BELOW — DO NOT INVENT>
}
```

`letters: false` matters. `offerAllowsLetters()` gates the DS-02 letter pack. A
$27 report must never fire dispute letters at anybody.

**The Commas catalog title is genuinely unknown and must not be guessed.**
`api/public/optimize.mjs` states the rule in its own header: *"Never POST
`/public-api/products/create`. Never invent a catalog title."* The repo cannot tell
me which titles exist in the live Commas catalog. Until someone confirms, use the
existing `COMMAS_DEFAULT_PRODUCT_TITLE` (`"Consulting Services Package"`) rather
than creating a new one. This is open question Q1.

### 7.2 The checkout itself

Copy the pattern that already works for a stranger on a public page —
`api/public/optimize.mjs`:

- No authentication. A stranger from an ad.
- `checkoutConfig()` then `createCheckoutSession()` from
  `src/payments/commas-api.mjs`, keyed by `FANBASIS_CHECKOUT_API_KEY`, base
  `FANBASIS_CHECKOUT_API_BASE`.
- `withCheckoutIdentifiers()` carries our `autopsy_id` on the success URL.
- If neither Commas path is configured, answer **503**. Never invent a link.
- Reconciliation on the way back: `markPaidBySession()` in
  `src/payment-links/index.mjs`.

**Order of operations, and it matters:** pay first, upload second. The buyer pays
$27, lands on the upload page carrying his `autopsy_id`, then uploads. If we let
him upload first we would be holding other people's data from someone who never
became a customer.

### 7.3 Refunds

Instant, no questions, on request within 7 days. A refund also **deletes the
upload and the report** — same button, same transaction. A refunded buyer's data
does not sit in our system.

---

## 8. Consumer data: consent, minimisation, retention, deletion

This is the section that decides whether the offer can ship.

### 8.1 Consent — what we have and what we do not

**What we do not have:** any consent from the declined consumers. They do not know
FundHub exists.

**What we have instead**, and it is a different thing with a different name:

- A **merchant attestation** from the broker, captured as a required checkbox plus
  a typed name at upload, stored with a timestamp, an IP address and the exact
  wording version. It says, in plain words:
  1. these are his own client records,
  2. he has the right to share this information for the purpose of getting an
     assessment,
  3. he has removed names and personal identifiers before uploading,
  4. FundHub will not contact any of these people, and
  5. if he later wants us to work one of these deals, he introduces the person
     himself and that person consents to us directly.

**Do NOT store this in the consents table.**
`src/consent/index.mjs` sets `CONSENT_KINDS = ["soft_pull_consent",
"dispute_authorization"]`, and the database enforces it — `099_client_consents.sql`
line 155 and `167_dispute_authorization_consent.sql` line 41 are CHECK constraints
on exactly those values. That table means *"a consumer gave us permission about
their own file."* A broker's warranty about somebody else's file is not that.
Widening `CONSENT_KINDS` would blur the one record an auditor most needs to be
clean. Store the attestation on the autopsy row itself.

### 8.2 No credit pull. Ever. On anybody in this file.

Absolute, and it is the reason §5.1's field list is what it is.

- Nothing in this flow touches the soft-pull path — not
  `src/handlers/diagnostic-soft-pull.mjs`, not
  `src/workflows/c-00-crs-soft-pull-request.mjs`, not
  `src/finance/soft-pulls.mjs`, not `src/finance/soft-pull-pricing.mjs`, not the
  soft-pull ledger.
- Nothing creates a `clients` row from an uploaded record.
- The report says so on its face: **"We did not look at anyone's credit. These are
  estimates from the numbers you gave us."**
- If one of these deals later becomes a real client, that is a **new** journey with
  its own consent capture through `captureConsent()` in `src/consent/index.mjs`.
  It starts clean. It does not inherit anything from the autopsy.

### 8.3 Minimisation — what gets dropped, what gets kept

| Data | Treatment |
|---|---|
| Names, SSNs, DOBs, addresses, e-mails, phones | **Refused at the boundary, before storage.** Never written. Nothing to hash, because nothing arrives. |
| `row_label` | Kept as the broker typed it. It is his key, meaningless to us. Truncated to 32 chars. |
| `declined_on` | **Month and year only.** A full date plus a state plus an amount is a re-identification handle. |
| Exact FICO | **Never accepted.** Bands only. |
| The raw uploaded file | Kept only until parsing succeeds, then **deleted from blob storage**. We keep the parsed, cleaned rows, not the original. This is the single highest-value minimisation step in the design. |
| PDF attachments (A4) | Kept for the retention window, then deleted with everything else. Never machine-read, never indexed, never text-searched. |
| Buyer's own contact details | Kept normally. He is a customer and he consented. |

### 8.4 What FundHub may and may not do with it afterwards

**May:**
- Score it, and show the buyer his own report.
- Count it in aggregate, internal-only, with no row-level detail and no export
  (e.g. "brokers who upload average N rows"). Internal means internal — see §4.3.

**May not — and these are enforced by the fact that the data does not exist, not
by policy alone:**
- Contact any of these consumers. In any channel. Ever. There are no contact
  fields, so there is nothing to contact.
- Create clients, leads, campaign records or mail records from them. The uploaded
  rows must **never** enter the campaign or mail pipeline.
  `src/mail/suppression.mjs` is the wrong control here — suppression manages a
  list you are allowed to mail and are choosing not to. These people are not on
  such a list and must never be added to one.
  `src/mail/README.md` already states that nothing in `src/mail/` mails anything,
  and that the absence of a send path is deliberate. Nothing in this offer changes
  that.
- Sell, share, or hand the data to a lender, an affiliate, or another partner.
- Match the rows against any other FundHub dataset to try to identify anyone.

### 8.5 Retention and deletion

**The existing machinery does not cover this, and I am not going to pretend it
does.**

`src/retention/policy.mjs` defines exactly five data classes:
`crs_raw_payloads`, `pii_access_log`, `soft_pull_ledger`, `bank_transactions`,
`mock_data`. None of them is a broker upload.

**Proposal:** a sixth class, `broker_upload_rows`, added to `DATA_CLASSES` and to
`src/retention/classes.mjs` with a `count` and a `purge`, following that file's two
rules exactly — counting never writes, and every query is org-scoped with the org
not optional. Action is **delete, not de-identify**: there is no identity left to
strip, so a tombstone would just be clutter.

Purge runs through the existing `scripts/retention-purge.mjs`, which only writes
under an explicit `--apply`.

**The period is an owner decision and the code is right to refuse a default.**
`loadPolicy()` returns `retainDays` as *absent*, not null, when nobody has decided
— and its own comment explains why: `"retainDays" in policy` is the question "has
anybody decided this", and a zero must never be able to answer it. So **nothing
purges until Chris sets a number.** **CLOSED 2026-08-31 (owner-set): rows are
RETAINED IN FULL and no purge schedule is configured for this class — register the
class so it is counted and auditable, but do not schedule a purge. See
`W0-decisions.md`.** The original proposal below is retained for mechanism only, not a
setting.

**Three ways an upload dies:**

1. **The clock.** At the retention period, rows and any attachments are purged.
2. **The buyer's button.** "Delete my upload" on the report page — immediate, hard
   delete of rows and attachments, keeping only the purchase record and a
   `deleted_at` stamp. Confirmed by e-mail to the buyer.
3. **Refund.** §7.3 — same effect, automatic.

`src/privacy/erasure.mjs`'s `eraseClient()` **does not apply.** It is keyed on
`clientId`, and an autopsy buyer is not a client. Bending it to take a
non-client id would weaken the one function whose whole job is being precise.
Build the scoped delete on the autopsy record instead, and follow `eraseClient()`'s
posture: record what was kept and why (`KEPT_WITH_REASON`), because a financial
record of a $27 sale is not erasable and pretending otherwise would be worse.

### 8.6 Scoping

- Every read and write carries `org_id` **and** `autopsy_id`.
- Partner principals never see another partner's autopsies. `src/partners/scope.mjs`
  (`scopeFor`, `where`, `assertCanReadRow`, `PARTNER_SCOPED_TABLES`) is the existing
  tenancy tool — if these tables become partner-visible, they get added to
  `PARTNER_SCOPED_TABLES` and covered by the isolation tests, not left to a
  hand-written WHERE clause.
- The report link is signed and expiring. Not guessable, not permanent.

---

## 9. The report, and the two doors out

### 9.1 Layout

**Header.** "Decline Autopsy — 20 files reviewed." Date. Buyer's name.

**The disclosure sits at the top, not the bottom.** Four short lines:
*We did not look at anyone's credit. These are estimates from the numbers you gave
us. We removed nothing you did not send, and we will not contact any of these
people. Your file is deleted on <date>.*

**Panel 1 — The count.** Four numbers, in the four buckets of §6.3. Fundable now /
fundable after repair / not fundable / not enough information. The fourth number is
shown as prominently as the others.

**Panel 2 — The money, row by row.** One line per uploaded row, keyed by the
broker's own `row_label`. Bucket, estimated capacity, and the assumptions used.
Rows with NULL capacity say "Not enough information" and show a dash — never zero.

**Panel 3 — Why each one failed, grouped.** Decline reasons rolled up, so the
broker sees the pattern rather than twenty individual verdicts. Uses
`SUGGESTION_CATALOGUE` and `annotateSuggestions()` from `src/underwrite/report.mjs`.

**Panel 4 — Which lenders would have taken it.** From `matchLenders()`. Counts and
categories, not a lender list he can walk away with — that list is the asset.

**Panel 5 — What it was worth.** The arithmetic in §10, shown as arithmetic, with
"estimate" on every figure. Totals exclude the unknown rows and say so.

**Panel 6 — Two doors.** §9.2.

### 9.2 The two doors

**Door A — Partner.** *"Stop writing them off. Send them to us and keep half."*
$10,000 one time, no monthly, financeable through our own rails as a training
product, no credit gate. 50% of repair and funding, front end and back end,
including half the success fee. Goes to `api/public/partner-apply.mjs` with
`track: "white_label"` — the `TRACKS` map already accepts `white_label`,
`white-label`, `partner` and `wl`, all mapping to `partner`. Routed at
`"public/partner-apply"` in `netlify/functions/api.mjs` line 593. It creates a real
login, a real partner row and a personal URL — it is not a form that goes nowhere.

**Door B — Affiliate.** For a broker not ready to buy in. Same endpoint,
`track: "affiliate"`, which also queues the AF1 drip catalogue through
`queueAffiliateTemplate()` in `src/affiliates/drip.mjs`. Tier 1 20% on funding
deposit collected or repair enrolment fee, per migrations 260/261.

**Both doors describe terms, never earnings.** "50% of the fee" is a term. "You
will make $30,000" is an earnings claim and does not appear.

### 9.3 The Live Trial connection

A broker who buys the autopsy and does not take either door is the exact person the
Live Trial is for. Per the locked decision: if a Live Trial prospect reaches day 8
and does not sign, **he keeps the leads his trial produced**, FundHub fulfils any
that convert, and he is paid as an affiliate at the standard 20%. He becomes an
affiliate rather than walking away with nothing. Consumers are told on day 1 that
FundHub performs fulfilment.

### 9.4 The $27 does not split — and this is a real code decision

The Decline Autopsy report is a **digital product**. Per the locked decision,
e-products stay 100% FundHub.

**Concretely:** no row is ever created in `affiliate_commission_rules` for
`decline-autopsy`, and no `partner_revenue` row is ever accrued from an autopsy
purchase. The existing rules are already narrow and correct —
`src/affiliates/economics.mjs` sets `FUNDING_PRODUCT_CODES = ["card-stacking-dfy"]`
and `REPAIR_PRODUCT_CODES = ["repair-bundle"]`, so `decline-autopsy` is excluded by
default. **Leave it that way. Do not add it.**

What *does* split is the funding and repair business the autopsy produces later,
through the normal path.

---

## 10. Worked money example, end to end, in integer cents

**Money is integer cents**, via `src/commissions/money.mjs`. `fromCents` returns a
**string**. `percentOf` takes percent units, so `10` means 10%.

**Setup.** A broker buys the autopsy and uploads 20 declines. Six land in
"fundable now". Three land in "not enough information" — they are excluded from
every total below, and the report says "3 rows excluded — not enough information".

**Step 1 — the autopsy sale.**

```
price                      2_700 cents    ($27.00)
partner/affiliate split        0 cents    e-product, 100% FundHub (§9.4)
FundHub keeps              2_700 cents
```

**Step 2 — one deal, once it funds.** Using the owner-set average at its low end,
$100,000 funded.

```
funded amount             10_000_000 cents   ($100,000)   ESTIMATE
success fee               percentOf(10_000_000, 10)
                           = 1_000_000 cents  ($10,000)
```

**The $3,000 deposit counts toward the 10%. It is not additional.**

```
deposit already collected     300_000 cents  ($3,000)
still due after funding       700_000 cents  ($7,000)
total the client pays       1_000_000 cents  ($10,000)
```

**Step 3 — the partner's half.**

```
gross to split              1_000_000 cents
partner share       applySplit(1_000_000, 50) =   500_000 cents  ($5,000)
FundHub share                                     500_000 cents  ($5,000)
```

`share_pct_applied = 50` is frozen on the `partner_revenue` row at accrual, so if
the rate ever changes, this deal's history does not move
(`db/migrations/042_partners.sql`).

**Step 4 — the partner's own sub-affiliate, if there is one.** Paid out of the
partner's half. FundHub's 50% never moves. Basis per migrations 260/261 is the
funding deposit collected.

```
tier 1 basis                  300_000 cents   (the deposit)
tier 1 at 20%       percentOf(300_000, 20) =    60_000 cents  ($600)
partner nets        500_000 - 60_000      =   440_000 cents  ($4,400)
FundHub still                                  500_000 cents  ($5,000)
```

**Step 5 — all six fundable rows, if every one funded at $100,000.**

```
gross fees      6 x 1_000_000           =  6_000_000 cents  ($60,000)
partner half    applySplit(6_000_000,50)=  3_000_000 cents  ($30,000)
FundHub half                               3_000_000 cents  ($30,000)
```

**Step 6 — what the report is allowed to say about that.**

The report shows this arithmetic **only to the one buyer, about his own uploaded
rows**, with "estimate" on every figure, with the three excluded rows named, and
with the funded-amount assumption printed next to the number it produced.

It never says he will earn it. It never appears on a public page. It is never
averaged into a claim. See §4.3.

**One more, for the entry fee.** $10,000 financed through FundHub's rails:

```
entry fee                   1_000_000 cents  ($10,000)
lender payout by band — FundHub receives:
  prime 680+        85%  ->   850_000 cents  ($8,500)
  near prime 600+   75%  ->   750_000 cents  ($7,500)
  Lender B tiers    77 / 72 / 62 / 50 / 30%
  Sub Prime A       42%  ->   420_000 cents  ($4,200)
partner recruiting bonus, one time, entry only:
  percentOf(1_000_000, 20)  =  200_000 cents  ($2,000)
```

$10,000 sits under the $17,000 subprime cap, so every band can carry it. Nothing is
paid on the recruited partner's production, and there is no monthly to pay on.

---

## 11. Files this touches

Verified to exist. Nothing below is written by this spec.

**Read, not modified**

- `/home/user/fundhub-platform/CLAUDE.md`
- `/home/user/fundhub-platform/docs/UPLOADS-SPEC.md`
- `/home/user/fundhub-platform/docs/compliance/creative-block-reasons.md`
- `/home/user/fundhub-platform/docs/journeys/white-label-intended.md`
- `/home/user/fundhub-platform/docs/journeys/white-label-actual.md`
- `/home/user/fundhub-platform/docs/journeys/slo-connections-intended.md`
- `/home/user/fundhub-platform/db/migrations/042_partners.sql`
- `/home/user/fundhub-platform/db/migrations/099_client_consents.sql`
- `/home/user/fundhub-platform/db/migrations/100_retention_policy.sql`
- `/home/user/fundhub-platform/db/migrations/102_erasure_requests.sql`
- `/home/user/fundhub-platform/db/migrations/118_client_uploads.sql`
- `/home/user/fundhub-platform/db/migrations/167_dispute_authorization_consent.sql`
- `/home/user/fundhub-platform/db/migrations/260_affiliate_commission_rates_20260824.sql`
- `/home/user/fundhub-platform/db/migrations/261_affiliate_tier1_20pct_20260824.sql`
- `/home/user/fundhub-platform/src/underwrite/engine.mjs`
- `/home/user/fundhub-platform/src/underwrite/adapter.mjs`
- `/home/user/fundhub-platform/src/underwrite/business-funding.mjs`
- `/home/user/fundhub-platform/src/underwrite/report.mjs`
- `/home/user/fundhub-platform/src/underwrite/vendor/underwriter.cjs`
- `/home/user/fundhub-platform/src/lenders/match.mjs`
- `/home/user/fundhub-platform/src/lenders/store.mjs`
- `/home/user/fundhub-platform/src/commissions/money.mjs`
- `/home/user/fundhub-platform/src/consent/index.mjs`
- `/home/user/fundhub-platform/src/consent/disclosures.mjs`
- `/home/user/fundhub-platform/src/privacy/erasure.mjs`
- `/home/user/fundhub-platform/src/partners/scope.mjs`
- `/home/user/fundhub-platform/src/affiliates/economics.mjs`
- `/home/user/fundhub-platform/src/affiliates/drip.mjs`
- `/home/user/fundhub-platform/src/mail/README.md`
- `/home/user/fundhub-platform/src/mail/suppression.mjs`
- `/home/user/fundhub-platform/src/documents/store.mjs`
- `/home/user/fundhub-platform/src/documents/register.mjs`
- `/home/user/fundhub-platform/src/documents/kinds.mjs`
- `/home/user/fundhub-platform/src/payments/commas-api.mjs`
- `/home/user/fundhub-platform/src/payment-links/index.mjs`
- `/home/user/fundhub-platform/api/public/optimize.mjs`
- `/home/user/fundhub-platform/api/public/partner-apply.mjs`
- `/home/user/fundhub-platform/api/documents-upload.mjs`
- `/home/user/fundhub-platform/public/affiliates/index.html`
- `/home/user/fundhub-platform/scripts/retention-purge.mjs`

**Modified when this is built**

- `/home/user/fundhub-platform/src/config/offers.mjs` — one frozen `DECLINE_AUTOPSY`
  entry (§7.1)
- `/home/user/fundhub-platform/src/lenders/csv.mjs` — export the existing
  `splitCsvLine` (§5.2)
- `/home/user/fundhub-platform/src/documents/upload-validate.mjs` — a named
  `text/csv` branch in `sniffMimeType()` (§5.3)
- `/home/user/fundhub-platform/netlify/functions/api.mjs` — new flat `ROUTES` keys
  (§5.3)
- `/home/user/fundhub-platform/src/retention/policy.mjs` — sixth data class (§8.5)
- `/home/user/fundhub-platform/src/retention/classes.mjs` — its `count` and `purge`
  (§8.5)
- `/home/user/fundhub-platform/docs/journeys/CHANGELOG.md` — one line per journey
  change

**New when this is built**

- `api/public/decline-autopsy.mjs` — page data and checkout (no auth)
- `api/public/decline-autopsy-upload.mjs` — the upload boundary and validators
- `api/public/decline-autopsy-report.mjs` — signed, expiring report read
- `src/decline-autopsy/parse.mjs` — CSV and manual normalisation, PII refusal
- `src/decline-autopsy/score.mjs` — the reduced-input path into
  `computeUnderwrite` (§6.2)
- `src/decline-autopsy/report.mjs` — report assembly on top of
  `src/underwrite/report.mjs`
- `db/migrations/<next>_decline_autopsy.sql` — the two tables (§5.4)
- `public/funnel/decline-autopsy/` — sales page, upload page, report page
- `src/http/decline-autopsy.pg.test.mjs` — **endpoint tests must live under
  `src/`**; `npm test`'s glob is `src/**` and `scripts/**` only, so a test placed
  under `api/` silently never runs
- `docs/journeys/decline-autopsy-intended.md` — **hand-authored by a human. An
  agent does not write this file** (CLAUDE.md §4)
- `docs/journeys/decline-autopsy-actual.md` — generated from code, in the same
  commit as the code

**Never touched by this work:** any `-intended.md` journey, `src/mail/*` send
paths, the soft-pull ledger, `api/documents-upload.mjs`'s principal set.

---

## 12. Genuinely unknown — absence is the finding

| # | Question | Why it cannot be answered from the repo |
|---|---|---|
| Q1 | Which Commas catalog title covers a $27 assessment? | The catalog lives at the vendor. `api/public/optimize.mjs` forbids inventing one and forbids creating one. Needs a human to look. |
| Q2 | How many declines does a typical broker actually hold, and in what format? | No measurement exists. A2's cap of 25 is a guess. |
| Q3 | What is the acquisition cost per $27 buyer? | Zero measured spend on this offer. "Self-liquidating" is the intent, not an observed fact. |
| Q4 | Should v1 machine-read PDF denial letters? | No PDF text extraction exists in the repo and adding one is a new dependency. Owner call. |
| Q5 | What retention period? | `loadPolicy()` deliberately refuses a default. A3's 30 days is a proposal. Nothing purges until it is set. |
| Q6 | Does `computeUnderwrite` behave sensibly on reduced input? | It has never been run this way. **Must be measured against real declined files before launch.** If it does not, the estimate is not trustworthy and the offer does not ship. |
| Q7 | Who builds the production writer for `partner_revenue`? | §4.1. Not in this workflow's scope, and recruiting at volume without it means manual payouts. |
| Q8 | Is `FANBASIS_CHECKOUT_API_KEY` set in production? | `api.netlify.com` is blocked by this environment's network policy, so `netlify env:list` cannot be run here. Someone with CLI access must confirm. |

---

## 13. Before this is called done

Per CLAUDE.md §6, all of these, and no exceptions:

1. `npm run lint`
2. `npx tsc --noEmit`
3. Test suite green — nothing skipped, deleted or weakened. Re-measure against a
   real Postgres and **record where it was run**; do not quote a historic number.
4. Playwright on every new page
5. `decline-autopsy-actual.md` written from code and the changelog appended, in the
   **same commit** as the code
6. Change manifest emitted
7. **Additionally, specific to this offer:**
   - A test proving an upload containing an SSN, an e-mail or a phone number is
     **refused and not stored**
   - A test proving the raw uploaded file is deleted from blob storage after
     parsing
   - A test proving a NULL capacity stays NULL through scoring, totalling and
     display — and never becomes 0
   - A test proving `decline-autopsy` accrues no partner or affiliate commission
   - A test proving the delete button removes rows and attachments
   - `src/http/routes.test.mjs` still passes with the new routes

---

## 14. Compliance summary

**COMPLIANCE REVIEW REQUIRED.** No advice attached.

Affected areas: **consent capture** (a merchant attestation that is deliberately
not stored as a consumer consent), **credit-pull type** (none — and the design is
built so none is possible), and **fee timing** (the $27 is charged before the
report is produced; the $3,000 deposit counts toward the 10%).

Not affected: dispute logic (`letters: false`), credit-repair messaging (none in
the report), payment rails (existing Commas path, unchanged), refund behaviour
(standard, plus data deletion).

**No customer-facing claim about credit outcomes appears anywhere in this offer.**
