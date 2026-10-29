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

test("portal send on HTTP failure preserves draft and never paints a false sent bubble", async ({ page }) => {
  let sends = 0;
  let saved = false;
  await page.route("**/api/chat/portal-message", (route) => {
    if (route.request().method() === "GET") {
      return reply(route, { ok: true, conversation_id: saved ? "portal-1" : null,
        messages: saved ? [{ sender_kind: "client", rendered_body: "A unique portal question" }] : [] });
    }
    sends++;
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
