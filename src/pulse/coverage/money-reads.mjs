// Small shared pieces for the "money B" coverage lanes (coverage batch W2, 2026-10-10).
//
// Lanes that use this file: gap-checkout, gap-finance-os-setup, gap-payments-unmatched,
// gap-subscriptions, gap-money-moves, gap-ads-meta.
//
// THIS IS NOT A LANE. It has no gapChecks, and its name does not start with gap- or slice-,
// so modules.test.mjs does not ask for it on the list. The lanes import it by a plain static
// import, which is how the live bundle packs it.
//
// READ ONLY. Nothing here writes, sends, calls a vendor, or opens a transaction. A lane hands
// its SQL to run(), which is the staff scope when the pulse has one and the shared pool when
// it does not. Never BEGIN, COMMIT, ROLLBACK or SET on it.

import { TEST_CLIENT_EMAIL_RE, SIM_RECEIPT_PREFIX } from "./gap-payments.mjs";

export { TEST_CLIENT_EMAIL_RE, SIM_RECEIPT_PREFIX };

export const MIN_MS = 60 * 1000;
export const HOUR_MS = 60 * MIN_MS;
export const DAY_MS = 24 * HOUR_MS;

/** Added to every suggested fix. The pulse reports; a person fixes. */
export const TRIP =
  "Recon (AG-07) is the one tripwire. Do not auto-fix from this pulse. Do not take a card payment. " +
  "Do not call Plaid. Do not mint a Commas catalog product.";

export function row(id, status, detail, suggestedFix = null) {
  return { id, status, detail, suggestedFix };
}

/** "Nothing to judge today": status na plus a code the audit re-checks (src/pulse/na-conditions.mjs). */
export function naRow(id, code, args, detail) {
  return { id, status: "na", detail, suggestedFix: null, na: { code, args } };
}

export function plural(n, word, many = null) {
  return `${n} ${n === 1 ? word : (many || `${word}s`)}`;
}

/** A count the read really sent. A missing answer is 0 here; use count() when null must survive. */
export function intOf(value) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** A finite number, or null. NULL MEANS UNKNOWN and is never turned into 0. */
export function count(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function clip(value, n = 180) {
  const msg = value && value.message ? value.message : value;
  return String(msg == null ? "" : msg).replace(/\s+/g, " ").trim().slice(0, n).trim();
}

export function oneRow(result) {
  const r = result && result.rows && result.rows[0];
  return r && typeof r === "object" ? r : null;
}

/** The staff scope when the pulse has one (the money and ad tables are row-secured), else the pool. */
export function runnerOf(ctx) {
  if (ctx && typeof ctx.scope === "function") return (fn) => ctx.scope(fn);
  if (ctx && ctx.db && typeof ctx.db.query === "function") return (fn) => fn(ctx.db);
  return null;
}

export function nowOf(ctx) {
  const n = ctx && ctx.now != null ? new Date(ctx.now) : new Date();
  return Number.isFinite(n.getTime()) ? n : new Date();
}

/** Why a read cannot start, in plain words, or null. */
export function skipWhy({ run, orgId }, what) {
  if (!run) return `no database in this run, so ${what} was not read`;
  if (!orgId) return `no org id in this run, so ${what} was not read`;
  return null;
}

/**
 * One read that must come back with one row of counts.
 * { r } on success. { skip } (a skip row, never a PASS) when the read failed or came back empty.
 */
export async function readRow(run, id, what, sql, params = []) {
  try {
    const out = await run((tx) => tx.query(sql, params));
    const r = oneRow(out);
    if (!r) return { skip: row(id, "skip", `could not read ${what}: the read came back with no row`) };
    return { r };
  } catch (err) {
    return { skip: row(id, "skip", `could not read ${what}: ${clip(err)}`) };
  }
}

/** Many rows, same rules. { rows } or { skip }. */
export async function readRows(run, id, what, sql, params = []) {
  try {
    const out = await run((tx) => tx.query(sql, params));
    return { rows: Array.isArray(out && out.rows) ? out.rows : [] };
  } catch (err) {
    return { skip: row(id, "skip", `could not read ${what}: ${clip(err)}`) };
  }
}

/* The test-client test, written once and pasted into each statement. `emails` is the SQL for the
   address to test; `param` is the placeholder holding TEST_CLIENT_EMAIL_RE. The clients row must be
   joined as `c`. Same shape as gap-payments.mjs, so a test client is the same person in every lane. */
export function testClientSql(emails, param) {
  return `(COALESCE(c.is_demo, false)
          OR COALESCE(c.custom_fields ->> 'synthetic', '') = 'true'
          OR COALESCE(${emails}, '') ~* ${param}::text)`;
}

/** The calendar day in New York (the ACH banking day), YYYY-MM-DD. Same call src/finance/money-transfers.mjs makes. */
export function etDay(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(now);
}

/** An ISO day moved by whole days. Pure UTC arithmetic. */
export function addDaysIso(iso, n) {
  const [y, m, d] = String(iso).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function ageOf(then, now) {
  const t = then instanceof Date ? then : new Date(then);
  const ms = now.getTime() - t.getTime();
  if (!Number.isFinite(ms) || ms < 0) return "a short time";
  const minutes = Math.floor(ms / MIN_MS);
  if (minutes < 120) return plural(Math.max(minutes, 1), "minute");
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return plural(hours, "hour");
  return plural(Math.floor(hours / 24), "day");
}

/** A value that is a mask or empty: the laptop's stand-in for a secret. */
export function looksMasked(value) {
  if (value === undefined || value === null) return true;
  const s = String(value).trim();
  return s === "" || s.startsWith("*") || /\*{4,}/.test(s);
}

/** Integer cents as words. NULL MEANS UNKNOWN: a missing amount is never "$0". */
export function dollars(cents) {
  if (cents === null || cents === undefined || cents === "") return "an unknown amount";
  const n = Number(cents);
  if (!Number.isFinite(n)) return "an unknown amount";
  const whole = n % 100 === 0;
  return `$${(n / 100).toLocaleString("en-US", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })}`;
}

export function toDate(v) {
  if (v === null || v === undefined || v === "") return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isFinite(d.getTime()) ? d : null;
}

/** The GET and HEAD the lanes make. Each call has its own timeout so a hung site is a skip, not a dead step. */
export const FETCH_TIMEOUT_MS = 6000;

export async function request(fetchImpl, method, url, init = {}) {
  const m = String(method).toUpperCase();
  if (m !== "GET" && m !== "HEAD") throw new Error(`money lanes only GET or HEAD (got ${m})`);
  const opts = { method: m, redirect: "follow", headers: init.headers || {} };
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    opts.signal = AbortSignal.timeout(init.timeoutMs || FETCH_TIMEOUT_MS);
  }
  const res = await fetchImpl(url, opts);
  const text = m === "GET" && res && typeof res.text === "function" ? await res.text() : "";
  return { status: Number(res && res.status), text: String(text || "") };
}
