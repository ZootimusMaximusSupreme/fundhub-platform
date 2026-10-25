# Wireframe Field Corrections — what changed and why

Every change maps a displayed field to the real system (db/schema/001_init.sql,
020_auth.sql, db/seed/002_pipelines.sql, src/workflows/, fundhub-docs sources,
inquiry-removal-ai case tables). Layouts untouched.

## Changed
- **affiliate.html** — removed the invented flat "12%" commission everywhere.
  Now: commission accrues on qualified paid outcomes at the rate in the partner
  agreement (AGREEMENT_RATE constant, marked configurable). Added the real tier
  rule (Tier 2 unlocks on first funded referral OR first recruited affiliate,
  downline override) and first-touch immutable attribution. Basis rows already
  used real products (Business Financial Assessment $32, Consulting Services
  Deposit $3,000).
- **pipeline.html** — rail names now the seven seeded pipelines verbatim:
  Sales / Funding: Card Stacking / Funding: Alt-Fin (Lendflow) / Optimization
  (Repair) Rounds / Inquiry Removal / AR / Collections / Affiliates + White Label / Hiring.
  "Survey Completed" → "Survey Complete" (seed spelling).
- **automations.html** — every row now carries its real workflow id
  (s-01, c-00, s-02, s-06, f-03, f-04, f-08, ds-01, u-04, c-03, dpc-05, af-02)
  and real product names. "48 hours idle" corrected to the actual 72-hour
  no-progress rule (dpc-05). AR row restated as the real Balance Due > 0 rule.
- **staff-teams.html** — role labels now the schema's role keys:
  Inquiry Remover → Inquiry Specialist (24 places). Owner / Admin / Closer /
  Funding Advisor / Setter confirmed present.
- **messaging.html** — "Est. value" → "Prequal estimate"
  (cf_reanalyzer_prequal_amount / total_funding_estimate). Temperature =
  conversations.sentiment (Hot|Warm|Cold) — already real.
- **client-control-panel.html** — "Credit Source" → "Primary Snapshot Source"
  (the real Analyzer→CRS promotion concept; CRS overrides Analyzer after u-04).
- **client-portal.html** — added the missing fifth deliverable, Metro 2 Dispute
  Letter Pack, beside Credit Analysis Report / Credit Optimization Roadmap /
  Funding Snapshot / Bank and Lender Match List.
- **NEW partner-galaxy.html** — the white-label partner's own Galaxy. Scoped to
  their book; staff identities replaced with anonymous team nodes; permanent
  scope banner. shell.js: role `partner` lands here; employees still get no
  Galaxy (owner/admin only, unchanged).

## Already real (left alone)
Closer Dashboard calculator tables (match the Deal Funding / Deal Math build
spec, 22/22 tests passing on the math core) · inquiry-remover table = the
inquiry_log columns (bureau, inquiry, call_attempts, status) with full bureau
names · galaxy.html team = the actual org · products P-01–P-05 = the real
ladder rows · Setter Josh's prompt + guardrails in agent-editor = the live
Bland agent · documents.html = documents registry fields · sample-data tier
gates.

## Flagged — confirm when convenient
1. **Affiliate rate placeholder** is 0.12 in demo math, labeled as
   agreement-configurable. Real schedule is AF-04 — still your open decision.
2. **command-center "Cost / Funded Client"** needs ad-spend data (CAPI /
   migration 038, not yet merged). Field kept, marked derived-from-spend.
3. **Credit Optimization Bundle** shows $1,500–$2,500 variable — matches the
   products table; confirm band.
4. **Upper offer ladder** (education programs, B2B install workshop) is not in
   The CRM products screen — those sell through Commas/education rails, not
   client fulfillment. Add if you want them visible here.
