// S5 screen proofs: the staff sidebar. A real Chromium opens a staff screen as
// a signed-in owner (fake session, fake API, no outside network), then clicks
// every section head and every nav link and judges what the screen does.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { openLab, newStaffPage, waitForShell } from "./s5-browser-kit.mjs";
import { S5_DISPLAY_ROWS } from "./s5-display-contracts.mjs";

const THIS_FILE = "src/pulse/catalog/proofs/s5-display-sidebar.test.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const FRAGMENT = fs.readFileSync(path.join(ROOT, "public/app/sidebar.fragment.html"), "utf8");

// The rows the registry names: group data attribute, label as printed, target.
const GROUPS = [
  ["relationships", "Relationships"],
  ["work", "Your work"], ["clients", "Clients"], ["insights", "Insights"], ["marketing", "Marketing"],
  ["automation", "Automation"], ["settings", "Manage"],
];
const decode = (text) => text.replace(/&amp;/g, "&");
const LINKS = [...FRAGMENT.matchAll(/<div class="navgroup" data-fh-section="([^"]+)">[\s\S]*?<\/div><\/div>/g)].flatMap((group) =>
  [...group[0].matchAll(/<a class="navitem" href="([^"]+)">[\s\S]*?<span class="lbl">([^<]+)<\/span>/g)]
    .map((link) => ({ section: group[1], href: link[1], label: decode(link[2]) })));

test("the fragment carries the seven current sections and the 34 links this proof clicks", () => {
  assert.deepEqual([...FRAGMENT.matchAll(/data-fh-section="([^"]+)"/g)].map((m) => m[1]), GROUPS.map(([key]) => key));
  assert.equal(LINKS.length, 34);
  assert.deepEqual(LINKS.filter(link => link.href === "bank-outreach.html"), [{ section: "relationships", href: "bank-outreach.html", label: "Bank outreach" }]);
  for (const link of LINKS) {
    assert.ok(fs.existsSync(path.join(ROOT, "public/app", link.href)), `${link.href} is a real screen`);
  }
});

// Eleven rows are in the rail file but shell.js hides them from every role that
// has a rail (owner, admin, sales manager, closer, funding advisor, CSM, setter,
// inquiry specialist, partner, outbound rep), so no person can click them: Home, Galaxy,
// Ops & Admin, Agent Editor, Workflows, Journeys, Consent, Finance OS, Hiring,
// Brand Studio and Affiliate. They are left out of this proof on purpose.
const HIDDEN_FROM_EVERY_ROLE = new Set([
  "partner-galaxy.html", "galaxy.html", "ops-admin.html", "agent-editor.html", "automations.html", "journeys.html",
  "consent-capture.html", "finance-os.html", "hiring.html", "brand-studio.html", "affiliate.html",
]);
const SHOWN_LINKS = LINKS.filter((link) => !HIDDEN_FROM_EVERY_ROLE.has(link.href));
const SHOWN_SECTIONS = [...new Set(SHOWN_LINKS.map((link) => link.section))];

const EVERY_ROLE = ["owner", "admin", "sales_manager", "closer", "funding_advisor", "csm", "setter", "inquiry_specialist", "partner", "outbound_rep"];
const BANK_OUTREACH_ROLES = new Set(["owner", "admin", "sales_manager", "outbound_rep"]);

test("the eleven left-out rows stay hidden and Bank outreach follows its exact role scope", { timeout: 180_000 }, async (t) => {
  const lab = await openLab();
  t.after(() => lab.close());
  for (const role of EVERY_ROLE) {
    const page = await newStaffPage(lab, { role });
    await page.goto(`${lab.origin}/app/${role === "outbound_rep" ? "bank-outreach.html" : "sales-floor.html"}`, { waitUntil: "domcontentloaded" });
    await page.locator('#side[data-fh-wired="1"]').waitFor({ state: "attached" });
    await page.waitForFunction(() => !document.getElementById("fh-gate-style"), null, { polling: 100, timeout: 30_000 });
    await page.evaluate(() => document.querySelectorAll("#side .navgroup").forEach((g) => g.classList.remove("closed")));
    const shown = await page.evaluate(() => [...document.querySelectorAll("#side a.navitem")]
      .filter((a) => a.getClientRects().length > 0).map((a) => a.getAttribute("href")));
    for (const href of shown) assert.equal(HIDDEN_FROM_EVERY_ROLE.has(href), false, `${role} can now see ${href}: add it to this proof`);
    const canOpenBanks = BANK_OUTREACH_ROLES.has(role);
    assert.equal(shown.includes("bank-outreach.html"), canOpenBanks, `${role}: exact Bank outreach visibility`);
    if (role === "outbound_rep") assert.deepEqual(shown, ["bank-outreach.html"], "outbound rep sees only their bank workspace");
    const bankGroup = page.locator('#side .navgroup[data-fh-section="relationships"]');
    const bankLink = bankGroup.locator('a.navitem[href="bank-outreach.html"]');
    assert.equal(await bankLink.isVisible(), canOpenBanks);
    if (canOpenBanks) {
      assert.equal((await bankLink.locator('.lbl').textContent()).trim(), "Bank outreach");
      assert.equal((await bankGroup.locator('.navhead').evaluate(node => node.firstChild.textContent)).trim(), "Relationships");
      await bankLink.click();
      await page.waitForURL(url => url.pathname === '/app/bank-outreach.html', { timeout: 15_000 });
      assert.equal(new URL(page.url()).pathname, '/app/bank-outreach.html', `${role}: Bank outreach opens its workspace`);
    }
    await page.close();
  }
});

async function openAsOwner(lab) {
  const page = await newStaffPage(lab, { role: "owner" });
  await page.goto(`${lab.origin}/app/sales-floor.html`, { waitUntil: "domcontentloaded" });
  await waitForShell(page);
  return page;
}

test("the six sections an owner sees each fold their links away and bring them back", { timeout: 120_000 }, async (t) => {
  const lab = await openLab();
  t.after(() => lab.close());
  const page = await openAsOwner(lab);
  assert.equal(SHOWN_LINKS.length, 23);
  assert.deepEqual(SHOWN_SECTIONS, ["relationships", "work", "clients", "insights", "marketing", "settings"]);
  for (const [key, title] of GROUPS.filter(([key]) => SHOWN_SECTIONS.includes(key))) {
    const group = page.locator(`#side .navgroup[data-fh-section="${key}"]`);
    const head = group.locator(".navhead").first();
    assert.equal(await head.isVisible(), true, `${title} head is on the rail`);
    assert.equal((await head.evaluate((node) => node.firstChild.textContent)).trim(), title);
    const links = group.locator("a.navitem");
    assert.ok((await links.count()) > 0, `${title} has links`);
    const startedClosed = await group.evaluate((node) => node.classList.contains("closed"));
    await head.click();
    const afterOne = await group.evaluate((node) => node.classList.contains("closed"));
    assert.equal(afterOne, !startedClosed, `${title}: one click flips the fold`);
    assert.equal(await links.first().isVisible(), !afterOne, `${title}: links follow the fold`);
    await head.click();
    assert.equal(await group.evaluate((node) => node.classList.contains("closed")), startedClosed, `${title}: a second click restores it`);
    assert.equal(await links.first().isVisible(), !startedClosed);
  }
  await page.close();
});

test("each of the 23 shown nav links is under its section with its label and opens its own screen", { timeout: 420_000 }, async (t) => {
  const lab = await openLab();
  t.after(() => lab.close());
  for (const link of SHOWN_LINKS) {
    const page = await openAsOwner(lab);
    const group = page.locator(`#side .navgroup[data-fh-section="${link.section}"]`);
    const anchor = group.locator(`a.navitem[href="${link.href}"]`);
    assert.equal(await anchor.count(), 1, `${link.section} > ${link.label}: link is present once`);
    assert.equal((await anchor.locator(".lbl").evaluate((node) => node.textContent)).trim(), link.label);
    if (await group.evaluate((node) => node.classList.contains("closed"))) await group.locator(".navhead").first().click();
    assert.equal(await anchor.isVisible(), true, `${link.label} can be seen once its section is open`);
    await anchor.click();
    await page.waitForURL((url) => url.pathname === `/app/${link.href}`, { timeout: 15_000 });
    assert.equal(new URL(page.url()).pathname, `/app/${link.href}`, `${link.label} stays on its own screen`);
    assert.match(await page.title(), /\S/, `${link.label} has a title`);
    await page.close();
  }
});

test("the registry names exactly the links this file clicks", () => {
  const registered = S5_DISPLAY_ROWS.filter((row) => row.test === THIS_FILE)
    .map((row) => row.control.match(/\(([^)]+\.html)\)$/)[1]).sort();
  assert.deepEqual(registered, SHOWN_LINKS.map((link) => link.href).sort());
});
