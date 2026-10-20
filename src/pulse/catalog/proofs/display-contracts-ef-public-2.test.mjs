import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";
import { CONTRACT } from "../../../marketing/api-contract.mjs";
import { DISPLAY_CONTRACTS_EF_PUBLIC_ROW_KEYS } from "./display-contracts-ef-public.mjs";
import {
  DISPLAY_CONTRACTS_EF_PUBLIC_2_METADATA,
  DISPLAY_CONTRACTS_EF_PUBLIC_2_PROOF_CASES,
  DISPLAY_CONTRACTS_EF_PUBLIC_2_ROW_KEYS,
} from "./display-contracts-ef-public-2.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const PUBLIC = path.join(ROOT, "public");
const TYPES = new Map([[".css", "text/css"], [".html", "text/html"], [".js", "text/javascript"], [".json", "application/json"], [".svg", "image/svg+xml"], [".png", "image/png"]]);

const compact = (value) => String(value || "").replace(/\s+/g, " ").trim();
const clone = (value) => JSON.parse(JSON.stringify(value));

function cases(recipe) {
  return DISPLAY_CONTRACTS_EF_PUBLIC_2_PROOF_CASES.filter((entry) => entry.recipe === recipe);
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
  const server = http.createServer((req, res) => {
    const file = staticFile(new URL(req.url, "http://127.0.0.1").pathname);
    if (!file) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
      return;
    }
    res.writeHead(200, { "content-type": `${TYPES.get(path.extname(file)) || "application/octet-stream"}; charset=utf-8` });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

async function closeServer(server) {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function json(route, body, status = 200) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function sessionPage(browser, role, routes = {}) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.addInitScript((savedRole) => {
    localStorage.setItem("fh_token", "proof-token");
    localStorage.setItem("fh_role", savedRole);
  }, role);
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/auth/session") return json(route, { ok: true, staff: { id: "proof-staff", name: "Proof Person", email: "proof@example.test", role, org_id: "proof-org", status: "active" } });
    if (url.pathname === "/api/health") return json(route, { ok: true, db: "up" });
    const answer = routes[url.pathname];
    if (answer) return json(route, typeof answer === "function" ? await answer(route) : answer);
    return json(route, { ok: false, error: "unexpected", path: url.pathname }, 599);
  });
  return page;
}

test("Display EF/Public wave 2 proves every exported row in rendered Chromium", { timeout: 120_000 }, async (t) => {
  assert.equal(DISPLAY_CONTRACTS_EF_PUBLIC_2_METADATA.provedCount, 23);
  assert.equal(DISPLAY_CONTRACTS_EF_PUBLIC_2_ROW_KEYS.length, 23);
  assert.equal(new Set(DISPLAY_CONTRACTS_EF_PUBLIC_2_ROW_KEYS).size, 23);
  const old = new Set(DISPLAY_CONTRACTS_EF_PUBLIC_ROW_KEYS);
  for (const proof of DISPLAY_CONTRACTS_EF_PUBLIC_2_PROOF_CASES) {
    assert.equal(old.has(proof.key), false, `old shard already exports ${proof.key}`);
  }

  const exercised = new Set();
  const mark = (proof) => {
    if (!proof) return;
    assert.equal(exercised.has(proof.key), false, `row exercised twice: ${proof.key}`);
    exercised.add(proof.key);
  };
  const markRecipe = (recipe) => cases(recipe).forEach(mark);

  const { server, origin } = await startServer();
  const browser = await chromium.launch({ headless: true });
  t.after(async () => {
    await browser.close();
    await closeServer(server);
  });

  await t.test("my numbers opens for the closer and paints the exact owed links and identity chips", async () => {
    const data = {
      ok: true, staff_id: "proof-staff", shift: { on_shift: true, elapsed_ms: 7_200_000 }, pace: {}, month: { unlogged: 2 }, money: {}, team: [], call_quality: {}, streak: {},
      owed: [
        { urgency: "NOW", title: "Log Dana's call", detail: "Missing outcome", client_id: "client-1", task_id: "task-9" },
        { urgency: "TODAY", title: "Call Lee", detail: "Quiet deposit", client_id: "client-2" },
      ],
    };
    const page = await sessionPage(browser, "closer", { "/api/read/my-numbers": data });
    await page.goto(`${origin}/app/my-numbers.html`);
    await page.waitForFunction(() => document.querySelectorAll("a.todo").length === 2);
    assert.equal(new URL(page.url()).pathname, "/app/my-numbers.html");
    assert.equal(compact(await page.locator("#shiftChip").innerText()).toLowerCase(), "on shift · 2h 0m");
    assert.equal(compact(await page.locator("#staffChip").innerText()).toLowerCase(), "proof person");
    const links = await page.locator("a.todo").evaluateAll((nodes) => nodes.map((node) => ({ text: node.innerText, href: node.getAttribute("href") })));
    assert.deepEqual(links.map((link) => link.href), ["closer-dashboard.html?client_id=client-1&task_id=task-9", "closer-dashboard.html?client_id=client-2"]);
    assert.match(links[0].text, /Log Dana's call[\s\S]*Missing outcome/);
    markRecipe("my-numbers");
    await page.close();
  });

  await t.test("partner training paints all thirteen rows, its home link, and no write control", async () => {
    const modules = Array.from({ length: 13 }, (_, index) => ({
      code: `m${index + 1}`, position: index + 1, title: `Module ${index + 1}`, week_no: index < 12 ? index + 1 : null,
      gate_code: index < 4 ? `G${index + 1}` : null, certified: index === 2,
      status: index < 2 ? "complete" : index === 2 ? "attended" : null,
    }));
    const body = { ok: true, modules, gates: [], modules_total: 13, modules_complete: 2, next_module: modules[2], next_gate: null, gates_outstanding: [], may_sell_supervised: false, may_sell_unsupervised: false, entitled: true, curriculum_seeded: true };
    const page = await sessionPage(browser, "partner", { "/api/read/partner-training": body });
    await page.goto(`${origin}/app/partner-training.html`);
    await page.waitForFunction(() => document.querySelectorAll("#trModules .mrow").length === 13);
    assert.equal(await page.locator("#trModules .mrow").count(), 13);
    const rows = compact(await page.locator("#trModules").innerText());
    assert.match(rows, /Module 1.*Done/i);
    assert.match(rows, /Module 3.*Certified.*Sat, not finished/i);
    assert.match(rows, /Module 13.*Not started/i);
    const home = page.locator('a[href="partner-galaxy.html"]:visible');
    assert.ok((await home.count()) > 0);
    assert.equal(await page.locator("#trBody button, #trBody input, #trBody select, #trBody textarea").count(), 0);
    markRecipe("partner-training");
    await page.close();
  });

  await t.test("static public screens render their exact result", async () => {
    const page = await browser.newPage();
    // These are exported HTML proofs. Keep Next's client hydration from racing
    // the two server-rendered <title> rows out of the 404 document while this
    // test reads them; the page body and metadata are already in the HTML.
    await page.route("**/climate/_next/static/**/*.js", (route) => route.abort());
    const expected = [
      ["/aniso-face/logo-6k/", "Fundhub ASCII", "canvas"],
      ["/aniso-face/logo-6k/preview.html", "Fundhub ASCII 6K", "video"],
      ["/climate/404.html", ["404: This page could not be found.", "FundHub Lending Climate Dashboard"], "404"],
      ["/climate/404/", ["404: This page could not be found.", "FundHub Lending Climate Dashboard"], "This page could not be found."],
      ["/climate/lender-climate/", "FundHub Lending Climate Dashboard", "Temporarily unavailable."],
    ];
    for (const [url, title, visible] of expected) {
      await page.goto(origin + url, { waitUntil: "domcontentloaded" });
      if (Array.isArray(title)) {
        const titles = new Set(await page.locator("title").allTextContents());
        for (const wanted of title) assert.equal(titles.has(wanted), true, `missing title ${wanted}`);
      }
      else assert.equal(await page.title(), title);
      if (visible === "canvas" || visible === "video") assert.ok(await page.locator(visible).count() > 0);
      else assert.ok(compact(await page.locator("body").innerText()).includes(visible));
    }
    markRecipe("static-screen");
    await page.close();
  });

  await t.test("public links perform their exact navigation", async () => {
    const page = await browser.newPage();
    const rows = [
      ["/optimize.html", "https://smartcredit.com/cblp/?PID=29056", "Get My Credit Report"],
      ["/optimize.html", "https://apply.fundhub.ai/schedule/phonecall", "Or book a call first"],
    ];
    for (const [from, href, label] of rows) {
      await page.goto(origin + from, { waitUntil: "domcontentloaded" });
      const link = page.locator(`a[href="${href}"]`, { hasText: label }).first();
      assert.equal(await link.isVisible(), true, `${label} is visible`);
      assert.equal(await link.getAttribute("href"), href);
      if (label === "Get My Credit Report") await page.locator("#sc-agree").check();
      const absolute = new URL(href, page.url());
      await page.route(absolute.href, (route) => route.fulfill({ status: 200, contentType: "text/html", body: `<main>${absolute.href}</main>` }), { times: 1 });
      const [request] = await Promise.all([
        page.context().waitForEvent("request", { predicate: (seen) => seen.url() === absolute.href }),
        link.click(),
      ]);
      assert.equal(request.url(), absolute.href);
    }
    for (const proof of cases("public-link").filter((entry) => entry.surface.startsWith("link:optimize.html"))) mark(proof);
    await page.close();
  });

  await t.test("partner, career, and education forms send the exact controlled payload and show success", async () => {
    const page = await browser.newPage();
    let posted;
    await page.route("**/api/public/partner-apply", async (route) => {
      posted = route.request().postDataJSON();
      await json(route, { ok: true, kind: "partner", status: "pending_review", email: posted.email, password: null, partner_id: "partner-1" });
    });
    await page.goto(`${origin}/affiliates/`);
    await page.locator("#p-name").fill("Dana Owner"); await page.locator("#p-email").fill("dana@example.test"); await page.locator("#p-phone").fill("6615550100");
    await page.locator("#p-co").fill("Dana Funding LLC"); await page.locator("#p-track").selectOption("white_label"); await page.locator("#p-aud").fill("Business owners"); await page.locator("#p-sms").check();
    await page.locator('#pform button[type="submit"]').click();
    await page.waitForFunction(() => getComputedStyle(document.querySelector("#success")).display !== "none");
    assert.deepEqual({ track: posted.track, email: posted.email, sms: posted.sms_consent }, { track: "white_label", email: "dana@example.test", sms: true });
    assert.match(compact(await page.locator("#success").innerText()), /application.*review call/i);
    markRecipe("partner-apply");

    let roleReads = 0; let application;
    await page.route("**/api/hiring/apply", async (route) => {
      if (route.request().method() === "GET") {
        roleReads += 1;
        if (roleReads === 1) return json(route, { ok: false }, 503);
        return json(route, { ok: true, roles: [{ key: "closer", name: "Closer", summary: "Close calls", status: "open" }] });
      }
      application = route.request().postDataJSON();
      return json(route, { ok: true, application_id: "application-1" });
    });
    await page.goto(`${origin}/careers.html`);
    await page.waitForFunction(() => getComputedStyle(document.querySelector("#roles-error")).display !== "none");
    await page.locator("#retry").click();
    await page.waitForFunction(() => getComputedStyle(document.querySelector("#apply-form")).display !== "none");
    await page.locator("#role").selectOption("closer"); await page.locator("#name").fill("Casey Closer"); await page.locator("#email").fill("casey@example.test"); await page.locator("#phone").fill("6615550111"); await page.locator("#linkedin").fill("https://linkedin.com/in/casey");
    await page.locator("#apply-form").evaluate((form) => form.requestSubmit());
    await page.waitForFunction(() => getComputedStyle(document.querySelector("#success")).display !== "none");
    assert.equal(roleReads, 2); assert.equal(application.role, "closer"); assert.equal(application.email, "casey@example.test");
    markRecipe("careers");

    let enrollment;
    await page.route("**/api/public/education-enroll", async (route) => { enrollment = route.request().postDataJSON(); await json(route, { ok: true, enrollment_id: "enroll-1" }); });
    await page.goto(`${origin}/education/enroll/`);
    await page.locator("#program").selectOption("capital-strategy"); await page.locator("#name").fill("Evan Student"); await page.locator("#email").fill("evan@example.test"); await page.locator("#phone").fill("6615550122"); await page.locator("#sms").check();
    await page.locator("#enroll-form").evaluate((form) => form.requestSubmit());
    await page.waitForFunction(() => getComputedStyle(document.querySelector("#success")).display !== "none");
    assert.deepEqual({ program: enrollment.program, email: enrollment.email, sms: enrollment.sms_consent }, { program: "capital-strategy", email: "evan@example.test", sms: true });
    markRecipe("education-enroll");
    await page.close();
  });

  await t.test("login, reset, portal link, roadmap, pull, and unsubscribe show exact outcomes", async () => {
    const page = await browser.newPage();
    let loginBody; let resetBody;
    await page.route("**/api/auth/login", async (route) => { loginBody = route.request().postDataJSON(); await json(route, { ok: true, token: "saved-token", staff: { role: "owner" } }); });
    await page.route("**/api/auth/reset", async (route) => { resetBody = route.request().postDataJSON(); await json(route, resetBody.action === "request" ? { ok: true, mailed: true } : { ok: true }); });
    await page.route("**/app/", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<main>App home</main>" }));
    await page.goto(`${origin}/login.html`);
    await page.locator("#email").fill("owner@example.test"); await page.locator("#pw").fill("correct horse battery staple"); await page.locator("#f").evaluate((form) => form.requestSubmit());
    await page.waitForURL("**/app/");
    assert.deepEqual(loginBody, { email: "owner@example.test", password: "correct horse battery staple" });
    assert.equal(await page.evaluate(() => localStorage.getItem("fh_token")), "saved-token");
    mark(cases("login").find((entry) => entry.surface.startsWith("form:")));

    await page.goto(`${origin}/login.html`);
    await page.locator("#fh-forgot-link").click(); await page.locator("#fh-forgot-email").fill("owner@example.test"); await page.locator("#fh-forgot-go").click();
    await page.waitForFunction(() => document.querySelector("#fh-forgot-msg").textContent.includes("lasts 1 hour"));
    assert.deepEqual(resetBody, { action: "request", email: "owner@example.test" });
    mark(cases("login").find((entry) => entry.surface.startsWith("button:")));

    let magicBody;
    await page.route("**/api/auth/magic-link", async (route) => { magicBody = route.request().postDataJSON(); await json(route, { ok: true, message: "If that email has a portal, a link is on its way." }); });
    await page.goto(`${origin}/portal-login.html`);
    await page.locator("#email").fill("client@example.test"); await page.locator("#f").evaluate((form) => form.requestSubmit());
    await page.waitForFunction(() => getComputedStyle(document.querySelector("#ok-box")).display !== "none");
    assert.deepEqual(magicBody, { email: "client@example.test" }); assert.match(await page.locator("#ok-box").innerText(), /link is on its way/i);
    markRecipe("portal-login");

    await page.goto(`${origin}/reset-password.html?token=one-shot-proof`);
    await page.locator("#pw1").fill("twelve-chars-plus"); await page.locator("#pw2").fill("twelve-chars-plus"); await page.locator("#f").evaluate((form) => form.requestSubmit());
    await page.waitForFunction(() => getComputedStyle(document.querySelector("#okMsg")).display !== "none");
    assert.deepEqual(resetBody, { action: "confirm", token: "one-shot-proof", password: "twelve-chars-plus" });
    mark(cases("reset-password").find((entry) => entry.surface.startsWith("form:")));
    await page.route(`${origin}/login.html`, (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<main>Staff login</main>" }), { times: 1 });
    const resetLogin = page.locator('#okMsg a[href="/login.html"]');
    assert.equal(await resetLogin.isVisible(), true);
    await Promise.all([page.waitForURL(`${origin}/login.html`), resetLogin.click()]);
    mark(cases("reset-password").find((entry) => entry.surface.startsWith("link:")));

    let optimizeBody;
    await page.route("**/api/public/optimize?view=roadmap", async (route) => { optimizeBody = true; await json(route, { ok: true, source: "sample", score: null, preapprovalKnown: false, accounts: [], findings: [], rounds: [] }); });
    await page.goto(`${origin}/optimize-plan.html`);
    await page.locator("#first").fill("Alex"); await page.locator("#last").fill("Roadmap"); await page.locator("#email").fill("alex@example.test"); await page.locator("#goal").selectOption({ index: 1 }); await page.locator("#intake").evaluate((form) => form.requestSubmit());
    await page.waitForFunction(() => !document.querySelector("#planhead").hidden);
    assert.equal(optimizeBody, true); assert.equal(compact(await page.locator("#plantitle").innerText()), "Alex's Plan"); assert.match(await page.locator("#sampletext").innerText(), /example credit file, not on yours/i);
    markRecipe("optimize-plan");
    const book = page.locator('#book[href="https://apply.fundhub.ai/schedule/phonecall"]');
    assert.equal(await book.isVisible(), true);
    await page.route("https://apply.fundhub.ai/schedule/phonecall", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<main>Booked call</main>" }), { times: 1 });
    await Promise.all([page.waitForURL("https://apply.fundhub.ai/schedule/phonecall"), book.click()]);
    mark(cases("public-link").find((entry) => entry.surface.startsWith("link:optimize-plan")));

    let checkoutPost;
    await page.route("**/api/public/slo-checkout", async (route) => {
      if (route.request().method() === "GET") return json(route, { ok: true, priceDisplay: "$297", checkout: { ready: true }, notices: {} });
      checkoutPost = route.request().postDataJSON(); return json(route, { ok: true, checkoutUrl: "https://checkout.example.test/pay" });
    });
    await page.route("https://checkout.example.test/pay", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<main>Secure payment</main>" }));
    await page.goto(`${origin}/roadmap/pay.html`);
    await page.waitForFunction(() => document.body.innerText.includes("$297"));
    await page.locator("#first").fill("Alex"); await page.locator("#last").fill("Roadmap"); await page.locator("#email").fill("alex@example.test"); await page.locator("#pay").evaluate((form) => form.requestSubmit());
    await page.waitForURL("https://checkout.example.test/pay");
    assert.equal(checkoutPost.email, "alex@example.test");
    assert.equal(checkoutPost.first_name, "Alex");
    assert.equal(checkoutPost.last_name, "Roadmap");
    markRecipe("roadmap-pay");

    let pullPost;
    await page.route("**/api/public/slo-pull", async (route) => { pullPost = route.request().postDataJSON(); await json(route, { ok: true }); });
    await page.goto(`${origin}/roadmap/pull.html?ref=pay-proof&client_id=client-proof`);
    for (const [id, value] of [["first", "Alex"], ["last", "Roadmap"], ["dob", "1990-01-02"], ["ssn", "123456789"], ["addr", "1 Main St"], ["city", "Phoenix"], ["state", "AZ"], ["zip", "85001"]]) await page.locator(`#${id}`).fill(value);
    await page.locator("#consent").check(); await page.locator("#pull").evaluate((form) => form.requestSubmit());
    await page.waitForFunction(() => !document.querySelector("#building").hidden);
    assert.deepEqual({ ref: pullPost.ref, client: pullPost.client_id, consent: pullPost.consent, ssn: pullPost.ssn }, { ref: "pay-proof", client: "client-proof", consent: true, ssn: "123456789" });
    assert.equal(await page.locator("#ssn").inputValue(), "");
    markRecipe("roadmap-pull");

    let unsubscribePost;
    await page.route("**/api/public/unsubscribe**", async (route) => {
      if (route.request().method() === "GET") return json(route, { ok: true, already_unsubscribed: false });
      unsubscribePost = route.request().postDataJSON(); return json(route, { ok: true });
    });
    await page.goto(`${origin}/unsubscribe.html?org=org-proof&client=client-proof&channel=email&exp=1790000000&sig=signed-proof`);
    await page.waitForFunction(() => !document.querySelector("#ask").hidden);
    await page.locator("#go").click(); await page.waitForFunction(() => getComputedStyle(document.querySelector("#done-box")).display !== "none");
    assert.deepEqual(unsubscribePost, { org: "org-proof", client: "client-proof", channel: "email", exp: "1790000000", sig: "signed-proof" });
    markRecipe("unsubscribe");
    await page.close();
  });

  await t.test("teleprompter proves countdown, exact speed steps, saved speed, and remote key", async () => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const base = clone(CONTRACT["GET marketing/shoot"].example.response);
    const scripts = base.shoot.scripts.map((script) => ({ ...clone(script), got_it: true }));
    scripts[0] = { ...scripts[0], got_it: false, title: "Proof Script", angle_name: "Proof Script", take_file_name: "Proof Script Take 1.mp4" };
    const shoot = { ...base, shoot: { ...base.shoot, scripts, root_script_ids: scripts.map((script) => script.root_script_id) } };
    await page.addInitScript(() => {
      localStorage.setItem("fh_token", "proof-token");
      localStorage.setItem("fhtp.settings", JSON.stringify({ countdown: true }));
    });
    await page.route("**/api/**", async (route) => {
      const req = route.request(); const p = new URL(req.url()).pathname;
      if (req.method() === "GET" && p === "/api/marketing/shoot") return json(route, shoot);
      if (req.method() === "GET" && p === "/api/marketing/health") return json(route, { ok: true, outbox: { held_reason: null, token_present: true } });
      return json(route, { ok: false }, 404);
    });
    await page.goto(`${origin}/app/teleprompter.html?k=film-key-proof`);
    await page.waitForFunction(() => document.querySelector("#s-title").textContent.includes("Proof Script"));
    const remote = page.locator('a[href="teleprompter-remote.html?k=film-key-proof"]');
    assert.equal(await remote.isVisible(), true);
    assert.match(compact(await remote.innerText()), /Remote/i);
    mark(cases("teleprompter").find((entry) => entry.control.includes("'Remote' link")));

    const before = await page.evaluate(() => window.__fhtp.state().wpm);
    await page.locator("#wpm-up").click();
    assert.equal(await page.evaluate(() => window.__fhtp.state().wpm), before + 5);
    await page.locator("#wpm-down").click();
    assert.equal(await page.evaluate(() => window.__fhtp.state().wpm), before);
    assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem("fhtp.wpm"))), before);
    mark(cases("teleprompter").find((entry) => entry.control.startsWith("Speed minus")));

    await page.locator("#play").click();
    assert.equal(await page.locator("#count").isVisible(), true);
    assert.equal(compact(await page.locator("#count").innerText()), "3");
    await page.waitForFunction(() => document.querySelector("#play").textContent.trim() === "Pause", null, { timeout: 5_000 });
    await page.locator("#play").click();
    assert.equal(compact(await page.locator("#play").innerText()), "Play");
    await page.close();
  });

  assert.deepEqual([...exercised].sort(), [...DISPLAY_CONTRACTS_EF_PUBLIC_2_ROW_KEYS].sort());
});
