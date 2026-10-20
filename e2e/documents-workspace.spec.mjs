import { test, expect } from "@playwright/test";
import fs from "node:fs";
import { openScreen, json, OWNER, CLIENT_ID } from "./harness.mjs";

const evidence = "ops/workflows/build-evidence/crm-portal-layout-audit-2026-10-18/documents";
const CT = "c7000000-0000-4000-8000-000000000001";
const base = { client_id: CLIENT_ID, client_name: "Dana Whitfield", created_at: "2026-10-05T10:00:00Z", generated_at: "2026-10-05T10:00:00Z", delivery_status: "sent", signature_required: false, mime_type: "application/pdf" };
const items = [
  { ...base, id: "d-ct", kind: "contract", title: "Funding agreement", signature_required: true, expires_at: "2027-11-08T10:00:00Z" },
  { ...base, id: "d-up", kind: "client_upload", title: "Driver licence", subtype: "id_document", delivery_status: "not_delivered", mime_type: "image/jpeg" },
  { ...base, id: "d-auth", kind: "authorization", title: "Soft-pull authorization", signed_at: "2026-10-06T10:00:00Z", signature_required: true },
  { ...base, id: "d-inv", kind: "invoice_document", title: "Funding program invoice", client_name: "Morgan Ellis", delivery_status: "not_delivered" },
  { ...base, id: "d-del", kind: "deliverable", title: "Funding readiness report", client_name: "Morgan Ellis", delivery_status: "delivered" },
  { ...base, id: "d-queue", kind: "deliverable", title: "Credit review", generated_at: null, mime_type: null, delivery_status: "pending" }
];
const full = { ok: true, count: items.length, limit: 200, offset: 0, hasMore: false, items };

async function open(page, { state = "full", url = "/app/documents.html" } = {}) {
  let release;
  const held = new Promise(resolve => { release = resolve; });
  const writes = [];
  const reads = [];
  await page.route("https://fonts.googleapis.com/**", route => route.abort());
  await page.route("https://fonts.gstatic.com/**", route => route.abort());
  await openScreen(page, url, OWNER, {
    "/api/read/documents": async route => {
      reads.push(route.request().url());
      if (state === "loading") await held;
      if (state === "error") return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, error: "documents_unavailable", message: "Documents are temporarily unavailable." }) });
      return json(route, state === "empty" ? { ...full, count: 0, items: [] } : full);
    },
    "/api/read/contracts": { ok: true, items: [{ id: CT, document_id: "d-ct", status: "sent" }] },
    "/api/contracts": route => { writes.push(route.request().postDataJSON()); return json(route, { ok: true, message: "Nothing was sent: outbound mail is paused." }); },
    "/api/documents-download": route => { writes.push({ download: route.request().url() }); return json(route, { ok: false, error: "not_found" }); }
  });
  return { release, writes, reads };
}

for (const width of [1440, 390, 320]) {
  test(`documents workspace ${width}: usable full library`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 });
    const { writes } = await open(page);
    await expect(page.locator("#body tr")).toHaveCount(6);
    fs.mkdirSync(evidence, { recursive: true });
    if (process.env.DOCUMENTS_BASELINE === "1") {
      await page.screenshot({ path: `${evidence}/before-${width}.png`, fullPage: true, animations: "disabled" });
      return;
    }
    await expect(page.locator("#kTotal")).toHaveText("6");
    await expect(page.locator("#kSign")).toHaveText("1");
    await expect(page.locator("#kUndel")).toHaveText("1");
    await expect(page.locator("#q")).toHaveAccessibleName("Search documents");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.locator("#fh-workspace-header")).toHaveAttribute("data-fh-scope", "all-clients");
    if(width===1440) await page.screenshot({ path: `${evidence}/after-1440-viewport.png`, animations: "disabled" });
    const overviewColumns = await page.locator(".documents-stats").evaluate(el => getComputedStyle(el).gridTemplateColumns.split(" ").length);
    // Approved Astra phone layout stacks readable summary rows; desktop keeps
    // the three metrics together. All controls, fold and write checks below stay.
    expect(overviewColumns).toBe(width < 700 ? 1 : 3);
    if (width < 700) {
      const clipped = await page.locator("#body button").evaluateAll(buttons => buttons.filter(button => {
        const r=button.getBoundingClientRect(), host=button.closest(".document-library").getBoundingClientRect();
        return r.x < host.x || r.right > host.right || r.height < 44;
      }).map(button => button.textContent));
      expect(clipped).toEqual([]);
      expect(await page.locator("#body").evaluate(el=>el.getBoundingClientRect().top)).toBeLessThan(650);
    }
    await page.screenshot({ path: `${evidence}/after-${width}.png`, fullPage: true, animations: "disabled" });
    const filter = page.locator('#tabs [data-c="upload"]');
    await filter.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#body tr")).toHaveCount(1);
    await expect(page.locator("#body")).toContainText("Driver licence");
    await expect(filter).toHaveAttribute("aria-pressed", "true");
    await page.locator('#tabs [data-c=""]').click();
    await page.locator("#q").fill("Morgan");
    await expect(page.locator("#body tr")).toHaveCount(2);
    await page.locator("#q").fill("no such document");
    await expect(page.locator("#body")).toContainText("No matching documents");
    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(page.locator("#body tr")).toHaveCount(6);
    await page.locator("#statusFilter").selectOption("sig-pending");
    await expect(page.locator("#body")).toContainText("Funding agreement");
    await expect(page.locator("#body tr")).toHaveCount(1);
    await page.locator("#statusFilter").selectOption("");
    await page.locator("#pendingBtn").click();
    await expect(page.locator("#pendingBtn")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#body tr")).toHaveCount(3);
    await page.locator("#pendingBtn").click();
    if (width < 700) {
      await page.locator("#mobileSort").selectOption("doc:1");
    } else {
      await page.getByRole("button", { name: "Sort by document", exact: true }).focus();
      await page.keyboard.press("Enter");
      await expect(page.locator('th[data-s="doc"]')).toHaveAttribute("aria-sort", "descending");
    }
    await expect(page.locator('[data-dl="d-queue"]')).toHaveCount(0);
    await page.locator(`[data-ct="remind"][data-cid="${CT}"]`).click();
    await expect(page.locator("#ctMsg")).toContainText("Nothing was sent: outbound mail is paused.");
    expect(writes).toEqual([{ action: "remind", id: CT }]);
  });
}

for (const state of ["empty", "loading", "error"]) {
  for (const width of [1440, 390, 320]) {
    test(`documents workspace ${width}: ${state} is explicit`, async ({ page }) => {
      test.skip(process.env.DOCUMENTS_BASELINE === "1", "Baseline capture only");
      await page.setViewportSize({ width, height: 960 });
      const { release, writes } = await open(page, { state });
      if (state === "empty") {
        await expect(page.locator("#body")).toContainText("No documents on file yet");
        await expect(page.locator("#kTotal")).toHaveText("0");
      } else if (state === "loading") {
        await expect(page.locator("#body")).toContainText("Loading documents");
        await expect(page.locator("#kTotal")).toHaveText("—");
        await expect(page.locator("#documentLibrary")).toHaveAttribute("aria-busy", "true");
      } else {
        await expect(page.locator("#body")).toContainText("Documents could not be loaded");
        await expect(page.locator("#kTotal")).toHaveText("—");
        await expect(page.getByRole("button", { name: "Try again", exact: true })).toBeVisible();
        await expect(page.locator("#body")).not.toContainText("No documents on file yet");
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `${evidence}/${state}-${width}.png`, fullPage: true, animations: "disabled" });
      expect(writes).toEqual([]);
      if (state === "loading") {
        release();
        await expect(page.locator("#body tr")).toHaveCount(6);
      }
    });
  }
}

for (const param of ["client_id", "id"]) test(`documents ${param} scope uses only a valid URL client and never remembered state`, async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("fh_client", "bbbbbbbb-2222-4222-8222-222222222222"));
  const { reads } = await open(page, { url: `/app/documents.html?${param}=${CLIENT_ID}` });
  expect(reads.length).toBe(1);
  expect(new URL(reads[0]).searchParams.get("client_id")).toBe(CLIENT_ID);
  await expect(page.locator("#fh-workspace-header")).toHaveAttribute("data-fh-scope", "selected-client");
});

test.describe("documents on a touch screen", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });
  test("a finger can switch class and use the status and class guide", async ({ page }) => {
    const { writes } = await open(page);
    await page.locator('#tabs [data-c="upload"]').tap();
    await expect(page.locator("#body")).toContainText("Driver licence");
    await expect(page.locator("#body tr")).toHaveCount(1);
    await page.locator(".document-guide summary").tap();
    await expect(page.locator(".document-guide")).toHaveAttribute("open", "");
    await page.locator('#classbar [data-c="contract"]').tap();
    await expect(page.locator("#body")).toContainText("Funding agreement");
    await expect(page.locator("#body tr")).toHaveCount(1);
    expect(writes).toEqual([]);
  });
});

test("Open PDF reads contract bytes and names the local file without exposing a storage path", async ({ page }) => {
  await open(page);
  const requests = [];
  await page.route("**/api/read/contracts?**", route => {
    requests.push(new URL(route.request().url()));
    return json(route, { ok: true, filename: "funding-agreement.pdf", pdf_base64: Buffer.from("%PDF-1.4 fixture only").toString("base64") });
  });
  await page.evaluate(() => {
    window.__pdfClicks = [];
    HTMLAnchorElement.prototype.click = function () { window.__pdfClicks.push({ href: this.href, download: this.download }); };
  });
  await page.locator(`[data-ct="open"][data-cid="${CT}"]`).click();
  await expect.poll(() => page.evaluate(() => window.__pdfClicks.length)).toBe(1);
  const clicked = await page.evaluate(() => window.__pdfClicks[0]);
  expect(clicked.download).toBe("funding-agreement.pdf");
  expect(clicked.href).toMatch(/^blob:/);
  expect(requests).toHaveLength(1);
  expect(requests[0].searchParams.get("file")).toBe("contract");
  expect(requests[0].searchParams.get("id")).toBe(CT);
  expect(await page.content()).not.toContain("%PDF-1.4 fixture only");
});
