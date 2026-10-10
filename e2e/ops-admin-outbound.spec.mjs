// Ops & Admin — the three Outbound Mail buttons that reach real clients.
//
// "Send what is waiting", "Pause sending" / "Turn sending on" and "Email unsent
// invoices" each go to /api/messages-outbound and each touch real clients. The
// list said no test ever pressed them. This presses each one: the confirm box
// must name the consequence, saying No must send nothing, saying Yes must send
// exactly the right request, and a refusal must be said out loud.

import { test, expect } from "@playwright/test";
import { OWNER, wireApi, gotoScreen } from "./harness.mjs";

function status({ queued = 3, enabled = true, invoices = 0 } = {}) {
  return {
    ok: true,
    message: `${queued} waiting to go out.`,
    counts: { queued, sent_today: 5, failed: 0, blocked: 1 },
    routing: [{ channel: "email", provider: "resend", enabled: true }],
    settings: { outbound_enabled: enabled },
    invoices_never_emailed: invoices
  };
}

/* Wire the page: GET answers the given status, POSTs are recorded and answered. */
async function open(page, initial, { postAnswer = () => ({ ok: true, message: "Done." }) } = {}) {
  const posts = [];
  let current = initial;
  await wireApi(page, {
    session: OWNER,
    handlers: {
      "/api/messages-outbound": async (route, { method }) => {
        if (method === "POST") {
          const body = route.request().postDataJSON();
          posts.push(body);
          const out = postAnswer(body);
          if (out && out.status) {
            await route.fulfill({ status: out.status, contentType: "application/json", body: JSON.stringify(out.body) });
            return;
          }
          if (body.action === "settings") current = { ...current, settings: { outbound_enabled: body.outbound_enabled } };
          return out;
        }
        return current;
      }
    }
  });
  await gotoScreen(page, "ops-admin.html");
  await expect(page.locator("#outboxSummary")).not.toHaveText("Checking…");
  return { posts };
}

function answerDialogs(page, accept) {
  const seen = [];
  page.on("dialog", async (d) => { seen.push(d.message()); if (accept) await d.accept(); else await d.dismiss(); });
  return seen;
}

test.describe("Ops & Admin outbound mail buttons", () => {
  test("Send what is waiting: the confirm names the count and that it cannot be pulled back; Yes sends dispatch", async ({ page }) => {
    const { posts } = await open(page, status({ queued: 3 }));
    const dialogs = answerDialogs(page, true);
    await expect(page.locator("#outboxSend")).toBeVisible();
    await page.locator("#outboxSend").click();
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0]).toEqual({ action: "dispatch" });
    expect(dialogs[0]).toContain("Send the 3 message(s) waiting now?");
    expect(dialogs[0]).toContain("cannot be pulled back");
    await expect(page.locator("#outboxMsg")).toHaveText("Done.");
  });

  test("Send what is waiting: No sends nothing", async ({ page }) => {
    const { posts } = await open(page, status({ queued: 2 }));
    const dialogs = answerDialogs(page, false);
    await page.locator("#outboxSend").click();
    await expect.poll(() => dialogs.length).toBe(1);
    await page.waitForTimeout(300);
    expect(posts).toEqual([]);
  });

  test("Send what is waiting is not shown when nothing is waiting", async ({ page }) => {
    await open(page, status({ queued: 0 }));
    await expect(page.locator("#outboxToggle")).toBeVisible();
    await expect(page.locator("#outboxSend")).toBeHidden();
  });

  test("Pause sending: the confirm says nothing goes out; Yes turns sending off, and the button flips to Turn sending on", async ({ page }) => {
    const { posts } = await open(page, status({ queued: 4, enabled: true }));
    const dialogs = answerDialogs(page, true);
    await expect(page.locator("#outboxToggle")).toHaveText("Pause sending");
    await page.locator("#outboxToggle").click();
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0]).toEqual({ action: "settings", outbound_enabled: false });
    expect(dialogs[0]).toContain("Pause sending? Nothing goes out to clients");
    expect(dialogs[0]).toContain("4 message(s) will sit in the queue");
    await expect(page.locator("#outboxToggle")).toHaveText("Turn sending on");
  });

  test("Turn sending on: the confirm warns queued mail starts going out; Yes turns it on", async ({ page }) => {
    const { posts } = await open(page, status({ queued: 6, enabled: false }));
    const dialogs = answerDialogs(page, true);
    await expect(page.locator("#outboxToggle")).toHaveText("Turn sending on");
    await page.locator("#outboxToggle").click();
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0]).toEqual({ action: "settings", outbound_enabled: true });
    expect(dialogs[0]).toContain("Queued messages start going out to real clients. 6 message(s) waiting now.");
    await expect(page.locator("#outboxToggle")).toHaveText("Pause sending");
  });

  test("Email unsent invoices: shown only when some were never emailed; Yes sends email_invoice_backlog", async ({ page }) => {
    const { posts } = await open(page, status({ invoices: 2 }));
    const dialogs = answerDialogs(page, true);
    await expect(page.locator("#outboxDetail")).toContainText("2 invoice(s) were never emailed to the client.");
    await page.locator("#outboxInvoices").click();
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0]).toEqual({ action: "email_invoice_backlog" });
    expect(dialogs[0]).toBe("Email every invoice the client was never told about?");
  });

  test("Email unsent invoices is hidden when every invoice was emailed", async ({ page }) => {
    await open(page, status({ invoices: 0 }));
    await expect(page.locator("#outboxInvoices")).toBeHidden();
  });

  test("a refusal from the server is said on the screen, in red, and the button state is not faked", async ({ page }) => {
    const { posts } = await open(page, status({ queued: 1, enabled: true }), {
      postAnswer: () => ({ status: 403, body: { ok: false, error: "forbidden" } })
    });
    answerDialogs(page, true);
    await page.locator("#outboxToggle").click();
    await expect.poll(() => posts.length).toBe(1);
    await expect(page.locator("#outboxMsg")).toContainText("not allowed");
    await expect(page.locator("#outboxMsg")).toHaveCSS("color", "rgb(110, 42, 34)");
    await expect(page.locator("#outboxToggle")).toHaveText("Pause sending");
  });

  test("when the queue cannot be read, no button is shown at all", async ({ page }) => {
    await wireApi(page, {
      session: OWNER,
      handlers: {
        "/api/messages-outbound": async (route) => {
          await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ ok: false, error: "query_failed" }) });
        }
      }
    });
    await gotoScreen(page, "ops-admin.html");
    await expect(page.locator("#outboxSummary")).toContainText("Could not read the outbound queue");
    await expect(page.locator("#outboxSend")).toBeHidden();
    await expect(page.locator("#outboxToggle")).toBeHidden();
    await expect(page.locator("#outboxInvoices")).toBeHidden();
  });
});
