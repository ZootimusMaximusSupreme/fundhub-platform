// The /order price fix drafts (fix batch 2026-10-09, piece F4).
//
// /order is a native ClickFunnels page, so the repo holds a frozen copy of the
// live page (marketing/landing-pages/slo/preview/order-live-2026-10-09.html)
// and a script that builds the red draft, the green draft and the clean page
// from it. These tests run the REAL pulse row funnel:order-price-matches-till
// on both: the live copy fails it ($297 against a $147 till), the clean page
// passes it. And they hold the owner's draft law: only price words change,
// no mark is left on the clean page, and no copy can send anything.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { gapChecks } from "./gap-funnels.mjs";
import {
  PRICE_FIXES,
  SNAPSHOT_FILE,
  buildClean,
  buildGreen,
  buildRed,
  fixPrices,
  oldPriceLeft,
  scrubSnapshot
} from "../../../marketing/landing-pages/slo/preview/order-price-draft-build.mjs";
import { SLO_PRICE_CENTS } from "../../slo/offer.mjs";

const FUNNEL = "https://apply.fundhub.ai";
const APP = "https://fundhub.ai";
const ID = "funnel:order-price-matches-till";
const SNAP = readFileSync(SNAPSHOT_FILE, "utf8");

// The till as it answered on 2026-10-09 (GET https://fundhub.ai/api/public/slo-checkout).
const TILL = JSON.stringify({ ok: true, name: "Complete Funding Diagnostic", priceCents: 14700, priceDisplay: "$147", demo: false, checkout: { ready: true } });

async function priceRow(orderHtml) {
  const fetchImpl = async (url) => {
    const path = new URL(String(url)).pathname;
    const body = path === "/order" ? orderHtml : path === "/api/public/slo-checkout" ? TILL : null;
    return {
      status: body === null ? 404 : 200,
      headers: new Headers({ "content-type": path.startsWith("/api/") ? "application/json" : "text/html" }),
      url: String(url),
      text: async () => body ?? "missing fixture"
    };
  };
  const rows = await gapChecks({ fetchImpl, funnelBaseUrl: FUNNEL, appBaseUrl: APP });
  return rows.find((r) => r.id === ID);
}

function visibleLines(html) {
  const t = String(html).replace(/<script\b[\s\S]*?<\/script>/gi, "").replace(/<style\b[\s\S]*?<\/style>/gi, "");
  return t.split(/<[^>]+>/).map((s) => s.trim()).filter(Boolean);
}

test("order draft: the till still charges $147, the price Chris set", () => {
  assert.equal(SLO_PRICE_CENTS, 14700);
});

test("order draft: the frozen live /order fails the pulse row ($297 against the $147 till)", async () => {
  const row = await priceRow(SNAP);
  assert.equal(row.status, "FAIL", row.detail);
  assert.match(row.detail, /charges \$297 but the till says \$147/);
});

test("order draft: the clean page passes the same pulse row", async () => {
  const row = await priceRow(buildClean(SNAP));
  assert.equal(row.status, "PASS", row.detail);
  assert.match(row.detail, /both say \$147/);
});

test("order draft: only price words change, every other word stays", () => {
  const before = visibleLines(SNAP);
  const after = visibleLines(buildClean(SNAP));
  assert.equal(after.length, before.length);
  const changed = before.map((line, i) => [line, after[i]]).filter(([a, b]) => a !== b);
  assert.equal(changed.length, 6);
  for (const [a, b] of changed) assert.equal(b, a.replace("$297", "$147"), `${a} -> ${b}`);
  assert.deepEqual(oldPriceLeft(buildClean(SNAP)), []);
});

test("order draft: the clean page carries no mark; the red draft keeps $297 and boxes it; the green marks $147", () => {
  const clean = buildClean(SNAP);
  assert.doesNotMatch(clean, /fhx-/);
  const red = buildRed(SNAP);
  assert.match(red, /fhx-banner red/);
  assert.match(red, /fhx-bad/);
  assert.match(red, /Secure checkout — \$297 one-time\./);
  const green = buildGreen(SNAP);
  assert.match(green, /Secure checkout — <span class="fhx-new">\$147<\/span> one-time\./);
  assert.match(green, /id="fhx-toggle">Hide the marks</);
  assert.match(green, /html\.fhx-clean \.fhx-new\{background:none;box-shadow:none\}/);
});

test("order draft: no copy can send anything and none holds a page key", () => {
  for (const html of [buildRed(SNAP), buildGreen(SNAP), buildClean(SNAP)]) {
    assert.match(html, /http-equiv="Content-Security-Policy" content="[^"]*form-action 'none'; connect-src 'none'; frame-src 'none'/);
    const scripts = [...html.matchAll(/<script\b([^>]*)>/gi)].map((m) => m[1]);
    for (const attrs of scripts) assert.match(attrs, /type="application\/json"|nonce="fhx"/, `a live script is left: ${attrs}`);
    assert.doesNotMatch(html, /pk_live_(?!SCRUBBED)|hbp_(?!SCRUBBED)/);
  }
  assert.match(SNAP, /<meta content="SCRUBBED" name="csrf-token"/);
});

test("order draft: a page that changed stops the build instead of guessing", () => {
  assert.throws(() => fixPrices(SNAP.replace("Secure checkout — $297 one-time.", "Secure checkout.")), /line under the headline: expected 1/);
  assert.equal(PRICE_FIXES.reduce((n, f) => n + f[3], 0), 160);
});

test("order draft: the scrub takes out every page key", () => {
  const raw = '<meta content="abc-123" name="csrf-token" /> data-stripe-publishable-key="pk_live_AbC123" apiKey: \'hbp_XyZ9\'';
  assert.equal(scrubSnapshot(raw), '<meta content="SCRUBBED" name="csrf-token" /> data-stripe-publishable-key="pk_live_SCRUBBED" apiKey: \'hbp_SCRUBBED\'');
});
