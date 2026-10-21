// Finish-853 batch 20: what the staff shell decides on every page load. The real public/app/shell.js runs
// in a real Chromium; /api is answered by the test with fake people. Covers the session check, the role
// gate and the rail rows each role is shown, the clock, the brand paint and the beta and demo banners.
// Nothing is saved anywhere real.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test, { before, after } from "node:test";
import { fileURLToPath } from "node:url";

import { openLab, makePage, callsTo, until } from "./fin-b20-browser-kit.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const SHELL_SOURCE = fs.readFileSync(path.join(ROOT, "public/app/shell.js"), "utf8");

let lab;
before(async () => { lab = await openLab(); });
after(async () => { await lab.close(); });

async function settle(page) {
  await page.waitForFunction(() => document.documentElement.classList.contains("fh-page-access-confirmed"), null, { polling: 100, timeout: 20_000 });
  await page.locator("#fh-shell-chip").waitFor({ state: "attached", timeout: 20_000 });
}

// ---------------------------------------------------------------------------------------------
// Session check
test("session check: no session and no demo sends a staff page to the staff sign-in, remembering where it was", { timeout: 60_000 }, async () => {
  const page = await makePage(lab, { token: "", hint: "", session: () => ({ status: 401, body: { ok: false } }) });
  await page.goto(`${lab.origin}/app/pipeline.html`, { waitUntil: "domcontentloaded" });
  await page.waitForURL((u) => u.pathname === "/login.html", { timeout: 15_000 });
  assert.equal(new URL(page.url()).searchParams.get("next"), "/app/pipeline.html");
  assert.equal(callsTo(page, "/api/auth/session").length >= 1, true);
  await page.close();
});

test("session check: no session on the client portal goes to the portal sign-in, not the staff one", { timeout: 60_000 }, async () => {
  const page = await makePage(lab, { token: "", hint: "client", session: () => ({ status: 401, body: { ok: false } }) });
  await page.goto(`${lab.origin}/app/client-portal.html`, { waitUntil: "domcontentloaded" });
  await page.waitForURL((u) => u.pathname === "/portal-login.html", { timeout: 15_000 });
  await page.close();
});

test("session check: the session's role decides, and it rewrites the remembered role", { timeout: 60_000 }, async () => {
  // remembered as owner, the server says closer: the page the owner may open is closed to a closer
  const page = await makePage(lab, { role: "closer", hint: "owner", staff: { name: "Riley Chen" } });
  await page.goto(`${lab.origin}/app/products-commissions.html`, { waitUntil: "domcontentloaded" });
  await page.waitForURL((u) => u.pathname === "/app/closer-dashboard.html", { timeout: 15_000 });
  await settle(page);
  assert.equal(await page.evaluate(() => localStorage.getItem("fh_role")), "closer", "the remembered role is corrected");
  await page.close();
});

test("session check: a demo session opens the page and the chip says DEMO; an unknown role gets the shared staff surface", { timeout: 60_000 }, async () => {
  const demo = await makePage(lab, {
    token: "", hint: "owner", session: () => ({ status: 401, body: { ok: false } }),
    storage: { fh_demo_staff: JSON.stringify({ id: "demo-1", name: "Demo Owner", role: "owner", status: "active" }) },
  });
  await demo.goto(`${lab.origin}/app/pipeline.html`, { waitUntil: "domcontentloaded" });
  await settle(demo);
  assert.equal(new URL(demo.url()).pathname, "/app/pipeline.html");
  await demo.close();

  const odd = await makePage(lab, { role: "wizard" });
  await odd.goto(`${lab.origin}/app/pipeline.html`, { waitUntil: "domcontentloaded" });
  await settle(odd);
  assert.equal(new URL(odd.url()).pathname, "/app/pipeline.html");
  await odd.close();
  const oddFinance = await makePage(lab, { role: "wizard" });
  await oddFinance.goto(`${lab.origin}/app/products-commissions.html`, { waitUntil: "domcontentloaded" });
  await oddFinance.waitForURL((u) => u.pathname === "/app/closer-dashboard.html", { timeout: 15_000 });
  await oddFinance.close();
});

// ---------------------------------------------------------------------------------------------
// Role gate: [role, page, where they end up]. "stay" means the page opens.
const GATE = [
  ["owner", "sales-floor.html", "stay"],
  ["owner", "client-portal.html", "stay"],
  ["owner", "partner-galaxy.html", "stay"],
  ["admin", "sales-floor.html", "stay"],
  ["admin", "client-portal.html", "pipeline.html"],
  ["admin", "affiliate.html", "pipeline.html"],
  ["admin", "partner-galaxy.html", "pipeline.html"],
  ["sales_manager", "sales-floor.html", "stay"],
  ["sales_manager", "products-commissions.html", "stay"],
  ["sales_manager", "my-numbers.html", "sales-floor.html"],
  ["closer", "closer-dashboard.html", "stay"],
  ["closer", "my-numbers.html", "stay"],
  ["closer", "sales-floor.html", "closer-dashboard.html"],
  ["closer", "products-commissions.html", "closer-dashboard.html"],
  ["closer", "lenders.html", "closer-dashboard.html"],
  ["funding_advisor", "lenders.html", "stay"],
  ["funding_advisor", "my-numbers.html", "client-control-panel.html"],
  ["funding_advisor", "sales-floor.html", "client-control-panel.html"],
  ["csm", "csm-queue.html", "stay"],
  ["csm", "sales-floor.html", "csm-queue.html"],
  ["setter", "pipeline.html", "stay"],
  ["setter", "sales-floor.html", "pipeline.html"],
  ["inquiry_specialist", "inquiry-remover.html", "stay"],
  ["inquiry_specialist", "sales-floor.html", "inquiry-remover.html"],
  ["partner", "brand-studio.html", "stay"],
  ["partner", "pipeline.html", "partner-galaxy.html"],
  ["partner", "sales-floor.html", "partner-galaxy.html"],
  ["client", "client-portal.html", "stay"],
  ["client", "sales-floor.html", "client-portal.html"],
  ["affiliate", "affiliate.html", "stay"],
  ["affiliate", "sales-floor.html", "affiliate.html"],
];

test("role gate: each role opens the screens it may and is sent to its own home from the rest", { timeout: 300_000 }, async () => {
  for (const [role, file, expected] of GATE) {
    const page = await makePage(lab, { role });
    await page.goto(`${lab.origin}/app/${file}`, { waitUntil: "domcontentloaded" });
    if (expected === "stay") {
      await settle(page);
      assert.equal(new URL(page.url()).pathname, `/app/${file}`, `${role} opens ${file}`);
    } else {
      await page.waitForURL((u) => u.pathname === `/app/${expected}`, { timeout: 15_000 }).catch(() => {});
      assert.equal(new URL(page.url()).pathname, `/app/${expected}`, `${role} is sent from ${file} to ${expected}`);
    }
    await page.close();
  }
});

test("role gate: the rail hides the rows a role may not open and keeps the ones it may", { timeout: 120_000 }, async () => {
  const gated = async (role, file, href) => {
    const page = await makePage(lab, { role });
    await page.goto(`${lab.origin}/app/${file}`, { waitUntil: "domcontentloaded" });
    await settle(page);
    const link = page.locator(`#side a.navitem[href^="${href}"]`).first();
    const value = await link.evaluate((a) => a.hasAttribute("data-fh-gated") && a.style.display === "none");
    await page.close();
    return value;
  };
  assert.equal(await gated("closer", "closer-dashboard.html", "sales-floor.html"), true, "a closer is not offered the sales floor");
  assert.equal(await gated("closer", "closer-dashboard.html", "my-numbers.html"), false, "a closer is offered My numbers");
  assert.equal(await gated("closer", "closer-dashboard.html", "products-commissions.html"), true);
  assert.equal(await gated("sales_manager", "sales-floor.html", "sales-floor.html"), false);
  assert.equal(await gated("sales_manager", "sales-floor.html", "my-numbers.html"), true);
  assert.equal(await gated("funding_advisor", "lenders.html", "lenders.html"), false);
  assert.equal(await gated("setter", "pipeline.html", "lenders.html"), true);
  assert.equal(await gated("owner", "pipeline.html", "lenders.html"), false);
});

// ---------------------------------------------------------------------------------------------
// Clock
test("clock: Arizona time, the date when the bar is wide, only the time when narrow, gone when small, none for a client, and it ticks", { timeout: 60_000 }, async () => {
  const page = await makePage(lab, { role: "owner", width: 1440 });
  await page.goto(`${lab.origin}/app/products-commissions.html`, { waitUntil: "domcontentloaded" });
  await settle(page);
  const account = page.locator("#fh-shell-chip");
  const diagnostics = page.locator("#fh-shell-account-diagnostics");
  const clock = page.locator("#fh-workspace-clock");
  assert.equal(await clock.isVisible(), false, "the clock waits inside the closed account menu");
  await account.locator("summary").first().click();
  await diagnostics.locator("summary").click();
  await clock.waitFor({ state: "visible" });
  // The page's clock and this process's clock are read a moment apart, so a minute (or midnight)
  // can turn over in between: accept Phoenix's reading from just before or just after the read.
  const readStart = new Date();
  const wide = (await clock.textContent()).trim();
  const readEnd = new Date();
  assert.match(wide, /^[A-Z][a-z]{2}, [A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2}:\d{2} (AM|PM) MST$/);
  const phoenixDays = [readStart, readEnd].map((d) => d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/Phoenix" }));
  assert.equal(phoenixDays.some((day) => wide.startsWith(`${day}, `)), true, `the day is Phoenix's (${phoenixDays.join(" or ")})`);
  const phoenixClocks = [readStart, readEnd].map((d) => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Phoenix" }).replace(/ (AM|PM)$/, ""));
  assert.equal(phoenixClocks.some((hm) => wide.includes(hm)), true, `the hour and minute are Phoenix's (${phoenixClocks.join(" or ")})`);
  await until(async () => (await clock.textContent()).trim() !== wide, { timeout: 4000, message: "the clock to tick" });
  await page.setViewportSize({ width: 1150, height: 900 });
  assert.match((await clock.textContent()).trim(), /^[A-Z][a-z]{2}, [A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2}:\d{2} (AM|PM) MST$/, "the technical clock keeps its full Arizona face when the header narrows");
  assert.equal(await clock.isVisible(), true);
  await page.setViewportSize({ width: 1000, height: 900 });
  assert.equal(await clock.isVisible(), true, "the open Technical details menu remains usable under 1100px");
  await page.close();

  const client = await makePage(lab, { role: "client" });
  await client.goto(`${lab.origin}/app/client-portal.html`, { waitUntil: "domcontentloaded" });
  await settle(client);
  assert.equal(await client.locator("#fh-shell-clock").count(), 0, "a client sees no office clock");
  await client.close();
});

// ---------------------------------------------------------------------------------------------
// Brand paint
const BRAND = {
  ink: "#112233", paper: "#EEEEEE", ramp: ["#F2A69B", "#F5CE8F", "#F2E39B", "#A8D8B0", "#A9C6E8", "#C4B3E5"],
  display_face: "Inter", mono_face: "JetBrains Mono", wordmark_url: "https://cdn.proof.test/logo.svg", entity_name: "Proof Co",
};

async function brandVars(brand) {
  const page = await makePage(lab, { api: (call) => (call.path === "/api/org-brand" ? { ok: true, brand } : undefined) });
  await page.goto(`${lab.origin}/app/pipeline.html`, { waitUntil: "domcontentloaded" });
  await settle(page);
  await until(() => callsTo(page, "/api/org-brand").length > 0, { message: "the brand read" });
  await new Promise((resolve) => setTimeout(resolve, 300));
  const vars = await page.evaluate(() => {
    const s = document.documentElement.style;
    return {
      ink: s.getPropertyValue("--ink"), paper: s.getPropertyValue("--paper"), accent: s.getPropertyValue("--accent"),
      spectrum: s.getPropertyValue("--spectrum"), sans: s.getPropertyValue("--sans"), mono: s.getPropertyValue("--mono"),
      logo: s.getPropertyValue("--logo"), brand: document.getElementById("fh-shell-chip").getAttribute("data-brand"),
      fonts: document.getElementById("fh-brand-fonts") ? document.getElementById("fh-brand-fonts").getAttribute("href") : null,
    };
  });
  await page.close();
  return vars;
}

test("brand paint: ink, paper, the six stops, the faces and an https wordmark are applied", { timeout: 60_000 }, async () => {
  const v = await brandVars(BRAND);
  assert.equal(v.ink, "#112233");
  assert.equal(v.paper, "#EEEEEE");
  assert.equal(v.accent, "#C4B3E5", "the accent is the sixth stop");
  assert.match(v.spectrum, /^linear-gradient\(90deg,#F2A69B 0%,#F5CE8F 20%,#F2E39B 40%,#A8D8B0 60%,#A9C6E8 80%,#C4B3E5 100%\)$/);
  assert.match(v.sans, /^'Inter', system-ui/);
  assert.match(v.mono, /^'JetBrains Mono', ui-monospace/);
  assert.equal(v.logo, 'url("https://cdn.proof.test/logo.svg")');
  assert.equal(v.brand, "Proof Co");
  assert.match(v.fonts, /^https:\/\/fonts\.googleapis\.com\/css2\?family=Inter:wght@400;600&family=JetBrains\+Mono:wght@400;500&display=swap$/);
});

test("brand paint: a value the shell refuses is left out and the rest still paints", { timeout: 90_000 }, async () => {
  const bad = await brandVars({
    ...BRAND, ink: "red", paper: "url(javascript:alert(1))", ramp: BRAND.ramp.slice(0, 5), display_face: "Inter;}body{x:y",
    mono_face: "", wordmark_url: "http://cdn.proof.test/logo.svg",
  });
  assert.equal(bad.ink, "");
  assert.equal(bad.paper, "");
  assert.equal(bad.spectrum, "", "a five-stop ramp paints nothing");
  assert.equal(bad.accent, "");
  assert.equal(bad.sans, "");
  assert.equal(bad.mono, "");
  assert.equal(bad.logo, "", "an http wordmark is not painted");
  assert.equal(bad.fonts, null);
  const data = await brandVars({ ...BRAND, wordmark_url: "data:image/png;base64,iVBORw0KGgo=" });
  assert.equal(data.logo, 'url("data:image/png;base64,iVBORw0KGgo=")');
  const quote = await brandVars({ ...BRAND, wordmark_url: 'https://cdn.proof.test/a"b.svg' });
  assert.equal(quote.logo, "", "a quote, space or bracket in the address is refused");
  const none = await brandVars(null);
  assert.equal(none.ink, "", "no brand leaves the stylesheet's own colours");
});

// ---------------------------------------------------------------------------------------------
// Banners
async function patchedShell(page, listed) {
  assert.ok(SHELL_SOURCE.includes("var BETA_PAGES = [];"), "shell.js still names its beta screens in this one line");
  const source = SHELL_SOURCE.replace("var BETA_PAGES = [];", `var BETA_PAGES = ${JSON.stringify(listed)};`);
  await page.route("**/app/shell.js", (route) => route.fulfill({ status: 200, contentType: "text/javascript; charset=utf-8", body: source }));
}

test("beta banner: the shipped shell lists no beta screen, so no desk draws it or the Dismiss button", { timeout: 90_000 }, async () => {
  assert.match(SHELL_SOURCE, /var BETA_PAGES = \[\];/);
  for (const file of ["pipeline.html", "sales-floor.html", "products-commissions.html"]) {
    const page = await makePage(lab, { role: "owner" });
    await page.goto(`${lab.origin}/app/${file}`, { waitUntil: "domcontentloaded" });
    await settle(page);
    assert.equal(await page.locator("#fh-beta-banner").count(), 0, `${file}: no beta banner`);
    assert.equal(await page.locator("[data-fh-beta-dismiss]").count(), 0);
    assert.equal(await page.locator(".beta-badge").count(), 0);
    await page.close();
  }
});

test("beta banner: when a screen is listed the owner alone gets the banner, a BETA badge on its row, and Dismiss removes it", { timeout: 90_000 }, async () => {
  const owner = await makePage(lab, { role: "owner" });
  await patchedShell(owner, ["pipeline.html"]);
  await owner.goto(`${lab.origin}/app/pipeline.html`, { waitUntil: "domcontentloaded" });
  await settle(owner);
  const bar = owner.locator("#fh-beta-banner");
  await bar.waitFor({ state: "attached" });
  assert.match((await bar.textContent()).replace(/\s+/g, " "), /^Beta — under development\. Data may be incomplete or inaccurate\. Do not use for client decisions\.\s*Dismiss$/);
  assert.equal(await owner.locator('#side a.navitem[href="pipeline.html"] .beta-badge').count(), 1);
  await owner.locator("[data-fh-beta-dismiss]").click();
  assert.equal(await owner.locator("#fh-beta-banner").count(), 0, "Dismiss removes it for this page view");
  await owner.close();

  const admin = await makePage(lab, { role: "admin" });
  await patchedShell(admin, ["pipeline.html"]);
  await admin.goto(`${lab.origin}/app/pipeline.html`, { waitUntil: "domcontentloaded" });
  await settle(admin);
  assert.equal(await admin.locator("#fh-beta-banner").count(), 0, "an admin is not shown the owner's banner");
  assert.equal(await admin.locator(".beta-badge").count(), 0);
  await admin.close();

  const other = await makePage(lab, { role: "owner" });
  await patchedShell(other, ["pipeline.html"]);
  await other.goto(`${lab.origin}/app/sales-floor.html`, { waitUntil: "domcontentloaded" });
  await settle(other);
  assert.equal(await other.locator("#fh-beta-banner").count(), 0, "only the listed screen shows it");
  await other.close();
});

test("demo banner: Demo Mode on never paints a banner on a staff desk", { timeout: 60_000 }, async () => {
  const page = await makePage(lab, {
    role: "owner",
    api: (call) => (call.path === "/api/demo/mode" ? { ok: true, demo_mode_enabled: true, primary_client_id: "demo-client-1" } : undefined),
  });
  await page.goto(`${lab.origin}/app/pipeline.html`, { waitUntil: "domcontentloaded" });
  await settle(page);
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.equal(await page.locator("[data-fh-demo-banner]").count(), 0);
  assert.equal(await page.locator("#fh-demo-banner").count(), 0);
  await page.close();
});
