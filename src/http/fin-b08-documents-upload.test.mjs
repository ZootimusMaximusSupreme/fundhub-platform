// finish-853 batch 08: POST /api/documents-upload. The real handler, the real byte check, the real
// in-memory file store, the real document registry and the real event bus run over stand-in
// documents, versions, clients and events. The row's words: a multipart file is sniffed against the
// accepted types, stored, registered as a document, and raises docs.received so the reader runs.
// Practice test, fake data, no network, no database.
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import handler from "../../api/documents-upload.mjs";
import { fakeDb, makeRes, req, runWithSharedDb, staffSession, accountSession, ORG_ID, OTHER_ORG_ID, STAFF_ID } from "../testing/handler-harness.mjs";
import { tablesDb } from "../testing/fin-b08-tables.mjs";

const CLIENT = "c1000000-0000-4000-8000-000000000001";
const OTHER_CLIENT = "c2000000-0000-4000-8000-000000000002";
const FOREIGN_CLIENT = "c9000000-0000-4000-8000-000000000009";
const BIZ = "b1000000-0000-4000-8000-000000000001";
const PERSONAL = "b3000000-0000-4000-8000-000000000003";
const ARCHIVED_BIZ = "b4000000-0000-4000-8000-000000000004";
const KEYS = ["DOCUMENT_URL_SECRET", "MESSAGING_DRY_RUN", "ADAPTERS_DRY_RUN", "INNGEST_EVENT_KEY", "DOCUMENT_STORE_PROVIDER"];
const saved = {};
const realFetch = globalThis.fetch;
const asked = [];
before(() => {
  for (const k of KEYS) saved[k] = process.env[k];
  process.env.DOCUMENT_URL_SECRET = crypto.randomBytes(24).toString("hex");
  process.env.MESSAGING_DRY_RUN = "1";
  process.env.ADAPTERS_DRY_RUN = "1";
  delete process.env.INNGEST_EVENT_KEY;
  delete process.env.DOCUMENT_STORE_PROVIDER;
  globalThis.fetch = async (url) => { asked.push(String(url)); throw new Error("network refused in this test"); };
});
after(() => {
  for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  globalThis.fetch = realFetch;
});
beforeEach(() => { asked.length = 0; });

const png = (n = 64) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(n, 1)]);
const pdf = () => Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(64, 2)]);
const exe = () => Buffer.concat([Buffer.from("MZ"), Buffer.alloc(64, 3)]);
const file = (buffer, filename, mimeType) => ({ buffer, filename, mimeType });

function uploadFile({ docs = [], signed = [] } = {}) {
  const tables = {
    clients: [
      { id: CLIENT, org_id: ORG_ID, tags: ["docs:missing"] },
      { id: OTHER_CLIENT, org_id: ORG_ID, tags: ["docs:missing"] },
      { id: FOREIGN_CLIENT, org_id: OTHER_ORG_ID, tags: [] },
    ],
    entities: [
      { id: BIZ, org_id: ORG_ID, client_id: CLIENT, kind: "business", archived_at: null },
      { id: "b2000000-0000-4000-8000-000000000002", org_id: ORG_ID, client_id: OTHER_CLIENT, kind: "business", archived_at: null },
      // this client's own personal container, and one of its businesses that was archived: neither takes a business paper
      { id: PERSONAL, org_id: ORG_ID, client_id: CLIENT, kind: "personal", archived_at: null },
      { id: ARCHIVED_BIZ, org_id: ORG_ID, client_id: CLIENT, kind: "business", archived_at: "2026-01-01T00:00:00Z" },
    ],
    documents: docs.slice(),
    document_versions: [],
    events: [],
    client_consents: [],
  };
  const fake = tablesDb({
    tables,
    autoInsert: true,
    rules: [
      [/^\s*SELECT 1 FROM clients WHERE id = \$1 AND org_id = \$2/i, (_s, p) => tables.clients.filter((c) => c.id === p[0] && c.org_id === p[1]).map(() => ({ "?column?": 1 }))],
      [/^\s*SELECT id FROM orgs WHERE slug/i, [{ id: ORG_ID }]],
      [/^\s*SELECT 1 FROM entities\s+WHERE id = \$1 AND org_id = \$2 AND client_id = \$3 AND kind = 'business' AND archived_at IS NULL/i,
        (_s, p) => tables.entities.filter((e) => e.id === p[0] && e.org_id === p[1] && e.client_id === p[2] && e.kind === "business" && !e.archived_at).map(() => ({ "?column?": 1 }))],
      // Who has a live signed authorization: a consent row, not a document (src/inquiry-ops/doc-gate.mjs).
      [/FROM client_consents/i, (_s, p) => signed.filter((id) => (Array.isArray(p[1]) ? p[1].includes(id) : true)).map((id) => ({ client_id: id }))],
      [/^\s*UPDATE documents SET\s+current_version/i, (_s, p) => {
        const d = tables.documents.find((x) => x.id === p[0]);
        Object.assign(d, { current_version: p[1], current_version_id: p[2], storage_key: p[3], mime_type: p[4], byte_size: p[5], checksum: p[6], generated_by: p[7] });
        return [{ ...d }];
      }],
      [/^\s*UPDATE clients SET tags = array\(SELECT unnest\(tags\) EXCEPT SELECT unnest\(\$2::text\[\]\)\) WHERE id = \$1/i, (_s, p) => {
        const c = tables.clients.find((x) => x.id === p[0]);
        if (c) c.tags = c.tags.filter((t) => !p[1].includes(t));
        return { rows: [], rowCount: c ? 1 : 0 };
      }],
    ],
  });
  return { fake, tables };
}

async function call(body, file, who = [staffSession({ role: "closer" })]) {
  const session = fakeDb(who);
  const res = makeRes();
  const combined = {
    calls: file.fake.calls,
    query: (sql, params) => (/FROM live JOIN staff|UPDATE account_sessions|FROM accounts WHERE id/.test(typeof sql === "string" ? sql : sql.text) ? session.query(sql, params) : file.fake.query(sql, params)),
    connect: () => file.fake.connect(),
  };
  await runWithSharedDb(combined, () => handler(req("POST", { body, headers: { host: "app.example.test" } }), res));
  return { res, file };
}
const asClient = (clientId = CLIENT) => accountSession({ kind: "client", clientId });

describe("POST /api/documents-upload", () => {
  test("a client's file is checked, stored and registered as one document on their own file, and docs.received is raised for it", async () => {
    const f = uploadFile();
    const { res } = await call({ fields: { client_id: OTHER_CLIENT, subtype: "id_document" }, files: [file(png(), "id.png", "image/png")] }, f, asClient());
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(f.tables.documents.length, 1);
    const doc = f.tables.documents[0];
    assert.deepEqual([doc.org_id, doc.client_id, doc.kind, doc.subtype, doc.mime_type], [ORG_ID, CLIENT, "client_upload", "id_document", "image/png"]);
    assert.ok(doc.storage_key, "the bytes were stored");
    assert.equal(doc.byte_size, png().length);
    assert.equal(f.tables.document_versions.length, 1);
    const meta = JSON.parse(doc.metadata);
    assert.equal(meta.original_filename, "id.png");
    assert.deepEqual(meta.label, { given: "id_document", filed_as: "id_document", source: "given" });
    assert.equal(meta.uploaded_by.kind, "client");
    const [event] = f.tables.events;
    assert.equal(event.name, "docs.received");
    assert.equal(event.client_id, CLIENT);
    assert.equal(event.org_id, ORG_ID);
    assert.equal(event.payload.document_id, doc.id);
    assert.equal(event.payload.subtype, "id_document");
    assert.equal(res.body.documents[0].id, doc.id);
    assert.equal(JSON.stringify(res.body).includes(doc.storage_key), false, "the storage key never reaches the browser");
  });

  test("every file is its own document: three files make three documents and three events", async () => {
    const f = uploadFile();
    const { res } = await call({ fields: { client_id: CLIENT, subtype: "bank_statement" }, files: [
      file(pdf(), "jan.pdf", "application/pdf"), file(pdf(), "feb.pdf", "application/pdf"), file(png(), "mar.png", "image/png"),
    ] }, f, asClient());
    assert.equal(res.statusCode, 200);
    assert.equal(f.tables.documents.length, 3);
    assert.equal(new Set(f.tables.documents.map((d) => d.document_key)).size, 3);
    assert.equal(f.tables.events.filter((e) => e.name === "docs.received").length, 3);
    assert.equal(res.body.documents.length, 3);
  });

  test("the bytes are sniffed, never trusted: a program renamed to .png is refused and nothing is stored, registered or announced", async () => {
    const f = uploadFile();
    const { res } = await call({ fields: { client_id: CLIENT, subtype: "id_document" }, files: [file(exe(), "id.png", "image/png")] }, f, asClient());
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.ok, false);
    assert.ok(res.body.error);
    assert.equal(f.tables.documents.length, 0);
    assert.equal(f.tables.document_versions.length, 0);
    assert.equal(f.tables.events.length, 0);
    const none = uploadFile();
    const empty = await call({ fields: { client_id: CLIENT }, files: [] }, none, asClient());
    assert.equal(empty.res.statusCode, 400);
    assert.equal(none.tables.documents.length, 0);
  });

  test("a staff member uploads on a client's behalf, named in the record, and only for a client of their own company", async () => {
    const f = uploadFile();
    const { res } = await call({ fields: { client_id: CLIENT, subtype: "proof_of_address" }, files: [file(pdf(), "bill.pdf", "application/pdf")] }, f);
    assert.equal(res.statusCode, 200);
    const meta = JSON.parse(f.tables.documents[0].metadata);
    assert.deepEqual(meta.uploaded_by, { kind: "staff", id: STAFF_ID });
    assert.equal(f.tables.documents[0].client_id, CLIENT);

    const foreign = uploadFile();
    const refused = await call({ fields: { client_id: FOREIGN_CLIENT }, files: [file(pdf(), "x.pdf", "application/pdf")] }, foreign);
    assert.equal(refused.res.statusCode, 404);
    assert.equal(foreign.tables.documents.length, 0);
    const bad = await call({ fields: { client_id: "nope" }, files: [file(pdf(), "x.pdf", "application/pdf")] }, uploadFile());
    assert.equal(bad.res.statusCode, 400);
  });

  test("an unnamed or unrecognised label is filed as other and the record says whose word it was", async () => {
    const f = uploadFile();
    await call({ fields: { client_id: CLIENT }, files: [file(png(), "a.png", "image/png")] }, f, asClient());
    await call({ fields: { client_id: CLIENT, subtype: "treasure_map" }, files: [file(png(), "b.png", "image/png")] }, f, asClient());
    const labels = f.tables.documents.map((d) => JSON.parse(d.metadata).label);
    assert.deepEqual(labels, [
      { given: null, filed_as: "other", source: "none_given" },
      { given: "treasure_map", filed_as: "other", source: "unrecognised" },
    ]);
    assert.deepEqual(f.tables.documents.map((d) => d.subtype), ["other", "other"]);
  });

  test("a business paper is filed under one of this client's own active businesses, and another client's business is refused", async () => {
    const f = uploadFile();
    const ok = await call({ fields: { client_id: CLIENT, subtype: "bank_statement", entity_id: BIZ }, files: [file(pdf(), "s.pdf", "application/pdf")] }, f, asClient());
    assert.equal(ok.res.statusCode, 200);
    assert.equal(JSON.parse(f.tables.documents[0].metadata).entity_id, BIZ);
    const other = uploadFile();
    const refused = await call({ fields: { client_id: CLIENT, subtype: "bank_statement", entity_id: "b2000000-0000-4000-8000-000000000002" }, files: [file(pdf(), "s.pdf", "application/pdf")] }, other, asClient());
    assert.equal(refused.res.statusCode, 404);
    assert.equal(refused.res.body.error, "no such business");
    assert.equal(other.tables.documents.length, 0);
    // this client's own personal container and its archived business are not "active business containers" either
    for (const entity of [PERSONAL, ARCHIVED_BIZ]) {
      const g = uploadFile();
      const r = await call({ fields: { client_id: CLIENT, subtype: "bank_statement", entity_id: entity }, files: [file(pdf(), "s.pdf", "application/pdf")] }, g, asClient());
      assert.equal(r.res.statusCode, 404, entity);
      assert.equal(r.res.body.error, "no such business");
      assert.equal(g.tables.documents.length, 0);
    }
    // A business id that is not an id at all is a bad request, and is not looked up.
    const bad = uploadFile();
    const notAnId = await call({ fields: { client_id: CLIENT, subtype: "bank_statement", entity_id: "not-an-id" }, files: [file(pdf(), "s.pdf", "application/pdf")] }, bad, asClient());
    assert.equal(notAnId.res.statusCode, 400);
    assert.equal(notAnId.res.body.error, "entity_id must be a uuid");
    assert.equal(bad.tables.documents.length, 0);
    assert.equal(bad.fake.calls.filter((c) => /FROM entities/.test(c.sql)).length, 0);
  });

  test("the 'we still need your documents' flag comes off only when the whole packet is there", async () => {
    const f = uploadFile({ signed: [CLIENT] });
    const one = await call({ fields: { client_id: CLIENT, subtype: "id_document" }, files: [file(png(), "id.png", "image/png")] }, f, asClient());
    assert.equal(one.res.body.docs_missing, "kept", "an ID and a signature, but no proof of address yet");
    assert.deepEqual(f.tables.clients[0].tags, ["docs:missing"]);
    const last = await call({ fields: { client_id: CLIENT, subtype: "proof_of_address" }, files: [file(pdf(), "bill.pdf", "application/pdf")] }, f, asClient());
    assert.equal(last.res.body.docs_missing, "cleared");
    assert.deepEqual(f.tables.clients[0].tags, []);
    assert.deepEqual(f.tables.clients[1].tags, ["docs:missing"], "another client's flag is not touched");
  });

  test("without a signed authorization the flag stays on even when the ID and the address are both there", async () => {
    const f = uploadFile({ signed: [] });
    await call({ fields: { client_id: CLIENT, subtype: "id_document" }, files: [file(png(), "id.png", "image/png")] }, f, asClient());
    const last = await call({ fields: { client_id: CLIENT, subtype: "proof_of_address" }, files: [file(pdf(), "bill.pdf", "application/pdf")] }, f, asClient());
    assert.equal(last.res.body.docs_missing, "kept");
    assert.deepEqual(f.tables.clients[0].tags, ["docs:missing"]);
  });

  test("a client login with no client on it, no login, and a non-POST are refused", async () => {
    const f = uploadFile();
    const noLogin = await call({ fields: { client_id: CLIENT }, files: [file(png(), "a.png", "image/png")] }, f, []);
    assert.equal(noLogin.res.statusCode, 401);
    assert.equal(f.tables.documents.length, 0);
    const get = makeRes();
    await runWithSharedDb(f.fake, () => handler(req("GET", {}), get));
    assert.equal(get.statusCode, 405);
    assert.deepEqual(asked, []);
  });
});
