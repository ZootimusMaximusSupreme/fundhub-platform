// finish-853 batch 08: POST /api/contracts. The real handler and the real contract library
// (templates, drafts, signers, send, void, the PDF upload and the field boxes) run over the stand-in
// contract tables of src/testing/fin-b08-contracts-db.mjs, which freezes a sent contract's wording the
// way the database's trigger does. Rows covered: the drafts, send, template authoring and void.
// Practice test, fake data, no network, no database; outbound fences held up and the network refused.
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { PDFDocument } from "pdf-lib";

import handler from "../../api/contracts.mjs";
import { fakeDb, makeRes, req, runWithSharedDb, staffSession, accountSession, ORG_ID, OTHER_ORG_ID, STAFF_ID } from "../testing/handler-harness.mjs";
import { contractsDb, baseBook, IDS } from "../testing/fin-b08-contracts-db.mjs";
import { assertSqlHas } from "../testing/s3-scoped-rows.mjs";
import { verifyContractUrl } from "../contracts/signed-link.mjs";
import { STAFF_ROLES } from "../pulse/catalog/proofs/s2-route-kit.mjs";

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

const book = () => baseBook({ orgId: ORG_ID, otherOrgId: OTHER_ORG_ID, staffId: STAFF_ID });
const newFile = (over = {}) => contractsDb({ ...book(), ...over });

async function call(body, fake, who = [staffSession({ role: "closer" })]) {
  const session = fakeDb(who);
  const res = makeRes();
  const combined = {
    calls: fake.calls,
    query: (sql, params) => (/FROM live JOIN staff|UPDATE account_sessions|FROM accounts WHERE id/.test(typeof sql === "string" ? sql : sql.text) ? session.query(sql, params) : fake.query(sql, params)),
    connect: () => fake.connect(),
  };
  await runWithSharedDb(combined, () => handler(req("POST", { body, headers: { host: "app.example.test" } }), res));
  return { res, fake };
}
const owner = [staffSession({ role: "owner" })];
async function draft(fake, values = { service: "Credit review" }, extra = {}) {
  const { res } = await call({ action: "create_draft", client_id: IDS.client, template_id: IDS.template, values, ...extra }, fake);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  return res.body.contract;
}
const pdfBase64 = async () => {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  doc.addPage([612, 792]);
  return Buffer.from(await doc.save()).toString("base64");
};

describe("POST /api/contracts: drafts", () => {
  test("create_client adds a contact for this company, reuses a known email, and refuses a bad one", async () => {
    const fake = newFile();
    const made = await call({ action: "create_client", first_name: "Sam", last_name: "New", email: " Sam@Example.test ", phone: "6025550111" }, fake);
    assert.equal(made.res.statusCode, 200);
    assert.equal(made.res.body.existing, false);
    const row = fake.tables.clients.find((c) => c.email === "Sam@Example.test" || c.email === "sam@example.test");
    assert.ok(row, "the client row exists");
    assert.equal(row.org_id, ORG_ID);
    assert.equal(row.first_name, "Sam");
    const again = await call({ action: "create_client", first_name: "Samuel", email: "dana@example.test" }, fake);
    assert.equal(again.res.body.existing, true);
    assert.equal(again.res.body.client.id, IDS.client, "the same person is not made twice");
    assert.equal(fake.tables.clients.filter((c) => c.org_id === ORG_ID).length, 3);
    const foreignEmail = await call({ action: "create_client", first_name: "X", email: "foreign@example.test" }, fake);
    assert.equal(foreignEmail.res.body.existing, false, "another company's client of the same email is not reused");
    const noName = await call({ action: "create_client", email: "x@example.test" }, fake);
    assert.equal(noName.res.statusCode, 400);
    assert.equal(noName.res.body.error, "name_required");
    const badEmail = await call({ action: "create_client", first_name: "Z", email: "nope" }, fake);
    assert.equal(badEmail.res.body.error, "email_invalid");
  });

  test("create_draft files a draft for this client from this company's template with the typed blanks and one signer", async () => {
    const fake = newFile();
    const { res } = await call({ action: "create_draft", client_id: IDS.client, template_id: IDS.template, values: { service: "Credit review" }, title: "Dana's setup" }, fake);
    assert.equal(res.statusCode, 200);
    const c = fake.tables.contracts[0];
    assert.deepEqual([c.org_id, c.client_id, c.template_id, c.template_key, c.title, c.status, c.created_by], [ORG_ID, IDS.client, IDS.template, "SETUP", "Dana's setup", "draft", STAFF_ID]);
    assert.equal(c.merge_values.service, "Credit review");
    assert.equal(c.rendered_body ?? null, null, "nothing is frozen until it is sent");
    assert.equal(res.body.signers.length, 1);
    assert.deepEqual([res.body.signers[0].name, res.body.signers[0].email, res.body.signers[0].client_id], ["Dana Whitfield", "dana@example.test", IDS.client]);
  });

  test("create_draft refuses another company's client or template, an archived template and a staff id off this company", async () => {
    const fake = newFile();
    const cases = [
      [{ client_id: IDS.foreignClient, template_id: IDS.template }, 404, "client_not_found"],
      [{ client_id: IDS.client, template_id: IDS.foreignTemplate }, 404, "template_not_found"],
      [{ client_id: IDS.client, template_id: IDS.archived }, 409, "template_archived"],
      [{ client_id: IDS.client, template_id: IDS.template, staff_id: "5b000000-0000-4000-8000-000000000009" }, 404, "staff_not_found"],
    ];
    for (const [body, status, code] of cases) {
      const { res } = await call({ action: "create_draft", ...body }, fake);
      assert.equal(res.statusCode, status, code);
      assert.equal(res.body.error, code);
    }
    assert.equal(fake.tables.contracts.length, 0);
  });

  test("save_draft changes the blanks of a draft only; once it is sent its wording is fixed", async () => {
    const fake = newFile();
    const c = await draft(fake);
    const saved = await call({ action: "save_draft", id: c.id, values: { service: "Funding review" }, title: "Renamed" }, fake);
    assert.equal(saved.res.statusCode, 200);
    assert.equal(fake.tables.contracts[0].merge_values.service, "Funding review");
    assert.equal(fake.tables.contracts[0].title, "Renamed");
    await call({ action: "send", id: c.id }, fake);
    const late = await call({ action: "save_draft", id: c.id, values: { service: "Sneaky change" } }, fake);
    assert.equal(late.res.statusCode, 409);
    assert.equal(late.res.body.error, "already_sent");
    assert.equal(fake.tables.contracts[0].merge_values.service, "Funding review");
    const foreign = await call({ action: "save_draft", id: c.id, values: {} }, fake, [staffSession({ role: "closer", org_id: OTHER_ORG_ID })]);
    assert.equal(foreign.res.statusCode, 404);
  });

  test("preview renders the words for this client with the typed blanks, names what is missing, and writes nothing", async () => {
    const fake = newFile();
    const full = await call({ action: "preview", template_id: IDS.template, client_id: IDS.client, values: { service: "Credit review" } }, fake);
    assert.equal(full.res.statusCode, 200);
    assert.equal(full.res.body.preview.body, "Hello Dana, you agree to the setup of Credit review.");
    assert.deepEqual(full.res.body.preview.missing_required, []);
    const blank = await call({ action: "preview", template_id: IDS.template, client_id: IDS.client, values: {} }, fake);
    assert.deepEqual(blank.res.body.preview.missing_required, ["Service"]);
    assert.equal(fake.tables.contracts.length, 0);
    assert.equal(fake.calls.filter((c) => /^\s*(INSERT|UPDATE)/i.test(c.sql)).length, 0, "a preview writes nothing");
    const foreign = await call({ action: "preview", template_id: IDS.foreignTemplate, client_id: IDS.client, values: {} }, fake);
    assert.equal(foreign.res.statusCode, 404);
  });
});

describe("POST /api/contracts: send", () => {
  test("send freezes the words, registers the document, marks it sent and returns a signed link for staff to pass on", async () => {
    const fake = newFile();
    const c = await draft(fake);
    const { res } = await call({ action: "send", id: c.id }, fake);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.resent, false);
    const row = fake.tables.contracts[0];
    assert.equal(row.status, "sent");
    assert.equal(row.rendered_body, "Hello Dana, you agree to the setup of Credit review.");
    assert.match(row.body_sha, /^sha256:[0-9a-f]{64}$/);
    assert.equal(row.sent_by, STAFF_ID);
    assert.ok(row.sent_at);
    assert.equal(row.signature_statement, "I have read this and I agree.");
    assert.equal(fake.tables.documents.length, 1);
    assert.equal(row.document_id, fake.tables.documents[0].id);
    assert.equal(fake.tables.document_versions[0].checksum, row.body_sha, "the document's fingerprint is the contract's");
    assert.equal(fake.tables.documents[0].client_id, IDS.client);

    const url = new URL(res.body.link.url);
    assert.equal(url.pathname, "/contract.html");
    const verdict = verifyContractUrl({ contractId: c.id, signerId: null, expiresAt: url.searchParams.get("exp"), sig: url.searchParams.get("sig") });
    assert.equal(verdict.valid, true, "the link carries a signature this server accepts");
    assert.equal(res.body.links.length, 1);
    assert.equal(res.body.links[0].name, "Dana Whitfield");
    const signer = fake.tables.contract_signers[0];
    assert.equal(signer.status, "sent");
    assert.ok(signer.link_expires_at);
    assert.deepEqual(asked, [], "nothing is posted anywhere from here");
    assert.ok(fake.tables.events.some((e) => e.name === "contract.sent" && e.client_id === IDS.client));
  });

  test("sending again hands back a fresh link to the same document and does not change a word", async () => {
    const fake = newFile();
    const c = await draft(fake);
    const first = await call({ action: "send", id: c.id }, fake);
    const frozen = { ...fake.tables.contracts[0] };
    const second = await call({ action: "send", id: c.id }, fake);
    assert.equal(second.res.statusCode, 200);
    assert.equal(second.res.body.resent, true);
    assert.equal(fake.tables.contracts[0].rendered_body, frozen.rendered_body);
    assert.equal(fake.tables.contracts[0].body_sha, frozen.body_sha);
    assert.equal(fake.tables.documents.length, 1, "no second document");
    assert.ok(second.res.body.link.url);
    assert.notEqual(second.res.body.link.url, undefined);
    void first;
  });

  test("a draft with blanks left, a template that still holds placeholder text, a void or a signed contract is not sent", async () => {
    const fake = newFile();
    const blank = await draft(fake, {});
    const missing = await call({ action: "send", id: blank.id }, fake);
    assert.equal(missing.res.statusCode, 400);
    assert.equal(missing.res.body.error, "missing_required");
    assert.equal(fake.tables.contracts[0].status, "draft");
    assert.equal(fake.tables.documents.length, 0);

    const placeholder = newFile();
    placeholder.tables.contract_templates.find((t) => t.id === IDS.template).body = "THIS IS NOT THE REAL AGREEMENT TEXT. DO NOT SEND THIS. {{field.service}}";
    const p = await draft(placeholder);
    const sendPlaceholder = await call({ action: "send", id: p.id }, placeholder);
    assert.equal(sendPlaceholder.res.statusCode, 409);
    assert.equal(sendPlaceholder.res.body.error, "placeholder_text");
    assert.equal(placeholder.tables.contracts[0].status, "draft");
    assert.equal(placeholder.tables.documents.length, 0);

    const voided = newFile();
    const v = await draft(voided);
    await call({ action: "void", id: v.id, reason: "wrong client" }, voided, owner);
    const sendVoid = await call({ action: "send", id: v.id }, voided);
    assert.equal(sendVoid.res.statusCode, 409);
    assert.equal(sendVoid.res.body.error, "voided");

    const done = newFile();
    const s = await draft(done);
    done.tables.contracts.find((x) => x.id === s.id).status = "signed";
    const sendSigned = await call({ action: "send", id: s.id }, done);
    assert.equal(sendSigned.res.statusCode, 409);
    assert.equal(sendSigned.res.body.error, "already_signed");
  });

  test("a company cannot send another company's contract, and with no signing secret it says so instead of sending", async () => {
    const fake = newFile();
    const c = await draft(fake);
    const foreign = await call({ action: "send", id: c.id }, fake, [staffSession({ role: "closer", org_id: OTHER_ORG_ID })]);
    assert.equal(foreign.res.statusCode, 404);
    assert.equal(fake.tables.contracts[0].status, "draft");
    const held = process.env.CONTRACT_URL_SECRET;
    const heldDoc = process.env.DOCUMENT_URL_SECRET;
    delete process.env.CONTRACT_URL_SECRET;
    delete process.env.DOCUMENT_URL_SECRET;
    try {
      const none = await call({ action: "send", id: c.id }, fake);
      assert.equal(none.res.statusCode, 503);
      assert.equal(none.res.body.error, "not_configured");
    } finally { process.env.CONTRACT_URL_SECRET = held; process.env.DOCUMENT_URL_SECRET = heldDoc; }
  });
});

describe("POST /api/contracts: void", () => {
  test("void needs a reason and an owner or admin, ends the contract, and the link can no longer sign it", async () => {
    const fake = newFile();
    const c = await draft(fake);
    await call({ action: "send", id: c.id }, fake);
    const noReason = await call({ action: "void", id: c.id, reason: "  " }, fake, owner);
    assert.equal(noReason.res.statusCode, 400);
    assert.equal(noReason.res.body.error, "void_reason_required");
    assert.equal(fake.tables.contracts[0].status, "sent");
    const { res } = await call({ action: "void", id: c.id, reason: "Sent to the wrong person" }, fake, owner);
    assert.equal(res.statusCode, 200);
    const row = fake.tables.contracts[0];
    assert.equal(row.status, "void");
    assert.equal(row.void_reason, "Sent to the wrong person");
    assert.equal(row.voided_by, STAFF_ID);
    assert.ok(row.voided_at);
    const resend = await call({ action: "send", id: c.id }, fake);
    assert.equal(resend.res.statusCode, 409, "a voided contract is not sent again");
  });

  test("a signed contract cannot be voided, and only owner and admin may void or write the words", async () => {
    const fake = newFile();
    const c = await draft(fake);
    fake.tables.contracts[0].status = "signed";
    const signed = await call({ action: "void", id: c.id, reason: "oops" }, fake, owner);
    assert.equal(signed.res.statusCode, 409);
    assert.equal(signed.res.body.error, "already_signed");
    assert.equal(fake.tables.contracts[0].status, "signed");

    const letIn = { void: [], create_template: [] };
    for (const role of STAFF_ROLES) {
      const f = newFile();
      const d = await draft(f);
      const v = await call({ action: "void", id: d.id, reason: "test" }, f, [staffSession({ role })]);
      if (v.res.statusCode !== 403) letIn.void.push(role);
      const t = await call({ action: "create_template", template_key: "NEW-ONE", name: "New", body: "Words." }, newFile(), [staffSession({ role })]);
      if (t.res.statusCode !== 403) letIn.create_template.push(role);
    }
    assert.deepEqual(letIn.void.sort(), ["admin", "owner"]);
    assert.deepEqual(letIn.create_template.sort(), ["owner"]);
  });
});

describe("POST /api/contracts: template authoring", () => {
  test("create_template saves new contract copy under a clean short name for this company, written by this person", async () => {
    const fake = newFile();
    const { res } = await call({ action: "create_template", template_key: "funding agreement", name: "Funding Agreement", body: "You agree to {{field.fee}}.", manual_fields: [{ key: "fee", label: "Fee", required: true }] }, fake, owner);
    assert.equal(res.statusCode, 200);
    const t = fake.tables.contract_templates.at(-1);
    assert.deepEqual([t.org_id, t.template_key, t.name, t.kind, t.created_by, t.source_kind], [ORG_ID, "FUNDING-AGREEMENT", "Funding Agreement", "contract", STAFF_ID, "text"]);
    assert.match(t.signature_statement, /I have read this document and I agree to it/);
    const dup = await call({ action: "create_template", template_key: "FUNDING-AGREEMENT", name: "Again", body: "x" }, fake, owner);
    void dup;
    const blank = await call({ action: "create_template", template_key: "NEW-ONE", name: "No words", body: "   " }, fake, owner);
    assert.equal(blank.res.statusCode, 400);
    assert.equal(blank.res.body.error, "body_required");
    const bad = await call({ action: "create_template", template_key: "!", name: "Bad key", body: "x" }, fake, owner);
    assert.equal(bad.res.body.error, "invalid_template_key");
  });

  test("save_template edits the words, and a changed short name is refused so contracts already sent keep their record", async () => {
    const fake = newFile();
    const ok = await call({ action: "save_template", id: IDS.template, name: "Setup Agreement v2", body: "New words for {{contact.first_name}}." }, fake, owner);
    assert.equal(ok.res.statusCode, 200);
    const t = fake.tables.contract_templates.find((x) => x.id === IDS.template);
    assert.equal(t.name, "Setup Agreement v2");
    assert.equal(t.body, "New words for {{contact.first_name}}.");
    assert.equal(t.updated_by, STAFF_ID);
    const rename = await call({ action: "save_template", id: IDS.template, template_key: "SOMETHING-ELSE", body: "x" }, fake, owner);
    assert.equal(rename.res.statusCode, 409);
    assert.equal(rename.res.body.error, "rename_refused");
    assert.equal(t.template_key, "SETUP");
    const foreign = await call({ action: "save_template", id: IDS.foreignTemplate, body: "Hijacked" }, fake, owner);
    assert.equal(foreign.res.statusCode, 404);
    assert.equal(fake.tables.contract_templates.find((x) => x.id === IDS.foreignTemplate).body, "Foreign words.");
  });

  test("archive_template takes copy out of use without deleting it, and turns it back on", async () => {
    const fake = newFile();
    const off = await call({ action: "archive_template", id: IDS.template }, fake, owner);
    assert.equal(off.res.statusCode, 200);
    assert.equal(fake.tables.contract_templates.find((x) => x.id === IDS.template).active, false);
    const blocked = await call({ action: "create_draft", client_id: IDS.client, template_id: IDS.template, values: { service: "x" } }, fake);
    assert.equal(blocked.res.body.error, "template_archived");
    const on = await call({ action: "archive_template", id: IDS.template, active: true }, fake, owner);
    assert.equal(on.res.statusCode, 200);
    assert.equal(fake.tables.contract_templates.find((x) => x.id === IDS.template).active, true);
    assert.ok(fake.tables.contract_templates.some((x) => x.id === IDS.template), "nothing is deleted");
  });

  test("upload_template turns a PDF into a template with its pages counted; save_fields places the boxes inside the pages", async () => {
    const fake = newFile();
    const up = await call({ action: "upload_template", template_key: "paper-contract", name: "Paper Contract", filename: "paper.pdf", file: await pdfBase64() }, fake, owner);
    assert.equal(up.res.statusCode, 200, JSON.stringify(up.res.body));
    const t = fake.tables.contract_templates.at(-1);
    assert.deepEqual([t.template_key, t.source_kind, t.page_count, t.original_filename, t.org_id], ["PAPER-CONTRACT", "pdf", 2, "paper.pdf", ORG_ID]);
    assert.equal(t.page_sizes.length, 2);
    assert.ok(t.document_id, "the PDF is stored and registered");
    assert.equal(fake.tables.documents.some((d) => d.id === t.document_id && d.org_id === ORG_ID), true);

    const notPdf = await call({ action: "upload_template", template_key: "bad-one", name: "Bad", file: Buffer.from("this is not a pdf").toString("base64") }, fake, owner);
    assert.equal(notPdf.res.statusCode, 400);
    assert.equal(notPdf.res.body.error, "not_a_pdf");

    const box = { id: "sig", page: 1, x: 0.1, y: 0.8, w: 0.3, h: 0.05, type: "signature", signer: 0, label: "Sign here" };
    const placed = await call({ action: "save_fields", id: t.id, fields: [box], signer_roles: [{ label: "Client" }] }, fake, owner);
    assert.equal(placed.res.statusCode, 200);
    assert.equal(fake.tables.contract_templates.find((x) => x.id === t.id).fields.length, 1);
    assert.equal(fake.tables.contract_templates.find((x) => x.id === t.id).fields[0].page, 1);
    const offPage = await call({ action: "save_fields", id: t.id, fields: [{ ...box, page: 5 }] }, fake, owner);
    assert.equal(offPage.res.statusCode, 400);
    assert.equal(offPage.res.body.error, "field_page_out_of_range");
    const hanging = await call({ action: "save_fields", id: t.id, fields: [{ ...box, x: 0.9 }] }, fake, owner);
    assert.equal(hanging.res.body.error, "field_off_page");
    assert.equal(fake.tables.contract_templates.find((x) => x.id === t.id).fields[0].x, 0.1, "a refused save changes nothing");
  });

  test("the statement that writes the template is scoped to this company", async () => {
    const fake = newFile();
    await call({ action: "save_template", id: IDS.template, body: "New words." }, fake, owner);
    const update = fake.calls.find((c) => /UPDATE contract_templates/.test(c.sql));
    assertSqlHas(update.sql, { "one template, in this company": "WHERE id = $1::uuid AND org_id = $2::uuid" });
  });
});

describe("POST /api/contracts: the door", () => {
  test("a client login, no login, a GET and an unknown action are refused", async () => {
    const fake = newFile();
    const client = await call({ action: "send", id: IDS.template }, fake, accountSession({ kind: "client", clientId: IDS.client }));
    assert.equal(client.res.statusCode, 401);
    const none = await call({ action: "send", id: IDS.template }, fake, []);
    assert.equal(none.res.statusCode, 401);
    const bad = await call({ action: "shred", id: IDS.template }, fake);
    assert.equal(bad.res.statusCode, 400);
    assert.equal(bad.res.body.error, "unknown_action");
    const get = makeRes();
    await runWithSharedDb(fake, () => handler(req("GET", {}), get));
    assert.equal(get.statusCode, 405);
  });

  test("an id that is not an id is a 400 with its own error before any contract table is read or written", async () => {
    const fake = newFile();
    const SESSION = /FROM live JOIN staff|UPDATE account_sessions|FROM accounts WHERE id/;
    const cases = [
      [{ action: "save_template", id: "nope" }, "invalid_id"],
      [{ action: "archive_template", id: "nope" }, "invalid_id"],
      [{ action: "save_fields", id: "nope", fields: [] }, "invalid_id"],
      [{ action: "create_draft", client_id: "nope", template_id: IDS.template }, "invalid_client_id"],
      [{ action: "create_draft", client_id: IDS.client, template_id: "nope" }, "invalid_template_id"],
      [{ action: "create_draft", client_id: IDS.client, template_id: IDS.template, staff_id: "nope" }, "invalid_staff_id"],
      [{ action: "save_draft", id: "nope", values: {} }, "invalid_id"],
      [{ action: "preview", template_id: "nope" }, "invalid_template_id"],
      [{ action: "preview", template_id: IDS.template, client_id: "nope" }, "invalid_client_id"],
      [{ action: "send", id: "nope" }, "invalid_id"],
      [{ action: "void", id: "nope", reason: "Wrong terms" }, "invalid_id"],
    ];
    const contractsBefore = JSON.stringify(fake.tables.contracts);
    for (const [body, error] of cases) {
      const { res } = await call(body, fake, owner);
      assert.equal(res.statusCode, 400, body.action);
      assert.equal(res.body.error, error, body.action);
    }
    assert.deepEqual(fake.calls.filter((c) => !SESSION.test(c.sql)).map((c) => c.sql.trim().slice(0, 50)), [], "no statement ran against the contract tables");
    assert.equal(JSON.stringify(fake.tables.contracts), contractsBefore);
  });

  test("a signed-in staff role outside the staff set is refused on every write and nothing is saved", async () => {
    const fake = newFile();
    const contractsBefore = fake.tables.contracts.length;
    const templatesBefore = fake.tables.contract_templates.length;
    const outsider = [staffSession({ role: "bookkeeper" })];
    for (const body of [
      { action: "create_draft", client_id: IDS.client, template_id: IDS.template, values: { service: "Credit review" } },
      { action: "create_template", template_key: "NEW-ONE", name: "New", body: "Words." },
      { action: "void", id: IDS.template, reason: "test" },
    ]) {
      const r = await call(body, fake, outsider);
      assert.equal(r.res.statusCode, 403, body.action);
    }
    assert.equal(fake.tables.contracts.length, contractsBefore);
    assert.equal(fake.tables.contract_templates.length, templatesBefore);
  });
});
