// Finish-853 batch 20, repair cycle 1: the staff rail, held where the first cycle left a gap.
//
//   1. The exact set of desks. Every desk that loads shell.js carries the rail file's markup once, and the
//      two pages that load it and carry none are named. A desk that loses its rail, or a new desk that
//      forgets it, turns this red. (The first cycle only looked at desks that already had a rail and
//      asked for "at least 30".)
//   2. All nine section heads fold and unfold: the six an owner sees on a wide screen, the three that no
//      role sees today (Home, Watch, Automation) with the menu rows un-hidden in a served copy of shell.js,
//      and the heads inside the phone drawer.
//
// A real Chromium opens the real files from public/app; /api is answered by the test.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test, { before, after } from "node:test";
import { fileURLToPath } from "node:url";

import { openLab, makePage, until } from "./fin-b20-browser-kit.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const APP = path.join(ROOT, "public/app");
const FRAGMENT = fs.readFileSync(path.join(APP, "sidebar.fragment.html"), "utf8");
const SHELL = fs.readFileSync(path.join(APP, "shell.js"), "utf8");
const RAIL_CSS = fs.readFileSync(path.join(APP, "crm-sidebar.css"), "utf8");
const ASIDE = FRAGMENT.replace(/^<!--[\s\S]*?-->\s*/, "").trim();

// The desks that carry the staff rail, by name. Add a desk here when it is built; remove one only when the
// screen is retired.
const RAIL_DESKS = [
  "affiliate.html", "agent-editor.html", "automations.html", "brand-studio.html", "calendar.html", "campaign-manager.html",
  "client-control-panel.html", "closer-dashboard.html", "company-brain.html", "consent-capture.html", "content-admin.html",
  "contracts.html", "creative-factory.html", "csm-queue.html", "documents.html", "finance-os.html", "galaxy.html", "hiring.html",
  "inquiry-remover.html", "journeys.html", "lenders.html", "marketing-command-center.html", "messaging.html", "my-numbers.html",
  "ops-admin.html", "partner-galaxy.html", "partner-training.html", "pipeline.html", "products-commissions.html",
  "sales-floor.html", "social-studio.html", "staff-teams.html",
];
// Pages that load shell.js and draw no rail: the client's own portal (its own header) and the router page.
const NO_RAIL = ["client-portal.html", "index.html"];

const loadsShell = (text) => /<script[^>]*\bsrc=["'](?:\/app\/)?shell\.js(?:\?[^"']*)?["']/.test(text);

test("rail desks: the exact set of pages that load shell.js with a rail is the named set, each carries the rail once, and only two pages load it without one", () => {
  const pages = fs.readdirSync(APP).filter((f) => f.endsWith(".html") && f !== "sidebar.fragment.html").sort();
  const withShell = [];
  const asideCount = {};
  for (const file of pages) {
    const text = fs.readFileSync(path.join(APP, file), "utf8");
    asideCount[file] = (text.match(/<aside\s+class="side"/g) || []).length;
    if (loadsShell(text)) withShell.push(file);
  }
  const rail = withShell.filter((f) => asideCount[f] > 0);
  const bare = withShell.filter((f) => asideCount[f] === 0);
  assert.deepEqual(rail, RAIL_DESKS, "the desks that carry the rail");
  assert.deepEqual(bare, NO_RAIL, "the pages that load shell.js and carry no rail");
  for (const file of RAIL_DESKS) assert.equal(asideCount[file], 1, `${file} carries exactly one rail`);
  for (const file of pages) {
    if (!withShell.includes(file)) assert.equal(asideCount[file], 0, `${file} draws a rail without loading shell.js, which wires it`);
  }
  // every one of those rails is the file's markup, word for word (the live rail replaces it with the same text)
  for (const file of RAIL_DESKS) {
    const text = fs.readFileSync(path.join(APP, file), "utf8");
    const inline = text.match(/<aside\s+class="side"[^>]*>[\s\S]*?<div class="side-foot"[\s\S]*?<\/aside>/);
    assert.ok(inline, `${file} has the whole rail`);
    assert.equal(inline[0].replace(/<a class="navitem on"/g, '<a class="navitem"'), ASIDE, `${file}'s rail equals the fragment`);
  }
});

// ---------------------------------------------------------------------------------------------
let lab;
before(async () => { lab = await openLab(); });
after(async () => { await lab.close(); });

// The eleven hidden rows are hidden twice: by NAV_HIDDEN in shell.js and by one rule in crm-sidebar.css.
// Serve copies of both without them, so the heads they hold can be seen and folded.
async function unhidden(page) {
  const patched = SHELL.replace(/var NAV_HIDDEN = \[[\s\S]*?\];/, () => "var NAV_HIDDEN = [];");
  assert.notEqual(patched, SHELL, "shell.js still names its hidden rows in one list");
  const css = RAIL_CSS.replace(/\.navitem:is\([\s\S]*?\)\s*\{\s*display:\s*none\s*!important;\s*\}/, () => "");
  assert.notEqual(css, RAIL_CSS, "crm-sidebar.css still hides those rows in one rule");
  await page.route("**/app/shell.js", (route) => route.fulfill({ status: 200, contentType: "text/javascript; charset=utf-8", body: patched }));
  await page.route("**/app/crm-sidebar.css", (route) => route.fulfill({ status: 200, contentType: "text/css; charset=utf-8", body: css }));
}

async function settle(page) {
  await page.waitForFunction(() => document.documentElement.classList.contains("fh-page-access-confirmed"), null, { polling: 100, timeout: 20_000 });
  await page.locator('#side[data-fh-wired="1"]').waitFor({ state: "attached" });
}

// Click a head twice: the group's `closed` class flips and its links follow, then both are restored.
async function foldAndUnfold(page, key, label) {
  const group = page.locator(`#side .navgroup[data-fh-section="${key}"]`);
  const head = group.locator(".navhead").first();
  const list = group.locator(".navlist").first();
  const panelShown = async (expected, note) => {
    await until(async () => (await list.evaluate((el) => getComputedStyle(el).display !== "none")) === expected, { message: `${label}: ${note}`, timeout: 4000 });
  };
  const startedClosed = await group.evaluate((el) => el.classList.contains("closed"));
  assert.equal(await head.getAttribute("aria-expanded"), String(!startedClosed), `${label}: its accessibility state matches the starting state`);
  await panelShown(!startedClosed, "its panel matches the starting state");
  await head.click();
  assert.equal(await group.evaluate((el) => el.classList.contains("closed")), !startedClosed, `${label}: a click flips it`);
  assert.equal(await head.getAttribute("aria-expanded"), String(startedClosed), `${label}: its accessibility state follows the fold`);
  await panelShown(startedClosed, "its panel follows the fold");
  await head.click();
  assert.equal(await group.evaluate((el) => el.classList.contains("closed")), startedClosed, `${label}: a second click restores it`);
  assert.equal(await head.getAttribute("aria-expanded"), String(!startedClosed), `${label}: its accessibility state follows the fold back`);
  await panelShown(!startedClosed, "its panel follows the fold back");
}

const visibleHeads = (page) => page.evaluate(() => [...document.querySelectorAll("#side .navgroup")]
  .filter((g) => g.style.display !== "none").map((g) => g.getAttribute("data-fh-section")));

test("section heads: with the hidden menu rows shown, all nine heads are there and each folds and unfolds", { timeout: 180_000 }, async () => {
  const seen = new Set();

  const owner = await makePage(lab, { role: "owner" });
  await unhidden(owner);
  await owner.goto(`${lab.origin}/app/pipeline.html`, { waitUntil: "domcontentloaded" });
  await settle(owner);
  const ownerHeads = await visibleHeads(owner);
  assert.deepEqual(ownerHeads, ["work", "clients", "insights", "marketing", "automation", "settings"],
    "all six current groups are present once the deliberately hidden rows are shown");
  for (const key of ownerHeads) { await foldAndUnfold(owner, key, `owner ${key}`); seen.add(key); }
  await owner.close();

  const partner = await makePage(lab, { role: "partner" });
  await unhidden(partner);
  await partner.goto(`${lab.origin}/app/brand-studio.html`, { waitUntil: "domcontentloaded" });
  await settle(partner);
  const partnerHeads = await visibleHeads(partner);
  assert.deepEqual(partnerHeads, ["insights", "marketing", "settings"], "a partner's Home, marketing tools and Brand Studio stay in their current groups");
  for (const key of partnerHeads) { await foldAndUnfold(partner, key, `partner ${key}`); seen.add(key); }
  await partner.close();

  assert.deepEqual([...seen].sort(), ["automation", "clients", "insights", "marketing", "settings", "work"], "all six current heads were folded");
});

test("section heads: in the phone drawer a head folds its links and brings them back", { timeout: 120_000 }, async () => {
  const page = await makePage(lab, { role: "owner", width: 390, height: 844 });
  await page.goto(`${lab.origin}/app/pipeline.html`, { waitUntil: "domcontentloaded" });
  await settle(page);
  await page.locator("#fh-menu-btn").click();
  assert.equal(await page.locator("#side").evaluate((el) => el.classList.contains("open")), true, "the drawer is open");
  for (const key of ["work", "clients", "insights"]) await foldAndUnfold(page, key, `phone ${key}`);
  assert.equal(await page.locator("#side").evaluate((el) => el.classList.contains("open")), true, "folding a head does not close the drawer");
  await page.close();
});
