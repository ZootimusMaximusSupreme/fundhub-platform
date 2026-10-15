// Practice test for the money vault's "documents-upload (server)" row: stores the file, one document per
// file, sniffs the bytes. The REAL api/documents-upload.mjs handler, the real storage (in memory), the
// real document registration and the real byte check run with the database answered by stand-in rows.
//
// The live SQL check judges a saved upload row by row, and cannot see the way an upload goes wrong BEFORE
// it is saved. So this holds, directly:
//   * every file of one request becomes its OWN document (its own document key and its own first
//     version), so three bank statements are three documents and none overwrites another;
//   * the bytes are sniffed: a file that says it is a PDF but is not one is refused, nothing is stored or
//     registered, and no event is raised;
//   * a file over the size limit is refused the same way;
//   * a client session uploads only for its own file, whatever client id the request names, and a
//     staff session only for a client of its own company;
//   * a business folder that is not this client's own active business is refused before anything is stored.

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";

import handler from "../../../../api/documents-upload.mjs";
import { callShared } from "../../../testing/s3-handler-call.mjs";
import { ORG_ID, accountSession, req, staffSession } from "../../../testing/handler-harness.mjs";

// The handler signs the link it hands back, and refuses to without a long enough secret. A throwaway one.
process.env.DOCUMENT_URL_SECRET = randomBytes(24).toString("hex");
delete process.env.DOCUMENT_STORE_PROVIDER;

const CLIENT = "c1000000-0000-4000-8000-000000000001";
const OTHER_CLIENT = "c2000000-0000-4000-8000-000000000002";
const BUSINESS = "b1000000-0000-4000-8000-000000000001";

const PDF = (tag) => Buffer.from(`%PDF-1.4 stand-in statement ${tag}`);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("png body")]);
const HTML = Buffer.from("<html><script>alert(1)</script></html>");
const file = (buffer, name, mimeType = "application/pdf") => ({ buffer, filename: name, mimeType });

/** A database that answers each statement of one upload from what it was given, and remembers what it was asked to write. */
function uploadRules({ clients = [CLIENT], entities = [{ id: BUSINESS, client: CLIENT }] } = {}) {
  const written = { documents: [], versions: [], events: [], updates: [] };
  const docs = new Map();
  let n = 0;
  const rules = [
    [/FROM clients WHERE id = \$1 AND org_id = \$2/, (_sql, p) => (clients.includes(p[0]) && p[1] === ORG_ID ? [{ "?column?": 1 }] : [])],
    [/FROM entities\s+WHERE id = \$1/, (_sql, p) => (entities.some((e) => e.id === p[0] && e.client === p[2]) ? [{ "?column?": 1 }] : [])],
    [/INSERT INTO documents/, (_sql, p) => {
      n += 1;
      const row = {
        id: `d0000000-0000-4000-8000-${String(n).padStart(12, "0")}`, org_id: p[0], client_id: p[1], document_key: p[2], kind: p[3], subtype: p[4],
        title: p[5], current_version: 1, storage_key: p[7], mime_type: p[8], byte_size: p[9], checksum: p[10], generated_by: p[11], metadata: JSON.parse(p[16]),
      };
      docs.set(row.id, row);
      written.documents.push(row);
      return [row];
    }],
    [/INSERT INTO document_versions/, (_sql, p) => {
      const row = { id: `e0000000-0000-4000-8000-${String(written.versions.length + 1).padStart(12, "0")}`, org_id: p[0], document_id: p[1], version: p[2], storage_key: p[3], mime_type: p[4], byte_size: p[5], checksum: p[6] };
      written.versions.push(row);
      return [row];
    }],
    [/UPDATE documents SET/, (_sql, p) => {
      const row = { ...docs.get(p[0]), current_version: p[1], current_version_id: p[2] };
      docs.set(row.id, row);
      written.updates.push(row);
      return [row];
    }],
    [/INSERT INTO events/, (_sql, p) => { written.events.push({ name: p[1], client: p[4] }); return [{ id: `f0000000-0000-4000-8000-${String(written.events.length).padStart(12, "0")}` }]; }],
    [/FROM documents d\b/, (_sql, p) => (docs.has(p[0]) ? [{ ...docs.get(p[0]), subtype: docs.get(p[0]).subtype }] : [])],
    [/FROM documents\s+WHERE org_id/, () => [...docs.values()].map((d) => ({ kind: d.kind, subtype: d.subtype }))],
  ];
  return { rules, written };
}

const post = (body, headers) => req("POST", { body, headers });

test("every file of one request becomes its own document with its own first version, so three statements are three documents", async () => {
  const { rules, written } = uploadRules();
  const request = post({ fields: { client_id: CLIENT, subtype: "bank_statement" }, files: [file(PDF("a"), "jan.pdf"), file(PDF("b"), "feb.pdf"), file(PNG, "mar.png", "application/octet-stream")] });
  const { res } = await callShared(handler, request, [staffSession({ role: "funding_advisor" }), ...rules]);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.documents.length, 3);

  assert.equal(written.documents.length, 3);
  const keys = written.documents.map((d) => d.document_key);
  assert.equal(new Set(keys).size, 3, `three different document keys, got ${keys.join(" | ")}`);
  assert.equal(new Set(written.documents.map((d) => d.storage_key)).size, 3, "three different stored files");
  assert.deepEqual(written.versions.map((v) => v.version), [1, 1, 1], "each file is the first version of its own document");
  assert.deepEqual(written.documents.map((d) => d.client_id), [CLIENT, CLIENT, CLIENT]);
  assert.deepEqual(written.documents.map((d) => d.mime_type), ["application/pdf", "application/pdf", "image/png"], "the type stored is the type sniffed, not the type the browser declared");
  assert.ok(written.documents.every((d) => d.subtype === "bank_statement" && d.kind === "client_upload"));
  assert.equal(written.events.length, 3, "one docs.received per file");
});

test("two uploads of the same subtype in two requests are two documents, never one row that overwrites itself", async () => {
  const { rules, written } = uploadRules();
  for (const tag of ["x", "y"]) {
    const { res } = await callShared(handler, post({ fields: { client_id: CLIENT, subtype: "bank_statement" }, files: [file(PDF(tag), `${tag}.pdf`)] }), [staffSession({ role: "owner" }), ...rules]);
    assert.equal(res.statusCode, 200);
  }
  assert.equal(written.documents.length, 2);
  assert.notEqual(written.documents[0].document_key, written.documents[1].document_key);
});

test("the bytes are sniffed: a file that claims to be a pdf but is html is refused and nothing is stored, registered or raised", async () => {
  const { rules, written } = uploadRules();
  const { res } = await callShared(handler, post({ fields: { client_id: CLIENT }, files: [file(HTML, "statement.pdf", "application/pdf")] }), [staffSession({ role: "owner" }), ...rules]);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.ok, false);
  assert.equal(written.documents.length, 0);
  assert.equal(written.versions.length, 0);
  assert.equal(written.events.length, 0);

  const empty = await callShared(handler, post({ fields: { client_id: CLIENT }, files: [file(Buffer.alloc(0), "empty.pdf")] }), [staffSession({ role: "owner" }), ...rules]);
  assert.equal(empty.res.statusCode, 400, "an empty file is refused");
});

test("a file over the size limit is refused before it is stored", async () => {
  const { rules, written } = uploadRules();
  const huge = Buffer.concat([Buffer.from("%PDF-1.4 "), Buffer.alloc(11 * 1024 * 1024, 65)]);
  const { res } = await callShared(handler, post({ fields: { client_id: CLIENT }, files: [file(huge, "huge.pdf")] }), [staffSession({ role: "owner" }), ...rules]);
  assert.equal(res.statusCode, 400);
  assert.equal(written.documents.length, 0);
});

test("a client session uploads only for its own file, whatever client the request names", async () => {
  const { rules, written } = uploadRules({ clients: [CLIENT, OTHER_CLIENT] });
  const { res } = await callShared(handler, post({ fields: { client_id: OTHER_CLIENT, subtype: "id_document" }, files: [file(PDF("id"), "id.pdf")] }),
    accountSession({ kind: "client", clientId: CLIENT }).concat(rules));
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual(written.documents.map((d) => d.client_id), [CLIENT], "the file lands on the session's own client");
  assert.ok(written.documents[0].generated_by.startsWith("client:"));
});

test("staff cannot upload for a client of another company", async () => {
  const { rules, written } = uploadRules({ clients: [CLIENT] });
  const { res } = await callShared(handler, post({ fields: { client_id: OTHER_CLIENT }, files: [file(PDF("z"), "z.pdf")] }), [staffSession({ role: "owner" }), ...rules]);
  assert.equal(res.statusCode, 404);
  assert.equal(written.documents.length, 0);
});

test("a business folder that is not this client's own is refused before anything is stored, and a real one is kept on the document", async () => {
  const { rules, written } = uploadRules();
  const stranger = "b2000000-0000-4000-8000-000000000002";
  const bad = await callShared(handler, post({ fields: { client_id: CLIENT, entity_id: stranger, subtype: "bank_statement" }, files: [file(PDF("q"), "q.pdf")] }), [staffSession({ role: "owner" }), ...rules]);
  assert.equal(bad.res.statusCode, 404);
  assert.equal(written.documents.length, 0);

  const good = await callShared(handler, post({ fields: { client_id: CLIENT, entity_id: BUSINESS, subtype: "business_bank_statement" }, files: [file(PDF("r"), "r.pdf")] }), [staffSession({ role: "owner" }), ...rules]);
  assert.equal(good.res.statusCode, 200, JSON.stringify(good.res.body));
  assert.equal(written.documents[0].metadata.entity_id, BUSINESS);
});
