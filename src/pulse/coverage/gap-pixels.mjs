// Pixel and attribution gaps for the morning pulse.
//
// Audit only. Recon (AG-07) is the tripwire. This file does not start a job,
// a cron, or another watchdog, and it does not auto-fix.
//
// What it will do:
//   - One GET of the funnel page the manifest says must carry the Meta pixel.
//     PASS when that HTML contains the pixel id (META_PIXEL_ID, or the fallback
//     named META_PIXEL_FALLBACK_ID in marketing/landing-pages/tracking-manifest.mjs).
//   - The same HTML is checked for our Clarity script tag. No call to
//     clarity.ms and no Clarity data export.
//   - GET /api/public/slo-interest (UTMs are posted there). GET writes nothing.
//   - GET /api/public/vsl-watch. A 405 means the route is there. No POST, so
//     no fake viewing is filed.
//   - A SELECT for funnel.click rows. No insert, no fake click, no purchase.
//
// Details name env keys only. They never include secret values or the pixel id.

import {
  CLARITY_SRC,
  PUSH_MANIFEST,
  metaPixelId
} from "../../../marketing/landing-pages/tracking-manifest.mjs";

export const APP_BASE = "https://fundhub.ai";
export const UTM_CAPTURE_PATH = "/api/public/slo-interest";
export const VSL_WATCH_PATH = "/api/public/vsl-watch";
export const AD_CLICK_WINDOW_DAYS = 7;

export const CHECK_IDS = Object.freeze([
  "pixel-on-funnel-page",
  "clarity-snippet",
  "utm-capture-route",
  "vsl-watch-route",
  "ad-click-stored"
]);

const RECON =
  "Use the existing Recon tripwire (AG-07). Do not auto-fix from this pulse.";

/** The funnel page whose head the manifest says must include the Meta pixel. */
export function requiredPixelPage(manifest = PUSH_MANIFEST) {
  const row = (manifest || []).find((r) => r && r.strategy === "funnel_head_pixel" && r.liveUrl);
  return row ? String(row.liveUrl) : "";
}

/** True when a manifest row for this page lists our Clarity script. */
export function clarityRequiredOn(pageUrl, manifest = PUSH_MANIFEST) {
  const path = urlPath(pageUrl);
  if (!path) return false;
  return (manifest || []).some((row) => {
    if (!row || !row.liveUrl || !Array.isArray(row.extraFooterScripts)) return false;
    if (!row.extraFooterScripts.includes(CLARITY_SRC)) return false;
    return urlPath(row.liveUrl) === path;
  });
}

export function pageHasPixel(html, pixelId) {
  const id = String(pixelId || "");
  if (!/^\d{6,20}$/.test(id)) return false;
  const hay = String(html ?? "");
  return hay.includes(id) && hay.includes("fbq(");
}

export function pageHasClaritySnippet(html) {
  const hay = String(html ?? "");
  return (
    hay.includes(`src="${CLARITY_SRC}"`) ||
    hay.includes(`src='${CLARITY_SRC}'`) ||
    hay.includes('src="/js/clarity.js"') ||
    hay.includes("src='/js/clarity.js'")
  );
}

export const AD_CLICK_SQL = `
SELECT
  count(*) FILTER (WHERE name = 'funnel.page')::int AS pages,
  count(*) FILTER (WHERE name = 'funnel.click')::int AS clicks
FROM events
WHERE created_at > $1
  AND coalesce(is_demo, false) = false
  AND name IN ('funnel.page', 'funnel.click')`;

function row(id, status, detail, suggestedFix = null) {
  return { id, status, detail, suggestedFix };
}

function clip(s, n = 200) {
  return String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, n);
}

function safeErr(err) {
  const msg = clip((err && err.message) || err || "error");
  if (/postgres:|password|secret|token|api[_-]?key|bearer /i.test(msg)) return "the read failed";
  return msg || "the read failed";
}

function urlPath(raw) {
  try {
    const path = new URL(String(raw)).pathname.replace(/\/+$/, "");
    return path || "/";
  } catch {
    return "";
  }
}

function routeAlive(status) {
  return (
    (status >= 200 && status < 300) ||
    status === 400 ||
    status === 401 ||
    status === 403 ||
    status === 405
  );
}

async function readGet(fetchImpl, url) {
  const res = await fetchImpl(url, {
    method: "GET",
    headers: { accept: "text/html,application/json" }
  });
  const text = typeof res.text === "function" ? await res.text() : "";
  return { status: Number(res.status), text: String(text ?? "") };
}

/**
 * @param {object} [ctx]
 * @param {typeof fetch} [ctx.fetchImpl]
 * @param {typeof fetch} [ctx.fetch]
 * @param {Record<string, string | undefined>} [ctx.env]
 * @param {string} [ctx.appBase]
 * @param {{ query: Function }} [ctx.db]
 * @param {string} [ctx.orgId]
 * @param {Date} [ctx.now]
 * @returns {Promise<Array<{ id: string, status: "PASS" | "FAIL" | "skip", detail: string, suggestedFix: string | null }>>}
 */
export async function gapChecks(ctx = {}) {
  const fetchImpl = ctx.fetchImpl || ctx.fetch || globalThis.fetch;
  const env = ctx.env || process.env;
  const appBase = String(ctx.appBase || APP_BASE).replace(/\/+$/, "");
  const manifest = ctx.manifest || PUSH_MANIFEST;
  const pageUrl = requiredPixelPage(manifest);
  const resolved = metaPixelId(env);

  let page = null;
  let pageError = "";
  if (typeof fetchImpl !== "function") {
    pageError = "no fetch was passed";
  } else if (!pageUrl) {
    pageError = "the manifest names no funnel page that must carry the pixel";
  } else {
    try {
      page = await readGet(fetchImpl, pageUrl);
    } catch (err) {
      pageError = safeErr(err);
    }
  }

  const pixel = assessPixel({ pageUrl, page, pageError, pixelId: resolved.id, source: resolved.envName });
  const clarity = assessClarity({ pageUrl, page, pageError, manifest });
  const utm = await assessRoute({
    id: "utm-capture-route",
    fetchImpl,
    url: `${appBase}${UTM_CAPTURE_PATH}`,
    dead: "UTM capture route is dead (GET /api/public/slo-interest).",
    alive: "GET /api/public/slo-interest is up. UTMs post there. This check did not POST.",
    fix: `Restore GET /api/public/slo-interest. fh-attribution.js posts UTMs there. Do not POST a lead from this check. ${RECON}`
  });
  const vsl = await assessRoute({
    id: "vsl-watch-route",
    fetchImpl,
    url: `${appBase}${VSL_WATCH_PATH}`,
    dead: "vsl-watch beacon route is dead (GET /api/public/vsl-watch).",
    alive: "GET /api/public/vsl-watch is up. A 405 means the route is there. This check did not POST a viewing.",
    fix: `Restore /api/public/vsl-watch. A GET that answers 405 means it is alive. Do not POST a viewing from this check. ${RECON}`
  });
  const clicks = await assessAdClicks(ctx);
  return redactRows([pixel, clarity, utm, vsl, clicks], hiddenValues(env, resolved.id));
}

function hiddenValues(env, pixelId) {
  const hidden = [];
  const id = String(pixelId || "").trim();
  if (id) hidden.push(id);
  const bag = env && typeof env === "object" ? env : {};
  for (const [key, value] of Object.entries(bag)) {
    if (!/TOKEN|SECRET|KEY|PIXEL|CLARITY|PASSWORD/i.test(key)) continue;
    const s = String(value ?? "").trim();
    if (s.length >= 6) hidden.push(s);
  }
  return hidden;
}

function redactRows(rows, hidden) {
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    detail: redact(r.detail, hidden),
    suggestedFix: r.suggestedFix == null ? null : redact(r.suggestedFix, hidden)
  }));
}

function redact(text, hidden) {
  let out = String(text ?? "");
  for (const secret of hidden) {
    if (secret) out = out.split(secret).join("[set]");
  }
  return out;
}

function assessPixel({ pageUrl, page, pageError, pixelId, source }) {
  const id = "pixel-on-funnel-page";
  const fix =
    `Put the Meta pixel back on the funnel page the manifest names (${pageUrl || "funnel_head_pixel"}). ` +
    `The id comes from META_PIXEL_ID, or META_PIXEL_FALLBACK_ID in tracking-manifest.mjs. ${RECON}`;
  if (pageError) return row(id, "FAIL", clip(pageError), fix);
  if (!page || page.status < 200 || page.status >= 300) {
    return row(id, "FAIL", clip(`${pageUrl} answered ${page ? page.status : "nothing"}`), fix);
  }
  if (!pageHasPixel(page.text, pixelId)) {
    return row(id, "FAIL", clip(`${pageUrl} loaded, and the pixel id (${source}) is not in the HTML`), fix);
  }
  return row(id, "PASS", clip(`${pageUrl} HTML includes the pixel id (${source})`));
}

function assessClarity({ pageUrl, page, pageError, manifest }) {
  const id = "clarity-snippet";
  const fix =
    "Put the Clarity script (fundhub.ai/js/clarity.js) back on that page. " +
    `Env name CLARITY_PROJECT_ID. Do not call the Clarity export. ${RECON}`;
  if (!clarityRequiredOn(pageUrl, manifest)) {
    return row(id, "skip", "The manifest does not put the Clarity script on this page");
  }
  if (pageError) return row(id, "FAIL", clip(pageError), fix);
  if (!page || page.status < 200 || page.status >= 300) {
    return row(id, "FAIL", clip(`${pageUrl} answered ${page ? page.status : "nothing"}`), fix);
  }
  if (!pageHasClaritySnippet(page.text)) {
    return row(
      id,
      "FAIL",
      clip(`${pageUrl} loaded, and the Clarity script tag is missing. Env name CLARITY_PROJECT_ID.`),
      fix
    );
  }
  return row(
    id,
    "PASS",
    clip(`${pageUrl} HTML includes the Clarity script. Env name CLARITY_PROJECT_ID. Clarity export was not called.`)
  );
}

async function assessRoute({ id, fetchImpl, url, dead, alive, fix }) {
  if (typeof fetchImpl !== "function") return row(id, "FAIL", "no fetch was passed", fix);
  try {
    const res = await readGet(fetchImpl, url);
    if (res.status === 404 || res.status === 410) return row(id, "FAIL", clip(`${dead} Status ${res.status}.`), fix);
    if (!routeAlive(res.status)) return row(id, "FAIL", clip(`${url} answered ${res.status}.`), fix);
    const note = res.status === 405 ? " Status 405." : ` Status ${res.status}.`;
    return row(id, "PASS", clip(alive + note));
  } catch (err) {
    return row(id, "FAIL", clip(`${dead} ${safeErr(err)}`), fix);
  }
}

async function assessAdClicks(ctx) {
  const id = "ad-click-stored";
  const fix =
    "Clicks are saved as events named funnel.click by POST /api/public/slo-interest. " +
    `Pages were saved and no click was. Do not send a fake click or a fake purchase. ${RECON}`;
  const db = ctx.db;
  if (!db || typeof db.query !== "function") {
    return row(id, "skip", "no database in this run — ad clicks not read");
  }
  const now = ctx.now instanceof Date ? ctx.now : new Date();
  const since = new Date(now.getTime() - AD_CLICK_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const orgId = ctx.orgId ? String(ctx.orgId) : "";
  const text = orgId ? `${AD_CLICK_SQL} AND org_id = $2` : AD_CLICK_SQL;
  const params = orgId ? [since, orgId] : [since];
  let rows;
  try {
    const out = await db.query(text, params);
    rows = out && out.rows;
  } catch (err) {
    return row(id, "FAIL", clip(`could not read stored ad clicks: ${safeErr(err)}`), fix);
  }
  const rec = (rows && rows[0]) || {};
  const pages = Number(rec.pages) || 0;
  const clicks = Number(rec.clicks) || 0;
  if (pages === 0 && clicks === 0) {
    return row(
      id,
      "skip",
      `no funnel page views in ${AD_CLICK_WINDOW_DAYS} days, so there was no ad click to store`
    );
  }
  if (clicks === 0) {
    return row(
      id,
      "FAIL",
      clip(`${pages} funnel page views in ${AD_CLICK_WINDOW_DAYS} days and no funnel.click row stored`),
      fix
    );
  }
  const noun = clicks === 1 ? "ad click" : "ad clicks";
  return row(id, "PASS", clip(`${clicks} ${noun} stored in ${AD_CLICK_WINDOW_DAYS} days (${pages} page views)`));
}
