import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { CLARITY_SRC, META_PIXEL_FALLBACK_ID } from "../../../marketing/landing-pages/tracking-manifest.mjs";
import {
  AD_CLICK_SQL,
  CHECK_IDS,
  clarityRequiredOn,
  gapChecks,
  pageHasClaritySnippet,
  pageHasPixel,
  requiredPixelPage
} from "./gap-pixels.mjs";

const PIXEL = "998877665544";
const TOKEN = "clarity-export-token-do-not-print";
const PROJECT = "proj-do-not-print";
const PAGE = requiredPixelPage();

function pageHtml(pixelId, { clarity = true } = {}) {
  const tag = clarity ? `<script src="${CLARITY_SRC}" defer></script>` : "";
  return `<!doctype html><html><head><script>fbq('init', '${pixelId}');</script>${tag}</head><body></body></html>`;
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
  return {
    [new URL(PAGE).pathname]: { status: 200, text: html },
    "/api/public/slo-interest": { status: 200, text: '{"ok":true}' },
    "/api/public/vsl-watch": { status: 405, text: '{"ok":false,"error":"method_not_allowed"}' }
  };
}

function dbWith({ pages = 4, clicks = 2, orgId = "" } = {}) {
  const seen = [];
  return {
    seen,
    async query(sql, params) {
      seen.push({ sql, params });
      return { rows: [{ pages, clicks }] };
    },
    orgId
  };
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
}

function assertReadsOnly(calls) {
  assert.equal(calls.length, 3);
  assert.ok(calls.every((c) => c.method === "GET" && c.body == null));
  const paths = calls.map((c) => new URL(c.url).pathname);
  assert.equal(paths.filter((p) => p === new URL(PAGE).pathname).length, 1);
  assert.ok(paths.includes("/api/public/slo-interest"));
  assert.ok(paths.includes("/api/public/vsl-watch"));
  assert.ok(calls.every((c) => !String(c.url).includes("clarity.ms")));
  assert.ok(calls.every((c) => !/purchase/i.test(String(c.url))));
}

test("the manifest page is the one that must carry the pixel and Clarity", () => {
  assert.equal(PAGE, "https://apply.fundhub.ai/watch");
  assert.equal(clarityRequiredOn(PAGE), true);
  assert.equal(pageHasPixel(pageHtml(PIXEL), PIXEL), true);
  assert.equal(pageHasPixel("<html>no pixel</html>", PIXEL), false);
  assert.equal(pageHasClaritySnippet(pageHtml(PIXEL)), true);
  assert.equal(pageHasClaritySnippet(pageHtml(PIXEL, { clarity: false })), false);
});

test("green path: pixel, Clarity, both routes, and a stored click", async () => {
  const { fetchImpl, calls } = fakeFetch(liveRoutes());
  const db = dbWith({ pages: 4, clicks: 2 });
  const checks = await gapChecks({ fetchImpl, env: env(), db, now: new Date("2026-10-08T15:00:00Z") });
  assertShape(checks);
  assertNoSecrets(checks);
  assertReadsOnly(calls);
  assert.ok(checks.every((c) => c.status === "PASS"));
  assert.match(byId(checks)["pixel-on-funnel-page"].detail, /META_PIXEL_ID/);
  assert.match(byId(checks)["clarity-snippet"].detail, /CLARITY_PROJECT_ID/);
  assert.match(byId(checks)["clarity-snippet"].detail, /Clarity export was not called/);
  assert.match(byId(checks)["vsl-watch-route"].detail, /405/);
  assert.match(byId(checks)["ad-click-stored"].detail, /2 ad clicks stored/);
  assert.match(db.seen[0].sql, /funnel\.click/);
  assert.doesNotMatch(db.seen[0].sql, /\b(insert|update|delete|drop)\b/i);
  assert.equal(db.seen[0].params[0].toISOString(), "2026-10-01T15:00:00.000Z");
});

test("pixel missing on the page the code says must have it", async () => {
  const html = `<html><script src="${CLARITY_SRC}" defer></script></html>`;
  const { fetchImpl, calls } = fakeFetch(liveRoutes(html));
  const checks = await gapChecks({ fetchImpl, env: env(), db: dbWith() });
  assertShape(checks);
  assertNoSecrets(checks);
  assertReadsOnly(calls);
  assert.equal(byId(checks)["pixel-on-funnel-page"].status, "FAIL");
  assert.match(byId(checks)["pixel-on-funnel-page"].detail, /not in the HTML/);
  assert.equal(byId(checks)["clarity-snippet"].status, "PASS");
});

test("Clarity snippet missing", async () => {
  const { fetchImpl } = fakeFetch(liveRoutes(pageHtml(PIXEL, { clarity: false })));
  const checks = await gapChecks({ fetchImpl, env: env(), db: dbWith() });
  assert.equal(byId(checks)["clarity-snippet"].status, "FAIL");
  assert.match(byId(checks)["clarity-snippet"].detail, /Clarity script tag is missing/);
  assert.match(byId(checks)["clarity-snippet"].suggestedFix, /Do not call the Clarity export/);
  assert.equal(byId(checks)["pixel-on-funnel-page"].status, "PASS");
});

test("Clarity is skip when the manifest does not ask for the script", async () => {
  const manifest = [{ strategy: "funnel_head_pixel", liveUrl: "https://apply.fundhub.ai/watch" }];
  const { fetchImpl } = fakeFetch(liveRoutes(pageHtml(PIXEL, { clarity: false })));
  const checks = await gapChecks({ fetchImpl, env: env(), db: dbWith(), manifest });
  assert.equal(byId(checks)["clarity-snippet"].status, "skip");
  assert.equal(byId(checks)["pixel-on-funnel-page"].status, "PASS");
});

test("UTM capture route dead", async () => {
  const routes = liveRoutes();
  routes["/api/public/slo-interest"] = { status: 404, text: "missing" };
  const { fetchImpl, calls } = fakeFetch(routes);
  const checks = await gapChecks({ fetchImpl, env: env(), db: dbWith() });
  assert.equal(byId(checks)["utm-capture-route"].status, "FAIL");
  assert.match(byId(checks)["utm-capture-route"].detail, /UTM capture route is dead/);
  assert.match(byId(checks)["utm-capture-route"].suggestedFix, /Do not POST a lead/);
  assert.ok(calls.every((c) => c.method === "GET"));
});

test("vsl-watch beacon route dead", async () => {
  const routes = liveRoutes();
  routes["/api/public/vsl-watch"] = { status: 404, text: "missing" };
  const { fetchImpl, calls } = fakeFetch(routes);
  const checks = await gapChecks({ fetchImpl, env: env(), db: dbWith() });
  assert.equal(byId(checks)["vsl-watch-route"].status, "FAIL");
  assert.match(byId(checks)["vsl-watch-route"].detail, /vsl-watch beacon route is dead/);
  assert.match(byId(checks)["vsl-watch-route"].suggestedFix, /Do not POST a viewing/);
  assert.ok(calls.every((c) => c.method === "GET" && c.body == null));
});

test("a 405 on vsl-watch is alive and files no viewing", async () => {
  const { fetchImpl, calls } = fakeFetch(liveRoutes());
  const checks = await gapChecks({ fetchImpl, env: env(), db: dbWith() });
  assert.equal(byId(checks)["vsl-watch-route"].status, "PASS");
  const vsl = calls.find((c) => c.url.includes("/api/public/vsl-watch"));
  assert.equal(vsl.method, "GET");
  assert.equal(vsl.body, null);
});

test("ad click not stored", async () => {
  const { fetchImpl } = fakeFetch(liveRoutes());
  const checks = await gapChecks({
    fetchImpl,
    env: env(),
    db: dbWith({ pages: 6, clicks: 0 })
  });
  assert.equal(byId(checks)["ad-click-stored"].status, "FAIL");
  assert.match(byId(checks)["ad-click-stored"].detail, /no funnel\.click row stored/);
  assert.match(byId(checks)["ad-click-stored"].suggestedFix, /fake purchase/);
});

test("ad click is skip with no database or no page views", async () => {
  const { fetchImpl } = fakeFetch(liveRoutes());
  const noDb = await gapChecks({ fetchImpl, env: env() });
  assert.equal(byId(noDb)["ad-click-stored"].status, "skip");
  const quiet = await gapChecks({ fetchImpl, env: env(), db: dbWith({ pages: 0, clicks: 0 }) });
  assert.equal(byId(quiet)["ad-click-stored"].status, "skip");
});

test("ad click read is a SELECT and can be scoped to one org", async () => {
  const { fetchImpl } = fakeFetch(liveRoutes());
  const db = dbWith({ pages: 1, clicks: 1 });
  const orgId = "11111111-1111-4111-8111-111111111111";
  const checks = await gapChecks({ fetchImpl, env: env(), db, orgId });
  assert.equal(byId(checks)["ad-click-stored"].status, "PASS");
  assert.match(db.seen[0].sql, /^\s*SELECT/i);
  assert.match(db.seen[0].sql, /org_id = \$2/);
  assert.equal(db.seen[0].params[1], orgId);
  assert.doesNotMatch(AD_CLICK_SQL, /\b(insert|update|delete|drop)\b/i);
});

test("unset META_PIXEL_ID uses the fallback and the report does not print the id", async () => {
  const { fetchImpl } = fakeFetch(liveRoutes(pageHtml(META_PIXEL_FALLBACK_ID)));
  const checks = await gapChecks({
    fetchImpl,
    env: { CLARITY_DATA_EXPORT_TOKEN: TOKEN },
    db: dbWith()
  });
  assert.equal(byId(checks)["pixel-on-funnel-page"].status, "PASS");
  assert.match(byId(checks)["pixel-on-funnel-page"].detail, /META_PIXEL_ID unset/);
  assertNoSecrets(checks);
});

test("the checker source does not call Clarity export, Meta, or POST", () => {
  const src = readFileSync(fileURLToPath(new URL("./gap-pixels.mjs", import.meta.url)), "utf8");
  assert.doesNotMatch(src, /https?:\/\/[^"'\n]*clarity\.ms/);
  assert.doesNotMatch(src, /export-data/);
  assert.doesNotMatch(src, /graph\.facebook\.com/);
  assert.doesNotMatch(src, /method:\s*["']POST["']/);
  assert.match(src, /export async function gapChecks/);
});
