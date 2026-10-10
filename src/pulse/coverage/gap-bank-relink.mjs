// A bank login that broke and a paying client nobody told. Read only.
//
// WHY IT EXISTS (FinanceOS F2). When Plaid says a bank login needs the client to
// sign in again, the login goes to link_state = 'error' and is never read again.
// F2 gives that client a way to fix it (POST /api/banking/relink,
// src/banking/plaid-relink.mjs) and ONE text that says so
// (src/finance/bank-reconnect-notice.mjs, queued at the end of the daily
// plaid-transactions-sweeper pass).
//
// The new route has its ping (reg:banking/relink). A ping cannot see the text
// never going out. gap-banks already goes red for a login in error (the screen
// has no bank on it). This lane asks the one question that is new in F2:
//
//   "Did every paying client whose bank login broke get the reconnect text?"
//
// SAME AUDIENCE, SAME SKIPS AS THE JOB. A login is only counted when the job
// would have texted it:
//   * the code is one a reconnect fixes (NOTIFY_CODES), not a bank that is down;
//   * the login is real: a token, consent, a Plaid item id that is not mock:;
//   * the client holds an active finance-os subscription or paid for the Capital
//     Blueprint (the job's isNoticeAudience);
//   * the client has not opted out of SMS (the job refuses an opted-out client
//     and leaves the stamp empty for good), and has a phone (with no number
//     there is nothing to text, and a message with no destination is the
//     dispatcher's failure, which its own checks report). A client who cannot
//     be texted is not a missed text.
//
// WHEN IT TURNS RED. The job queues the text in the same pass that finds the
// break, then stamps plaid_items.reconnect_notified_at (migration 474). A login
// in 'error' for more than two days with that stamp still empty went through at
// least one pass that should have queued it and did not. Likely causes: the
// SMS-FINANCE-OS-RECONNECT template is missing or not approved, the job's
// reconnect step threw, or a pass has not run.
//
// READ ONLY. One SELECT. No text, no Plaid call, no write, no transaction
// control. The access token column is only tested for NULL, never selected.
// A read that fails is a skip with the reason, never a pass.

import { NOTIFY_CODES } from "../../banking/plaid-item-errors.mjs";
import { FINANCE_OS_TIER } from "../../finance/finance-os-entitlement.mjs";
import { PAID_TRANSACTION_STATUS } from "../../entitlements/entitlements.mjs";
import { BLUEPRINT_PRODUCT_CODE } from "../../waypoints/purchase.mjs";

export const CHECK_IDS = Object.freeze(["bank-relink-error-login-not-told"]);

const ID = CHECK_IDS[0];
const DAY_MS = 24 * 60 * 60 * 1000;

/** A broken login this old, still untold, is red. The job runs once a day. */
export const UNTOLD_AFTER_MS = 2 * DAY_MS;

/* $1 org (null = every org), $2 NOTIFY_CODES, $3 error-before cutoff, $4 the
   finance-os tier, $5 now, $6 the Blueprint product code, $7 the paid status.
   Same audience as isNoticeAudience: financeOsEntitlement, then
   isCapitalBlueprintBuyer. A login with no last_error_at is dated by updated_at,
   the way the notice's own event id does it. */
export const UNTOLD_SQL = `/* gap-bank-relink:untold */
SELECT count(DISTINCT i.client_id)::int AS clients,
       count(*)::int AS logins,
       min(COALESCE(i.last_error_at, i.updated_at)) AS oldest,
       (array_agg(i.last_error_code ORDER BY COALESCE(i.last_error_at, i.updated_at) ASC))[1] AS last_code
  FROM plaid_items i
  JOIN clients c ON c.id = i.client_id AND c.org_id = i.org_id
 WHERE i.link_state = 'error'
   AND i.reconnect_notified_at IS NULL
   AND i.encrypted_access_token IS NOT NULL
   AND i.consent_granted_at IS NOT NULL
   AND i.plaid_item_id IS NOT NULL
   AND i.plaid_item_id NOT LIKE 'mock:%'
   AND i.last_error_code = ANY($2::text[])
   AND COALESCE(i.last_error_at, i.updated_at) < $3::timestamptz
   AND ($1::uuid IS NULL OR i.org_id = $1::uuid)
   AND btrim(COALESCE(c.phone, '')) <> ''
   AND NOT EXISTS (
         SELECT 1 FROM opt_outs o
          WHERE o.client_id = i.client_id AND o.channel = 'sms' AND o.opted_in_at IS NULL
       )
   AND (
         EXISTS (
           SELECT 1 FROM subscriptions s
            WHERE s.org_id = i.org_id AND s.client_id = i.client_id
              AND s.tier = $4::text AND s.status = 'active'
              AND s.effective_from <= $5::timestamptz
              AND (s.effective_to IS NULL OR s.effective_to > $5::timestamptz)
         )
      OR EXISTS (
           SELECT 1 FROM transactions t
             JOIN products p ON p.id = resolve_product_id(t.org_id, t.product_name)
            WHERE t.org_id = i.org_id AND t.client_id = i.client_id
              AND lower(p.code) = lower($6::text)
              AND lower(btrim(COALESCE(t.status, ''))) = $7::text
         )
       )`;

function check(status, detail, suggestedFix = null) {
  return { id: ID, status, detail, suggestedFix };
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function toDate(v) {
  if (v == null || v === "") return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isFinite(d.getTime()) ? d : null;
}

function clip(s, n = 160) {
  return String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, n);
}

function noun(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

function days(ms) {
  return Math.max(1, Math.round(ms / DAY_MS));
}

function reader(ctx) {
  if (ctx && typeof ctx.scope === "function") return ctx.scope;
  const db = ctx && ctx.db;
  if (db && typeof db.query === "function") return (fn) => fn(db);
  return null;
}

const FIX =
  "Read plaid_items in 'error' with reconnect_notified_at empty, then the reconnect tally of the " +
  "plaid-transactions-sweeper pass. Likely causes: the SMS-FINANCE-OS-RECONNECT template is missing or " +
  "not approved (migration 474), or the reconnect step threw. Do not text from this check. " +
  "Do not call Plaid. Do not auto-fix. Chris fixes reds.";

/** judge — one row of UNTOLD_SQL → the check row. Pure. */
export function judgeUntold(row, now = new Date()) {
  const clients = num(row && row.clients);
  if (clients === 0) {
    return check(
      "PASS",
      "Every paying client whose bank login broke more than 2 days ago has been told to reconnect, " +
      "or cannot be texted (no phone, opted out)."
    );
  }
  const logins = num(row && row.logins);
  const oldest = toDate(row && row.oldest);
  const age = oldest ? ` The oldest broke ${days(now.getTime() - oldest.getTime())} days ago.` : "";
  const code = row && row.last_code ? ` Oldest code: ${clip(row.last_code, 80)}.` : "";
  const what = logins > clients ? ` (${noun(logins, "bank login", "bank logins")})` : "";
  return check(
    "FAIL",
    `${noun(clients, "paying client has", "paying clients have")} a bank login that broke more than ` +
    `2 days ago and was never told to reconnect${what}.${age}${code}`,
    FIX
  );
}

/**
 * gapChecks(ctx) → [{ id, status, detail, suggestedFix }] (one row, always)
 * status is PASS, FAIL, or skip. ctx: { db } or { scope }, optional { now, orgId }.
 * SELECT only. Never calls Plaid. Never texts.
 */
export async function gapChecks(ctx = {}) {
  const run = reader(ctx);
  if (!run) {
    return [check("skip", "No database in this run. Broken bank logins were not read. A skip is not a pass.")];
  }
  const now = toDate(ctx.now) || new Date();
  const cutoff = new Date(now.getTime() - UNTOLD_AFTER_MS);
  const params = [
    ctx.orgId || null,
    [...NOTIFY_CODES],
    cutoff.toISOString(),
    FINANCE_OS_TIER,
    now.toISOString(),
    BLUEPRINT_PRODUCT_CODE,
    PAID_TRANSACTION_STATUS
  ];
  try {
    const res = await run((db) => db.query(UNTOLD_SQL, params));
    const row = res && Array.isArray(res.rows) ? res.rows[0] : null;
    // A count with no GROUP BY always answers one row. No row means the read did not work.
    if (!row) return [check("skip", "The read of broken bank logins answered no row. A skip is not a pass.")];
    return [judgeUntold(row, now)];
  } catch (err) {
    // 42703 = undefined column: this database has not had migration 474 applied yet. It is
    // the one expected way to read nothing (a proof run before the ship). Say so plainly.
    if (err && err.code === "42703") {
      return [check(
        "skip",
        "plaid_items.reconnect_notified_at is not on this database yet (migration 474 is not applied), " +
        "so broken bank logins were not read. Apply the migration (npm run ship). A skip is not a pass."
      )];
    }
    return [check(
      "skip",
      `Could not read broken bank logins: ${clip((err && err.message) || err)}. A skip is not a pass.`
    )];
  }
}
