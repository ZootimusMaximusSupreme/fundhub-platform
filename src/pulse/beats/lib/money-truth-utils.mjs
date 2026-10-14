// Pure/read-only support for money truth shared by daily lanes and hourly beats.

export const MIN_MS = 60 * 1000;
export const HOUR_MS = 60 * MIN_MS;
export const DAY_MS = 24 * HOUR_MS;

export const TEST_CLIENT_EMAIL_RE = String.raw`\+(walk|sim)-[0-9]+@|@example\.(com|net|org)$|\.(test|example|invalid|localhost|local)$|^(e2e|demo)\+`;
export const SIM_RECEIPT_PREFIX = "sim-pay-";
export const TRIP =
  "Recon (AG-07) is the one tripwire. Do not auto-fix from this pulse. Do not take a card payment. " +
  "Do not call Plaid. Do not mint a Commas catalog product.";

export function row(id, status, detail, suggestedFix = null) {
  return { id, status, detail, suggestedFix };
}

export function naRow(id, code, args, detail) {
  return { id, status: "na", detail, suggestedFix: null, na: { code, args } };
}

export function plural(n, word, many = null) {
  return `${n} ${n === 1 ? word : (many || `${word}s`)}`;
}

export function intOf(value) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

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

// The daily wrapper supplies run; the hourly harness supplies read.
export function runnerOf(ctx) {
  if (ctx && typeof ctx.run === "function") return ctx.run;
  if (ctx && typeof ctx.read === "function") {
    return (fn) => fn(Object.freeze({ query: (sql, params) => ctx.read(sql, params) }));
  }
  return null;
}

export function nowOf(ctx) {
  const n = ctx && ctx.now != null ? new Date(ctx.now) : new Date();
  return Number.isFinite(n.getTime()) ? n : new Date();
}

export function skipWhy({ run, orgId }, what) {
  if (!run) return `no database in this run, so ${what} was not read`;
  if (!orgId) return `no org id in this run, so ${what} was not read`;
  return null;
}

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

export async function readRows(run, id, what, sql, params = []) {
  try {
    const out = await run((tx) => tx.query(sql, params));
    return { rows: Array.isArray(out && out.rows) ? out.rows : [] };
  } catch (err) {
    return { skip: row(id, "skip", `could not read ${what}: ${clip(err)}`) };
  }
}

export function testClientSql(emails, param) {
  return `(COALESCE(c.is_demo, false)
          OR COALESCE(c.custom_fields ->> 'synthetic', '') = 'true'
          OR COALESCE(${emails}, '') ~* ${param}::text)`;
}

export function etDay(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(now);
}

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

export function looksMasked(value) {
  if (value === undefined || value === null) return true;
  const s = String(value).trim();
  return s === "" || s.startsWith("*") || /\*{4,}/.test(s);
}

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

export async function request(readWeb, method, url, init = {}) {
  const m = String(method).toUpperCase();
  if (m !== "GET" && m !== "HEAD") throw new Error(`money truth only reads with GET or HEAD (got ${m})`);
  return readWeb(m, url, init);
}
