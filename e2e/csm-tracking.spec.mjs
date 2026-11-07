// CSM desk — "Where each client is" (unit N, 2026-11-07).
//
// Fake clients and a stand-in API only. Nothing reaches a database, a provider
// or a phone. The nudge is checked by the request the page would send to the
// existing staff reply door (POST /api/messages); nothing is sent anywhere.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { openScreen, json, OWNER } from "./harness.mjs";

const EVIDENCE = "ops/workflows/build-evidence/csm-tracking-2026-11-07";
const ME = "5a000000-0000-4000-8000-0000000000c5";
const NOW = "2026-11-07T18:00:00Z";
const DANA = "c1000000-0000-4000-8000-000000000001";
const MARCUS = "c1000000-0000-4000-8000-000000000002";
const AMELIA = "c1000000-0000-4000-8000-000000000003";

const gate = (state, fundable, inquiries, seasoned, seasonWords) => ({
  state,
  checks: [
    { key: "fundable", label: "Fundable in UnderwriteIQ", passed: fundable, words: fundable === null ? "Not read yet" : fundable ? "6 of 6 checks · Fundable" : "4 of 6 checks · Not fundable yet" },
    { key: "no_inquiries", label: "No hard inquiries", passed: inquiries, words: inquiries === null ? "Not known yet" : inquiries ? "None on file" : "3 inquiries on file" },
    { key: "seasoned_30", label: "A bank account open 30+ days", passed: seasoned, words: seasonWords }
  ]
});

const DANA_ROW = {
  client_id: DANA, client_name: "Dana Whitfield", client_code: "FH-101", first_name: "Dana", assigned_csm_staff_id: ME, assigned_csm_name: "Casey Reed",
  steps: { total: 8, done: 3, finished: false, current: { id: "w4", title: "Pay Card A down to $400", state: "in_progress", reason: null, owner: "client", due_at: null, since: "2026-10-26T18:00:00Z", days_on_step: 12, days_late: null, reminders: null, paid_alternative: null } },
  payments: { bank_late: 1, plan_late: null, total_late: 1 },
  seasoning: { opened: 1, seasoned: 0, closest: { bank: "Chase", day: 12, of: 30 }, accounts: [{ bank: "Chase", opened_on: "2026-10-26", day: 12, of: 30, seasoned: false, better: null, next_mark: 30 }] },
  last_team_text_at: null,
  behind: [{ code: "step_stuck", words: "On the same step for 12 days" }, { code: "bank_late", words: "1 card or loan payment is late" }],
  apply_gate: gate("locked", null, null, false, "Chase is on day 12 of 30")
};
const MARCUS_ROW = {
  client_id: MARCUS, client_name: "Marcus Chen with a very long family name that has to wrap on a small phone", client_code: "FH-102", first_name: "Marcus", assigned_csm_staff_id: null, assigned_csm_name: null,
  steps: { total: 6, done: 2, finished: false, current: { id: "w9", title: "Mail the dispute letters and upload the mailing proof", state: "not_started", reason: null, owner: "client", due_at: "2026-10-28T18:00:00Z", since: "2026-10-01T18:00:00Z", days_on_step: 37, days_late: 10, reminders: "done", paid_alternative: null } },
  payments: { bank_late: null, plan_late: 1, total_late: 1 },
  seasoning: { opened: 0, seasoned: 0, closest: null, accounts: [] },
  last_team_text_at: "2026-11-05T17:00:00Z",
  behind: [{ code: "step_late", words: "Step is 10 days late. The auto reminders are done." }, { code: "plan_late", words: "1 Fundhub plan payment is late" }],
  apply_gate: gate("locked", null, null, false, "No bank account opened yet")
};
const AMELIA_ROW = {
  client_id: AMELIA, client_name: "Amelia Robinson", client_code: "FH-103", first_name: "Amelia", assigned_csm_staff_id: null, assigned_csm_name: null,
  steps: { total: 8, done: 7, finished: false, current: { id: "w8", title: "Apply at Bank of America", state: "not_started", reason: null, owner: "fundhub", due_at: null, since: "2026-11-05T18:00:00Z", days_on_step: 2, days_late: null, reminders: null, paid_alternative: null } },
  payments: { bank_late: 0, plan_late: null, total_late: 0 },
  seasoning: { opened: 1, seasoned: 1, closest: null, accounts: [{ bank: "Bank of America", opened_on: "2026-09-23", day: 45, of: 30, seasoned: true, better: null, next_mark: 60 }] },
  last_team_text_at: "2026-11-05T18:00:00Z",
  behind: [],
  apply_gate: gate("open", true, true, true, "1 account is seasoned")
};

const DANA_DETAIL = {
  ...DANA_ROW,
  steps: { ...DANA_ROW.steps, current: { ...DANA_ROW.steps.current, paid_alternative: { label: "Have us do it", price_cents: 29700 } } },
  late_accounts: [{ name: "Card A", kind: "credit" }],
  late_plans: [],
  fundability: { has_pull: true, sample: true, score: 4, score_max: 6, tier: "not_fundable", inquiries_clean: true, inquiries: 0, failing: ["Cards used 30% or less", "A card 2+ years old with a $5,000+ limit"] },
  apply_gate: gate("locked", false, true, false, "Chase is on day 12 of 30"),
  next_steps: [{ title: "Pay Card A down to $400", owner: "client" }, { title: "Open a Chase business checking account", owner: "client" }],
  drafts: {
    help: "Hi Dana, it's Chris at Fundhub. Your next step is \"Pay Card A down to $400\". Reply here and we will help you finish it.",
    call: "Hi Dana, it's Chris at Fundhub. Want to finish \"Pay Card A down to $400\" together? We can set up a paid one-on-one consulting call. Reply CALL and we will send you times and the price."
  }
};

const QUEUE_ROW = { task_id: "task-mid", client_id: DANA, client_name: "Dana Whitfield", client_code: "FH-101", title: "Halfway accountability call", source_workflow: "customer-insights-mid", due_at: "2026-11-08T15:00:00Z", owned_codes: [], balance_due: null, open_invoices: 0, assignee_staff_id: null, meeting_url: null };

function listBody(url, mode) {
  const show = url.searchParams.get("show") || "behind";
  const all = [DANA_ROW, MARCUS_ROW, AMELIA_ROW];
  const items = mode === "empty" ? [] : show === "all" ? all : all.filter((r) => r.behind.length);
  return { ok: true, view: "tracking", show, mine: url.searchParams.get("mine") === "1", total: mode === "empty" ? 0 : 3, behind_count: mode === "empty" ? 0 : 2, truncated: false, count: items.length, limit: 25, offset: 0, hasMore: false, items };
}

async function fixture(page, mode = "full", { sendAnswer = null, detailFails = 0, shift = { id: "shift-1", staff_id: ME, started_at: "2026-11-07T15:00:00Z" } } = {}) {
  const reads = [];
  const writes = [];
  let detailCalls = 0;
  await page.clock.install({ time: new Date(NOW) });
  await page.route(/^https:\/\//, (route) => route.abort());
  await openScreen(page, "/app/csm-queue.html", { ...OWNER, staff: { ...OWNER.staff, id: ME, role: "csm" } }, {
    "/api/shifts": (route) => json(route, { ok: true, shift }),
    "/api/read/csm-queue": async (route, { url }) => {
      const u = new URL(url);
      if (u.searchParams.get("view") !== "tracking") return json(route, { ok: true, items: [QUEUE_ROW] });
      reads.push(u.search);
      if (u.searchParams.get("client_id")) {
        detailCalls++;
        if (detailCalls <= detailFails) return json(route, { ok: false, error: "unavailable" }, 503);
        return json(route, { ok: true, view: "tracking", client: DANA_DETAIL });
      }
      if (mode === "loading") return new Promise(() => {});
      if (mode === "error") return json(route, { ok: false, error: "unavailable" }, 503);
      return json(route, listBody(u, mode));
    },
    "/api/read/customer-insights": { ok: true, items: [], questions: { mid: [], post: [] } },
    "/api/messages": (route) => {
      writes.push(route.request().postDataJSON());
      const out = sendAnswer ? sendAnswer(writes.length) : { status: 200, body: { ok: true, outcome: "sent", deduped: false, message: { id: "m1" } } };
      return route.fulfill({ status: out.status, contentType: "application/json", body: JSON.stringify(out.body) });
    },
    "/api/tasks": (route) => { writes.push({ path: "/api/tasks" }); return json(route, { ok: false }, 403); },
    "/api/customer-insights": (route) => { writes.push({ path: "/api/customer-insights" }); return json(route, { ok: true }, 201); }
  });
  return { reads, writes };
}

/* Numbered red circle + yellow arrow on the exact control, with a legend (audit-screenshot-markups). */
async function marked(page, file, target, legend) {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  await page.evaluate(({ target, legend }) => {
    const el = document.querySelector(target);
    if (!el) return;
    el.scrollIntoView({ block: "center" });
    const box = el.getBoundingClientRect();
    const mk = (css) => { const d = document.createElement("div"); d.dataset.evidence = "1"; Object.assign(d.style, { position: "absolute", pointerEvents: "none", zIndex: 99999 }, css); document.body.appendChild(d); return d; };
    mk({ left: (box.left + scrollX - 4) + "px", top: (box.top + scrollY - 4) + "px", width: (box.width + 8) + "px", height: (box.height + 8) + "px", border: "3px solid #d22", borderRadius: "10px" });
    const n = mk({ left: (box.left + scrollX - 16) + "px", top: (box.top + scrollY - 16) + "px", width: "28px", height: "28px", borderRadius: "50%", background: "#d22", color: "#fff", font: "700 15px/28px system-ui", textAlign: "center" });
    n.textContent = "1";
    const arrow = mk({ left: (box.left + scrollX + Math.min(box.width - 40, 60)) + "px", top: (box.top + scrollY - 34) + "px", font: "700 26px/1 system-ui", color: "#f5c400", textShadow: "0 0 2px #000" });
    arrow.textContent = "↓";
    const key = mk({ left: (scrollX + 8) + "px", top: (box.top + scrollY + box.height + 12) + "px", maxWidth: Math.min(innerWidth - 16, 520) + "px", background: "#fff", border: "2px solid #d22", borderRadius: "6px", padding: "6px 8px", font: "13px/1.4 system-ui", color: "#111" });
    key.textContent = "1 — " + legend;
  }, { target, legend });
  await page.screenshot({ path: path.join(EVIDENCE, file), fullPage: true });
  await page.locator('[data-evidence="1"]').evaluateAll((els) => els.forEach((e) => e.remove()));
}

async function noSmallControls(page) {
  const small = await page.locator("#csm-tracking :is(button, select, a, textarea)").evaluateAll((els) => els
    .filter((el) => el.getClientRects().length)
    .map((el) => { const r = el.getBoundingClientRect(); return { text: (el.textContent || el.id || "").trim().slice(0, 40), w: Math.round(r.width), h: Math.round(r.height) }; })
    .filter((s) => s.w < 44 || s.h < 44));
  expect(small, JSON.stringify(small)).toEqual([]);
}

async function noSideways(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const clipped = await page.locator("#csm-tracking *").evaluateAll((els) => els.filter((el) => el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX === "visible" && el.clientWidth > 0 && el.tagName !== "PROGRESS").length);
  expect(clipped).toBe(0);
}

for (const width of [1440, 390, 320]) {
  for (const mode of ["full", "empty", "loading", "error"]) {
    test(`${mode} list fits ${width}px with 44px controls and writes nothing`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      const { writes, reads } = await fixture(page, mode);
      const host = page.locator("#csm-tracking");
      await expect(host.getByRole("heading", { name: "Where each client is" })).toBeVisible();
      if (mode === "full") {
        await expect(page.locator("#ctCount")).toHaveText("2");
        await expect(page.locator("#ctCmp")).toHaveText("of 3 clients on a plan");
        await expect(host.locator("[data-ct-row]")).toHaveCount(2);
        const dana = host.locator(`[data-ct-row="${DANA}"]`);
        await expect(dana).toContainText("Step 4 of 8: Pay Card A down to $400");
        await expect(dana).toContainText("On the same step for 12 days");
        await expect(dana).toContainText("1 card or loan payment is late");
        await expect(dana).not.toContainText("On it 12 days");
        await expect(dana).not.toContainText("1 late payment");
        await expect(dana).toContainText("Chase · day 12 of 30");
        await expect(dana).toContainText("Apply: locked");
        await expect(dana).toContainText("No team text yet");
        await expect(host.locator(`[data-ct-row="${MARCUS}"]`)).toContainText("Step is 10 days late. The auto reminders are done.");
        await expect(host.locator(`[data-ct-row="${MARCUS}"]`)).not.toContainText("10 days late · auto reminders done");
        await expect(host.locator(`[data-ct-row="${MARCUS}"]`)).toContainText("Last team text 2 days ago");
        expect(reads[0]).toContain("view=tracking&show=behind&limit=25&offset=0");
      } else if (mode === "empty") {
        await expect(page.locator("#ctCount")).toHaveText("0");
        await expect(host).toContainText("No one is falling behind right now.");
        await expect(host.getByRole("button", { name: "Show all clients" })).toBeVisible();
      } else if (mode === "loading") {
        await expect(page.locator("#ctList")).toHaveAttribute("aria-busy", "true");
        await expect(page.locator(".ct-skel")).toHaveCount(2);
        await expect(page.locator(".q-skel")).toHaveCount(0);
      } else {
        await expect(page.locator("#ctCount")).toHaveText("—");
        await expect(host).toContainText("Could not load where your clients are. The database is not reachable right now.");
        await expect(host.getByRole("button", { name: "Try again" })).toBeVisible();
      }
      await expect(page.locator("#qList [data-row]")).toHaveCount(1);
      await noSmallControls(page);
      await noSideways(page);
      expect(writes).toEqual([]);
      const legend = { full: "Falling-behind list: step, days stuck, late payments, seasoning, apply gate", empty: "Empty: nobody falling behind, one action to see everyone", loading: "Loading: skeleton rows in the real layout", error: "Error: plain words and a Try again button" }[mode];
      await marked(page, `${mode}-${width}.png`, mode === "full" ? `[data-ct-row="${DANA}"]` : "#ctList", `${legend} (${width}px, fake data)`);
    });
  }
}

test("Show all and Only mine ask the same read with the right filter", async ({ page }) => {
  const { reads } = await fixture(page);
  await expect(page.locator("[data-ct-row]")).toHaveCount(2);
  await page.locator("#ctShow").selectOption("all");
  await expect(page.locator("[data-ct-row]")).toHaveCount(3);
  await expect(page.locator("#ctCount")).toHaveText("3");
  await expect(page.locator("#ctCmp")).toHaveText("2 are falling behind");
  expect(reads.at(-1)).toContain("show=all");
  await expect(page.locator(`[data-ct-row="${AMELIA}"]`)).toContainText("Our team’s step");
  await expect(page.locator(`[data-ct-row="${AMELIA}"]`)).toContainText("Can apply");
  await expect(page.locator(`[data-ct-row="${AMELIA}"]`)).toContainText("On it 2 days");
  await expect(page.locator(`[data-ct-row="${AMELIA}"]`)).toContainText("No late payments");
  await page.locator("#ctMine").selectOption("1");
  await expect.poll(() => reads.at(-1)).toContain("mine=1");
});

test("See where they are opens one client: step, payments, seasoning and the apply gate with UnderwriteIQ's own words", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const { reads, writes } = await fixture(page);
  const open = page.locator(`[data-ct-open="${DANA}"]`);
  await open.click();
  await expect(open).toHaveAttribute("aria-expanded", "true");
  const d = page.locator(`#ct-detail-${DANA}`);
  await expect(d).toContainText("3 of 8 steps done");
  await expect(d).toContainText("We can do this step for them: $297.00 (Have us do it)");
  await expect(d).toContainText("Card A · the bank marks this payment late");
  await expect(d).toContainText("0 of 1 seasoned");
  await expect(d).toContainText("Day 12 of 30");
  await expect(d.locator("progress")).toHaveAttribute("value", "12");
  await expect(d).toContainText("Locked");
  await expect(d.locator(".ct-checks li.no")).toHaveCount(2);
  await expect(d).toContainText("UnderwriteIQ says to work on: Cards used 30% or less");
  await expect(d).toContainText("This credit report is a sample");
  await expect(page.locator("#ctBody")).toHaveValue(DANA_DETAIL.drafts.help);
  expect(reads.at(-1)).toBe(`?view=tracking&client_id=${DANA}`);
  await noSmallControls(page);
  await noSideways(page);
  expect(writes).toEqual([]);
  await marked(page, "detail-1440.png", `#ct-detail-${DANA} .ct-grid`, "One client: their step, payments, seasoning clock and apply gate (fake data)");
  await open.click();
  await expect(d).toHaveCount(0);
});

test("the nudge sends the help text through the staff reply door, once per tap, and says what happened", async ({ page }) => {
  const { writes } = await fixture(page);
  await page.locator(`[data-ct-open="${DANA}"]`).click();
  await expect(page.locator("#ctBody")).toHaveValue(DANA_DETAIL.drafts.help);
  await page.locator("#ctBody").fill("Hi Dana, it's Chris at Fundhub. Reply here and we will help you finish your card pay-down.");
  await page.locator("[data-ct-send]").click();
  await expect(page.locator("#ctSay")).toHaveText("Sent to Dana.");
  expect(writes).toHaveLength(1);
  expect(writes[0]).toEqual({ client_id: DANA, channel: "sms", body: "Hi Dana, it's Chris at Fundhub. Reply here and we will help you finish your card pay-down.", idempotency_key: expect.any(String) });
  await expect(page.locator(`[data-ct-row="${DANA}"]`)).toContainText("Last team text just now");
  await marked(page, "nudge-sent-1440.png", ".ct-nudge", "Nudge: help text sent through POST /api/messages (stand-in, nothing sent)");
});

test("the paid call offer swaps in its own words and email adds a subject", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { writes } = await fixture(page);
  await page.locator(`[data-ct-open="${DANA}"]`).click();
  await page.locator("#ctKind").selectOption("call");
  await expect(page.locator("#ctBody")).toHaveValue(DANA_DETAIL.drafts.call);
  await page.locator("#ctChan").selectOption("email");
  await expect(page.locator("[data-ct-send]")).toHaveText("Send the email");
  await page.locator("[data-ct-send]").click();
  await expect(page.locator("#ctSay")).toHaveText("Sent to Dana.");
  expect(writes[0]).toMatchObject({ client_id: DANA, channel: "email", body: DANA_DETAIL.drafts.call, subject: "A note from Chris at Fundhub" });
  await noSmallControls(page);
  await noSideways(page);
  await marked(page, "nudge-call-390.png", ".ct-nudge", "Paid consulting call offer, by email, at 390px (no price is named; none is stored)");
});

test("a CSM off shift is told to clock in, and quiet hours and held sends are said in plain words", async ({ page }) => {
  let n = 0;
  const answers = [
    { status: 403, body: { ok: false, error: "no_active_shift", message: "clock in" } },
    { status: 200, body: { ok: true, outcome: "deferred", detail: "2026-11-08T16:00:00.000Z", deduped: false } },
    { status: 200, body: { ok: true, outcome: "blocked", detail: ["opted_out"], deduped: false } }
  ];
  const { writes } = await fixture(page, "full", { sendAnswer: () => answers[n++] });
  await page.locator(`[data-ct-open="${DANA}"]`).click();
  const send = page.locator("[data-ct-send]");
  await send.click();
  await expect(page.locator("#ctSay")).toHaveText("Clock in first. You can text a client only while you are on a shift.");
  await send.click();
  await expect(page.locator("#ctSay")).toContainText("Saved. It goes out when quiet hours end");
  await page.locator("#ctBody").fill("Hi Dana, it's Chris at Fundhub. Checking in.");
  await send.click();
  await expect(page.locator("#ctSay")).toHaveText("The send rules held it, so nothing went out. Check their opt-out and contact details.");
  expect(writes).toHaveLength(3);
  expect(writes[0].idempotency_key).toBe(writes[1].idempotency_key);
  expect(writes[2].idempotency_key).not.toBe(writes[1].idempotency_key);
});

test("a detail that fails to load says so and Try again loads it", async ({ page }) => {
  await fixture(page, "full", { detailFails: 1 });
  await page.locator(`[data-ct-open="${DANA}"]`).click();
  const d = page.locator(`#ct-detail-${DANA}`);
  await expect(d).toContainText("Could not load this client. The database is not reachable right now.");
  await d.getByRole("button", { name: "Try again" }).click();
  await expect(d).toContainText("3 of 8 steps done");
});

test("the empty falling-behind list's one action shows everyone", async ({ page }) => {
  const { reads } = await fixture(page, "empty");
  await page.getByRole("button", { name: "Show all clients" }).click();
  await expect(page.locator("#ctShow")).toHaveValue("all");
  await expect.poll(() => reads.at(-1)).toContain("show=all");
  await expect(page.locator("#csm-tracking")).toContainText("No clients are on a plan yet.");
});
