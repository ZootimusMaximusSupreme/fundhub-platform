// Client control panel — the two controls that put a person in front of a
// client's portal: "Send portal sign-in link" and "Add this person to the file".
// Each is pressed in the real page and the exact write is judged: the client's
// own id goes out, an answer that did not queue is never shown as sent, and
// only an owner or admin is offered either control.
// NO BACKEND: page.route() answers /api/**; nothing is sent.
import { test, expect } from "@playwright/test";
import { openScreen, json, OWNER, CLOSER, CLIENT_ID } from "./harness.mjs";

async function open(page, { session = OWNER, portal = { ok: true, sent: true, url: "https://app.example.test/portal-login.html?t=abc", expiresAt: "2026-10-13T18:00:00Z" }, rep = { ok: true, account_id: "a1", sent: true, url: "https://app.example.test/portal-login.html?t=rep" } } = {}) {
  const writes = [];
  await openScreen(page, `/app/client-control-panel.html?client_id=${CLIENT_ID}`, session, {
    "/api/auth/send-portal-link": async (route) => {
      writes.push({ route: "send-portal-link", body: route.request().postDataJSON() });
      return json(route, portal);
    },
    "/api/auth/authorized-rep": async (route, { method }) => {
      if (method === "POST") {
        writes.push({ route: "authorized-rep", body: route.request().postDataJSON() });
        return json(route, rep);
      }
      return json(route, { ok: true, rep: null });
    },
  });
  return { writes };
}

test.describe("client control panel: portal access controls", () => {
  test("Send portal sign-in link sends this client's id and says Sent only when the email queued", async ({ page }) => {
    const { writes } = await open(page);
    await page.locator("#ccp-portal-link").click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0]).toEqual({ route: "send-portal-link", body: { client_id: CLIENT_ID } });
    await expect(page.locator("#ccp-portal-link-status")).toContainText("Sent at");
    await expect(page.locator("#ccp-portal-link-label")).toHaveText("Sent — hold on");
  });

  test("a link that was made but not queued is never reported as sent", async ({ page }) => {
    await open(page, { portal: { ok: true, sent: false, url: "https://app.example.test/x" } });
    await page.locator("#ccp-portal-link").click();
    await expect(page.locator("#ccp-portal-link-status")).toContainText("no email went out");
    await expect(page.locator("#ccp-portal-link-status")).not.toContainText("Sent at");
  });

  test("a closer is not offered the sign-in link or the representative form", async ({ page }) => {
    await open(page, { session: CLOSER });
    await expect(page.locator("#ccp-portal-link-wrap")).toBeHidden();
    await expect(page.locator("#ccp-rep-wrap")).toBeHidden();
  });

  test("Add this person sends the name, email and phone typed for this client and shows the link back", async ({ page }) => {
    const { writes } = await open(page);
    await page.locator("#ccp-rep-name").fill("Pat Rep");
    await page.locator("#ccp-rep-email").fill("pat.rep@example.test");
    await page.locator("#ccp-rep-phone").fill("(602) 555-0142");
    await page.locator("#ccp-rep-add").click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0]).toEqual({
      route: "authorized-rep",
      body: { client_id: CLIENT_ID, name: "Pat Rep", email: "pat.rep@example.test", phone: "(602) 555-0142" },
    });
    await expect(page.locator("#ccp-rep-status")).toContainText("Added. The sign-in email is queued.");
    await expect(page.locator("#ccp-rep-url")).toHaveValue("https://app.example.test/portal-login.html?t=rep");
  });

  test("a refusal from the server is said in its own words and no link is shown", async ({ page }) => {
    const { writes } = await open(page, { rep: { ok: false, error: "That email is already on a client file. Use his own email." } });
    await page.locator("#ccp-rep-name").fill("Pat Rep");
    await page.locator("#ccp-rep-email").fill("dana@example.test");
    await page.locator("#ccp-rep-phone").fill("6025550142");
    await page.locator("#ccp-rep-add").click();
    await expect.poll(() => writes.length).toBe(1);
    await expect(page.locator("#ccp-rep-status")).toHaveText("That email is already on a client file. Use his own email.");
    await expect(page.locator("#ccp-rep-url")).toBeHidden();
  });
});
