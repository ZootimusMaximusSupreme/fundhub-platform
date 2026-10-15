// finish-853 batch 08, repair cycle 1: GET and POST /api/contracts/sign, what the signer is shown and what a
// signature keeps. The first file judged the happy path and the refusals. This one adds:
//   - what a signer is told about the other signers (names and states, never their email) and which boxes
//     they are shown (their own only), and the no-store header on the view;
//   - a link that does not name a signer on a contract with two signers opens nothing and signs nothing;
//   - the values typed into the boxes (field_values): required boxes are asked for, a value for somebody
//     else's box is dropped, and the typed name fills the signature box;
//   - a parallel contract lets the second signer sign first; a sequential one does not;
//   - a voided contract cannot be signed by POST;
//   - each tamper layer on its own: the document registry's fingerprint, and the row's own fingerprint.
// Practice test, fake data, no network, no database.
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { PDFDocument } from "pdf-lib";

import contractsHandler from "../../api/contracts.mjs";
import signHandler from "../../api/contracts/sign.mjs";
import { fakeDb, makeRes, req, runWithSharedDb, staffSession, ORG_ID, OTHER_ORG_ID, STAFF_ID } from "../testing/handler-harness.mjs";
import { contractsDb, baseBook, IDS } from "../testing/fin-b08-contracts-db.mjs";
import { bodyHash } from "../contracts/send.mjs";

const KEYS = ["CONTRACT_URL_SECRET", "DOCUMENT_URL_SECRET", "MESSAGING_DRY_RUN", "ADAPTERS_DRY_RUN", "INNGEST_EVENT_KEY", "DOCUMENT_STORE_PROVIDER", "PUBLIC_BASE_URL"];
const saved = {};
const realFetch = globalThis.fetch;
const asked = [];
before(() => {
  for (const k of KEYS) saved[k] = process.env[k];
  process.env.CONTRACT_URL_SECRET = crypto.randomBytes(24).toString("hex");
  process.env.DOCUMENT_URL_SECRET = crypto.randomBytes(24).toString("hex");
  process.env.MESSAGING_DRY_RUN = "1";
  process.env.ADAPTERS_DRY_RUN = "1";
  delete process.env.INNGEST_EVENT_KEY;
  delete process.env.DOCUMENT_STORE_PROVIDER;
  delete process.env.PUBLIC_BASE_URL;
  globalThis.fetch = async (url) => { asked.push(String(url)); throw new Error("network refused in this test"); };
});
after(() => {
  for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  globalThis.fetch = realFetch;
});
beforeEach(() => { asked.length = 0; });

const TWO = [
  { role_label: "Client", name: "Dana Whitfield", email: "dana@example.test", client_id: IDS.client },
  { role_label: "Counterparty", name: "Pat Counter", email: "pat@example.test", client_id: null },
];
const BOXES = [
  { id: "d_sig", page: 0, type: "signature", signer: 0, source: "manual", x: 0.1, y: 0.8, w: 0.3, h: 0.05, label: "Dana signature", required: true },
  { id: "d_amount", page: 0, type: "text", signer: 0, source: "manual", x: 0.1, y: 0.6, w: 0.3, h: 0.05, label: "Fee amount", required: true },
  { id: "d_name", page: 0, type: "text", signer: 0, source: "signer.name", x: 0.1, y: 0.5, w: 0.3, h: 0.05, label: "Printed name", required: false },
  { id: "p_sig", page: 1, type: "signature", signer: 1, source: "manual", x: 0.5, y: 0.8, w: 0.3, h: 0.05, label: "Pat signature", required: true },
  { id: "p_note", page: 1, type: "text", signer: 1, source: "manual", x: 0.5, y: 0.6, w: 0.3, h: 0.05, label: "Pat note", required: false },
];
const book = () => baseBook({ orgId: ORG_ID, otherOrgId: OTHER_ORG_ID, staffId: STAFF_ID });
const staffOwner = [staffSession({ role: "owner" })];

async function viaStaff(body, fake) {
  const session = fakeDb(staffOwner);
  const res = makeRes();
  const combined = {
    calls: fake.calls,
    query: (sql, params) => (/FROM live JOIN staff/.test(typeof sql === "string" ? sql : sql.text) ? session.query(sql, params) : fake.query(sql, params)),
    connect: () => fake.connect(),
  };
  await runWithSharedDb(combined, () => contractsHandler(req("POST", { body, headers: { host: "app.example.test" } }), res));
  return res;
}
const queryOf = (url) => Object.fromEntries(new URL(url).searchParams.entries());
async function sentContract({ signers = TWO, order = "sequential" } = {}) {
  const fake = contractsDb(book());
  const created = await viaStaff({ action: "create_draft", client_id: IDS.client, template_id: IDS.template, values: { service: "Credit review" }, signers, signing_order: order }, fake);
  assert.equal(created.statusCode, 200, JSON.stringify(created.body));
  const sent = await viaStaff({ action: "send", id: created.body.contract.id }, fake);
  assert.equal(sent.statusCode, 200, JSON.stringify(sent.body));
  return { fake, id: created.body.contract.id, links: sent.body.links.map((l) => ({ ...l, query: queryOf(l.url) })), contractLink: queryOf(sent.body.link.url) };
}
/** An uploaded two-page PDF with boxes for two signers, sent to both. */
async function sentPaper({ order = "sequential" } = {}) {
  const fake = contractsDb(book());
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  doc.addPage([612, 792]);
  const up = await viaStaff({ action: "upload_template", template_key: "paper-two", name: "Paper Two", filename: "paper.pdf", file: Buffer.from(await doc.save()).toString("base64") }, fake);
  assert.equal(up.statusCode, 200, JSON.stringify(up.body));
  const placed = await viaStaff({ action: "save_fields", id: up.body.template.id, fields: BOXES, signer_roles: [{ label: "Client" }, { label: "Counterparty" }] }, fake);
  assert.equal(placed.statusCode, 200, JSON.stringify(placed.body));
  const created = await viaStaff({ action: "create_draft", client_id: IDS.client, template_id: up.body.template.id, values: {}, signers: TWO, signing_order: order }, fake);
  assert.equal(created.statusCode, 200, JSON.stringify(created.body));
  const sent = await viaStaff({ action: "send", id: created.body.contract.id }, fake);
  assert.equal(sent.statusCode, 200, JSON.stringify(sent.body));
  return { fake, id: created.body.contract.id, links: sent.body.links.map((l) => ({ ...l, query: queryOf(l.url) })), contractLink: queryOf(sent.body.link.url) };
}
async function call(request, fake) {
  const res = makeRes();
  await runWithSharedDb(fake, () => signHandler(request, res));
  return res;
}
const get = (query, fake) => call({ method: "GET", query, headers: {}, body: {} }, fake);
const post = (query, body, fake) => call({ method: "POST", query, headers: { "user-agent": "TestBrowser/1.0" }, body }, fake);

describe("GET /api/contracts/sign: what the signer is told", () => {
  test("a signer sees the other signers' names and states, never their email, and the view is never cached", async () => {
    const { fake, links } = await sentContract();
    const res = await get(links[0].query, fake);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.contract.signers, [
      { role_label: "Client", name: "Dana Whitfield", status: "viewed", signed_at: null },
      { role_label: "Counterparty", name: "Pat Counter", status: "sent", signed_at: null },
    ]);
    const blob = JSON.stringify(res.body);
    assert.equal(blob.includes("pat@example.test"), false, "the other signer's email is not sent");
    assert.equal(blob.includes("dana@example.test"), false, "not even their own: the page does not need it");
    assert.equal(res.headers["cache-control"], "private, no-store");
    assert.equal(res.headers["x-content-type-options"], "nosniff");
    assert.equal(res.body.contract.signer.name, "Dana Whitfield");
  });

  test("a contract-wide link on a contract with two signers does not say who is looking: nothing is shown, recorded or signed", async () => {
    const { fake, id, contractLink } = await sentContract();
    const view = await get(contractLink, fake);
    assert.equal(view.statusCode, 409);
    assert.equal(view.body.error, "signer_required");
    assert.equal(view.body.contract, undefined);
    const row = fake.tables.contracts.find((c) => c.id === id);
    assert.equal(row.view_count ?? 0, 0, "no view was recorded");
    assert.deepEqual(fake.tables.contract_signers.map((s) => s.view_count ?? 0), [0, 0]);
    const signed = await post(contractLink, { signer_name: "Dana Whitfield", agreed: true }, fake);
    assert.equal(signed.statusCode, 409);
    assert.equal(signed.body.error, "signer_required");
    assert.deepEqual(fake.tables.contract_signers.map((s) => s.status === "signed"), [false, false]);
    assert.equal(fake.tables.events.some((e) => e.name === "contract.signed"), false);
  });

  test("on an uploaded PDF a signer is shown only their own boxes, with auto-filled ones locked and valued", async () => {
    const { fake, links } = await sentPaper();
    const first = await get(links[0].query, fake);
    assert.equal(first.statusCode, 200, JSON.stringify(first.body));
    assert.deepEqual(first.body.contract.fields.map((f) => f.id).sort(), ["d_amount", "d_name", "d_sig"]);
    const printed = first.body.contract.fields.find((f) => f.id === "d_name");
    assert.equal(printed.locked, true);
    assert.equal(printed.value, "Dana Whitfield");
    assert.equal(first.body.contract.fields.find((f) => f.id === "d_amount").locked, false);
    assert.equal(first.body.contract.body, null, "a PDF's words are fetched as a file, not inlined");

    // Pat's turn is not yet: sign Dana first, then read Pat's own boxes.
    const dana = await post(links[0].query, { signer_name: "Dana Whitfield", agreed: true, field_values: { d_amount: "$1,200" } }, fake);
    assert.equal(dana.statusCode, 200, JSON.stringify(dana.body));
    const second = await get(links[1].query, fake);
    assert.equal(second.statusCode, 200, JSON.stringify(second.body));
    assert.deepEqual(second.body.contract.fields.map((f) => f.id).sort(), ["p_note", "p_sig"]);
    const blob = JSON.stringify(second.body);
    assert.equal(blob.includes("d_amount") || blob.includes("Fee amount"), false, "Dana's boxes are not sent to Pat");
  });
});

describe("POST /api/contracts/sign: the values and the order", () => {
  test("a required box is asked for, the values typed are kept for that signer only, the typed name fills their signature box", async () => {
    const { fake, id, links } = await sentPaper();
    const missing = await post(links[0].query, { signer_name: "Dana Whitfield", agreed: true, field_values: {} }, fake);
    assert.equal(missing.statusCode, 400);
    assert.equal(missing.body.error, "missing_fields");
    assert.match(missing.body.message, /Fee amount/);
    assert.equal(fake.tables.contract_signers[0].status === "signed", false);

    const ok = await post(links[0].query, {
      signer_name: "  Dana  Whitfield ", agreed: true,
      field_values: { d_amount: "$1,200", p_note: "written by the wrong person", d_name: "overwritten printed name", nope: "x" },
    }, fake);
    assert.equal(ok.statusCode, 200, JSON.stringify(ok.body));
    const dana = fake.tables.contract_signers[0];
    assert.equal(dana.status, "signed");
    assert.equal(dana.field_values.d_amount, "$1,200", "the value typed is kept");
    assert.equal(dana.field_values.d_sig, "Dana Whitfield", "the typed name is the signature");
    assert.equal(dana.field_values.p_note, undefined, "another signer's box is dropped");
    assert.equal(dana.field_values.d_name, undefined, "an auto-filled box cannot be written");
    assert.equal(dana.field_values.nope, undefined);
    assert.equal(fake.tables.contracts.find((c) => c.id === id).status === "signed", false, "Pat has not signed yet");
  });

  test("a parallel contract lets the second signer sign first; the contract completes with the last signature", async () => {
    const { fake, id, links } = await sentContract({ order: "parallel" });
    const second = await post(links[1].query, { signer_name: "Pat Counter", agreed: true }, fake);
    assert.equal(second.statusCode, 200, JSON.stringify(second.body));
    assert.equal(second.body.complete, false);
    assert.equal(fake.tables.contract_signers[1].status, "signed");
    assert.equal(fake.tables.contracts.find((c) => c.id === id).status === "signed", false);
    const first = await post(links[0].query, { signer_name: "Dana Whitfield", agreed: true }, fake);
    assert.equal(first.statusCode, 200);
    assert.equal(first.body.complete, true);
    assert.equal(fake.tables.contracts.find((c) => c.id === id).status, "signed");
  });

  test("a voided contract cannot be signed by POST and nothing is recorded", async () => {
    const { fake, id, links } = await sentContract();
    await viaStaff({ action: "void", id, reason: "Wrong terms" }, fake);
    const res = await post(links[0].query, { signer_name: "Dana Whitfield", agreed: true }, fake);
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.error, "voided");
    assert.equal(fake.tables.contract_signers[0].status === "signed", false);
    assert.equal(fake.tables.contracts.find((c) => c.id === id).status, "void");
    assert.equal(fake.tables.events.some((e) => e.name === "contract.signed"), false);
  });
});

describe("POST /api/contracts/sign: each tamper layer on its own", () => {
  test("words and the row's fingerprint changed together: the document registry's fingerprint still refuses the signature", async () => {
    const { fake, id, links } = await sentContract({ signers: [TWO[0]] });
    const row = fake.tables.contracts.find((c) => c.id === id);
    row.rendered_body += " Also you owe us a million dollars.";
    row.body_sha = bodyHash(row.rendered_body); // the row now agrees with itself
    const res = await post(links[0].query, { signer_name: "Dana Whitfield", agreed: true }, fake);
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.error, "content_changed");
    assert.equal(fake.tables.contract_signers[0].status === "signed", false);
    assert.equal(row.status === "signed", false);
  });

  test("words and the registry untouched but the row's own fingerprint changed: the signature is refused too", async () => {
    const { fake, id, links } = await sentContract({ signers: [TWO[0]] });
    const row = fake.tables.contracts.find((c) => c.id === id);
    row.body_sha = `sha256:${"0".repeat(64)}`;
    const res = await post(links[0].query, { signer_name: "Dana Whitfield", agreed: true }, fake);
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.error, "content_changed");
    assert.equal(fake.tables.contract_signers[0].status === "signed", false);
  });

  test("a contract with no anchor in the registry cannot be checked, so it is refused rather than waved through", async () => {
    const { fake, id, links } = await sentContract({ signers: [TWO[0]] });
    fake.tables.contracts.find((c) => c.id === id).document_version_id = null;
    const res = await post(links[0].query, { signer_name: "Dana Whitfield", agreed: true }, fake);
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.error, "unverifiable");
    assert.equal(fake.tables.contract_signers[0].status === "signed", false);
  });
});
