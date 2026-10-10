// Partner pages that are published and do not open. Report only.
//
// One question a partner's visitor would feel: "I clicked the partner's link
// and got a 'nothing is live' page."
//
//   partner-pages:live   every partner_pages row with status 'published' answers
//                        200 at /sites/<partnerId>/<slug>
//
// Brand Studio publishes a draft by setting status to 'published'
// (api/partner-pages.mjs). The page is then served by
// netlify/functions/partner-site.mjs, which answers a miss with a 404 "Nothing is
// live at this web address" page and a hit with a 200. Nothing read a published
// page after the publish click (measured 2026-10-10: gap-built-funnels.mjs reads
// built funnels, not partner pages), so a page that was published and then lost
// its brand row, its function route or its slug would be dead with no alarm.
//
// GET only, one request per page, all at once, each with its own timeout, so the
// whole lane stays far under 20 seconds. At most PAGE_CAP pages are read in one
// morning; with more than that the lane reads a different slice each day and the
// detail says how many it read. Nothing is written. No repo file is read.
//
// Custom domains are not read (a verified domain serves the same pages by host).

export const PAGE_CAP = 60;
export const PAGE_TIMEOUT_MS = 8000;
export const DEFAULT_BASE_URL = "https://fundhub.ai";
/** The words on the miss page (netlify/functions/partner-site.mjs NOT_LIVE_HTML). */
export const NOT_LIVE_MARK = "Nothing is live at this web address";

export const CHECK_IDS = Object.freeze(["partner-pages:live"]);

export const PUBLISHED_SQL = `
  /* gap:partner-pages-published */
  SELECT pp.id::text AS id, pp.partner_id::text AS partner_id, pp.slug
    FROM partner_pages pp
   WHERE pp.status = 'published'
     AND ($1::uuid IS NULL OR pp.org_id = $1::uuid)
   ORDER BY pp.published_at NULLS LAST, pp.id
   LIMIT 500`;

const ID = "partner-pages:live";
const DAY_MS = 24 * 60 * 60 * 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

function check(status, detail, suggestedFix = null) {
  return { id: ID, status, detail, suggestedFix };
}

function reader(ctx) {
  if (ctx && typeof ctx.scope === "function") return ctx.scope;
  const db = ctx && ctx.db;
  if (db && typeof db.query === "function") return (fn) => fn(db);
  return null;
}

function clip(s, n = 120) {
  return String(s == null ? "" : (s && s.message) || s).replace(/\s+/g, " ").trim().slice(0, n);
}

/** Which pages to read today: all of them, or a rotating slice of PAGE_CAP. */
export function pickPages(rows, now, cap = PAGE_CAP) {
  if (rows.length <= cap) return rows.slice();
  const day = Math.floor(now.getTime() / DAY_MS);
  const start = (day * cap) % rows.length;
  const out = [];
  for (let i = 0; i < cap; i += 1) out.push(rows[(start + i) % rows.length]);
  return out;
}

/** One page. { ok, why }. A 200 that is the miss page is not live. */
export async function readPage(fetchImpl, origin, row, timeoutMs = PAGE_TIMEOUT_MS) {
  const url = `${origin}/sites/${row.partner_id}/${row.slug}`;
  try {
    const init = { method: "GET", headers: { accept: "text/html" } };
    if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
      init.signal = AbortSignal.timeout(timeoutMs);
    }
    const res = await fetchImpl(url, init);
    const status = res && res.status;
    if (status !== 200) return { ok: false, why: `answered ${status}` };
    let body = "";
    try {
      body = res && typeof res.text === "function" ? String(await res.text()) : "";
    } catch {
      body = "";
    }
    if (body.includes(NOT_LIVE_MARK)) return { ok: false, why: "answered 200 with the not-live page" };
    return { ok: true, why: "" };
  } catch (err) {
    return { ok: false, why: `did not answer (${clip(err, 60)})` };
  }
}

/**
 * gapChecks(ctx) → [{ id, status, detail, suggestedFix }]
 * ctx: { db } or { scope }, { fetchImpl | fetch }, optional { now, orgId, baseUrl }.
 */
export async function gapChecks(ctx = {}) {
  const run = reader(ctx);
  if (!run) return [check("skip", "No database in this run, so the published partner pages were not listed.")];
  const fetchImpl = typeof ctx.fetchImpl === "function" ? ctx.fetchImpl : (typeof ctx.fetch === "function" ? ctx.fetch : null);
  if (!fetchImpl) return [check("skip", "No web client came with this run, so no partner page was opened.")];

  const now = ctx.now instanceof Date && Number.isFinite(ctx.now.getTime()) ? ctx.now : new Date();
  let rows;
  try {
    const res = await run((db) => db.query(PUBLISHED_SQL, [ctx.orgId || null]));
    rows = res && Array.isArray(res.rows) ? res.rows : null;
  } catch (err) {
    return [check("skip", `The published partner pages could not be listed: ${clip(err)}.`)];
  }
  if (!rows) return [check("skip", "The published partner pages came back as no list, so none was opened.")];

  // A row that could not make a real address is its own failure: the page cannot be live.
  const bad = rows.filter((r) => !UUID_RE.test(String(r.partner_id)) || !SLUG_RE.test(String(r.slug)));
  const good = rows.filter((r) => !bad.includes(r));
  if (!rows.length) return [check("PASS", "No partner page is published, so none can be dead.")];

  const origin = String(ctx.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const picked = pickPages(good, now);
  const results = await Promise.all(picked.map((row) => readPage(fetchImpl, origin, row)));

  const failures = [];
  for (const r of bad) failures.push(`${String(r.partner_id).slice(0, 8)}/${clip(r.slug, 30)} has a slug or partner id that cannot be a web address`);
  results.forEach((r, i) => {
    if (!r.ok) failures.push(`${String(picked[i].partner_id).slice(0, 8)}…/${picked[i].slug} ${r.why}`);
  });

  const total = rows.length;
  const readN = picked.length;
  const slice = good.length > readN ? ` (a rotating ${readN} of ${good.length} today)` : "";
  if (!failures.length) {
    return [check("PASS", `All ${readN} published partner ${readN === 1 ? "page answers" : "pages answer"} 200 at /sites/<partner>/<slug>${slice}.`)];
  }
  const shown = failures.slice(0, 5).join("; ");
  const more = failures.length > 5 ? `; and ${failures.length - 5} more` : "";
  return [check(
    "FAIL",
    `${failures.length} published partner ${failures.length === 1 ? "page is" : "pages are"} not live (of ${total} published${slice}): ${shown}${more}.`,
    "Open Brand Studio for that partner and press Publish again, or read the partner-site function log. " +
      "A published row that answers 404 means the page, the brand row or the route is missing. Do not auto-fix. Chris fixes reds."
  )];
}
