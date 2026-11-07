// Alerts and repeat bills the client adds by hand — the store, the input check and
// the screen's view. Finance OS CFO build, unit AL2 (owner ask 2026-11-07: "they
// can add alerts too... add recurring expenses... organize it by business").
//
// THE TABLE is finance_custom_alerts (db/migrations/583_finance_custom_alerts.sql).
// THE DATE MATH AND THE PUSH PLANNER are src/pulse/beats/lib/custom-alert-plan.mjs,
// re-exported below, so the daily pass, the screen and the morning check read one
// planner.
//
// EVERY READ AND WRITE IS FILTERED ON org_id AND client_id. A row that is not this
// client's is a 404, never a hint the id is real. A business is checked against
// the client's own entities (kind 'business', not archived) before it is saved.
//
// REMOVE SETS archived_at. Nothing here deletes a row, sends, or moves money.

import { FileAlertInputError } from "./store.mjs";
import {
  ALERT_CADENCES, BILL_CADENCES, CUSTOM_PUSH_DAYS_BEFORE, nextCustomOn, planCustomPush, customLabel, customDay
} from "../../pulse/beats/lib/custom-alert-plan.mjs";
import { parseIsoDate, daysBetween } from "../../pulse/beats/lib/card-due-helpers.mjs";
import { addDaysIso } from "./common.mjs";

export {
  CUSTOM_PHONE_KINDS, CUSTOM_CADENCES, ALERT_CADENCES, BILL_CADENCES, CUSTOM_KEY_PREFIX, CUSTOM_PUSH_DAYS_BEFORE,
  nextCustomOn, isCustomOccurrence, planCustomPush, customLabel, customPhoneKind, customDay
} from "../../pulse/beats/lib/custom-alert-plan.mjs";

export const CUSTOM_ITEM_KINDS = Object.freeze(["alert", "bill"]);
export const CUSTOM_SCOPES = Object.freeze(["personal", "business"]);
export const NAME_MAX = 80;
/** $1,000,000,000.00 — past this it is a typo. */
export const AMOUNT_MAX_CENTS = 100_000_000_000;
/** A client can keep this many at once. A cap, not a product rule: past it the list stops being useful. */
export const ITEMS_MAX = 100;
/** A date more than this far ahead is a typo. */
export const MAX_YEARS_AHEAD = 5;
/** A repeat bill may be counted from a charge this far back. */
export const MAX_YEARS_BACK = 10;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLUMNS = `id, kind, name, amount_cents, cadence, day_of_month, start_on::text AS start_on, scope, entity_id,
  phone_alert, created_by, updated_by, archived_at, created_at, updated_at`;

const bad = (field, message, status = 400) => new FileAlertInputError(field, message, status);

/** A name as typed: trimmed, spaces squeezed, no control characters, 1 to 80 long. */
export function readName(v) {
  if (typeof v !== "string") throw bad("name", "name is required");
  // eslint-disable-next-line no-control-regex
  const name = v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (!name) throw bad("name", "name is required");
  if (name.length > NAME_MAX) throw bad("name", `name is longer than ${NAME_MAX} characters`);
  return name;
}

/** Integer cents, 1 to AMOUNT_MAX_CENTS; null when absent and allowed. */
export function readAmount(v, { required }) {
  if (v === null || v === undefined || v === "") {
    if (required) throw bad("amount_cents", "a bill needs an amount");
    return null;
  }
  const n = typeof v === "string" && /^\d+$/.test(v.trim()) ? Number(v.trim()) : v;
  if (!Number.isSafeInteger(n) || n <= 0) throw bad("amount_cents", "amount_cents must be a whole number of cents above zero");
  if (n > AMOUNT_MAX_CENTS) throw bad("amount_cents", "that amount is too large");
  return n;
}

/**
 * readCustomInput(body, { today, kind }) → the fields to save, or throws FileAlertInputError.
 *
 * `kind` is the row's kind on an update (a kind is never changed); on an add it is
 * read from the body.
 */
export function readCustomInput(body = {}, { today, kind = null } = {}) {
  if (!parseIsoDate(today)) throw new TypeError("readCustomInput: today is required");
  const k = kind || (typeof body.kind === "string" ? body.kind.trim() : "");
  if (!CUSTOM_ITEM_KINDS.includes(k)) throw bad("kind", "kind must be alert or bill");
  const name = readName(body.name);
  const amount = readAmount(body.amount_cents, { required: k === "bill" });

  const cadence = typeof body.cadence === "string" ? body.cadence.trim() : "";
  const allowed = k === "alert" ? ALERT_CADENCES : BILL_CADENCES;
  if (!allowed.includes(cadence)) throw bad("cadence", `cadence must be one of ${allowed.join(", ")}`);

  let dayOfMonth = null;
  let startOn = null;
  if (cadence === "monthly") {
    const d = typeof body.day_of_month === "string" && /^\d+$/.test(body.day_of_month.trim())
      ? Number(body.day_of_month.trim()) : body.day_of_month;
    if (!Number.isInteger(d) || d < 1 || d > 31) throw bad("day_of_month", "day_of_month must be a day from 1 to 31");
    dayOfMonth = d;
  } else {
    const on = typeof body.start_on === "string" ? body.start_on.trim() : "";
    if (!parseIsoDate(on)) throw bad("start_on", "start_on must be a real date (YYYY-MM-DD)");
    const ahead = daysBetween(today, on);
    if (ahead > Math.round(MAX_YEARS_AHEAD * 365.25)) throw bad("start_on", `that date is more than ${MAX_YEARS_AHEAD} years away`);
    if (cadence === "once" && ahead < 0) throw bad("start_on", "that date has already passed");
    if (ahead < -Math.round(MAX_YEARS_BACK * 365.25)) throw bad("start_on", `that date is more than ${MAX_YEARS_BACK} years ago`);
    startOn = on;
  }

  const scope = typeof body.scope === "string" ? body.scope.trim() : "";
  if (!CUSTOM_SCOPES.includes(scope)) throw bad("scope", "scope must be personal or business");
  let entityId = null;
  if (body.entity_id !== null && body.entity_id !== undefined && body.entity_id !== "") {
    if (scope !== "business") throw bad("entity_id", "only a business alert names a business");
    if (typeof body.entity_id !== "string" || !UUID_RE.test(body.entity_id.trim())) throw bad("entity_id", "entity_id must be a uuid");
    entityId = body.entity_id.trim().toLowerCase();
  }

  let phone = true;
  if (body.phone_alert !== undefined && body.phone_alert !== null) {
    if (typeof body.phone_alert !== "boolean") throw bad("phone_alert", "phone_alert must be true or false");
    phone = body.phone_alert;
  }

  return {
    kind: k, name, amount_cents: amount, cadence, day_of_month: dayOfMonth, start_on: startOn,
    scope, entity_id: entityId, phone_alert: phone
  };
}

/** The business must be one of this client's own, live, business entities. */
async function checkEntity(conn, { orgId, clientId, entityId }) {
  if (!entityId) return;
  const r = await conn.query(
    `SELECT id FROM entities
      WHERE id = $1 AND org_id = $2 AND client_id = $3 AND kind = 'business' AND archived_at IS NULL`,
    [entityId, orgId, clientId]
  );
  if (!r.rows[0]) throw bad("entity_id", "no such business", 404);
}

const byWho = (by) => (by === "staff" ? "staff" : "client");

/** The client's live items, oldest first. */
export async function listCustomItems(conn, { orgId, clientId }) {
  const r = await conn.query(
    `SELECT ${COLUMNS} FROM finance_custom_alerts
      WHERE org_id = $1 AND client_id = $2 AND archived_at IS NULL
      ORDER BY created_at ASC, id ASC
      LIMIT ${ITEMS_MAX}`,
    [orgId, clientId]
  );
  return r.rows;
}

/** addCustomItem(conn, { orgId, clientId, input, by }) → the saved row. `input` is readCustomInput()'s answer. */
export async function addCustomItem(conn, { orgId, clientId, input, by }) {
  await checkEntity(conn, { orgId, clientId, entityId: input.entity_id });
  const count = await conn.query(
    `SELECT count(*)::int AS n FROM finance_custom_alerts WHERE org_id = $1 AND client_id = $2 AND archived_at IS NULL`,
    [orgId, clientId]
  );
  if (Number(count.rows[0] && count.rows[0].n) >= ITEMS_MAX) {
    throw bad("kind", `you can keep up to ${ITEMS_MAX} alerts and bills; remove one first`);
  }
  const who = byWho(by);
  const r = await conn.query(
    `INSERT INTO finance_custom_alerts
       (org_id, client_id, kind, name, amount_cents, cadence, day_of_month, start_on, scope, entity_id,
        phone_alert, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::date, $9, $10, $11, $12, $12)
     RETURNING ${COLUMNS}`,
    [orgId, clientId, input.kind, input.name, input.amount_cents, input.cadence, input.day_of_month,
      input.start_on, input.scope, input.entity_id, input.phone_alert, who]
  );
  return r.rows[0];
}

/** The kind of one live row of this client, or a 404. */
export async function customKindOf(conn, { orgId, clientId, id }) {
  if (typeof id !== "string" || !UUID_RE.test(id.trim())) throw bad("id", "id must be a uuid");
  const r = await conn.query(
    `SELECT kind FROM finance_custom_alerts WHERE id = $1 AND org_id = $2 AND client_id = $3 AND archived_at IS NULL`,
    [id.trim(), orgId, clientId]
  );
  if (!r.rows[0]) throw bad("id", "no such alert or bill", 404);
  return r.rows[0].kind;
}

/** updateCustomItem(conn, { orgId, clientId, id, input, by }) → the saved row. Every field is replaced. */
export async function updateCustomItem(conn, { orgId, clientId, id, input, by }) {
  await checkEntity(conn, { orgId, clientId, entityId: input.entity_id });
  const r = await conn.query(
    `UPDATE finance_custom_alerts
        SET name = $4, amount_cents = $5, cadence = $6, day_of_month = $7, start_on = $8::date, scope = $9,
            entity_id = $10, phone_alert = $11, updated_by = $12
      WHERE id = $1 AND org_id = $2 AND client_id = $3 AND archived_at IS NULL AND kind = $13
      RETURNING ${COLUMNS}`,
    [id, orgId, clientId, input.name, input.amount_cents, input.cadence, input.day_of_month, input.start_on,
      input.scope, input.entity_id, input.phone_alert, byWho(by), input.kind]
  );
  if (!r.rows[0]) throw bad("id", "no such alert or bill", 404);
  return r.rows[0];
}

/** setCustomPhone(conn, { orgId, clientId, id, enabled, by }) → { id, phone_alert }. */
export async function setCustomPhone(conn, { orgId, clientId, id, enabled, by }) {
  if (typeof enabled !== "boolean") throw bad("enabled", "enabled must be true or false");
  if (typeof id !== "string" || !UUID_RE.test(id.trim())) throw bad("id", "id must be a uuid");
  const r = await conn.query(
    `UPDATE finance_custom_alerts SET phone_alert = $4, updated_by = $5
      WHERE id = $1 AND org_id = $2 AND client_id = $3 AND archived_at IS NULL
      RETURNING id, phone_alert`,
    [id.trim(), orgId, clientId, enabled, byWho(by)]
  );
  if (!r.rows[0]) throw bad("id", "no such alert or bill", 404);
  return { id: String(r.rows[0].id), phone_alert: r.rows[0].phone_alert === true };
}

/** removeCustomItem(conn, { orgId, clientId, id, by }) → { id, removed: true }. Sets archived_at. */
export async function removeCustomItem(conn, { orgId, clientId, id, by }) {
  if (typeof id !== "string" || !UUID_RE.test(id.trim())) throw bad("id", "id must be a uuid");
  const r = await conn.query(
    `UPDATE finance_custom_alerts SET archived_at = now(), updated_by = $4
      WHERE id = $1 AND org_id = $2 AND client_id = $3 AND archived_at IS NULL
      RETURNING id`,
    [id.trim(), orgId, clientId, byWho(by)]
  );
  if (!r.rows[0]) throw bad("id", "no such alert or bill", 404);
  return { id: String(r.rows[0].id), removed: true };
}

/**
 * customView(row, { today, sent }) → one item as the screen shows it.
 *
 * `sent` is the screen's list of phone alerts (src/push/finance-alerts.mjs
 * listPhoneAlerts), to say whether this date's alert is waiting or went.
 */
export function customView(row, { today, sent = null } = {}) {
  const amount = row.amount_cents === null || row.amount_cents === undefined ? null : Number(row.amount_cents);
  const nextOn = nextCustomOn(row, today);
  const plan = planCustomPush(row, { today });
  let alertOn = null;
  if (row.phone_alert !== false) {
    if (plan.push) alertOn = today;
    else if (plan.reason === "not_yet" && plan.dueOn) alertOn = addDaysIso(plan.dueOn, -CUSTOM_PUSH_DAYS_BEFORE);
  }
  const went = Array.isArray(sent) && nextOn
    ? sent.find((a) => a.subject_id === String(row.id) && a.about_on === nextOn) : null;
  return {
    id: String(row.id),
    kind: row.kind,
    name: customLabel(row),
    amount_cents: Number.isFinite(amount) ? amount : null,
    cadence: row.cadence,
    day_of_month: row.day_of_month === null || row.day_of_month === undefined ? null : Number(row.day_of_month),
    start_on: customDay(row.start_on),
    scope: row.scope,
    entity_id: row.entity_id ? String(row.entity_id) : null,
    phone_alert: row.phone_alert !== false,
    next_on: nextOn,
    phone: {
      alert_on: alertOn,
      reason: row.phone_alert === false ? "phone_alert_off" : plan.push ? null : plan.reason,
      sent: went ? went.state : null
    },
    added_by: row.created_by === "staff" ? "staff" : "client"
  };
}

export default { listCustomItems, addCustomItem, updateCustomItem, removeCustomItem, setCustomPhone, readCustomInput, customView };
