// Proves the Funding papers section: what the client sees and can send, and
// what staff can accept, reject, change, sort and add. Standalone page
// (money-vault.html) and frame tab (financeos.html#vault). The views are built
// by the real vault engine through src/http/fixtures/money-vault.sample.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";

import { OWNER, json, proofRows, startScreens } from "./s4-screen-harness.mjs";
import { CLIENT, CLIENT_ID, entryUrl, moneyResource, waitFor } from "./s4-money-harness.mjs";
import { sampleDoc, sampleReview, sampleVault } from "../../../http/fixtures/money-vault.sample.mjs";

const proof = proofRows(import.meta.url);
const PAGE = { entry: "page", file: "money-vault.html", surface: "public/app/money-vault.html" };
const FRAME = { entry: "frame", tab: "vault", surface: "financeos.html#vault" };
const BIZ = "386c687a-167d-4d44-a000-8d50b5a80191";
const STAFF = OWNER;

// The engine view, with a "View" link on every document the way the server signs one.
function view(audience, extra = {}, expiresAt = "2099-01-01T00:00:00.000Z") {
  const v = sampleVault({ variant: "full", audience, extra });
  const link = (d) => ({ ...d, download: { url: `/files/${d.id}.pdf`, expires_at: expiresAt } });
  for (const item of v.items) item.documents = (item.documents || []).map(link);
  v.unfiled = (v.unfiled || []).map(link);
  return v;
}
const docOf = (v, slotStart, status) => v.items.find((i) => i.slot.startsWith(slotStart)).documents.find((d) => d.status === status);

async function openVault(open, target, { session = CLIENT, clientId = "", audience = "client", write, extra, expiresAt } = {}) {
  const uploads = [];
  const resource = moneyResource("vault", { read: () => view(audience, extra, expiresAt), write: write || (() => ({ status: 200, body: { ok: true, result: { item_key: "x" } } })) });
  const handlers = {
    ...resource.handlers,
    "/api/documents-upload": async (route) => {
      const request = route.request();
      const body = request.postData() || "";
      uploads.push({ type: request.headers()["content-type"] || "", body });
      // One document is stored per file, the way the real endpoint answers.
      const stored = (body.match(/filename="/g) || []).map((_, i) => ({ id: `new-doc-${i}` }));
      return json(route, { ok: true, documents: stored });
    },
  };
  const opened = await open(entryUrl(target.entry, { ...target, clientId }), { session, handlers });
  await opened.page.waitForSelector(".fh-vault .vt-item");
  return { ...opened, ...resource.log, uploads };
}

for (const target of [PAGE, FRAME]) {
  const surface = target.surface;
  const frame = target.entry === "frame";

  test(`${target.entry}: the client sees the list, can send a file and sees no staff controls`, { timeout: 90_000 }, async (t) => {
    const { open } = await startScreens(t);
    // The sample's EIN letter was sent and is waiting; a person rejecting it gives the "rejected" paper state.
    const ein = sampleDoc(8, "ein_letter", "cp575-ein-letter.pdf", "2026-10-06T21:40:00.000Z", { business: true });
    const extra = { reviews: [sampleReview(ein, { status: "rejected", covers: null, reason: "The page is cut off" })] };
    const v = view("client", extra);
    const { page, uploads, reads, errors } = await openVault(open, target, { extra });
    assert.deepEqual(reads, [""], "a client reads their own file");

    await proof.check(frame ? /^Papers list: progress, two groups/ : /^Open the page \(client, or staff with/, async () => {
      for (const item of v.items) {
        const li = page.locator(`li.vt-item[data-item="${item.slot}"]`);
        assert.equal(await li.count(), 1, `${item.title} has its line`);
        assert.match(await li.innerText(), new RegExp(item.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      }
      assert.ok(await page.locator(".vt-group").count() >= 2, "personal and business groups");
      assert.equal(await page.locator('[data-act="accept"], [data-act="reject"], #vt-add, .vt-sort').count(), 0, "a client sees no staff controls");
    }, surface);

    if (!frame) {
      await proof.check(/^View \(link to the file/, async () => {
        const doc = docOf(v, "id_document", "accepted");
        const link = page.locator(`li.vt-doc[data-doc="${doc.id}"] a.vt-view`);
        assert.equal(await link.getAttribute("href"), `/files/${doc.id}.pdf`);

        // a link that has lived its 15 minutes is not followed: the paper list is read again instead
        const old = await openVault(open, target, { expiresAt: "2000-01-01T00:00:00.000Z" });
        const reads = old.reads.length;
        await old.page.locator(`li.vt-doc[data-doc="${doc.id}"] a.vt-view`).click();
        await waitFor(() => old.reads.length === reads + 1);
        await old.page.waitForFunction(() => /That link timed out, so we made a fresh one\. Tap View again\./.test(document.body.innerText));
        assert.equal(old.page.context().pages().length, 1, "the dead link was not opened");
        await old.page.close();
      }, surface);
    }

    // send: the right fields go with the file; a text file is refused on the page
    const sendRow = frame ? /^Client: 'Send' \/ pick-file button/ : /^Upload \/ Upload more/;
    await proof.check(sendRow, async () => {
      // each paper's button says what it is for, and a paper that takes several files has a multi-file input
      const BUTTONS = [
        ["tax_returns_business", "Upload", true], ["tax_returns_personal", "Upload more", true],
        ["bank_statements_business", "Upload more", true], ["ein_letter", "Upload a new copy", false],
        ["certificate_good_standing", "Upload a newer one", false],
      ];
      for (const [slotKey, label, multiple] of BUTTONS) {
        const pick = page.locator(`button[data-act="pick"][data-slot^="${slotKey}"]`);
        assert.equal(await pick.evaluate((el) => el.firstChild.textContent), label, `${slotKey} button`);
        const input = page.locator(`input[type="file"][data-slot^="${slotKey}"]`);
        assert.equal(await input.evaluate((el) => el.hasAttribute("multiple")), multiple, `${slotKey} multi-file input`);
        assert.match(await input.getAttribute("accept"), /application\/pdf.*image\/jpeg.*image\/png/, `${slotKey} takes PDF, JPG, PNG`);
      }
      assert.equal(await page.locator('button[data-act="pick"][data-slot^="id_document"]').count(), 0, "an accepted paper has no upload button");

      const slot = `tax_returns_business:${BIZ}`;
      const input = page.locator(`input[type="file"][data-slot="${slot}"]`);
      await input.setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("not a paper") });
      await page.waitForFunction(() => /That file type does not work/.test(document.body.innerText));
      assert.deepEqual(uploads, [], "a text file is not sent");
      await input.setInputFiles([
        { name: "return-2025.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 one") },
        { name: "return-2024.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 two") },
      ]);
      await waitFor(() => uploads.length === 1);
      assert.match(uploads[0].type, /^multipart\/form-data/);
      for (const part of ['name="kind"', "client_upload", 'name="subtype"', "business_tax_return", 'name="entity_id"', BIZ, "return-2025.pdf", "return-2024.pdf"]) {
        assert.ok(uploads[0].body.includes(part), `the upload carries ${part}`);
      }
      await page.waitForFunction(() => /Got your 2 files\./.test(document.body.innerText));

      // a photo is a paper too: JPG and PNG go through as one file each
      for (const [i, [name, mimeType]] of [["license.jpg", "image/jpeg"], ["license.png", "image/png"]].entries()) {
        await page.locator(`input[type="file"][data-slot="${slot}"]`).setInputFiles({ name, mimeType, buffer: Buffer.from("photo") });
        await waitFor(() => uploads.length === 2 + i);
        assert.ok(uploads[1 + i].body.includes(`filename="${name}"`), `${name} is sent`);
        assert.ok(uploads[1 + i].body.includes(mimeType), `${name} goes as ${mimeType}`);
        await page.waitForFunction(() => /Got it\. We're checking your file\./.test(document.body.innerText));
      }
    }, surface);
    assert.deepEqual(errors, []);
    await page.close();
  });

  test(`${target.entry}: staff accept, reject, change, sort and add post the exact request`, { timeout: 120_000 }, async (t) => {
    const { open } = await startScreens(t);
    const v = view("staff");
    const einLetter = docOf(v, "ein_letter", "uploaded");
    const sepStatement = docOf(v, "bank_statements_business", "uploaded");
    const articles = docOf(v, "articles_of_organization", "accepted");
    const augStatement = docOf(v, "bank_statements_business", "rejected");
    const scan = v.unfiled[0];
    const ein = v.items.find((i) => i.key === "ein_letter");
    const statements = v.items.find((i) => i.key === "bank_statements_business");
    const { page, posts, errors } = await openVault(open, target, { session: STAFF, clientId: CLIENT_ID, audience: "staff" });
    const row = (doc) => page.locator(`li.vt-doc[data-doc="${doc.id}"]`);
    const last = () => posts.at(-1);

    await proof.check(frame ? /^Staff only: 'Accept' \(asks months or end date/ : /^Staff: Accept \(button on a file waiting for review/, async () => {
      // Accept a paper that needs no details: one press
      await row(einLetter).locator('[data-act="accept"]').click();
      await waitFor(() => posts.length === 1);
      assert.deepEqual(last(), { action: "accept", document_id: einLetter.id, client_id: CLIENT_ID });
      await page.waitForFunction(() => /Accepted\./.test(document.body.innerText));

      // Accept a bank statement: asks how many months and the last day first
      await row(sepStatement).locator('[data-act="accept"]').click();
      assert.equal(posts.length, 1, "no request until Accept file");
      const form = row(sepStatement).locator('.vt-form[data-form="accept"]');
      await form.locator('[data-field="covers"]').fill("1");
      await form.locator('[data-field="period_end"]').fill("2026-09-30");
      await form.locator('[data-act="accept-send"]').click();
      await waitFor(() => posts.length === 2);
      assert.deepEqual(last(), { action: "accept", document_id: sepStatement.id, covers: 1, period_end: "2026-09-30", client_id: CLIENT_ID });
    }, surface);

    // The frame lists the reject form under 'Change' (below); the page lists it as its own row.
    const reject = async () => {
      // Reject: the reason is required, then it is posted
      await row(sepStatement).locator('[data-act="reject"]').click();
      const rejectForm = row(sepStatement).locator('.vt-form[data-form="reject"]');
      await rejectForm.locator('[data-act="reject-send"]').click();
      await page.waitForFunction(() => /Write what the client should fix\./.test(document.body.innerText));
      assert.equal(posts.length, 2);
      await rejectForm.locator('[data-field="reason"]').fill("Page 2 is missing");
      await rejectForm.locator('[data-act="reject-send"]').click();
      await waitFor(() => posts.length === 3);
      assert.deepEqual(last(), { action: "reject", document_id: sepStatement.id, reason: "Page 2 is missing", client_id: CLIENT_ID });
    };
    if (frame) await reject();
    else await proof.check(/^Staff: Reject \(opens the reject form\)/, reject, surface);

    await proof.check(frame ? /^Staff only: 'Change'/ : /^Staff: Change \(re-open/, async () => {
      // Change: an accepted file can be flipped to rejected, nothing is sent until Reject file; Cancel closes it
      await row(articles).locator('[data-act="change"]').click();
      const flip = row(articles).locator('.vt-form[data-form="reject"]');
      assert.equal(await flip.isVisible(), true);
      assert.equal(posts.length, 3, "Change sends nothing");
      await flip.locator('[data-act="cancel"]').click();
      assert.equal(await flip.isVisible(), false);
      assert.equal(posts.length, 3, "Cancel sends nothing");
      await row(articles).locator('[data-act="change"]').click();
      await flip.locator('[data-field="reason"]').fill("Wrong state on the filing");
      await flip.locator('[data-act="reject-send"]').click();
      await waitFor(() => posts.length === 4);
      assert.deepEqual(last(), { action: "reject", document_id: articles.id, reason: "Wrong state on the filing", client_id: CLIENT_ID });
      await row(augStatement).locator('[data-act="change"]').click();
      assert.equal(await row(augStatement).locator('.vt-form[data-form="accept"]').isVisible(), true, "a rejected file flips back to accept");
    }, surface);

    await proof.check(frame ? /^Staff only: files to sort/ : /^Staff: Files to sort/, async () => {
      // Files to sort: pick the paper, then File and accept
      posts.length = 0;
      const sortRow = page.locator(`.vt-sort li.vt-doc[data-doc="${scan.id}"]`);
      await sortRow.locator('[data-act="sort-accept"]').click();
      const acceptForm = sortRow.locator('.vt-form[data-form="accept"]');
      await acceptForm.locator('[data-act="sort-accept-send"]').click();
      await page.waitForFunction(() => /Pick the paper this file is for first\./.test(document.body.innerText));
      assert.deepEqual(posts, [], "no paper picked, nothing sent");
      await acceptForm.locator('[data-field="slot"]').selectOption(ein.slot);
      assert.equal(await acceptForm.locator('[data-when="covers"]').isVisible(), false, "a paper with no months asks for none");
      await acceptForm.locator('[data-act="sort-accept-send"]').click();
      await waitFor(() => posts.length === 1);
      assert.deepEqual(last(), { action: "accept", document_id: scan.id, item_key: "ein_letter", entity_id: BIZ, client_id: CLIENT_ID });

      // File and accept under a paper that counts months: the months and the date go with it
      await waitFor(() => posts.length === 1);
      await sortRow.locator('[data-act="sort-accept"]').click();
      await acceptForm.locator('[data-field="slot"]').selectOption(statements.slot);
      assert.equal(await acceptForm.locator('[data-when="covers"]').isVisible(), true, "months are asked for a statement");
      assert.equal(await acceptForm.locator('[data-when="date"]').isVisible(), true, "the date is asked for a statement");
      await acceptForm.locator('[data-field="covers"]').fill("2");
      await acceptForm.locator('[data-field="period_end"]').fill("2026-09-30");
      await acceptForm.locator('[data-act="sort-accept-send"]').click();
      await waitFor(() => posts.length === 2);
      assert.deepEqual(last(), {
        action: "accept", document_id: scan.id, item_key: "bank_statements_business", entity_id: BIZ,
        covers: 2, period_end: "2026-09-30", client_id: CLIENT_ID,
      });

      // Files to sort: Reject needs the paper and a reason
      await page.locator(`.vt-sort li.vt-doc[data-doc="${scan.id}"] [data-act="sort-reject"]`).click();
      const sortReject = page.locator(`.vt-sort li.vt-doc[data-doc="${scan.id}"] .vt-form[data-form="reject"]`);
      await sortReject.locator('[data-act="sort-reject-send"]').click();
      await page.waitForFunction(() => /Pick the paper this file is for first\./.test(document.querySelector('.vt-sort .vt-form[data-form="reject"]:not([hidden])')?.innerText || ""));
      assert.equal(posts.length, 2, "no paper and no reason, nothing sent");
      await sortReject.locator('[data-field="slot"]').selectOption(ein.slot);
      await sortReject.locator('[data-field="reason"]').fill("This is not an EIN letter");
      await sortReject.locator('[data-act="sort-reject-send"]').click();
      await waitFor(() => posts.length === 3);
      assert.deepEqual(last(), { action: "reject", document_id: scan.id, item_key: "ein_letter", entity_id: BIZ, reason: "This is not an EIN letter", client_id: CLIENT_ID });
    }, surface);

    await proof.check(frame ? /^Staff only: 'Add a paper' form/ : /^Staff: Add a paper/, async () => {
      // Add a paper: needs a name; then the request carries every field
      posts.length = 0;
      await page.locator("#vt-add > summary").click();
      await page.locator('.vt-add-form button[type="submit"]').click();
      await page.waitForFunction(() => /Give the paper a name\./.test(document.body.innerText));
      assert.deepEqual(posts, []);
      const add = page.locator(".vt-add-form");
      await add.locator('[name="title"]').fill("Business license");
      await add.locator('[name="entity_id"]').selectOption(BIZ);
      await add.locator('[name="note"]').fill("The lender asked for it");
      await add.locator('[name="subtype"]').selectOption("business_license");
      await add.locator('[name="need"]').fill("2");
      await add.locator('button[type="submit"]').click();
      await waitFor(() => posts.length === 1);
      assert.deepEqual(last(), {
        action: "add_item", title: "Business license", note: "The lender asked for it", entity_id: BIZ,
        subtype: "business_license", need: 2, client_id: CLIENT_ID,
      });
    }, surface);
    assert.deepEqual(errors, []);
    await page.close();
  });
}

// Staff controls need BOTH a client id in the address and the server's word that this is the staff view.
const GATE = [
  { name: "a client id and the staff view", clientId: CLIENT_ID, audience: "staff", controls: true },
  { name: "a client id but the server says client view", clientId: CLIENT_ID, audience: "client", controls: false },
  { name: "the staff view but no client id", clientId: "", audience: "staff", controls: false },
];
test("staff controls show only with a client id AND the server's word that this is the staff view", { timeout: 90_000 }, async (t) => {
  const { open } = await startScreens(t);
  await proof.check(/^Open the page \(client, or staff with/, async () => {
    for (const gate of GATE) {
      const opened = await openVault(open, PAGE, { session: STAFF, clientId: gate.clientId, audience: gate.audience });
      const controls = await opened.page.locator('[data-act="accept"], [data-act="reject"], #vt-add, .vt-sort').count();
      assert.equal(controls > 0, gate.controls, gate.name);
      assert.deepEqual(opened.reads, [gate.clientId ? `?client_id=${gate.clientId}` : ""], `${gate.name}: the read names the client only when one was given`);
      await opened.page.close();
    }
  }, PAGE.surface);
});

test("every listed row was exercised", () => {
  proof.assertAllClaimed();
});
