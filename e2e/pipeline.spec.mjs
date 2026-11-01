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

  test("calls a rescheduled appointment Rescheduled, without claiming the old time is current", async ({ page }) => {
    const stages = structuredClone(STAGES);
    stages.stages[0].cards[0].booked_starts_at = "2030-05-02T17:00:00.000Z";
    stages.stages[0].cards[0].booked_kind = "rescheduled";
    await openScreen(page, "/app/pipeline.html", OWNER, {
      "/api/dashboard/pipeline": stages
    });
    await expect(page.locator(".card[data-client-id] .c-booked-when"))
      .toHaveText("Rescheduled · Thu, May 2, 2030, 10:00 AM MST");
  });

  test("calls a new booking after an earlier booking Booked again", async ({ page }) => {
    const stages = structuredClone(STAGES);
    stages.stages[0].cards[0].booked_starts_at = "2030-05-02T17:00:00.000Z";
    stages.stages[0].cards[0].booked_kind = "rebooked";
    await openScreen(page, "/app/pipeline.html", OWNER, {
      "/api/dashboard/pipeline": stages
    });
    await expect(page.locator(".card[data-client-id] .c-booked-when"))
      .toHaveText("Booked again · Thu, May 2, 2030, 10:00 AM MST");
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

  test("opens a pre-credit card with real survey answers FIRST, not below credit", async ({ page }) => {
    await openScreen(page, "/app/pipeline.html", OWNER, {
      "/api/dashboard/pipeline": STAGES,
      "/api/dashboard/client?id=": {
        ok: true,
        client: {
          id: CLIENT_ID, first_name: "Dana", last_name: "Whitfield",
          custom_fields: {
            cf_svy_funding_target_amount_label: "$100k - $250k",
            cf_svy_planned_use_label: "Fund inventory",
            cf_svy_self_reported_fico_label: "700-749"
          }
        },
        tri_merge: { experian: null, equifax: null, transunion: null, source: null, sample: false }
      }
    });
    await page.locator('.card[data-client-id] .c-name').click();
    await expect(page.locator('#fhDrawerBody')).toContainText("Fund inventory");
    await expect(page.locator('#fhDrawerBody > .fh-drawer-sec h3')).toHaveText([
      "Contact", "Call", "Survey", "Credit", "Businesses", "Path", "How they got here"
    ]);
  });

  test("promotes Credit over Survey after a genuine score, never for a simulated report", async ({ page }) => {
    const detail = {
      ok: true, client: {
        id: CLIENT_ID, custom_fields: { cf_svy_planned_use_label: "Fund inventory" }
      },
      tri_merge: {
        experian: 745, equifax: 739, transunion: 742,
        source: "crs_results", asOf: "2026-10-29T17:00:00.000Z", sample: false
      }
    };
    await openScreen(page, "/app/pipeline.html", OWNER, {
      "/api/dashboard/pipeline": STAGES,
      "/api/dashboard/client?id=": detail
    });
    await page.locator('.card[data-client-id] .c-name').click();
    await expect(page.locator('#fhDrawerBody')).toContainText("Fund inventory");
    await expect(page.locator('#fhDrawerBody > .fh-drawer-sec h3')).toHaveText([
      "Contact", "Call", "Credit", "Survey", "Businesses", "Path", "How they got here"
    ]);
    detail.tri_merge.sample = true;
    await page.locator('#fhDrawerClose').click();
    await page.locator('.card[data-client-id] .c-name').click();
    await expect(page.locator('#fhDrawerBody > .fh-drawer-sec h3').nth(2)).toHaveText("Survey");
  });

  test("keeps incomplete real credit below the survey", async ({ page }) => {
    await openScreen(page, "/app/pipeline.html", OWNER, {
      "/api/dashboard/pipeline": STAGES,
      "/api/dashboard/client?id=": {
        ok: true, client: { id: CLIENT_ID, custom_fields: { cf_svy_planned_use_label: "Fund inventory" } },
        tri_merge: { experian: 745, equifax: null, transunion: 742,
          source: "crs_results", asOf: "2026-10-29T17:00:00.000Z", sample: false }
      }
    });
    await page.locator('.card[data-client-id] .c-name').click();
    await expect(page.locator('#fhDrawerBody > .fh-drawer-sec h3')).toHaveText([
      "Contact", "Call", "Survey", "Credit", "Businesses", "Path", "How they got here"
    ]);
  });

  test("sorts Sales cards by soonest upcoming call, then recent past, then unscheduled", async ({ page }) => {
    const stages = structuredClone(STAGES);
    const at = (deltaDays) => new Date(Date.now() + deltaDays * 86400000).toISOString();
    const sample = (id, when) => ({
      ...stages.stages[0].cards[0], id: "card-" + id, name: id, client_id: id,
      booked_starts_at: when, entered_at: "2026-10-01T00:00:00Z"
    });
    stages.stages[0].cards = [
      sample("No booking", null), sample("Far future", at(4)),
      sample("Old past", at(-8)), sample("Soon", at(1)),
      sample("Recent past", at(-1)), sample("Next", at(2))
    ];
    stages.stages[0].count = 6;
    await openScreen(page, "/app/pipeline.html", OWNER, {
      "/api/dashboard/pipeline": stages
    });
    await expect(page.locator('.col[data-stage-key="new_lead"] .card .c-name')).toHaveText([
      "Soon", "Next", "Far future", "Recent past", "Old past", "No booking"
    ]);
  });

  test("keeps card email and text actions during detail loading and failure", async ({ page }) => {
    const stages = structuredClone(STAGES);
    stages.stages[0].cards[0].email = "dana@example.test";
    stages.stages[0].cards[0].phone = "+16025550100";
    let finishDetail;
    const pendingDetail = new Promise((resolve) => { finishDetail = resolve; });
    await openScreen(page, "/app/pipeline.html", OWNER, {
      "/api/dashboard/pipeline": stages,
      "/api/dashboard/client?id=": () => pendingDetail
    });
    await page.locator('.card[data-client-id] .c-name').click();
    const links = page.locator("#fhDrawerBody .fh-drawer-msg a");
    await expect(page.locator("#fhDrawerBody")).toContainText("Loading survey and credit details");
    await expect(links).toHaveCount(2);
    await expect(links.nth(0)).toHaveAttribute("href", `messaging.html?client_id=${CLIENT_ID}&channel=email`);
    await expect(links.nth(1)).toHaveAttribute("href", `messaging.html?client_id=${CLIENT_ID}&channel=sms`);
    finishDetail({ ok: false, error: "db_down" });
    await expect(page.locator("#fhDrawerBody")).toContainText("Survey and credit details could not load");
    await expect(links).toHaveCount(2);
  });

  test("shows the card's selected appointment in Call despite a stale detail task", async ({ page }) => {
    const stages = structuredClone(STAGES);
    stages.stages[0].cards[0].booked_starts_at = "2030-05-02T17:00:00.000Z";
    stages.stages[0].cards[0].booked_kind = "rescheduled";
    await openScreen(page, "/app/pipeline.html", OWNER, {
      "/api/dashboard/pipeline": stages,
      "/api/dashboard/client?id=": {
        ok: true, client: { id: CLIENT_ID, custom_fields: {} },
        latest_booking: { when: "2030-04-30T17:00:00.000Z", status: "booked", title: "Old call" }
      }
    });
    await page.locator('.card[data-client-id] .c-name').click();
    const call = page.locator("#fhDrawerBody > .fh-drawer-sec").nth(1);
    await expect(call.locator("h3")).toHaveText("Call");
    await expect(call).toContainText("May 2, 2030, 10:00 AM");
    await expect(call).toContainText("Rescheduled");
    await expect(call).not.toContainText("Old call");
  });

  test("makes a failed client-detail read visible instead of leaving blank survey answers", async ({ page }) => {
    await openScreen(page, "/app/pipeline.html", OWNER, {
      "/api/dashboard/pipeline": STAGES,
      "/api/dashboard/client?id=": { ok: false, error: "db_down" }
    });
    await page.locator('.card[data-client-id] .c-name').click();
    await expect(page.locator("#fhDrawerBody")).toContainText("Survey and credit details could not load");
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
