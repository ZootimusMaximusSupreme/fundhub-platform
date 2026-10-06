// Products, client control panel, calendar — the persist / handler fixes.

import { test, expect } from "@playwright/test";
import { openScreen, json, OWNER, CLIENT_ID } from "./harness.mjs";

test.describe("products & commissions", () => {

  test("Save posts to /api/products", async ({ page }) => {
    const writes = [];
    await openScreen(page, "/app/products-commissions.html", OWNER, {
      "/api/read/products": {
        ok: true, count: 1, limit: 200, offset: 0, hasMore: false,
        items: [{
          code: "funding_bundle", name: "Funding Bundle", category: "funding",
          default_price: 3000, min_price: 2000, max_price: 5000,
          price_is_variable: true, active_rules: 1
        }]
      },
      "/api/read/commissions": { ok: true, count: 0, items: [] },
      "/api/products": async (route, { method }) => {
        if (method === "POST") {
          const body = JSON.parse(route.request().postData() || "{}");
          writes.push(body);
          return json(route, {
            ok: true, action: body.action,
            product: {
              id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
              code: body.code || "funding_bundle",
              name: body.name, category: body.category,
              default_price: body.default_price, min_price: body.min_price,
              max_price: body.max_price, price_is_variable: body.price_is_variable
            }
          });
        }
        return json(route, { ok: true });
      }
    });
    await page.locator("tr[data-p], #prodBody tr, tbody tr").first().click();
    const name = page.locator("#p_name");
    await expect(name).toBeVisible({ timeout: 5000 });
    await name.fill("Funding Bundle Plus");
    await page.locator("#edSave").click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0].action).toBe("save");
    expect(writes[0].name).toBe("Funding Bundle Plus");
  });

  test("rails column stays empty rather than inventing funnels", async ({ page }) => {
    await openScreen(page, "/app/products-commissions.html", OWNER, {
      "/api/read/products": {
        ok: true, count: 1, items: [{
          code: "funding_bundle", name: "Funding Bundle", category: "funding",
          default_price: 3000, min_price: 2000, max_price: 5000,
          price_is_variable: true, active_rules: 0
        }]
      },
      "/api/read/commissions": { ok: true, items: [] }
    });
    await expect(page.locator("body")).not.toContainText("Sales · Card Stacking · Repair");
  });

  test("tiered rules use API fields and do not show unsupported edit controls", async ({ page }) => {
    await openScreen(page, "/app/products-commissions.html", OWNER, {
      "/api/read/products": { ok: true, count: 0, items: [] },
      "/api/read/commissions": { ok: true, count: 0, items: [] },
      "/api/commission-rules": {
        ok: true, count: 1, rules: [{
          id: "77777777-7777-4777-8777-777777777777", name: "Tiered closer rule",
          basis: "front_end", stacking: "base", product_id: null, product_name: null,
          role: "closer", staff_id: null, staff_name: null, calc_method: "tiered",
          amount_basis: "deposit_collected", effective_from: "2026-08-20T00:00:00Z",
          effective_to: null, notes: "Owner-set", tiers: [{
            min_amount: "1000.00", max_amount: "5000.00", percent: "10.00",
            flat_amount: null, per_unit_amount: null
          }]
        }]
      }
    });
    await page.getByRole("button", { name: "Commission rules", exact: true }).click();
    await page.locator(".rule-hd").click();
    await expect(page.locator(".tierbox")).toContainText("$1,000 → $5,000");
    await expect(page.locator(".tierbox")).toContainText("10%");
    await expect(page.getByRole("button", { name: "Change rate", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Close v/ })).toHaveCount(0);
  });

  test("commission read failure is not painted as zero rules", async ({ page }) => {
    await openScreen(page, "/app/products-commissions.html", OWNER, {
      "/api/read/products": { ok: true, count: 0, items: [] },
      "/api/read/commissions": { ok: true, count: 0, items: [] },
      "/api/commission-rules": { ok: false, error: "read_failed" }
    });
    await page.getByRole("button", { name: "Commission rules", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("Commission rules could not be loaded");
    await expect(page.locator("#ruleList")).not.toContainText("No commission rules are on file yet");
    await expect(page.locator("#kRules")).toHaveText("—");
  });
});

test.describe("client control panel open buttons", () => {

  /* THE MORE MENU WAS REBUILT IN THE 2026-08-16 CRM MERGE (e2776fd46). The
     data-open buttons are gone; "Open Funding Matrix" is a real link to the
     lender matrix for this client (wireLinks: lenders.html?client_id=…). The
     CRM Contact button went with the CRM itself (owner 2026-08-15, "GHL is
     out" — 168_retire_ghl_agents.sql). Re-pointed 2026-10-05. */
  test("Open Funding Matrix goes to the lender matrix with the client id", async ({ page }) => {
    await openScreen(page, `/app/client-control-panel.html?id=${CLIENT_ID}`, OWNER);
    await page.locator("#more-menu summary, details.more > summary").click();
    const btn = page.locator("#ccp-link-lenders");
    await expect(btn).toBeVisible();
    await btn.click();
    await expect(page).toHaveURL(new RegExp(`lenders\\.html\\?client_id=${CLIENT_ID}`));
  });

  test("No CRM Contact control is offered — the old CRM is retired", async ({ page }) => {
    await openScreen(page, `/app/client-control-panel.html?id=${CLIENT_ID}`, OWNER);
    await expect(page.locator("#more-menu")).toBeAttached({ timeout: 10_000 });
    await expect(page.locator('[data-open="ghl"]')).toHaveCount(0);
  });

  test("Raw Report stays hidden until a real report file exists", async ({ page }) => {
    await openScreen(page, `/app/client-control-panel.html?id=${CLIENT_ID}`, OWNER);
    await expect(page.getByRole('button', { name: 'Raw Report', exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Raw Report', exact: true })).toHaveCount(0);
    await expect(page.getByText('Raw Report', { exact: true })).toHaveCount(0);
  });

  test("Save notes writes the open client and the typed note", async ({ page }) => {
    const writes = [];
    await openScreen(page, `/app/client-control-panel.html?id=${CLIENT_ID}`, OWNER, {
      "/api/client-notes": async (route) => {
        writes.push(JSON.parse(route.request().postData() || "{}"));
        return json(route, { ok: true, client: { id: CLIENT_ID, staff_notes: "Call Friday." } });
      }
    });
    await page.locator('[aria-controls="details-body"]').click();
    await page.locator("#notes").fill("Call Friday.");
    await page.locator("#notes-save").click();
    await expect(page.locator("#notes-status")).toContainText("Saved to this client file.");
    expect(writes).toEqual([{ client_id: CLIENT_ID, notes: "Call Friday." }]);
  });

  test("Open Bank Inbox shows this client's bank messages", async ({ page }) => {
    await openScreen(page, `/app/client-control-panel.html?id=${CLIENT_ID}`, OWNER, {
      "/api/read/bank-inbox": {
        ok: true, count: 1, items: [{
          subject: "Deposit received", body_preview: "Funding deposit cleared."
        }]
      }
    });
    await page.locator("#more-menu summary, details.more > summary").click();
    await page.locator("#ccp-bank-inbox-open").click();
    await expect(page.locator("#ccp-bank-inbox")).toContainText("Deposit received");
    await expect(page.locator("#ccp-bank-inbox")).toContainText("Funding deposit cleared.");
  });
});

test.describe("calendar Join Call and Client file", () => {

  test("buttons are disabled when nothing is up next", async ({ page }) => {
    await openScreen(page, "/app/calendar.html", OWNER, {
      "/api/tasks": { ok: true, tasks: [] }
    });
    await expect(page.locator("#unJoin")).toBeDisabled();
    await expect(page.locator("#unFile")).toBeDisabled();
  });

  test("Client file enables when a dated task has a client_id", async ({ page }) => {
    const due = new Date();
    due.setHours(due.getHours() + 1);
    await openScreen(page, "/app/calendar.html", OWNER, {
      "/api/tasks": {
        ok: true,
        tasks: [{
          id: "task-1", client_id: CLIENT_ID, client_name: "Dana Whitfield",
          title: "Follow-up call", body: "Confirm docs",
          due_at: due.toISOString(), assignee_name: "Jordan Blake", done: false
        }]
      }
    });
    await expect(page.locator("#unFile")).toBeEnabled({ timeout: 5000 });
    await page.locator("#unFile").click();
    await expect(page).toHaveURL(new RegExp(`client-control-panel\\.html\\?client_id=${CLIENT_ID}`));
  });

  test("Join Call stays disabled without a meeting URL", async ({ page }) => {
    const due = new Date();
    due.setHours(due.getHours() + 1);
    await openScreen(page, "/app/calendar.html", OWNER, {
      "/api/tasks": {
        ok: true,
        tasks: [{
          id: "task-1", client_id: CLIENT_ID, client_name: "Dana Whitfield",
          title: "Follow-up call", due_at: due.toISOString(), done: false
        }]
      }
    });
    await expect(page.locator("#unJoin")).toBeDisabled();
  });

  test("clicking a calendar event makes it Up Next", async ({ page }) => {
    /* The page's clock is pinned to 9am today, the way e2e/calendar.spec.mjs
       does it. "Now plus two hours" is tomorrow after 10pm, so the picked event
       was not on today's grid and this failed every night from 10pm to
       midnight (measured 2026-10-05, 22:40 Arizona). */
    const nineAm = new Date();
    nineAm.setHours(9, 0, 0, 0);
    await page.clock.setFixedTime(nineAm);
    const firstDue = new Date(nineAm);
    firstDue.setHours(10);
    const pickedDue = new Date(nineAm);
    pickedDue.setHours(11);
    await openScreen(page, "/app/calendar.html", OWNER, {
      "/api/tasks": {
        ok: true,
        tasks: [
          {
            id: "task-first", client_id: CLIENT_ID, client_name: "First Client",
            title: "First calendar event", due_at: firstDue.toISOString(), done: false
          },
          {
            id: "task-event", client_id: CLIENT_ID, client_name: "Dana Whitfield",
            title: "Calendar event pick", body: "Picked from the day grid",
            due_at: pickedDue.toISOString(), done: false
          }
        ]
      }
    });
    await page.locator('.evt[data-task-id="task-event"]').click();
    await expect(page.locator("#unClient")).toContainText("Dana Whitfield");
    await expect(page.locator("#unBody")).toContainText("Calendar event pick");
  });
});
