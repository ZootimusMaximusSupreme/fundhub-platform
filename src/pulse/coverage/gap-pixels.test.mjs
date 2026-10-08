import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  CLARITY_SRC,
  FH_ATTRIBUTION_SRC,
  FH_EVENTS_SRC,
  META_PIXEL_FALLBACK_ID,
  VSL_WATCH_BEACON_SRC
} from "../../../marketing/landing-pages/tracking-manifest.mjs";
import {
  AD_CLICK_SQL,
  CHECK_IDS,
  FUNNEL_CLICK_SQL,
  MIN_FUNNEL_PAGES,
  MIN_META_CLICKS,
  clarityRequiredOn,
  clarityScriptHasProjectId,
  gapChecks,
  ownPixelPages,
  pageHasClaritySnippet,
  pageHasPixel,
  requiredPixelPage,
  scriptsRequiredOn
} from "./gap-pixels.mjs";

const PIXEL = "998877665544";
const TOKEN = "clarity-export-token-do-not-print";
const PROJECT = "proj-do-not-print";
const PAGE = requiredPixelPage();
const NOW = new Date("2026-10-08T15:00:00Z"); // 8:00 a.m. Phoenix, Oct 8
const ORG = "11111111-1111-4111-8111-111111111111";

const CLARITY_JS = 'var CLARITY_PROJECT_ID = "abcdef1234";\n(function(){ /* loader */ })();';
const SCRIPT_BODIES = {
  "/funnel/fh-attribution.js": 'var STORE = "fh_attribution"; /* captures utm_* */',
  "/funnel/fh-events.js": 'var ENDPOINT = "https://fundhub.ai/api/public/slo-interest";',
  "/funnel/vsl-watch-beacon.js": 'var ENDPOINT = "https://fundhub.ai/api/public/vsl-watch";'
};

function scriptTag(src) {
  return `<script src="${src}"></script>`;
}

function pageHtml(pixelId, { clarity = true, scripts = [FH_ATTRIBUTION_SRC, FH_EVENTS_SRC, VSL_WATCH_BEACON_SRC] } = {}) {
  const tag = clarity ? `<script src="${CLARITY_SRC}" defer></script>` : "";
  const loads = scripts.map(scriptTag).join("");
  return `<!doctype html><html><head><script>fbq('init', '${pixelId}');</script>${tag}</head><body>${loads}</body></html>`;
}

function fakeFetch(routes) {
  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    const method = String(opts.method || "GET").toUpperCase();
    calls.push({ url: String(url), method, body: opts.body ?? null });
    const u = new URL(String(url));
    const hit = routes[`${u.host}${u.pathname}`] || routes[u.pathname];
    if (!hit) return { status: 404, text: async () => "missing" };
    if (hit.throw) throw new Error(hit.throw);
    return { status: hit.status, text: async () => hit.text ?? "" };
  };
  return { fetchImpl, calls };
}

function liveRoutes(html = pageHtml(PIXEL)) {
  const own = { status: 200, text: pageHtml(PIXEL, { clarity: false, scripts: [FH_ATTRIBUTION_SRC] }) };
  return {
    [new URL(PAGE).pathname]: { status: 200, text: html },
    "/apply": own,
    "/roadmap": own,
    "/roadmap-book": own,
    "/roadmap-thank-you": own,
    "/js/clarity.js": { status: 200, text: CLARITY_JS },
    "/funnel/fh-attribution.js": { status: 200, text: SCRIPT_BODIES["/funnel/fh-attribution.js"] },
    "/funnel/fh-events.js": { status: 200, text: SCRIPT_BODIES["/funnel/fh-events.js"] },
    "/funnel/vsl-watch-beacon.js": { status: 200, text: SCRIPT_BODIES["/funnel/vsl-watch-beacon.js"] },
    "/api/public/slo-interest": { status: 200, text: '{"ok":true}' },
    "/api/public/vsl-watch": { status: 405, text: '{"ok":false,"error":"method_not_allowed"}' }
  };
}

// A scope that answers by the exact SQL text, so a check that sends the wrong
// query gets nothing back instead of the canned row.
function scopeFor({ ad = { meta_clicks: 40, stored: 30 }, funnel = { pages: 80, clicks: 60 } } = {}, seen = []) {
  const tx = {
    async query(sql, params) {
      seen.push({ sql, params });
      if (sql === AD_CLICK_SQL) {
        if (ad instanceof Error) throw ad;
        return { rows: [ad] };
      }
      if (sql === FUNNEL_CLICK_SQL) {
        if (funnel instanceof Error) throw funnel;
        return { rows: [funnel] };
      }
      throw new Error(`unexpected query: ${String(sql).slice(0, 60)}`);
    }
  };
  return async (fn) => fn(tx);
}

function env() {
  return {
    META_PIXEL_ID: PIXEL,
    CLARITY_PROJECT_ID: PROJECT,
    CLARITY_DATA_EXPORT_TOKEN: TOKEN
  };
}

function byId(checks) {
  return Object.fromEntries(checks.map((c) => [c.id, c]));
}

function assertShape(checks) {
  assert.deepEqual(checks.map((c) => c.id), [...CHECK_IDS]);
  for (const c of checks) {
    assert.deepEqual(Object.keys(c).sort(), ["detail", "id", "status", "suggestedFix"]);
    assert.ok(c.status === "PASS" || c.status === "FAIL" || c.status === "skip");
    assert.equal(typeof c.detail, "string");
    assert.ok(c.detail.length > 0);
    if (c.status === "FAIL") {
      assert.equal(typeof c.suggestedFix, "string");
      assert.match(c.suggestedFix, /Recon/);
      assert.match(c.suggestedFix, /AG-07/);
      assert.doesNotMatch(c.suggestedFix, /new watchdog|second watchdog|second tripwire/i);
    } else {
      assert.equal(c.suggestedFix, null);
    }
  }
}

function assertNoSecrets(checks) {
  const blob = JSON.stringify(checks);
  assert.equal(blob.includes(PIXEL), false);
  assert.equal(blob.includes(TOKEN), false);
  assert.equal(blob.includes(PROJECT), false);
  assert.equal(blob.includes(META_PIXEL_FALLBACK_ID), false);
  assert.equal(blob.includes("abcdef1234"), false);
}

function assertReadsOnly(calls) {
  // /watch, 4 custom pages, clarity.js, 3 tracking scripts, 2 routes.
  assert.equal(calls.length, 11);
  assert.ok(calls.every((c) => c.method === "GET" && c.body == null));
  const paths = calls.map((c) => new URL(c.url).pathname);
  assert.equal(paths.filter((p) => p === new URL(PAGE).pathname).length, 1);
  assert.ok(paths.includes("/api/public/slo-interest"));
  assert.ok(paths.includes("/api/public/vsl-watch"));
  assert.ok(calls.every((c) => !String(c.url).includes("clarity.ms")));
  assert.ok(calls.every((c) => !/purchase/i.test(String(c.url))));
}

test("the manifest names the head page, the four custom pages, and what /watch must load", () => {
  assert.equal(PAGE, "https://apply.fundhub.ai/watch");
  assert.deepEqual(ownPixelPages().map((u) => new URL(u).pathname).sort(), [
    "/apply",
    "/roadmap",
    "/roadmap-book",
    "/roadmap-thank-you"
  ]);
  assert.equal(clarityRequiredOn(PAGE), true);
  assert.deepEqual(scriptsRequiredOn(PAGE).sort(), [FH_ATTRIBUTION_SRC, FH_EVENTS_SRC, VSL_WATCH_BEACON_SRC].sort());
  assert.equal(pageHasClaritySnippet(pageHtml(PIXEL)), true);
  assert.equal(pageHasClaritySnippet(pageHtml(PIXEL, { clarity: false })), false);
});

test("pageHasPixel needs the pixel started with the id, not a mention of it", () => {
  assert.equal(pageHasPixel(pageHtml(PIXEL), PIXEL), true);
  assert.equal(pageHasPixel("<html>no pixel</html>", PIXEL), false);
  // The id in a comment next to some other fbq call is not our pixel.
  assert.equal(pageHasPixel(`<!-- ${PIXEL} --><script>fbq('track','PageView')</script>`, PIXEL), false);
  // A different pixel started on the page is not ours.
  assert.equal(pageHasPixel(pageHtml("111111111111"), PIXEL), false);
  assert.equal(pageHasPixel(pageHtml(PIXEL), "not-digits"), false);
});

test("clarity.js carries a project id, or it records nothing", () => {
  assert.equal(clarityScriptHasProjectId(CLARITY_JS), true);
  assert.equal(clarityScriptHasProjectId('var CLARITY_PROJECT_ID = "";\n'), false);
  assert.equal(clarityScriptHasProjectId("// no id here"), false);
});

test("green path: pixel everywhere, Clarity, scripts, both routes, and stored clicks", async () => {
  const { fetchImpl, calls } = fakeFetch(liveRoutes());
  const seen = [];
  const checks = await gapChecks({ fetchImpl, env: env(), scope: scopeFor({}, seen), orgId: ORG, now: NOW });
  assertShape(checks);
  assertNoSecrets(checks);
  assertReadsOnly(calls);
  assert.ok(checks.every((c) => c.status === "PASS"), JSON.stringify(checks.map((c) => [c.id, c.status])));
  const rows = byId(checks);
  assert.match(rows["pixel-on-funnel-page"].detail, /META_PIXEL_ID/);
  assert.match(rows["pixel-on-own-pages"].detail, /\/roadmap/);
  assert.match(rows["clarity-snippet"].detail, /CLARITY_PROJECT_ID/);
  assert.match(rows["clarity-snippet"].detail, /Clarity export was not called/);
  assert.match(rows["vsl-watch-route"].detail, /405/);
  assert.match(rows["ad-click-stored"].detail, /Meta counted 40 link clicks from 2026-10-05 to 2026-10-07; we stored 30 ad visits/);
  assert.match(rows["funnel-click-stored"].detail, /60 button clicks stored/);
  // The ad-click read is a SELECT over the three closed Arizona days for this company.
  const ad = seen.find((q) => q.sql === AD_CLICK_SQL);
  assert.deepEqual(ad.params, ["2026-10-05", "2026-10-07", ORG]);
  assert.match(ad.sql, /^\s*SELECT/i);
  assert.doesNotMatch(ad.sql, /\b(insert|update|delete|drop)\b/i);
  const fun = seen.find((q) => q.sql === FUNNEL_CLICK_SQL);
  assert.equal(fun.params[0].toISOString(), "2026-10-01T15:00:00.000Z");
  assert.equal(fun.params[1], ORG);
  assert.doesNotMatch(fun.sql, /\b(insert|update|delete|drop)\b/i);
});

test("pixel missing on the page the code says must have it", async () => {
  const html = `<html><script src="${CLARITY_SRC}" defer></script></html>`;
  const { fetchImpl, calls } = fakeFetch(liveRoutes(html));
  const checks = await gapChecks({ fetchImpl, env: env(), scope: scopeFor() });
  assertShape(checks);
  assertNoSecrets(checks);
  assertReadsOnly(calls);
  assert.equal(byId(checks)["pixel-on-funnel-page"].status, "FAIL");
  assert.match(byId(checks)["pixel-on-funnel-page"].detail, /not started in the HTML/);
  assert.equal(byId(checks)["pixel-on-own-pages"].status, "PASS");
  assert.equal(byId(checks)["clarity-snippet"].status, "PASS");
});

test("the head page is down: pixel FAIL names the status, never PASS", async () => {
  const routes = liveRoutes();
  routes[new URL(PAGE).pathname] = { status: 503, text: "down" };
  const { fetchImpl } = fakeFetch(routes);
  const rows = byId(await gapChecks({ fetchImpl, env: env(), scope: scopeFor() }));
  assert.equal(rows["pixel-on-funnel-page"].status, "FAIL");
  assert.match(rows["pixel-on-funnel-page"].detail, /answered 503/);
  assert.equal(rows["clarity-snippet"].status, "FAIL");
});

test("a fetch that throws is a FAIL with the reason, not a PASS", async () => {
  const routes = liveRoutes();
  routes[new URL(PAGE).pathname] = { throw: "socket hang up" };
  const { fetchImpl } = fakeFetch(routes);
  const rows = byId(await gapChecks({ fetchImpl, env: env(), scope: scopeFor() }));
  assert.equal(rows["pixel-on-funnel-page"].status, "FAIL");
  assert.match(rows["pixel-on-funnel-page"].detail, /socket hang up/);
});

test("the pixel is gone from /roadmap only: own-pages FAIL names it, /watch stays PASS", async () => {
  const routes = liveRoutes();
  routes["/roadmap"] = { status: 200, text: "<html><body>sales page with no pixel</body></html>" };
  const { fetchImpl } = fakeFetch(routes);
  const checks = await gapChecks({ fetchImpl, env: env(), scope: scopeFor() });
  assertShape(checks);
  const rows = byId(checks);
  assert.equal(rows["pixel-on-own-pages"].status, "FAIL");
  assert.match(rows["pixel-on-own-pages"].detail, /\/roadmap \(pixel not started\)/);
  assert.doesNotMatch(rows["pixel-on-own-pages"].detail, /\/apply/);
  assert.equal(rows["pixel-on-funnel-page"].status, "PASS");
});

test("a custom page that answers 404 is named in the own-pages FAIL", async () => {
  const routes = liveRoutes();
  delete routes["/roadmap-book"];
  const { fetchImpl } = fakeFetch(routes);
  const r = byId(await gapChecks({ fetchImpl, env: env(), scope: scopeFor() }))["pixel-on-own-pages"];
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /\/roadmap-book \(answered 404\)/);
});

test("Clarity snippet missing", async () => {
  const { fetchImpl } = fakeFetch(liveRoutes(pageHtml(PIXEL, { clarity: false })));
  const checks = await gapChecks({ fetchImpl, env: env(), scope: scopeFor() });
  assert.equal(byId(checks)["clarity-snippet"].status, "FAIL");
  assert.match(byId(checks)["clarity-snippet"].detail, /Clarity script tag is missing/);
  assert.match(byId(checks)["clarity-snippet"].suggestedFix, /Do not call the Clarity export/);
  assert.equal(byId(checks)["pixel-on-funnel-page"].status, "PASS");
});

test("Clarity tag on the page but a blank project id in clarity.js is a FAIL", async () => {
  const routes = liveRoutes();
  routes["/js/clarity.js"] = { status: 200, text: 'var CLARITY_PROJECT_ID = "";' };
  const { fetchImpl } = fakeFetch(routes);
  const r = byId(await gapChecks({ fetchImpl, env: env(), scope: scopeFor() }))["clarity-snippet"];
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /blank project id/);
  assertNoSecrets([r]);
});

test("Clarity tag on the page but clarity.js answers 404 is a FAIL", async () => {
  const routes = liveRoutes();
  delete routes["/js/clarity.js"];
  const { fetchImpl } = fakeFetch(routes);
  const r = byId(await gapChecks({ fetchImpl, env: env(), scope: scopeFor() }))["clarity-snippet"];
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /answered 404/);
});

test("Clarity is skip when the manifest does not ask for the script", async () => {
  const manifest = [{ strategy: "funnel_head_pixel", liveUrl: "https://apply.fundhub.ai/watch" }];
  const { fetchImpl } = fakeFetch(liveRoutes(pageHtml(PIXEL, { clarity: false })));
  const checks = await gapChecks({ fetchImpl, env: env(), scope: scopeFor(), manifest });
  assert.equal(byId(checks)["clarity-snippet"].status, "skip");
  assert.equal(byId(checks)["pixel-on-funnel-page"].status, "PASS");
  assert.equal(byId(checks)["pixel-on-own-pages"].status, "skip");
});

test("a tracking script file that is gone is a FAIL", async () => {
  const routes = liveRoutes();
  delete routes["/funnel/fh-attribution.js"];
  const { fetchImpl } = fakeFetch(routes);
  const r = byId(await gapChecks({ fetchImpl, env: env(), scope: scopeFor() }))["tracking-scripts-live"];
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /fh-attribution\.js \(answered 404\)/);
  assert.match(r.suggestedFix, /Do not POST a lead or a viewing/);
});

test("a tracking script that no longer says what it must is a FAIL", async () => {
  const routes = liveRoutes();
  routes["/funnel/vsl-watch-beacon.js"] = { status: 200, text: "<html>Netlify 200 page</html>" };
  const { fetchImpl } = fakeFetch(routes);
  const r = byId(await gapChecks({ fetchImpl, env: env(), scope: scopeFor() }))["tracking-scripts-live"];
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /vsl-watch-beacon\.js \(file has changed\)/);
});

test("the /watch page stops loading the video beacon: FAIL names it", async () => {
  const html = pageHtml(PIXEL, { scripts: [FH_ATTRIBUTION_SRC, FH_EVENTS_SRC] });
  const { fetchImpl } = fakeFetch(liveRoutes(html));
  const r = byId(await gapChecks({ fetchImpl, env: env(), scope: scopeFor() }))["tracking-scripts-live"];
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /\/watch does not load vsl-watch-beacon\.js/);
});

test("UTM capture route dead", async () => {
  const routes = liveRoutes();
  routes["/api/public/slo-interest"] = { status: 404, text: "missing" };
  const { fetchImpl, calls } = fakeFetch(routes);
  const checks = await gapChecks({ fetchImpl, env: env(), scope: scopeFor() });
  assert.equal(byId(checks)["utm-capture-route"].status, "FAIL");
  assert.match(byId(checks)["utm-capture-route"].detail, /UTM capture route is dead/);
  assert.match(byId(checks)["utm-capture-route"].suggestedFix, /Do not POST a lead/);
  assert.ok(calls.every((c) => c.method === "GET"));
});

test("a 500 on the UTM route is a FAIL, not a PASS", async () => {
  const routes = liveRoutes();
  routes["/api/public/slo-interest"] = { status: 500, text: "boom" };
  const { fetchImpl } = fakeFetch(routes);
  const r = byId(await gapChecks({ fetchImpl, env: env(), scope: scopeFor() }))["utm-capture-route"];
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /answered 500/);
});

test("vsl-watch beacon route dead", async () => {
  const routes = liveRoutes();
  routes["/api/public/vsl-watch"] = { status: 404, text: "missing" };
  const { fetchImpl, calls } = fakeFetch(routes);
  const checks = await gapChecks({ fetchImpl, env: env(), scope: scopeFor() });
  assert.equal(byId(checks)["vsl-watch-route"].status, "FAIL");
  assert.match(byId(checks)["vsl-watch-route"].detail, /vsl-watch beacon route is dead/);
  assert.match(byId(checks)["vsl-watch-route"].suggestedFix, /Do not POST a viewing/);
  assert.ok(calls.every((c) => c.method === "GET" && c.body == null));
});

test("a 405 on vsl-watch is alive and files no viewing", async () => {
  const { fetchImpl, calls } = fakeFetch(liveRoutes());
  const checks = await gapChecks({ fetchImpl, env: env(), scope: scopeFor() });
  assert.equal(byId(checks)["vsl-watch-route"].status, "PASS");
  const vsl = calls.find((c) => c.url.includes("/api/public/vsl-watch"));
  assert.equal(vsl.method, "GET");
  assert.equal(vsl.body, null);
});

test("the pulse's baseUrl moves the two route reads", async () => {
  const { fetchImpl, calls } = fakeFetch(liveRoutes());
  await gapChecks({ fetchImpl, env: env(), scope: scopeFor(), baseUrl: "https://preview.example.test/" });
  const hosts = calls
    .filter((c) => c.url.includes("/api/public/"))
    .map((c) => new URL(c.url).host);
  assert.deepEqual(hosts, ["preview.example.test", "preview.example.test"]);
});

test("the ad-click read counts Meta ad visits only, from closed Arizona days, once", () => {
  assert.match(AD_CLICK_SQL, /payload->'attribution'->>'fbclid' IS NOT NULL/);
  assert.match(AD_CLICK_SQL, /utm_source' ~\* '\^\(fb\|ig\|facebook\|instagram\|meta\)'/);
  assert.match(AD_CLICK_SQL, /GREATEST\(/);
  assert.match(AD_CLICK_SQL, /count\(DISTINCT e\.payload->>'session_id'\)/);
  assert.match(AD_CLICK_SQL, /AT TIME ZONE 'America\/Phoenix'/);
  assert.match(AD_CLICK_SQL, /coalesce\(m\.link_clicks, m\.clicks\)/);
  assert.doesNotMatch(AD_CLICK_SQL, /\b(insert|update|delete|drop|truncate)\b/i);
});

test("ad click: Meta counted many clicks and we stored none is a FAIL", async () => {
  const { fetchImpl } = fakeFetch(liveRoutes());
  const checks = await gapChecks({
    fetchImpl,
    env: env(),
    scope: scopeFor({ ad: { meta_clicks: 64, stored: 0 } }),
    now: NOW
  });
  const r = byId(checks)["ad-click-stored"];
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /Meta counted 64 link clicks/);
  assert.match(r.detail, /we stored 0 ad visits/);
  assert.match(r.suggestedFix, /fake purchase/);
});

test("ad click: a stored share under 10 percent of Meta's count is a FAIL, 27 percent is a PASS", async () => {
  const { fetchImpl } = fakeFetch(liveRoutes());
  const low = byId(await gapChecks({ fetchImpl, env: env(), scope: scopeFor({ ad: { meta_clicks: 100, stored: 9 } }), now: NOW }));
  assert.equal(low["ad-click-stored"].status, "FAIL");
  const fine = byId(await gapChecks({ fetchImpl, env: env(), scope: scopeFor({ ad: { meta_clicks: 56, stored: 15 } }), now: NOW }));
  assert.equal(fine["ad-click-stored"].status, "PASS");
});

test("ad click: ads paused (Meta counted almost nothing) is a skip, not a PASS", async () => {
  const { fetchImpl } = fakeFetch(liveRoutes());
  const r = byId(await gapChecks({
    fetchImpl,
    env: env(),
    scope: scopeFor({ ad: { meta_clicks: MIN_META_CLICKS - 1, stored: 0 } }),
    now: NOW
  }))["ad-click-stored"];
  assert.equal(r.status, "skip");
  assert.match(r.detail, /too little ad traffic/);
});

test("ad click: a failed read is a FAIL with the reason", async () => {
  const { fetchImpl } = fakeFetch(liveRoutes());
  const r = byId(await gapChecks({
    fetchImpl,
    env: env(),
    scope: scopeFor({ ad: new Error("column link_clicks does not exist") })
  }))["ad-click-stored"];
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /could not read ad clicks: column link_clicks does not exist/);
});

test("ad click and funnel click are skip with no database", async () => {
  const { fetchImpl } = fakeFetch(liveRoutes());
  const noDb = byId(await gapChecks({ fetchImpl, env: env() }));
  assert.equal(noDb["ad-click-stored"].status, "skip");
  assert.equal(noDb["funnel-click-stored"].status, "skip");
});

test("db alone works when there is no staff scope", async () => {
  const { fetchImpl } = fakeFetch(liveRoutes());
  const seen = [];
  const scope = scopeFor({}, seen);
  const db = { query: (sql, params) => scope((tx) => tx.query(sql, params)) };
  const checks = await gapChecks({ fetchImpl, env: env(), db, now: NOW });
  assert.equal(byId(checks)["ad-click-stored"].status, "PASS");
  assert.equal(seen.length, 2);
});

test("funnel click: plenty of page views and not one click is a FAIL", async () => {
  const { fetchImpl } = fakeFetch(liveRoutes());
  const r = byId(await gapChecks({
    fetchImpl,
    env: env(),
    scope: scopeFor({ funnel: { pages: 6000, clicks: 0 } })
  }))["funnel-click-stored"];
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /no funnel\.click row stored/);
  assert.match(r.suggestedFix, /fake purchase/);
});

test("funnel click: a quiet week with no click is a skip, not a false alarm", async () => {
  const { fetchImpl } = fakeFetch(liveRoutes());
  const r = byId(await gapChecks({
    fetchImpl,
    env: env(),
    scope: scopeFor({ funnel: { pages: MIN_FUNNEL_PAGES - 1, clicks: 0 } })
  }))["funnel-click-stored"];
  assert.equal(r.status, "skip");
  assert.match(r.detail, new RegExp(`under ${MIN_FUNNEL_PAGES}`));
});

test("funnel click: a failed read is a FAIL, not a PASS", async () => {
  const { fetchImpl } = fakeFetch(liveRoutes());
  const r = byId(await gapChecks({
    fetchImpl,
    env: env(),
    scope: scopeFor({ funnel: new Error("relation events is missing") })
  }))["funnel-click-stored"];
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /could not read stored funnel clicks/);
});

test("without a fetch the page and route rows are skip, and the database rows still run", async () => {
  const seen = [];
  const saved = globalThis.fetch;
  globalThis.fetch = undefined;
  let checks;
  try {
    checks = await gapChecks({ env: env(), scope: scopeFor({}, seen), now: NOW });
  } finally {
    globalThis.fetch = saved;
  }
  assertShape(checks);
  const skipped = checks.slice(0, 6);
  assert.ok(skipped.every((c) => c.status === "skip" && /no fetch in this run/.test(c.detail)));
  assert.equal(byId(checks)["ad-click-stored"].status, "PASS");
  assert.equal(byId(checks)["funnel-click-stored"].status, "PASS");
  assert.equal(seen.length, 2);
});

test("unset META_PIXEL_ID uses the fallback and the report does not print the id", async () => {
  const html = pageHtml(META_PIXEL_FALLBACK_ID);
  const routes = liveRoutes(html);
  const own = { status: 200, text: pageHtml(META_PIXEL_FALLBACK_ID, { clarity: false, scripts: [FH_ATTRIBUTION_SRC] }) };
  for (const p of ["/apply", "/roadmap", "/roadmap-book", "/roadmap-thank-you"]) routes[p] = own;
  const { fetchImpl } = fakeFetch(routes);
  const checks = await gapChecks({
    fetchImpl,
    env: { CLARITY_DATA_EXPORT_TOKEN: TOKEN },
    scope: scopeFor()
  });
  assert.equal(byId(checks)["pixel-on-funnel-page"].status, "PASS");
  assert.equal(byId(checks)["pixel-on-own-pages"].status, "PASS");
  assert.match(byId(checks)["pixel-on-funnel-page"].detail, /META_PIXEL_ID unset/);
  assertNoSecrets(checks);
});

test("the checker source does not call Clarity export, Meta, or POST", () => {
  const src = readFileSync(fileURLToPath(new URL("./gap-pixels.mjs", import.meta.url)), "utf8");
  assert.doesNotMatch(src, /https?:\/\/[^"'\n]*clarity\.ms/);
  assert.doesNotMatch(src, /export-data/);
  assert.doesNotMatch(src, /graph\.facebook\.com/);
  assert.doesNotMatch(src, /method:\s*["']POST["']/);
  assert.doesNotMatch(src, /\b(BEGIN|COMMIT|ROLLBACK)\b/);
  assert.match(src, /export async function gapChecks/);
});
