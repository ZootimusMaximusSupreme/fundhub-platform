// Proves the Overview section: the page opens on the right file, Connect a bank
// runs the link-token -> bank window -> exchange flow, and the Trends buttons
// ask for the chosen range and remember it. Standalone page and frame tab.

import { test } from "node:test";
import assert from "node:assert/strict";

import { json, proofRows, startScreens } from "./s4-screen-harness.mjs";
import { CLIENT, CLIENT_ID, STAFF, bankLink, entryUrl, moneyResource, sampleAnswer, waitFor } from "./s4-money-harness.mjs";

const proof = proofRows(import.meta.url);
const PAGE = { entry: "page", file: "money.html", surface: "public/app/money.html" };
const FRAME = { entry: "frame", tab: "overview", surface: "financeos.html#overview" };

async function openOverview(open, target, { session = CLIENT, clientId = "", read = () => sampleAnswer("money-overview.sandbox.json"), trendsDown = { value: false } } = {}) {
  const resource = moneyResource("overview", { read });
  const trends = [];
  const link = bankLink();
  const handlers = {
    ...resource.handlers,
    ...link.handlers,
    "/api/money/trends": async (route, { url }) => {
      trends.push(new URL(url).searchParams.get("range"));
      if (trendsDown.value) return json(route, { ok: false, error: "server_error" }, 500);
      return json(route, { ok: true, range: new URL(url).searchParams.get("range"), daily: {}, monthly: { months: [] } });
    },
  };
  const opened = await open(entryUrl(target.entry, { ...target, clientId }), { session, handlers });
  await link.stubBankWindow(opened.page);
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
  // One connect run: the page loads in the named state, the button is pressed, and the exact flow is seen.
  const connect = async (target, kind) => {
    const { page, link, reads } = await openOverview(open, target, { session: STAFF, clientId: CLIENT_ID, read: kind === "empty" ? empty : undefined });
    await page.waitForSelector('[data-act="connect"]');
    if (kind === "empty") assert.match(await page.locator("body").innerText(), /No bank accounts yet/);
    await page.locator('[data-act="connect"]').first().click();
    await waitFor(() => link.posts.some((p) => p.path === "link-exchange"));
    assert.deepEqual(link.posts, link.expected(CLIENT_ID));
    await waitFor(() => reads.length >= 2);
    await page.close();
  };
  // The page lists the header button and the empty-state button as two rows; the frame lists one row for both.
  for (const kind of ["header", "empty"]) await proof.check(rows.page[kind], () => connect(PAGE, kind), PAGE.surface);
  await proof.check(rows.frame.header, async () => {
    for (const kind of ["header", "empty"]) await connect(FRAME, kind);
  }, FRAME.surface);
});

test("Trends buttons ask for 30 days, 90 days or 12 months and keep the choice", { timeout: 60_000 }, async (t) => {
  const { open } = await startScreens(t);
  await proof.check(/^Trends: 30 days \/ 90 days \/ 12 months buttons/, async () => {
    const trendsDown = { value: false };
    const { page, trends } = await openOverview(open, FRAME, { session: STAFF, clientId: CLIENT_ID, trendsDown });
    await page.waitForSelector(".trange-btn");
    assert.deepEqual(trends, ["90d"], "the default range is 90 days");
    await page.locator('.trange-btn[data-range="30d"]').click();
    await waitFor(() => trends.length === 2);
    await page.locator('.trange-btn[data-range="12m"]').click();
    await waitFor(() => trends.length === 3);
    assert.deepEqual(trends, ["90d", "30d", "12m"]);
    assert.equal(await page.evaluate(() => sessionStorage.getItem("fos_trends_range")), "12m", "the choice is kept");
    assert.equal(await page.locator('.trange-btn[data-range="12m"]').getAttribute("aria-pressed"), "true");

    // Try again: a failed read shows the button; pressing it asks again for the same range
    trendsDown.value = true;
    await page.locator('.trange-btn[data-range="30d"]').click();
    await waitFor(() => trends.length === 4);
    await page.waitForSelector("[data-trends-retry]");
    trendsDown.value = false;
    await page.locator("[data-trends-retry]").click();
    await waitFor(() => trends.length === 5);
    assert.deepEqual(trends.slice(3), ["30d", "30d"], "Try again asks for the range that failed");
    await page.waitForSelector(".trange-btn");
    assert.equal(await page.locator("[data-trends-retry]").count(), 0, "the error is gone once the read works");
    assert.equal(await page.locator('.trange-btn[data-range="30d"]').getAttribute("aria-pressed"), "true");
    await page.close();
  }, FRAME.surface);
});

test("every listed row was exercised", () => {
  proof.assertAllClaimed();
});
