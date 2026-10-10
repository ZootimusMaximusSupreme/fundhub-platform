// Plan source: what the FinanceOS Money Helper put on the client's plan —
// reminders it set (create_reminder) and dated steps it scheduled
// (schedule_pin). Rows: money_agent_pins (db/migrations/465_money_helper_agent.sql),
// written only by src/finance/money-helper.mjs executeActions after the brain's
// answer passed every check in src/finance/money-agent-ai.mjs.
//
// REGISTERED BY THE ORCHESTRATOR. W6 does not edit plan-sources/index.mjs; add
// `import * as agent from "./agent.mjs"` and put it in SOURCES at merge.
//
// One pin per row in the window. A reminder's title says it is a reminder. A
// cancelled row is not a pin. Status is the row's own: planned, done, missed.
//
// STAFF MARK: planned → done or missed, on this client's row only. A row that
// is not planned any more is left alone (changed: false).

export const name = "agent";

export const MARKS = Object.freeze(["done", "missed"]);

const PREFIX = "agent:";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const text = (v) => (v === null || v === undefined || String(v).trim() === "" ? null : String(v).trim());
const cents = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isSafeInteger(n) ? n : null;
};

/** One money_agent_pins row → one pin (the board's contract shape). Pure. */
export function buildAgentPin(row = {}) {
  const reminder = row.purpose === "reminder";
  const title = text(row.title) || (reminder ? "Reminder" : "Step");
  return {
    id: `${PREFIX}${row.id}`,
    date: typeof row.date === "string" ? row.date.slice(0, 10) : null,
    kind: row.kind || "other",
    title: reminder ? `Reminder: ${title}` : title,
    detail: text(row.detail) || (reminder ? "Set by your money helper." : "Put on your plan by your money helper."),
    amount_cents: cents(row.amount_cents),
    bank: null,
    container_id: null,
    status: ["planned", "done", "missed"].includes(row.status) ? row.status : "planned",
    source: name,
    can_mark: row.status === "planned" ? [...MARKS] : []
  };
}

const COLS = `id, purpose, pin_date::text AS date, kind, title, detail, amount_cents, status`;

export async function pins(db, { orgId, clientId, from, to } = {}) {
  const r = await db.query(
    `SELECT ${COLS} FROM money_agent_pins
      WHERE org_id = $1 AND client_id = $2 AND status <> 'cancelled'
        AND pin_date BETWEEN $3::date AND $4::date
      ORDER BY pin_date, created_at, id`,
    [orgId, clientId, from, to]
  );
  return (r.rows || []).map(buildAgentPin);
}

export async function mark(db, { orgId, clientId, pinId, status } = {}) {
  if (!MARKS.includes(status)) return { ok: false, reason: "bad_status" };
  const id = typeof pinId === "string" && pinId.startsWith(PREFIX) ? pinId.slice(PREFIX.length) : "";
  if (!UUID.test(id)) return { ok: false, reason: "not_found" };
  const upd = await db.query(
    `UPDATE money_agent_pins SET status = $4
      WHERE id = $1 AND org_id = $2 AND client_id = $3 AND status = 'planned'
      RETURNING ${COLS}`,
    [id, orgId, clientId, status]
  );
  if (upd.rows[0]) return { ok: true, changed: true, pin: buildAgentPin(upd.rows[0]) };
  const cur = await db.query(
    `SELECT ${COLS} FROM money_agent_pins WHERE id = $1 AND org_id = $2 AND client_id = $3 AND status <> 'cancelled'`,
    [id, orgId, clientId]
  );
  if (!cur.rows[0]) return { ok: false, reason: "not_found" };
  return { ok: true, changed: false, pin: buildAgentPin(cur.rows[0]) };
}
