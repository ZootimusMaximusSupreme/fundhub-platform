// Plan source "payoff" — the steps of the client's saved payment strategy, as
// dated pins on the FinanceOS timeline (W1's GET /api/money/plan).
//
// Contract: ops/workflows/finance-os-wave5-2026-10-06.md, "Shared contract —
// plan pins". The orchestrator adds this file to plan-sources/index.mjs at merge.
//
// WHERE THE PINS COME FROM. "Save this plan" on the Strategy section
// (POST /api/money/strategy, src/finance/payment-strategy.mjs) stores the plan's
// milestones in payment_strategy_plans (migration 463): each card's month under
// 30% and under 10% of its limit, each debt's payoff month, the month card use
// gets under 30% / 10% overall, and the debt-free month. The dates are the plan
// as the client chose it. They are NOT recomputed here — a pin that moved every
// time a balance changed would not be a plan.
//
// STATUS IS MEASURED, NOT ASSUMED. Each read compares the pin to the account's
// balance on file right now:
//   done     the card is at or under the pin's target (paid off: $0 or less);
//            card use overall is at or under the target; debt-free: every debt
//            in the plan owes nothing
//   missed   not done, and the date has passed
//   planned  not done, date still ahead — or the balance is unknown and the
//            date is still ahead (unknown is never "done")
//
// A $0 or unknown limit never had a card-use pin to begin with (the math gives
// no target without a positive limit), so nothing here can say "pay to $0" for
// a card whose limit is missing.

import { readSavedPlan } from "../payment-strategy.mjs";
import { METHOD_INFO, TARGETS } from "../../../public/app/money-strategy-math.js";

export const name = "payoff";

const BALANCES_SQL = `
  SELECT id::text AS id, account_type, current_balance_cents, credit_limit_cents, closed_at
    FROM bank_accounts
   WHERE client_id = $1 AND org_id = $2`;

function int(v) {
  if (typeof v === "number") return Number.isSafeInteger(v) ? v : null;
  if (typeof v === "string" && /^-?\d+$/.test(v.trim())) {
    const n = Number(v.trim());
    return Number.isSafeInteger(n) ? n : null;
  }
  return null;
}

function usd(cents) {
  if (!Number.isSafeInteger(cents)) return "—";
  const dollars = String(Math.floor(Math.abs(cents) / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const c = Math.abs(cents) % 100;
  return `${cents < 0 ? "-" : ""}$${dollars}${c ? "." + String(c).padStart(2, "0") : ""}`;
}

const TARGET_BY_PCT = new Map(TARGETS.map((t) => [t.pct, t]));

/**
 * pinsFromPlan(saved, balances, { from, to, today }) → contract pins. Pure.
 *
 * saved     shapeSaved() output (id, method, monthly_cents, inputs, milestones)
 * balances  Map(account id → { balance_cents, limit_cents, type, closed })
 */
export function pinsFromPlan(saved, balances = new Map(), { from = null, to = null, today } = {}) {
  if (!saved || !Array.isArray(saved.milestones)) return [];
  const debtById = new Map((saved.inputs || []).map((d) => [String(d.id), d]));
  const methodLabel = (METHOD_INFO[saved.method] || {}).label || saved.method;
  const planLine = `Your plan: ${usd(saved.monthly_cents)} a month toward debt, ${String(methodLabel).toLowerCase()}.`;
  const owed = (id) => {
    const b = balances.get(String(id));
    return b && b.balance_cents !== null ? Math.max(0, b.balance_cents) : null;
  };
  const overallNow = () => {
    let num = 0;
    let den = 0;
    for (const b of balances.values()) {
      if (b.type !== "credit" || b.closed || b.limit_cents === null || b.limit_cents <= 0) continue;
      if (b.balance_cents === null) return null; // a card with no balance: card use is unknown
      num += Math.max(0, b.balance_cents);
      den += b.limit_cents;
    }
    return den > 0 ? { num, den } : null;
  };

  const out = [];
  for (const m of saved.milestones) {
    if (!m || typeof m.date !== "string") continue;
    if ((from && m.date < from) || (to && m.date > to)) continue;
    const debt = m.debt_id ? debtById.get(String(m.debt_id)) : null;
    const nameOf = (debt && debt.name) || m.name || "this debt";
    const later = m.earliest ? " At the earliest: a rate (APR) is missing, so it could take longer." : "";
    let title;
    let detail;
    let amount = null;
    let done = false;

    if (m.key === "debt_free") {
      title = "Debt-free";
      detail = `Every card and loan in your plan is paid off. ${planLine}${later}`;
      const ids = (saved.inputs || []).filter((d) => d.balance_cents > 0).map((d) => d.id);
      done = ids.length > 0 && ids.every((id) => owed(id) === 0);
    } else if (m.kind === "checkpoint" && m.target_pct) {
      const t = TARGET_BY_PCT.get(m.target_pct);
      title = `Card use under ${m.target_pct}% overall`;
      detail = `${t ? t.meaning : ""} ${planLine}${later}`.trim();
      const now = overallNow();
      done = now !== null && now.num * 100 <= m.target_pct * now.den;
    } else if (m.target_pct) {
      const t = TARGET_BY_PCT.get(m.target_pct);
      amount = int(m.target_cents);
      title = `Pay ${nameOf} down to ${usd(amount)}`;
      detail = `That is under ${m.target_pct}% of its limit. ${t ? t.meaning : ""} ${planLine}${later}`.replace(/\s+/g, " ").trim();
      const o = owed(m.debt_id);
      done = o !== null && amount !== null && o <= amount;
    } else {
      title = `Pay off ${nameOf}`;
      detail = `${planLine}${later}`;
      const o = owed(m.debt_id);
      done = o !== null && o <= 0;
    }

    out.push({
      id: `payoff:${saved.id}:${m.key}`,
      date: m.date,
      kind: m.kind === "checkpoint" ? "checkpoint" : "pay_down",
      title,
      detail,
      amount_cents: amount,
      bank: null,
      container_id: debt && debt.container_id ? String(debt.container_id) : null,
      status: done ? "done" : today && m.date < today ? "missed" : "planned",
      source: name,
      earliest: m.earliest === true
    });
  }
  return out;
}

/** Contract entry point. No saved plan → no pins. */
export async function pins(db, { orgId, clientId, from = null, to = null, now = new Date(), today = null } = {}) {
  const saved = await readSavedPlan(db, { orgId, clientId });
  if (!saved) return [];
  const r = await db.query(BALANCES_SQL, [clientId, orgId]);
  const balances = new Map(r.rows.map((row) => [String(row.id), {
    type: row.account_type,
    balance_cents: int(row.current_balance_cents),
    limit_cents: int(row.credit_limit_cents),
    closed: !!row.closed_at
  }]));
  const day = typeof today === "string" && /^\d{4}-\d{2}-\d{2}$/.test(today) ? today : new Date(now).toISOString().slice(0, 10);
  return pinsFromPlan(saved, balances, { from, to, today: day });
}

export default { name, pins };
