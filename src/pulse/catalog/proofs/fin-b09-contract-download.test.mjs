// Practice test (real page, fake /api answers) for the signed-document download button on the public
// contract page (public/contract.html, button #dlBtn). It reads no live data and signs nothing.
// The page is opened on a document that is fully signed; the button must ask the server for the file
// with the same signed link, hand the person that file under the server's file name, and say so
// out loud when the file cannot be fetched.

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { json, proofRows, sharedScreens, waitFor } from "./fin-b09-kit.mjs";

const proof = proofRows(import.meta.url);
const screens = sharedScreens();

const LINK = "?id=7e000000-0000-4000-8000-000000000002&sig=link-signature&exp=1999999999";
const BASE = {
  title: "Funding Agreement", can_sign: false, verified: true, source_kind: "text",
  body: "This agreement is between Fundhub and the client.", fields: [], signers: [],
  sent_at: "2026-10-08T10:00:00Z",
  signature_statement: "I have read this document and I agree to it.",
};
const ALL_SIGNED = {
  ...BASE, status: "signed",
  signer: { status: "signed", name: "Dana Whitfield", signer_name: "Dana Whitfield", signed_at: "2026-10-09T15:30:00Z" },
};
// This person has signed; the other signer has not. The whole document is not signed yet.
const MINE_ONLY = { ...ALL_SIGNED, status: "sent" };
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

async function openSigned({ contract = ALL_SIGNED, file = { ok: true, pdf_base64: PDF.toString("base64"), filename: "Funding-Agreement-signed.pdf" } } = {}) {
  const reads = [];
  const files = [];
  const state = { file };
  const { page, errors } = await screens.open(`/contract.html${LINK}`, {
    session: null,
    handlers: {
      "/api/contracts/sign": async (route, { url, method }) => {
        const search = new URL(url).search;
        if (method === "GET" && search.includes("file=1")) {
          files.push(search);
          return json(route, state.file);
        }
        reads.push(search);
        return json(route, { ok: true, contract });
      },
    },
  });
  await page.waitForSelector("#donePanel", { state: "visible" });
  return { page, errors, reads, files, state };
}

test("Download a copy: asks for the file on the same signed link and saves it under the server's name", async () => {
  await proof.check("Download a copy of the signed document.", async () => {
    const { page, errors, reads, files } = await openSigned();
    assert.deepEqual(reads, [LINK], "the page was read once, on the link exactly as sent");
    assert.equal(await page.locator("#dlBtn").isVisible(), true);
    assert.equal(await page.locator("#dlBtn").innerText(), "Download a copy");
    assert.equal(files.length, 0, "nothing is fetched until the button is pressed");

    const [download] = await Promise.all([page.waitForEvent("download"), page.locator("#dlBtn").click()]);
    assert.equal(download.suggestedFilename(), "Funding-Agreement-signed.pdf");
    const saved = await download.path();
    assert.deepEqual(fs.readFileSync(saved), PDF, "the saved file is exactly the bytes the server sent");
    assert.deepEqual(files, [`${LINK}&file=1`], "the file request carries the link, then file=1");
    assert.equal(await page.locator("#dlBtn").innerText(), "Download a copy");
    assert.deepEqual(errors, []);
    await page.close();
  });
});

test("Download a copy: a file that cannot be fetched is said out loud, and a retry works", async () => {
  const { page, files, state } = await openSigned({ file: { ok: false, message: "That link has expired." } });
  await page.locator("#dlBtn").click();
  await waitFor(() => files.length === 1, "the file request");
  await page.waitForFunction(() => document.querySelector("#dlBtn").innerText === "Download failed — try again");

  // A file answer with no bytes in it is a failure too, not a silent nothing.
  state.file = { ok: true, filename: "empty.pdf" };
  await page.locator("#dlBtn").click();
  await waitFor(() => files.length === 2, "the second file request");
  await page.waitForFunction(() => document.querySelector("#dlBtn").innerText === "Download failed — try again");

  state.file = { ok: true, pdf_base64: PDF.toString("base64"), filename: "Funding-Agreement-signed.pdf" };
  const [download] = await Promise.all([page.waitForEvent("download"), page.locator("#dlBtn").click()]);
  assert.equal(download.suggestedFilename(), "Funding-Agreement-signed.pdf");
  await page.waitForFunction(() => document.querySelector("#dlBtn").innerText === "Download a copy");
  await page.close();
});

test("Download a copy is offered only when everyone has signed", async () => {
  const { page } = await openSigned({ contract: MINE_ONLY });
  assert.match(await page.locator("#doneText").innerText(), /waiting for the other people to sign/);
  assert.equal(await page.locator("#dlBtn").isHidden(), true);
  await page.close();
});

test("every listed row was exercised", () => {
  proof.assertAllClaimed();
});
