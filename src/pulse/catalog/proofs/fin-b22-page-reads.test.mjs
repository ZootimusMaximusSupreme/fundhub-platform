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
  CLIMATE_READING_SURFACE, CONSULTING_REQUEST_SURFACE, STATE_CODES, DEFAULT_BASE_URL,
  outlinesIn, pageScripts, judgeClimateReading, judgeConsultingRequest, runFinB22PageReads,
} from "./fin-b22-page-reads.mjs";
import { REPO_ROOT } from "./fin-b22-sql-kit.mjs";

const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
const ORIGIN = DEFAULT_BASE_URL;
const CLIMATE_ID = `flow:journey:${CLIMATE_READING_SURFACE}`;
const CONSULT_ID = `flow:journey:${CONSULTING_REQUEST_SURFACE}`;

const apiBody = (over = {}) => JSON.stringify({
  ok: true,
  national: { score: 54.3 },
  states: STATE_CODES.map((state) => ({ state, score: 50 })),
  ...over,
});

/** A script that holds an outline for each of these states, the way the live page's bundle does. */
const outlineScript = (codes) => `var a=JSON.parse('{${codes.map((c) => `"${c}":"M10,10 L40,10 L40,40 L10,40 Z"`).join(",")}}');function r(){}`;

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
  const all = new Set(STATE_CODES);
  assert.equal(judgeClimateReading({ api: { ok: false, states: [] }, outlines: all }).status, "FAIL");
  assert.equal(judgeClimateReading({ api: { ok: true }, outlines: all }).status, "FAIL");
  assert.equal(judgeClimateReading({ api: null, outlines: all }).status, "FAIL");
});

test("no national number is not a failure: the page shows a dash for it, as the journey allows", () => {
  const row = judgeClimateReading({
    api: { ok: true, national: { score: null }, states: STATE_CODES.map((state) => ({ state })) },
    outlines: new Set(STATE_CODES),
  });
  assert.equal(row.status, "PASS");
  assert.match(row.detail, /no national number \(the page shows a dash\)/);
});

test("a page that loads its outlines from the map file at run time is judged by that file", async () => {
  const page = '<script src="/climate/_next/static/chunks/app/page-bbbb.js"></script>';
  const script = "fetch('/climate/maps/us-states-paths.json')";
  const full = JSON.stringify(Object.fromEntries(STATE_CODES.map((c) => [c, "M1,1 L9,1 L9,9 Z"])));
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
});

test("the live read makes one request for the data, one for the page and one for each of its own scripts", async () => {
  const fetchImpl = liveSite();
  await runFinB22PageReads({ fetchImpl });
  const climate = fetchImpl.calls.filter((u) => !u.includes("/consulting/"));
  assert.equal(climate.length, 6);
  assert.ok(fetchImpl.calls.every((u) => u.startsWith(ORIGIN)), "same site only");
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
  assert.match(row.detail, /opens an email to the support address the page lists/);
  assert.match(row.detail, /no card field and no payment script/);
});

const BREAKS = [
  ["the form is gone", (t) => t.replace(/<form\b/g, "<div").replace(/<\/form>/g, "</div>"), /no request form/],
  ["the submit no longer opens an email", (t) => t.replace(/location\.href\s*=\s*"mailto:/, 'location.href = "https://x.example/'), /submit does not open an email/],
  ["the submit handler is gone", (t) => t.replace(/addEventListener\("submit"/, 'addEventListener("click"'), /submit does not open an email/],
  ["the email goes to an address the page does not list", (t) => t.replace(/location\.href = "mailto:[^"?]+/, 'location.href = "mailto:someone.else@fundhub-client.test.io'), /not the support address the page lists/],
  ["the page lists no support address", (t) => t.replace(/<a href="mailto:[^"]+">/g, '<a href="/contact">'), /not the support address the page lists|lists no support address/],
  ["a card number field appears", (t) => t.replace("<button class=\"btn\" type=\"submit\">", '<input name="cardnumber" autocomplete="cc-number"><button class="btn" type="submit">'), /card number or card details/],
  ["a card field hides behind an id", (t) => t.replace("<button class=\"btn\" type=\"submit\">", '<input id="cvc-code"><button class="btn" type="submit">'), /card number or card details/],
  ["a payment script is loaded", (t) => t.replace("</body>", '<script src="https://js.stripe.com/v3/"></script></body>'), /payment script/],
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
