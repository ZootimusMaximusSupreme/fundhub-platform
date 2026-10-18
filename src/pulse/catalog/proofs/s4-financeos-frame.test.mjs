// Proves the FinanceOS one-page frame: the sixteen tabs and the header, a 401
// sending each kind of person to their own sign-in page and back to the same
// tab, and the client id staff open the page with riding on every read.

import { test } from "node:test";
import assert from "node:assert/strict";

import { json, proofRows, startScreens } from "./s4-screen-harness.mjs";
import { CLIENT, CLIENT_ID, STAFF, sampleAnswer, waitFor } from "./s4-money-harness.mjs";

const proof = proofRows(import.meta.url);
const TABS = ["overview", "accounts", "payments", "transfers", "alerts", "next", "credit", "fundability", "strategy", "banks", "declines", "helper", "plan", "vault", "connections", "setup"];

test("the frame lists every tab, names the client and shows the sandbox note", { timeout: 60_000 }, async (t) => {
  const { open } = await startScreens(t);
  await proof.check(/^Page itself loads/, async () => {
    const overview = { ...sampleAnswer("money-overview.sandbox.json"), sandbox: true };
    const refusedScripts = [];
    const watchScripts = (page) => page.on("response", (response) => {
      if (/\.js$/.test(new URL(response.url()).pathname) && response.status() !== 200) refusedScripts.push(`${response.status()} ${response.url()}`);
    });
    const { page, errors } = await open("/app/financeos.html", { session: CLIENT, handlers: { "/api/money/overview": overview }, before: watchScripts });
    await page.waitForFunction((name) => document.querySelector("#fos-client")?.textContent === name, overview.client.name);
    assert.deepEqual(await page.locator(".fos-tabs a").evaluateAll((els) => els.map((e) => e.id.replace("tab-", ""))), TABS);
    assert.equal(await page.locator("#fos-sandbox").isVisible(), true, "the sandbox note shows for test data");
    const missing = await page.evaluate((keys) => keys.filter((k) => !(window.FinanceOS.sections[k] && typeof window.FinanceOS.sections[k].mount === "function")), TABS);
    assert.deepEqual(missing, [], "every tab has its section script loaded");
    // 17 section scripts (the sixteen tabs and the trends script), then the frame's own
    const scripts = await page.evaluate(() => [...document.scripts].map((el) => el.getAttribute("src")).filter(Boolean));
    assert.equal(scripts[0], "/app/fundhub-font.js", "the shared presentation adapter loads first");
    assert.ok(scripts.includes("/app/client-ios.js"), "client-only navigation is loaded");
    assert.equal(scripts.filter(src => !["/app/fundhub-font.js", "/app/client-ios.js"].includes(src)).length, 18);
    assert.equal(scripts.at(-1), "financeos.js", "the frame script loads after every section");
    assert.deepEqual(refusedScripts, [], "every script answered");
    assert.equal(await page.evaluate(() => typeof window.FinanceOS.trends?.mount + "/" + typeof window.FinanceOS.extras?.connections?.mount), "function/function");
    for (const tab of TABS) {
      await page.locator(`#tab-${tab}`).click();
      await page.waitForFunction((k) => document.querySelector(`#tab-${k}`).getAttribute("aria-selected") === "true", tab);
      assert.equal(await page.locator(`#fos-${tab}`).isVisible(), true, `${tab} opens`);
      assert.doesNotMatch(await page.locator(`#fos-${tab}`).innerText(), /coming soon/i, `${tab} is a real section`);
    }
    assert.deepEqual(errors, []);
    await page.close();
  });
});

test("a 401 sends a client to the portal sign-in and staff to the staff sign-in, back to the same tab", { timeout: 60_000 }, async (t) => {
  const { open } = await startScreens(t);
  await proof.check(/^Sign-in redirect on any 401/, async () => {
    const refuse = (route) => route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ ok: false, error: "unauthorized" }) });
    const client = await open("/app/financeos.html#banks", { session: CLIENT, handlers: { "/api/money/overview": refuse, "/api/money/banks": refuse } });
    await client.page.waitForURL(/\/portal-login\.html$/);
    await client.page.close();

    const staff = await open(`/app/financeos.html?client_id=${CLIENT_ID}#banks`, { session: STAFF, handlers: { "/api/money/overview": json_ok, "/api/money/banks": refuse } });
    await staff.page.waitForURL(/\/login\.html\?next=/);
    const next = new URL(staff.page.url()).searchParams.get("next");
    assert.equal(next, `/app/financeos.html?client_id=${CLIENT_ID}#banks`, "staff come back to the same tab on the same client");
    await staff.page.close();
  });
});

function json_ok(route) {
  return json(route, { ok: true, client: { name: "Dana Whitfield" }, sandbox: false });
}

test("a staff view carries the client id on every read and on the way back to Finance OS", { timeout: 60_000 }, async (t) => {
  const { open } = await startScreens(t);
  await proof.check(/^Staff view: who may open this page/, async () => {
    const reads = [];
    const record = (route, { url }) => { reads.push(new URL(url).pathname + new URL(url).search); return json(route, { ok: true, client: { name: "Dana Whitfield" } }); };
    const staff = await open(`/app/financeos.html?client_id=${CLIENT_ID}#overview`, { session: STAFF, handlers: { "/api/money/overview": record, "/api/money/banks": record } });
    await staff.page.waitForSelector("#fos-overview");
    await waitFor(() => reads.length >= 1);
    await staff.page.locator("#tab-banks").click();
    await waitFor(() => reads.some((r) => r.startsWith("/api/money/banks")));
    for (const read of reads) assert.match(read, new RegExp(`client_id=${CLIENT_ID}`), `${read} names the client`);
    assert.equal(await staff.page.locator("#money-back").getAttribute("href"), `finance-os.html?client_id=${CLIENT_ID}`);
    await staff.page.close();

    const ownReads = [];
    const own = await open("/app/financeos.html#overview", { session: CLIENT, handlers: { "/api/money/overview": (route, { url }) => { ownReads.push(new URL(url).search); return json_ok(route); } } });
    await own.page.waitForSelector("#fos-overview");
    await waitFor(() => ownReads.length >= 1);
    assert.deepEqual(ownReads, [""], "a client's read names no client");
    await own.page.close();
  });
});

test("every listed row was exercised", () => {
  proof.assertAllClaimed();
});
