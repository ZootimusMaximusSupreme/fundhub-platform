// Practice test (fake data, real pages): two reads on the Money page.
//  1. "Connect a bank" on public/app/money.html loads the bank's own script
//     from cdn.plaid.com when Connect is pressed (and not before), and goes on
//     to the exchange only when that script ran.
//  2. The Trends slot: money-trends.js draws the exact returned numbers into
//     the slot when the page loaded it (the one-page frame, financeos.html).
//     The words and tables are judged, and so are the drawn lines themselves:
//     where each point sits, a missing day is a break and never a zero or a
//     bridge, an estimated stretch is dashed, a lone day is a dot, and the
//     range buttons and their default are read back. A page that did not load
//     money-trends.js must leave the slot empty and ask for no trends; a page
//     that did must draw it. The standalone money.html is read by that rule
//     either way (the contract is conditional, so adding the script is not a
//     break).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { OWNER, bodyOf, json, startPages, waitFor } from "./fin-b23-browser-kit.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const SANDBOX = JSON.parse(fs.readFileSync(path.join(ROOT, "src/http/fixtures/money-overview.sandbox.json"), "utf8"));
const CLIENT_ID = "c1000000-0000-4000-8000-000000000001";
const STAFF = { ok: true, staff: { ...OWNER.staff, role: "funding_advisor" } };
const PLAID_URL = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";
const BANK_WINDOW = "window.Plaid={create:function(c){return{open:function(){setTimeout(function(){c.onSuccess('fake-public-token',{institution:{institution_id:'ins_sample',name:'Sample Bank'}})},0)}}}};";

const EMPTY_OVERVIEW = { ...SANDBOX, accounts: [] };

function plaidRoutes({ script = "serves", linkToken = { status: 200, body: { ok: true, link_token: "fake-link-token" } } } = {}) {
  const log = { posts: [], scriptRequests: [], overviewReads: 0 };
  const handlers = {
    "/api/money/overview": async (route) => { log.overviewReads += 1; return json(route, EMPTY_OVERVIEW); },
    "/api/money/trends": async (route) => json(route, { ok: true, range: "90d", daily: {}, monthly: { months: [] } }),
    "/api/banking/link-token": async (route) => {
      log.posts.push({ path: "link-token", body: bodyOf(route) });
      return json(route, linkToken.body, linkToken.status);
    },
    "/api/banking/link-exchange": async (route) => {
      log.posts.push({ path: "link-exchange", body: bodyOf(route) });
      return json(route, { ok: true });
    },
  };
  const before = async (page) => {
    await page.route("https://cdn.plaid.com/**", async (route) => {
      log.scriptRequests.push(route.request().url());
      if (script === "blocked") return route.abort();
      return route.fulfill({ contentType: "text/javascript", body: BANK_WINDOW });
    });
  };
  return { log, handlers, before };
}

test("Connect a bank loads the bank script only when it is pressed, then runs token, window and exchange", { timeout: 90_000 }, async (t) => {
  const { open } = await startPages(t);
  const { log, handlers, before } = plaidRoutes();
  const { page, errors } = await open(`/app/money.html?client_id=${CLIENT_ID}`, { session: STAFF, handlers, before });
  await page.waitForSelector('[data-act="connect"]');
  assert.match(await page.locator("body").innerText(), /No bank accounts yet/);
  await page.waitForTimeout(250);
  assert.deepEqual(log.scriptRequests, [], "the bank script is not fetched before Connect is pressed");
  assert.deepEqual(log.posts, []);

  await page.locator('[data-act="connect"]').first().click();
  await waitFor(() => log.posts.some((p) => p.path === "link-exchange"), "the exchange");
  assert.deepEqual(log.scriptRequests, [PLAID_URL], "exactly the bank's own script, once");
  assert.deepEqual(log.posts, [
    { path: "link-token", body: { client_id: CLIENT_ID } },
    { path: "link-exchange", body: { public_token: "fake-public-token", institution: { institution_id: "ins_sample", name: "Sample Bank" }, client_id: CLIENT_ID } },
  ]);
  await waitFor(() => log.overviewReads >= 2, "the accounts are read again after the connect");
  assert.deepEqual(errors, []);
  await page.close();
});

test("when the bank script cannot load, nothing is exchanged and the page says so", { timeout: 60_000 }, async (t) => {
  const { open } = await startPages(t);
  const { log, handlers, before } = plaidRoutes({ script: "blocked" });
  const { page } = await open(`/app/money.html?client_id=${CLIENT_ID}`, { session: STAFF, handlers, before });
  await page.waitForSelector('[data-act="connect"]');
  await page.locator('[data-act="connect"]').first().click();
  await page.waitForFunction(() => /The bank sign-in window did not load\./.test(document.body.innerText));
  assert.deepEqual(log.scriptRequests, [PLAID_URL]);
  assert.deepEqual(log.posts.map((p) => p.path), ["link-token"], "no exchange without the bank's window");
  assert.equal(await page.locator('[data-act="connect"]').first().isDisabled(), false, "the button is usable again");
  await page.close();
});

test("when no link token can be made, the bank script is never fetched", { timeout: 60_000 }, async (t) => {
  const { open } = await startPages(t);
  const { log, handlers, before } = plaidRoutes({ linkToken: { status: 503, body: { ok: false, error: "not_configured" } } });
  const { page } = await open(`/app/money.html?client_id=${CLIENT_ID}`, { session: STAFF, handlers, before });
  await page.waitForSelector('[data-act="connect"]');
  await page.locator('[data-act="connect"]').first().click();
  await page.waitForFunction(() => /Bank connections are not set up yet\./.test(document.body.innerText));
  assert.deepEqual(log.scriptRequests, []);
  assert.deepEqual(log.posts.map((p) => p.path), ["link-token"]);
  await page.close();
});

const TRENDS = {
  ok: true,
  range: "90d",
  daily: {
    days: ["2026-10-10", "2026-10-11", "2026-10-12"],
    estimated: [false, true, false],
    cash: {
      personal: { cents: [100000, 150000, 125050] },
      business: { cents: [null, 500000, 650000] },
    },
    debt: {
      total: { cents: [900000, 880000, 860000] },
      personal: { cents: [300000, 290000, 280000] },
      business: { cents: [600000, 590000, 580000] },
    },
    cards_used_pct: [41.2, 40, 38.5],
  },
  monthly: {
    months: ["2026-08", "2026-09", "2026-10"],
    personal: { in_cents: [400000, 420000, 380000], out_cents: [350000, 360000, 390000] },
    business: { in_cents: [1000000, null, 1200000], out_cents: [800000, 900000, 950000] },
  },
};

test("the Trends slot draws the exact returned numbers, and a missing day is a gap, not zero", { timeout: 90_000 }, async (t) => {
  const { open } = await startPages(t);
  const asked = [];
  const handlers = {
    "/api/money/overview": SANDBOX,
    "/api/money/trends": async (route, { url }) => {
      asked.push(new URL(url).searchParams.get("range"));
      return json(route, TRENDS);
    },
  };
  const { page, errors } = await open(`/app/financeos.html?client_id=${CLIENT_ID}#overview`, { session: STAFF, handlers });
  await openMoneyDetail(page, "history");
  await page.waitForSelector('figure[data-chart="cash"]');
  assert.deepEqual(asked, ["90d"]);

  const cash = page.locator('figure[data-chart="cash"]');
  const legend = (await cash.locator(".tlegend").innerText()).replace(/\s+/g, " ");
  assert.match(legend, /Personal \$1,250\.50/);
  assert.match(legend, /Business \$6,500\.00/);
  const rows = await cash.locator("details.tdata tbody tr").evaluateAll((trs) => trs.map((tr) => [...tr.children].map((td) => td.textContent.trim())));
  assert.deepEqual(rows, [
    ["Oct 12, 2026", "$1,250.50", "$6,500.00"],
    ["Oct 11, 2026", "$1,500.00 *", "$5,000.00 *"],
    ["Oct 10, 2026", "$1,000.00", "—"],
  ]);
  // The point words the chart gives each day: no point at all for the day with no business number.
  const titles = await cash.locator(".thit title").evaluateAll((els) => els.map((e) => e.textContent));
  assert.ok(titles.includes("Personal · Oct 12, 2026: $1,250.50"));
  assert.ok(titles.includes("Business · Oct 11, 2026: $5,000.00 (estimated)"));
  assert.equal(titles.some((x) => /Business · Oct 10, 2026/.test(x)), false, "a day with no number is not drawn as $0");
  assert.equal(await cash.locator("polyline.tline.s1").count() >= 1, true);
  assert.match(await cash.locator("details.tdata").textContent(), /estimated from your bank activity/);

  const debt = (await page.locator('figure[data-chart="debt"] .tlegend').innerText()).replace(/\s+/g, " ");
  assert.match(debt, /All debt \$8,600\.00/);
  const used = (await page.locator('figure[data-chart="used"] .tlegend').innerText()).replace(/\s+/g, " ");
  assert.match(used, /Cards used 38\.5%/);
  const flow = (await page.locator('figure[data-chart="flow-business"] details.tdata tbody tr').evaluateAll((trs) => trs.map((tr) => [...tr.children].map((td) => td.textContent.trim()))));
  assert.deepEqual(flow, [
    ["Oct 2026", "$12,000.00", "$9,500.00"],
    ["Sep 2026", "—", "$9,000.00"],
    ["Aug 2026", "$10,000.00", "$8,000.00"],
  ]);
  assert.deepEqual(errors, []);
  await page.close();
});

test("a Money page that did not load the trends script leaves the slot empty, and one that did draws it", { timeout: 60_000 }, async (t) => {
  const { open } = await startPages(t);
  const asked = [];
  const handlers = {
    "/api/money/overview": SANDBOX,
    "/api/money/trends": async (route) => { asked.push(new URL(route.request().url()).searchParams.get("range")); return json(route, TRENDS); },
  };
  const { page } = await open(`/app/money.html?client_id=${CLIENT_ID}`, { session: STAFF, handlers });
  await page.waitForSelector("[data-trends-slot]", { state: "attached" });
  await openMoneyDetail(page, "history");
  await page.waitForTimeout(500);
  const loaded = await page.evaluate(() => typeof (window.FinanceOS && window.FinanceOS.trends && window.FinanceOS.trends.mount) === "function");
  if (loaded) {
    // The page carries the script: the slot must hold the graphs, drawn from one read.
    await page.waitForSelector('[data-trends-slot] figure[data-chart="cash"]');
    assert.deepEqual(asked, ["90d"]);
    assert.match((await page.locator('[data-trends-slot] figure[data-chart="cash"] .tlegend').innerText()).replace(/\s+/g, " "), /Personal \$1,250\.50/);
  } else {
    // No script on this page: nothing is drawn and nothing is asked for.
    assert.equal(await page.locator("[data-trends-slot]").innerHTML(), "", "no graph without money-trends.js");
    assert.deepEqual(asked, []);
  }
  t.diagnostic(`money.html loaded money-trends.js: ${loaded}`);
  await page.close();
});

// Six days with a hole in the middle. Personal cash has a missing day (a gap) and one
// estimated day; business cash has only two lone days. Everything is chosen so a line
// drawn flat, bridged across the hole, or never dashed is a different picture.
const LINES = {
  ok: true,
  range: "90d",
  daily: {
    days: ["2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11", "2026-10-12"],
    estimated: [false, false, true, false, false, false],
    cash: {
      personal: { cents: [100000, 120000, 110000, null, 140000, 160000] },
      business: { cents: [null, 50000, null, null, 70000, null] },
    },
    debt: {
      total: { cents: [900000, 880000, 860000, 840000, 820000, 800000] },
      personal: { cents: [300000, 290000, 280000, 270000, 260000, 250000] },
      business: { cents: [600000, 590000, 580000, 570000, 560000, 550000] },
    },
    cards_used_pct: [41.2, 40, 38.5, null, 36, 35.5],
  },
  monthly: { months: [], personal: { in_cents: [], out_cents: [] }, business: { in_cents: [], out_cents: [] } },
};

/** Where a value belongs in the 600 by 160 plot: days spread left to right, top of the plot is the biggest number, bottom the smallest. */
function plotter(allValues, count, { floorZero = false } = {}) {
  const nums = allValues.filter((v) => typeof v === "number");
  let hi = Math.max(...nums);
  let lo = Math.min(...nums);
  if (floorZero && lo > 0) lo = 0;
  return (i, v) => `${((i * 600) / (count - 1)).toFixed(1)},${(10 + ((hi - v) * 140) / (hi - lo)).toFixed(1)}`;
}

async function linesOf(figure) {
  return figure.locator("polyline.tline").evaluateAll((els) => els.map((e) => ({ cls: e.getAttribute("class"), points: e.getAttribute("points") })));
}

async function openMoneyDetail(page, key) {
  const detail = page.locator(`#money-detail-${key}`);
  await detail.waitFor({ state: "attached" });
  if (!(await detail.evaluate((node) => node.open))) await detail.locator(":scope > summary").click();
  await detail.locator(".money-detail-body").waitFor({ state: "visible" });
}

test("the drawn lines sit at the returned values, break at a missing day, dash the estimated stretch and dot a lone day", { timeout: 90_000 }, async (t) => {
  const { open } = await startPages(t);
  const handlers = { "/api/money/overview": SANDBOX, "/api/money/trends": LINES };
  const { page, errors } = await open(`/app/financeos.html?client_id=${CLIENT_ID}#overview`, { session: STAFF, handlers });
  await openMoneyDetail(page, "history");
  await page.waitForSelector('figure[data-chart="cash"]');

  // ---- Cash: two lines, two separate scales of one plot -------------------------------
  const cash = page.locator('figure[data-chart="cash"]');
  const personal = LINES.daily.cash.personal.cents;
  const business = LINES.daily.cash.business.cents;
  const at = plotter([...personal, ...business], 6);
  // The biggest number is the top of the plot and the smallest the bottom, whatever else changes.
  assert.equal(at(5, 160000), "600.0,10.0");
  assert.equal(at(1, 50000), "120.0,150.0");
  const cashLines = await linesOf(cash);
  assert.deepEqual(cashLines, [
    // Personal: Oct 7 to Oct 8 solid, Oct 8 to Oct 9 dashed (Oct 9 is estimated), then a break for Oct 10, Oct 11 to Oct 12 solid.
    { cls: "tline s1", points: `${at(0, 100000)} ${at(1, 120000)}` },
    { cls: "tline s1 test", points: `${at(1, 120000)} ${at(2, 110000)}` },
    { cls: "tline s1", points: `${at(4, 140000)} ${at(5, 160000)}` },
    // Business has no two neighbouring days, so it draws no line at all, only its two dots.
  ]);
  assert.equal(cashLines.some((l) => l.cls.includes("s2")), false);
  // Nothing crosses the missing day: no line has a point between Oct 9 (x 240) and Oct 11 (x 480).
  for (const line of cashLines) {
    const xs = line.points.split(" ").map((p) => Number(p.split(",")[0]));
    assert.equal(xs.some((x) => x > 240 && x < 480), false, `a line crosses the missing day: ${line.points}`);
  }
  // Dots: one per returned number, round for Personal and square for Business.
  assert.equal(await cash.locator("path.tdot.s1.rd").count(), 5);
  assert.equal(await cash.locator("path.tdot.s2.sq").count(), 2);
  const titles = await cash.locator(".thit title").evaluateAll((els) => els.map((e) => e.textContent));
  assert.deepEqual(titles, [
    "Personal \u00b7 Oct 7, 2026: $1,000.00",
    "Personal \u00b7 Oct 8, 2026: $1,200.00",
    "Personal \u00b7 Oct 9, 2026: $1,100.00 (estimated)",
    "Personal \u00b7 Oct 11, 2026: $1,400.00",
    "Personal \u00b7 Oct 12, 2026: $1,600.00",
    "Business \u00b7 Oct 8, 2026: $500.00",
    "Business \u00b7 Oct 11, 2026: $700.00",
  ]);
  // The words under the picture: latest real number, not the empty last day; short axis labels.
  const legend = (await cash.locator(".tlegend").innerText()).replace(/\s+/g, " ");
  assert.match(legend, /Personal \$1,600\.00/);
  assert.match(legend, /Business \$700\.00/);
  assert.deepEqual(await cash.locator(".ty span").allTextContents(), ["$1.6k", "$1.1k", "$500"]);
  assert.deepEqual(await cash.locator(".tx span").allTextContents(), ["Oct 7", "Oct 9", "Oct 12"]);
  const tableRows = await cash.locator("details.tdata tbody tr").evaluateAll((trs) => trs.map((tr) => [...tr.children].map((td) => td.textContent.trim())));
  assert.deepEqual(tableRows, [
    ["Oct 12, 2026", "$1,600.00", "\u2014"],
    ["Oct 11, 2026", "$1,400.00", "$700.00"],
    ["Oct 10, 2026", "\u2014", "\u2014"],
    ["Oct 9, 2026", "$1,100.00 *", "\u2014"],
    ["Oct 8, 2026", "$1,200.00", "$500.00"],
    ["Oct 7, 2026", "$1,000.00", "\u2014"],
  ]);

  // ---- Debt: nothing missing, but the estimated day still splits and dashes the line --
  const debt = page.locator('figure[data-chart="debt"]');
  const debtValues = [...LINES.daily.debt.total.cents, ...LINES.daily.debt.personal.cents, ...LINES.daily.debt.business.cents];
  const onDebt = plotter(debtValues, 6, { floorZero: true });
  const total = LINES.daily.debt.total.cents;
  assert.equal(onDebt(0, 900000), "0.0,10.0", "debt starts from zero at the bottom, the biggest number at the top");
  const allDebt = (await linesOf(debt)).filter((l) => /\bs0\b/.test(l.cls));
  assert.deepEqual(allDebt, [
    { cls: "tline s0", points: `${onDebt(0, total[0])} ${onDebt(1, total[1])}` },
    { cls: "tline s0 test", points: `${onDebt(1, total[1])} ${onDebt(2, total[2])} ${onDebt(3, total[3])}` },
    { cls: "tline s0", points: `${onDebt(3, total[3])} ${onDebt(4, total[4])} ${onDebt(5, total[5])}` },
  ]);
  assert.equal((await linesOf(debt)).length, 9, "three series, three stretches each");

  // ---- Cards used: the empty day is a break, never 0% -------------------------------
  const used = page.locator('figure[data-chart="used"]');
  const pcts = LINES.daily.cards_used_pct;
  const onUsed = plotter(pcts, 6, { floorZero: true });
  assert.deepEqual(await linesOf(used), [
    { cls: "tline s0", points: `${onUsed(0, 41.2)} ${onUsed(1, 40)}` },
    { cls: "tline s0 test", points: `${onUsed(1, 40)} ${onUsed(2, 38.5)}` },
    { cls: "tline s0", points: `${onUsed(4, 36)} ${onUsed(5, 35.5)}` },
  ]);
  assert.match((await used.locator(".tlegend").innerText()).replace(/\s+/g, " "), /Cards used 35\.5%/);
  const usedTitles = await used.locator(".thit title").evaluateAll((els) => els.map((e) => e.textContent));
  assert.equal(usedTitles.length, 5, "five days have a number, the sixth day is not drawn as 0%");
  assert.deepEqual(errors, []);
  await page.close();
});

test("the range buttons ask for the range they name, remember it, and fall back to 90 days", { timeout: 120_000 }, async (t) => {
  const { open } = await startPages(t);
  const pressedOf = (page) => page.locator(".trange-btn").evaluateAll((els) => els.map((e) => [e.getAttribute("data-range"), e.getAttribute("aria-pressed")]));
  const handlersFor = (asked) => ({
    "/api/money/overview": SANDBOX,
    "/api/money/trends": async (route) => {
      const u = new URL(route.request().url());
      asked.push([u.searchParams.get("range"), u.searchParams.get("client_id")]);
      return json(route, { ...TRENDS, range: u.searchParams.get("range") });
    },
  });
  const ALL_90 = [["30d", "false"], ["90d", "true"], ["12m", "false"]];

  // 1. Nothing remembered: 90 days, asked for this client, and the 90 days button is the pressed one.
  const asked = [];
  const first = await open(`/app/financeos.html?client_id=${CLIENT_ID}#overview`, { session: STAFF, handlers: handlersFor(asked) });
  await openMoneyDetail(first.page, "history");
  await first.page.waitForSelector(".trange-btn");
  assert.deepEqual(asked, [["90d", CLIENT_ID]]);
  assert.deepEqual(await pressedOf(first.page), ALL_90);

  // 2. Press 30 days: one more read for 30d, that button is pressed, and the choice is remembered.
  await first.page.locator('.trange-btn[data-range="30d"]').click();
  await waitFor(() => asked.length === 2, "the 30 day read");
  assert.deepEqual(asked[1], ["30d", CLIENT_ID]);
  await first.page.waitForFunction(() => document.querySelector('.trange-btn[data-range="30d"]')?.getAttribute("aria-pressed") === "true");
  assert.deepEqual(await pressedOf(first.page), [["30d", "true"], ["90d", "false"], ["12m", "false"]]);
  assert.equal(await first.page.evaluate(() => sessionStorage.getItem("fos_trends_range")), "30d");
  // 3. Open the page again in the same tab: it asks for 30 days straight away.
  asked.length = 0;
  await first.page.reload();
  await openMoneyDetail(first.page, "history");
  await first.page.waitForSelector(".trange-btn");
  assert.deepEqual(asked[0], ["30d", CLIENT_ID]);
  assert.deepEqual(await pressedOf(first.page), [["30d", "true"], ["90d", "false"], ["12m", "false"]]);
  await first.page.close();

  // 4. A remembered value that is not one of the three ranges is ignored: 90 days.
  const junk = [];
  const second = await open(`/app/financeos.html?client_id=${CLIENT_ID}#overview`, {
    session: STAFF, handlers: handlersFor(junk),
    init: () => { try { sessionStorage.setItem("fos_trends_range", "7d"); } catch (e) { /* none */ } },
  });
  await openMoneyDetail(second.page, "history");
  await second.page.waitForSelector(".trange-btn");
  assert.deepEqual(junk, [["90d", CLIENT_ID]]);
  assert.deepEqual(await pressedOf(second.page), ALL_90);
  await second.page.close();

  // 5. A browser that will not let the page read its tab storage still gets 90 days.
  const blocked = [];
  const third = await open(`/app/financeos.html?client_id=${CLIENT_ID}#overview`, {
    session: STAFF, handlers: handlersFor(blocked),
    init: () => {
      const real = Storage.prototype.getItem;
      Storage.prototype.getItem = function (key) {
        if (key === "fos_trends_range") throw new Error("storage blocked");
        return real.call(this, key);
      };
    },
  });
  await openMoneyDetail(third.page, "history");
  await third.page.waitForSelector(".trange-btn");
  assert.deepEqual(blocked, [["90d", CLIENT_ID]]);
  assert.deepEqual(await pressedOf(third.page), ALL_90);
  await third.page.close();

  // 6. Drawn with no range named at all (the exported draw function), it says 90 days too, and follows the read's own range.
  const html = await (await open(`/app/financeos.html?client_id=${CLIENT_ID}#overview`, { session: STAFF, handlers: handlersFor([]) })).page;
  await openMoneyDetail(html, "history");
  await html.waitForSelector(".trange-btn");
  const pressed = await html.evaluate(() => {
    const read = (markup) => [...new DOMParser().parseFromString(markup, "text/html").querySelectorAll(".trange-btn")]
      .filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.getAttribute("data-range"));
    return {
      none: read(window.FHTrends.renderTrends({})),
      fromRead: read(window.FHTrends.renderTrends({ range: "12m" })),
    };
  });
  assert.deepEqual(pressed, { none: ["90d"], fromRead: ["12m"] });
  await html.close();
});
