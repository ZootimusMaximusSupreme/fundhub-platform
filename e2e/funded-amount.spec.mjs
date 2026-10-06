// Playwright — the two boxes where a staff member records money.
//
// WHAT WAS BROKEN. Nothing in the product could record a dollar amount. The
// Pipeline board's Funded column is guarded (src/workflows/cards.mjs) because
// funding_rounds.funded_amount is the basis a client is billed from, so every
// move onto Funded was refused and nobody could answer the refusal. "Bank yes"
// on the client control panel recorded that a bank said yes but never for how
// much.
//
// WHAT THESE PROVE, in a real browser, clicking real buttons:
//   1. the box appears and the amount reaches the request body
//   2. a BLANK box sends nothing at all — it never sends 0
//   3. junk and negatives are refused on the screen, before any request
//
// (2) is the one that matters. A zero here is a claim that nothing funded, and
// it would flow straight into an invoice looking perfectly legitimate
// (docs/finance/CLOSEOUT-FEE-BASIS.md).
//
// NO BACKEND — /api/** is answered by page.route() via harness.mjs.

import { test, expect } from "@playwright/test";
import { openScreen, json, OWNER, CLIENT_ID } from "./harness.mjs";

const LENDER_ID = "bbbbbbbb-1111-4111-8111-111111111111";

const MATCHES = {
  ok: true,
  match_count: 1,
  summary: { lender_count: 1 },
  matches: [{
    id: LENDER_ID,
    name: "Mesa Community Bank",
    bureaus_pulled: "EX",
    application_url: "https://bank.example/apply/mesa"
  }]
};

/* Captures every POST body the screen sends to an endpoint, so a test can
   assert on what was sent AND on the fact that nothing was sent at all. */
function captureWrites(path, writes, reply) {
  return {
    [path]: async (route, ctx) => {
      const method = ctx && ctx.method ? ctx.method : route.request().method();
      if (method !== "POST") return json(route, { ok: false, error: "method_not_allowed" }, 405);
      writes.push(JSON.parse(route.request().postData() || "{}"));
      return json(route, reply);
    }
  };
}

/* A STANDING-IN BACKEND FOR /api/applications that remembers.
   The screen both writes approvals and reads them back — reading them back is
   how a missing amount gets shown and how it gets filled in later — so a stub
   that forgets between the POST and the GET cannot prove either. `saved` is
   the application rows this fake file already holds; a POST updates the row
   for that lender exactly the way logBankDecision does (find by client +
   lender, patch, never mint a second one).

   AN ABSENT approved_amount STAYS ABSENT. The fake never fills one in, so a
   test that sees an amount here is seeing one the screen really sent. */
function applicationsBackend(writes, saved) {
  return {
    "/api/applications": async (route, ctx) => {
      const method = ctx && ctx.method ? ctx.method : route.request().method();
      if (method === "GET") {
        return json(route, { ok: true, decisions: [], applications: saved });
      }
      if (method !== "POST") return json(route, { ok: false, error: "method_not_allowed" }, 405);
      const body = JSON.parse(route.request().postData() || "{}");
      writes.push(body);

      /* "This approval does not count" — the way out of the Funded block. The
         real handler stamps who and when and leaves status alone; this fake
         does the same, because a stub that changed the status would hide the
         one thing worth proving. */
      if (body.action === "exclude_approval" || body.action === "reinstate_approval") {
        const target = saved.find((a) => a.id === body.application_id);
        if (!target) return json(route, { ok: false, error: "not_found" }, 404);
        if (body.action === "exclude_approval") {
          target.approval_excluded_at = "2026-08-30T12:00:00Z";
          target.approval_excluded_by = "Owner Olivia";
          target.approval_exclusion_reason = body.reason || null;
        } else {
          target.approval_excluded_at = null;
          target.approval_excluded_by = null;
          target.approval_exclusion_reason = null;
        }
        return json(route, { ok: true, application: target });
      }

      let row = saved.find((a) => a.lender_id === body.lender_id);
      if (!row) {
        row = { id: "app-" + (saved.length + 1), lender_id: body.lender_id, status: null, approved_amount: null };
        saved.push(row);
      }
      row.status = body.status;
      // Only a real amount overwrites. Absent means nobody said, and the
      // column keeps whatever it had — the server behaves the same way.
      if (body.approved_amount !== undefined && body.approved_amount !== null) {
        row.approved_amount = body.approved_amount;
      }
      return json(route, { ok: true, application: row });
    }
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   BANK YES — how much the bank approved
   ══════════════════════════════════════════════════════════════════════════ */
test.describe("client control panel — Bank yes records an amount", () => {

  async function open(page, writes, saved = []) {
    return openScreen(page, `/app/client-control-panel.html?client_id=${CLIENT_ID}`, OWNER, {
      "/api/read/lender-matches": MATCHES,
      ...applicationsBackend(writes, saved)
    });
  }

  /* THE BUTTON WORDS ARE CHRIS'S (owner-set 2026-09-06, 648af7b02): "Bank yes"
     and "Bank no" became Approved / Declined / Pending. The stored values did
     not change — Approved, Denied, Applied — so every write assertion below is
     as it was; only the button names moved. The amount box is labelled
     "Approved $" and its placeholder says to leave it empty if unknown. */
  test("the approved-amount box is on the screen next to the Approved button", async ({ page }) => {
    await open(page, []);
    const amt = page.locator('input[data-amount-lender-id]').first();
    await expect(amt).toBeVisible({ timeout: 10_000 });
    await expect(page.getByLabel("Approved $").first()).toBeVisible();
    await expect(amt).toHaveAttribute("placeholder", /empty if unknown/i);
    await expect(page.getByRole("button", { name: "Approved", exact: true }).first()).toBeVisible();
  });

  test("a typed amount reaches the request as approved_amount in dollars", async ({ page }) => {
    const writes = [];
    await open(page, writes);
    await page.locator('input[data-amount-lender-id]').first().fill("$45,000");
    await page.getByRole("button", { name: "Approved", exact: true }).first().click();
    await expect.poll(() => writes.length, { timeout: 10_000 }).toBe(1);
    expect(writes[0].status).toBe("Approved");
    // Dollars, fixed 2dp — the unit applications.approved_amount stores.
    expect(writes[0].approved_amount).toBe("45000.00");
  });

  test("450.10 stays 450.10 — no floating point drift", async ({ page }) => {
    const writes = [];
    await open(page, writes);
    await page.locator('input[data-amount-lender-id]').first().fill("450.10");
    await page.getByRole("button", { name: "Approved", exact: true }).first().click();
    await expect.poll(() => writes.length, { timeout: 10_000 }).toBe(1);
    expect(writes[0].approved_amount).toBe("450.10");
  });

  /* THIS TEST WAS INVERTED ON PURPOSE (owner-set 2026-08-29).
     It used to prove a blank box sent NOTHING. The owner corrected the rule:
     approval and amount are two separate moments, because when a bank comes
     back the fulfillment team often does not know the limit yet. So a blank
     box must SAVE the approval — and still must not send a zero. Those are two
     different things and both are asserted here. */
  test("A BLANK BOX SAVES THE APPROVAL AND SENDS NO AMOUNT — never a zero", async ({ page }) => {
    const writes = [];
    await open(page, writes);
    await page.getByRole("button", { name: "Approved", exact: true }).first().click();
    await expect.poll(() => writes.length, { timeout: 10_000 }).toBe(1);
    expect(writes[0].status).toBe("Approved");
    // No key at all. Not 0, not "", not null.
    expect(Object.prototype.hasOwnProperty.call(writes[0], "approved_amount")).toBe(false);
  });

  test("after saving with no amount, the row says so and the block counts it", async ({ page }) => {
    const writes = [];
    await open(page, writes);
    await page.getByRole("button", { name: "Approved", exact: true }).first().click();
    await expect.poll(() => writes.length, { timeout: 10_000 }).toBe(1);
    await expect(page.locator(`[data-amount-needed-lender-id="${LENDER_ID}"]`))
      .toBeVisible({ timeout: 10_000 });
    await expect(page.locator("#fh-funding-amounts-waiting"))
      .toContainText(/waiting on its dollar amount/i, { timeout: 10_000 });
  });

  test("junk and negatives are refused on the screen, before any request", async ({ page }) => {
    const writes = [];
    await open(page, writes);
    const amt = page.locator('input[data-amount-lender-id]').first();
    for (const bad of ["abc", "-500", "0"]) {
      await amt.fill(bad);
      await page.getByRole("button", { name: "Approved", exact: true }).first().click();
      await page.waitForTimeout(300);
    }
    expect(writes).toHaveLength(0);
  });

  test("Declined still works and carries no amount", async ({ page }) => {
    const writes = [];
    await open(page, writes);
    await page.getByRole("button", { name: "Declined", exact: true }).first().click();
    await expect.poll(() => writes.length, { timeout: 10_000 }).toBe(1);
    expect(writes[0].status).toBe("Denied");
    expect(writes[0].approved_amount).toBeUndefined();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   THE SECOND MOMENT — the amount arrives later
   ══════════════════════════════════════════════════════════════════════════ */
test.describe("client control panel — an approval waiting on its amount", () => {

  const waiting = () => [{
    id: "app-1", lender_id: LENDER_ID, status: "Approved", approved_amount: null
  }];
  const priced = () => [{
    id: "app-1", lender_id: LENDER_ID, status: "Approved", approved_amount: "45000.00"
  }];

  async function open(page, writes, saved) {
    return openScreen(page, `/app/client-control-panel.html?client_id=${CLIENT_ID}`, OWNER, {
      "/api/read/lender-matches": MATCHES,
      ...applicationsBackend(writes, saved)
    });
  }

  test("an approval with no amount is marked on its row when the screen opens", async ({ page }) => {
    await open(page, [], waiting());
    await expect(page.locator(`[data-amount-needed-lender-id="${LENDER_ID}"]`))
      .toBeVisible({ timeout: 10_000 });
    await expect(page.locator(`[data-amount-needed-lender-id="${LENDER_ID}"]`))
      .toHaveText(/amount needed/i);
    await expect(page.locator("#fh-funding-amounts-waiting"))
      .toContainText(/1 bank approval is still waiting/i);
    // And the box is empty, because nothing is known. Never a 0.
    await expect(page.locator(`input[data-amount-lender-id="${LENDER_ID}"]`)).toHaveValue("");
  });

  test("an approval that already has an amount shows it back and is not flagged", async ({ page }) => {
    await open(page, [], priced());
    await expect(page.locator(`input[data-amount-lender-id="${LENDER_ID}"]`))
      .toHaveValue("45000.00", { timeout: 10_000 });
    await expect(page.locator(`[data-amount-needed-lender-id="${LENDER_ID}"]`)).toBeHidden();
    await expect(page.locator("#fh-funding-amounts-waiting")).toBeHidden();
  });

  test("typing the amount in later saves it and clears the flag", async ({ page }) => {
    const writes = [];
    const saved = waiting();
    await open(page, writes, saved);
    await expect(page.locator(`[data-amount-needed-lender-id="${LENDER_ID}"]`))
      .toBeVisible({ timeout: 10_000 });

    await page.locator(`input[data-amount-lender-id="${LENDER_ID}"]`).fill("$45,000");
    await page.getByRole("button", { name: "Approved", exact: true }).first().click();

    await expect.poll(() => writes.length, { timeout: 10_000 }).toBe(1);
    expect(writes[0].approved_amount).toBe("45000.00");
    // Same lender, so the fake backend patched the one row rather than adding
    // a second — the same thing logBankDecision does against a real database.
    expect(saved).toHaveLength(1);

    await expect(page.locator(`[data-amount-needed-lender-id="${LENDER_ID}"]`))
      .toBeHidden({ timeout: 10_000 });
    await expect(page.locator("#fh-funding-amounts-waiting")).toBeHidden();
  });

  test("the count still shows when no lenders match at all", async ({ page }) => {
    /* The rot case. A client whose lender list has gone empty has no rows to
       chip, and that is exactly the file where a waiting approval would never
       be seen again. The sentence has to be painted on that path too. */
    await openScreen(page, `/app/client-control-panel.html?client_id=${CLIENT_ID}`, OWNER, {
      "/api/read/lender-matches": { ok: true, match_count: 0, summary: { lender_count: 0 }, matches: [] },
      ...applicationsBackend([], waiting())
    });
    await expect(page.locator("#fh-funding-amounts-waiting"))
      .toContainText(/1 bank approval is still waiting/i, { timeout: 10_000 });
  });

  test("a typo in the box is still refused — a wrong amount is not an unknown", async ({ page }) => {
    const writes = [];
    await open(page, writes, waiting());
    await page.locator(`input[data-amount-lender-id="${LENDER_ID}"]`).fill("forty thousand");
    await page.getByRole("button", { name: "Approved", exact: true }).first().click();
    await page.waitForTimeout(800);
    expect(writes).toHaveLength(0);
    await expect(page.locator("#fh-funding-apply-status")).toContainText(/not an amount/i);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   THE BOARD — the same fact, across every client
   ══════════════════════════════════════════════════════════════════════════ */
test.describe("pipeline board — a card says when an approval has no amount", () => {

  function boardWith(cardExtra) {
    return {
      "/api/dashboard/pipeline": {
        ok: true,
        pipeline: "sales",
        stages: [{
          key: "new_lead", name: "New Lead", sort_order: 0, count: 1, amount: 3000,
          cards: [{
            id: "card-1", client_id: CLIENT_ID, name: "Dana Whitfield",
            owner: "Jordan Blake", entered_at: "2026-08-01T10:00:00Z",
            outcome_tier: null, funded: false, amount: 3000, ...cardExtra
          }]
        }],
        total: 1
      }
    };
  }

  test("the card carries the flag when an approval has no dollar amount", async ({ page }) => {
    await openScreen(page, "/app/pipeline.html", OWNER, boardWith({ approval_amount_missing: true }));
    await expect(page.locator(".card .c-needs-amount").first())
      .toHaveText(/amount needed/i, { timeout: 10_000 });
  });

  test("no flag when nothing is waiting, and none when the key never arrived", async ({ page }) => {
    await openScreen(page, "/app/pipeline.html", OWNER, boardWith({ approval_amount_missing: false }));
    await expect(page.locator(".card .c-needs-amount")).toHaveCount(0);

    // A reply that never carried the key is not evidence of a clean file, but
    // it is not evidence of a waiting one either — the card must say nothing
    // rather than invent either answer.
    await openScreen(page, "/app/pipeline.html", OWNER, boardWith({}));
    await expect(page.locator(".card .c-needs-amount")).toHaveCount(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   FUNDED — what actually funded
   ══════════════════════════════════════════════════════════════════════════ */
test.describe("pipeline board — a move onto Funded carries the money", () => {

  /* The shared parser is what the page asks; driving the whole board through a
     drag is slow and brittle, so these exercise the page's own module directly
     in the browser, then assert the wiring that calls it. */
  test("the shared money rule is loaded and live on the page", async ({ page }) => {
    await openScreen(page, "/app/pipeline.html", OWNER, {});
    const out = await page.evaluate(() => {
      const p = window.FHMoneyInput && window.FHMoneyInput.parseAmount;
      if (!p) return { missing: true };
      return {
        typed: p("$45,000"),
        pennies: p("450.10"),
        blank: p(""),
        zero: p("0"),
        negative: p("-5"),
        junk: p("abc")
      };
    });
    expect(out.missing).toBeUndefined();
    expect(out.typed).toMatchObject({ ok: true, cents: 4500000, dollars: "45000.00" });
    expect(out.pennies).toMatchObject({ ok: true, cents: 45010, dollars: "450.10" });
    // Every one of these must refuse. None may come back as a zero amount.
    expect(out.blank.ok).toBe(false);
    expect(out.blank.reason).toBe("blank");
    expect(out.blank.cents).toBeUndefined();
    expect(out.zero.ok).toBe(false);
    expect(out.negative.ok).toBe(false);
    expect(out.junk.ok).toBe(false);
  });

  /* A Card Stacking board with a real Funded column — the only place the
     guard fires. Dragging onto it is exactly what a funding advisor does. */
  const CARD_STACKING_BOARD = {
    ok: true,
    pipeline: "funding_card_stacking",
    total: 1,
    stages: [
      {
        key: "approved", name: "Approved", sort_order: 0, count: 1, amount: 40000,
        cards: [{
          id: "card-1", client_id: CLIENT_ID, name: "Dana Whitfield",
          owner: "Jordan Blake", entered_at: "2026-08-01T10:00:00Z",
          outcome_tier: null, funded: false, amount: 40000
        }]
      },
      { key: "funded", name: "Funded", sort_order: 1, count: 0, amount: 0, cards: [] }
    ]
  };

  /* Drives the drag from the Approved card onto the Funded column, with the
     amount box answering `answer` (null = the person pressed Cancel). */
  async function dragToFunded(page, answer, writes) {
    await openScreen(page, "/app/pipeline.html", OWNER, {
      "/api/dashboard/pipeline": CARD_STACKING_BOARD,
      ...captureWrites("/api/pipeline-cards", writes, { ok: true, action: "move" })
    });
    // Any alert (a refusal) is dismissed so it cannot block the run.
    page.on("dialog", (d) => { d.dismiss().catch(() => {}); });
    await page.evaluate((a) => { window.prompt = () => a; }, answer);

    /* Select the Card Stacking rail. The columns carry whichever rail key was
       REQUESTED (buildColumn stamps col.dataset.pipelineKey), and the guard
       only fires for funding_card_stacking — so painting these same stages
       under the default Sales rail would prove nothing. */
    await page.evaluate(() => window.FHPipelineBoard.showPipeline("funding_card_stacking"));
    await expect(page.locator('.col[data-pipeline-key="funding_card_stacking"]').first())
      .toBeVisible({ timeout: 10_000 });

    const card = page.locator('.card[data-client-id]').first();
    const dest = page.locator('.col[data-stage-key="funded"] .col-body').first();
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(dest).toBeVisible();
    const c = await card.boundingBox();
    const d = await dest.boundingBox();
    await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2);
    await page.mouse.down();
    await page.mouse.move(d.x + d.width / 2, d.y + 20, { steps: 8 });
    await page.mouse.up();
  }

  test("a typed amount reaches the request as funded_amount in dollars", async ({ page }) => {
    const writes = [];
    await dragToFunded(page, "$45,000", writes);
    await expect.poll(() => writes.length, { timeout: 10_000 }).toBe(1);
    expect(writes[0].stage_key).toBe("funded");
    expect(writes[0].pipeline_key).toBe("funding_card_stacking");
    expect(writes[0].client_id).toBe(CLIENT_ID);
    // Dollars, fixed 2dp — what funding_rounds.funded_amount stores and what
    // guardFundedAmount in src/workflows/cards.mjs is waiting for.
    expect(writes[0].funded_amount).toBe("45000.00");
  });

  test("CANCELLING THE BOX SENDS NOTHING — never a zero", async ({ page }) => {
    const writes = [];
    await dragToFunded(page, null, writes);
    await page.waitForTimeout(1200);
    expect(writes).toHaveLength(0);
  });

  test("AN EMPTY BOX SENDS NOTHING — empty is not zero", async ({ page }) => {
    const writes = [];
    await dragToFunded(page, "", writes);
    await page.waitForTimeout(1200);
    expect(writes).toHaveLength(0);
  });

  test("a move to any other column still needs no amount", async ({ page }) => {
    // The box must appear on Funded and nowhere else, or every ordinary move
    // starts nagging for money it does not need.
    const writes = [];
    await openScreen(page, "/app/pipeline.html", OWNER, {
      "/api/dashboard/pipeline": {
        ...CARD_STACKING_BOARD,
        stages: [
          CARD_STACKING_BOARD.stages[0],
          { key: "action_required", name: "Action Required", sort_order: 1, count: 0, amount: 0, cards: [] }
        ]
      },
      ...captureWrites("/api/pipeline-cards", writes, { ok: true, action: "move" })
    });
    let asked = false;
    await page.evaluate(() => { window.prompt = () => { window.__asked = true; return null; }; });
    await page.evaluate(() => window.FHPipelineBoard.showPipeline("funding_card_stacking"));
    await expect(page.locator('.col[data-pipeline-key="funding_card_stacking"]').first())
      .toBeVisible({ timeout: 10_000 });
    const card = page.locator('.card[data-client-id]').first();
    const dest = page.locator('.col[data-stage-key="action_required"] .col-body').first();
    await expect(card).toBeVisible({ timeout: 10_000 });
    const c = await card.boundingBox();
    const d = await dest.boundingBox();
    await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2);
    await page.mouse.down();
    await page.mouse.move(d.x + d.width / 2, d.y + 20, { steps: 8 });
    await page.mouse.up();
    await expect.poll(() => writes.length, { timeout: 10_000 }).toBe(1);
    asked = await page.evaluate(() => !!window.__asked);
    expect(asked).toBe(false);
    expect(writes[0].funded_amount).toBeUndefined();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   "DOESN'T COUNT" — the way out of the Funded block

   A round can no longer be marked Funded while a bank approval on it has no
   dollar amount, because we bill a percent of the approvals that carry one and
   a blank approval is never invoiced. Some approvals are never going to have an
   amount — the client did not use the card, or the bank pulled it — so there
   has to be a way to say so, on the record.

   These prove the control appears exactly where it helps and nowhere else, that
   it is a deliberate act (a reason is required, cancelling does nothing), and
   that it is NOT a bank no: the request never carries a status at all.
   ══════════════════════════════════════════════════════════════════════════ */
test.describe("client control panel — an approval that does not count", () => {

  async function open(page, writes, saved = []) {
    return openScreen(page, `/app/client-control-panel.html?client_id=${CLIENT_ID}`, OWNER, {
      "/api/read/lender-matches": MATCHES,
      ...applicationsBackend(writes, saved)
    });
  }

  const blankApproval = () => ([{
    id: "app-1", lender_id: LENDER_ID, lender_name: "Mesa Community Bank",
    status: "Approved", approved_amount: null
  }]);

  const skip = (page) => page.locator(`[data-approval-skip-lender-id="${LENDER_ID}"]`);

  test("the button shows on an approval with no amount", async ({ page }) => {
    await open(page, [], blankApproval());
    await expect(skip(page)).toBeVisible({ timeout: 10_000 });
    await expect(skip(page)).toHaveText("Doesn't count");
  });

  test("it does NOT show on an approval that already has its amount", async ({ page }) => {
    await open(page, [], [{
      id: "app-1", lender_id: LENDER_ID, lender_name: "Mesa Community Bank",
      status: "Approved", approved_amount: "45000.00"
    }]);
    await expect(page.locator('input[data-amount-lender-id]').first())
      .toHaveValue("45000.00", { timeout: 10_000 });
    await expect(skip(page)).toBeHidden();
  });

  test("it does NOT show on a bank no", async ({ page }) => {
    await open(page, [], [{
      id: "app-1", lender_id: LENDER_ID, lender_name: "Mesa Community Bank",
      status: "Denied", approved_amount: null
    }]);
    await expect(page.locator('input[data-amount-lender-id]').first()).toBeVisible({ timeout: 10_000 });
    await expect(skip(page)).toBeHidden();
  });

  test("cancelling the reason changes nothing at all", async ({ page }) => {
    const writes = [];
    await open(page, writes, blankApproval());
    await expect(skip(page)).toBeVisible({ timeout: 10_000 });
    await page.evaluate(() => { window.prompt = () => null; });
    await skip(page).click();
    await page.waitForTimeout(300);
    expect(writes).toHaveLength(0);
  });

  test("an empty reason changes nothing either — it has to be deliberate", async ({ page }) => {
    const writes = [];
    await open(page, writes, blankApproval());
    await expect(skip(page)).toBeVisible({ timeout: 10_000 });
    await page.evaluate(() => { window.prompt = () => "   "; });
    await skip(page).click();
    await page.waitForTimeout(300);
    expect(writes).toHaveLength(0);
  });

  test("a reason sends the exclusion — and never a status, so it is not a bank no", async ({ page }) => {
    const writes = [];
    await open(page, writes, blankApproval());
    await expect(skip(page)).toBeVisible({ timeout: 10_000 });
    await page.evaluate(() => { window.prompt = () => "Client never used it"; });
    await skip(page).click();
    await expect.poll(() => writes.length, { timeout: 10_000 }).toBe(1);
    expect(writes[0].action).toBe("exclude_approval");
    expect(writes[0].application_id).toBe("app-1");
    expect(writes[0].reason).toBe("Client never used it");
    // THE POINT: a denial is a different thing and this must never look like one.
    expect(writes[0].status).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(writes[0], "approved_amount")).toBe(false);
  });

  test("once excluded the row stops being chased, and the block stops counting it", async ({ page }) => {
    const writes = [];
    await open(page, writes, blankApproval());
    await expect(page.locator("#fh-funding-amounts-waiting"))
      .toContainText(/waiting on its dollar amount/i, { timeout: 10_000 });

    await page.evaluate(() => { window.prompt = () => "Approval withdrawn"; });
    await skip(page).click();
    await expect.poll(() => writes.length, { timeout: 10_000 }).toBe(1);

    await expect(skip(page)).toHaveText("Not counted — undo", { timeout: 10_000 });
    await expect(page.locator(`[data-amount-needed-lender-id="${LENDER_ID}"]`)).toBeHidden();
    await expect(page.locator("#fh-funding-amounts-waiting")).toBeHidden();
  });

  test("undo puts it back, and asks for no reason to do so", async ({ page }) => {
    const writes = [];
    await open(page, writes, [{
      id: "app-1", lender_id: LENDER_ID, lender_name: "Mesa Community Bank",
      status: "Approved", approved_amount: null,
      approval_excluded_at: "2026-08-30T12:00:00Z",
      approval_excluded_by: "Owner Olivia",
      approval_exclusion_reason: "Approval withdrawn"
    }]);
    await expect(skip(page)).toHaveText("Not counted — undo", { timeout: 10_000 });
    // Who did it and why is readable without opening anything.
    await expect(skip(page)).toHaveAttribute("title", /Owner Olivia.*Approval withdrawn/);

    await page.evaluate(() => { window.prompt = () => { window.__asked = true; return "x"; }; });
    await skip(page).click();
    await expect.poll(() => writes.length, { timeout: 10_000 }).toBe(1);
    expect(writes[0].action).toBe("reinstate_approval");
    expect(await page.evaluate(() => !!window.__asked)).toBe(false);

    // It counts again, so it is chased again.
    await expect(skip(page)).toHaveText("Doesn't count", { timeout: 10_000 });
    await expect(page.locator("#fh-funding-amounts-waiting"))
      .toContainText(/waiting on its dollar amount/i);
  });
});
