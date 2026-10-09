// Credit soft-pull approve door. Report only. Never auto-fix.
// One GET of the approve screen. One GET of its read route, with no link token.
// One in-process GET of the same read, with a link signed for a real client, to
// see the database half answer. None of these GETs pulls credit or sends bureau
// mail. The handler is only ever asked to read.
// Recon (AG-07) is the one tripwire. Do not invent a second watchdog.
// Do not edit the approve page from this check.
//
// The plain up/down ping of both doors is reg:soft-pull-approve.html and
// reg:soft-pull-approve in the registry. What these add: the screen is really
// the approve screen, the unsigned answer has the right shape, and a signed
// read reaches the database and comes back with the words and the price.

//
// 2026-10-09 (Tier 1): three more rows read the credit-pull ledger itself, the
// part the doors above cannot see: did a pull fail or stall, did a paid buyer
// never get the pull form, did a paid and approved client never get a pull.
// They read the database only. They never pull credit, never send, never POST.

import { secretFromEnv } from "../../documents/signed-url.mjs";
import { signSoftPullApproveUrl } from "../../consent/approve-token.mjs";
import { CONSENT_VALID_SQL } from "../../consent/index.mjs";
import { classifyVisitor } from "../../slo/visitor.mjs";
import { TEST_CLIENT_EMAIL_RE } from "./gap-consent.mjs";

export const DEFAULT_BASE_URL = "https://fundhub.ai";
export const APPROVE_PAGE_PATH = "/app/soft-pull-approve.html";
export const APPROVE_READ_PATH = "/api/soft-pull-approve";

/** The screen calls this path. A 200 page that lacks it is not the approve screen. */
export const PAGE_MARKER = "/api/soft-pull-approve";

/** What GET /api/soft-pull-approve returns when the link is real. */
export const READ_KIND = "soft_pull_consent";

export const CHECK_IDS = Object.freeze([
  "soft-pull:approve-page",
  "soft-pull:approve-read",
  "soft-pull:approve-signed-read"
]);

/** Each GET gets this long. Both run at once, and the lane step has 26 seconds. */
export const FETCH_TIMEOUT_MS = 8000;

/** The newest real client. Any client will do: the read is thrown away. */
export const CLIENT_PICK_SQL = `
/* gap:soft-pull-client */
SELECT c.id::text AS id
  FROM clients c
 WHERE c.org_id = $1::uuid
   AND c.is_demo IS NOT TRUE
 ORDER BY c.created_at DESC
 LIMIT 1
`.trim();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const TRIPWIRE =
  "Recon (AG-07) is the one tripwire. Do not invent a second watchdog. " +
  "Do not pull credit. Do not send bureau mail. Do not edit the approve page. Do not auto-fix.";

const PAGE_FIX =
  `Put the soft-pull approve screen back at ${APPROVE_PAGE_PATH}. ${TRIPWIRE}`;

const READ_FIX =
  `Fix GET ${APPROVE_READ_PATH} so the approve screen can read it. Do not POST. ${TRIPWIRE}`;

function check(id, status, detail, suggestedFix = null) {
  return { id, status, detail, suggestedFix };
}

function clip(s, n = 160) {
  return String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, n);
}

function originOf(baseUrl) {
  return String(baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function httpStatus(res) {
  const n = Number(res && res.status);
  return Number.isInteger(n) ? n : null;
}

async function bodyText(res) {
  if (res && typeof res.text === "function") return String((await res.text()) ?? "");
  if (res && typeof res.json === "function") {
    const value = await res.json();
    return JSON.stringify(value);
  }
  return "";
}

function parseJson(text) {
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

/** Unsigned refusal, or the disclosure read. Never a credit pull. */
export function approveReadShape(status, body) {
  if (!body || typeof body !== "object") return false;
  if (status === 200) {
    return body.ok === true
      && body.kind === READ_KIND
      && body.disclosure != null
      && typeof body.disclosure === "object"
      && body.pricing != null
      && typeof body.pricing === "object";
  }
  if (status === 400 || status === 401) {
    return body.ok === false && typeof body.error === "string" && body.error.length > 0;
  }
  return false;
}

async function readGet(fetchImpl, url, accept) {
  const init = {
    method: "GET",
    credentials: "omit",
    headers: { accept }
  };
  // A door that never answers must not hold up the whole morning pulse.
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    init.signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  }
  const res = await fetchImpl(url, init);
  const text = await bodyText(res);
  return { status: httpStatus(res), text };
}

export async function checkApprovePage({ fetchImpl, baseUrl = DEFAULT_BASE_URL } = {}) {
  const id = "soft-pull:approve-page";
  if (typeof fetchImpl !== "function") {
    return check(id, "skip", "no fetch in this run — approve screen not opened");
  }
  const url = `${originOf(baseUrl)}${APPROVE_PAGE_PATH}`;
  try {
    const { status, text } = await readGet(fetchImpl, url, "text/html");
    if (status === 404 || (status != null && status >= 500)) {
      const extra = text ? `: ${clip(text, 120)}` : "";
      return check(id, "FAIL", `soft-pull approve screen answered ${status}${extra}`, PAGE_FIX);
    }
    if (status === 200 && text.includes(PAGE_MARKER)) {
      return check(id, "PASS", "soft-pull approve screen loaded");
    }
    const why = status === 200 ? "without its read route" : `answered ${status == null ? "nothing" : status}`;
    return check(id, "FAIL", `soft-pull approve screen ${why}`, PAGE_FIX);
  } catch (err) {
    return check(id, "FAIL", `soft-pull approve screen unreachable: ${clip(err && err.message)}`, PAGE_FIX);
  }
}

export async function checkApproveRead({ fetchImpl, baseUrl = DEFAULT_BASE_URL } = {}) {
  const id = "soft-pull:approve-read";
  if (typeof fetchImpl !== "function") {
    return check(id, "skip", "no fetch in this run — approve read API not opened");
  }
  const url = `${originOf(baseUrl)}${APPROVE_READ_PATH}`;
  try {
    const { status, text } = await readGet(fetchImpl, url, "application/json");
    if (status === 404 || (status != null && status >= 500)) {
      const extra = text ? `: ${clip(text, 120)}` : "";
      return check(id, "FAIL", `soft-pull read API answered ${status}${extra}`, READ_FIX);
    }
    const body = parseJson(text);
    if (approveReadShape(status, body)) {
      const shape = status === 200 ? "approval read shape" : "unsigned link shape";
      return check(id, "PASS", `soft-pull read API answered ${status} with the ${shape}`);
    }
    return check(
      id,
      "FAIL",
      `soft-pull read API answered ${status == null ? "nothing" : status} but the body was not the approval read shape`,
      READ_FIX
    );
  } catch (err) {
    return check(id, "FAIL", `soft-pull read API unreachable: ${clip(err && err.message)}`, READ_FIX);
  }
}

function mockRes() {
  return {
    statusCode: 0,
    body: null,
    headers: {},
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; }
  };
}

/** The word and the price the approve screen paints. Names and contact stay out. */
export function signedReadShape(status, body) {
  if (status !== 200 || !body || typeof body !== "object") return false;
  const text = body.disclosure && typeof body.disclosure === "object" ? body.disclosure.text : null;
  const base = body.pricing && typeof body.pricing === "object" ? Number(body.pricing.base_cents) : NaN;
  return body.ok === true
    && body.kind === READ_KIND
    && typeof text === "string" && text.trim().length > 0
    && Number.isFinite(base) && base > 0
    && body.consent != null && typeof body.consent === "object"
    && body.contact != null && typeof body.contact === "object";
}

/**
 * The approve read, with a link signed for a real client, run in-process.
 * The signed-out GET only ever sees the first refusal, which is answered before
 * the database or the words are touched. This one gets past it: it signs a link
 * the same way the closer's Present cockpit does, hands it to the real handler
 * with the pulse's database, and checks the 200 has the words and the price.
 * GET only. The handler writes nothing on a GET.
 */
export async function checkApproveSignedRead(ctx = {}) {
  const id = "soft-pull:approve-signed-read";
  const db = ctx.db;
  const orgId = typeof ctx.orgId === "string" ? ctx.orgId.trim() : "";
  if (!db || typeof db.query !== "function") {
    return check(id, "skip", "no database in this run — signed approve read not opened");
  }
  if (!UUID_RE.test(orgId)) {
    return check(id, "skip", "no company in this run — signed approve read not opened");
  }
  const env = ctx.env && typeof ctx.env === "object" ? ctx.env : process.env;

  let secret;
  try {
    secret = secretFromEnv(env);
  } catch {
    return check(
      id,
      "FAIL",
      "approval links cannot be signed: DOCUMENT_URL_SECRET is missing or too short",
      `Set DOCUMENT_URL_SECRET (32 or more characters) on Netlify. ${TRIPWIRE}`
    );
  }

  let clientId;
  try {
    const found = await db.query(CLIENT_PICK_SQL, [orgId]);
    clientId = found && found.rows && found.rows[0] ? found.rows[0].id : null;
  } catch (err) {
    return check(id, "FAIL", `could not pick a client to read: ${clip(err && err.message)}`, READ_FIX);
  }
  if (!clientId) return check(id, "skip", "no real client on file — signed approve read not opened");

  try {
    const handler = typeof ctx.approveHandler === "function"
      ? ctx.approveHandler
      : (await import("../../../api/soft-pull-approve.mjs")).default;
    const signed = signSoftPullApproveUrl({ orgId, clientId, ttlSeconds: 300, secret });
    const query = Object.fromEntries(new URL(signed.path, "https://link.invalid").searchParams);
    const res = mockRes();
    await handler({ method: "GET", headers: {}, query, body: null }, res, { db, env, secret });
    const status = Number(res.statusCode) || 0;
    if (signedReadShape(status, res.body)) {
      return check(id, "PASS", "signed approve read answered 200 with the words, the price and the consent state");
    }
    const code = res.body && typeof res.body.error === "string" ? ` (${clip(res.body.error, 60)})` : "";
    return check(
      id,
      "FAIL",
      `signed approve read answered ${status || "nothing"}${code} and not the approval read shape`,
      READ_FIX
    );
  } catch (err) {
    return check(id, "FAIL", `signed approve read threw: ${clip(err && err.message)}`, READ_FIX);
  }
}

// ---------------------------------------------------------------------------
// The credit-pull ledger. Three questions a paying customer would feel.
//
// WHAT THE PULL IS, IN ONE PICTURE (read from the code on 2026-10-09):
//   1. A buyer pays a diagnostic (the $297 roadmap, or the $32 approve link).
//   2. diagnostic.paid starts C-00. C-00 writes a soft_pull_requests row
//      ('queued') only when a live soft_pull_consent is on file AND the client
//      has a portal account. With no consent, or no account, it stops and
//      writes NOTHING. That silence is the hole the third row below watches.
//      When a pull is ALREADY open for the client (queued or processing), C-00
//      gets "already_open" and writes no new row. That older row is the pull
//      for this payment; row 3 counts it (see pullAnswersPayment).
//   3. The same job claims the row ('processing'), asks CRS, and closes it
//      'fulfilled' or 'failed'.
//   The $297 roadmap buyer pays first, then fills the pull form. The form
//   stores consent and, once the order is paid, fires diagnostic.paid again.
//   The approve link is the other way round: consent and identity first, then
//   a $32 checkout, and the pull runs when that is paid. So "consent given, no
//   pull yet" is NORMAL until the buyer pays. Only paid + consented + no pull
//   is a break.
//
// WHO CAN LEAVE A ROW 'queued', AND FOR HOW LONG:
//   * C-00 (idempotency key 'diagnostic-paid:...') and the Finance OS sweeper
//     (requested_by_kind 'system') run the pull in the same job. A row still
//     queued 15 minutes later means the job died.
//   * A staff or portal tap on the soft-pull request door, and the paid dispute
//     round, only RECORD the request. A person presses the staff pull button
//     later. Those rows wait on a human, so they get 48 hours, not 15 minutes.
//   * 'processing' is a runner holding the row. Seconds, never 15 minutes.
//
// Every number below is a threshold in JS, applied to rows the SQL fetched
// wide, so the unit tests can walk each boundary. The SQL only picks the real
// (non-test, non-demo) clients and the right tables.
// ---------------------------------------------------------------------------

export const PULL_CHECK_IDS = Object.freeze([
  "softpull:request-failed-or-stuck",
  "softpull:paid-form-not-filled-2h",
  "softpull:approve-click-no-pull"
]);

/** Every row this lane returns, doors first. */
export const ALL_CHECK_IDS = Object.freeze([...CHECK_IDS, ...PULL_CHECK_IDS]);

/** A failed pull is news for this long, unless the client has had a newer pull since. */
export const FAILED_LOOKBACK_DAYS = 3;
/** A pull run by C-00 or the Finance OS sweeper is done in seconds. */
export const AUTO_QUEUED_MINUTES = 15;
/** A runner that claimed a row and never closed it. */
export const PROCESSING_MINUTES = 15;
/** A request that waits on a person to press the staff pull button. */
export const HUMAN_QUEUED_HOURS = 48;
/** A paid roadmap buyer gets this long before "no form, no reminder" is a break. */
export const PAID_FORM_HOURS = 2;
/** Older than this is the consent:required lane's job, not a morning alarm. */
export const PAID_FORM_LOOKBACK_DAYS = 14;
/** Paid and approved, then this long with no pull row. */
export const NO_PULL_MINUTES = 15;
export const NO_PULL_LOOKBACK_DAYS = 30;
/** Clock slop between the payment stamp and the pull row's own stamp. */
export const NO_PULL_SLOP_MINUTES = 2;
/** The reminder C-00's sibling sends 15 minutes after a $297 payment. */
export const NUDGE_KEYS = Object.freeze(["SMS-SLO-PAID-FORM-01", "EMAIL-SLO-PAID-FORM-01"]);
/** A reminder in one of these never reached the buyer. */
export const NUDGE_DEAD_STATUSES = Object.freeze(["failed", "bounced", "blocked", "cancelled"]);
export const LEDGER_ROW_CAP = 500;
export const ORDER_ROW_CAP = 200;
/** One lane read gets this long. The lane step has 26 seconds in all. */
export const READ_TIMEOUT_MS = 8000;

const SOFT_PULL_KIND = "soft_pull_consent";
const PAID_DIAGNOSTIC_KEY_PREFIX = "diagnostic-paid:";
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const LEDGER_FIX =
  "Open the client in the Client Control Panel and read the credit pull row. For a failed pull, read the reason and run the staff pull button again once it is fixed. For a stuck pull, read the C-00 run for the payment. This check only reads. Do not pull credit or send anything from it. Do not auto-fix.";
const PAID_FORM_FIX =
  "Read the slo-paid-form-nudge run for these buyers and the EMAIL-SLO-PAID-FORM-01 and SMS-SLO-PAID-FORM-01 rows in messages. The buyer needs the roadmap form link. This check only reads. Do not send from it. Do not auto-fix.";
const NO_PULL_FIX =
  "Read the C-00 run for the payment (diagnostic.paid). It stops with no row when the client has no portal account. Fix that on the client record, then run the staff pull button. This check only reads. Do not pull credit from it. Do not auto-fix.";

/* A test client is one nobody is selling to: the demo flag, the synthetic flag,
   or an address the sim seeder and our own e2e runs use. Same rule as
   gap-consent.mjs, which owns the pattern; this is only the SQL wrapper. */
function testClientSql(alias, param) {
  return `(COALESCE(${alias}.is_demo, false)
          OR COALESCE(${alias}.custom_fields ->> 'synthetic', '') = 'true'
          OR COALESCE(${alias}.email, '') ~* ${param})`;
}

/** The newest pulls, and every pull still open. Open ones sort first so a row cap can never hide a stuck one. */
export const LEDGER_SQL = `
/* gap:softpull-ledger */
SELECT r.id::text AS id,
       r.client_id::text AS client_id,
       r.status,
       r.state_reason,
       r.requested_by_kind,
       r.idempotency_key,
       r.requested_at,
       r.updated_at
  FROM soft_pull_requests r
  JOIN clients c ON c.id = r.client_id AND c.org_id = r.org_id
 WHERE r.org_id = $1::uuid
   AND ($3::boolean OR NOT ${testClientSql("c", "$4")})
   AND (r.status IN ('queued', 'processing')
        OR r.requested_at > $2::timestamptz - interval '${FAILED_LOOKBACK_DAYS} days')
 ORDER BY (r.status IN ('queued', 'processing')) DESC, r.requested_at DESC
 LIMIT ${LEDGER_ROW_CAP}
`.trim();

/** Paid $297 roadmap orders whose pull form is still empty. */
export const PAID_FORM_ORDERS_SQL = `
/* gap:softpull-paid-form-orders */
SELECT pl.id::text AS order_id,
       pl.client_id::text AS client_id,
       c.email,
       COALESCE(pl.paid_at, pl.updated_at) AS paid_at
  FROM payment_links pl
  JOIN clients c ON c.id = pl.client_id AND c.org_id = pl.org_id
 WHERE pl.org_id = $1::uuid
   AND pl.purpose = 'diagnostic'
   AND lower(btrim(COALESCE(pl.description, ''))) LIKE 'slo diagnostic%'
   AND (pl.status = 'paid' OR pl.paid_at IS NOT NULL)
   AND pl.identity_stored_at IS NULL
   AND ($3::boolean OR COALESCE(pl.is_demo, false) = false)
   AND ($3::boolean OR NOT ${testClientSql("c", "$4")})
   AND COALESCE(pl.paid_at, pl.updated_at) > $2::timestamptz - interval '${PAID_FORM_LOOKBACK_DAYS} days'
 ORDER BY COALESCE(pl.paid_at, pl.updated_at) ASC
 LIMIT ${ORDER_ROW_CAP}
`.trim();

/** Paid diagnostic orders of any kind: the roadmap and the approve-link $32. */
export const PAID_DIAGNOSTICS_SQL = `
/* gap:softpull-paid-diagnostics */
SELECT pl.id::text AS order_id,
       pl.client_id::text AS client_id,
       COALESCE(pl.paid_at, pl.updated_at) AS paid_at
  FROM payment_links pl
  JOIN clients c ON c.id = pl.client_id AND c.org_id = pl.org_id
 WHERE pl.org_id = $1::uuid
   AND pl.purpose = 'diagnostic'
   AND (pl.status = 'paid' OR pl.paid_at IS NOT NULL)
   AND ($3::boolean OR COALESCE(pl.is_demo, false) = false)
   AND ($3::boolean OR NOT ${testClientSql("c", "$4")})
   AND COALESCE(pl.paid_at, pl.updated_at) > $2::timestamptz - interval '${NO_PULL_LOOKBACK_DAYS} days'
 ORDER BY COALESCE(pl.paid_at, pl.updated_at) ASC
 LIMIT ${ORDER_ROW_CAP}
`.trim();

/** The newest LIVE soft-pull consent per client. The validity rule is the one the pull gate uses. */
export const LIVE_CONSENT_SQL = `
/* gap:softpull-live-consent */
SELECT cc.client_id::text AS client_id,
       max(cc.granted_at) AS granted_at
  FROM client_consents cc
 WHERE cc.org_id = $1::uuid
   AND cc.kind = $2
   AND cc.client_id = ANY($3::uuid[])
   AND (${CONSENT_VALID_SQL})
 GROUP BY cc.client_id
`.trim();

/** Clients who already hold a credit file of their own. */
export const HAS_FILE_SQL = `
/* gap:softpull-has-file */
SELECT DISTINCT cr.client_id::text AS client_id
  FROM crs_results cr
 WHERE cr.org_id = $1::uuid
   AND cr.client_id = ANY($2::uuid[])
   AND COALESCE(cr.is_demo, false) = false
`.trim();

/** The pull-form reminders, whatever their fate. */
export const NUDGES_SQL = `
/* gap:softpull-nudges */
SELECT m.client_id::text AS client_id,
       m.template_key,
       m.status,
       m.created_at
  FROM messages m
 WHERE m.org_id = $1::uuid
   AND m.client_id = ANY($2::uuid[])
   AND m.template_key = ANY($3::text[])
`.trim();

/**
 * Each client's pull rows: when asked, what state, when closed. A pull that was
 * already open when the payment landed is not given a new row (C-00 gets
 * "already_open" and stops), so "was a row made after the payment" is not enough.
 * The state and the close time let the judge see a pull that was open at the
 * payment and finished after it.
 */
export const PULL_TIMES_SQL = `
/* gap:softpull-pull-times */
SELECT r.client_id::text AS client_id,
       r.requested_at,
       r.status,
       r.resolved_at,
       r.updated_at
  FROM soft_pull_requests r
 WHERE r.org_id = $1::uuid
   AND r.client_id = ANY($2::uuid[])
`.trim();

export const PULL_READ_SQL = Object.freeze([
  LEDGER_SQL, PAID_FORM_ORDERS_SQL, PAID_DIAGNOSTICS_SQL,
  LIVE_CONSENT_SQL, HAS_FILE_SQL, NUDGES_SQL, PULL_TIMES_SQL
]);

/** A pull check never writes. Refuse any statement that is not a plain read. */
export function assertReadOnlySql(sql) {
  const body = String(sql || "").replace(/\/\*[\s\S]*?\*\//g, "").trim();
  if (!/^(select|with)\b/i.test(body) || /\b(insert|update|delete|drop|alter|truncate|begin|commit|rollback|set)\b/i.test(body)) {
    throw new Error("soft-pull ledger check refused a statement that is not a plain read");
  }
}

function nowOf(ctx) {
  const n = ctx && ctx.now;
  return n instanceof Date && !Number.isNaN(n.getTime()) ? n : new Date();
}

function ms(value) {
  if (value == null) return NaN;
  const t = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(t) ? t : NaN;
}

function shortId(id) {
  return String(id == null ? "" : id).slice(0, 8);
}

function plural(n, one, many) {
  return n === 1 ? one : many;
}

/** "52 min", "5 hours", "3 days": short, for a sentence a person reads fast. */
export function ageText(durationMs) {
  const d = Math.max(0, Number(durationMs) || 0);
  if (d < 2 * HOUR) return `${Math.max(1, Math.round(d / MIN))} min`;
  if (d < 2 * DAY) return `${Math.round(d / HOUR)} hours`;
  return `${Math.round(d / DAY)} days`;
}

function withTimeout(promise, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} took longer than ${READ_TIMEOUT_MS / 1000} seconds`)), READ_TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function canQuery(ctx) {
  return typeof ctx.scope === "function"
    || !!(ctx.scope && typeof ctx.scope.asStaff === "function")
    || !!(ctx.db && typeof ctx.db.query === "function");
}

/**
 * Run a few reads on one connection. The pulse hands over a staff scope (the
 * tables are row-secured); with none, the plain pool is used. Nothing here
 * opens or closes a transaction on the shared pool.
 */
export async function withReader(ctx, label, fn) {
  const reader = {
    async query(sql, params) {
      assertReadOnlySql(sql);
      return reader.tx.query(sql, params);
    }
  };
  const run = (tx) => { reader.tx = tx; return fn(reader); };
  let job;
  if (typeof ctx.scope === "function") job = ctx.scope(run);
  else if (ctx.scope && typeof ctx.scope.asStaff === "function") job = ctx.scope.asStaff(run);
  else job = run(ctx.db);
  return withTimeout(Promise.resolve(job), label);
}

function guard(ctx, id, what) {
  if (!canQuery(ctx)) return check(id, "skip", `no database in this run — ${what} not read`);
  const orgId = typeof ctx.orgId === "string" ? ctx.orgId.trim() : "";
  if (!UUID_RE.test(orgId)) return check(id, "skip", `no company in this run — ${what} not read`);
  return null;
}

function skipRead(id, what, err) {
  return check(id, "skip", `could not read ${what}: ${clip(err && err.message)}`);
}

// ---- row 1: did a credit pull fail, or never finish? ----------------------

function pullSource(row) {
  const key = String(row.idempotency_key || "");
  if (key.startsWith(PAID_DIAGNOSTIC_KEY_PREFIX)) return "paid_diagnostic";
  if (String(row.requested_by_kind || "") === "system") return "finance_os";
  return "person";
}

/**
 * Sort ledger rows into the ways a pull goes wrong. Pure: rows and a clock in,
 * lists out. A failed pull is forgiven once the same client has a newer pull
 * that is open or fulfilled, because someone already retried it.
 */
export function judgeLedger(rows, nowMs) {
  const list = Array.isArray(rows) ? rows : [];
  const byClient = new Map();
  for (const row of list) {
    const key = String(row.client_id);
    if (!byClient.has(key)) byClient.set(key, []);
    byClient.get(key).push(row);
  }
  const out = { failed: [], stuckAuto: [], stuckProcessing: [], stuckPerson: [] };
  for (const row of list) {
    const asked = ms(row.requested_at);
    if (!Number.isFinite(asked)) continue;
    const status = String(row.status || "");
    if (status === "failed") {
      if (nowMs - asked > FAILED_LOOKBACK_DAYS * DAY) continue;
      const retried = (byClient.get(String(row.client_id)) || []).some((other) =>
        other !== row
        && ms(other.requested_at) > asked
        && ["queued", "processing", "fulfilled"].includes(String(other.status)));
      if (!retried) out.failed.push({ row, ageMs: nowMs - asked });
    } else if (status === "processing") {
      const touched = ms(row.updated_at);
      const since = Number.isFinite(touched) ? touched : asked;
      if (nowMs - since > PROCESSING_MINUTES * MIN) out.stuckProcessing.push({ row, ageMs: nowMs - since });
    } else if (status === "queued") {
      const waited = nowMs - asked;
      if (pullSource(row) === "person") {
        if (waited > HUMAN_QUEUED_HOURS * HOUR) out.stuckPerson.push({ row, ageMs: waited });
      } else if (waited > AUTO_QUEUED_MINUTES * MIN) {
        out.stuckAuto.push({ row, ageMs: waited });
      }
    }
  }
  return out;
}

function oldest(list) {
  return list.reduce((m, x) => Math.max(m, x.ageMs), 0);
}

export async function checkRequestFailedOrStuck(ctx = {}) {
  const id = "softpull:request-failed-or-stuck";
  const early = guard(ctx, id, "credit pull ledger");
  if (early) return early;
  const now = nowOf(ctx);
  let rows;
  try {
    rows = await withReader(ctx, "credit pull ledger", async (q) => {
      const res = await q.query(LEDGER_SQL, [ctx.orgId.trim(), now.toISOString(), ctx.demoOn === true, TEST_CLIENT_EMAIL_RE]);
      return res && Array.isArray(res.rows) ? res.rows : [];
    });
  } catch (err) {
    return skipRead(id, "the credit pull ledger", err);
  }

  const j = judgeLedger(rows, now.getTime());
  const total = j.failed.length + j.stuckAuto.length + j.stuckProcessing.length + j.stuckPerson.length;
  if (total === 0) {
    return check(
      id,
      "PASS",
      `no credit pull failed in the last ${FAILED_LOOKBACK_DAYS} days or is stuck (${rows.length} pull ${plural(rows.length, "row", "rows")} read)`
    );
  }
  const parts = [];
  if (j.failed.length) {
    const why = [...new Set(j.failed.map((x) => clip(x.row.state_reason, 40)).filter(Boolean))].slice(0, 2);
    parts.push(`${j.failed.length} failed in the last ${FAILED_LOOKBACK_DAYS} days${why.length ? ` (reason: ${why.join("; ")})` : ""}`);
  }
  if (j.stuckAuto.length) {
    parts.push(`${j.stuckAuto.length} still queued after ${AUTO_QUEUED_MINUTES} min though the job runs it itself (oldest ${ageText(oldest(j.stuckAuto))})`);
  }
  if (j.stuckProcessing.length) {
    parts.push(`${j.stuckProcessing.length} stuck mid-run for over ${PROCESSING_MINUTES} min (oldest ${ageText(oldest(j.stuckProcessing))})`);
  }
  if (j.stuckPerson.length) {
    parts.push(`${j.stuckPerson.length} waiting on staff for over ${HUMAN_QUEUED_HOURS} hours (oldest ${ageText(oldest(j.stuckPerson))})`);
  }
  const ids = [...new Set([...j.failed, ...j.stuckAuto, ...j.stuckProcessing, ...j.stuckPerson].map((x) => shortId(x.row.client_id)))].slice(0, 3);
  return check(
    id,
    "FAIL",
    `${total} credit ${plural(total, "pull needs", "pulls need")} a look: ${parts.join("; ")}. Clients: ${ids.join(", ")}`,
    LEDGER_FIX
  );
}

// ---- row 2: paid, form still empty, and nobody reminded them -------------

function nudgeWentOut(nudges, clientId, paidMs) {
  return (nudges || []).some((m) =>
    String(m.client_id) === String(clientId)
    && NUDGE_KEYS.includes(String(m.template_key))
    && !NUDGE_DEAD_STATUSES.includes(String(m.status || "").toLowerCase())
    && !(ms(m.created_at) < paidMs));
}

/**
 * Which paid roadmap orders are stuck without a reminder. Pure.
 * `live` and `files` are sets of client ids; `nudges` the reminder rows.
 */
export function judgePaidForm({ orders, live, files, nudges, nowMs }) {
  const waiting = [];
  const reminded = [];
  const seen = new Set();
  for (const order of Array.isArray(orders) ? orders : []) {
    const paid = ms(order.paid_at);
    const client = String(order.client_id);
    if (!Number.isFinite(paid) || seen.has(client)) continue;
    if (nowMs - paid > PAID_FORM_LOOKBACK_DAYS * DAY) continue;
    // The reminder job never writes to a company, test or bot address, so an
    // order from one is not a buyer who was missed.
    const mail = String(order.email || "").trim().toLowerCase();
    if (!mail.includes("@") || classifyVisitor({ email: mail }).actor !== "person") continue;
    if (live.has(client) || files.has(client)) continue;
    seen.add(client);
    if (nowMs - paid <= PAID_FORM_HOURS * HOUR) continue;
    if (nudgeWentOut(nudges, client, paid)) reminded.push({ order, ageMs: nowMs - paid });
    else waiting.push({ order, ageMs: nowMs - paid });
  }
  return { waiting, reminded };
}

export async function checkPaidFormNotFilled(ctx = {}) {
  const id = "softpull:paid-form-not-filled-2h";
  const early = guard(ctx, id, "paid roadmap orders");
  if (early) return early;
  const now = nowOf(ctx);
  const orgId = ctx.orgId.trim();
  let read;
  try {
    read = await withReader(ctx, "paid roadmap orders", async (q) => {
      const orders = (await q.query(PAID_FORM_ORDERS_SQL, [orgId, now.toISOString(), ctx.demoOn === true, TEST_CLIENT_EMAIL_RE])).rows || [];
      const clientIds = [...new Set(orders.map((o) => String(o.client_id)))];
      if (!clientIds.length) return { orders, live: [], files: [], nudges: [] };
      const live = await q.query(LIVE_CONSENT_SQL, [orgId, SOFT_PULL_KIND, clientIds]);
      const files = await q.query(HAS_FILE_SQL, [orgId, clientIds]);
      const nudges = await q.query(NUDGES_SQL, [orgId, clientIds, [...NUDGE_KEYS]]);
      return { orders, live: live.rows || [], files: files.rows || [], nudges: nudges.rows || [] };
    });
  } catch (err) {
    return skipRead(id, "the paid roadmap orders", err);
  }

  const j = judgePaidForm({
    orders: read.orders,
    live: new Set(read.live.map((r) => String(r.client_id))),
    files: new Set(read.files.map((r) => String(r.client_id))),
    nudges: read.nudges,
    nowMs: now.getTime()
  });
  if (j.waiting.length === 0) {
    const tail = j.reminded.length
      ? `${j.reminded.length} ${plural(j.reminded.length, "is", "are")} still waiting but ${plural(j.reminded.length, "was", "were")} reminded`
      : `none are waiting on the form`;
    return check(
      id,
      "PASS",
      `no paid roadmap buyer is waiting on the pull form without a reminder (${read.orders.length} paid in the last ${PAID_FORM_LOOKBACK_DAYS} days; ${tail})`
    );
  }
  const ids = j.waiting.slice(0, 3).map((x) => shortId(x.order.client_id));
  return check(
    id,
    "FAIL",
    `${j.waiting.length} paid roadmap ${plural(j.waiting.length, "buyer has", "buyers have")} not filled the pull form for over ${PAID_FORM_HOURS} hours and no reminder text or email went out (oldest paid ${ageText(oldest(j.waiting))} ago). Clients: ${ids.join(", ")}`,
    PAID_FORM_FIX
  );
}

// ---- row 3: approved and paid, and nothing ran ----------------------------

/** A pull row in one of these states is a pull in flight. */
export const OPEN_PULL_STATUSES = Object.freeze(["queued", "processing"]);

/**
 * Does this pull row answer a payment made at `sinceMs` (the payment time minus
 * the clock slop)? Three ways it can:
 *   * it was asked for at or after the payment (the ordinary case);
 *   * it is open right now (queued or processing). C-00 does not write a second
 *     row when one is already open, so a pull that was open at the payment
 *     answers it. If that open row is stale, the ledger row (row 1) goes red;
 *   * it was closed (done, failed or cancelled) at or after the payment: it was
 *     open when the buyer paid and finished after. A row closed BEFORE the
 *     payment does not answer it.
 * A closed row always has a close time (the table's own rule); updated_at is
 * only the fallback when that stamp does not read as a time.
 */
export function pullAnswersPayment(pull, sinceMs) {
  if (!pull || typeof pull !== "object") return false;
  if (pull.requested >= sinceMs) return true;
  if (OPEN_PULL_STATUSES.includes(String(pull.status || ""))) return true;
  const closed = Number.isFinite(pull.resolved) ? pull.resolved : pull.updated;
  return closed >= sinceMs;
}

/**
 * Which paid, consented clients never got a pull. Pure.
 * `consents` maps client id -> when the newest live consent was granted.
 * `pulls` maps client id -> that client's pull rows, each
 * { requested, status, resolved, updated } with the times in milliseconds.
 */
export function judgeNoPull({ orders, consents, pulls, nowMs }) {
  const missing = [];
  let checked = 0;
  const seen = new Set();
  for (const order of Array.isArray(orders) ? orders : []) {
    const paid = ms(order.paid_at);
    const client = String(order.client_id);
    if (!Number.isFinite(paid) || nowMs - paid > NO_PULL_LOOKBACK_DAYS * DAY) continue;
    const granted = consents.get(client);
    // No live consent: the pull gate refuses on purpose. That is consent:required's row.
    if (!Number.isFinite(granted)) continue;
    checked += 1;
    const ready = Math.max(paid, granted);
    if (nowMs - ready <= NO_PULL_MINUTES * MIN) continue;
    const since = paid - NO_PULL_SLOP_MINUTES * MIN;
    if ((pulls.get(client) || []).some((pull) => pullAnswersPayment(pull, since))) continue;
    if (seen.has(client)) continue;
    seen.add(client);
    missing.push({ order, ageMs: nowMs - ready });
  }
  return { missing, checked };
}

export async function checkApproveClickNoPull(ctx = {}) {
  const id = "softpull:approve-click-no-pull";
  const early = guard(ctx, id, "paid pull orders");
  if (early) return early;
  const now = nowOf(ctx);
  const orgId = ctx.orgId.trim();
  let read;
  try {
    read = await withReader(ctx, "paid pull orders", async (q) => {
      const orders = (await q.query(PAID_DIAGNOSTICS_SQL, [orgId, now.toISOString(), ctx.demoOn === true, TEST_CLIENT_EMAIL_RE])).rows || [];
      const clientIds = [...new Set(orders.map((o) => String(o.client_id)))];
      if (!clientIds.length) return { orders, live: [], times: [] };
      const live = await q.query(LIVE_CONSENT_SQL, [orgId, SOFT_PULL_KIND, clientIds]);
      const times = await q.query(PULL_TIMES_SQL, [orgId, clientIds]);
      return { orders, live: live.rows || [], times: times.rows || [] };
    });
  } catch (err) {
    return skipRead(id, "the paid pull orders", err);
  }

  const consents = new Map(read.live.map((r) => [String(r.client_id), ms(r.granted_at)]));
  const pulls = new Map();
  for (const r of read.times) {
    const key = String(r.client_id);
    if (!pulls.has(key)) pulls.set(key, []);
    pulls.get(key).push({
      requested: ms(r.requested_at),
      status: String(r.status || ""),
      resolved: ms(r.resolved_at),
      updated: ms(r.updated_at)
    });
  }
  const j = judgeNoPull({ orders: read.orders, consents, pulls, nowMs: now.getTime() });
  if (j.missing.length === 0) {
    return check(
      id,
      "PASS",
      j.checked
        ? `no client who approved and paid in the last ${NO_PULL_LOOKBACK_DAYS} days is waiting on a credit pull (${j.checked} checked)`
        : `no client has both approved and paid for a pull in the last ${NO_PULL_LOOKBACK_DAYS} days, so there was nothing to check`
    );
  }
  const ids = j.missing.slice(0, 3).map((x) => shortId(x.order.client_id));
  return check(
    id,
    "FAIL",
    `${j.missing.length} ${plural(j.missing.length, "client approved", "clients approved")} the pull and paid, and no pull was started ${NO_PULL_MINUTES} or more minutes later (oldest waiting ${ageText(oldest(j.missing))}). Clients: ${ids.join(", ")}`,
    NO_PULL_FIX
  );
}

/**
 * The three credit-pull ledger rows. Read only, database only.
 * @param {object} [ctx]
 */
export async function pullLedgerChecks(ctx = {}) {
  return Promise.all([
    checkRequestFailedOrStuck(ctx),
    checkPaidFormNotFilled(ctx),
    checkApproveClickNoPull(ctx)
  ]);
}


/**
 * Soft-pull lane: the approve door (three rows), then the credit-pull ledger
 * (three rows). Everything runs at once, so the lane is as slow as its slowest
 * read, not the sum.
 * @param {{ fetchImpl?: Function, fetch?: Function, baseUrl?: string, db?: object, scope?: Function, orgId?: string, env?: object, now?: Date }} [ctx]
 * @returns {Promise<Array<{ id: string, status: string, detail: string, suggestedFix: string|null }>>}
 */
export async function gapChecks(ctx = {}) {
  const fetchImpl = ctx.fetchImpl || ctx.fetch;
  const baseUrl = ctx.baseUrl;
  const [page, read, signed, ledger, paidForm, noPull] = await Promise.all([
    checkApprovePage({ fetchImpl, baseUrl }),
    checkApproveRead({ fetchImpl, baseUrl }),
    checkApproveSignedRead(ctx),
    checkRequestFailedOrStuck(ctx),
    checkPaidFormNotFilled(ctx),
    checkApproveClickNoPull(ctx)
  ]);
  return [page, read, signed, ledger, paidForm, noPull];
}
