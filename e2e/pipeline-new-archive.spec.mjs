// Pipeline — New Client and Archive, pressed for real.
//
// New Client adds a person to the Sales board. Archive (the DEL button and the
// drawer's Archive) takes a client off EVERY board. Both were source-checked
// only; no browser test pressed them. This presses them: the type-DELETE gate,
// Cancel and Escape sending nothing, the exact request on a real save, and a
// refusal said out loud with the card left in place.

import { test, expect } from "@playwright/test";
import { openScreen, json, OWNER, CLIENT_ID } from "./harness.mjs";

const STAGES = {
  ok: true, pipeline: "sales", total: 1,
  stages: [
    { key: "new_lead", name: "New Lead", sort_order: 0, count: 1, amount: 0,
      cards: [{ id: "card-1", client_id: CLIENT_ID, name: "Dana Whitfield", owner: "Jordan Blake",
        entered_at: "2026-08-01T10:00:00Z", outcome_tier: null, funded: false, amount: 3000 }] },
    { key: "booked", name: "Booked", sort_order: 2, count: 0, amount: 0, cards: [] }
  ]
};

async function board(page, { archiveAnswer, newAnswer } = {}) {
  const archives = [];
  const creates = [];
  let boardReads = 0;
  await openScreen(page, "/app/pipeline.html", OWNER, {
    "/api/dashboard/pipeline": (route) => { boardReads += 1; return json(route, STAGES); },
    "/api/dashboard/client-archive": async (route) => {
      archives.push(JSON.parse(route.request().postData() || "{}"));
      const out = archiveAnswer || { status: 200, body: { ok: true, archived: true } };
      return route.fulfill({ status: out.status, contentType: "application/json", body: JSON.stringify(out.body) });
    },
    "/api/pipeline-clients": async (route) => {
      creates.push(JSON.parse(route.request().postData() || "{}"));
      const out = newAnswer || { status: 200, body: { ok: true, client_id: "c-new" } };
      return route.fulfill({ status: out.status, contentType: "application/json", body: JSON.stringify(out.body) });
    }
  });
  await expect(page.locator(".card[data-client-id]")).toHaveCount(1);
  return { archives, creates, boardReads: () => boardReads };
}

test.describe("pipeline: New Client", () => {
  test("Save with a box empty says what is missing and sends nothing", async ({ page }) => {
    const { creates } = await board(page);
    await page.locator("#fhNewClient").click();
    await expect(page.locator("#fhNewModal")).toHaveClass(/open/);
    await page.locator("#fhNewName").fill("Riley Stone");
    await page.locator("#fhNewGo").click();
    await expect(page.locator("#fhNewErr")).toHaveText("Fill in name, email, phone, and product.");
    expect(creates).toEqual([]);
  });

  test("a full form saves through the apply-form door, closes, and reloads the board", async ({ page }) => {
    const { creates, boardReads } = await board(page);
    const before = boardReads();
    await page.locator("#fhNewClient").click();
    await expect(page.locator("#fhNewName")).toBeFocused();
    await page.locator("#fhNewName").fill("  Riley Stone ");
    await page.locator("#fhNewEmail").fill("riley@example.com");
    await page.locator("#fhNewPhone").fill("6025550101");
    await page.locator("#fhNewProduct").selectOption("card-stacking-dfy");
    await page.locator("#fhNewGo").click();
    await expect.poll(() => creates.length).toBe(1);
    expect(creates[0]).toEqual({ name: "Riley Stone", email: "riley@example.com", phone: "6025550101", product: "card-stacking-dfy" });
    await expect(page.locator("#fhNewModal")).not.toHaveClass(/open/);
    await expect.poll(() => boardReads()).toBeGreaterThan(before);
  });

  test("a refusal keeps the form open, says why, and lets them try again", async ({ page }) => {
    const { creates } = await board(page, {
      newAnswer: { status: 400, body: { ok: false, error: "email_taken", message: "That email is already a client." } }
    });
    await page.locator("#fhNewClient").click();
    await page.locator("#fhNewName").fill("Riley Stone");
    await page.locator("#fhNewEmail").fill("dana@example.com");
    await page.locator("#fhNewPhone").fill("6025550101");
    await page.locator("#fhNewProduct").selectOption("diagnostic");
    await page.locator("#fhNewGo").click();
    await expect.poll(() => creates.length).toBe(1);
    await expect(page.locator("#fhNewErr")).toHaveText("That email is already a client.");
    await expect(page.locator("#fhNewModal")).toHaveClass(/open/);
    await expect(page.locator("#fhNewGo")).toBeEnabled();
    await expect(page.locator("#fhNewGo")).toHaveText("Save");
  });

  test("Cancel closes it and sends nothing", async ({ page }) => {
    const { creates } = await board(page);
    await page.locator("#fhNewClient").click();
    await page.locator("#fhNewName").fill("Riley Stone");
    await page.locator("#fhNewCancel").click();
    await expect(page.locator("#fhNewModal")).not.toHaveClass(/open/);
    expect(creates).toEqual([]);
  });

  for (const initialFocusReady of [false, true]) {
    test(initialFocusReady ? "waiting for the real initial focus preserves the exact save, close and board reload" : "a pending initial focus can steal Email fill; the unchanged save guard refuses it", async ({ page }) => {
      // Hold the app's actual callback, not a replacement focus handler. This
      // exposes the gap between fill() focusing Email and inserting its text.
      await page.addInitScript((ready) => {
        const nativeTimeout = window.setTimeout.bind(window);
        window.__newSaveClicks = 0;
        window.__newFocusRuns = 0;
        window.setTimeout = function (callback, delay, ...args) {
          if (delay === 0 && typeof callback === "function" && String(callback).includes("nameEl.focus()")) {
            window.__heldNewFocus = () => callback(...args);
            return 0;
          }
          return nativeTimeout(callback, delay, ...args);
        };
        window.__runNewFocus = () => {
          const callback = window.__heldNewFocus;
          window.__heldNewFocus = null;
          if (callback) { window.__newFocusRuns++; callback(); }
        };
        document.addEventListener("focusin", event => {
          if (!ready && event.target.id === "fhNewEmail" && window.__heldNewFocus) queueMicrotask(() => window.__runNewFocus());
        }, true);
        document.addEventListener("click", event => { if (event.target.id === "fhNewGo") window.__newSaveClicks++; }, true);
      }, initialFocusReady);
      const { creates, boardReads } = await board(page);
      const before = boardReads();
      await page.locator("#fhNewClient").click();
      expect(await page.evaluate(() => typeof window.__heldNewFocus)).toBe("function");
      await expect(page.locator("#fhNewName")).not.toBeFocused();
      if (initialFocusReady) {
        const focused = expect(page.locator("#fhNewName")).toBeFocused();
        await page.evaluate(() => window.__runNewFocus());
        await focused;
      }
      await page.locator("#fhNewName").fill("  Riley Stone ");
      await page.locator("#fhNewEmail").fill("riley@example.com");
      await page.locator("#fhNewPhone").fill("6025550101");
      await page.locator("#fhNewProduct").selectOption("card-stacking-dfy");
      expect(await page.evaluate(() => typeof window.FHData.write)).toBe("function");
      await expect(page.locator("#fhNewName")).toHaveValue(initialFocusReady ? "  Riley Stone " : "  Riley Stone riley@example.com");
      await expect(page.locator("#fhNewEmail")).toHaveValue(initialFocusReady ? "riley@example.com" : "");
      await expect(page.locator("#fhNewPhone")).toHaveValue("6025550101");
      await expect(page.locator("#fhNewProduct")).toHaveValue("card-stacking-dfy");
      await page.locator("#fhNewGo").click();
      if (initialFocusReady) {
        await expect.poll(() => creates.length).toBe(1);
        expect(creates[0]).toEqual({ name: "Riley Stone", email: "riley@example.com", phone: "6025550101", product: "card-stacking-dfy" });
        await expect(page.locator("#fhNewModal")).not.toHaveClass(/open/);
        await expect.poll(() => boardReads()).toBeGreaterThan(before);
      } else {
        await expect(page.locator("#fhNewErr")).toHaveText("Fill in name, email, phone, and product.");
        await expect(page.locator("#fhNewModal")).toHaveClass(/open/);
        await expect(page.locator("#fhNewGo")).toBeEnabled();
        await expect(page.locator("#fhNewGo")).toHaveText("Save");
        expect(creates).toEqual([]);
      }
      expect(await page.evaluate(() => [window.__newSaveClicks, window.__newFocusRuns])).toEqual([1, 1]);
    });
  }
});

test.describe("pipeline: Archive", () => {
  test("DEL opens the gate; Archive stays off until exactly DELETE is typed", async ({ page }) => {
    const { archives } = await board(page);
    await page.locator(".card[data-client-id] .c-btn.del").click();
    await expect(page.locator("#fhDelModal")).toHaveClass(/open/);
    await expect(page.locator("#fhDelGo")).toBeDisabled();
    await page.locator("#fhDelInput").fill("delete");
    await expect(page.locator("#fhDelGo")).toBeDisabled();
    await page.locator("#fhDelInput").press("Enter");
    await page.waitForTimeout(200);
    expect(archives).toEqual([]);
    await page.locator("#fhDelInput").fill("DELETE");
    await expect(page.locator("#fhDelGo")).toBeEnabled();
  });

  test("typing DELETE and pressing Archive archives that client, and the card leaves the board", async ({ page }) => {
    const { archives } = await board(page);
    await page.locator(".card[data-client-id] .c-btn.del").click();
    await page.locator("#fhDelInput").fill("DELETE");
    await page.locator("#fhDelGo").click();
    await expect.poll(() => archives.length).toBe(1);
    expect(archives[0]).toEqual({ client_id: CLIENT_ID, confirm: "DELETE" });
    await expect(page.locator("#fhDelModal")).not.toHaveClass(/open/);
    await expect(page.locator(".card[data-client-id]")).toHaveCount(0);
    await expect(page.locator("body")).toContainText("Archived Dana Whitfield");
  });

  test("Cancel and Escape both close the gate and archive nothing", async ({ page }) => {
    const { archives } = await board(page);
    await page.locator(".card[data-client-id] .c-btn.del").click();
    await page.locator("#fhDelInput").fill("DELETE");
    await page.locator("#fhDelCancel").click();
    await expect(page.locator("#fhDelModal")).not.toHaveClass(/open/);
    await page.locator(".card[data-client-id] .c-btn.del").click();
    await expect(page.locator("#fhDelInput")).toHaveValue("");
    await page.keyboard.press("Escape");
    await expect(page.locator("#fhDelModal")).not.toHaveClass(/open/);
    expect(archives).toEqual([]);
    await expect(page.locator(".card[data-client-id]")).toHaveCount(1);
  });

  test("a refused archive says so and leaves the card on the board", async ({ page }) => {
    const { archives } = await board(page, { archiveAnswer: { status: 403, body: { ok: false, error: "forbidden" } } });
    await page.locator(".card[data-client-id] .c-btn.del").click();
    await page.locator("#fhDelInput").fill("DELETE");
    await page.locator("#fhDelGo").click();
    await expect.poll(() => archives.length).toBe(1);
    await expect(page.locator("body")).toContainText("Archive failed: forbidden");
    await expect(page.locator(".card[data-client-id]")).toHaveCount(1);
  });

  test("the drawer: Archive opens the same gate; Close and Escape close the drawer", async ({ page }) => {
    const { archives } = await board(page);
    await page.locator(".card[data-client-id] .c-name").click();
    await expect(page.locator("#fhDrawer")).toHaveClass(/open/);
    await page.locator("#fhDrawerDel").click();
    await expect(page.locator("#fhDelModal")).toHaveClass(/open/);
    await page.locator("#fhDelInput").fill("DELETE");
    await page.locator("#fhDelGo").click();
    await expect.poll(() => archives.length).toBe(1);
    expect(archives[0].client_id).toBe(CLIENT_ID);
    await expect(page.locator("#fhDrawer")).not.toHaveClass(/open/);
  });

  test("the drawer Close button and the Escape key each close it", async ({ page }) => {
    await board(page);
    await page.locator(".card[data-client-id] .c-name").click();
    await expect(page.locator("#fhDrawer")).toHaveClass(/open/);
    await page.locator("#fhDrawerClose").click();
    await expect(page.locator("#fhDrawer")).not.toHaveClass(/open/);
    await page.locator(".card[data-client-id] .c-name").click();
    await expect(page.locator("#fhDrawer")).toHaveClass(/open/);
    await page.keyboard.press("Escape");
    await expect(page.locator("#fhDrawer")).not.toHaveClass(/open/);
  });
});
