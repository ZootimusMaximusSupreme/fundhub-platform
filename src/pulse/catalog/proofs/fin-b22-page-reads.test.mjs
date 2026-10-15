// Batch 22, generation 2: the two live page reads, tested.
//
// The pages this repo serves are the pages the live site serves (public/climate and public/consulting go out
// with every ship), so the judges run over the real files here, and over copies with one thing broken at a time.
// The reads run through a stand-in site: a function that answers each address from a file or a string. No
// network. Each break below makes the verdict go from PASS to FAIL; each failed read is a skip, never a PASS.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  CLIMATE_READING_SURFACE, CONSULTING_REQUEST_SURFACE, CONSULTING_SUPPORT_ADDRESS, STATE_CODES, DEFAULT_BASE_URL,
  cardFields, paymentLinks, payButtons,
  MAX_PLAIN_BOXES, MIN_DISTINCT_SHAPES, MAX_READING_AGE_MS,
  outlinesIn, outlineShapes, pathCorners, isPlainBox, pageScripts, judgeClimateReading, judgeConsultingRequest,
  runFinB22PageReads,
} from "./fin-b22-page-reads.mjs";
import { REPO_ROOT } from "./fin-b22-sql-kit.mjs";

const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
const ORIGIN = DEFAULT_BASE_URL;
const CLIMATE_ID = `flow:journey:${CLIMATE_READING_SURFACE}`;
const CONSULT_ID = `flow:journey:${CONSULTING_REQUEST_SURFACE}`;

const goodStates = () => STATE_CODES.map((state, i) => ({ state, score: 40 + (i % 30), color: "#F2E39B", color_band: "neutral" }));
// The door stamps the reading with the time of the request.
const apiBody = (over = {}) => JSON.stringify({
  ok: true,
  as_of: new Date().toISOString(),
  national: { score: 54.3 },
  states: goodStates(),
  ...over,
});

/** A state's own shape: five corners, and a different set of corners for each state (never a box). */
const realPath = (i) => `M0,0 L${10 + i},${i % 7} L${20 + i * 2},${5 + (i % 9)} L${12 + i},${20 + (i % 5)} L3,${15 + (i % 3)} Z`;
/** A script that holds an outline for each of these states, the way the live page's bundle does. */
const outlineScript = (codes) => `var a=JSON.parse('{${codes.map((c) => `"${c}":"${realPath(STATE_CODES.indexOf(c))}"`).join(",")}}');function r(){}`;
/** The same, with a chosen path for each state. */
const outlineScriptWith = (make) => `var a=JSON.parse('{${STATE_CODES.map((c, i) => `"${c}":"${make(c, i)}"`).join(",")}}');function r(){}`;
/** The map the judge is given when a page draws these paths. */
const shapesOf = (make) => new Map(STATE_CODES.map((c, i) => [c, make(c, i)]));
const REAL_MAP = shapesOf((c, i) => realPath(i));

/** A stand-in site. `routes` maps an address (or a path) to a string or { status, body }. */
function site(routes) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    const key = String(url).replace(ORIGIN, "");
    const hit = routes[String(url)] ?? routes[key];
    if (hit === undefined) return new Response("not found", { status: 404 });
    if (hit instanceof Error) throw hit;
    const { status = 200, body = "" } = typeof hit === "string" ? { body: hit } : hit;
    return new Response(body, { status });
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

/** The live site as the repo holds it: the real /climate/ page and scripts, the real /consulting/ page. */
function liveSite(over = {}) {
  const html = read("public/climate/index.html");
  const routes = {
    "/api/climate": apiBody(),
    "/climate/": html,
    "/consulting/": read("public/consulting/index.html"),
  };
  for (const m of html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)) {
    if (m[1].startsWith("/climate/")) routes[m[1]] = read(path.join("public", m[1]));
  }
  return site({ ...routes, ...over });
}

// ── climate: the reading and the map ─────────────────────────────────────────

test("the climate reading on the live page is red today: five outlines for 51 states", async () => {
  const fetchImpl = liveSite();
  const row = (await runFinB22PageReads({ fetchImpl })).get(CLIMATE_ID);
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /draws 5 of 51 state outlines/);
  assert.match(row.detail, /no outline for 46 states/);
  assert.match(row.detail, /The 5 it has are plain boxes, not state shapes/);
  for (const code of ["AZ", "CA", "NY", "TX", "FL"]) assert.doesNotMatch(row.detail, new RegExp(`\\(.*\\b${code}\\b`), `${code} has an outline`);
  assert.match(row.suggestedFix, /every state/);
});

test("the climate reading goes green when the page draws all 51 outlines", async () => {
  const fetchImpl = site({
    "/api/climate": apiBody(),
    "/climate/": '<html><script src="/climate/_next/static/chunks/app/page-aaaa.js"></script></html>',
    "/climate/_next/static/chunks/app/page-aaaa.js": outlineScript(STATE_CODES),
  });
  const row = (await runFinB22PageReads({ fetchImpl })).get(CLIMATE_ID);
  assert.equal(row.status, "PASS", row.detail);
  assert.match(row.detail, /all 51 state outlines/);
  assert.match(row.detail, /national number of 54\.3/);
});

test("one missing outline is red and names the state", async () => {
  const codes = STATE_CODES.filter((c) => c !== "WY");
  const fetchImpl = site({
    "/api/climate": apiBody(),
    "/climate/": '<script src="/climate/_next/static/chunks/app/page-aaaa.js"></script>',
    "/climate/_next/static/chunks/app/page-aaaa.js": outlineScript(codes),
  });
  const row = (await runFinB22PageReads({ fetchImpl })).get(CLIMATE_ID);
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /draws 50 of 51/);
  assert.match(row.detail, /\(WY\)/);
});

test("the data door sending 50 states is red, and says which one is gone", async () => {
  const fetchImpl = site({
    "/api/climate": apiBody({ states: STATE_CODES.filter((c) => c !== "DC").map((state) => ({ state })) }),
    "/climate/": '<script src="/climate/_next/static/chunks/app/page-aaaa.js"></script>',
    "/climate/_next/static/chunks/app/page-aaaa.js": outlineScript(STATE_CODES),
  });
  const row = (await runFinB22PageReads({ fetchImpl })).get(CLIMATE_ID);
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /sent 50 of 51 states \(missing DC\)/);
});

test("a data door that says not ok, or sends no list, is red", () => {
  const all = REAL_MAP;
  assert.equal(judgeClimateReading({ api: { ok: false, states: [] }, outlines: all }).status, "FAIL");
  // every state present and every outline drawn, but the door itself says it did not work
  const sick = judgeClimateReading({ api: { ok: false, as_of: new Date().toISOString(), states: goodStates() }, outlines: all });
  assert.equal(sick.status, "FAIL");
  assert.match(sick.detail, /did not send a good reading/);
  assert.equal(judgeClimateReading({ api: { ok: true }, outlines: all }).status, "FAIL");
  assert.equal(judgeClimateReading({ api: null, outlines: all }).status, "FAIL");
});

test("no national number is not a failure: the page shows a dash for it, as the journey allows", () => {
  const row = judgeClimateReading({
    api: { ok: true, as_of: new Date().toISOString(), national: { score: null }, states: goodStates() },
    outlines: REAL_MAP,
  });
  assert.equal(row.status, "PASS");
  assert.match(row.detail, /no national number \(the page shows a dash\)/);
});

// A good reading to break one field of at a time.
const readingOf = (over = {}) => ({ ok: true, as_of: new Date().toISOString(), national: { score: 54.3 }, states: goodStates(), stale: false, ...over });
const judged = (api, outlines = REAL_MAP, now) => judgeClimateReading({ api, outlines, ...(now ? { now } : {}) });

test("the good reading used below is green", () => {
  assert.equal(judged(readingOf()).status, "PASS");
});

test("51 named states with no score and no colour, no national number and an old stamp is a blank reading, and red", () => {
  const blankStates = STATE_CODES.map((state) => ({ state, score: null, color: null }));
  const row = judged({ ok: true, as_of: "2020-01-01T00:00:00Z", stale: true, national: { score: null }, states: blankStates });
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /51 of 51 states came from the data door with no score between 0 and 100 or no colour/);
});

test("one state with no score, one with no colour and one with a score off the scale are each red and named", () => {
  for (const [label, patch, code] of [
    ["no score", { score: null }, "OH"],
    ["a blank score", { score: "" }, "OH"],
    ["a score that is not a number", { score: "n/a" }, "OH"],
    ["no colour", { color: "" }, "OH"],
    ["a colour that is not a colour", { color: "blue-ish" }, "OH"],
    ["a score over 100", { score: 140 }, "OH"],
    ["a score under 0", { score: -3 }, "OH"],
  ]) {
    const states = goodStates().map((s) => (s.state === code ? { ...s, ...patch } : s));
    const row = judged(readingOf({ states }));
    assert.equal(row.status, "FAIL", label);
    assert.match(row.detail, /1 of 51 states came from the data door/, label);
    assert.match(row.detail, /\(OH\)/, label);
  }
});

test("a score of zero and a score of 100 are real scores", () => {
  const states = goodStates().map((s) => (s.state === "OH" ? { ...s, score: 0 } : s.state === "WA" ? { ...s, score: 100 } : s));
  assert.equal(judged(readingOf({ states })).status, "PASS");
});

test("a national number that is present and not a number is red; an absent one is a dash", () => {
  assert.equal(judged(readingOf({ national: { score: "n/a" } })).status, "FAIL");
  assert.match(judged(readingOf({ national: { score: "n/a" } })).detail, /national number .* is not a number/);
  assert.equal(judged(readingOf({ national: { score: "54.3" } })).status, "PASS");
  assert.equal(judged(readingOf({ national: null })).status, "PASS");
});

test("a reading that is not dated today is red: no stamp, an unreadable stamp, a stale one, a stamp from the future", () => {
  const now = new Date("2026-10-15T12:00:00Z");
  const at = (ms) => new Date(now.getTime() + ms).toISOString();
  assert.equal(judged(readingOf({ as_of: at(0) }), REAL_MAP, now).status, "PASS");
  assert.equal(judged(readingOf({ as_of: at(-(MAX_READING_AGE_MS - 60_000)) }), REAL_MAP, now).status, "PASS");
  for (const [label, as_of] of [
    ["no stamp", undefined], ["not a date", "yesterday"], ["2020", "2020-06-01T00:00:00Z"],
    ["three days old", at(-3 * 24 * 60 * 60 * 1000)], ["a stamp from next week", at(7 * 24 * 60 * 60 * 1000)],
  ]) {
    const row = judged(readingOf({ as_of }), REAL_MAP, now);
    assert.equal(row.status, "FAIL", label);
    assert.match(row.detail, /not dated today/, label);
  }
});

test("the reading being marked stale is not by itself red (the door says so for a fallback source), the numbers are judged", () => {
  assert.equal(judged(readingOf({ stale: true })).status, "PASS");
});

// ── the map has to be a map ──────────────────────────────────────────────────

test("51 plain boxes are 51 outlines and not a map: red", () => {
  const boxes = shapesOf((c, i) => "M0,0 L1,0 L1,1 L0,1 Z");
  const row = judged(readingOf(), boxes);
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /placeholders, not a map: 51 are plain boxes/);
  assert.match(row.suggestedFix, /real state shapes/);
});

test("51 boxes of different sizes at different places are still boxes", () => {
  const boxes = shapesOf((c, i) => `M${10 * i},${5 * i} L${10 * i + 30 + i},${5 * i} L${10 * i + 30 + i},${5 * i + 20} L${10 * i},${5 * i + 20} Z`);
  assert.match(judged(readingOf(), boxes).detail, /51 are plain boxes/);
});

test("51 copies of one polygon are 51 outlines that differ in nothing: red", () => {
  const same = shapesOf((c, i) => `M${i},0 L${i + 12},3 L${i + 18},14 L${i + 6},22 L${i - 4},9 Z`);
  const row = judged(readingOf(), same);
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /0 are plain boxes .* 1 of 51 differ in shape/);
});

test("a real map with its few boxy states (Wyoming, Colorado) is green", () => {
  const withBoxes = shapesOf((c, i) => (c === "WY" ? `M${i},0 L${i + 9},0 L${i + 9},7 L${i},7 Z` : c === "CO" ? `M${i},0 L${i + 8},0 L${i + 8},6 L${i},6 Z` : realPath(i)));
  const row = judged(readingOf(), withBoxes);
  assert.equal(row.status, "PASS", row.detail);
  assert.match(row.detail, /\(2 plain boxes, 51 different shapes\)/);
});

test("the box limit is a half: 25 boxes pass, 26 fail", () => {
  const withBoxes = (n) => shapesOf((c, i) => (i < n ? `M${i},0 L${i + 9 + i},0 L${i + 9 + i},${7 + i} L${i},${7 + i} Z` : realPath(i)));
  assert.equal(MAX_PLAIN_BOXES, 25);
  assert.equal(judged(readingOf(), withBoxes(25)).status, "PASS");
  assert.equal(judged(readingOf(), withBoxes(26)).status, "FAIL");
});

test("the shape floor: 45 different shapes pass, 44 fail", () => {
  const withCopies = (copies) => shapesOf((c, i) => realPath(i < copies ? 0 : i));
  assert.equal(MIN_DISTINCT_SHAPES, 45);
  // copies 1 .. n => n of the 51 outlines are the same one shape, the rest differ
  assert.equal(judged(readingOf(), withCopies(7)).status, "PASS");   // 51 - 7 + 1 = 45 distinct
  assert.equal(judged(readingOf(), withCopies(8)).status, "FAIL");   // 44 distinct
});

test("a bare list of state codes carries no shapes, so it is red, never a pass", () => {
  const row = judged(readingOf(), new Set(STATE_CODES));
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /shapes of the state outlines were not read/);
});

test("the path reader: corners, boxes, triangles, relative and curved paths", () => {
  assert.deepEqual(pathCorners("M120,200 L200,200 L200,260 L120,260 Z"), [[120, 200], [200, 200], [200, 260], [120, 260]]);
  assert.equal(isPlainBox("M120,200 L200,200 L200,260 L120,260 Z"), true);
  assert.equal(isPlainBox("M0,0 L1,0 L1,1 L0,1"), true, "a box needs no Z");
  assert.equal(isPlainBox("M0,0 L1,0 L1,1 L0,1 L0,0 Z"), true, "closing onto the start is not a fifth corner");
  assert.equal(isPlainBox("M0,0 H10 V5 H0 Z"), true, "H and V draw a box too");
  assert.equal(isPlainBox("m0,0 l10,0 l0,5 l-10,0 z"), true, "relative moves draw a box too");
  assert.equal(isPlainBox("M0,0 L5,0 L2,4 Z"), true, "a triangle is a placeholder");
  assert.equal(isPlainBox("M0,0 L9,0"), true, "a line is a placeholder");
  assert.equal(isPlainBox("M0,0 L10,2 L11,7 L1,5 Z"), false, "a tilted four-sided shape is not an upright box");
  assert.equal(isPlainBox(realPath(3)), false);
  assert.equal(isPlainBox("M0,0 C5,5 9,9 10,0 L10,10 L0,10 Z"), false, "a curved path is never read as a box");
  assert.equal(pathCorners("M0,0 C5,5 9,9 10,0"), null);
  assert.equal(pathCorners(""), null);
});

test("the shape finder returns each state's path, and ignores a code that is not a state", () => {
  const found = outlineShapes(`{"AZ":"M120,200 L200,200 L200,260 Z","ZZ":"M1,1 L2,2 L3,3 Z"}`);
  assert.deepEqual([...found.keys()], ["AZ"]);
  assert.equal(found.get("AZ"), "M120,200 L200,200 L200,260 Z");
});

test("the live read is red on 51 placeholder boxes in the page's own script, so a stub map cannot turn it green", async () => {
  const fetchImpl = site({
    "/api/climate": apiBody(),
    "/climate/": '<script src="/climate/_next/static/chunks/app/page-dddd.js"></script>',
    "/climate/_next/static/chunks/app/page-dddd.js": outlineScriptWith(() => "M0,0 L1,0 L1,1 L0,1 Z"),
  });
  const row = (await runFinB22PageReads({ fetchImpl })).get(CLIMATE_ID);
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /placeholders, not a map/);
});

test("the live read is red on a blank reading even when every outline is drawn", async () => {
  const fetchImpl = site({
    "/api/climate": apiBody({ states: STATE_CODES.map((state) => ({ state, score: null, color: null })), national: { score: null }, stale: true, as_of: "2020-01-01T00:00:00Z" }),
    "/climate/": '<script src="/climate/_next/static/chunks/app/page-eeee.js"></script>',
    "/climate/_next/static/chunks/app/page-eeee.js": outlineScript(STATE_CODES),
  });
  const row = (await runFinB22PageReads({ fetchImpl })).get(CLIMATE_ID);
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /no score between 0 and 100 or no colour/);
});

test("a page that loads its outlines from the map file at run time is judged by that file", async () => {
  const page = '<script src="/climate/_next/static/chunks/app/page-bbbb.js"></script>';
  const script = "fetch('/climate/maps/us-states-paths.json')";
  const full = JSON.stringify(Object.fromEntries(STATE_CODES.map((c, i) => [c, realPath(i)])));
  const five = JSON.stringify(Object.fromEntries(["AZ", "CA", "NY", "TX", "FL"].map((c) => [c, "M1,1 L9,1 L9,9 Z"])));
  const route = (map) => ({
    "/api/climate": apiBody(), "/climate/": page,
    "/climate/_next/static/chunks/app/page-bbbb.js": script, "/climate/maps/us-states-paths.json": map,
  });
  assert.equal((await runFinB22PageReads({ fetchImpl: site(route(full)) })).get(CLIMATE_ID).status, "PASS");
  assert.equal((await runFinB22PageReads({ fetchImpl: site(route(five)) })).get(CLIMATE_ID).status, "FAIL");
});

test("the map file alone does not count when the page never loads it", async () => {
  const fetchImpl = site({
    "/api/climate": apiBody(),
    "/climate/": '<script src="/climate/_next/static/chunks/app/page-cccc.js"></script>',
    "/climate/_next/static/chunks/app/page-cccc.js": outlineScript(["AZ", "CA"]),
    "/climate/maps/us-states-paths.json": JSON.stringify(Object.fromEntries(STATE_CODES.map((c) => [c, "M1,1 L9,1 Z"]))),
  });
  const row = (await runFinB22PageReads({ fetchImpl })).get(CLIMATE_ID);
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /draws 2 of 51/);
});

test("a page that loads no script of its own is red", async () => {
  const fetchImpl = site({ "/api/climate": apiBody(), "/climate/": "<html><p>Loading</p></html>" });
  const row = (await runFinB22PageReads({ fetchImpl })).get(CLIMATE_ID);
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /loads no script of its own/);
});

test("the outline finder reads quoted, escaped and minified forms, and ignores a code that is not a state", () => {
  assert.deepEqual([...outlinesIn(`{"AZ":"M120,200 L200,200 Z"}`)], ["AZ"]);
  assert.deepEqual([...outlinesIn(`'{\\"CA\\":\\"M60,180 L110,180 Z\\"}'`)], ["CA"]);
  assert.deepEqual([...outlinesIn(`{"ZZ":"M120,200 L200,200 Z","XX":"M1,1 L2,2 L3,3 Z"}`)], []);
  assert.deepEqual([...outlinesIn(`{"AZ":"Monday","CA":"M"}`)], []);
  assert.deepEqual([...outlinesIn("")], []);
});

test("the page's own scripts are the ones read: framework files and other sites are left out", () => {
  const html = read("public/climate/index.html");
  const urls = pageScripts(html, ORIGIN).map((u) => u.replace(ORIGIN, ""));
  assert.deepEqual(urls, [
    "/climate/_next/static/chunks/fd9d1056-7d5ef8fc1895a2d9.js",
    "/climate/_next/static/chunks/117-92e5c7d1924bf491.js",
    "/climate/_next/static/chunks/375-9c2ed26a6c945538.js",
    "/climate/_next/static/chunks/app/page-b71b32356ee1b98a.js",
  ]);
  assert.deepEqual(pageScripts('<script src="https://cdn.example.test/x.js"></script><script src="/funnel/rb2b.js"></script>', ORIGIN), []);
  // another site's script under the same path is still another site's script
  assert.deepEqual(pageScripts('<script src="https://cdn.example.test/climate/_next/static/chunks/app/page-zz.js"></script>', ORIGIN), []);
});

test("the live read makes one request for the data, one for the page and one for each of its own scripts", async () => {
  const fetchImpl = liveSite();
  await runFinB22PageReads({ fetchImpl });
  const climate = fetchImpl.calls.filter((u) => !u.includes("/consulting/"));
  assert.equal(climate.length, 6);
  assert.ok(fetchImpl.calls.every((u) => u.startsWith(ORIGIN)), "same site only");
});

test("a stand-in site that never answers is a skip inside the run's own time, not a hang", async () => {
  const hung = (url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  });
  // AbortSignal.timeout does not hold the process open, so the test holds it open itself.
  const hold = setTimeout(() => {}, 20_000);
  try {
    const started = Date.now();
    const rows = await runFinB22PageReads({ fetchImpl: hung });
    assert.ok(Date.now() - started < 9000, "the reads gave up on their own");
    for (const row of rows.values()) assert.equal(row.status, "skip");
  } finally {
    clearTimeout(hold);
  }
});

test("the whole run has its own time limit: three slow stages in a row end as a skip when together they run long", async () => {
  // like a real fetch, a slow answer is dropped when the caller's signal aborts
  const slow = (inner) => (url, init) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(inner(url, init)), 150);
    init.signal.addEventListener("abort", () => { clearTimeout(timer); reject(new Error("aborted")); }, { once: true });
  });
  const fast = liveSite();
  // each read answers in 150 ms inside its own 1 s limit; three stages in a row take about 450 ms
  const hold = setTimeout(() => {}, 5000);
  try {
    const whole = await runFinB22PageReads({ fetchImpl: slow(fast), readTimeoutMs: 1000, runTimeoutMs: 5000 });
    assert.equal(whole.get(CLIMATE_ID).status, "FAIL", "inside the run's time limit it answers");
    const cut = await runFinB22PageReads({ fetchImpl: slow(fast), readTimeoutMs: 1000, runTimeoutMs: 300 });
    assert.equal(cut.get(CLIMATE_ID).status, "skip", "past the run's time limit it is a skip");
    assert.match(cut.get(CLIMATE_ID).detail, /was not checked/);
  } finally {
    clearTimeout(hold);
  }
});

test("a read whose body cannot be read, and a judge that throws, are skips and not a thrown lane", async () => {
  const strange = async () => ({ status: 200, text: async () => { throw new TypeError("body stream locked"); } });
  for (const row of (await runFinB22PageReads({ fetchImpl: strange })).values()) assert.equal(row.status, "skip");

  const boom = () => { throw new RangeError("a page nobody planned for"); };
  const rows = await runFinB22PageReads({ fetchImpl: liveSite() }, { climate: boom, consulting: boom });
  for (const row of rows.values()) {
    assert.equal(row.status, "skip");
    assert.match(row.detail, /a page nobody planned for/);
  }
});

test("a failed read of the climate data, the page, or a script is a skip, never a pass", async () => {
  const cases = {
    "the data door answers 500": { "/api/climate": { status: 500, body: "boom" } },
    "the data door is not JSON": { "/api/climate": "<html>maintenance</html>" },
    "the page answers 404": { "/climate/": { status: 404, body: "" } },
    "a script answers 503": { "/climate/_next/static/chunks/app/page-b71b32356ee1b98a.js": { status: 503, body: "" } },
    "the network drops": { "/api/climate": new Error("socket hang up") },
  };
  for (const [name, over] of Object.entries(cases)) {
    const row = (await runFinB22PageReads({ fetchImpl: liveSite(over) })).get(CLIMATE_ID);
    assert.equal(row.status, "skip", name);
    assert.match(row.detail, /was not checked/, name);
  }
});

test("with no GET client handed in, both page reads are skips with the reason, and the real site is never called", async () => {
  const saved = globalThis.fetch;
  let touched = 0;
  globalThis.fetch = async () => { touched += 1; return new Response("", { status: 200 }); };
  try {
    const rows = [...(await runFinB22PageReads({})).values()];
    assert.equal(rows.length, 2);
    for (const row of rows) {
      assert.equal(row.status, "skip");
      assert.match(row.detail, /no GET client/);
    }
    assert.equal(touched, 0);
  } finally {
    globalThis.fetch = saved;
  }
});

// ── consulting: the request form ─────────────────────────────────────────────

const CONSULTING = read("public/consulting/index.html");

test("the live consulting form is green today: it opens an email to the page's support address and takes no card", async () => {
  const row = (await runFinB22PageReads({ fetchImpl: liveSite() })).get(CONSULT_ID);
  assert.equal(row.status, "PASS", row.detail);
  assert.match(row.detail, /opens an email to support@fhconsulting\.online, the support address the page lists/);
  assert.match(row.detail, /no card field, no payment script, link or button/);
});

const BREAKS = [
  ["the form is gone", (t) => t.replace(/<form\b/g, "<div").replace(/<\/form>/g, "</div>"), /no request form/],
  ["the submit no longer opens an email", (t) => t.replace(/location\.href\s*=\s*"mailto:/, 'location.href = "https://x.example/'), /submit does not open an email/],
  ["the submit handler is gone", (t) => t.replace(/addEventListener\("submit"/, 'addEventListener("click"'), /submit does not open an email/],
  ["the email goes to an address the page does not list", (t) => t.replace(/location\.href = "mailto:[^"?]+/, 'location.href = "mailto:someone.else@fundhub-client.test.io'), /not the support address the page lists/],
  ["the page lists no support address", (t) => t.replace(/<a href="mailto:[^"]+">/g, '<a href="/contact">'), /not the support address the page lists|lists no support address/],
  ["a card number field appears", (t) => t.replace("<button class=\"btn\" type=\"submit\">", '<input name="cardnumber" autocomplete="cc-number"><button class="btn" type="submit">'), /card number or card details/],
  ["a card field hides behind an id", (t) => t.replace("<button class=\"btn\" type=\"submit\">", '<input id="cvc-code"><button class="btn" type="submit">'), /card number or card details/],
  ["a payment script is loaded", (t) => t.replace("</body>", '<script src="https://js.stripe.com/v3/"></script></body>'), /payment or checkout address/],
  ["the form posts to another site", (t) => t.replace('<form class="app" id="consult-form">', '<form class="app" id="consult-form" action="https://pay.example/charge">'), /posts to another site/],
  ["the page stops saying nothing is charged", (t) => t.replace(/Nothing is charged|You are not charged|not a purchase|does not (?:take|charge) a card|This page does not charge/gi, "Thanks"), /does not say nothing is charged/],
];

for (const [name, mutate, expected] of BREAKS) {
  test(`consulting form: ${name} is red`, () => {
    const changed = mutate(CONSULTING);
    assert.notEqual(changed, CONSULTING, "the break changed the page");
    const row = judgeConsultingRequest(changed);
    assert.equal(row.status, "FAIL");
    assert.match(row.detail, expected);
  });
}

// The breaks a second reader found: each one used to leave the verdict green.
const MORE_BREAKS = [
  ["a Pay link to a card checkout", (t) => t.replace("</body>", '<a href="https://checkout.stripe.com/c/pay/cs_x">Pay $5,000 now</a></body>'), /payment or checkout address/],
  ["a Pay button with no address of its own", (t) => t.replace("</body>", '<button type="button" id="p">Pay $5,000 now</button></body>'), /asks for money/],
  ["a Buy link to a path on this site", (t) => t.replace("</body>", '<a href="/consulting/checkout/">Reserve</a></body>'), /payment or checkout address/],
  ["a link to a pay path with no payment word in its text", (t) => t.replace("</body>", '<a href="/pay">Next</a></body>'), /payment or checkout address/],
  ["an embedded card frame", (t) => t.replace("</body>", '<iframe src="https://js.stripe.com/v3/elements-inner-card.html"></iframe></body>'), /payment or checkout address/],
  ["a frame to a vendor with no known name in the text, only in its address", (t) => t.replace("</body>", '<iframe src="//pay.somevendor.example/embed"></iframe></body>'), /payment or checkout address/],
  ["a script that loads the card vendor at run time", (t) => t.replace("</body>", '<script>var s=document.createElement("script");s.src="https://js.stripe.com/v3";document.head.appendChild(s);</script></body>'), /payment or checkout address/],
  ["a script that sends the visitor to a checkout path", (t) => t.replace("</body>", '<script>function go(){ window.location = "/checkout"; }</script></body>'), /payment or checkout address/],
  ["an input named pan", (t) => t.replace('<button class="btn" type="submit">', '<input name="pan"><button class="btn" type="submit">'), /card number or card details/],
  ["an input named number with a card placeholder", (t) => t.replace('<button class="btn" type="submit">', '<input name="number" placeholder="Card number"><button class="btn" type="submit">'), /card number or card details/],
  ["an input described only in an aria label", (t) => t.replace('<button class="btn" type="submit">', '<input name="q7" aria-label="Expiry date"><button class="btn" type="submit">'), /card number or card details/],
  ["a label that asks for card details", (t) => t.replace("<label", "<label data-x=1>Card number</label><label"), /card number or card details/],
  ["the support address changed on the page and in the form", (t) => t.replaceAll("support@fhconsulting.online", "sales@elsewhere.example"), /not to the support address support@fhconsulting\.online/],
  ["a typo in the address on the page and in the form", (t) => t.replaceAll("support@fhconsulting.online", "support@fhconsulting.onlin"), /not to the support address/],
  ["the right address listed but the form opens another inbox that is also listed", (t) => t.replace('location.href = "mailto:support@fhconsulting.online', 'location.href = "mailto:support@fundhub.ai').replace("</body>", '<a href="mailto:support@fundhub.ai">x</a></body>'), /not to the support address support@fhconsulting\.online/],
];

for (const [name, mutate, expected] of MORE_BREAKS) {
  test(`consulting form: ${name} is red`, () => {
    const changed = mutate(CONSULTING);
    assert.notEqual(changed, CONSULTING, "the break changed the page");
    const row = judgeConsultingRequest(changed);
    assert.equal(row.status, "FAIL");
    assert.match(row.detail, expected);
  });
}

test("consulting form: the pinned support address is the one on all four /consulting/ pages", () => {
  for (const file of ["index.html", "terms/index.html", "privacy/index.html", "refund/index.html"]) {
    assert.ok(read(`public/consulting/${file}`).includes(`mailto:${CONSULTING_SUPPORT_ADDRESS}`), file);
  }
});

test("consulting form: the real page has no card field, no payment address and no pay button", () => {
  assert.deepEqual(cardFields(CONSULTING), []);
  assert.deepEqual(paymentLinks(CONSULTING), []);
  assert.deepEqual(payButtons(CONSULTING), []);
});

test("consulting form: the finders see what they are for", () => {
  assert.equal(cardFields('<input name="cardnumber">').length, 1);
  assert.equal(cardFields('<input autocomplete="cc-exp">').length, 1);
  assert.equal(cardFields('<input name="email" autocomplete="email">').length, 0);
  assert.equal(cardFields('<textarea placeholder="Offers, team size, and the tools you already use."></textarea>').length, 0);
  assert.equal(cardFields('<label for="a">Your name</label>').length, 0);
  assert.ok(paymentLinks('<a href="https://buy.stripe.com/x">x</a>').length);
  assert.ok(paymentLinks('<script>fetch("/api/checkout/start")</script>').length);
  assert.deepEqual(paymentLinks('<a href="mailto:pay@x.example">mail</a><a href="#pay">jump</a><a href="/consulting/terms/">Terms</a>'), []);
  assert.deepEqual(payButtons('<a href="#x">Payment plans</a><button>Email this request</button>'), []);
  assert.deepEqual(payButtons('<button>Buy now</button><a href="#x">Check out</a>'), ["Buy now", "Check out"]);
});

test("consulting form: an empty answer is red, and a failed read is a skip", async () => {
  assert.equal(judgeConsultingRequest("").status, "FAIL");
  const down = await runFinB22PageReads({ fetchImpl: liveSite({ "/consulting/": { status: 500, body: "" } }) });
  assert.equal(down.get(CONSULT_ID).status, "skip");
  const gone = await runFinB22PageReads({ fetchImpl: liveSite({ "/consulting/": new Error("socket hang up") }) });
  assert.equal(gone.get(CONSULT_ID).status, "skip");
});

test("the two reads are independent: a broken climate read leaves the consulting verdict alone", async () => {
  const rows = await runFinB22PageReads({ fetchImpl: liveSite({ "/api/climate": { status: 500, body: "" } }) });
  assert.equal(rows.get(CLIMATE_ID).status, "skip");
  assert.equal(rows.get(CONSULT_ID).status, "PASS");
});
