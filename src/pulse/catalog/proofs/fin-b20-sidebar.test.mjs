// Finish-853 batch 20: the staff rail. public/app/sidebar.fragment.html is the one source; shell.js
// carries a copy it mounts. Existing desks carry inline copies; the owner-only company cash desk mounts
// the same fragment into an empty aside through the guarded shell. A real Chromium opens desks as each
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
const DYNAMIC_RAIL_DESK = "company-cash.html";
const COMPANY_STAFF = { id: "00000000-0000-4000-8000-000000000002",
  org_id: "00000000-0000-4000-8000-000000000001" };

const decode = (t) => t.replace(/&amp;/g, "&");
const ASIDE = FRAGMENT.replace(/^<!--[\s\S]*?-->\s*/, "").trim();
const GROUPS = [...ASIDE.matchAll(/<div class="navgroup" data-fh-section="([^"]+)"><button class="navhead"[^>]*>([^<]+)<span/g)]
  .map((m) => ({ key: m[1], title: decode(m[2]) }));
const LINKS = [...ASIDE.matchAll(/<div class="navgroup" data-fh-section="([^"]+)">[\s\S]*?<\/div><\/div>/g)].flatMap((group) =>
  [...group[0].matchAll(/<a class="navitem" href="([^"]+)">[\s\S]*?<span class="lbl">([^<]+)<\/span><\/a>/g)]
    .map((link) => ({ section: group[1], href: link[1], label: decode(link[2]) })));

// What each role is shown on its rail. Pinned from the shell's own role map, so a change to who sees
// what turns this red and has to be a decision.
const OWNER = ["bank-outreach.html", "pipeline.html", "setter-dashboard.html", "closer-dashboard.html", "my-numbers.html", "sales-floor.html", "calendar.html", "lenders.html",
  "client-control-panel.html", "csm-queue.html", "messaging.html", "documents.html", "inquiry-remover.html", "company-brain.html",
  "marketing-command-center.html", "campaign-manager.html", "social-studio.html", "creative-factory.html", "content-admin.html",
  "staff-teams.html", "products-commissions.html", "contracts.html", "client-portal.html"];
const STAFF = ["pipeline.html", "closer-dashboard.html", "calendar.html", "client-control-panel.html", "csm-queue.html",
  "messaging.html", "documents.html", "inquiry-remover.html", "company-brain.html"];
const RAIL = {
  owner: { page: "pipeline.html", links: OWNER, heads: ["relationships", "work", "clients", "insights", "marketing", "settings"] },
  admin: { page: "pipeline.html", links: OWNER.filter((h) => h !== "client-portal.html"), heads: ["relationships", "work", "clients", "insights", "marketing", "settings"] },
  sales_manager: {
    page: "pipeline.html",
    links: ["bank-outreach.html", "pipeline.html", "closer-dashboard.html", "sales-floor.html", "calendar.html", "client-control-panel.html", "csm-queue.html",
      "messaging.html", "documents.html", "inquiry-remover.html", "company-brain.html", "staff-teams.html", "products-commissions.html"],
    heads: ["relationships", "work", "clients", "insights", "settings"],
  },
  outbound_rep: { page: "bank-outreach.html", links: ["bank-outreach.html"], heads: ["relationships"] },
  closer: { page: "pipeline.html", links: ["pipeline.html", "closer-dashboard.html", "my-numbers.html", "calendar.html", ...STAFF.slice(3)], heads: ["work", "clients", "insights"] },
  funding_advisor: { page: "pipeline.html", links: ["pipeline.html", "closer-dashboard.html", "calendar.html", "lenders.html", ...STAFF.slice(3)], heads: ["work", "clients", "insights"] },
  csm: { page: "pipeline.html", links: STAFF, heads: ["work", "clients", "insights"] },
  setter: { page: "setter-dashboard.html", links: ["pipeline.html", "setter-dashboard.html", ...STAFF.slice(1)], heads: ["work", "clients", "insights"] },
  inquiry_specialist: { page: "pipeline.html", links: STAFF, heads: ["work", "clients", "insights"] },
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
test("the file carries seven current sections and 34 links, shell.js mounts the same markup, and each inline desk matches", () => {
  assert.deepEqual(GROUPS.map((g) => g.key), ["relationships", "work", "clients", "insights", "marketing", "automation", "settings"]);
  assert.deepEqual(GROUPS.map((g) => g.title), ["Relationships", "Your work", "Clients", "Insights", "Marketing", "Automation", "Manage"]);
  assert.equal(LINKS.length, 34);
  assert.equal(new Set(LINKS.map((l) => l.href)).size, 34, "each link is listed once");
  for (const l of LINKS) assert.ok(fs.existsSync(path.join(APP, l.href)), `${l.href} is a real screen`);

  const marker = SHELL.match(/\/\* ==SIDEBAR_HTML_START== \*\/\s*var SIDEBAR_HTML = ("[\s\S]*?");\s*\/\* ==SIDEBAR_HTML_END== \*\//);
  assert.ok(marker, "shell.js holds the markup between its two markers");
  assert.equal(JSON.parse(marker[1]).trim(), ASIDE, "shell.js carries the fragment exactly");

  const copies = fs.readdirSync(APP).filter((f) => f.endsWith(".html") && f !== "sidebar.fragment.html")
    .map((f) => [f, fs.readFileSync(path.join(APP, f), "utf8")])
    .filter(([, text]) => /<aside\s+class="side"/.test(text));
  assert.ok(copies.length >= 30, `${copies.length} desks carry the rail`);
  for (const [file, text] of copies) {
    if (file === DYNAMIC_RAIL_DESK) {
      assert.match(text, /<aside class="side" id="side" aria-label="Workspace navigation"><\/aside>/,
        "company cash has exactly the empty shared-shell mount");
      assert.match(text, /<script defer src="shell\.js"><\/script>/,
        "company cash loads the guarded shared shell");
      assert.match(text, /<link id="fh-crm-sidebar-css" rel="stylesheet" href="\/app\/crm-sidebar\.css(?:\?v=workspace-20261018)?">/,
        "company cash loads the canonical rail CSS");
      assert.equal((text.match(/<aside\b/g) || []).length, 1, "company cash has no duplicate rail");
      continue;
    }
    const inline = text.match(/<aside\s+class="side"[^>]*>[\s\S]*?<div class="side-foot"[\s\S]*?<\/aside>/);
    assert.ok(inline, `${file} has the rail`);
    const normalized = inline[0].replace(/<a class="navitem on"/g, '<a class="navitem"');
    assert.equal(normalized, ASIDE, `${file}'s inline rail equals the fragment`);
  }
});

test("company cash mounts the canonical 34-row rail once and offers only the owner account-menu entry", { timeout: 60_000 }, async () => {
  const page = await makePage(lab, { role: "owner", staff: COMPANY_STAFF,
    api: (call) => call.path === "/api/owner/company-bank"
      ? { ok: true, configured: false, items: [], accounts: [], transactions: [] }
      : call.path === "/api/owner/company-cash"
        ? { ok: true, summary: { available_cents: null, missing: ["business_bank_balance"] },
          account: null, obligations: [], recurring_candidates: [] } : undefined });
  await page.goto(`${lab.origin}/app/${DYNAMIC_RAIL_DESK}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.documentElement.classList.contains("fh-page-access-confirmed"),
    null, { polling: 100, timeout: 20_000 });
  await page.locator('#side[data-fh-wired="1"]').waitFor({ state: "attached" });
  assert.equal(await page.locator("#side").count(), 1, "one rail mount");
  const mounted = await page.locator("#side a.navitem").evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("href").split("?")[0]));
  assert.deepEqual(mounted, LINKS.map((link) => link.href), "all 34 canonical links mount in order");
  assert.deepEqual((await shown(page)).links.slice().sort(), OWNER.slice().sort(),
    "company cash shows the same owner rail links as the other desks");
  assert.equal(await page.locator('#side a.navitem[href="company-cash.html"]').count(), 0,
    "company cash is an account-menu-only destination");
  await page.locator("#fh-shell-chip-show").click();
  assert.equal(await page.locator('.fh-account-menu a.fh-account-company[href="company-cash.html"]').isVisible(), true);
  assert.equal(await page.locator(".fh-account-menu a.fh-account-company").count(), 1);
  await page.close();
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
test("section heads: the six groups an owner sees fold their links; hidden Automation stays gated", { timeout: 120_000 }, async () => {
  const page = await openRail("owner", "pipeline.html");
  await page.locator("#fh-menu-btn").click();
  const got = await shown(page);
  assert.deepEqual(got.heads, ["relationships", "work", "clients", "insights", "marketing", "settings"]);
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
  const automation = page.locator('#side .navgroup[data-fh-section="automation"]');
  assert.equal(await automation.count(), 1, "Automation is in the markup");
  assert.equal(await automation.evaluate((el) => el.style.display === "none" && el.hasAttribute("data-fh-gated-group")), true, "Automation has no visible row for the owner");
  await page.close();
});

test("section heads: Your work and Clients start open, including the current screen", { timeout: 60_000 }, async () => {
  const page = await openRail("owner", "pipeline.html");
  const open = await page.evaluate(() => [...document.querySelectorAll("#side .navgroup")].filter((g) => !g.classList.contains("closed")).map((g) => g.getAttribute("data-fh-section")));
  assert.deepEqual(open, ["work", "clients"], "the daily Work and Clients groups begin open");
  assert.equal(await page.locator('#side a.navitem.on').getAttribute("href"), "pipeline.html");
  await page.close();
});

// ---------------------------------------------------------------------------------------------
test("desktop: the header button opens and closes the full route menu without a persistent rail", { timeout: 60_000 }, async () => {
  const page = await openRail("owner", "pipeline.html");
  const side = page.locator("#side");
  const menu = page.locator("#fh-menu-btn");
  assert.equal(await side.isVisible(), false);
  assert.equal(await side.getAttribute("aria-hidden"), "true");
  assert.equal(await menu.getAttribute("aria-expanded"), "false");
  assert.equal(await page.locator(".app").evaluate((el) => getComputedStyle(el).paddingLeft), "0px");
  await menu.click();
  assert.equal(await side.isVisible(), true);
  assert.equal(await menu.getAttribute("aria-expanded"), "true");
  assert.equal(await side.evaluate((el) => el.classList.contains("mini")), false);
  assert.equal(await page.locator("#burger").innerText(), "×");
  await page.locator("#burger").click();
  assert.equal(await side.isVisible(), false);
  assert.equal(await menu.getAttribute("aria-expanded"), "false");
  await page.close();
});

test("phone: the menu opens with a scrim; the scrim, Escape, close button and a link close it", { timeout: 90_000 }, async () => {
  const page = await makePage(lab, { role: "owner", width: 390, height: 844 });
  await page.goto(`${lab.origin}/app/pipeline.html`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.documentElement.classList.contains("fh-page-access-confirmed"), null, { polling: 100, timeout: 20_000 });
  const side = page.locator("#side");
  const menu = page.locator("#fh-menu-btn");
  const scrim = page.locator("#side-scrim");
  const isOpen = () => side.evaluate((el) => el.classList.contains("open"));
  assert.equal(await isOpen(), false);
  assert.equal(await menu.getAttribute("aria-expanded"), "false");
  assert.equal(await side.isVisible(), false);

  await menu.click();
  assert.equal(await isOpen(), true);
  assert.equal(await page.locator("#burger").innerText(), "×", "the open menu offers a close button");
  assert.equal(await menu.getAttribute("aria-expanded"), "true");
  assert.equal(await scrim.evaluate((el) => el.classList.contains("show")), true);
  await page.mouse.click(385, 400);                                              // the scrim, right of the menu
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
    "partner-galaxy.html": ["insights", "Home"], "finance-os.html": ["clients", "Finance OS"], "consent-capture.html": ["clients", "Consent"],
    "galaxy.html": ["insights", "Galaxy"], "ops-admin.html": ["insights", "Operations"], "agent-editor.html": ["automation", "Agent Editor"],
    "automations.html": ["automation", "Workflows"], "journeys.html": ["automation", "Journeys"], "hiring.html": ["settings", "Hiring"],
    "brand-studio.html": ["settings", "Brand Studio"], "affiliate.html": ["settings", "Affiliate"],
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
