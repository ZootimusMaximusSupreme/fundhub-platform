// Batch 12, repair cycle 1: what the Hiring board PAINTS.
// Practice test means a real page in Chromium, fake /api answers shaped exactly like the saved reads, and a
// judgement of the words and numbers on the screen. Nothing here reads live data.
//
// The live checks for this board read the saved applications. They cannot see a bench row that prints the
// wrong number, a column that holds the wrong people, or a drawer that opens the wrong application. These
// tests can: the page is given applications in several stages, and every cell is judged against a count made
// here from those rows, not copied from the page.

import { test } from "node:test";
import assert from "node:assert/strict";

import { OWNER, json, startScreens } from "./s4-screen-harness.mjs";
import { proofRows } from "./fin-b12-kit.mjs";

const proof = proofRows(import.meta.url);

const STAGE_NAME = {
  applied: "Applied", screening: "Screening", group_interview: "Group Interview", one_on_one: "1:1 Interview", offer: "Offer",
};
const SORT = { applied: 0, screening: 1, group_interview: 2, one_on_one: 3, offer: 4 };
const ROLE_NAME = { closer: "Closer", setter: "Setter", sales_coordinator: "Sales Coordinator" };

const FLAG = { key: "income_goal_mismatch", label: "Stated income goal is far outside the role’s OTE — confirm expectations" };

let n = 0;
/** One row, shaped as GET /api/hiring/candidates returns it (api/hiring/candidates.mjs). */
function app(name, role, stage, over = {}) {
  n += 1;
  const slug = name.toLowerCase().replace(/[^a-z]+/g, ".");
  return {
    application_id: `app-${String(n).padStart(3, "0")}`, status: "open",
    applied_at: "2026-10-01T09:00:00Z", entered_stage_at: `2026-10-${String(10 - (n % 8)).padStart(2, "0")}T09:00:00Z`,
    candidate_id: `cand-${n}`, full_name: name, email: `${slug}@example.com`, phone: `+1 602 555 01${String(n).padStart(2, "0")}`,
    source: "referral", source_detail: `Referred by person ${n}`, disc_profile: null, linkedin_profile_url: null,
    role_key: role, role_name: ROLE_NAME[role], stage_key: stage, stage_name: STAGE_NAME[stage], sort_order: SORT[stage],
    average: 3.4, recommendation: "advance", flags: [], rubric_version: 1, is_automated: true,
    has_video: true, has_resume: true, recommendation_status: "advisory — a human decides", ...over,
  };
}

const APPS = [
  app("Priya Raghunathan", "closer", "applied", { average: 3.4, recommendation: "advance", has_video: true, has_resume: true }),
  app("Marcus Boone", "closer", "applied", { average: null, recommendation: null, has_video: false, has_resume: false, source: "client_base", source_detail: "Card Stacking client" }),
  app("Sam Ortega", "setter", "applied", { average: 2.1, recommendation: "review_likely_no", flags: [FLAG], is_automated: false, has_video: true, has_resume: false, disc_profile: "DI", linkedin_profile_url: "https://www.linkedin.com/in/sam-ortega" }),
  app("Lee Park", "closer", "group_interview", { average: 3.0 }),
  app("Kim Doe", "closer", "one_on_one", { average: 3.8, recommendation: "advance_priority" }),
  app("Ali Noor", "setter", "offer", { average: 3.6 }),
  app("Rae Closed", "closer", "applied", { status: "rejected", average: 1.5, recommendation: "review_likely_no" }),
];
const DRAWER_PHONE = {
  "Sam Ortega": "(602) 555-0103",
  "Priya Raghunathan": "(602) 555-0101",
  "Marcus Boone": "(602) 555-0102",
};

const open = (r, s) => APPS.filter((a) => a.role_key === r && a.status === "open" && (!s || a.stage_key === s));
const benchOf = (role, target, manager) => {
  const onBench = open(role).filter((a) => a.stage_key === "one_on_one" || a.stage_key === "offer").length;
  return {
    role_key: role, role_name: ROLE_NAME[role], bench_target: target, bench_count: onBench,
    bench_shortfall: Math.max(target - onBench, 0), open_applications: open(role).length,
    hiring_manager: manager, short: target - onBench > 0, unrouted: manager === null,
    awaiting_screen: open(role, "applied").length, awaiting_group_interview: open(role, "group_interview").length,
  };
};
// What the server's bench read gives: the roles in order, the biggest shortfall first. Sales coordinator is full.
const BENCH = [
  benchOf("closer", 4, null),
  benchOf("setter", 4, "Casey Reed"),
  { role_key: "sales_coordinator", role_name: "Sales Coordinator", bench_target: 2, bench_count: 2, bench_shortfall: 0, open_applications: 2,
    hiring_manager: null, short: false, unrouted: true, awaiting_screen: 0, awaiting_group_interview: 0 },
];

function application(a) {
  return {
    ok: true, application_id: a.application_id, status: a.status, answers: { why_this_role: "I want to close funding offers.", years_selling: "6" },
    applied_at: a.applied_at, entered_stage_at: a.entered_stage_at, video_url: a.has_video ? `https://video.example.com/${a.application_id}` : null,
    has_resume: a.has_resume, candidate_id: a.candidate_id, full_name: a.full_name, email: a.email, phone: a.phone,
    source: a.source, source_detail: a.source_detail, disc_profile: a.disc_profile, linkedin_profile_url: a.linkedin_profile_url, notes: null,
    role_key: a.role_key, role_name: a.role_name, stage_key: a.stage_key, stage_name: a.stage_name,
    posting_title: null, posting_channel: null,
    scores: a.average === null ? [] : [{
      id: `score-${a.application_id}`, stage_key: "applied", rubric_version: a.rubric_version,
      category_scores: { effort: 3, honesty: 3, income_goal_fit: 3, relevant_experience: 3, sales_inputs: 3, work_history: 3 },
      average: a.average, recommendation: a.recommendation, flags: a.flags, is_automated: a.is_automated,
      created_at: "2026-10-02T06:00:00Z", scored_by_name: a.is_automated ? null : "Casey Reed",
    }],
    interviews: [], decisions: [],
  };
}

function board() {
  const page = (items) => ({ ok: true, count: items.length, limit: 200, offset: 0, hasMore: false, items });
  const log = { drawer: [] };
  return {
    log,
    handlers: {
      "/api/demo/mode": async (route) => json(route, { ok: true, demo_mode_enabled: false, primary_client_id: null }),
      "/api/hiring/candidates": async (route) => json(route, page(APPS)),
      "/api/hiring/bench": async (route) => json(route, page(BENCH)),
      "/api/hiring/postings": async (route) => json(route, page([])),
      "/api/hiring/decisions": async (route) => json(route, page([])),
      "/api/hiring/funnel": async (route) => json(route, { ok: true, items: [], stages: [] }),
      "/api/hiring/application": async (route, { url }) => {
        const id = new URL(url).searchParams.get("id");
        log.drawer.push(id);
        const found = APPS.find((a) => a.application_id === id);
        return found ? json(route, application(found)) : json(route, { ok: false, error: "not_found" }, 404);
      },
    },
  };
}

async function openBoard(open) {
  const fake = board();
  const { page, errors } = await open("/app/hiring.html", { session: OWNER, handlers: fake.handlers });
  await page.waitForFunction(() => document.querySelectorAll("#board .ccard").length > 0 && document.querySelectorAll("#benchTbl tbody tr").length > 0);
  return { page, errors, fake };
}

const cells = (page, sel) => page.locator(sel).evaluateAll((rows) => rows.map((r) => [...r.children].map((c) => c.textContent.trim().replace(/\s+/g, " "))));

test("Hiring: the bench table prints each role's own bench, short-by, open, waiting and manager numbers and flags", { timeout: 90_000 }, async (t) => {
  const { open } = await startScreens(t);
  await proof.check(/^Bench table: one row per role/, async () => {
    const { page, errors } = await openBoard(open);
    const rows = await cells(page, "#benchTbl tbody tr");
    // Columns: role, bench "n / target" + note, short by, open applications, awaiting screen, awaiting group, manager, flags.
    const want = BENCH.map((b) => [
      b.role_name,
      `${b.bench_count} / ${b.bench_target}target for this role`,
      String(b.bench_shortfall),
      String(b.open_applications),
      `${b.awaiting_screen}not screened yet`,
      `${b.awaiting_group_interview}at group interview`,
      b.hiring_manager || "unassigned",
      [b.short ? "short" : null, b.unrouted ? "unrouted" : null].filter(Boolean).join(" ") || "—",
    ]);
    assert.deepEqual(rows, want, "each role's row says the bench read's own numbers, in the bench read's own order");
    // The figures the table says are the same ones worked out here from the applications on the board.
    assert.equal(BENCH[0].bench_count, open_count("closer", ["one_on_one", "offer"]));
    assert.equal(BENCH[0].awaiting_screen, open_count("closer", ["applied"]), "the rejected one is not waiting on a screen");

    // The four tiles above the table are the sums of those rows.
    const stats = await page.locator("#statRow .stat").evaluateAll((els) => els.map((e) => ({
      label: e.querySelector(".eyebrow").textContent.trim(), value: e.querySelector(".sv").textContent.replace(/\s+/g, " ").trim(),
      detail: e.querySelector(".sd").textContent.trim(),
    })));
    const sum = (k) => BENCH.reduce((total, b) => total + b[k], 0);
    const byLabel = Object.fromEntries(stats.map((s) => [s.label, s]));
    assert.equal(byLabel["SHORT BY"].value, String(sum("bench_shortfall")));
    assert.equal(byLabel["SHORT BY"].detail, `people, across ${BENCH.length} roles`);
    assert.equal(byLabel["ON THE BENCH"].value, `${sum("bench_count")} / ${sum("bench_target")}`);
    assert.equal(byLabel["OPEN APPLICATIONS"].value, String(sum("open_applications")));
    assert.deepEqual(errors.filter((e) => !/Failed to load resource/i.test(e)), []);
    await page.close();
  });
});

function open_count(role, stages) {
  return APPS.filter((a) => a.role_key === role && a.status === "open" && stages.includes(a.stage_key)).length;
}

test("Hiring: each board column holds exactly the applications in its stage, newest first, and the count says so", { timeout: 90_000 }, async (t) => {
  const { open } = await startScreens(t);
  await proof.check(/^Board column: Applied \(applied\)/, async () => {
    const { page } = await openBoard(open);
    const column = async (name) => page.locator(".col").filter({ has: page.locator(`.cn span:first-child:text-is("${name}")`) }).first();
    const names = async (col) => col.locator(".ccard .nm span:last-child").allTextContents();
    const count = async (col) => (await col.locator(".cc").textContent()).trim();

    // Applied holds the applications whose stage is Applied: three open ones and the closed one, and no one from later.
    const applied = await column("Applied");
    const inApplied = APPS.filter((a) => a.stage_key === "applied");
    assert.equal(await count(applied), String(inApplied.length), "the count is the number of cards");
    // The page orders by stage then by when they entered it, newest first.
    const expectOrder = [...inApplied].sort((x, y) => (y.entered_stage_at > x.entered_stage_at ? 1 : -1)).map((a) => a.full_name);
    assert.deepEqual((await names(applied)).map((s) => s.trim()), expectOrder, "Applied lists its own people, newest first");
    for (const later of APPS.filter((a) => a.stage_key !== "applied")) {
      assert.ok(!(await names(applied)).includes(later.full_name), `${later.full_name} (${later.stage_key}) is not in Applied`);
    }
    // Every other column holds only its own.
    for (const [stage, label] of [["group_interview", "Group Interview"], ["one_on_one", "1:1 Interview"], ["offer", "Offer"]]) {
      const col = await column(label);
      const want = APPS.filter((a) => a.stage_key === stage).map((a) => a.full_name);
      assert.deepEqual((await names(col)).map((s) => s.trim()), want, `${label} lists only its own`);
      assert.equal(await count(col), String(want.length));
    }
    // A column with nobody says so.
    const empty = await column("Screening");
    assert.equal(await count(empty), "0");
    assert.match(await empty.locator(".col-bd").innerText(), /nothing here/);
    // The stage rail counts the same people.
    const railApplied = await page.locator('#stageRail button[data-stage="applied"] .n').textContent();
    assert.equal(railApplied.trim(), String(inApplied.length));
    // A person moved to Screening leaves Applied: the same page, given the move, shows it.
    await page.close();

    const moved = APPS.map((a) => (a.full_name === "Priya Raghunathan" ? { ...a, stage_key: "screening", stage_name: "Screening", sort_order: 1 } : a));
    const fake = board();
    fake.handlers["/api/hiring/candidates"] = async (route) => json(route, { ok: true, count: moved.length, limit: 200, offset: 0, hasMore: false, items: moved });
    const second = await open("/app/hiring.html", { session: OWNER, handlers: fake.handlers });
    await second.page.waitForFunction(() => document.querySelectorAll("#board .ccard").length > 0);
    const col2 = second.page.locator(".col").filter({ has: second.page.locator('.cn span:first-child:text-is("Applied")') }).first();
    assert.ok(!(await col2.locator(".ccard .nm span:last-child").allTextContents()).map((s) => s.trim()).includes("Priya Raghunathan"));
    const scr = second.page.locator(".col").filter({ has: second.page.locator('.cn span:first-child:text-is("Screening")') }).first();
    assert.deepEqual((await scr.locator(".ccard .nm span:last-child").allTextContents()).map((s) => s.trim()), ["Priya Raghunathan"]);
    await second.page.close();
  });
});

test("Hiring: a card shows its person's own score, flags, source and video and resume tags, and opens that application", { timeout: 90_000 }, async (t) => {
  const { open } = await startScreens(t);
  await proof.check(/^Board card: click opens the application drawer/, async () => {
    const { page, fake, errors } = await openBoard(open);
    for (const a of APPS.filter((x) => x.status === "open")) {
      const card = page.locator(`.ccard[data-app="${a.application_id}"]`);
      const text = (await card.innerText()).replace(/\s+/g, " ");
      assert.ok(text.includes(a.full_name), `${a.full_name}: its own name`);
      assert.ok(text.includes(`${a.role_name} · ${a.source}`), `${a.full_name}: role and source`);
      assert.ok(text.includes(a.average === null ? "not scored" : `${a.average.toFixed(2)} / 4`), `${a.full_name}: its own score`);
      assert.ok(text.includes(a.is_automated ? "automated grader" : "scored by a person"), `${a.full_name}: who scored`);
      if (a.flags.length) assert.ok(text.includes(`⚑ ${a.flags.length} flag ${a.flags.map((f) => f.key).join(", ")}`), `${a.full_name}: its flags`);
      else assert.ok(!text.includes("⚑"), `${a.full_name}: no flag line`);
      const tags = await card.locator(".chips .tag").evaluateAll((els) => Object.fromEntries(els
        .filter((e) => /^(video|resume)$/.test(e.textContent.trim())).map((e) => [e.textContent.trim(), e.classList.contains("has")])));
      assert.deepEqual(tags, { video: a.has_video, resume: a.has_resume }, `${a.full_name}: video and resume tags`);
    }

    // Press a card: THAT application's drawer opens, asks for THAT application, and names its own details.
    for (const a of [APPS[2], APPS[0], APPS[1]]) {
      // (dispatchEvent: the narrow board overlaps neighbouring cards' tags, so a mouse press can land on the wrong one.)
      await page.locator(`.ccard[data-app="${a.application_id}"]`).dispatchEvent("click");
      await page.waitForFunction((name) => document.querySelector("#dwTitle")?.textContent === name, a.full_name);
      await page.waitForFunction((email) => (document.querySelector("#dwBody")?.innerText || "").includes(email), a.email);
      assert.equal(fake.log.drawer.at(-1), a.application_id, `${a.full_name}: the page asked for its own application`);
      const sub = (await page.locator("#dwSub").textContent()).replace(/\s+/g, " ");
      assert.ok(sub.includes(a.application_id) && sub.includes(a.role_name) && sub.includes(a.stage_name) && sub.includes(`status ${a.status}`), `${a.full_name}: sub line ${sub}`);
      const body = (await page.locator("#dwBody").innerText()).replace(/\s+/g, " ");
      assert.ok(body.includes(a.email), `${a.full_name}: email`);
      assert.ok(body.includes(DRAWER_PHONE[a.full_name]), `${a.full_name}: readable phone`);
      assert.ok(!body.includes(a.phone), `${a.full_name}: raw phone is not displayed`);
      assert.ok(body.includes(a.source) && body.includes(a.source_detail), `${a.full_name}: source`);
      assert.ok(body.includes(a.has_video ? `https://video.example.com/${a.application_id}` : "none submitted"), `${a.full_name}: video`);
      assert.ok(body.includes(a.has_resume ? "resume ✓" : "resume ✗"), `${a.full_name}: resume`);
      if (a.disc_profile) assert.ok(body.includes(a.disc_profile), `${a.full_name}: DISC`);
      if (a.linkedin_profile_url) assert.ok(body.includes(a.linkedin_profile_url), `${a.full_name}: LinkedIn`);
      if (a.average === null) assert.match(body, /SCORE HISTORY — 0 ENTRIES/i);
      else {
        assert.match(body, /SCORE HISTORY — 1 ENTRY/i);
        assert.ok(body.includes(`= ${a.average.toFixed(2)}`) || body.includes(a.average.toFixed(2)), `${a.full_name}: its own average`);
        assert.ok(body.toLowerCase().includes(a.is_automated ? "automated" : "scored by casey reed"), `${a.full_name}: who scored`);
        for (const f of a.flags) assert.ok(body.includes(f.label), `${a.full_name}: flag ${f.key}`);
      }
      await page.keyboard.press("Escape");
      await page.waitForFunction(() => document.querySelector("#drawer, .drawer")?.getAttribute("aria-hidden") === "true");
    }
    assert.deepEqual(errors.filter((e) => !/Failed to load resource/i.test(e)), []);
    await page.close();
  });
});

test("every listed row was exercised", () => {
  proof.assertAllClaimed();
});
