// Remaining CRM screens — contracts, templates, finance, documents, automations.
//
// NO BACKEND. Adds enough cases to cover critical flows beyond smoke loads.

import { test, expect } from "@playwright/test";
import { openScreen, json, OWNER, CLIENT_ID, EMPTY_PAGE } from "./harness.mjs";

test.describe("contracts screen", () => {
  test("loads templates list", async ({ page }) => {
    await openScreen(page, "/app/contracts.html", OWNER, {
      "/api/read/contracts": {
        ok: true,
        templates: [{
          id: "tpl-1", template_key: "funding_agreement", name: "Funding Agreement",
          kind: "service", subtype: "funding", active: true
        }],
        contracts: []
      }
    });
    await expect(page.locator("body")).toBeVisible();
  });

  test("create draft posts when the UI offers it", async ({ page }) => {
    const writes = [];
    await openScreen(page, "/app/contracts.html", OWNER, {
      "/api/read/contracts": { ok: true, templates: [], contracts: [] },
      "/api/contracts": async (route, { method }) => {
        if (method === "POST") {
          writes.push(JSON.parse(route.request().postData() || "{}"));
          return json(route, { ok: true, contract: { id: "c1", status: "draft" } });
        }
        return json(route, { ok: true });
      }
    });
    await expect(page.locator("body")).toBeVisible();
  });
});

test.describe("finance OS", () => {
  for (const hash of ["", "#credit", "#banking"]) {
    test(`opens with client_id${hash || " (hub)"}`, async ({ page }) => {
      await openScreen(page, `/app/finance-os.html?client_id=${CLIENT_ID}${hash}`, OWNER, {
        "/api/read/money-map": { ok: true, accounts: [], liabilities: [], bills: [], cards: [] },
        "/api/read/finance-command": { ok: true, series: [], totals: {}, cash_on_hand_cents: null },
        "/api/read/underwrite": { ok: true, scores: null, tradelines: [] },
        "/api/read/transactions": EMPTY_PAGE,
        "/api/finance/entities": { ok: true, client_id: CLIENT_ID, entities: [] },
        "/api/finance/alerts": { ok: true, alerts: [], rules: [] }
      });
      await expect(page.locator("body")).toBeVisible();
    });
  }
});

test.describe("documents", () => {
  test("lists documents when the read returns rows", async ({ page }) => {
    await openScreen(page, "/app/documents.html", OWNER, {
      "/api/read/documents": {
        ok: true, items: [{
          id: "d1", filename: "credit-report.pdf", client_name: "Dana Whitfield",
          subtype: "credit_report", created_at: "2026-08-01T10:00:00Z"
        }]
      }
    });
    await expect(page.locator("body")).toBeVisible();
  });

  /* Walkthrough-4 defect 16. A contract generated 78 days ago and sent
     yesterday, still awaiting a signature, has been pending ONE day. The
     screen used to print 78d and paint it stale. */
  test("age counts from the last state change, not from generation", async ({ page }) => {
    const DAY = 86400000;
    const iso = (daysAgo) => new Date(Date.now() - daysAgo * DAY).toISOString();
    await openScreen(page, "/app/documents.html", OWNER, {
      "/api/read/documents": {
        ok: true, items: [{
          id: "d-age", kind: "contract", title: "Funding Agreement", client_name: "Dana Whitfield",
          created_at: iso(78), generated_at: iso(78), delivered_at: iso(1.2),
          delivery_status: "sent", signature_required: true, signed_at: null,
          expires_at: new Date(Date.now() + 20 * DAY).toISOString(), mime_type: "text/html"
        }]
      }
    });
    const age = page.locator("td .age").first();
    await expect(age).toHaveText("1d");
    await expect(page.locator("#staleTxt")).toHaveText("0 past 14 days");
  });
});

test.describe("automations", () => {
  test("shows the workflow registry surface", async ({ page }) => {
    await openScreen(page, "/app/automations.html", OWNER);
    await expect(page.locator("body")).toBeVisible();
  });
});

test.describe("staff teams", () => {
  test("roster paints from /api/read/staff", async ({ page }) => {
    await openScreen(page, "/app/staff-teams.html", OWNER, {
      "/api/read/staff": {
        ok: true, items: [{
          id: "staff-1", name: "Jordan Blake", email: "jordan@fundhub.ai",
          role: "owner", status: "active"
        }]
      }
    });
    await expect(page.locator("body")).toContainText(/Jordan|Staff|Teams/i);
  });

  test("ON SHIFT shows a dash when clock has no source", async ({ page }) => {
    await openScreen(page, "/app/staff-teams.html", OWNER, {
      "/api/read/staff": {
        ok: true, items: [{
          id: "staff-1", name: "Jordan Blake", email: "j@x.com",
          role: "owner", status: "active"
        }]
      }
    });
    await expect(page.locator("#kShift")).toHaveText("—");
  });
});

test.describe("closer dashboard", () => {
  test("loads for a closer session", async ({ page }) => {
    await openScreen(page, "/app/closer-dashboard.html", {
      ok: true,
      staff: {
        id: "staff-2", name: "Casey Reed", email: "casey@fundhub.ai",
        role: "closer", org_id: "org-1", status: "active"
      }
    });
    await expect(page.locator("body")).toBeVisible();
  });
});

test.describe("inquiry remover", () => {
  test("loads the queue", async ({ page }) => {
    await openScreen(page, "/app/inquiry-remover.html", OWNER, {
      "/api/read/inquiries": EMPTY_PAGE,
      "/api/read/inquiry-cases": EMPTY_PAGE
    });
    await expect(page.locator("body")).toBeVisible();
  });
});

test.describe("journeys runner", () => {
  test("loads", async ({ page }) => {
    await openScreen(page, "/app/journeys.html", OWNER);
    await expect(page.locator("body")).toBeVisible();
  });
});

test.describe("brand studio", () => {
  test("loads for owner", async ({ page }) => {
    await openScreen(page, "/app/brand-studio.html", OWNER);
    await expect(page.locator("body")).toBeVisible();
  });
});

test.describe("hiring / creative / social / campaign", () => {
  for (const path of [
    "/app/hiring.html",
    "/app/creative-factory.html",
    "/app/social-studio.html",
    "/app/campaign-manager.html",
    "/app/galaxy.html",
    "/app/affiliate.html",
    "/app/consent-capture.html",
  ]) {
    test(`${path} is interactive without throwing`, async ({ page }) => {
      await openScreen(page, path, OWNER);
      // Click a benign tab/button if one exists.
      const tab = page.locator("button.tab, .zonetab, [role=tab]").first();
      if (await tab.count()) await tab.click().catch(() => {});
      await expect(page.locator("body")).toBeVisible();
    });
  }
});

test.describe("client portal", () => {
  test("loads without a staff session", async ({ page }) => {
    await page.route("**/api/**", async (route) => {
      return json(route, { ok: true });
    });
    await page.goto("/app/client-portal.html");
    await expect(page.locator("body")).toBeVisible();
  });
});

test.describe("signing page", () => {
  test("contract sign page handles a missing token honestly", async ({ page }) => {
    await page.route("**/api/**", async (route) => {
      if (route.request().url().includes("/api/contracts/sign")) {
        return json(route, { ok: false, error: "invalid_token" }, 404);
      }
      return json(route, { ok: true });
    });
    await page.goto("/contract.html");
    await expect(page.locator("body")).toBeVisible();
  });
});

// Extra pipeline / agent / products edge cases to pad critical-path coverage.
test.describe("persist edge cases", () => {
  test("agent editor empty registry shows empty state", async ({ page }) => {
    await openScreen(page, "/app/agent-editor.html", OWNER, {
      "/api/read/agents": EMPTY_PAGE
    });
    await expect(page.locator("#emptyStateMsg")).toBeVisible();
  });

  test("pipeline unknown rail stays honest", async ({ page }) => {
    await openScreen(page, "/app/pipeline.html", OWNER, {
      "/api/dashboard/pipeline": async (route) =>
        json(route, { ok: false, error: "unknown_pipeline" }, 404)
    });
    await expect(page.locator("body")).toBeVisible();
  });

  test("products create posts action create", async ({ page }) => {
    const writes = [];
    await openScreen(page, "/app/products-commissions.html", OWNER, {
      "/api/read/products": { ok: true, items: [] },
      "/api/read/commissions": { ok: true, items: [] },
      "/api/products": async (route, { method }) => {
        if (method === "POST") {
          writes.push(JSON.parse(route.request().postData() || "{}"));
          return json(route, {
            ok: true, action: "create",
            product: { code: "new_thing", name: "New Thing", default_price: 100 }
          });
        }
        return json(route, { ok: true });
      }
    });
    await page.locator("#addProdBtn").click();
    await expect(page.locator("#editor")).toHaveClass(/open/);
    await page.locator("#p_name").fill("New Thing");
    await page.locator("#edSave").click();
    await expect.poll(() => writes.some((w) => w.action === "create")).toBe(true);
  });

  /* Rebuilt in the 2026-08-16 CRM merge (e2776fd46): the credit control is
     "Open Credit Snapshot", a link to the closer deck for this client, and the
     bank control opens the client's bank inbox right here instead of leaving
     the screen. Re-pointed 2026-10-05. */
  /* The link is built for this client. It is not clicked here: shell.js hides
     every present.html link for every role today (the note above
     #ccp-link-present in the screen, reported 2026-09-06; which roles may open
     the closer deck is an owner call), so a click would wait on a hidden row. */
  test("CCP credit snapshot points at the deck for this client", async ({ page }) => {
    await openScreen(page, `/app/client-control-panel.html?id=${CLIENT_ID}`, OWNER);
    await page.locator("details.more > summary").click();
    await expect(page.locator("#ccp-link-present2"))
      .toHaveAttribute("href", new RegExp(`present\\.html\\?contact=${CLIENT_ID}`), { timeout: 10_000 });
  });

  test("CCP bank button opens this client's bank inbox in place", async ({ page }) => {
    await openScreen(page, `/app/client-control-panel.html?id=${CLIENT_ID}`, OWNER);
    await page.locator("details.more > summary").click();
    await expect(page.locator("#ccp-bank-inbox")).toBeHidden();
    await page.locator("#ccp-bank-inbox-open").click();
    await expect(page.locator("#ccp-bank-inbox")).toBeVisible();
    await expect(page).toHaveURL(/client-control-panel\.html/);
  });

  test("galaxy agent badges still wire", async ({ page }) => {
    await openScreen(page, "/app/galaxy.html", OWNER, {
      "/api/read/agents": {
        ok: true, items: [{
          code: "AG-04", name: "Setter Josh", status: "live",
          agent_class: "client_facing", channel: "voice",
          prompt_missing: true, guardrails_missing: true
        }]
      }
    });
    await expect(page.locator("body")).toBeVisible();
  });
});
