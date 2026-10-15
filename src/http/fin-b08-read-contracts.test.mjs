// finish-853 batch 08: GET /api/read/contracts. The real handler and the real contract library run
// over the stand-in contract tables of src/testing/fin-b08-contracts-db.mjs. The row's words:
// ?view=templates|contracts, ?id= (one contract with frozen wording, integrity, signers), ?file=
// template|contract (PDF bytes). Practice test, fake data, no network, no database.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { PDFDocument } from "pdf-lib";

import contractsHandler from "../../api/contracts.mjs";
import readHandler from "../../api/read/contracts.mjs";
import signHandler from "../../api/contracts/sign.mjs";
import { fakeDb, makeRes, req, runWithSharedDb, staffSession, accountSession, ORG_ID, OTHER_ORG_ID, STAFF_ID } from "../testing/handler-harness.mjs";
import { contractsDb, baseBook, IDS } from "../testing/fin-b08-contracts-db.mjs";
import { STAFF_ROLES } from "../pulse/catalog/proofs/s2-route-kit.mjs";

const KEYS = ["CONTRACT_URL_SECRET", "DOCUMENT_URL_SECRET", "MESSAGING_DRY_RUN", "ADAPTERS_DRY_RUN", "INNGEST_EVENT_KEY", "DOCUMENT_STORE_PROVIDER"];
const saved = {};
before(() => {
  for (const k of KEYS) saved[k] = process.env[k];
  process.env.CONTRACT_URL_SECRET = crypto.randomBytes(24).toString("hex");
  process.env.DOCUMENT_URL_SECRET = crypto.randomBytes(24).toString("hex");
  process.env.MESSAGING_DRY_RUN = "1";
  process.env.ADAPTERS_DRY_RUN = "1";
  delete process.env.INNGEST_EVENT_KEY;
  delete process.env.DOCUMENT_STORE_PROVIDER;
});
after(() => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

const staffOwner = [staffSession({ role: "owner" })];
function wrap(fake, who) {
  const session = fakeDb(who);
  return {
    calls: fake.calls,
    query: (sql, params) => (/FROM live JOIN staff|UPDATE account_sessions|FROM accounts WHERE id/.test(typeof sql === "string" ? sql : sql.text) ? session.query(sql, params) : fake.query(sql, params)),
    connect: () => fake.connect(),
  };
}
async function staffPost(body, fake) {
  const res = makeRes();
  await runWithSharedDb(wrap(fake, staffOwner), () => contractsHandler(req("POST", { body, headers: { host: "app.example.test" } }), res));
  return res;
}
async function read(query, fake, who = [staffSession({ role: "closer" })]) {
  const res = makeRes();
  await runWithSharedDb(wrap(fake, who), () => readHandler(req("GET", { query }), res));
  return res;
}
async function library() {
  const fake = contractsDb(baseBook({ orgId: ORG_ID, otherOrgId: OTHER_ORG_ID, staffId: STAFF_ID }));
  const a = await staffPost({ action: "create_draft", client_id: IDS.client, template_id: IDS.template, values: { service: "Credit review" } }, fake);
  const b = await staffPost({ action: "create_draft", client_id: IDS.otherClient, template_id: IDS.template, values: { service: "Funding review" } }, fake);
  await staffPost({ action: "send", id: a.body.contract.id }, fake);
  // Another company's contract, in the same table.
  fake.tables.contracts.push({ id: "f9000000-0000-4000-8000-000000000009", org_id: OTHER_ORG_ID, client_id: IDS.foreignClient, template_id: IDS.foreignTemplate, template_key: "FOREIGN", title: "Foreign contract", status: "sent", created_at: "2099-01-01T00:00:00Z", rendered_body: "Foreign words.", fields: [], merge_values: {} });
  return { fake, sent: a.body.contract, draft: b.body.contract };
}

describe("GET /api/read/contracts", () => {
  test("view=contracts lists this company's contracts only, with the client's name and who sent them, and narrows by status and client", async () => {
    const { fake, sent, draft } = await library();
    const all = await read({ view: "contracts" }, fake);
    assert.equal(all.statusCode, 200);
    assert.equal(all.body.view, "contracts");
    assert.deepEqual(all.body.items.map((i) => i.id).sort(), [sent.id, draft.id].sort(), "the other company's contract is not listed");
    const row = all.body.items.find((i) => i.id === sent.id);
    assert.deepEqual([row.first_name, row.last_name, row.status, row.sent_by_name], ["Dana", "Whitfield", "sent", "Olive Owner"]);
    const listSql = fake.calls.find((c) => /FROM contracts c\s+JOIN clients cl/.test(c.sql)).sql;
    assert.doesNotMatch(listSql, /rendered_body/, "the list statement leaves the long wording out");
    const drafts = await read({ view: "contracts", status: "draft" }, fake);
    assert.deepEqual(drafts.body.items.map((i) => i.id), [draft.id]);
    const byClient = await read({ client_id: IDS.client }, fake);
    assert.deepEqual(byClient.body.items.map((i) => i.id), [sent.id]);
    assert.equal((await read({ client_id: "nope" }, fake)).statusCode, 400);
  });

  test("view=templates lists this company's templates with their blanks, and active_only leaves the archived ones out", async () => {
    const { fake } = await library();
    const res = await read({ view: "templates" }, fake);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.items.map((t) => t.template_key).sort(), ["OLD-ONE", "SETUP"]);
    const setup = res.body.items.find((t) => t.template_key === "SETUP");
    assert.deepEqual(setup.manual_fields.map((f) => [f.key, f.required]), [["service", true]]);
    const active = await read({ view: "templates", active_only: "1" }, fake);
    assert.deepEqual(active.body.items.map((t) => t.template_key), ["SETUP"]);
  });

  test("?id= gives one contract with its frozen wording, the integrity verdict, the signers and who is waited on", async () => {
    const { fake, sent } = await library();
    const res = await read({ id: sent.id }, fake);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.contract.rendered_body, "Hello Dana, you agree to the setup of Credit review.");
    assert.deepEqual(res.body.integrity, { ok: true, reason: null });
    assert.equal(res.body.signers.length, 1);
    assert.equal(res.body.signers[0].name, "Dana Whitfield");
    assert.deepEqual(res.body.waiting_on, { name: "Dana Whitfield", role: "Client", remaining: 1 });
    assert.deepEqual(res.body.manual_fields.map((f) => f.key), ["service"]);
    assert.ok(res.body.copy_hash);
    fake.tables.contracts.find((c) => c.id === sent.id).rendered_body += " Quietly added.";
    const tampered = await read({ id: sent.id }, fake);
    assert.equal(tampered.body.integrity.ok, false);
    assert.equal(tampered.body.integrity.reason, "content_changed");
  });

  test("a contract or template of another company is 404, and a bad id is 400", async () => {
    const { fake } = await library();
    const foreignContract = await read({ id: "f9000000-0000-4000-8000-000000000009" }, fake);
    assert.equal(foreignContract.statusCode, 404);
    assert.equal(foreignContract.body.error, "not_found");
    const foreignFile = await read({ file: "contract", id: "f9000000-0000-4000-8000-000000000009" }, fake);
    assert.equal(foreignFile.statusCode, 404);
    assert.equal(foreignFile.body.error, "not_found", "another company's contract is 'not found', not 'no file'");
    assert.equal(foreignFile.body.pdf_base64, undefined);
    const foreignTemplate = await read({ file: "template", template_id: IDS.foreignTemplate }, fake);
    assert.equal(foreignTemplate.statusCode, 404);
    assert.equal(foreignTemplate.body.error, "not_found", "another company's template is 'not found', not 'no file'");
    assert.equal(foreignTemplate.body.pdf_base64, undefined);
    assert.equal((await read({ id: "nope" }, fake)).statusCode, 400);
    assert.equal((await read({ file: "template", template_id: "nope" }, fake)).statusCode, 400);
    const badFile = await read({ file: "contract", id: "nope" }, fake);
    assert.deepEqual([badFile.statusCode, badFile.body.error], [400, "invalid_id"]);
  });

  test("the queue's filters must be real: a client, staff or document id that is not an id, or more than 200 documents, is 400 and no list is read", async () => {
    const { fake } = await library();
    const listReads = () => fake.calls.filter((c) => /FROM contracts c\s+JOIN clients cl/.test(c.sql)).length;
    const before = listReads();
    const cases = [
      [{ client_id: "nope" }, "invalid_client_id"],
      [{ staff_id: "nope" }, "invalid_staff_id"],
      [{ document_id: "nope" }, "invalid_document_id"],
      [{ document_id: `${IDS.client},nope` }, "invalid_document_id"],
      [{ document_id: Array.from({ length: 201 }, (_, i) => `d${String(i).padStart(7, "0")}-0000-4000-8000-000000000000`).join(",") }, "invalid_document_id"],
    ];
    for (const [query, error] of cases) {
      const res = await read(query, fake);
      assert.equal(res.statusCode, 400, JSON.stringify(query).slice(0, 60));
      assert.equal(res.body.error, error);
    }
    assert.equal(listReads(), before, "no list was read for a bad filter");
  });

  test("?file=contract returns the sent document as PDF bytes; ?file=template returns an uploaded template's PDF", async () => {
    const { fake, sent } = await library();
    const contract = await read({ file: "contract", id: sent.id }, fake);
    assert.equal(contract.statusCode, 200);
    assert.equal(contract.body.signed, false);
    assert.equal(Buffer.from(contract.body.pdf_base64, "base64").subarray(0, 5).toString(), "%PDF-");
    assert.equal(contract.headers["cache-control"], "private, no-store");

    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    const up = await staffPost({ action: "upload_template", template_key: "paper-one", name: "Paper One", filename: "paper.pdf", file: Buffer.from(await doc.save()).toString("base64") }, fake);
    assert.equal(up.statusCode, 200);
    const template = await read({ file: "template", template_id: up.body.template.id }, fake);
    assert.equal(template.statusCode, 200);
    assert.equal(template.body.filename, "paper.pdf");
    assert.equal(template.body.page_count, 1);
    assert.equal(Buffer.from(template.body.pdf_base64, "base64").subarray(0, 5).toString(), "%PDF-");
    const textTemplate = await read({ file: "template", template_id: IDS.template }, fake);
    assert.equal(textTemplate.statusCode, 404, "a typed template has no file");
    assert.equal(textTemplate.body.error, "no_file");
  });

  test("every staff role may read; a client login, a white-label partner staff row and no login are refused; only GET is served", async () => {
    const { fake } = await library();
    for (const role of STAFF_ROLES) assert.equal((await read({ view: "templates" }, fake, [staffSession({ role })])).statusCode, 200, role);
    assert.equal((await read({ view: "templates" }, fake, [staffSession({ role: "partner" })])).statusCode, 403);
    assert.equal((await read({ view: "templates" }, fake, accountSession({ kind: "client", clientId: IDS.client }))).statusCode, 401);
    assert.equal((await read({ view: "templates" }, fake, [])).statusCode, 401);
    const noOrg = await read({ view: "templates" }, fake, [staffSession({ role: "closer", org_id: null })]);
    assert.equal(noOrg.statusCode, 400);
    assert.equal(noOrg.body.error, "org_required");
    const post = makeRes();
    await runWithSharedDb(wrap(fake, staffOwner), () => readHandler(req("POST", { body: {} }), post));
    assert.equal(post.statusCode, 405);
  });

  // ── the queue, read by the statement's own text ───────────────────────────────────────────────

  async function signedLibrary() {
    const fake = contractsDb(baseBook({ orgId: ORG_ID, otherOrgId: OTHER_ORG_ID, staffId: STAFF_ID }));
    const mint = async (client, values, extra = {}) => {
      const r = await staffPost({ action: "create_draft", client_id: client, template_id: IDS.template, values, ...extra }, fake);
      assert.equal(r.statusCode, 200, JSON.stringify(r.body));
      return r.body.contract;
    };
    const oldest = await mint(IDS.client, { service: "Oldest" });
    const middle = await mint(IDS.otherClient, { service: "Middle" }, { staff_id: STAFF_ID });
    const newest = await mint(IDS.client, { service: "Newest" });
    const send = async (c) => {
      const r = await staffPost({ action: "send", id: c.id }, fake);
      assert.equal(r.statusCode, 200, JSON.stringify(r.body));
      return r.body;
    };
    const sentOldest = await send(oldest);
    const sentMiddle = await send(middle);
    // Sign the middle one through its own link: it becomes a signed contract with a signed copy.
    const q = Object.fromEntries(new URL(sentMiddle.links[0].url).searchParams.entries());
    const signRes = makeRes();
    await runWithSharedDb(fake, () => signHandler({ method: "POST", query: q, headers: {}, body: { signer_name: "Pat Counter", agreed: true } }, signRes));
    assert.equal(signRes.statusCode, 200, JSON.stringify(signRes.body));
    return { fake, oldest, middle, newest, sentOldest, sentMiddle };
  }
  const ids = (res) => res.body.items.map((i) => i.id);

  test("the queue is newest first, a draft with no sender is still listed, and the limit keeps the newest", async () => {
    const { fake, oldest, middle, newest } = await signedLibrary();
    const all = await read({ view: "contracts" }, fake);
    assert.equal(all.statusCode, 200);
    assert.deepEqual(ids(all), [newest.id, middle.id, oldest.id], "newest first");
    const draftRow = all.body.items.find((i) => i.id === newest.id);
    assert.equal(draftRow.status, "draft");
    assert.equal(draftRow.sent_by_name, null, "a draft has no sender and is still on the queue");
    assert.equal(all.body.items.find((i) => i.id === oldest.id).sent_by_name, "Olive Owner");
    const two = await read({ view: "contracts", limit: "2" }, fake);
    assert.deepEqual(ids(two), [newest.id, middle.id]);
    assert.equal(two.body.count, 2);
  });

  test("the status filter reaches signed, and the staff and document filters narrow to the contracts they name", async () => {
    const { fake, oldest, middle, newest, sentOldest } = await signedLibrary();
    const signed = await read({ view: "contracts", status: "signed" }, fake);
    assert.deepEqual(ids(signed), [middle.id], "only the signed contract");
    assert.equal(signed.body.items[0].status, "signed");
    const sent = await read({ view: "contracts", status: "sent" }, fake);
    assert.deepEqual(ids(sent), [oldest.id]);
    const unknownStatus = await read({ view: "contracts", status: "nonsense" }, fake);
    assert.equal(unknownStatus.body.count, 3, "an unknown status is no filter");

    const byStaff = await read({ view: "contracts", staff_id: STAFF_ID }, fake);
    assert.deepEqual(ids(byStaff), [middle.id], "the contract about that staff member");

    const signedRow = fake.tables.contracts.find((c) => c.id === middle.id);
    assert.ok(signedRow.signed_document_id && signedRow.document_id);
    const oldestDoc = sentOldest.contract.document_id;
    const byDoc = await read({ view: "contracts", document_id: oldestDoc }, fake);
    assert.deepEqual(ids(byDoc), [oldest.id], "by the copy that was sent");
    const bySignedCopy = await read({ view: "contracts", document_id: signedRow.signed_document_id }, fake);
    assert.deepEqual(ids(bySignedCopy), [middle.id], "by the signed copy, the other end of the pointer");
    const both = await read({ view: "contracts", document_id: `${oldestDoc}, ${signedRow.signed_document_id}` }, fake);
    assert.deepEqual(ids(both).sort(), [oldest.id, middle.id].sort());
    assert.equal(ids(both).includes(newest.id), false);
  });

  test("the template library lists active copy first, then by kind and short name", async () => {
    const { fake } = await library();
    const made = await staffPost({ action: "create_template", template_key: "authorize-pull", name: "Pull Authorization", kind: "authorization", body: "I allow it." }, fake);
    assert.equal(made.statusCode, 200, JSON.stringify(made.body));
    const res = await read({ view: "templates" }, fake);
    assert.deepEqual(res.body.items.map((t) => t.template_key), ["AUTHORIZE-PULL", "SETUP", "OLD-ONE"]);
    assert.equal(res.body.count, 3);
    const two = await read({ view: "templates", limit: "2" }, fake);
    assert.deepEqual(two.body.items.map((t) => t.template_key), ["AUTHORIZE-PULL", "SETUP"]);
  });

  test("?file=contract serves the signed copy once it is signed, and signed=0 still gives the copy that was sent", async () => {
    const { fake, middle, oldest } = await signedLibrary();
    const signedCopy = await read({ file: "contract", id: middle.id }, fake);
    assert.equal(signedCopy.statusCode, 200);
    assert.equal(signedCopy.body.signed, true);
    assert.match(signedCopy.body.filename, /-signed\.pdf$/);
    const asked = await read({ file: "contract", id: middle.id, signed: "1" }, fake);
    assert.equal(asked.body.signed, true);
    const sentCopy = await read({ file: "contract", id: middle.id, signed: "0" }, fake);
    assert.equal(sentCopy.statusCode, 200);
    assert.equal(sentCopy.body.signed, false);
    assert.notEqual(sentCopy.body.pdf_base64, signedCopy.body.pdf_base64, "the signed copy is a different file");
    const unsigned = await read({ file: "contract", id: oldest.id }, fake);
    assert.equal(unsigned.body.signed, false);
  });

  test("a PDF template file is never cached, and a contract with one person already signed names the one still waited on", async () => {
    const { fake } = await library();
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    const up = await staffPost({ action: "upload_template", template_key: "paper-two", name: "Paper Two", filename: "paper.pdf", file: Buffer.from(await doc.save()).toString("base64") }, fake);
    const file = await read({ file: "template", template_id: up.body.template.id }, fake);
    assert.equal(file.statusCode, 200);
    assert.equal(file.headers["cache-control"], "private, no-store");

    const two = [
      { role_label: "Client", name: "Dana Whitfield", email: "dana@example.test", client_id: IDS.client },
      { role_label: "Counterparty", name: "Pat Counter", email: "pat@example.test", client_id: null },
    ];
    const made = await staffPost({ action: "create_draft", client_id: IDS.client, template_id: IDS.template, values: { service: "Two sign" }, signers: two }, fake);
    const sent = await staffPost({ action: "send", id: made.body.contract.id }, fake);
    const q = Object.fromEntries(new URL(sent.body.links[0].url).searchParams.entries());
    const signRes = makeRes();
    await runWithSharedDb(fake, () => signHandler({ method: "POST", query: q, headers: {}, body: { signer_name: "Dana Whitfield", agreed: true } }, signRes));
    assert.equal(signRes.statusCode, 200);
    const one = await read({ id: made.body.contract.id }, fake);
    assert.deepEqual(one.body.waiting_on, { name: "Pat Counter", role: "Counterparty", remaining: 1 });
    assert.deepEqual(one.body.signers.map((x) => x.status), ["signed", "sent"]);
  });
});
