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
    const foreignFile = await read({ file: "contract", id: "f9000000-0000-4000-8000-000000000009" }, fake);
    assert.equal(foreignFile.statusCode, 404);
    const foreignTemplate = await read({ file: "template", template_id: IDS.foreignTemplate }, fake);
    assert.equal(foreignTemplate.statusCode, 404);
    assert.equal((await read({ id: "nope" }, fake)).statusCode, 400);
    assert.equal((await read({ file: "template", template_id: "nope" }, fake)).statusCode, 400);
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
});
