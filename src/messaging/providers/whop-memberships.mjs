// Whop memberships — read the plans clients pay on Fundhub's own Whop account. GET ONLY.
//
// Finance OS unit W (owner ask 2026-11-07: track "all the other ones that I offer over at"
// Whop, like the Clarity plans, with a phone alert before each payment). This file only
// reads. It never creates a checkout, charges, cancels or changes anything at Whop.
//
// Current API, checked 2026-11-07 against Whop's own OpenAPI document
// (https://api.whop.com/api/v1/openapi.json, x-api-version-date 2026-11-06) and the docs:
//   https://docs.whop.com/api-reference/memberships/list-memberships
//     GET /memberships   account_id (biz_), statuses (repeatable), first (max 100), after
//                        → { data: Membership[], page_info: { end_cursor, has_next_page } }
//     scope member:basic:read
//   https://docs.whop.com/api-reference/memberships/retrieve-membership
//     GET /memberships/{id} → Membership
//   https://docs.whop.com/api-reference/members/retrieve-member
//     GET /members/{id} → Member; its `email` is null without member:email:read
// Membership fields read (that version): id, status, member_id, product { id, title },
// product_id, variant_id, renewal_price (Money or null: "what the next renewal charges,
// after any promo code"), billing_period_days, split_pay_required_payments,
// split_pay_current_payments, collection_method, cancel_at_period_end, current_period_end,
// canceled_at, expires_at, metadata, account { id }, created_at, updated_at.
//
// SAME FENCE AS EVERY WHOP CALL: src/lib/outbound-fetch.mjs transmit(), fence ADAPTERS, the
// documented hosts from whopApiBase() (production api.whop.com, or the sandbox host when
// WHOP_ENV=sandbox). The API key is read by the caller from WHOP_API_KEY and is never
// logged, returned or put in an error. A provider error body is never echoed: it can hold
// customer data.

import { transmit, ADAPTERS } from "../../lib/outbound-fetch.mjs";
import { whopApiBase } from "./whop-payments.mjs";

/** The dated Whop API shape every read here is pinned to. */
export const WHOP_MEMBERSHIPS_API_VERSION = "2026-11-06";
/** Whop's page size cap. */
export const PAGE_SIZE = 100;
/** A list longer than this many pages is not finished; the caller treats it as unread. */
export const MAX_PAGES = 50;

const MEMBERSHIP_ID = /^mem_[A-Za-z0-9]{1,64}$/;
const MEMBER_ID = /^mber_[A-Za-z0-9]{1,64}$/;
const ACCOUNT_ID = /^biz_[A-Za-z0-9]{1,64}$/;
/** The membership statuses Whop's list filter takes (OpenAPI listMemberships `statuses`). */
export const LIST_STATUSES = Object.freeze(["active", "trialing", "past_due", "completed", "canceled",
  "expired", "canceling", "paused", "expiring", "one_time", "unclaimed", "banned"]);

export class WhopReadError extends Error {
  constructor(message, code, status = null) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/** One GET. Returns the parsed body, or throws WhopReadError with a short reason. */
export async function whopGet(path, { apiKey, env = process.env, fetchImpl, what = "Whop memberships read" } = {}) {
  const key = String(apiKey || "").trim();
  if (!key) throw new WhopReadError("Whop API key is not configured", "whop_not_configured");
  if (!/^\/(?:memberships|members)(?:\/[A-Za-z0-9_]+)?(?:\?[A-Za-z0-9_=&%.*\-]*)?$/.test(String(path))) {
    throw new WhopReadError("Unsupported Whop memberships resource", "whop_bad_resource");
  }
  const url = new URL(whopApiBase(env) + path);
  const out = await transmit(url.href, {
    method: "GET",
    headers: { Authorization: `Bearer ${key}`, "Api-Version-Date": WHOP_MEMBERSHIPS_API_VERSION, accept: "application/json" }
  }, { fence: ADAPTERS, what, env, fetchImpl, timeoutMs: 15000 });
  if (out.blocked) throw new WhopReadError("Whop read held by the adapter fence", "whop_fenced");
  if (out.status === 401) throw new WhopReadError("Whop did not accept the API key (401)", "whop_unauthorized", 401);
  if (out.status === 403) throw new WhopReadError("The Whop API key cannot read this (403)", "whop_forbidden", 403);
  if (out.status === 404) throw new WhopReadError("Whop has no such record (404)", "whop_not_found", 404);
  if (!out.ok || !out.body || typeof out.body !== "object" || out.body.error) {
    // Never the body: it can carry customer data.
    throw new WhopReadError(`Whop read failed (${out.status || "no answer"})`, "whop_read_failed", out.status || null);
  }
  return out.body;
}

/**
 * listMemberships({ accountId, apiKey, statuses, env, fetchImpl, maxPages })
 *   → { rows: Membership[], complete: true }
 * Every page, newest first. Throws when a page is malformed, the cursor stalls, or the
 * page cap is reached — an unfinished list is never treated as the whole list.
 */
export async function listMemberships({ accountId, apiKey, statuses = [], env = process.env, fetchImpl, maxPages = MAX_PAGES } = {}) {
  if (!ACCOUNT_ID.test(String(accountId || ""))) throw new WhopReadError("WHOP_ACCOUNT_ID is not a biz_ id", "whop_not_configured");
  const wanted = statuses.filter((s) => LIST_STATUSES.includes(s));
  const rows = [];
  const seen = new Set();
  let after = null;
  for (let page = 0; page < maxPages; page += 1) {
    const q = new URLSearchParams({ account_id: accountId, first: String(PAGE_SIZE) });
    for (const s of wanted) q.append("statuses", s);
    if (after) q.set("after", after);
    const body = await whopGet(`/memberships?${q}`, { apiKey, env, fetchImpl, what: "Whop GET /memberships" });
    if (!Array.isArray(body.data) || !body.page_info || typeof body.page_info.has_next_page !== "boolean") {
      throw new WhopReadError("Whop's memberships list came back in a shape this code does not know", "whop_bad_page");
    }
    rows.push(...body.data);
    if (!body.page_info.has_next_page) return { rows, complete: true };
    after = body.page_info.end_cursor;
    if (!after || seen.has(after)) throw new WhopReadError("Whop's memberships list cursor did not move", "whop_bad_page");
    seen.add(after);
  }
  throw new WhopReadError(`Whop's memberships list is longer than ${maxPages} pages; not finished`, "whop_too_many_pages");
}

/** retrieveMembership — one membership by its mem_ id. */
export async function getMembership(id, { apiKey, env = process.env, fetchImpl } = {}) {
  if (!MEMBERSHIP_ID.test(String(id || ""))) throw new WhopReadError("not a Whop membership id", "whop_bad_resource");
  return whopGet(`/memberships/${id}`, { apiKey, env, fetchImpl, what: "Whop GET /memberships/{id}" });
}

/** retrieveMember — one member by its mber_ id. Only id and email are handed back. */
export async function getMemberEmail(id, { apiKey, env = process.env, fetchImpl } = {}) {
  if (!MEMBER_ID.test(String(id || ""))) throw new WhopReadError("not a Whop member id", "whop_bad_resource");
  const body = await whopGet(`/members/${id}`, { apiKey, env, fetchImpl, what: "Whop GET /members/{id}" });
  const email = typeof body.email === "string" && body.email.includes("@") ? body.email : null;
  return { id: typeof body.id === "string" ? body.id : null, email };
}

export default { whopGet, listMemberships, getMembership, getMemberEmail };
