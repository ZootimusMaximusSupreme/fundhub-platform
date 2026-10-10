// Company Brain — Send, Enter, and New chat, pressed (no backend, no AI).
//
// The only Company Brain browser spec is a live one that needs the deployed
// site. This presses the chat locally with the answer stood in: the question is
// sent as typed, the thread id comes back and rides on the next question, New
// chat starts clean, and a refusal is said in plain words, not a code.

import { test, expect } from "@playwright/test";
import { openScreen, json, OWNER } from "./harness.mjs";

const THREAD = "7b000000-0000-4000-8000-000000000001";

async function open(page, { answer } = {}) {
  const asks = [];
  await openScreen(page, "/app/company-brain.html", OWNER, {
    "/api/read/company-brain": async (route) => {
      asks.push(route.request().postDataJSON());
      const out = answer ? answer(asks.length) : { ok: true, thread_id: THREAD, answer: { text: `Answer ${asks.length}.`, source: "docs" }, sources: [] };
      return json(route, out);
    },
    "/api/company-brain/threads": { ok: true, threads: [] },
    "/api/company-brain/upload": { ok: true, files: [] },
    "/api/company-brain/reviews": { ok: true, items: [] }
  });
  return { asks };
}

test.describe("company brain chat", () => {
  test("Send asks the question typed; the next question carries the thread it opened", async ({ page }) => {
    const { asks } = await open(page);
    await page.locator("#q").fill("  How do I send a contract?  ");
    await page.locator("#askBtn").click();
    await expect.poll(() => asks.length).toBe(1);
    expect(asks[0]).toEqual({ question: "How do I send a contract?" });
    await expect(page.locator("body")).toContainText("Answer 1.");
    await page.locator("#q").fill("And how do I void one?");
    await page.locator("#q").press("Enter");
    await expect.poll(() => asks.length).toBe(2);
    expect(asks[1]).toEqual({ question: "And how do I void one?", thread_id: THREAD });
  });

  test("Shift+Enter makes a new line and sends nothing; an empty box sends nothing", async ({ page }) => {
    const { asks } = await open(page);
    await page.locator("#q").fill("line one");
    await page.locator("#q").press("Shift+Enter");
    await page.waitForTimeout(200);
    expect(asks).toEqual([]);
    await page.locator("#q").fill("   ");
    await page.locator("#askBtn").click();
    await page.waitForTimeout(200);
    expect(asks).toEqual([]);
  });

  test("New chat starts clean: the next question carries no thread", async ({ page }) => {
    const { asks } = await open(page);
    await page.locator("#q").fill("First question");
    await page.locator("#askBtn").click();
    await expect.poll(() => asks.length).toBe(1);
    // At a 1280-wide screen the account bar shell.js draws sits on top of New
    // chat (a leftover card is filed). A person hides it with its x first.
    await page.locator("#fh-shell-chip-hide").click();
    await page.locator("#newChat").click();
    await page.locator("#q").fill("Fresh question");
    await page.locator("#askBtn").click();
    await expect.poll(() => asks.length).toBe(2);
    expect(asks[1]).toEqual({ question: "Fresh question" });
  });

  test("a refusal is shown in words, and Send comes back", async ({ page }) => {
    const { asks } = await open(page, { answer: () => ({ ok: false, error: "invalid_thread_id" }) });
    await page.locator("#q").fill("Anything");
    await page.locator("#askBtn").click();
    await expect.poll(() => asks.length).toBe(1);
    await expect(page.locator("body")).toContainText("That chat link is broken.");
    await expect(page.locator("#askBtn")).toHaveText("Send");
    await expect(page.locator("#askBtn")).toBeEnabled();
  });
});
