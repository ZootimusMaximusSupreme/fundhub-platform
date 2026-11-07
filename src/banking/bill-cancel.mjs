// "Cancel it for me" — a client's repeat bills, each with a button that asks
// the Fundhub team to cancel it, and where that ask stands.
//
// Finance OS wave 4, unit CANCEL (ops/workflows/finance-os-wave4-brief.txt):
// "a button creates a Fundhub team task to cancel that bill (the existing staff
// task system), with status Requested / Working / Cancelled shown on the bill,
// plus the merchant's own cancel link when one is known. Never auto-cancel
// through an API."
//
// WHAT A BILL IS. A row in recurring_bills (migration 086) the detector is sure
// of (medium or high, PRESENTABLE_LABELS), on an open account of this client —
// the same rows the Overview's "Repeating bills" list reads. A bill is named by
// its bank account and the detector's merchant key, the same pair
// src/banking/bill-cleanup.mjs flags by, so a re-detected row keeps its ask.
//
// THE TEAM TASK. The press calls createTask (src/lib/create-task.mjs, the one
// place work is made for a person): role 'csm', source 'bill-cancel', so it
// lands on the CSM queue (/app/csm-queue.html). The status is read from that
// task, never stored twice (migration 586):
//
//   no ask, or its task was removed     none       → "Cancel it for me"
//   task open, nobody has claimed it    requested  → "Requested"
//   task open, a person claimed it      working    → "Working"
//   task done                           cancelled  → "Cancelled"
//
// A bill marked cancelled that charges AGAIN after that day says so, and the
// button comes back as "Ask again" — "Cancelled" is never shown over a new
// charge as if it were the last word.
//
// THE MERCHANT'S OWN CANCEL LINK. merchant_cancel_links (586): set by a person
// on the team who used that page, per org and merchant key. Empty until someone
// sets one. Never guessed from a merchant's name. https only.
//
// NOTHING HERE CANCELS ANYTHING. No merchant, bank or card company is called.
// No money moves and no message is sent. org_id and client_id are bound on
// every statement.

import { PRESENTABLE_LABELS } from "./recurring.mjs";
import { createTask as defaultCreateTask } from "../lib/create-task.mjs";

export const SOURCE_WORKFLOW = "bill-cancel";
export const TASK_ROLE = "csm";
export const STATES = Object.freeze(["none", "requested", "working", "cancelled"]);
export const BILL_LIMIT = 200;
export const URL_MAX = 500;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const CADENCE_WORD = { weekly: "every week", biweekly: "every two weeks", monthly: "every month", annual: "every year" };

const text = (v) => (v === null || v === undefined || String(v).trim() === "" ? null : String(v).trim());
export const isUuid = (v) => typeof v === "string" && UUID.test(v);

/* bigint arrives as a string from node-postgres. Integer cents or null. */
function intCents(v) {
  if (typeof v === "string" && /^-?\d+$/.test(v.trim())) return Number(v.trim());
  return Number.isSafeInteger(v) ? v : null;
}

/** A date or timestamp → 'YYYY-MM-DD' (UTC), or null. */
export function dayOf(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  const s = String(v).trim();
  if (DAY.test(s.slice(0, 10)) && (s.length === 10 || s.charAt(10) === "T" || s.charAt(10) === " ")) {
    if (s.length === 10) return s;
    const t = new Date(s);
    return Number.isNaN(t.getTime()) ? s.slice(0, 10) : t.toISOString().slice(0, 10);
  }
  return null;
}

function lastFour(v) {
  const s = text(v);
  if (!s) return null;
  const digits = s.replace(/\D/g, "");
  return digits ? digits.slice(-4) : null;
}

function usd(cents) {
  if (!Number.isSafeInteger(cents)) return null;
  const n = Math.abs(cents);
  const whole = Math.floor(n / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return "$" + whole + "." + String(n % 100).padStart(2, "0");
}

function longDay(iso) {
  if (!iso || !DAY.test(iso)) return null;
  const [y, m, d] = iso.split("-").map(Number);
  return MONTHS[m - 1] + " " + d + ", " + y;
}

/**
 * cleanCancelUrl(raw) → the https address, or null. A whole address with a real
 * host; no user name or password in it; no spaces; at most URL_MAX characters.
 */
export function cleanCancelUrl(raw) {
  const s = text(raw);
  if (!s || s.length > URL_MAX || /\s/.test(s)) return null;
  let u;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== "https:") return null;
  if (u.username || u.password) return null;
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(u.hostname)) return null;
  const href = u.href;
  return href.length > URL_MAX ? null : href;
}

/**
 * cancelState(request, { lastChargeOn }) → { state, asked_on, cancelled_on,
 * charged_again_on, can_ask } — where one ask stands, from its task.
 *
 * request   the newest bill_cancel_requests row for the bill, joined to its
 *           task: { created_at, task_id, task_done, task_staff_id, task_updated_at }.
 * lastChargeOn  the bill's newest charge day (recurring_bills.last_seen_on).
 */
export function cancelState(request, { lastChargeOn = null } = {}) {
  const none = { state: "none", asked_on: null, cancelled_on: null, charged_again_on: null, can_ask: true };
  if (!request || !text(request.task_id) || request.task_done === null || request.task_done === undefined) return none;
  const asked = dayOf(request.created_at);
  if (request.task_done === true) {
    const cancelled = dayOf(request.task_updated_at);
    const last = dayOf(lastChargeOn);
    const again = cancelled && last && last > cancelled ? last : null;
    return { state: "cancelled", asked_on: asked, cancelled_on: cancelled, charged_again_on: again, can_ask: again !== null };
  }
  return {
    state: text(request.task_staff_id) ? "working" : "requested",
    asked_on: asked, cancelled_on: null, charged_again_on: null, can_ask: false
  };
}

const billKey = (accountId, merchantKey) => `${accountId} ${merchantKey}`;

/** One recurring_bills row (joined to its account) → what the screen shows. */
export function billView(row, { request = null, link = null } = {}) {
  const amount = intCents(row.typical_amount_cents);
  const lastOn = dayOf(row.last_seen_on);
  return {
    id: String(row.id),
    name: text(row.merchant_display) || text(row.merchant_key),
    merchant_key: text(row.merchant_key),
    cadence: text(row.cadence),
    /* 086 stores a bill as a NEGATIVE number. A person reads the size. */
    amount_cents: amount === null ? null : Math.abs(amount),
    next_on: dayOf(row.next_expected_on),
    last_on: lastOn,
    account_name: text(row.account_name) || text(row.account_official_name),
    account_mask: lastFour(row.account_mask),
    cancel: cancelState(request, { lastChargeOn: lastOn }),
    link: link && text(link.url) ? { url: String(link.url), set_on: dayOf(link.set_at) } : null
  };
}

/**
 * buildBillCancel({ bills, requests, links, viewer }) → the block the Strategy
 * screen draws. PURE. `requests` newest first; the newest per bill wins.
 */
export function buildBillCancel({ bills = [], requests = [], links = [], viewer = "client" } = {}) {
  const latest = new Map();
  for (const r of Array.isArray(requests) ? requests : []) {
    if (!r || !text(r.bank_account_id) || !text(r.merchant_key)) continue;
    const k = billKey(String(r.bank_account_id), String(r.merchant_key));
    if (!latest.has(k)) latest.set(k, r);
  }
  const byMerchant = new Map();
  for (const l of Array.isArray(links) ? links : []) {
    if (l && text(l.merchant_key) && text(l.url)) byMerchant.set(String(l.merchant_key), l);
  }
  const out = (Array.isArray(bills) ? bills : [])
    .filter((b) => b && b.id && text(b.bank_account_id) && text(b.merchant_key))
    .map((b) => billView(b, {
      request: latest.get(billKey(String(b.bank_account_id), String(b.merchant_key))) || null,
      link: byMerchant.get(String(b.merchant_key)) || null
    }))
    .sort((a, b) => (a.next_on ?? "9999") < (b.next_on ?? "9999") ? -1
      : (a.next_on ?? "9999") > (b.next_on ?? "9999") ? 1
        : String(a.name).localeCompare(String(b.name)) || a.id.localeCompare(b.id));
  const counts = { requested: 0, working: 0, cancelled: 0 };
  for (const b of out) if (counts[b.cancel.state] !== undefined) counts[b.cancel.state] += 1;
  return { ok: true, viewer: viewer === "staff" ? "staff" : "client", bills: out, counts };
}

/**
 * taskWords(bill, { today }) → { title, detail, dueAt } for the CSM's task.
 * Only facts on file; an unknown amount or date is left out, never "$0".
 */
export function taskWords(b, { today } = {}) {
  const name = text(b.merchant_display) || text(b.merchant_key) || "a repeat bill";
  const amount = intCents(b.typical_amount_cents);
  const where = [text(b.account_name) || text(b.account_official_name), lastFour(b.account_mask) ? "····" + lastFour(b.account_mask) : null]
    .filter(Boolean).join(" ");
  const charge = [
    usd(amount === null ? null : Math.abs(amount)),
    CADENCE_WORD[text(b.cadence)] || null,
    where ? "on " + where : null
  ].filter(Boolean).join(" ");
  const last = longDay(dayOf(b.last_seen_on));
  const nextIso = dayOf(b.next_expected_on);
  const next = longDay(nextIso);
  const sentences = [
    `The client asked Fundhub to cancel ${name}.`,
    charge ? `It charges ${charge}.` : null,
    last ? `Last charge ${last}.` : null,
    next ? `Next charge about ${next}.` : null,
    "Cancel it with the company, then mark this task done."
  ].filter(Boolean);
  const todayIso = dayOf(today);
  return {
    title: `Cancel a repeat bill: ${name}`.slice(0, 200),
    detail: sentences.join(" "),
    dueAt: nextIso && todayIso && nextIso >= todayIso ? nextIso : null
  };
}

/* ── the reads ───────────────────────────────────────────────────────────── */

/* Dates as text: node-postgres moves a `date` a day east of UTC otherwise. */
const BILL_COLUMNS = `
  b.id::text AS id, b.bank_account_id::text AS bank_account_id, b.merchant_key, b.merchant_display, b.cadence,
  b.typical_amount_cents, b.next_expected_on::text AS next_expected_on, b.last_seen_on::text AS last_seen_on,
  a.name AS account_name, a.official_name AS account_official_name, a.mask AS account_mask`;

const BILLS_SQL = `
  SELECT ${BILL_COLUMNS}
    FROM recurring_bills b
    JOIN bank_accounts a ON a.id = b.bank_account_id AND a.org_id = b.org_id AND a.client_id = b.client_id
   WHERE b.org_id = $1 AND b.client_id = $2
     AND b.confidence_label = ANY($3::text[])
     AND a.closed_at IS NULL
   ORDER BY b.next_expected_on ASC NULLS LAST, b.merchant_key ASC, b.id ASC
   LIMIT $4`;

const BILL_ONE_SQL = `
  SELECT ${BILL_COLUMNS}
    FROM recurring_bills b
    JOIN bank_accounts a ON a.id = b.bank_account_id AND a.org_id = b.org_id AND a.client_id = b.client_id
   WHERE b.org_id = $1 AND b.client_id = $2 AND b.id = $3::uuid
     AND b.confidence_label = ANY($4::text[])
     AND a.closed_at IS NULL`;

const REQUEST_COLUMNS = `
  r.id::text AS id, r.bank_account_id::text AS bank_account_id, r.merchant_key, r.created_at,
  r.task_id::text AS task_id, t.done AS task_done, t.assignee_staff_id::text AS task_staff_id,
  t.updated_at AS task_updated_at`;

const REQUESTS_SQL = `
  SELECT ${REQUEST_COLUMNS}
    FROM bill_cancel_requests r
    LEFT JOIN tasks t ON t.id = r.task_id AND t.org_id = r.org_id
   WHERE r.org_id = $1 AND r.client_id = $2
   ORDER BY r.created_at DESC, r.id DESC
   LIMIT 1000`;

const LATEST_FOR_BILL_SQL = `
  SELECT ${REQUEST_COLUMNS}, count(*) OVER () AS prior
    FROM bill_cancel_requests r
    LEFT JOIN tasks t ON t.id = r.task_id AND t.org_id = r.org_id
   WHERE r.org_id = $1 AND r.client_id = $2 AND r.bank_account_id = $3::uuid AND r.merchant_key = $4
   ORDER BY r.created_at DESC, r.id DESC
   LIMIT 1`;

const LINKS_SQL = `
  SELECT merchant_key, url, set_at
    FROM merchant_cancel_links
   WHERE org_id = $1 AND merchant_key = ANY($2::text[])`;

const TASK_BY_KEY_SQL = `
  SELECT id::text AS id FROM tasks
   WHERE org_id = $1 AND client_id = $2 AND source_workflow = $3 AND body = $4
   LIMIT 1`;

const INSERT_SQL = `
  INSERT INTO bill_cancel_requests
    (org_id, client_id, bank_account_id, merchant_key, recurring_bill_id, merchant_name, amount_cents, cadence,
     task_id, requested_by_kind, requested_by_staff_id)
  VALUES ($1, $2, $3::uuid, $4, $5::uuid, $6, $7, $8, $9::uuid, $10, $11)
  ON CONFLICT (task_id) WHERE task_id IS NOT NULL DO NOTHING
  RETURNING id::text AS id`;

const LINK_UPSERT_SQL = `
  INSERT INTO merchant_cancel_links (org_id, merchant_key, url, set_by_staff_id, set_at)
  VALUES ($1, $2, $3, $4, now())
  ON CONFLICT (org_id, merchant_key)
  DO UPDATE SET url = EXCLUDED.url, set_by_staff_id = EXCLUDED.set_by_staff_id, set_at = now()
  RETURNING merchant_key, url, set_at`;

function need(orgId, clientId, fn) {
  if (!orgId || !clientId) throw new TypeError(`${fn}: orgId and clientId are required`);
}

/**
 * readBillCancel(db, { orgId, clientId, viewer }) → buildBillCancel()'s block,
 * or { ok: false, reason } when the read failed. Read-only. Never throws on a
 * failed read, so the rest of the Strategy screen still loads.
 */
export async function readBillCancel(db, { orgId, clientId, viewer = "client" } = {}) {
  need(orgId, clientId, "readBillCancel");
  try {
    const bills = await db.query(BILLS_SQL, [orgId, clientId, [...PRESENTABLE_LABELS], BILL_LIMIT]);
    const rows = bills.rows || [];
    if (!rows.length) return buildBillCancel({ bills: [], viewer });
    const keys = [...new Set(rows.map((r) => text(r.merchant_key)).filter(Boolean))];
    const [requests, links] = await Promise.all([
      db.query(REQUESTS_SQL, [orgId, clientId]),
      db.query(LINKS_SQL, [orgId, keys])
    ]);
    return buildBillCancel({ bills: rows, requests: requests.rows || [], links: links.rows || [], viewer });
  } catch (e) {
    return { ok: false, reason: "read_failed", message: "Your repeat bills could not be read right now." };
  }
}

async function oneBill(db, { orgId, clientId, billId }) {
  const r = await db.query(BILL_ONE_SQL, [orgId, clientId, billId, [...PRESENTABLE_LABELS]]);
  return (r.rows && r.rows[0]) || null;
}

/**
 * requestBillCancel(db, { orgId, clientId, billId, actor, staffId, now, createTask })
 *   → { ok: true, created, bill_cancel } | { ok: false, error }
 *
 * The bill is looked up in the client's OWN file by id; nothing else the
 * browser sends is used. One open ask per bill: a second press while one is
 * open (or after a cancel that held) answers with what is there and writes
 * nothing. A cancel that charged again may be asked again — a new task.
 */
export async function requestBillCancel(db, {
  orgId, clientId, billId, actor = "client", staffId = null, now = new Date(), createTask = defaultCreateTask
} = {}) {
  need(orgId, clientId, "requestBillCancel");
  if (!isUuid(billId)) return { ok: false, error: "bad_bill_id" };
  const viewer = actor === "staff" ? "staff" : "client";
  const bill = await oneBill(db, { orgId, clientId, billId });
  if (!bill) return { ok: false, error: "bill_not_found" };

  const prior = await db.query(LATEST_FOR_BILL_SQL, [orgId, clientId, bill.bank_account_id, bill.merchant_key]);
  const latest = (prior.rows && prior.rows[0]) || null;
  const where = cancelState(latest, { lastChargeOn: bill.last_seen_on });
  if (!where.can_ask) {
    return { ok: true, created: false, bill_cancel: await readBillCancel(db, { orgId, clientId, viewer }) };
  }

  const n = (latest ? Number(latest.prior) || 1 : 0) + 1;
  const key = `${SOURCE_WORKFLOW}:${bill.bank_account_id}:${bill.merchant_key}:${n}`;
  const words = taskWords(bill, { today: now });
  const made = await createTask(db, {
    orgId,
    clientId,
    title: words.title,
    sourceWorkflow: SOURCE_WORKFLOW,
    assigneeRole: TASK_ROLE,
    eventId: key,
    dueAt: words.dueAt,
    detail: words.detail
  });
  let taskId = made && made.id ? String(made.id) : null;
  if (!taskId) {
    // Two presses at once: the other one's insert won. It is the same task.
    const again = await db.query(TASK_BY_KEY_SQL, [orgId, clientId, SOURCE_WORKFLOW, key]);
    taskId = again.rows && again.rows[0] ? String(again.rows[0].id) : null;
  }
  if (!taskId) return { ok: false, error: "task_not_saved" };

  const amount = intCents(bill.typical_amount_cents);
  await db.query(INSERT_SQL, [
    orgId, clientId, bill.bank_account_id, bill.merchant_key, bill.id,
    text(bill.merchant_display) || text(bill.merchant_key),
    amount === null || amount === 0 ? null : Math.abs(amount),
    text(bill.cadence),
    taskId,
    viewer,
    viewer === "staff" && isUuid(String(staffId || "")) ? staffId : null
  ]);

  return {
    ok: true,
    created: !!(made && made.created),
    bill_cancel: await readBillCancel(db, { orgId, clientId, viewer })
  };
}

/**
 * setCancelLink(db, { orgId, clientId, billId, url, staffId })
 *   → { ok: true, link, bill_cancel } | { ok: false, error }
 *
 * STAFF ONLY (the handler checks): a person on the team saves the merchant's
 * own cancel page they used. Keyed by the bill's merchant, so every client
 * with that merchant sees it. The merchant comes from the client's own bill,
 * never from the browser.
 */
export async function setCancelLink(db, { orgId, clientId, billId, url, staffId = null } = {}) {
  need(orgId, clientId, "setCancelLink");
  if (!isUuid(billId)) return { ok: false, error: "bad_bill_id" };
  const clean = cleanCancelUrl(url);
  if (!clean) return { ok: false, error: "bad_url" };
  const bill = await oneBill(db, { orgId, clientId, billId });
  if (!bill) return { ok: false, error: "bill_not_found" };
  const saved = await db.query(LINK_UPSERT_SQL, [orgId, bill.merchant_key, clean, isUuid(String(staffId || "")) ? staffId : null]);
  const row = saved.rows && saved.rows[0];
  return {
    ok: true,
    link: row ? { merchant_key: row.merchant_key, url: row.url, set_on: dayOf(row.set_at) } : { merchant_key: bill.merchant_key, url: clean, set_on: null },
    bill_cancel: await readBillCancel(db, { orgId, clientId, viewer: "staff" })
  };
}

export default { readBillCancel, requestBillCancel, setCancelLink, buildBillCancel, cancelState, cleanCancelUrl };
