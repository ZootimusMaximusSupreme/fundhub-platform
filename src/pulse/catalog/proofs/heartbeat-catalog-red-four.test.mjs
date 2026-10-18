import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

import optimizeHandler, { BOOK_URL, optimizePageConfig } from "../../../../api/public/optimize.mjs";
import entitlementsHandler from "../../../../api/read/entitlements.mjs";
import trainingProgressHandler from "../../../../api/training-progress.mjs";
import { createCheckoutSession } from "../../../payments/commas-api.mjs";
import { closerMyNumbers } from "../../../sales/metrics.mjs";
import {
  ORG_ID,
  STAFF_ID,
  accountSession,
  fakeDb,
  makeRes,
  req,
  useSharedDb,
} from "../../../testing/handler-harness.mjs";
import { resolvePrincipal } from "../../../http/middleware/requirePrincipal.mjs";
import { compileCatalog } from "../compiler.mjs";
import * as displayRecipes from "../display-recipes.mjs";
import * as flowRecipes from "../flow-recipes.mjs";
import {
  HEARTBEAT_CATALOG_RED_FOUR_DISPLAY_PROOFS,
  HEARTBEAT_CATALOG_RED_FOUR_FLOW,
  HEARTBEAT_CATALOG_RED_FOUR_TEST_FILE,
} from "./heartbeat-catalog-red-four.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const PUBLIC = path.join(ROOT, "public");
const MAP_DIR = path.join(ROOT, "ops/workflows/coverage-every-surface-2026-10-10");
const CLIENT_ID = "11111111-2222-4333-8444-555555555555";
const OTHER_CLIENT_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const TASK_ID = "22222222-3333-4444-8555-666666666666";
const QUIET_CLIENT_ID = "33333333-4444-4555-8666-777777777777";
const PARTNER_ID = "44444444-5555-4666-8777-888888888888";
const MIME = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
]);

function mappedRow(definition) {
  const rows = JSON.parse(fs.readFileSync(path.join(MAP_DIR, definition.sourceFile), "utf8"));
  const matches = rows.filter((row) => (
    row.surface === definition.surface && row.control === definition.control
  ));
  assert.equal(matches.length, 1, `${definition.id}: exact mapped row`);
  return matches[0];
}

function resolveEvidence(reference) {
  if (!String(reference).includes("/")) return [];
  return fs.existsSync(path.join(ROOT, reference)) ? [reference] : [];
}

function staticFile(pathname) {
  const clean = decodeURIComponent(pathname).replace(/^\/+/, "");
  const candidates = !clean
    ? [path.join(PUBLIC, "index.html")]
    : clean.endsWith("/")
      ? [path.join(PUBLIC, clean, "index.html")]
      : [path.join(PUBLIC, clean), path.join(PUBLIC, clean, "index.html")];
  return candidates.find((candidate) => candidate.startsWith(PUBLIC) && fs.existsSync(candidate));
}

async function startServer() {
  const server = http.createServer((request, response) => {
    const file = staticFile(new URL(request.url, "http://127.0.0.1").pathname);
    if (!file) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("not found");
      return;
    }
    response.writeHead(200, { "content-type": MIME.get(path.extname(file)) || "application/octet-stream" });
    fs.createReadStream(file).pipe(response);
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

function normalize(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

test("the fresh compiler moves exactly the four assigned rows from L2 red to L3 wired", () => {
  const definitions = [...HEARTBEAT_CATALOG_RED_FOUR_DISPLAY_PROOFS, HEARTBEAT_CATALOG_RED_FOUR_FLOW];
  const saved = JSON.parse(fs.readFileSync(path.join(ROOT, "src/pulse/catalog/generated.json"), "utf8"));
  const before = definitions.map((definition) => saved.items.find((item) => item.id === definition.id));
  assert.equal(before.filter((item) => item?.state === "red" && item?.proofDepth === "e2e").length, 4);

  const sources = [...new Set(definitions.map((definition) => definition.sourceFile))].map((sourceFile) => ({
    sourceFile,
    rows: definitions.filter((definition) => definition.sourceFile === sourceFile).map(mappedRow),
  }));
  const compiled = compileCatalog(sources, [displayRecipes, flowRecipes], { resolve: resolveEvidence });

  assert.deepEqual(compiled.counts, { wired: 4, red: 0 });
  assert.deepEqual(compiled.items.map((item) => item.id).sort(), definitions.map((item) => item.id).sort());
  for (const item of compiled.items) {
    assert.equal(item.state, "wired", item.id);
    assert.equal(item.proofDepth, "deep", item.id);
    assert.equal(item.proofVerdict, undefined, item.id);
    assert.equal(item.proof.tests.includes(HEARTBEAT_CATALOG_RED_FOUR_TEST_FILE), true, item.id);
    assert.match(item.reason, /Mapped to .* executable proof target/);
  }
});

test("the four L3 contracts exercise the promised final result", { timeout: 120_000 }, async (t) => {
  const { server, origin } = await startServer();
  const browser = await chromium.launch({ headless: true });
  t.after(async () => {
    await browser.close();
    await closeServer(server);
  });

  await t.test("My Numbers derives both owed records and opens their exact closer records", async () => {
    const calls = [];
    const database = {
      async query(sql, params = []) {
        calls.push({ sql, params });
        if (/EXTRACT\(DAY FROM/.test(sql)) {
          assert.match(sql, /AND o\.staff_id = \$2/);
          assert.deepEqual(params, [ORG_ID, STAFF_ID]);
          return { rows: [{
            client_id: QUIET_CLIENT_ID,
            name: "Quinn Quiet",
            staff_id: STAFF_ID,
            closer_name: "Casey Closer",
            quiet_days: 9,
          }] };
        }
        if (/FROM tasks t/.test(sql)) {
          assert.match(sql, /t\.assignee_staff_id = \$2/);
          return { rows: [{
            task_id: TASK_ID,
            client_id: CLIENT_ID,
            client_name: "Una Logged",
            due_at: "2026-10-17T12:00:00.000Z",
          }] };
        }
        if (/SELECT demo_mode_enabled FROM orgs/.test(sql)) return { rows: [{ demo_mode_enabled: false }] };
        if (/FROM products p/.test(sql)) return { rows: [] };
        if (/FROM commission_ledger/.test(sql)) return { rows: [{}] };
        if (/SELECT COALESCE\(SUM\(cash_collected_cents\)/.test(sql)) return { rows: [{}] };
        if (/SELECT count\(\*\)::int AS deposits/.test(sql)) return { rows: [{}] };
        return { rows: [] };
      },
    };
    const result = await closerMyNumbers(database, {
      orgId: ORG_ID,
      staffId: STAFF_ID,
      now: new Date("2026-10-18T12:00:00.000Z"),
    });
    assert.deepEqual(result.owed.map((row) => ({
      client_id: row.client_id,
      task_id: row.task_id,
      title: row.title,
    })), [
      { client_id: CLIENT_ID, task_id: TASK_ID, title: "Log the call with Una Logged" },
      { client_id: QUIET_CLIENT_ID, task_id: undefined, title: "Follow up with Quinn Quiet" },
    ]);
    assert.equal(calls.filter((call) => /EXTRACT\(DAY FROM/.test(call.sql)).length, 1);

    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await page.addInitScript(() => {
      localStorage.setItem("fh_token", "proof-staff-token");
      localStorage.setItem("fh_role", "closer");
    });
    await page.route("https://**", (route) => route.abort("blockedbyclient"));
    await page.route("**/api/**", async (route) => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === "/api/read/my-numbers") return fulfillJson(route, { ok: true, ...result });
      if (pathname === "/api/auth/session" || pathname === "/api/session") {
        return fulfillJson(route, { ok: true, staff: { id: STAFF_ID, org_id: ORG_ID, role: "closer", name: "Casey Closer", status: "active" } });
      }
      return fulfillJson(route, { ok: true, items: [] });
    });
    await page.goto(`${origin}/app/my-numbers.html`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.querySelectorAll("a.todo").length === 2);
    const links = await page.locator("a.todo").evaluateAll((nodes) => nodes.map((node) => ({
      href: node.getAttribute("href"),
      text: node.textContent,
    })));
    assert.deepEqual(links.map((link) => link.href), [
      `closer-dashboard.html?client_id=${CLIENT_ID}&task_id=${TASK_ID}`,
      `closer-dashboard.html?client_id=${QUIET_CLIENT_ID}`,
    ]);
    assert.match(normalize(links[0].text), /Log the call with Una Logged/);
    assert.match(normalize(links[1].text), /9d quiet.*Follow up with Quinn Quiet.*Deposit paid, not funded/);
    await page.route("**/app/closer-dashboard.html**", (route) => route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><main>Closer record</main>",
    }), { times: 1 });
    await Promise.all([
      page.waitForURL((url) => url.pathname === "/app/closer-dashboard.html"),
      page.locator("a.todo").nth(1).click(),
    ]);
    const opened = new URL(page.url());
    assert.equal(opened.searchParams.get("client_id"), QUIET_CLIENT_ID);
    assert.equal(opened.searchParams.has("task_id"), false);
    await context.close();
  });

  await t.test("a real partner session is refused by the write door and the rendered page has no write path", async () => {
    const database = fakeDb(accountSession({ kind: "partner", partnerId: PARTNER_ID }));
    const partnerRequest = req("POST", {
      body: { partner_id: PARTNER_ID, action: "module", module: "m1", status: "complete" },
    });
    const principal = await resolvePrincipal(partnerRequest, { db: database });
    assert.equal(principal.kind, "partner");
    assert.equal(principal.partnerId, PARTNER_ID);

    const response = makeRes();
    await trainingProgressHandler(partnerRequest, response, { db: database });
    assert.equal(response.statusCode, 401);
    assert.equal(response.body.error, "unauthorized");
    const unexpectedWrites = database.calls
      .map((call) => call.sql.replace(/\s+/g, " ").trim())
      .filter((sql) => /\b(?:INSERT INTO|DELETE FROM|UPDATE)\b/i.test(sql))
      .filter((sql) => !/\bUPDATE (?:account_)?sessions\b/i.test(sql));
    assert.deepEqual(unexpectedWrites, []);
    assert.equal(database.calls.some((call) => /training_progress|training_gate_decisions/i.test(call.sql)), false);

    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    const apiWrites = [];
    await page.addInitScript(() => {
      localStorage.setItem("fh_token", "proof-partner-token");
      localStorage.setItem("fh_role", "partner");
    });
    await page.route("https://**", (route) => route.abort("blockedbyclient"));
    await page.route("**/api/**", async (route) => {
      if (route.request().method() !== "GET") apiWrites.push(route.request().url());
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === "/api/read/partner-training") {
        const modules = Array.from({ length: 13 }, (_, index) => ({
          code: `m${index + 1}`,
          position: index + 1,
          title: `Module ${index + 1}`,
          week_no: index + 1,
          gate_code: index < 4 ? `G${index + 1}` : null,
          certified: false,
          status: index === 0 ? "complete" : null,
        }));
        return fulfillJson(route, {
          ok: true,
          modules,
          gates: [],
          modules_total: 13,
          modules_complete: 1,
          next_module: modules[1],
          next_gate: null,
          gates_outstanding: ["G1", "G2", "G3", "G4"],
          may_sell_supervised: false,
          may_sell_unsupervised: false,
          curriculum_seeded: true,
        });
      }
      if (pathname === "/api/auth/session" || pathname === "/api/session") {
        return fulfillJson(route, {
          ok: true,
          staff: { id: "partner-proof", org_id: ORG_ID, role: "partner", name: "Proof Partner", status: "active" },
        });
      }
      return fulfillJson(route, { ok: true, items: [] });
    });
    await page.goto(`${origin}/app/partner-training.html`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.querySelectorAll("#trModules .mrow").length === 13);
    assert.equal(await page.locator("#trBody button, #trBody input, #trBody select, #trBody textarea").count(), 0);
    assert.equal(await page.locator('script[src*="training-progress"]').count(), 0);
    assert.deepEqual(apiWrites, []);
    await context.close();
  });

  await t.test("the minted checkout return opens only the new active entitlement on the scoped account", async () => {
    let checkoutBody = null;
    const checkout = await createCheckoutSession({
      amountCents: 3200,
      productTitle: "Consulting Services Assessment",
      metadata: { link_ref: "pay_ref_deep_proof", client_id: CLIENT_ID, org_id: ORG_ID },
      successUrl: `${origin}/app/payment-success.html`,
      env: { FANBASIS_CHECKOUT_API_KEY: "not-a-live-key", FANBASIS_CHECKOUT_API_BASE: "https://blocked.example.test" },
      fetchImpl: async (_url, options) => {
        checkoutBody = JSON.parse(options.body);
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ data: { payment_link: "https://blocked.example.test/pay", id: "session-proof" } }),
        };
      },
    });
    assert.equal(checkout.ok, true);
    const successUrl = new URL(checkoutBody.success_url);
    assert.equal(successUrl.origin, origin);
    assert.equal(successUrl.pathname, "/app/payment-success.html");
    assert.deepEqual([...successUrl.searchParams.keys()].sort(), ["client_id", "ref"]);
    assert.equal(successUrl.searchParams.get("ref"), "pay_ref_deep_proof");
    assert.equal(successUrl.searchParams.get("client_id"), CLIENT_ID);

    const held = { client_id: CLIENT_ID, entitlement_code: "held", entitlement_name: "Existing Access", active: true };
    const fresh = { client_id: CLIENT_ID, entitlement_code: "fresh", entitlement_name: "Fresh Funding Room", active: true };
    const inactive = { client_id: CLIENT_ID, entitlement_code: "inactive", entitlement_name: "Inactive Offer", active: false };
    const foreign = { client_id: OTHER_CLIENT_ID, entitlement_code: "foreign", entitlement_name: "Other Account", active: true };
    let reads = 0;
    const database = fakeDb([
      ...accountSession({ kind: "client", clientId: CLIENT_ID }),
      [/FROM v_client_entitlements/, (_sql, params) => {
        reads += 1;
        assert.equal(params[2], CLIENT_ID, "session client id owns the SQL scope");
        assert.equal(params[3], true, "client principal stays client-scoped");
        assert.equal(params[4], null);
        return reads === 1 ? [held] : [held, fresh, inactive, foreign];
      }],
    ]);
    const restore = useSharedDb(database);
    const context = await browser.newContext({ viewport: { width: 430, height: 860 } });
    const page = await context.newPage();
    try {
      await page.addInitScript(() => {
        localStorage.setItem("fh_token", "proof-client-token");
        const realSetTimeout = window.setTimeout.bind(window);
        window.setTimeout = (fn, delay, ...args) => realSetTimeout(fn, Math.min(Number(delay) || 0, 5), ...args);
      });
      await page.route("https://**", (route) => route.abort("blockedbyclient"));
      await page.route("**/api/read/entitlements**", async (route) => {
        const url = new URL(route.request().url());
        const response = makeRes();
        await entitlementsHandler(req("GET", {
          query: Object.fromEntries(url.searchParams),
          headers: { authorization: route.request().headers().authorization },
        }), response);
        await fulfillJson(route, response.body, response.statusCode);
      });
      await page.goto(successUrl.href, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => document.querySelector("#state")?.textContent.includes("Just opened on your account"));
      const state = normalize(await page.locator("#state").textContent());
      assert.match(state, /Just opened on your account.*Fresh Funding Room/);
      assert.equal(state.includes("Existing Access"), false);
      assert.equal(state.includes("Inactive Offer"), false);
      assert.equal(state.includes("Other Account"), false);
      assert.equal(normalize(await page.locator("#refline").textContent()), "Payment reference: pay_ref_deep_proof");
      assert.ok(reads >= 2);
      assert.equal(database.calls.some((call) => /INSERT INTO|DELETE FROM/i.test(call.sql)), false);
    } finally {
      restore();
      await context.close();
    }
  });

  await t.test("Book a call sends the exact GET with every form field blank and never loads the external page", async () => {
    const context = await browser.newContext({ viewport: { width: 430, height: 860 } });
    const page = await context.newPage();
    let blockedBookRequests = 0;
    let resolveBlockedBook;
    const blockedBook = new Promise((resolve) => { resolveBlockedBook = resolve; });
    await page.route("https://**/*", (route) => route.abort("blockedbyclient"));
    await page.route("**/api/public/optimize", async (route) => {
      const response = makeRes();
      await optimizeHandler({ method: "GET", query: {}, url: route.request().url() }, response);
      assert.deepEqual(response.body, optimizePageConfig(process.env));
      await fulfillJson(route, response.body, response.statusCode);
    });
    await page.route("**/api/**", (route) => fulfillJson(route, { ok: true }));
    await page.goto(`${origin}/optimize.html`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction((bookUrl) => document.querySelector("#book")?.href === bookUrl, BOOK_URL);
    await page.route(BOOK_URL, async (route) => {
      blockedBookRequests += 1;
      resolveBlockedBook();
      await route.abort("blockedbyclient");
    }, { times: 1 });
    assert.deepEqual(await page.locator("#first, #last, #email, #phone").evaluateAll((nodes) => nodes.map((node) => node.value)), ["", "", "", ""]);
    const requestPromise = page.waitForRequest((request) => request.url() === BOOK_URL && request.method() === "GET");
    await page.locator("#book").click({ noWaitAfter: true });
    const request = await requestPromise;
    await blockedBook;
    assert.equal(request.url(), BOOK_URL);
    assert.equal(request.method(), "GET");
    assert.equal(blockedBookRequests, 1);
    assert.equal(new URL(page.url()).origin, origin, "the blocked external page was never opened");
    await context.close();
  });
});
