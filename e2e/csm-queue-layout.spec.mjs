import { test, expect } from "@playwright/test";
import path from "node:path";
import { openScreen, json, OWNER } from "./harness.mjs";

const EVIDENCE = "ops/workflows/build-evidence/crm-portal-layout-audit-2026-10-18/csm-queue";
const ME = "5a000000-0000-4000-8000-0000000000c5";
const NOW = "2026-10-18T15:00:00Z";
const QUESTIONS = {
  mid: [{ id: "why_buy", prompt: "What did you hope to achieve when you joined?" }, { id: "support", prompt: "Where would a little more support help?" }],
  post: [{ id: "result", prompt: "What happened with your funding?" }]
};
const ROWS = [
  { task_id: "task-mid", client_id: "c1000000-0000-4000-8000-000000000001", client_name: "Dana Whitfield", client_code: "FH-101", title: "Halfway accountability call", source_workflow: "customer-insights-mid", due_at: "2026-10-16T15:00:00Z", owned_codes: ["funding_bundle"], balance_due: null, open_invoices: 0, assignee_staff_id: null, meeting_url: null },
  { task_id: "task-post", client_id: "c1000000-0000-4000-8000-000000000002", client_name: "Marcus Chen", client_code: "FH-102", title: "Funding results conversation", source_workflow: "customer-insights-post", due_at: "2026-10-18T16:00:00Z", owned_codes: ["capital_blueprint", "funding_bundle"], balance_due: "1250.00", open_invoices: 1, bill_days_overdue: 30, assignee_staff_id: ME, meeting_url: "https://meet.example.test/results" },
  { task_id: "task-prep", client_id: "c1000000-0000-4000-8000-000000000003", client_name: "Amelia Robinson", client_code: "FH-103", title: "Closing prep call before the closer", source_workflow: "blueprint-csm-prep", due_at: "2026-10-19T16:00:00Z", owned_codes: ["capital_blueprint"], balance_due: "0.00", open_invoices: 0, assignee_staff_id: "teammate", assigned_csm_name: "Casey Reed", meeting_url: null },
  { task_id: "task-coach", client_id: "c1000000-0000-4000-8000-000000000004", client_name: "Jamie Ortiz", client_code: "FH-104", title: "Check in after coach texts stopped", source_workflow: "blueprint-coach", due_at: null, owned_codes: [], balance_due: null, open_invoices: 0, assignee_staff_id: null, meeting_url: null }
];

async function fixture(page, mode = "full", { questions = QUESTIONS, shift = { id: "shift-1", staff_id: ME, started_at: "2026-10-18T14:00:00Z" } } = {}) {
  const writes = [];
  let reads = 0;
  await page.clock.install({ time: new Date(NOW) });
  await page.route(/^https:\/\//, route => route.abort());
  await openScreen(page, "/app/csm-queue.html", { ...OWNER, staff: { ...OWNER.staff, id: ME, role: "csm" } }, {
    "/api/shifts": (route, { method }) => {
      if (method !== "GET") { writes.push({ path: "/api/shifts", body: route.request().postDataJSON() }); return json(route, { ok: true, shift: null }); }
      if (mode === "error") return json(route, { ok: false, error: "unavailable" }, 503);
      return json(route, { ok: true, shift });
    },
    "/api/read/csm-queue": async route => {
      reads++;
      if (mode === "loading") return new Promise(() => {});
      if (mode === "error") return json(route, { ok: false, error: "unavailable" }, 503);
      return json(route, { ok: true, items: mode === "empty" ? [] : ROWS });
    },
    "/api/read/customer-insights": { ok: true, items: [], questions },
    "/api/tasks": route => { writes.push({ path: "/api/tasks", body: route.request().postDataJSON() }); return json(route, { ok: false, error: "no_active_shift" }, 403); },
    "/api/customer-insights": route => { writes.push({ path: "/api/customer-insights", body: route.request().postDataJSON() }); return json(route, { ok: true }, 201); }
  });
  return { writes, reads: () => reads };
}

async function markedScreenshot(page, file, text, target = ".q-head") {
  await page.evaluate(({ text, target }) => {
    const el = document.querySelector(target);
    const box = el.getBoundingClientRect();
    const mark = document.createElement("div");
    mark.dataset.evidence = "true";
    Object.assign(mark.style, { position: "absolute", left: (box.left + scrollX - 3) + "px", top: (box.top + scrollY - 3) + "px", width: (box.width + 6) + "px", height: (box.height + 6) + "px", border: "2px solid #c72626", borderRadius: "5px", pointerEvents: "none", zIndex: "9999" });
    const caption = document.createElement("div");
    caption.textContent = text;
    Object.assign(caption.style, { position: "absolute", top: "-3px", left: "4px", transform: "translateY(-100%)", maxWidth: Math.max(150, box.width - 8) + "px", background: "#c72626", color: "white", padding: "4px 7px", font: "11px/1.35 system-ui", borderRadius: "3px" });
    mark.appendChild(caption);
    document.body.appendChild(mark);
  }, { text, target });
  await page.screenshot({ path: path.join(EVIDENCE, file), fullPage: true });
  await page.locator('[data-evidence="true"]').evaluateAll(els => els.forEach(el => el.remove()));
}

for (const width of [1440, 390, 320]) {
  for (const mode of ["full", "empty", "loading", "error"]) test(mode + " state fits " + width + "px and keeps the next action visible", async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const { writes } = await fixture(page, mode);
    await expect(page.locator("#fh-workspace-header")).toBeVisible();
    if (mode === "full") {
      await expect(page.locator("#qCount")).toHaveText("4");
      await expect(page.locator("#qOverdue")).toContainText("1 call past due");
      await expect(page.locator("#qList [data-row]")).toHaveCount(4);
      const nextAction = await page.locator('[data-claim="task-mid"]').boundingBox();
      expect(nextAction.y + nextAction.height).toBeLessThanOrEqual(844);
      await expect(page.locator('[data-row="task-mid"]')).toContainText("Owes —");
      await expect(page.locator('[data-row="task-prep"]')).toContainText("Owes $0.00");
      await expect(page.locator('[data-row="task-post"]')).toContainText("bill 30 days late");
      await expect(page.locator('[data-row="task-post"]')).not.toContainText("Call 30 days late");
      await expect(page.locator('[data-row="task-prep"]')).toContainText("Assigned CSM: Casey Reed");
      await expect(page.locator('[data-row="task-prep"] [data-claim]')).toHaveCount(0);
      await expect(page.locator('[data-row="task-coach"] [data-open]')).toHaveCount(0);
      await expect(page.getByRole("link", { name: "Booking link" })).toHaveAttribute("href", "https://meet.example.test/results");
    } else if (mode === "empty") {
      await expect(page.locator("#qCount")).toHaveText("0");
      await expect(page.locator("#qList")).toContainText("No calls are waiting for you.");
      await expect(page.locator("#qList a")).toHaveAttribute("href", "client-control-panel.html");
    } else if (mode === "loading") {
      await expect(page.locator("#qList")).toHaveAttribute("aria-busy", "true");
      await expect(page.locator(".q-skel")).toHaveCount(3);
    } else {
      await expect(page.locator("#qCount")).toHaveText("—");
      await expect(page.locator("#qList")).toContainText("The database is not reachable");
      await expect(page.locator("#qClock")).toBeDisabled();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(writes).toEqual([]);
    await markedScreenshot(page, "after-" + mode + "-" + width + ".png", "After: " + mode + " queue · " + width + "px · safe API fixture", mode === "full" ? ".q-list" : ".q-head");
  });
}

test("keyboard interview controls preserve the question bank, default channel and focus", async ({ page }) => {
  await fixture(page);
  const open = page.locator('[data-open="task-post"]');
  await open.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#qChan")).toBeFocused();
  await expect(open).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#qChan")).toHaveValue("google_meet");
  await expect(page.locator("#qa-result")).toBeVisible();
  await page.locator('[data-save="task-post"]').click();
  await expect(page.locator("#qSay")).toContainText("at least one answer");
  await open.focus();
  await page.keyboard.press("Enter");
  await expect(open).toBeFocused();
  await expect(open).toHaveAttribute("aria-expanded", "false");
});

test("a shift change and queue refresh preserve unsaved conversation notes", async ({ page }) => {
  await fixture(page);
  await page.locator('[data-open="task-mid"]').click();
  await page.locator("#qa-why_buy").fill("Inventory funding for the new season.");
  await page.locator("#qNotes").fill("Keep this note while ending the shift.");
  await page.locator("#qClock").click();
  await expect(page.locator("#qClock")).toHaveText("Start shift");
  await expect(page.locator("#qa-why_buy")).toHaveValue("Inventory funding for the new season.");
  await page.locator("#qRefresh").click();
  await expect(page.locator("#qNotes")).toHaveValue("Keep this note while ending the shift.");
});

test("a shift action never turns a still-loading queue into a false empty state", async ({ page }) => {
  await fixture(page, "loading");
  await page.locator("#qClock").click();
  await expect(page.locator("#qClock")).toHaveText("Start shift");
  await expect(page.locator("#qCount")).toHaveText("—");
  await expect(page.locator(".q-skel")).toHaveCount(3);
  await expect(page.locator("#qList")).toHaveAttribute("aria-busy", "true");
});

test("post interviews send their stage, selected channel and null optional notes", async ({ page }) => {
  const { writes } = await fixture(page);
  await page.locator('[data-open="task-post"]').click();
  await page.locator("#qChan").selectOption("ai_reachout");
  await page.locator("#qa-result").fill("  Two cards for $40,000.  ");
  await page.locator('[data-save="task-post"]').click();
  expect(writes).toEqual([{ path: "/api/customer-insights", body: {
    client_id: ROWS[1].client_id, task_id: "task-post", stage: "post", channel: "ai_reachout",
    answers: { result: "Two cards for $40,000." }, notes: null
  } }]);
  await expect(page.locator("#qBanner")).toContainText("Answers saved for Marcus Chen.");
  await expect(page.locator('[data-open="task-post"]')).toBeFocused();
});

test("touch targets, retry and missing questions remain useful at 320px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  const { reads, writes } = await fixture(page, "full", { questions: null, shift: null });
  const before = reads();
  await page.locator("#qRefresh").click();
  await expect.poll(reads).toBeGreaterThan(before);
  await page.locator('[data-open="task-mid"]').click();
  await expect(page.locator("#qList")).toContainText("The question list did not load.");
  await expect(page.locator('[data-open="task-mid"]')).toBeFocused();
  const sizes = await page.locator('.content button, .content a.btn').evaluateAll(els => els.filter(el => el.getClientRects().length).map(el => ({ text: el.textContent.trim(), height: el.getBoundingClientRect().height })));
  expect(sizes.every(size => size.height >= 44), JSON.stringify(sizes)).toBe(true);
  expect(writes).toEqual([]);
});

test.describe("phone touch", () => {
  test.use({ hasTouch: true });
  test("tap opens notes and refresh keeps the draft at 390px", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const { writes } = await fixture(page);
    await page.locator('[data-open="task-mid"]').tap();
    await expect(page.locator("#qChan")).toHaveValue("call");
    await page.locator("#qa-why_buy").fill("A line of credit for seasonal inventory.");
    await page.locator("#qRefresh").tap();
    await expect(page.locator("#qa-why_buy")).toHaveValue("A line of credit for seasonal inventory.");
    await page.waitForTimeout(450); // Let the browser’s touch highlight finish before review capture.
    await markedScreenshot(page, "after-interview-390.png", "After: touch interview · real question schema · unsaved draft retained", ".q-form");
    await page.locator('[data-open="task-mid"]').tap();
    await expect(page.locator("#qa-why_buy")).toHaveCount(0);
    expect(writes).toEqual([]);
  });
});
