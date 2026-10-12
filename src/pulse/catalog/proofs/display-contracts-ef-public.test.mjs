import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

import {
  DISPLAY_CONTRACTS_EF_PUBLIC_PROOF_CASES,
  DISPLAY_CONTRACTS_EF_PUBLIC_PROOF_METADATA,
  DISPLAY_CONTRACTS_EF_PUBLIC_ROW_KEYS,
} from "./display-contracts-ef-public.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const PUBLIC = path.join(ROOT, "public");
const CATALOG = JSON.parse(fs.readFileSync(path.join(ROOT, "src/pulse/catalog/generated.json"), "utf8"));
const CLIENT_ID = "11111111-2222-4333-8444-555555555555";
const OTHER_CLIENT_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

const CONTENT_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
]);

function normalize(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function cases(recipe) {
  return DISPLAY_CONTRACTS_EF_PUBLIC_PROOF_CASES.filter((entry) => entry.recipe === recipe);
}

function one(recipe) {
  const found = cases(recipe);
  assert.equal(found.length, 1, `expected one ${recipe} proof case`);
  return found[0];
}

function staticFile(pathname) {
  const clean = decodeURIComponent(pathname).replace(/^\/+/, "");
  if (!clean) return path.join(PUBLIC, "index.html");
  const candidates = clean.endsWith("/")
    ? [path.join(PUBLIC, clean, "index.html")]
    : [path.join(PUBLIC, clean), path.join(PUBLIC, clean, "index.html")];
  return candidates.find((candidate) => candidate.startsWith(PUBLIC) && fs.existsSync(candidate));
}

async function startServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname.startsWith("/api/")) {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true, items: [], notes: {}, meta: {} }));
      return;
    }
    const file = staticFile(url.pathname);
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

async function closeServer(server) {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function visibleAnchor(page, href, label) {
  const anchors = page.locator(`a[href="${href.replaceAll('"', '\\"')}"]`);
  const compactLabel = label.replace(/\s+/g, "");
  for (let index = 0; index < await anchors.count(); index += 1) {
    const anchor = anchors.nth(index);
    if (!await anchor.isVisible()) continue;
    if (normalize(await anchor.textContent()).replace(/\s+/g, "").includes(compactLabel)) return anchor;
  }
  assert.fail(`no visible ${label} link points to ${href}`);
}

function entitlement(code, name, clientId = CLIENT_ID, active = true) {
  return {
    client_id: clientId,
    entitlement_code: code,
    entitlement_name: name,
    active,
  };
}

async function paymentPage(browser, origin, answer, { fastTimers = false, query } = {}) {
  const page = await browser.newPage();
  if (fastTimers) {
    await page.addInitScript(() => {
      const realSetTimeout = window.setTimeout.bind(window);
      window.setTimeout = (fn, delay, ...args) => realSetTimeout(fn, Math.min(Number(delay) || 0, 5), ...args);
    });
  }
  const calls = [];
  await page.route("**/api/read/entitlements**", async (route) => {
    calls.push({ url: route.request().url(), at: Date.now() });
    const response = await answer(calls.length, route.request());
    if (response === "abort") return route.abort("failed");
    return route.fulfill({
      status: response.status ?? 200,
      contentType: "application/json",
      body: JSON.stringify(response.body ?? response),
    });
  });
  const search = query ?? `?ref=pay_ref_123&client_id=${CLIENT_ID}`;
  await page.goto(`${origin}/app/payment-success.html${search}`, { waitUntil: "domcontentloaded" });
  return { page, calls };
}

async function waitForText(page, text, timeout = 8_000) {
  await page.waitForFunction((wanted) => document.body.textContent.includes(wanted), text, { timeout });
}

async function waitForState(page, text, timeout = 8_000) {
  await page.waitForFunction(
    (wanted) => document.getElementById("state")?.innerText.includes(wanted),
    text,
    { timeout },
  );
}

test("Display EF/Public contracts prove each exported row in rendered Chromium", { timeout: 90_000 }, async (t) => {
  assert.equal(DISPLAY_CONTRACTS_EF_PUBLIC_PROOF_METADATA.provedCount, 44);
  assert.equal(DISPLAY_CONTRACTS_EF_PUBLIC_ROW_KEYS.length, 44);
  assert.equal(new Set(DISPLAY_CONTRACTS_EF_PUBLIC_ROW_KEYS).size, 44);

  for (const proofCase of DISPLAY_CONTRACTS_EF_PUBLIC_PROOF_CASES) {
    const matches = CATALOG.items.filter((item) => item.id === proofCase.id);
    assert.equal(matches.length, 1, `catalog row ${proofCase.id}`);
    assert.equal(matches[0].sourceFile, proofCase.sourceFile);
    assert.equal(matches[0].surface, proofCase.surface);
    assert.equal(matches[0].proofAsserts, proofCase.control);
    assert.equal(matches[0].proofVerdict, "red");
  }

  const exercised = new Set();
  const mark = (proofCase) => {
    assert.equal(exercised.has(proofCase.key), false, `row was exercised twice: ${proofCase.key}`);
    exercised.add(proofCase.key);
  };

  const { server, origin } = await startServer();
  const browser = await chromium.launch({ headless: true });
  t.after(async () => {
    await browser.close();
    await closeServer(server);
  });

  await t.test("public screen rows render their exact page result", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    for (const proofCase of cases("public-screen")) {
      await page.goto(`${origin}${proofCase.page}`, { waitUntil: "domcontentloaded" });
      assert.equal(await page.title(), proofCase.title, `${proofCase.surface}: title`);
      const headings = page.locator("h1:visible");
      const rendered = [];
      for (let index = 0; index < await headings.count(); index += 1) {
        rendered.push(normalize(await headings.nth(index).textContent()));
      }
      assert.ok(rendered.includes(proofCase.heading), `${proofCase.surface}: rendered headings were ${rendered.join(" | ")}`);
      mark(proofCase);
    }
    await page.close();
  });

  await t.test("public link rows perform the real click and reach the exact address", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    for (const proofCase of cases("public-link")) {
      await page.goto(`${origin}${proofCase.page}`, { waitUntil: "domcontentloaded" });
      const anchor = await visibleAnchor(page, proofCase.href, proofCase.label);
      assert.ok(
        normalize(await anchor.textContent()).replace(/\s+/g, "").includes(proofCase.label.replace(/\s+/g, "")),
        `${proofCase.surface}: label`,
      );
      const expected = new URL(proofCase.href, page.url());
      await page.route(expected.href, (route) => route.fulfill({
        status: 200,
        contentType: "text/html",
        body: `<!doctype html><title>Clicked destination</title><main>${expected.pathname}${expected.search}</main>`,
      }), { times: 1 });
      await Promise.all([
        page.waitForURL((url) => url.pathname === expected.pathname && url.search === expected.search),
        anchor.click(),
      ]);
      const actual = new URL(page.url());
      assert.equal(actual.pathname, expected.pathname, `${proofCase.surface}: path`);
      assert.equal(actual.search, expected.search, `${proofCase.surface}: query`);
      mark(proofCase);
    }
    await page.close();
  });

  await t.test("morning brief link and red-check toggle paint the exact result", async () => {
    const openCase = one("morning-open");
    const toggleCase = one("morning-toggle");
    const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
    const apiCalls = [];
    const reds = Array.from({ length: 6 }, (_, index) => ({
      id: `test:red-${index + 1}`,
      day_count: index + 1,
      customer_sees: `Test result ${index + 1}`,
      proof: `Observed ${index + 1}`,
      fix: `Fix ${index + 1}`,
    }));
    await page.route("**/api/public/morning-brief**", async (route) => {
      const url = new URL(route.request().url());
      apiCalls.push(url.pathname + url.search);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          date: "2026-10-09",
          kind: "morning",
          brief: {
            systems: { status: "ok", total: 10, green: 4, red: 6, not_checked: 0, reds },
            team: null,
            money: null,
            marketing: null,
            suggestions: [],
            today: null,
          },
        }),
      });
    });
    const code = "AbCdEfGhIjKlMnOpQrStUvWxYz012-_9";
    await page.goto(`${origin}/app/morning-brief.html?date=2026-10-09&kind=morning&k=${code}`);
    assert.equal(normalize(await page.locator("h1").textContent()), "Friday, October 9");
    assert.equal(new URL(page.url()).pathname, "/app/morning-brief.html");
    assert.deepEqual(apiCalls, [`/api/public/morning-brief?date=2026-10-09&kind=morning&k=${code}`]);
    const stored = await page.evaluate((secret) => ({
      local: JSON.stringify({ ...localStorage }).includes(secret),
      session: JSON.stringify({ ...sessionStorage }).includes(secret),
      cookie: document.cookie.includes(secret),
    }), code);
    assert.deepEqual(stored, { local: false, session: false, cookie: false });
    mark(openCase);

    const button = page.locator("section", { has: page.locator("h2", { hasText: "Systems" }) }).locator("button.more");
    assert.equal(normalize(await button.textContent()), "Show all 6 red checks");
    assert.equal(await page.locator("li.red-item:visible").count(), 5);
    await button.click();
    assert.equal(await page.locator("li.red-item:visible").count(), 6);
    assert.equal(normalize(await button.textContent()), "Show only the first 5");
    await button.click();
    assert.equal(await page.locator("li.red-item:visible").count(), 5);
    assert.equal(normalize(await button.textContent()), "Show all 6 red checks");
    mark(toggleCase);
    await page.close();
  });

  await t.test("payment return paints identifiers and carries the account back to the portal", async () => {
    const { page, calls } = await paymentPage(browser, origin, async () => ({ status: 401, body: { ok: false } }), { fastTimers: true });
    await waitForState(page, "We cannot check your account from here");
    assert.equal(new URL(page.url()).pathname, "/app/payment-success.html");
    assert.equal(normalize(await page.locator("h1").textContent()), "Thanks — you are back from checkout");
    assert.equal(calls.length, 1);
    mark(one("payment-open"));

    assert.equal(normalize(await page.locator("#refline").textContent()), "Payment reference: pay_ref_123");
    assert.equal(await page.locator("#refline").isVisible(), true);
    mark(one("payment-reference"));

    const back = page.locator("#back");
    assert.equal(await back.getAttribute("href"), `client-portal.html?client_id=${CLIENT_ID}`);
    await page.route(`**/app/client-portal.html?client_id=${CLIENT_ID}`, (route) => route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><title>Portal</title><main>Client portal</main>",
    }), { times: 1 });
    await Promise.all([
      page.waitForURL((url) => url.pathname === "/app/client-portal.html" && url.searchParams.get("client_id") === CLIENT_ID),
      back.click(),
    ]);
    assert.equal(new URL(page.url()).searchParams.get("client_id"), CLIENT_ID);
    mark(one("payment-back"));
    await page.close();
  });

  await t.test("payment check waits three seconds, stops at six, remembers the baseline, and restarts only on click", async () => {
    const held = entitlement("held-access", "Existing Access");
    const { page, calls } = await paymentPage(browser, origin, async () => ({ ok: true, items: [held] }));
    await waitForState(page, "Nothing new has opened yet", 22_000);
    assert.equal(calls.length, 6, "the bounded page made exactly six reads");
    for (let index = 1; index < calls.length; index += 1) {
      assert.ok(calls[index].at - calls[index - 1].at >= 2_800, `read ${index + 1} ran before the three-second gap`);
    }
    assert.ok(normalize(await page.locator("#state").textContent()).includes("Existing Access"));
    await page.waitForTimeout(3_200);
    assert.equal(calls.length, 6, "the bounded page kept polling after the sixth read");
    mark(one("payment-bounded"));

    const nextRead = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/read/entitlements");
    await page.locator("#again").click();
    await nextRead;
    assert.equal(calls.length, 7, "Check again did not start a new round");
    mark(one("payment-again"));
    await page.close();
  });

  await t.test("payment feed paints every named state from controlled returned rows", async () => {
    const held = entitlement("held-access", "Existing Access");
    const fresh = entitlement("new-access", "Fresh Funding Room");
    const inactive = entitlement("inactive", "Inactive Offer", CLIENT_ID, false);
    const other = entitlement("other", "Other Person Offer", OTHER_CLIENT_ID);

    const opened = await paymentPage(browser, origin, async (call) => ({
      ok: true,
      items: call === 1 ? [held] : [held, fresh, inactive, other],
    }), { fastTimers: true });
    await waitForState(opened.page, "Just opened on your account");
    const openedText = normalize(await opened.page.locator("#state").textContent());
    assert.ok(openedText.includes("Fresh Funding Room"));
    assert.equal(openedText.includes("Inactive Offer"), false);
    assert.equal(openedText.includes("Other Person Offer"), false);
    assert.ok(opened.calls.every((call) => {
      const url = new URL(call.url);
      return url.pathname === "/api/read/entitlements"
        && url.searchParams.get("limit") === "200"
        && url.searchParams.get("client_id") === CLIENT_ID;
    }));
    mark(one("payment-feed"));
    await opened.page.close();

    const nothingNew = await paymentPage(browser, origin, async () => ({ ok: true, items: [held] }), { fastTimers: true });
    await waitForState(nothingNew.page, "Nothing new has opened yet");
    assert.ok(normalize(await nothingNew.page.locator("#state").textContent()).includes("Existing Access"));
    await nothingNew.page.close();

    const nothingOpen = await paymentPage(browser, origin, async () => ({ ok: true, items: [] }), { fastTimers: true });
    await waitForState(nothingOpen.page, "Nothing is open on your account yet");
    await nothingOpen.page.close();

    const signedOut = await paymentPage(browser, origin, async () => ({ status: 401, body: { ok: false } }), { fastTimers: true });
    await waitForState(signedOut.page, "We cannot check your account from here");
    await signedOut.page.close();

    const unknown = await paymentPage(browser, origin, async () => ({
      ok: true,
      items: [entitlement("one", "One", CLIENT_ID), entitlement("two", "Two", OTHER_CLIENT_ID)],
    }), { fastTimers: true, query: "?ref=unknown-account" });
    await waitForState(unknown.page, "We cannot tell which account this is");
    await unknown.page.close();

    const unreachable = await paymentPage(browser, origin, async () => "abort", { fastTimers: true });
    await waitForState(unreachable.page, "We could not reach your account");
    await unreachable.page.close();

    mark(one("payment-states"));
  });

  await t.test("pocket remote reads, moves, pauses, resets, saves, and opens the mirrored iPad", async () => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const calls = [];
    const shoot = {
      ok: true,
      wpm: 150,
      shoot: {
        scripts: [
          { id: "s1", version: 3, ad_id: 7, angle_name: "Done angle", body: "Done script words.", got_it: true },
          { id: "s2", version: 5, ad_id: 8, angle_name: "The bank said no", body: "One two three four five six seven eight nine ten.", got_it: false },
        ],
      },
    };
    await page.route("**/api/**", async (route) => {
      const request = route.request();
      calls.push({
        url: request.url(),
        method: request.method(),
        headers: request.headers(),
        body: request.method() === "POST" ? request.postDataJSON() : null,
      });
      if (request.url().includes("/api/marketing/scripts/edit")) {
        const body = request.postDataJSON();
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true, script: { id: "s2", version: 6, body: body.body } }),
        });
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(shoot) });
    });
    await page.goto(`${origin}/app/teleprompter-remote.html?k=film-key-abc`);
    assert.equal(normalize(await page.locator("#remote-title").textContent()), "The bank said no");
    assert.equal(await page.locator("#remote-body").inputValue(), "One two three four five six seven eight nine ten.");
    const read = calls.find((call) => call.url.includes("/api/marketing/shoot"));
    assert.equal(read.headers["x-shoot-film"], "film-key-abc");
    assert.equal(read.headers.authorization, undefined);
    mark(one("remote-open"));

    assert.equal(normalize(await page.locator("#remote-roll .now").textContent()), "One");
    await page.locator("#remote-play").click();
    assert.equal(await page.locator("#remote-play").getAttribute("aria-pressed"), "true");
    await page.waitForFunction(() => document.querySelector("#remote-roll .now")?.textContent.trim() !== "One", null, { timeout: 3_000 });
    await page.locator("#remote-play").click();
    const stoppedAt = normalize(await page.locator("#remote-roll .now").textContent());
    await page.waitForTimeout(700);
    assert.equal(normalize(await page.locator("#remote-roll .now").textContent()), stoppedAt);
    assert.equal(normalize(await page.locator("#gap").textContent()), "The recording phone still cannot pause the iPad or change the words.");
    mark(one("remote-play"));

    await page.locator("#remote-play").click();
    await page.locator("#remote-body").focus();
    assert.equal(await page.locator("#remote-play").getAttribute("aria-pressed"), "false");
    await page.locator("#remote-body").fill("Reset clock words for the saved script.");
    assert.equal(normalize(await page.locator("#remote-roll .now").textContent()), "Reset");
    mark(one("remote-words"));

    await page.locator("#remote-save").click();
    await waitForText(page, "Saved. The iPad shows these words the next time its words are paused.");
    const edit = calls.find((call) => call.url.includes("/api/marketing/scripts/edit"));
    assert.equal(edit.method, "POST");
    assert.equal(edit.headers["x-shoot-film"], "film-key-abc");
    assert.equal(edit.body.id, "s2");
    assert.equal(edit.body.version, 5);
    assert.equal(edit.body.body, "Reset clock words for the saved script.");
    assert.equal(typeof edit.body.request_id, "string");
    mark(one("remote-save"));

    const mirror = page.locator("#remote-ipad");
    assert.equal(await mirror.getAttribute("href"), "/app/teleprompter.html?k=film-key-abc&mirror=1");
    await page.route("**/app/teleprompter.html**", (route) => route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><title>Mirrored iPad</title><main>Mirror opened</main>",
    }));
    await Promise.all([
      page.waitForURL((url) => url.pathname === "/app/teleprompter.html" && url.searchParams.get("mirror") === "1"),
      mirror.click(),
    ]);
    const mirrorUrl = new URL(page.url());
    assert.equal(mirrorUrl.searchParams.get("k"), "film-key-abc");
    assert.equal(mirrorUrl.searchParams.get("mirror"), "1");
    assert.equal(normalize(await page.locator("main").textContent()), "Mirror opened");
    mark(one("remote-link"));
    await page.close();
  });

  assert.deepEqual([...exercised].sort(), [...DISPLAY_CONTRACTS_EF_PUBLIC_ROW_KEYS].sort());
});
