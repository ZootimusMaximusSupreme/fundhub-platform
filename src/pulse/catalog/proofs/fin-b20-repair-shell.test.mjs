// Finish-853 batch 20, repair cycle 1: the staff shell, held where the first cycle left a gap. The real
// public/app/shell.js runs in a real Chromium; /api is answered by the test with fake people and fake
// numbers; every other address is blocked. Nothing is saved anywhere real.
//
//   1. Search on a desk that loads no data.js: the shell's own request, the way it encodes the typed word,
//      the token it carries, how a refusal reads, and that nothing a hit holds is ever drawn as markup.
//   2. The backend word, fed by the bodies the REAL /api/health sends (healthState() over a stand-in).
//   3. Sign out: every key it must leave behind, for a signed-in person and for a demo one.
//   4. The chip's name, its hidden state, the clock on a customer screen, the brand read's token.
//   5. The page-load session check: what it clears. (The bounce that happens before the session answers is
//      in fin-b20-repair-gate.test.mjs with the rest of the role gate.)

import assert from "node:assert/strict";
import test, { before, after } from "node:test";

import { openLab, makePage, callsTo, until, TOKEN } from "./fin-b20-browser-kit.mjs";
import { healthState } from "../../../http/health.mjs";
import { EXPECTED_MIGRATIONS } from "../../../../db/expected-migrations.mjs";

let lab;
before(async () => { lab = await openLab(); });
after(async () => { await lab.close(); });

const words = (scope, selector) => scope.locator(selector).first().evaluate((el) => {
  const parts = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) parts.push(walker.currentNode.nodeValue);
  return parts.join(" ").replace(/\s+/g, " ").trim();
});

async function open(page, path) {
  await page.goto(`${lab.origin}${path}`, { waitUntil: "domcontentloaded" });
  await page.locator("#fh-shell-chip").waitFor({ state: "attached", timeout: 20_000 });
}

// ---------------------------------------------------------------------------------------------
// 1. Search on a desk with no data.js (lenders.html)
const DESK = "/app/lenders.html";
const demoStaff = JSON.stringify({ id: "demo-1", name: "Demo Owner", role: "owner", status: "active" });

async function openSearch(page) {
  await open(page, DESK);
  assert.equal(await page.evaluate(() => typeof window.FHData), "undefined", "this desk loads no data.js, so the shell's own request is the one that runs");
  await page.locator("#fh-shell-search-btn").click();
  return { input: page.locator("#fh-shell-search-input"), results: "#fh-shell-search-results" };
}

test("search on a desk with no data.js: the typed word is encoded whole, the saved token goes with it, and a hit opens its page", { timeout: 90_000 }, async () => {
  const term = "Ann & Bob #1 ?x=2 100%";
  const page = await makePage(lab, {
    api: (call) => {
      if (call.path !== "/api/read/search") return undefined;
      if (call.query.q === term) return { ok: true, groups: { clients: [{ href: "client-control-panel.html?id=c-ann", title: "Ann Bob", subtitle: "Fake client" }] } };
      return { ok: true, groups: {} };
    },
  });
  const { input, results } = await openSearch(page);
  await input.fill(`  ${term}  `);
  await page.locator(".fh-search-hit").first().waitFor({ state: "visible" });
  const asked = callsTo(page, "/api/read/search");
  assert.equal(asked.length, 1, "one read for one typed word");
  assert.equal(asked[0].query.q, term, "the word arrives whole: the ampersand, hash, question mark and percent are not read as the address");
  assert.deepEqual(Object.keys(asked[0].query), ["q"], "no other parameter came out of the word");
  assert.equal(asked[0].headers.authorization, `Bearer ${TOKEN}`);
  assert.equal(asked[0].headers.accept, "application/json");
  assert.equal(await words(page, `${results} .fh-search-ghead`), "Clients 1");
  await page.locator(".fh-search-hit").first().click();
  await page.waitForURL((u) => u.pathname === "/app/client-control-panel.html" && u.searchParams.get("id") === "c-ann");
  await page.close();
});

test("search on a desk with no data.js: a refusal, a server error, a page that is not JSON and no network each say so; clearing shows the hint", { timeout: 120_000 }, async () => {
  let mode = "empty";
  const page = await makePage(lab, {
    api: async (call, route) => {
      if (call.path !== "/api/read/search") return undefined;
      if (mode === "empty") return { ok: true, groups: {} };
      if (mode === "401") return { status: 401, body: { ok: false, error: "unauthorized" } };
      if (mode === "403") return { status: 403, body: { ok: false, error: "forbidden" } };
      if (mode === "500") return { status: 500, body: { ok: false, error: "internal_error" } };
      if (mode === "notok") return { ok: false, error: "bad_query" };
      if (mode === "html") {
        await route.fulfill({ status: 200, contentType: "text/html", body: "<html>bad gateway</html>" });
        return { hold: true };
      }
      return { abort: true };
    },
  });
  const { input, results } = await openSearch(page);
  const HINT = "Type a name, email, phone, or anything else you remember.";
  const said = async (term, expected, note) => {
    // back to the hint first, so a line left over from the step before can never stand in for this one
    await input.fill("");
    await until(async () => (await words(page, results)) === HINT, { message: `${note}: the hint before it` });
    await input.fill(term);
    await until(async () => (await words(page, results)) === expected, { message: note });
  };
  await said("zzz", "No matches for “zzz”.", "the no-match line");
  mode = "401"; await said("zzz1", "Not signed in — search needs a real session.", "401 reads as signed out");
  mode = "403"; await said("zzz2", "Not signed in — search needs a real session.", "403 reads as signed out");
  mode = "500"; await said("zzz3", "Search could not run. Try again in a moment.", "a server error");
  mode = "notok"; await said("zzz4", "Search could not run. Try again in a moment.", "an answer that is not ok");
  mode = "html"; await said("zzz5", "Search could not run. Try again in a moment.", "a page that is not JSON");
  mode = "abort"; await said("zzz6", "Search could not run. Try again in a moment.", "no network");
  await said("   ", HINT, "the hint again");
  await page.close();
});

test("search on a desk with no data.js: a title, a subtitle, an address and the typed word are drawn as words, never as markup", { timeout: 90_000 }, async () => {
  const hostile = {
    href: 'x"><img src=x onerror="window.__proof_ran = 1">',
    title: '<b>Bold</b> & "quoted" <script>window.__proof_ran = 2</script>',
    subtitle: "<i>sub</i> 'single' & more",
  };
  const page = await makePage(lab, {
    api: (call) => {
      if (call.path !== "/api/read/search") return undefined;
      return call.query.q === "needle" ? { ok: true, groups: { clients: [hostile] } } : { ok: true, groups: {} };
    },
  });
  const { input, results } = await openSearch(page);
  await input.fill("needle");
  const hit = page.locator(".fh-search-hit").first();
  await hit.waitFor({ state: "visible" });
  assert.equal(await words(hit, ".fh-search-title"), hostile.title, "the title reads as the words it was sent");
  assert.equal(await words(hit, ".fh-search-sub"), hostile.subtitle);
  assert.equal(await hit.getAttribute("href"), hostile.href, "the address is one attribute value, whole");
  assert.deepEqual(await hit.evaluate((a) => a.getAttributeNames().sort()), ["class", "href"], "nothing was injected into the link");
  assert.equal(await page.locator(`${results} img, ${results} b, ${results} i, ${results} script`).count(), 0, "no element came out of a result");
  assert.equal(await page.evaluate(() => window.__proof_ran === undefined), true, "nothing in a result ran");
  assert.equal(await page.locator(`${results} .fh-search-hit`).count(), 1);

  await input.fill("<u>none</u>");
  await until(async () => (await words(page, results)) === "No matches for “<u>none</u>”.", { message: "the no-match line with markup in the word" });
  assert.equal(await page.locator(`${results} u`).count(), 0);
  await page.close();
});

test("search on a desk with no data.js: a demo session is told to sign in and nothing is asked of the server", { timeout: 60_000 }, async () => {
  const page = await makePage(lab, {
    token: "", hint: "owner", session: () => ({ status: 401, body: { ok: false } }), storage: { fh_demo_staff: demoStaff },
  });
  const { input, results } = await openSearch(page);
  await input.fill("anyone");
  await until(async () => (await words(page, results)) === "Demo session — search needs a real sign-in.", { message: "the demo line" });
  assert.equal(callsTo(page, "/api/read/search").length, 0, "nothing was asked of the server");
  await page.close();
});

// ---------------------------------------------------------------------------------------------
// 2. The backend word, from the real health bodies
const healthBody = async (db) => JSON.parse(JSON.stringify(await healthState(db, () => new Date("2026-10-14T17:00:00.000Z"))));
const rowsOf = (keys) => ({ async query() { return { rows: keys.map((key) => ({ key })) }; } });
const failing = (error) => ({ async query() { throw error; } });
const refused = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
// The word's colour is part of what it says: mint is real data, peach is an API with no database, rose is no API.
const MINT = "rgb(168, 216, 176)";
const PEACH = "rgb(245, 206, 143)";
const ROSE = "rgb(242, 166, 155)";

test("status word: LIVE only when the real health body says ok and up; behind, unconfigured, unreachable and broken are not LIVE", { timeout: 180_000 }, async () => {
  const up = await healthBody(rowsOf(EXPECTED_MIGRATIONS));
  const behind = await healthBody(rowsOf(EXPECTED_MIGRATIONS.slice(0, -2)));
  assert.equal(up.ok, true);
  assert.equal(up.db, "up");
  assert.deepEqual([behind.ok, behind.db, behind.state], [false, "up", "behind"], "the shape that must never read LIVE: the database answers and migrations are missing");
  assert.equal(behind.pending, 2);
  const cases = [
    { name: "up", body: up, word: "LIVE", tone: MINT, title: `${EXPECTED_MIGRATIONS.length} migrations applied` },
    { name: "behind", body: behind, word: "NO DB", tone: PEACH },
    { name: "unconfigured", body: await healthBody(failing(new Error("DATABASE_URL not set"))), word: "NO DB", tone: PEACH },
    { name: "unreachable", body: await healthBody(failing(refused)), word: "NO DB", tone: PEACH },
    { name: "broken", body: await healthBody(failing(new Error("relation does not exist"))), word: "NO DB", tone: PEACH },
    { name: "ok with a database word that is not up", body: { ok: true, db: "sleeping" }, word: "NO DB", tone: PEACH },
    { name: "up with ok false", body: { ok: false, db: "up" }, word: "NO DB", tone: PEACH },
    { name: "no JSON", body: null, raw: "<html>bad gateway</html>", word: "NO API", tone: ROSE },
  ];
  for (const c of cases) {
    const page = await makePage(lab, { health: () => (c.raw ? { raw: c.raw } : { body: c.body }) });
    await open(page, "/app/pipeline.html");
    await until(async () => (await page.locator("#fh-shell-src").innerText()) !== "···", { message: `${c.name}: the word` });
    assert.equal(await page.locator("#fh-shell-src").innerText(), c.word, c.name);
    assert.equal(await page.locator("#fh-shell-src").evaluate((el) => getComputedStyle(el).backgroundColor), c.tone, `${c.name}: the colour`);
    if (c.title) assert.equal(await page.locator("#fh-shell-src").getAttribute("title"), c.title, c.name);
    // The shell reads a `message` field the health body never carries, so for every state that is not LIVE
    // the hint is the shell's own sentence and the body's `error` is not shown (product finding).
    if (c.word === "NO DB") assert.equal(await page.locator("#fh-shell-src").getAttribute("title"), "The database is not reachable right now.", c.name);
    await page.close();
  }
  // a demo session says DEMO even when the backend is up, and never in the real-data colour
  const demo = await makePage(lab, {
    token: "", hint: "owner", session: () => ({ status: 401, body: { ok: false } }),
    storage: { fh_demo_staff: demoStaff }, health: () => ({ body: up }),
  });
  await open(demo, "/app/pipeline.html");
  await until(async () => (await demo.locator("#fh-shell-src").innerText()) === "DEMO", { message: "the demo word" });
  assert.equal(await demo.locator("#fh-shell-src").evaluate((el) => getComputedStyle(el).backgroundColor), PEACH, "demo data is never painted as real data");
  await demo.close();
});

// ---------------------------------------------------------------------------------------------
// 3. Sign out
const CLIENT_ID = "dddddddd-0000-4000-8000-000000000001";
const ENTITY_ID = "eeeeeeee-0000-4000-8000-000000000001";

test("sign out: the remembered client and entity go with the token and role, and nothing is left for the next person", { timeout: 60_000 }, async () => {
  const page = await makePage(lab, { storage: { fh_client: CLIENT_ID, fh_entity: ENTITY_ID } });
  await open(page, "/app/pipeline.html");
  assert.equal(await page.evaluate(() => localStorage.getItem("fh_client")), CLIENT_ID, "remembered while working");
  await page.locator("#fh-shell-out").click();
  await page.waitForURL((u) => u.pathname === "/login.html");
  const left = await page.evaluate(() => ({
    token: localStorage.getItem("fh_token"), role: localStorage.getItem("fh_role"), demo: localStorage.getItem("fh_demo"),
    demoStaff: localStorage.getItem("fh_demo_staff"), client: localStorage.getItem("fh_client"), entity: localStorage.getItem("fh_entity"),
  }));
  assert.deepEqual(left, { token: null, role: null, demo: null, demoStaff: null, client: null, entity: null });
  assert.equal(callsTo(page, "/api/auth/logout", "POST").length, 1);
  await page.close();
});

test("sign out: a demo session is ended too, so the next load is signed out and not a demo person again", { timeout: 90_000 }, async () => {
  const page = await makePage(lab, {
    token: "", hint: "owner", session: () => ({ status: 401, body: { ok: false } }),
    storage: { fh_demo_staff: demoStaff, fh_demo: "1", fh_client: CLIENT_ID, fh_entity: ENTITY_ID },
  });
  await open(page, "/app/pipeline.html");
  await page.locator("#fh-shell-out").click();
  await page.waitForURL((u) => u.pathname === "/login.html");
  const left = await page.evaluate(() => ({
    demoStaff: localStorage.getItem("fh_demo_staff"), demo: localStorage.getItem("fh_demo"), client: localStorage.getItem("fh_client"),
    entity: localStorage.getItem("fh_entity"), role: localStorage.getItem("fh_role"),
  }));
  assert.deepEqual(left, { demoStaff: null, demo: null, client: null, entity: null, role: null });
  assert.equal(callsTo(page, "/api/auth/logout").length, 0, "there was no token to tell the server about");
  // and the next desk asks for a sign-in instead of opening for a demo person
  await page.goto(`${lab.origin}/app/pipeline.html`, { waitUntil: "domcontentloaded" });
  await page.waitForURL((u) => u.pathname === "/login.html" && u.searchParams.get("next") === "/app/pipeline.html");
  await page.close();
});

// ---------------------------------------------------------------------------------------------
// 4. The chip, the clock, the brand read
const fakeAddress = (local) => [local, "proof.invalid"].join("@");

test("account chip: the name is shown before the address; with no name the address is; hiding sets aria-hidden both ways", { timeout: 90_000 }, async () => {
  const named = await makePage(lab, { role: "closer", staff: { name: "Riley Chen", email: fakeAddress("riley.chen") } });
  await open(named, "/app/closer-dashboard.html");
  assert.equal(await words(named, '#fh-shell-chip span[title^="role closer"]'), "Riley Chen · closer");
  const chip = named.locator("#fh-shell-chip");
  assert.equal(await chip.getAttribute("aria-hidden"), "false");
  await named.locator("#fh-shell-chip-hide").click();
  assert.equal(await chip.getAttribute("aria-hidden"), "true", "hidden from the accessibility tree when hidden");
  await named.locator("#fh-shell-chip-show").click();
  assert.equal(await chip.getAttribute("aria-hidden"), "false");
  await named.close();

  const unnamed = await makePage(lab, { role: "closer", staff: { name: "", email: fakeAddress("riley.chen") } });
  await open(unnamed, "/app/closer-dashboard.html");
  assert.equal(await words(unnamed, '#fh-shell-chip span[title^="role closer"]'), `${fakeAddress("riley.chen")} · closer`);
  await unnamed.close();
});

test("clock: staff who open a customer's screen are not given the office clock, and a staff desk is", { timeout: 90_000 }, async () => {
  const cases = [["owner", "/app/client-portal.html"], ["closer", "/app/consent-capture.html"], ["csm", "/app/consent-capture.html"], ["funding_advisor", "/app/consent-capture.html"]];
  for (const [role, path] of cases) {
    const page = await makePage(lab, { role });
    await open(page, path);
    await page.locator("#fh-shell-chip").waitFor({ state: "attached" });
    await new Promise((resolve) => setTimeout(resolve, 400));
    assert.equal(await page.locator("#fh-shell-clock").count(), 0, `${role} on ${path}: no office clock`);
    assert.equal(await page.locator(".topbar").count() > 0, true, `${path} has the bar a clock would have gone into`);
    await page.close();
  }
  const desk = await makePage(lab, { role: "owner" });
  await open(desk, "/app/products-commissions.html");
  await desk.locator("#fh-shell-clock").waitFor({ state: "attached" });
  await desk.close();
});

test("brand read: the saved token goes with the request, so the company's own brand is the one answered", { timeout: 60_000 }, async () => {
  const page = await makePage(lab, { api: (call) => (call.path === "/api/org-brand" ? { ok: true, brand: { ink: "#112233" } } : undefined) });
  await open(page, "/app/pipeline.html");
  await until(() => callsTo(page, "/api/org-brand").length > 0, { message: "the brand read" });
  const call = callsTo(page, "/api/org-brand")[0];
  assert.equal(call.headers.authorization, `Bearer ${TOKEN}`);
  assert.equal(call.headers.accept, "application/json");
  await page.close();
});

// ---------------------------------------------------------------------------------------------
// 5. The page-load session check
test("session check: a real session clears a demo person left in storage, and no session clears the remembered role", { timeout: 90_000 }, async () => {
  const real = await makePage(lab, { role: "owner", storage: { fh_demo: "1", fh_demo_staff: demoStaff } });
  await open(real, "/app/pipeline.html");
  const left = await real.evaluate(() => ({ demo: localStorage.getItem("fh_demo"), demoStaff: localStorage.getItem("fh_demo_staff"), role: localStorage.getItem("fh_role") }));
  assert.deepEqual(left, { demo: null, demoStaff: null, role: "owner" }, "the demo person is gone and the real role stays");
  await real.close();

  const none = await makePage(lab, { token: "stale-token", hint: "owner", session: () => ({ status: 401, body: { ok: false } }) });
  await none.goto(`${lab.origin}/app/pipeline.html`, { waitUntil: "domcontentloaded" });
  await none.waitForURL((u) => u.pathname === "/login.html");
  assert.equal(await none.evaluate(() => localStorage.getItem("fh_role")), null, "a remembered role does not outlive the session it came from");
  await none.close();
});
