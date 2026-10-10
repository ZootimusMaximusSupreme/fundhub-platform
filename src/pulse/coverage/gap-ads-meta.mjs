// Meta ad money for the morning pulse. Read only. Report only. (coverage batch W2, 2026-10-10)
//
//   ads-meta:matches    Does what we show for each campaign (running or paused, daily budget) equal what
//                       Meta says right now? A campaign we show as paused that Meta still spends on is
//                       the one this exists for.
//   ads-meta:load-jobs  Are the "Load to Meta" jobs (marketing_jobs kind meta_load) moving, or failed
//                       or stuck? gap-marketing-queue.mjs leaves this kind to "the ads lane" and no
//                       check read it before this one.
//
// HOW THE COMPARISON STAYS HONEST
//   * GET only. One read of the ad account's campaign list per saved connection, with the saved key
//     decrypted in memory (src/adplatforms/tokens.mjs) and sent as a Bearer header, the same way
//     api/campaigns/sync.mjs reads. The key is never written down, never put in a row, never in a URL.
//   * Meta's `updated_time` on a campaign says when the campaign last changed there. If it changed
//     AFTER our row was last touched (synced_at or updated_at, plus 2 minutes), the hourly sync simply
//     has not caught up, and that campaign is counted as "changed in Meta since our last sync", not red.
//   * Red is a mismatch that Meta stopped changing BEFORE our row was last touched. Our sync (or our
//     write door) stored something Meta does not hold: the sync is wrong, or "Stop spending" said paused
//     and Meta did not take it.
//   * Meta's daily_budget is on the campaign only for campaign-budget campaigns. When Meta sends none,
//     the budget is not compared (the sync keeps our old budget for that case on purpose).
//   * A campaign we show as ACTIVE that Meta's list does not hold is red, but only when the list was
//     read to its end. A cut-short list proves nothing about what is missing.
//
// WHAT IT CANNOT SEE: an ad set's budget, an ad's status, spend, or delivery. Those are the other ads
// rows (gap-ads.mjs). It does not change a budget, pause a campaign or load an ad.
//
// A failed read, a key it cannot open, or Meta refusing the key is a skip with the reason, never a PASS.

import { decryptToken } from "../../adplatforms/tokens.mjs";
import { QUEUE_WAIT_MS as LOAD_QUEUE_WAIT_MS, FAILED_LOOKBACK_DAYS } from "./gap-marketing-queue.mjs";
import {
  DAY_MS, MIN_MS, TRIP, ageOf, clip, intOf, naRow, nowOf, plural, readRow, readRows, request, row, runnerOf, skipWhy, toDate
} from "./money-reads.mjs";

export const CHECK_IDS = Object.freeze(["ads-meta:matches", "ads-meta:load-jobs"]);

export const GRAPH_BASE = "https://graph.facebook.com";
/** api/campaigns/sync.mjs DEFAULT_META_API_VERSION. META_API_VERSION wins when it is set, as it does there. */
export const DEFAULT_META_API_VERSION = "v26.0";
export const CAMPAIGN_FIELDS = "id,name,status,effective_status,daily_budget,updated_time";
export const PAGE_SIZE = 100;
export const MAX_PAGES = 3;
export const MAX_CONNECTIONS = 3;
/** Two minutes of clock difference between Meta's stamp and ours. */
export const CLOCK_SLACK_MS = 2 * MIN_MS;
/** The whole Meta read has this long. Each lane is one pulse step with a 26 second ceiling. */
export const META_DEADLINE_MS = 14000;

/** gap-marketing-queue.mjs: a queued job waits 3 clock ticks of 15 minutes before it is red. */
export const QUEUE_WAIT_MS = LOAD_QUEUE_WAIT_MS;
/** src/marketing/jobs.mjs STALE_AFTER_MINUTES (a claim older than this is taken back). Held equal by a drift test. */
export const STALE_AFTER_MINUTES = 16;
/** A claim is taken back after STALE_AFTER_MINUTES by a clock that ticks every 15 minutes. */
export const RUNNING_WAIT_MS = (STALE_AFTER_MINUTES + 15) * MIN_MS;
export const FAILED_LOOKBACK_MS = FAILED_LOOKBACK_DAYS * DAY_MS;

export const CONNECTIONS_SQL = `
  /* gap:ads-meta-connections */
  SELECT id::text AS id,
         partner_id::text AS partner_id,
         external_ad_account_id,
         encrypted_access_token
    FROM ad_platform_connections
   WHERE platform = 'meta'
     AND connection_state = 'active'
     AND encrypted_access_token IS NOT NULL
     AND external_ad_account_id IS NOT NULL
     AND external_ad_account_id NOT ILIKE 'pending:%'
   ORDER BY last_synced_at DESC NULLS LAST
   LIMIT ${MAX_CONNECTIONS}
`;

export const CONNECTION_COUNT_SQL = `
  /* gap:ads-meta-connection-count */
  SELECT count(*)::int AS n
    FROM ad_platform_connections
   WHERE platform = 'meta'
     AND connection_state = 'active'
     AND encrypted_access_token IS NOT NULL
     AND external_ad_account_id IS NOT NULL
     AND external_ad_account_id NOT ILIKE 'pending:%'
`;

export const CAMPAIGNS_SQL = `
  /* gap:ads-meta-campaigns */
  SELECT external_id, name, status, budget_cents, synced_at, updated_at
    FROM campaigns
   WHERE connection_id = $1::uuid
     AND platform = 'meta'
     AND external_id IS NOT NULL
   LIMIT 500
`;

export const LOAD_JOBS_SQL = `
  /* gap:ads-meta-load-jobs */
  SELECT count(*)::int AS total_n,
         count(*) FILTER (WHERE status = 'failed' AND COALESCE(finished_at, updated_at) >= $2::timestamptz)::int AS failed_n,
         count(*) FILTER (WHERE status = 'queued' AND run_after < $3::timestamptz)::int AS queued_n,
         count(*) FILTER (WHERE status = 'running' AND COALESCE(claimed_at, created_at) < $4::timestamptz)::int AS running_n,
         min(created_at) FILTER (WHERE
               (status = 'failed' AND COALESCE(finished_at, updated_at) >= $2::timestamptz)
            OR (status = 'queued' AND run_after < $3::timestamptz)
            OR (status = 'running' AND COALESCE(claimed_at, created_at) < $4::timestamptz)) AS oldest,
         left(string_agg(DISTINCT left(error, 90), ' | ') FILTER (
               WHERE status = 'failed' AND COALESCE(finished_at, updated_at) >= $2::timestamptz), 240) AS errors,
         (SELECT count(*)::int FROM ad_videos v
           WHERE v.org_id = $1::uuid AND v.load_error IS NOT NULL AND v.loaded_at IS NULL) AS video_error_n
    FROM marketing_jobs
   WHERE org_id = $1::uuid
     AND kind = 'meta_load'
`;

/* ---- the pure comparison ----------------------------------------------------------------------- */

const up = (v) => String(v == null ? "" : v).trim().toUpperCase();

/**
 * judgeCampaigns({ ours, meta, truncated }) -> counts and the names of what is wrong. Pure.
 *   ours  rows of CAMPAIGNS_SQL
 *   meta  Meta's campaign objects ({ id, status, daily_budget, updated_time })
 *   truncated  true when Meta's list was cut short (missing-at-Meta is then never claimed)
 */
export function judgeCampaigns({ ours = [], meta = [], truncated = false } = {}) {
  const byId = new Map();
  for (const m of meta) if (m && m.id != null) byId.set(String(m.id), m);
  const out = { compared: 0, behind: 0, status: [], budget: [], missing: [], unread: 0 };
  for (const o of ours) {
    const key = String(o.external_id);
    const m = byId.get(key);
    const name = clip(o.name || key, 40);
    if (!m) {
      if (!truncated && up(o.status) === "ACTIVE") out.missing.push(name);
      else out.unread += 1;
      continue;
    }
    out.compared += 1;
    const touched = [toDate(o.synced_at), toDate(o.updated_at)].filter(Boolean).sort((a, b) => b.getTime() - a.getTime())[0] || null;
    const metaChanged = toDate(m.updated_time);
    if (metaChanged && touched && metaChanged.getTime() > touched.getTime() + CLOCK_SLACK_MS) {
      out.behind += 1;
      continue;
    }
    const ourStatus = up(o.status);
    const metaStatus = up(m.status);
    if (ourStatus && metaStatus && ourStatus !== metaStatus) {
      out.status.push(`${name}: we show ${ourStatus}, Meta says ${metaStatus}`);
    }
    if (m.daily_budget != null && m.daily_budget !== "") {
      const metaCents = Math.round(Number(m.daily_budget));
      const ourCents = o.budget_cents == null ? null : Number(o.budget_cents);
      if (Number.isFinite(metaCents) && ourCents !== null && Number.isFinite(ourCents) && ourCents !== metaCents) {
        out.budget.push(`${name}: we show ${ourCents} cents a day, Meta says ${metaCents}`);
      }
    }
  }
  return out;
}

/* ---- the Meta read ------------------------------------------------------------------------------ */

function withDeadline(promise, ms, what) {
  let timer;
  const cut = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} did not answer in ${Math.round(ms / 1000)} seconds`)), ms);
  });
  return Promise.race([promise, cut]).finally(() => clearTimeout(timer));
}

function actPath(id) {
  const s = String(id || "");
  return s.startsWith("act_") ? s : `act_${s}`;
}

/** Meta's campaign list for one account, GET only, followed to its end up to MAX_PAGES. */
export async function readMetaCampaigns({ fetchImpl, token, accountId, version }) {
  const qs = new URLSearchParams({ fields: CAMPAIGN_FIELDS, limit: String(PAGE_SIZE) });
  let next = `${GRAPH_BASE}/${version}/${actPath(accountId)}/campaigns?${qs}`;
  const rows = [];
  const seen = new Set();
  let pages = 0;
  while (next && pages < MAX_PAGES) {
    if (seen.has(next)) break;
    seen.add(next);
    const res = await request(fetchImpl, "GET", next, { headers: { authorization: `Bearer ${token}`, accept: "application/json" } });
    let body = null;
    try { body = JSON.parse(res.text); } catch { body = null; }
    if (res.status < 200 || res.status >= 300 || !body) {
      const e = new Error(`Meta answered ${res.status || "nothing"}`);
      e.status = res.status;
      throw e;
    }
    for (const r of Array.isArray(body.data) ? body.data : []) rows.push(r);
    next = body.paging && body.paging.next ? String(body.paging.next) : null;
    pages += 1;
  }
  return { rows, truncated: Boolean(next) };
}

async function defaultOrg(run) {
  try {
    const out = await run((tx) => tx.query("SELECT id FROM orgs WHERE is_default LIMIT 1"));
    return out && out.rows && out.rows[0] ? String(out.rows[0].id) : null;
  } catch {
    return null;
  }
}

async function checkMatches({ run, hasScope, env, fetchImpl }) {
  const id = CHECK_IDS[0];
  if (!run) return row(id, "skip", "no database in this run, so the saved Meta connections were not read");
  const conns = await readRows(run, id, "the saved Meta connections", CONNECTIONS_SQL, []);
  if (conns.skip) return conns.skip;
  if (conns.rows.length === 0) {
    if (!hasScope) {
      return row(id, "skip", "no staff scope in this run, and the ad tables read as empty without it, so the Meta connections were not read");
    }
    return naRow(
      id,
      "not-connected",
      { check: id, what: "A Meta ad account" },
      "No Meta ad account is connected and active, so there is no campaign to compare with Meta. Judged the day one is connected."
    );
  }
  if (typeof fetchImpl !== "function") return row(id, "skip", "no fetch in this run, so Meta was not asked");
  const version = (env && env.META_API_VERSION) || DEFAULT_META_API_VERSION;
  const total = { compared: 0, behind: 0, unread: 0, status: [], budget: [], missing: [] };
  const skips = [];
  let read = 0;
  for (const conn of conns.rows) {
    let token;
    try {
      token = decryptToken(conn.encrypted_access_token, { partnerId: conn.partner_id, env });
    } catch (err) {
      // The message names the variable and never a value (src/adplatforms/tokens.mjs).
      skips.push(`a saved Meta key could not be opened (${clip(err, 90)})`);
      continue;
    }
    if (!token) {
      skips.push("a saved Meta connection has no key");
      continue;
    }
    const ours = await readRows(run, id, "our campaigns", CAMPAIGNS_SQL, [conn.id]);
    if (ours.skip) {
      skips.push(ours.skip.detail);
      continue;
    }
    let listed;
    try {
      listed = await withDeadline(
        readMetaCampaigns({ fetchImpl, token, accountId: conn.external_ad_account_id, version }),
        META_DEADLINE_MS,
        "Meta"
      );
    } catch (err) {
      skips.push(`Meta was not read: ${clip(String(err && err.message ? err.message : err).replaceAll(token, "[key]"), 100)}`);
      continue;
    }
    read += 1;
    const j = judgeCampaigns({ ours: ours.rows, meta: listed.rows, truncated: listed.truncated });
    total.compared += j.compared;
    total.behind += j.behind;
    total.unread += j.unread;
    total.status.push(...j.status);
    total.budget.push(...j.budget);
    total.missing.push(...j.missing);
  }
  const wrong = total.status.length + total.budget.length + total.missing.length;
  if (wrong > 0) {
    const bits = [];
    if (total.status.length) bits.push(`${plural(total.status.length, "campaign")} with the wrong running state (${total.status.slice(0, 3).join("; ")})`);
    if (total.budget.length) bits.push(`${plural(total.budget.length, "campaign")} with the wrong daily budget (${total.budget.slice(0, 3).join("; ")})`);
    if (total.missing.length) bits.push(`${plural(total.missing.length, "campaign")} we show as running that Meta does not list (${total.missing.slice(0, 3).join(", ")})`);
    return row(
      id,
      "FAIL",
      `${bits.join("; ")}. Meta had stopped changing each of these before our row was last saved, so the next sync would not explain it.`,
      `Open the campaign in Meta Ads Manager and in the Campaign Manager (public/app/campaign-manager.html). Read action_log for that campaign and api/campaigns/write.mjs. ` +
        `Make Meta say what you want it to say first, then press Sync Meta now. A campaign we show paused that Meta runs is spending real money. ${TRIP}`
    );
  }
  if (read === 0) {
    return row(id, "skip", `Meta was not compared: ${skips.slice(0, 2).join("; ") || "no connection could be read"}`);
  }
  const behind = total.behind ? `; ${plural(total.behind, "campaign")} changed in Meta since our last sync (the hourly sync takes them)` : "";
  const skipNote = skips.length ? `; ${plural(skips.length, "connection")} could not be read (${skips[0]})` : "";
  return row(
    id,
    "PASS",
    `${plural(total.compared, "campaign")} compared with Meta on ${plural(read, "connection")}: running state and daily budget agree${behind}${skipNote}`
  );
}

async function checkLoadJobs({ run, orgId, now }) {
  const id = CHECK_IDS[1];
  const why = skipWhy({ run, orgId }, "Load-to-Meta jobs");
  if (why) return row(id, "skip", why);
  const iso = (ms) => new Date(now.getTime() - ms).toISOString();
  const got = await readRow(run, id, "Load-to-Meta jobs", LOAD_JOBS_SQL, [
    orgId, iso(FAILED_LOOKBACK_MS), iso(QUEUE_WAIT_MS), iso(RUNNING_WAIT_MS)
  ]);
  if (got.skip) return got.skip;
  const r = got.r;
  const failed = intOf(r.failed_n);
  const queued = intOf(r.queued_n);
  const running = intOf(r.running_n);
  const videoErr = intOf(r.video_error_n);
  if (failed + queued + running + videoErr === 0) {
    const total = intOf(r.total_n);
    return row(
      id,
      "PASS",
      total === 0
        ? "no ad has been sent to Meta by the loader yet, so there is no Load-to-Meta job to judge"
        : `${plural(total, "Load-to-Meta job")} on file, none failed in ${FAILED_LOOKBACK_DAYS} days, none stuck`
    );
  }
  const parts = [];
  if (failed) parts.push(`${plural(failed, "load")} failed for good in the last ${FAILED_LOOKBACK_DAYS} days`);
  if (queued) parts.push(`${plural(queued, "load")} queued past the ${Math.round(QUEUE_WAIT_MS / MIN_MS)} minute wait`);
  if (running) parts.push(`${plural(running, "load")} claimed and silent for over ${Math.round(RUNNING_WAIT_MS / MIN_MS)} minutes`);
  if (videoErr) parts.push(`${plural(videoErr, "approved video")} holding a load error and never loaded`);
  const oldest = r.oldest ? ` The oldest began ${ageOf(r.oldest, now)} ago.` : "";
  const errs = typeof r.errors === "string" && r.errors ? ` Why: ${r.errors}.` : "";
  return row(
    id,
    "FAIL",
    `${parts.join("; ")}.${oldest}${errs}`,
    `Read marketing_jobs (kind meta_load) and ad_videos.load_error, then GET /api/marketing/meta/load-status (src/marketing/meta-load.mjs readLoadStatus). ` +
      `Press Retry on the Launch tab once the reason is fixed. The loader only ever loads an ad PAUSED. ${TRIP}`
  );
}

/**
 * The audit calls this to prove a "nothing to judge" row again. `not-connected` is true only while no active
 * Meta connection with a key and a real account number is saved, by the same read the lane used.
 */
export const naVerify = Object.freeze({
  "not-connected": async (args, ctx = {}) => {
    const run = runnerOf(ctx);
    if (!run || typeof ctx.scope !== "function" || !args || args.check !== CHECK_IDS[0]) return false;
    const out = await run((tx) => tx.query(CONNECTION_COUNT_SQL));
    const r = out && out.rows && out.rows[0];
    return !!r && intOf(r.n) === 0;
  }
});

/**
 * Two read-only checks. ctx: { db, scope, orgId, now, env, fetchImpl }.
 */
export async function gapChecks(ctx = {}) {
  const run = runnerOf(ctx);
  const now = nowOf(ctx);
  const fetchImpl = typeof ctx.fetchImpl === "function" ? ctx.fetchImpl : null;
  const env = ctx.env && typeof ctx.env === "object" ? ctx.env : {};
  let orgId = ctx.orgId || null;
  if (!orgId && run) orgId = await defaultOrg(run);
  const out = [];
  const jobs = [
    [CHECK_IDS[0], () => checkMatches({ run, hasScope: typeof ctx.scope === "function", env, fetchImpl })],
    [CHECK_IDS[1], () => checkLoadJobs({ run, orgId, now })]
  ];
  for (const [id, fn] of jobs) {
    try {
      out.push(await fn());
    } catch (err) {
      out.push(row(id, "skip", `the check could not run: ${String(err && err.message ? err.message : err).slice(0, 160)}`));
    }
  }
  return out;
}
