// Creative Factory — Approve, Reject and Archive on one creative, pressed.
//
// "Decide on one creative" changes what a partner may run. The list said no
// test pressed the three buttons. This presses each: the confirm names the
// consequence and the creative, No sends nothing, Yes sends exactly that
// creative for that partner, and the buttons stay off while the owner has not
// turned the partner's suite on.

import { test, expect } from "@playwright/test";
import { openScreen, json, OWNER } from "./harness.mjs";

const PARTNER = "9a000000-0000-4000-8000-000000000001";
const ASSET = "a5000000-0000-4000-8000-000000000001";

async function open(page, { enabled = true, actionAnswer } = {}) {
  const actions = [];
  await openScreen(page, `/app/creative-factory.html?partner_id=${PARTNER}`, OWNER, {
    "/api/read/partners": { ok: true, count: 1, limit: 200, offset: 0, hasMore: false, items: [{ id: PARTNER, name: "Acme Capital", slug: "acme" }] },
    "/api/partner-marketing/usage": { ok: true, partner_id: PARTNER, enabled, used: 0, remaining: 1000, cap: 1000 },
    "/api/creative/library": { ok: true, count: 1, limit: 200, offset: 0, hasMore: false, items: [
      { id: ASSET, partner_id: PARTNER, kind: "static", format: "1080x1080", compliance_state: "pending", archived_at: null, created_at: "2026-10-09T12:00:00Z" }
    ] },
    "/api/creative/actions": async (route) => {
      const body = route.request().postDataJSON();
      actions.push(body);
      const out = actionAnswer ? actionAnswer(body) : {
        ok: true,
        asset: { id: ASSET, compliance_state: body.action === "approve" ? "approved" : body.action === "reject" ? "blocked" : "pending",
                 archived_at: body.action === "archive" ? "2026-10-10T12:00:00Z" : null }
      };
      return json(route, out);
    }
  });
  await expect(page.locator("#actAsset option")).toHaveCount(2);
  return { actions };
}

const button = (page, act) => page.locator(`[data-cact="${act}"]`);

test.describe("creative factory: decide on one creative", () => {
  test("with the partner's suite off, the three buttons stay off", async ({ page }) => {
    await open(page, { enabled: false });
    for (const act of ["approve", "reject", "archive"]) await expect(button(page, act)).toBeDisabled();
  });

  test("no creative chosen: says so and sends nothing", async ({ page }) => {
    const { actions } = await open(page);
    await expect(button(page, "approve")).toBeEnabled();
    await button(page, "approve").click();
    await expect(page.locator("#actMsg")).toHaveText("Choose a creative first.");
    expect(actions).toEqual([]);
  });

  for (const [act, word, after] of [
    ["approve", "Approve this creative? It will be marked approved for this partner.", "Done. This creative is now approved."],
    ["reject", "Reject this creative? It will be marked blocked and cannot be used.", "Done. This creative is now blocked."],
    ["archive", "Archive this creative? It will be hidden from the library unless archived items are shown.", "Done. This creative is now pending and archived."]
  ]) {
    test(`${act}: the confirm names the consequence and the creative; Yes sends that creative for that partner`, async ({ page }) => {
      const { actions } = await open(page);
      await page.locator("#actAsset").selectOption(ASSET);
      const dialogs = [];
      page.once("dialog", (d) => { dialogs.push(d.message()); d.accept(); });
      await button(page, act).click();
      await expect.poll(() => actions.length).toBe(1);
      expect(actions[0]).toEqual({ partner_id: PARTNER, asset_id: ASSET, action: act });
      expect(dialogs[0].startsWith(word)).toBe(true);
      expect(dialogs[0]).toContain("static · 1080x1080 · pending");
      await expect(page.locator("#actMsg")).toHaveText(after);
    });
  }

  test("No on the confirm sends nothing", async ({ page }) => {
    const { actions } = await open(page);
    await page.locator("#actAsset").selectOption(ASSET);
    page.once("dialog", (d) => d.dismiss());
    await button(page, "reject").click();
    await page.waitForTimeout(300);
    expect(actions).toEqual([]);
    await expect(page.locator("#actMsg")).toHaveText("");
  });

  test("a refusal is said in plain words, not the server's code", async ({ page }) => {
    const { actions } = await open(page, { actionAnswer: () => ({ ok: false, error: "suite_off" }) });
    await page.locator("#actAsset").selectOption(ASSET);
    page.once("dialog", (d) => d.accept());
    await button(page, "approve").click();
    await expect.poll(() => actions.length).toBe(1);
    await expect(page.locator("#actMsg")).toHaveText("Could not approve it. This part of the system is switched off for this partner. Only the owner can turn it on.");
  });
});
