// Test helper for the trip lane SQL tests (coverage batch W8, 2026-10-10). Not a lane, not a test.
//
// It runs one SELECT against Postgres with every table the SELECT reads replaced by a small made-up
// one (WITH payment_links AS (...)). No real row is read or written, so it is safe on any database.
// Each made-up table first selects its columns FROM the real table WHERE false, so a column that is
// not on the real schema fails the test, and the column types are the real ones. It runs inside
// BEGIN READ ONLY and always rolls back (money-test-kit.runShadowSql). The tests that use it skip,
// and say so, when DATABASE_URL is not set.

import { HAS_DB, closeShadowDb, lit, runShadowSql } from "./money-test-kit.mjs";

export { HAS_DB, closeShadowDb };
export const ORG = "11111111-1111-4111-8111-111111111111";
export const OTHER_ORG = "22222222-2222-4222-8222-222222222222";

let n = 0;
/** A fresh uuid (counter based, so test output is stable). The argument is only a label for the reader. */
export function uid(_label = "") {
  n += 1;
  const hex = n.toString(16).padStart(12, "0");
  return `00000000-0000-4000-8000-${hex}`;
}

/** One cell. A JS array is a Postgres array (ARRAY[...]::type); everything else goes through lit(). */
function cell(value, type) {
  if (Array.isArray(value)) {
    if (!value.length) return `'{}'::${type}`;
    return `ARRAY[${value.map((x) => lit(x)).join(", ")}]::${type}`;
  }
  return `${lit(value)}::${type}`;
}

/**
 * One made-up table. cols is [[name, sqlType], ...]. rows is a list of objects.
 * The first branch pins the names to the real table; the second carries the made-up rows.
 */
export function checkedShadow(name, cols, rows) {
  const names = cols.map(([c]) => c);
  const head = `SELECT ${names.join(", ")} FROM public.${name} WHERE false`;
  if (!rows.length) return `${name} AS (${head})`;
  const values = rows
    .map((r) => `(${cols.map(([c, ty]) => cell(r[c], ty)).join(", ")})`)
    .join(", ");
  return `${name} AS (${head} UNION ALL SELECT * FROM (VALUES ${values}) AS v(${names.join(", ")}))`;
}

/** Run `sql` with the given shadows. `world` is { tableName: { cols, rows } }. */
export async function runWorld(sql, world, params) {
  const shadows = Object.entries(world).map(([name, t]) => checkedShadow(name, t.cols, t.rows));
  return runShadowSql(`WITH ${shadows.join(",\n")}\n${sql}`, params);
}

/** The column lists the trip lanes read, by table. Every SELECT in a trip lane must fit these. */
export const COLS = Object.freeze({
  clients: [
    ["id", "uuid"], ["org_id", "uuid"], ["client_code", "text"], ["email", "text"],
    ["is_demo", "boolean"], ["custom_fields", "jsonb"], ["tags", "text[]"], ["created_at", "timestamptz"],
    ["updated_at", "timestamptz"], ["partner_id", "uuid"]
  ],
  payment_links: [
    ["org_id", "uuid"], ["client_id", "uuid"], ["purpose", "text"], ["status", "text"], ["link_ref", "text"],
    ["paid_at", "timestamptz"], ["updated_at", "timestamptz"], ["identity_stored_at", "timestamptz"], ["is_demo", "boolean"]
  ],
  events: [
    ["org_id", "uuid"], ["client_id", "uuid"], ["name", "text"], ["created_at", "timestamptz"],
    ["is_demo", "boolean"], ["idempotency_key", "text"], ["payload", "jsonb"]
  ],
  sales: [
    ["id", "uuid"], ["org_id", "uuid"], ["client_id", "uuid"], ["product_id", "uuid"], ["status", "text"],
    ["sold_at", "timestamptz"], ["is_demo", "boolean"], ["agreed_success_fee_percent", "numeric"]
  ],
  products: [["id", "uuid"], ["org_id", "uuid"], ["code", "text"], ["category", "text"]],
  cards: [
    ["org_id", "uuid"], ["client_id", "uuid"], ["pipeline_id", "uuid"], ["stage_id", "uuid"],
    ["entered_at", "timestamptz"], ["updated_at", "timestamptz"], ["is_demo", "boolean"], ["partner_id", "uuid"]
  ],
  pipelines: [["id", "uuid"], ["org_id", "uuid"], ["key", "text"]],
  pipeline_stages: [["id", "uuid"], ["pipeline_id", "uuid"], ["key", "text"]],
  bookings: [["org_id", "uuid"], ["client_id", "uuid"], ["status", "text"], ["created_at", "timestamptz"]],
  call_outcomes: [
    ["org_id", "uuid"], ["client_id", "uuid"], ["outcome", "text"], ["logged_at", "timestamptz"], ["is_demo", "boolean"]
  ],
  funding_rounds: [
    ["id", "uuid"], ["org_id", "uuid"], ["client_id", "uuid"], ["round_number", "integer"], ["status", "text"],
    ["product", "text"], ["funded_amount", "numeric"], ["created_at", "timestamptz"], ["updated_at", "timestamptz"], ["is_demo", "boolean"]
  ],
  funding_closeout: [["funding_round_id", "uuid"], ["org_id", "uuid"]],
  invoices: [
    ["org_id", "uuid"], ["funding_round_id", "uuid"], ["source", "text"], ["invoice_type", "text"], ["status", "text"]
  ],
  funding_round_sales: [["org_id", "uuid"], ["funding_round_id", "uuid"], ["sale_id", "uuid"]],
  sale_attributions: [["org_id", "uuid"], ["sale_id", "uuid"], ["basis", "text"]],
  commission_ledger: [
    ["org_id", "uuid"], ["funding_round_id", "uuid"], ["basis", "text"], ["reverses_ledger_id", "uuid"], ["status", "text"]
  ],
  repair_programs: [["org_id", "uuid"], ["client_id", "uuid"], ["created_at", "timestamptz"], ["status", "text"]],
  pii_identity: [
    ["org_id", "uuid"], ["client_id", "uuid"], ["verified_legal_name", "text"], ["verified_at", "timestamptz"]
  ],
  crs_results: [
    ["org_id", "uuid"], ["client_id", "uuid"], ["created_at", "timestamptz"], ["is_demo", "boolean"],
    ["outcome_tier", "text"], ["result", "jsonb"]
  ],
  client_consents: [
    ["org_id", "uuid"], ["client_id", "uuid"], ["kind", "text"], ["granted_at", "timestamptz"],
    ["expires_at", "timestamptz"], ["revoked_at", "timestamptz"]
  ],
  contracts: [
    ["org_id", "uuid"], ["client_id", "uuid"], ["template_key", "text"], ["status", "text"], ["signed_at", "timestamptz"]
  ],
  contract_templates: [["org_id", "uuid"], ["template_key", "text"], ["subtype", "text"]],
  dispute_letters: [
    ["org_id", "uuid"], ["client_id", "uuid"], ["round", "text"], ["created_at", "timestamptz"], ["mailed_at", "timestamptz"]
  ],
  dispute_cases: [
    ["id", "uuid"], ["org_id", "uuid"], ["client_id", "uuid"], ["round", "text"], ["status", "text"],
    ["response_due_at", "timestamptz"]
  ],
  dispute_responses: [
    ["org_id", "uuid"], ["client_id", "uuid"], ["case_id", "uuid"], ["confirmed", "boolean"], ["confirmed_at", "timestamptz"]
  ],
  repair_decision_log: [
    ["org_id", "uuid"], ["client_id", "uuid"], ["decision", "text"], ["created_at", "timestamptz"]
  ],
  inquiry_removal_cases: [
    ["org_id", "uuid"], ["client_id", "uuid"], ["funding_round_id", "uuid"], ["case_status", "inquiry_case_status"],
    ["selected_bureaus_raw", "text"], ["request_source", "text"], ["open_inquiry_count", "integer"],
    ["letter_provider_id", "text"], ["draft_letter_document_id", "uuid"], ["letter_draft_html", "text"],
    ["call_due_at", "timestamptz"], ["call_fired_at", "timestamptz"], ["closed_at", "timestamptz"],
    ["completed_at", "timestamptz"], ["cleared_at", "timestamptz"], ["created_at", "timestamptz"],
    ["updated_at", "timestamptz"], ["is_demo", "boolean"]
  ],
  affiliates: [
    ["id", "uuid"], ["org_id", "uuid"], ["name", "text"], ["tracking_id", "text"], ["status", "text"],
    ["created_at", "timestamptz"], ["activated_at", "timestamptz"], ["is_demo", "boolean"], ["tier_level", "text"],
    ["partner_license_signed_at", "timestamptz"], ["tax_form_received_at", "timestamptz"]
  ],
  affiliate_link_clicks: [
    ["org_id", "uuid"], ["affiliate_id", "uuid"], ["tracking_id_used", "text"], ["occurred_at", "timestamptz"]
  ],
  affiliate_referrals: [
    ["id", "uuid"], ["org_id", "uuid"], ["affiliate_id", "uuid"], ["client_id", "uuid"], ["tier", "text"],
    ["status", "text"], ["converted_at", "timestamptz"], ["commission_due", "numeric"]
  ],
  sale_payments: [
    ["id", "uuid"], ["org_id", "uuid"], ["sale_id", "uuid"], ["transaction_id", "uuid"], ["source_event_id", "uuid"],
    ["kind", "text"], ["amount", "numeric"], ["paid_at", "timestamptz"], ["created_at", "timestamptz"],
    ["is_demo", "boolean"], ["product_id", "uuid"]
  ],
  affiliate_payout_lines: [["payout_id", "uuid"], ["referral_id", "uuid"], ["kind", "text"]],
  affiliate_payouts: [
    ["id", "uuid"], ["org_id", "uuid"], ["affiliate_id", "uuid"], ["status", "text"], ["paid_at", "timestamptz"],
    ["created_at", "timestamptz"], ["initiated_at", "timestamptz"]
  ],
  accounts: [
    ["id", "uuid"], ["org_id", "uuid"], ["kind", "text"], ["email", "text"], ["client_id", "uuid"],
    ["affiliate_id", "uuid"], ["last_login_at", "timestamptz"]
  ],
  messages: [
    ["org_id", "uuid"], ["client_id", "uuid"], ["template_key", "text"], ["status", "text"], ["created_at", "timestamptz"]
  ],
  documents: [
    ["org_id", "uuid"], ["client_id", "uuid"], ["kind", "text"], ["subtype", "text"], ["created_at", "timestamptz"],
    ["generated_at", "timestamptz"], ["byte_size", "bigint"], ["metadata", "jsonb"], ["generated_by", "text"],
    ["is_demo", "boolean"]
  ],
  account_magic_links: [
    ["org_id", "uuid"], ["client_id", "uuid"], ["account_id", "uuid"], ["consumed_at", "timestamptz"]
  ],
  entitlements: [
    ["org_id", "uuid"], ["client_id", "uuid"], ["granted_at", "timestamptz"], ["revoked_at", "timestamptz"],
    ["expires_at", "timestamptz"], ["is_demo", "boolean"]
  ],
  partners: [
    ["id", "uuid"], ["org_id", "uuid"], ["name", "text"], ["brand_name", "text"], ["slug", "text"], ["status", "text"],
    ["created_at", "timestamptz"], ["updated_at", "timestamptz"], ["activated_at", "timestamptz"],
    ["agreement_signed_at", "timestamptz"], ["contact_email", "text"], ["is_demo", "boolean"], ["revenue_share_pct", "numeric"]
  ],
  partner_pages: [
    ["org_id", "uuid"], ["partner_id", "uuid"], ["slug", "text"], ["status", "text"], ["published_at", "timestamptz"]
  ],
  partner_revenue: [
    ["org_id", "uuid"], ["partner_id", "uuid"], ["transaction_id", "uuid"], ["source_event_id", "uuid"],
    ["status", "text"], ["created_at", "timestamptz"]
  ],
  partner_payouts: [
    ["id", "uuid"], ["org_id", "uuid"], ["partner_id", "uuid"], ["status", "text"], ["paid_at", "timestamptz"],
    ["created_at", "timestamptz"], ["initiated_at", "timestamptz"]
  ],
  applications: [
    ["org_id", "uuid"], ["funding_round_id", "uuid"], ["status", "text"], ["approved_amount", "numeric"],
    ["approval_excluded_at", "timestamptz"], ["status_updated_date", "timestamptz"], ["updated_at", "timestamptz"]
  ]
});

/** An empty world with the named tables. */
export function emptyWorld(names) {
  const w = {};
  for (const name of names) {
    if (!COLS[name]) throw new Error(`trip-test-kit has no column list for ${name}`);
    w[name] = { cols: COLS[name], rows: [] };
  }
  return w;
}
