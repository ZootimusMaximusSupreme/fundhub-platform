// Contracts — writing the words a client signs, pressed for real.
//
// New wording, Save, Archive / Turn back on, and the uploaded-PDF editor (drag
// a box onto the page, pick what it is, Save boxes). The list said only the
// page source was checked; nothing filled the form or dragged a box. This does,
// and checks the exact request: the blanks typed, the short name only on create,
// and boxes saved as fractions of the page (0 to 1), never pixels.

import { test, expect } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { openScreen, json, OWNER } from "./harness.mjs";

const TPL = "7e000000-0000-4000-8000-000000000001";
const PDF_TPL = "7e000000-0000-4000-8000-000000000002";

const TEXT_TEMPLATE = {
  id: TPL, template_key: "FUNDING-AGREEMENT", name: "Funding Agreement", kind: "contract", subtype: "funding_agreement",
  body: "Hello {{contact.first_name}}. Fee {{field.fee}}.", manual_fields: [{ key: "fee", label: "Fee", required: true }],
  signature_statement: "I agree.", active: true, source_kind: "text"
};
const PDF_TEMPLATE = {
  id: PDF_TPL, template_key: "LENDER-FORM", name: "Lender form", kind: "contract", active: true,
  source_kind: "pdf", page_count: 1, original_filename: "lender-form.pdf", fields: [], signer_roles: []
};

let pdfBase64 = "";
test.beforeAll(async () => {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  pdfBase64 = Buffer.from(await doc.save()).toString("base64");
});

async function open(page, { templates = [TEXT_TEMPLATE, PDF_TEMPLATE], writeAnswer } = {}) {
  const writes = [];
  await openScreen(page, "/app/contracts.html", OWNER, {
    "/api/read/contracts": (route, { url }) => {
      if (url.includes("file=template")) return json(route, { ok: true, pdf_base64: pdfBase64 });
      if (url.includes("view=templates")) return json(route, { ok: true, count: templates.length, items: templates });
      return json(route, { ok: true, items: [] });
    },
    "/api/contracts": async (route) => {
      const body = route.request().postDataJSON();
      writes.push(body);
      const out = writeAnswer ? writeAnswer(body) : { status: 200, body: { ok: true, message: "Saved.", template: { ...TEXT_TEMPLATE, id: body.id || TPL, active: body.active !== false } } };
      return route.fulfill({ status: out.status, contentType: "application/json", body: JSON.stringify(out.body) });
    }
  });
  await expect(page.locator("#tplList tr[data-tid]")).toHaveCount(templates.length);
  return { writes };
}

test.describe("contracts: the wording editor", () => {
  test("New wording saves the words, the blanks typed and the short name", async ({ page }) => {
    const { writes } = await open(page);
    await page.locator("#btnNewTpl").click();
    await page.locator("#tKey").fill("REPAIR-AGREEMENT");
    await page.locator("#tName").fill("Repair Agreement");
    await page.locator("#tKind").selectOption("authorization");
    await page.locator("#tSubtype").fill("repair_agreement");
    await page.locator("#tBody").fill("Hi {{contact.first_name}}, the fee is {{field.fee}}.");
    await expect(page.locator("#tTags")).toHaveText("blanks used: contact.first_name, field.fee");
    await page.locator("#btnAddField").click();
    await page.locator('#tFields .mfrow [data-k="key"]').fill("fee");
    await page.locator('#tFields .mfrow [data-k="label"]').fill("The fee");
    await page.locator('#tFields .mfrow [data-k="required"]').check();
    await page.locator("#btnAddField").click();
    await expect(page.locator("#tFields .mfrow")).toHaveCount(2);
    await page.locator('#tFields .mfrow').nth(1).locator("[data-del]").click();
    await page.locator("#btnSaveTpl").click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0]).toEqual({
      action: "create_template", template_key: "REPAIR-AGREEMENT", name: "Repair Agreement", kind: "authorization",
      subtype: "repair_agreement", body: "Hi {{contact.first_name}}, the fee is {{field.fee}}.",
      manual_fields: [{ key: "fee", label: "The fee", required: true }],
      signature_statement: "I have read this document and I agree to it. Typing my name here is my signature."
    });
    await expect(page.locator("#tplMsg")).toContainText("Saved.");
  });

  test("editing a wording saves by id; the short name is locked and is not sent", async ({ page }) => {
    const { writes } = await open(page);
    await page.locator(`tr[data-tid="${TPL}"]`).click();
    await expect(page.locator("#tKey")).toBeDisabled();
    await page.locator("#tName").fill("Funding Agreement v2");
    await page.locator("#btnSaveTpl").click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0].action).toBe("save_template");
    expect(writes[0].id).toBe(TPL);
    expect(writes[0].name).toBe("Funding Agreement v2");
    expect(writes[0]).not.toHaveProperty("template_key");
  });

  test("Archive turns a wording off; on an archived one the button says Turn back on", async ({ page }) => {
    const { writes } = await open(page, { templates: [TEXT_TEMPLATE, { ...TEXT_TEMPLATE, id: "7e000000-0000-4000-8000-000000000009", template_key: "OLD", active: false }] });
    await page.locator(`tr[data-tid="${TPL}"]`).click();
    await expect(page.locator("#btnArchive")).toHaveText("Archive");
    await page.locator("#btnArchive").click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0]).toEqual({ action: "archive_template", id: TPL, active: false });
    await page.locator('tr[data-tid="7e000000-0000-4000-8000-000000000009"]').click();
    await expect(page.locator("#btnArchive")).toHaveText("Turn back on");
    await page.locator("#btnArchive").click();
    await expect.poll(() => writes.length).toBe(2);
    expect(writes[1]).toEqual({ action: "archive_template", id: "7e000000-0000-4000-8000-000000000009", active: true });
  });

  test("a refused save is said and nothing is claimed", async ({ page }) => {
    await open(page, { writeAnswer: () => ({ status: 400, body: { ok: false, error: "key_taken", message: "That short name is already used." } }) });
    await page.locator("#btnNewTpl").click();
    await page.locator("#tKey").fill("FUNDING-AGREEMENT");
    await page.locator("#btnSaveTpl").click();
    await expect(page.locator("#tplMsg")).toContainText("That short name is already used.");
    await expect(page.locator("#tplMsg .badge")).toHaveText("problem");
  });
});

test.describe("contracts: the uploaded-PDF box editor", () => {
  async function openPdf(page) {
    const ctx = await open(page);
    await page.locator(`tr[data-tid="${PDF_TPL}"]`).click();
    await expect(page.locator("#pdfEditor")).toBeVisible();
    await expect(page.locator('#pdfPages .pg[data-page="0"] canvas')).toBeVisible({ timeout: 15_000 });
    return ctx;
  }

  test("drag a box onto the page, make it a Signature, Save boxes: the box is saved in page fractions", async ({ page }) => {
    const { writes } = await openPdf(page);
    const pg = page.locator('#pdfPages .pg[data-page="0"]');
    await pg.scrollIntoViewIfNeeded();
    const r = await pg.boundingBox();
    // The page is taller than the screen; drag in the middle so the pen stays on it.
    await page.mouse.move(r.x + r.width * 0.40, r.y + r.height * 0.45);
    await page.mouse.down();
    await page.mouse.move(r.x + r.width * 0.55, r.y + r.height * 0.48, { steps: 6 });
    await page.mouse.move(r.x + r.width * 0.70, r.y + r.height * 0.50, { steps: 6 });
    await page.mouse.up();
    await expect(pg.locator(".box")).toHaveCount(1);
    await page.locator("#bpType").selectOption("signature");
    await expect(page.locator("#bpSource")).toHaveValue("manual");
    await page.locator("#btnSaveFields").click();
    await expect.poll(() => writes.length).toBe(1);
    const sent = writes[0];
    expect(sent.action).toBe("save_fields");
    expect(sent.id).toBe(PDF_TPL);
    expect(sent.signer_roles).toEqual([{ index: 0, label: "Client", fill_from_client: true }]);
    expect(sent.fields).toHaveLength(1);
    const f = sent.fields[0];
    expect(f).toMatchObject({ page: 0, type: "signature", source: "manual", signer: 0, required: true, id: "f1" });
    for (const k of ["x", "y", "w", "h"]) {
      expect(f[k]).toBeGreaterThan(0);
      expect(f[k]).toBeLessThanOrEqual(1);
    }
    expect(f.x).toBeCloseTo(0.40, 1);
    expect(f.y).toBeCloseTo(0.45, 1);
    expect(f.w).toBeCloseTo(0.30, 1);
  });

  test("a box removed before saving is not saved; Add a signer adds a second role", async ({ page }) => {
    const { writes } = await openPdf(page);
    const pg = page.locator('#pdfPages .pg[data-page="0"]');
    await pg.scrollIntoViewIfNeeded();
    const r = await pg.boundingBox();
    await page.mouse.click(r.x + r.width * 0.5, r.y + r.height * 0.5);
    await expect(pg.locator(".box")).toHaveCount(1);
    await page.locator("#bpDel").click();
    await expect(pg.locator(".box")).toHaveCount(0);
    await page.locator("#btnAddSigner").click();
    await page.locator("#btnSaveFields").click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0].fields).toEqual([]);
    expect(writes[0].signer_roles.map((x) => x.label)).toEqual(["Client", "Signer 2"]);
  });
});
