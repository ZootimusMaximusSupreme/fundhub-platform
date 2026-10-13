// Pipeline — drag and MOVE persist via POST /api/pipeline-cards.
//
// NO BACKEND.

import { test, expect } from "@playwright/test";
import { openScreen, json, OWNER, CLIENT_ID } from "./harness.mjs";

const STAGES = {
  ok: true,
  pipeline: "sales",
  total: 1,
  stages: [
    {
      key: "new_lead", name: "New Lead", sort_order: 0, count: 1, amount: 0,
      cards: [{
        id: "card-1", client_id: CLIENT_ID, name: "Dana Whitfield",
        owner: "Jordan Blake", entered_at: "2026-08-01T10:00:00Z",
        outcome_tier: null, funded: false, amount: 3000
      }]
    },
    {
      key: "booked", name: "Booked", sort_order: 2, count: 0, amount: 0, cards: []
    }
  ]
};

test.describe("pipeline board", () => {

  test("renders live cards with client ids", async ({ page }) => {
    await openScreen(page, "/app/pipeline.html", OWNER, {
      "/api/dashboard/pipeline": STAGES
    });
    await expect(page.locator('.card[data-client-id]')).toHaveCount(1);
    await expect(page.locator('.card[data-client-id]')).toContainText("Dana Whitfield");
  });

  test("MOVE posts a pipeline-cards move", async ({ page }) => {
    const writes = [];
    await openScreen(page, "/app/pipeline.html", OWNER, {
      "/api/dashboard/pipeline": STAGES,
      "/api/pipeline-cards": async (route, { method }) => {
        if (method === "POST") {
          const body = JSON.parse(route.request().postData() || "{}");
          writes.push(body);
          return json(route, { ok: true, action: "move", ...body });
        }
        return json(route, { ok: true });
      }
    });
    await expect(page.locator('.card[data-client-id]')).toHaveCount(1);
    await page.locator('.card[data-client-id] .c-btn.route').first().click();
    await expect.poll(async () =>
      page.locator("#routeMenu").evaluate((el) => el && !el.hidden)
    ).toBe(true);
    await page.locator('#routeMenu .rm-item[data-pipeline-key]').first().click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0].action).toBe("move");
    expect(writes[0].client_id).toBe(CLIENT_ID);
    expect(writes[0].pipeline_key).toBeTruthy();
    expect(writes[0].stage_key).toBeTruthy();
  });

  test("the phone and email links on a card stay taps; the rest of the card drags", async ({ page }) => {
    const writes = [];
    const withContact = JSON.parse(JSON.stringify(STAGES));
    Object.assign(withContact.stages[0].cards[0], { phone: "+1 602 555 0100", email: "dana@example.com" });
    await openScreen(page, "/app/pipeline.html", OWNER, {
      "/api/dashboard/pipeline": withContact,
      "/api/pipeline-cards": async (route, { method }) => {
        if (method === "POST") writes.push(JSON.parse(route.request().postData() || "{}"));
        return json(route, { ok: true, action: "move" });
      }
    });
    const link = page.locator('.card[data-client-id] .c-msg-link').first();
    await expect(link).toBeVisible();
    const l = await link.boundingBox();
    await page.mouse.move(l.x + 4, l.y + l.height / 2);
    await page.mouse.down();
    await expect(page.locator(".drag-card")).toHaveCount(0);
    // Let go away from the link, so the test does not follow it to messaging.
    await page.mouse.move(5, 5);
    await page.mouse.up();
    expect(writes).toHaveLength(0);
    // The empty part of the same row picks the card up.
    const row = page.locator('.card[data-client-id] .c-msg').first();
    const r = await row.boundingBox();
    const dest = await page.locator('.col[data-stage-key="booked"] .col-body').first().boundingBox();
    await page.mouse.move(r.x + r.width - 6, r.y + r.height / 2);
    await page.mouse.down();
    await expect(page.locator(".drag-card")).toHaveCount(1);
    await page.mouse.move(dest.x + dest.width / 2, dest.y + 20, { steps: 8 });
    await page.mouse.up();
    await expect.poll(() => writes.length, { timeout: 5000 }).toBe(1);
    expect(writes[0].stage_key).toBe("booked");
  });

  test("dropping a card onto another column posts a move", async ({ page }) => {
    const writes = [];
    await openScreen(page, "/app/pipeline.html", OWNER, {
      "/api/dashboard/pipeline": STAGES,
      "/api/pipeline-cards": async (route, { method }) => {
        if (method === "POST") {
          writes.push(JSON.parse(route.request().postData() || "{}"));
          return json(route, { ok: true, action: "move" });
        }
        return json(route, { ok: true });
      }
    });
    const card = page.locator('.card[data-client-id]').first();
    const dest = page.locator('.col[data-stage-key="booked"] .col-body').first();
    await expect(card).toBeVisible();
    await expect(dest).toBeVisible();
    const c = await card.boundingBox();
    const d = await dest.boundingBox();
    if (c && d) {
      await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2);
      await page.mouse.down();
      await page.mouse.move(d.x + d.width / 2, d.y + 20, { steps: 8 });
      await page.mouse.up();
      await expect.poll(() => writes.length, { timeout: 5000 }).toBeGreaterThan(0);
      expect(writes[0].stage_key).toBe("booked");
    }
  });

  // ── the "in stage" clock ─────────────────────────────────────────────────
  //
  // The board prints entered_at and labels it "in stage". Until migration 271
  // that column was stamped once when the card was created and never updated,
  // so a card moved into Funded five minutes ago printed "20d in stage" —
  // exactly what a card nobody had touched in twenty days printed. 271 makes
  // the column true. These two prove the SCREEN honours it: it must read
  // entered_at and nothing else, and the Age filter must select on that same
  // number.

  const agedStages = (enteredAt) => ({
    ok: true,
    pipeline: "sales",
    total: 1,
    stages: [
      {
        key: "new_lead", name: "New Lead", sort_order: 0, count: 1, amount: 0,
        cards: [{
          id: "card-1", client_id: CLIENT_ID, name: "Dana Whitfield",
          owner: "Jordan Blake", entered_at: enteredAt,
          outcome_tier: null, funded: false, amount: 3000
        }]
      },
      { key: "booked", name: "Booked", sort_order: 2, count: 0, amount: 0, cards: [] }
    ]
  });

  const agoISO = (mins) => new Date(Date.now() - mins * 60000).toISOString();

  test("a card that entered its stage minutes ago prints minutes, not its age", async ({ page }) => {
    await openScreen(page, "/app/pipeline.html", OWNER, {
      "/api/dashboard/pipeline": agedStages(agoISO(7))
    });
    // Seven minutes in stage. The card may be weeks old; the board must not say so.
    await expect(page.locator(".card .c-age")).toHaveText("7m in stage");
  });

  test("a card that has genuinely sat prints days in stage", async ({ page }) => {
    await openScreen(page, "/app/pipeline.html", OWNER, {
      "/api/dashboard/pipeline": agedStages(agoISO(5 * 1440))
    });
    await expect(page.locator(".card .c-age")).toHaveText("5d in stage");
  });

  test("'Over 3d in stage' keeps a stalled card and drops a just-moved one", async ({ page }) => {
    // Stalled: last moved five days ago. Survives the filter.
    await openScreen(page, "/app/pipeline.html", OWNER, {
      "/api/dashboard/pipeline": agedStages(agoISO(5 * 1440))
    });
    await page.locator("#filterBtn").click();
    await page.locator("#fAge").selectOption("4320");
    await expect(page.locator(".card[data-client-id]")).toBeVisible();

    // Same card, moved seven minutes ago. Filtered out — however old it is.
    await openScreen(page, "/app/pipeline.html", OWNER, {
      "/api/dashboard/pipeline": agedStages(agoISO(7))
    });
    await page.locator("#filterBtn").click();
    await page.locator("#fAge").selectOption("4320");
    await expect(page.locator(".card[data-client-id]")).toBeHidden();
  });
});
