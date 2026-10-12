import assert from "node:assert/strict";
import test from "node:test";

import climateConfig from "../../../../api/climate/config.mjs";
import rb2bWebhook from "../../../../api/public/rb2b-webhook.mjs";
import { evaluateRouteContract } from "./door-batch-route-contract.mjs";

test("one safe route pass calls and judges both public read contracts", async () => {
  const priorBrowserKey = process.env.GOOGLE_MAPS_BROWSER_KEY;
  const priorApplyUrl = process.env.APPLY_PAGE_URL;
  process.env.GOOGLE_MAPS_BROWSER_KEY = "fake-browser-key-for-door-proof";
  process.env.APPLY_PAGE_URL = "https://apply.example.test";

  try {
    const climate = await evaluateRouteContract({
      handler: climateConfig,
      request: { method: "GET" },
      expected: {
        status: 200,
        body: {
          ok: true,
          mapsKey: "fake-browser-key-for-door-proof",
          applyUrl: "https://apply.example.test",
        },
        headers: { "access-control-allow-origin": "*", "cache-control": "no-store" },
      },
    });
    assert.equal(climate.ok, true, climate.problems.join(", "));

    const rb2b = await evaluateRouteContract({
      handler: rb2bWebhook,
      request: { method: "GET" },
      deps: {
        secret: "unused-fake-secret",
        db: { query: () => assert.fail("GET must not read the database") },
        emit: () => assert.fail("GET must not emit an event"),
      },
      expected: {
        status: 200,
        body: { ok: true, service: "rb2b-webhook" },
        headers: { "cache-control": "no-store" },
      },
    });
    assert.equal(rb2b.ok, true, rb2b.problems.join(", "));
  } finally {
    if (priorBrowserKey === undefined) delete process.env.GOOGLE_MAPS_BROWSER_KEY;
    else process.env.GOOGLE_MAPS_BROWSER_KEY = priorBrowserKey;
    if (priorApplyUrl === undefined) delete process.env.APPLY_PAGE_URL;
    else process.env.APPLY_PAGE_URL = priorApplyUrl;
  }
});
