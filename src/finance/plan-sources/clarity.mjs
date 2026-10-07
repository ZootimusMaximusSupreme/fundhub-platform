// Plan source: money a client owes Fundhub — Clarity Payments and buy now, pay
// later plans (kind "due"). Owner-set 2026-10-06: any debt owed to Fundhub LLC
// or a subsidiary (docs/finance/finance-os-direction-2026-10-06.md).
//
// One pin per installment whose due date falls in the window. The plans, their
// schedules and each installment's state come from listClarityPayments() in
// src/finance/clarity-payments.mjs — the same read the Payments section paints —
// so the plan never works out "late" a second way.
//
// STATUS, from the installment's own state there:
//   paid                  → done
//   late (date passed,    → missed
//         money still left)
//   due soon / coming up  → planned
//
// A SETTLED plan (staff closed it: paid elsewhere, or forgiven) keeps only the
// installments that were paid; the unpaid rest is no longer owed, so it is not a
// date anyone has to meet. Cancelled plans are already left out by the read.
//
// AMOUNT: what was paid for a done installment, what is left for an open one.
//
// No staff mark here on purpose. A payment pays the OLDEST unpaid installment
// first (allocatePayment), so "mark payment 3 done" is not a thing that can be
// written truthfully. Payments are recorded on the Payments section.

import { listClarityPayments } from "../clarity-payments.mjs";
import { dollars, shortDate } from "../../banking/card-due-reminders.mjs";
import { parseIsoDate } from "../../banking/statement-cycles.mjs";

export const name = "clarity";

const STATUS = { paid: "done", late: "missed", due_soon: "planned", upcoming: "planned" };

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const isInt = (v) => Number.isSafeInteger(v);

/**
 * buildClarityPins — plan views (planView shape) → pins. Pure.
 * @param {Array} plans   listClarityPayments() output
 * @param {object} window { from, to } as 'YYYY-MM-DD', inclusive
 */
export function buildClarityPins(plans = [], { from, to } = {}) {
  if (!parseIsoDate(from) || !parseIsoDate(to)) return [];
  const out = [];
  for (const p of Array.isArray(plans) ? plans : []) {
    if (!p || p.status === "cancelled") continue;
    const items = Array.isArray(p.installments) ? p.installments : [];
    const count = items.length;
    const owedTo = p.owed_to || "Fundhub LLC";
    for (const i of items) {
      if (!i || !i.id || !i.due_on || i.due_on < from || i.due_on > to) continue;
      if (p.status === "settled" && i.state !== "paid") continue; // no longer owed
      const status = STATUS[i.state] || "planned";

      let detail;
      if (status === "done") {
        const on = i.paid_at ? shortDate(String(i.paid_at).slice(0, 10)) : null;
        detail = on ? `Paid on ${on}.` : "Paid.";
      } else {
        const parts = [`Owed to ${owedTo}.`];
        if (isInt(i.paid_cents) && i.paid_cents > 0) parts.push(`${dollars(i.paid_cents)} paid so far.`);
        if (status === "missed" && isInt(i.days_late) && i.days_late > 0) {
          parts.push(`${i.days_late} ${i.days_late === 1 ? "day" : "days"} late.`);
        }
        detail = parts.join(" ");
      }

      out.push({
        id: `clarity:${i.id}`,
        date: i.due_on,
        kind: "due",
        title: `${cap(p.name || "Payment to Fundhub")}: payment ${i.seq} of ${count}`,
        detail,
        amount_cents: status === "done"
          ? (isInt(i.amount_cents) ? i.amount_cents : null)
          : (isInt(i.left_cents) ? i.left_cents : null),
        bank: null,
        container_id: null,
        status,
        source: name,
        can_mark: []
      });
    }
  }
  return out;
}

export async function pins(db, { orgId, clientId, from, to, today } = {}) {
  const day = parseIsoDate(today) ? today : new Date().toISOString().slice(0, 10);
  const plans = await listClarityPayments(db, { orgId, clientId, today: day });
  return buildClarityPins(plans, { from, to });
}
