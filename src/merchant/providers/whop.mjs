// Whop — pull a client's sales, refunds, fees and payouts with THEIR API key.
//
// Docs read 2026-10-06 (the "Current API", which Whop says new integrations
// should build on — https://docs.whop.com/api-reference/stability):
//
//   https://docs.whop.com/api-reference/beta/overview
//     Base URL https://api.whop.com/api/v1. "Authenticate every request with a
//     Bearer API key" (an Account API key from whop.com/dashboard/developer).
//     "Send an `Api-Version-Date` header … to pin the shapes" — without it the
//     original 2025-01-01 shapes come back. Pinned below to the date these
//     docs were read, because src/merchant/normalize.mjs reads the Money
//     objects ({ amount: "10.00", currency, decimals }) that version returns.
//     Pagination: `first` (page size), `after` = previous
//     `page_info.end_cursor`, stop when `page_info.has_next_page` is false.
//   https://docs.whop.com/api-reference/beta/payments/list-payments
//     GET /payments — status (open | authorized | paid | …), created_after,
//     first (max 100), after. Rows: Payment { id "pay_…", status, total,
//     amount_after_fees, currency, paid_at, created_at, … }.
//   https://docs.whop.com/api-reference/beta/refunds/list-refunds
//     GET /refunds — created_after, first, after. Rows: Refund { id "rf_…",
//     payment_id, amount (Money), status pending | requires_action |
//     succeeded | failed | canceled, created_at }.
//   https://docs.whop.com/api-reference/beta/payouts/list-payouts
//     GET /payouts — "The owning account ID (a biz_ identifier). Provide this
//     or user_id." created_after, first, after. Rows: { id "wdrl_…", amount
//     (decimal string, whole currency units), currency, status requested |
//     in_review | processing | completed | reversed | canceled | failed |
//     denied, created_at }.
//   https://docs.whop.com/api-reference/beta/accounts/retrieve-account
//     GET /accounts/me — "The reserved id `me` retrieves the account associated
//     with the current Account API key." Gives the biz_ id /payouts needs.
//
// Fees are not a separate call: a Payment carries `total` and
// `amount_after_fees`, and the difference is Whop's fee (normalize.mjs).
//
// listEvents({ apiKey, since, cursor }) → { events, nextCursor, ignored }
//   ONE list page per call (plus /accounts/me once, before the first payouts
//   page). The cursor is this module's own JSON — which stream, which page,
//   and the window — so a pull stopped by the page budget resumes exactly.
import { getJson, MerchantPullError } from "./http.mjs";
import { whopListItemEvents } from "../normalize.mjs";

export const id = "whop";
export const label = "Whop";
export const WHOP_API_BASE = "https://api.whop.com/api/v1";
export const WHOP_API_VERSION_DATE = "2026-10-06";
export const PAGE_SIZE = 100;
export const STREAMS = Object.freeze(["payments", "refunds", "payouts"]);
export const keyHelp = "In Whop, open Developer → Account API keys (whop.com/dashboard/developer), make a key that can read payments, refunds and payouts, and paste it here.";

function parseCursor(cursor) {
  if (!cursor) return null;
  try {
    const c = JSON.parse(String(cursor));
    if (c && c.v === 1 && STREAMS.includes(c.stream)) return c;
  } catch { /* a cursor we did not write — start over */ }
  return null;
}

function isoOrNull(v) {
  if (!v) return null;
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

export async function listEvents({ apiKey, since = null, cursor = null, env = process.env, fetchImpl = undefined } = {}) {
  const key = String(apiKey || "").trim();
  if (!key) throw new MerchantPullError("bad_key", "No Whop API key is saved for this connection.");
  const c = parseCursor(cursor) || { v: 1, stream: "payments", after: null, since: isoOrNull(since), account: null };
  const headers = { authorization: `Bearer ${key}`, "Api-Version-Date": WHOP_API_VERSION_DATE };
  const opts = { headers, env, fetchImpl };

  if (c.stream === "payouts" && !c.account) {
    const acct = await getJson(`${WHOP_API_BASE}/accounts/me`, { ...opts, what: "whop GET /accounts/me" });
    const biz = acct && typeof acct.id === "string" && acct.id.startsWith("biz_") ? acct.id : null;
    if (!biz) throw new MerchantPullError("bad_response", "Whop did not say which account this key belongs to, so payouts cannot be read.");
    c.account = biz;
  }

  const q = new URLSearchParams();
  q.set("first", String(PAGE_SIZE));
  if (c.after) q.set("after", c.after);
  if (c.since) q.set("created_after", c.since);
  if (c.stream === "payments") q.set("status", "paid");
  if (c.stream === "payouts") q.set("account_id", c.account);

  const body = await getJson(`${WHOP_API_BASE}/${c.stream}?${q.toString()}`, { ...opts, what: `whop GET /${c.stream}` });
  if (!Array.isArray(body.data)) throw new MerchantPullError("bad_response", `Whop's ${c.stream} list came back without a data list.`);

  const events = [];
  let ignored = 0;
  for (const item of body.data) {
    const out = whopListItemEvents(c.stream, item);
    events.push(...out.events);
    if (!out.events.length) ignored++;
  }

  const pi = body.page_info && typeof body.page_info === "object" ? body.page_info : {};
  let next = null;
  if (pi.has_next_page === true && typeof pi.end_cursor === "string" && pi.end_cursor && pi.end_cursor !== c.after) {
    next = { ...c, after: pi.end_cursor };
  } else {
    const i = STREAMS.indexOf(c.stream);
    if (i < STREAMS.length - 1) next = { ...c, stream: STREAMS[i + 1], after: null };
  }
  return { events, nextCursor: next ? JSON.stringify(next) : null, ignored };
}
