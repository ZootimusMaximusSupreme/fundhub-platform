// Staff commission alerts — COMPLIANCE REVIEW REQUIRED (payout / commission timing).
//
// 5B.5 Mark paid → email the staff member (Resend, like invite mail).
// 5B.6 Deal close → short SMS win ping to closer + sales manager on the sale.
//
// Does NOT move money. Mark paid still only records the payout.

import { renderTemplate } from "../lib/render-template.mjs";
import { isDraftTemplateRow } from "../messaging/draft-guard.mjs";
import { send as sendResend } from "../messaging/providers/resend.mjs";
import { sendNativeToStaff } from "../push/native-send.mjs";

export const EMAIL_COMMISSION_PAID = "EMAIL-COMMISSION-PAID";
export const SMS_DEAL_CLOSE_WIN = "SMS-DEAL-CLOSE-WIN";
export const DEAL_CLOSE_ROLES = Object.freeze(["closer", "sales_manager"]);

function clean(v) {
  if (v == null) return "";
  return String(v).trim();
}

function firstName(name) {
  const n = clean(name);
  if (!n) return "there";
  return n.split(/\s+/)[0] || "there";
}

function amountDisplay(amount, currency = "USD") {
  const n = Number(amount);
  if (!Number.isFinite(n)) return clean(amount) || "—";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD"
    }).format(n);
  } catch {
    return `$${n.toFixed(2)}`;
  }
}

export function buildPayoutEmailContext({
  staff = {},
  amount,
  currency = "USD",
  payoutRef = "",
  payoutRail = "ACH"
} = {}) {
  return {
    staff_first_name: firstName(staff.name),
    staff_name: clean(staff.name) || "teammate",
    amount_display: amountDisplay(amount, currency),
    payout_ref: clean(payoutRef) || "—",
    payout_rail: clean(payoutRail) || "ACH"
  };
}

export function buildDealCloseBody({ staff = {}, client = {}, amount } = {}) {
  const who = firstName(staff.name);
  const clientName = clean([client.first_name, client.last_name].filter(Boolean).join(" "))
    || clean(client.name)
    || "a client";
  const lines = [
    `🔥 ${who} — you closed it.`,
    "",
    clientName
  ];
  if (amount != null && amount !== "") {
    lines.push(amountDisplay(amount));
  }
  lines.push("");
  lines.push("Nice work. Check the ledger when you're ready.");
  return lines.join("\n");
}

export async function notifyCommissionPaid(db, event, { fetchImpl, env } = {}) {
  const orgId = event?.orgId;
  const p = event?.payload || {};
  const staffId = p.staff_id || p.staffId;
  const ledgerId = p.ledger_id || p.ledgerId;
  if (!orgId || !staffId) return { mailed: false, reason: "missing_ids" };

  const staffRes = await db.query(
    `SELECT id, name, email, role, status
       FROM staff
      WHERE id = $1::uuid AND org_id = $2::uuid
      LIMIT 1`,
    [staffId, orgId]
  );
  const staff = staffRes.rows[0];
  if (!staff || staff.status !== "active") return { mailed: false, reason: "no_staff" };
  const to = clean(staff.email).toLowerCase();
  if (!to || !to.includes("@")) return { mailed: false, reason: "no_email" };

  const tpl = await db.query(
    `SELECT body, subject, compliance_passed
       FROM message_templates
      WHERE org_id = $1 AND template_key = $2
      LIMIT 1`,
    [orgId, EMAIL_COMMISSION_PAID]
  );
  const row = tpl.rows[0];
  if (!row || isDraftTemplateRow(row) || !row.compliance_passed) {
    return { mailed: false, reason: "template_pending" };
  }

  const ctx = buildPayoutEmailContext({
    staff,
    amount: p.amount,
    currency: p.currency || "USD",
    payoutRef: p.payout_ref || p.payoutRef,
    payoutRail: p.payout_rail || p.payoutRail || "ACH"
  });
  const subject = renderTemplate(row.subject || "You got paid", ctx);
  const body = renderTemplate(row.body, ctx);

  const out = await sendResend(
    { to, subject, body },
    { fetchImpl, env: env || process.env }
  );
  if (out && out.status === "sent") {
    return {
      mailed: true,
      to,
      ledgerId: ledgerId || null,
      staffId
    };
  }
  return {
    mailed: false,
    reason: (out && out.error) || "send_failed",
    to,
    staffId
  };
}

// A paid ledger event is the only trigger. The client id is needed by the
// existing staff push receipt and native tap path; never substitute another
// person's client or send for an unassociated manual ledger line.
export async function notifyCommissionPaidPush(db, event, { pushImpl = sendNativeToStaff } = {}) {
  const orgId = event?.orgId;
  const clientId = event?.clientId;
  const payload = event?.payload || {};
  const staffId = payload.staff_id || payload.staffId;
  const ledgerId = payload.ledger_id || payload.ledgerId;
  if (!orgId || !staffId || !ledgerId || !clientId) {
    return { sent: 0, reason: "missing_ids" };
  }
  const recipient = (await db.query(
    `SELECT s.id FROM staff s
      WHERE s.id=$1 AND s.org_id=$2 AND s.status='active'
        AND lower(btrim(s.role)) NOT IN
          ('owner','admin','partner','client','affiliate','outbound_rep')
        AND (lower(btrim(s.role)) IN ('closer','sales_manager') OR EXISTS (
          SELECT 1 FROM staff_role_assignments a
          JOIN staff_roles sr ON sr.id=a.role_id AND sr.org_id=a.org_id
          WHERE a.staff_id=s.id AND a.org_id=s.org_id AND sr.active
            AND sr.key IN ('closer','sales_manager')))`,
    [staffId, orgId]
  )).rows[0];
  if (!recipient) return { sent: 0, reason: "not_eligible" };
  return pushImpl(db, {
    orgId, staffId, clientId, kind: "payout", key: `commission.paid:${ledgerId}`
  });
}

async function resolveSaleId(db, event) {
  const p = event?.payload || {};
  if (p.saleId || p.sale_id) return p.saleId || p.sale_id;
  const orgId = event.orgId;
  const clientId = event.clientId;
  if (!orgId || !clientId) return null;
  if (p.paymentLinkId || p.payment_link_id) {
    const link = await db.query(
      `SELECT sale_id FROM payment_links
        WHERE id = $1::uuid AND org_id = $2::uuid AND client_id = $3::uuid
        LIMIT 1`,
      [p.paymentLinkId || p.payment_link_id, orgId, clientId]
    );
    if (link.rows[0]?.sale_id) return link.rows[0].sale_id;
  }
  const sale = await db.query(
    `SELECT id FROM sales
      WHERE org_id = $1::uuid AND client_id = $2::uuid
      ORDER BY sold_at DESC NULLS LAST, created_at DESC
      LIMIT 1`,
    [orgId, clientId]
  );
  return sale.rows[0]?.id || null;
}

export async function recipientsForSale(db, { orgId, saleId, event } = {}) {
  const seen = new Set();
  const out = [];
  const push = (row) => {
    if (!row?.id || seen.has(row.id)) return;
    const phone = clean(row.phone);
    if (!phone) return;
    const role = String(row.role || "").toLowerCase();
    if (!DEAL_CLOSE_ROLES.includes(role)) return;
    if (row.status && row.status !== "active") return;
    seen.add(row.id);
    out.push({ id: row.id, role, phone, name: row.name, email: row.email });
  };

  if (saleId) {
    const attributed = await db.query(
      `SELECT s.id, s.name, s.email, s.phone, s.role, s.status, sa.role AS attr_role
         FROM sale_attributions sa
         JOIN staff s ON s.id = sa.staff_id
        WHERE sa.org_id = $1::uuid
          AND sa.sale_id = $2::uuid
          AND lower(sa.role) = ANY($3::text[])`,
      [orgId, saleId, DEAL_CLOSE_ROLES]
    );
    for (const row of attributed.rows) {
      push({ ...row, role: row.attr_role || row.role });
    }
  }

  const p = event?.payload || {};
  for (const [id, role] of [
    [p.closerId || p.closer_staff_id, "closer"],
    [p.salesManagerId || p.sales_manager_staff_id, "sales_manager"]
  ]) {
    if (!id || seen.has(id)) continue;
    const r = await db.query(
      `SELECT id, name, email, phone, role, status
         FROM staff WHERE id = $1::uuid AND org_id = $2::uuid LIMIT 1`,
      [id, orgId]
    );
    if (r.rows[0]) push({ ...r.rows[0], role });
  }

  return out;
}

export async function notifyDealCloseWin(db, event) {
  const orgId = event?.orgId;
  const clientId = event?.clientId;
  const eventId = event?.id;
  if (!orgId || !eventId) return { queued: 0, reason: "missing_ids" };

  const tpl = await db.query(
    `SELECT body, subject, compliance_passed
       FROM message_templates
      WHERE org_id = $1 AND template_key = $2
      LIMIT 1`,
    [orgId, SMS_DEAL_CLOSE_WIN]
  );
  const row = tpl.rows[0];
  if (!row || isDraftTemplateRow(row) || !row.compliance_passed) {
    return { queued: 0, reason: "template_pending" };
  }

  const saleId = await resolveSaleId(db, event);
  const people = await recipientsForSale(db, { orgId, saleId, event });
  if (!people.length) return { queued: 0, reason: "no_recipients" };

  let client = {};
  if (clientId) {
    const cr = await db.query(
      `SELECT first_name, last_name, email, phone
         FROM clients WHERE id = $1 AND org_id = $2 LIMIT 1`,
      [clientId, orgId]
    );
    client = cr.rows[0] || {};
  }

  const amount = event?.payload?.amount ?? event?.payload?.paidAmount ?? null;
  let queued = 0;
  for (const person of people) {
    const body = renderTemplate(row.body, {
      alert_body: buildDealCloseBody({ staff: person, client, amount })
    });
    const providerRef = `workflow:${SMS_DEAL_CLOSE_WIN}:${eventId}:${person.id}`;
    const ins = await db.query(
      `INSERT INTO messages (org_id, client_id, direction, channel, template_key, rendered_body, provider, provider_ref, status, compliance_check_passed, to_address)
       VALUES ($1,$2,'outbound','sms',$3,$4,'internal',$5,'queued',true,$6)
       ON CONFLICT (org_id, provider_ref) WHERE provider_ref IS NOT NULL DO NOTHING
       RETURNING id`,
      [orgId, clientId || null, SMS_DEAL_CLOSE_WIN, body, providerRef, person.phone]
    );
    if (ins.rows[0]) queued += 1;
  }
  return { queued, saleId: saleId || null };
}
