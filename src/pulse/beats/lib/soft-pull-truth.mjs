// The credit soft pull, read only: the approve screen, its read door, and the credit-pull ledger.
//
// ONE JUDGE, TWO CLOCKS (2026-10-20). These checks, their SQL and their judges used to live in
// src/pulse/coverage/gap-soft-pull.mjs. They moved here unchanged (the reader argument is named io)
// so the morning lane (which imports them back) and the hourly beat soft-pull run the same reads and
// the same verdicts. A beat may import only from src/pulse/beats/lib, so:
//   TEST_CLIENT_EMAIL_RE, CONSENT_VALID_SQL   come from ./consent-truth.mjs (held equal to
//                                             src/consent/index.mjs by a drift test)
//   classifyVisitor                           is a copy of src/slo/visitor.mjs, held equal by a drift
//                                             test in beat-soft-pull.test.mjs
//
//   soft-pull:approve-page             the approve screen loads and still calls its read door
//   soft-pull:approve-read             GET /api/soft-pull-approve with no link answers the refusal shape
//   softpull:request-failed-or-stuck   a credit pull failed in the last 3 days, or is stuck
//   softpull:paid-form-not-filled-2h   a paid roadmap buyer has an empty pull form and got no reminder
//   softpull:approve-click-no-pull     a client approved and paid, and no pull was started
//
// The signed approve read (it runs the real handler in process) stays in the lane.
// `web(url, init)` answers like fetch: the lane hands in its fetch, the beat a GET through ctx.http.
// They never pull credit, never send, never POST.

import { CONSENT_VALID_SQL, TEST_CLIENT_EMAIL_RE } from "./consent-truth.mjs";

const BOT_UA = /HeadlessChrome|Playwright|Puppeteer|PhantomJS|Headless|bot|crawler|spider|Bytespider|GPTBot/i;
const TEST_LOCAL = /(^|[.+_-])(e2e|sim|test)([.+_-]|$)/;

/** Copy of classifyVisitor in src/slo/visitor.mjs (drift test): a real person, or one of us. */
export function classifyVisitor({ email, userAgent, webdriver } = {}) {
  if (webdriver === true || webdriver === "true" || webdriver === 1) {
    return { actor: "agent", reason: "automated_browser" };
  }
  if (BOT_UA.test(String(userAgent || ""))) {
    return { actor: "agent", reason: "bot_browser" };
  }
  const mail = String(email || "").trim().toLowerCase();
  const at = mail.lastIndexOf("@");
  if (at > 0) {
    const local = mail.slice(0, at);
    const domain = mail.slice(at + 1);
    if (domain === "fundhub.ai") return { actor: "agent", reason: "company_email" };
    if (domain === "example.com" || domain === "example.net" || domain === "example.org") {
      return { actor: "agent", reason: "test_email" };
    }
    if (TEST_LOCAL.test(local)) return { actor: "agent", reason: "test_email" };
  }
  return { actor: "person", reason: "browser" };
}

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

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const TRIPWIRE =
  "Recon (AG-07) is the one tripwire. Do not invent a second watchdog. " +
  "Do not pull credit. Do not send bureau mail. Do not edit the approve page. Do not auto-fix.";

export const PAGE_FIX =
  `Put the soft-pull approve screen back at ${APPROVE_PAGE_PATH}. ${TRIPWIRE}`;

export const READ_FIX =
  `Fix GET ${APPROVE_READ_PATH} so the approve screen can read it. Do not POST. ${TRIPWIRE}`;

export function check(id, status, detail, suggestedFix = null) {
  return { id, status, detail, suggestedFix };
}

export function clip(s, n = 160) {
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

async function readGet(web, url, accept) {
  const init = {
    method: "GET",
    credentials: "omit",
    headers: { accept }
  };
  // A door that never answers must not hold up the whole morning pulse.
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    init.signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  }
  const res = await web(url, init);
  const text = await bodyText(res);
  return { status: httpStatus(res), text };
}

export async function checkApprovePage({ web, baseUrl = DEFAULT_BASE_URL } = {}) {
  const id = "soft-pull:approve-page";
  if (typeof web !== "function") {
    return check(id, "skip", "no fetch in this run — approve screen not opened");
  }
  const url = `${originOf(baseUrl)}${APPROVE_PAGE_PATH}`;
  try {
    const { status, text } = await readGet(web, url, "text/html");
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

export async function checkApproveRead({ web, baseUrl = DEFAULT_BASE_URL } = {}) {
  const id = "soft-pull:approve-read";
  if (typeof web !== "function") {
    return check(id, "skip", "no fetch in this run — approve read API not opened");
  }
  const url = `${originOf(baseUrl)}${APPROVE_READ_PATH}`;
  try {
    const { status, text } = await readGet(web, url, "application/json");
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

function nowOf(io) {
  const n = io && io.now;
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

function canQuery(io) {
  return typeof io.scope === "function"
    || !!(io.scope && typeof io.scope.asStaff === "function")
    || !!(io.db && typeof io.db.query === "function");
}

/**
 * Run a few reads on one connection. The pulse hands over a staff scope (the
 * tables are row-secured); with none, the plain pool is used. Nothing here
 * opens or closes a transaction on the shared pool.
 */
export async function withReader(io, label, fn) {
  const reader = {
    async query(sql, params) {
      assertReadOnlySql(sql);
      return reader.tx.query(sql, params);
    }
  };
  const run = (tx) => { reader.tx = tx; return fn(reader); };
  let job;
  if (typeof io.scope === "function") job = io.scope(run);
  else if (io.scope && typeof io.scope.asStaff === "function") job = io.scope.asStaff(run);
  else job = run(io.db);
  return withTimeout(Promise.resolve(job), label);
}

function guard(io, id, what) {
  if (!canQuery(io)) return check(id, "skip", `no database in this run — ${what} not read`);
  const orgId = typeof io.orgId === "string" ? io.orgId.trim() : "";
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

export async function checkRequestFailedOrStuck(io = {}) {
  const id = "softpull:request-failed-or-stuck";
  const early = guard(io, id, "credit pull ledger");
  if (early) return early;
  const now = nowOf(io);
  let rows;
  try {
    rows = await withReader(io, "credit pull ledger", async (q) => {
      const res = await q.query(LEDGER_SQL, [io.orgId.trim(), now.toISOString(), io.demoOn === true, TEST_CLIENT_EMAIL_RE]);
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

export async function checkPaidFormNotFilled(io = {}) {
  const id = "softpull:paid-form-not-filled-2h";
  const early = guard(io, id, "paid roadmap orders");
  if (early) return early;
  const now = nowOf(io);
  const orgId = io.orgId.trim();
  let read;
  try {
    read = await withReader(io, "paid roadmap orders", async (q) => {
      const orders = (await q.query(PAID_FORM_ORDERS_SQL, [orgId, now.toISOString(), io.demoOn === true, TEST_CLIENT_EMAIL_RE])).rows || [];
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

export async function checkApproveClickNoPull(io = {}) {
  const id = "softpull:approve-click-no-pull";
  const early = guard(io, id, "paid pull orders");
  if (early) return early;
  const now = nowOf(io);
  const orgId = io.orgId.trim();
  let read;
  try {
    read = await withReader(io, "paid pull orders", async (q) => {
      const orders = (await q.query(PAID_DIAGNOSTICS_SQL, [orgId, now.toISOString(), io.demoOn === true, TEST_CLIENT_EMAIL_RE])).rows || [];
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
 * @param {object} [io]
 */
export async function pullLedgerChecks(io = {}) {
  return Promise.all([
    checkRequestFailedOrStuck(io),
    checkPaidFormNotFilled(io),
    checkApproveClickNoPull(io)
  ]);
}
