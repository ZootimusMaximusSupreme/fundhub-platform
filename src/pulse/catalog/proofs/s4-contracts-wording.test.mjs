// Proves the contract wording desk (public/app/contracts.html): writing and
// saving a wording, its blanks, archive, the uploaded-PDF box editor (draw,
// select, move, resize, kind, signer, source, remove, add a signer) and the
// PDF viewer. Every request is checked for the exact fields it carries.

import { test } from "node:test";
import assert from "node:assert/strict";

import { PDFDocument } from "pdf-lib";

import { OWNER, bodyOf, json, proofRows, startScreens } from "./s4-screen-harness.mjs";
import { waitFor } from "./s4-money-harness.mjs";

const proof = proofRows(import.meta.url);
const TPL = "7e000000-0000-4000-8000-000000000001";
const OLD = "7e000000-0000-4000-8000-000000000009";
const PDF_TPL = "7e000000-0000-4000-8000-000000000002";
const SIGNATURE_WORDS = "I have read this document and I agree to it. Typing my name here is my signature.";

const TEXT_TEMPLATE = {
  id: TPL, template_key: "FUNDING-AGREEMENT", name: "Funding Agreement", kind: "contract", subtype: "funding_agreement",
  body: "Hello {{contact.first_name}}. Fee {{field.fee}}.", manual_fields: [{ key: "fee", label: "Fee", required: true }],
  signature_statement: "I agree.", active: true, source_kind: "text",
};
const PDF_TEMPLATE = {
  id: PDF_TPL, template_key: "LENDER-FORM", name: "Lender form", kind: "contract", active: true,
  source_kind: "pdf", page_count: 1, original_filename: "lender-form.pdf", fields: [], signer_roles: [],
};

async function pdfBytes() {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  return Buffer.from(await doc.save());
}

async function openDesk(open, { templates = [TEXT_TEMPLATE, PDF_TEMPLATE], write } = {}) {
  const pdf = (await pdfBytes()).toString("base64");
  const writes = [];
  const handlers = {
    "/api/read/contracts": async (route, { url }) => {
      if (url.includes("file=template")) return json(route, { ok: true, pdf_base64: pdf });
      if (url.includes("view=templates")) return json(route, { ok: true, count: templates.length, items: templates });
      return json(route, { ok: true, items: [] });
    },
    "/api/contracts": async (route) => {
      const body = bodyOf(route);
      writes.push(body);
      const out = write ? write(body) : {
        status: 200, body: { ok: true, message: "Saved.", template: { ...TEXT_TEMPLATE, id: body.id || TPL, active: body.active !== false } },
      };
      return route.fulfill({ status: out.status, contentType: "application/json", body: JSON.stringify(out.body) });
    },
  };
  // A tall window, so the whole PDF page is on screen and every mouse position lands on it.
  const opened = await open("/app/contracts.html", { session: OWNER, handlers, viewport: { width: 1280, height: 1500 } });
  await opened.page.waitForSelector("#tplList tr[data-tid]");
  return { ...opened, writes, templates };
}

test("a new wording carries the typed name, type, words and blanks, and Save creates it", { timeout: 60_000 }, async (t) => {
  const { open } = await startScreens(t);
  const { page, writes } = await openDesk(open);

  await proof.check(/^New wording button and editor boxes/, async () => {
    await page.locator("#btnNewTpl").click();
    await page.locator("#tKey").fill("REPAIR-AGREEMENT");
    await page.locator("#tName").fill("Repair Agreement");
    await page.locator("#tKind").selectOption("authorization");
    await page.locator("#tSubtype").fill("repair_agreement");
    await page.locator("#tBody").fill("Hi {{contact.first_name}}, the fee is {{field.fee}}.");
    assert.equal(await page.locator("#tTags").innerText(), "blanks used: contact.first_name, field.fee");
    assert.equal(await page.locator("#tStatement").inputValue(), SIGNATURE_WORDS, "the signature sentence starts filled in");
  });

  await proof.check(/^Editor: 'Blanks you fill in when sending'/, async () => {
    await page.locator("#btnAddField").click();
    await page.locator('#tFields .mfrow [data-k="key"]').fill("fee");
    await page.locator('#tFields .mfrow [data-k="label"]').fill("The fee");
    await page.locator('#tFields .mfrow [data-k="required"]').check();
    await page.locator("#btnAddField").click();
    assert.equal(await page.locator("#tFields .mfrow").count(), 2);
    await page.locator("#tFields .mfrow").nth(1).locator("[data-del]").click();
    assert.equal(await page.locator("#tFields .mfrow").count(), 1, "the x removes the row");
  });

  await proof.check(/^Save \(create a new wording\)/, async () => {
    await page.locator("#btnSaveTpl").click();
    await waitFor(() => writes.length === 1);
    assert.deepEqual(writes[0], {
      action: "create_template", template_key: "REPAIR-AGREEMENT", name: "Repair Agreement", kind: "authorization",
      subtype: "repair_agreement", body: "Hi {{contact.first_name}}, the fee is {{field.fee}}.",
      manual_fields: [{ key: "fee", label: "The fee", required: true }], signature_statement: SIGNATURE_WORDS,
    });
    await page.waitForFunction(() => /Saved\./.test(document.querySelector("#tplMsg")?.innerText || ""));
  });
  await page.close();
});

test("editing saves by id with no short name; Archive and Turn back on post the switch", { timeout: 60_000 }, async (t) => {
  const { open } = await startScreens(t);
  const { page, writes } = await openDesk(open, { templates: [TEXT_TEMPLATE, { ...TEXT_TEMPLATE, id: OLD, template_key: "OLD", active: false }] });

  await proof.check(/^Save \(edit an existing wording\)/, async () => {
    await page.locator(`tr[data-tid="${TPL}"]`).click();
    assert.equal(await page.locator("#tKey").isDisabled(), true, "the short name is locked");
    await page.locator("#tName").fill("Funding Agreement v2");
    await page.locator("#btnSaveTpl").click();
    await waitFor(() => writes.length === 1);
    assert.equal(writes[0].action, "save_template");
    assert.equal(writes[0].id, TPL);
    assert.equal(writes[0].name, "Funding Agreement v2");
    assert.equal("template_key" in writes[0], false, "the short name is not sent on an edit");
  });

  await proof.check(/^Archive \/ Turn back on/, async () => {
    await page.locator(`tr[data-tid="${TPL}"]`).click();
    assert.equal(await page.locator("#btnArchive").innerText(), "Archive");
    await page.locator("#btnArchive").click();
    await waitFor(() => writes.length === 2);
    assert.deepEqual(writes[1], { action: "archive_template", id: TPL, active: false });
    await page.locator(`tr[data-tid="${OLD}"]`).click();
    assert.equal(await page.locator("#btnArchive").innerText(), "Turn back on");
    await page.locator("#btnArchive").click();
    await waitFor(() => writes.length === 3);
    assert.deepEqual(writes[2], { action: "archive_template", id: OLD, active: true });
  });
  await page.close();
});

test("Upload a PDF asks for a short name and sends the file as a data URL", { timeout: 60_000 }, async (t) => {
  const { open } = await startScreens(t);
  const { page, writes } = await openDesk(open, {
    write: (body) => ({ status: 200, body: { ok: true, message: "Uploaded.", template: { ...PDF_TEMPLATE, id: PDF_TPL, template_key: body.template_key } } }),
  });
  await proof.check(/^Upload a PDF: button, file picker, name prompt/, async () => {
    page.once("dialog", (dialog) => { assert.match(dialog.defaultValue(), /^LENDER-APP$/); dialog.accept("LENDER-APP-2026"); });
    await page.locator("#fileInput").setInputFiles({ name: "lender-app.pdf", mimeType: "application/pdf", buffer: await pdfBytes() });
    await waitFor(() => writes.length === 1);
    assert.equal(writes[0].action, "upload_template");
    assert.equal(writes[0].template_key, "LENDER-APP-2026");
    assert.equal(writes[0].name, "lender-app");
    assert.equal(writes[0].filename, "lender-app.pdf");
    assert.match(writes[0].file, /^data:application\/pdf;base64,/);
    // Cancelling the name question sends nothing
    page.once("dialog", (dialog) => dialog.dismiss());
    await page.locator("#fileInput").setInputFiles({ name: "other.pdf", mimeType: "application/pdf", buffer: await pdfBytes() });
    await page.waitForTimeout(200);
    assert.equal(writes.length, 1);
  });
  await page.close();
});

test("the uploaded PDF shows in the viewer; boxes draw, select, change and remove", { timeout: 90_000 }, async (t) => {
  const { open } = await startScreens(t);
  const { page, writes } = await openDesk(open);
  await page.locator(`tr[data-tid="${PDF_TPL}"]`).click();
  const pg = page.locator('#pdfPages .pg[data-page="0"]');

  await proof.check(/^PDF viewer \(pdf\.js, vendored\)/, async () => {
    await pg.locator("canvas").waitFor({ timeout: 20_000 });
    const box = await pg.boundingBox();
    assert.ok(box.width > 300 && box.height > 400, "the page is drawn at reading size");
    assert.match(await pg.locator(".pn").innerText(), /page 1/i);
  });

  await pg.scrollIntoViewIfNeeded();
  // The tool panel can move the page when a box is picked, so every position is read fresh.
  const at = async (fx, fy) => {
    const r = await pg.boundingBox();
    return [r.x + r.width * fx, r.y + r.height * fy];
  };
  const dragTo = async (from, to, steps = 5) => {
    await page.mouse.move(...from);
    await page.mouse.down();
    await page.mouse.move(...to, { steps });
    await page.mouse.up();
  };

  // Drawing is the set-up for the box tools below. Moving and resizing a box are NOT
  // claimed: the saved position changes but the box on screen stays where it was
  // drawn until the next redraw (see the manifest), so that row stays not proved.
  await dragTo(await at(0.40, 0.45), await at(0.70, 0.50), 10);
  assert.equal(await pg.locator(".box").count(), 1);
  await page.mouse.click(...(await at(0.50, 0.58)));
  assert.equal(await pg.locator(".box").count(), 2, "a click on empty page space makes a default box");
  await pg.locator('.box[data-id="f1"]').click({ position: { x: 4, y: 4 } });
  assert.equal(await pg.locator(".box.sel").getAttribute("data-id"), "f1", "a click on a box picks it");

  await proof.check(/^PDF editor: field type chips/, async () => {
    await page.locator("#bpLabel").fill("Owner signature");
    const autoSource = (await page.locator("#bpSource option").evaluateAll((els) => els.map((e) => e.value))).find((v) => v !== "manual");
    await page.locator("#bpSource").selectOption(autoSource);
    assert.equal(await page.locator("#bpSource").inputValue(), autoSource, "a box can be filled from the client's file");
    await page.locator("#bpType").selectOption("signature");
    assert.equal(await page.locator("#bpSource").inputValue(), "manual", "a signature is never filled in for somebody");
    await page.locator("#bpReq").uncheck();
    await page.locator('.chip2[data-type="date"]').click();
    assert.equal(await page.locator('.chip2[data-type="date"]').getAttribute("class"), "chip2 on");
    await pg.locator('.box[data-id="f2"]').click({ position: { x: 4, y: 4 } });
    await page.locator("#bpDel").click();
    assert.equal(await pg.locator(".box").count(), 1, "Remove this box takes the box off");
  });

  await proof.check(/^PDF editor: Add a signer/, async () => {
    await page.locator("#btnAddSigner").click();
    assert.match(await page.locator("#signerRoles").innerText(), /1\. client\s*2\. signer 2/i);
    await page.locator('.box[data-id="f1"]').click({ position: { x: 4, y: 4 } });
    await page.locator("#bpSigner").selectOption("1");
  });

  await page.locator("#btnSaveFields").click();
  await waitFor(() => writes.length === 1);
  const sent = writes[0];
  assert.equal(sent.action, "save_fields");
  assert.equal(sent.id, PDF_TPL);
  assert.deepEqual(sent.signer_roles.map((s) => s.label), ["Client", "Signer 2"]);
  assert.equal(sent.fields.length, 1);
  const f = sent.fields[0];
  assert.deepEqual({ page: f.page, type: f.type, source: f.source, signer: f.signer, required: f.required, label: f.label, id: f.id },
    { page: 0, type: "signature", source: "manual", signer: 1, required: false, label: "Owner signature", id: "f1" });
  for (const key of ["x", "y", "w", "h"]) assert.ok(f[key] > 0 && f[key] <= 1, `${key} is a fraction of the page`);
  assert.ok(Math.abs(f.x - 0.40) < 0.03 && Math.abs(f.y - 0.45) < 0.03 && Math.abs(f.w - 0.30) < 0.03, "the drawn box is saved as page fractions");
  await page.close();
});

test("every listed row was exercised", () => {
  proof.assertAllClaimed();
});
