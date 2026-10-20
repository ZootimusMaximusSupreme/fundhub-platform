// Batch 18 practice tests: the Ops & Admin screen (public/app/ops-admin.html) in a real Chromium with
// fake /api answers (no live data).
//
//   Open the page            owner and admin stay; every other staff role is sent away
//   Period pill              the menu, Escape, a click outside, and the two reads each choice makes
//   Zone tabs                Money and People swap, and only one is shown
//   Write today's C-suite    visible only when something is packed, short or spent; one POST; the words
//                            for each answer
//   Affiliates + Hiring      the drawer opens, holds the fixed words, and its link goes to Affiliates
//
// The AR checks use the same fake read boundary as the other browser tests and
// judge the visible replacement table after it paints.

import { test } from "node:test";
import assert from "node:assert/strict";

import { json, OWNER, proofRows, sharedScreens, waitFor } from "./fin-b18-kit.mjs";

const proof = proofRows(import.meta.url);
const screens = sharedScreens();
const SURFACE = "public/app/ops-admin.html";
const as = (role) => ({ ok: true, staff: { ...OWNER.staff, role } });

const KPIS = {
  ok: true,
  kpis: { cash_collected_cents: 0 },
  display: { cash: "$4,200", funded: "3", close: "25%", show: "60%", cpf: "$310", clients: "7" },
};

function pulse({ packed = false, short = false, adsStatus = "not_configured", spend = null } = {}) {
  return {
    ok: true,
    briefs: { ceo: "What needs doing today?\nNothing is on fire.", owner: "What will be done.\nNothing yet." },
    hire: { recommend: packed, existing_task_id: null, linkedin: { status: "not_configured" }, profile: { lines: [] } },
    pulse: {
      calendar: { packed, source: "MODEL" },
      gaps: { has_short: short, notes: [] },
      ads: { status: adsStatus, spend_cents: spend },
    },
  };
}

/** Open the page with logged reads. handlers answer kpis, ops-pulse and (optionally) hire-closer. */
async function openOps({ session = OWNER, pulseBody = pulse(), hire = null, invoices = { ok: true, items: [] } } = {}) {
  const calls = { kpis: [], pulse: [], hire: [], other: [] };
  const handlers = {
    "/api/dashboard/kpis": async (route, { url }) => { calls.kpis.push(new URL(url).searchParams.get("period")); return json(route, KPIS); },
    "/api/read/ops-pulse": async (route, { url }) => {
      calls.pulse.push(new URL(url).searchParams.get("period"));
      return json(route, typeof pulseBody === "function" ? pulseBody() : pulseBody);
    },
    "/api/read/invoices": async (route) => json(route, invoices),
    "/api/ops/hire-closer": async (route, { method }) => {
      calls.hire.push({ method, body: JSON.parse(route.request().postData() || "null") });
      const answer = hire ? await hire() : { status: 200, body: { ok: true, acted: false } };
      return route.fulfill({ status: answer.status, contentType: "application/json", body: JSON.stringify(answer.body) });
    },
  };
  const opened = await screens.open("/app/ops-admin.html", { session, handlers });
  opened.page.on("request", (request) => {
    const u = new URL(request.url());
    if (u.pathname.startsWith("/api/")) calls.other.push(u.pathname);
  });
  return { ...opened, calls };
}

const arInvoice = (id, name, extra = {}) => ({
  id, client_name: name, open_balance: "100.00", days_overdue: 1, status: "sent",
  due_at: "2026-10-20T12:00:00.000Z", sent_at: "2026-10-01T12:00:00.000Z",
  reminded_at: null, reminder_count: 0, escalated_at: null, last_payment_at: null,
  payment_method: null, owner_name: null, ...extra,
});

const AR_ITEMS = [
  arInvoice("20000000-0000-4000-8000-000000000001", "Zed Company", { open_balance: "100.00", days_overdue: 3, status: "sent" }),
  arInvoice("30000000-0000-4000-8000-000000000001", "Amy Company", { open_balance: "300.00", days_overdue: 1, status: "escalated" }),
  arInvoice("10000000-0000-4000-8000-000000000001", "Mid Company", { open_balance: "200.00", days_overdue: 2, status: "reminded" }),
];

// ───────────────────────── Open the page ─────────────────────────

test("Open the page: owner and admin stay on Ops & Admin, every other staff role is sent somewhere else", { timeout: 180_000 }, async () => {
  await proof.check(/^Open the page \(owner and admin only/, async () => {
    const stays = ["owner", "admin"];
    const bounced = ["sales_manager", "closer", "funding_advisor", "inquiry_specialist", "csm", "setter"];
    for (const role of stays) {
      const { page, calls, errors } = await openOps({ session: as(role) });
      await waitFor(() => calls.kpis.length >= 1, `${role}: the page asks for its KPIs`);
      await page.waitForSelector("#kpi-grid");
      assert.equal(new URL(page.url()).pathname, "/app/ops-admin.html", `${role} stays on the page`);
      assert.equal(await page.locator("#period-btn").isVisible(), true, `${role} sees the period pill`);
      assert.deepEqual(errors, []);
      await page.close();
    }
    for (const role of bounced) {
      const { page } = await openOps({ session: as(role) });
      await page.waitForURL((url) => url.pathname !== "/app/ops-admin.html", { timeout: 20_000 });
      assert.notEqual(new URL(page.url()).pathname, "/app/ops-admin.html", `${role} is sent away`);
      await page.close();
    }
  }, SURFACE);
});

// ───────────────────────── Period pill ─────────────────────────

test("Period pill: the menu lists four periods, closes on Escape and on a click outside, and a choice reads KPIs and briefs for it", { timeout: 120_000 }, async () => {
  await proof.check(/^Period pill: Today \/ Last 7 Days \/ Last 30 Days \/ Quarter to Date/, async () => {
    const { page, calls, errors } = await openOps();
    await waitFor(() => calls.kpis.length === 1 && calls.pulse.length === 1, "the first reads");
    assert.deepEqual([calls.kpis[0], calls.pulse[0]], ["7d", "7d"], "the page opens on the last 7 days");
    const menu = page.locator("#period-menu");
    const button = page.locator("#period-btn");
    assert.match(await page.locator("#period-label").innerText(), /^Last 7 Days — /);
    assert.equal(await page.locator("#foot-period").innerText(), "last 7 days");
    assert.equal(await menu.isVisible(), false, "the menu starts shut");
    assert.equal(await button.getAttribute("aria-expanded"), "false");

    await button.click();
    assert.equal(await menu.isVisible(), true);
    assert.equal(await button.getAttribute("aria-expanded"), "true");
    const options = await page.locator(".period-opt").evaluateAll((els) => els.map((el) => ({
      id: el.dataset.id, label: el.querySelector("span").textContent, current: el.getAttribute("aria-current"),
    })));
    assert.deepEqual(options, [
      { id: "today", label: "Today", current: "false" },
      { id: "7d", label: "Last 7 Days", current: "true" },
      { id: "30d", label: "Last 30 Days", current: "false" },
      { id: "qtd", label: "Quarter to Date", current: "false" },
    ]);

    await page.keyboard.press("Escape");
    assert.equal(await menu.isVisible(), false, "Escape closes the menu");
    assert.equal(await button.getAttribute("aria-expanded"), "false");
    await button.click();
    assert.equal(await menu.isVisible(), true);
    await page.locator(".section-title").first().click();
    assert.equal(await menu.isVisible(), false, "a click outside closes the menu");

    // a choice closes the menu, repaints the words, and reads KPIs and briefs for that period
    await button.click();
    await page.locator('.period-opt[data-id="30d"]').click();
    await waitFor(() => calls.kpis.length === 2 && calls.pulse.length === 2, "the 30 day reads");
    assert.deepEqual([calls.kpis[1], calls.pulse[1]], ["30d", "30d"]);
    assert.equal(await menu.isVisible(), false, "choosing closes the menu");
    assert.match(await page.locator("#period-label").innerText(), /^Last 30 Days — /);
    assert.equal(await page.locator("#foot-period").innerText(), "last 30 days");
    assert.equal(await page.locator("#kpi-meta").innerText(), "last 30 days");
    assert.equal(await page.locator('#kpi-grid [data-kpi="cash"]').first().innerText(), "$4,200", "the KPI tiles show the answer");

    // the same period again reads nothing new
    await button.click();
    await page.locator('.period-opt[data-id="30d"]').click();
    await page.waitForTimeout(150);
    assert.deepEqual([calls.kpis.length, calls.pulse.length], [2, 2], "picking the period you are on is a no-op");

    for (const [id, label, foot] of [["qtd", "Quarter to Date", "quarter to date"], ["today", "Today", "today"]]) {
      await button.click();
      await page.locator(`.period-opt[data-id="${id}"]`).click();
      await waitFor(() => calls.kpis.at(-1) === id && calls.pulse.at(-1) === id, `the ${id} reads`);
      assert.match(await page.locator("#period-label").innerText(), new RegExp(`^${label} — `));
      assert.equal(await page.locator("#foot-period").innerText(), foot);
    }
    assert.deepEqual(errors, []);
    await page.close();
  }, SURFACE);
});

// ───────────────────────── Zone tabs ─────────────────────────

test("Zone tabs: Money is shown first, People swaps it, and Money swaps back, with the tab marked", { timeout: 90_000 }, async () => {
  await proof.check(/^Zone tabs: Money \/ People/, async () => {
    const { page, errors } = await openOps();
    const state = () => page.evaluate(() => ({
      tabs: [...document.querySelectorAll(".zonetab")].map((t) => [t.dataset.zone, t.getAttribute("aria-selected"), t.classList.contains("on")]),
      zones: [...document.querySelectorAll(".zone")].map((z) => [z.dataset.zone, z.hidden, getComputedStyle(z).display !== "none"]),
    }));
    assert.deepEqual(await state(), {
      tabs: [["money", "true", true], ["people", "false", false]],
      zones: [["money", false, true], ["people", true, false]],
    }, "Money is the default");

    await page.locator('.zonetab[data-zone="people"]').click();
    assert.deepEqual(await state(), {
      tabs: [["money", "false", false], ["people", "true", true]],
      zones: [["money", true, false], ["people", false, true]],
    }, "People swaps in and Money goes away");
    assert.equal(await page.locator("#staff-comp-body").isVisible(), true, "the People tables can be seen");
    assert.equal(await page.locator("#kpi-grid").isVisible(), false, "the money tiles are hidden while People shows");

    await page.locator('.zonetab[data-zone="money"]').focus();
    await page.keyboard.press("Enter");
    assert.deepEqual(await state(), {
      tabs: [["money", "true", true], ["people", "false", false]],
      zones: [["money", false, true], ["people", true, false]],
    }, "Money comes back, from the keyboard too");
    assert.deepEqual(errors, []);
    await page.close();
  }, SURFACE);
});

// ───────────────────────── Write today's C-suite tasks ─────────────────────────

test("Write today's C-suite tasks: shown only when the calendar is packed, a gap is short, or ad spend is above zero", { timeout: 120_000 }, async () => {
  const cases = [
    ["nothing packed, short or spent", pulse(), false],
    ["calendar packed", pulse({ packed: true }), true],
    ["a gap is short", pulse({ short: true }), true],
    ["ad spend above zero", pulse({ adsStatus: "ok", spend: 12500 }), true],
    ["ads connected with no spend", pulse({ adsStatus: "ok", spend: 0 }), false],
    ["spend present but ads not connected", pulse({ adsStatus: "not_configured", spend: 12500 }), false],
  ];
  const posted = [];
  await proof.check(/^Write today's C-suite tasks/, async () => {
    for (const [name, body, shown] of cases) {
      const { page, calls, errors } = await openOps({ pulseBody: body });
      await page.waitForSelector("#ops-pulse-body:not([hidden])");
      assert.equal(await page.locator("#ops-pulse-act").isVisible(), shown, `${name}: the button is ${shown ? "shown" : "hidden"}`);
      assert.deepEqual(calls.hire, [], `${name}: nothing is posted on load`);
      assert.deepEqual(errors, []);
      await page.close();
    }

    // pressing it: one POST, locked while it works, then the words for the answer
    const answers = [
      [{ status: 200, body: { ok: true, acted: true, linkedin: { status: "posted" } } }, "Tasks saved. LinkedIn: posted. A person still has to send the invite."],
      [{ status: 200, body: { ok: true, acted: false, diagnose: { created: false }, linkedin: { status: "not_configured" } } }, "Review tasks already on file. LinkedIn: not_configured."],
      [{ status: 200, body: { ok: true, acted: false } }, "No new C-suite tasks this time."],
      [{ status: 500, body: { ok: false, error: "query_failed" } }, "Could not write today’s tasks. Try again."],
    ];
    for (const [answer, words] of answers) {
      let release;
      const gate = new Promise((resolve) => { release = resolve; });
      const { page, calls, errors } = await openOps({ pulseBody: pulse({ packed: true }), hire: async () => { await gate; return answer; } });
      await page.waitForSelector("#ops-pulse-act:not([hidden])");
      const pulseReads = () => calls.pulse.length;
      await page.locator("#ops-pulse-act").click();
      await waitFor(() => calls.hire.length === 1, "the hire-closer request");
      assert.equal(await page.locator("#ops-pulse-act").isDisabled(), true, "the button is locked while it works");
      assert.equal(await page.locator("#ops-pulse-act-msg").innerText(), "Working…");
      const before = pulseReads();
      release();
      await page.waitForFunction((text) => document.getElementById("ops-pulse-act-msg").innerText === text, words);
      assert.equal(await page.locator("#ops-pulse-act").isDisabled(), false, "the button is free again");
      assert.deepEqual(calls.hire, [{ method: "POST", body: {} }], "one POST with an empty body");
      if (answer.status === 200) await waitFor(() => pulseReads() > before, "the briefs are read again after tasks are written");
      posted.push(words);
      assert.deepEqual(errors, []);
      await page.close();
    }
    assert.equal(posted.length, 4);
  }, SURFACE);
});

// ───────────────────────── Affiliates + Hiring drawer ─────────────────────────

test("Affiliates + Hiring: the drawer starts shut, opens to its fixed words, and its link goes to Affiliates", { timeout: 90_000 }, async () => {
  await proof.check(/^Affiliates \+ Hiring drawer/, async () => {
    const { page, calls, errors } = await openOps();
    await page.waitForSelector("#aff");
    const drawer = page.locator("details#aff");
    assert.equal(await drawer.evaluate((el) => el.open), false, "the drawer starts shut");
    assert.equal((await page.locator(".af-n").innerText()).replace(/\s+/g, " "), "— referrals · — paid out · — applicants");
    assert.equal(await page.locator(".aff-body").isVisible(), false);

    await page.locator("#aff > summary .af-t").click();
    assert.equal(await drawer.evaluate((el) => el.open), true, "pressing the row opens it");
    const body = (await page.locator(".aff-body").innerText()).replace(/\s+/g, " ");
    assert.match(body, /AFFILIATES No affiliate data yet\./);
    assert.match(body, /HIRING PIPELINE No hiring pipeline data yet\./);
    assert.equal(await page.locator("#aff-link").getAttribute("href"), "affiliate.html");
    assert.equal((await page.locator("#aff-link").innerText()).replace(/\s+/g, " ").trim(), "Open Affiliates ↗");
    // nothing in the page reads affiliate or hiring data: the words are fixed
    assert.deepEqual(calls.other.filter((p) => /affiliate|hiring/i.test(p)), []);

    await page.locator("#aff > summary .af-t").click();
    assert.equal(await drawer.evaluate((el) => el.open), false, "pressing it again shuts it");

    await page.locator("#aff-link").click();
    await page.waitForURL(/\/app\/affiliate\.html$/);
    assert.deepEqual(errors, []);
    await page.close();
  }, SURFACE);
});

test("AR headers sort every visible column by click or keyboard after the table repaints", { timeout: 90_000 }, async () => {
  await proof.check(/^AR column header sort/, async () => {
    const { page, errors } = await openOps({ invoices: { ok: true, items: AR_ITEMS } });
    await page.waitForSelector("#ar-table tr[data-ar]");
    const names = () => page.$$eval("#ar-table tr[data-ar]", (rows) => rows.map((r) => r.cells[0].textContent.trim()));
    const cases = [
      ["Client", "Amy Company"], ["Invoice", "Mid Company"], ["Amount owed", "Zed Company"],
      ["Overdue", "Amy Company"], ["Status", "Amy Company"],
    ];
    for (const [label, first] of cases) {
      const th = page.locator("#ar-table th", { hasText: label });
      assert.equal(await th.getAttribute("tabindex"), "0", `${label} is reachable by keyboard`);
      await th.click();
      assert.equal(await th.getAttribute("aria-sort"), "ascending", `${label} sorts ascending`);
      assert.equal((await names())[0], first, `${label} changes the visible row order`);
    }
    const client = page.locator("#ar-table th", { hasText: "Client" });
    await client.focus();
    await page.keyboard.press("Enter");
    assert.equal(await client.getAttribute("aria-sort"), "ascending");
    await page.keyboard.press("Enter");
    assert.equal(await client.getAttribute("aria-sort"), "descending");
    assert.equal((await names())[0], "Zed Company", "Enter reverses the Client order");
    assert.deepEqual(errors, []);
    await page.close();
  }, SURFACE);
});

test("AR rows open the promised saved details and close by click or keyboard", { timeout: 90_000 }, async () => {
  await proof.check(/^AR row expand/, async () => {
    const detail = arInvoice("40000000-0000-4000-8000-000000000001", "Dana Whitfield", {
      open_balance: "1250.50", days_overdue: 12, status: "escalated",
      due_at: "2026-10-20T12:00:00.000Z", sent_at: "2026-10-01T12:00:00.000Z",
      reminded_at: "2026-10-10T12:00:00.000Z", reminder_count: 2,
      escalated_at: "2026-10-15T12:00:00.000Z", last_payment_at: "2026-10-16T12:00:00.000Z",
      payment_method: "ACH", owner_name: "Morgan CSM",
    });
    const { page, errors } = await openOps({ invoices: { ok: true, items: [detail] } });
    const row = page.locator("#ar-table tr[data-ar]");
    await row.waitFor();
    assert.equal(await row.getAttribute("tabindex"), "0");
    await row.click();
    assert.equal(await row.getAttribute("aria-expanded"), "true");
    const words = (await page.locator("#ar-table .ar-detail").innerText()).replace(/\s+/g, " ");
    for (const expected of ["Terms Due Oct 20, 2026", "Payment method ACH", "Owner Morgan CSM",
      "Outstanding $1,250.50", "Collection history", "Invoice sent", "Reminder sent (2)",
      "Moved to collections", "Payment recorded"]) assert.match(words, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
    await row.click();
    assert.equal(await page.locator("#ar-table .ar-detail").count(), 0, "a second click closes it");
    await row.focus();
    await page.keyboard.press("Enter");
    assert.equal(await page.locator("#ar-table .ar-detail").count(), 1, "Enter opens it too");
    assert.deepEqual(errors, []);
    await page.close();
  }, SURFACE);
});

test("every listed row was exercised", () => {
  proof.assertAllClaimed();
});
