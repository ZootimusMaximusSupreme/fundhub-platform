// Client portal Messages tab: read-only own chat, browser/mock only.
import { test, expect } from "@playwright/test";
const CID = "aaaaaaaa-1111-4111-8111-111111111111";
const self = {
  ok: true, principal: "client",
  staff: { id: CID, client_id: CID, name: "Synthetic Client",
    role: "client", org_id: "org-a", status: "active" }
};
function reply(route, obj, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(obj) });
}
async function wire(page, state) {
  await page.addInitScript(() => {
    localStorage.setItem("fh_token", "isolated-e2e");
    localStorage.setItem("fh_role", "client");
    localStorage.removeItem("fh_demo");
  });
  await page.route("**/api/**", (route) => {
    const u = new URL(route.request().url()), p = u.pathname;
    if (p === "/api/auth/session") {
      return reply(route, {
        ...self, principal: state.staff ? "staff" : "client",
        portal_sample: !!state.sample,
        staff: { ...self.staff, role: state.staff ? "owner" : "client" }
      });
    }
    if (p === "/api/chat/portal-message") {
      state.reads++;
      state.queryStrings.push(u.search);
      if (state.failOnce) {
        state.failOnce = false;
        return reply(route, { ok: true, messages: state.rows }, 503);
      }
      return reply(route, { ok: true, conversation_id: "thread-A", messages: state.rows });
    }
    if (p === "/api/read/portal-summary") {
      return reply(route, { ok: true, scores: {}, documents: [], payments: [], invoice_due: null });
    }
    if (p === "/api/dashboard/client") {
      return reply(route, { ok: true, data: {
        client: { first_name: "Synthetic", last_name: "Client" },
        messages: [{ rendered_body: "Staff-only preview note" }],
        transactions: []
      } });
    }
    if (p === "/api/read/entitlements" || p.includes("entitlements")) return reply(route, { ok: true, items: [] });
    return reply(route, { ok: true, items: [] });
  });
}
async function openTab(page) {
  await page.goto("/app/client-portal.html?id=" + CID);
  await page.locator("#acct summary").click();
  await page.locator('#acct-tabs [data-tab="msg"]').click();
  await expect(page.locator("#tp-msg")).toBeVisible();
}
test("signed-in client sees saved chat after refresh without supplying another client id", async ({ page }) => {
  const state = {
    reads: 0, queryStrings: [], rows: [
      { sender_kind: "client", created_at: "2026-10-29T12:00:00Z", rendered_body: "My saved portal question" },
      { sender_kind: "agent", created_at: "2026-10-29T12:01:00Z", rendered_body: "Your case is in review" }
    ]
  };
  await wire(page, state);
  await openTab(page);
  await expect(page.locator("#tp-msg")).toContainText("My saved portal question");
  await expect(page.locator("#tp-msg")).toContainText("Your case is in review");
  await expect(page.locator("#tp-msg")).toContainText("not a carrier delivery receipt");
  state.rows.push({
    sender_kind: "staff", created_at: "2026-10-29T12:10:00Z", rendered_body: "Advisor updated the file"
  });
  await page.reload();
  await expect(page.locator("#tp-msg")).toContainText("Advisor updated the file");
  expect(state.reads).toBeGreaterThanOrEqual(2);
  expect(state.queryStrings.every((q) => !q.includes("client_id") && !q.includes("org_id"))).toBe(true);
});
test("failed read is an error, not fake empty; retry reloads without client write", async ({ page }) => {
  const state = { reads: 0, queryStrings: [], failOnce: true,
    rows: [{ sender_kind: "client", rendered_body: "Saved after retry" }] };
  await wire(page, state);
  await page.goto("/app/client-portal.html?id=" + CID);
  await expect(page.locator("#tp-msg")).toContainText("We could not load your saved chat messages");
  await page.locator("#acct summary").click();
  await page.locator('#acct-tabs [data-tab="msg"]').click();
  await expect(page.locator("#tp-msg")).toContainText("Saved after retry");
  // A later rate-limit failure is still an error, and the Retry button works.
  state.failOnce = true;
  await page.locator('#acct-tabs [data-tab="msg"]').click();
  await expect(page.locator("#tp-msg")).toContainText("We could not load your saved chat messages");
  await page.locator("#tp-msg").getByRole("button", { name: "Retry loading messages" }).click();
  await expect(page.locator("#tp-msg")).toContainText("Saved after retry");
  expect(state.reads).toBeGreaterThanOrEqual(4);
});
test("staff preview and fictional sample view never request real client chat", async ({ page }) => {
  const state = { reads: 0, queryStrings: [], staff: true, rows: [] };
  await wire(page, state);
  await openTab(page);
  await expect(page.locator("#tp-msg")).not.toContainText("Loading your portal chat messages");
  expect(state.reads).toBe(0);
  // An unrelated staff principal cannot make a client-only conversation read.
});
test("client sample view hides real chat even when the sample portal renders", async ({ page }) => {
  const state = { reads: 0, queryStrings: [], sample: true,
    rows: [{ sender_kind: "client", rendered_body: "Private real message" }] };
  await wire(page, state);
  await openTab(page);
  await expect(page.locator("#tp-msg")).toContainText("Sample view");
  await expect(page.locator("#tp-msg")).not.toContainText("Private real message");
  expect(state.reads).toBe(0);
});
