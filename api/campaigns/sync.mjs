// POST /api/campaigns/sync — pull Meta campaigns / ad sets / ads / insights
// into local tables for one partner connection.
//
// Credentials: connection row's encrypted token (ad_platform_connections).
// App-level env (optional, for future token refresh):
//   META_APP_ID, META_APP_SECRET, META_API_VERSION
// Leave unset until a Meta app is configured — sync then returns
// credential_missing rather than inventing a token.
//
// WHY A 'pending' CONNECTION IS SYNCED TOO, AND WHAT PROMOTES IT.
//
// This used to read `connection_state = 'active'` only. Nothing in the codebase
// ever wrote 'active': api/campaigns/meta-agency.mjs is the only writer and it
// inserts 'pending' (its INSERT sets the literal), the column's own default is
// 'pending' (046_ad_platforms.sql:69), and so every freshly connected account
// answered "Connect a Meta ad account for this partner first." forever. The sync
// button could never be pressed successfully even once.
//
// The obvious shortcut — have meta-agency.mjs write 'active' — would be a lie.
// What that endpoint proves before it saves is that FUNDHUB'S OWN agency token
// authenticates and that Meta accepted a partnership REQUEST. It does not prove
// access to the partner's ad account: the partner admin still has to Approve in
// Business Settings → Requests, which is why that handler returns
// meta_approve_required: true. Access does not exist yet at save time.
//
// So 'active' keeps its real meaning and this file is what earns it: a
// connection becomes active the first time we successfully READ that ad account
// from Meta with its stored token. That is the proof, it is observable, and it
// is the same fact the launch gate (046 campaign_launch_gate) and the ceilings
// depend on. A pending row is therefore ATTEMPTED, and only a Meta call that
// actually came back promotes it. A failure leaves it pending and writes Meta's
// own sentence into last_error.
//
// AND IT IS RECORDED THE MOMENT IT HAPPENS. The promotion used to sit below the
// walk over every campaign, ad set and ad. Point 1 below says a big account
// cannot finish that walk inside the time limit — so on a big account the
// promotion was never reached and the row stayed pending forever, which is the
// same dead end this whole note is about. The proof arrives with the two
// account-level reads; everything after them is our own writing, not proof of
// access. So the UPDATE now runs the instant the campaign list comes back.
//
// THE SECOND SWITCH: platform_verification_state. 046_ad_platforms.sql:414-418
// will not put a credit-related campaign live unless that column says
// 'approved', and nothing in this repository ever wrote 'approved'. Same fix,
// same shape: Meta's own verification_status is read back off the Business node
// and written straight through (metaVerificationState below). We never award it
// ourselves, and when Meta will not answer, the column is left alone.
//
// Two pending rows are still skipped, because trying them cannot work:
//   - no stored token (an active row without one violates
//     ad_platform_connections_active_token_ck anyway), and
//   - a `pending:biz:<id>` placeholder ad account, which meta-agency.mjs writes
//     when nobody typed an act_ id. There is no account there to read.
// Both are reported by name instead of collapsing into one blank refusal.
//
// ═══════════════════════════════════════════════════════════════════════════
// TWO THINGS THIS RUN USED TO GET WRONG. Both cost the whole run.
//
// 1. ONE INSIGHTS CALL, NOT ONE PER AD. The numbers pull used to hit
//    `<ad id>/insights` separately for every single ad. An ad account with four
//    hundred ads meant four hundred sequential calls inside one request, which
//    does not finish inside a serverless time limit. Meta's insights endpoint
//    takes a `level` parameter, so asking the AD ACCOUNT for `level=ad` returns
//    a row per ad per day in ONE paged response. Same date window, same field
//    list. Rows are keyed back to each ad by the `ad_id` Meta puts on every row
//    — see insightsRequestUrl / fetchInsightPages / groupInsightsByAd below.
//
// 2. ONE SHORT TRANSACTION PER CAMPAIGN, NOT ONE FOR THE WHOLE RUN. Everything
//    used to happen inside a single withPartnerScope transaction that stayed
//    open across every call to Meta. If the run passed the time limit that
//    transaction was thrown away and NOTHING was saved — not campaigns, not ad
//    sets, not ads — so pressing Sync again started from zero and hit the same
//    wall.
//
//    It could also answer ok:true with counts for rows that were never written.
//    In Postgres the first failed statement aborts the whole transaction; every
//    later write then silently does nothing and COMMIT quietly becomes a
//    ROLLBACK. A swallowed INSERT error was therefore not "carry on", it was
//    "everything after this is a lie".
//
//    Now: every call to Meta happens OUTSIDE a transaction, and each campaign —
//    with its ad sets, its ads and their numbers — is written in its own short
//    transaction. A campaign that commits stays committed. A campaign that
//    fails is named in the answer and does not take the others with it. Nothing
//    is counted until its transaction has actually committed, and any failure
//    at all makes the answer say so (buildSyncResponse).
//
// 3. ONE PAGE IS NOT THE LIST. Every list Meta answers is a page plus a link
//    to the next page. The campaign, ad set and ad reads asked for a page and
//    never followed the link, so an ad account with more than a hundred
//    campaigns — or an ad set with more than a hundred ads — lost everything
//    past the first hundred, permanently and silently. Now all four lists go
//    through fetchAllPages(), which follows `paging.next` to the end, caps the
//    walk (LIST_MAX_PAGES) so a runaway account cannot spin forever, and puts
//    a line in `errors` when the cap is hit. A short answer says it is short.
// ═══════════════════════════════════════════════════════════════════════════

import { db } from "../../src/db.mjs";
import { requirePrincipal } from "../../src/http/middleware/requirePrincipal.mjs";
import { withPartnerScope } from "../../src/partners/rls.mjs";
import { resolvePartnerId } from "../../src/http/partner-read-api.mjs";
import { decryptToken } from "../../src/adplatforms/tokens.mjs";
import { callPlatform } from "../../src/adplatforms/_api.mjs";
import {
  normalizeInsight,
  VIDEO_INSIGHT_REQUEST_FIELDS
} from "../../src/adplatforms/meta.mjs";
import { notifyDyingBefore25 } from "../../src/ops/watch-curve.mjs";
import {
  MONEY_INSIGHT_REQUEST_FIELDS,
  META_RESULT_COLUMNS,
  metaResultMetrics
} from "../../src/ads/meta-results.mjs";
import { reresolveAdNumbers } from "../../src/ads/store.mjs";
import { safeError } from "../../src/http/health.mjs";

const API_VERSION = () => process.env.META_API_VERSION || "v21.0";
const BASE = "https://graph.facebook.com";

/* How many days of numbers to pull, and how far the pager is allowed to walk.
   The page cap is a stop, not a target: a pull that hits it keeps the rows it
   already read and says out loud that it stopped early.

   ═══════════════════════════════════════════════════════════════════════════
   WHY 28 AND NOT 7 — 2026-09-09. A SEVEN-DAY WINDOW LOSES DAYS FOREVER.

   Until now this pull only ever asked Meta for the last seven days, and the
   only thing that ran it was a person pressing Sync. Those two facts together
   are the whole problem: miss eight days and day eight is gone. Not "late" —
   gone. Meta still holds it, but nothing here would ever ask for it again, so
   ad_metrics_daily has no row for it, and the screens read a missing row as
   zero spend. "Nobody looked" and "we spent nothing" look identical.

   28 days is chosen for two reasons, not one:

     1. A MISSED WEEK IS STILL RECOVERABLE. The scheduled sweeper below runs
        daily, but a schedule that has been paused, a deploy that was down, or
        a connection that was broken and then fixed all produce a gap. 28 days
        means three whole weeks of that can be repaired by the next successful
        pull instead of being written off.

     2. META RESTATES RECENT NUMBERS. Attribution keeps settling after the day
        closes — conversions get credited back to earlier days, spend is
        adjusted. A day read once on the day itself is not the final number. A
        28-day window re-reads every day until it has stopped moving.

   RE-PULLING A DAY WE ALREADY HAVE IS CORRECT, NOT WASTE. storeInsights()
   writes with `ON CONFLICT (ad_id, date) DO UPDATE SET ...` (below), and that
   conflict target is a real unique index — db/migrations/046_ad_platforms.sql
   :461-462 `ad_metrics_daily_uniq ON ad_metrics_daily (ad_id, date)`. So a day
   that is pulled again overwrites itself with Meta's newer answer. It cannot
   double-count and it cannot duplicate a row.

   THE COST IS PAGES, AND IT IS BOUNDED. Four times the days is four times the
   rows, and the rows arrive INSIGHT_PAGE_SIZE at a time behind one account-level
   call (see insightsRequestUrl). At 500 rows a page, an account with 400 ads
   produces about 23 pages across 28 days, well inside INSIGHT_MAX_PAGES. A pull
   that ever does hit that cap keeps what it read and says so. */
export const INSIGHT_WINDOW_DAYS = 28;
export const INSIGHT_MAX_PAGES = 100;
export const INSIGHT_PAGE_SIZE = 500;

/* THE LISTS PAGE TOO — CAMPAIGNS, AD SETS AND ADS.
   Meta answers a list request with at most `limit` rows and a `paging.next`
   link for the rest. Asking for one page and never following that link is a
   silent loss: an ad account with more than LIST_PAGE_SIZE campaigns, or an ad
   set with more than LIST_PAGE_SIZE ads, simply never saw the rest, and no
   screen and no error ever said so.

   WHY 50 PAGES. Meta's own published ad-account limits are 5,000 campaigns,
   5,000 ad sets and 5,000 ads per account, so 50 pages of 100 covers a real
   account to Meta's own ceiling. It is a stop, not a target: a walk that hits
   it keeps every row it already read and says out loud that it stopped early
   (listTruncationMessage below), because replacing one silent truncation with
   another is the exact failure this exists to end. */
export const LIST_PAGE_SIZE = 100;
export const LIST_MAX_PAGES = 50;

function acct(connection) {
  const id = String(connection.external_ad_account_id || "");
  return id.startsWith("act_") ? id : `act_${id}`;
}

/* The two states worth attempting. 'expired' and 'revoked' are facts about the
   token that a retry cannot change, and a needs_verification row is blocked on
   the platform rather than on us. */
const SYNCABLE_STATES = new Set(["active", "pending"]);

/* pendingAdAccountPlaceholder() in src/adplatforms/meta.mjs writes this shape
   when the connect form had no act_ id in it. It is a note-to-self, not an
   account, and asking Meta for `act_pending:biz:123` only produces a confusing
   400. */
export const isPlaceholderAccount = (id) =>
  /^pending:/i.test(String(id || "").trim());

/* syncBlockReason(connection) → null when this row can be synced, otherwise one
   plain sentence saying what to do about it. Exported and dependency-free so it
   is unit-testable without a database. */
export function syncBlockReason(connection = {}) {
  if (!SYNCABLE_STATES.has(String(connection.connection_state))) {
    return `This Meta connection is ${connection.connection_state}. Reconnect the ad account.`;
  }
  if (!connection.encrypted_access_token) {
    return "This Meta connection has no saved key. Connect the ad account again.";
  }
  if (isPlaceholderAccount(connection.external_ad_account_id)) {
    return "This Meta connection has no ad account number yet. Add the act_ number to it.";
  }
  return null;
}

async function metaGet(connection, path, fields, ctx) {
  const token = decryptToken(connection.encrypted_access_token, {
    partnerId: connection.partner_id
  });
  if (!token) {
    const e = new Error("connection has no access token");
    e.code = "NO_TOKEN";
    throw e;
  }
  const qs = new URLSearchParams({ fields, limit: "100" });
  return callPlatform({
    url: `${BASE}/${API_VERSION()}/${path}?${qs}`,
    token,
    method: "GET",
    ctx
  });
}

/* ── business verification, read from Meta ────────────────────────────────── */

/* THE SECOND SWITCH NOBODY COULD FLIP.
   046_ad_platforms.sql:414-418 refuses to put a credit-related campaign live
   unless platform_verification_state = 'approved'. Nothing in this repository
   ever wrote 'approved': api/campaigns/meta-agency.mjs:169 inserts
   'unverified' and no other writer exists, so "go live" failed with a database
   error forever — the same permanent dead end 'active' had, one step further
   down the same road. Campaigns really do go live from here
   (api/campaigns/write.mjs:112), so the gate really does bite.

   Same shape as the fix above: something observable earns it. Meta's Business
   node carries its own verification_status, so the sync reads it back and
   writes what Meta said. We never award 'approved' ourselves.

   metaVerificationState(status) → one of the four values the column's CHECK
   allows (046_ad_platforms.sql:89), or null for "Meta did not say" — and null
   means leave the column alone rather than guess. Exported and
   dependency-free, so the mapping is testable without a database. */
export function metaVerificationState(status) {
  const s = String(status || "").trim().toLowerCase();
  if (!s) return null;
  if (s === "verified") return "approved";
  if (s === "not_verified") return "unverified";
  if (s.startsWith("pending")) return "submitted";
  if (["failed", "rejected", "revoked", "ineligible", "expired"].includes(s)) {
    return "rejected";
  }
  // An unrecognised word from Meta is not a decision. Say nothing.
  return null;
}

/* Ask Meta what the partner's Business Portfolio verification looks like.

   NEVER FATAL. A token without business_management scope, or a business id
   Meta will not show us, must not fail the sync or hold back the promotion
   above — the ad account read already proved access. When this cannot answer,
   the column keeps whatever it had and the screen keeps showing that. */
async function readVerificationState(connection, ctx) {
  const bizId = String(connection.external_business_id || "").trim();
  if (!/^\d+$/.test(bizId)) return null;
  try {
    const row = await metaGet(connection, bizId, "verification_status", ctx);
    return metaVerificationState(row?.verification_status);
  } catch {
    return null;
  }
}

/* The connection's key, decrypted once per connection instead of once per ad.
   A missing key is NO_TOKEN, never an empty string handed to Meta. */
function tokenFor(connection) {
  const token = decryptToken(connection.encrypted_access_token, {
    partnerId: connection.partner_id
  });
  if (!token) {
    const e = new Error("connection has no access token");
    e.code = "NO_TOKEN";
    throw e;
  }
  return token;
}

/* ── the one insights call ────────────────────────────────────────────────── */

/* insightsRequestUrl — the AD ACCOUNT's insights at level=ad.

   `level=ad` is the whole trick: it turns one request into a row per ad rather
   than one request per ad. `ad_id` is asked for by name so each row can be tied
   back to our own ad row; Meta includes it at this level anyway, and asking
   costs nothing.

   THE FIELD LIST IS NOT EDITED HERE. The video names (eight counts plus the
   play curve) come from one exported list in src/adplatforms/meta.mjs, and
   the money names (`actions` plus `cost_per_action_type`, 2026-10-05) from one
   exported list in src/ads/meta-results.mjs, so that what we ask Meta for and
   what the parser knows how to read can never drift apart. A name already on
   the list is not asked for twice. */
export function insightsRequestUrl(connection, { since, until, version = API_VERSION() } = {}) {
  const params = new URLSearchParams({
    fields: [...new Set([
      "ad_id", "spend", "impressions", "clicks", "ctr", "actions",
      "purchase_roas", "date_start",
      ...VIDEO_INSIGHT_REQUEST_FIELDS,
      ...MONEY_INSIGHT_REQUEST_FIELDS
    ])].join(","),
    time_range: JSON.stringify({ since, until }),
    time_increment: "1",
    level: "ad",
    limit: String(INSIGHT_PAGE_SIZE)
  });
  return `${BASE}/${version}/${acct(connection)}/insights?${params}`;
}

/* fetchAllPages → { rows, pages, truncated }

   Follows Meta's `paging.next` until it runs out. Bounded, and it refuses to
   read a page URL it has already read, because a cursor that loops back on
   itself would otherwise hang the request forever.

   THE SAME SHAPE src/analytics/clickfunnels.mjs:162-174 ALREADY USES for
   ClickFunnels: walk the cursor, cap the number of pages so one runaway account
   cannot spin forever. One walker, used by all four Meta lists — the numbers,
   the campaigns, the ad sets and the ads — rather than four half-answers.

   TRUNCATION IS REPORTED, NOT THROWN. The rows already read are real numbers
   worth keeping; throwing would drop every one of them to say the last page was
   missing. */
export async function fetchAllPages({ url, token, ctx = {}, maxPages = INSIGHT_MAX_PAGES }) {
  const rows = [];
  const seen = new Set();
  let next = url;
  let pages = 0;

  while (next && pages < maxPages) {
    if (seen.has(next)) break;
    seen.add(next);
    const page = await callPlatform({ url: next, token, method: "GET", ctx });
    for (const row of page?.data || []) rows.push(row);
    next = page?.paging?.next || null;
    pages += 1;
  }

  return { rows, pages, truncated: Boolean(next) };
}

/* The name this walker had when it only ever walked insights. Kept because the
   journey pages and the tests that pin the paging behaviour call it that. */
export const fetchInsightPages = fetchAllPages;

/* metaListUrl — the first page of one of Meta's lists. Same field list and same
   page size the single-page read used, so nothing about the request changed
   except that the answer is now followed to its end. */
export function metaListUrl(path, fields, { version = API_VERSION(), limit = LIST_PAGE_SIZE } = {}) {
  const qs = new URLSearchParams({ fields, limit: String(limit) });
  return `${BASE}/${version}/${path}?${qs}`;
}

/* metaList → { rows, pages, truncated } for campaigns / ad sets / ads. */
async function metaList(path, fields, { token, ctx = {}, maxPages = LIST_MAX_PAGES } = {}) {
  return fetchAllPages({ url: metaListUrl(path, fields), token, ctx, maxPages });
}

/* One sentence for a walk that stopped early, used by all four lists so the
   screen never has to guess which kind of shortfall it is looking at. */
export function listTruncationMessage({ pages, listed, missing = listed }) {
  return `stopped after ${pages} pages of ${listed} — ` +
    `the list was cut short, so some ${missing} are missing`;
}

/* groupInsightsByAd → Map keyed by Meta's ad id, holding that ad's day rows.

   A row with no ad_id cannot be tied to an ad, so it is dropped rather than
   guessed at. Guessing would put one ad's spend on a different ad. */
export function groupInsightsByAd(rows) {
  const byAd = new Map();
  for (const row of rows || []) {
    const key = row?.ad_id != null ? String(row.ad_id) : "";
    if (!key) continue;
    if (!byAd.has(key)) byAd.set(key, []);
    byAd.get(key).push(row);
  }
  return byAd;
}

/* The date window the pull covers: the last INSIGHT_WINDOW_DAYS days, one row
   per day. It was seven days for as long as a person pressing Sync was the only
   thing that ever ran it — see INSIGHT_WINDOW_DAYS above for why that pair of
   facts lost days permanently, and why the window is 28 now. */
export function insightWindow(now = Date.now()) {
  return {
    since: new Date(now - INSIGHT_WINDOW_DAYS * 864e5).toISOString().slice(0, 10),
    until: new Date(now).toISOString().slice(0, 10)
  };
}

async function upsertCampaign(tx, { orgId, partnerId, connectionId, row }) {
  const externalId = String(row.id);
  const budget = row.daily_budget != null
    ? Math.round(Number(row.daily_budget))
    : null;
  const existing = await tx.query(
    `SELECT id FROM campaigns WHERE connection_id = $1 AND external_id = $2`,
    [connectionId, externalId]
  );
  if (existing.rows[0]) {
    const u = await tx.query(
      `UPDATE campaigns SET
         name = $2, status = $3, objective = $4,
         budget_cents = COALESCE($5, budget_cents),
         special_ad_category = COALESCE($6, special_ad_category),
         synced_at = now(), updated_at = now(), last_error = NULL
       WHERE id = $1 RETURNING *`,
      [existing.rows[0].id, row.name, row.status || null, row.objective || null, budget,
       Array.isArray(row.special_ad_categories) && row.special_ad_categories[0]
         ? row.special_ad_categories[0]
         : null]
    );
    return u.rows[0];
  }
  const sac = Array.isArray(row.special_ad_categories) && row.special_ad_categories[0]
    ? row.special_ad_categories[0]
    : "CREDIT";
  const ins = await tx.query(
    `INSERT INTO campaigns (
       org_id, partner_id, connection_id, platform, external_id,
       name, status, objective, offer_type, special_ad_category, budget_cents,
       approval_state, synced_at
     ) VALUES (
       $1,$2,$3,'meta',$4,$5,$6,$7,'funding',$8,COALESCE($9,0),'draft',now()
     ) RETURNING *`,
    [orgId, partnerId, connectionId, externalId, row.name,
     row.status || null, row.objective || null, sac, budget]
  );
  return ins.rows[0];
}

async function upsertAdSet(tx, { orgId, partnerId, connectionId, campaignId, row }) {
  const externalId = String(row.id);
  const existing = await tx.query(
    `SELECT id FROM ad_sets WHERE connection_id = $1 AND external_id = $2`,
    [connectionId, externalId]
  );
  const budget = row.daily_budget != null ? Math.round(Number(row.daily_budget)) : 0;
  if (existing.rows[0]) {
    const u = await tx.query(
      `UPDATE ad_sets SET name = $2, status = $3, budget_cents = COALESCE($4, budget_cents),
         synced_at = now(), updated_at = now() WHERE id = $1 RETURNING *`,
      [existing.rows[0].id, row.name, row.status || null, budget]
    );
    return u.rows[0];
  }
  const ins = await tx.query(
    `INSERT INTO ad_sets (
       org_id, partner_id, connection_id, campaign_id, external_id, name, status, budget_cents, synced_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now()) RETURNING *`,
    [orgId, partnerId, connectionId, campaignId, externalId, row.name,
     row.status || null, budget]
  );
  return ins.rows[0];
}

async function upsertAd(tx, { orgId, partnerId, connectionId, campaignId, adSetId, row }) {
  const externalId = String(row.id);
  const existing = await tx.query(
    `SELECT id FROM ads WHERE connection_id = $1 AND external_id = $2`,
    [connectionId, externalId]
  );
  if (existing.rows[0]) {
    const u = await tx.query(
      `UPDATE ads SET name = $2, status = $3, updated_at = now() WHERE id = $1 RETURNING *`,
      [existing.rows[0].id, row.name, row.status || null]
    );
    return u.rows[0];
  }
  const ins = await tx.query(
    `INSERT INTO ads (
       org_id, partner_id, connection_id, campaign_id, ad_set_id, external_id, name, status
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [orgId, partnerId, connectionId, campaignId, adSetId, externalId, row.name, row.status || null]
  );
  return ins.rows[0];
}

/* storeInsights → the number of days actually written

   THE EIGHT VIDEO COUNT COLUMNS PLUS video_play_curve PASS THROUGH AS NULL
   WHEN META DID NOT ANSWER. Never 0 / never []: a photo ad has no video numbers
   at all and a video nobody watched has real zeros, and 378 / 394 exist to keep
   those facts apart. So these video parameters are `?? null` and the four
   money/count ones above them keep their `?? 0`, because those columns are NOT
   NULL (046:440-448).

   A FAILED INSERT IS NO LONGER CAUGHT HERE, AND THE COUNT NO LONGER LIES. This
   used to end `.catch(...)` and then increment `stored` regardless, so a write
   that failed was counted as a write that succeeded. Worse, catching it was
   never really "carry on": in Postgres the first failed statement aborts the
   whole transaction, so every later write in the same transaction silently did
   nothing and COMMIT quietly became a ROLLBACK.

   Letting it throw hands the failure to the campaign that owns this transaction
   (see the handler). That one campaign rolls back and is named in the answer;
   the campaigns that already committed are untouched. The reason still travels
   all the way to the response — on a database where migration 378 / 394 has not
   been applied, "column does not exist" is exactly what the reader needs to see.

   THE FOUR META RESULT COLUMNS (408) — purchases, cost_per_purchase_cents,
   link_clicks, landing_page_views — come from metaResultMetrics()
   (src/ads/meta-results.mjs) and pass through as NULL when Meta sent no line
   for them, never 0. They are written only when `withResults` is true, which
   the sync decides once per run by looking for the columns
   (hasMetaResultColumns). Until 408 is applied the write is exactly what it
   was before, so this code landing ahead of the migration cannot break the
   daily pull. */
export function insightUpsertSql({ withResults = false } = {}) {
  const extraCols = withResults ? `,\n         ${META_RESULT_COLUMNS.join(", ")}` : "";
  const extraVals = withResults ? ",$19,$20,$21,$22" : "";
  const extraSet = withResults
    ? META_RESULT_COLUMNS.map((c) => `,\n         ${c} = EXCLUDED.${c}`).join("")
    : "";
  return `INSERT INTO ad_metrics_daily (
         org_id, partner_id, ad_id, date, spend_cents, impressions, clicks, ctr, roas,
         video_continuous_2s_watched, video_plays,
         video_p25_watched, video_p50_watched, video_p75_watched,
         video_p95_watched, video_p100_watched, video_thruplay_watched,
         video_play_curve${extraCols}
       ) VALUES ($1,$2,$3,$4::date,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb${extraVals})
       ON CONFLICT (ad_id, date) DO UPDATE SET
         spend_cents = EXCLUDED.spend_cents,
         impressions = EXCLUDED.impressions,
         clicks = EXCLUDED.clicks,
         ctr = EXCLUDED.ctr,
         roas = EXCLUDED.roas,
         video_continuous_2s_watched = EXCLUDED.video_continuous_2s_watched,
         video_plays = EXCLUDED.video_plays,
         video_p25_watched = EXCLUDED.video_p25_watched,
         video_p50_watched = EXCLUDED.video_p50_watched,
         video_p75_watched = EXCLUDED.video_p75_watched,
         video_p95_watched = EXCLUDED.video_p95_watched,
         video_p100_watched = EXCLUDED.video_p100_watched,
         video_thruplay_watched = EXCLUDED.video_thruplay_watched,
         video_play_curve = EXCLUDED.video_play_curve${extraSet},
         synced_at = now()`;
}

/* The values for insightUpsertSql, in the same order. Exported beside it so a
   test can hold the SQL and the values side by side. */
export function insightUpsertParams({ orgId, partnerId, adId, day, raw, withResults = false }) {
  const row = normalizeInsight(raw);
  const curve = row.video_play_curve == null
    ? null
    : JSON.stringify(row.video_play_curve);
  const params = [orgId, partnerId, adId, day, row.spend_cents ?? 0,
    row.impressions ?? 0, row.clicks ?? 0, row.ctr ?? null, row.roas ?? null,
    row.video_continuous_2s_watched ?? null, row.video_plays ?? null,
    row.video_p25_watched ?? null,
    row.video_p50_watched ?? null, row.video_p75_watched ?? null,
    row.video_p95_watched ?? null, row.video_p100_watched ?? null,
    row.video_thruplay_watched ?? null, curve];
  if (withResults) {
    const m = metaResultMetrics(raw);
    for (const c of META_RESULT_COLUMNS) params.push(m[c] ?? null);
  }
  return params;
}

/* Are the 408 columns on ad_metrics_daily? Read from the catalog, which is not
   filtered by row-level security or column grants. Any failure answers false:
   the old write is always the safe one. */
export async function hasMetaResultColumns(query) {
  try {
    const r = await query(
      `SELECT count(*)::int AS n
         FROM pg_attribute
        WHERE attrelid = to_regclass('public.ad_metrics_daily')
          AND attname = ANY($1::text[])
          AND attnum > 0 AND NOT attisdropped`,
      [[...META_RESULT_COLUMNS]]
    );
    return Number(r?.rows?.[0]?.n) === META_RESULT_COLUMNS.length;
  } catch {
    return false;
  }
}

async function storeInsights(tx, { orgId, partnerId, adId, insights, withResults = false }) {
  let stored = 0;
  const sql = insightUpsertSql({ withResults });
  for (const raw of insights || []) {
    const day = raw.date_start || raw.date || null;
    if (!day || !adId) continue;
    await tx.query(sql, insightUpsertParams({ orgId, partnerId, adId, day, raw, withResults }));
    stored += 1;
  }
  return stored;
}

/* ── the answer ───────────────────────────────────────────────────────────── */

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/* buildSyncResponse → { status, body }

   THE RUN NEVER CLAIMS TO HAVE SAVED WHAT IT DID NOT SAVE. `ok` is true only
   when every part committed. A run that saved some campaigns and lost others
   answers ok:false with partial:true and the counts that really landed, so
   nobody goes looking for data that was never written. A run that saved nothing
   at all answers 502.

   Exported and dependency-free, so the wording and the ok/partial decision can
   be tested without a database. */
export function buildSyncResponse({ stats, missingApp }) {
  const saved = stats.campaigns + stats.ad_sets + stats.ads + stats.insights;
  const failures = stats.errors.length;
  const ok = failures === 0;
  const partial = !ok && saved > 0;

  const counts =
    `${plural(stats.campaigns, "campaign", "campaigns")}, ` +
    `${plural(stats.ad_sets, "ad set", "ad sets")}, ` +
    `${plural(stats.ads, "ad", "ads")} and ` +
    `${plural(stats.insights, "day of numbers", "days of numbers")}`;

  let message;
  if (ok) {
    message = `Pulled in ${counts}.`;
  } else if (partial) {
    message = `Saved ${counts}, then stopped. ` +
      `${plural(failures, "part", "parts")} did not save. ` +
      `First problem: ${describeError(stats.errors[0])}`;
  } else {
    message = `Nothing was saved. ` +
      `${plural(failures, "part", "parts")} failed. ` +
      `First problem: ${describeError(stats.errors[0])}`;
  }

  return {
    status: ok || partial ? 200 : 502,
    body: {
      ok,
      partial,
      platform: "meta",
      connections: stats.connections,
      campaigns: stats.campaigns,
      ad_sets: stats.ad_sets,
      ads: stats.ads,
      insights: stats.insights,
      errors: stats.errors,
      message,
      meta_app_configured: !missingApp,
      note: missingApp
        ? "META_APP_ID / META_APP_SECRET unset — sync uses connection user tokens only; token refresh needs the app credentials (see ops/STILL-MISSING.md)."
        : null
    }
  };
}

/* One failure, in words: which thing it was, then what went wrong with it. */
function describeError(entry) {
  if (!entry) return "unknown";
  const where = entry.campaign
    ? `campaign ${entry.campaign}`
    : entry.connection
      ? `ad account link ${entry.connection}`
      : entry.ad
        ? `ad ${entry.ad}`
        : "the sync";
  return `${where} — ${entry.error}`;
}

/* syncPartnerConnections — THE PULL ITSELF, with no request and no response in
   it. Everything below used to live inside the handler, which meant the only
   way to run a sync was to be a signed-in person pressing a button. Lifting it
   out changes nothing about what it does; it just gives the scheduled sweeper
   (src/workflows/meta-campaign-sync-sweeper.mjs) the same door.

   IT STILL RUNS INSIDE THE PARTNER'S OWN SCOPE. inScope below is the same
   withPartnerScope call it always was, so the row-level policies apply to a
   scheduled run exactly as they apply to a button press. A sweeper looping over
   partners therefore opens one scoped transaction per partner and can never see
   across the boundary — see src/partners/rls.mjs.

   It throws NO_CONNECTION / NO_TOKEN the way it always did; the handler turns
   those into the same 400s, and the sweeper counts them as skips. */
export async function syncPartnerConnections({ partnerId, connectionId = null, deps = {} }) {
  /* Every database touch below opens its own short transaction. NONE of them
     wraps a call to Meta — that is the whole point of this shape. */
  const inScope = (fn) => withPartnerScope({ kind: "partner", partnerId }, fn);

  const connId = connectionId;
  const found = await inScope((tx) => tx.query(
    `SELECT * FROM ad_platform_connections
      WHERE partner_id = $1 AND platform = 'meta'
        AND ($2::uuid IS NULL OR id = $2)
      ORDER BY created_at`,
    [partnerId, connId]
  ).then((r) => r.rows));

  /* Filtered here rather than in the WHERE so the reason a row was skipped
     survives into the answer. "Connect a Meta ad account first" told Chris
     to redo the one thing he had already done. */
  const usable = found.filter((c) => syncBlockReason(c) === null);
  if (!usable.length) {
    const e = new Error(
      found.length ? syncBlockReason(found[0]) : "no Meta connection for this partner"
    );
    e.code = "NO_CONNECTION";
    e.connected = found.length > 0;
    throw e;
  }

  const stats = { connections: 0, campaigns: 0, ad_sets: 0, ads: 0, insights: 0, errors: [] };
  const orgId = usable[0].org_id;

  /* Purchases, cost per purchase, link clicks and landing page views (408).
     Asked once per run. false until 408 is applied, and then the write is the
     same as it always was. Reported, never fatal. */
  const withResults = await inScope((tx) =>
    hasMetaResultColumns((sql, params) => tx.query(sql, params))
  ).catch(() => false);
  stats.meta_results_saved = withResults;

  for (const connection of usable) {
    stats.connections += 1;
    try {
      const token = tokenFor(connection);
      const { since, until } = insightWindow();

      /* ONE call for every ad's numbers, instead of one call per ad. Done
         before the walk so each ad's days are already in hand when its row is
         written, which keeps the write transactions short. */
      const pull = await fetchAllPages({
        url: insightsRequestUrl(connection, { since, until }),
        token,
        ctx: deps
      });
      const insightsByAd = groupInsightsByAd(pull.rows);
      if (pull.truncated) {
        stats.errors.push({
          connection: connection.id,
          error: listTruncationMessage({
            pages: pull.pages, listed: "numbers", missing: "days"
          })
        });
      }

      /* THE CAMPAIGN LIST, FOLLOWED TO ITS END. This used to read one page.
         An ad account with more than LIST_PAGE_SIZE campaigns lost every
         campaign past the first page, with nothing on screen to say so. */
      const campaignPull = await metaList(
        `${acct(connection)}/campaigns`,
        "id,name,status,objective,daily_budget,special_ad_categories",
        { token, ctx: deps }
      );
      if (campaignPull.truncated) {
        stats.errors.push({
          connection: connection.id,
          error: listTruncationMessage({ pages: campaignPull.pages, listed: "campaigns" })
        });
      }

      /* THE PROMOTION, AND THE ONLY THING THAT EVER SETS 'active'.
         Reaching this line means Meta answered a read of this ad account
         with this connection's own stored token — which is exactly what
         'active' is defined to mean in 046_ad_platforms.sql:64-69. The
         token is non-null (syncBlockReason refuses a row without one), so
         ad_platform_connections_active_token_ck cannot be violated here.
         Anything other than 'pending' is left alone: a row someone
         deliberately marked expired or revoked is not un-marked by a sync.

         IT RUNS HERE, THE MOMENT META ANSWERS — NOT AFTER THE WALK.
         It used to sit below the campaign loop. The walk makes one call per
         campaign and one per ad set (see the header note above), so a busy
         ad account can pass the serverless time limit before the loop ends.
         When that happened the promotion was never reached, the row stayed
         'pending', and the next press did exactly the same thing — the same
         permanent dead end, just moved to bigger accounts. Everything after
         the two reads above is OUR writing, not proof of access; the proof
         already arrived with the insights pull and the campaign list, so the
         proof is recorded the moment it lands — before any further call to
         Meta, including the verification read directly below it. */
      await inScope((tx) => tx.query(
        `UPDATE ad_platform_connections
            SET last_synced_at = now(),
                last_error = NULL,
                connection_state = CASE WHEN connection_state = 'pending'
                                        THEN 'active' ELSE connection_state END,
                updated_at = now()
          WHERE id = $1`,
        [connection.id]
      )).catch((err) => {
        // Swallowing this used to leave a connection stuck pending with
        // nothing on screen to say why.
        stats.errors.push({ connection: connection.id, error: String(err.message || err) });
        return null;
      });

      /* THE SECOND GATE, EARNED THE SAME WAY. Meta's own word on the
         partner's business verification, written straight through. NULL
         means Meta did not say, and the column keeps what it had. Never
         fatal, never counted as a failure of the run: readVerificationState
         swallows its own errors, so a token without business_management
         scope costs nothing here. */
      const verification = await readVerificationState(connection, deps);
      if (verification) {
        await inScope((tx) => tx.query(
          `UPDATE ad_platform_connections
              SET platform_verification_state = $2, updated_at = now()
            WHERE id = $1 AND platform_verification_state IS DISTINCT FROM $2`,
          [connection.id, verification]
        )).catch(() => null);
      }

      for (const crow of campaignPull.rows) {
        /* Read this campaign's ad sets and ads from Meta BEFORE opening a
           transaction. A transaction is never held open across a network
           call. */
        const tree = [];
        try {
          /* Both of these are walked to the end too. An ad set with more
             than LIST_PAGE_SIZE ads used to lose every ad past the first
             page — the screen showed fewer ads than exist, forever. A walk
             that hits the cap keeps what it read and is named in the answer
             so the shortfall is visible instead of silent. */
          const setPull = await metaList(
            `${crow.id}/adsets`,
            "id,name,status,daily_budget,campaign_id",
            { token, ctx: deps }
          );
          if (setPull.truncated) {
            stats.errors.push({
              campaign: crow.id,
              error: listTruncationMessage({ pages: setPull.pages, listed: "ad sets" })
            });
          }
          for (const srow of setPull.rows) {
            const adPull = await metaList(
              `${srow.id}/ads`,
              "id,name,status,adset_id",
              { token, ctx: deps }
            );
            if (adPull.truncated) {
              stats.errors.push({
                campaign: crow.id,
                error: `ad set ${srow.id} — ` +
                  listTruncationMessage({ pages: adPull.pages, listed: "ads" })
              });
            }
            tree.push({ set: srow, ads: adPull.rows });
          }
        } catch (err) {
          stats.errors.push({ campaign: crow.id, error: String(err.message || err) });
          continue;
        }

        /* One short transaction for this campaign and everything under it.
           Counted only after it has committed — see buildSyncResponse. */
        try {
          const written = await inScope(async (tx) => {
            const done = { ad_sets: 0, ads: 0, insights: 0 };
            const camp = await upsertCampaign(tx, {
              orgId, partnerId, connectionId: connection.id, row: crow
            });
            for (const { set: srow, ads } of tree) {
              const adSet = await upsertAdSet(tx, {
                orgId, partnerId, connectionId: connection.id,
                campaignId: camp.id, row: srow
              });
              done.ad_sets += 1;
              for (const arow of ads) {
                const ad = await upsertAd(tx, {
                  orgId, partnerId, connectionId: connection.id,
                  campaignId: camp.id, adSetId: adSet.id, row: arow
                });
                done.ads += 1;
                done.insights += await storeInsights(tx, {
                  orgId, partnerId, adId: ad.id,
                  insights: insightsByAd.get(String(arow.id)) || [],
                  withResults
                });
              }
            }
            return done;
          });
          stats.campaigns += 1;
          stats.ad_sets += written.ad_sets;
          stats.ads += written.ads;
          stats.insights += written.insights;
        } catch (err) {
          stats.errors.push({ campaign: crow.id, error: String(err.message || err) });
        }
      }

    } catch (err) {
      stats.errors.push({ connection: connection.id, error: String(err.message || err) });
      // Its own transaction, so a failure while recording a failure cannot
      // take anything else down with it.
      await inScope((tx) => tx.query(
        `UPDATE ad_platform_connections SET last_error = $2 WHERE id = $1`,
        [connection.id, String(err.message || err).slice(0, 500)]
      )).catch(() => null);
    }
  }

  /* AD NUMBERS FOR VISITORS WHO ARRIVED BEFORE THEIR AD WAS HERE (407).
     A visitor's ad number is found by ad set id + ad name against the ads this
     sync just saved. Someone who clicked before the ad was copied in, or before
     the ad had its Fundhub number, was saved with no number; this fills those,
     and only those. It never changes a number already set. A failure here
     (407 not applied yet, for one) is reported and never undoes a good sync. */
  try {
    const filled = await inScope((tx) => reresolveAdNumbers(tx, { orgId }));
    stats.ad_numbers = { filled };
  } catch (err) {
    stats.ad_numbers = {
      filled: 0,
      error: String((err && err.message) || err).slice(0, 300)
    };
  }

  /* Watch-curve dying alert. Read-only on Meta. Uses the same phone/ntfy path
     as the ad-video pipeline. A buzz failure must not undo a good sync. */
  try {
    const scoped = {
      query: (sql, params) => inScope((tx) => tx.query(sql, params))
    };
    stats.watch_curve = await notifyDyingBefore25(scoped, { partnerId });
  } catch (err) {
    stats.watch_curve = {
      checked: 0,
      alerted: 0,
      skipped: 0,
      error: String((err && err.message) || err).slice(0, 300)
    };
  }

  return stats;
}

export default async function handler(req, res, deps = {}) {
  const database = deps.db || db;
  if (req.method !== "POST") {
    res.setHeader("allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const principal = await requirePrincipal(req, res, ["partner", "staff"], { db: database });
  if (!principal) return;

  const body = req.body || {};
  const query = { ...(req.query || {}), partner_id: body.partner_id || (req.query || {}).partner_id };
  const partnerId = resolvePartnerId(principal, query);
  if (!partnerId) {
    return res.status(400).json({ ok: false, error: "partner_id_required" });
  }

  // App credentials are optional for user-token sync, but document the gap.
  const missingApp = !process.env.META_APP_ID || !process.env.META_APP_SECRET;

  try {
    const stats = await syncPartnerConnections({
      partnerId,
      connectionId: body.connection_id || null,
      deps
    });
    const answer = buildSyncResponse({ stats, missingApp });
    return res.status(answer.status).json(answer.body);
  } catch (err) {
    if (err.code === "NO_CONNECTION" || err.code === "NO_TOKEN") {
      return res.status(400).json({
        ok: false,
        error: err.code === "NO_TOKEN" ? "credential_missing" : "no_meta_connection",
        message: err.message,
        need: err.code === "NO_TOKEN"
          ? "Store a Meta Marketing API user token on ad_platform_connections (encrypted). Optionally set META_APP_ID + META_APP_SECRET for refresh."
          // A connection that exists but cannot be used gets the reason it
          // cannot be used. Telling someone to connect an account they already
          // connected is what made this dead end feel permanent.
          : err.connected
            ? err.message
            : "Connect a Meta ad account for this partner first."
      });
    }
    return res.status(500).json({ ok: false, error: safeError(err) });
  }
}
