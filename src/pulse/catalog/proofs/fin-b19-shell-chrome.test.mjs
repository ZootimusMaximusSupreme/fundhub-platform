// Batch 19 practice tests: the shared staff chrome drawn by public/app/shell.js (account chip, search,
// role gate, brand paint, beta banner, sidebar logo and collapse). A real page in Chromium with a fake
// session and fake /api answers (no live data), one action at a time, and a judgement of the request the
// page makes and what it paints. Rows come from fin-b19-rows.json.

import assert from "node:assert/strict";
import test from "node:test";

import { STAFF, proofRows, sharedLab, waitFor } from "./fin-b19-kit.mjs";

const proof = proofRows(import.meta.url);
const lab = sharedLab();

const PAGE = "/app/sales-floor.html";
const never = () => new Promise(() => {});
const ready = async (page) => {
  await page.locator('#side[data-fh-wired="1"]').waitFor({ state: "attached" });
  await page.locator("#fh-shell-chip").waitFor({ state: "attached" });
  await page.waitForFunction(() => !document.getElementById("fh-gate-style"), null, { polling: 100, timeout: 30_000 });
};
const go = async (page, path = PAGE) => {
  await page.goto(`${lab.origin}${path}`, { waitUntil: "domcontentloaded" });
  await ready(page);
};

const openAccount = async (page, { technical = false } = {}) => {
  const account = page.locator("#fh-shell-chip");
  if (await account.evaluate((node) => node.tagName === "DETAILS")) {
    if (!(await account.evaluate((node) => node.open))) await account.locator("summary").first().click();
    if (technical) {
      const diagnostics = page.locator("#fh-shell-account-diagnostics");
      if (await diagnostics.count() && !(await diagnostics.evaluate((node) => node.open))) {
        await diagnostics.locator("summary").click();
      }
    }
    return;
  }
  if (await account.isHidden()) await page.locator("#fh-shell-chip-show").click();
};
const store = (page, key) => page.evaluate((k) => localStorage.getItem(k), key);
// A 1 pixel PNG, so the upload is a real image with the PNG signature.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

test("the badge names what is answering: LIVE, NO DB, NO API, or DEMO, in its own colour, for every answer the health read can give", { timeout: 180_000 }, async () => {
  await proof.check(/^Account chip: backend badge/, async () => {
    // The three tones the chip uses (TONE in public/app/shell.js): mint is real data, peach is an API with no
    // database, rose is no API at all. The label and the colour are both read off the screen.
    const MINT = "rgb(168, 216, 176)";
    const PEACH = "rgb(245, 206, 143)";
    const ROSE = "rgb(242, 166, 155)";
    const TEXT = "rgb(13, 17, 19)";
    const read = async (page) => page.evaluate(() => {
      const el = document.querySelector("#fh-shell-src");
      const style = getComputedStyle(el);
      return { label: el.textContent, title: el.getAttribute("title"), background: style.backgroundColor, color: style.color };
    });
    const settled = (page, label) => page.waitForFunction((want) => document.querySelector("#fh-shell-src")?.textContent === want, label);

    // Answers /api/health can give: [name, answer, label, hint pattern, colour]
    const cases = [
      ["live", { status: 200, body: { ok: true, db: "up", migrations: 212 } }, "LIVE", /^212 migrations applied$/, MINT],
      ["no database", { status: 200, body: { ok: false, db: "down", message: "The database is not reachable right now." } }, "NO DB", /database is not reachable/, PEACH],
      // The database answers and the code expects migrations that are not there: ok is false with the database up.
      // The badge must NOT say LIVE: the screens read a schema that is behind.
      ["database up but behind its migrations", { status: 200, body: { ok: false, db: "up", state: "behind", migrations: 209, expected: 212, pending: 3, error: "database is behind: 209 of 212 migrations applied, 3 pending" } }, "NO DB", /./, PEACH],
      ["ok but the database is down", { status: 200, body: { ok: true, db: "down" } }, "NO DB", /./, PEACH],
      ["no api", { status: 404, body: { ok: false, error: "not_found" } }, "NO API", /\/api\/\* is not deployed/, ROSE],
    ];
    for (const [name, health, label, hint, background] of cases) {
      const page = await lab.open({ api: (request, url) => (url.pathname === "/api/health" ? health : undefined) });
      await go(page);
      await openAccount(page, { technical: true });
      await settled(page, label);
      const got = await read(page);
      assert.equal(got.label, label, name);
      assert.match(got.title, hint, name);
      assert.equal(got.background, background, `${name}: the badge colour`);
      assert.equal(got.color, TEXT, `${name}: the badge text colour`);
      await page.close();
    }

    // The health door cannot be reached at all, or answers something that is not JSON: NO API, never LIVE.
    const unreachable = await lab.open();
    await unreachable.route("**/api/health", (route) => route.abort());
    await go(unreachable);
    await openAccount(unreachable, { technical: true });
    await settled(unreachable, "NO API");
    const gone = await read(unreachable);
    assert.equal(gone.title, "/api/health unreachable");
    assert.equal(gone.background, ROSE);
    await unreachable.close();

    const notJson = await lab.open();
    await notJson.route("**/api/health", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<html>maintenance</html>" }));
    await go(notJson);
    await openAccount(notJson, { technical: true });
    await settled(notJson, "NO API");
    const html = await read(notJson);
    assert.equal(html.title, "/api/health did not return JSON");
    assert.equal(html.background, ROSE);
    await notJson.close();

    // A demo login (no real session, a stored demo person) always says DEMO, even when the backend is up:
    // its screens are sample data whatever the server says. The colour is the NO DB one, not the LIVE one:
    // a demo screen must not wear the colour of real data.
    for (const [name, health, background] of [
      ["backend up", { ok: true, db: "up", migrations: 3 }, PEACH],
      ["backend down", { ok: false, db: "down" }, PEACH],
    ]) {
      const demo = await lab.open({
        session: null,
        storage: { fh_demo_staff: JSON.stringify({ ...STAFF, role: "owner" }), fh_demo: "1" },
        api: (request, url) => (url.pathname === "/api/health" ? health : undefined),
      });
      await go(demo);
      await openAccount(demo, { technical: true });
      await settled(demo, "DEMO");
      const got = await read(demo);
      assert.match(got.title, /^Sample session\./, name);
      assert.equal(got.background, background, `${name}: DEMO is not drawn in the LIVE colour`);
      assert.notEqual(got.background, MINT, name);
      await demo.close();
    }
    // A demo login with no API at all keeps the rose of the missing API, and still says DEMO.
    const demoOffline = await lab.open({
      session: null,
      storage: { fh_demo_staff: JSON.stringify({ ...STAFF, role: "owner" }), fh_demo: "1" },
      api: (request, url) => (url.pathname === "/api/health" ? { status: 404, body: { ok: false } } : undefined),
    });
    await go(demoOffline);
    await openAccount(demoOffline, { technical: true });
    await settled(demoOffline, "DEMO");
    assert.equal((await read(demoOffline)).background, ROSE);
    await demoOffline.close();
  });
});

test("Sign out tells the server first, then wipes this browser and lands on the right sign-in page", { timeout: 120_000 }, async () => {
  await proof.check(/^Account chip: Sign out/, async () => {
    const page = await lab.open({ storage: { fh_client: "client-123", fh_demo: "1", fh_demo_staff: "{}" } });
    await go(page);
    assert.equal(await store(page, "fh_token"), "fake-token");
    await openAccount(page);
    await page.locator("#fh-shell-out").click();
    await page.waitForURL((url) => url.pathname === "/login.html");
    const logout = page.apiCalls.filter((c) => c.path === "/api/auth/logout");
    assert.equal(logout.length, 1, "exactly one logout request");
    assert.equal(logout[0].method, "POST");
    assert.equal(logout[0].bearer, "Bearer fake-token", "the server is told which session to revoke");
    for (const key of ["fh_token", "fh_role", "fh_demo", "fh_demo_staff", "fh_client"]) {
      assert.equal(await store(page, key), null, `${key} is wiped`);
    }
    await page.close();

    // A slow or dead server never strands the person on a shared machine: it still signs out.
    const slow = await lab.open({ api: (request, url) => (url.pathname === "/api/auth/logout" ? never() : undefined) });
    await go(slow);
    await openAccount(slow);
    await slow.locator("#fh-shell-out").click();
    await slow.waitForURL((url) => url.pathname === "/login.html", { timeout: 15_000 });
    assert.equal(await store(slow, "fh_token"), null);
    await slow.close();

    // A client signs out from their own portal to the client's sign-in page, not the staff password form.
    const client = await lab.open({ role: "client", staff: { role: "client" } });
    await client.goto(`${lab.origin}/app/client-portal.html`, { waitUntil: "domcontentloaded" });
    await client.locator("#fh-shell-out").waitFor({ state: "attached" });
    await openAccount(client);
    await client.locator("#fh-shell-out").click();
    await client.waitForURL((url) => url.pathname === "/portal-login.html");
    await client.close();
  });
});

test("the account summary opens the real menu, Escape closes it, and Sign out stays reachable", { timeout: 120_000 }, async () => {
  await proof.check(/^Account chip: x hide the bar/, async () => {
    const page = await lab.open();
    await go(page);
    const account = page.locator("#fh-shell-chip");
    const summary = page.locator("#fh-shell-chip-show");
    assert.equal(await account.evaluate((node) => node.tagName), "DETAILS");
    assert.equal(await account.evaluate((node) => node.open), false);
    assert.match((await summary.innerText()).trim(), /Casey/);
    assert.equal(await page.locator("#fh-shell-out").isVisible(), false);
    await summary.click();
    assert.equal(await account.evaluate((node) => node.open), true);
    assert.equal(await page.locator("#fh-shell-out").isVisible(), true, "Sign out is one account-menu click away");
    await page.keyboard.press("Escape");
    assert.equal(await account.evaluate((node) => node.open), false);
    assert.equal(await page.evaluate(() => document.activeElement?.id), "fh-shell-chip-show");
    await page.reload({ waitUntil: "domcontentloaded" });
    await ready(page);
    assert.equal(await account.evaluate((node) => node.open), false, "the menu starts closed after a reload");
    await summary.click();
    assert.equal(await page.locator("#fh-shell-out").isVisible(), true);
    assert.equal(await store(page, "fh_chip_hidden"), null, "the retired floating-bar preference is not written");
    await page.close();
  });
});

test("the photo control sends the picked image as the photo field, then shows what the session says", { timeout: 120_000 }, async () => {
  await proof.check(/^Account chip: add or change your photo/, async () => {
    let uploaded = false;
    const page = await lab.open({
      session: () => ({ ok: true, staff: { ...STAFF, role: "owner", ...(uploaded ? { avatarUrl: "/api/staff/avatar" } : {}) } }),
      api: (request, url) => {
        if (request.method() === "POST" && url.pathname === "/api/staff/avatar") {
          uploaded = true;
          return { ok: true, avatarUrl: "/api/staff/avatar" };
        }
        return undefined;
      },
    });
    await go(page);
    await openAccount(page);
    const avatar = page.locator("#fh-shell-avatar");
    assert.equal(await avatar.evaluate((el) => el.tagName), "BUTTON", "no photo yet: a plus button");
    assert.equal(await page.locator('#fh-shell-chip input[type="file"]').getAttribute("accept"), "image/png,image/jpeg");
    const chooser = page.waitForEvent("filechooser");
    await avatar.click();
    await (await chooser).setFiles({ name: "me.png", mimeType: "image/png", buffer: PNG });
    await waitFor(() => page.apiCalls.some((c) => c.method === "POST" && c.path === "/api/staff/avatar"), "the photo upload");
    const post = page.apiCalls.find((c) => c.method === "POST" && c.path === "/api/staff/avatar");
    assert.equal(post.bearer, "Bearer fake-token");
    assert.match(post.contentType, /^multipart\/form-data; boundary=/, "multipart, boundary written by the browser");
    assert.match(post.raw, /name="photo"; filename="me\.png"/, "the field is named photo");
    assert.match(post.raw, /\x89PNG/, "the image bytes are the file's");
    // The chip shows what the session now reports, not only what the POST said.
    await page.waitForFunction(() => document.querySelector("#fh-shell-avatar")?.tagName === "IMG");
    assert.match(await avatar.getAttribute("src"), /^\/api\/staff\/avatar\?v=\d+$/);
    assert.equal(page.apiCalls.filter((c) => c.path === "/api/auth/session").length >= 2, true, "the session is read again after the upload");
    await page.close();

    // A refused photo says why, in a bubble, and keeps the plus.
    const refused = await lab.open({
      api: (request, url) => (request.method() === "POST" && url.pathname === "/api/staff/avatar"
        ? { status: 400, body: { ok: false, error: "invalid_file_type", message: "only jpg and png photos are accepted" } }
        : undefined),
    });
    await go(refused);
    await openAccount(refused);
    const chooser2 = refused.waitForEvent("filechooser");
    await refused.locator("#fh-shell-avatar").click();
    await (await chooser2).setFiles({ name: "me.png", mimeType: "image/png", buffer: PNG });
    await refused.waitForSelector("#fh-shell-avatar-err", { state: "visible" });
    assert.equal(await refused.locator("#fh-shell-avatar-err").innerText(), "only jpg and png photos are accepted");
    assert.equal(await refused.locator("#fh-shell-avatar").evaluate((el) => el.tagName), "BUTTON");
    await refused.close();

    // A demo login has no staff row to hang a photo on: it says so and opens no picker.
    const demo = await lab.open({ session: null, storage: { fh_demo_staff: JSON.stringify({ ...STAFF, role: "owner" }) } });
    await go(demo);
    await openAccount(demo);
    await demo.locator("#fh-shell-avatar").click();
    await demo.waitForSelector("#fh-shell-avatar-err", { state: "visible" });
    assert.match(await demo.locator("#fh-shell-avatar-err").innerText(), /^Demo session — sign in for real to add a photo\./);
    assert.equal(demo.apiCalls.some((c) => c.path === "/api/staff/avatar"), false, "nothing is sent");
    await demo.close();
  });
});

test("the beta banner is not drawn today, and when a page is listed it shows for the owner only and Dismiss removes it", { timeout: 120_000 }, async () => {
  await proof.check(/^Beta banner with Dismiss/, async () => {
    // The shipped list is empty: no page, for any role, draws the banner or a BETA badge.
    for (const role of ["owner", "admin", "sales_manager"]) {
      const page = await lab.open({ role });
      await go(page);
      assert.equal(await page.locator("#fh-beta-banner").count(), 0, `${role}: no banner on the shipped pages`);
      assert.equal(await page.locator(".beta-badge").count(), 0, `${role}: no BETA badge on any nav row`);
      await page.close();
    }
    // The same file with the list naming this page: the banner is the owner's, and Dismiss removes it.
    const patch = { "/app/shell.js": (text) => {
      assert.match(text, /var BETA_PAGES = \[\];/, "the shipped list is empty");
      return text.replace("var BETA_PAGES = [];", 'var BETA_PAGES = ["sales-floor.html"];');
    } };
    const owner = await lab.open({ role: "owner", patch });
    await go(owner);
    const banner = owner.locator("#fh-beta-banner");
    await banner.waitFor({ state: "visible" });
    assert.match(await banner.innerText(), /^Beta — under development\. Data may be incomplete or inaccurate\. Do not use for client decisions\./);
    assert.equal(await owner.locator('a.navitem[href="sales-floor.html"] .beta-badge').innerText(), "BETA", "the nav row carries the badge");
    await owner.locator("[data-fh-beta-dismiss]").click();
    assert.equal(await owner.locator("#fh-beta-banner").count(), 0, "Dismiss removes it");
    await owner.reload({ waitUntil: "domcontentloaded" });
    await ready(owner);
    assert.equal(await owner.locator("#fh-beta-banner").count(), 1, "it is back when the page is reopened: nothing is stored");
    await owner.close();

    const admin = await lab.open({ role: "admin", patch });
    await go(admin);
    assert.equal(await admin.locator("#fh-beta-banner").count(), 0, "not for an admin");
    await admin.close();
  });
});

test("brand paint sets the company colors, fonts and logo, and refuses any value that is not a plain hex, face or https logo", { timeout: 120_000 }, async () => {
  await proof.check(/^Brand paint/, async () => {
    const brand = {
      ink: "#112233", paper: "#F0F0E0", ramp: ["#111111", "#222222", "#333333", "#444444", "#555555", "#666666"],
      display_face: "Fraunces", mono_face: "IBM Plex Mono", wordmark_url: "https://assets.example.test/logo.svg", entity_name: "Acme Funding",
    };
    // The brand read is for the signed-in person only (api/org-brand.mjs answers 401 without a session token), so
    // the fake answers the way the real door does: no bearer, no brand. A page that stops sending its token paints
    // nothing, and the painted values below are never seen.
    const open = async (b, extra = {}) => {
      const page = await lab.open({
        api: (request, url) => {
          if (url.pathname !== "/api/org-brand") return undefined;
          return request.headers().authorization === "Bearer fake-token" ? { ok: true, brand: b } : { status: 401, body: { ok: false, error: "unauthorized" } };
        },
        ...extra,
      });
      await go(page);
      await waitFor(() => page.apiCalls.some((c) => c.path === "/api/org-brand"), "the brand read");
      return page;
    };
    const fontLink = (page) => page.evaluate(() => document.getElementById("fh-brand-fonts")?.getAttribute("href") ?? null);
    const vars = (page) => page.evaluate(() => {
      const s = document.documentElement.style;
      return Object.fromEntries(["--ink", "--paper", "--spectrum", "--accent", "--sans", "--mono", "--logo"].map((k) => [k, s.getPropertyValue(k)]));
    });

    const good = await open(brand);
    await good.waitForFunction(() => document.documentElement.style.getPropertyValue("--ink") === "#112233");
    const read = good.apiCalls.filter((c) => c.path === "/api/org-brand");
    assert.equal(read.length, 1, "one brand read");
    assert.equal(read[0].method, "GET");
    assert.equal(read[0].bearer, "Bearer fake-token", "the signed-in person's token rides on the brand read");
    const painted = await vars(good);
    assert.equal(painted["--paper"], "#F0F0E0");
    assert.equal(painted["--accent"], "#666666", "the accent is the last ramp stop");
    assert.equal(painted["--spectrum"], "linear-gradient(90deg,#111111 0%,#222222 20%,#333333 40%,#444444 60%,#555555 80%,#666666 100%)");
    assert.match(painted["--sans"], /^'Fraunces', system-ui/);
    assert.match(painted["--mono"], /^'IBM Plex Mono', ui-monospace/);
    assert.equal(painted["--logo"], 'url("https://assets.example.test/logo.svg")');
    assert.equal(await good.locator("#fh-shell-chip").getAttribute("data-brand"), "Acme Funding");
    // The two faces are asked of Google Fonts by name, in one stylesheet link, and nothing else is.
    assert.equal(await fontLink(good), "https://fonts.googleapis.com/css2?family=Fraunces:wght@400;600&family=IBM+Plex+Mono:wght@400;500&display=swap");
    await good.close();

    // The logo is the one value that is free text. An inline image is painted only when it is a base64 image
    // with nothing else in it; every other shape leaves the Fundhub logo, while the plain colours still paint.
    const inline = await open({ ...brand, wordmark_url: "data:image/png;base64,iVBORw0KGgo=" });
    await inline.waitForFunction(() => document.documentElement.style.getPropertyValue("--ink") === "#112233");
    assert.equal((await vars(inline))["--logo"], 'url("data:image/png;base64,iVBORw0KGgo=")', "a base64 image is painted");
    await inline.close();
    for (const refused of ["data:text/html;base64,AAAA", "data:image/png;base64,@@@@", "data:image/png;base64,", "https://",
      "http://assets.example.test/logo.svg", "https://assets.example.test/a b.svg", "https://assets.example.test/a(b).svg"]) {
      const page = await open({ ...brand, wordmark_url: refused });
      await page.waitForFunction(() => document.documentElement.style.getPropertyValue("--ink") === "#112233");
      assert.equal((await vars(page))["--logo"], "", `${refused} is not painted as the logo`);
      assert.equal((await vars(page))["--paper"], "#F0F0E0", "the rest of the brand still paints");
      await page.close();
    }

    // Values that are not plain are never written to the page's styles.
    const bad = await open({
      ink: "red", paper: "url(https://assets.example.test/x)", ramp: ["#111111", "#222222", "#333333", "#444444", "#555555"],
      display_face: "Evil;}", mono_face: "x".repeat(80), wordmark_url: "javascript:alert(1)",
    });
    await bad.waitForTimeout(400);
    assert.deepEqual(await vars(bad), { "--ink": "", "--paper": "", "--spectrum": "", "--accent": "", "--sans": "", "--mono": "", "--logo": "" },
      "an unsafe or short value leaves the Fundhub default in place");
    assert.equal(await fontLink(bad), null, "and no font stylesheet is asked for");
    await bad.close();

    // No brand, or a refused read, leaves the Fundhub default.
    const none = await lab.open({ api: (request, url) => (url.pathname === "/api/org-brand" ? { status: 401, body: { ok: false } } : undefined) });
    await go(none);
    await waitFor(() => none.apiCalls.some((c) => c.path === "/api/org-brand"), "the brand read");
    await none.waitForTimeout(300);
    assert.equal((await vars(none))["--ink"], "");
    await none.close();
  });
});

// Who may open what, pinned. This is the table in public/app/shell.js (ROLE_TABS) as the page itself holds it, read
// out of the real file by exposing the table and allowedFor() to the test, so a changed row is red here and a
// person has to say the change is meant. The three outside principals are "a client must not see the CRM".
const EXPECTED_TABS = {
  owner: "*", admin: "admin", funding_advisor: "funding_advisor", closer: "closer", inquiry_specialist: "staff",
  setter: "staff", sales_manager: "sales_manager", csm: "csm",
  client: ["client-portal.html", "affiliate.html", "financeos.html", "money.html", "money-accounts.html", "money-credit.html",
    "money-connections.html", "money-payments.html", "money-setup.html", "money-plan.html", "money-banks.html", "money-strategy.html",
    "money-fundability.html", "money-next.html", "money-helper.html", "money-transfers.html", "money-declines.html", "money-alerts.html",
    "money-vault.html"],
  affiliate: ["affiliate.html"],
  partner: ["partner-galaxy.html", "brand-studio.html", "social-studio.html", "creative-factory.html", "partner-training.html"],
};
const STAFF_ROLES = ["owner", "admin", "funding_advisor", "closer", "inquiry_specialist", "setter", "sales_manager", "csm"];
const OUTSIDE = ["client", "affiliate", "partner"];
const HOMES = { client: "/app/client-portal.html", affiliate: "/app/affiliate.html", partner: "/app/partner-galaxy.html" };
// Screens of the CRM an outside principal must never be let into.
const CRM_PAGES = ["pipeline.html", "sales-floor.html", "lenders.html", "client-control-panel.html", "staff-teams.html",
  "products-commissions.html", "closer-dashboard.html", "finance-os.html", "ops-admin.html", "hiring.html", "csm-queue.html",
  "messaging.html", "documents.html", "calendar.html", "my-numbers.html", "campaign-manager.html", "contracts.html", "galaxy.html"];

test("the role gate sends a role away from a page it may not open, the session answer wins, and no session goes to sign in", { timeout: 300_000 }, async () => {
  await proof.check(/^Role gate:/, async () => {
    // A cached role that may not open this page is bounced before the session even answers.
    const slowSession = () => never();
    const hinted = await lab.open({ role: "closer", session: slowSession });
    await hinted.goto(`${lab.origin}${PAGE}`, { waitUntil: "commit" });
    await hinted.waitForURL((url) => url.pathname === "/app/closer-dashboard.html", { timeout: 15_000 });
    await hinted.close();

    // The session is the authority: a cached owner whose session says closer is sent to the closer's home,
    // and the cached role is corrected for next time.
    const stale = await lab.open({ role: "owner", session: { ok: true, staff: { ...STAFF, role: "closer" } } });
    await stale.goto(`${lab.origin}${PAGE}`, { waitUntil: "domcontentloaded" });
    await stale.waitForURL((url) => url.pathname === "/app/closer-dashboard.html", { timeout: 15_000 });
    assert.equal(await store(stale, "fh_role"), "closer");
    await stale.close();

    // A role that may open it stays, and the session writes the cache.
    const allowed = await lab.open({ role: "sales_manager", session: { ok: true, staff: { ...STAFF, role: "sales_manager" } } });
    await go(allowed);
    assert.equal(new URL(allowed.url()).pathname, PAGE);
    assert.equal(await store(allowed, "fh_role"), "sales_manager");
    await allowed.close();

    // No session at all: the sign-in page, remembering where to come back to, and the cached role is cleared.
    const signedOut = await lab.open({ role: "owner", session: null });
    await signedOut.goto(`${lab.origin}${PAGE}`, { waitUntil: "domcontentloaded" });
    await signedOut.waitForURL((url) => url.pathname === "/login.html", { timeout: 15_000 });
    assert.equal(new URL(signedOut.url()).searchParams.get("next"), "/app/sales-floor.html");
    assert.equal(await store(signedOut, "fh_role"), null);
    await signedOut.close();

    // The boundary that matters: a client, an affiliate and a partner are each sent back to their own door from a
    // CRM screen, whichever way the gate learns who they are.
    for (const role of OUTSIDE) {
      // 1. By the cached role, before the session answers.
      const byHint = await lab.open({ role, session: slowSession });
      await byHint.goto(`${lab.origin}${PAGE}`, { waitUntil: "commit" });
      await byHint.waitForURL((url) => url.pathname === HOMES[role], { timeout: 15_000 });
      assert.equal(byHint.apiCalls.some((c) => c.path === "/api/read/sales-floor"), false, `${role}: the floor is never asked for`);
      await byHint.close();

      // 2. By the session, when the cached role is a staff one (a shared machine, a stale cache).
      const bySession = await lab.open({ role: "owner", session: { ok: true, staff: { ...STAFF, role } } });
      await bySession.goto(`${lab.origin}${PAGE}`, { waitUntil: "domcontentloaded" });
      await bySession.waitForURL((url) => url.pathname === HOMES[role], { timeout: 15_000 });
      assert.equal(await store(bySession, "fh_role"), role, `${role}: the cache is corrected`);
      await bySession.close();
    }

    // A client with no session goes to the client's own sign-in page, not the staff password form.
    const clientOut = await lab.open({ role: "client", session: null });
    await clientOut.goto(`${lab.origin}/app/client-portal.html`, { waitUntil: "domcontentloaded" });
    await clientOut.waitForURL((url) => url.pathname === "/portal-login.html", { timeout: 15_000 });
    await clientOut.close();

    // The table itself, as the real file holds it: pinned row by row, then the questions that matter asked of
    // allowedFor() for every role. Nothing is copied from the file into the test except the exposure line.
    const expose = { "/app/shell.js": (text) => {
      assert.ok(text.includes("function homeFor(role, ok) {"), "the anchor for exposing the table is still in shell.js");
      return text.replace("function homeFor(role, ok) {", "window.__finRoleTabs = ROLE_TABS; window.__finAllowedFor = allowedFor;\n  function homeFor(role, ok) {");
    } };
    const probe = await lab.open({ role: "owner", patch: expose });
    await go(probe);
    const held = await probe.evaluate((pages) => {
      const tabs = JSON.parse(JSON.stringify(window.__finRoleTabs));
      const open = {};
      for (const role of Object.keys(tabs)) {
        const ok = window.__finAllowedFor(role);
        open[role] = pages.filter((p) => ok.indexOf(p) !== -1);
      }
      const portals = {};
      for (const role of Object.keys(tabs)) {
        const ok = window.__finAllowedFor(role);
        portals[role] = ["client-portal.html", "affiliate.html", "partner-galaxy.html", "brand-studio.html"].filter((p) => ok.indexOf(p) !== -1);
      }
      return { tabs, open, portals };
    }, CRM_PAGES);
    await probe.close();
    assert.deepEqual(held.tabs, EXPECTED_TABS, "ROLE_TABS is exactly the table the owner signed off");
    for (const role of OUTSIDE) assert.deepEqual(held.open[role], [], `${role} may open no CRM screen`);
    // The sales floor is the sales manager's, the owner's and the admin's, and nobody else's.
    assert.deepEqual(STAFF_ROLES.concat(OUTSIDE).filter((r) => held.open[r].includes("sales-floor.html")).sort(), ["admin", "owner", "sales_manager"]);
    // The pipeline is every employee's; the closer desk is every employee's except the outside three.
    for (const role of STAFF_ROLES) assert.ok(held.open[role].includes("pipeline.html"), `${role} opens the pipeline`);
    // The client portal is the owner's (the owner walk) and the client's; the affiliate screen is those two and
    // the affiliate's; partner Home is the owner's and the partner's, and an admin gets none of the three.
    assert.deepEqual(Object.keys(held.portals).filter((r) => held.portals[r].includes("client-portal.html")).sort(), ["client", "owner"]);
    assert.deepEqual(Object.keys(held.portals).filter((r) => held.portals[r].includes("affiliate.html")).sort(), ["affiliate", "client", "owner"]);
    assert.deepEqual(Object.keys(held.portals).filter((r) => held.portals[r].includes("partner-galaxy.html")).sort(), ["owner", "partner"]);
    assert.deepEqual(held.portals.admin, ["brand-studio.html"], "an admin opens no client, affiliate or partner portal");
  });
});

// The five groups the overlay writes, in the order it writes them, with the words on each head.
const SEARCH_GROUPS = [["clients", "Clients"], ["contracts", "Contracts"], ["documents", "Documents"], ["conversations", "Conversations"], ["cards", "Pipeline"]];
const hit = (title, subtitle, href) => ({ title, subtitle, href });
const ANSWER = {
  clients: [hit("Dana Whitfield", "dana@example.com", "/app/client-control-panel.html?client_id=c1")],
  contracts: [hit("Dana Whitfield engagement", "Signed", "/app/contracts.html?id=k1"), hit("Dana Whitfield addendum", "Sent", "/app/contracts.html?id=k2")],
  documents: [hit("Credit report.pdf", "Uploaded", "/app/documents.html?doc=d1")],
  conversations: [hit("Dana Whitfield", "Texts", "/app/messaging.html?c=m1")],
  cards: [hit("Dana Whitfield", "Sales · New Lead", "/app/pipeline.html#fh-card-1")],
};
// Client text is whatever a client typed, so the overlay writes it as text and never as markup.
const HOSTILE = {
  clients: [hit('<img src=x onerror="window.__xss=1">', "a & b <b>bold</b>", '/app/client-control-panel.html?a=1&b="2"')],
};

async function searchOn(page, term) {
  const overlay = page.locator("#fh-shell-search-overlay");
  await page.keyboard.press("Control+k");
  assert.equal(await overlay.isVisible(), true, "Control+K opens it");
  await page.locator("#fh-shell-search-input").fill(term);
  return overlay;
}

test("the search overlay opens from the button and the keyboard, asks the server for the typed words, and shows every group's hits as links", { timeout: 240_000 }, async () => {
  await proof.check(/^Search button and overlay/, async () => {
    const answer = (request, url) => {
      if (url.pathname !== "/api/read/search") return undefined;
      const q = url.searchParams.get("q");
      if (q === "denied") return { status: 403, body: { ok: false, error: "forbidden" } };
      if (q === "boom") return { status: 500, body: { ok: false, error: "query_failed" } };
      if (q === "html") return { ok: true, groups: HOSTILE };
      return { ok: true, groups: q === "dana" ? ANSWER : {} };
    };
    const searches = (page) => page.apiCalls.filter((c) => c.path === "/api/read/search").map((c) => c.query.q);
    const heads = (page) => page.$$eval(".fh-search-ghead", (els) => els.map((e) => e.textContent.replace(/\s+/g, " ").trim()));
    const links = (page) => page.$$eval("a.fh-search-hit", (els) => els.map((e) => [e.getAttribute("href"), e.querySelector(".fh-search-title").textContent, e.querySelector(".fh-search-sub").textContent]));

    // Both ways the overlay can reach the server: through the page's data helper (sales-floor loads it) and, on a
    // screen that does not load it, through its own request (lenders does not). The same words must come out.
    const where = [
      ["a screen with the data helper", "/app/sales-floor.html", true],
      ["a screen without the data helper", "/app/lenders.html", false],
    ];
    for (const [name, path, hasHelper] of where) {
      const page = await lab.open({ api: answer });
      await go(page, path);
      assert.equal(await page.evaluate(() => typeof (window.FHData && window.FHData.search)), hasHelper ? "function" : "undefined", `${name}: which path answers`);
      const overlay = page.locator("#fh-shell-search-overlay");
      const input = page.locator("#fh-shell-search-input");
      assert.equal(await overlay.isHidden(), true);
      await page.locator("#fh-shell-search-btn").click();
      assert.equal(await overlay.isVisible(), true, `${name}: the button opens it`);
      assert.equal(await input.evaluate((el) => el === document.activeElement), true, "and the box has the cursor");
      assert.match(await page.locator("#fh-shell-search-results").innerText(), /^Type a name, email, phone/);
      await input.fill("dana");
      await page.waitForSelector(".fh-search-hit");
      assert.deepEqual(searches(page), ["dana"], `${name}: one request, for the typed words`);
      const sent = page.apiCalls.find((c) => c.path === "/api/read/search");
      assert.equal(sent.method, "GET");
      assert.equal(sent.bearer, "Bearer fake-token", `${name}: the signed-in person's token rides on the search`);
      assert.deepEqual(await heads(page), ["Clients 1", "Contracts 2", "Documents 1", "Conversations 1", "Pipeline 1"], `${name}: five groups, in order, with their counts`);
      assert.deepEqual(
        await links(page),
        SEARCH_GROUPS.flatMap(([key]) => ANSWER[key].map((h) => [h.href, h.title, h.subtitle])),
        `${name}: each hit is a link to where it lives`,
      );
      await page.keyboard.press("Escape");
      assert.equal(await overlay.isHidden(), true, "Escape closes it");
      await page.keyboard.press("Control+k");
      assert.equal(await overlay.isVisible(), true, "Control+K opens it");
      await input.fill("zzz");
      await page.waitForFunction(() => /No matches for/.test(document.querySelector("#fh-shell-search-results").textContent));
      assert.match(await page.locator("#fh-shell-search-results").innerText(), /No matches for “zzz”\./);
      await input.fill("denied");
      await page.waitForFunction(() => /Not signed in/.test(document.querySelector("#fh-shell-search-results").textContent));
      assert.match(await page.locator("#fh-shell-search-results").innerText(), /^Not signed in — search needs a real session\./);
      await input.fill("boom");
      await page.waitForFunction(() => /Search could not run/.test(document.querySelector("#fh-shell-search-results").textContent));
      await page.keyboard.press("Control+k");
      assert.equal(await overlay.isHidden(), true, "Control+K again closes it");

      // What a client typed is shown as text: no tag is built, no handler runs, the address is kept whole.
      await searchOn(page, "html");
      await page.waitForSelector(".fh-search-hit");
      const [[href, title, subtitle]] = await links(page);
      assert.equal(title, '<img src=x onerror="window.__xss=1">', `${name}: the title is written as typed`);
      assert.equal(subtitle, "a & b <b>bold</b>");
      assert.equal(href, '/app/client-control-panel.html?a=1&b="2"', "the address survives its own quote and ampersand");
      assert.equal(await page.locator("#fh-shell-search-results img").count(), 0, "no image was built from a client's text");
      assert.equal(await page.locator("#fh-shell-search-results b").count(), 0);
      assert.equal(await page.evaluate(() => window.__xss), undefined, "and nothing ran");
      await page.close();
    }

    // The three outside roles never get the search button: not a partner, not a client, not an affiliate.
    for (const [role, path] of [["partner", "/app/brand-studio.html"], ["client", "/app/client-portal.html"], ["affiliate", "/app/affiliate.html"]]) {
      const outside = await lab.open({ role, staff: { role } });
      // The portals carry no sidebar, so wait for the chip the shell draws once the session has answered.
      await outside.goto(`${lab.origin}${path}`, { waitUntil: "domcontentloaded" });
      await outside.locator("#fh-shell-chip").waitFor({ state: "attached" });
      assert.equal(await outside.locator("#fh-shell-search-btn").count(), 0, `${role}: no search button`);
      await outside.keyboard.press("Control+k");
      assert.equal(await outside.locator("#fh-shell-search-overlay").count(), 0, `${role}: Control+K opens nothing`);
      await outside.close();
    }
    // Every employee role has it.
    const closer = await lab.open({ role: "closer", staff: { role: "closer" } });
    await go(closer, "/app/closer-dashboard.html");
    assert.equal(await closer.locator("#fh-shell-search-btn").count(), 1, "a closer has the search button");
    await closer.close();
  });
});

test("the sidebar logo goes to the pipeline, and the collapse button folds the rail to icons and back", { timeout: 120_000 }, async () => {
  await proof.check(/^Sidebar logo link/, async () => {
    const page = await lab.open();
    await go(page);
    assert.equal(await page.locator("#side a.logo").getAttribute("href"), "pipeline.html");
    const side = page.locator("#side");
    const burger = page.locator("#burger");
    assert.equal((await burger.innerText()).trim(), "‹");
    assert.equal(await side.evaluate((el) => el.classList.contains("mini")), false);
    await burger.click();
    assert.equal(await side.evaluate((el) => el.classList.contains("mini")), true, "folded to the icon strip");
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains("fh-side-mini")), true);
    assert.equal((await burger.innerText()).trim(), "›");
    assert.equal(await page.locator("#side .navgroup.closed").count(), 0, "every section is open on the icon strip, so no row is lost");
    await burger.click();
    assert.equal(await side.evaluate((el) => el.classList.contains("mini")), false, "and back");
    assert.equal((await burger.innerText()).trim(), "‹");
    await page.locator("#side a.logo").click();
    await page.waitForURL((url) => url.pathname === "/app/pipeline.html");
    await page.close();

    // On a phone the rail is off canvas: the menu button brings it in, the same control closes it, and a
    // destination tapped closes it too.
    const phone = await lab.open({ width: 390, height: 800 });
    await go(phone);
    assert.equal(await phone.locator("#side").evaluate((el) => el.classList.contains("open")), false);
    assert.equal((await phone.locator("#burger").innerText()).trim(), "×");
    await phone.locator("#fh-menu-btn").click();
    assert.equal(await phone.locator("#side").evaluate((el) => el.classList.contains("open")), true, "the menu button opens the drawer");
    await phone.locator("#burger").click();
    assert.equal(await phone.locator("#side").evaluate((el) => el.classList.contains("open")), false, "the collapse button closes the drawer on a phone");
    assert.equal(await phone.locator("#side").evaluate((el) => el.classList.contains("mini")), false, "and does not fold it");
    await phone.close();
  });
});

test("every listed row was exercised", () => {
  proof.assertAllClaimed();
});
