#!/usr/bin/env node
// Re-score FinanceOS scorecard rows 14a + 16. Test only. MESSAGING_DRY_RUN=1.
import "../../scripts/load-env.mjs";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db, close } from "../../src/db.mjs";
import { resolveDefaultOrg } from "../../src/auth/org.mjs";
import { createPaymentLink } from "../../src/payment-links/index.mjs";
import {
  SETUP_PURPOSE,
  SETUP_DESCRIPTION,
  SETUP_COMMAS_TITLE,
  readSetupStatus
} from "../../src/finance/money-setup.mjs";
import { addClarityPayment } from "../../src/finance/clarity-payments.mjs";
import { drain } from "../../src/payments/commas-inbox.mjs";
import { processCommasInboxRow } from "../../src/adapters/commas.mjs";
import { ensureRegistered } from "../../src/register-all.mjs";

const __dir = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dir, "../..");

process.env.MESSAGING_DRY_RUN = "1";
process.env.ADAPTERS_DRY_RUN = "1";
process.env.PLAID_ENV = process.env.PLAID_ENV || "sandbox";

const SETUP_FEE = Number(process.env.FINANCE_OS_SETUP_FEE_CENTS || "49700");
const TAG = `e2e+financeos-14a16-${Date.now()}@fundhub.ai`;
const INSTALL_CENTS = 33300;

async function drainInbox() {
  ensureRegistered();
  const out = await drain(db, { process: processCommasInboxRow, limit: 20 });
  return out;
}

async function pushReceipt(email, ref) {
  const r = spawnSync(
    "node",
    ["scripts/sim/push-payment.mjs", "--email", email, "--ref", ref, "--site", "https://fundhub.ai"],
    { cwd: REPO, encoding: "utf8", env: { ...process.env, MESSAGING_DRY_RUN: "1", ADAPTERS_DRY_RUN: "1" } }
  );
  return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}

async function main() {
  const orgId = await resolveDefaultOrg(db);
  const staff = (
    await db.query(
      `SELECT id, role FROM staff WHERE org_id=$1 AND lower(email)='chris@fundhub.ai' AND status='active' LIMIT 1`,
      [orgId]
    )
  ).rows[0];
  if (!staff) throw new Error("no owner staff");

  const clientId = randomUUID();
  await db.query(
    `INSERT INTO clients (id, org_id, first_name, last_name, email, phone, outcome_tier, is_demo)
     VALUES ($1,$2,'Sim','FinanceOS', $3, '+16616054248', 'funding', true)`,
    [clientId, orgId, TAG]
  );

  const proof = {
    email: TAG,
    client_id: clientId,
    setup_fee_cents: SETUP_FEE,
    plaid_env: process.env.PLAID_ENV,
    messaging_dry_run: process.env.MESSAGING_DRY_RUN
  };

  // --- 14a: setup fee link → finance-os sub ---
  const setupLink = await createPaymentLink(db, {
    orgId,
    clientId,
    purpose: SETUP_PURPOSE,
    description: SETUP_DESCRIPTION,
    commasProductTitle: SETUP_COMMAS_TITLE,
    amountCents: SETUP_FEE,
    createdByStaffId: staff.id,
    createdByRole: staff.role,
    env: process.env
  });
  proof.setup_link_ref = setupLink.link_ref;

  const pushSetup = await pushReceipt(TAG, setupLink.link_ref);
  proof.push_setup = { exit: pushSetup.status, tail: (pushSetup.stdout + pushSetup.stderr).slice(-500) };
  if (pushSetup.status !== 0) {
    proof.row14a = "FAIL";
    proof.row14a_reason = "push-payment failed for setup link";
    console.log(JSON.stringify(proof, null, 2));
    await close();
    process.exit(0);
  }

  let drained = await drainInbox();
  proof.inbox_after_setup = drained;

  const setupStatus = await readSetupStatus(db, { orgId, clientId, env: process.env });
  const sub = (
    await db.query(
      `SELECT id, tier, provider_ref FROM subscriptions
       WHERE org_id=$1 AND client_id=$2 AND tier='finance-os' ORDER BY effective_from DESC LIMIT 1`,
      [orgId, clientId]
    )
  ).rows[0];
  const paidLink = (
    await db.query(
      `SELECT id, status, description FROM payment_links
       WHERE client_id=$1 AND description=$2 AND status='paid' LIMIT 1`,
      [clientId, SETUP_DESCRIPTION]
    )
  ).rows[0];

  proof.row14a_sql = {
    entitled: setupStatus?.entitled,
    paid: setupStatus?.paid,
    sub_tier: sub?.tier || null,
    provider_ref: sub?.provider_ref || null,
    paid_setup_link: paidLink?.status || null
  };
  proof.row14a =
    setupStatus?.entitled &&
    setupStatus?.paid &&
    sub?.tier === "finance-os" &&
    paidLink?.status === "paid"
      ? "PASS"
      : "FAIL";

  // --- 16: Commas receipt on matching installment ---
  const today = new Date().toISOString().slice(0, 10);
  const planRef = `e2e:clarity-${clientId.slice(0, 8)}`;
  const existing = (
    await db.query(`SELECT id FROM clarity_payments WHERE org_id=$1 AND client_id=$2 AND external_ref=$3`, [
      orgId,
      clientId,
      planRef
    ])
  ).rows[0];
  let planId = existing?.id;
  if (!planId) {
    const added = await addClarityPayment(db, {
      orgId,
      clientId,
      externalRef: planRef,
      input: {
        kind: "clarity",
        owed_to: "Fundhub LLC",
        installments: [{ due_on: today, amount_cents: INSTALL_CENTS }]
      }
    });
    planId = added.id;
  }

  const instBefore = (
    await db.query(
      `SELECT id, paid_cents, amount_cents FROM clarity_payment_installments
       WHERE clarity_payment_id=$1 ORDER BY seq LIMIT 1`,
      [planId]
    )
  ).rows[0];

  const clarityLink = await createPaymentLink(db, {
    orgId,
    clientId,
    purpose: "custom",
    description: "E2E Clarity installment",
    commasProductTitle: "Consulting Services Standard",
    amountCents: INSTALL_CENTS,
    createdByStaffId: staff.id,
    createdByRole: staff.role,
    env: process.env
  });
  proof.clarity_link_ref = clarityLink.link_ref;

  const pushClarity = await pushReceipt(TAG, clarityLink.link_ref);
  proof.push_clarity = { exit: pushClarity.status, tail: (pushClarity.stdout + pushClarity.stderr).slice(-500) };
  if (pushClarity.status === 0) {
    drained = await drainInbox();
    proof.inbox_after_clarity = drained;
  }

  const instAfter = (
    await db.query(
      `SELECT id, paid_cents, amount_cents FROM clarity_payment_installments
       WHERE clarity_payment_id=$1 ORDER BY seq LIMIT 1`,
      [planId]
    )
  ).rows[0];
  const agentLog = (
    await db.query(
      `SELECT action, detail FROM money_agent_log
       WHERE org_id=$1 AND client_id=$2 AND idempotency_key LIKE 'commas-payment:%'
       ORDER BY created_at DESC LIMIT 3`,
      [orgId, clientId]
    )
  ).rows;
  const clarityPaidLink = (
    await db.query(
      `SELECT status FROM payment_links WHERE link_ref=$1 LIMIT 1`,
      [clarityLink.link_ref]
    )
  ).rows[0];

  proof.row16_sql = {
    inst_before_paid: instBefore?.paid_cents,
    inst_after_paid: instAfter?.paid_cents,
    clarity_link_status: clarityPaidLink?.status,
    agent_log: agentLog
  };
  proof.row16 =
    pushClarity.status === 0 &&
    Number(instAfter?.paid_cents) >= INSTALL_CENTS &&
    clarityPaidLink?.status === "paid" &&
    agentLog.some((r) => r.action === "payment_recorded")
      ? "PASS"
      : "FAIL";

  console.log(JSON.stringify(proof, null, 2));
  await close();
}

main().catch(async (e) => {
  console.error(e);
  try {
    await close();
  } catch {
    /* noop */
  }
  process.exit(1);
});
