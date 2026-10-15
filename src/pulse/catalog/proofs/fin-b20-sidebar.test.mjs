// Finish-853 batch 20: the staff rail. public/app/sidebar.fragment.html is the one source; shell.js
// carries a copy it mounts, and every desk carries an inline copy. A real Chromium opens desks as each
// role (fake session, fake /api, nothing leaves the machine) and judges what the rail shows, how its
// section heads fold, the collapse button, the phone drawer, and the eleven rows the file lists but no
// role is shown.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test, { before, after } from "node:test";
import { fileURLToPath } from "node:url";

import { openLab, makePage } from "./fin-b20-browser-kit.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const APP = path.join(ROOT, "public/app");
const FRAGMENT = fs.readFileSync(path.join(APP, "sidebar.fragment.html"), "utf8");
const SHELL = fs.readFileSync(path.join(APP, "shell.js"), "utf8");

const decode = (t) => t.replace(/&amp;/g, "&");
const ASIDE = FRAGMENT.replace(/^<!--[\s\S]*?-->\s*/, "").trim();
const GROUPS = [...ASIDE.matchAll(/<div class="navgroup" data-fh-section="([^"]+)"><button class="navhead" type="button">([^<]+)<span/g)]
  .map((m) => ({ key: m[1], title: decode(m[2]) }));
const LINKS = [...ASIDE.matchAll(/<div class="navgroup" data-fh-section="([^"]+)">[\s\S]*?<\/div><\/div>/g)].flatMap((group) =>
  [...group[0].matchAll(/<a class="navitem" href="([^"]+)"><span class="ico">[^<]*<\/span><span class="lbl">([^<]+)<\/span>/g)]
    .map((link) => ({ section: group[1], href: link[1], label: decode(link[2]) })));

// What each role is shown on its rail. Pinned from the shell's own role map, so a change to who sees
// what turns this red and has to be a decision.
const OWNER = ["pipeline.html", "closer-dashboard.html", "my-numbers.html", "sales-floor.html", "calendar.html", "lenders.html",
  "client-control-panel.html", "csm-queue.html", "messaging.html", "documents.html", "inquiry-remover.html", "company-brain.html",
  "marketing-command-center.html", "campaign-manager.html", "social-studio.html", "creative-factory.html", "content-admin.html",
  "staff-teams.html", "products-commissions.html", "contracts.html", "client-portal.html"];
const STAFF = ["pipeline.html", "closer-dashboard.html", "calendar.html", "client-control-panel.html", "csm-queue.html",
  "messaging.html", "documents.html", "inquiry-remover.html"];
const RAIL = {
  owner: { page: "pipeline.html", links: OWNER, heads: ["sales", "funding", "client-ops", "marketing", "admin", "portals"] },
  admin: { page: "pipeline.html", links: OWNER.filter((h) => h !== "client-portal.html"), heads: ["sales", "funding", "client-ops", "marketing", "admin"] },
  sales_manager: {
    page: "pipeline.html",
    links: ["pipeline.html", "closer-dashboard.html", "sales-floor.html", "calendar.html", "client-control-panel.html", "csm-queue.html",
      "messaging.html", "documents.html", "inquiry-remover.html", "staff-teams.html", "products-commissions.html"],
    heads: ["sales", "funding", "client-ops", "admin"],
  },
  closer: { page: "pipeline.html", links: ["pipeline.html", "closer-dashboard.html", "my-numbers.html", "calendar.html", ...STAFF.slice(3)], heads: ["sales", "funding", "client-ops"] },
  funding_advisor: { page: "pipeline.html", links: ["pipeline.html", "closer-dashboard.html", "calendar.html", "lenders.html", ...STAFF.slice(3)], heads: ["sales", "funding", "client-ops"] },
  csm: { page: "pipeline.html", links: STAFF, heads: ["sales", "funding", "client-ops"] },
  setter: { page: "pipeline.html", links: STAFF, heads: ["sales", "funding", "client-ops"] },
  inquiry_specialist: { page: "pipeline.html", links: STAFF, heads: ["sales", "funding", "client-ops"] },
  partner: { page: "partner-galaxy.html", links: ["social-studio.html", "creative-factory.html"], heads: ["marketing"] },
};
// Rows the file lists that no role is shown (NAV_HIDDEN in shell.js, owner-set 2026-08-19): the page still
// opens by its address.
const HIDDEN = ["partner-galaxy.html", "galaxy.html", "ops-admin.html", "agent-editor.html", "automations.html", "journeys.html",
  "consent-capture.html", "finance-os.html", "hiring.html", "brand-studio.html", "affiliate.html"];

let lab;
before(async () => { lab = await openLab(); });
after(async () => { await lab.close(); });

async function openRail(role, file) {
  const page = await makePage(lab, { role });
  await page.goto(`${lab.origin}/app/${file}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.documentElement.classList.contains("fh-page-access-confirmed"), null, { polling: 100, timeout: 20_000 });
  await page.locator('#side[data-fh-wired="1"]').waitFor({ state: "attached" });
  return page;
}

const shown = (page) => page.evaluate(() => ({
  links: [...document.querySelectorAll("#side a.navitem")].filter((a) => a.style.display !== "none").map((a) => a.getAttribute("href").split("?")[0]),
  heads: [...document.querySelectorAll("#side .navgroup")].filter((g) => g.style.display !== "none").map((g) => g.getAttribute("data-fh-section")),
}));

// ---------------------------------------------------------------------------------------------
test("the file carries nine sections and 32 links, shell.js mounts the same markup, and every desk's inline copy matches", () => {
  assert.deepEqual(GROUPS.map((g) => g.key), ["home", "sales", "funding", "client-ops", "watch", "automation", "marketing", "admin", "portals"]);
  assert.deepEqual(GROUPS.map((g) => g.title), ["Home", "Sales", "Funding", "Client ops", "Watch", "Automation", "Marketing", "Admin", "Portals"]);
  assert.equal(LINKS.length, 32);
  assert.equal(new Set(LINKS.map((l) => l.href)).size, 32, "each link is listed once");
  for (const l of LINKS) assert.ok(fs.existsSync(path.join(APP, l.href)), `${l.href} is a real screen`);

  const marker = SHELL.match(/\/\* ==SIDEBAR_HTML_START== \*\/\s*var SIDEBAR_HTML = ("[\s\S]*?");\s*\/\* ==SIDEBAR_HTML_END== \*\//);
  assert.ok(marker, "shell.js holds the markup between its two markers");
  assert.equal(JSON.parse(marker[1]).trim(), ASIDE, "shell.js carries the fragment exactly");

  const copies = fs.readdirSync(APP).filter((f) => f.endsWith(".html") && f !== "sidebar.fragment.html")
    .map((f) => [f, fs.readFileSync(path.join(APP, f), "utf8")])
    .filter(([, text]) => /<aside\s+class="side"/.test(text));
  assert.ok(copies.length >= 30, `${copies.length} desks carry the rail`);
  for (const [file, text] of copies) {
    const inline = text.match(/<aside\s+class="side"[^>]*>[\s\S]*?<div class="side-foot"[\s\S]*?<\/aside>/);
    assert.ok(inline, `${file} has the rail`);
    const normalized = inline[0].replace(/<a class="navitem on"/g, '<a class="navitem"');
    assert.equal(normalized, ASIDE, `${file}'s inline rail equals the fragment`);
  }
});

// ---------------------------------------------------------------------------------------------
test("each role's rail shows exactly its links and section heads, and never one of the eleven hidden rows", { timeout: 240_000 }, async () => {
  for (const [role, expected] of Object.entries(RAIL)) {
    const page = await openRail(role, expected.page);
    const got = await shown(page);
    assert.deepEqual([...got.links].sort(), [...expected.links].sort(), `${role}: links`);
    assert.deepEqual(got.heads, expected.heads, `${role}: section heads`);
    for (const href of got.links) assert.equal(HIDDEN.includes(href), false, `${role} is shown ${href}`);
    // The row is in the markup (one inline copy per desk) and gated, not removed
    const gated = await page.evaluate((hrefs) => hrefs.map((h) => {
      const a = document.querySelector(`#side a.navitem[href="${h}"]`);
      return [h, !!a, !!a && a.hasAttribute("data-fh-gated") && a.style.display === "none"];
    }), HIDDEN);
    for (const [href, inMarkup, isGated] of gated) {
      assert.equal(inMarkup, true, `${role}: ${href} is in the markup`);
      assert.equal(isGated, true, `${role}: ${href} is hidden by the gate`);
    }
    await page.close();
  }
});

// ---------------------------------------------------------------------------------------------
test("section heads: the six a person sees fold their links away and bring them back; Home, Watch and Automation never show a head", { timeout: 120_000 }, async () => {
  const page = await openRail("owner", "pipeline.html");
  const got = await shown(page);
  assert.deepEqual(got.heads, ["sales", "funding", "client-ops", "marketing", "admin", "portals"]);
  for (const key of got.heads) {
    const title = GROUPS.find((g) => g.key === key).title;
    const group = page.locator(`#side .navgroup[data-fh-section="${key}"]`);
    const head = group.locator(".navhead").first();
    assert.equal((await head.evaluate((el) => el.firstChild.textContent)).trim(), title);
    const first = group.locator("a.navitem").first();
    const startedClosed = await group.evaluate((el) => el.classList.contains("closed"));
    await head.click();
    assert.equal(await group.evaluate((el) => el.classList.contains("closed")), !startedClosed, `${title}: a click flips it`);
    assert.equal(await first.isVisible(), startedClosed, `${title}: its links follow the fold`);
    await head.click();
    assert.equal(await group.evaluate((el) => el.classList.contains("closed")), startedClosed, `${title}: a second click restores it`);
  }
  for (const key of ["home", "watch", "automation"]) {
    const group = page.locator(`#side .navgroup[data-fh-section="${key}"]`);
    assert.equal(await group.count(), 1, `${key} is in the markup`);
    assert.equal(await group.evaluate((el) => el.style.display === "none" && el.hasAttribute("data-fh-gated-group")), true, `${key} has no head for the owner`);
  }
  await page.close();
});

test("section heads: only the group holding the open screen starts open", { timeout: 60_000 }, async () => {
  const page = await openRail("owner", "pipeline.html");
  const open = await page.evaluate(() => [...document.querySelectorAll("#side .navgroup")].filter((g) => !g.classList.contains("closed")).map((g) => g.getAttribute("data-fh-section")));
  assert.deepEqual(open, ["sales"], "the Sales group holds the pipeline row");
  assert.equal(await page.locator('#side a.navitem.on').getAttribute("href"), "pipeline.html");
  await page.close();
});

// ---------------------------------------------------------------------------------------------
test("collapse button: shrinks the rail to icons and opens every group, a second press restores the rail and the one-group default", { timeout: 60_000 }, async () => {
  const page = await openRail("owner", "pipeline.html");
  const side = page.locator("#side");
  const burger = page.locator("#burger");
  assert.equal(await burger.innerText(), "‹‹");
  const wide = await side.evaluate((el) => el.getBoundingClientRect().width);
  await burger.click();
  assert.equal(await side.evaluate((el) => el.classList.contains("mini")), true);
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains("fh-side-mini")), true);
  assert.equal(await burger.innerText(), "››");
  await page.waitForFunction((w) => document.querySelector("#side").getBoundingClientRect().width < w, wide);
  const closedWhileMini = await page.evaluate(() => [...document.querySelectorAll("#side .navgroup")].filter((g) => g.style.display !== "none" && g.classList.contains("closed")).length);
  assert.equal(closedWhileMini, 0, "an icon rail has no closed group");
  await burger.click();
  assert.equal(await side.evaluate((el) => el.classList.contains("mini")), false);
  assert.equal(await burger.innerText(), "‹‹");
  await page.waitForFunction((w) => Math.abs(document.querySelector("#side").getBoundingClientRect().width - w) < 1, wide);
  const open = await page.evaluate(() => [...document.querySelectorAll("#side .navgroup")].filter((g) => !g.classList.contains("closed")).map((g) => g.getAttribute("data-fh-section")));
  assert.deepEqual(open, ["sales"]);
  await page.close();
});

test("phone: the rail is off-screen, Menu opens it with a scrim, the scrim, Escape, the close button and a link close it", { timeout: 90_000 }, async () => {
  const page = await makePage(lab, { role: "owner", width: 390, height: 844 });
  await page.goto(`${lab.origin}/app/pipeline.html`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.documentElement.classList.contains("fh-page-access-confirmed"), null, { polling: 100, timeout: 20_000 });
  const side = page.locator("#side");
  const menu = page.locator("#fh-menu-btn");
  const scrim = page.locator("#side-scrim");
  const isOpen = () => side.evaluate((el) => el.classList.contains("open"));
  assert.equal(await isOpen(), false);
  assert.equal(await menu.getAttribute("aria-expanded"), "false");
  assert.equal(await page.locator("#burger").innerText(), "✕", "on a phone the same button closes");

  await menu.click();
  assert.equal(await isOpen(), true);
  assert.equal(await menu.getAttribute("aria-expanded"), "true");
  assert.equal(await scrim.evaluate((el) => el.classList.contains("show")), true);
  await page.mouse.click(385, 400);                                              // the scrim, right of the rail
  assert.equal(await isOpen(), false);
  assert.equal(await scrim.evaluate((el) => el.classList.contains("show")), false);

  await menu.click();
  await page.keyboard.press("Escape");
  assert.equal(await isOpen(), false);

  await menu.click();
  await page.locator("#burger").click();
  assert.equal(await isOpen(), false, "the close button on a phone closes the drawer");

  await menu.click();
  await page.locator('#side a.navitem[href="calendar.html"]').click();
  await page.waitForURL((u) => u.pathname === "/app/calendar.html");
  await page.close();
});

// ---------------------------------------------------------------------------------------------
// The eleven rows the file lists. Each is in the named group with its label, points at a real screen,
// is hidden from every role's rail, and the screen still opens by its address.
const ROW_BY_HREF = Object.fromEntries(LINKS.map((l) => [l.href, l]));

test("the eleven hidden rows are in their named groups with their labels and point at real screens", () => {
  const expected = {
    "partner-galaxy.html": ["home", "Home"], "finance-os.html": ["funding", "Finance OS"], "consent-capture.html": ["client-ops", "Consent"],
    "galaxy.html": ["watch", "Galaxy"], "ops-admin.html": ["watch", "Ops & Admin"], "agent-editor.html": ["automation", "Agent Editor"],
    "automations.html": ["automation", "Workflows"], "journeys.html": ["automation", "Journeys"], "hiring.html": ["admin", "Hiring"],
    "brand-studio.html": ["admin", "Brand Studio"], "affiliate.html": ["portals", "Affiliate"],
  };
  assert.deepEqual(Object.keys(expected).sort(), [...HIDDEN].sort());
  for (const [href, [section, label]] of Object.entries(expected)) {
    assert.equal(ROW_BY_HREF[href]?.section, section, `${href}: group`);
    assert.equal(ROW_BY_HREF[href]?.label, label, `${href}: label`);
    assert.ok(fs.existsSync(path.join(APP, href)), `${href} exists`);
  }
  assert.match(SHELL, /var NAV_HIDDEN = \[[\s\S]*?\];/);
  const list = SHELL.match(/var NAV_HIDDEN = \[([\s\S]*?)\];/)[1];
  for (const href of HIDDEN.filter((h) => h !== "partner-galaxy.html")) assert.ok(list.includes(`"${href}"`), `${href} is on NAV_HIDDEN`);
});

test("by address: the owner opens each of the eleven hidden screens and stays, a partner opens partner Home, an affiliate opens Affiliate", { timeout: 240_000 }, async () => {
  for (const href of HIDDEN) {
    const page = await makePage(lab, { role: "owner" });
    await page.goto(`${lab.origin}/app/${href}`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.documentElement.classList.contains("fh-page-access-confirmed"), null, { polling: 100, timeout: 20_000 });
    assert.equal(new URL(page.url()).pathname, `/app/${href}`, `the owner opens ${href} by its address`);
    await page.close();
  }
  const partner = await makePage(lab, { role: "partner" });
  await partner.goto(`${lab.origin}/app/partner-galaxy.html`, { waitUntil: "domcontentloaded" });
  await partner.waitForFunction(() => document.documentElement.classList.contains("fh-page-access-confirmed"), null, { polling: 100, timeout: 20_000 });
  assert.equal(new URL(partner.url()).pathname, "/app/partner-galaxy.html");
  await partner.close();
  const affiliate = await makePage(lab, { role: "affiliate" });
  await affiliate.goto(`${lab.origin}/app/affiliate.html`, { waitUntil: "domcontentloaded" });
  await affiliate.waitForFunction(() => document.documentElement.classList.contains("fh-page-access-confirmed"), null, { polling: 100, timeout: 20_000 });
  assert.equal(new URL(affiliate.url()).pathname, "/app/affiliate.html");
  await affiliate.close();
});
