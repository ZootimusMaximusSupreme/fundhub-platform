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

  test("formats the card and drawer phone while keeping the raw search and text target", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const stages = structuredClone(STAGES);
    stages.stages[0].cards[0].phone = "+14702920106";
    stages.stages[0].cards[0].email = "dana@example.com";
    await openScreen(page, "/app/pipeline.html", OWNER, {
      "/api/dashboard/pipeline": stages,
      "/api/dashboard/client": { ok: true, client: { id: CLIENT_ID, phone: "+14702920106", email: "dana@example.com", custom_fields: {} } }
    });

    const card = page.locator('.card[data-client-id="' + CLIENT_ID + '"]').first();
    const phone = card.locator('.c-msg-link[href*="channel=sms"]');
    await expect(phone).toHaveText("(470) 292-0106");
    await expect(phone).toHaveAttribute("href", "messaging.html?client_id=" + CLIENT_ID + "&channel=sms");
    await expect(card).toHaveAttribute("data-search", /\+14702920106/);
    expect(await phone.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    if (process.env.CRM_PHONE_EVIDENCE) {
      await phone.scrollIntoViewIfNeeded();
      await page.evaluate(() => {
        const box = document.querySelector('.card[data-client-id] .c-msg-link[href*="channel=sms"]').getBoundingClientRect();
        const mark = document.createElement("div");
        mark.innerHTML = '<svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg"><defs><marker id="tip" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto"><path d="M0 0 L9 4.5 L0 9" fill="none" stroke="#eab308" stroke-width="2"/></marker></defs><ellipse cx="' + (box.left + box.width / 2) + '" cy="' + (box.top + box.height / 2) + '" rx="' + (box.width / 2 + 8) + '" ry="' + (box.height / 2 + 8) + '" fill="none" stroke="#dc2626" stroke-width="4"/><line x1="' + (box.right + 65) + '" y1="' + (box.top - 33) + '" x2="' + (box.right + 8) + '" y2="' + box.top + '" stroke="#eab308" stroke-width="4" marker-end="url(#tip)"/><circle cx="' + (box.left - 16) + '" cy="' + (box.top - 17) + '" r="14" fill="#dc2626"/><text x="' + (box.left - 16) + '" y="' + (box.top - 12) + '" text-anchor="middle" fill="white" font-size="16" font-weight="700">1</text></svg><div style="position:absolute;bottom:12px;left:12px;right:12px;padding:8px;background:white;color:#111;border:2px solid #dc2626;font:14px system-ui">1. US phone numbers are now easy to read on every CRM contact view.</div>';
        Object.assign(mark.style, { position: "fixed", inset: "0", zIndex: "999999", pointerEvents: "none" });
        document.body.appendChild(mark);
      });
      await page.screenshot({ path: "ops/workflows/crm-phone-formatting-2026-10-30-MARKED.png" });
    }
    await card.locator(".c-name").click();
    await expect(page.locator('#fhDrawerBody .fh-drawer-row').filter({ hasText: "Phone" }))
      .toContainText("(470) 292-0106");
  });

  test("renders live cards with client ids", async ({ page }) => {
    await openScreen(page, "/app/pipeline.html", OWNER, {
      "/api/dashboard/pipeline": STAGES
    });
    await expect(page.locator('.card[data-client-id]')).toHaveCount(1);
    await expect(page.locator('.card[data-client-id]')).toContainText("Dana Whitfield");
  });

  test("shows the booked day and Phoenix time near the name, separate from confirmation", async ({ page }) => {
    const stages = structuredClone(STAGES);
    stages.stages[0].cards[0].booked_starts_at = "2030-05-01T17:00:00.000Z";
    stages.stages[0].cards[0].call_confirmed = true;
    await openScreen(page, "/app/pipeline.html", OWNER, {
      "/api/dashboard/pipeline": stages
    });

    const card = page.locator('.card[data-client-id]');
    await expect(card.locator('.c-booked-when')).toHaveText("Booked · Wed, May 1, 2030, 10:00 AM MST");
    await expect(card.locator('.c-call-confirmed')).toHaveText("✓ Call confirmed");
    await expect(card.locator('.c-name')).toBeVisible();
    await expect(card.locator('.c-booked-when')).toBeVisible();
  });

  test("leaves the booking label off cards without an active call", async ({ page }) => {
    await openScreen(page, "/app/pipeline.html", OWNER, {
      "/api/dashboard/pipeline": STAGES
    });
    await expect(page.locator('.card[data-client-id] .c-booked-when')).toHaveCount(0);
  });

  test("keeps a past booked time visible while the card remains on the board", async ({ page }) => {
    const stages = structuredClone(STAGES);
    stages.stages[0].cards[0].booked_starts_at = "2020-05-01T17:00:00.000Z";
    await openScreen(page, "/app/pipeline.html", OWNER, {
      "/api/dashboard/pipeline": stages
    });
    await expect(page.locator('.card[data-client-id] .c-booked-when'))
      .toHaveText("Booked · Fri, May 1, 2020, 10:00 AM MST");
  });

  test("opens the card with Contact, Call, Credit, then Survey before other details", async ({ page }) => {
    await openScreen(page, "/app/pipeline.html", OWNER, {
      "/api/dashboard/pipeline": STAGES
    });
    await page.locator('.card[data-client-id] .c-name').click();
    await expect(page.locator('#fhDrawerBody > .fh-drawer-sec h3')).toHaveText([
      "Contact", "Call", "Credit", "Survey", "Businesses", "Path", "How they got here"
    ]);
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
