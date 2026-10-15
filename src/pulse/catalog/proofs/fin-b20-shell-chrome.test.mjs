// Finish-853 batch 20: the staff shell's account chip, search, sign out, photo and status chip. The real
// public/app/shell.js runs in a real Chromium; /api is answered by the test with fake people and fake
// numbers; every other address is blocked. Nothing is saved anywhere real.

import assert from "node:assert/strict";
import test, { before, after } from "node:test";

import { openLab, makePage, callsTo, until, TOKEN } from "./fin-b20-browser-kit.mjs";

let lab;
before(async () => { lab = await openLab(); });
after(async () => { await lab.close(); });

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

async function open(page, path = "/app/sales-floor.html") {
  await page.goto(`${lab.origin}${path}`, { waitUntil: "domcontentloaded" });
  await page.locator("#fh-shell-chip").waitFor({ state: "attached", timeout: 20_000 });
}

const words = (scope, selector) => scope.locator(selector).first().evaluate((el) => {
  const parts = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) parts.push(walker.currentNode.nodeValue);
  return parts.join(" ").replace(/\s+/g, " ").trim();
});

// ---------------------------------------------------------------------------------------------
// Search
const HITS = {
  // keys on purpose out of the shell's order: the shell decides the order
  cards: [{ href: "pipeline.html?card=k-1", title: "Casey card", subtitle: "Sales · Closed Won" }],
  conversations: [{ href: "messaging.html?c=m-1", title: "Casey thread", subtitle: "sms · 2 days ago" }],
  clients: [{ href: "client-control-panel.html?id=client-proof-1", title: "Casey Search Proof", subtitle: "Fake client · proof-001" }],
  contracts: [{ href: "contracts.html?id=k-9", title: "Casey agreement", subtitle: "Signed" }],
};

test("search: the typed term is what is asked for, groups come back in the shell's order with counts, a hit opens its page", { timeout: 90_000 }, async () => {
  const page = await makePage(lab, {
    api: (call) => {
      if (call.path !== "/api/read/search") return undefined;
      if (call.query.q === "Casey") return { ok: true, groups: HITS };
      return { ok: true, groups: {} };
    },
  });
  await open(page);
  const btn = page.locator("#fh-shell-search-btn");
  assert.equal(await btn.isVisible(), true);
  const overlay = page.locator("#fh-shell-search-overlay");
  assert.equal(await overlay.isVisible(), false);
  await btn.click();
  assert.equal(await overlay.isVisible(), true);
  assert.equal(await words(page, "#fh-shell-search-results"), "Type a name, email, phone, or anything else you remember.");
  assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), "fh-shell-search-input", "the box has the cursor");

  await page.locator("#fh-shell-search-input").fill("Casey");
  await page.locator(".fh-search-hit").first().waitFor({ state: "visible" });
  const asked = callsTo(page, "/api/read/search");
  assert.equal(asked.length, 1, "one read for one typed word");
  assert.equal(asked[0].query.q, "Casey");
  assert.equal(asked[0].headers.authorization, `Bearer ${TOKEN}`);
  const order = await page.locator(".fh-search-group").evaluateAll((els) => els.map((e) => [e.getAttribute("data-group"), e.querySelector(".fh-search-ghead").textContent.replace(/\s+/g, " ").trim()]));
  assert.deepEqual(order, [
    ["clients", "Clients 1"], ["contracts", "Contracts 1"], ["conversations", "Conversations 1"], ["cards", "Pipeline 1"],
  ]);
  const hit = page.locator('.fh-search-hit[href="client-control-panel.html?id=client-proof-1"]');
  assert.equal(await words(hit, ".fh-search-title"), "Casey Search Proof");
  assert.equal(await words(hit, ".fh-search-sub"), "Fake client · proof-001");
  await hit.click();
  await page.waitForURL((u) => u.pathname === "/app/client-control-panel.html" && u.searchParams.get("id") === "client-proof-1");
  await page.close();
});

test("search: no match, signed out and a server error each say so in words; clearing the box shows the hint", { timeout: 90_000 }, async () => {
  let mode = "empty";
  const page = await makePage(lab, {
    api: (call) => {
      if (call.path !== "/api/read/search") return undefined;
      if (mode === "empty") return { ok: true, groups: {} };
      if (mode === "unauthorized") return { status: 401, body: { ok: false, error: "unauthorized" } };
      return { status: 500, body: { ok: false, error: "internal_error" } };
    },
  });
  await open(page);
  await page.locator("#fh-shell-search-btn").click();
  const input = page.locator("#fh-shell-search-input");
  const results = "#fh-shell-search-results";

  await input.fill("zzz");
  await until(async () => (await words(page, results)) === "No matches for “zzz”.", { message: "the no-match line" });
  mode = "unauthorized";
  await input.fill("zzz2");
  await until(async () => (await words(page, results)) === "Not signed in — search needs a real session.", { message: "the signed-out line" });
  mode = "error";
  await input.fill("zzz3");
  await until(async () => (await words(page, results)) === "Search could not run. Try again in a moment.", { message: "the error line" });
  await input.fill("   ");
  await until(async () => (await words(page, results)) === "Type a name, email, phone, or anything else you remember.", { message: "the hint again" });
  await page.close();
});

test("search: Ctrl+K opens and closes it, Escape and a click on the backdrop close it, an old answer never replaces a newer one", { timeout: 90_000 }, async () => {
  let release;
  const page = await makePage(lab, {
    api: (call) => {
      if (call.path !== "/api/read/search") return undefined;
      if (call.query.q === "first") return new Promise((resolve) => { release = () => resolve({ ok: true, groups: { clients: [{ href: "#", title: "OLD ANSWER", subtitle: "" }] } }); });
      return { ok: true, groups: { clients: [{ href: "#", title: "NEW ANSWER", subtitle: "" }] } };
    },
  });
  await open(page);
  const overlay = page.locator("#fh-shell-search-overlay");
  await page.keyboard.press("Control+k");
  assert.equal(await overlay.isVisible(), true);
  await page.keyboard.press("Control+k");
  assert.equal(await overlay.isVisible(), false, "the same chord closes it");
  await page.keyboard.press("Control+k");
  await page.keyboard.press("Escape");
  assert.equal(await overlay.isVisible(), false);
  await page.keyboard.press("Control+k");
  await page.mouse.click(5, 5);                                           // the dark backdrop
  assert.equal(await overlay.isVisible(), false);

  await page.keyboard.press("Control+k");
  await page.locator("#fh-shell-search-input").fill("first");
  await until(() => callsTo(page, "/api/read/search").some((c) => c.query.q === "first"), { message: "the first read to be asked" });
  await page.locator("#fh-shell-search-input").fill("second");
  await page.locator(".fh-search-title", { hasText: "NEW ANSWER" }).waitFor();
  release();
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(await page.locator(".fh-search-title").count(), 1);
  assert.equal(await words(page, ".fh-search-title"), "NEW ANSWER", "the late first answer is dropped");
  await page.close();
});

test("search: a client, an affiliate and a partner are not offered it", { timeout: 90_000 }, async () => {
  for (const [role, path] of [["client", "/app/client-portal.html"], ["partner", "/app/partner-galaxy.html"], ["affiliate", "/app/affiliate.html"]]) {
    const page = await makePage(lab, { role });
    await open(page, path);
    assert.equal(await page.locator("#fh-shell-search-btn").count(), 0, `${role} has no search button`);
    assert.equal(await page.locator("#fh-shell-search-overlay").count(), 0);
    await page.close();
  }
});

// ---------------------------------------------------------------------------------------------
// Sign out
test("sign out: the server is told first with the saved token, then the token and role are gone and the staff sign-in opens", { timeout: 60_000 }, async () => {
  const page = await makePage(lab);
  await open(page);
  assert.equal(await page.locator("#fh-shell-out").innerText(), "Sign out");
  await page.locator("#fh-shell-out").click();
  await page.waitForURL((u) => u.pathname === "/login.html");
  const logout = callsTo(page, "/api/auth/logout", "POST");
  assert.equal(logout.length, 1);
  assert.equal(logout[0].headers.authorization, `Bearer ${TOKEN}`);
  const kept = await page.evaluate(() => ({ token: localStorage.getItem("fh_token"), role: localStorage.getItem("fh_role"), demo: localStorage.getItem("fh_demo") }));
  assert.deepEqual(kept, { token: null, role: null, demo: null });
  await page.close();
});

test("sign out: a server that never answers does not strand the person, and a client goes to the portal sign-in", { timeout: 60_000 }, async () => {
  const slow = await makePage(lab, { api: (call) => (call.path === "/api/auth/logout" ? { hold: true } : undefined) });
  await open(slow);
  await slow.locator("#fh-shell-out").click();
  await slow.waitForURL((u) => u.pathname === "/login.html", { timeout: 10_000 });
  assert.equal(await slow.evaluate(() => localStorage.getItem("fh_token")), null, "the token is cleared even though the server never replied");
  await slow.close();

  const client = await makePage(lab, { role: "client" });
  await open(client, "/app/client-portal.html");
  await client.locator("#fh-shell-out").click();
  await client.waitForURL((u) => u.pathname === "/portal-login.html");
  assert.equal(callsTo(client, "/api/auth/logout", "POST").length, 1);
  await client.close();

  const none = await makePage(lab, { token: "" });
  await none.goto(`${lab.origin}/app/sales-floor.html`, { waitUntil: "domcontentloaded" });
  await none.waitForURL((u) => u.pathname === "/login.html" || u.pathname === "/app/sales-floor.html", { timeout: 10_000 });
  await none.close();
});

// ---------------------------------------------------------------------------------------------
// Photo
test("photo: the picked picture is sent as the 'photo' field with the saved token, then the chip shows the saved photo", { timeout: 60_000 }, async () => {
  let saved = false;
  const page = await makePage(lab, {
    session: () => ({ body: { ok: true, staff: { id: "staff-proof", name: "Casey Proof", role: "owner", org_id: "org-proof", status: "active", avatarUrl: saved ? "/api/staff/avatar" : null } } }),
    api: (call) => {
      if (call.path === "/api/staff/avatar" && call.method === "POST") { saved = true; return { ok: true, avatarUrl: "/api/staff/avatar" }; }
      return undefined;
    },
  });
  await open(page);
  const avatar = page.locator("#fh-shell-avatar");
  assert.equal(await avatar.evaluate((el) => el.tagName), "BUTTON", "no photo yet: a small plus");
  assert.equal(await avatar.getAttribute("aria-label"), "Add your photo");
  const input = page.locator('#fh-shell-chip input[type="file"]');
  assert.equal(await input.getAttribute("accept"), "image/png,image/jpeg");
  await input.setInputFiles({ name: "me.png", mimeType: "image/png", buffer: PNG });
  await page.locator("img#fh-shell-avatar").waitFor({ timeout: 10_000 });
  const posts = callsTo(page, "/api/staff/avatar", "POST");
  assert.equal(posts.length, 1);
  assert.equal(posts[0].headers.authorization, `Bearer ${TOKEN}`);
  assert.match(posts[0].contentType, /^multipart\/form-data; boundary=/);
  assert.match(posts[0].body, /name="photo"; filename="me\.png"/);
  const src = await page.locator("img#fh-shell-avatar").getAttribute("src");
  assert.match(src, /^\/api\/staff\/avatar\?v=\d+$/);
  assert.equal(await page.locator("img#fh-shell-avatar").getAttribute("alt"), "Your photo");
  await page.close();
});

test("photo: a refused picture shows the server's reason for a few seconds and leaves the plus; a demo session is told to sign in", { timeout: 60_000 }, async () => {
  const page = await makePage(lab, {
    api: (call) => (call.path === "/api/staff/avatar" && call.method === "POST"
      ? { status: 400, body: { ok: false, error: "invalid_file_type", message: "only jpg and png photos are accepted (declared type: image/gif)" } }
      : undefined),
  });
  await open(page);
  await page.locator('#fh-shell-chip input[type="file"]').setInputFiles({ name: "me.gif", mimeType: "image/gif", buffer: PNG });
  await page.locator("#fh-shell-avatar-err").waitFor({ state: "visible", timeout: 10_000 });
  assert.equal(await page.locator("#fh-shell-avatar-err").innerText(), "only jpg and png photos are accepted (declared type: image/gif)");
  assert.equal(await page.locator("#fh-shell-avatar").evaluate((el) => el.tagName), "BUTTON", "still no photo");
  assert.equal(callsTo(page, "/api/staff/avatar", "GET").length, 0);
  await page.close();

  const demo = await makePage(lab, {
    token: "", hint: "owner",
    session: () => ({ status: 401, body: { ok: false } }),
    storage: { fh_demo_staff: JSON.stringify({ id: "demo-1", name: "Demo Owner", role: "owner", status: "active" }) },
  });
  await open(demo);
  await demo.locator("#fh-shell-avatar").click();
  await demo.locator("#fh-shell-avatar-err").waitFor({ state: "visible" });
  assert.equal(await demo.locator("#fh-shell-avatar-err").innerText(), "Demo session — sign in for real to add a photo.");
  assert.equal(callsTo(demo, "/api/staff/avatar").length, 0, "nothing is sent for a demo session");
  await demo.close();
});

test("photo: a client, an affiliate and a partner have no photo control, a person on staff does", { timeout: 90_000 }, async () => {
  for (const [role, path] of [["client", "/app/client-portal.html"], ["partner", "/app/partner-galaxy.html"], ["affiliate", "/app/affiliate.html"]]) {
    const page = await makePage(lab, { role });
    await open(page, path);
    assert.equal(await page.locator("#fh-shell-avatar").count(), 0, `${role}: no photo control`);
    await page.close();
  }
  const staff = await makePage(lab, { role: "closer" });
  await open(staff, "/app/closer-dashboard.html");
  assert.equal(await staff.locator("#fh-shell-avatar").count(), 1);
  await staff.close();
});

// ---------------------------------------------------------------------------------------------
// The chip: who, role, backend word, hide and show; the status word
test("account chip: name and role, the backend word, hide with the x and bring it back with 'account', kept across a reload", { timeout: 90_000 }, async () => {
  const page = await makePage(lab, { role: "closer", staff: { name: "Riley Chen" } });
  await open(page, "/app/closer-dashboard.html");
  assert.equal(await words(page, '#fh-shell-chip span[title^="role closer"]'), "Riley Chen · closer");
  assert.equal(await page.locator("#fh-shell-out").innerText(), "Sign out");
  await until(async () => (await page.locator("#fh-shell-src").innerText()) === "LIVE", { message: "the backend word" });
  assert.match(await page.locator("#fh-shell-src").getAttribute("title"), /^7 migrations applied$/);

  const chip = page.locator("#fh-shell-chip");
  const show = page.locator("#fh-shell-chip-show");
  assert.equal(await chip.isVisible(), true);
  assert.equal(await show.isVisible(), false);
  await page.locator("#fh-shell-chip-hide").click();
  assert.equal(await chip.isVisible(), false);
  assert.equal(await show.isVisible(), true);
  assert.equal(await show.innerText(), "account");
  assert.equal(await page.evaluate(() => localStorage.getItem("fh_chip_hidden")), "1");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator("#fh-shell-chip-show").waitFor({ state: "attached" });
  assert.equal(await page.locator("#fh-shell-chip").isVisible(), false, "still hidden after a reload");
  await page.locator("#fh-shell-chip-show").click();
  assert.equal(await page.locator("#fh-shell-chip").isVisible(), true);
  assert.equal(await page.locator("#fh-shell-chip-show").isVisible(), false);
  assert.equal(await page.evaluate(() => localStorage.getItem("fh_chip_hidden")), null);
  await page.close();

  const odd = await makePage(lab, { role: "wizard", staff: { name: "Wes Wizard" } });
  await open(odd, "/app/pipeline.html");
  assert.match(await words(odd, "#fh-shell-chip"), /Wes Wizard · wizard \?/, "an unknown role is marked with a question mark");
  await odd.close();
});

test("status chip: LIVE with the migration count, NO DB with the server's words, NO API when the answer is missing, DEMO for a demo session", { timeout: 120_000 }, async () => {
  const cases = [
    { name: "up", health: { body: { ok: true, db: "up", migrations: 12 } }, word: "LIVE", title: "12 migrations applied" },
    { name: "database down", health: { status: 503, body: { ok: false, db: "down", message: "The database is not reachable right now." } }, word: "NO DB", title: "The database is not reachable right now." },
    { name: "function missing", health: { status: 404, body: { error: "not found" } }, word: "NO API", title: "/api/* is not deployed" },
    { name: "not json", health: { raw: "<html>bad gateway</html>" }, word: "NO API", title: "/api/health did not return JSON" },
    { name: "unreachable", health: { abort: true }, word: "NO API", title: "/api/health unreachable" },
  ];
  for (const c of cases) {
    const page = await makePage(lab, { health: () => c.health });
    await open(page);
    await until(async () => (await page.locator("#fh-shell-src").innerText()) !== "···", { message: `${c.name}: the word` });
    assert.equal(await page.locator("#fh-shell-src").innerText(), c.word, c.name);
    assert.equal(await page.locator("#fh-shell-src").getAttribute("title"), c.title, c.name);
    await page.close();
  }
  const demo = await makePage(lab, {
    token: "", hint: "owner", session: () => ({ status: 401, body: { ok: false } }),
    storage: { fh_demo_staff: JSON.stringify({ id: "demo-1", name: "Demo Owner", role: "owner", status: "active" }) },
  });
  await open(demo);
  await until(async () => (await demo.locator("#fh-shell-src").innerText()) === "DEMO", { message: "the demo word" });
  assert.match(await demo.locator("#fh-shell-src").getAttribute("title"), /^demo session — screens show built-in sample data\./);
  await demo.close();
});
