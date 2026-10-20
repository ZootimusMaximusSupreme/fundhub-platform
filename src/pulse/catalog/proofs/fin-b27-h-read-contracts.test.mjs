import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  CLIMATE_READING_SURFACE,
  DEFAULT_BASE_URL,
  STATE_CODES,
} from "./fin-b22-page-reads.mjs";
import {
  CATALOG_CLIMATE_READ,
  FIN_B27_H_READ_PROVED,
  FIN_B27_H_READ_TEST,
  runFinB27HReadResults,
} from "./fin-b27-h-read-contracts.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const FLOW_CLIMATE_ID = `flow:journey:${CLIMATE_READING_SURFACE}`;

function localClimateSite() {
  const html = fs.readFileSync(path.join(ROOT, "public/climate/index.html"), "utf8");
  const routes = new Map([
    ["/api/climate", JSON.stringify({
      ok: true,
      as_of: new Date().toISOString(),
      national: { score: 54.3 },
      states: STATE_CODES.map((state, index) => ({
        state,
        score: 40 + (index % 30),
        color: "#F2E39B",
        color_band: "neutral",
      })),
    })],
    ["/climate/", html],
  ]);

  for (const match of html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)) {
    if (!match[1].startsWith("/climate/")) continue;
    routes.set(match[1], fs.readFileSync(path.join(ROOT, "public", match[1]), "utf8"));
  }

  return async (url) => {
    const key = String(url).replace(DEFAULT_BASE_URL, "");
    if (!routes.has(key)) return new Response("not found", { status: 404 });
    return new Response(routes.get(key), { status: 200 });
  };
}

test("the climate catalog row owns the exact live read and focused proof files", () => {
  assert.deepEqual(FIN_B27_H_READ_PROVED, [CATALOG_CLIMATE_READ]);
  assert.equal(CATALOG_CLIMATE_READ.sourceFile, "public-pages.json");
  assert.equal(CATALOG_CLIMATE_READ.depth, "deep");
  assert.equal(CATALOG_CLIMATE_READ.tests.includes(FIN_B27_H_READ_TEST), true);
  assert.match(CATALOG_CLIMATE_READ.evidence, /fin-b22-page-reads\.test\.mjs/);
  assert.match(CATALOG_CLIMATE_READ.evidence, /fin-b27-h-read-contracts\.test\.mjs/);
});

test("the safe climate read maps the shipped five-shape page to the exact catalog row and stays red", async () => {
  const rows = await runFinB27HReadResults({ fetchImpl: localClimateSite() });
  const row = rows.get(CATALOG_CLIMATE_READ.id);
  assert.equal(row.id, "catalog-read:climate-map");
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /draws 5 of 51 state outlines/);
  assert.match(row.detail, /no outline for 46 states/);
  assert.match(row.suggestedFix, /every state/);
});

test("the catalog binding carries a future green result and never turns a missing read green", async () => {
  const pass = await runFinB27HReadResults({}, async () => new Map([[
    FLOW_CLIMATE_ID,
    { id: FLOW_CLIMATE_ID, status: "PASS", detail: "all 51 state outlines match the reading", suggestedFix: null },
  ]]));
  assert.equal(pass.get(CATALOG_CLIMATE_READ.id).status, "PASS");
  assert.match(pass.get(CATALOG_CLIMATE_READ.id).detail, /all 51 state outlines/);

  const missing = await runFinB27HReadResults({}, async () => new Map());
  assert.equal(missing.get(CATALOG_CLIMATE_READ.id).status, "skip");
  assert.match(missing.get(CATALOG_CLIMATE_READ.id).detail, /returned no climate row/);
});
