// Offline browser acceptance: employee SOP document shortcuts -> existing Company Brain.
// No production sessions, providers, credit pulls or outbound messages.
import { test, expect } from "@playwright/test";
import { wireApi, withSession, json, OWNER, CLOSER, PARTNER } from "./harness.mjs";

const SCREENS = {
  "setter-dashboard.html": "setter",
  "closer-dashboard.html": "closer",
  "sales-floor.html": "sales",
  "pipeline.html": "onboarding",
  "bank-outreach.html": "bank-outreach",
  "lenders.html": "lenders",
  "inquiry-remover.html": "credit-repair",
  "client-control-panel.html": "funding",
  "csm-queue.html": "client-success",
  "ops-admin.html": "operations",
  "finance-os.html": "finance",
  "messaging.html": "communications",
  "calendar.html": "appointments",
  "documents.html": "documents",
  "my-numbers.html": "performance",
  "staff-teams.html": "staff-operations",
  "contracts.html": "agreements",
  "consent-capture.html": "consent"
};
const STAFF = (role) => ({ ok: true, staff: {
  id: "staff-fixture", name: "Taylor Test", email: "test@fundhub.example",
  role, org_id: "org-fixture", status: "active"
}});
const selectors = {
  shortcut: "#fh-sop-shortcut",
  search: "#fh-shell-search-btn",
  context: "#fh-sop-context"
};

async function setup(page, session = OWNER, handlers = {}) {
  await withSession(page, session);
  await wireApi(page, session, {
    "/api/company-brain/threads": { ok: true, threads: [] },
    "/api/company-brain/upload": { ok: true, uploads: [], pendingCount: 0 },
    "/api/company-brain/reviews": { ok: true, reviews: [] },
    ...handlers
  });
}

test("all eighteen working desks have a discoverable SOP link; existing refresh stays", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setup(page);
  for (const [screen, topic] of Object.entries(SCREENS)) {
    await page.goto("/app/" + screen);
    const link = page.locator(selectors.shortcut);
    await expect(link, screen + " has the staff SOP shortcut").toBeVisible();
    await expect(link).toHaveCount(1);
    await expect(link).toHaveAttribute("href", "company-brain.html?sop=" + topic);
    await expect(link).toHaveAttribute("aria-label", /scripts and SOPs/i);
    await expect(link).toHaveAttribute("data-fh-sop-topic", topic);
    await expect(link.locator(".fh-sop-label")).toHaveText("SOPs");
    await expect(link.locator(".fh-sop-label")).toBeVisible();
    await expect(page.locator("#fh-workspace-header")).toBeVisible();
  }
  await page.goto("/app/setter-dashboard.html");
  await expect(page.locator("#setter-refresh")).toBeVisible();
  await expect(page.locator(selectors.search)).toBeVisible();
  await page.goto("/app/csm-queue.html");
  await expect(page.locator("#qRefresh")).toBeVisible();
});

test("staff clicks document icon, gets contextual Knowledge Base search, then Back returns to dashboard", async ({ page }) => {
  const asks = [];
  // The existing Company Brain API grants setter tier-filtered STAFF access.
  await setup(page, STAFF("setter"), {
    "/api/read/company-brain": async (route) => {
      asks.push(route.request().postDataJSON());
      await json(route, { ok: true, thread_id: "7b000000-0000-4000-8000-000000000001",
        answer: { text: "Approved instructions, according to the cited source." }, sources: [] });
    }
  });
  await page.goto("/app/setter-dashboard.html");
  await expect(page.locator(selectors.shortcut)).toBeVisible();
  await page.locator(selectors.shortcut).click();
  await expect(page).toHaveURL(/company-brain\.html\?sop=setter$/);
  await expect(page.locator(selectors.context)).toBeVisible();
  await expect(page.locator("#tabAsk")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#fh-sop-title")).toHaveText("Setter scripts and onboarding");
  await expect(page.locator("#docList")).toBeHidden(); // org-wide owner-tier upload inventory is not a staff SOP list
  expect(asks).toEqual([]); // navigation itself MUST NOT write a chat message.
  await page.getByRole("button", { name: "Find approved instructions" }).click();
  await expect.poll(() => asks.length).toBe(1);
  expect(asks[0].question).toMatch(/setter calling script.*logging dials/i);
  await expect(page.locator("#chat")).toHaveAttribute("data-view", "ask");
  await expect(page.locator("#msgs")).toContainText("Approved instructions");
  await page.goBack();
  await expect(page).toHaveURL(/setter-dashboard\.html$/);
  await expect(page.locator(selectors.shortcut)).toBeVisible();
});

test("phone shortcut has a 44px target, opens search and returns without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const asks = [];
  // Exercise actual closer identity, not an owner impersonating the closer.
  await setup(page, CLOSER, {
    "/api/read/company-brain": async (route) => {
      asks.push(route.request().postDataJSON());
      await json(route, { ok: true, answer: { text: "See approved closer script." }, sources: [] });
    }
  });
  await page.goto("/app/closer-dashboard.html");
  const link = page.locator(selectors.shortcut);
  await expect(link).toBeVisible();
  const rect = await link.boundingBox();
  expect(rect && rect.width).toBeGreaterThanOrEqual(44);
  expect(rect && rect.height).toBeGreaterThanOrEqual(44);
  await link.click();
  await expect(page).toHaveURL(/company-brain\.html\?sop=closer$/);
  await expect(page.locator(selectors.context)).toBeVisible();
  await expect(page.locator("#docList")).toBeHidden();
  await page.locator("#fh-sop-find").click();
  await expect.poll(() => asks.length).toBe(1);
  expect(asks[0].question).toMatch(/closer discovery and sales scripts/);
  await expect(page.locator("#chat")).toHaveAttribute("data-view", "ask");
  await expect(page.locator("#msgs")).toContainText("approved closer script");
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.goBack();
  await expect(page).toHaveURL(/closer-dashboard\.html$/);
});

test("320px staff header stays on one row with a full-size SOP icon and usable CRM search", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 780 });
  await setup(page, OWNER);
  await page.goto("/app/pipeline.html");
  const shortcut = page.locator(selectors.shortcut);
  await expect(shortcut).toBeVisible();
  const measurements = await page.evaluate(() => {
    const header = document.querySelector("#fh-workspace-header");
    const tools = header.querySelector(".fh-workspace-tools");
    const shortcut = header.querySelector("#fh-sop-shortcut");
    const box = shortcut.getBoundingClientRect();
    const toolbar = tools.getBoundingClientRect();
    return {
      headerHeight: header.getBoundingClientRect().height,
      targetWidth: box.width, targetHeight: box.height,
      right: toolbar.right,
      overflow: document.documentElement.scrollWidth - innerWidth
    };
  });
  expect(measurements.headerHeight).toBeLessThanOrEqual(74);
  expect(measurements.targetWidth).toBeGreaterThanOrEqual(44);
  expect(measurements.targetHeight).toBeGreaterThanOrEqual(44);
  expect(measurements.right).toBeLessThanOrEqual(320);
  expect(measurements.overflow).toBeLessThanOrEqual(0);
  await expect(page.locator(selectors.search)).toBeVisible();
  await page.locator(selectors.search).click();
  await expect(page.locator("#fh-shell-search-overlay")).toHaveClass(/open/);
  await page.keyboard.press("Escape");
  await expect(page.locator("#fh-shell-search-overlay")).not.toHaveClass(/open/);
});

test("role-authorized employees get their correct SOP button; external principals get none", async ({ page }) => {
  const allowed = [
    [STAFF("setter"), "setter-dashboard.html", "setter"],
    [CLOSER, "closer-dashboard.html", "closer"],
    [STAFF("csm"), "csm-queue.html", "client-success"],
    [STAFF("funding_advisor"), "lenders.html", "lenders"],
    [STAFF("inquiry_specialist"), "inquiry-remover.html", "credit-repair"],
    [STAFF("sales_manager"), "sales-floor.html", "sales"]
  ];
  for (const [session, screen, topic] of allowed) {
    await setup(page, session);
    await page.goto("/app/" + screen);
    await expect(page.locator(selectors.shortcut)).toHaveAttribute("href", "company-brain.html?sop=" + topic);
  }
  await setup(page, STAFF("outbound_rep"));
  await page.goto("/app/bank-outreach.html");
  await expect(page.locator(selectors.shortcut)).toHaveCount(0);
  // outbound_rep is NOT in ROLE_SETS.STAFF. Do not widen that gate just for a link.
  await setup(page, PARTNER);
  await page.goto("/app/partner-training.html");
  await expect(page.locator(selectors.shortcut)).toHaveCount(0);
  await setup(page, STAFF("client"));
  await page.goto("/app/client-portal.html");
  await expect(page.locator(selectors.shortcut)).toHaveCount(0);
});

test("regular staff SOP navigation never reads the org-wide owner-tier upload inventory", async ({ page }) => {
  let uploadReads = 0;
  await setup(page, STAFF("setter"), {
    "/api/company-brain/upload": async (route) => {
      uploadReads += 1;
      await json(route, { ok: true, uploads: [{ id: "private", name: "Owner private memo", accessTier: "owner" }], pendingCount: 1 });
    }
  });
  await page.goto("/app/company-brain.html?sop=setter");
  await expect(page.locator(selectors.context)).toBeVisible();
  await expect(page.locator("#docList")).toBeHidden();
  await expect(page.locator("#tabManage")).toBeHidden();
  await page.locator("#tabTraining").click();
  await page.locator("#tabAsk").click();
  expect(uploadReads).toBe(0);
});

test("all deep-link topics are finite; bogus or injected SOP values render no instruction card", async ({ page }) => {
  await setup(page, OWNER);
  await page.goto("/app/company-brain.html?sop=%3Cscript%3E");
  await expect(page.locator("#fh-sop-context")).toBeHidden();
  await expect(page.locator("#chat")).not.toHaveClass(/docs-open/);
  await page.goto("/app/company-brain.html?sop=made-up");
  await expect(page.locator("#fh-sop-context")).toBeHidden();
  await expect(page.locator("#chat")).not.toHaveClass(/docs-open/);
});

test("Knowledge Base opens on approved guides, hides client scope, and separates training from file review", async ({ page }) => {
  await setup(page, OWNER, {
    "/api/company-brain/library": { ok: true, files: [
      { id: "sales-1", name: "Setter call guide", category: "Sales", url: "https://drive.google.com/sales-guide", source: "Drive" },
      { id: "funding-1", name: "Funding handoff", category: "Funding", url: null, source: "Upload" }
    ] },
    "/api/company-brain/upload": { ok: true, uploads: [{ id: "upload-1", name: "New file", approvalStatus: "pending" }], pendingCount: 1 },
    "/api/company-brain/reviews": { ok: true, reviews: [{ id: "review-1", file_name: "New file", proposed_tier: "staff", access_tier: "owner", rationale: "This file explains the current handoff." }] }
  });
  await page.goto("/app/company-brain.html");
  await expect(page.locator("#fh-workspace-header")).toBeVisible();
  await expect(page.locator("#fh-workspace-scope")).toHaveCount(0);
  await expect(page.locator("#tabAsk")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#browseGuides")).toBeHidden();
  await expect(page.locator("#libraryList")).toContainText("Setter call guide");
  await expect(page.locator("#libraryList")).toContainText("Funding handoff");
  await page.getByRole("button", { name: "Funding", exact: true }).click();
  await expect(page.locator("#libraryList")).not.toContainText("Setter call guide");
  await expect(page.locator("#libraryList")).toContainText("Funding handoff");
  await page.locator("#tabTraining").click();
  await expect(page.locator("#quizPick")).toBeVisible();
  await expect(page.locator("#libraryList")).toBeHidden();
  await page.locator("#tabManage").click();
  await expect(page.locator("#reviewPanel")).toBeVisible();
  await expect(page.locator("#reviewList")).toContainText("New file");
  await expect(page.locator("#reviewList details")).not.toHaveAttribute("open", "");
  await page.locator("#reviewList summary").click();
  await expect(page.locator("#reviewList details")).toHaveAttribute("open", "");
  await expect(page.locator("#docList")).toContainText("New file");
  await expect(page.locator("#quizPick")).toBeHidden();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("#tabManage")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});

test("an active chat can browse guides without losing its messages", async ({ page }) => {
  await setup(page, OWNER, {
    "/api/company-brain/library": { ok: true, files: [{ id: "sales-1", name: "Setter call guide", category: "Sales", url: null, source: "Upload" }] },
    "/api/read/company-brain": { ok: true, thread_id: "7b000000-0000-4000-8000-000000000001", answer: { text: "Use the setter script." }, sources: [] }
  });
  await page.goto("/app/company-brain.html");
  await page.locator("#q").fill("What is the call script?");
  await page.locator("#askBtn").click();
  await expect(page.locator("#msgs")).toContainText("Use the setter script.");
  await page.locator("#browseGuides").click();
  await expect(page.locator("#libraryList")).toContainText("Setter call guide");
  await page.locator("#browseGuides").click();
  await expect(page.locator("#msgs")).toContainText("Use the setter script.");
});

test("deleting a named chat confirms the consequence and removes it from the list", async ({ page }) => {
  const threadId = "7b000000-0000-4000-8000-000000000002";
  const deletes = [];
  await setup(page, OWNER, {
    "/api/company-brain/threads": async (route) => {
      if (route.request().method() === "DELETE") {
        deletes.push(route.request().url());
        return json(route, { ok: true });
      }
      return json(route, { ok: true, threads: [{ id: threadId, title: "Contract steps", messageCount: 2 }] });
    }
  });
  await page.goto("/app/company-brain.html");
  await expect(page.getByRole("button", { name: "Delete chat: Contract steps" })).toBeVisible();
  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain('Delete chat "Contract steps" and its messages?');
    await dialog.accept();
  });
  await page.getByRole("button", { name: "Delete chat: Contract steps" }).click();
  await expect(page.getByRole("button", { name: "Delete chat: Contract steps" })).toHaveCount(0);
  expect(deletes).toHaveLength(1);
  expect(deletes[0]).toContain("thread_id=" + threadId);
});

test("funding fulfillment and inquiry work have small source-linked SOPs at their task headings", async ({ page }) => {
  await setup(page, OWNER);
  await page.goto("/app/client-control-panel.html");
  const funding = page.locator('a.fh-step-sop[data-fh-sop-step="funding-round"]');
  const credit = page.locator('a.fh-step-sop[data-fh-sop-step="inquiry-case"]');
  await expect(funding).toHaveCount(1);
  await expect(credit).toHaveCount(1);
  await expect(funding).toHaveAttribute("href", "company-brain.html?sop=funding-round");
  // Funding and Credit start inside hidden tab panels. Open the real tab
  // before clicking the task SOP; a hidden link is not a usable shortcut.
  await page.locator("#ccp-tab-funding").click();
  await expect(funding).toBeVisible();
  await funding.click();
  await expect(page).toHaveURL(/company-brain\.html\?sop=funding-round$/);
  await expect(page.locator("#fh-sop-title")).toHaveText("Funding round SOP");
  await page.goBack();
  await expect(page).toHaveURL(/client-control-panel\.html#ccp-view-funding$/);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.locator("#ccp-tab-credit").click();
    await expect(credit).toBeVisible();
    const box = await credit.boundingBox();
    expect(box && box.width).toBeGreaterThanOrEqual(44);
    expect(box && box.height).toBeGreaterThanOrEqual(44);
  }
  await page.goto("/app/inquiry-remover.html");
  await expect(page.locator('a.fh-step-sop[data-fh-sop-step="inquiry-case"]').first()).toHaveAttribute(
    "href", "company-brain.html?sop=inquiry-case"
  );
});

test("setter call SOPs remain present after the selected-lead details redraw", async ({ page }) => {
  await setup(page, STAFF("setter"));
  await page.goto("/app/setter-dashboard.html");
  await expect(page.locator("#fh-sop-shortcut")).toBeVisible();
  await page.evaluate(() => {
    const details = document.querySelector("#setter-detail");
    details.innerHTML = '<section class="setter-section"><h3>Call result</h3></section>' +
      '<section class="setter-section"><h3>Closer handoff</h3></section>';
  });
  await expect(page.locator('a[data-fh-sop-step="setter-calls"]')).toHaveCount(1);
  await expect(page.locator('a[data-fh-sop-step="setter-handoff"]')).toHaveCount(1);
  await page.evaluate(() => {
    document.querySelector("#setter-detail").innerHTML =
      '<section class="setter-section"><h3>Call result</h3></section>';
  });
  await expect(page.locator('a[data-fh-sop-step="setter-calls"]')).toHaveCount(1);
});

test("external bank reps never receive a staff SOP or task link", async ({ page }) => {
  await setup(page, STAFF("outbound_rep"));
  await page.goto("/app/bank-outreach.html");
  await expect(page.locator("#fh-sop-shortcut")).toHaveCount(0);
  await expect(page.locator(".fh-step-sop")).toHaveCount(0);
});


test("task SOPs survive staff queue and heading redraws without duplicate links", async ({ page }) => {
  await setup(page, OWNER);
  await page.goto("/app/csm-queue.html");
  await page.evaluate(() => {
    document.querySelector("#qList").innerHTML =
      '<article class="q-row"><h3 class="q-form-heading">Conversation notes</h3></article>';
  });
  await expect(page.locator("#qList .fh-step-sop")).toHaveAttribute("href", "company-brain.html?sop=csm-followup");
  await expect(page.locator("#qList .fh-step-sop")).toHaveCount(1);

  const redraws = [
    ["pipeline.html", "#fhDrawerName", "Selected lead", "onboarding"],
    ["documents.html", ".documents-intro h2", "Signed agreements", "documents"],
    ["contracts.html", "#editorTitle", "Client funding agreement", "agreements"],
    ["consent-capture.html", "#ccTitle", "Credit report authorization", "consent"]
  ];
  for (const [screen, selector, newLabel, topic] of redraws) {
    await page.goto("/app/" + screen);
    await page.evaluate(({ selector, newLabel }) => {
      document.querySelector(selector).textContent = newLabel;
    }, { selector, newLabel });
    const link = page.locator(screen === "documents.html" ? ".documents-intro .fh-step-sop" :
      (screen === "consent-capture.html" || screen === "pipeline.html") ? selector + " + a.fh-step-sop" : selector + " a.fh-step-sop");
    await expect(link).toHaveCount(1);
    await expect(link).toHaveAttribute("href", "company-brain.html?sop=" + topic);
  }
});
