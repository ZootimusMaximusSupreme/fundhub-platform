// Whop plans — the daily read from Whop. Finance OS unit W (owner ask 2026-11-07: track
// "all the other ones that I offer over at" Whop like the Clarity plans).
//
// THIS IS THE ONLY WHOP PLANS FILE THAT TALKS TO WHOP. GET only, through
// src/messaging/providers/whop-memberships.mjs: the open memberships, a saved plan Whop no
// longer lists, and one member's email when a membership has no Fundhub checkout metadata.
// Nothing is created, charged, cancelled or changed at Whop. The screen, the Payments read
// and the phone-alert pass read only what this saves (src/finance/whop-plans.mjs), so none
// of them loads network code.
//
// THE MATCH IS NEVER A GUESS (migration 584 says the same):
//   fundhub_checkout  membership.metadata carries fh_org_id + fh_client_id, written by
//                     Fundhub's own checkout (Whop copies a checkout's metadata to the
//                     membership), and that client is in that org.
//   email             the Whop member's email equals the email of exactly one real client
//                     of the default org (DEFAULT_ORG_SLUG, else "fundhub"): Fundhub's own
//                     Whop account sells Fundhub's offers. Zero or two clients: not saved.
// The email is read into memory, compared, and dropped. It is never stored or logged.

import { listMemberships, getMembership, getMemberEmail } from "../messaging/providers/whop-memberships.mjs";
import { rowFromMembership, checkoutClientOf } from "./whop-plans.mjs";
import { OPEN_STATUSES } from "../pulse/beats/lib/whop-plan-push.mjs";

/** Per run: saved plans Whop no longer lists as open are read one by one, up to this many. */
export const MAX_REFRESH = 200;
/** Per run: member emails read, up to this many. */
export const MAX_EMAIL_READS = 200;

const MEMBERSHIP_ID = /^mem_[A-Za-z0-9]{1,64}$/;
const MEMBER_ID = /^mber_[A-Za-z0-9]{1,64}$/;
const ACCOUNT_ID = /^biz_[A-Za-z0-9]{1,64}$/;

const UPSERT_SQL = `
INSERT INTO whop_memberships (org_id, client_id, whop_membership_id, whop_account_id, whop_product_id,
  whop_variant_id, product_title, status, renewal_cents, renewal_currency, billing_period_days,
  split_pay_required, split_pay_paid, collection_method, cancel_at_period_end, current_period_end,
  period_end_on, canceled_at, expires_at, matched_by, whop_created_at, whop_updated_at, synced_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::timestamptz,
  $17::date, $18::timestamptz, $19::timestamptz, $20, $21::timestamptz, $22::timestamptz, $23::timestamptz)
ON CONFLICT (org_id, whop_membership_id) DO UPDATE SET
  client_id = EXCLUDED.client_id, whop_account_id = EXCLUDED.whop_account_id,
  whop_product_id = EXCLUDED.whop_product_id, whop_variant_id = EXCLUDED.whop_variant_id,
  product_title = EXCLUDED.product_title, status = EXCLUDED.status,
  renewal_cents = EXCLUDED.renewal_cents, renewal_currency = EXCLUDED.renewal_currency,
  billing_period_days = EXCLUDED.billing_period_days, split_pay_required = EXCLUDED.split_pay_required,
  split_pay_paid = EXCLUDED.split_pay_paid, collection_method = EXCLUDED.collection_method,
  cancel_at_period_end = EXCLUDED.cancel_at_period_end, current_period_end = EXCLUDED.current_period_end,
  period_end_on = EXCLUDED.period_end_on, canceled_at = EXCLUDED.canceled_at, expires_at = EXCLUDED.expires_at,
  matched_by = EXCLUDED.matched_by, whop_created_at = EXCLUDED.whop_created_at,
  whop_updated_at = EXCLUDED.whop_updated_at, synced_at = EXCLUDED.synced_at,
  unlinked_at = NULL, updated_at = now()
RETURNING id`.trim();

async function saveRow(db, { orgId, clientId, matchedBy, row, at }) {
  await db.query(UPSERT_SQL, [
    orgId, clientId, row.whop_membership_id, row.whop_account_id, row.whop_product_id, row.whop_variant_id,
    row.product_title, row.status, row.renewal_cents, row.renewal_currency, row.billing_period_days,
    row.split_pay_required, row.split_pay_paid, row.collection_method, row.cancel_at_period_end,
    row.current_period_end, row.period_end_on, row.canceled_at, row.expires_at, matchedBy,
    row.whop_created_at, row.whop_updated_at, at
  ]);
}

async function unlink(db, { orgId, membershipId, at }) {
  const r = await db.query(
    `UPDATE whop_memberships SET unlinked_at = $3::timestamptz, updated_at = now()
      WHERE org_id = $1 AND whop_membership_id = $2 AND unlinked_at IS NULL RETURNING id`,
    [orgId, membershipId, at]
  );
  return r.rows.length;
}

async function defaultOrgId(db, env) {
  const slug = String(env.DEFAULT_ORG_SLUG || "fundhub").trim() || "fundhub";
  const r = await db.query(`SELECT id FROM orgs WHERE slug = $1 LIMIT 1`, [slug]);
  return r.rows[0]?.id || null;
}

/* Which client a membership belongs to. { orgId, clientId, by } or { reason, final }.
   `final` means the answer is sure; a saved link is dropped only on a sure answer. */
async function matchClient(db, m, { orgFallback, read, io, budget }) {
  const named = checkoutClientOf(m);
  if (named) {
    const r = await db.query(`SELECT id FROM clients WHERE id = $1 AND org_id = $2 LIMIT 1`, [named.clientId, named.orgId]);
    return r.rows[0] ? { orgId: named.orgId, clientId: named.clientId, by: "fundhub_checkout" }
      : { reason: "checkout_client_missing", final: true };
  }
  if (!orgFallback) return { reason: "no_default_org", final: false };
  if (!MEMBER_ID.test(String(m.member_id || ""))) return { reason: "no_member", final: true };
  if (budget.emailReads <= 0) return { reason: "email_read_limit", final: false };
  budget.emailReads -= 1;
  let email = null;
  try {
    ({ email } = await read.getMemberEmail(m.member_id, io));
  } catch (e) {
    return { reason: e && e.code === "whop_forbidden" ? "no_email_scope" : "email_read_failed", final: false };
  }
  if (!email) return { reason: "no_email", final: false };
  const r = await db.query(
    `SELECT id FROM clients
      WHERE org_id = $1 AND lower(btrim(email)) = lower(btrim($2))
        AND COALESCE(is_demo, false) = false
        AND COALESCE(custom_fields ->> 'synthetic', '') <> 'true'
      LIMIT 2`,
    [orgFallback, email]
  );
  if (r.rows.length === 1) return { orgId: orgFallback, clientId: r.rows[0].id, by: "email" };
  return { reason: r.rows.length ? "two_clients" : "no_client", final: true };
}

/**
 * syncWhopMemberships(db, { env, now, fetchImpl, read }) → tally
 *
 * One pass over Fundhub's Whop account (WHOP_API_KEY, WHOP_ACCOUNT_ID):
 *   1. every open membership (trialing, active, past_due), all pages;
 *   2. each saved open plan Whop did not list, read once, so a plan that ended stops
 *      showing and stops alerting;
 *   3. each tied to its client (checkout metadata, else one exact email) and saved.
 * THROWS when the open list cannot be read, so the job's receipt says error. A single
 * membership that cannot be read or tied is counted and the pass goes on.
 *
 * SCOPE. This is the one account-level pass: it reads the saved rows of THIS Whop account
 * (whop_account_id), whichever company each is saved under, and writes each row under the
 * org and client its match names. Every per-client read stays org_id + client_id.
 */
export async function syncWhopMemberships(db, {
  env = process.env, now = new Date(), fetchImpl,
  read = { listMemberships, getMembership, getMemberEmail },
  maxRefresh = MAX_REFRESH, maxEmailReads = MAX_EMAIL_READS
} = {}) {
  const at = new Date(now).toISOString();
  const tally = {
    ok: true, at, listed: 0, refreshed: 0, saved: 0, unlinked: 0,
    matched: { fundhub_checkout: 0, email: 0 }, unmatched: {}, errors: []
  };
  const apiKey = String(env.WHOP_API_KEY || "").trim();
  const accountId = String(env.WHOP_ACCOUNT_ID || "").trim();
  if (!apiKey || !ACCOUNT_ID.test(accountId)) return { ...tally, skipped: true, reason: "whop_not_configured" };
  const io = { apiKey, env, fetchImpl };
  const miss = (reason) => { tally.unmatched[reason] = (tally.unmatched[reason] || 0) + 1; };

  // 1. The open plans, whole list or nothing.
  const listed = await read.listMemberships({ accountId, statuses: [...OPEN_STATUSES], ...io });
  const found = new Map();
  for (const m of listed.rows || []) if (m && MEMBERSHIP_ID.test(String(m.id || ""))) found.set(m.id, m);
  tally.listed = found.size;

  // What is saved for this Whop account already: the links a sure answer may drop.
  const saved = (await db.query(
    `SELECT org_id, client_id, whop_membership_id, matched_by, status, unlinked_at
       FROM whop_memberships WHERE whop_account_id = $1 LIMIT 5000`,
    [accountId]
  )).rows;
  const savedById = new Map();
  for (const s of saved) {
    const list = savedById.get(s.whop_membership_id) || [];
    list.push(s);
    savedById.set(s.whop_membership_id, list);
  }

  // 2. Saved open plans Whop no longer lists as open: read each once.
  let refreshBudget = maxRefresh;
  for (const s of saved) {
    if (found.has(s.whop_membership_id) || s.unlinked_at || !OPEN_STATUSES.includes(s.status)) continue;
    if (refreshBudget <= 0) { miss("refresh_limit"); continue; }
    refreshBudget -= 1;
    try {
      const m = await read.getMembership(s.whop_membership_id, io);
      if (m && m.id === s.whop_membership_id) { found.set(m.id, m); tally.refreshed += 1; }
    } catch (e) {
      if (e && e.code === "whop_not_found") {
        tally.unlinked += await unlink(db, { orgId: s.org_id, membershipId: s.whop_membership_id, at });
      } else {
        tally.errors.push({ membership: s.whop_membership_id, error: String((e && e.code) || "read_failed") });
      }
    }
  }

  // 3. Tie each to its client and save.
  const orgFallback = await defaultOrgId(db, env);
  const budget = { emailReads: maxEmailReads };
  for (const m of found.values()) {
    const row = rowFromMembership(m, { accountId });
    if (!row) { miss("unknown_shape"); continue; }
    if (row.whop_account_id !== accountId) { miss("other_account"); continue; }
    const before = savedById.get(m.id) || [];
    const match = await matchClient(db, m, { orgFallback, read, io, budget });
    if (match.clientId) {
      await saveRow(db, { orgId: match.orgId, clientId: match.clientId, matchedBy: match.by, row, at });
      tally.saved += 1;
      tally.matched[match.by] += 1;
      // The same plan saved under another company before: that old link is not this one.
      for (const b of before) {
        if (b.org_id !== match.orgId && !b.unlinked_at) tally.unlinked += await unlink(db, { orgId: b.org_id, membershipId: m.id, at });
      }
      continue;
    }
    miss(match.reason);
    for (const b of before) {
      if (b.unlinked_at) continue;
      if (match.final) {
        tally.unlinked += await unlink(db, { orgId: b.org_id, membershipId: m.id, at });
      } else {
        // Not sure this run (an email read failed): keep the client, refresh the facts.
        await saveRow(db, { orgId: b.org_id, clientId: b.client_id, matchedBy: b.matched_by, row, at });
        tally.saved += 1;
      }
    }
  }
  return tally;
}

export default syncWhopMemberships;
