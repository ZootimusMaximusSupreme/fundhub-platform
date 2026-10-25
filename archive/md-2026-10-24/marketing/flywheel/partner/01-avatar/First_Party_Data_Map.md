# First-Party Data Map — Voice of the Customer

Every place in FundHub's own database where customers, prospects, and partners speak in their own words — plus every table that shows where they move, stall, or drop out of the journey. Merged from five area sweeps: survey, messages and comms, calls and sales, journey events and pipelines, partner and affiliate. (A sixth sweep, intake-docs, overlapped the survey area almost entirely; its additions are folded in below.)

**Voice value key:** gold = verbatim customer language worth mining first. useful = structured signal or secondary language. thin = little or nothing to mine today.
**PII risk key:** how easy it is to accidentally pull a name, email, phone, or worse alongside the good stuff.

---

## 1. The Gold

Ranked. Each entry says what question it answers.

1. **Inbound messages — `messages.rendered_body`.** The single richest source. Every inbound SMS, inbound email, and portal chat message stores the client's verbatim words. Answers: what vocabulary do real clients use, unprompted? What do they ask, complain about, celebrate? Caveat: voice-call rows hold only a disposition label, never a transcript — transcripts live in `call_outcomes`.
2. **Call outcomes — `call_outcomes.transcript` + `belief_failed` + `notes`.** Word-for-word Google Meet transcripts of sales calls, the coded objection diagnosis (Cole Gordon seven-belief model: pain / doubt / cost / desire / money / support / trust), and the prospect's own stated cost of not acting (`cost_of_inaction`, embedded as JSON in `notes`). Answers: what objections kill deals, in the prospect's words, and which belief failed.
3. **Survey desires — `client_custom_fields.cf_svy_money_change_now` + `cf_svy_planned_use`, and the raw copy in `events` (`survey.submitted`).** Multi-select desire statements chosen verbatim ("Peace of mind (stop stressing about cash)", "Fresh start (new business / startup launch)") — countable, so desires rank by real volume. `cf_svy_planned_use` also carries the only true free text in the survey: what visitors typed when they picked "Other." Answers: what do applicants say they want the money for, and what would it change?
4. **Customer interviews — `customer_insights`.** Mid check-in and post-funding interview answers, typed by staff as the customer said them. Questions are exactly the avatar questions: hardest thing right now, what almost stopped you, what changed first, what would you tell someone. Built to feed ads/VSL/landing pages one day — but the migration itself stamps marketing reuse COMPLIANCE REVIEW REQUIRED, and consent for reuse is not yet established. Research calibration only.
5. **Contract decline reasons — `contract_signers.decline_reason`.** Words the signer themselves typed. The code refuses a decline without a reason, so every declined signer explains why. Answers: why do people balk at the agreement?
6. **Partner applications — `partners.notes` (the `audience=` line).** The only surviving Brandon-side (partner avatar) voice: the white-label applicant's typed answer to "tell us about your audience," capped at 400 characters. Answers: how do partners describe themselves and their reach? **Finding:** the affiliate-track answer to the same question is validated and then thrown away — affiliate applicant voice exists nowhere in this database.
7. **Shadow agent log — `agent_shadow_log.inbound_body`.** A second, clean copy of inbound client messages, pre-paired with the reply the AI agent would have sent. Handy for pulling inbound language per channel without touching the messages table.
8. **The event spine — `events` (canonical names).** Not words, but the journey itself: entry → survey → diagnostic paid → booking → call → decision → deposit → sale → funding rounds, plus abandonment signals. Counting distinct clients per stage per week IS the stall/drop/convert funnel.
9. **The decoder ring — `docs/clickfunnels/cf-survey-ground-truth.md`.** Not applicant data: the owner-dumped verbatim wording of every survey question and option. Any research quoting survey values must quote option language from this file. Machine-readable twin: `src/survey/cf-question-map.mjs`.

---

## 2. Full Map

### A. Survey and intake

| Source | What it holds | Voice | PII risk | Where defined |
|---|---|---|---|---|
| `client_custom_fields` — `cf_svy_planned_use`, `cf_svy_money_change_now` | Desire language of every applicant. `cf_svy_money_change_now` is a text[] multi-select of emotional desire statements chosen verbatim. `cf_svy_planned_use` is one of six picklist options OR the exact free text typed under "Other" (`public/js/homepage-survey.js` line 332). The only true free text in the survey. | gold | medium | `db/schema/005_client_custom_fields.sql` (lines 129, 180); `db/migrations/163_cf_svy_typed_columns.sql`; writer `src/handlers/client-custom-fields.mjs` (upsertSurveyCarbonCopy) |
| `client_custom_fields` — sizing/gate columns (`cf_svy_funding_target_amount`, `cf_svy_has_business`, `cf_svy_business_revenue`, `cf_svy_revenue_verifiable`, `cf_svy_annual_income_range`, `cf_svy_income_verifiable`, `cf_svy_available_capital`, `cf_svy_self_reported_fico`, `cf_svy_has_negatives`) | Self-reported sizing bands: how much they want, business age, revenue/income bands, provability, cash on hand, FICO band, negatives Yes/No. FICO + negatives are the Stage 2 qualification gate (PASS / DOWNSELL / MANUAL_REVIEW in `src/config/survey-qualification.mjs`) — a convert/decline journey signal. Bands are verbatim customer-facing labels, so they double as segmentation language. | useful | low | `db/migrations/163_cf_svy_typed_columns.sql`; `db/schema/005_client_custom_fields.sql` (lines 179, 202, 242, 281); gate logic `src/config/survey-qualification.mjs` |
| `client_custom_fields` — legacy CRM columns (`cf_svy_your_why`, `cf_svy_what_matters_most`, `cf_svy_tried_restoration_before`, `cf_svy_clarity_first`, `contactcf_svy_annual_income_range_0u7_copy`; plus free-text `pre_call_question`, `funding_planned_use`, `repair_why`) | Carried over from the 300-field the CRM export. The `your_why` / `what_matters_most` picklists and the `pre_call_question` / `funding_planned_use` / `repair_why` free-text fields are customer motivation language in the client's own words IF populated — no writer in the current codebase asks them; populated only via CRM port. Check row counts before building on any of them. Option labels are not recorded in the repo. | thin (until counted) | low | `db/schema/005_client_custom_fields.sql` (lines 88, 107, 137, 231, 307); `db/schema/meta/custom-field-map.json`; write path `src/handlers/client-custom-fields.mjs` |
| `events` — `name = 'survey.submitted'` (`payload->'answers'`, `payload->>'source'`) | The raw, append-only capture of every survey submission — the full answer object exactly as submitted, including typed "Other" free text, plus source (website:home, ClickFunnels). Richer than the typed mirror: keeps every submission (not just the latest per client) and survives failed client resolution. WARNING: the same payload carries name, email, phone at the top level — select only `payload->'answers'` and `payload->>'source'`, never the whole payload. | gold | high | `db/schema/001_init.sql` line 365; writers `api/public/survey-submit.mjs`, `src/adapters/clickfunnels.mjs` |
| `clients` — `custom_fields` (jsonb cf_svy_* keys), `tags`, `outcome_tier`, `channel_source`, `funded`, `funded_amount`, `days_to_fund` | The declared source of truth for survey answers (`client-lifecycle.mjs` merges every submission into `custom_fields`; the typed table is only the mirror). `outcome_tier` + funded columns tie survey language to eventual outcomes — language-vs-conversion analysis. `tags` carries 'survey:complete'. Also holds the `closer_deck_disposition` key (see C). WARNING: the row holds first_name, last_name, email, phone — select only jsonb keys, aggregate. | useful | high | `db/schema/001_init.sql` lines 44–71; merge writer `src/handlers/client-lifecycle.mjs`; reader `src/config/survey-qualification.mjs` |
| `docs/clickfunnels/cf-survey-ground-truth.md` (file, not a table) | Verbatim question titles and option labels for the whole survey — the decoder ring for every cf_svy_* value, and the exact market language applicants respond to. Declared the only survey source of truth. | useful | low | that file; `src/survey/cf-question-map.mjs`; `docs/clickfunnels/OWNER-CF-SETUP-CHECKLIST.md` |

### B. Messages and conversations

| Source | What it holds | Voice | PII risk | Where defined |
|---|---|---|---|---|
| `messages` — `rendered_body`, `subject`, `direction`, `channel`, `sender_kind`, `template_key`, `status`, `blocked_reason`, `is_demo` | The single richest source. `direction='inbound'` + `sender_kind='client'` isolates verbatim client words across SMS, email, portal chat. `template_key` on outbound rows joined to the next inbound reply shows which copy gets responses; `status`/`blocked_reason` show where sends die. Caveats: voice rows store only the Bland call disposition, never a transcript; filter `is_demo=false`; never select `to_address`, `client_id`, `sender_staff_id` alongside body text. | gold | high | `db/schema/001_init.sql` line 256 + migrations 110, 111, 120, 134, 144, 148, 165; writers `src/handlers/comms.mjs` (onMessageInbound, line 219), `api/chat/portal-message.mjs` (line 49) |
| `agent_shadow_log` — `inbound_body`, `would_send_body`, `channel`, `reason`, `agent_code` | Shadow-mode AI log: a second verbatim copy of each inbound client message next to the reply the agent would have sent. Clean, pre-paired inbound language per channel. Do not select `context_snapshot`, `model_request` (client profile jsonb), `client_id`, `conversation_id`. | gold | high | `db/migrations/144_agent_runtime.sql` |
| `customer_insights` — `stage`, `channel`, `answers`, `notes`, `occurred_at` | Mid check-in and post-funding interview answers, typed in as the customer said them. `answers` is jsonb keyed by stable question id (`src/insights/questions.mjs`): mid = hardest_now, working_looks_like, in_the_way, wish_told_sooner; post = life_before, already_tried, almost_stopped, changed_first, tell_someone, do_well_better, felt_funded. `notes` is free text up to 20,000 chars. Marketing reuse is stamped COMPLIANCE REVIEW REQUIRED; consent not yet established. Never select `meeting_url`, `recording_url`, `client_id`, `recorded_by`. | gold | medium | `db/migrations/166_customer_insights.sql`; code `src/insights/store.mjs`, `src/insights/questions.mjs`, `api/customer-insights.mjs` |
| `conversations` — `channel`, `kind`, `last_pulse_at`, `agent_*` columns | One thread per client per channel. Pure journey signal: joining each thread to its newest message's direction gives the "client left hanging" measure the inbox uses. **Finding: `summary` and `sentiment` exist in schema but nothing ever writes them — always NULL, do not build on them.** Exclude `kind='internal'` (staff DMs). | useful | low | `db/schema/001_init.sql` line 276 + migrations 057, 122, 134, 144; writer `src/conversations/store.mjs` |
| `bank_inbox` — `classification`, `subject`, `body_preview` | Inbound bank/lender emails from the Mailgun F-11 router. `body_preview` (500-char, whitespace-flattened) holds the bank's own approval/decline/stipulation language including stated dollar amounts. Lender voice, not client voice — the language banks use when saying yes or no. Classification over time = approvals vs declines per cohort. Never select `raw`; subjects can contain applicant names — treat output as PII-bearing until scrubbed. | useful | medium–high | `db/schema/001_init.sql` line 336; writer `src/handlers/comms.mjs` (onMailResponse); classifier `src/adapters/mailgun.mjs` |
| `opt_outs` — `channel`, `source`, `opted_out_at`, `opted_in_at` | TCPA opt-out audit log — the hardest pure decline signal in the system: people who said stop, by channel and month, and whether they came back. No free text. | useful | low | `db/schema/008_opt_out.sql`; writer `src/handlers/comms.mjs` (STOP/START handling) |
| `brain_messages` — `role`, `text`, `thin` | Company Brain chat turns. `role='user'` rows are verbatim questions — from STAFF, not clients. Internal-confusion signal only; `thin=true` flags knowledge-base gaps. Do not join to `brain_threads.staff_id` in output. | thin | medium | `db/migrations/175_company_brain_threads.sql` |
| `webhook_captures` — `provider`, `raw_body`, `parsed` | Forensic tap of raw inbound webhook bytes (Twilio, ClickFunnels; capture-mode gated). Client words are entangled with raw phone numbers/emails in the same field and cannot be PII-stripped in SQL. Redundant with `messages` and `events` — volume telemetry only. | thin | high | `db/migrations/145_webhook_captures.sql`; writers `src/http/router.mjs` line 238, `src/adapters/clickfunnels.mjs` ~line 397 |
| `mail_responses` (+ journey columns on `mail_universe`) | Response log for the direct-mail program. Almost certainly EMPTY today: `src/mail/` deliberately mails nothing until the FCRA/compliance gate clears (CLAUDE.md §12). Know it exists for later; don't query now. | thin | high | `db/migrations/065_mail_campaigns.sql` line 268; `db/schema/001_init.sql` (mail_universe) |
| `commas_inbox` — `event_type`, `status`, `received_at` | Commas payment webhook landing table. No customer words; `raw_body` is high-PII payment payload — never select. Money-chain tables are the right conversion-timing source. | thin | high | `db/migrations/156_commas_inbox.sql` |

### C. Calls and sales

| Source | What it holds | Voice | PII risk | Where defined |
|---|---|---|---|---|
| `call_outcomes` — `transcript`, `notes`, `belief_failed`, `outcome`, `duration_seconds`, `is_demo` | One row per held sales call. `transcript` = word-for-word Google Meet transcript, auto-stamped every 10 minutes (`src/workflows/meet-transcript-sweeper.mjs` → stampCallTranscript in `src/sales/recordings.mjs`) — verbatim prospect speech and objections. `belief_failed` = seven-belief diagnosis (pain/doubt/cost/desire/money/support/trust; each label maps to a customer phrase, e.g. money = "can't afford it", support = "need to ask my spouse", per `src/sales/beliefs.mjs`). `outcome` = deposit / downsell / callback / no_show / not_a_fit. `notes` = closer free text + embedded JSON (trailing `checklist:{...}` and a closer_deck object whose `cost_of_inaction` is the prospect's stated stakes, 80 chars). Parse notes as text + embedded JSON. Filter `is_demo=false`; never join clients columns. | gold | high | `db/migrations/147_call_outcomes.sql`, 170, 259 + 268 (transcript), 148 (is_demo); writers `src/sales/call-outcomes.mjs`, `src/sales/closer-deck.mjs`, `src/sales/recordings.mjs` |
| `clients.custom_fields->'closer_deck_disposition'` | Per-client closer-deck snapshot (route, offer_key, amount_cents, temperature, beliefs_count, cost_of_inaction, at). `cost_of_inaction` = the prospect's stated cost of doing nothing. `temperature`/`beliefs_count` = deal heat; route/offer_key = which offer path. Duplicated into `call_outcomes.notes`. | useful | medium | `src/sales/closer-deck.mjs` (logDeckDisposition, ~line 800); `db/schema/005_client_custom_fields.sql` |
| `marketing_flags` — `belief`, `lead_source`, `setter_label`, `outcome_count`, `note`, `period_start/end` | Objection patterns a sales manager flagged for marketing routing ("N calls failed on the money belief from this lead source this period") plus a free-text note. The human-curated bridge between call objections and ad strategy. Store-only by design. | useful | low | `db/migrations/147_call_outcomes.sql` line 76; writer createMarketingFlag in `src/sales/call-outcomes.mjs` |
| `bookings` — `source`, `status`, `event_type_slug`, `starts_at`, `created_at` | One row per scheduled call, backfilled from booking.created events. `status` walks booked → rescheduled → cancelled → noshow → completed (show-rate funnel); `source` is the TRUE origin (clickfunnels/gauntlet/sim — migration 225 repaired the hardcoded 'calcom' lie). Never select `attendee_name`, `attendee_email`, `raw`. | useful | high | `db/migrations/225_bookings.sql` (+ 203 RLS); writer `src/bookings/store.mjs` |
| `sales` — `status`, `product_id`, `agreed_price`, `sold_at`, `notes`, `is_demo` | The agreement: who bought what at what price. `status` refunded = buyer's-remorse signal. `notes` occasionally carries why-they-bought context but nothing enforces it. | thin | medium | `db/migrations/011_sales.sql` (+148); writers `src/handlers/money-chain.mjs`, `src/slo/purchase.mjs` |
| `sale_payments` — `kind`, `amount`, `paid_at`, `notes` | Money in per sale. deposit-but-never-installment = stall point. `notes` hand-typed for wires/checks, rarely customer language. | thin | medium | `db/migrations/011_sales.sql` |
| `call_compliance_flags` — `kind`, `phrase`, `detail` | Verbatim flagged phrases from call recordings. **CURRENTLY EMPTY BY DESIGN — no code writes it yet.** Would become call-phrase voice once the flagging pipeline ships. | thin | medium | `db/migrations/147_call_outcomes.sql` |
| `tasks` (closer bookings, title LIKE 'Strategy session%') | The closer's to-do per booked call; joined against `call_outcomes` absence yields "calls held but never logged" (listUnloggedCalls). No customer language. | thin | low | writer `src/handlers/comms.mjs`; reader `src/sales/call-outcomes.mjs` |
| `outbound_calls` — `kind`, `status` | One row per AI (Bland) phone call placed. Status-only; no words stored. | thin | low | `db/schema/010_outbound_calls.sql`; writer `src/lib/outbound-calls.mjs` |

### D. Journey events and pipelines

| Source | What it holds | Voice | PII risk | Where defined |
|---|---|---|---|---|
| `events` — voice-bearing payloads (`survey.submitted` answers; `message.inbound` `payload->>'body'`; `mail.response` bodyPreview) | Every adapter writes here first. `message.inbound` deliberately carries the WHOLE inbound email/SMS body ("a person's own words written to us" — mailgun.mjs). Payloads also carry email/name/phone keys — never select whole payloads. | gold | high | `db/schema/001_init.sql` line 365; writers `src/adapters/clickfunnels.mjs` (~line 428), `src/adapters/mailgun.mjs` (~lines 915, 1006) |
| `events` — journey spine (canonical names + `payload->>'outcomeTier'`, `payload->>'outcome'`) | The canonical funnel (`src/events/canonical.mjs`): entry.captured → survey.submitted → diagnostic.paid → analysis.completed → booking.* → call.completed → decision.rendered → deposit.paid → sale.closed → round.started/submitted/approved/funded, plus payment.failed/expired/canceled (abandoned checkouts) and repair.stalled. Distinct clients per stage per week = the funnel. entry.captured with no survey.submitted = the drop-off driving the S-02 nudge (20-min window, `src/workflows/s-02-incomplete-survey-nudge.mjs`); the ladder is also the cold/warm/hot classifier (`src/config/lead-temperature.mjs`). **KNOWN GAP: there is NO round.declined event — lender declines emit nothing (lendflow 'DECLINE GAP'); read declines from `applications`/`funding_rounds`.** | gold (signal) | low (aggregates) / high (payloads) | `db/schema/001_init.sql` line 365; vocabulary `src/events/canonical.mjs`; emitters `src/sales/call-outcomes.mjs`, `src/handlers/comms.mjs` |
| `contract_signers` — `status`, `decline_reason`, `declined_at`, `viewed_at`, `view_count` | E-sign signer rows. `decline_reason` is words the SIGNER typed — code rejects a decline without one and a CHECK constraint forces it non-blank. Viewed-but-never-signed = signing stall. Never select `name`, `email`, `signer_name`, `signer_ip`, `field_values`. | gold | high | `db/migrations/125_contract_esign.sql` line 233; writer `src/contracts/signers.mjs` (line 216) |
| `funding_rounds` — `round_number`, `status`, `product`, `hold_reason`, `conditions`, submitted/approved/funded amounts | Round lifecycle. `hold_reason` free text for stuck rounds (mirror values like 'New Inquiries'); `conditions` = lender stipulations; submitted vs approved vs funded shows shrinkage through the funnel. | useful | low | `db/schema/001_init.sql` line 119 |
| `applications` — `bank`, `status`, `conditions`, `approved_amount` | Per-lender rows within a round — where declines actually live (lendflow maps declined/denied/rejected/no_offers/not_qualified/ineligible to a stage move only). `conditions` carries stipulation language. | useful | low | `db/schema/001_init.sql` line 137; decline vocabulary `src/adapters/lendflow.mjs` line 158 |
| `inquiry_log` — `bureau`, `inquiry`, `status`, `outcome`, `call_state`, `last_failure_reason`, `call_outcome_summary` | One row per credit inquiry worked for removal. `inquiry` = furnisher name (a map of which lenders pull on this population); status/outcome deliberately unconstrained desk vocabulary; 140 added the phone-work state machine showing exactly where bureau calls stall. | useful | medium | `db/schema/001_init.sql` line 174 + migrations 055, 140 |
| `inquiry_attempts` — `kind`, `outcome`, `note` | Append-only log of each removal attempt with staffer-typed outcome and note. Staff voice about bureau interactions, not client voice. | useful | medium | `db/migrations/055_inquiry_work.sql` line 41; writer `src/inquiries/work.mjs` |
| `inquiry_removal_cases` — `case_status`, `remover_notes`, `master_call_state`, `hold_duration_display`, cycle times | AI removal cases: where cases sit, how long callers hold, remover's free-text narrative, cycle time (requested → closed). | useful | medium | `db/migrations/140_inquiry_ops.sql` line 101; adapter `src/adapters/inquiry-removal.mjs` |
| `crs_results` — `outcome_tier`, `created_at` | One row per credit-pull run; the 6-tier decision distribution (qualify vs repair-route) is a core convert/decline signal. **The `result` jsonb is a full credit report — extreme PII, never select it.** | thin (aggregates only) | high | `db/schema/001_init.sql` line 313; writer `src/finance/crs-pull.mjs` |
| `cards` + `pipeline_stages` + `pipelines` | Current position in each pipeline (sales, funding_card_stacking, funding_altfin, optimization, inquiry_removal, ar_collections, affiliates_white_label); `entered_at` gives dwell time = "where are people stalled right now." No history table — past transitions come from `events`. | useful | low | `db/schema/001_init.sql` lines 185–220 |
| `failed_events` — `event_name`, `handler_name`, `error_message`, `attempts` | Dead-letter queue: a stalled client may be stalled because the automation died. Aggregate on names only — `payload` copies the source event. | thin | medium | `db/migrations/039_failed_events.sql` |

### E. Partner and affiliate (the Brandon-side avatar)

| Source | What it holds | Voice | PII risk | Where defined |
|---|---|---|---|---|
| `partners` — `notes`, `status`, `agreement_signed_at` | The only surviving partner-applicant voice. `notes` is a three-line blob (`phone=`, `audience=` free text capped 400 chars, `sms_consent=`); the audience line is the typed answer to "tell us how you'd partner / about your audience" (form field p-aud on `public/affiliates/index.html`). Lifecycle: invited/active/paused + agreement gate. WARNING: the phone number sits in the same column — regexp out the audience line only. | gold | medium | `db/migrations/042_partners.sql`; writer `api/public/partner-apply.mjs` |
| `affiliates` — lifecycle columns (`status`, `tier_level`, `activated_at`, `tier2_unlocked_at`, `recruited_by`, `partner_license_signed_at`, `payout_status`) | Affiliate journey: created → activated → license signed → tier2 unlocked, plus downline edges. **NO VOICE COLUMN EXISTS. Finding: partner-apply REQUIRES the audience free text for affiliate applicants, then discards it — every affiliate's answer about their audience is validated and thrown away. The affiliate-track avatar language exists nowhere in this database.** | useful | low | `db/schema/001_init.sql`; `db/migrations/033_affiliates.sql`; writer `api/public/partner-apply.mjs` |
| `affiliate_referrals` — `status`, `void_reason`, `source`, `attributed_at`, `converted_at`, `tier` | Attribution-to-payment funnel: attributed → converted → paid → void. Rows stuck at 'attributed' = the stall population. `void_reason` is required free text on void — a small real vein of decline language. | useful | low | `db/migrations/033_affiliates.sql` |
| `affiliate_link_clicks` — `tracking_id_used`, `affiliate_id`, `occurred_at`, `source` | Top-of-funnel: one row per referral-link visit (live from `public/start.html`). `affiliate_id` NULL = dead link. Privacy by construction (hashes only). Click → lead → funded funnel per affiliate. | useful | low | `db/migrations/235_affiliate_link_clicks.sql`; writer `api/public/affiliate-click.mjs` |
| `cards` (pipeline `affiliates_white_label`) | White-label lifecycle board: recruiting → invited → agreement_signed → active → paused; `entered_at` is honest time-in-stage (trigger from 271) — where partners stall and for how long. | useful | low | migrations 115, 265, 271; writer `api/public/partner-apply.mjs` |
| `accounts` — `kind`, `status`, `created_at`, `last_login_at` | Post-application drop-off, both tracks: a login is created at apply, so `last_login_at IS NULL` = wanted in, got a password, never came back — the sharpest Brandon-side stall signal. Never select email/name/password_hash. | useful | high | `db/migrations/044_accounts.sql`; writer via `src/auth/account-session.mjs` from partner-apply |
| `partner_brand` — `voice`, `approval_status` | `voice` is partner-authored brand-tone free text when populated (often empty — apply seeds only entity_name/support_email). `approval_status` stuck at 'draft' = setup stall. Do not select entity/address/email/domain columns. | thin | medium | `db/migrations/043_partner_brand.sql` |
| `partner_pages` — `status`, `funnel_key`, `published_at`, `body_json` | Partner funnel pages. Mostly stock template copy, not voice. Publication status = mild setup-completion signal. | thin | low | `db/migrations/135_partner_pages.sql` |
| `affiliate_events` — `kind`, `detail` | Designed as an affiliate history log. **Finding: no production writer exists (only a DELETE in demo seed) — empty outside demo data. Worthless today.** | thin | low | `db/schema/001_init.sql` |

---

## 3. Harvest Queries

Read-only, PII-safe as written. Run them exactly — the point of each query's shape is what it does NOT select.

### Survey desires, ranked by volume

```sql
SELECT unnest(cf_svy_money_change_now) AS desire, count(*) AS n
FROM client_custom_fields
WHERE cf_svy_money_change_now IS NOT NULL
GROUP BY 1 ORDER BY n DESC;

-- free text / picklist for planned use:
SELECT cf_svy_planned_use, count(*) AS n
FROM client_custom_fields
WHERE cf_svy_planned_use IS NOT NULL
GROUP BY 1 ORDER BY n DESC;
```

### Survey sizing and gate bands

```sql
SELECT cf_svy_funding_target_amount, cf_svy_has_business, cf_svy_available_capital,
       cf_svy_self_reported_fico, cf_svy_has_negatives, count(*) AS n
FROM client_custom_fields
WHERE cf_svy_funding_target_amount IS NOT NULL
GROUP BY 1,2,3,4,5 ORDER BY n DESC;
```

### Legacy CRM motivation columns — count before trusting

```sql
SELECT cf_svy_your_why, cf_svy_what_matters_most, count(*) AS n
FROM client_custom_fields
WHERE cf_svy_your_why IS NOT NULL OR cf_svy_what_matters_most IS NOT NULL
GROUP BY 1,2 ORDER BY n DESC;

-- legacy free-text fields (the CRM port only; check population):
SELECT cf_svy_planned_use, cf_svy_money_change_now, cf_svy_your_why, cf_svy_what_matters_most,
       cf_svy_funding_target_amount, cf_svy_self_reported_fico,
       pre_call_question, funding_planned_use, repair_why
FROM client_custom_fields
WHERE COALESCE(cf_svy_planned_use, pre_call_question, funding_planned_use, repair_why) IS NOT NULL;
```

### Raw survey submissions (answers only — never the whole payload)

```sql
SELECT payload->'answers'->>'cf_svy_planned_use' AS planned_use,
       payload->'answers'->'cf_svy_money_change_now' AS desires,
       payload->>'source' AS source, created_at::date AS day
FROM events
WHERE name = 'survey.submitted' AND payload ? 'answers'
ORDER BY created_at DESC LIMIT 500;
```

### Survey language vs eventual outcome

```sql
SELECT custom_fields->>'cf_svy_planned_use' AS planned_use,
       custom_fields->>'cf_svy_funding_target_amount' AS target,
       outcome_tier, count(*) AS n
FROM clients
WHERE custom_fields ? 'cf_svy_planned_use'
GROUP BY 1,2,3 ORDER BY n DESC;

-- completion rate:
SELECT count(*) FILTER (WHERE 'survey:complete' = ANY(tags)) AS completed, count(*) AS total
FROM clients;
```

### Inbound client words (the motherlode)

```sql
SELECT m.channel, m.created_at::date AS day, m.rendered_body AS client_words
FROM messages m
WHERE m.direction = 'inbound' AND m.sender_kind = 'client'
  AND m.channel IN ('sms','email') AND m.is_demo = false
  AND length(coalesce(m.rendered_body,'')) > 20
ORDER BY m.created_at DESC LIMIT 500;
-- length filter drops STOP/START keywords; no client_id/to_address selected.
-- Free text can still embed a phone or name; regex-scrub downstream before any reuse.
```

### Shadow-agent inbound copy

```sql
SELECT channel, agent_code, created_at::date AS day, inbound_body
FROM agent_shadow_log
WHERE inbound_body IS NOT NULL AND length(inbound_body) > 20
ORDER BY created_at DESC LIMIT 500;
```

### Customer interview answers

```sql
SELECT i.stage, i.channel, a.key AS question_id, a.value AS answer
FROM customer_insights i, jsonb_each_text(i.answers) a
WHERE btrim(a.value) <> ''
ORDER BY i.occurred_at DESC LIMIT 500;

-- free-text notes:
SELECT stage, notes FROM customer_insights WHERE notes IS NOT NULL;
-- answers may name people/businesses inside the text; do not join clients
```

### Threads waiting on us (client left hanging)

```sql
SELECT c.channel, date_trunc('week', COALESCE(c.last_pulse_at, c.created_at)) AS wk,
       count(*) FILTER (WHERE last.direction = 'inbound') AS threads_waiting_on_us,
       count(*) AS threads_active
FROM conversations c
JOIN LATERAL (SELECT m.direction FROM messages m
              WHERE m.conversation_id = c.id
              ORDER BY m.created_at DESC LIMIT 1) last ON true
WHERE c.kind = 'client'
GROUP BY 1, 2 ORDER BY 2 DESC;
```

### Call outcomes: transcripts, objections, closer notes

```sql
SELECT outcome, belief_failed, duration_seconds, transcript, notes
FROM call_outcomes
WHERE is_demo = false
  AND (transcript IS NOT NULL AND btrim(transcript) <> ''
       OR notes IS NOT NULL AND btrim(notes) <> '')
ORDER BY logged_at DESC LIMIT 200;
-- transcripts are verbatim speech: names/financial details may appear inside
-- the text itself; never join clients columns
```

### Cost-of-inaction and deal heat per client

```sql
SELECT custom_fields#>>'{closer_deck_disposition,offer_key}' AS offer_key,
       custom_fields#>>'{closer_deck_disposition,route}' AS route,
       (custom_fields#>>'{closer_deck_disposition,temperature}')::int AS temperature,
       custom_fields#>>'{closer_deck_disposition,cost_of_inaction}' AS cost_of_inaction
FROM clients
WHERE custom_fields ? 'closer_deck_disposition' LIMIT 500;
```

### Manager-flagged objection patterns

```sql
SELECT belief, lead_source, setter_label, outcome_count,
       period_start::date, period_end::date, note
FROM marketing_flags WHERE is_demo = false
ORDER BY created_at DESC LIMIT 200;
```

### Show-rate funnel by booking source

```sql
SELECT source, event_type_slug, status, date_trunc('week', created_at) AS wk, count(*)
FROM bookings
GROUP BY 1,2,3,4 ORDER BY wk DESC, count(*) DESC;
-- aggregate only; attendee_name/attendee_email/raw stay unselected
```

### The journey funnel, stage by stage

```sql
SELECT name, date_trunc('week', created_at) AS wk, count(*) AS n,
       count(DISTINCT client_id) AS clients
FROM events
WHERE name IN ('entry.captured','survey.submitted','diagnostic.paid','booking.created',
               'booking.cancelled','booking.noshow','call.completed','decision.rendered',
               'deposit.paid','sale.closed','round.started','round.submitted',
               'round.approved','round.funded','payment.failed','payment.expired',
               'payment.canceled')
GROUP BY 1,2 ORDER BY 2 DESC, 3 DESC;

-- started the funnel, never finished the survey:
SELECT count(*) AS started_never_finished FROM (
  SELECT client_id FROM events WHERE name='entry.captured' AND client_id IS NOT NULL
  EXCEPT
  SELECT client_id FROM events WHERE name='survey.submitted') t;
```

### Inbound message bodies from the event log

```sql
SELECT name, created_at,
       CASE WHEN name='survey.submitted' THEN payload->'answers'
            ELSE to_jsonb(payload->>'body') END AS words
FROM events
WHERE (name='survey.submitted' AND payload->'answers' IS NOT NULL)
   OR (name='message.inbound' AND payload->>'body' IS NOT NULL)
ORDER BY created_at DESC LIMIT 500;
```

### Why signers decline the contract

```sql
SELECT decline_reason, declined_at::date AS d, view_count
FROM contract_signers
WHERE status='declined' AND decline_reason IS NOT NULL
ORDER BY declined_at DESC LIMIT 200;
```

### Where funding rounds stall and shrink

```sql
SELECT status, hold_reason, count(*) AS rounds,
       round(avg(submitted_amount)) AS avg_submitted,
       round(avg(funded_amount)) AS avg_funded
FROM funding_rounds GROUP BY 1,2 ORDER BY rounds DESC;

-- per-lender outcomes (declines live here, not in events):
SELECT bank, status, count(*) AS n, round(avg(approved_amount)) AS avg_approved
FROM applications GROUP BY 1,2 ORDER BY n DESC LIMIT 100;
```

### Lender voice (bank emails)

```sql
SELECT classification, created_at::date AS day, count(*) AS emails
FROM bank_inbox GROUP BY 1, 2 ORDER BY 2 DESC;

-- language pass (scrub names downstream):
SELECT classification, body_preview FROM bank_inbox
WHERE body_preview IS NOT NULL ORDER BY created_at DESC LIMIT 200;
```

### Inquiry-removal desk

```sql
SELECT bureau, inquiry, status, outcome, call_state, last_failure_reason, call_outcome_summary
FROM inquiry_log
WHERE outcome IS NOT NULL OR last_failure_reason IS NOT NULL
ORDER BY updated_at DESC LIMIT 500;

SELECT kind, outcome, note, created_at::date AS d
FROM inquiry_attempts
WHERE note IS NOT NULL OR outcome IS NOT NULL
ORDER BY created_at DESC LIMIT 500;

SELECT case_status, master_call_state, remover_notes, open_inquiry_count,
       (closed_at - requested_at) AS cycle
FROM inquiry_removal_cases
WHERE remover_notes IS NOT NULL
ORDER BY requested_at DESC LIMIT 300;
```

### Qualification-tier distribution

```sql
SELECT outcome_tier, date_trunc('month', created_at) AS mo, count(*) AS n
FROM crs_results GROUP BY 1,2 ORDER BY 2 DESC, 3 DESC;
```

### Where people sit right now (all pipelines)

```sql
SELECT p.key AS pipeline, s.name AS stage, count(*) AS cards_now,
       round(avg(extract(epoch FROM now()-c.entered_at))/86400,1) AS avg_days_in_stage
FROM cards c
JOIN pipeline_stages s ON s.id=c.stage_id
JOIN pipelines p ON p.id=c.pipeline_id
GROUP BY 1,2,s.sort_order ORDER BY 1, s.sort_order;
```

### Opt-outs (the hardest no)

```sql
SELECT channel, source, date_trunc('month', opted_out_at) AS mo,
       count(*) AS opt_outs, count(opted_in_at) AS came_back
FROM opt_outs GROUP BY 1, 2, 3 ORDER BY 3 DESC;
```

### Partner voice (the audience line only)

```sql
SELECT p.status, (p.agreement_signed_at IS NOT NULL) AS agreement_signed,
       p.created_at::date AS applied_on,
       (regexp_match(p.notes, 'audience=([^\n]+)'))[1] AS audience_text
FROM partners p
WHERE p.notes LIKE '%audience=%'
ORDER BY p.created_at DESC;
```

### Affiliate lifecycle and referral funnel

```sql
SELECT status, tier_level, count(*) AS n, count(activated_at) AS activated,
       count(partner_license_signed_at) AS license_signed,
       count(tier2_unlocked_at) AS tier2_unlocked,
       count(recruited_by) AS recruited_by_downline
FROM affiliates GROUP BY status, tier_level ORDER BY 1, 2;

SELECT status, source, source_event, count(*) AS n,
       avg(converted_at - attributed_at) AS avg_time_to_convert,
       string_agg(DISTINCT void_reason, ' | ') FILTER (WHERE void_reason IS NOT NULL) AS void_reasons
FROM affiliate_referrals
GROUP BY status, source, source_event ORDER BY n DESC;

SELECT date_trunc('week', occurred_at) AS wk, COALESCE(source, 'unknown') AS source,
       count(*) AS clicks, count(*) FILTER (WHERE affiliate_id IS NULL) AS dead_code_clicks
FROM affiliate_link_clicks GROUP BY 1, 2 ORDER BY 1 DESC, 3 DESC;
```

### Partner board and ghosted applicants

```sql
SELECT ps.name AS stage, count(*) AS partners_in_stage,
       avg(now() - c.entered_at) AS avg_time_in_stage
FROM cards c
JOIN pipelines pl ON pl.id = c.pipeline_id AND pl.key = 'affiliates_white_label'
JOIN pipeline_stages ps ON ps.id = c.stage_id
WHERE c.partner_id IS NOT NULL
GROUP BY ps.name, ps.sort_order ORDER BY ps.sort_order;

SELECT kind, status, count(*) AS n, count(last_login_at) AS ever_logged_in,
       count(*) FILTER (WHERE last_login_at IS NULL AND created_at < now() - interval '7 days') AS ghosted_after_7d
FROM accounts WHERE kind IN ('affiliate', 'partner') GROUP BY kind, status;
```

### Partner brand voice (usually empty)

```sql
SELECT approval_status, count(*) AS n,
       count(NULLIF(btrim(COALESCE(voice, '')), '')) AS has_voice_text,
       string_agg(DISTINCT NULLIF(btrim(voice), ''), ' || ') AS voice_samples
FROM partner_brand GROUP BY approval_status;
```

### Health checks on the thin/empty tables

```sql
SELECT kind, count(*) AS n, min(created_at) AS first_seen, max(created_at) AS last_seen
FROM affiliate_events GROUP BY kind;               -- expected: empty outside demo

SELECT kind, phrase, count(*) FROM call_compliance_flags GROUP BY 1,2 ORDER BY 3 DESC;  -- expected: empty

SELECT channel, outcome_tier, date_trunc('week', response_at) AS wk, count(*)
FROM mail_responses GROUP BY 1,2,3 ORDER BY 3 DESC;  -- expected: empty (mail is gated)

SELECT event_name, handler_name, status, count(*) AS rows, sum(attempts) AS total_attempts
FROM failed_events GROUP BY 1,2,3 ORDER BY rows DESC LIMIT 100;

SELECT provider, created_at::date AS d, count(*) AS captures
FROM webhook_captures GROUP BY 1,2 ORDER BY 2 DESC;  -- volume telemetry only; never mine raw_body
```

---

## 4. Rules

1. **Read-only, always.** SELECT only. No writes, no temp tables on production.
2. **Run as the unprivileged role** (`fundhub_app`), never as a superuser or owner — superuser bypasses row-level security and turns isolation guarantees into false greens.
3. **Never export raw emails, phones, SSNs, or full names.** The queries above are shaped to avoid PII columns — do not "improve" them by adding columns. Never `SELECT *` on `clients`, `client_custom_fields` (it holds SSN/EIN columns), `accounts`, `bookings`, `bank_inbox.raw`, `crs_results.result`, `webhook_captures.raw_body`, or any events payload wholesale.
4. **Free text goes through a scrub before it lands in any research doc.** Verbatim bodies, transcripts, notes, and decline reasons can embed names, phone numbers, and financial details inside the text itself. Regex-scrub (names, phones, emails, dollar-amount + name pairs) downstream before quoting anything.
5. **Filter `is_demo = false`** wherever the column exists (`messages`, `call_outcomes`, `sales`, `marketing_flags`) — demo seed writes fake threads and calls.
6. **Output is research calibration, never publishable testimonial material.** `customer_insights` in particular is stamped COMPLIANCE REVIEW REQUIRED for marketing reuse, and consent for reuse is not established. Nothing harvested here goes into an ad, VSL, or landing page without explicit consent and human approval.
7. **Check row counts before building on legacy columns.** The CRM-era fields (`cf_svy_your_why`, `cf_svy_what_matters_most`, `pre_call_question`, `funding_planned_use`, `repair_why`) have no current writer; population is unknown.
8. **Known dead ends — do not build on:** `conversations.summary` / `conversations.sentiment` (never written), `call_compliance_flags` (no writer yet), `affiliate_events` (no production writer), `mail_responses` (mail program is gated, table empty), any `round.declined` event (does not exist — use `applications`).

---

## 5. Where To Run It

**Not from a hosted agent session.** This environment's network policy blocks `api.netlify.com` and `api.supabase.com` at the proxy (403 at CONNECT), so a hosted session cannot fetch `DATABASE_URL` or reach the production database. A 403 there is an org policy denial — do not retry or route around it.

Run the harvest from a machine that already has database access:

- **Chris's laptop**, or any session with local env access, where `.env` exists or `DATABASE_URL` can be fetched via `netlify env:get DATABASE_URL --context production`.
- Connect as **`fundhub_app`** (the unprivileged role from `db/migrations/104_app_role.sql`), not as the database owner.
- Pipe query output to files under a gitignored path — harvested text is PII-bearing until scrubbed and must never be committed.