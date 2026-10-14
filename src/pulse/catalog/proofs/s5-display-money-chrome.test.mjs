// S5 screen proofs: the shared frame on the client's money pages. A real
// Chromium opens each page twice (as the client, then as staff naming a client)
// with a fake API, and judges the nav bar, the back link, the script that must
// load, the read that fires on load, and the Try again button on a failed read.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { openLab, newStaffPage } from "./s5-browser-kit.mjs";
import { S5_DISPLAY_ROWS } from "./s5-display-contracts.mjs";

const THIS_FILE = "src/pulse/catalog/proofs/s5-display-money-chrome.test.mjs";
const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../public/app");
const CLIENT = "c1000000-0000-4000-8000-0000000000c1";
const SIX = ["Money", "Accounts", "Credit", "Connections", "Payments", "Setup"];

// Where each nav label goes. A link that carries the right words to the wrong
// place is as broken as a missing link.
const OVERVIEW = "/app/financeos.html";
const GOES_TO = {
  Money: `${OVERVIEW}#overview`, Plan: `${OVERVIEW}#plan`, Helper: `${OVERVIEW}#helper`, Accounts: `${OVERVIEW}#accounts`,
  Credit: `${OVERVIEW}#credit`, Connections: `${OVERVIEW}#connections`, Payments: `${OVERVIEW}#payments`, Setup: `${OVERVIEW}#setup`,
  Applications: "/app/money-declines.html", Fundability: "/app/money-fundability.html",
};

// One entry per page. nav and current are what the board's order says;
// read lists every call the page must make when it opens; inlineStyle says the
// page keeps its styles in its own <style> block; on the pages that have a Try
// again, answer is a valid read for the retry and painted is what the page says
// once it has taken that answer.
const PAGES = [
  { name: "credit", nav: SIX, current: "Credit", read: ["/api/money/credit"], global: "FHMoneyCredit", retry: true, inlineStyle: true,
    answer: { ok: true, has_pull: false, business: {} }, painted: /No credit pull yet/ },
  { name: "declines", nav: ["Money", "Accounts", "Credit", "Applications", "Connections", "Payments", "Setup"], current: "Applications", read: ["/api/blueprint/declines"], global: "FHMoneyDeclines", retry: true,
    answer: { ok: true, view: { applications: [], declines: [] } }, painted: /No bank applications on your file yet/ },
  { name: "fundability", nav: ["Money", "Accounts", "Credit", "Fundability", "Connections", "Payments", "Setup"], current: "Fundability", read: ["/api/money/fundability"], global: "FHMoneyFundability", retry: true,
    answer: { ok: true, has_pull: false }, painted: /No credit file yet/ },
  { name: "next", nav: SIX, current: null, read: ["/api/money/tasks", "/api/money/ready-to-fund"], global: "FHMoneyNext", retry: false },
  { name: "connections", nav: SIX, current: "Connections", read: ["/api/money/connections"], global: "FHMoneyConnections", retry: false },
  { name: "helper", nav: ["Money", "Plan", "Helper", "Accounts", "Credit", "Connections", "Payments", "Setup"], current: "Helper", read: ["/api/money/helper"], global: "FHMoneyHelper", retry: true,
    answer: { ok: true, turns: [], pending: 0, helper: { brain: "rules" } }, painted: /Texts off: answers show here only/ },
  { name: "plan", nav: ["Money", "Plan", "Accounts", "Credit", "Connections", "Payments", "Setup"], current: "Plan", read: ["/api/money/plan"], global: "FHMoneyPlan", retry: false },
  { name: "setup", nav: SIX, current: "Setup", read: ["/api/money/setup"], global: "FHMoneySetup", retry: false, inlineStyle: true },
  { name: "payments", nav: SIX, current: "Payments", read: ["/api/money/payments"], global: "FHMoneyPayments", retry: false },
];

async function openPage(lab, page, { client, reads = [] }) {
  const files = [];
  page.on("response", (response) => { files.push({ url: new URL(response.url()), status: response.status() }); });
  await page.goto(`${lab.origin}/app/money-${page.moneyName}.html${client ? `?client_id=${CLIENT}` : ""}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelector(`[id$="-root"]`)?.children.length > 0, null, { polling: 100, timeout: 30_000 });
  // Ready means every read the page makes on load has been asked for and the
  // network has gone quiet, so a second, unwanted read would be seen too.
  const deadline = Date.now() + 30_000;
  while (reads.some((readPath) => !page.apiCalls.some((call) => call.path === readPath))) {
    assert.ok(Date.now() < deadline, `${page.moneyName}: ${reads.join(", ")} was not read on load`);
    await page.waitForTimeout(25);
  }
  await page.waitForLoadState("networkidle");
  return files;
}

const frame = (page) => page.evaluate(() => ({
  styles: [...document.querySelectorAll("style")].filter((node) => node.textContent.trim().length > 0).length,
  back: [document.getElementById("money-back")?.textContent.trim(), document.getElementById("money-back")?.getAttribute("href")],
  nav: [...document.querySelectorAll(".mnav a")].map((a) => ({ label: a.textContent.trim(), href: a.getAttribute("href"), current: a.getAttribute("aria-current") })),
}));

test("each money page keeps its nav bar, back link, script, and first read, for the client and for staff", { timeout: 300_000 }, async (t) => {
  const lab = await openLab();
  t.after(() => lab.close());
  for (const spec of PAGES) {
    // The client, no client id in the address.
    const clientPage = await newStaffPage(lab, { role: "client" });
    clientPage.moneyName = spec.name;
    const clientFiles = await openPage(lab, clientPage, { client: false, reads: spec.read });
    const asClient = await frame(clientPage);
    assert.deepEqual(asClient.nav.map((link) => link.label), spec.nav, `${spec.name}: nav order`);
    assert.deepEqual(
      asClient.nav.map((link) => [link.label, link.href]),
      spec.nav.map((label) => [label, GOES_TO[label]]),
      `${spec.name}: every nav word goes where its word says`,
    );
    if (spec.inlineStyle) assert.ok(asClient.styles > 0, `${spec.name}: keeps its styles in its own <style> block`);
    assert.deepEqual(asClient.nav.filter((link) => link.current === "page").map((link) => link.label), spec.current ? [spec.current] : [], `${spec.name}: current marker`);
    assert.ok(asClient.nav.every((link) => !/client_id/.test(link.href)), `${spec.name}: no client id on client links`);
    assert.deepEqual(asClient.back, ["Back to my portal", "client-portal.html"], `${spec.name}: client back link`);
    for (const readPath of spec.read) {
      const calls = clientPage.apiCalls.filter((call) => call.path === readPath);
      assert.equal(calls.length, 1, `${spec.name}: ${readPath} is read once on load`);
      assert.equal(calls[0].method, "GET");
      assert.equal(calls[0].query.client_id, undefined, `${spec.name}: the client names nobody`);
    }
    const script = clientFiles.find((file) => file.url.pathname === `/app/money-${spec.name}.js`);
    assert.equal(script?.status, 200, `${spec.name}: its script loads`);
    assert.equal(await clientPage.evaluate((name) => typeof window[name], spec.global), "object", `${spec.name}: ${spec.global} is defined`);
    if (fs.existsSync(path.join(APP, `money-${spec.name}.css`))) {
      assert.equal(clientFiles.find((file) => file.url.pathname === `/app/money-${spec.name}.css`)?.status, 200);
    }
    await clientPage.close();

    // Staff naming a client: every link, the back link and every read carry it.
    const staffPage = await newStaffPage(lab, { role: "owner" });
    staffPage.moneyName = spec.name;
    await openPage(lab, staffPage, { client: true, reads: spec.read });
    const asStaff = await frame(staffPage);
    assert.deepEqual(asStaff.nav.map((link) => link.label), spec.nav);
    for (const link of asStaff.nav) {
      const target = new URL(link.href, lab.origin);
      assert.equal(target.searchParams.get("client_id"), CLIENT, `${spec.name}: ${link.label} carries the client`);
      assert.equal(target.pathname + target.hash, GOES_TO[link.label], `${spec.name}: ${link.label} still goes to its own place`);
    }
    assert.deepEqual(asStaff.back, ["Back to Finance OS", `finance-os.html?client_id=${CLIENT}`], `${spec.name}: staff back link`);
    for (const readPath of spec.read) {
      const calls = staffPage.apiCalls.filter((call) => call.path === readPath);
      assert.ok(calls.length >= 1, `${spec.name}: ${readPath} is read`);
      assert.ok(calls.every((call) => call.query.client_id === CLIENT), `${spec.name}: ${readPath} names the client`);
    }
    await staffPage.close();
  }
});

test("a failed first read shows the error with a Try again button that reads again", { timeout: 180_000 }, async (t) => {
  const lab = await openLab();
  t.after(() => lab.close());
  for (const spec of PAGES.filter((item) => item.retry)) {
    let failing = true;
    const page = await newStaffPage(lab, {
      role: "client",
      api: (request, url) => {
        if (url.pathname === "/api/auth/session") return undefined;
        return failing ? { status: 500, body: { ok: false, error: "query_failed" } } : spec.answer;
      },
    });
    page.moneyName = spec.name;
    await openPage(lab, page, { client: false, reads: spec.read });
    const retry = page.getByRole("button", { name: /try again/i });
    // The error is painted a moment after the failed answer lands; wait for the
    // button itself rather than counting at a guessed moment.
    await retry.first().waitFor({ state: "visible", timeout: 30_000 });
    assert.equal(await retry.count(), 1, `${spec.name}: one Try again button`);
    const reads = () => page.apiCalls.filter((call) => call.path === spec.read[0]).length;
    const before = reads();
    failing = false;
    // A click that a repaint swallowed is tapped again. A button that is dead
    // never makes a read, however many times it is tapped, and fails here.
    for (let tap = 0; tap < 5 && reads() === before; tap += 1) {
      await retry.first().click();
      const until = Date.now() + 5_000;
      while (reads() === before && Date.now() < until) await page.waitForTimeout(50);
    }
    assert.ok(reads() > before, `${spec.name}: Try again made no read`);
    // Ready means the page took the answer: its own success words are on the
    // screen and no Try again is. Loading has no Try again either, so the
    // absence of the button alone would pass while the answer was still on its way.
    const ok = spec.painted.source;
    try {
      await page.waitForFunction(
        (pattern) => new RegExp(pattern).test(document.body.innerText)
          && ![...document.querySelectorAll("button")].some((b) => /try again/i.test(b.textContent)),
        ok,
        { polling: 100, timeout: 30_000 },
      );
    } catch (error) {
      const seen = page.apiCalls.map((call) => call.path).join(" ");
      const shown = await page.evaluate(() => document.body.innerText.slice(0, 300)).catch(() => "(page gone)");
      throw new Error(`${spec.name}: the page did not take the retry answer. reads before ${before}, now ${reads()}; calls: ${seen}; page: ${shown}`);
    }
    assert.equal(reads(), before + 1, `${spec.name}: Try again reads once more`);
    await page.close();
  }
});

test("the registry names exactly the pages and kinds this file proves", () => {
  const mine = S5_DISPLAY_ROWS.filter((row) => row.test === THIS_FILE);
  const byPage = new Map();
  for (const row of mine) {
    const page = row.surface.match(/money-([a-z]+)\.html$/)[1];
    byPage.set(page, [...(byPage.get(page) || []), row.control.split(/[ (:]/)[0]]);
  }
  assert.deepEqual([...byPage.keys()].sort(), PAGES.map((p) => p.name).sort());
  for (const spec of PAGES) {
    const kinds = byPage.get(spec.name);
    for (const must of ["Money", "Back", "Page"]) assert.ok(kinds.includes(must), `${spec.name} is missing a ${must} row`);
    assert.equal(kinds.includes("Error"), spec.retry, `${spec.name}: error row only where the retry case runs`);
  }
});
