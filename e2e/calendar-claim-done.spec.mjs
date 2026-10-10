// Calendar — Claim and Mark done on a task row, pressed for real.
//
// The calendar spec covers Join Call, Client file and the schedule reads; the
// list said no test pressed Claim or Mark done. This presses both: the exact
// PATCH, the row saying what happened, the queue read again so the row shows
// the truth (a claimed task loses its Claim button), and a refusal in words.

import { test, expect } from "@playwright/test";
import { CLIENT_ID, CLOSER, wireApi, gotoScreen } from "./harness.mjs";

function todayAt(h) { const d = new Date(); d.setHours(h, 0, 0, 0); return d.toISOString(); }

async function open(page, { patchAnswer } = {}) {
  const patches = [];
  let claimed = false;
  let done = false;
  await wireApi(page, {
    session: CLOSER,
    handlers: {
      "/api/tasks": async (route, { url, method }) => {
        if (method === "PATCH") {
          const body = route.request().postDataJSON();
          patches.push(body);
          const out = patchAnswer ? patchAnswer(body) : null;
          if (out) return route.fulfill({ status: out.status, contentType: "application/json", body: JSON.stringify(out.body) });
          if (body.claim) claimed = true;
          if (body.done) done = true;
          return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, task: { id: body.id } }) });
        }
        if (url.includes("done=true")) return { ok: true, tasks: [] };
        if (done) return { ok: true, tasks: [] };
        return {
          ok: true,
          tasks: [{
            id: "task-a", client_id: CLIENT_ID, client_name: "Alpha Person", title: "Follow-up call",
            due_at: todayAt(16), done: false,
            assignee_staff_id: claimed ? "staff-2" : null, assignee_name: claimed ? "Casey Reed" : null
          }]
        };
      }
    }
  });
  const nine = new Date(); nine.setHours(9, 0, 0, 0);
  await page.clock.setFixedTime(nine);
  await gotoScreen(page, "calendar.html", "", CLOSER);
  await expect(page.locator('.row-btn[data-act="claim"][data-task-id="task-a"]').first()).toBeVisible({ timeout: 10_000 });
  return { patches };
}

test.describe("calendar: Claim and Mark done", () => {
  test("Claim takes that task, says so, and after the re-read the Claim button is gone", async ({ page }) => {
    const { patches } = await open(page);
    await page.locator('.row-btn[data-act="claim"][data-task-id="task-a"]').first().click();
    await expect.poll(() => patches.length).toBe(1);
    expect(patches[0]).toEqual({ id: "task-a", claim: true });
    await expect(page.locator("body")).toContainText("Claimed by you.");
    await expect(page.locator('.row-btn[data-act="claim"][data-task-id="task-a"]')).toHaveCount(0);
    await expect(page.locator("body")).toContainText("Casey Reed");
  });

  test("Mark done closes that task and it leaves the open list", async ({ page }) => {
    const { patches } = await open(page);
    await page.locator('.row-btn[data-act="done"][data-task-id="task-a"]').first().click();
    await expect.poll(() => patches.length).toBe(1);
    expect(patches[0]).toEqual({ id: "task-a", done: true });
    await expect(page.locator('.row-btn[data-act="done"][data-task-id="task-a"]')).toHaveCount(0);
  });

  test("off shift: the refusal says clock in first, and the task is untouched", async ({ page }) => {
    const { patches } = await open(page, { patchAnswer: () => ({ status: 403, body: { ok: false, error: "no_active_shift" } }) });
    await page.locator('.row-btn[data-act="claim"][data-task-id="task-a"]').first().click();
    await expect.poll(() => patches.length).toBe(1);
    await expect(page.locator("body")).toContainText("Clock in first. Work can only be claimed or closed on a shift.");
    await expect(page.locator('.row-btn[data-act="claim"][data-task-id="task-a"]').first()).toBeVisible();
  });

  test("a teammate got there first: said in plain words", async ({ page }) => {
    await open(page, { patchAnswer: () => ({ status: 409, body: { ok: false, error: "already_claimed" } }) });
    await page.locator('.row-btn[data-act="claim"][data-task-id="task-a"]').first().click();
    await expect(page.locator("body")).toContainText("Somebody else took this one first.");
  });
});
