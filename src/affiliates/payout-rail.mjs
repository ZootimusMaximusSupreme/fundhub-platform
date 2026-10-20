/* THE AFFILIATE PAYOUT RAIL — from a pending payout run to a paid one.
 *
 * Owner ask, 2026-10-20: affiliate payout tracking, finished, through Plaid.
 * src/affiliates/payouts.mjs builds the monthly run (pending or held) and stops.
 * This file is everything after that: the affiliate's bank, the send, the
 * proof, and the record. Board: ops/workflows/affiliate-payout-plaid-2026-10-20.md.
 * Picture: docs/journeys/affiliate-payout-flow.md.
 *
 * HOW PLAID IS USED (agent-set 2026-10-20; Chris answered "no preference"):
 *   1. The affiliate links their own bank with Plaid Link (product "transfer").
 *      That proves the account is real and theirs. affiliate_payout_accounts.
 *   2. Finance staff press Send. Plaid Transfer pays the run OUT of Fundhub's
 *      Plaid Ledger to that account (a "credit" leg). Same gate the client
 *      transfers use: transferMode() — sandbox unless PLAID_ENV=production AND
 *      FINANCE_OS_TRANSFERS_LIVE=1, and only inside the per-transfer limit.
 *   3. The 15-minute sync asks Plaid what happened. Settled → paid, with the
 *      transfer id as the reference. Failed / returned / cancelled → back to
 *      pending with the reason, so staff can fix the bank and send again.
 *   4. Until Plaid gives production access, a real affiliate is paid by hand
 *      (ACH from the bank, cheque) and staff Mark paid with the reference.
 *
 * TEST MONEY NEVER PAYS A REAL PERSON. A sandbox send is refused for a real
 * (non-demo) affiliate here, and 492's trigger refuses a sandbox-settled Plaid
 * run turning a real affiliate's payout paid anyway. Belt and braces.
 *
 * WHAT THE DATABASE ALREADY GUARANTEES (033 + 492), so this file does not
 * re-check it as the last word: legal status moves only, no processing or paid
 * without a signed license AND a tax form, no paid without a method and a
 * reference, a paid run is frozen, one commission line per referral ever.
 *
 * No network code here. Plaid calls go through src/banking/providers/plaid-http.mjs
 * (via src/banking/plaid.mjs and src/banking/plaid-transfer.mjs).
 */

import { toCents } from "../commissions/money.mjs";
import { withTransaction } from "../db/with-transaction.mjs";
import { plaidConfigFromEnv, linkAccount, getAccounts, SEAM_REASONS } from "../banking/plaid.mjs";
import { plaidTransferProvider } from "../banking/plaid-transfer.mjs";
import { transferMode } from "../finance/money-transfers.mjs";
import { PAYOUT_DEFAULTS } from "./payouts.mjs";

import { DUE_DAYS_AFTER_PERIOD, PLAID_METHOD, dueOnFor } from "./payout-due.mjs";
export { DUE_DAYS_AFTER_PERIOD, PLAID_METHOD, dueOnFor };
/* How a payout made outside Plaid is recorded. Each needs a reference. */
export const MANUAL_METHODS = Object.freeze(["ach", "wire", "check", "manual"]);
export const LINK_PRODUCTS = Object.freeze(["transfer"]);
/* What Plaid prints on the affiliate's bank statement (10 characters max on ACH). */
export const PAYOUT_DESCRIPTION = "PAYOUT";
/* Plaid credit statuses: pending → posted → settled. funds_available is a debit
   status; read as done if Plaid ever reports it on a credit. */
export const TRANSFER_DONE = Object.freeze(["settled", "funds_available"]);
export const TRANSFER_DEAD = Object.freeze(["failed", "cancelled", "returned"]);
export const SANDBOX_LABEL = "(Plaid sandbox — test data)";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v) => typeof v === "string" && UUID_RE.test(v);

const refuse = (status, error, message, extra = {}) => ({ ok: false, status, error, message, ...extra });

export function actorLabel(staff) {
  if (!staff) return "unknown";
  const name = String(staff.name || "").trim();
  if (name) return name.slice(0, 120);
  const email = String(staff.email || "").trim();
  if (email) return email.slice(0, 120);
  return String(staff.id || "unknown").slice(0, 120);
}

/** Plaid idempotency key, ≤ 50 characters. One per send attempt. */
export function attemptKey(payoutId, attempt) {
  return `ap:${payoutId}:${attempt}`;
}

/** The Plaid transfer status → what it means for the run. Pure. */
export function railOutcome(transferStatus) {
  const s = String(transferStatus || "").toLowerCase();
  if (TRANSFER_DONE.includes(s)) return "paid";
  if (TRANSFER_DEAD.includes(s)) return "failed";
  return "in_flight";
}

/** Pick the account to pay into. A caller-named one wins; otherwise the only
 *  depository checking/savings account. Credit cards and loans cannot take a
 *  payout. Pure. */
export function pickPayoutAccount(accounts, wantedId = null) {
  const list = Array.isArray(accounts) ? accounts : [];
  const ok = (a) => a && a.type === "depository" && (!a.subtype || ["checking", "savings"].includes(a.subtype));
  if (wantedId) {
    const a = list.find((x) => x.plaidAccountId === wantedId);
    if (!a) return { error: "account_not_in_link" };
    if (!ok(a)) return { error: "account_cannot_take_payouts" };
    return { account: a };
  }
  const usable = list.filter(ok);
  if (usable.length === 1) return { account: usable[0] };
  if (usable.length === 0) return { error: "no_checking_or_savings" };
  return { error: "pick_one_account", choices: usable.map((a) => ({ id: a.plaidAccountId, name: a.name, mask: a.mask, subtype: a.subtype })) };
}

/* ═══════════════════════════════════════════════════════════════════════════
   1. The affiliate's bank
   ═══════════════════════════════════════════════════════════════════════════ */

/** Open Plaid Link for one affiliate. */
export async function startAffiliateBankLink({ affiliateId, env = process.env, http = null } = {}) {
  const cfg = plaidConfigFromEnv(env);
  if (!cfg.ready) return refuse(503, SEAM_REASONS.NOT_CONFIGURED, "Bank linking is not set up yet.", { missing: [...cfg.missing, ...cfg.problems] });
  if (!isUuid(affiliateId)) return refuse(400, SEAM_REASONS.BAD_REQUEST, "affiliate id is required");
  const { createLinkToken } = http || (await import("../banking/providers/plaid-http.mjs"));
  const r = await createLinkToken({ clientUserId: `affiliate:${affiliateId}`, products: [...LINK_PRODUCTS] }, {
    environment: cfg.environment, clientId: env.PLAID_CLIENT_ID, secret: env.PLAID_SECRET, env
  });
  if (!r.ok) return refuse(502, r.blocked ? SEAM_REASONS.HELD : SEAM_REASONS.UPSTREAM_ERROR, "Plaid did not open the bank link.", { detail: r.error ?? null });
  return { ok: true, status: 200, linkToken: r.linkToken, expiration: r.expiration ?? null, environment: cfg.environment };
}

/**
 * Finish Plaid Link: trade the public token, read the accounts, save the one
 * that takes payouts. The old active account (if any) becomes 'replaced' in the
 * same transaction, so there is never a moment with two.
 */
export async function completeAffiliateBankLink(db, {
  orgId, affiliateId, publicToken, accountId = null, institution = null,
  linkedBy = "affiliate", now = new Date(), env = process.env, plaid = null
} = {}) {
  if (!isUuid(orgId) || !isUuid(affiliateId)) return refuse(400, SEAM_REASONS.BAD_REQUEST, "org and affiliate are required");
  const p = plaid || { linkAccount, getAccounts };

  const aff = (await db.query(`SELECT id FROM affiliates WHERE id = $1 AND org_id = $2`, [affiliateId, orgId])).rows[0];
  if (!aff) return refuse(404, "affiliate_not_found", "That affiliate is not on file.");

  const linked = await p.linkAccount({ clientId: affiliateId, publicToken, env });
  if (!linked.ok) return refuse(linked.reason === SEAM_REASONS.NOT_CONFIGURED ? 503 : 502, linked.reason, "Plaid did not finish the bank link.", { detail: linked.error ?? null });
  const { plaidItemId, encryptedAccessToken, environment } = linked.item;

  const got = await p.getAccounts({ itemId: plaidItemId, encryptedAccessToken, env });
  if (!got.ok) return refuse(502, got.reason, "Plaid did not list the accounts.", { detail: got.error ?? null });

  const pick = pickPayoutAccount(got.accounts, accountId);
  if (pick.error) return refuse(409, pick.error, "Pick one checking or savings account for payouts.", { choices: pick.choices ?? [] });
  const a = pick.account;

  const baseName = institution && institution.name ? String(institution.name).slice(0, 200) : null;
  const institutionName = environment === "sandbox" ? `${baseName || "Plaid bank"} ${SANDBOX_LABEL}` : baseName;

  const row = await withTransaction(db, async (tx) => {
    await tx.query(
      `UPDATE affiliate_payout_accounts SET status = 'replaced', updated_at = now()
        WHERE affiliate_id = $1 AND org_id = $2 AND status = 'active'
          AND NOT (plaid_item_id = $3 AND plaid_account_id = $4)`,
      [affiliateId, orgId, plaidItemId, a.plaidAccountId]);
    return (await tx.query(
      `INSERT INTO affiliate_payout_accounts
         (org_id, affiliate_id, provider, environment, plaid_item_id, plaid_account_id,
          encrypted_access_token, institution_name, account_name, account_mask, account_subtype,
          status, consent_granted_at, linked_by)
       VALUES ($1,$2,'plaid',$3,$4,$5,$6,$7,$8,$9,$10,'active',$11,$12)
       ON CONFLICT (org_id, plaid_item_id, plaid_account_id)
       DO UPDATE SET encrypted_access_token = EXCLUDED.encrypted_access_token,
                     status = 'active', consent_granted_at = EXCLUDED.consent_granted_at,
                     updated_at = now()
       RETURNING id, environment, institution_name, account_name, account_mask, account_subtype, status`,
      [orgId, affiliateId, environment, plaidItemId, a.plaidAccountId, encryptedAccessToken,
       institutionName, a.name ?? null, a.mask ?? null, a.subtype ?? null, now, String(linkedBy).slice(0, 120)]
    )).rows[0];
  });

  return { ok: true, status: 200, account: shapeAccount(row) };
}

export function shapeAccount(r) {
  if (!r) return null;
  return {
    id: r.id,
    environment: r.environment,
    testData: r.environment !== "production",
    institution: r.institution_name || null,
    name: r.account_name || null,
    mask: r.account_mask || null,
    subtype: r.account_subtype || null,
    status: r.status
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   2. Sending a run through Plaid
   ═══════════════════════════════════════════════════════════════════════════ */

const PAYOUT_SQL = `
  SELECT p.id, p.org_id, p.affiliate_id, p.status, p.amount, p.hold_reason, p.method,
         p.plaid_transfer_id, p.plaid_transfer_status, p.rail_attempts, p.due_on,
         a.name AS affiliate_name, COALESCE(a.is_demo, false) AS is_demo,
         a.partner_license_signed_at, a.tax_form_received_at
    FROM affiliate_payouts p
    JOIN affiliates a ON a.id = p.affiliate_id
   WHERE p.id = $1 AND p.org_id = $2`;

const ACTIVE_ACCOUNT_SQL = `
  SELECT id, environment, plaid_item_id, plaid_account_id, encrypted_access_token,
         consent_granted_at, institution_name, account_name, account_mask, account_subtype, status
    FROM affiliate_payout_accounts
   WHERE affiliate_id = $1 AND org_id = $2 AND status = 'active'
   LIMIT 1`;

async function loadPayout(db, orgId, payoutId) {
  if (!isUuid(orgId) || !isUuid(payoutId)) return null;
  return (await db.query(PAYOUT_SQL, [payoutId, orgId])).rows[0] || null;
}

function gateRefusal(p) {
  if (!p.partner_license_signed_at) return refuse(409, "partner_license_unsigned", "This affiliate has not signed the partner license. The payout stays held.");
  if (!p.tax_form_received_at) return refuse(409, "tax_form_missing", "We have no tax form on file for this affiliate. The payout stays held.");
  return null;
}

/**
 * Send one pending run to the affiliate's linked bank through Plaid Transfer.
 * The claim (pending → processing) is one conditional UPDATE, so two staff
 * pressing Send at once cannot both send: the loser updates nothing.
 */
export async function sendPayoutViaPlaid(db, {
  orgId, payoutId, staff, env = process.env, provider = null, now = new Date()
} = {}) {
  const p = await loadPayout(db, orgId, payoutId);
  if (!p) return refuse(404, "payout_not_found", "That payout is not on file.");
  if (p.status !== "pending") return refuse(409, "payout_not_pending", `This payout is ${p.status}. Only a pending payout can be sent.`);
  const gate = gateRefusal(p);
  if (gate) return gate;

  const cents = toCents(p.amount);
  if (!(cents > 0)) return refuse(409, "nothing_to_pay", "This payout has no money on it.");

  const mode = transferMode(env);
  if (!mode.enabled && !provider) return refuse(409, mode.reason || "transfers_off", "Plaid payouts are switched off here. Pay by hand and use Mark paid.", { reason: mode.reason });
  const environment = mode.environment || "sandbox";
  if (environment !== "production" && !p.is_demo) {
    return refuse(409, "sandbox_test_affiliates_only",
      "Plaid is on test money only. A real affiliate cannot be paid with test money. Pay by hand and use Mark paid until Plaid gives live access.");
  }
  if (mode.perTransferCents !== null && mode.perTransferCents !== undefined && cents > mode.perTransferCents) {
    return refuse(409, "over_transfer_limit", "This payout is over the per-transfer limit.", { limitCents: mode.perTransferCents });
  }

  const acct = (await db.query(ACTIVE_ACCOUNT_SQL, [p.affiliate_id, orgId])).rows[0];
  if (!acct) return refuse(409, "no_bank_linked", "This affiliate has not linked a bank for payouts.");
  if (acct.environment !== environment) {
    return refuse(409, "bank_link_wrong_environment", `The affiliate's bank was linked on Plaid ${acct.environment}, but payouts run on ${environment}. They need to link again.`);
  }

  const approvedBy = actorLabel(staff);
  const claimed = (await db.query(
    `UPDATE affiliate_payouts
        SET status = 'processing', method = $3, approved_at = $4, approved_by = $5,
            payout_account_id = $6, rail_environment = $7, rail_attempts = rail_attempts + 1,
            rail_failure = NULL, plaid_authorization_id = NULL, plaid_transfer_id = NULL,
            plaid_transfer_status = NULL, updated_at = now()
      WHERE id = $1 AND org_id = $2 AND status = 'pending'
      RETURNING rail_attempts`,
    [payoutId, orgId, PLAID_METHOD, now, approvedBy, acct.id, environment])).rows[0];
  if (!claimed) return refuse(409, "payout_not_pending", "Someone else is already sending this payout.");

  const rail = provider || plaidTransferProvider({ env, environment });
  const account = {
    plaid_account_id: acct.plaid_account_id,
    entity_kind: "unknown",
    item: {
      plaid_item_id: acct.plaid_item_id,
      encrypted_access_token: acct.encrypted_access_token,
      link_state: "active",
      consent_granted_at: acct.consent_granted_at
    }
  };

  const backToPending = async (why) => {
    await db.query(
      `UPDATE affiliate_payouts SET status = 'pending', rail_failure = $3, updated_at = now()
        WHERE id = $1 AND org_id = $2 AND status = 'processing' AND plaid_transfer_id IS NULL`,
      [payoutId, orgId, String(why).slice(0, 300)]);
  };

  const auth = await rail.authorizeLeg({
    type: "credit", account, amountCents: cents, network: "ach",
    legalName: String(p.affiliate_name || "Fundhub affiliate").slice(0, 100),
    idempotencyKey: attemptKey(payoutId, claimed.rail_attempts)
  });
  if (!auth.ok) {
    await backToPending(`authorization failed: ${auth.errorCode || auth.reason || "unknown"}`);
    return refuse(502, "plaid_authorization_failed", "Plaid did not approve the payout. It is back to pending.", { detail: auth.error ?? auth.reason });
  }
  if (auth.decision !== "approved") {
    await backToPending(`authorization ${auth.decision}: ${auth.rationaleCode || ""} ${auth.rationaleDescription || ""}`.trim());
    return refuse(409, "plaid_declined", "Plaid declined the payout. It is back to pending.", { decision: auth.decision, rationale: auth.rationaleCode ?? null });
  }
  await db.query(`UPDATE affiliate_payouts SET plaid_authorization_id = $3, updated_at = now() WHERE id = $1 AND org_id = $2`,
    [payoutId, orgId, auth.authorizationId]);

  const made = await rail.createLeg({
    account, authorizationId: auth.authorizationId, amountCents: cents,
    description: PAYOUT_DESCRIPTION, metadata: { affiliate_payout_id: payoutId }
  });
  if (!made.ok) {
    await backToPending(`transfer create failed: ${made.errorCode || made.reason || "unknown"}`);
    return refuse(502, "plaid_transfer_failed", "Plaid did not create the transfer. It is back to pending.", { detail: made.error ?? made.reason });
  }

  await db.query(
    `UPDATE affiliate_payouts
        SET plaid_transfer_id = $3, plaid_transfer_status = $4, rail_synced_at = $5, updated_at = now()
      WHERE id = $1 AND org_id = $2`,
    [payoutId, orgId, made.transferId, made.status || "pending", now]);

  return { ok: true, status: 200, payoutId, transferId: made.transferId, transferStatus: made.status || "pending", environment };
}

/**
 * Ask Plaid what happened to every run in flight. Settled → paid. Dead → back
 * to pending with the reason. A late return on a run already paid is recorded
 * on the row (the run stays frozen) and the pulse turns red on it.
 */
export async function syncPayoutTransfers(db, { env = process.env, provider = null, now = new Date(), limit = 200 } = {}) {
  const rows = (await db.query(
    `SELECT p.id, p.org_id, p.status, p.rail_environment, p.plaid_transfer_id, p.plaid_transfer_status
       FROM affiliate_payouts p
      WHERE p.method = $1 AND p.plaid_transfer_id IS NOT NULL
        AND (p.status = 'processing'
             OR (p.status = 'paid' AND p.paid_at > $2::timestamptz
                 AND COALESCE(p.plaid_transfer_status, '') NOT IN ('returned', 'failed')))
      ORDER BY p.rail_synced_at NULLS FIRST
      LIMIT $3`,
    [PLAID_METHOD, new Date(now.getTime() - 70 * 24 * 60 * 60 * 1000), limit])).rows;

  const out = { checked: 0, paid: 0, failed: 0, returnedAfterPaid: 0, unchanged: 0, errors: [] };
  for (const r of rows) {
    out.checked += 1;
    const rail = provider || plaidTransferProvider({ env, environment: r.rail_environment || "sandbox" });
    const got = await rail.getLeg(r.plaid_transfer_id);
    if (!got.ok) { out.errors.push({ payoutId: r.id, error: got.errorCode || got.reason }); continue; }
    const t = got.transfer || {};
    const status = String(t.status || "").toLowerCase() || null;
    const outcome = railOutcome(status);
    const failure = t.failureReason
      ? [t.failureReason.achReturnCode, t.failureReason.description].filter(Boolean).join(" ").slice(0, 300)
      : null;

    if (r.status === "paid") {
      if (outcome === "failed") {
        await db.query(
          `UPDATE affiliate_payouts SET plaid_transfer_status = $2, rail_failure = $3, rail_synced_at = $4, updated_at = now()
            WHERE id = $1 AND status = 'paid'`,
          [r.id, status, failure || `transfer ${status} after it settled`, now]);
        out.returnedAfterPaid += 1;
      } else {
        await db.query(`UPDATE affiliate_payouts SET plaid_transfer_status = $2, rail_synced_at = $3 WHERE id = $1`, [r.id, status, now]);
        out.unchanged += 1;
      }
      continue;
    }

    if (outcome === "paid") {
      await db.query(
        `UPDATE affiliate_payouts
            SET plaid_transfer_status = $2, status = 'paid', paid_at = $3,
                external_ref = COALESCE(external_ref, plaid_transfer_id), rail_synced_at = $3, updated_at = now()
          WHERE id = $1 AND status = 'processing'`,
        [r.id, status, now]);
      out.paid += 1;
    } else if (outcome === "failed") {
      await db.query(
        `UPDATE affiliate_payouts
            SET status = 'pending', plaid_transfer_status = $2, rail_failure = $3,
                plaid_transfer_id = NULL, plaid_authorization_id = NULL, rail_synced_at = $4, updated_at = now()
          WHERE id = $1 AND status = 'processing'`,
        [r.id, status, `transfer ${t.id || r.plaid_transfer_id} ${status}${failure ? `: ${failure}` : ""}`.slice(0, 300), now]);
      out.failed += 1;
    } else {
      await db.query(`UPDATE affiliate_payouts SET plaid_transfer_status = $2, rail_synced_at = $3 WHERE id = $1`, [r.id, status, now]);
      out.unchanged += 1;
    }
  }
  return out;
}

/* ═══════════════════════════════════════════════════════════════════════════
   3. Paid by hand, hold, release, void
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Record a payout made outside Plaid (ACH from the bank, wire, cheque). Needs
 * a reference. pending → processing → paid inside one transaction, because 033
 * allows nothing shorter.
 */
export async function markPayoutPaid(db, {
  orgId, payoutId, method, externalRef, paidAt = null, staff, now = new Date()
} = {}) {
  const m = String(method || "").trim().toLowerCase();
  if (!MANUAL_METHODS.includes(m)) return refuse(400, "method_required", `How was it paid? One of: ${MANUAL_METHODS.join(", ")}.`);
  const ref = String(externalRef || "").trim();
  if (!ref) return refuse(400, "reference_required", "Add the bank trace number, wire number or cheque number.");
  if (ref.length > 200) return refuse(400, "reference_too_long", "The reference is too long.");
  let when = now;
  if (paidAt) {
    when = new Date(paidAt);
    if (Number.isNaN(when.getTime())) return refuse(400, "bad_paid_at", "That paid date is not a date.");
    if (when.getTime() > now.getTime() + 5 * 60 * 1000) return refuse(400, "paid_at_in_future", "The paid date cannot be in the future.");
  }

  const p = await loadPayout(db, orgId, payoutId);
  if (!p) return refuse(404, "payout_not_found", "That payout is not on file.");
  if (p.status === "paid") return refuse(409, "already_paid", "This payout is already paid.");
  if (p.status !== "pending") return refuse(409, "payout_not_pending", `This payout is ${p.status}. Only a pending payout can be marked paid.`);
  const gate = gateRefusal(p);
  if (gate) return gate;

  const by = actorLabel(staff);
  const row = await withTransaction(db, async (tx) => {
    const step = (await tx.query(
      `UPDATE affiliate_payouts
          SET status = 'processing', method = $3, approved_at = $4, approved_by = $5, updated_at = now()
        WHERE id = $1 AND org_id = $2 AND status = 'pending'
        RETURNING id`, [payoutId, orgId, m, now, by])).rows[0];
    if (!step) return null;
    return (await tx.query(
      `UPDATE affiliate_payouts
          SET status = 'paid', external_ref = $3, paid_at = $4, updated_at = now(),
              notes = concat_ws(E'\\n', notes, $5::text)
        WHERE id = $1 AND org_id = $2 AND status = 'processing'
        RETURNING id, status, method, external_ref, paid_at`,
      [payoutId, orgId, ref, when, `Marked paid by ${by}.`])).rows[0];
  });
  if (!row) return refuse(409, "payout_not_pending", "Someone else changed this payout first.");
  return { ok: true, status: 200, payout: row };
}

export async function holdPayout(db, { orgId, payoutId, reason, staff } = {}) {
  const why = String(reason || "").trim();
  if (!why) return refuse(400, "reason_required", "Say why it is on hold.");
  const row = (await db.query(
    `UPDATE affiliate_payouts SET status = 'held', hold_reason = $3, updated_at = now(),
            notes = concat_ws(E'\\n', notes, $4::text)
      WHERE id = $1 AND org_id = $2 AND status = 'pending'
      RETURNING id, status, hold_reason`,
    [payoutId, orgId, why.slice(0, 200), `Held by ${actorLabel(staff)}.`])).rows[0];
  if (!row) return refuse(409, "payout_not_pending", "Only a pending payout can be put on hold.");
  return { ok: true, status: 200, payout: row };
}

/** held → pending, only when the gates are now open. */
export async function releasePayout(db, { orgId, payoutId, staff } = {}) {
  const p = await loadPayout(db, orgId, payoutId);
  if (!p) return refuse(404, "payout_not_found", "That payout is not on file.");
  if (p.status !== "held") return refuse(409, "payout_not_held", `This payout is ${p.status}, not held.`);
  const gate = gateRefusal(p);
  if (gate) return gate;
  const row = (await db.query(
    `UPDATE affiliate_payouts SET status = 'pending', hold_reason = NULL, updated_at = now(),
            notes = concat_ws(E'\\n', notes, $3::text)
      WHERE id = $1 AND org_id = $2 AND status = 'held'
      RETURNING id, status`,
    [payoutId, orgId, `Released by ${actorLabel(staff)}.`])).rows[0];
  if (!row) return refuse(409, "payout_not_held", "Someone else changed this payout first.");
  return { ok: true, status: 200, payout: row };
}

/** pending/held → void. Its lines are detached so the referrals go back to
 *  owed and the next run picks them up; a void run carries no money. */
export async function voidPayout(db, { orgId, payoutId, reason, staff } = {}) {
  const why = String(reason || "").trim();
  if (!why) return refuse(400, "reason_required", "Say why it is cancelled.");
  const row = await withTransaction(db, async (tx) => {
    const r = (await tx.query(
      `UPDATE affiliate_payouts SET status = 'void', void_reason = $3, updated_at = now(),
              notes = concat_ws(E'\\n', notes, $4::text)
        WHERE id = $1 AND org_id = $2 AND status IN ('pending', 'held')
        RETURNING id, status, void_reason`,
      [payoutId, orgId, why.slice(0, 200), `Cancelled by ${actorLabel(staff)}.`])).rows[0];
    if (!r) return null;
    await tx.query(`DELETE FROM affiliate_payout_lines WHERE payout_id = $1 AND org_id = $2`, [payoutId, orgId]);
    return r;
  });
  if (!row) return refuse(409, "payout_not_voidable", "Only a pending or held payout can be cancelled. Money in flight cannot.");
  return { ok: true, status: 200, payout: row };
}

/* ═══════════════════════════════════════════════════════════════════════════
   4. The two paperwork gates
   ═══════════════════════════════════════════════════════════════════════════ */

/* Held runs waiting on paperwork that is now in: release them. A run still
   missing the other paper keeps its hold with the new reason. */
async function releaseCleared(db, orgId, affiliateId) {
  const a = (await db.query(
    `SELECT partner_license_signed_at, tax_form_received_at FROM affiliates WHERE id = $1 AND org_id = $2`,
    [affiliateId, orgId])).rows[0];
  if (!a) return 0;
  if (a.partner_license_signed_at && a.tax_form_received_at) {
    return (await db.query(
      `UPDATE affiliate_payouts SET status = 'pending', hold_reason = NULL, updated_at = now()
        WHERE affiliate_id = $1 AND org_id = $2 AND status = 'held' AND hold_reason = ANY($3::text[])
        RETURNING id`,
      [affiliateId, orgId, Object.values(PAYOUT_DEFAULTS.heldReasons)])).rowCount || 0;
  }
  const next = !a.partner_license_signed_at ? PAYOUT_DEFAULTS.heldReasons.license : PAYOUT_DEFAULTS.heldReasons.tax;
  await db.query(
    `UPDATE affiliate_payouts SET hold_reason = $3, updated_at = now()
      WHERE affiliate_id = $1 AND org_id = $2 AND status = 'held' AND hold_reason = ANY($4::text[]) AND hold_reason <> $3`,
    [affiliateId, orgId, next, Object.values(PAYOUT_DEFAULTS.heldReasons)]);
  return 0;
}

/** Record the affiliate's tax form. Write-once date; a reference is required
 *  so the screen can point at the paper. */
export async function recordTaxForm(db, { orgId, affiliateId, ref, receivedAt = null, staff, now = new Date() } = {}) {
  const pointer = String(ref || "").trim();
  if (!pointer) return refuse(400, "reference_required", "Add where the tax form is (document id or e-sign envelope).");
  const when = receivedAt ? new Date(receivedAt) : now;
  if (Number.isNaN(when.getTime()) || when.getTime() > now.getTime() + 5 * 60 * 1000) return refuse(400, "bad_received_at", "That date is not right.");
  const row = (await db.query(
    `UPDATE affiliates SET tax_form_received_at = COALESCE(tax_form_received_at, $3),
            tax_form_ref = COALESCE(tax_form_ref, $4), updated_at = now()
      WHERE id = $1 AND org_id = $2
      RETURNING id, tax_form_received_at, tax_form_ref`,
    [affiliateId, orgId, when, pointer.slice(0, 200)])).rows[0];
  if (!row) return refuse(404, "affiliate_not_found", "That affiliate is not on file.");
  const released = await releaseCleared(db, orgId, affiliateId);
  return { ok: true, status: 200, affiliate: row, released, by: actorLabel(staff) };
}

/**
 * Stamp the partner license from a real signed PARTNER-LICENSE contract whose
 * frozen merge values name this affiliate (merge_values.affiliate_id). Same
 * rule as src/contracts/partner-license.mjs for white-label partners: no
 * document, no stamp. Write-once.
 */
export async function stampAffiliateLicense(db, { orgId, affiliateId } = {}) {
  const aff = (await db.query(
    `SELECT id, partner_license_signed_at FROM affiliates WHERE id = $1 AND org_id = $2`, [affiliateId, orgId])).rows[0];
  if (!aff) return refuse(404, "affiliate_not_found", "That affiliate is not on file.");
  const signed = (await db.query(
    `SELECT id, signed_at FROM contracts
      WHERE org_id = $1 AND template_key = 'PARTNER-LICENSE' AND status = 'signed'
        AND signed_at IS NOT NULL AND is_demo = false AND merge_values->>'affiliate_id' = $2::text
      ORDER BY signed_at ASC LIMIT 1`, [orgId, affiliateId])).rows[0];
  if (aff.partner_license_signed_at) {
    return { ok: true, status: 200, stamped: false, signedAt: aff.partner_license_signed_at, contractId: signed ? signed.id : null };
  }
  if (!signed) return refuse(409, "partner_license_not_signed", "This affiliate has not signed the partner license yet. Send it from the Contracts screen.");
  const row = (await db.query(
    `UPDATE affiliates SET partner_license_signed_at = $3, partner_license_ref = $4, updated_at = now()
      WHERE id = $1 AND org_id = $2 AND partner_license_signed_at IS NULL
      RETURNING partner_license_signed_at`, [affiliateId, orgId, signed.signed_at, `contract:${signed.id}`])).rows[0];
  const released = await releaseCleared(db, orgId, affiliateId);
  return { ok: true, status: 200, stamped: !!row, signedAt: row ? row.partner_license_signed_at : signed.signed_at, contractId: signed.id, released };
}

/* ═══════════════════════════════════════════════════════════════════════════
   5. The staff view
   ═══════════════════════════════════════════════════════════════════════════ */

export const PAYOUTS_VIEW_SQL = `
  SELECT p.id, p.affiliate_id, a.name AS affiliate_name, a.tracking_id,
         COALESCE(a.is_demo, false) AS is_demo,
         p.period_start, p.period_end, p.due_on, p.amount, p.currency, p.status,
         p.hold_reason, p.void_reason, p.method, p.external_ref, p.approved_at, p.approved_by,
         p.initiated_at, p.paid_at, p.rail_environment, p.plaid_transfer_id, p.plaid_transfer_status,
         p.rail_failure, p.rail_synced_at,
         (a.partner_license_signed_at IS NOT NULL) AS license_ok,
         (a.tax_form_received_at IS NOT NULL) AS tax_ok,
         acc.id AS account_id, acc.environment AS account_environment, acc.institution_name,
         acc.account_mask, acc.account_subtype,
         (SELECT count(*)::int FROM affiliate_payout_lines l WHERE l.payout_id = p.id) AS line_count
    FROM affiliate_payouts p
    JOIN affiliates a ON a.id = p.affiliate_id AND a.org_id = p.org_id
    LEFT JOIN affiliate_payout_accounts acc
      ON acc.affiliate_id = p.affiliate_id AND acc.org_id = p.org_id AND acc.status = 'active'
   WHERE p.org_id = $1
     AND ($2::text IS NULL OR p.status = $2::text)
   ORDER BY (p.status IN ('pending', 'held', 'processing')) DESC, p.due_on ASC NULLS LAST, p.created_at DESC
   LIMIT $3`;

const numOrNull = (v) => (v === null || v === undefined || v === "" ? null : (Number.isFinite(Number(v)) ? Number(v) : null));

export function shapePayoutRow(r, today) {
  const open = ["pending", "held", "processing"].includes(r.status);
  const due = r.due_on ? (r.due_on instanceof Date ? r.due_on.toISOString().slice(0, 10) : String(r.due_on).slice(0, 10)) : null;
  return {
    id: r.id,
    affiliate: { id: r.affiliate_id, name: r.affiliate_name, code: r.tracking_id, test: !!r.is_demo },
    periodStart: r.period_start,
    periodEnd: r.period_end,
    dueOn: due,
    overdue: open && due !== null && due < today,
    amount: numOrNull(r.amount),
    currency: r.currency,
    status: r.status,
    holdReason: r.hold_reason || null,
    voidReason: r.void_reason || null,
    method: r.method || null,
    reference: r.external_ref || null,
    approvedAt: r.approved_at, approvedBy: r.approved_by || null,
    paidAt: r.paid_at,
    plaid: r.plaid_transfer_id || r.rail_environment
      ? { environment: r.rail_environment || null, transferId: r.plaid_transfer_id || null, status: r.plaid_transfer_status || null, failure: r.rail_failure || null, syncedAt: r.rail_synced_at }
      : (r.rail_failure ? { environment: null, transferId: null, status: null, failure: r.rail_failure, syncedAt: null } : null),
    gates: { license: !!r.license_ok, tax: !!r.tax_ok },
    bank: r.account_id ? {
      environment: r.account_environment, testData: r.account_environment !== "production",
      institution: r.institution_name || null, mask: r.account_mask || null, subtype: r.account_subtype || null
    } : null,
    lines: r.line_count
  };
}

export async function payoutsView(db, { orgId, status = null, limit = 200, now = new Date(), env = process.env } = {}) {
  const allowed = ["pending", "held", "processing", "paid", "void"];
  const s = status && allowed.includes(status) ? status : null;
  const rows = (await db.query(PAYOUTS_VIEW_SQL, [orgId, s, Math.min(Math.max(Number(limit) || 200, 1), 500)])).rows;
  const today = now.toISOString().slice(0, 10);
  const mode = transferMode(env);
  const payouts = rows.map((r) => shapePayoutRow(r, today));
  return {
    rail: { enabled: mode.enabled, environment: mode.environment, live: mode.live, reason: mode.reason, perTransferCents: mode.perTransferCents },
    dueRule: `Due on the 15th of the month after the month earned (period end + ${DUE_DAYS_AFTER_PERIOD} days).`,
    counts: {
      pending: payouts.filter((p) => p.status === "pending").length,
      held: payouts.filter((p) => p.status === "held").length,
      processing: payouts.filter((p) => p.status === "processing").length,
      overdue: payouts.filter((p) => p.overdue).length
    },
    payouts
  };
}

export default {
  dueOnFor, attemptKey, railOutcome, pickPayoutAccount,
  startAffiliateBankLink, completeAffiliateBankLink,
  sendPayoutViaPlaid, syncPayoutTransfers,
  markPayoutPaid, holdPayout, releasePayout, voidPayout,
  recordTaxForm, stampAffiliateLicense, payoutsView
};
