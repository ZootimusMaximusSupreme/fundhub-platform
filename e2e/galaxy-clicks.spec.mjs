// Galaxy — click a team to zoom, click a worker to open their day, Escape out.
//
// Galaxy is read only (nothing on it writes), but the list said no test ever
// clicked the sky. This clicks it the way a person would: on the team, then on
// the one worker in it (found by where the pointer turns into a hand), and
// checks the day panel opens with that worker, then Escape steps back out.

import { test, expect } from "@playwright/test";
import { openScreen, OWNER } from "./harness.mjs";

const FEED = {
  ok: true,
  nodes: [{
    id: "n1", c: "sales", kind: "human", name: "Casey Reed", ini: "CR", role: "Closer",
    state: "active", act: "On a call with a client", shift: "8:00 AM", on: "4h 10m",
    pace: 1.0, unit: "calls", out: 6, stats: [["Calls", "6"]], tl: [["9:00", "Clocked in"]], files: ["FH-000101"]
  }],
  clients: [], routes: [], kpis: []
};

async function cursorAt(page, x, y) {
  await page.mouse.move(x, y);
  return page.locator("#sky").evaluate((c) => c.style.cursor);
}

test("click the team, click the worker: their day opens; Escape closes it, Escape again zooms out", async ({ page }) => {
  await openScreen(page, "/app/galaxy.html", OWNER, { "/api/read/company-activity": FEED });
  await expect(page.locator("#galaxyBackendNotice")).toContainText("1 workers");
  const box = await page.locator("#sky").boundingBox();

  // The Sales & Funding team sits at fx 0.165, fy 0.44 of the sky (galaxy.html CLUSTERS, layout()).
  const W = box.width, GH = box.height;
  const padX = Math.min(Math.max(W * 0.11, 92), 190);
  const sx = box.x + padX + 0.165 * (W - 2 * padX);
  const sy = box.y + 66 + 0.44 * (GH - 66 - 44);
  await page.mouse.click(sx, sy);
  await page.waitForTimeout(1600); // the camera glides; it never cuts

  // Find the worker: the pointer turns into a hand over a person.
  // Look from the middle of the sky outward, nearest points first.
  const points = [];
  for (let dy = -160; dy <= 160; dy += 10) for (let dx = -220; dx <= 220; dx += 10) points.push([dx, dy]);
  points.sort((a, b) => Math.hypot(a[0], a[1]) - Math.hypot(b[0], b[1]));
  let hit = null;
  for (const [dx, dy] of points) {
    const x = box.x + W / 2 + dx, y = box.y + GH / 2 + dy;
    if (await cursorAt(page, x, y) === "pointer") { hit = { x, y }; break; }
  }
  expect(hit, "no worker under the pointer after zooming into the team").not.toBe(null);
  await page.mouse.click(hit.x, hit.y);
  await expect(page.locator("#panel")).toHaveClass(/open/);
  await expect(page.locator("#panel")).toContainText("Casey Reed");
  await expect(page.locator("#panel")).toContainText("Closer");
  await expect(page.locator("#panel")).toContainText("8:00 AM");

  await page.keyboard.press("Escape");
  await expect(page.locator("#panel")).not.toHaveClass(/open/);
  await page.keyboard.press("Escape");
  // Back at the whole sky: the team is a target again, so the pointer is a hand over it.
  await page.waitForTimeout(1200);
  expect(await cursorAt(page, sx, sy)).toBe("pointer");
});

test("with no session the sky says sign in, and reads nothing", async ({ page }) => {
  const asked = [];
  await page.route("**/api/**", (route) => { asked.push(route.request().url()); return route.fulfill({ status: 401, contentType: "application/json", body: "{}" }); });
  await page.goto("/app/galaxy.html");
  await page.waitForTimeout(500);
  expect(asked.filter((u) => u.includes("company-activity"))).toEqual([]);
});
