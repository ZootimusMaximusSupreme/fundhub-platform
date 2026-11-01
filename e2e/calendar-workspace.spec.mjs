import fs from "node:fs";
import path from "node:path";
import { test, expect } from "@playwright/test";
import { CLIENT_ID, CLOSER, wireApi, gotoScreen } from "./harness.mjs";

const runtimeErrors = new WeakMap();
test.beforeEach(async ({ page }) => {
  const errors = [];
  runtimeErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(String(error)));
});
test.afterEach(async ({ page }) => {
  expect(runtimeErrors.get(page), "calendar emits no JavaScript errors").toEqual([]);
});

const proofDir = path.resolve("ops/workflows/build-evidence/crm-portal-layout-audit-2026-10-18/calendar");
const clock = new Date("2026-10-18T16:00:00Z");
const tasks = [
  { id: "completed", client_name: "Erin Cole", title: "Document review", due_at: "2026-10-18T15:00:00Z", done: true, assignee_name: "Casey Reed" },
  { id: "first", client_id: CLIENT_ID, client_name: "Dana Whitfield", title: "Funding strategy call · Review the next funding round and documents", due_at: "2026-10-18T17:00:00Z", done: false, assignee_name: "Casey Reed", assignee_role: "closer", meeting_url: "https://meet.example.com/dana" },
  { id: "second", client_id: CLIENT_ID, client_name: "Alexandra Montgomery-Williams", title: "Business credit review and application checklist", due_at: "2026-10-18T19:30:00Z", done: false },
  { id: "tomorrow", client_id: CLIENT_ID, client_name: "Marcus Bell", title: "Follow-up call", due_at: "2026-10-19T18:00:00Z", done: false },
  { id: "undated", client_name: "Priya Raman", title: "Check the uploaded bank statements", due_at: null, done: false }
];

async function openCalendar(page, state = "full") {
  await page.clock.setFixedTime(clock);
  await wireApi(page, {
    session: CLOSER,
    handlers: {
      "/api/tasks": async (route, { url }) => {
        if (state === "loading") {
          await new Promise((resolve) => setTimeout(resolve, 1500));
        }
        if (state === "error" || (state === "partial" && url.includes("done=true"))) {
          return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, error: "db_unavailable" }) });
        }
        const selected = state === "empty" ? [] : tasks.filter((task) => url.includes("done=true") ? task.done : !task.done);
        return { ok: true, tasks: selected };
      },
      "/api/shifts?roster=1": () => ({ ok: true, roster: [{ name: "Casey Reed", role: "closer", started_at: "2026-10-18T15:00:00Z" }] })
    }
  });
  await gotoScreen(page, "calendar.html");
  if (state === "full" || state === "partial") await expect(page.locator("#unClient")).toHaveText("Dana Whitfield");
  else if (state === "empty") await expect(page.locator(".day-wrap")).toContainText("No tasks due.");
  else if (state === "error") await expect(page.locator(".day-wrap")).toContainText("Schedule did not load.");
  else await expect(page.locator(".day-wrap")).toContainText("Loading the schedule");
}

async function markedScreenshot(page, filename, selector, caption) {
  const box = await page.locator(selector).first().boundingBox();
  if (box) {
    await page.evaluate(({ box, caption }) => {
      const mark = document.createElement("div");
      mark.id = "calendar-evidence-mark";
      const left = Math.max(3, box.x), top = Math.max(76, box.y);
      const width = Math.min(box.width, innerWidth - left - 3);
      const height = Math.max(30, Math.min(box.y + box.height, innerHeight - 6) - top);
      mark.style.cssText = `position:fixed;pointer-events:none;z-index:2147483001;left:${left}px;top:${top}px;width:${width}px;height:${height}px;border:2px solid #c52b2b;border-radius:5px;box-sizing:border-box`;
      const label = document.createElement("span");
      label.textContent = caption;
      label.style.cssText = `position:absolute;left:4px;top:${top > 105 ? "-23px" : "3px"};max-width:calc(100vw - 28px);padding:3px 6px;border:1px solid #c52b2b;border-radius:3px;color:#a51f1f;background:#fff;font:500 10px/1.3 system-ui;white-space:normal`;
      mark.appendChild(label);
      document.body.appendChild(mark);
    }, { box, caption });
  }
  await page.screenshot({ path: path.join(proofDir, filename), fullPage: true });
  await page.locator("#calendar-evidence-mark").evaluateAll((marks) => marks.forEach((mark) => mark.remove()));
}

for (const width of [1440, 390, 320]) {
  test(`calendar evidence ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
    const prefix = "after";
    const states = ["full", "empty", "loading", "error"];
    fs.mkdirSync(proofDir, { recursive: true });
    for (const state of states) {
      await openCalendar(page, state);
      if (prefix !== "before") {
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
        expect(overflow, `${state} at ${width}px has no page overflow`).toBe(false);
      }
      if (state !== "full") await page.locator(".day-wrap").evaluate((element) => element.scrollIntoView({ block: "start" }));
      const caption = { full: "Date and view controls", empty: "Empty: no appointments found", loading: "Loading: schedule still pending", error: "Error: reload the unread schedule" }[state];
      await markedScreenshot(page, `${prefix}-${width}-${state}.png`, state === "full" ? ".calendar-controls" : ".open-slot", caption);
      if (prefix !== "before" && state === "full") {
        const stats = await page.locator(".calendar-summary .stat:visible").evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().top));
        expect(new Set(stats.map(Math.round)).size, "summary stays in one readable row").toBe(1);
        await page.locator(".day-wrap").evaluate((element) => element.scrollIntoView({ block: "start" }));
        await expect(page.locator('.evt[data-task-id="first"]')).toBeVisible();
        await markedScreenshot(page, `${prefix}-${width}-day.png`, '.evt[data-task-id="first"]', "Readable appointment and task actions");
        await page.locator("#upNext").scrollIntoViewIfNeeded();
        await markedScreenshot(page, `${prefix}-${width}-details.png`, "#upNext", "Selected call and client context");
        await page.getByRole("button", { name: "Week", exact: true }).click();
        await page.locator(".weekstrip").scrollIntoViewIfNeeded();
        await expect(page.locator(".day-wrap")).toBeHidden();
        await expect(page.locator(".ws-chip").filter({ hasText: "Alexandra" })).toBeVisible();
        await markedScreenshot(page, `${prefix}-${width}-week.png`, ".ws-day.sel", "Week agenda shows every appointment");
      }
      await page.unrouteAll({ behavior: "ignoreErrors" });
    }
  });
}

test("calendar navigation and selection work with native keyboard controls", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openCalendar(page);
  const next = page.getByRole("button", { name: "Next day" });
  await next.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".datelabel")).toHaveText("Monday, October 19");
  await page.getByRole("button", { name: "Today", exact: true }).focus();
  await page.keyboard.press("Space");
  await expect(page.locator(".datelabel")).toHaveText("Sunday, October 18");
  const week = page.getByRole("button", { name: "Week", exact: true });
  await week.focus();
  await page.keyboard.press("Space");
  await expect(week).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Next week" })).toBeVisible();
  await expect(page.locator(".day-wrap")).toBeHidden();
  await page.locator('.ws-day[data-ymd="2026-10-19"]').focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".datelabel")).toHaveText("Monday, October 19");
  await expect(page.getByRole("button", { name: "Day", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('.ws-day[data-ymd="2026-10-19"]')).toBeFocused();
  await expect(page.locator(".day-wrap")).toBeVisible();
  for (const selector of [".navbtn", ".today-btn", "#seg button", ".ws-day"]) {
    for (const box of await page.locator(selector).evaluateAll((elements) => elements.map((element) => ({ width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height })))) {
      expect(box.width).toBeGreaterThanOrEqual(40);
      expect(box.height).toBeGreaterThanOrEqual(40);
    }
  }
});

test("calendar task and upcoming selection remain reachable by keyboard at 320px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await openCalendar(page);
  await page.locator('.evt-select[data-task-id="second"]').focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#unClient")).toHaveText("Alexandra Montgomery-Williams");
  await expect(page.locator('.evt-select[data-task-id="second"]')).toBeFocused();
  await page.locator('.then-row[data-task-id="tomorrow"]').focus();
  await page.keyboard.press("Space");
  await expect(page.locator("#unClient")).toHaveText("Marcus Bell");
  await expect(page.locator(".datelabel")).toHaveText("Monday, October 19");
  await expect(page.locator("#unFile")).toBeEnabled();
  await expect(page.locator("#unJoin")).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});

test("partial schedule keeps truthful counts and an accessible warning", async ({ page }) => {
  await openCalendar(page, "partial");
  await expect(page.locator("#statBooked")).toHaveText("—");
  await expect(page.locator("#statDone")).toHaveText("—");
  await expect(page.locator("#statLeft")).toHaveText("2");
  await expect(page.locator(".live-pill")).toContainText("Completed tasks unavailable");
  await expect(page.locator(".day-wrap")).toContainText("Completed tasks did not load.");
});

test("week navigation moves seven days and day totals stay tied to the selected date", async ({ page }) => {
  await openCalendar(page);
  await page.getByRole("button", { name: "Week", exact: true }).click();
  await page.getByRole("button", { name: "Next week" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".datelabel")).toHaveText("Week of Oct 25 – Oct 31");
  await expect(page.locator("#wsTitle")).toHaveText("Week of Oct 25 – Oct 31");
  await expect(page.locator(".ws-day.is-today")).toHaveCount(0);
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await expect(page.locator(".ws-day.is-today")).toHaveAttribute("data-ymd", "2026-10-18");
  await page.locator('.ws-day[data-ymd="2026-10-19"]').click();
  await expect(page.locator("#statBooked")).toHaveText("1");
  await expect(page.locator("#statDone")).toHaveText("0");
  await expect(page.locator("#statLeft")).toHaveText("1");
  await expect(page.locator("#statLeftLabel")).toHaveText("Left Oct 19");
});

test("undated work can be claimed and completed by keyboard on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  const writes = [];
  let claimed = false;
  let done = false;
  await page.clock.setFixedTime(clock);
  await wireApi(page, { session: CLOSER, handlers: {
    "/api/tasks": (route, { method, url }) => {
      if (method === "PATCH") {
        expect(route.request().headers().authorization).toBe("Bearer e2e-token");
        const body = route.request().postDataJSON();
        writes.push(body);
        if (body.claim) claimed = true;
        if (body.done) done = true;
        return { ok: true };
      }
      return { ok: true, tasks: done || url.includes("done=true") ? [] : [{
        ...tasks.find((task) => task.id === "undated"),
        assignee_name: claimed ? "Casey Reed" : null,
        assignee_staff_id: claimed ? "staff-2" : null
      }] };
    }
  } });
  await gotoScreen(page, "calendar.html");
  const claim = page.locator('#noDateList [data-act="claim"]');
  await expect(claim).toBeVisible();
  await claim.focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toEqual({ id: "undated", claim: true });
  await expect(page.locator("#noDateList")).toContainText("Casey Reed");
  await expect(claim).toHaveCount(0);
  const complete = page.locator('#noDateList [data-act="done"]');
  await complete.focus();
  await page.keyboard.press("Space");
  await expect.poll(() => writes.length).toBe(2);
  expect(writes[1]).toEqual({ id: "undated", done: true });
  await expect(page.locator("#noDateList")).toBeHidden();
  await expect(page.locator("#statNoDateTile")).toBeHidden();
});

test("a failed schedule can be reloaded without writing any task", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  let recovered = false;
  const writes = [];
  await page.clock.setFixedTime(clock);
  await wireApi(page, { session: CLOSER, handlers: {
    "/api/tasks": (route, { url, method }) => {
      if (method !== "GET") writes.push(method);
      if (!recovered) return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, error: "db_unavailable" }) });
      return { ok: true, tasks: tasks.filter((task) => url.includes("done=true") ? task.done : !task.done) };
    }
  } });
  await gotoScreen(page, "calendar.html");
  const retry = page.getByRole("button", { name: "Reload schedule" });
  await expect(retry).toBeVisible();
  recovered = true;
  await retry.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#unClient")).toHaveText("Dana Whitfield");
  await expect(page.locator("#fh-data-banner")).toBeHidden();
  await expect(page.locator(".live-pill")).toContainText("Schedule ready");
  expect(writes).toEqual([]);
});
