// Batch 13 practice tests: the Hiring desk (public/app/hiring.html).
//
// A real Chromium opens the real page from public/ with a fake API (nothing leaves this machine). Each
// test clicks the control and judges exactly what the page then shows and what it sends. These are
// practice tests with fake data, not live checks.
//
// The fake candidates, postings and decisions are made up for the test: no real person is named.
//
// Which tests are attached to a row is listed in fin-b13-display-practice.mjs. The page-load, funnel and
// decision-log checks all assert that the page's shared clock is today's clock. That assertion is what
// catches the old July 30, 2026 anchor before any date-window result can be called proved.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test, { after, before } from "node:test";
import { fileURLToPath } from "node:url";

import { fulfillJson, newStaffPage, openLab, waitForShell } from "./s5-browser-kit.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

const STAGES = [
  ["applied", "Applied", 0], ["screening", "Screening", 1], ["group_interview", "Group Interview", 2],
  ["one_on_one", "1:1 Interview", 3], ["offer", "Offer", 4], ["hired", "Hired", 5], ["onboarding", "Onboarding", 6],
  ["ramp", "Ramp (60-day trial)", 7], ["performing", "Performing", 8], ["rejected", "Not Moving Forward", 9],
  ["withdrawn", "Withdrawn", 10]
];
const STAGE = Object.fromEntries(STAGES.map(([key, name, sort]) => [key, { stage_key: key, stage_name: name, sort_order: sort }]));
const ROLE = {
  closer: { role_key: "closer", role_name: "Closer" },
  setter: { role_key: "setter", role_name: "Setter" },
  sales_coordinator: { role_key: "sales_coordinator", role_name: "Sales Coordinator" }
};

let n = 0;
function candidate(name, role, source, stage, over = {}) {
  n += 1;
  return {
    application_id: `app-${String(n).padStart(3, "0")}`, candidate_id: `cand-${n}`, status: "open",
    applied_at: "2026-07-10 09:00", entered_stage_at: "2026-07-20 09:00", full_name: name,
    email: null, phone: null, source, source_detail: null, disc_profile: null,
    linkedin_profile_url: null, ...ROLE[role], ...STAGE[stage], average: 3.2, recommendation: "advance",
    flags: [], rubric_version: 1, is_automated: true, has_video: false, has_resume: true,
    recommendation_status: "advisory — a human decides", ...over
  };
}

const FLAG = { key: "incongruent_answers", label: "Answers appear internally inconsistent — verify before proceeding" };
const AVA = candidate("Ava Reed", "closer", "referral", "screening");
const BEN = candidate("Ben Cole", "setter", "social", "applied", { average: 1.5, recommendation: "review_likely_no", flags: [FLAG] });
const CY = candidate("Cy Dunn", "closer", "ads", "group_interview", { average: null, recommendation: "incomplete" });
const DI = candidate("Di Ellis", "sales_coordinator", "inbound", "offer", { average: 3.6, recommendation: "advance_priority" });
const ED = candidate("Ed Fox", "closer", "referral", "rejected", { status: "rejected", average: 2.0, recommendation: "review_maybe" });
const FLO = candidate("Flo Gray", "setter", "referral", "hired", { status: "hired", average: 3.4 });
const APPS = [AVA, BEN, CY, DI, ED, FLO];

const BENCH = [
  { role_key: "closer", role_name: "Closer", bench_target: 4, bench_count: 0, bench_shortfall: 4, open_applications: 2,
    hiring_manager: null, short: true, unrouted: true, awaiting_screen: 0, awaiting_group_interview: 1 },
  { role_key: "setter", role_name: "Setter", bench_target: 4, bench_count: 0, bench_shortfall: 4, open_applications: 1,
    hiring_manager: "Chris Stanbridge", short: true, unrouted: false, awaiting_screen: 1, awaiting_group_interview: 0 },
  { role_key: "sales_coordinator", role_name: "Sales Coordinator", bench_target: 4, bench_count: 1, bench_shortfall: 3,
    open_applications: 1, hiring_manager: null, short: true, unrouted: true, awaiting_screen: 0, awaiting_group_interview: 0 }
];

const POSTINGS = [
  { id: "post-1", channel: "linkedin", title: "Closer, remote", location: "Remote", apply_url: "https://jobs.example.test/1",
    status: "posted", posted_at: "2026-07-01 09:00", closed_at: null, last_error: null, last_synced_at: "2026-07-29 09:00",
    created_at: "2026-07-01 08:00", is_published: true, role_key: "closer", role_name: "Closer", applications: 3, applications_7d: 1 },
  { id: "post-2", channel: "internal", title: "Setter, draft", location: null, apply_url: null, status: "draft", posted_at: null,
    closed_at: null, last_error: null, last_synced_at: null, created_at: "2026-07-05 08:00", is_published: false,
    role_key: "setter", role_name: "Setter", applications: 0, applications_7d: 0 },
  { id: "post-3", channel: "job_board", title: "Coordinator board ad", location: "Phoenix", apply_url: null, status: "failed",
    posted_at: null, closed_at: null, last_error: "Board said: invalid company id 4471", last_synced_at: "2026-07-28 09:00",
    created_at: "2026-07-06 08:00", is_published: false, role_key: "sales_coordinator", role_name: "Sales Coordinator",
    applications: 0, applications_7d: 0 },
  { id: "post-4", channel: "internal", title: "Closer, filled", location: null, apply_url: null, status: "closed",
    posted_at: "2026-06-01 09:00", closed_at: "2026-06-20 09:00", last_error: null, last_synced_at: null,
    created_at: "2026-06-01 08:00", is_published: false, role_key: "closer", role_name: "Closer", applications: 5, applications_7d: 0 }
];

const decisionRow = (id, decision, created_at, role_key, over = {}) => ({
  id, decision, from_stage_key: "applied", to_stage_key: decision === "reject" ? "rejected" : "screening", reason: null,
  recommendation_at_decision: "advance", candidate_notified_at: null, created_at, role_key, source: "referral",
  decided_by_name: "Casey Proof", human_decided: true, score_at_decision: 3.1, rubric_version: 1,
  followed_recommendation: true, ...over
});
const DECISIONS = [
  decisionRow("dec-a", "advance", "2026-07-20 10:00", "closer"),
  decisionRow("dec-b", "reject", "2026-07-25 11:00", "setter", { reason: "No sales background shown", followed_recommendation: false }),
  decisionRow("dec-c", "advance", "2026-05-01 10:00", "closer")
];

// The nine sources the row names, in the row's order. The database's own list is read from the migration
// so a source added or dropped there without the page moving is a red test.
const SOURCE_KEYS = ["referral", "client_base", "audience", "social", "job_board", "ads", "linkedin", "recruiter", "inbound"];
function sourcesInTheDatabase() {
  const sql = fs.readFileSync(path.join(REPO, "db/migrations/051_hiring.sql"), "utf8");
  const found = /candidates_source_ck CHECK \(source IN\s*\(([^)]*)\)\)/.exec(sql);
  assert.ok(found, "candidates_source_ck is not in 051_hiring.sql");
  return [...found[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}
const STATUS_AT = {
  applied: "open", screening: "open", group_interview: "open", one_on_one: "open", offer: "open",
  hired: "hired", onboarding: "hired", ramp: "hired", performing: "hired", rejected: "rejected", withdrawn: "withdrawn"
};

function makeApi(state) {
  return async (request, url) => {
    const p = url.pathname;
    if (p === "/api/demo/mode") return { ok: true, demo_mode_enabled: state.demoMode === true };
    if (p === "/api/hiring/candidates") return { ok: true, items: state.apps, count: state.apps.length };
    if (p === "/api/hiring/postings") return { ok: true, items: state.postings };
    if (p === "/api/hiring/decisions") return { ok: true, items: state.decisions };
    if (p === "/api/hiring/bench") return { ok: true, items: state.bench };
    if (p === "/api/hiring/funnel") {
      state.funnelCalls.push(Object.fromEntries(url.searchParams));
      return { ok: true, items: state.funnel(Object.fromEntries(url.searchParams)) };
    }
    if (p === "/api/hiring/application") {
      const appId = url.searchParams.get("id");
      state.applicationReads.push(appId);
      if (state.applicationWaits?.[appId]) await state.applicationWaits[appId];
      const found = state.apps.find((a) => a.application_id === appId);
      return { ok: true, ...found, answers: found.answers || { why: "Wants the work" }, video_url: null, scores: [], interviews: [], decisions: [] };
    }
    if (p === "/api/hiring/decide") {
      state.decides.push(JSON.parse(request.postData() || "{}"));
      return { ok: true };
    }
    return undefined;
  };
}

const freshState = (over = {}) => ({
  apps: APPS, postings: POSTINGS, decisions: DECISIONS, bench: BENCH, demoMode: false, decides: [], funnelCalls: [],
  applicationReads: [],
  funnel: () => [{ source: "referral", role_key: "closer", applications: 4, reached_group_interview: 3, reached_one_on_one: 2,
    reached_offer: 1, hired: 1, rejected: 1, hire_rate_pct: 25 }],
  ...over
});

async function openHiring(lab, state, { role = "owner" } = {}) {
  const page = await newStaffPage(lab, { role, api: makeApi(state) });
  await page.goto(`${lab.origin}/app/hiring.html`, { waitUntil: "domcontentloaded" });
  await page.locator("#board .col").first().waitFor({ timeout: 30_000 });
  await page.waitForFunction(() => /loaded/.test(document.getElementById("footNote")?.textContent || ""), null, { timeout: 30_000 });
  return page;
}

const text = (page, selector) => page.locator(selector).first().textContent();
const boardNames = (page) => page.locator("#board .ccard .nm span:last-child").allTextContents();
const columnNames = (page) => page.locator("#board .col .cn span:first-child").allTextContents();

let lab;
before(async () => { lab = await openLab(); });
after(async () => { await lab?.close(); });

test("page load reads demo mode, candidates, postings, decisions and bench, then paints tiles, board and tables", { timeout: 120_000 }, async () => {
  const state = freshState();
  const page = await openHiring(lab, state);
  const pageNow = await page.evaluate(() => NOW.getTime());
  assert.ok(Math.abs(Date.now() - pageNow) < 60_000, "the desk clock must be the real page-load time, not the old July 30, 2026 fixture");
  const reads = page.apiCalls.map((call) => call.path).filter((p) => p.startsWith("/api/hiring/") || p === "/api/demo/mode");
  for (const path of ["/api/demo/mode", "/api/hiring/candidates", "/api/hiring/postings", "/api/hiring/decisions", "/api/hiring/bench"]) {
    assert.ok(reads.includes(path), `the page never read ${path}`);
  }
  // The candidate read asks for everything, 200 at a time.
  const cand = page.apiCalls.find((call) => call.path === "/api/hiring/candidates");
  assert.deepEqual(cand.query, { state: "all", limit: "200" });

  // Tiles: short by 4+4+3 = 11, waiting on you = 2 (one flagged, one not scored), bench 1 / 12, open 4.
  const tiles = await page.locator("#statRow .stat").allTextContents();
  assert.match(tiles[0], /SHORT BY\s*11/);
  assert.match(tiles[1], /WAITING ON YOU\s*2/);
  assert.match(tiles[2], /ON THE BENCH\s*1\s*\/ 12/);
  assert.match(tiles[3], /OPEN APPLICATIONS\s*4/);
  assert.match(await text(page, "#benchChipTxt"), /bench 1 \/ 12/);

  // Board: all 11 stages, each person in their own column.
  assert.equal((await columnNames(page)).length, 11);
  assert.match(await text(page, "#boardCount"), /^6 applications shown/);
  const screening = page.locator("#board .col", { hasText: "Screening" }).first();
  assert.match(await screening.textContent(), /Ava Reed/);
  // Tables: bench per role, waiting on a person, postings.
  assert.equal(await page.locator("#benchTbl tbody tr").count(), 3);
  assert.equal(await page.locator("#rqTbl tbody tr[data-app]").count(), 2);
  assert.equal(await page.locator("#postTbl tbody tr.rowbtn").count(), 4);
  await page.close();
});


// Six Demo Mode rows, each marked a different way, plus a real person whose surname only begins DEMO.
const DEMO_ROWS = {
  both: candidate("DEMO Candidate — Juniper Vale", "closer", "inbound", "applied", { source_detail: "platform_demo", average: null, recommendation: "incomplete" }),
  detailOnly: candidate("Gus Hale", "closer", "inbound", "applied", { source_detail: "platform_demo", average: null, recommendation: "incomplete" }),
  nameOnly: candidate("DEMO Candidate — Cedar Holt", "closer", "inbound", "applied", { average: null, recommendation: "incomplete" }),
  hyphen: candidate("DEMO-Wren Ames", "setter", "inbound", "applied", { average: null, recommendation: "incomplete" }),
  emDash: candidate("DEMO—Sky Boone", "sales_coordinator", "inbound", "offer", { average: 3.1 }),
  onBench: candidate("DEMO Candidate — Rowan Pike", "closer", "inbound", "one_on_one", { average: 3.3 })
};
const REAL_DEMOISH = candidate("DEMOTT Ray", "closer", "inbound", "applied", { average: 3.0 });
const DEMO_LIST = Object.values(DEMO_ROWS);
// The server counts every application, demo ones with the real ones (v_hiring_bench).
const DEMO_BENCH = [
  { ...BENCH[0], open_applications: 7, bench_count: 1, bench_shortfall: 3, awaiting_screen: 4, awaiting_group_interview: 1 },
  { ...BENCH[1], open_applications: 2, bench_count: 0, bench_shortfall: 4, awaiting_screen: 2, awaiting_group_interview: 0 },
  { ...BENCH[2], open_applications: 2, bench_count: 2, bench_shortfall: 2, awaiting_screen: 0, awaiting_group_interview: 0 }
];

test("summary tiles drop Demo Mode rows from every number and say how many were left out", { timeout: 120_000 }, async () => {
  const state = freshState({ apps: [...APPS, ...DEMO_LIST, REAL_DEMOISH], bench: DEMO_BENCH, demoMode: true });
  const page = await openHiring(lab, state);
  const tiles = await page.locator("#statRow .stat").allTextContents();
  // 5 real open applications; the 6 demo ones are taken off, and the page says so on every tile they touch.
  assert.match(tiles[3], /OPEN APPLICATIONS\s*5/, "the demo applications must not be counted");
  assert.match(tiles[3], /6 demo rows not counted/);
  // Two real people need a person (a flag, and no score). Four demo people also have no score.
  assert.match(tiles[1], /WAITING ON YOU\s*2/, "the demo rows are not waiting on anybody");
  assert.match(tiles[1], /2 still open · 4 demo rows not counted/);
  // The demo person on the bench and the demo person at Offer come off the bench and the short-by number.
  assert.match(tiles[2], /ON THE BENCH\s*1\s*\/ 12/, "demo people on the bench must come off the bench");
  assert.match(tiles[2], /6 demo rows not counted/);
  assert.match(tiles[0], /SHORT BY\s*11/);
  assert.match(await text(page, "#benchChipTxt"), /bench 1 \/ 12/);

  // The bench table takes them off too, role by role.
  const bench = (await page.locator("#benchTbl tbody tr").allTextContents()).join("|");
  assert.match(bench, /Closer\s*0\s*\/ 4/);
  assert.match(bench, /Sales Coordinator\s*1\s*\/ 4/);

  // Demo rows stay on the board with their label, whichever way they were marked; the real DEMOTT is not one.
  for (const demo of DEMO_LIST) {
    const card = page.locator(`#board .ccard[data-app="${demo.application_id}"]`);
    await card.waitFor();
    assert.match(await card.textContent(), /demo row/, `${demo.full_name} lost its label`);
  }
  const real = page.locator(`#board .ccard[data-app="${REAL_DEMOISH.application_id}"]`);
  await real.waitFor();
  assert.doesNotMatch(await real.textContent(), /demo row/, "a real surname that starts DEMO is not a demo row");
  assert.match(await text(page, "#boardCount"), /7 applications shown · 6 demo/);

  // The waiting table lists the demo people who have no score, labelled, and says how many it did not count.
  const waiting = page.locator("#rqTbl tbody tr[data-app]");
  assert.equal(await waiting.count(), 6, "two real people and four demo people");
  for (const demo of [DEMO_ROWS.both, DEMO_ROWS.detailOnly, DEMO_ROWS.nameOnly, DEMO_ROWS.hyphen]) {
    assert.match(await page.locator(`#rqTbl tbody tr[data-app="${demo.application_id}"]`).textContent(), /demo row/,
      `${demo.full_name} lost its label in the waiting table`);
  }
  assert.doesNotMatch(await page.locator(`#rqTbl tbody tr[data-app="${BEN.application_id}"]`).textContent(), /demo row/);
  assert.match(await text(page, "#rqCount"), /^2 waiting · 2 open · 4 demo not counted$/);
  assert.match(await text(page, "#deriv"), /6 Demo Mode rows are shown on the board with a demo label and counted in none of the numbers above/);
  await page.close();

  // Demo mode off: the same rows are hidden and the page says how many; the real numbers do not move.
  const off = await openHiring(lab, freshState({ apps: [...APPS, ...DEMO_LIST, REAL_DEMOISH], bench: DEMO_BENCH, demoMode: false }));
  for (const demo of DEMO_LIST) {
    assert.equal(await off.locator(`#board .ccard[data-app="${demo.application_id}"]`).count(), 0, `${demo.full_name} must be hidden`);
  }
  assert.equal(await off.locator(`#board .ccard[data-app="${REAL_DEMOISH.application_id}"]`).count(), 1);
  assert.match(await text(off, "#boardPager"), /6 seeded by Demo Mode and hidden because Demo Mode is off/);
  assert.match(await text(off, "#boardCount"), /7 applications shown · 6 demo hidden/);
  assert.equal(await off.locator("#rqTbl tbody tr[data-app]").count(), 2, "demo rows are off the waiting table too");
  assert.match((await off.locator("#statRow .stat").allTextContents())[3], /OPEN APPLICATIONS\s*5/);
  await off.close();
});

test("demo session (fh_demo=1) shows sample rows and reads no hiring endpoint", { timeout: 120_000 }, async () => {
  const page = await lab.browser.newPage({ viewport: { width: 1440, height: 900 } });
  const hiringCalls = [];
  await page.addInitScript(() => {
    try {
      localStorage.setItem("fh_demo", "1");
      localStorage.setItem("fh_demo_staff", JSON.stringify({ id: "demo-1", name: "Demo Owner", role: "owner", org_id: "demo" }));
      localStorage.setItem("fh_role", "owner");
    } catch { /* storage may be blocked */ }
  });
  await page.route("https://**", (route) => route.abort());
  await page.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith("/api/hiring/")) hiringCalls.push(url.pathname);
    // No real session: the shell falls back to the stored demo staff, as it does for a demo session.
    return fulfillJson(route, { ok: false }, 401);
  });
  await page.goto(`${lab.origin}/app/hiring.html`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => /demo session, sample rows/.test(document.getElementById("footNote")?.textContent || ""), null, { timeout: 30_000 });
  assert.deepEqual(hiringCalls, [], "a demo session must not query the hiring backend");
  assert.ok(await page.locator("#board .ccard").count() > 0, "the sample rows must be painted on the board");
  await page.close();
});


// One person for each of the nine sources, spread over the three roles, so a dropped or misspelled source
// leaves a person nobody can filter to.
const SOURCE_APPS = SOURCE_KEYS.map((source, i) =>
  candidate(`Src ${source}`, ["closer", "setter", "sales_coordinator"][i % 3], source, "applied", { flags: [] }));

test("role select, source select and the flagged-only toggle each narrow the board, and clear again", { timeout: 120_000 }, async () => {
  const page = await openHiring(lab, freshState());
  const shown = async () => (await boardNames(page)).sort();
  const values = (selector) => page.locator(`${selector} option`).evaluateAll((els) => els.map((el) => el.value));

  // Every role the row names, and only those.
  assert.deepEqual(await values("#fRole"), ["", "closer", "setter", "sales_coordinator"]);
  for (const role of ["closer", "setter", "sales_coordinator"]) {
    await page.locator("#fRole").selectOption(role);
    const expected = APPS.filter((a) => a.role_key === role).map((a) => a.full_name).sort();
    assert.ok(expected.length > 0, `the fixture has nobody in ${role}`);
    assert.deepEqual(await shown(), expected, `the ${role} filter showed the wrong people`);
    assert.match(await text(page, "#boardCount"), new RegExp(`^${expected.length} applications? shown`));
  }
  await page.locator("#fRole").selectOption("");
  assert.equal((await shown()).length, 6);

  await page.locator("#fSource").selectOption("referral");
  assert.deepEqual(await shown(), ["Ava Reed", "Ed Fox", "Flo Gray"]);
  assert.match(await text(page, "#boardCount"), /^3 applications shown/);

  // Flagged only keeps people with a flag or no score. None of the three referrals has either. The button
  // looks pressed and says so to a screen reader, and both go away on the next press.
  const toggle = page.locator("#fFlagged");
  assert.equal(await toggle.evaluate((el) => el.classList.contains("on")), false);
  await toggle.click();
  assert.equal(await toggle.getAttribute("aria-pressed"), "true");
  assert.equal(await toggle.evaluate((el) => el.classList.contains("on")), true, "a pressed toggle must look pressed");
  assert.deepEqual(await shown(), []);
  assert.match(await text(page, "#boardCount"), /^0 applications shown/);
  await page.locator("#fSource").selectOption("");
  assert.deepEqual(await shown(), ["Ben Cole", "Cy Dunn"]);
  await toggle.click();
  assert.equal(await toggle.getAttribute("aria-pressed"), "false");
  assert.equal(await toggle.evaluate((el) => el.classList.contains("on")), false, "an unpressed toggle must not look pressed");
  assert.equal((await shown()).length, 6);
  await page.close();
});

test("the source select names all nine sources the database allows, and each one shows only its own people", { timeout: 120_000 }, async () => {
  assert.deepEqual(sourcesInTheDatabase(), SOURCE_KEYS, "the row's nine sources and candidates_source_ck must be the same list");
  const page = await openHiring(lab, freshState({ apps: SOURCE_APPS, bench: BENCH }));
  const values = await page.locator("#fSource option").evaluateAll((els) => els.map((el) => el.value));
  assert.deepEqual(values, ["", ...SOURCE_KEYS], "the select must offer exactly the nine sources, in the row's order");
  assert.equal((await boardNames(page)).length, 9);

  for (const source of SOURCE_KEYS) {
    await page.locator("#fSource").selectOption(source);
    assert.deepEqual(await boardNames(page), [`Src ${source}`], `the ${source} filter showed the wrong people`);
    assert.match(await text(page, "#boardCount"), /^1 application shown/);
  }
  await page.locator("#fSource").selectOption("");
  assert.equal((await boardNames(page)).length, 9);

  // Role and source together keep the people who are both.
  await page.locator("#fRole").selectOption("setter");
  await page.locator("#fSource").selectOption("client_base");
  assert.deepEqual(await boardNames(page), ["Src client_base"]);
  await page.locator("#fSource").selectOption("referral");
  assert.deepEqual(await boardNames(page), [], "referral is a closer in this fixture, so setter and referral is nobody");
  await page.close();
});


test("stage rail shows one column for one stage, and 'all stages' brings all eleven back", { timeout: 120_000 }, async () => {
  const page = await openHiring(lab, freshState());
  const rail = page.locator("#stageRail button");
  assert.equal(await rail.count(), 12, "all stages plus one button per stage");
  assert.match(await rail.first().textContent(), /all stages\s*6/i);

  await rail.filter({ hasText: "Offer" }).click();
  assert.deepEqual(await columnNames(page), ["Offer"]);
  assert.deepEqual(await boardNames(page), ["Di Ellis"]);
  assert.equal(await page.locator('#stageRail button.on').count(), 1);

  await rail.filter({ hasText: "all stages" }).click();
  assert.equal((await columnNames(page)).length, 11);
  assert.equal((await boardNames(page)).length, 6);
  await page.close();
});

// One person in every stage, so a column that holds the wrong people, the wrong name or the wrong count is
// seen for each of the eleven.
const STAGE_PEOPLE = STAGES.map(([key]) => candidate(`Person ${key}`, "closer", "referral", key, { status: STATUS_AT[key] }));

test("every stage column holds exactly the people at that stage, under its own name, with its own count", { timeout: 120_000 }, async () => {
  const page = await openHiring(lab, freshState({ apps: STAGE_PEOPLE }));
  assert.deepEqual(await columnNames(page), STAGES.map(([, name]) => name), "the eleven column names, in the funnel's order");
  const columns = page.locator("#board .col");
  assert.equal(await columns.count(), 11);
  for (const [i, [key, name]] of STAGES.entries()) {
    const column = columns.nth(i);
    assert.equal(await column.locator(".cn span:first-child").textContent(), name);
    assert.equal(await column.locator(".cc").textContent(), "1", `${name} must count its one person`);
    assert.deepEqual(await column.locator(".ccard .nm span:last-child").allTextContents(), [`Person ${key}`],
      `${name} holds the wrong people`);
  }
  // A closed application sits in its closing column and reads as closed.
  assert.equal(await columns.nth(9).locator(".ccard").first().evaluate((el) => el.classList.contains("closed")), true);
  assert.equal(await columns.nth(1).locator(".ccard").first().evaluate((el) => el.classList.contains("closed")), false);
  await page.close();

  // Two in one stage and none in the others: the count is that stage's own, and an empty column says so.
  const crowd = [candidate("Two A", "closer", "ads", "ramp", { status: "hired" }), candidate("Two B", "setter", "ads", "ramp", { status: "hired" })];
  const second = await openHiring(lab, freshState({ apps: crowd }));
  const ramp = second.locator("#board .col").nth(7);
  assert.equal(await ramp.locator(".cc").textContent(), "2");
  assert.deepEqual((await ramp.locator(".ccard .nm span:last-child").allTextContents()).sort(), ["Two A", "Two B"]);
  assert.equal(await second.locator("#board .col").nth(6).locator(".cc").textContent(), "0");
  assert.match(await second.locator("#board .col").nth(10).textContent(), /nothing puts a candidate\s*in this stage yet/);
  assert.match(await second.locator("#board .col").nth(1).textContent(), /nothing here/);
  await second.close();
});


test("Reset filters puts every filter, rail and select back to its starting value", { timeout: 120_000 }, async () => {
  const state = freshState();
  const page = await openHiring(lab, state);
  const onButton = (selector) => page.locator(`${selector} button.on`).first().textContent();
  await page.locator("details.reports > summary").click();
  // Move every one of them off its starting value, the ones inside the folded reports as well.
  await page.locator("#fRole").selectOption("closer");
  await page.locator("#fSource").selectOption("ads");
  await page.locator("#fFlagged").click();
  await page.locator("#stageRail button", { hasText: "Group Interview" }).click();
  await page.locator("#postStateRail button", { hasText: "failed" }).click();
  await page.locator("#postChannelRail button", { hasText: "job_board" }).click();
  await page.locator("#fnRole").selectOption("setter");
  await page.locator("#fnDays").selectOption("30");
  await page.locator("#dcRole").selectOption("closer");
  await page.locator("#dcDays").selectOption("30");
  await page.locator("#dcRail button", { hasText: /^reject/ }).click();
  assert.equal((await columnNames(page)).length, 1);
  assert.match(await onButton("#postStateRail"), /^failed/);
  assert.match(await onButton("#postChannelRail"), /^job_board/);
  assert.match(await onButton("#dcRail"), /^reject/);
  assert.equal(await page.locator("#fnDays").inputValue(), "30");
  assert.equal(await page.locator("#dcRole").inputValue(), "closer");
  assert.equal(await page.locator("#dcDays").inputValue(), "30");
  assert.equal(await page.locator("#fFlagged").evaluate((el) => el.classList.contains("on")), true);

  await page.locator("#resetBtn").click();
  await page.waitForFunction(() => /^90d window/.test(document.getElementById("fnWindow").textContent));
  assert.equal(await page.locator("#fRole").inputValue(), "");
  assert.equal(await page.locator("#fSource").inputValue(), "");
  assert.equal(await page.locator("#fnRole").inputValue(), "");
  assert.equal(await page.locator("#fnDays").inputValue(), "90");
  assert.equal(await page.locator("#dcRole").inputValue(), "");
  assert.equal(await page.locator("#dcDays").inputValue(), "90");
  assert.equal(await page.locator("#fFlagged").getAttribute("aria-pressed"), "false");
  assert.equal(await page.locator("#fFlagged").evaluate((el) => el.classList.contains("on")), false);
  // Every rail is back on its "all" button.
  assert.match(await onButton("#stageRail"), /^all stages/);
  assert.match(await onButton("#postStateRail"), /^all states/);
  assert.match(await onButton("#postChannelRail"), /^all channels/);
  assert.match(await onButton("#dcRail"), /^all/);
  assert.equal((await columnNames(page)).length, 11);
  assert.equal((await boardNames(page)).length, 6);
  assert.equal(await page.locator("#postTbl tbody tr.rowbtn").count(), 4);
  // The funnel was read again for the starting window and no role.
  assert.deepEqual(state.funnelCalls.at(-1), { days: "90", limit: "200" });
  await page.close();
});


test("a card and a waiting-on-a-person row (click or Enter) open that candidate's drawer", { timeout: 120_000 }, async () => {
  const state = freshState();
  const page = await openHiring(lab, state);
  const drawerOn = () => page.waitForFunction(() => document.getElementById("drawer").classList.contains("on"));
  const drawerOff = async () => {
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.getElementById("drawer").classList.contains("on"));
  };
  const titleIs = (name) => page.waitForFunction((n) => document.getElementById("dwTitle").textContent === n, name);

  await page.locator(`#board .ccard[data-app="${AVA.application_id}"]`).click();
  await drawerOn();
  assert.equal(await text(page, "#dwTitle"), "Ava Reed");
  assert.ok(state.applicationReads.includes(AVA.application_id), "the full application is read on demand");
  await drawerOff();

  // The waiting table lists the two people who need a person: Ben (a flag) and Cy (no score). Each row opens
  // ITS OWN candidate, by click and by Enter, so a row that opened the first person for everyone is seen.
  assert.equal(await page.locator("#rqTbl tbody tr[data-app]").count(), 2);
  assert.match(await text(page, "#rqCount"), /^2 waiting · 2 open/);
  const rowOf = (app) => page.locator(`#rqTbl tbody tr[data-app="${app.application_id}"]`);
  const order = await page.locator("#rqTbl tbody tr[data-app]").evaluateAll((els) => els.map((el) => el.getAttribute("data-app")));
  assert.equal(order.length, 2);
  const [firstId, secondId] = order;
  const byId = new Map(APPS.map((a) => [a.application_id, a]));

  await rowOf(byId.get(secondId)).click();
  await titleIs(byId.get(secondId).full_name);
  await drawerOff();
  await rowOf(byId.get(firstId)).click();
  await titleIs(byId.get(firstId).full_name);
  await drawerOff();

  for (const id of [secondId, firstId]) {
    await rowOf(byId.get(id)).focus();
    await page.keyboard.press("Enter");
    await titleIs(byId.get(id).full_name);
    assert.equal(await page.locator("#drawer").getAttribute("aria-hidden"), "false");
    await drawerOff();
  }
  // Space opens it too, and the full application is fetched asynchronously.
  // Wait for that exact request: titleIs only waits for the synchronous drawer header,
  // so reading the last API call immediately can race with the intercepted response.
  const readsBeforeSpace = state.applicationReads.filter((id) => id === secondId).length;
  await rowOf(byId.get(secondId)).focus();
  const spaceRead = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === "/api/hiring/application" && url.searchParams.get("id") === secondId;
  }, { timeout: 15_000 });
  await page.keyboard.press(" ");
  await spaceRead;
  await titleIs(byId.get(secondId).full_name);
  assert.ok(
    state.applicationReads.filter((id) => id === secondId).length > readsBeforeSpace,
    "Space must fetch the opened candidate's application"
  );
  await page.close();
});

test("candidate drawer formats US phone labels and preserves international or incomplete numbers", { timeout: 120_000 }, async () => {
  const cases = [
    { application: { ...AVA, phone: "+1 (602) 555-0101" }, label: "(602) 555-0101" },
    { application: { ...BEN, phone: "+44 20 7946 0958" }, label: "+44 20 7946 0958" },
    { application: { ...CY, phone: "Ask for number" }, label: "Ask for number" }
  ];
  const state = freshState({ apps: cases.map(({ application }) => application) });
  const page = await openHiring(lab, state);
  try {
    for (const { application, label } of cases) {
      await page.locator(`#board .ccard[data-app="${application.application_id}"]`).click();
      await page.waitForFunction(expected =>
        document.querySelector("#dwBody .kv > div:nth-child(2) .v")?.textContent === expected,
      label);
      assert.equal(await text(page, "#dwBody .kv > div:nth-child(2) .v"), label);
      await page.locator("#dwClose").click();
      await page.waitForFunction(() => !document.getElementById("drawer").classList.contains("on"));
    }
    assert.deepEqual(state.decides, [], "reading a phone label does not save a decision");
  } finally { await page.close(); }
});

test("a late application response cannot replace another candidate with the same displayed name", { timeout: 120_000 }, async () => {
  const first = candidate("Jordan Rivers", "setter", "social", "applied", {
    answers: { why: "OLDER-APPLICANT-PRIVATE-ANSWER" }
  });
  const second = candidate("Jordan Rivers", "closer", "ads", "screening", {
    answers: { why: "CURRENT-APPLICANT-CORRECT-ANSWER" }
  });
  let releaseOlder;
  const holdOlder = new Promise((resolve) => { releaseOlder = resolve; });
  const state = freshState({ apps: [first, second], applicationWaits: { [first.application_id]: holdOlder } });
  const page = await openHiring(lab, state);
  const isApplication = (resource, id) => {
    const url = new URL(resource.url());
    return url.pathname === "/api/hiring/application" && url.searchParams.get("id") === id;
  };
  try {
    const firstRequest = page.waitForRequest((request) => isApplication(request, first.application_id));
    await page.locator(`#board .ccard[data-app="${first.application_id}"]`).click();
    await firstRequest; // full response remains pending
    await page.locator("#dwClose").click();
    await page.locator(`#board .ccard[data-app="${second.application_id}"]`).click();
    await page.locator("#dwBody").getByText("CURRENT-APPLICANT-CORRECT-ANSWER").waitFor();
    assert.equal(await text(page, "#dwTitle"), "Jordan Rivers");

    // Release the older response only after the correct second applicant is shown.
    const staleResponse = page.waitForResponse((response) => isApplication(response, first.application_id));
    releaseOlder();
    await staleResponse;
    await page.waitForTimeout(75); // flush the incoming JSON and drawer render microtasks
    assert.match(await text(page, "#dwBody"), /CURRENT-APPLICANT-CORRECT-ANSWER/);
    assert.doesNotMatch(await text(page, "#dwBody"), /OLDER-APPLICANT-PRIVATE-ANSWER/);
    assert.match(await text(page, "#dwSub"), new RegExp(second.application_id));
  } finally {
    releaseOlder();
    await page.close();
  }
});

test("drawer closes from the X button, a click on the scrim, and the Escape key", { timeout: 120_000 }, async () => {
  const page = await openHiring(lab, freshState());
  const open = async () => {
    await page.locator(`#board .ccard[data-app="${AVA.application_id}"]`).click();
    await page.waitForFunction(() => document.getElementById("drawer").classList.contains("on"));
    assert.equal(await page.locator("#drawer").getAttribute("aria-hidden"), "false");
  };
  const closed = async () => {
    await page.waitForFunction(() => !document.getElementById("drawer").classList.contains("on")
      && !document.getElementById("scrim").classList.contains("on"));
    assert.equal(await page.locator("#drawer").getAttribute("aria-hidden"), "true");
    assert.equal(await page.locator("#drawer").getAttribute("inert"), "");
  };

  await open();
  await page.locator("#dwClose").click();
  await closed();

  await open();
  await page.mouse.click(400, 450); // the dimmed page between the rail and the drawer
  await closed();

  await open();
  await page.keyboard.press("Escape");
  await closed();
  await page.close();
});

test("drawer Advance lists the stages up to Hired and sends the chosen stage and reason", { timeout: 120_000 }, async () => {
  const state = freshState();
  const page = await openHiring(lab, state);
  await page.locator(`#board .ccard[data-app="${AVA.application_id}"]`).click();
  await page.locator("#dcStage").waitFor();
  // She is at Screening, so the list starts after it and stops at Hired.
  assert.deepEqual(await page.locator("#dcStage option").evaluateAll((els) => els.map((el) => el.value)),
    ["group_interview", "one_on_one", "offer", "hired"]);
  await page.locator("#dcStage").selectOption("one_on_one");
  await page.locator("#dcReason").fill("  Strong answers on the call  ");
  await page.locator("#dcAdvance").click();
  await page.waitForFunction(() => /Saved/.test(document.getElementById("dcMsg")?.textContent || ""));
  assert.deepEqual(state.decides, [{
    application_id: AVA.application_id, action: "advance", to_stage: "one_on_one", reason: "Strong answers on the call"
  }]);
  await page.close();
});

test("drawer Advance with no reason sends a null reason", { timeout: 120_000 }, async () => {
  const state = freshState();
  const page = await openHiring(lab, state);
  await page.locator(`#board .ccard[data-app="${DI.application_id}"]`).click();
  await page.locator("#dcStage").waitFor();
  assert.deepEqual(await page.locator("#dcStage option").evaluateAll((els) => els.map((el) => el.value)), ["hired"]);
  await page.locator("#dcAdvance").click();
  await page.waitForFunction(() => /Saved/.test(document.getElementById("dcMsg")?.textContent || ""));
  assert.deepEqual(state.decides, [{ application_id: DI.application_id, action: "advance", to_stage: "hired", reason: null }]);
  await page.close();
});

test("drawer Reject needs a written reason, asks to confirm, and sends nothing when she says no", { timeout: 120_000 }, async () => {
  const state = freshState();
  const page = await openHiring(lab, state);
  const dialogs = [];
  let answer = false;
  page.on("dialog", async (dialog) => {
    dialogs.push(dialog.message());
    if (answer) await dialog.accept(); else await dialog.dismiss();
  });
  await page.locator(`#board .ccard[data-app="${BEN.application_id}"]`).click();
  await page.locator("#dcReject").waitFor();

  // No reason: a sentence, no question, nothing sent.
  await page.locator("#dcReject").click();
  assert.match(await text(page, "#dcMsg"), /Write a reason first/);
  assert.deepEqual(dialogs, []);
  assert.deepEqual(state.decides, []);

  // A reason: she is asked, and says no.
  await page.locator("#dcReason").fill("No sales background shown");
  await page.locator("#dcReject").click();
  assert.equal(dialogs.length, 1);
  assert.match(dialogs[0], /Reject this candidate\?/);
  assert.deepEqual(state.decides, []);

  // She says yes: the reason goes with the rejection.
  answer = true;
  await page.locator("#dcReject").click();
  await page.waitForFunction(() => /Saved/.test(document.getElementById("dcMsg")?.textContent || ""));
  assert.deepEqual(state.decides, [{ application_id: BEN.application_id, action: "reject", reason: "No sales background shown" }]);
  await page.close();
});

test("a closed application offers no Advance and no Reject, and says why", { timeout: 120_000 }, async () => {
  const page = await openHiring(lab, freshState());
  await page.locator(`#board .ccard[data-app="${ED.application_id}"]`).click();
  await page.waitForFunction(() => /so it is closed/.test(document.getElementById("dwBody")?.textContent || ""));
  assert.match(await text(page, "#dwBody"), /This application is rejected, so it is closed/);
  assert.equal(await page.locator("#dcAdvance").count(), 0);
  assert.equal(await page.locator("#dcReject").count(), 0);
  await page.close();
});

test("postings rails filter by state and by channel, show the counts, and a row opens and closes its detail", { timeout: 120_000 }, async () => {
  const page = await openHiring(lab, freshState());
  const titles = async () => (await page.locator("#postTbl tbody tr.rowbtn td:first-child b").allTextContents()).sort();

  const stateRail = page.locator("#postStateRail button");
  assert.deepEqual(await stateRail.allTextContents().then((all) => all.map((t) => t.trim())),
    ["all states4", "draft1", "posted1", "paused0", "closed1", "failed1"]);
  const channelRail = page.locator("#postChannelRail button");
  assert.deepEqual(await channelRail.allTextContents().then((all) => all.map((t) => t.trim())),
    ["all channels4", "linkedin1", "facebook0", "job_board1", "internal2"]);

  await stateRail.filter({ hasText: "failed" }).click();
  assert.deepEqual(await titles(), ["Coordinator board ad"]);
  await stateRail.filter({ hasText: "all states" }).click();
  await channelRail.filter({ hasText: "internal" }).click();
  assert.deepEqual(await titles(), ["Closer, filled", "Setter, draft"]);
  // Both rails together: internal AND closed.
  await stateRail.filter({ hasText: "closed" }).click();
  assert.deepEqual(await titles(), ["Closer, filled"]);
  await stateRail.filter({ hasText: "paused" }).click();
  assert.match(await text(page, "#postTbl tbody"), /No postings match this filter/);
  await stateRail.filter({ hasText: "all states" }).click();
  await channelRail.filter({ hasText: "all channels" }).click();
  assert.equal((await titles()).length, 4);

  // Row detail: click opens, click closes, Enter and Space toggle.
  const failed = page.locator("#postTbl tbody tr.rowbtn", { hasText: "Coordinator board ad" });
  const detail = failed.locator("xpath=following-sibling::tr[1]");
  assert.equal(await failed.getAttribute("aria-expanded"), "false");
  assert.equal(await detail.isHidden(), true);
  await failed.click();
  assert.equal(await failed.getAttribute("aria-expanded"), "true");
  assert.equal(await detail.isVisible(), true);
  assert.match(await detail.textContent(), /Board said: invalid company id 4471/);
  await failed.click();
  assert.equal(await failed.getAttribute("aria-expanded"), "false");
  assert.equal(await detail.isHidden(), true);
  await failed.focus();
  await page.keyboard.press("Enter");
  assert.equal(await failed.getAttribute("aria-expanded"), "true");
  await page.keyboard.press(" ");
  assert.equal(await failed.getAttribute("aria-expanded"), "false");
  await page.close();
});


test("the reports fold is closed until asked, and holds both the funnel and the decisions tables", { timeout: 120_000 }, async () => {
  const page = await openHiring(lab, freshState());
  const reports = page.locator("details.reports");
  assert.equal(await reports.evaluate((el) => el.open), false);
  assert.equal(await page.locator("#fnTbl").isVisible(), false);
  assert.equal(await page.locator("#dcTbl").isVisible(), false, "the decisions table must be inside the fold too");
  await page.locator("details.reports > summary").click();
  assert.equal(await reports.evaluate((el) => el.open), true);
  assert.equal(await page.locator("#fnTbl").isVisible(), true);
  assert.equal(await page.locator("#dcTbl").isVisible(), true);
  // Both tables really sit inside the fold, not merely beside it.
  assert.equal(await reports.evaluate((el) => el.contains(document.getElementById("fnTbl")) && el.contains(document.getElementById("dcTbl"))), true);
  await page.locator("details.reports > summary").click();
  assert.equal(await reports.evaluate((el) => el.open), false);
  assert.equal(await page.locator("#fnTbl").isVisible(), false);
  assert.equal(await page.locator("#dcTbl").isVisible(), false);
  await page.close();
});

// The funnel and decision log use one shared page-load clock. Build the fixture dates from that clock, but
// first prove that it is today's clock so the old fixed-date bug cannot pass this test.
test("the funnel re-reads for its role and days; the decision log filters by kind, role and window", { timeout: 120_000 }, async () => {
  const page0 = await openHiring(lab, freshState());
  const pageNow = await page0.evaluate(() => NOW.getTime());
  assert.ok(Math.abs(Date.now() - pageNow) < 60_000, "the selected day windows must start from the real page-load time");
  await page0.close();
  const at = (daysAgo) => {
    const d = new Date(pageNow - daysAgo * 86_400_000);
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} 10:00`;
  };
  const decisions = [
    decisionRow("dec-a", "advance", at(5), "closer"),
    decisionRow("dec-b", "reject", at(10), "setter", { reason: "No sales background shown", followed_recommendation: false }),
    decisionRow("dec-c", "advance", at(120), "closer"),
    decisionRow("dec-d", "offer", at(3), "closer", { to_stage_key: "offer" }),
    decisionRow("dec-e", "advance", at(400), "setter")
  ];
  const state = freshState({
    decisions,
    funnel: ({ role, days }) => [{
      source: "referral", role_key: role || "closer", applications: Number(days) === 30 ? 2 : 4,
      reached_group_interview: 1, reached_one_on_one: 1, reached_offer: 0, hired: 1, rejected: 0, hire_rate_pct: 50
    }]
  });
  const page = await openHiring(lab, state);
  await page.locator("details.reports > summary").click();

  // Funnel: the role alone re-reads it, the days alone re-read it, and what comes back is what is painted.
  assert.deepEqual(await page.locator("#fnDays option").evaluateAll((els) => els.map((el) => el.value)), ["30", "90", "180", "365", "730"]);
  await page.waitForFunction(() => /^90d window · 1 groups · 4 applications$/.test(document.getElementById("fnWindow").textContent)
    && document.querySelector("#fnTbl tbody tr td:nth-child(2)")?.textContent === "Closer");
  const before = state.funnelCalls.length;
  const isSetterRead = (request) => {
    const url = new URL(request.url());
    return url.pathname === "/api/hiring/funnel" && url.searchParams.get("days") === "90" && url.searchParams.get("role") === "setter";
  };
  let releaseSetterRead;
  const holdSetterRead = new Promise(resolve => { releaseSetterRead = resolve; });
  await page.route("**/api/hiring/funnel?**", async route => {
    if (isSetterRead(route.request())) await holdSetterRead;
    await route.fallback();
  });
  const setterRequest = page.waitForRequest(isSetterRead, { timeout: 15_000 });
  const setterResponse = page.waitForResponse(response => isSetterRead(response.request()), { timeout: 15_000 });
  await page.locator("#fnRole").selectOption("setter");
  await setterRequest;
  try {
    // The old "1 groups" label is still visible while the new read is held:
    // that text alone must never count as the Setter response being painted.
    assert.match(await text(page, "#fnWindow"), /^90d window · 1 groups · 4 applications$/);
    assert.equal(await text(page, "#fnTbl tbody tr td:nth-child(2)"), "Closer");
    assert.equal(state.funnelCalls.length, before);
  } finally { releaseSetterRead(); }
  await setterResponse;
  await page.waitForFunction(() => /^90d window · 1 groups · 4 applications$/.test(document.getElementById("fnWindow").textContent)
    && document.querySelector("#fnTbl tbody tr td:nth-child(2)")?.textContent === "Setter");
  assert.deepEqual(state.funnelCalls.at(-1), { days: "90", role: "setter", limit: "200" });
  assert.equal(state.funnelCalls.length, before + 1, "choosing a role must read the funnel once");
  await page.locator("#fnDays").selectOption("30");
  await page.waitForFunction(() => /^30d window · 1 groups · 2 applications$/.test(document.getElementById("fnWindow").textContent));
  assert.deepEqual(state.funnelCalls.at(-1), { days: "30", role: "setter", limit: "200" });
  assert.match(await text(page, "#fnTbl tbody"), /^ReferralSetter21101050\.0%$/);

  // Decision log at 90 days: the four inside it, not the 120 and 400 days old ones.
  const rows = async () => (await page.locator("#dcTbl tbody tr.rowbtn td:first-child .sub").allTextContents()).sort();
  assert.deepEqual(await rows(), ["dec-a", "dec-b", "dec-d"]);
  assert.match(await text(page, "#dcSummary"), /1\s*of\s*3\s*=\s*33\.3%/);
  // Every kind the rail offers narrows to its own rows: the three producers have rows, the four that nothing
  // produces are marked and show zero.
  const kind = (name) => page.locator("#dcRail button", { hasText: new RegExp(`^${name}`) });
  await kind("advance").click();
  assert.deepEqual(await rows(), ["dec-a"]);
  await kind("reject").click();
  assert.deepEqual(await rows(), ["dec-b"]);
  await kind("offer").first().click();
  assert.deepEqual(await rows(), ["dec-d"]);
  for (const empty of ["offer_accepted", "offer_declined", "withdraw", "hold"]) {
    await kind(empty).click();
    assert.deepEqual(await rows(), [], `${empty} has no rows`);
    assert.match(await text(page, "#dcRail"), new RegExp(`${empty} ∅\\s*0`));
  }
  await kind("all").first().click();
  // The rail counts follow the window and the role, not the kind.
  assert.match(await text(page, "#dcRail"), /all3/);
  // Role: closer only.
  await page.locator("#dcRole").selectOption("closer");
  assert.deepEqual(await rows(), ["dec-a", "dec-d"]);
  // Window: 30 days keeps the same two; 180 brings back the 120-day one; 365 and 730 add the 400-day one at 730.
  await page.locator("#dcDays").selectOption("30");
  assert.deepEqual(await rows(), ["dec-a", "dec-d"]);
  await page.locator("#dcDays").selectOption("180");
  assert.deepEqual(await rows(), ["dec-a", "dec-c", "dec-d"]);
  await page.locator("#dcRole").selectOption("");
  await page.locator("#dcDays").selectOption("365");
  assert.deepEqual(await rows(), ["dec-a", "dec-b", "dec-c", "dec-d"]);
  await page.locator("#dcDays").selectOption("730");
  assert.deepEqual(await rows(), ["dec-a", "dec-b", "dec-c", "dec-d", "dec-e"]);
  // A row opens its reason and closes it again.
  await page.locator("#dcDays").selectOption("90");
  await page.locator("#dcTbl tbody tr.rowbtn", { hasText: "dec-b" }).click();
  assert.match(await text(page, "#dcTbl tbody"), /No sales background shown/);
  await page.close();
});


test("only owner and admin stay on the Hiring page; every other staff role is sent to its own home", { timeout: 240_000 }, async () => {
  for (const role of ["owner", "admin"]) {
    const page = await openHiring(lab, freshState(), { role });
    assert.match(new URL(page.url()).pathname, /\/app\/hiring\.html$/, `${role} must stay`);
    // Reached by address only. shell.js hides the row itself (NAV_HIDDEN) and marks it gated; a style sheet
    // rule hides it as well, so the link being invisible proves nothing about shell.js. The mark does.
    await waitForShell(page);
    const link = page.locator('#fh-side-nav a.navitem[href="hiring.html"]');
    assert.equal(await link.count(), 1, `${role}: the row is in the markup for shell.js to hide`);
    assert.equal(await link.getAttribute("data-fh-gated"), "1", `${role}: shell.js must hide the Hiring row itself`);
    assert.equal(await link.evaluate((el) => el.style.display), "none", `${role}: the row must be hidden by shell.js`);
    assert.equal(await link.isVisible(), false, `${role}: the sidebar must not show a Hiring row`);
    await page.close();
  }
  // Every other role is sent away, the two outside principals (client, affiliate) among them.
  for (const role of ["closer", "setter", "csm", "sales_manager", "funding_advisor", "inquiry_specialist", "partner", "client", "affiliate"]) {
    const page = await newStaffPage(lab, { role, api: makeApi(freshState()) });
    await page.goto(`${lab.origin}/app/hiring.html`, { waitUntil: "domcontentloaded" });
    await page.waitForURL((url) => !/\/app\/hiring\.html$/.test(url.pathname), { timeout: 30_000 });
    assert.doesNotMatch(new URL(page.url()).pathname, /hiring\.html$/, `${role} must be sent away`);
    await page.close();
  }
});

// WAITING ON YOU counts everyone who needs a person, closed or open, and says how many are still open. The
// other three tiles add up what the server sent, role by role, and the chip follows the short-by number.
test("the four tiles add up the bench rows the server sent, and the waiting tile counts closed people too", { timeout: 120_000 }, async () => {
  const bench = [
    { ...BENCH[0], bench_target: 4, bench_count: 2, bench_shortfall: 2, open_applications: 5 },
    { ...BENCH[1], bench_target: 3, bench_count: 0, bench_shortfall: 3, open_applications: 2 },
    { ...BENCH[2], bench_target: 5, bench_count: 1, bench_shortfall: 4, open_applications: 3 }
  ];
  // Ed was turned down and still carries a flag: he is waiting on a person, but he is not open.
  const edFlagged = { ...ED, flags: [FLAG] };
  const page = await openHiring(lab, freshState({ apps: [AVA, BEN, CY, DI, edFlagged, FLO], bench }));
  const tiles = await page.locator("#statRow .stat").allTextContents();
  assert.match(tiles[0], /SHORT BY\s*9\s*people, across 3 roles/);
  assert.match(tiles[1], /WAITING ON YOU\s*3\s*2 still open/);
  assert.match(tiles[2], /ON THE BENCH\s*3\s*\/ 12/);
  assert.match(tiles[3], /OPEN APPLICATIONS\s*10/);
  assert.match(await text(page, "#benchChipTxt"), /bench 3 \/ 12/);
  assert.match(await page.locator("#benchChip").getAttribute("class"), /\bbad\b/, "9 short is far short: the chip is red");
  const roles = (await page.locator("#benchTbl tbody tr").allTextContents()).join("|");
  assert.match(roles, /Closer\s*2\s*\/ 4\s*target for this role\s*2\s*5/);
  assert.match(roles, /Setter\s*0\s*\/ 3\s*target for this role\s*3\s*2/);
  assert.match(roles, /Sales Coordinator\s*1\s*\/ 5\s*target for this role\s*4\s*3/);
  await page.close();

  // Every role at target: nothing short, the chip is calm, and the page says so in words.
  const full = bench.map((row) => ({ ...row, bench_count: row.bench_target, bench_shortfall: 0, short: false }));
  const calm = await openHiring(lab, freshState({ bench: full }));
  const calmTiles = await calm.locator("#statRow .stat").allTextContents();
  assert.match(calmTiles[0], /SHORT BY\s*0/);
  assert.match(calmTiles[2], /ON THE BENCH\s*12\s*\/ 12/);
  assert.match(await calm.locator("#benchChip").getAttribute("class"), /\bon\b/);
  assert.match(await text(calm, "#deriv"), /None\. Every role is at target\./);
  await calm.close();
});

