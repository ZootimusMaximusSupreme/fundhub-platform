import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

import {
  DISPLAY_CONTRACTS_CD_METADATA,
  DISPLAY_CONTRACTS_CD_PROOF_KEYS,
  DISPLAY_CONTRACTS_CD_PROOFS,
} from "./display-contracts-cd.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const PUBLIC = path.join(ROOT, "public");
const GENERATED = JSON.parse(fs.readFileSync(path.join(ROOT, "src/pulse/catalog/generated.json"), "utf8"));
const STRATEGY_FIXTURE = JSON.parse(fs.readFileSync(
  path.join(ROOT, "src/http/fixtures/money-strategy.sample.json"),
  "utf8",
));
const CONTENT_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
]);

const IDS = Object.freeze({
  indexHomes: "3c8a3638ccb9fed1e730",
  signOut: "9581343e55d47fd676e6",
  chipToggle: "4e4a254a9ab1fc28b599",
  brand: "a0c63ee4bf98e4fb8d05",
  shell: "13b45cf2a27cc1c063bd",
  nav: "5d4a9bf5968279f9f2b9",
  back: "15a968e951b4709d966a",
  sandbox: "869f8a7966cfafbdc5d2",
  read: "bc5533e1b9b49389a6c3",
  amount: "bf16ef3e7ca991a2c3c9",
  method: "7b6e890740abd1287782",
  goal: "41dbaa240149eb3e2485",
  useAmount: "35a34f62c9a8edc57c67",
  save: "6a59c13d490c9b662788",
  tiles: "733b98d26085426a411b",
  debts: "87aa73d872e6976dfdd9",
  chart: "10ad36c6cab098cd6e7a",
  months: "3ee6d8a7f002f963042f",
  explainers: "0bb3c43986f79ff3c43c",
  empty: "981cd985eef64fd7777c",
  minimums: "fc73468e11daaf980755",
  states: "e3bd83041fbea9dd5554",
});

const SIGNED_OUT_READS = Object.freeze({
  "public/app/money-connections.html": ["/api/money/connections"],
  "public/app/money-credit.html": ["/api/money/credit"],
  "public/app/money-declines.html": ["/api/blueprint/declines"],
  "public/app/money-fundability.html": ["/api/money/fundability"],
  "public/app/money-helper.html": ["/api/money/helper"],
  "public/app/money-next.html": ["/api/money/tasks", "/api/money/ready-to-fund"],
  "public/app/money-payments.html": ["/api/money/payments"],
  "public/app/money-plan.html": ["/api/money/plan"],
  "public/app/money-setup.html": ["/api/money/setup"],
  "public/app/money-strategy.html": ["/api/money/strategy"],
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function staticFile(pathname) {
  const clean = decodeURIComponent(pathname).replace(/^\/+/, "");
  const candidates = clean.endsWith("/")
    ? [path.join(PUBLIC, clean, "index.html")]
    : [path.join(PUBLIC, clean), path.join(PUBLIC, clean, "index.html")];
  return candidates.find((candidate) => candidate.startsWith(PUBLIC) && fs.existsSync(candidate));
}

async function startServer() {
  const server = http.createServer((req, res) => {
    const file = staticFile(new URL(req.url, "http://127.0.0.1").pathname);
    if (!file) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("not found");
      return;
    }
    res.writeHead(200, {
      "content-type": CONTENT_TYPES.get(path.extname(file)) || "application/octet-stream",
    });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

async function stopServer(server) {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function json(route, body, status = 200) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function browserContext(browser, api, { role = "client", token = "display-cd-token" } = {}) {
  const context = await browser.newContext({
    reducedMotion: "reduce",
    viewport: { width: 1440, height: 1000 },
  });
  await context.addInitScript(({ initialRole, initialToken }) => {
    localStorage.clear();
    if (initialRole) localStorage.setItem("fh_role", initialRole);
    if (initialToken) localStorage.setItem("fh_token", initialToken);
  }, { initialRole: role, initialToken: token });
  await context.route(/^https:\/\/fonts\.(?:googleapis|gstatic)\.com\//, (route) => route.abort());
  await context.route("**/api/**", api);
  return context;
}

async function strategyPage(browser, origin, {
  fixture = STRATEGY_FIXTURE,
  onGet,
  onPost,
  query = "",
  role = "client",
} = {}) {
  const calls = { get: [], post: [] };
  const context = await browserContext(browser, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname !== "/api/money/strategy") return json(route, { ok: true, items: [] });
    if (request.method() === "GET") {
      calls.get.push(url.pathname + url.search);
      if (onGet) return onGet(route, calls.get.length);
      return json(route, clone(fixture));
    }
    const body = request.postDataJSON();
    calls.post.push(body);
    if (onPost) return onPost(route, body, calls.post.length);
    return json(route, { ok: true, saved: { ...body, saved_at: "2026-10-12T12:00:00Z", steps: 39 } });
  }, { role });
  const page = await context.newPage();
  const requests = [];
  page.on("request", (request) => requests.push(new URL(request.url()).pathname));
  await page.goto(`${origin}/app/money-strategy.html${query}`, { waitUntil: "domcontentloaded" });
  return { context, page, calls, requests };
}

function centsText(cents) {
  return (cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

test("Display CD exports exact catalog row keys and import-ready proof metadata", () => {
  assert.equal(DISPLAY_CONTRACTS_CD_PROOFS.length, 32);
  assert.equal(DISPLAY_CONTRACTS_CD_PROOF_KEYS.length, DISPLAY_CONTRACTS_CD_PROOFS.length);
  assert.equal(new Set(DISPLAY_CONTRACTS_CD_PROOF_KEYS).size, DISPLAY_CONTRACTS_CD_PROOF_KEYS.length);
  assert.equal(DISPLAY_CONTRACTS_CD_METADATA.provedCount, DISPLAY_CONTRACTS_CD_PROOFS.length);
  assert.equal(DISPLAY_CONTRACTS_CD_METADATA.baselineRedCount, 414);
  assert.equal(DISPLAY_CONTRACTS_CD_METADATA.honestLeftoverCount, 382);

  const allowedSources = new Set(["desks-c.json", "desks-d.json"]);
  for (const proof of DISPLAY_CONTRACTS_CD_PROOFS) {
    assert.equal(allowedSources.has(proof.sourceFile), true, `${proof.rowId}: wrong shard source`);
    assert.equal(proof.key, `${proof.sourceFile}\0${proof.surface}\0${proof.control}`);
    assert.equal(proof.tests.length, 1);
    assert.equal(proof.tests[0], DISPLAY_CONTRACTS_CD_METADATA.test);
    assert.equal(proof.evidence, DISPLAY_CONTRACTS_CD_METADATA.test);
    assert.equal(proof.proof.runner, "local Chromium with controlled fake API routes");
    assert.ok(proof.proof.assertion.length > 30, `${proof.rowId}: missing proof metadata`);

    const matches = GENERATED.items.filter((row) => row.id === proof.rowId);
    assert.equal(matches.length, 1, `${proof.rowId}: catalog row is not unique`);
    const row = matches[0];
    assert.equal(row.sourceFile, proof.sourceFile, `${proof.rowId}: source changed`);
    assert.equal(row.surface, proof.surface, `${proof.rowId}: surface changed`);
    assert.equal(row.proofAsserts, proof.control, `${proof.rowId}: control changed`);
  }
});

test("every exported Display CD key drives the real page and asserts its exact result", async (t) => {
  const { server, origin } = await startServer();
  const browser = await chromium.launch({ headless: true });
  const exercised = new Set();
  const prove = (rowId) => {
    assert.equal(exercised.has(rowId), false, `${rowId}: direct proof recorded twice`);
    exercised.add(rowId);
  };
  t.after(async () => {
    await browser.close();
    await stopServer(server);
  });

  const homes = new Map([
    ["owner", "/app/pipeline.html"],
    ["admin", "/app/pipeline.html"],
    ["funding_advisor", "/app/client-control-panel.html"],
    ["closer", "/app/closer-dashboard.html"],
    ["inquiry_specialist", "/app/inquiry-remover.html"],
    ["setter", "/app/pipeline.html"],
    ["sales_manager", "/app/sales-floor.html"],
    ["csm", "/app/csm-queue.html"],
    ["client", "/app/client-portal.html"],
    ["affiliate", "/app/affiliate.html"],
    ["partner", "/app/partner-galaxy.html"],
  ]);
  let currentRole = "owner";
  const indexContext = await browserContext(browser, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/auth/session") {
      return json(route, {
        ok: true,
        staff: {
          id: `staff-${currentRole}`,
          name: `Role ${currentRole}`,
          email: `${currentRole}@example.test`,
          role: currentRole,
          org_id: "org-1",
          status: "active",
        },
      });
    }
    if (url.pathname === "/api/health") return json(route, { ok: true, db: "up", migrations: 333 });
    if (url.pathname === "/api/org-brand") return json(route, { ok: true, brand: null });
    return json(route, { ok: true, items: [], groups: [], pages: [] });
  }, { role: "", token: "index-role-token" });
  for (const [role, home] of homes) {
    currentRole = role;
    const page = await indexContext.newPage();
    await page.goto(`${origin}/app/index.html`, { waitUntil: "domcontentloaded" });
    await page.waitForURL(`${origin}${home}`);
    await page.locator("html.fh-page-access-confirmed").waitFor({ state: "attached" });
    assert.equal(new URL(page.url()).pathname, home, `${role}: wrong home`);
    await page.close();
  }
  await indexContext.close();
  prove(IDS.indexHomes);

  const brand = {
    ink: "#112233",
    paper: "#F4F1EA",
    ramp: ["#111111", "#222222", "#333333", "#444444", "#555555", "#667788"],
    display_face: "Inter",
    mono_face: "JetBrains Mono",
    wordmark_url: "data:image/svg+xml;base64,PHN2Zy8+",
    entity_name: "Mesa Capital LLC",
  };
  let logout = null;
  const shellContext = await browser.newContext({
    reducedMotion: "reduce",
    viewport: { width: 1440, height: 1000 },
    storageState: {
      cookies: [],
      origins: [{
        origin,
        localStorage: [
          { name: "fh_role", value: "owner" },
          { name: "fh_token", value: "shell-token" },
        ],
      }],
    },
  });
  await shellContext.route(/^https:\/\/fonts\.(?:googleapis|gstatic)\.com\//, (route) => route.abort());
  await shellContext.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/api/auth/session") {
      return json(route, {
        ok: true,
        staff: { id: "owner-1", name: "Owner One", email: "owner@example.test", role: "owner", org_id: "org-1", status: "active" },
      });
    }
    if (url.pathname === "/api/auth/logout") {
      logout = { method: request.method(), authorization: request.headers().authorization };
      return json(route, { ok: true });
    }
    if (url.pathname === "/api/health") return json(route, { ok: true, db: "up", migrations: 333 });
    if (url.pathname === "/api/org-brand") return json(route, { ok: true, brand });
    return json(route, { ok: true, items: [], groups: [], pages: [] });
  });
  const shellPage = await shellContext.newPage();
  await shellPage.goto(`${origin}/app/lenders.html`, { waitUntil: "domcontentloaded" });
  await shellPage.locator("#fh-shell-chip").waitFor({ state: "visible" });
  await shellPage.waitForFunction(() => document.documentElement.style.getPropertyValue("--ink") === "#112233");
  const painted = await shellPage.evaluate(() => {
    const style = document.documentElement.style;
    return {
      ink: style.getPropertyValue("--ink"),
      paper: style.getPropertyValue("--paper"),
      accent: style.getPropertyValue("--accent"),
      spectrum: style.getPropertyValue("--spectrum"),
      sans: style.getPropertyValue("--sans"),
      mono: style.getPropertyValue("--mono"),
      logo: style.getPropertyValue("--logo"),
      entity: document.getElementById("fh-shell-chip")?.getAttribute("data-brand"),
    };
  });
  assert.deepEqual(painted, {
    ink: "#112233",
    paper: "#F4F1EA",
    accent: "#667788",
    spectrum: "linear-gradient(90deg,#111111 0%,#222222 20%,#333333 40%,#444444 60%,#555555 80%,#667788 100%)",
    sans: "'Inter', system-ui, -apple-system, sans-serif",
    mono: "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace",
    logo: 'url("data:image/svg+xml;base64,PHN2Zy8+")',
    entity: "Mesa Capital LLC",
  });
  prove(IDS.brand);

  await shellPage.locator("#fh-shell-chip-hide").click();
  assert.equal(await shellPage.locator("#fh-shell-chip").getAttribute("aria-hidden"), "true");
  assert.equal(await shellPage.locator("#fh-shell-chip").evaluate((el) => el.style.display), "none");
  assert.equal(await shellPage.locator("#fh-shell-chip-show").evaluate((el) => el.style.display), "flex");
  assert.equal(await shellPage.evaluate(() => localStorage.getItem("fh_chip_hidden")), "1");
  await shellPage.locator("#fh-shell-chip-show").click();
  assert.equal(await shellPage.locator("#fh-shell-chip").getAttribute("aria-hidden"), "false");
  assert.equal(await shellPage.locator("#fh-shell-chip").evaluate((el) => el.style.display), "flex");
  assert.equal(await shellPage.locator("#fh-shell-chip-show").evaluate((el) => el.style.display), "none");
  assert.equal(await shellPage.evaluate(() => localStorage.getItem("fh_chip_hidden")), null);
  prove(IDS.chipToggle);

  await Promise.all([
    shellPage.waitForURL(`${origin}/login.html`),
    shellPage.locator("#fh-shell-out").click(),
  ]);
  assert.deepEqual(logout, { method: "POST", authorization: "Bearer shell-token" });
  assert.deepEqual(await shellPage.evaluate(() => ({
    token: localStorage.getItem("fh_token"),
    role: localStorage.getItem("fh_role"),
    client: localStorage.getItem("fh_client"),
    entity: localStorage.getItem("fh_entity"),
  })), { token: null, role: null, client: null, entity: null });
  await shellContext.close();
  prove(IDS.signOut);

  let savedBody = null;
  const main = await strategyPage(browser, origin, {
    fixture: STRATEGY_FIXTURE,
    onPost: async (route, body) => {
      savedBody = body;
      return json(route, {
        ok: true,
        saved: { ...body, saved_at: "2026-10-12T12:00:00Z", steps: 39 },
      });
    },
  });
  await main.page.locator("#s-amount").waitFor({ state: "visible" });

  const loadedShell = await main.page.evaluate(() => ({
    title: document.title,
    root: !!document.querySelector("#strategy-root .fh-strategy .controls"),
    script: typeof window.FHMoneyStrategy?.mount,
    css: [...document.styleSheets].some((sheet) => String(sheet.href || "").endsWith("/app/money-strategy.css")),
  }));
  assert.deepEqual(loadedShell, {
    title: "Fundhub — Payment strategy",
    root: true,
    script: "function",
    css: true,
  });
  prove(IDS.shell);

  const clientNav = await main.page.locator("#money-nav a").evaluateAll((links) => links.map((link) => ({
    text: link.textContent.trim(),
    href: link.getAttribute("href"),
    current: link.getAttribute("aria-current"),
  })));
  assert.deepEqual(clientNav, [
    { text: "Money", href: "/app/financeos.html#overview", current: null },
    { text: "Accounts", href: "/app/financeos.html#accounts", current: null },
    { text: "Credit", href: "/app/financeos.html#credit", current: null },
    { text: "Connections", href: "/app/financeos.html#connections", current: null },
    { text: "Payments", href: "/app/financeos.html#payments", current: null },
    { text: "Setup", href: "/app/financeos.html#setup", current: null },
    { text: "Strategy", href: "/app/money-strategy.html", current: "page" },
  ]);
  assert.deepEqual(await main.page.locator("#money-back").evaluate((link) => ({
    text: link.textContent.trim(),
    href: link.getAttribute("href"),
  })), { text: "Back to my portal", href: "client-portal.html" });

  assert.equal(await main.page.locator("#money-sandbox").isVisible(), true);
  assert.equal(
    (await main.page.locator("#money-sandbox").innerText()).replace(/\s+/g, " ").trim(),
    "Sample data These accounts come from a test bank (Plaid sandbox), not a real one.",
  );
  prove(IDS.sandbox);

  assert.deepEqual(main.calls.get, ["/api/money/strategy"]);
  assert.match(await main.page.locator(".fh-strategy .head").innerText(), /Test Test · Pick how much goes to debt each month/);
  assert.match(await main.page.locator(".debts-card").innerText(), /Business Amex/);
  prove(IDS.read);

  assert.equal(main.requests.includes("/app/money-strategy-math.js"), true);
  assert.equal(await main.page.evaluate(() => typeof window.FHStrategyMath?.buildPlan), "function");

  await main.page.locator("#s-amount").fill("1,500.00");
  await main.page.waitForFunction(() => document.querySelector(".tiles")?.textContent.includes("Jan 7, 2030"));
  assert.equal(await main.page.locator("#s-amount").inputValue(), "1,500.00");
  assert.equal(await main.page.locator("#s-range").inputValue(), "150000");
  assert.match(await main.page.locator(".tiles").innerText(), /Debt-free by[\s\S]*Jan 7, 2030/i);
  prove(IDS.amount);
  assert.match(await main.page.locator(".tiles").innerText(), /Jan 7, 2030/);

  const tiles = (await main.page.locator(".tiles").innerText()).replace(/\s+/g, " ");
  assert.match(tiles, /Debt-free by Jan 7, 2030 At the earliest/i);
  assert.match(tiles, /Interest saved vs\. minimums — No rate \(APR\) on file/i);
  assert.match(tiles, /Card use 20\.3% Now/i);
  assert.equal(
    (await main.page.locator('section[aria-labelledby="t-cash"]').innerText()).replace(/\s+/g, " ").trim(),
    "CASH THIS MONTH Safe Personal: $315.00 of the $1,530.55 its cash can cover. Business: $1,185.00 of the $18,450.00 its cash can cover.",
  );
  prove(IDS.tiles);

  const debtRows = await main.page.locator(".debts-card tbody tr").evaluateAll((rows) => rows.map((row) =>
    [...row.cells].map((cell) => cell.textContent.replace(/\s+/g, " ").trim()),
  ));
  assert.deepEqual(debtRows, [
    ["1", "Personal Visa Personal", "$1,320.40", "24.99%", "$40.00", "Mar 7, 2027", "$76.36"],
    ["2", "Business Amex Business", "$5,400.00", "18.24%", "$135.00", "Apr 7, 2028", "$910.09"],
    ["3", "Sample Chase Ink Business", "$2,000.00", "Not on file", "Not on file", "Aug 7, 2028 · at the earliest", "—"],
    ["4", "SBA Loan Business", "$48,000.00", "Not on file", "$1,050.00", "Jan 7, 2030 · at the earliest", "—"],
  ]);
  const debts = (await main.page.locator(".debts-card").innerText()).replace(/\s+/g, " ");
  assert.match(debts, /Missing No rate \(APR\) on file for Sample Chase Ink and SBA Loan/);
  prove(IDS.debts);

  const chart = main.page.locator('[data-slot="chart"]');
  assert.equal(await chart.locator("svg.chart").getAttribute("aria-label"), "Card use by month: 20.3% now, under 10% by Oct 7, 2027");
  const chartText = (await chart.innerText()).replace(/\s+/g, " ");
  assert.match(chartText, /30% · fundable line/);
  assert.match(chartText, /10% · target/);
  assert.match(chartText, /Business Amex/);
  assert.match(chartText, /Personal Visa/);
  prove(IDS.chart);

  const methods = main.page.locator("[data-method]");
  assert.deepEqual(await methods.allInnerTexts(), ["Highest rate first", "Card use first", "Smallest balance first"]);
  await main.page.locator('[data-method="utilization"]').click();
  await main.page.waitForFunction(() => document.querySelector(".debts-card tbody tr .debt-name")?.textContent === "Business Amex");
  assert.equal(await main.page.locator('[data-method="utilization"]').getAttribute("aria-pressed"), "true");
  await main.page.locator('[data-method="snowball"]').click();
  await main.page.waitForFunction(() => document.querySelector(".debts-card tbody tr .debt-name")?.textContent === "Personal Visa");
  assert.equal(await main.page.locator('[data-method="snowball"]').getAttribute("aria-pressed"), "true");
  await main.page.locator('[data-method="avalanche"]').click();
  await main.page.waitForFunction(() => document.querySelector(".debts-card tbody tr .debt-name")?.textContent === "Personal Visa");
  assert.equal(await main.page.locator('[data-method="avalanche"]').getAttribute("aria-pressed"), "true");
  prove(IDS.method);

  const monthDetails = main.page.locator('[data-slot="months-wrap"]');
  await monthDetails.locator("summary").click();
  assert.equal(await monthDetails.locator("tbody tr").count(), 24);
  assert.equal(await monthDetails.locator('[data-act="more-months"]').innerText(), "Show 15 more months");
  await monthDetails.locator('[data-act="more-months"]').click();
  await assert.doesNotReject(() => main.page.waitForFunction(() => document.querySelectorAll('[data-slot="months-wrap"] tbody tr').length === 39));
  assert.equal(await monthDetails.locator("tbody tr").count(), 39);
  assert.equal(await monthDetails.locator('[data-act="more-months"]').count(), 0);
  prove(IDS.months);

  assert.deepEqual(await main.page.locator("#s-goal option").evaluateAll((options) => options.map((option) => [option.value, option.textContent.trim()])), [
    ["", "No goal"],
    ["debt_free", "Debt-free by"],
    ["util30", "Card use under 30% by"],
    ["util10", "Card use under 10% by"],
  ]);
  await main.page.locator("#s-goal").selectOption("debt_free");
  await main.page.locator("#s-goal-by").fill("2028-12-31");
  await main.page.waitForFunction(() => document.querySelector('[data-slot="goal-note"]')?.textContent.includes("Dec 31, 2028"));
  assert.equal(await main.page.locator("#s-goal-by").isVisible(), true);
  assert.match(await main.page.locator('[data-slot="goal-note"]').innerText(), /To get there by Dec 31, 2028 you need \$[\d,]+\.00 a month \(highest rate first\)\./);
  prove(IDS.goal);

  const goalUse = main.page.locator('[data-slot="goal-note"] [data-act="use-amount"]');
  const goalCents = Number(await goalUse.getAttribute("data-cents"));
  assert.equal(Number.isSafeInteger(goalCents) && goalCents > 0, true);
  await goalUse.click();
  await main.page.waitForFunction((value) => document.querySelector("#s-amount")?.value === value, centsText(goalCents));
  assert.equal(await main.page.locator("#s-amount").inputValue(), centsText(goalCents));

  await main.page.locator('[data-act="save"]').click();
  await main.page.waitForFunction(() => document.querySelector('[data-slot="save-msg"]')?.textContent.includes("Saved."));
  assert.deepEqual(savedBody, {
    action: "save_plan",
    method: "avalanche",
    monthly_cents: goalCents,
    goal: { kind: "debt_free", by: "2028-12-31" },
  });
  assert.equal((await main.page.locator('[data-slot="save-msg"]').innerText()).replace(/\s+/g, " ").trim(), "Saved. Its 39 steps are on your FinanceOS timeline.");
  prove(IDS.save);
  await main.context.close();

  const staff = await strategyPage(browser, origin, {
    fixture: STRATEGY_FIXTURE,
    query: "?client_id=staff-client",
    role: "owner",
  });
  await staff.page.locator("#s-amount").waitFor({ state: "visible" });
  const staffNav = await staff.page.locator("#money-nav a").evaluateAll((links) => links.map((link) => ({
    text: link.textContent.trim(),
    href: link.getAttribute("href"),
    current: link.getAttribute("aria-current"),
  })));
  assert.deepEqual(staffNav, [
    { text: "Money", href: "/app/financeos.html?client_id=staff-client#overview", current: null },
    { text: "Accounts", href: "/app/financeos.html?client_id=staff-client#accounts", current: null },
    { text: "Credit", href: "/app/financeos.html?client_id=staff-client#credit", current: null },
    { text: "Connections", href: "/app/financeos.html?client_id=staff-client#connections", current: null },
    { text: "Payments", href: "/app/financeos.html?client_id=staff-client#payments", current: null },
    { text: "Setup", href: "/app/financeos.html?client_id=staff-client#setup", current: null },
    { text: "Strategy", href: "/app/money-strategy.html?client_id=staff-client", current: "page" },
  ]);
  prove(IDS.nav);
  assert.deepEqual(await staff.page.locator("#money-back").evaluate((link) => ({
    text: link.textContent.trim(),
    href: link.getAttribute("href"),
  })), { text: "Back to Finance OS", href: "finance-os.html?client_id=staff-client" });
  prove(IDS.back);
  const details = staff.page.locator(".fh-strategy details.card");
  assert.equal(await details.count() >= 3, true);
  const cashDetails = details.filter({ has: staff.page.getByText("How the cash check works", { exact: true }) });
  const howDetails = details.filter({ has: staff.page.getByText("How this is worked out", { exact: true }) });
  await cashDetails.locator("summary").click();
  await howDetails.locator("summary").click();
  const cashText = (await cashDetails.innerText()).replace(/\s+/g, " ");
  const howText = (await howDetails.innerText()).replace(/\s+/g, " ");
  assert.match(cashText, /How the cash check works/i);
  assert.match(cashText, /Business cash: \$18,750\.00 in Business Checking/);
  assert.match(cashText, /Personal cash and business cash are never added together/);
  assert.match(howText, /How this is worked out/i);
  assert.match(howText, /Staff only · sources:/);
  assert.match(howText, /src\/banking\/cashflow\.mjs/);
  prove(IDS.explainers);
  await staff.context.close();

  const emptyFixture = clone(STRATEGY_FIXTURE);
  emptyFixture.inputs.debts = [];
  const empty = await strategyPage(browser, origin, { fixture: emptyFixture });
  await empty.page.locator(".empty").waitFor({ state: "visible" });
  assert.match(await empty.page.locator(".empty").innerText(), /No cards or loans with a balance yet/);
  assert.deepEqual(await empty.page.locator(".empty a").evaluate((link) => ({
    text: link.textContent.trim(),
    href: link.getAttribute("href"),
  })), { text: "Add an account", href: "/app/financeos.html#accounts" });
  prove(IDS.empty);
  await empty.context.close();

  const minimumFixture = clone(STRATEGY_FIXTURE);
  minimumFixture.defaults = { method: "avalanche", monthly_cents: 100000, goal: null };
  const minimum = await strategyPage(browser, origin, { fixture: minimumFixture });
  await minimum.page.locator(".notice").waitFor({ state: "visible" });
  assert.match(await minimum.page.locator(".notice").innerText(), /That is less than the minimum payments \(\$1,225\.00 a month\)\. Pick at least that much\./);
  const minimumUse = minimum.page.getByRole("button", { name: "Use $1,225.00" });
  await minimumUse.click();
  await minimum.page.waitForFunction(() => document.querySelector("#s-amount")?.value === "1,225.00");
  assert.equal(await minimum.page.locator("#s-amount").inputValue(), "1,225.00");
  await minimum.context.close();

  const noAmountFixture = clone(STRATEGY_FIXTURE);
  noAmountFixture.defaults = { method: "avalanche", monthly_cents: null, goal: null };
  const noAmount = await strategyPage(browser, origin, { fixture: noAmountFixture });
  await noAmount.page.locator(".notice").waitFor({ state: "visible" });
  assert.equal(
    (await noAmount.page.locator(".notice").innerText()).replace(/\s+/g, " ").trim(),
    "PLAN Pick how much you can put toward debt each month.",
  );
  assert.equal(await noAmount.page.locator('.notice [data-act="use-amount"]').count(), 0);
  await noAmount.context.close();
  prove(IDS.minimums);

  const overFixture = clone(STRATEGY_FIXTURE);
  overFixture.defaults = { method: "avalanche", monthly_cents: 150000, goal: null };
  overFixture.inputs.cash.by_kind.personal.safe_cents = 12000;
  const over = await strategyPage(browser, origin, { fixture: overFixture });
  const safeUse = over.page.getByRole("button", { name: "Use $1,305.00" });
  await safeUse.waitFor({ state: "visible" });
  await safeUse.click();
  await over.page.waitForFunction(() => document.querySelector("#s-amount")?.value === "1,305.00");
  assert.equal(await over.page.locator("#s-amount").inputValue(), "1,305.00");
  await over.context.close();

  const refusedFixture = clone(STRATEGY_FIXTURE);
  refusedFixture.defaults = { method: "avalanche", monthly_cents: 150000, goal: null };
  const refused = await strategyPage(browser, origin, {
    fixture: refusedFixture,
    onPost: (route) => json(route, {
      ok: false,
      error: "over_safe_amount",
      message: "Too much for this month's cash.",
      max_safe_monthly_cents: 130500,
    }, 409),
  });
  await refused.page.locator("#s-amount").waitFor({ state: "visible" });
  await refused.page.locator('[data-act="save"]').click();
  const refusedUse = refused.page.locator('[data-slot="save-msg"] [data-act="use-amount"]');
  await refusedUse.waitFor({ state: "visible" });
  assert.equal(await refusedUse.innerText(), "Use $1,305.00");
  await refusedUse.click();
  await refused.page.waitForFunction(() => document.querySelector("#s-amount")?.value === "1,305.00");
  assert.equal(await refused.page.locator("#s-amount").inputValue(), "1,305.00");
  await refused.context.close();
  prove(IDS.useAmount);

  let releaseFirstRead;
  const firstReadGate = new Promise((resolve) => { releaseFirstRead = resolve; });
  const states = await strategyPage(browser, origin, {
    onGet: async (route, count) => {
      if (count === 1) {
        await firstReadGate;
        return json(route, { ok: false, db: "down", message: "database unavailable" }, 503);
      }
      return json(route, clone(STRATEGY_FIXTURE));
    },
  });
  assert.equal(await states.page.locator('[aria-busy="true"]').count() >= 2, true);
  assert.match(await states.page.locator("#strategy-root").innerText(), /Loading your cards and loans/);
  releaseFirstRead();
  const retry = states.page.getByRole("button", { name: "Try again" });
  await retry.waitFor({ state: "visible" });
  assert.equal((await states.page.locator('[role="alert"]').innerText()).replace(/\s+/g, " ").trim(), "We could not load your plan Our database is not answering right now. Try again in a few minutes. Try again");
  await retry.click();
  await states.page.locator("#s-amount").waitFor({ state: "visible" });
  assert.deepEqual(states.calls.get, ["/api/money/strategy", "/api/money/strategy"]);
  assert.match(await states.page.locator(".debts-card").innerText(), /Personal Visa/);
  await states.context.close();

  const mathContext = await browserContext(browser, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/money/strategy") return json(route, clone(STRATEGY_FIXTURE));
    return json(route, { ok: true, items: [] });
  });
  await mathContext.route("**/app/money-strategy-math.js", (route) => route.abort("failed"));
  const mathPage = await mathContext.newPage();
  await mathPage.goto(`${origin}/app/money-strategy.html`, { waitUntil: "domcontentloaded" });
  const mathAlert = mathPage.locator('[role="alert"]');
  await mathAlert.waitFor({ state: "visible" });
  assert.equal(
    (await mathAlert.innerText()).replace(/\s+/g, " ").trim(),
    "We could not load your plan The part of the page that does the math did not load. Try again. Try again",
  );
  await mathContext.close();
  prove(IDS.states);

  const signedOutProofs = DISPLAY_CONTRACTS_CD_PROOFS.filter((proof) => proof.control === "Signed-out redirect (read answers 401)");
  assert.equal(signedOutProofs.length, 10);
  for (const proof of signedOutProofs) {
    const apiReads = [];
    const expectedReads = SIGNED_OUT_READS[proof.surface];
    assert.ok(expectedReads, `${proof.rowId}: missing named data endpoint`);
    const context = await browserContext(browser, async (route) => {
      const request = route.request();
      const requestPath = new URL(request.url()).pathname;
      apiReads.push({ method: request.method(), path: requestPath });
      if (expectedReads.includes(requestPath) && request.method() === "GET") {
        return json(route, { ok: false, error: "unauthorized" }, 401);
      }
      return json(route, { ok: true, items: [], groups: [], pages: [] });
    }, { role: "", token: "" });
    const page = await context.newPage();
    const pagePath = `/${proof.surface.replace(/^public\//, "")}`;
    await page.goto(`${origin}${pagePath}`, { waitUntil: "domcontentloaded" });
    await page.waitForURL(`${origin}/portal-login.html`);
    assert.equal(new URL(page.url()).pathname, "/portal-login.html", `${proof.rowId}: wrong sign-in page`);
    for (const expectedPath of expectedReads) {
      assert.equal(
        apiReads.some((entry) => entry.method === "GET" && entry.path === expectedPath),
        true,
        `${proof.rowId}: ${expectedPath} did not receive 401`,
      );
    }
    prove(proof.rowId);
    await context.close();
  }

  assert.deepEqual(
    [...exercised].sort(),
    DISPLAY_CONTRACTS_CD_PROOFS.map((proof) => proof.rowId).sort(),
    "every exported proof key must have one direct Chromium result assertion",
  );
  t.diagnostic(`strict proved count: ${exercised.size}; honest leftovers: ${DISPLAY_CONTRACTS_CD_METADATA.honestLeftoverCount}`);
});
