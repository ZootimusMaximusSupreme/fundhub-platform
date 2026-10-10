// Built funnels that are live, for the morning pulse. Read only. Report only.
//
// A funnel the dashboard built (marketing_funnels.kind is set) goes live when
// the push-live job proves its three pages on apply.fundhub.ai (X4F, 2026-10-06).
// From that moment it is on every affiliate's link list (LIVE_OFFERS_SQL in
// src/affiliates/share-link.mjs) and it can take ad traffic. The push proves the
// pages ONCE, on the day it goes live. Nothing else looked at them again.
//
// This lane looks again, every morning. For each live built funnel it reads the
// funnel's pages from marketing_funnel_pages and does one cache-busted GET of each
// page's live_url. A funnel is wrong when:
//   * it has fewer than its three pages on file (landing, booking, thank_you), or
//   * a page has no live address, or
//   * a page answers anything but 200, or cannot be reached, or
//   * a page answers 200 without its funnel tag (the <meta name="fh-funnel-tag">
//     the database trigger in migration 425 makes every saved page carry). A 200
//     with no tag is a blank page, an error page, or another funnel's page.
//
// Why a new lane and not gap-funnels. gap-funnels.mjs and slice-05-funnels.mjs only
// read pages written into the code (GAP_DOORS). A funnel made in the dashboard is a
// row in the database, so no code names it. gap-marketing-queue only sees a job that
// failed. Neither can see a live page that has gone dead weeks later (ClickFunnels
// unlinks a step, someone archives the funnel).
//
// READ ONLY. Every read is a SELECT. Every web call is a GET. No text, no email, no
// AI call, no ClickFunnels API call (the pages are read the way a buyer reads them,
// on apply.fundhub.ai, with no key). The pulse only reports. It never fixes.
//
// NO REPO FILE IS READ AT RUN TIME. Everything comes from the database and the web.
//
// "NOTHING TO JUDGE" (owner law 2026-10-09: a live thing is never "not checked").
// With no live built funnel there is no page to judge. The lane then returns status
// "na" with na: { code: "low-traffic", args } (too few live built funnels to judge,
// judged the day one goes live). naVerify["low-traffic"] re-reads with the SAME SQL
// and the SAME minimum (MIN_LIVE_FUNNELS) on every audit, so the claim cannot rot.
// A zero from a table that reads as EMPTY is a blind read, not "none live", so it
// stays a skip (see SEEN_SQL).

import { tagMeta } from "../../marketing/funnel-tracking.mjs";
import { FUNNEL_ROLES } from "../../marketing/funnel-paths.mjs";

export const CHECK_IDS = Object.freeze(["built-funnels:live-pages-answer"]);
const ID = CHECK_IDS[0];

/** Fewer live built funnels than this and there is nothing to judge. The audit uses the same number. */
export const MIN_LIVE_FUNNELS = 1;

/** One web call may wait this long. Netlify cuts the whole step at 26 seconds. */
export const TIMEOUT_MS = 8000;
/** Whole lane budget for the web reads. A page still waiting then is not read, and the row says so. */
export const DEADLINE_MS = 15000;
/** Pages read in one run. More than this and the rest are named as not read, never passed. */
export const MAX_PAGES = 60;

/** The cache-busting query the push proof uses (clickfunnels-pages.mjs fetchLivePage). */
export const CACHE_BUST_PARAM = "fh_cb";

/** Live built funnels with their pages. One row per page; a funnel with no page row is one row with a null role. */
export const LIVE_SQL = `
  /* gap:built-funnels-live */
  SELECT f.id::text AS funnel_id, f.key, f.tag,
         p.role, p.path AS page_path, p.live_url
    FROM marketing_funnels f
    LEFT JOIN marketing_funnel_pages p
           ON p.funnel_id = f.id AND p.org_id = f.org_id
   WHERE f.kind IS NOT NULL
     AND f.status = 'live'
     AND ($1::uuid IS NULL OR f.org_id = $1::uuid)
   ORDER BY f.key, p.position
`;

/** Every funnel row the read can see. Zero here means the read is blind, not that none is live. */
export const SEEN_SQL = `
  /* gap:built-funnels-seen */
  SELECT count(*)::int AS n
    FROM marketing_funnels
   WHERE ($1::uuid IS NULL OR org_id = $1::uuid)
`;

const FIX =
  "Open the page the detail names. Read the ClickFunnels funnel made for it by API (its name carries the " +
  "funnel tag): the funnel's domain must be apply.fundhub.ai and its three steps must be landing, booking, " +
  "thank-you. An agent fixes it by API; Chris never logs in. The pulse only reports. Do not auto-fix.";

function row(status, detail, suggestedFix = null) {
  return { id: ID, status, detail, suggestedFix };
}

/** "Nothing to judge today": status na plus the code the audit re-checks. */
function naRow(orgId) {
  const args = { check: ID, what: "live built funnels", count: 0, min: MIN_LIVE_FUNNELS };
  if (orgId) args.orgId = String(orgId);
  return {
    id: ID,
    status: "na",
    detail: "No funnel built in the dashboard is live yet, so there is no live page to judge. Judged the day one goes live.",
    suggestedFix: null,
    na: { code: "low-traffic", args }
  };
}

function clip(err, n = 160) {
  return String((err && err.message) || err).replace(/\s+/g, " ").trim().slice(0, n);
}

/** The staff scope when the pulse passes one, else the plain handle (tests, a laptop). */
function bind(ctx) {
  if (ctx && typeof ctx.scope === "function") return (fn) => ctx.scope(fn);
  if (ctx && ctx.db && typeof ctx.db.query === "function") return (fn) => fn(ctx.db);
  return null;
}

async function rowsOf(run, sql, params) {
  const out = await run((tx) => tx.query(sql, params));
  return (out && Array.isArray(out.rows) && out.rows) || [];
}

function distinctFunnels(rows) {
  return new Set(rows.map((r) => String(r.funnel_id)));
}

/**
 * The audit calls this to prove a "nothing to judge" row again. It reads with the
 * same SQL (LIVE_SQL, SEEN_SQL) and the same minimum (MIN_LIVE_FUNNELS) the lane
 * used, and answers true only when the table reads as non-empty AND the live built
 * funnels are fewer than the minimum. No database, a count that is not a number, or
 * a row about another check is false. A read that throws is left to throw: the
 * audit counts a throw as false.
 * @param {{ check?: string, orgId?: string }} args
 * @param {{ db?: any, scope?: Function, orgId?: string }} ctx
 */
export const naVerify = Object.freeze({
  "low-traffic": async (args, ctx = {}) => {
    if (!args || args.check !== ID) return false;
    const run = bind(ctx);
    if (!run) return false;
    const orgId = args.orgId || ctx.orgId || null;
    const seen = await rowsOf(run, SEEN_SQL, [orgId]);
    const n = Number(seen[0] && seen[0].n);
    if (!Number.isFinite(n) || n <= 0) return false;
    const live = await rowsOf(run, LIVE_SQL, [orgId]);
    return distinctFunnels(live).size < MIN_LIVE_FUNNELS;
  }
});

/** The address with a cache-busting query on it. Null when it is not an https address. */
export function bustedUrl(liveUrl, now) {
  let u;
  try {
    u = new URL(String(liveUrl));
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  u.searchParams.set(CACHE_BUST_PARAM, String(now.getTime()));
  return u.toString();
}

/** One page, one GET. Never throws. Answers { ok, why }. */
async function readPage(fetchImpl, page, now) {
  const url = bustedUrl(page.live_url, now);
  if (!url) return { ok: false, why: `${page.live_url} is not an https address` };
  const init = {
    method: "GET",
    redirect: "follow",
    headers: { accept: "text/html", "cache-control": "no-cache", pragma: "no-cache" }
  };
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    init.signal = AbortSignal.timeout(TIMEOUT_MS);
  }
  let res;
  let text = "";
  try {
    res = await fetchImpl(url, init);
    text = typeof res.text === "function" ? String((await res.text()) || "") : "";
  } catch (err) {
    return { ok: false, why: `${page.live_url} could not be reached (${clip(err, 80)})` };
  }
  const status = Number(res && res.status);
  if (status !== 200) return { ok: false, why: `${page.live_url} answered ${Number.isFinite(status) ? status : "no status"}` };
  if (!text.includes(tagMeta(page.tag))) {
    return { ok: false, why: `${page.live_url} answered 200 but does not carry the funnel tag ${page.tag}` };
  }
  return { ok: true, why: "" };
}

/** What is wrong with the rows themselves, before any page is read. */
function problemsOnFile(funnelRows) {
  const byFunnel = new Map();
  for (const r of funnelRows) {
    const id = String(r.funnel_id);
    if (!byFunnel.has(id)) byFunnel.set(id, { key: r.key, tag: r.tag, pages: [] });
    if (r.role) byFunnel.get(id).pages.push(r);
  }
  const problems = [];
  const toRead = [];
  for (const f of byFunnel.values()) {
    const have = new Set(f.pages.map((p) => p.role));
    const missing = FUNNEL_ROLES.filter((role) => !have.has(role));
    if (missing.length) {
      problems.push(`${f.key} is live but has no ${missing.join(" or ")} page on file`);
    }
    for (const p of f.pages) {
      if (!p.live_url) {
        problems.push(`${f.key} ${p.role} page (${p.page_path}) has no live address`);
      } else {
        toRead.push({ key: f.key, tag: f.tag, role: p.role, live_url: p.live_url });
      }
    }
  }
  return { problems, toRead, funnels: byFunnel.size };
}

function plural(n, one, many) {
  return n === 1 ? one : many;
}

function listProblems(items, max = 4) {
  const shown = items.slice(0, max).join("; ");
  return items.length > max ? `${shown}; and ${items.length - max} more` : shown;
}

/**
 * One read-only check. ctx: { db, scope, orgId, now, fetchImpl | fetch, deadlineMs }.
 * The row is { id, status, detail, suggestedFix } with status PASS, FAIL, skip, or
 * na (nothing to judge: the row then also carries na: { code, args }).
 */
export async function gapChecks(ctx = {}) {
  const run = bind(ctx);
  if (!run) return [row("skip", "no database in this run — live built funnels were not read")];
  const orgId = ctx.orgId || null;
  const now = ctx.now instanceof Date ? ctx.now : new Date();

  let live;
  try {
    live = await rowsOf(run, LIVE_SQL, [orgId]);
  } catch (err) {
    return [row("skip", `could not read the live built funnels: ${clip(err)}`)];
  }

  if (live.length === 0) {
    let seen;
    try {
      seen = await rowsOf(run, SEEN_SQL, [orgId]);
    } catch (err) {
      return [row("skip", `could not read the funnel table to see if any built funnel is live: ${clip(err)}`)];
    }
    const n = Number(seen[0] && seen[0].n);
    if (!Number.isFinite(n)) return [row("skip", "the funnel count was not a number, so no live built funnel could be ruled out")];
    // A table that reads as empty is a blind read (no rows visible to this role), not "none live".
    if (n <= 0) {
      return [row("skip", "no funnel row was visible at all, so this read cannot say that none is live")];
    }
    return [naRow(orgId)];
  }

  const { problems, toRead, funnels } = problemsOnFile(live);
  const fetchImpl = Object.hasOwn(ctx, "fetchImpl") && ctx.fetchImpl !== undefined
    ? ctx.fetchImpl
    : (ctx.fetch ?? globalThis.fetch);
  const wanted = toRead.slice(0, MAX_PAGES);
  const notRead = toRead.length - wanted.length;
  const results = new Array(wanted.length).fill(null);
  let late = 0;

  if (wanted.length && typeof fetchImpl === "function") {
    const deadline = Number.isFinite(ctx.deadlineMs) ? ctx.deadlineMs : DEADLINE_MS;
    let timer;
    const timedOut = new Promise((resolve) => {
      timer = setTimeout(resolve, deadline);
    });
    try {
      await Promise.race([
        Promise.all(wanted.map((page, i) =>
          readPage(fetchImpl, page, now).then((r) => { results[i] = r; })
        )),
        timedOut
      ]);
    } finally {
      clearTimeout(timer);
    }
    late = results.filter((r) => r === null).length;
  } else if (wanted.length) {
    late = wanted.length;
  }

  const wrong = results.filter((r) => r && !r.ok).map((r) => r.why);
  const all = [...problems, ...wrong];
  const total = toRead.length;
  const noun = plural(funnels, "live built funnel", "live built funnels");

  if (all.length) {
    return [
      row(
        "FAIL",
        `${all.length} ${plural(all.length, "problem", "problems")} on ${funnels} ${noun}: ${listProblems(all)}`,
        FIX
      )
    ];
  }
  const unread = late + notRead;
  if (unread > 0) {
    const why = typeof fetchImpl === "function"
      ? `${late} ${plural(late, "page", "pages")} did not answer in time${notRead ? ` and ${notRead} were over the ${MAX_PAGES} page limit` : ""}`
      : "no fetch in this run";
    return [row("skip", `${funnels} ${noun}, ${total} pages: ${why}, so they were not all read`)];
  }
  return [
    row(
      "PASS",
      `${funnels} ${noun}, ${total} ${plural(total, "page", "pages")}: each answered 200 and carries its funnel tag`
    )
  ];
}
