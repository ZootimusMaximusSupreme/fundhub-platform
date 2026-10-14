// Proves the Overview section: the page opens on the right file, Connect a bank
// runs the link-token -> bank window -> exchange flow, and the Trends buttons
// ask for the chosen range and remember it. Standalone page and frame tab.

import { test } from "node:test";
import assert from "node:assert/strict";

import { json, proofRows, startScreens } from "./s4-screen-harness.mjs";
import { CLIENT, CLIENT_ID, STAFF, entryUrl, moneyResource, sampleAnswer, waitFor } from "./s4-money-harness.mjs";

const proof = proofRows(import.meta.url);
const PAGE = { entry: "page", file: "money.html", surface: "public/app/money.html" };
const FRAME = { entry: "frame", tab: "overview", surface: "financeos.html#overview" };

async function openOverview(open, target, { session = CLIENT, clientId = "", read = () => sampleAnswer("money-overview.sandbox.json") } = {}) {
  const resource = moneyResource("overview", { read });
  const link = [];
  const trends = [];
  const handlers = {
    ...resource.handlers,
    "/api/money/trends": async (route, { url }) => {
      trends.push(new URL(url).searchParams.get("range"));
      return json(route, { ok: true, range: new URL(url).searchParams.get("range"), daily: {}, monthly: { months: [] } });
    },
    "/api/banking/link-token": async (route) => {
      link.push({ path: "link-token", body: JSON.parse(route.request().postData() || "{}") });
      return json(route, { ok: true, link_token: "fake-link-token" });
    },
    "/api/banking/link-exchange": async (route) => {
      link.push({ path: "link-exchange", body: JSON.parse(route.request().postData() || "{}") });
      return json(route, { ok: true });
    },
  };
  const opened = await open(entryUrl(target.entry, { ...target, clientId }), { session, handlers });
  await opened.page.route("https://cdn.plaid.com/**", (route) => route.fulfill({
    contentType: "text/javascript",
    body: "window.Plaid={create:function(c){return{open:function(){setTimeout(function(){c.onSuccess('fake-public-token',{institution:{institution_id:'ins_sample',name:'Sample Bank'}})},0)}}}};",
  }));
  return { ...opened, ...resource.log, link, trends };
}

test("the page opens on the client's own file, or on the file staff name", { timeout: 60_000 }, async (t) => {
  const { open } = await startScreens(t);
  await proof.check(/^Open the page \(client, or staff with \?client_id=\)/, async () => {
    const answer = sampleAnswer("money-overview.sandbox.json");
    const own = await openOverview(open, PAGE);
    await own.page.waitForFunction(() => /Money/.test(document.querySelector("h1")?.innerText || ""));
    assert.deepEqual(own.reads, [""], "a client reads their own file with no client_id");
    assert.match(await own.page.locator(".head .caption").first().innerText(), new RegExp(answer.client.name));
    assert.match(await own.page.locator("body").innerText(), /Test data — Plaid sandbox/);
    await own.page.close();
    const staff = await openOverview(open, PAGE, { session: STAFF, clientId: CLIENT_ID });
    await staff.page.waitForSelector(".head");
    assert.deepEqual(staff.reads, [`?client_id=${CLIENT_ID}`]);
    await staff.page.close();
  }, PAGE.surface);
});

test("Connect a bank runs token, bank window and exchange, in the header and in the empty state", { timeout: 90_000 }, async (t) => {
  const { open } = await startScreens(t);
  const empty = () => ({ ...sampleAnswer("money-overview.sandbox.json"), accounts: [] });
  const rows = {
    page: { header: /^Connect a bank \(header button/, empty: /^Connect a bank \(empty-state button/ },
    frame: { header: /^Connect a bank button \(header, and again in the empty state\)/ },
  };
  for (const [target, readers] of [[PAGE, { header: undefined, empty }], [FRAME, { header: undefined, empty }]]) {
    for (const kind of ["header", "empty"]) {
      const { page, link, reads } = await openOverview(open, target, { session: STAFF, clientId: CLIENT_ID, read: readers[kind] });
      await page.waitForSelector('[data-act="connect"]');
      if (kind === "empty") assert.match(await page.locator("body").innerText(), /No bank accounts yet/);
      await page.locator('[data-act="connect"]').first().click();
      await waitFor(() => link.some((p) => p.path === "link-exchange"));
      assert.deepEqual(link, [
        { path: "link-token", body: { client_id: CLIENT_ID } },
        { path: "link-exchange", body: { public_token: "fake-public-token", institution: { institution_id: "ins_sample", name: "Sample Bank" }, client_id: CLIENT_ID } },
      ]);
      await page.waitForFunction(() => /Bank connected\. Loading your accounts…/.test(document.body.innerText) || document.querySelector("h1"));
      await waitFor(() => reads.length >= 2);
      if (rows[target.entry][kind]) await proof.check(rows[target.entry][kind], async () => {}, target.surface);
      await page.close();
    }
  }
});

test("Trends buttons ask for 30 days, 90 days or 12 months and keep the choice", { timeout: 60_000 }, async (t) => {
  const { open } = await startScreens(t);
  await proof.check(/^Trends: 30 days \/ 90 days \/ 12 months buttons/, async () => {
    const { page, trends } = await openOverview(open, FRAME, { session: STAFF, clientId: CLIENT_ID });
    await page.waitForSelector(".trange-btn");
    assert.deepEqual(trends, ["90d"], "the default range is 90 days");
    await page.locator('.trange-btn[data-range="30d"]').click();
    await waitFor(() => trends.length === 2);
    await page.locator('.trange-btn[data-range="12m"]').click();
    await waitFor(() => trends.length === 3);
    assert.deepEqual(trends, ["90d", "30d", "12m"]);
    assert.equal(await page.evaluate(() => sessionStorage.getItem("fos_trends_range")), "12m", "the choice is kept");
    assert.equal(await page.locator('.trange-btn[data-range="12m"]').getAttribute("aria-pressed"), "true");
    await page.close();
  }, FRAME.surface);
});

test("every listed row was exercised", () => {
  proof.assertAllClaimed();
});
