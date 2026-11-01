// Shared fixtures for the end-to-end verification harness.
// Every adapter env secret is set to a deterministic mock value so signature
// gates can be exercised without transmitting. Outbound providers stay dry.

import crypto from "node:crypto";
import { clearHandlers } from "../events/registry.mjs";
import { _resetOrgCache } from "../events/bus.mjs";
import { registerAll } from "../register-all.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { createSession } from "../auth/session.mjs";
import { assertHarnessSafe } from "./scratch-guard.mjs";

export const MARK = "e2e_verify";
export const CALL_STATES = Object.freeze([
  "not_started",
  "queued",
  "dialing",
  "navigating_ivr",
  "on_hold",
  "talking_to_rep",
  "transferred_to_human",
  "completed",
  "failed",
  "canceled",
  "retry_scheduled"
]);

/** Bureau field names that must survive CRS ingest unchanged in meaning. */
export const BUREAU_FIELDS = Object.freeze([
  "creditorName",
  "currentBalanceAmount",
  "creditLimitAmount",
  "accountOpenedDate",
  "accountIdentifier",
  "accountReportedDate",
  "accountStatusType"
]);

/** Independent money expectations (hand-calculated — do not import commission code). */
export const MONEY = Object.freeze({
  depositDollars: 3000,
  expectedCloserFront: 600,       // $3000 deposit × owner-set 20%
  advisorHourly: 6.25,             // $6.25/hr (shift pay — not ledger)
  advisorBackPct: 0.0025,          // 0.25% of funded
  successFeePct: 0.10,             // 10%
  fundedAmount: 50000,
  // hand calc: 50000 * 0.0025 = 125
  expectedAdvisorBack: 125,
  // hand calc: 50000 * 0.10 = 5000
  expectedSuccessFee: 5000
});

export const MOCK_SECRETS = Object.freeze({
  COMMAS_WEBHOOK_SECRET: "verify-commas-secret",
  CLICKFUNNELS_WEBHOOK_SECRET: "verify-cf-secret",
  TWILIO_AUTH_TOKEN: "verify-twilio-token",
  MAILGUN_WEBHOOK_SIGNING_KEY: "verify-mailgun-key",
  BLAND_WEBHOOK_SECRET: "verify-bland-secret",
  LENDFLOW_WEBHOOK_SECRET: "verify-lendflow-secret"
});

/** Force dry-run / no-transmit environment for the process. */
export function applyDryRunEnv() {
  for (const [k, v] of Object.entries(MOCK_SECRETS)) {
    process.env[k] = v;
  }
  // Never transmit. Unset real provider credentials if present in the shell.
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.TWILIO_ACCOUNT_SID;
  delete process.env.TWILIO_API_KEY;
  delete process.env.MAILGUN_API_KEY;
  delete process.env.INNGEST_EVENT_KEY;
  process.env.MESSAGING_DRY_RUN = "1";
  process.env.ADAPTERS_DRY_RUN = "1";
}

export async function bootHandlers() {
  _resetOrgCache();
  clearHandlers();
  registerAll();
}

/**
 * Build a verification org context: default org, one staff per role, sessions,
 * commission rules for funding product, product entitlements, templates marked
 * compliance_passed for keys the funding path needs (so queueing can succeed).
 */
export async function setupContext(db) {
  applyDryRunEnv();
  await assertHarnessSafe(db);
  await bootHandlers();

  const orgId = await resolveDefaultOrg(db);
  const stamp = Date.now();
  const staffByRole = {};

  const roles = [
    "owner", "admin", "sales_manager", "funding_advisor",
    "closer", "inquiry_specialist", "setter"
  ];

  for (const role of roles) {
    const email = `${MARK}.${role}.${stamp}@verify.local`;
    const { rows } = await db.query(
      `INSERT INTO staff (org_id, email, name, role, status)
       VALUES ($1, $2, $3, $4, 'active')
       RETURNING id, email, name, role, org_id, status`,
      [orgId, email, `Verify ${role}`, role]
    );
    const row = rows[0];
    const session = await createSession(db, { staffId: row.id, orgId });
    staffByRole[role] = { ...row, token: session.token };
  }

  // Ensure product entitlements exist (money-chain grants from these).
  await db.query(
    `INSERT INTO product_entitlements (org_id, product_code, entitlement_code)
     VALUES
       ($1, 'diagnostic', 'credit-analysis-report'),
       ($1, 'consulting-package', 'metro2-letter-pack'),
       ($1, 'card-stacking-dfy', 'funding-snapshot')
     ON CONFLICT DO NOTHING`,
    [orgId]
  );

  const fundingProduct = (await db.query(
    `SELECT id FROM products WHERE org_id = $1 AND code = 'card-stacking-dfy'`,
    [orgId]
  )).rows[0];
  const diyProduct = (await db.query(
    `SELECT id FROM products WHERE org_id = $1 AND code = 'consulting-package'`,
    [orgId]
  )).rows[0];
  const diagProduct = (await db.query(
    `SELECT id FROM products WHERE org_id = $1 AND code = 'diagnostic'`,
    [orgId]
  )).rows[0];

  // Commission rules matching owner-stated economics.
  // Prefer existing active rules (seed / prior runs) — exclusion constraint
  // forbids overlapping ranges for the same role/product/basis.
  async function ensureRule({ basis, role, calc_method, flat_amount, percent, amount_basis, name }) {
    const existing = (await db.query(
      `SELECT id FROM commission_rules
        WHERE org_id = $1 AND basis = $2 AND role = $3 AND product_id = $4
          AND active = true
        ORDER BY effective_from DESC LIMIT 1`,
      [orgId, basis, role, fundingProduct.id]
    )).rows[0];
    if (existing) return existing;
    try {
      return (await db.query(
        `INSERT INTO commission_rules (
           org_id, name, basis, stacking, role, product_id,
           calc_method, flat_amount, percent, amount_basis, effective_from, active
         ) VALUES (
           $1, $2, $3, 'base', $4, $5,
           $6, $7, $8, $9, '2020-01-01', true
         ) RETURNING id`,
        [orgId, name, basis, role, fundingProduct.id,
          calc_method, flat_amount ?? null, percent ?? null, amount_basis]
      )).rows[0];
    } catch (err) {
      if (err.code === "23P01") {
        return (await db.query(
          `SELECT id FROM commission_rules
            WHERE org_id = $1 AND basis = $2 AND role = $3 AND product_id = $4
            LIMIT 1`,
          [orgId, basis, role, fundingProduct.id]
        )).rows[0];
      }
      throw err;
    }
  }

  const front = await ensureRule({
    basis: "front_end", role: "closer", calc_method: "percent",
    percent: 20, amount_basis: "deposit_collected", name: `${MARK} closer one fifth`
  });
  const advisorBack = await ensureRule({
    basis: "back_end", role: "funding_advisor", calc_method: "percent",
    percent: 0.25, amount_basis: "amount_funded", name: `${MARK} advisor 0.25%`
  });

  // Approve workflow templates so sendTemplated can queue (still no transmit).
  await db.query(
    `UPDATE message_templates
        SET compliance_passed = true
      WHERE org_id = $1
        AND (
          template_key LIKE 'SMS-F%' OR template_key LIKE 'EMAIL-F%' OR
          template_key LIKE 'SMS-ROUND%' OR template_key LIKE 'EMAIL-U02%' OR
          template_key LIKE 'SMS-DS%' OR template_key LIKE 'EMAIL-DS%' OR
          template_key LIKE 'SMS-C06%' OR template_key LIKE 'EMAIL-C06%' OR
          template_key LIKE 'SMS-S%' OR template_key LIKE 'EMAIL-S%' OR
          template_key LIKE 'SMS-N%' OR template_key LIKE 'EMAIL-N%' OR
          template_key LIKE 'SMS-AI%' OR template_key LIKE 'EMAIL-DPC%' OR
          template_key LIKE 'SMS-DPC%' OR template_key LIKE 'EMAIL-AX%' OR
          template_key LIKE 'SMS-AX%'
        )
        AND body NOT ILIKE '%[DRAFT%'`,
    [orgId]
  );

  // Pause sending on THIS org only. Re-check scratch-guard immediately before
  // the flip so a live DB cannot lose outbound_enabled (2026-08-22).
  await assertHarnessSafe(db);
  await db.query(
    `INSERT INTO messaging_settings (org_id, outbound_enabled, daily_send_cap)
     VALUES ($1, false, 0)
     ON CONFLICT (org_id) DO UPDATE
       SET outbound_enabled = false, daily_send_cap = 0`,
    [orgId]
  );

  // Second org for isolation attacks.
  const otherOrg = (await db.query(
    `INSERT INTO orgs (name, slug)
     VALUES ($1, $2)
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [`Verify Other ${stamp}`, `verify-other-${stamp}`]
  )).rows[0];

  const otherOwner = (await db.query(
    `INSERT INTO staff (org_id, email, name, role, status)
     VALUES ($1, $2, 'Other Owner', 'owner', 'active')
     RETURNING id, email, role, org_id`,
    [otherOrg.id, `${MARK}.other.owner.${stamp}@verify.local`]
  )).rows[0];
  const otherSession = await createSession(db, {
    staffId: otherOwner.id, orgId: otherOrg.id
  });

  return {
    orgId,
    otherOrgId: otherOrg.id,
    staffByRole,
    otherOwner: { ...otherOwner, token: otherSession.token },
    products: {
      funding: fundingProduct,
      diy: diyProduct,
      diagnostic: diagProduct
    },
    rules: { front: front.id, advisorBack: advisorBack.id },
    mark: MARK,
    stamp
  };
}

export async function wipeClientTree(db, clientIds) {
  if (!clientIds?.length) return;
  await db.query(`ALTER TABLE commission_ledger DISABLE TRIGGER trg_commission_ledger_no_delete`).catch(() => {});
  await db.query(`ALTER TABLE entitlements DISABLE TRIGGER trg_entitlements_no_delete`).catch(() => {});
  try {
    await db.query(`DELETE FROM commission_ledger WHERE client_id = ANY($1)`, [clientIds]);
    await db.query(`DELETE FROM entitlements WHERE client_id = ANY($1)`, [clientIds]);
  } finally {
    await db.query(`ALTER TABLE commission_ledger ENABLE TRIGGER trg_commission_ledger_no_delete`).catch(() => {});
    await db.query(`ALTER TABLE entitlements ENABLE TRIGGER trg_entitlements_no_delete`).catch(() => {});
  }
  await db.query(`DELETE FROM sale_payments WHERE sale_id IN (SELECT id FROM sales WHERE client_id = ANY($1))`, [clientIds]);
  await db.query(`DELETE FROM sale_attributions WHERE sale_id IN (SELECT id FROM sales WHERE client_id = ANY($1))`, [clientIds]);
  await db.query(`DELETE FROM funding_round_sales WHERE sale_id IN (SELECT id FROM sales WHERE client_id = ANY($1))`, [clientIds]);
  await db.query(`DELETE FROM funding_closeout_items WHERE funding_closeout_id IN (
    SELECT id FROM funding_closeout WHERE funding_round_id IN (SELECT id FROM funding_rounds WHERE client_id = ANY($1)))`, [clientIds]).catch(() => {});
  await db.query(`DELETE FROM funding_closeout WHERE funding_round_id IN (SELECT id FROM funding_rounds WHERE client_id = ANY($1))`, [clientIds]).catch(() => {});
  await db.query(`DELETE FROM application_decisions WHERE application_id IN (SELECT id FROM applications WHERE client_id = ANY($1))`, [clientIds]).catch(() => {});
  await db.query(`DELETE FROM applications WHERE client_id = ANY($1)`, [clientIds]).catch(() => {});
  await db.query(
    `DELETE FROM invoice_payments WHERE invoice_id IN (
       SELECT id FROM invoices WHERE client_id = ANY($1)
          OR funding_round_id IN (SELECT id FROM funding_rounds WHERE client_id = ANY($1)))`,
    [clientIds]
  ).catch(() => {});
  await db.query(
    `DELETE FROM invoice_line_items WHERE invoice_id IN (
       SELECT id FROM invoices WHERE client_id = ANY($1)
          OR funding_round_id IN (SELECT id FROM funding_rounds WHERE client_id = ANY($1)))`,
    [clientIds]
  ).catch(() => {});
  await db.query(
    `UPDATE invoices SET funding_round_id = NULL
      WHERE funding_round_id IN (SELECT id FROM funding_rounds WHERE client_id = ANY($1))`,
    [clientIds]
  ).catch(() => {});
  await db.query(`DELETE FROM invoices WHERE client_id = ANY($1)`, [clientIds]).catch(() => {});
  await db.query(`DELETE FROM funding_rounds WHERE client_id = ANY($1)`, [clientIds]);
  await db.query(`DELETE FROM sales WHERE client_id = ANY($1)`, [clientIds]);
  await db.query(`DELETE FROM payment_links WHERE client_id = ANY($1)`, [clientIds]).catch(() => {});
  await db.query(`DELETE FROM contract_signers WHERE contract_id IN (SELECT id FROM contracts WHERE client_id = ANY($1))`, [clientIds]).catch(() => {});
  await db.query(`DELETE FROM contracts WHERE client_id = ANY($1)`, [clientIds]).catch(() => {});
  await db.query(`DELETE FROM opt_outs WHERE client_id = ANY($1)`, [clientIds]).catch(() => {});
  await db.query(`DELETE FROM messages WHERE client_id = ANY($1)`, [clientIds]);
  await db.query(`DELETE FROM conversations WHERE client_id = ANY($1)`, [clientIds]);
  await db.query(`DELETE FROM tasks WHERE client_id = ANY($1)`, [clientIds]);
  await db.query(`DELETE FROM cards WHERE client_id = ANY($1)`, [clientIds]);
  await db.query(`DELETE FROM tradelines WHERE client_id = ANY($1)`, [clientIds]).catch(() => {});
  await db.query(`DELETE FROM crs_results WHERE client_id = ANY($1)`, [clientIds]);
  await db.query(`DELETE FROM client_consents WHERE client_id = ANY($1)`, [clientIds]).catch(() => {});
  await db.query(`DELETE FROM inquiry_log WHERE client_id = ANY($1)`, [clientIds]).catch(() => {});
  await db.query(`DELETE FROM inquiry_removal_cases WHERE client_id = ANY($1)`, [clientIds]).catch(() => {});
  await db.query(`DELETE FROM inquiry_prep WHERE client_id = ANY($1)`, [clientIds]).catch(() => {});
  await db.query(`DELETE FROM agent_shadow_log WHERE client_id = ANY($1)`, [clientIds]).catch(() => {});
  await db.query(`DELETE FROM transactions WHERE client_id = ANY($1)`, [clientIds]);
  await db.query(`DELETE FROM events WHERE client_id = ANY($1)`, [clientIds]);
  await db.query(`DELETE FROM documents WHERE client_id = ANY($1)`, [clientIds]).catch(() => {});
  await db.query(`DELETE FROM bank_accounts WHERE client_id = ANY($1)`, [clientIds]).catch(() => {});
  await db.query(`DELETE FROM clients WHERE id = ANY($1)`, [clientIds]);
}

export async function wipeVerifyArtifacts(db, ctx) {
  const clients = (await db.query(
    `SELECT id FROM clients WHERE email LIKE $1 OR email LIKE $2 OR tags @> ARRAY['e2e_verify']::text[]`,
    [`${MARK}%`, `%@verify.local`]
  )).rows.map((r) => r.id);
  await wipeClientTree(db, clients);

  // Drop verify events BEFORE deleting staff — otherwise a later replay trips
  // sale_attributions_staff_id_fkey on orphaned closerId values.
  await db.query(
    `DELETE FROM events
      WHERE payload->>'email' LIKE $1
         OR payload->>'email' LIKE $2
         OR idempotency_key LIKE $3`,
    [`${MARK}%`, `%@verify.local`, `${MARK}%`]
  ).catch(() => {});

  if (ctx?.rules) {
    // Do not delete seed commission rules we reused — only ones we inserted
    // this run with our mark in the name.
    await db.query(
      `DELETE FROM commission_rules WHERE name LIKE $1`,
      [`${MARK}%`]
    ).catch(() => {});
  }
  await db.query(`DELETE FROM staff WHERE email LIKE $1`, [`${MARK}%`]);
  await db.query(`DELETE FROM agents WHERE code LIKE 'VF-%'`).catch(() => {});
  if (ctx?.otherOrgId) {
    await db.query(`DELETE FROM staff WHERE org_id = $1`, [ctx.otherOrgId]);
    await db.query(`DELETE FROM orgs WHERE id = $1`, [ctx.otherOrgId]);
  }
}

export function signHmac(rawBody, secret) {
  return crypto.createHmac("sha256", secret).update(rawBody || "").digest("hex");
}
