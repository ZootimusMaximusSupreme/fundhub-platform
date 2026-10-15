// Batch 19 practice tests: the nine sidebar section heads drawn by public/app/shell.js. A real page in
// Chromium per role (fake session, fake /api), judging which heads a role sees, which links sit under
// each, and whether a head folds and unfolds them. Rows come from fin-b19-rows.json.
//
// Six heads are drawn for at least one role, so they are proved here. Home, Watch and Automation are
// never drawn for any role (every link under them is on shell.js NAV_HIDDEN), so no person can click
// their head: those three rows are exercised here as "never visible" in a real browser, and are judged
// by the live shared chrome (src/pulse/coverage/fin-b19-hidden-head.mjs), which reads the hidden list and
// the code that applies it, and says "nothing to judge" only while both hold.

import assert from "node:assert/strict";
import test from "node:test";

import { proofRows, sharedLab } from "./fin-b19-kit.mjs";

const proof = proofRows(import.meta.url);
const lab = sharedLab();

const STAFF_ROLES = ["owner", "admin", "sales_manager", "closer", "funding_advisor", "csm", "setter", "inquiry_specialist"];
const EVERY_ROLE = [...STAFF_ROLES, "partner"];

// One page per role, read once: the heads drawn, each with the links a person can see under it.
const rails = new Map();
async function railOf(role) {
  if (rails.has(role)) return rails.get(role);
  const page = await lab.open({ role, staff: { role } });
  await page.goto(`${lab.origin}${role === "partner" ? "/app/partner-galaxy.html" : "/app/pipeline.html"}`, { waitUntil: "domcontentloaded" });
  await page.locator('#side[data-fh-wired="1"]').waitFor({ state: "attached" });
  await page.waitForFunction(() => !document.getElementById("fh-gate-style"), null, { polling: 100, timeout: 30_000 });
  await page.evaluate(() => document.querySelectorAll("#side .navgroup").forEach((g) => g.classList.remove("closed")));
  const heads = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll("#side .navgroup")]
    .filter((g) => getComputedStyle(g).display !== "none" && g.getClientRects().length > 0)
    .map((g) => [g.dataset.fhSection, {
      title: g.querySelector(".navhead").firstChild.textContent.trim(),
      links: [...g.querySelectorAll("a.navitem")].filter((a) => a.getClientRects().length > 0).map((a) => a.getAttribute("href")),
      all: [...g.querySelectorAll("a.navitem")].map((a) => a.getAttribute("href")),
    }])));
  await page.close();
  rails.set(role, heads);
  return heads;
}

// What each role sees under each head today. The list under a head is the rail file's list minus the rows
// shell.js hides by name (NAV_HIDDEN) and the rows the role may not open.
const OPS_FIVE = ["csm-queue.html", "messaging.html", "documents.html", "inquiry-remover.html", "company-brain.html"];
const OPS_FOUR = ["csm-queue.html", "messaging.html", "documents.html", "inquiry-remover.html"];
const MARKETING_FIVE = ["marketing-command-center.html", "campaign-manager.html", "social-studio.html", "creative-factory.html", "content-admin.html"];
const SECTIONS = {
  funding: {
    title: "Funding",
    named: ["lenders.html", "client-control-panel.html", "finance-os.html"],
    sees: {
      owner: ["lenders.html", "client-control-panel.html"], admin: ["lenders.html", "client-control-panel.html"],
      funding_advisor: ["lenders.html", "client-control-panel.html"],
      sales_manager: ["client-control-panel.html"], closer: ["client-control-panel.html"], csm: ["client-control-panel.html"],
      setter: ["client-control-panel.html"], inquiry_specialist: ["client-control-panel.html"],
    },
  },
  "client-ops": {
    title: "Client ops",
    named: ["csm-queue.html", "consent-capture.html", "messaging.html", "documents.html", "inquiry-remover.html", "company-brain.html"],
    sees: {
      owner: OPS_FIVE, admin: OPS_FIVE, sales_manager: OPS_FOUR, closer: OPS_FOUR, funding_advisor: OPS_FOUR,
      csm: OPS_FOUR, setter: OPS_FOUR, inquiry_specialist: OPS_FOUR,
    },
  },
  marketing: {
    title: "Marketing",
    named: MARKETING_FIVE,
    sees: { owner: MARKETING_FIVE, admin: MARKETING_FIVE, partner: ["social-studio.html", "creative-factory.html"] },
  },
  admin: {
    title: "Admin",
    named: ["staff-teams.html", "hiring.html", "products-commissions.html", "contracts.html", "brand-studio.html"],
    sees: {
      owner: ["staff-teams.html", "products-commissions.html", "contracts.html"],
      admin: ["staff-teams.html", "products-commissions.html", "contracts.html"],
      sales_manager: ["staff-teams.html", "products-commissions.html"],
    },
  },
  portals: {
    title: "Portals",
    named: ["client-portal.html", "affiliate.html"],
    sees: { owner: ["client-portal.html"] },
  },
};

const ROW = {
  funding: /^Sidebar group 'Funding'/,
  "client-ops": /^Sidebar group 'Client ops'/,
  marketing: /^Sidebar group 'Marketing'/,
  admin: /^Sidebar group 'Admin'/,
  portals: /^Sidebar group 'Portals'/,
};

for (const [key, section] of Object.entries(SECTIONS)) {
  test(`the ${section.title} head is drawn only for the roles that have a link under it, with exactly those links`, { timeout: 180_000 }, async () => {
    await proof.check(ROW[key], async () => {
      for (const role of EVERY_ROLE) {
        const rail = await railOf(role);
        const want = section.sees[role];
        if (!want) {
          assert.equal(rail[key], undefined, `${role}: no ${section.title} head when every link under it is off their rail`);
          continue;
        }
        assert.ok(rail[key], `${role}: the ${section.title} head is drawn`);
        assert.equal(rail[key].title, section.title);
        assert.deepEqual(rail[key].links, want, `${role}: links under ${section.title}`);
        // The rows the section names and this role cannot see are in the markup but never shown.
        for (const href of section.named) {
          if (!want.includes(href)) assert.ok(!rail[key].links.includes(href), `${role}: ${href} stays off the rail`);
        }
      }

      // The head folds its links away and brings them back. Owner has every head, so one page does it.
      const page = await lab.open({ role: "owner" });
      await page.goto(`${lab.origin}/app/pipeline.html`, { waitUntil: "domcontentloaded" });
      await page.locator('#side[data-fh-wired="1"]').waitFor({ state: "attached" });
      await page.waitForFunction(() => !document.getElementById("fh-gate-style"), null, { polling: 100, timeout: 30_000 });
      const group = page.locator(`#side .navgroup[data-fh-section="${key}"]`);
      const head = group.locator(".navhead");
      const links = group.locator("a.navitem");
      const closed = () => group.evaluate((node) => node.classList.contains("closed"));
      assert.equal(await closed(), true, "a section you are not standing in starts folded");
      assert.equal(await links.first().isVisible(), false, "and its links are out of sight");
      await head.click();
      assert.equal(await closed(), false, "one click opens it");
      assert.equal(await links.first().isVisible(), true, "and the first link can be seen");
      const shown = await links.evaluateAll((els) => els.filter((a) => a.getClientRects().length > 0).map((a) => a.getAttribute("href")));
      assert.deepEqual(shown, section.sees.owner, "the links shown are exactly the owner's list");
      await head.click();
      assert.equal(await closed(), true, "a second click folds it again");
      assert.equal(await links.first().isVisible(), false);
      await page.close();
    });
  });
}

test("Home, Watch and Automation are drawn for no role, so their heads cannot be folded or unfolded", { timeout: 180_000 }, async () => {
  const NEVER = {
    home: ["partner-galaxy.html"],
    watch: ["galaxy.html", "ops-admin.html"],
    automation: ["agent-editor.html", "automations.html", "journeys.html"],
  };
  for (const role of EVERY_ROLE) {
    const rail = await railOf(role);
    for (const [key, links] of Object.entries(NEVER)) {
      assert.equal(rail[key], undefined, `${role} can now see the ${key} head: attach its row`);
      for (const href of links) assert.ok(!Object.values(rail).some((h) => h.links.includes(href)), `${role} can now open ${href} from the rail`);
    }
  }
  // Each of them does sit in the rail markup, so the reason is "hidden by name", not "not built".
  const rail = await railOf("owner");
  assert.ok(Object.keys(rail).length >= 5, "the owner's rail has its other heads");
  for (const row of proof.rows) {
    if (/^Sidebar group '(Home|Watch|Automation)'/.test(row.control)) {
      // Exercised here and never handed to the catalog: see notAttached in fin-b19-rows.json.
      await proof.check(row.control, async () => {
        const key = row.control.match(/^Sidebar group '(\w+)'/)[1].toLowerCase();
        for (const role of EVERY_ROLE) assert.equal((await railOf(role))[key], undefined, `${role}: ${key}`);
      });
    }
  }
});

test("every listed row was exercised", () => {
  proof.assertAllClaimed();
});
