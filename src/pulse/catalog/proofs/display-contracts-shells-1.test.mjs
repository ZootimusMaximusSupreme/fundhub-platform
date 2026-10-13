import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";
import {
  DISPLAY_CONTRACTS_SHELLS_1,
  DISPLAY_CONTRACTS_SHELLS_1_METADATA,
  DISPLAY_CONTRACTS_SHELLS_1_ROW_KEYS,
} from "./display-contracts-shells-1.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const PUBLIC = path.join(ROOT, "public");
const CATALOG = JSON.parse(fs.readFileSync(path.join(ROOT, "src/pulse/catalog/generated.json"), "utf8"));
const TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
]);

function staticFile(pathname) {
  const clean = decodeURIComponent(pathname).replace(/^\/+/, "");
  const candidates = clean.endsWith("/")
    ? [path.join(PUBLIC, clean, "index.html")]
    : [path.join(PUBLIC, clean), path.join(PUBLIC, clean, "index.html")];
  return candidates.find((candidate) => candidate.startsWith(`${PUBLIC}${path.sep}`) && fs.existsSync(candidate));
}

async function startServer() {
  const server = http.createServer((req, res) => {
    const file = staticFile(new URL(req.url, "http://127.0.0.1").pathname);
    if (!file) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("not found");
      return;
    }
    res.writeHead(200, { "content-type": TYPES.get(path.extname(file)) || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

async function closeServer(server) {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function fulfillJson(route, body, status = 200) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function makePage(browser, origin, { width = 1440, height = 900, role = "owner" } = {}) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.addInitScript(() => {
    localStorage.setItem("fh_token", "shell-proof-fake-token");
    localStorage.setItem("fh_role", "owner");
  });
  await page.route("https://**", (route) => route.abort());
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "GET" && url.pathname === "/api/auth/session") {
      return fulfillJson(route, {
        ok: true,
        staff: {
          id: "staff-shell-proof",
          name: "Casey Shell Proof",
          email: "casey.shell-proof@example.test",
          role,
          org_id: "org-shell-proof",
          status: "active",
        },
      });
    }
    if (request.method() === "GET" && url.pathname === "/api/read/search") {
      assert.equal(url.searchParams.get("q"), "Casey Shell Proof");
      return fulfillJson(route, {
        ok: true,
        groups: {
          clients: [{
            href: "client-control-panel.html?id=client-shell-proof",
            title: "Casey Search Proof",
            subtitle: "Fake client · shell-proof-001",
          }],
        },
      });
    }
    return fulfillJson(route, { ok: true, data: {}, items: [], tasks: [], count: 0 });
  });
  return page;
}

async function waitForShell(page) {
  await page.locator('#side[data-fh-wired="1"]').waitFor({ state: "attached" });
  await page.locator("#fh-shell-chip").waitFor({ state: "attached" });
  await page.waitForFunction(() => !document.getElementById("fh-gate-style"));
}

test("exports only exact wired rows in the three named source files", () => {
  assert.equal(DISPLAY_CONTRACTS_SHELLS_1_METADATA.provedCount, 6);
  assert.deepEqual(DISPLAY_CONTRACTS_SHELLS_1_METADATA.sourceFiles, ["desks-b.json", "desks-e.json", "desks-f.json"]);
  assert.equal(new Set(DISPLAY_CONTRACTS_SHELLS_1_ROW_KEYS).size, DISPLAY_CONTRACTS_SHELLS_1_ROW_KEYS.length);
  assert.equal(DISPLAY_CONTRACTS_SHELLS_1_ROW_KEYS.length, DISPLAY_CONTRACTS_SHELLS_1.length);

  const byId = new Map(CATALOG.items.map((row) => [row.id, row]));
  for (const proof of DISPLAY_CONTRACTS_SHELLS_1) {
    const row = byId.get(proof.rowKey);
    assert.ok(row, `catalog row is missing: ${proof.rowKey}`);
    assert.equal(row.sourceFile, proof.sourceFile);
    assert.equal(row.surface, proof.surface);
    assert.equal(row.family, proof.family);
    assert.equal(row.expected, proof.expected);
    assert.equal(row.state, "wired", `${proof.rowKey} was not wired after catalog rebuild`);
    assert.equal(row.proofDepth, "deep");
    assert.equal(row.proofVerdict, undefined);
    assert.equal(proof.proof.depth, "deep");
    assert.equal(proof.proof.runner, "rendered-chromium-local-fake-routes");
    assert.equal(proof.proof.file, "src/pulse/catalog/proofs/display-contracts-shells-1.test.mjs");
    assert.ok(proof.proof.assertion.length > 30);
  }
});

test("rendered sidebar logo and burger show their navigation and rail results", { timeout: 60_000 }, async (t) => {
  const { server, origin } = await startServer();
  const browser = await chromium.launch({ headless: true });
  t.after(async () => {
    await browser.close();
    await closeServer(server);
  });

  const page = await makePage(browser, origin);
  await page.goto(`${origin}/app/sales-floor.html`, { waitUntil: "domcontentloaded" });
  await waitForShell(page);

  const logo = page.locator("#side a.logo");
  assert.equal(await logo.getAttribute("href"), "pipeline.html");
  await logo.click();
  await page.waitForURL(/\/app\/pipeline\.html$/);
  await page.locator("#board").waitFor({ state: "attached" });
  assert.equal(await page.title(), "Fundhub — Pipeline");

  await page.goto(`${origin}/app/sales-floor.html`, { waitUntil: "domcontentloaded" });
  await waitForShell(page);
  const side = page.locator("#side");
  const burger = page.locator("#burger");
  const expandedWidth = await side.evaluate((node) => node.getBoundingClientRect().width);
  await burger.click();
  assert.equal(await side.evaluate((node) => node.classList.contains("mini")), true);
  assert.equal(await page.locator("html").evaluate((node) => node.classList.contains("fh-side-mini")), true);
  await page.waitForFunction((width) => document.querySelector("#side").getBoundingClientRect().width < width, expandedWidth);
  const collapsedWidth = await side.evaluate((node) => node.getBoundingClientRect().width);
  assert.ok(collapsedWidth < expandedWidth, `collapsed rail ${collapsedWidth}px should be narrower than ${expandedWidth}px`);
  await burger.click();
  assert.equal(await side.evaluate((node) => node.classList.contains("mini")), false);
  await page.waitForFunction((width) => Math.abs(document.querySelector("#side").getBoundingClientRect().width - width) < 1, expandedWidth);
  const restoredWidth = await side.evaluate((node) => node.getBoundingClientRect().width);
  assert.ok(Math.abs(restoredWidth - expandedWidth) < 1, `restored rail ${restoredWidth}px should match ${expandedWidth}px`);
  await page.close();
});

test("rendered shared shell searches fake client data and hides/restores its account bar", { timeout: 60_000 }, async (t) => {
  const { server, origin } = await startServer();
  const browser = await chromium.launch({ headless: true });
  t.after(async () => {
    await browser.close();
    await closeServer(server);
  });

  const page = await makePage(browser, origin);
  await page.goto(`${origin}/app/sales-floor.html`, { waitUntil: "domcontentloaded" });
  await waitForShell(page);

  await page.locator("#fh-shell-search-btn").click();
  const overlay = page.locator("#fh-shell-search-overlay");
  assert.equal(await overlay.isVisible(), true);
  await page.locator("#fh-shell-search-input").fill("Casey Shell Proof");
  const hit = page.locator(".fh-search-hit");
  await hit.waitFor({ state: "visible" });
  assert.equal(await hit.locator(".fh-search-title").innerText(), "Casey Search Proof");
  assert.equal(await hit.locator(".fh-search-sub").innerText(), "Fake client · shell-proof-001");
  assert.equal(await hit.getAttribute("href"), "client-control-panel.html?id=client-shell-proof");
  await hit.click();
  await page.waitForURL(/\/app\/client-control-panel\.html\?id=client-shell-proof$/);
  await page.locator("#fh-shell-chip").waitFor({ state: "attached" });
  assert.equal(new URL(page.url()).searchParams.get("id"), "client-shell-proof");

  const chip = page.locator("#fh-shell-chip");
  const hide = page.locator("#fh-shell-chip-hide");
  const show = page.locator("#fh-shell-chip-show");
  await hide.click();
  assert.equal(await chip.isVisible(), false);
  assert.equal(await show.isVisible(), true);
  assert.equal(await show.innerText(), "account");
  await show.click();
  assert.equal(await chip.isVisible(), true);
  assert.equal(await show.isVisible(), false);
  await page.close();
});

test("rendered public shell toggles the Sales links and the phone drawer", { timeout: 60_000 }, async (t) => {
  const { server, origin } = await startServer();
  const browser = await chromium.launch({ headless: true });
  t.after(async () => {
    await browser.close();
    await closeServer(server);
  });

  const page = await makePage(browser, origin, { width: 390, height: 844 });
  await page.goto(`${origin}/app/sales-floor.html`, { waitUntil: "domcontentloaded" });
  await waitForShell(page);

  const menu = page.locator("#fh-menu-btn");
  const side = page.locator("#side");
  const scrim = page.locator("#side-scrim");
  await menu.click();
  assert.equal(await side.evaluate((node) => node.classList.contains("open")), true);
  assert.equal(await menu.getAttribute("aria-expanded"), "true");
  assert.equal(await scrim.evaluate((node) => node.classList.contains("show")), true);
  await page.mouse.click(380, 400);
  assert.equal(await side.evaluate((node) => node.classList.contains("open")), false);
  assert.equal(await scrim.evaluate((node) => node.classList.contains("show")), false);
  assert.equal(await menu.getAttribute("aria-expanded"), "false");

  await menu.click();
  const sales = page.locator('#side .navgroup[data-fh-section="sales"]');
  const pipeline = sales.locator('a.navitem[href="pipeline.html"]');
  const salesHrefs = await sales.locator("a.navitem").evaluateAll((links) => links.map((link) => link.getAttribute("href")));
  assert.deepEqual(salesHrefs, [
    "pipeline.html",
    "closer-dashboard.html",
    "my-numbers.html",
    "sales-floor.html",
    "calendar.html",
  ]);
  await sales.locator(".navhead").click();
  assert.equal(await sales.evaluate((node) => node.classList.contains("closed")), true);
  assert.equal(await pipeline.isVisible(), false);
  await sales.locator(".navhead").click();
  assert.equal(await sales.evaluate((node) => node.classList.contains("closed")), false);
  assert.equal(await pipeline.isVisible(), true);
  await pipeline.click();
  await page.waitForURL(/\/app\/pipeline\.html$/);
  await page.locator("#board").waitFor({ state: "attached" });
  assert.equal(await page.title(), "Fundhub — Pipeline");
  await page.close();
});
