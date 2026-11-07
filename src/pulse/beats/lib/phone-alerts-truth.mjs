// Phone alerts — did the push a client was promised actually go out? Read only. Report only.
//
// Unit D of the Finance OS CFO build (ops/workflows/finance-os-cfo-build-2026-11-06.txt, spec item 1,
// owner-set 2026-11-06: "MOST IMPORTANT"). One id, one yes-or-no: alerts:phone-alerts-went-out.
// It asks two questions:
//   1. OWED. For every Finance OS or Capital Blueprint client who has a phone set up for alerts, has
//      phone alerts on and never said STOP: every card due in 0 to 3 days with no payment on file (any
//      credit card, personal or business, and a credit line), every loan due in 0 to 3 days, every bill
//      they marked Important that charges in 0 to 3 days, every payment-plan installment owed to
//      Fundhub due in 0 to 3 days, every Whop plan Whop charges in 0 to 3 days (unit W, planWhopPush
//      in ./whop-plan-push.mjs), and every alert or repeat bill the client added by hand with its
//      phone alert on and its date in 0 to 3 days (unit AL2, 2026-11-07), at the daily pass's last run
//      — is there a queued phone alert row? "Owed" is decided by the pass's OWN planners
//      (planCardDuePush, planBillPush in src/finance/file-alerts/phone-alerts.mjs), on the pass's own
//      date, so this check and the pass cannot disagree.
//   2. WENT OUT. Every finance phone alert row from the last few days (card due, statement close and
//      important bill): sent, or still waiting for its hour, or stopped by the client — not failed,
//      stuck in the queue, or sent with an unknown outcome.
//
// RULES (heartbeat law): SELECT only. No push, no text, no web call. A failed read is a skip with the
// reason, never a PASS. Test traffic (demo flag, synthetic client, test address) is left out. Under
// 20 seconds: five small reads, each capped.
//
// ONE JUDGE, TWO CLOCKS. The morning lane (src/pulse/coverage/gap-phone-alerts.mjs, a thin adapter) and
// the hourly beat money-alerts run this file. A file in src/pulse/beats/lib may import only from this
// folder, so the planner is ./phone-alert-plan.mjs (the daily pass re-exports it) and two values are
// carried here: the Blueprint product code and the paid status. gap-phone-alerts.test.mjs holds both
// equal to their sources. The database is handed in as io.db (anything with query(sql, params)).

import { TEST_ADDRESS_RE } from "./alerts-truth.mjs";
import {
  planCardDuePush, planBillPush, planLoanDuePush, planInstallmentPush, pushRef, kindOfTemplate, eventDateOfKey,
  PUSH_TEMPLATE_PREFIX, PUSH_REF_PREFIX
} from "./phone-alert-plan.mjs";
import { planCustomPush } from "./custom-alert-plan.mjs";
import { planWhopPush } from "./whop-plan-push.mjs";

export const CHECK_IDS = Object.freeze(["alerts:phone-alerts-went-out"]);
const ID = CHECK_IDS[0];

export const FINANCE_OS_TIER = "finance-os";
/** src/config/offers.mjs OFFERS.UWIQ_DELIVERABLES.productCode (the Capital Blueprint). Carried, see above. */
export const BLUEPRINT_PRODUCT_CODE = "consulting-package";
/** src/entitlements/entitlements.mjs PAID_TRANSACTION_STATUS. Carried, see above. */
export const PAID_TRANSACTION_STATUS = "succeeded";
/** The daily pass runs at 07:30 UTC (src/workflows/blueprint-finance-os-alerts.mjs). It is judged an hour after. */
export const PASS_MINUTE_UTC = 7 * 60 + 30;
export const PASS_GRACE_MINUTES = 60;
/** Finance phone alert rows are read for this long. */
export const LOOKBACK_DAYS = 3;
/** A queued row whose hour came this long ago and is still queued is stuck. */
export const STUCK_HOURS = 2;
/** A row left 'sending' this long: the phone pipes never answered, and it is never retried. */
export const UNKNOWN_MINUTES = 30;

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const TAIL = "Do not send from this check. Do not re-run the pass from here. Do not resend an unknown outcome.";

function row(status, detail, suggestedFix = null) {
  return { id: ID, status, detail, suggestedFix };
}
function plural(n, one, many) { return n === 1 ? one : many; }
function clip(value, max = 120) {
  const s = String(value == null ? "" : value).replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
function toMs(v) {
  if (v == null || v === "") return null;
  const ms = v instanceof Date ? v.getTime() : Date.parse(String(v));
  return Number.isFinite(ms) ? ms : null;
}
async function readRows(db, sql, params) {
  try {
    const got = await db.query(sql, params);
    return { rows: got && Array.isArray(got.rows) ? got.rows : null };
  } catch (err) {
    return { error: clip((err && err.message) || err, 160) };
  }
}

/** The UTC date of the daily pass's last run that has had its grace hour. Pure. */
export function lastPassDate(now) {
  return new Date(now.getTime() - (PASS_MINUTE_UTC + PASS_GRACE_MINUTES) * MIN).toISOString().slice(0, 10);
}

// ── reads ────────────────────────────────────────────────────────────────────

/**
 * $1 org, $2 as-of, $3 TEST_ADDRESS_RE, $4 Blueprint product code, $5 paid status.
 * The clients the daily pass would queue phone alerts for: in its audience (an active Finance OS
 * subscription, or a paid Capital Blueprint), real, with a phone set up for alerts (the same join
 * src/push/finance-alerts.mjs PHONE_STATE_SQL uses), phone alerts not switched off, no STOP.
 */
export const PHONE_CLIENTS_SQL = `
SELECT c.id AS client_id
  FROM clients c
 WHERE c.org_id = $1::uuid
   AND COALESCE(c.is_demo, false) = false
   AND COALESCE(c.custom_fields ->> 'synthetic', '') <> 'true'
   AND COALESCE(c.email, '') !~* $3::text
   AND (
        EXISTS (SELECT 1 FROM subscriptions s
                 WHERE s.client_id = c.id AND s.org_id = c.org_id
                   AND s.tier = '${FINANCE_OS_TIER}' AND s.status = 'active'
                   AND s.effective_from <= $2::timestamptz
                   AND (s.effective_to IS NULL OR s.effective_to > $2::timestamptz))
     OR EXISTS (SELECT 1 FROM transactions t
                  JOIN products p ON p.id = resolve_product_id(t.org_id, t.product_name)
                 WHERE t.client_id = c.id AND t.org_id = c.org_id
                   AND lower(p.code) = lower($4::text)
                   AND lower(btrim(COALESCE(t.status, ''))) = $5::text)
   )
   AND NOT EXISTS (SELECT 1 FROM file_protection_settings fs
                    WHERE fs.client_id = c.id AND fs.org_id = c.org_id AND fs.phone_alerts = false)
   AND NOT EXISTS (SELECT 1 FROM opt_outs o
                    WHERE o.client_id = c.id AND o.org_id = c.org_id
                      AND o.channel IN ('sms', 'push') AND o.opted_in_at IS NULL)
   AND (
        EXISTS (SELECT 1 FROM client_apns_devices d
                  JOIN accounts a ON a.id = d.account_id AND a.org_id = d.org_id AND a.status = 'active'
                  JOIN account_sessions se ON se.id = d.session_id AND se.account_id = d.account_id
                   AND se.org_id = d.org_id AND se.revoked_at IS NULL AND se.expires_at > now()
                 WHERE d.org_id = c.org_id AND d.client_id = c.id
                   AND d.expired_at IS NULL AND d.revoked_at IS NULL
                   AND ((a.kind = 'client' AND a.client_id = d.client_id)
                     OR (a.kind = 'authorized_rep' AND se.active_client_id = d.client_id)))
     OR EXISTS (SELECT 1 FROM client_push_subscriptions ps
                 WHERE ps.org_id = c.org_id AND ps.client_id = c.id
                   AND ps.expired_at IS NULL AND ps.revoked_at IS NULL)
   )
 LIMIT 500`.trim();

/** $1 org, $2 client ids. Open credit cards and loans with their statement cycle (the rows planCardDue
 *  and planLoanDue read), with the subtype that tells a line of credit. */
export const PHONE_CARDS_SQL = `
SELECT c.client_id, c.bank_account_id, c.minimum_payment_cents, c.last_statement_balance_cents,
       c.last_statement_date::text AS last_statement_date, c.payment_due_day, c.raw,
       a.name, a.mask, a.account_type, a.account_subtype, a.current_balance_cents
  FROM account_statement_cycles c
  JOIN bank_accounts a ON a.id = c.bank_account_id AND a.org_id = c.org_id
 WHERE c.org_id = $1::uuid
   AND c.client_id = ANY($2::uuid[])
   AND a.account_type IN ('credit', 'loan')
   AND a.closed_at IS NULL
 LIMIT 2000`.trim();

/** $1 org, $2 client ids. Each open payment plan owed to Fundhub: its next unpaid installment. */
export const PHONE_PLANS_SQL = `
SELECT DISTINCT ON (p.id) p.id AS plan_id, p.client_id, p.kind, p.owed_to, p.label,
       i.id AS installment_id, i.seq, i.due_on::text AS due_on, (i.amount_cents - i.paid_cents) AS left_cents
  FROM clarity_payments p
  JOIN clarity_payment_installments i ON i.clarity_payment_id = p.id
 WHERE p.org_id = $1::uuid
   AND p.client_id = ANY($2::uuid[])
   AND p.status = 'open'
   AND i.paid_cents < i.amount_cents
 ORDER BY p.id, i.seq
 LIMIT 2000`.trim();

/** $1 org, $2 client ids. Each open Whop plan that can still charge (unit W, whop_memberships):
 *  the rows planWhopPush reads. */
export const PHONE_WHOP_SQL = `
SELECT w.id, w.client_id, w.product_title, w.status, w.renewal_cents, w.split_pay_required, w.split_pay_paid,
       w.cancel_at_period_end, w.period_end_on::text AS period_end_on, w.current_period_end, w.unlinked_at
  FROM whop_memberships w
 WHERE w.org_id = $1::uuid
   AND w.client_id = ANY($2::uuid[])
   AND w.unlinked_at IS NULL
   AND w.status IN ('trialing', 'active')
 LIMIT 2000`.trim();

/** $1 org, $2 client ids. The bills they marked Important (the bill store's presentable ones only). */
export const PHONE_BILLS_SQL = `
SELECT b.id, b.client_id, b.important, b.merchant_display, b.merchant_key, b.confidence_label,
       b.next_expected_on::text AS next_expected_on, b.next_expected_unknown_reason
  FROM recurring_bills b
 WHERE b.org_id = $1::uuid
   AND b.client_id = ANY($2::uuid[])
   AND b.important
   AND b.confidence_label IN ('medium', 'high')
 LIMIT 2000`.trim();

/** $1 org, $2 client ids. The alerts and repeat bills the clients added by hand, live, phone alert on
 *  (finance_custom_alerts, migration 583). */
export const PHONE_CUSTOM_SQL = `
SELECT f.id, f.client_id, f.kind, f.name, f.cadence, f.day_of_month, f.start_on::text AS start_on,
       f.phone_alert, f.archived_at
  FROM finance_custom_alerts f
 WHERE f.org_id = $1::uuid
   AND f.client_id = ANY($2::uuid[])
   AND f.archived_at IS NULL
   AND f.phone_alert
 LIMIT 2000`.trim();

/** $1 org, $2 refs. The rows the pass would have written for what it owed. */
export const OWED_PUSHES_SQL = `
SELECT m.provider_ref, m.status, m.last_error, m.scheduled_at, m.created_at, m.updated_at
  FROM messages m
 WHERE m.org_id = $1::uuid
   AND m.channel = 'push'
   AND m.provider_ref = ANY($2::text[])`.trim();

/** $1 org, $2 since, $3 TEST_ADDRESS_RE. Every recent finance phone alert row of a real client. */
export const RECENT_PUSHES_SQL = `
SELECT m.provider_ref, m.template_key, m.status, m.last_error, m.blocked_reason,
       m.scheduled_at, m.created_at, m.updated_at, m.last_attempt_at
  FROM messages m
  JOIN clients c ON c.id = m.client_id AND c.org_id = m.org_id
 WHERE m.org_id = $1::uuid
   AND m.channel = 'push'
   AND m.template_key LIKE '${PUSH_TEMPLATE_PREFIX}%'
   AND m.created_at >= $2::timestamptz
   AND COALESCE(c.is_demo, false) = false
   AND COALESCE(c.custom_fields ->> 'synthetic', '') <> 'true'
   AND COALESCE(c.email, '') !~* $3::text
 ORDER BY m.created_at DESC
 LIMIT 500`.trim();

// ── judging ──────────────────────────────────────────────────────────────────

/** What the pass owed at its last run: [{ ref, kind, label, dueOn }]. Pure. */
export function owedPushes({ cards = [], bills = [], plans = [], whop = [], custom = [] }, today) {
  const owed = [];
  const take = (plan) => {
    if (plan.push) owed.push({ ref: pushRef(plan.key), kind: plan.kind, label: clip(plan.label, 40), dueOn: plan.dueOn });
  };
  for (const c of cards) {
    const account = { account_id: c.bank_account_id, name: c.name, mask: c.mask, balance_cents: c.current_balance_cents };
    take(c.account_type === "loan"
      ? planLoanDuePush(account, c, { today, subtype: c.account_subtype })
      : planCardDuePush(account, c, { today, subtype: c.account_subtype }));
  }
  for (const b of bills) take(planBillPush(b, { today }));
  for (const p of plans) take(planInstallmentPush(p, { today }));
  for (const w of whop) take(planWhopPush(w, { today }));
  // A name the client typed stays out of the report: it could hold anything.
  for (const c of custom) {
    const plan = planCustomPush(c, { today });
    if (plan.push) owed.push({ ref: pushRef(plan.key), kind: plan.kind, label: null, dueOn: plan.dueOn });
  }
  return owed;
}

const NOUN = {
  card_due: "card", credit_line_due: "credit line", loan_due: "loan", important_bill: "bill", plan_due: "plan payment",
  custom_alert: "alert they added", custom_bill: "bill they added"
};

/** One phone alert row. Null when it is fine, or a short reason it is not. Pure. */
export function pushProblem(r, now) {
  const status = String(r.status || "");
  const note = String(r.last_error || "");
  if (status === "sent" || status === "blocked") return null;
  if (status === "queued") {
    const due = toMs(r.scheduled_at) ?? toMs(r.created_at);
    if (due !== null && now.getTime() - due > STUCK_HOURS * HOUR) return "it is still queued hours after its hour";
    return null;
  }
  if (status === "sending") {
    const at = toMs(r.last_attempt_at) ?? toMs(r.updated_at) ?? toMs(r.created_at);
    if (at !== null && now.getTime() - at > UNKNOWN_MINUTES * MIN) return "the phone pipes never answered (outcome unknown)";
    return null;
  }
  if (status === "failed") {
    if (note === "no_push_device") return null; // the client's phone went away; not ours to fix
    if (note.startsWith("too_late")) return "it was not sent before the day it was about";
    if (note.startsWith("push keys")) return "the push keys are not set on the server";
    return "every phone refused it";
  }
  return `its status is ${clip(status || "empty", 20)}`;
}

const FIX =
  "Read the messages row (channel push, provider_ref finance-push:<key>). A missing row means the daily pass " +
  "blueprint-finance-os-alerts did not queue it: read its last run in src/finance/file-alerts/run.mjs (step 5, " +
  "phone alerts). A row stuck queued means the dispatcher (message-dispatch-sweeper) did not pick it up. A failed " +
  "row names why in last_error. A row left 'sending' had an unknown outcome and must be checked by a person. " +
  `A person fixes it, not this check. ${TAIL}`;

function judge({ clients, cards, bills, plans = { rows: [] }, whop = { rows: [] }, custom = { rows: [] }, owedRows, recent, now }) {
  const unread = [];
  const bad = [];
  const seen = [];
  const today = lastPassDate(now);

  if (clients.error || !clients.rows) {
    unread.push(`the clients with phone alerts could not be read (${clients.error || "no rows came back"})`);
  } else if (cards.error || !cards.rows || bills.error || !bills.rows || plans.error || !plans.rows || whop.error || !whop.rows || custom.error || !custom.rows) {
    unread.push(`cards, loans, important bills, payment plans or added alerts could not be read (${cards.error || bills.error || plans.error || whop.error || custom.error || "no rows came back"})`);
  } else if (owedRows.error || !owedRows.rows) {
    unread.push(`the owed phone alerts could not be read (${owedRows.error || "no rows came back"})`);
  } else {
    const owed = owedPushes({ cards: cards.rows, bills: bills.rows, plans: plans.rows, whop: whop.rows, custom: custom.rows }, today);
    const have = new Map(owedRows.rows.map((r) => [String(r.provider_ref), r]));
    const missing = owed.filter((o) => !have.has(o.ref))
      .map((o) => `${NOUN[o.kind] || o.kind}${o.label ? ` ${o.label}` : ""} due ${o.dueOn}`);
    if (missing.length) {
      const more = missing.length > 3 ? `, ${missing.length - 3} more` : "";
      bad.push(`${missing.length} of ${owed.length} owed phone ${plural(owed.length, "alert", "alerts")} ${plural(missing.length, "was", "were")} never queued (${missing.slice(0, 3).join(", ")}${more})`);
    }
    seen.push(`${owed.length} owed at the ${today} pass for ${clients.rows.length} ${plural(clients.rows.length, "client", "clients")} with a phone`);
  }

  if (recent.error || !recent.rows) {
    unread.push(`recent phone alerts could not be read (${recent.error || "no rows came back"})`);
  } else {
    const why = new Map();
    for (const r of recent.rows) {
      const p = pushProblem(r, now);
      if (!p) continue;
      const kind = kindOfTemplate(r.template_key) || "unknown";
      const on = eventDateOfKey(String(r.provider_ref || "").slice(PUSH_REF_PREFIX.length));
      const key = `${kind}${on ? ` for ${on}` : ""}: ${p}`;
      why.set(key, (why.get(key) || 0) + 1);
    }
    if (why.size) {
      const total = [...why.values()].reduce((a, b) => a + b, 0);
      const parts = [...why.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, n]) => `${k} x${n}`);
      bad.push(`${total} of ${recent.rows.length} recent phone ${plural(recent.rows.length, "alert", "alerts")} did not go out: ${parts.join("; ")}`);
    }
    seen.push(`${recent.rows.length} phone ${plural(recent.rows.length, "alert", "alerts")} from the last ${LOOKBACK_DAYS} days`);
  }

  if (bad.length) {
    const tail = unread.length ? ` Not read: ${unread.join("; ")}.` : "";
    return row("FAIL", `${bad.join(". ")}.${tail}`, FIX);
  }
  if (unread.length) return row("skip", `Phone alerts not fully read: ${unread.join("; ")}.`);
  return row("PASS", `Every phone alert is in order: ${seen.join(" and ")}, each sent, waiting for its hour, or stopped by the client.`);
}

/**
 * runPhoneAlertChecks — one read-only row, alerts:phone-alerts-went-out.
 * io: { db, orgId, now }. db is anything with query(sql, params): the pool in the morning lane, the read
 * box in the hourly beat. SELECT only. Never sends.
 */
export async function runPhoneAlertChecks(io = {}) {
  const db = io.db;
  if (!db || typeof db.query !== "function") return [row("skip", "No database in this run. Phone alerts not read.")];
  if (!io.orgId) return [row("skip", "No company in this run. Phone alerts not read.")];
  const now = io.now instanceof Date && Number.isFinite(io.now.getTime()) ? io.now : new Date();
  try {
    const since = new Date(now.getTime() - LOOKBACK_DAYS * DAY).toISOString();
    const [clients, recent] = await Promise.all([
      readRows(db, PHONE_CLIENTS_SQL, [io.orgId, now.toISOString(), TEST_ADDRESS_RE, BLUEPRINT_PRODUCT_CODE, PAID_TRANSACTION_STATUS]),
      readRows(db, RECENT_PUSHES_SQL, [io.orgId, since, TEST_ADDRESS_RE])
    ]);
    let cards = { rows: [] };
    let bills = { rows: [] };
    let plans = { rows: [] };
    let whop = { rows: [] };
    let custom = { rows: [] };
    let owedRows = { rows: [] };
    const ids = clients.rows ? clients.rows.map((r) => String(r.client_id)) : [];
    if (ids.length) {
      [cards, bills, plans, whop, custom] = await Promise.all([
        readRows(db, PHONE_CARDS_SQL, [io.orgId, ids]),
        readRows(db, PHONE_BILLS_SQL, [io.orgId, ids]),
        readRows(db, PHONE_PLANS_SQL, [io.orgId, ids]),
        readRows(db, PHONE_WHOP_SQL, [io.orgId, ids]),
        readRows(db, PHONE_CUSTOM_SQL, [io.orgId, ids])
      ]);
      if (cards.rows && bills.rows && plans.rows && whop.rows && custom.rows) {
        const refs = owedPushes({ cards: cards.rows, bills: bills.rows, plans: plans.rows, whop: whop.rows, custom: custom.rows }, lastPassDate(now)).map((o) => o.ref);
        if (refs.length) owedRows = await readRows(db, OWED_PUSHES_SQL, [io.orgId, refs]);
      }
    }
    return [judge({ clients, cards, bills, plans, whop, custom, owedRows, recent, now })];
  } catch (err) {
    return [row("skip", `${ID} could not run: ${clip((err && err.message) || err, 160)}.`)];
  }
}
