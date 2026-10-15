// Batch 11 practice tests: three small controls that only move a person or close a form.
//
//   consent-capture.html  the Back link (Client Control Panel, or Client Portal for dispute letters)
//   contracts.html        the Cancel button on the wording editor, and the link to Documents
//
// Real page in Chromium, fake /api answers. Nothing is sent or saved by any of these controls, and
// that is part of what is judged: Cancel sends no write, and the links only navigate.

import { test } from "node:test";
import assert from "node:assert/strict";

import { json, OWNER, proofRows, sharedScreens, waitFor } from "./fin-b11-kit.mjs";

const proof = proofRows(import.meta.url);
const { open } = sharedScreens();

const CLIENT = "ac1ac964-e02b-468b-9cbe-7030e03dd13b";
const TPL = "7e000000-0000-4000-8000-000000000001";

test("consent capture: the Back link goes to the right screen and carries the client", { timeout: 90_000 }, async () => {
  const consent = (kind) => ({
    "/api/consent/capture": async (route) => json(route, {
      ok: true, kind, status: { valid: false, reason: "none_on_file" }, history: [],
      disclosure: { version: "2.1", text: `The ${kind} wording the client reads.` }
    })
  });
  async function openConsent({ kind = "", client = CLIENT } = {}) {
    const query = [client ? `client_id=${client}` : "", kind ? `kind=${kind}` : ""].filter(Boolean).join("&");
    const opened = await open(`/app/consent-capture.html${query ? `?${query}` : ""}`, { session: OWNER, handlers: consent(kind || "soft_pull_consent") });
    // With a client named the page reads the wording and shows its version; with none it reads nothing.
    if (client) await opened.page.waitForFunction(() => document.querySelector("#ccVersion")?.textContent !== "—");
    else await opened.page.waitForFunction(() => document.querySelector("#ccBack"));
    return opened;
  }
  const leaves = async (page) => {
    const seen = [];
    page.on("framenavigated", (frame) => { if (frame === page.mainFrame()) seen.push(frame.url()); });
    await page.locator("#ccBack").click();
    await waitFor(() => seen.length > 0, "the page to move");
    return seen[0];
  };

  await proof.check(/^Back link/, async () => {
    // Soft pull and every other consent: back to the Client Control Panel, carrying the client.
    const normal = await openConsent();
    assert.equal(await normal.page.locator("#ccBack").innerText(), "← Back to Client Control Panel");
    assert.match(await normal.page.locator("#ccBack").getAttribute("href"), new RegExp(`^client-control-panel\\.html\\?client_id=${CLIENT}`));
    const there = await leaves(normal.page);
    assert.match(there, new RegExp(`/app/client-control-panel\\.html\\?client_id=${CLIENT}`));
    await normal.page.close();

    // Dispute letter authorization lives on the portal, so the link says so and goes there.
    const dispute = await openConsent({ kind: "dispute_authorization" });
    assert.equal(await dispute.page.locator("#ccBack").innerText(), "← Back to Client Portal");
    assert.match(await dispute.page.locator("#ccBack").getAttribute("href"), new RegExp(`^client-portal\\.html\\?id=${CLIENT}`));
    const portal = await leaves(dispute.page);
    assert.match(portal, new RegExp(`/app/client-portal\\.html\\?id=${CLIENT}`));
    await dispute.page.close();

    // Only dispute authorization lives on the portal. The two kinds that share the page's else branch
    // (a recorded call, and use in an advert) and a kind the page does not know all go to the control panel.
    for (const kind of ["call_recording", "marketing_use", "something_unknown"]) {
      const other = await openConsent({ kind });
      assert.equal(await other.page.locator("#ccBack").innerText(), "← Back to Client Control Panel", kind);
      assert.match(await other.page.locator("#ccBack").getAttribute("href"), new RegExp(`^client-control-panel\\.html\\?client_id=${CLIENT}`), kind);
      const landed = await leaves(other.page);
      assert.match(landed, new RegExp(`/app/client-control-panel\\.html\\?client_id=${CLIENT}`), kind);
      assert.doesNotMatch(landed, /client-portal/, kind);
      await other.page.close();
    }

    // With no client named, the link still works and carries nothing.
    const bare = await openConsent({ client: "" });
    assert.equal(await bare.page.locator("#ccBack").getAttribute("href"), "client-control-panel.html");
    const bareDispute = await openConsent({ kind: "dispute_authorization", client: "" });
    assert.equal(await bareDispute.page.locator("#ccBack").getAttribute("href"), "client-portal.html");
    await bare.page.close();
    await bareDispute.page.close();
  });
});

test("contracts: Cancel closes the editor and sends nothing; the Documents link goes to Documents", { timeout: 90_000 }, async () => {
  const writes = [];
  const template = { id: TPL, template_key: "FUNDING-AGREEMENT", name: "Funding Agreement", kind: "contract", subtype: "funding_agreement",
    body: "Hello {{contact.first_name}}.", manual_fields: [], signature_statement: "I agree.", active: true, source_kind: "text" };
  const handlers = {
    "/api/read/contracts": async (route, { url }) => json(route, url.includes("view=templates") ? { ok: true, count: 1, items: [template] } : { ok: true, items: [] }),
    "/api/contracts": async (route) => { writes.push(route.request().postDataJSON()); return json(route, { ok: true, message: "Saved." }); }
  };
  const { page } = await open("/app/contracts.html", { session: OWNER, handlers });
  await waitFor(async () => (await page.locator("#tplList tr[data-tid]").count()) === 1, "the wording list");
  const editorShown = () => page.locator("#tplEditor").evaluate((el) => el.style.display !== "none");

  await proof.check(/^Cancel button$/, async () => {
    assert.equal(await editorShown(), false, "the editor starts closed");
    // Open an existing wording, change a box, then cancel: closed, nothing written, nothing selected.
    await page.locator(`tr[data-tid="${TPL}"]`).click();
    assert.equal(await editorShown(), true);
    assert.equal(await page.locator(`tr[data-tid="${TPL}"]`).getAttribute("class"), "rowlink sel");
    await page.locator("#tName").fill("Funding Agreement v2");
    await page.locator("#btnCancelTpl").click();
    assert.equal(await editorShown(), false);
    assert.equal(await page.locator(`tr[data-tid="${TPL}"]`).getAttribute("class"), "rowlink");
    assert.deepEqual(writes, [], "Cancel writes nothing");
    // Opening the same wording again shows what was saved, not the cancelled edit.
    await page.locator(`tr[data-tid="${TPL}"]`).click();
    assert.equal(await page.locator("#tName").inputValue(), "Funding Agreement");
    await page.locator("#btnCancelTpl").click();
    // New wording, then Cancel: closed, and Save was never pressed.
    await page.locator("#btnNewTpl").click();
    assert.equal(await editorShown(), true);
    await page.locator("#tKey").fill("DRAFT");
    await page.locator("#btnCancelTpl").click();
    assert.equal(await editorShown(), false);
    assert.deepEqual(writes, []);
  });

  await proof.check(/^Link: 'Documents'/, async () => {
    const link = page.locator("#explainCard a", { hasText: "Documents" });
    assert.equal(await link.count(), 1);
    assert.equal(await link.getAttribute("href"), "documents.html");
    // The click has to land on a screen that exists: the server answers 200 with the Documents page,
    // not a "not found" body that merely sits at the right address.
    const [answer] = await Promise.all([
      page.waitForResponse((r) => r.request().isNavigationRequest() && /\/app\/documents\.html$/.test(new URL(r.url()).pathname)),
      link.click()
    ]);
    assert.equal(answer.status(), 200, "the Documents screen exists");
    await page.waitForLoadState("domcontentloaded");
    assert.match(page.url(), /\/app\/documents\.html$/);
    assert.equal(await page.title(), "Fundhub — Documents");
    assert.equal(await page.locator("h1").first().innerText(), "Documents");
    assert.deepEqual(writes, []);
  });
  await page.close();
});

test("every listed small-page row was pressed", () => {
  proof.assertAllClaimed();
});
