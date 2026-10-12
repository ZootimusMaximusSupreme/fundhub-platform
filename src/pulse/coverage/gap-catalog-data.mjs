// Shared result judge for the sensitive catalog tables that had only writer
// tests. Read only. It reads business result fields, never table shape alone.
// Empty tables are a verified "nothing to judge" result. A populated row with
// no usable business result is red.

export const TABLE_RULES = Object.freeze({
  action_log: { all: ["org_id", "target_type", "target_id"], any: ["after", "execute_error", "executed_at"] },
  affiliate_commission_rules: { all: ["org_id", "calc_method"], any: ["percent", "flat_amount", "max_amount"] },
  agent_shadow_log: { all: ["org_id", "agent_code", "reason"], any: ["would_send_body", "inbound_body"] },
  alerts: { all: ["org_id", "kind", "state", "title"], any: ["detail", "as_of"] },
  bank_inbox: { all: ["org_id", "client_id", "classification", "subject"], any: ["body_preview", "raw"] },
  bank_relationship_deposits: { all: ["org_id", "client_id", "amount_cents", "deposited_on"] },
  bank_transactions: { all: ["org_id", "client_id", "amount_cents", "posted_on"] },
  blueprint_bank_relationship_todos: { all: ["org_id", "client_id", "bank_key", "state"] },
  blueprint_decline_steps: { all: ["org_id", "decline_id", "step_key", "status"], any: ["step_text", "filled_text", "blank_label"] },
  blueprint_declines: { all: ["org_id", "client_id", "bank", "declined_on"], any: ["outcome", "reason_categories", "analysis"] },
  business_tradelines: { all: ["org_id", "client_id", "creditor_name", "source"] },
  candidate_outreach: { all: ["org_id", "candidate_id", "status", "step"] },
  card_liabilities: { all: ["org_id", "client_id", "as_of"], any: ["current_balance_cents", "statement_balance_cents", "past_due_cents"] },
  card_liability_history: { all: ["org_id", "client_id", "as_of"], any: ["current_balance_cents", "statement_balance_cents", "past_due_cents"] },
  cashflow_reminders: { all: ["org_id", "client_id", "reminder_kind", "body", "surface_at"] },
  cashflow_settings: { all: ["org_id", "min_buffer_cents", "confidence_floor", "settlement_lead_days"] },
  client_authorized_reps: { all: ["org_id", "account_id", "client_id"] },
  client_cards: { all: ["org_id", "client_id", "provider", "provider_token", "last4"] },
  client_custom_fields: { all: ["org_id", "client_id", "ai_call_enabled"] },
  client_escalations: { all: ["org_id", "client_id", "said_at", "matched_pattern"] },
  client_push_subscriptions: { all: ["org_id", "client_id", "endpoint_hash", "encrypted_endpoint"] },
  commission_rule_tiers: { all: ["org_id", "rule_id"], any: ["percent", "flat_amount", "per_unit_amount"] },
  conversation_participants: { all: ["conversation_id", "staff_id"] },
  creative_billing_rates: { all: ["org_id", "rate_key", "rate"] },
  creative_usage_events: { all: ["org_id", "partner_id", "event_type", "quantity", "total_cents", "status"] },
  credit_partner_links: { all: ["org_id", "primary_client_id", "partner_client_id"] },
  decline_autopsy_rows: { all: ["org_id", "autopsy_id", "bucket"], any: ["estimated_capacity_cents", "decline_reason"] },
  decline_autopsy_uploads: { all: ["org_id", "autopsy_ref", "buyer_email"], any: ["paid_at", "scored_at", "deleted_at"] },
  dispute_responses: { all: ["org_id", "client_id", "case_id"], any: ["raw_text", "parse_json"] },
  document_vault_items: { all: ["org_id", "client_id", "item_key", "kind", "title"] },
  document_vault_reviews: { all: ["org_id", "client_id", "document_id", "status"] },
  education_enrollments: { all: ["org_id", "client_id", "program", "status"] },
  entities: { all: ["org_id", "client_id", "kind", "name"] },
  file_protection_settings: { all: ["org_id", "client_id", "payment_timing", "promo_end", "cash_reserve", "new_credit"] },
  finance_account_daily: { all: ["org_id", "client_id", "bank_account_id", "day", "source"], any: ["current_balance_cents", "available_balance_cents", "credit_limit_cents"] },
  finance_client_daily: { all: ["org_id", "client_id", "day", "source"], any: ["cash_personal_cents", "cash_business_cents", "debt_total_cents", "cards_balance_cents"] },
  funding_closeout_items: { all: ["org_id", "funding_closeout_id", "lender_name", "approved_amount", "fee_amount"] },
  inquiry_attempts: { all: ["org_id", "inquiry_id", "staff_id", "kind", "outcome"] },
  inquiry_log: { all: ["org_id", "client_id", "bureau", "inquiry", "status"] },
  inquiry_prep: { all: ["org_id", "client_id", "prep_state", "bureau", "inquiry_name"] },
  investment_holdings: { all: ["org_id", "client_id", "bank_account_id", "current_value_cents", "as_of"] },
  invoice_line_items: { all: ["org_id", "invoice_id", "line_no", "description", "amount"] },
  invoice_payments: { all: ["org_id", "invoice_id", "kind", "amount", "paid_at"] },
  live_trial_events: { all: ["org_id", "live_trial_id", "kind", "occurred_at"] },
  live_trials: { all: ["org_id", "contact_email", "status", "price_cents"] },
  mail_universe: { all: ["org_id", "campaign_id", "record_slug"], any: ["fields", "suppressed", "responded_at", "outcome_tier"] },
  merchant_events: { all: ["connection_id", "provider_event_id", "kind", "amount_cents", "occurred_at"] },
  money_agent_pins: { all: ["org_id", "client_id", "purpose", "kind", "title", "status"] },
  money_helper_threads: { all: ["org_id", "client_id", "halted_at", "halt_reason"] },
  money_transfer_events: { all: ["org_id", "client_id", "transfer_id", "event_type"], any: ["to_status", "debit_status", "credit_status", "detail"] },
  money_transfer_sync_cursors: { all: ["environment", "after_id", "updated_at"] },
  partner_payout_lines: { all: ["org_id", "payout_id", "revenue_id", "client_id", "amount"] },
  partner_revenue: { all: ["org_id", "partner_id", "client_id", "gross_amount", "share_amount", "status"] },
  payment_strategy_plans: { all: ["org_id", "client_id", "method", "monthly_cents", "goal_kind", "summary"] },
  pii_identity: { all: ["org_id", "client_id"], any: ["ssn_enc", "dob", "addresses"] },
  recurring_bill_transactions: { all: ["recurring_bill_id", "bank_transaction_id"] },
  recurring_bills: { all: ["org_id", "client_id", "merchant_key", "cadence", "typical_amount_cents", "confidence_pct"] },
  regulator_complaints: { all: ["org_id", "client_id", "kind", "state"] },
  repair_decision_log: { all: ["org_id", "client_id", "case_id", "decision", "payload"] },
  sale_payments: { all: ["org_id", "sale_id", "kind", "amount", "paid_at"] },
  snapshots: { all: ["org_id", "client_id", "source", "data"], any: ["score", "bureau"] },
  social_posts: { all: ["org_id", "partner_id", "caption", "status"], any: ["scheduled_for", "posted_at", "blocked_reasons", "last_error"] },
  spend_ceilings: { all: ["org_id", "partner_id", "platform", "daily_limit_cents", "active"] },
  tradelines: { all: ["org_id", "client_id", "lender", "kind", "source"], any: ["credit_limit_cents", "balance_cents"] },
  waypoint_definitions: { all: ["key", "title", "detail", "owner_kind"] },
  waypoint_nudges: { all: ["org_id", "client_id", "waypoint_id", "step", "kind", "outcome"] },
});

export const TABLE_NAMES = Object.freeze(Object.keys(TABLE_RULES));
export const CHECK_IDS = Object.freeze(TABLE_NAMES.map((name) => `catalog-data:${name}`));
const BATCH_SIZE = 11;

function present(field) {
  return `NULLIF(BTRIM(COALESCE(to_jsonb(t)->>'${field}', '')), '') IS NOT NULL`;
}

function completeCondition(rule) {
  const all = rule.all.map(present);
  const any = (rule.any || []).map(present);
  return [...all, ...(any.length ? [`(${any.join(' OR ')})`] : [])].join(' AND ');
}

function selectFor(table, rule) {
  const quoted = `"${table.replaceAll('"', '""')}"`;
  return `SELECT '${table}'::text AS table_name, count(*)::int AS row_count, ` +
    `count(*) FILTER (WHERE ${completeCondition(rule)})::int AS complete_count ` +
    `FROM ${quoted} t ` +
    `WHERE ($1::text IS NULL OR NOT (to_jsonb(t) ? 'org_id') OR to_jsonb(t)->>'org_id' = $1::text)`;
}

export const SQL_BATCHES = Object.freeze(Array.from(
  { length: Math.ceil(TABLE_NAMES.length / BATCH_SIZE) },
  (_, index) => TABLE_NAMES.slice(index * BATCH_SIZE, (index + 1) * BATCH_SIZE)
    .map((table) => selectFor(table, TABLE_RULES[table]))
    .join('\nUNION ALL\n'),
));

function result(id, status, detail, suggestedFix = null, na = undefined) {
  return { id, status, detail, suggestedFix, ...(na ? { na } : {}) };
}

export function judgeTableResult(table, stats = {}) {
  const id = `catalog-data:${table}`;
  const rows = Number(stats.row_count || 0);
  const complete = Number(stats.complete_count || 0);
  if (rows === 0) {
    return result(id, 'na', `${table} has no rows, so there is no saved result to judge.`, null, {
      code: 'catalog-data-empty',
      args: { table },
    });
  }
  if (complete === rows) {
    return result(id, 'PASS', `${table}: all ${rows} saved result row${rows === 1 ? '' : 's'} carry the business result fields this table promises.`);
  }
  const bad = Math.max(0, rows - complete);
  return result(
    id,
    'FAIL',
    `${table}: ${bad} of ${rows} saved result row${rows === 1 ? '' : 's'} ${bad === 1 ? 'is' : 'are'} missing a business result.`,
    `Open the ${table} rows counted by the catalog data check and finish the missing result. Do not auto-fix. Chris fixes reds.`,
  );
}

function skip(table, error) {
  const message = String(error?.message || error || 'unknown read error').replace(/\s+/g, ' ').slice(0, 160);
  return result(`catalog-data:${table}`, 'skip', `${table} was not read: ${message}.`);
}

function reader(ctx) {
  if (ctx && typeof ctx.scope === 'function') return ctx.scope;
  if (ctx?.db && typeof ctx.db.query === 'function') return (fn) => fn(ctx.db);
  return null;
}

export async function gapChecks(ctx = {}) {
  const run = reader(ctx);
  if (!run) return TABLE_NAMES.map((table) => skip(table, 'no database in this run'));

  const byTable = new Map();
  for (let index = 0; index < SQL_BATCHES.length; index += 1) {
    const tables = TABLE_NAMES.slice(index * BATCH_SIZE, (index + 1) * BATCH_SIZE);
    try {
      const answer = await run((db) => db.query(SQL_BATCHES[index], [ctx.orgId || null]));
      for (const row of answer?.rows || []) byTable.set(String(row.table_name), row);
    } catch (error) {
      for (const table of tables) byTable.set(table, { error });
    }
  }

  return TABLE_NAMES.map((table) => {
    const stats = byTable.get(table);
    if (!stats) return skip(table, 'the batch returned no result');
    if (stats.error) return skip(table, stats.error);
    return judgeTableResult(table, stats);
  });
}
