// Portal/staff cross-role reply safety: browser-only, mocked requests, no real send.
import { test, expect } from "@playwright/test";

async function mount(page, portal) {
  await page.goto("/404.html");
  await page.addScriptTag({ url: "/app/chat-widget.js" });
  await page.evaluate((isPortal) => {
    window.FHChat.mount({ portal: isPortal, hadCall: true, autoOpenPrecall: false });
  }, portal);
  await page.locator("#fh-chat-fab").click();
  await expect(page.locator("#fh-chat-panel")).toBeVisible();
}

const reply = (route, body, status = 200) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

async function mountWelcome(page, control) {
  const methods = [];
  await page.route("**/api/chat/portal-message", (route) => {
    methods.push(route.request().method());
    return reply(route, { ok: true, messages: [] });
  });
  await page.goto("/404.html");
  await page.clock.install({ time: new Date("2026-11-05T12:00:00Z") });
  await page.clock.pauseAt(new Date("2026-11-05T12:00:01Z"));
  await page.evaluate((html) => {
    document.body.innerHTML = '<form aria-label="Synthetic bank plan">' + html + '</form>';
  }, control);
  await page.addScriptTag({ url: "/app/chat-widget.js" });
  await page.evaluate(() => {
    window.FHChat.mount({ portal: true, hadCall: false, popAfterMs: 1400 });
  });
  await expect(page.locator("#fh-chat-panel")).toBeHidden();
  return methods;
}

test("delayed welcome keeps the first bank-name entry in its form", async ({ page }) => {
  const methods = await mountWelcome(page,
    '<label>Bank or credit union name<input name="bankName" required></label>');
  const bankName = page.getByRole("textbox", { name: "Bank or credit union name" });
  await bankName.focus();
  // Run the widget's real delayed callback between focus and text entry.
  await page.clock.runFor(1400);
  await page.keyboard.type("Fixture Neighborhood CU");
  await expect(bankName).toHaveValue("Fixture Neighborhood CU");
  await expect(bankName).toBeFocused();
  await expect(page.locator("#fh-chat-panel")).toBeVisible();
  await expect(page.locator("#fh-chat-panel")).not.toHaveAttribute("aria-modal", "true");
  await expect(page.locator("#fh-chat-input")).toHaveValue("");
  await expect.poll(() => methods.filter((method) => method === "GET").length).toBeGreaterThan(0);
  expect(methods).not.toContain("POST");
});

for (const [kind, control] of [
  ["textarea", '<textarea data-active aria-label="Notes"></textarea>'],
  ["select", '<select data-active aria-label="Account type"><option>Checking</option></select>'],
  ["button", '<button data-active type="button">Review bank terms</button>'],
  ["link", '<a data-active href="#terms">Bank terms</a>'],
  ["editable text", '<div data-active contenteditable="true" role="textbox" aria-label="Draft"></div>']
]) {
  test(`delayed welcome preserves an active ${kind}`, async ({ page }) => {
    await mountWelcome(page, control);
    const active = page.locator("[data-active]");
    await active.focus();
    await page.clock.runFor(1400);
    await expect(active).toBeFocused();
    await expect(page.locator("#fh-chat-panel")).toBeVisible();
  });
}

test("idle welcome and explicit mouse or keyboard opening still focus chat", async ({ page }) => {
  await mountWelcome(page, '<input aria-label="Another form field">');
  await page.clock.runFor(1400);
  const input = page.locator("#fh-chat-input");
  await expect(input).toBeFocused();
  await page.locator("#fh-chat-close").click();
  await page.getByRole("textbox", { name: "Another form field" }).focus();
  await page.locator("#fh-chat-fab").click();
  await expect(input).toBeFocused();
  await page.locator("#fh-chat-close").click();
  await page.locator("#fh-chat-fab").focus();
  await page.keyboard.press("Enter");
  await expect(input).toBeFocused();
});

test("portal send on HTTP failure preserves draft and never paints a false sent bubble", async ({ page }) => {
  let sends = 0;
  let saved = false;
  const portalPosts = [];
  await page.route("**/api/chat/portal-message", (route) => {
    if (route.request().method() === "GET") {
      return reply(route, { ok: true, conversation_id: saved ? "portal-1" : null,
        messages: saved ? [{ sender_kind: "client", rendered_body: "A unique portal question" }] : [] });
    }
    sends++;
    portalPosts.push(JSON.parse(route.request().postData() || "{}"));
    if (sends === 1) return reply(route, { ok: true, error: "temporary_gateway" }, 503);
    saved = true;
    return reply(route, { ok: true, conversation_id: "portal-1" });
  });
  await mount(page, true);
  const input = page.locator("#fh-chat-input");
  await input.fill("A unique portal question");
  await page.locator("#fh-chat-send").click();
  await expect(page.locator("#fh-chat-hint")).toContainText("Not confirmed");
  await expect(input).toHaveValue("A unique portal question");
  await expect(page.locator("#fh-chat-body .msg.me")).toHaveCount(0);
  await page.locator("#fh-chat-send").click();
  await expect(input).toHaveValue("");
  await expect(page.locator("#fh-chat-body .msg.me")).toContainText(["A unique portal question"]);
  expect(sends).toBe(2);
  expect(portalPosts[0].idempotency_key).toMatch(/^[a-zA-Z0-9_-]{8,80}$/);
  expect(portalPosts[1].idempotency_key).toBe(portalPosts[0].idempotency_key);
});

test("network refusal cannot erase a portal draft or masquerade as delivery", async ({ page }) => {
  await page.route("**/api/chat/portal-message", (route) => {
    if (route.request().method() === "GET") return reply(route, { ok: true, messages: [] });
    return route.abort("failed");
  });
  await mount(page, true);
  const input = page.locator("#fh-chat-input");
  await input.fill("Keep my draft on WiFi loss");
  await page.locator("#fh-chat-send").click();
  await expect(page.locator("#fh-chat-hint")).toContainText("network_unavailable");
  await expect(input).toHaveValue("Keep my draft on WiFi loss");
  await expect(page.locator("#fh-chat-body .msg.me")).toHaveCount(0);
});

test("staff cannot send without client selection; retry keeps one idempotency key", async ({ page }) => {
  const posts = [];
  await page.route("**/api/chat/peers", (route) =>
    reply(route, { ok: true, clients: [{ id: "client-A", name: "Synthetic Buyer" }], staff: [] }));
  await page.route("**/api/chat/messages", (route) => {
    if (route.request().method() !== "POST") return reply(route, { ok: true, messages: [] });
    const post = JSON.parse(route.request().postData() || "{}");
    posts.push(post);
    if (posts.length === 1) return reply(route, { ok: true, outcome: "sent" }, 429);
    return reply(route, { ok: true, conversation_id: "thread-A", outcome: "deferred" });
  });
  await mount(page, false);
  await page.locator('[data-mode="message"]').click();
  await page.locator("#fh-chat-kind").selectOption("client");
  const input = page.locator("#fh-chat-input");
  await input.fill("Send the financing update");
  await page.locator("#fh-chat-send").click();
  await expect(page.locator("#fh-chat-hint")).toContainText("Pick one of your clients");
  await expect(input).toHaveValue("Send the financing update");
  expect(posts).toHaveLength(0);
  await page.locator("#fh-chat-client").selectOption("client-A");
  await page.locator("#fh-chat-send").click();
  await expect(page.locator("#fh-chat-hint")).toContainText("Not confirmed");
  await expect(input).toHaveValue("Send the financing update");
  await expect(page.locator("#fh-chat-body .msg.me")).toHaveCount(0);
  await page.locator("#fh-chat-send").click();
  await expect(input).toHaveValue("");
  await expect(page.locator("#fh-chat-body")).toContainText("not yet confirmed delivered");
  expect(posts).toHaveLength(2);
  expect(posts[0].client_id).toBe("client-A");
  expect(posts[0].idempotency_key).toBeTruthy();
  expect(posts[1].idempotency_key).toBe(posts[0].idempotency_key);
});
