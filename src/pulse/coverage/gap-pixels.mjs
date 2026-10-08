// Pixel and attribution gaps for the morning pulse.
//
// Audit only. Recon (AG-07) is the tripwire. This file does not start a job,
// a cron, or another watchdog, and it does not auto-fix.
//
// What it will do:
//   - GET the funnel page the manifest says must carry the Meta pixel, and the
//     custom pages that carry their own copy (the manifest names them). PASS when
//     the HTML starts the pixel with our id (META_PIXEL_ID, or the fallback named
//     META_PIXEL_FALLBACK_ID in marketing/landing-pages/tracking-manifest.mjs).
//   - The /watch HTML is checked for our Clarity script tag, and the script itself
//     is read to be sure it still carries a project id (blank id = records nothing).
//     No call to clarity.ms and no Clarity data export.
//   - GET the three tracking scripts the pages load (attribution, events, vsl
//     beacon) and check the pages still load them.
//   - GET /api/public/slo-interest (UTMs are posted there). GET writes nothing.
//   - GET /api/public/vsl-watch. A 405 means the route is there. No POST, so
//     no fake viewing is filed.
//   - SELECTs only. Ad clicks: what Meta says it sent (ad_metrics_daily link
//     clicks) against the visits we stored with a UTM or fbclid. Funnel clicks:
//     page views stored with no button click stored. No insert, no fake click,
//     no purchase.
//
// Details name env keys only. They never include secret values or the pixel id.

import {
  CLARITY_SRC,
  FH_ATTRIBUTION_SRC,
  FH_EVENTS_SRC,
  PUSH_MANIFEST,
  VSL_WATCH_BEACON_SRC,
  hasScriptSrc,
  metaPixelId
} from "../../../marketing/landing-pages/tracking-manifest.mjs";
import { AD_ACCOUNT_TZ, adAccountDay } from "../../lib/ad-account-day.mjs";

export const APP_BASE = "https://fundhub.ai";
export const UTM_CAPTURE_PATH = "/api/public/slo-interest";
export const VSL_WATCH_PATH = "/api/public/vsl-watch";
export const AD_CLICK_WINDOW_DAYS = 7;

/** Meta link clicks needed in the window before "we stored none" means anything. */
export const MIN_META_CLICKS = 20;
/** Stored ad visits below this share of Meta's clicks is a broken capture. Live 2026-10: 27% to 190%. */
export const MIN_STORE_SHARE = 0.1;
/** Page views needed before "no button click stored" means anything. */
export const MIN_FUNNEL_PAGES = 25;
const FETCH_TIMEOUT_MS = 10000;

export const CHECK_IDS = Object.freeze([
  "pixel-on-funnel-page",
  "pixel-on-own-pages",
  "clarity-snippet",
  "tracking-scripts-live",
  "utm-capture-route",
  "vsl-watch-route",
  "ad-click-stored",
  "funnel-click-stored"
]);

const RECON =
  "Use the existing Recon tripwire (AG-07). Do not auto-fix from this pulse.";

/** Pages whose HTML the manifest writes whole, so each carries its own pixel copy. */
const OWN_PIXEL_STRATEGIES = new Set(["custom_html_put", "apply_survey_replace"]);

/** What each tracking script must still say, so an empty or swapped file fails. */
const SCRIPTS = Object.freeze([
  { src: FH_ATTRIBUTION_SRC, name: "fh-attribution.js", marker: "fh_attribution" },
  { src: FH_EVENTS_SRC, name: "fh-events.js", marker: UTM_CAPTURE_PATH },
  { src: VSL_WATCH_BEACON_SRC, name: "vsl-watch-beacon.js", marker: VSL_WATCH_PATH }
]);

/** The funnel page whose head the manifest says must include the Meta pixel. */
export function requiredPixelPage(manifest = PUSH_MANIFEST) {
  const row = (manifest || []).find((r) => r && r.strategy === "funnel_head_pixel" && r.liveUrl);
  return row ? String(row.liveUrl) : "";
}

/** Live URLs of the pages that carry their own pixel copy (custom HTML). */
export function ownPixelPages(manifest = PUSH_MANIFEST) {
  const urls = (manifest || [])
    .filter((r) => r && r.liveUrl && OWN_PIXEL_STRATEGIES.has(r.strategy))
    .map((r) => String(r.liveUrl));
  return [...new Set(urls)];
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

/** Scripts the page must load, from every manifest row for that page. */
export function scriptsRequiredOn(pageUrl, manifest = PUSH_MANIFEST) {
  const path = urlPath(pageUrl);
  const rows = (manifest || []).filter((r) => r && r.liveUrl && urlPath(r.liveUrl) === path);
  const need = new Set(rows.length ? [FH_ATTRIBUTION_SRC] : []);
  for (const r of rows) {
    if (r.vslBeacon) need.add(VSL_WATCH_BEACON_SRC);
    if (Array.isArray(r.extraFooterScripts) && r.extraFooterScripts.includes(FH_EVENTS_SRC)) {
      need.add(FH_EVENTS_SRC);
    }
  }
  return [...need];
}

/** The page starts the Meta pixel with this id. A bare mention of the id is not enough. */
export function pageHasPixel(html, pixelId) {
  const id = String(pixelId || "");
  if (!/^\d{6,20}$/.test(id)) return false;
  return new RegExp(`fbq\\(\\s*['"]init['"]\\s*,\\s*['"]${id}['"]`).test(String(html ?? ""));
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

/** clarity.js is a no-op while its project id is blank: the tag loads and nothing records. */
export function clarityScriptHasProjectId(js) {
  return /var\s+CLARITY_PROJECT_ID\s*=\s*["'][A-Za-z0-9]{6,}["']/.test(String(js ?? ""));
}

// $1 and $2 are the first and last closed Arizona day, $3 is the company or NULL.
// Meta's number of link clicks against the visits we stored from a Meta ad. A visit
// is from a Meta ad when it carries an fbclid or a Meta utm_source (live ads send
// "fb_ad"); the e2e and diag runs use other sources and do not count. slo.visit has
// no session id and funnel.page does, so the two are counted apart and the larger
// one wins. Adding them would count one person twice.
// ad_metrics_daily is a row-security table: it reads empty on the plain app role,
// so this runs on the staff scope.
const AD_VISIT_WHERE = `
              AND coalesce(e.is_demo, false) = false
              AND e.created_at >= ($1::date)::timestamp AT TIME ZONE '${AD_ACCOUNT_TZ}'
              AND e.created_at < (($2::date) + 1)::timestamp AT TIME ZONE '${AD_ACCOUNT_TZ}'
              AND ($3::uuid IS NULL OR e.org_id = $3::uuid)
              AND (e.payload->'attribution'->>'fbclid' IS NOT NULL
                OR e.payload->'attribution'->>'utm_source' ~* '^(fb|ig|facebook|instagram|meta)')`;

export const AD_CLICK_SQL = `
  SELECT (SELECT coalesce(sum(coalesce(m.link_clicks, m.clicks)), 0)::int
            FROM ad_metrics_daily m
           WHERE m.date >= $1::date
             AND m.date <= $2::date
             AND ($3::uuid IS NULL OR m.org_id = $3::uuid)) AS meta_clicks,
         GREATEST(
           (SELECT count(*)::int
              FROM events e
             WHERE e.name = 'slo.visit' ${AD_VISIT_WHERE}),
           (SELECT count(DISTINCT e.payload->>'session_id')::int
              FROM events e
             WHERE e.name = 'funnel.page' ${AD_VISIT_WHERE})
         ) AS stored`;

// $1 is the start of the window, $2 is the company or NULL. Button clicks the
// funnel tracker (fh-events.js) saves, against the page views it saves.
export const FUNNEL_CLICK_SQL = `
  SELECT count(*) FILTER (WHERE name = 'funnel.page')::int AS pages,
         count(*) FILTER (WHERE name = 'funnel.click')::int AS clicks
    FROM events
   WHERE created_at > $1
     AND coalesce(is_demo, false) = false
     AND name IN ('funnel.page', 'funnel.click')
     AND ($2::uuid IS NULL OR org_id = $2::uuid)`;

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
  const init = { method: "GET", headers: { accept: "text/html,application/json" } };
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    init.signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  }
  const res = await fetchImpl(url, init);
  const text = typeof res.text === "function" ? await res.text() : "";
  return { status: Number(res.status), text: String(text ?? "") };
}

/** One GET that never throws: { status, text } or { error }. */
async function tryGet(fetchImpl, url) {
  if (typeof fetchImpl !== "function") return { error: "no fetch in this run" };
  try {
    return await readGet(fetchImpl, url);
  } catch (err) {
    return { error: safeErr(err) };
  }
}

function runnerOf(ctx) {
  if (typeof ctx.scope === "function") return (fn) => ctx.scope(fn);
  if (ctx.db && typeof ctx.db.query === "function") return (fn) => fn(ctx.db);
  return null;
}

/**
 * @param {object} [ctx]
 * @param {typeof fetch} [ctx.fetchImpl]
 * @param {typeof fetch} [ctx.fetch]
 * @param {Record<string, string | undefined>} [ctx.env]
 * @param {string} [ctx.appBase] app origin; the pulse passes it as ctx.baseUrl
 * @param {{ query: Function }} [ctx.db]
 * @param {(fn: (tx: any) => Promise<any>) => Promise<any>} [ctx.scope] staff scope
 * @param {string} [ctx.orgId]
 * @param {Date} [ctx.now]
 * @returns {Promise<Array<{ id: string, status: "PASS" | "FAIL" | "skip", detail: string, suggestedFix: string | null }>>}
 */
export async function gapChecks(ctx = {}) {
  const fetchImpl = ctx.fetchImpl || ctx.fetch || globalThis.fetch;
  const env = ctx.env || process.env;
  const appBase = String(ctx.appBase || ctx.baseUrl || APP_BASE).replace(/\/+$/, "");
  const manifest = ctx.manifest || PUSH_MANIFEST;
  const pageUrl = requiredPixelPage(manifest);
  const ownUrls = ownPixelPages(manifest).filter((u) => u !== pageUrl);
  const resolved = metaPixelId(env);

  const [page, owns, clarityJs, scripts, utmGet, vslGet] = await Promise.all([
    pageUrl
      ? tryGet(fetchImpl, pageUrl)
      : { error: "the manifest names no funnel page that must carry the pixel" },
    Promise.all(ownUrls.map(async (url) => ({ url, got: await tryGet(fetchImpl, url) }))),
    tryGet(fetchImpl, CLARITY_SRC),
    Promise.all(SCRIPTS.map(async (s) => ({ ...s, got: await tryGet(fetchImpl, s.src) }))),
    tryGet(fetchImpl, `${appBase}${UTM_CAPTURE_PATH}`),
    tryGet(fetchImpl, `${appBase}${VSL_WATCH_PATH}`)
  ]);

  const pixel = assessPixel({ pageUrl, page, pixelId: resolved.id, source: resolved.envName });
  const own = assessOwnPages({ owns, pixelId: resolved.id });
  const clarity = assessClarity({ pageUrl, page, clarityJs, manifest });
  const live = assessScripts({ pageUrl, page, scripts, manifest });
  const utm = assessRoute({
    id: "utm-capture-route",
    got: utmGet,
    url: `${appBase}${UTM_CAPTURE_PATH}`,
    dead: "UTM capture route is dead (GET /api/public/slo-interest).",
    alive: "GET /api/public/slo-interest is up. UTMs post there. This check did not POST.",
    fix: `Restore GET /api/public/slo-interest. fh-attribution.js posts UTMs there. Do not POST a lead from this check. ${RECON}`
  });
  const vsl = assessRoute({
    id: "vsl-watch-route",
    got: vslGet,
    url: `${appBase}${VSL_WATCH_PATH}`,
    dead: "vsl-watch beacon route is dead (GET /api/public/vsl-watch).",
    alive: "GET /api/public/vsl-watch is up. A 405 means the route is there. This check did not POST a viewing.",
    fix: `Restore /api/public/vsl-watch. A GET that answers 405 means it is alive. Do not POST a viewing from this check. ${RECON}`
  });
  const pages = [pixel, own, clarity, live, utm, vsl];
  const adClicks = await assessAdClicks(ctx);
  const funnelClicks = await assessFunnelClicks(ctx);
  // Without a fetch nothing was read. That is a skip, not a dead page.
  const rows = typeof fetchImpl === "function"
    ? pages
    : pages.map((r) => row(r.id, "skip", "no fetch in this run — live pages were not read"));
  return redactRows([...rows, adClicks, funnelClicks], hiddenValues(env, resolved.id));
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

function assessPixel({ pageUrl, page, pixelId, source }) {
  const id = "pixel-on-funnel-page";
  const fix =
    `Put the Meta pixel back on the funnel page the manifest names (${pageUrl || "funnel_head_pixel"}). ` +
    `The id comes from META_PIXEL_ID, or META_PIXEL_FALLBACK_ID in tracking-manifest.mjs. ${RECON}`;
  if (page.error) return row(id, "FAIL", clip(page.error), fix);
  if (page.status < 200 || page.status >= 300) {
    return row(id, "FAIL", clip(`${pageUrl} answered ${page.status}`), fix);
  }
  if (!pageHasPixel(page.text, pixelId)) {
    return row(id, "FAIL", clip(`${pageUrl} loaded, and the pixel id (${source}) is not started in the HTML`), fix);
  }
  return row(id, "PASS", clip(`${pageUrl} HTML includes the pixel id (${source})`));
}

// The custom pages (/apply and the three roadmap steps) are written whole by the
// push, so each carries its own pixel. The funnel head does not cover them, and a
// bad push to one of them would not touch /watch.
function assessOwnPages({ owns, pixelId }) {
  const id = "pixel-on-own-pages";
  const fix =
    "Push the page again from marketing/landing-pages so its own Meta pixel block is back. " +
    `The id comes from META_PIXEL_ID, or META_PIXEL_FALLBACK_ID in tracking-manifest.mjs. ${RECON}`;
  if (!owns.length) {
    return row(id, "skip", "The manifest names no custom page that carries its own pixel");
  }
  const bad = [];
  for (const { url, got } of owns) {
    const path = urlPath(url);
    if (got.error) bad.push(`${path} (${got.error})`);
    else if (got.status < 200 || got.status >= 300) bad.push(`${path} (answered ${got.status})`);
    else if (!pageHasPixel(got.text, pixelId)) bad.push(`${path} (pixel not started)`);
  }
  if (bad.length) {
    return row(id, "FAIL", clip(`Meta pixel missing on ${bad.join("; ")}`, 300), fix);
  }
  return row(id, "PASS", clip(`${owns.map((o) => urlPath(o.url)).join(", ")} each start the Meta pixel`, 300));
}

function assessClarity({ pageUrl, page, clarityJs, manifest }) {
  const id = "clarity-snippet";
  const fix =
    "Put the Clarity script (fundhub.ai/js/clarity.js) back on that page, with its project id filled in. " +
    `Env name CLARITY_PROJECT_ID. Do not call the Clarity export. ${RECON}`;
  if (!clarityRequiredOn(pageUrl, manifest)) {
    return row(id, "skip", "The manifest does not put the Clarity script on this page");
  }
  if (page.error) return row(id, "FAIL", clip(page.error), fix);
  if (page.status < 200 || page.status >= 300) {
    return row(id, "FAIL", clip(`${pageUrl} answered ${page.status}`), fix);
  }
  if (!pageHasClaritySnippet(page.text)) {
    return row(
      id,
      "FAIL",
      clip(`${pageUrl} loaded, and the Clarity script tag is missing. Env name CLARITY_PROJECT_ID.`),
      fix
    );
  }
  if (clarityJs.error || clarityJs.status < 200 || clarityJs.status >= 300) {
    return row(
      id,
      "FAIL",
      clip(`The Clarity tag is on the page, but ${CLARITY_SRC} ${clarityJs.error || `answered ${clarityJs.status}`}`),
      fix
    );
  }
  if (!clarityScriptHasProjectId(clarityJs.text)) {
    return row(
      id,
      "FAIL",
      clip("The Clarity tag is on the page, but clarity.js has a blank project id, so nothing records. Env name CLARITY_PROJECT_ID."),
      fix
    );
  }
  return row(
    id,
    "PASS",
    clip(`${pageUrl} HTML includes the Clarity script, and clarity.js carries a project id. Env name CLARITY_PROJECT_ID. Clarity export was not called.`)
  );
}

// fh-attribution.js is what captures the UTMs on the page, fh-events.js what sends
// page and button events, vsl-watch-beacon.js what sends the video seconds. The
// routes can be up and the capture still dead when the script file is gone.
function assessScripts({ pageUrl, page, scripts, manifest }) {
  const id = "tracking-scripts-live";
  const fix =
    "Restore the tracking script under public/funnel and deploy, or push the page again so it loads the script. " +
    `Do not POST a lead or a viewing to test it. ${RECON}`;
  const bad = [];
  for (const s of scripts) {
    if (s.got.error) bad.push(`${s.name} (${s.got.error})`);
    else if (s.got.status < 200 || s.got.status >= 300) bad.push(`${s.name} (answered ${s.got.status})`);
    else if (!s.got.text.includes(s.marker)) bad.push(`${s.name} (file has changed)`);
  }
  if (!page.error && page.status >= 200 && page.status < 300) {
    for (const src of scriptsRequiredOn(pageUrl, manifest)) {
      if (!hasScriptSrc(page.text, src)) {
        const name = (SCRIPTS.find((s) => s.src === src) || { name: src }).name;
        bad.push(`${urlPath(pageUrl)} does not load ${name}`);
      }
    }
  }
  if (bad.length) return row(id, "FAIL", clip(bad.join("; "), 300), fix);
  return row(
    id,
    "PASS",
    clip(`fh-attribution.js, fh-events.js and vsl-watch-beacon.js serve, and ${urlPath(pageUrl) || "the funnel page"} loads them`)
  );
}

function assessRoute({ id, got, url, dead, alive, fix }) {
  if (got.error) return row(id, "FAIL", clip(`${dead} ${got.error}`), fix);
  if (got.status === 404 || got.status === 410) return row(id, "FAIL", clip(`${dead} Status ${got.status}.`), fix);
  if (!routeAlive(got.status)) return row(id, "FAIL", clip(`${url} answered ${got.status}.`), fix);
  return row(id, "PASS", clip(`${alive} Status ${got.status}.`));
}

function shiftDay(iso, delta) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

// An ad click is a person who clicked a Meta ad. Meta counts it (link clicks); we
// store it as a visit that carries a UTM or an fbclid. Zero stored while Meta
// counted many means the capture is dead. Few Meta clicks (ads paused) is a skip.
async function assessAdClicks(ctx) {
  const id = "ad-click-stored";
  const fix =
    "Meta counted link clicks and we stored almost no visits with a UTM or fbclid. " +
    "Check that the ad URL still carries its UTMs, that the page loads fh-attribution.js, and that " +
    `POST /api/public/slo-interest saves the visit. Do not send a fake click or a fake purchase. ${RECON}`;
  const run = runnerOf(ctx);
  if (!run) return row(id, "skip", "no database in this run — ad clicks not read");
  const now = ctx.now instanceof Date ? ctx.now : new Date();
  const today = adAccountDay(now);
  const from = shiftDay(today, -3);
  const to = shiftDay(today, -1);
  const orgId = ctx.orgId ? String(ctx.orgId) : null;
  let rec;
  try {
    const out = await run((tx) => tx.query(AD_CLICK_SQL, [from, to, orgId]));
    rec = (out && out.rows && out.rows[0]) || {};
  } catch (err) {
    return row(id, "FAIL", clip(`could not read ad clicks: ${safeErr(err)}`), fix);
  }
  const meta = Number(rec.meta_clicks) || 0;
  const stored = Number(rec.stored) || 0;
  if (meta < MIN_META_CLICKS) {
    return row(
      id,
      "skip",
      `Meta counted ${meta} link clicks from ${from} to ${to}, under ${MIN_META_CLICKS}, so there is too little ad traffic to judge`
    );
  }
  if (stored < meta * MIN_STORE_SHARE) {
    return row(
      id,
      "FAIL",
      clip(`Meta counted ${meta} link clicks from ${from} to ${to} and we stored ${stored} ad visits with a UTM or fbclid`),
      fix
    );
  }
  return row(id, "PASS", clip(`Meta counted ${meta} link clicks from ${from} to ${to}; we stored ${stored} ad visits`));
}

// The funnel tracker saves a page row for every view and a click row for every
// button press. Plenty of views and not one click means the click beacon is dead.
// Bots count too: the tracker does not care who pressed.
async function assessFunnelClicks(ctx) {
  const id = "funnel-click-stored";
  const fix =
    "Clicks are saved as events named funnel.click by POST /api/public/slo-interest (fh-events.js). " +
    `Pages were saved and no click was. Do not send a fake click or a fake purchase. ${RECON}`;
  const run = runnerOf(ctx);
  if (!run) return row(id, "skip", "no database in this run — funnel clicks not read");
  const now = ctx.now instanceof Date ? ctx.now : new Date();
  const since = new Date(now.getTime() - AD_CLICK_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const orgId = ctx.orgId ? String(ctx.orgId) : null;
  let rec;
  try {
    const out = await run((tx) => tx.query(FUNNEL_CLICK_SQL, [since, orgId]));
    rec = (out && out.rows && out.rows[0]) || {};
  } catch (err) {
    return row(id, "FAIL", clip(`could not read stored funnel clicks: ${safeErr(err)}`), fix);
  }
  const pages = Number(rec.pages) || 0;
  const clicks = Number(rec.clicks) || 0;
  if (clicks > 0) {
    const noun = clicks === 1 ? "button click" : "button clicks";
    return row(id, "PASS", clip(`${clicks} ${noun} stored in ${AD_CLICK_WINDOW_DAYS} days (${pages} page views)`));
  }
  if (pages < MIN_FUNNEL_PAGES) {
    return row(
      id,
      "skip",
      `only ${pages} funnel page views in ${AD_CLICK_WINDOW_DAYS} days, under ${MIN_FUNNEL_PAGES}, so no click is expected yet`
    );
  }
  return row(
    id,
    "FAIL",
    clip(`${pages} funnel page views in ${AD_CLICK_WINDOW_DAYS} days and no funnel.click row stored`),
    fix
  );
}
