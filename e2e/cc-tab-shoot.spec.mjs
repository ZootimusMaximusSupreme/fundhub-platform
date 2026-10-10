// The Shoot tab in a real browser, offline (unit X5).
//
// The tab (public/app/cc-tab-shoot.js) is mounted by e2e/helpers/shoot-tab-host.html,
// the tiny stand-in registry docs/specs/command-center-tabs.md allows until the
// frame lands. /api/** is answered here from the API contract's own examples
// (src/marketing/api-contract.mjs), so the screen is tested against the shapes
// the server promises. No database, no session, nothing sent anywhere.
//
// It proves: approved scripts show in film order with the ad number, the angle
// name and the exact NAMING.md take file name; Film first and the arrows change
// the order that Save the plan sends; Open the teleprompter is the one filled
// button once a shoot exists; Got it from a row; the board; the two-tap close;
// the empty and error states; one column with no sideways scroll at 390px and
// big enough taps; and nothing breaks at 1280.

import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CONTRACT } from "../src/marketing/api-contract.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOST = fs.readFileSync(path.join(HERE, "helpers", "shoot-tab-host.html"), "utf8");
const plain = (v) => JSON.parse(JSON.stringify(v));
const PAGE = plain(CONTRACT["GET marketing/shoot"].example.response);
const [ONE, TWO] = PAGE.shoot.scripts;

/* Before any shoot: three approved scripts, the last a retake. */
const C1 = { ...ONE, takes: 0, got_it: false, take_no: 1, take_file_name: "SLO Ad 91 — Lenders read two files Take 1.mp4", last_take_file_name: null };
const C2 = { ...TWO };
const C3 = {
  ...ONE, id: "00000000-0000-4000-8000-000000000301", root_script_id: "00000000-0000-4000-8000-000000000301",
  ad_id: "93", title: "Your file is worth more", angle_name: "Your file is worth more", takes: 0, got_it: false,
  take_no: 2, take_file_name: "SLO Ad 93 — Your file is worth more Take 2.mp4", last_take_file_name: null, needs_retake: true
};
const NO_SHOOT = { shoot: null, plan_candidates: [C3, C1, C2], plan_estimated_minutes: 8, past_shoots: [], wpm: 150, as_of: "2026-10-13T16:06:00.000Z" };

async function host(page, { get, posts = [], noConfirm = false } = {}) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  if (noConfirm) await page.addInitScript(() => { window.__noConfirm = true; });
  await page.route("**/e2e-host/shoot.html", (r) => r.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: HOST }));
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname.replace(/^\/api\//, "");
    if (req.method() === "GET" && p === "marketing/shoot") {
      const out = typeof get === "function" ? get(url) : get;
      return route.fulfill({ status: out.status || 200, contentType: "application/json", body: JSON.stringify(out.body ?? out) });
    }
    if (req.method() === "POST") {
      const body = JSON.parse(req.postData() || "{}");
      posts.push({ path: p, body });
      if (p === "marketing/shoot") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ shoot: PAGE.shoot }) });
      if (p === "marketing/shoot/mark") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ marks: {} }) });
    }
    return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "not_found", path: p }) });
  });
  await page.goto("/e2e-host/shoot.html");
  return errors;
}

async function noSideways(page) {
  const w = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect(w[0], "no sideways scroll").toBeLessThanOrEqual(w[1]);
}

for (const size of [{ width: 390, height: 844 }, { width: 1280, height: 900 }]) {
  test.describe(`Shoot tab at ${size.width}px`, () => {
    test.use({ viewport: size, timezoneId: "America/Phoenix", locale: "en-US" });

    test("before a shoot: approved scripts in film order, each with its exact take file name; Save the plan sends the order", async ({ page }) => {
      const posts = [];
      let saved = false;
      const errors = await host(page, { get: () => (saved ? PAGE : NO_SHOOT), posts });
      await expect(page.getByText("Ready to film: 3 scripts, about 8 minutes")).toBeVisible();
      const rows = page.locator("ol.rows > li");
      await expect(rows).toHaveCount(3);
      await expect(rows.nth(0)).toContainText("Ad 93 · Your file is worth more");
      await expect(rows.nth(0)).toContainText("Retake");
      await expect(rows.nth(0).locator("[data-file]")).toHaveText("SLO Ad 93 — Your file is worth more Take 2.mp4");
      await expect(rows.nth(1).locator("[data-file]")).toHaveText("SLO Ad 91 — Lenders read two files Take 1.mp4");
      await expect(rows.nth(2)).toContainText("File name unknown: The Funding, done-for-you offer has no file-name word yet");

      // The teleprompter waits for a plan, and says why.
      const tp = page.getByRole("button", { name: "Open the teleprompter" });
      await expect(tp).toBeDisabled();
      await expect(page.getByText("Save a plan first. Free.")).toBeVisible();

      // Film first moves Ad 92 to the top; it leaves the plan when unticked.
      await rows.nth(2).getByRole("button", { name: "Film first" }).click();
      await expect(rows.nth(0)).toContainText("Ad 92");
      await page.getByRole("button", { name: "Move Ad 93 down" }).click();
      await expect(rows.nth(2)).toContainText("Ad 93");
      await rows.nth(0).getByLabel("On the plan").uncheck();

      saved = true;
      await page.getByRole("button", { name: "Save the plan" }).click();
      await expect(page.getByText("Today's shoot: 2 scripts, about 5 minutes")).toBeVisible();
      expect(posts).toHaveLength(1);
      expect(posts[0].path).toBe("marketing/shoot");
      expect(posts[0].body.root_script_ids).toEqual([C1.root_script_id, C3.root_script_id]);
      expect(posts[0].body.request_id).toMatch(/^[A-Za-z0-9._:-]{8,200}$/);
      expect(errors).toEqual([]);
      if (size.width === 390) await noSideways(page);
    });

    test("the teleprompter link carries the film key from the shoot", async ({ page }) => {
      const key = "/app/teleprompter.html?k=11111111-1111-4111-8111-111111111111.22222222-2222-4222-8222-222222222222.1.ab";
      const keyed = { ...PAGE, film: { path: key, expires_at: "2026-10-14T16:00:00.000Z" } };
      await host(page, { get: keyed });
      await expect(page.getByRole("link", { name: "Open the teleprompter" })).toHaveAttribute("href", key);
      await expect(page.locator("ol.rows > li").nth(1).getByRole("link", { name: "Roll it" })).toHaveAttribute("href", `${key}&script=${TWO.root_script_id}`);
      await expect(page.getByText(/sign in/i)).toHaveCount(0);
    });

    test("with a shoot: the teleprompter is the filled button, rows mark takes, the board and the two-tap close", async ({ page }) => {
      const posts = [];
      const errors = await host(page, { get: PAGE, posts });
      await expect(page.getByText("Today's shoot: 2 scripts, about 5 minutes")).toBeVisible();
      const open = page.getByRole("link", { name: "Open the teleprompter" });
      await expect(open).toHaveAttribute("href", "/app/teleprompter.html");
      await expect(open).toHaveClass(/primary/);
      expect(await page.locator(".cc-shoot .btn.primary").count(), "one filled button").toBe(1);
      await expect(page.getByText("1 of 2 marked Got it.")).toBeVisible();

      const rows = page.locator("ol.rows > li");
      await expect(rows.nth(0)).toContainText("Got it");
      await expect(rows.nth(0).locator("[data-file]")).toHaveText("SLO Ad 91 — Lenders read two files Take 3.mp4");
      await expect(rows.nth(1).getByRole("link", { name: "Roll it" })).toHaveAttribute("href", `/app/teleprompter.html?script=${TWO.root_script_id}`);
      await rows.nth(1).getByRole("button", { name: "Another take" }).click();
      await expect.poll(() => posts.length).toBe(1);
      expect(posts[0]).toMatchObject({ path: "marketing/shoot/mark", body: { shoot_id: PAGE.shoot.id, root_script_id: TWO.root_script_id, mark: "another_take" } });

      // The board, in words.
      const board = page.getByRole("list", { name: "Progress board" });
      await expect(board).toContainText("Ad 91 · Lenders read two files");
      await expect(board).toContainText("Filmed");
      await expect(page.getByRole("link", { name: "Open SLO Ads in Drive" })).toHaveAttribute("href", "https://drive.google.com/drive/folders/13ZOjA56MNuM-PHSRK5fQK0bovRwR8raZ");

      // Close takes two taps; the second names the consequence.
      await page.getByRole("button", { name: "Close the shoot" }).click();
      expect(posts).toHaveLength(1);
      await expect(page.getByText("Close this shoot? Scripts not marked Got it stay on the next plan.")).toBeVisible();
      await page.getByRole("button", { name: "Close it" }).click();
      await expect.poll(() => posts.length).toBe(2);
      expect(posts[1].body).toMatchObject({ id: PAGE.shoot.id, status: "done" });

      if (size.width === 390) {
        await noSideways(page);
        const small = await page.locator(".cc-shoot button:visible, .cc-shoot a.btn:visible").evaluateAll((els) =>
          els.map((e) => [e.textContent.trim(), e.getBoundingClientRect().height]).filter(([, h]) => h < 44));
        expect(small, "every tap is at least 44px tall").toEqual([]);
      }
      expect(errors).toEqual([]);
    });
  });
}

test.describe("Shoot tab states", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("empty: nothing approved says what to do, and nothing can be saved", async ({ page }) => {
    await host(page, { get: { shoot: null, plan_candidates: [], plan_estimated_minutes: 0, past_shoots: [], wpm: 150, as_of: NO_SHOOT.as_of } });
    await expect(page.getByText("Nothing to film yet")).toBeVisible();
    await expect(page.getByText("No approved scripts to film. Approve some in Scripts first.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Save the plan" })).toBeDisabled();
  });

  test("error: a failed read says so in words, and Try again reads again", async ({ page }) => {
    let calls = 0;
    await host(page, { get: () => (++calls === 1 ? { status: 500, body: { error: "internal_error" } } : NO_SHOOT) });
    await expect(page.getByText("The shoot did not load. The rest of this page is current. Try again.")).toBeVisible();
    await expect(page.getByText(/internal_error|500/)).toHaveCount(0);
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByText("Ready to film: 3 scripts, about 8 minutes")).toBeVisible();
  });

  test("a refused save shows the server's words where Chris is looking", async ({ page }) => {
    await host(page, { get: NO_SHOOT });
    await page.route("**/api/marketing/shoot", (route) => route.request().method() === "POST"
      ? route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: "invalid", field: "id", message: "A shoot is already planned. Change that one, or close it before you plan a new one." }) })
      : route.fallback());
    await page.getByRole("button", { name: "Save the plan" }).click();
    await expect(page.getByRole("alert")).toHaveText("A shoot is already planned. Change that one, or close it before you plan a new one.");
  });

  test("without the frame's confirm sheet, Close still takes two taps", async ({ page }) => {
    const posts = [];
    await host(page, { get: PAGE, posts, noConfirm: true });
    await page.getByRole("button", { name: "Close the shoot" }).click();
    await expect(page.getByText("Close this shoot? Scripts not marked Got it stay on the next plan.")).toBeVisible();
    expect(posts).toHaveLength(0);
    await page.getByRole("button", { name: "Keep it open" }).click();
    expect(posts).toHaveLength(0);
  });
});
