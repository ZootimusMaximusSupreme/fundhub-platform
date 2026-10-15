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
const store = (page, key) => page.evaluate((k) => localStorage.getItem(k), key);
// A 1 pixel PNG, so the upload is a real image with the PNG signature.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

test("the badge names what is answering: LIVE, NO DB, NO API, or DEMO", { timeout: 120_000 }, async () => {
  await proof.check(/^Account chip: backend badge/, async () => {
    const cases = [
      ["live", { status: 200, body: { ok: true, db: "up", migrations: 212 } }, "LIVE", /212 migrations applied/],
      ["no database", { status: 200, body: { ok: false, db: "down", message: "The database is not reachable right now." } }, "NO DB", /database is not reachable/],
      ["no api", { status: 404, body: { ok: false, error: "not_found" } }, "NO API", /\/api\/\* is not deployed/],
    ];
    for (const [name, health, label, hint] of cases) {
      const page = await lab.open({ api: (request, url) => (url.pathname === "/api/health" ? health : undefined) });
      await go(page);
      await page.waitForFunction((want) => document.querySelector("#fh-shell-src")?.textContent === want, label);
      assert.match(await page.locator("#fh-shell-src").getAttribute("title"), hint, name);
      await page.close();
    }
    // A demo login (no real session, a stored demo person) always says DEMO, even when the backend is up:
    // its screens are sample data whatever the server says.
    const demo = await lab.open({
      session: null,
      storage: { fh_demo_staff: JSON.stringify({ ...STAFF, role: "owner" }), fh_demo: "1" },
      api: (request, url) => (url.pathname === "/api/health" ? { ok: true, db: "up", migrations: 3 } : undefined),
    });
    await go(demo);
    await demo.waitForFunction(() => document.querySelector("#fh-shell-src")?.textContent === "DEMO");
    assert.match(await demo.locator("#fh-shell-src").getAttribute("title"), /^demo session — screens show built-in sample data\./);
    await demo.close();
  });
});

test("Sign out tells the server first, then wipes this browser and lands on the right sign-in page", { timeout: 120_000 }, async () => {
  await proof.check(/^Account chip: Sign out/, async () => {
    const page = await lab.open({ storage: { fh_client: "client-123", fh_demo: "1", fh_demo_staff: "{}" } });
    await go(page);
    assert.equal(await store(page, "fh_token"), "fake-token");
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
    await slow.locator("#fh-shell-out").click();
    await slow.waitForURL((url) => url.pathname === "/login.html", { timeout: 15_000 });
    assert.equal(await store(slow, "fh_token"), null);
    await slow.close();

    // A client signs out from their own portal to the client's sign-in page, not the staff password form.
    const client = await lab.open({ role: "client", staff: { role: "client" } });
    await client.goto(`${lab.origin}/app/client-portal.html`, { waitUntil: "domcontentloaded" });
    await client.locator("#fh-shell-out").waitFor({ state: "attached" });
    await client.locator("#fh-shell-out").click({ force: true });
    await client.waitForURL((url) => url.pathname === "/portal-login.html");
    await client.close();
  });
});

test("the x hides the account bar, an account button brings it back, and the choice is remembered", { timeout: 120_000 }, async () => {
  await proof.check(/^Account chip: x hide the bar/, async () => {
    const page = await lab.open();
    await go(page);
    const chip = page.locator("#fh-shell-chip");
    const show = page.locator("#fh-shell-chip-show");
    assert.equal(await chip.isVisible(), true);
    assert.equal(await show.isHidden(), true);
    await page.locator("#fh-shell-chip-hide").click();
    assert.equal(await chip.isHidden(), true, "the bar is hidden");
    assert.equal(await chip.getAttribute("aria-hidden"), "true");
    assert.equal(await show.isVisible(), true, "the way back is on the page");
    assert.equal((await show.innerText()).trim(), "account");
    assert.equal(await store(page, "fh_chip_hidden"), "1");
    await page.reload({ waitUntil: "domcontentloaded" });
    await ready(page);
    assert.equal(await chip.isHidden(), true, "still hidden after a reload");
    assert.equal(await show.isVisible(), true);
    await show.click();
    assert.equal(await chip.isVisible(), true, "the account button brings the bar back, Sign out with it");
    assert.equal(await page.locator("#fh-shell-out").isVisible(), true);
    assert.equal(await show.isHidden(), true);
    assert.equal(await store(page, "fh_chip_hidden"), null, "the remembered choice is cleared");
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
    const open = async (b, extra = {}) => {
      const page = await lab.open({ api: (request, url) => (url.pathname === "/api/org-brand" ? { ok: true, brand: b } : undefined), ...extra });
      await go(page);
      await waitFor(() => page.apiCalls.some((c) => c.path === "/api/org-brand"), "the brand read");
      return page;
    };
    const vars = (page) => page.evaluate(() => {
      const s = document.documentElement.style;
      return Object.fromEntries(["--ink", "--paper", "--spectrum", "--accent", "--sans", "--mono", "--logo"].map((k) => [k, s.getPropertyValue(k)]));
    });

    const good = await open(brand);
    await good.waitForFunction(() => document.documentElement.style.getPropertyValue("--ink") === "#112233");
    const painted = await vars(good);
    assert.equal(painted["--paper"], "#F0F0E0");
    assert.equal(painted["--accent"], "#666666", "the accent is the last ramp stop");
    assert.equal(painted["--spectrum"], "linear-gradient(90deg,#111111 0%,#222222 20%,#333333 40%,#444444 60%,#555555 80%,#666666 100%)");
    assert.match(painted["--sans"], /^'Fraunces', system-ui/);
    assert.match(painted["--mono"], /^'IBM Plex Mono', ui-monospace/);
    assert.equal(painted["--logo"], 'url("https://assets.example.test/logo.svg")');
    assert.equal(await good.locator("#fh-shell-chip").getAttribute("data-brand"), "Acme Funding");
    await good.close();

    // Values that are not plain are never written to the page's styles.
    const bad = await open({
      ink: "red", paper: "url(https://assets.example.test/x)", ramp: ["#111111", "#222222", "#333333", "#444444", "#555555"],
      display_face: "Evil;}", mono_face: "x".repeat(80), wordmark_url: "javascript:alert(1)",
    });
    await bad.waitForTimeout(400);
    assert.deepEqual(await vars(bad), { "--ink": "", "--paper": "", "--spectrum": "", "--accent": "", "--sans": "", "--mono": "", "--logo": "" },
      "an unsafe or short value leaves the Fundhub default in place");
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

test("the role gate sends a role away from a page it may not open, the session answer wins, and no session goes to sign in", { timeout: 180_000 }, async () => {
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
  });
});

test("the search overlay opens from the button and the keyboard, asks the server for the typed words, and shows hits as links", { timeout: 120_000 }, async () => {
  await proof.check(/^Search button and overlay/, async () => {
    const groups = {
      clients: [{ title: "Dana Whitfield", subtitle: "dana@example.com", href: "/app/client-control-panel.html?client_id=c1" }],
      cards: [{ title: "Dana Whitfield", subtitle: "Sales · New Lead", href: "/app/pipeline.html#fh-card-1" }],
    };
    const page = await lab.open({
      api: (request, url) => {
        if (url.pathname !== "/api/read/search") return undefined;
        const q = url.searchParams.get("q");
        if (q === "denied") return { status: 403, body: { ok: false, error: "forbidden" } };
        return { ok: true, groups: q === "dana" ? groups : {} };
      },
    });
    await go(page);
    const overlay = page.locator("#fh-shell-search-overlay");
    const input = page.locator("#fh-shell-search-input");
    const searches = () => page.apiCalls.filter((c) => c.path === "/api/read/search").map((c) => c.query.q);
    assert.equal(await overlay.isHidden(), true);
    await page.locator("#fh-shell-search-btn").click();
    assert.equal(await overlay.isVisible(), true, "the button opens it");
    assert.equal(await input.evaluate((el) => el === document.activeElement), true, "and the box has the cursor");
    assert.match(await page.locator("#fh-shell-search-results").innerText(), /^Type a name, email, phone/);
    await input.fill("dana");
    await page.waitForSelector(".fh-search-hit");
    assert.deepEqual(searches(), ["dana"], "one request, for the typed words");
    assert.equal(page.apiCalls.find((c) => c.path === "/api/read/search").bearer, "Bearer fake-token");
    assert.deepEqual(
      await page.$$eval(".fh-search-ghead", (els) => els.map((e) => e.textContent.replace(/\s+/g, " ").trim())),
      ["Clients 1", "Pipeline 1"],
    );
    assert.deepEqual(
      await page.$$eval("a.fh-search-hit", (els) => els.map((e) => [e.getAttribute("href"), e.querySelector(".fh-search-title").textContent])),
      [["/app/client-control-panel.html?client_id=c1", "Dana Whitfield"], ["/app/pipeline.html#fh-card-1", "Dana Whitfield"]],
      "each hit is a link to where it lives",
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
    await page.keyboard.press("Control+k");
    assert.equal(await overlay.isHidden(), true, "Control+K again closes it");
    await page.close();

    // The three outside roles never get the search button.
    const partner = await lab.open({ role: "partner", staff: { role: "partner" } });
    await go(partner, "/app/brand-studio.html");
    assert.equal(await partner.locator("#fh-shell-search-btn").count(), 0);
    await partner.close();
  });
});

test("the sidebar logo goes to the pipeline, and the collapse button folds the rail to icons and back", { timeout: 120_000 }, async () => {
  await proof.check(/^Sidebar logo link/, async () => {
    const page = await lab.open();
    await go(page);
    assert.equal(await page.locator("#side a.logo").getAttribute("href"), "pipeline.html");
    const side = page.locator("#side");
    const burger = page.locator("#burger");
    assert.equal((await burger.innerText()).trim(), "‹‹");
    assert.equal(await side.evaluate((el) => el.classList.contains("mini")), false);
    await burger.click();
    assert.equal(await side.evaluate((el) => el.classList.contains("mini")), true, "folded to the icon strip");
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains("fh-side-mini")), true);
    assert.equal((await burger.innerText()).trim(), "››");
    assert.equal(await page.locator("#side .navgroup.closed").count(), 0, "every section is open on the icon strip, so no row is lost");
    await burger.click();
    assert.equal(await side.evaluate((el) => el.classList.contains("mini")), false, "and back");
    assert.equal((await burger.innerText()).trim(), "‹‹");
    await page.locator("#side a.logo").click();
    await page.waitForURL((url) => url.pathname === "/app/pipeline.html");
    await page.close();

    // On a phone the rail is off canvas: the menu button brings it in, the same control closes it, and a
    // destination tapped closes it too.
    const phone = await lab.open({ width: 390, height: 800 });
    await go(phone);
    assert.equal(await phone.locator("#side").evaluate((el) => el.classList.contains("open")), false);
    assert.equal((await phone.locator("#burger").innerText()).trim(), "✕");
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
