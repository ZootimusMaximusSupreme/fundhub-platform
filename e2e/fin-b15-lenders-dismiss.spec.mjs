// Finish-853 batch 15, repair cycle 1: the Lenders desk's Dismiss button, pressed on the real page.
//
//   lenders.html: Mismatch queue row: Dismiss button
//
// A practice test: the real page in Chromium, fake /api answers, no live data. It presses Dismiss (and its
// two neighbours Confirm and Corrected, so a swap between them is caught) and judges the exact request:
// which row, which word. The handler and the SQL behind it are judged by
// src/pulse/catalog/proofs/fin-b15-lenders-dismiss.test.mjs.

import { test, expect } from "@playwright/test";
import { OWNER, json, openScreen } from "./harness.mjs";

const O1 = "bbbbbbbb-1111-4111-8111-111111111111";
const O2 = "bbbbbbbb-2222-4222-8222-222222222222";
const O3 = "bbbbbbbb-3333-4333-8333-333333333333";

const row = (id, lender) => ({
  id, lender_name: lender, lender_table: "OnlineBizCC", expected_bureaus_raw: "EX", observed_bureau: "TU",
  observation_source: "manual", mismatch_flag: true, review_status: "pending",
  client_id: "aaaaaaaa-1111-4111-8111-111111111111", notes: null
});

async function open(page, { failWith = null } = {}) {
  const posts = [];
  const open = [row(O1, "First Bank"), row(O2, "Second Bank"), row(O3, "Third Bank")];
  await openScreen(page, "/app/lenders.html", OWNER, {
    "/api/read/lenders": { ok: true, lenders: [], meta: { count: 0, empty: true } },
    "/api/read/lender-observations": async (route) => json(route, { ok: true, observations: open.slice(), meta: { count: open.length } }),
    "/api/lender-observations": async (route) => {
      const sent = JSON.parse(route.request().postData() || "{}");
      posts.push(sent);
      if (failWith) return json(route, { ok: false, error: failWith }, 400);
      const at = open.findIndex((r) => r.id === sent.id);
      if (at >= 0) open.splice(at, 1);
      return json(route, { ok: true, observation: { id: sent.id, review_status: sent.review_status } });
    }
  });
  await page.getByRole("button", { name: /Bureau mismatch queue/i }).click();
  await expect(page.locator("#reviewBody tr")).toHaveCount(3);
  return { posts };
}

const rowFor = (page, lender) => page.locator("#reviewBody tr", { hasText: lender });

test("Dismiss sends that row's id and the word dismissed, the row leaves the queue, and the others stay", async ({ page }) => {
  const { posts } = await open(page);
  await rowFor(page, "Second Bank").getByRole("button", { name: "Dismiss" }).click();
  await expect(page.locator("#reviewBody tr")).toHaveCount(2);
  await expect(page.locator("#reviewBody")).not.toContainText("Second Bank");
  await expect(page.locator("#reviewBody")).toContainText("First Bank");
  await expect(page.locator("#reviewBody")).toContainText("Third Bank");
  await expect(page.locator("#toast")).toHaveText("Updated");
  await expect(page.locator("#mismatchCount")).toHaveText("(2)");
  await expect(page.locator("#reviewMeta")).toHaveText("2 open");
  expect(posts).toEqual([{ action: "review", id: O2, review_status: "dismissed" }]);
});

test("Confirm and Corrected each send their own word, so Dismiss cannot be sending one of theirs", async ({ page }) => {
  const { posts } = await open(page);
  await rowFor(page, "First Bank").getByRole("button", { name: "Confirm" }).click();
  await expect(page.locator("#reviewBody tr")).toHaveCount(2);
  await rowFor(page, "Third Bank").getByRole("button", { name: "Corrected" }).click();
  await expect(page.locator("#reviewBody tr")).toHaveCount(1);
  await rowFor(page, "Second Bank").getByRole("button", { name: "Dismiss" }).click();
  await expect(page.locator("#reviewBody tr")).toHaveCount(0);
  await expect(page.locator("#reviewEmpty")).toBeVisible();
  expect(posts).toEqual([
    { action: "review", id: O1, review_status: "confirmed" },
    { action: "review", id: O3, review_status: "corrected" },
    { action: "review", id: O2, review_status: "dismissed" }
  ]);
});

test("a Dismiss the server refuses keeps the row in the queue and says so, and nothing else is sent", async ({ page }) => {
  const { posts } = await open(page, { failWith: "invalid_review_status" });
  await rowFor(page, "First Bank").getByRole("button", { name: "Dismiss" }).click();
  await expect.poll(() => posts.length).toBe(1);
  await expect(page.locator("#toast")).toHaveText("invalid_review_status");
  await expect(page.locator("#reviewBody tr")).toHaveCount(3);
  await expect(page.locator("#reviewBody")).toContainText("First Bank");
  expect(posts).toEqual([{ action: "review", id: O1, review_status: "dismissed" }]);
});
