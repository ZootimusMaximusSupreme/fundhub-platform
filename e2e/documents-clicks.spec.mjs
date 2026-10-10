// Documents — Remind, Void and Download, pressed for real.
//
// Remind re-sends a signing request to a client. Void kills a contract. Download
// mints a 15-minute link to a client's file. No browser test pressed any of
// them. This presses each one: the exact request, the server's own words shown
// (a "paused" answer must not turn into "sent"), Void needs a reason and is not
// offered to a closer, and the download link is opened but never written into
// the page.

import { test, expect } from "@playwright/test";
import { openScreen, json, OWNER, CLOSER } from "./harness.mjs";

const CT = "c7000000-0000-4000-8000-000000000001";
const LINK = "/api/documents/d-up?sig=fifteen-minute-link";

const DOCS = {
  ok: true, count: 2, limit: 200, offset: 0, hasMore: false,
  items: [
    { id: "d-ct", kind: "contract", title: "Funding Agreement", client_name: "Dana Whitfield",
      created_at: "2026-10-08T10:00:00Z", generated_at: "2026-10-08T10:00:00Z", delivered_at: "2026-10-08T11:00:00Z",
      delivery_status: "sent", signature_required: true, signed_at: null,
      expires_at: "2026-11-08T10:00:00Z", mime_type: "application/pdf" },
    { id: "d-up", kind: "client_upload", subtype: "id_document", title: "Driver licence", client_name: "Dana Whitfield",
      created_at: "2026-10-07T10:00:00Z", generated_at: "2026-10-07T10:00:00Z", delivery_status: "not_delivered",
      signature_required: false, mime_type: "image/jpeg" }
  ]
};

async function open(page, { session = OWNER, contractStatus = "sent", writeAnswer, downloadAnswer } = {}) {
  const writes = [];
  const downloads = [];
  let contractReads = 0;
  await page.addInitScript(() => {
    window.__opened = [];
    window.open = (url, target, features) => { window.__opened.push({ url, target, features }); return null; };
  });
  await openScreen(page, "/app/documents.html", session, {
    "/api/read/documents": DOCS,
    "/api/read/contracts": (route) => {
      contractReads += 1;
      return json(route, { ok: true, items: [{ id: CT, document_id: "d-ct", status: contractStatus, signed_document_id: null }] });
    },
    "/api/contracts": async (route) => {
      const body = route.request().postDataJSON();
      writes.push(body);
      const out = writeAnswer ? writeAnswer(body) : { status: 200, body: { ok: true, message: body.action === "remind" ? "Reminder sent to Dana Whitfield." : "Contract voided." } };
      return route.fulfill({ status: out.status, contentType: "application/json", body: JSON.stringify(out.body) });
    },
    "/api/documents-download": async (route) => {
      downloads.push(route.request().url());
      const out = downloadAnswer || { status: 200, body: { ok: true, document: { id: "d-up", download: { url: LINK, expires_in: 900 } } } };
      return route.fulfill({ status: out.status, contentType: "application/json", body: JSON.stringify(out.body) });
    }
  });
  await expect(page.locator("#body tr")).toHaveCount(2);
  return { writes, downloads, contractReads: () => contractReads };
}

test.describe("documents: contract Remind and Void", () => {
  test("Remind re-sends for that contract and shows the server's own sentence", async ({ page }) => {
    const { writes } = await open(page);
    await page.locator(`[data-ct="remind"][data-cid="${CT}"]`).click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0]).toEqual({ action: "remind", id: CT });
    await expect(page.locator("#ctMsg")).toContainText("Reminder sent to Dana Whitfield.");
  });

  test("a reminder held because mail is paused says so; it is never shown as sent", async ({ page }) => {
    await open(page, { writeAnswer: () => ({ status: 200, body: { ok: true, queued: false, message: "Nothing was sent: outbound mail is paused." } }) });
    await page.locator(`[data-ct="remind"][data-cid="${CT}"]`).click();
    await expect(page.locator("#ctMsg")).toContainText("Nothing was sent: outbound mail is paused.");
    await expect(page.locator("#ctMsg")).not.toContainText("Reminder sent");
  });

  test("Void asks for a reason, sends it, and re-reads the contract state", async ({ page }) => {
    const { writes, contractReads } = await open(page);
    const before = contractReads();
    page.once("dialog", (d) => d.accept("Client chose a different plan"));
    await page.locator(`[data-ct="void"][data-cid="${CT}"]`).click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0]).toEqual({ action: "void", id: CT, reason: "Client chose a different plan" });
    await expect(page.locator("#ctMsg")).toContainText("Contract voided.");
    await expect.poll(() => contractReads()).toBeGreaterThan(before);
  });

  test("Void cancelled at the reason box sends nothing", async ({ page }) => {
    const { writes } = await open(page);
    page.once("dialog", (d) => d.dismiss());
    await page.locator(`[data-ct="void"][data-cid="${CT}"]`).click();
    await page.waitForTimeout(300);
    expect(writes).toEqual([]);
  });

  test("a refused void is said, not hidden", async ({ page }) => {
    await open(page, { writeAnswer: () => ({ status: 409, body: { ok: false, error: "already_signed", message: "This contract is already signed." } }) });
    page.once("dialog", (d) => d.accept("mistake"));
    await page.locator(`[data-ct="void"][data-cid="${CT}"]`).click();
    await expect(page.locator("#ctMsg")).toContainText("This contract is already signed.");
  });

  test("a closer is not offered Void (owner and admin only)", async ({ page }) => {
    await open(page, { session: CLOSER });
    await expect(page.locator(`[data-ct="remind"][data-cid="${CT}"]`)).toBeVisible();
    await expect(page.locator(`[data-ct="void"]`)).toHaveCount(0);
  });

  test("a signed contract offers no Remind and no Void", async ({ page }) => {
    await open(page, { contractStatus: "signed" });
    await expect(page.locator(`[data-ct="open"][data-cid="${CT}"]`)).toBeVisible();
    await expect(page.locator(`[data-ct="remind"]`)).toHaveCount(0);
    await expect(page.locator(`[data-ct="void"]`)).toHaveCount(0);
  });
});

test.describe("documents: Download", () => {
  test("Download asks for a fresh link for that document and opens it; the link is never written into the page", async ({ page }) => {
    const { downloads } = await open(page);
    await page.locator('[data-dl="d-up"]').click();
    await expect.poll(() => downloads.length).toBe(1);
    expect(downloads[0]).toMatch(/\/api\/documents-download\?id=d-up$/);
    await expect.poll(() => page.evaluate(() => window.__opened.length)).toBe(1);
    const opened = await page.evaluate(() => window.__opened[0]);
    expect(opened).toEqual({ url: LINK, target: "_blank", features: "noopener" });
    expect(await page.content()).not.toContain("fifteen-minute-link");
  });

  test("a download that cannot be minted says so and opens nothing", async ({ page }) => {
    await open(page, { downloadAnswer: { status: 404, body: { ok: false, error: "not_found", message: "That file is not in your company." } } });
    await page.locator('[data-dl="d-up"]').click();
    // data.js words a 404 as "no such record"; the point is a visible problem and no tab.
    await expect(page.locator("#ctMsg .badge")).toHaveText("problem");
    await expect(page.locator("#ctMsg")).toContainText("no such record");
    expect(await page.evaluate(() => window.__opened.length)).toBe(0);
  });
});
