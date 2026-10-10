// The plan — the read behind GET /api/money/plan and the FinanceOS Plan tab:
// one month (or any window up to a year) of dated pins from every plan source.
//
// THE JSON SHAPE (wave 5 board, ops/workflows/finance-os-wave5-2026-10-06.md, W1):
//
//   {
//     ok: true,
//     client:  { id, name },
//     viewer:  "client" | "staff",
//     today:   "YYYY-MM-DD"    the UTC day — the same "today" every money read uses
//     month:   "YYYY-MM"       the month `from` falls in
//     from, to: "YYYY-MM-DD"   inclusive
//     days:    [{ date, weekday (1 = Monday … 7 = Sunday), is_today, pin_count }]
//     pins:    [pin]           src/finance/plan-sources/index.mjs (the contract)
//     sources: [{ name, ok, count } | { name, ok: false, error }]
//     containers: [{ id, name, kind }]   so a pin's container_id has a name
//   }
//
// Staff marks are honoured by the sources; a CLIENT viewer gets every pin with
// can_mark: [] — the screen draws no control the person cannot use, and the
// endpoint refuses a client's mark anyway.
//
// planWindow() and planDays() are pure — no database, no clock — so every rule
// about the window is tested without Postgres.

import { allPins, SOURCES } from "./plan-sources/index.mjs";
import { parseIsoDate, formatIsoDate, daysInMonth, daysBetween } from "../banking/statement-cycles.mjs";

/** The widest window one read may ask for, in days (a year, leap or not). */
export const MAX_DAYS = 366;

const MONTH = /^(\d{4})-(\d{2})$/;

function firstQuery(v) {
  if (Array.isArray(v)) return v.length ? String(v[0]) : "";
  return v === undefined || v === null ? "" : String(v).trim();
}

/**
 * planWindow(query, today) → { ok: true, month, from, to } | { ok: false, error, message }
 *
 *   ?from=YYYY-MM-DD&to=YYYY-MM-DD  both, from <= to, at most MAX_DAYS days
 *   ?month=YYYY-MM                  that calendar month
 *   neither                         the month `today` falls in
 */
export function planWindow(query = {}, today) {
  const q = query && typeof query === "object" ? query : {};
  const fromQ = firstQuery(q.from);
  const toQ = firstQuery(q.to);
  const monthQ = firstQuery(q.month);

  if (fromQ || toQ) {
    if (!parseIsoDate(fromQ) || !parseIsoDate(toQ)) {
      return { ok: false, error: "invalid_window", message: "from and to must both be dates, like 2026-10-01." };
    }
    if (toQ < fromQ) return { ok: false, error: "invalid_window", message: "to must be on or after from." };
    if (daysBetween(fromQ, toQ) + 1 > MAX_DAYS) {
      return { ok: false, error: "window_too_long", message: `Ask for ${MAX_DAYS} days or fewer.` };
    }
    return { ok: true, month: fromQ.slice(0, 7), from: fromQ, to: toQ };
  }

  let ym = monthQ;
  if (!ym) {
    if (!parseIsoDate(today)) return { ok: false, error: "invalid_today", message: "No date to start from." };
    ym = today.slice(0, 7);
  }
  const m = MONTH.exec(ym);
  const year = m ? Number(m[1]) : NaN;
  const month = m ? Number(m[2]) : NaN;
  if (!m || month < 1 || month > 12 || year < 2000 || year > 2100) {
    return { ok: false, error: "invalid_month", message: "month must look like 2026-10." };
  }
  return {
    ok: true,
    month: ym,
    from: formatIsoDate({ year, month, day: 1 }),
    to: formatIsoDate({ year, month, day: daysInMonth(year, month) })
  };
}

/** Every day from..to with its weekday (1 = Monday … 7 = Sunday), whether it
 *  is today, and how many pins fall on it. */
export function planDays(from, to, today, pins = []) {
  const a = parseIsoDate(from);
  const span = daysBetween(from, to);
  if (!a || span === null || span < 0) return [];
  const counts = new Map();
  for (const p of Array.isArray(pins) ? pins : []) {
    if (p && p.date) counts.set(p.date, (counts.get(p.date) || 0) + 1);
  }
  const out = [];
  for (let i = 0; i <= span && i < MAX_DAYS; i++) {
    const t = new Date(Date.UTC(a.year, a.month - 1, a.day + i));
    const date = formatIsoDate({ year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() });
    out.push({ date, weekday: ((t.getUTCDay() + 6) % 7) + 1, is_today: date === today, pin_count: counts.get(date) || 0 });
  }
  return out;
}

const text = (v) => (v === null || v === undefined || v === "" ? null : String(v));

/**
 * moneyPlan(db, { orgId, clientId, window, today, now, env, viewer }) → the
 * payload above, or null when the client is not in that org (the caller
 * answers 404). Every query is filtered on org_id AND client_id.
 */
export async function moneyPlan(db, {
  orgId, clientId, window, today, now = new Date(), env = {}, viewer = "client", sources = SOURCES
} = {}) {
  const clientRes = await db.query(
    `SELECT id, first_name, last_name FROM clients WHERE id = $1 AND org_id = $2`,
    [clientId, orgId]
  );
  const client = clientRes.rows?.[0];
  if (!client) return null;

  const [plan, ents] = await Promise.all([
    allPins(db, { orgId, clientId, from: window.from, to: window.to, env, now, today, sources }),
    db.query(
      `SELECT id, kind, name FROM entities
        WHERE client_id = $1 AND org_id = $2 AND archived_at IS NULL
        ORDER BY kind, name, id`, [clientId, orgId])
  ]);

  const staff = viewer === "staff";
  const pins = plan.pins.map((p) => (staff ? p : { ...p, can_mark: [] }));
  const name = [text(client.first_name), text(client.last_name)].filter(Boolean).join(" ") || null;

  return {
    ok: true,
    client: { id: text(client.id), name },
    viewer: staff ? "staff" : "client",
    today,
    month: window.month,
    from: window.from,
    to: window.to,
    days: planDays(window.from, window.to, today, pins),
    pins,
    sources: plan.sources,
    containers: (ents.rows || []).map((e) => ({ id: text(e.id), name: text(e.name), kind: text(e.kind) }))
  };
}

export default moneyPlan;
