# Bank outreach — manual first, product fields per type (build spec, 2026-10-21)

Owner (Chris, 2026-10-21), in his words:

- "We start manually, we move to AI ... I'm not going to sit here and just build an AI system without having done it manually."
- "You can't just ask lenders for data points; the goal is to warm them up ... I was hoping we could hop on a call so I can ask about the data points."
- "It depends on the product." Products: business credit cards, business lines of credit, personal credit cards, personal lines of credit, personal loans; MCAs and others may come later.
- "Before we push it though, there needs to be a human in the loop. That's what the point of these reps are for."
- "It's not like it needs to be disabled. You just turn it on and off."
- Back end first, then front end. Sonnet for back end, Opus for the dashboard.

## What already exists (do not rebuild)

Live today (PR #77, #96, #111): bank list (11,568 bank-by-state rows), rep assignment, saving bankers, manual email/phone/LinkedIn links, touch log with next action, product drafts with facts, manager verify into `lenders`, partner check-ins, banker search (off until `SERPER_API_KEY`), automatic emails (off: 0 of 7 templates approved), AI reply reader (off: agent `BANK-OUTREACH-REPLY` = `draft`), automation screens.

The switches stay as they are: search = the key; automatic emails = template approval; AI replies = agent status. Nothing is removed.

## 1. Product fields per product type (back end)

`src/outreach/model.mjs` gets one field catalog. The 9 existing keys keep their names, types and storage, so saved products and the live checks keep working.

### Field catalog

| Key | Label | Type | Lenders column |
|---|---|---|---|
| `minimum_score` | Minimum credit score | score (integer 300–850) | `stated_requirements` text (existing) |
| `minimum_time_in_business_years` | Minimum years in business | years (≥0, 2 decimals) | `minimum_time_in_business_years` |
| `minimum_revenue_threshold` | Minimum yearly revenue | money (≥0, 2 decimals) | `minimum_revenue_threshold` |
| `bureaus_pulled` | Bureaus pulled | bureaus (EX/EQ/TU list) | `bureaus_pulled` (existing `/` join) |
| `inquiry_tolerance` | Inquiries they accept | text | `stated_requirements` text (existing) |
| `stated_income` | Accepts stated income | yes/no | `stated_requirements` text (existing) |
| `eligible_states` | States served | states (two-letter list) | `eligible_states` (existing `, ` join) |
| `application_url` | Online application link | url | `application_url` (existing) |
| `paper_application_url` | Paper application link | url | `notes` (existing) |
| `double_pull` | Pulls two bureaus | yes/no | `double_pull` ("Yes"/"No") |
| `relationship_required` | Needs an existing relationship | yes/no | `relationship_required` ("Yes"/"No") |
| `requires_account_opening` | Must open an account first | yes/no | `requires_account_opening` ("Yes"/"No") |
| `minimum_deposit` | Minimum deposit | money | `minimum_deposit` |
| `prequal_soft_pull` | Soft-pull pre-qualification | yes/no | `prequal_soft_pull` ("Yes"/"No") |
| `business_bureau_pulled` | Business bureau pulled | text (e.g. "D&B/SBFE", "None") | `business_bureau_pulled` |
| `underwriter` | Who underwrites it | text (e.g. "Underwritten by Elan") | `underwriter_interaction` |
| `intro_offers` | Intro offer | text (e.g. "0% intro APR — 12 months") | `intro_offers` |
| `multiple_llc_allowed` | More than one LLC allowed | yes/no | `multiple_llc_allowed` ("Yes"/"No") |
| `application_method` | How clients apply | text | `application_method` |
| `typical_amount` | Typical approved amount | money | `typical_approval_range` |
| `apr_pct` | APR (percent) | pct (0–100, 2 decimals) | `apr_range_pct` |
| `repayment_months` | Repayment months | months (integer 1–600) | `repayment_terms_months` |
| `funding_speed` | How fast it funds | text | `funding_speed` |
| `average_starting_line` | Usual starting line | money | `average_starting_loc` |
| `max_line` | Largest line | money | `max_known_loc` |
| `draw_and_renewal` | Draw period and renewal | text | `draw_period_renewal` |
| `documents_required` | Documents required | text | `docs_requested` |
| `collateral_required` | Collateral required | yes/no | `collateral_required` ("Yes"/"No") |
| `line_type` | Line type | text (revolving, non-revolving, secured) | `loc_type` |

### Fields per product type

Every product: `minimum_score`, `bureaus_pulled`, `double_pull`, `inquiry_tolerance`, `stated_income`, `eligible_states`, `application_url`, `paper_application_url`, `relationship_required`, `requires_account_opening`, `minimum_deposit`, `prequal_soft_pull`.

| Product (lender_table) | Adds |
|---|---|
| Business card online (`OnlineBizCC`), business card branch (`InBranchBizCC`) | `minimum_time_in_business_years`, `minimum_revenue_threshold`, `business_bureau_pulled`, `underwriter`, `intro_offers`, `multiple_llc_allowed` |
| Business line stated (`BizLOC_Stated`), business line documented (`BizLOC_Documented`) | `minimum_time_in_business_years`, `minimum_revenue_threshold`, `business_bureau_pulled`, `average_starting_line`, `max_line`, `apr_pct`, `draw_and_renewal`, `documents_required`, `collateral_required`, `line_type` |
| Personal card (`PersonalCC`) | `underwriter`, `intro_offers` |
| Personal line (`PersonalLOC`) | `average_starting_line`, `max_line`, `apr_pct`, `draw_and_renewal`, `collateral_required` |
| Personal loan (`PersonalLoans`) | `application_method`, `typical_amount`, `apr_pct`, `repayment_months`, `funding_speed` |

For personal products, `minimum_time_in_business_years` and `minimum_revenue_threshold` do not apply: the server stores the value `"n/a"` for them. A person never types it.

Adding a product type later (MCA) means adding one row to this table.

### Rules

- A value is a real answer or `"unknown"` (the banker does not know). Unknown never becomes zero, false or "all states".
- **A product is complete only when every field for its type is answered or `"unknown"`**, it has source evidence, a reachable banker, and a real online or paper application link (existing rules).
- Pushing a complete product writes every mapped column above into its `lenders` row, in the same transaction as today. Known-only: `"unknown"` and `"n/a"` write `NULL`.
- `normalizeFacts(input, { complete, lenderTable })` validates against the type's list; without `lenderTable` it keeps today's behavior (the 9 keys).
- The deep check `bank-outreach:verified-product` and the hourly beat accept `"n/a"` where they accept `"unknown"` for the two business-only keys. The two SQL copies stay identical (existing test).

## 2. A rep pushes to Lenders (back end)

`verify_product` is allowed for an `outbound_rep` on a bank assigned to them (the existing `account()` scope already enforces assignment), as well as managers. Everything else about verification is unchanged. `verified_by` is the person who pressed it.

## 3. Warm-up messages, sent by the rep (back end + front end)

The first contact warms the banker up and asks for a call. It never asks for data points. The rep sends it from their own email or phone; the CRM logs it.

Back end: the bank detail response (`GET /api/read/bank-outreach?id=`) adds, for each contact, `warmup`:

```json
{ "email": { "subject": "...", "body": "..." }, "text": "..." }
```

rendered from templates `EMAIL-BANK-OUTREACH-1` and new `SMS-BANK-OUTREACH-1` with merge tags `banker.first_name`, `bank.name`, `bank.state_name`, `rep.name` (the assigned rep's name, or the signed-in staff member when the bank has no rep). Rendering reads the template whether or not it is approved: approval only gates automatic sending.

Migration rewrites the copy of `EMAIL-BANK-OUTREACH-1..3` (only while it still holds the 495 words and is unapproved) and adds `SMS-BANK-OUTREACH-1`. Copy rules: sounds like a person, certain words (never "maybe", "might", "could", "we think"), no promises about approvals or amounts, "Fundhub" spelling, signed by the rep. Email 1 example: "Hi Jane, I'm Mike with Fundhub. We have clients in Arizona who need credit cards and business lines of credit, and I'd like to send them your way. Could we hop on a quick call so I learn what you look for? That way, when I send a client, your team can take care of them fast." Emails 2 and 3 are short, friendly follow-ups that ask for the call. The text is under 300 characters and ends with "Reply STOP to opt out."

Front end: the "Email banker" control opens `mailto:` with that subject and body; "Text banker" opens `sms:` with that body. Each click also logs a touch through the existing `log_touch` action (channel email, or call/note for a text per the existing channel list; outcome "Warm-up email sent" / "Warm-up text sent"; next action "Follow up with <banker>" due in 3 days). No message leaves Fundhub's servers.

## 4. Field catalog for the screen (back end → front end)

Every read response adds:

```json
"productFields": {
  "fields": { "<key>": { "label": "...", "type": "score|years|money|pct|months|yesno|bureaus|states|url|text" } },
  "types": { "OnlineBizCC": ["<key>", "..."], "...": [] },
  "notApplicable": { "PersonalCC": ["minimum_time_in_business_years", "minimum_revenue_threshold"], "...": [] }
}
```

The product form renders the fields for the chosen category from this catalog, in this order. Changing the category re-renders the fields and keeps answers for keys both types share.

## 5. Front end (Opus, `public/app/bank-outreach.*` only)

- Product form per type from `productFields`; "unknown" choice on every field; yes/no as a select (Yes / No / Unknown).
- Rep sees "Push to Lenders" on a complete product on their bank (same control managers have, renamed from Verify if needed for clarity).
- "Email banker" / "Text banker" warm-up buttons per contact (section 3).
- Rules: `docs/rules/UI-STANDARDS.md`, the four states, 1440/390/320 with no sideways scroll, 16px body, 13px captions, 44px targets; existing tests intact; marked screenshots.

## Proof and release

Unit + real PostgreSQL tests (CI), lint, TypeScript, bank Chromium spec, WebKit proof, layout guards, heartbeat/tripwire tests, journey `-actual.md` + changelog. One PR, CI green, merge, GitHub ships, then check `/api/health` and the live page files.
