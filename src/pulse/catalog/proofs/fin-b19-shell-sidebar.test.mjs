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
const MARKETING_FIVE = ["marketing-command-center.html", "campaign-manager.html", "social-studio.html", "creative-factory.html", "content-admin.html"];
const CURRENT_TITLES = { work: "Your work", clients: "Clients", insights: "Insights", marketing: "Marketing", settings: "Manage" };
const SECTIONS = {
  funding: {
    title: "Funding",
    named: ["lenders.html", "client-control-panel.html", "finance-os.html"],
    placement: { "lenders.html": "clients", "client-control-panel.html": "clients", "finance-os.html": "clients" },
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
    placement: {
      "csm-queue.html": "clients", "consent-capture.html": "clients", "messaging.html": "work",
      "documents.html": "clients", "inquiry-remover.html": "clients", "company-brain.html": "insights",
    },
    sees: {
      owner: OPS_FIVE, admin: OPS_FIVE, sales_manager: OPS_FIVE, closer: OPS_FIVE, funding_advisor: OPS_FIVE,
      csm: OPS_FIVE, setter: OPS_FIVE, inquiry_specialist: OPS_FIVE,
    },
  },
  marketing: {
    title: "Marketing",
    named: MARKETING_FIVE,
    placement: Object.fromEntries(MARKETING_FIVE.map((href) => [href, "marketing"])),
    sees: { owner: MARKETING_FIVE, admin: MARKETING_FIVE, partner: ["social-studio.html", "creative-factory.html"] },
  },
  admin: {
    title: "Admin",
    named: ["staff-teams.html", "hiring.html", "products-commissions.html", "contracts.html", "brand-studio.html"],
    placement: {
      "staff-teams.html": "settings", "hiring.html": "settings", "products-commissions.html": "settings",
      "contracts.html": "settings", "brand-studio.html": "settings",
    },
    sees: {
      owner: ["staff-teams.html", "products-commissions.html", "contracts.html"],
      admin: ["staff-teams.html", "products-commissions.html", "contracts.html"],
      sales_manager: ["staff-teams.html", "products-commissions.html"],
    },
  },
  portals: {
    title: "Portals",
    named: ["client-portal.html", "affiliate.html"],
    placement: { "client-portal.html": "settings", "affiliate.html": "settings" },
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
  test(`the former ${section.title} controls keep their exact role gates in the current sidebar groups`, { timeout: 180_000 }, async () => {
    await proof.check(ROW[key], async () => {
      for (const role of EVERY_ROLE) {
        const rail = await railOf(role);
        const want = section.sees[role] || [];
        const shown = Object.values(rail).flatMap((group) => group.links).filter((href) => section.named.includes(href));
        assert.deepEqual([...shown].sort(), [...want].sort(), `${role}: visible ${section.title} controls`);
        for (const href of want) {
          const group = rail[section.placement[href]];
          assert.ok(group, `${role}: ${CURRENT_TITLES[section.placement[href]]} is drawn for ${href}`);
          assert.ok(group.links.includes(href), `${role}: ${href} is in ${CURRENT_TITLES[section.placement[href]]}`);
        }
        for (const href of section.named) {
          if (!want.includes(href)) assert.ok(!shown.includes(href), `${role}: ${href} stays off the rail`);
        }
      }

      // Every current group holding one of these controls folds its visible links and brings them back.
      const page = await lab.open({ role: "owner" });
      await page.goto(`${lab.origin}/app/pipeline.html`, { waitUntil: "domcontentloaded" });
      await page.locator('#side[data-fh-wired="1"]').waitFor({ state: "attached" });
      await page.waitForFunction(() => !document.getElementById("fh-gate-style"), null, { polling: 100, timeout: 30_000 });
      const ownerGroups = [...new Set((section.sees.owner || []).map((href) => section.placement[href]))];
      for (const groupKey of ownerGroups) {
        const group = page.locator(`#side .navgroup[data-fh-section="${groupKey}"]`);
        const head = group.locator(".navhead");
        const firstHref = section.sees.owner.find((href) => section.placement[href] === groupKey);
        const first = group.locator(`a.navitem[href="${firstHref}"]`);
        assert.equal((await head.evaluate((node) => node.firstChild.textContent)).trim(), CURRENT_TITLES[groupKey]);
        const startedClosed = await group.evaluate((node) => node.classList.contains("closed"));
        await head.click();
        assert.equal(await group.evaluate((node) => node.classList.contains("closed")), !startedClosed, `${CURRENT_TITLES[groupKey]} flips`);
        assert.equal(await first.isVisible(), startedClosed, `${firstHref} follows the fold`);
        await head.click();
        assert.equal(await group.evaluate((node) => node.classList.contains("closed")), startedClosed, `${CURRENT_TITLES[groupKey]} restores`);
      }
      await page.close();
    });
  });
}

test("retired Home and Watch rows plus hidden Automation stay off every role's rail", { timeout: 180_000 }, async () => {
  const NEVER = {
    home: { links: ["partner-galaxy.html"], placement: "insights" },
    watch: { links: ["galaxy.html", "ops-admin.html"], placement: "insights" },
    automation: { links: ["agent-editor.html", "automations.html", "journeys.html"], placement: "automation" },
  };
  for (const role of EVERY_ROLE) {
    const rail = await railOf(role);
    for (const [key, spec] of Object.entries(NEVER)) {
      for (const href of spec.links) assert.ok(!Object.values(rail).some((h) => h.links.includes(href)), `${role} can now open ${href} from the rail`);
    }
  }
  // Each route still sits in the current rail markup and is hidden by the role gate.
  const page = await lab.open({ role: "owner" });
  await page.goto(`${lab.origin}/app/pipeline.html`, { waitUntil: "domcontentloaded" });
  await page.locator('#side[data-fh-wired="1"]').waitFor({ state: "attached" });
  for (const spec of Object.values(NEVER)) {
    for (const href of spec.links) {
      const link = page.locator(`#side a.navitem[href="${href}"]`);
      assert.equal(await link.count(), 1, `${href} remains in the markup`);
      assert.equal(await link.evaluate((node) => node.closest(".navgroup").dataset.fhSection), spec.placement, `${href}: current group`);
      assert.equal(await link.evaluate((node) => node.hasAttribute("data-fh-gated") && node.style.display === "none"), true, `${href}: gated`);
    }
  }
  for (const row of proof.rows) {
    if (/^Sidebar group '(Home|Watch|Automation)'/.test(row.control)) {
      // Exercised here and never handed to the catalog: see notAttached in fin-b19-rows.json.
      await proof.check(row.control, async () => {
        const key = row.control.match(/^Sidebar group '(\w+)'/)[1].toLowerCase();
        for (const role of EVERY_ROLE) {
          const visible = Object.values(await railOf(role)).flatMap((group) => group.links);
          for (const href of NEVER[key].links) assert.equal(visible.includes(href), false, `${role}: ${href}`);
        }
      });
    }
  }
  await page.close();
});

test("every listed row was exercised", () => {
  proof.assertAllClaimed();
});
