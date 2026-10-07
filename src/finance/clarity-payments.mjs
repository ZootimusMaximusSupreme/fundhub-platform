// Clarity Payments — money a client owes Fundhub LLC (or a subsidiary), paid on
// a schedule. Owner-set 2026-10-06: any debt owed to Fundhub or its
// subsidiaries, including buy now, pay later (BNPL) plans.
//
// Tables: db/migrations/443_clarity_payments.sql. The database holds the rules
// (kinds, statuses, never overpaid, schedule adds up to the plan). This file
// shapes rows for the page and writes them in the one-statement form the
// deferred schedule check needs.
//
// MONEY IS INTEGER CENTS (src/commissions/money.mjs). Nothing here ever moves
// money. "Record a payment" writes down a payment staff already saw land.
//
// The pure half (planView, allocatePayment, validatePlanInput) has no database
// and no clock; the caller passes today's date.

import { parseIsoDate, daysBetween } from "../banking/statement-cycles.mjs";

export const KINDS = Object.freeze(["clarity", "bnpl", "other"]);
export const DEFAULT_OWED_TO = "Fundhub LLC";
/** How many days ahead an unpaid installment counts as "due soon". */
export const DUE_SOON_DAYS = 3;
/** A plan longer than this is a typo, not a payment plan. */
export const MAX_INSTALLMENTS = 60;

const KIND_WORDS = { clarity: "Fundhub payment plan", bnpl: "buy now, pay later plan", other: "balance" };

export class ClarityInputError extends Error {
  constructor(message, code = "invalid_input") {
    super(message);
    this.code = code;
  }
}

const isInt = (v) => Number.isSafeInteger(v);
const toInt = (v) => (v === null || v === undefined || v === "" ? null : Number(v));

/** A `date` column or an ISO string → "YYYY-MM-DD". Read as text, not as a
 *  local midnight (node-postgres moves a Date a day east of UTC). */
export function isoDay(v) {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  const s = typeof v === "string" ? v.slice(0, 10) : "";
  return parseIsoDate(s) ? s : null;
}

/** What the plan is called in a sentence or a text. */
export function planWords(plan = {}) {
  const label = typeof plan.label === "string" ? plan.label.trim() : "";
  if (label) return label;
  const owed = typeof plan.owed_to === "string" && plan.owed_to.trim() ? plan.owed_to.trim() : DEFAULT_OWED_TO;
  if (plan.kind === "bnpl") return `buy now, pay later plan with ${owed}`;
  if (plan.kind === "clarity" && owed === DEFAULT_OWED_TO) return KIND_WORDS.clarity;
  return `${KIND_WORDS[plan.kind] || "balance"} with ${owed}`;
}

/**
 * installmentView(row, today) → one installment as the page reads it.
 * state: paid | late | due_soon | upcoming.
 */
export function installmentView(row = {}, today) {
  const amount = toInt(row.amount_cents);
  const paid = toInt(row.paid_cents) ?? 0;
  const left = amount === null ? null : Math.max(0, amount - paid);
  const dueOn = isoDay(row.due_on);
  const daysUntil = dueOn && parseIsoDate(today) ? daysBetween(today, dueOn) : null;
  let state = "upcoming";
  if (left === 0) state = "paid";
  else if (daysUntil !== null && daysUntil < 0) state = "late";
  else if (daysUntil !== null && daysUntil <= DUE_SOON_DAYS) state = "due_soon";
  return {
    id: row.id ?? null,
    seq: toInt(row.seq),
    due_on: dueOn,
    amount_cents: amount,
    paid_cents: paid,
    left_cents: left,
    paid_at: row.paid_at ? new Date(row.paid_at).toISOString() : null,
    state,
    days_late: state === "late" ? -daysUntil : 0
  };
}

/**
 * planView(plan, installments, today) → one plan with its schedule, what is
 * left, the next payment, and whether any part is late.
 */
export function planView(plan = {}, installments = [], today) {
  const items = installments
    .map((r) => installmentView(r, today))
    .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  const original = toInt(plan.original_cents);
  const paid = items.reduce((s, i) => s + (i.paid_cents || 0), 0);
  const left = items.reduce((s, i) => s + (i.left_cents || 0), 0);
  const open = plan.status === "open";
  const next = open ? items.find((i) => i.left_cents > 0) || null : null;
  const late = open ? items.filter((i) => i.state === "late") : [];
  return {
    id: plan.id ?? null,
    kind: plan.kind ?? null,
    owed_to: plan.owed_to || DEFAULT_OWED_TO,
    label: plan.label || null,
    // The invoice this plan mirrors, when there is one. A Commas payment that
    // names this invoice is matched to this plan first (clarity-autopay.mjs).
    invoice_id: plan.invoice_id ?? null,
    name: planWords(plan),
    status: plan.status ?? "open",
    settled_at: plan.settled_at ? new Date(plan.settled_at).toISOString() : null,
    original_cents: original,
    paid_cents: paid,
    left_cents: open ? left : 0,
    is_late: late.length > 0,
    days_late: late.reduce((m, i) => Math.max(m, i.days_late), 0),
    late_cents: late.reduce((s, i) => s + i.left_cents, 0),
    next: next ? { seq: next.seq, due_on: next.due_on, left_cents: next.left_cents, state: next.state } : null,
    installments: items
  };
}

/**
 * allocatePayment(installments, cents) → [{ id, from_cents, to_cents, applied_cents, fully_paid }]
 *
 * A payment pays the oldest unpaid installment first, then the next. More than
 * is left on the plan is refused — we never write down money we cannot place.
 */
export function allocatePayment(installments = [], cents) {
  if (!isInt(cents) || cents <= 0) throw new ClarityInputError("amount_cents must be a whole number of cents above 0");
  const open = installments
    .map((r) => ({ id: r.id, seq: toInt(r.seq), amount: toInt(r.amount_cents), paid: toInt(r.paid_cents) ?? 0 }))
    .filter((r) => r.amount !== null && r.paid < r.amount)
    .sort((a, b) => a.seq - b.seq);
  const leftTotal = open.reduce((s, r) => s + (r.amount - r.paid), 0);
  if (cents > leftTotal) {
    throw new ClarityInputError(`That is more than the ${leftTotal} cents left on this plan.`, "overpayment");
  }
  let rest = cents;
  const out = [];
  for (const r of open) {
    if (rest <= 0) break;
    const take = Math.min(rest, r.amount - r.paid);
    rest -= take;
    out.push({ id: r.id, from_cents: r.paid, to_cents: r.paid + take, applied_cents: take, fully_paid: r.paid + take === r.amount });
  }
  return out;
}

/**
 * validatePlanInput(body) → { kind, owed_to, label, original_cents, installments }
 * Throws ClarityInputError. The database checks the same rules again; this
 * only turns a bad form into words a person can fix.
 */
export function validatePlanInput(body = {}) {
  const kind = String(body.kind || "").trim();
  if (!KINDS.includes(kind)) throw new ClarityInputError(`kind must be one of ${KINDS.join(", ")}`);
  const owedTo = typeof body.owed_to === "string" && body.owed_to.trim() ? body.owed_to.trim() : DEFAULT_OWED_TO;
  if (owedTo.length > 120) throw new ClarityInputError("owed_to is too long");
  const label = typeof body.label === "string" && body.label.trim() ? body.label.trim() : null;
  if (label && label.length > 120) throw new ClarityInputError("label is too long");

  const raw = Array.isArray(body.installments) ? body.installments : [];
  if (!raw.length) throw new ClarityInputError("a plan needs at least one installment");
  if (raw.length > MAX_INSTALLMENTS) throw new ClarityInputError(`a plan can have at most ${MAX_INSTALLMENTS} installments`);
  const installments = raw.map((r, i) => {
    const dueOn = isoDay(r && r.due_on);
    const amount = r ? toInt(r.amount_cents) : null;
    if (!dueOn) throw new ClarityInputError(`installment ${i + 1}: due_on must be a date (YYYY-MM-DD)`);
    if (!isInt(amount) || amount <= 0) throw new ClarityInputError(`installment ${i + 1}: amount_cents must be whole cents above 0`);
    return { seq: i + 1, due_on: dueOn, amount_cents: amount };
  });
  const sum = installments.reduce((s, r) => s + r.amount_cents, 0);
  const original = body.original_cents === undefined || body.original_cents === null ? sum : toInt(body.original_cents);
  if (!isInt(original) || original <= 0) throw new ClarityInputError("original_cents must be whole cents above 0");
  if (original !== sum) {
    throw new ClarityInputError(`the installments add up to ${sum} cents, not ${original}`, "schedule_mismatch");
  }
  return { kind, owed_to: owedTo, label, original_cents: original, installments };
}

/* ───────────────────────── database ───────────────────────── */

const PLAN_COLS = `id, kind, owed_to, label, original_cents, status, settled_at, invoice_id, created_at`;
const INST_COLS = `id, clarity_payment_id, seq, due_on::text AS due_on, amount_cents, paid_cents, paid_at`;

/** Every plan for one client, with its schedule. Filtered on org AND client. */
export async function listClarityPayments(conn, { orgId, clientId, today }) {
  const plans = await conn.query(
    `SELECT ${PLAN_COLS} FROM clarity_payments
      WHERE org_id = $1 AND client_id = $2 AND status <> 'cancelled'
      ORDER BY (status = 'open') DESC, created_at ASC, id`,
    [orgId, clientId]
  );
  if (!plans.rows.length) return [];
  const ids = plans.rows.map((p) => p.id);
  const inst = await conn.query(
    `SELECT ${INST_COLS} FROM clarity_payment_installments
      WHERE org_id = $1 AND clarity_payment_id = ANY($2::uuid[])
      ORDER BY clarity_payment_id, seq`,
    [orgId, ids]
  );
  const byPlan = new Map();
  for (const r of inst.rows) {
    const k = String(r.clarity_payment_id);
    if (!byPlan.has(k)) byPlan.set(k, []);
    byPlan.get(k).push(r);
  }
  return plans.rows.map((p) => planView(p, byPlan.get(String(p.id)) || [], today));
}

/** One plan row, only if it belongs to this client in this org. */
async function ownPlan(conn, { orgId, clientId, planId }) {
  const r = await conn.query(
    `SELECT ${PLAN_COLS} FROM clarity_payments WHERE id = $1 AND org_id = $2 AND client_id = $3`,
    [planId, orgId, clientId]
  );
  return r.rows[0] || null;
}

/**
 * addClarityPayment — the plan and its whole schedule in ONE statement, so the
 * deferred "schedule adds up" check sees both at commit.
 */
export async function addClarityPayment(conn, { orgId, clientId, input, staffId = null, externalRef = null }) {
  const p = validatePlanInput(input);
  const r = await conn.query(
    `WITH plan AS (
       INSERT INTO clarity_payments (org_id, client_id, owed_to, kind, label, original_cents, created_by, external_ref)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $11)
       RETURNING id
     ), sched AS (
       INSERT INTO clarity_payment_installments (org_id, clarity_payment_id, seq, due_on, amount_cents)
       SELECT $1, plan.id, s.seq, s.due_on, s.amount_cents
         FROM plan, unnest($8::int[], $9::date[], $10::bigint[]) AS s(seq, due_on, amount_cents)
       RETURNING id
     )
     SELECT plan.id, (SELECT count(*) FROM sched)::int AS installments FROM plan`,
    [
      orgId, clientId, p.owed_to, p.kind, p.label, p.original_cents, staffId,
      p.installments.map((i) => i.seq),
      p.installments.map((i) => i.due_on),
      p.installments.map((i) => i.amount_cents),
      externalRef
    ]
  );
  return { id: r.rows[0]?.id ?? null, plan: p };
}

/**
 * recordClarityPayment — write down a payment staff saw land. Oldest unpaid
 * installment first. Each row is updated only if it still holds the paid
 * amount we read, so two people recording at once cannot both count.
 * A plan with nothing left becomes settled.
 */
export async function recordClarityPayment(conn, { orgId, clientId, planId, amountCents, paidAt = new Date() }) {
  const plan = await ownPlan(conn, { orgId, clientId, planId });
  if (!plan) return { ok: false, error: "not_found" };
  if (plan.status !== "open") return { ok: false, error: "plan_not_open" };

  const inst = await conn.query(
    `SELECT ${INST_COLS} FROM clarity_payment_installments
      WHERE org_id = $1 AND clarity_payment_id = $2 ORDER BY seq`,
    [orgId, planId]
  );
  const moves = allocatePayment(inst.rows, amountCents);
  const at = new Date(paidAt).toISOString();
  const upd = await conn.query(
    `UPDATE clarity_payment_installments i
        SET paid_cents = m.to_cents,
            paid_at = CASE WHEN m.to_cents = i.amount_cents THEN $4::timestamptz ELSE i.paid_at END
       FROM unnest($1::uuid[], $2::bigint[], $3::bigint[]) AS m(id, from_cents, to_cents)
      WHERE i.id = m.id AND i.paid_cents = m.from_cents AND i.org_id = $5 AND i.clarity_payment_id = $6
      RETURNING i.id`,
    [moves.map((m) => m.id), moves.map((m) => m.from_cents), moves.map((m) => m.to_cents), at, orgId, planId]
  );
  if (upd.rows.length !== moves.length) return { ok: false, error: "conflict", applied: upd.rows.length };

  const settle = await conn.query(
    `UPDATE clarity_payments p SET status = 'settled', settled_at = $3::timestamptz
      WHERE p.id = $1 AND p.org_id = $2 AND p.status = 'open'
        AND NOT EXISTS (SELECT 1 FROM clarity_payment_installments i
                         WHERE i.clarity_payment_id = p.id AND i.paid_cents < i.amount_cents)
      RETURNING p.id`,
    [planId, orgId, at]
  );
  return { ok: true, moves, settled: settle.rows.length > 0, plan };
}

/** settleClarityPayment — staff closes the plan (paid elsewhere, or forgiven). */
export async function settleClarityPayment(conn, { orgId, clientId, planId, at = new Date() }) {
  const plan = await ownPlan(conn, { orgId, clientId, planId });
  if (!plan) return { ok: false, error: "not_found" };
  if (plan.status !== "open") return { ok: false, error: "plan_not_open" };
  await conn.query(
    `UPDATE clarity_payments SET status = 'settled', settled_at = $3::timestamptz
      WHERE id = $1 AND org_id = $2 AND status = 'open'`,
    [planId, orgId, new Date(at).toISOString()]
  );
  return { ok: true, plan };
}

/**
 * logMoneyAction — one row in money_agent_log. ON CONFLICT DO NOTHING: a row
 * that is already there (same idempotency key, or a second text today) comes
 * back as { created: false }. That is the claim, not an error.
 */
export async function logMoneyAction(conn, row) {
  const r = await conn.query(
    `INSERT INTO money_agent_log
       (org_id, client_id, item_kind, item_id, item_label, decided_on, action, actor, brain,
        reason, texts_client, template_key, amount_cents, idempotency_key, detail)
     VALUES ($1, $2, $3, $4, $5, $6::date, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [
      row.orgId, row.clientId, row.itemKind, row.itemId ?? null, row.itemLabel ?? null, row.decidedOn,
      row.action, row.actor || "agent", row.actor && row.actor !== "agent" ? null : (row.brain || "rules"),
      row.reason ?? null, !!row.textsClient, row.templateKey ?? null, row.amountCents ?? null,
      row.idempotencyKey ?? null, row.detail ? JSON.stringify(row.detail) : null
    ]
  );
  return { created: r.rows.length > 0, id: r.rows[0]?.id ?? null };
}

/** The newest steps for one client, for the page. A Commas payment that could
 *  not be matched is staff work, not a step the client sees — it is left out
 *  here and read by readUnmatchedPayments instead. `via` says where an
 *  automatic payment came from ('commas'), or null. */
export async function readMoneyLog(conn, { orgId, clientId, limit = 25 }) {
  const r = await conn.query(
    `SELECT id, item_kind, item_label, decided_on::text AS decided_on, action, actor, brain,
            reason, message_status, task_id, amount_cents, created_at, detail->>'via' AS via
       FROM money_agent_log
      WHERE org_id = $1 AND client_id = $2 AND action <> 'payment_unmatched'
      ORDER BY created_at DESC, id
      LIMIT $3`,
    [orgId, clientId, limit]
  );
  return r.rows.map((x) => ({
    id: x.id,
    item_kind: x.item_kind,
    item_label: x.item_label,
    decided_on: x.decided_on,
    action: x.action,
    actor: x.actor,
    brain: x.brain,
    reason: x.reason,
    message_status: x.message_status,
    task_created: !!x.task_id,
    amount_cents: x.amount_cents === null || x.amount_cents === undefined ? null : Number(x.amount_cents),
    via: x.via || null,
    at: x.created_at ? new Date(x.created_at).toISOString() : null
  }));
}

/** Commas payments from this client that could not be tied to a plan, newest
 *  first, for staff (src/finance/clarity-autopay.mjs writes them). */
export async function readUnmatchedPayments(conn, { orgId, clientId, limit = 25 }) {
  const r = await conn.query(
    `SELECT id, decided_on::text AS decided_on, reason, amount_cents, created_at,
            detail->>'via' AS via, detail->>'payment_id' AS payment_id
       FROM money_agent_log
      WHERE org_id = $1 AND client_id = $2 AND action = 'payment_unmatched'
      ORDER BY created_at DESC, id
      LIMIT $3`,
    [orgId, clientId, limit]
  );
  return r.rows.map((x) => ({
    id: x.id,
    decided_on: x.decided_on,
    reason: x.reason,
    amount_cents: x.amount_cents === null || x.amount_cents === undefined ? null : Number(x.amount_cents),
    via: x.via || null,
    payment_id: x.payment_id || null,
    at: x.created_at ? new Date(x.created_at).toISOString() : null
  }));
}

export default {
  planView, installmentView, allocatePayment, validatePlanInput, planWords,
  listClarityPayments, addClarityPayment, recordClarityPayment, settleClarityPayment,
  logMoneyAction, readMoneyLog, readUnmatchedPayments
};
