// Practice test (fake data, real pages): two reads on the Money page.
//  1. "Connect a bank" on public/app/money.html loads the bank's own script
//     from cdn.plaid.com when Connect is pressed (and not before), and goes on
//     to the exchange only when that script ran.
//  2. The Trends slot: money-trends.js draws the exact returned numbers into
//     the slot when the page loaded it (the one-page frame, financeos.html),
//     and the standalone money.html, which does not load that file, leaves the
//     slot empty and asks for no trends.

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

test("the standalone Money page leaves the Trends slot empty and asks for no trends", { timeout: 60_000 }, async (t) => {
  const { open } = await startPages(t);
  const asked = [];
  const handlers = {
    "/api/money/overview": SANDBOX,
    "/api/money/trends": async (route) => { asked.push(route.request().url()); return json(route, TRENDS); },
  };
  const { page } = await open(`/app/money.html?client_id=${CLIENT_ID}`, { session: STAFF, handlers });
  await page.waitForSelector("[data-trends-slot]", { state: "attached" });
  await page.waitForTimeout(400);
  assert.equal(await page.locator("[data-trends-slot]").innerHTML(), "", "no graph without money-trends.js");
  assert.deepEqual(asked, []);
  await page.close();
});
