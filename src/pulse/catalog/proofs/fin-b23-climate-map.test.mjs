// Practice test (fake data, real page): what /climate/ paints from GET
// /api/climate. It proves the national number equals the returned score, the
// States table has one row per returned state with its own score, and every
// state shape the map has is painted with the colour band of that state's
// score. It does NOT close the catalog row "paints 51 states": the shipped map
// draws only the shapes in its bundled path list (5 today, not 51). The test
// reads that list from the bundle, so when the list grows to 51 the same test
// proves 51 shapes and the row can be closed then.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { json, startPages } from "./fin-b23-browser-kit.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const PAGE_CHUNK = fs.readdirSync(path.join(ROOT, "public/climate/_next/static/chunks"))
  .filter((name) => /^375-.*\.js$/.test(name))
  .map((name) => fs.readFileSync(path.join(ROOT, "public/climate/_next/static/chunks", name), "utf8"))[0];
// the map's own list of state shapes, as written in the bundle
const SHAPES = Object.keys(JSON.parse(/JSON\.parse\('(\{"[A-Z]{2}":.*?\})'\)/.exec(PAGE_CHUNK)[1]));

const CODES = ["AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY"];

function climate(shapeScores = []) {
  // the shapes the map really has get the scores asked for; every other state walks the colour bands
  const bands = [90, 70, 55, 40, 20];
  const states = CODES.map((code, i) => {
    const at = SHAPES.indexOf(code);
    const score = at >= 0 && shapeScores[at] !== undefined ? shapeScores[at] : bands[i % bands.length] + (i % 7) / 10;
    return {
      state: code, name: `${code} name`, score, color_band: "x", color: "#000000",
      title: "t", trend_30d: i % 3 === 0 ? "up" : "flat", business_conditions: 50, issuance_velocity: 40 + (i % 9),
    };
  });
  return {
    ok: true, mapsKey: false, as_of: "2026-10-14T17:00:00Z", stale: false,
    national: { score: 61.3, components: { nfib_index: 94.2 }, color_band: "x", color: "#000000", title: "Open", updated_at: "2026-10-14T17:00:00Z", stale: false },
    states,
    banks: [],
    sources: {},
  };
}

// Two sets of scores that sit on both sides of every colour boundary (80, 65, 50, 35),
// so a boundary moved either way changes a colour the test sees.
const SCORE_SETS = [
  [80, 79.9, 64.9, 49.9, 34.9],
  [65, 50, 35, 99, 0],
];

const band = (score) => (score >= 80 ? "rgba(34,197,94,.9)" : score >= 65 ? "rgba(163,230,53,.85)" : score >= 50 ? "rgba(250,204,21,.85)" : score >= 35 ? "rgba(251,146,60,.85)" : "rgba(239,68,68,.9)");

test("the climate page paints the national number, a row per returned state, and the map shapes in their score colour", { timeout: 90_000 }, async (t) => {
  const { open } = await startPages(t);
  for (const scores of SCORE_SETS) {
    const payload = climate(scores);
    const { page, errors } = await open("/climate/", { session: null, handlers: { "/api/climate": (route) => json(route, payload) } });
    await page.waitForFunction(() => /National Climate/.test(document.body.innerText));

    // national number: exactly the returned score, one decimal
    const national = await page.locator("section.section", { hasText: "National Climate" }).first().locator("div").filter({ hasText: /^61\.3$/ }).count();
    assert.ok(national >= 1, "the national score 61.3 is on the page");

    // the States table: one row per returned state, each with its own score, best first
    const rows = await page.locator("table.table tbody tr").evaluateAll((trs) => trs.map((tr) => [tr.children[0].textContent.trim(), tr.children[1].textContent.trim()]));
    assert.equal(rows.length, payload.states.length, "one table row per returned state (51 returned)");
    const expected = [...payload.states].sort((a, b) => b.score - a.score).map((s) => [s.state, s.score.toFixed(1)]);
    assert.deepEqual(rows, expected);

    // the map: every shape in the bundle, filled with the band of its state's score
    const painted = await page.locator("svg #states path[data-code]").evaluateAll((els) => els.map((el) => [el.getAttribute("data-code"), el.getAttribute("fill")]));
    assert.deepEqual(painted.map(([code]) => code).sort(), [...SHAPES].sort(), "one shape per entry in the bundled path list");
    for (const [code, fill] of painted) {
      const score = payload.states.find((s) => s.state === code).score;
      assert.equal(fill.replace(/\s/g, ""), band(score).replace(/\s/g, ""), `${code} at ${score} is filled by its score band`);
    }
    assert.deepEqual(errors, []);
    await page.close();
  }
});

test("an em dash stands where the API sent no national score, and a failed read says so", { timeout: 60_000 }, async (t) => {
  const { open } = await startPages(t);
  const payload = climate();
  payload.national.score = null;
  const { page } = await open("/climate/", { session: null, handlers: { "/api/climate": (route) => json(route, payload) } });
  await page.waitForFunction(() => /National Climate/.test(document.body.innerText));
  assert.ok(await page.locator("section.section", { hasText: "National Climate" }).first().locator("div").filter({ hasText: /^—$/ }).count() >= 1);
  await page.close();

  const down = await open("/climate/", { session: null, handlers: { "/api/climate": (route) => json(route, { ok: false, error: "climate_unavailable", message: "failed" }, 500) } });
  await down.page.waitForFunction(() => /Temporarily unavailable\./.test(document.body.innerText));
  assert.equal(await down.page.locator("svg #states").count(), 0, "no map is drawn when the read failed");
  await down.page.close();
});
