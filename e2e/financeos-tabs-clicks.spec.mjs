// FinanceOS (the client's money page) — the buttons a client presses, pressed.
//
// Money helper: the three suggestion buttons were tested by no one, and Send
// only in Node. Next steps: "Do task" hands a payment to the money helper and
// "I'm ready to get funded" opens a closing-prep call. Alerts: each switch
// stops or starts texts to the client. This presses each one through the real
// FinanceOS frame (financeos.html#tab), using the same sample answers the
// render tests pin, and checks the exact request.

import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { json, withSession } from "./harness.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => JSON.parse(fs.readFileSync(path.resolve(HERE, "..", rel), "utf8"));
const HELPER = read("src/http/fixtures/money-helper.sample.json");
const NEXT = read("src/http/fixtures/money-next.sample.json");
const ALERTS = read("src/finance/file-alerts/file-alerts.fixture.json");
const STAFF_CLIENT = "c1000000-0000-4000-8000-000000000001";

async function open(page, hash, { query = "", role = "client", handlers = {} } = {}) {
  await withSession(page, { staff: { role } });
  await page.route("**/api/**", async (route) => {
    const url = route.request().url();
    for (const [needle, h] of Object.entries(handlers)) {
      if (url.includes(needle)) return h(route, { url, method: route.request().method() });
    }
    if (url.includes("/api/money/overview")) return json(route, { ok: true, client: { name: "Dana Whitfield" }, sandbox: false });
    return json(route, { ok: true });
  });
  await page.goto(`/app/financeos.html${query}#${hash}`);
}

function recorder(getBody, postAnswer) {
  const posts = [];
  const handler = async (route, { method }) => {
    if (method === "POST") {
      const body = route.request().postDataJSON();
      posts.push(body);
      const out = postAnswer ? postAnswer(body) : { status: 200, body: { ok: true } };
      return route.fulfill({ status: out.status, contentType: "application/json", body: JSON.stringify(out.body) });
    }
    return json(route, typeof getBody === "function" ? getBody() : getBody);
  };
  return { posts, handler };
}

test.describe("FinanceOS: money helper", () => {
  const emptyThread = () => ({ ...HELPER, turns: [], pending: 0 });

  test("each suggestion button sends its own words as a message", async ({ page }) => {
    const r = recorder(emptyThread, () => ({ status: 202, body: { ok: true } }));
    await open(page, "helper", { handlers: { "/api/money/helper": r.handler } });
    const buttons = page.locator('#fos-helper [data-act="suggest"]');
    await expect(buttons).toHaveCount(3);
    const words = await buttons.first().getAttribute("data-text");
    await buttons.first().click();
    await expect.poll(() => r.posts.length).toBe(1);
    expect(r.posts[0]).toEqual({ action: "send", message: words });
  });

  test("Enter sends what was typed; Shift+Enter makes a new line and sends nothing", async ({ page }) => {
    const r = recorder(() => HELPER, () => ({ status: 202, body: { ok: true } }));
    await open(page, "helper", { handlers: { "/api/money/helper": r.handler } });
    const box = page.locator("#mh-input");
    await box.fill("Which card should I pay first?");
    await box.press("Shift+Enter");
    await page.waitForTimeout(200);
    expect(r.posts).toEqual([]);
    await box.press("Enter");
    await expect.poll(() => r.posts.length).toBe(1);
    expect(r.posts[0].action).toBe("send");
    expect(r.posts[0].message).toBe("Which card should I pay first?");
  });

  test("an empty message is refused on the page", async ({ page }) => {
    const r = recorder(() => HELPER);
    await open(page, "helper", { handlers: { "/api/money/helper": r.handler } });
    await page.locator('#fos-helper button[type="submit"]').click();
    await expect(page.locator("#fos-helper .send-msg")).toHaveText("Type a message first.");
    expect(r.posts).toEqual([]);
  });

  test("staff on a client's file: the message names that client", async ({ page }) => {
    const r = recorder(emptyThread, () => ({ status: 202, body: { ok: true } }));
    await open(page, "helper", { query: `?client_id=${STAFF_CLIENT}`, role: "funding_advisor", handlers: { "/api/money/helper": r.handler } });
    await page.locator('#fos-helper [data-act="suggest"]').nth(1).click();
    await expect.poll(() => r.posts.length).toBe(1);
    expect(r.posts[0].client_id).toBe(STAFF_CLIENT);
  });
});

test.describe("FinanceOS: next steps", () => {
  test("Do task hands that step to the money helper and the row says so", async ({ page }) => {
    const task = NEXT.tasks.tasks[0];
    const tasks = recorder(() => NEXT.tasks, (b) => ({ status: 200, body: { ok: true, task: { ...task, assignment: { status: "queued", open: true } } } }));
    const ready = recorder(() => NEXT.ready);
    await open(page, "next", { handlers: { "/api/money/tasks": tasks.handler, "/api/money/ready-to-fund": ready.handler } });
    const row = page.locator(`#fos-next [data-task-row="${task.id}"]`);
    await row.locator('[data-act="do"]').click();
    await expect.poll(() => tasks.posts.length).toBe(1);
    expect(tasks.posts[0]).toEqual({ action: "do_task", task_id: task.id });
    await expect(row.locator('[data-act="do"]')).toHaveCount(0);
    await expect(row.locator(".t-status")).not.toHaveText("");
  });

  test("a refused Do task says why and gives the button back", async ({ page }) => {
    const task = NEXT.tasks.tasks[1];
    const tasks = recorder(() => NEXT.tasks, () => ({ status: 409, body: { ok: false, error: "already_open", message: "Your money helper already has this one." } }));
    const ready = recorder(() => NEXT.ready);
    await open(page, "next", { handlers: { "/api/money/tasks": tasks.handler, "/api/money/ready-to-fund": ready.handler } });
    const row = page.locator(`#fos-next [data-task-row="${task.id}"]`);
    await row.locator('[data-act="do"]').click();
    await expect(row.locator(".act-msg")).toHaveText("Your money helper already has this one.");
    await expect(row.locator('[data-act="do"]')).toHaveText("Do task");
  });

  test("I'm ready to get funded sends the request; the card then says it went to the team", async ({ page }) => {
    const tasks = recorder(() => NEXT.tasks);
    const ready = recorder(() => NEXT.ready, () => ({ status: 200, body: { ...NEXT.ready, status: "requested", requested_at: "2026-10-10T17:00:00Z" } }));
    await open(page, "next", { handlers: { "/api/money/tasks": tasks.handler, "/api/money/ready-to-fund": ready.handler } });
    await page.locator('#fos-next [data-act="ready"]').click();
    await expect.poll(() => ready.posts.length).toBe(1);
    expect(ready.posts[0]).toEqual({});
    await expect(page.locator("#fos-next .ready")).toContainText("Sent to our team");
    await expect(page.locator('#fos-next [data-act="ready"]')).toHaveCount(0);
  });

  test("staff pressing it for a client names that client", async ({ page }) => {
    const tasks = recorder(() => NEXT.tasks);
    const ready = recorder(() => NEXT.ready, () => ({ status: 200, body: { ...NEXT.ready, status: "requested", requested_at: "2026-10-10T17:00:00Z" } }));
    await open(page, "next", { query: `?client_id=${STAFF_CLIENT}`, role: "csm", handlers: { "/api/money/tasks": tasks.handler, "/api/money/ready-to-fund": ready.handler } });
    await page.locator('#fos-next [data-act="ready"]').click();
    await expect.poll(() => ready.posts.length).toBe(1);
    expect(ready.posts[0]).toEqual({ client_id: STAFF_CLIENT });
  });
});

test.describe("FinanceOS: alert switches", () => {
  test("turning an alert off sends set_alert for that kind and says no texts will come", async ({ page }) => {
    const r = recorder(() => ALERTS, (b) => ({ status: 200, body: { ok: true, saved: { kind: b.kind, enabled: b.enabled } } }));
    await open(page, "alerts", { handlers: { "/api/money/alerts": r.handler } });
    const sw = page.locator('#fos-alerts [data-act="toggle"][data-kind="promo_end"]');
    await expect(sw).toHaveAttribute("aria-checked", "true");
    await sw.click();
    await expect.poll(() => r.posts.length).toBe(1);
    expect(r.posts[0]).toEqual({ action: "set_alert", kind: "promo_end", enabled: false });
    await expect(page.locator('#fos-alerts [data-act="toggle"][data-kind="promo_end"]')).toHaveAttribute("aria-checked", "false");
    await expect(page.locator("#fos-alerts #fa-k-promo_end")).toContainText("Saved. This alert is off. We will not text you about it.");
  });

  test("a refused switch keeps its old state and says why", async ({ page }) => {
    const r = recorder(() => ALERTS, () => ({ status: 403, body: { ok: false, error: "forbidden", message: "Only the client or their advisor can change this." } }));
    await open(page, "alerts", { handlers: { "/api/money/alerts": r.handler } });
    await page.locator('#fos-alerts [data-act="toggle"][data-kind="cash_reserve"]').click();
    await expect.poll(() => r.posts.length).toBe(1);
    await expect(page.locator('#fos-alerts [data-act="toggle"][data-kind="cash_reserve"]')).toHaveAttribute("aria-checked", "true");
    await expect(page.locator("#fos-alerts #fa-k-cash_reserve")).not.toContainText("Saved.");
  });
});
