// Batch 13 practice tests: the Hiring desk (public/app/hiring.html).
//
// A real Chromium opens the real page from public/ with a fake API (nothing leaves this machine). Each
// test clicks the control and judges exactly what the page then shows and what it sends. These are
// practice tests with fake data, not live checks.
//
// The fake candidates, postings and decisions are made up for the test: no real person is named.

import assert from "node:assert/strict";
import test, { after, before } from "node:test";

import { fulfillJson, newStaffPage, openLab } from "./s5-browser-kit.mjs";

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
      state.applicationReads.push(url.searchParams.get("id"));
      const found = state.apps.find((a) => a.application_id === url.searchParams.get("id"));
      return { ok: true, ...found, answers: { why: "Wants the work" }, video_url: null, scores: [], interviews: [], decisions: [] };
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

test("summary tiles drop Demo Mode rows from every number and say how many were left out", { timeout: 120_000 }, async () => {
  // Three demo rows, each marked a different way: both signs, only the seeder's source_detail, only the DEMO name.
  const demoBoth = candidate("DEMO Candidate — Juniper Vale", "closer", "inbound", "applied", {
    source_detail: "platform_demo", average: null, recommendation: "incomplete"
  });
  const demoByDetail = candidate("Gus Hale", "closer", "inbound", "applied", {
    source_detail: "platform_demo", average: null, recommendation: "incomplete"
  });
  const demoByName = candidate("DEMO Candidate — Cedar Holt", "closer", "inbound", "applied", {
    average: null, recommendation: "incomplete"
  });
  const demos = [demoBoth, demoByDetail, demoByName];
  // The server counts the demo applications with the real ones: 2 real open closers plus the 3 demo.
  const bench = BENCH.map((row) => (row.role_key === "closer" ? { ...row, open_applications: 5, awaiting_screen: 3 } : row));
  const state = freshState({ apps: [...APPS, ...demos], bench, demoMode: true });
  const page = await openHiring(lab, state);
  const tiles = await page.locator("#statRow .stat").allTextContents();
  assert.match(tiles[3], /OPEN APPLICATIONS\s*4/, "the demo applications must not be counted");
  assert.match(tiles[3], /3 demo rows not counted/);
  assert.match(tiles[1], /WAITING ON YOU\s*2/, "the demo rows are not waiting on anybody");
  // Demo rows stay on the board with their label.
  for (const demo of demos) {
    const card = page.locator(`#board .ccard[data-app="${demo.application_id}"]`);
    await card.waitFor();
    assert.match(await card.textContent(), /demo row/, `${demo.full_name} lost its label`);
  }
  assert.match(await text(page, "#boardCount"), /6 applications shown · 3 demo/);
  await page.close();

  // Demo mode off: the same rows are hidden and the page says how many.
  const off = await openHiring(lab, freshState({ apps: [...APPS, ...demos], bench, demoMode: false }));
  for (const demo of demos) {
    assert.equal(await off.locator(`#board .ccard[data-app="${demo.application_id}"]`).count(), 0, `${demo.full_name} must be hidden`);
  }
  assert.match(await text(off, "#boardPager"), /3 seeded by Demo Mode and hidden because Demo Mode is off/);
  assert.match(await text(off, "#boardCount"), /3 demo hidden/);
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

test("role select, source select and the flagged-only toggle each narrow the board, and clear again", { timeout: 120_000 }, async () => {
  const page = await openHiring(lab, freshState());
  const shown = async () => (await boardNames(page)).sort();

  await page.locator("#fRole").selectOption("setter");
  assert.deepEqual(await shown(), ["Ben Cole", "Flo Gray"]);
  assert.match(await text(page, "#boardCount"), /^2 applications shown/);
  await page.locator("#fRole").selectOption("");
  assert.equal((await shown()).length, 6);

  await page.locator("#fSource").selectOption("referral");
  assert.deepEqual(await shown(), ["Ava Reed", "Ed Fox", "Flo Gray"]);
  assert.match(await text(page, "#boardCount"), /^3 applications shown/);

  // Flagged only keeps people with a flag or no score. None of the three referrals has either.
  await page.locator("#fFlagged").click();
  assert.equal(await page.locator("#fFlagged").getAttribute("aria-pressed"), "true");
  assert.deepEqual(await shown(), []);
  assert.match(await text(page, "#boardCount"), /^0 applications shown/);
  await page.locator("#fSource").selectOption("");
  assert.deepEqual(await shown(), ["Ben Cole", "Cy Dunn"]);
  await page.locator("#fFlagged").click();
  assert.equal(await page.locator("#fFlagged").getAttribute("aria-pressed"), "false");
  assert.equal((await shown()).length, 6);
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

test("Reset filters puts every filter, rail and select back to its starting value", { timeout: 120_000 }, async () => {
  const page = await openHiring(lab, freshState());
  await page.locator("details.reports > summary").click();
  await page.locator("#fRole").selectOption("closer");
  await page.locator("#fSource").selectOption("ads");
  await page.locator("#fFlagged").click();
  await page.locator("#stageRail button", { hasText: "Group Interview" }).click();
  await page.locator("#postStateRail button", { hasText: "failed" }).click();
  await page.locator("#fnRole").selectOption("setter");
  await page.locator("#dcDays").selectOption("30");
  assert.equal((await columnNames(page)).length, 1);

  await page.locator("#resetBtn").click();
  assert.equal(await page.locator("#fRole").inputValue(), "");
  assert.equal(await page.locator("#fSource").inputValue(), "");
  assert.equal(await page.locator("#fnRole").inputValue(), "");
  assert.equal(await page.locator("#fnDays").inputValue(), "90");
  assert.equal(await page.locator("#dcRole").inputValue(), "");
  assert.equal(await page.locator("#dcDays").inputValue(), "90");
  assert.equal(await page.locator("#fFlagged").getAttribute("aria-pressed"), "false");
  assert.equal((await columnNames(page)).length, 11);
  assert.equal((await boardNames(page)).length, 6);
  assert.equal(await page.locator("#postTbl tbody tr.rowbtn").count(), 4);
  await page.close();
});

test("a card and a waiting-on-a-person row (click or Enter) open that candidate's drawer", { timeout: 120_000 }, async () => {
  const state = freshState();
  const page = await openHiring(lab, state);

  await page.locator(`#board .ccard[data-app="${AVA.application_id}"]`).click();
  await page.waitForFunction(() => document.getElementById("drawer").classList.contains("on"));
  assert.equal(await text(page, "#dwTitle"), "Ava Reed");
  assert.ok(state.applicationReads.includes(AVA.application_id), "the full application is read on demand");
  await page.keyboard.press("Escape");

  // The waiting table lists the two people who need a person: Ben (a flag) and Cy (no score).
  assert.equal(await page.locator("#rqTbl tbody tr[data-app]").count(), 2);
  assert.match(await text(page, "#rqCount"), /^2 waiting · 2 open/);
  await page.locator(`#rqTbl tbody tr[data-app="${BEN.application_id}"]`).click();
  await page.waitForFunction(() => document.getElementById("dwTitle").textContent === "Ben Cole");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.getElementById("drawer").classList.contains("on"));

  const cyRow = page.locator(`#rqTbl tbody tr[data-app="${CY.application_id}"]`);
  await cyRow.focus();
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.getElementById("dwTitle").textContent === "Cy Dunn");
  assert.equal(await page.locator("#drawer").getAttribute("aria-hidden"), "false");
  await page.close();
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

test("the reports fold is closed until asked; the funnel re-reads for its role and days; the decision log filters", { timeout: 120_000 }, async () => {
  const state = freshState({
    funnel: ({ role, days }) => [{
      source: "referral", role_key: role || "closer", applications: Number(days) === 30 ? 2 : 4,
      reached_group_interview: 1, reached_one_on_one: 1, reached_offer: 0, hired: 1, rejected: 0, hire_rate_pct: 50
    }]
  });
  const page = await openHiring(lab, state);
  const reports = page.locator("details.reports");
  assert.equal(await reports.evaluate((el) => el.open), false);
  assert.equal(await page.locator("#fnTbl").isVisible(), false);
  await page.locator("details.reports > summary").click();
  assert.equal(await reports.evaluate((el) => el.open), true);
  assert.equal(await page.locator("#fnTbl").isVisible(), true);
  await page.locator("details.reports > summary").click();
  assert.equal(await reports.evaluate((el) => el.open), false);
  await page.locator("details.reports > summary").click();

  // Funnel: the role and the days go to the read, and what comes back is what is painted.
  await page.locator("#fnRole").selectOption("setter");
  await page.waitForFunction(() => /1 groups/.test(document.getElementById("fnWindow").textContent));
  await page.locator("#fnDays").selectOption("30");
  await page.waitForFunction(() => /^30d window · 1 groups · 2 applications$/.test(document.getElementById("fnWindow").textContent));
  assert.deepEqual(state.funnelCalls.at(-1), { days: "30", role: "setter", limit: "200" });
  assert.match(await text(page, "#fnTbl tbody"), /^ReferralSetter21101050\.0%$/);

  // Decision log at 90 days: the two newer rows, not the one from May.
  const rows = async () => page.locator("#dcTbl tbody tr.rowbtn td:first-child .sub").allTextContents();
  assert.deepEqual((await rows()).sort(), ["dec-a", "dec-b"]);
  assert.match(await text(page, "#dcSummary"), /1\s*of\s*2\s*=\s*50\.0%/);
  // The kind rail: reject only.
  await page.locator("#dcRail button", { hasText: /^reject/ }).click();
  assert.deepEqual(await rows(), ["dec-b"]);
  await page.locator("#dcRail button", { hasText: /^all/ }).click();
  // Role: closer only.
  await page.locator("#dcRole").selectOption("closer");
  assert.deepEqual(await rows(), ["dec-a"]);
  // Days: a wider window brings back the May row.
  await page.locator("#dcDays").selectOption("180");
  assert.deepEqual((await rows()).sort(), ["dec-a", "dec-c"]);
  // The four kinds nothing produces are on the rail, marked, and show zero.
  assert.match(await text(page, "#dcRail"), /offer_accepted ∅\s*0/);
  // A row opens its reason and closes it again.
  await page.locator("#dcRole").selectOption("");
  await page.locator("#dcDays").selectOption("90");
  await page.locator("#dcTbl tbody tr.rowbtn", { hasText: "dec-b" }).click();
  assert.match(await text(page, "#dcTbl tbody"), /No sales background shown/);
  await page.close();
});

test("only owner and admin stay on the Hiring page; every other staff role is sent to its own home", { timeout: 180_000 }, async () => {
  for (const role of ["owner", "admin"]) {
    const page = await openHiring(lab, freshState(), { role });
    assert.match(new URL(page.url()).pathname, /\/app\/hiring\.html$/, `${role} must stay`);
    // Reached by address only: the row is hidden from the rail.
    const link = page.locator('#fh-side-nav a.navitem[href="hiring.html"]');
    assert.equal(await link.isVisible(), false, `${role}: the sidebar must not show a Hiring row`);
    await page.close();
  }
  for (const role of ["closer", "setter", "csm", "sales_manager", "funding_advisor", "inquiry_specialist", "partner"]) {
    const page = await newStaffPage(lab, { role, api: makeApi(freshState()) });
    await page.goto(`${lab.origin}/app/hiring.html`, { waitUntil: "domcontentloaded" });
    await page.waitForURL((url) => !/\/app\/hiring\.html$/.test(url.pathname), { timeout: 30_000 });
    assert.doesNotMatch(new URL(page.url()).pathname, /hiring\.html$/, `${role} must be sent away`);
    await page.close();
  }
});
