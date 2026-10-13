import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

import {
  DISPLAY_CONTRACTS_MONEY_2_METADATA,
  DISPLAY_CONTRACTS_MONEY_2_PROOF_KEYS,
  DISPLAY_CONTRACTS_MONEY_2_PROOFS,
} from "./display-contracts-money-2.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const PUBLIC = path.join(ROOT, "public");
const CATALOG = JSON.parse(fs.readFileSync(path.join(ROOT, "src/pulse/catalog/generated.json"), "utf8"));
const CONNECTION_FIXTURE = JSON.parse(fs.readFileSync(path.join(ROOT, "src/http/fixtures/money-connections.sample.json"), "utf8"));
const PLAN_FIXTURE = JSON.parse(fs.readFileSync(path.join(ROOT, "src/http/fixtures/money-plan.sample.json"), "utf8"));
const TYPES = new Map([
  [".css", "text/css; charset=utf-8"], [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"], [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
]);
const CLIENT_ID = "fake-client-2";

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

async function json(route, body, status = 200) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function newPage(browser, origin, pathAndQuery = "/app/money-connections.html") {
  const context = await browser.newContext({
    reducedMotion: "reduce",
    viewport: { width: 1440, height: 1000 },
    permissions: ["clipboard-read", "clipboard-write"],
  });
  await context.addInitScript(() => {
    localStorage.setItem("fh_role", "owner");
    localStorage.setItem("fh_token", "money-2-fake-token");
    window.__fakeClipboard = "";
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value) => { window.__fakeClipboard = value; },
        readText: async () => window.__fakeClipboard,
      },
    });
  });
  await context.route(/^https:\/\/fonts\.(?:googleapis|gstatic)\.com\//, (route) => route.abort());
  const page = await context.newPage();
  return { context, page, url: `${origin}${pathAndQuery}` };
}

test("Money 2 contains only unique exact wired rows from desks-d", () => {
  assert.equal(DISPLAY_CONTRACTS_MONEY_2_METADATA.provedCount, DISPLAY_CONTRACTS_MONEY_2_PROOFS.length);
  assert.equal(new Set(DISPLAY_CONTRACTS_MONEY_2_PROOF_KEYS).size, DISPLAY_CONTRACTS_MONEY_2_PROOF_KEYS.length);
  assert.deepEqual(DISPLAY_CONTRACTS_MONEY_2_METADATA.sourceFiles, ["desks-d.json"]);
  const byId = new Map(CATALOG.items.map((row) => [row.id, row]));
  for (const proof of DISPLAY_CONTRACTS_MONEY_2_PROOFS) {
    const row = byId.get(proof.rowId);
    assert.ok(row, `catalog row is missing: ${proof.rowId}`);
    assert.equal(row.sourceFile, proof.sourceFile);
    assert.equal(row.surface, proof.surface);
    assert.equal(row.proofAsserts, proof.control);
    assert.equal(row.state, "wired", `${proof.rowId} was not wired after catalog rebuild`);
    assert.equal(row.proofDepth, "deep");
    assert.equal(row.proofVerdict, undefined);
    assert.equal(proof.key, `${proof.sourceFile}\0${proof.surface}\0${proof.control}`);
    assert.deepEqual(proof.tests, [DISPLAY_CONTRACTS_MONEY_2_METADATA.test]);
    assert.equal(proof.evidence, DISPLAY_CONTRACTS_MONEY_2_METADATA.test);
    assert.equal(proof.proof.runner, "local Chromium with controlled fake API routes");
  }
});

test("rendered Connections actions send exact choices and show exact saved results", async (t) => {
  const { server, origin } = await startServer();
  const browser = await chromium.launch({ headless: true });
  const exercised = new Set();
  t.after(async () => { await browser.close(); await new Promise((resolve) => server.close(resolve)); });

  let data = structuredClone(CONNECTION_FIXTURE);
  data.open_api_url = "https://fake.example.test/merchant/events";
  const posts = [];
  let failFirstRead = false;
  let readCount = 0;
  const { context, page, url } = await newPage(browser, origin);
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname !== "/api/money/connections") return json(route, { ok: true });
    if (request.method() === "GET") {
      readCount++;
      if (failFirstRead && readCount === 1) return json(route, { ok: false, error: "offline" }, 503);
      return json(route, data);
    }
    const body = request.postDataJSON();
    posts.push(body);
    if (body.action === "create") {
      const connection = {
        id: body.provider === "api" ? "fake-api" : "fake-whop",
        provider: body.provider, provider_label: body.provider === "api" ? "Open API" : "Whop",
        entity_name: body.entity_id === CONNECTION_FIXTURE.containers[1].id ? "Chris (personal)" : "Fundhub LLC",
        status: "waiting", mode: body.mode, has_api_key: false, has_secret: false, event_count: 0,
        webhook_url: "https://fake.example.test/hook",
      };
      data = { ...data, connections: [...data.connections, connection] };
      return json(route, { ok: true, connection, ...(body.provider === "api" ? { api_key: "fake-once-only-key" } : {}) }, 201);
    }
    const connection = data.connections.find((item) => item.id === body.connection_id);
    if (body.action === "secret") {
      connection.has_secret = true;
      connection.status = "active";
      return json(route, { ok: true, connection });
    }
    if (body.action === "api_key") {
      connection.has_api_key = true;
      connection.api_key_hint = "fake";
      return json(route, { ok: true, connection, sync: { ok: true, inserted: 2, done: true } });
    }
    if (body.action === "sync") return json(route, { ok: true, connection, sync: { ok: true, inserted: 3, done: true } });
    if (body.action === "disable") {
      data = { ...data, connections: data.connections.filter((item) => item.id !== connection.id) };
      return json(route, { ok: true, connection: { ...connection, status: "disabled" } });
    }
    return json(route, { ok: false, error: "unexpected action" }, 400);
  });
  await page.goto(url, { waitUntil: "domcontentloaded" });

  const whop = page.locator('[data-provider="whop"]');
  await whop.locator('[data-ent="whop"]').selectOption(CONNECTION_FIXTURE.containers[1].id);
  await whop.locator('[data-mode="whop"]').selectOption("push");
  await whop.getByRole("button", { name: "Connect Whop" }).click();
  await page.locator('[data-conn="fake-whop"]').waitFor({ state: "visible" });
  assert.deepEqual(posts[0], {
    action: "create", provider: "whop", entity_id: CONNECTION_FIXTURE.containers[1].id, mode: "push",
  });
  assert.equal(await page.locator('[data-conn="fake-whop"] .conn-name').innerText(), "Chris (personal)");
  exercised.add("c546a8636bd471dd6858");
  exercised.add("3bf7b97f2f42c2bfd144");

  const openApi = page.locator('[data-provider="api"]');
  await openApi.getByRole("button", { name: "Connect Open API" }).click();
  await page.getByText("Your key — shown this one time", { exact: true }).waitFor();
  assert.equal(await page.getByText("fake-once-only-key", { exact: true }).count(), 1);
  const copyKey = page.locator('[data-conn="fake-api"] [data-act="copy"]').filter({ hasText: "Copy key" });
  await copyKey.click();
  const copiedKey = page.locator('[data-conn="fake-api"] [data-copy="fake-once-only-key"]');
  await copiedKey.filter({ hasText: "Copied" }).waitFor();
  assert.equal(await copiedKey.innerText(), "Copied");
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "fake-once-only-key");
  const copyAddress = page.locator('[data-conn="fake-api"] [data-act="copy"]').filter({ hasText: "Copy address" });
  await copyAddress.click();
  const copiedAddress = page.locator('[data-conn="fake-api"] [data-copy="https://fake.example.test/merchant/events"]');
  await copiedAddress.filter({ hasText: "Copied" }).waitFor();
  assert.equal(await copiedAddress.innerText(), "Copied");
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "https://fake.example.test/merchant/events");
  const copyWebhook = page.locator('[data-conn="fake-whop"] [data-act="copy"]').filter({ hasText: "Copy address" });
  await copyWebhook.click();
  const copiedWebhook = page.locator('[data-conn="fake-whop"] [data-copy="https://fake.example.test/hook"]');
  await copiedWebhook.filter({ hasText: "Copied" }).waitFor();
  assert.equal(await copiedWebhook.innerText(), "Copied");
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "https://fake.example.test/hook");
  exercised.add("fa664be83b590e87902b");
  exercised.add("d79d5d37332e42763743");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator('[data-conn="fake-api"]').waitFor();
  assert.equal(await page.getByText("fake-once-only-key", { exact: true }).count(), 0);

  // Replace the rendered page with a controlled state to exercise actions against a known connection.
  data = { ...data, connections: [...data.connections, { id: "fake-pull", provider: "whop", provider_label: "Whop", entity_name: "Fundhub LLC", status: "active", mode: "pull", has_api_key: true, api_key_hint: "old1", has_secret: false, event_count: 1 }] };
  await page.reload({ waitUntil: "domcontentloaded" });
  const pull = page.locator('[data-conn="fake-pull"]');
  await pull.locator('[data-apikey="fake-pull"]').fill("safe-fake-api-key");
  await pull.getByRole("button", { name: "Save key" }).click();
  await page.getByText("Synced. 2 new items.", { exact: true }).waitFor();
  assert.deepEqual(posts.at(-1), { action: "api_key", connection_id: "fake-pull", api_key: "safe-fake-api-key" });
  assert.equal(await pull.locator('[data-apikey="fake-pull"]').inputValue(), "");
  exercised.add("675db71c7a998943ff8b");

  await pull.getByRole("button", { name: "Sync now" }).click();
  await page.getByText("Synced. 3 new items.", { exact: true }).waitFor();
  assert.deepEqual(posts.at(-1), { action: "sync", connection_id: "fake-pull" });
  exercised.add("563bb412a2e63ec80aee");

  page.once("dialog", (dialog) => dialog.accept());
  await pull.getByRole("button", { name: "Turn off" }).click();
  await page.locator('[data-conn="fake-pull"]').waitFor({ state: "detached" });
  assert.deepEqual(posts.at(-1), { action: "disable", connection_id: "fake-pull" });
  exercised.add("6e4c7ebf97ae151bb41c");

  await context.close();
  assert.deepEqual([...exercised], [
    "c546a8636bd471dd6858", "3bf7b97f2f42c2bfd144", "fa664be83b590e87902b", "d79d5d37332e42763743",
    "675db71c7a998943ff8b", "563bb412a2e63ec80aee", "6e4c7ebf97ae151bb41c",
  ]);
});

test("rendered Connections saves a webhook secret and retries a failed read", async (t) => {
  const { server, origin } = await startServer();
  const browser = await chromium.launch({ headless: true });
  t.after(async () => { await browser.close(); await new Promise((resolve) => server.close(resolve)); });
  let data = structuredClone(CONNECTION_FIXTURE);
  let reads = 0;
  const posts = [];
  const { context, page, url } = await newPage(browser, origin);
  await page.route("**/api/**", async (route) => {
    if (route.request().method() === "GET") {
      reads++;
      if (reads === 1) return json(route, { ok: false, error: "offline" }, 503);
      return json(route, data);
    }
    const body = route.request().postDataJSON();
    posts.push(body);
    const connection = data.connections.find((item) => item.id === body.connection_id);
    connection.has_secret = true;
    connection.status = "active";
    return json(route, { ok: true, connection });
  });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "We could not load your connections" }).waitFor();
  await page.getByRole("button", { name: "Try again" }).click();
  await page.getByText("Waiting for secret", { exact: true }).first().waitFor();
  assert.equal(reads, 2);

  const whopId = CONNECTION_FIXTURE.connections.find((item) => item.provider === "whop").id;
  const whop = page.locator(`[data-conn="${whopId}"]`);
  await whop.locator(`[data-secret="${whopId}"]`).fill("fake-signing-secret");
  await whop.getByRole("button", { name: "Save secret" }).click();
  await page.locator('[data-provider="whop"] .prov-head .state').filter({ hasText: "Connected" }).waitFor();
  assert.deepEqual(posts, [{ action: "secret", connection_id: whopId, secret: "fake-signing-secret" }]);
  assert.equal(await whop.locator(`[data-secret="${whopId}"]`).inputValue(), "");
  assert.equal(await whop.locator(".state").innerText(), "Connected");
  await context.close();
});

test("rendered Plan moves months and sends an accepted Mark missed request", async (t) => {
  const { server, origin } = await startServer();
  const browser = await chromium.launch({ headless: true });
  t.after(async () => { await browser.close(); await new Promise((resolve) => server.close(resolve)); });
  const requests = [];
  const posts = [];
  let data = structuredClone(PLAN_FIXTURE);
  const { context, page, url } = await newPage(browser, origin, `/app/money-plan.html?client_id=${CLIENT_ID}`);
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "GET") {
      requests.push(url.pathname + url.search);
      const month = url.searchParams.get("month");
      return json(route, { ...data, month: month || data.month });
    }
    const body = request.postDataJSON();
    posts.push(body);
    const pin = data.pins.find((item) => item.id === body.pin_id);
    const changed = { ...pin, status: body.status, can_mark: [] };
    data = { ...data, pins: data.pins.map((item) => item.id === pin.id ? changed : item) };
    return json(route, { ok: true, changed: true, pin: changed });
  });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "October 2026", exact: true }).waitFor();
  await page.getByRole("button", { name: "Previous month, September 2026" }).click();
  await page.getByRole("heading", { name: "September 2026", exact: true }).waitFor();
  assert.equal(requests.at(-1), `/api/money/plan?month=2026-09&client_id=${CLIENT_ID}`);
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await page.getByRole("heading", { name: "October 2026", exact: true }).waitFor();
  assert.equal(requests.at(-1), `/api/money/plan?month=2026-10&client_id=${CLIENT_ID}`);
  await page.getByRole("button", { name: "Next month, November 2026" }).click();
  await page.getByRole("heading", { name: "November 2026", exact: true }).waitFor();
  assert.equal(requests.at(-1), `/api/money/plan?month=2026-11&client_id=${CLIENT_ID}`);

  // Exercise the detail action on a fake staff pin with explicit mark rights.
  const step = {
    id: "fake-waypoint", date: "2026-10-30", kind: "checkpoint", title: "Call the bank", detail: "Ask about the next step.",
    amount_cents: null, bank: null, container_id: null, status: "planned", source: "waypoints", can_mark: ["missed"],
  };
  data = { ...PLAN_FIXTURE, viewer: "staff", pins: [step] };
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /Call the bank/ }).first().click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("dialog").getByRole("button", { name: "Mark missed" }).click();
  assert.deepEqual(posts.at(-1), {
    action: "mark", source: "waypoints", pin_id: "fake-waypoint", status: "missed", client_id: CLIENT_ID,
  });
  await page.getByText("Marked missed.", { exact: true }).waitFor();
  assert.match(await page.locator(".pl-drawer").innerText(), /Missed/);
  await context.close();
});

test("rendered Plan retries partial and full read failures, and its drawer controls work", async (t) => {
  const { server, origin } = await startServer();
  const browser = await chromium.launch({ headless: true });
  t.after(async () => { await browser.close(); await new Promise((resolve) => server.close(resolve)); });
  let reads = 0;
  let data = structuredClone(PLAN_FIXTURE);
  const { context, page, url } = await newPage(browser, origin);
  await page.route("**/api/**", async (route) => {
    if (route.request().method() !== "GET") return json(route, { ok: true });
    reads++;
    if (reads === 1) return json(route, { ok: false, error: "offline" }, 503);
    if (reads === 3) {
      const partial = structuredClone(data);
      partial.sources[0] = { name: "waypoints", ok: false, error: "load_failed" };
      return json(route, partial);
    }
    return json(route, data);
  });
  await page.goto(url.replace("money-connections.html", "money-plan.html"), { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "We could not load your plan" }).waitFor();
  await page.getByRole("button", { name: "Try again" }).click();
  await page.getByRole("heading", { name: "October 2026", exact: true }).waitFor();
  await page.getByRole("button", { name: "Previous month, September 2026" }).click();
  await page.getByText("Part of your plan did not load:", { exact: false }).waitFor();
  await page.getByRole("button", { name: "Try again" }).click();
  await page.getByText("Part of your plan did not load:", { exact: false }).waitFor({ state: "detached" });

  const pin = page.locator('[data-pin="due:6af70e59-db5c-4220-95b7-69f6a4a87ff8:2026-10-01"]').first();
  await pin.click();
  await page.locator('.pl-scrim[data-act="close"]').click({ position: { x: 2, y: 2 } });
  await page.locator(".pl-drawer").waitFor({ state: "detached" });
  assert.equal(await pin.evaluate((node) => node === document.activeElement), true);

  const crowded = structuredClone(PLAN_FIXTURE);
  const sameDay = crowded.pins[0];
  crowded.pins = Array.from({ length: 5 }, (_, index) => ({
    ...sameDay, id: `fake-pin-${index}`, title: `Fake pin ${index + 1}`, date: sameDay.date, source: "clarity",
  }));
  data = crowded;
  await page.reload({ waitUntil: "domcontentloaded" });
  const more = page.locator('.more[data-day="2026-10-01"]');
  await more.click();
  assert.equal(await page.locator('[data-day-row="2026-10-01"] .day-h').evaluate((node) => node === document.activeElement), true);

  const opener = page.locator('[data-pin="fake-pin-0"]').first();
  await opener.click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("link", { name: "See it on Payments" }).focus();
  await dialog.getByRole("link", { name: "See it on Payments" }).press("Tab");
  assert.equal(await dialog.getByRole("button", { name: "Close" }).evaluate((node) => node === document.activeElement), true);
  await page.keyboard.press("Escape");
  await page.locator(".pl-drawer").waitFor({ state: "detached" });
  assert.equal(await opener.evaluate((node) => node === document.activeElement), true);
  await opener.click();
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
  await page.locator(".pl-drawer").waitFor({ state: "detached" });
  await context.close();
});
