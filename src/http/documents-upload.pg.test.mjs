// End-to-end tests for POST /api/documents-upload — client file uploads.
// See docs/UPLOADS-SPEC.md for the design. Drives the real Netlify handler
// against real Postgres (DATABASE_URL) because the interesting behaviour is
// all at the seam: multipart parsing in netlify/functions/api.mjs, the
// documents registry, the in-memory storage provider (DOCUMENT_STORE_PROVIDER
// is left unset so no real Netlify Blobs credential is needed here — store.mjs
// is provider-agnostic and src/documents/store.test.mjs covers the
// netlify-blobs provider itself against a fake SDK), and the event bus.

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { createSession } from "../auth/session.mjs";
import { createAccount, createAccountSession } from "../auth/account-session.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;
const SECRET = "test-document-url-secret-that-is-long-enough-32";
const EMAIL_TAG = "upload.fixture";

// Real magic-number bytes — the endpoint sniffs, it does not trust a filename.
const PDF_BYTES = Buffer.from("%PDF-1.4\n%fixture pdf body for upload tests\n%%EOF");
const NOT_A_DOC = Buffer.from("just plain text, not a pdf/jpg/png at all");

describe("POST /api/documents-upload", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let org, otherOrg, clientId, otherClientId, staffToken, otherStaffToken, clientToken, handler, priorSecret;

  const call = (path, init = {}) =>
    handler(new Request("https://site.netlify.app" + path, { host: "site.netlify.app", ...init }), {});

  const uploadForm = (bytes, opts = {}) => {
    const form = new FormData();
    const blob = new Blob([bytes], { type: opts.mimeType || "application/pdf" });
    form.append("file", blob, opts.filename || "test.pdf");
    if (opts.clientId !== undefined) form.append("client_id", opts.clientId);
    if (opts.subtype) form.append("subtype", opts.subtype);
    if (opts.entityId !== undefined) form.append("entity_id", opts.entityId);
    return form;
  };

  const post = (token, form) =>
    call("/api/documents-upload", {
      method: "POST",
      headers: token ? { authorization: "Bearer " + token } : {},
      body: form
    });

  before(async () => {
    priorSecret = process.env.DOCUMENT_URL_SECRET;
    process.env.DOCUMENT_URL_SECRET = SECRET;
    delete process.env.DOCUMENT_STORE_PROVIDER; // memory provider — no real storage vendor needed
    ({ default: handler } = await import("../../netlify/functions/api.mjs"));

    org = await resolveDefaultOrg(db);
    await purge();

    const staff = (await db.query(
      `INSERT INTO staff (org_id, email, name, role, status)
       VALUES ($1,$2,'Upload Fixture Staff','admin','active') RETURNING id`,
      [org, `${EMAIL_TAG}.staff@example.com`])).rows[0];
    staffToken = (await createSession(db, { staffId: staff.id, orgId: org })).token;

    clientId = (await db.query(
      `INSERT INTO clients (org_id, first_name, last_name, email)
       VALUES ($1,'Upload','Fixture',$2) RETURNING id`,
      [org, `${EMAIL_TAG}.client@example.com`])).rows[0].id;

    const acct = await createAccount(db, {
      orgId: org, kind: "client", email: `${EMAIL_TAG}.account@example.com`,
      password: "upload-fixture-password", clientId
    });
    clientToken = (await createAccountSession(db, { accountId: acct.id, orgId: org })).token;

    // A second org's client + staff — for the "not this org" isolation checks.
    otherOrg = (await db.query(
      `INSERT INTO orgs (name, slug) VALUES ('Upload Fixture Org','upload-fixture-org') RETURNING id`
    )).rows[0].id;
    otherClientId = (await db.query(
      `INSERT INTO clients (org_id, first_name, last_name, email)
       VALUES ($1,'Other','Org',$2) RETURNING id`,
      [otherOrg, `${EMAIL_TAG}.other@example.com`])).rows[0].id;
    const otherStaff = (await db.query(
      `INSERT INTO staff (org_id, email, name, role, status)
       VALUES ($1,$2,'Other Org Staff','admin','active') RETURNING id`,
      [otherOrg, `${EMAIL_TAG}.otherstaff@example.com`])).rows[0];
    otherStaffToken = (await createSession(db, { staffId: otherStaff.id, orgId: otherOrg })).token;
  });

  async function purge() {
    await db.query(`DELETE FROM events WHERE org_id IN ($1, (SELECT id FROM orgs WHERE slug = 'upload-fixture-org'))
                     AND (payload->>'client_id' IS NOT NULL)`, [org]).catch(() => {});
    const ids = (await db.query(
      `SELECT id FROM clients WHERE email LIKE $1 OR (first_name = 'Other' AND last_name = 'Org')`,
      [`${EMAIL_TAG}%`])).rows.map(r => r.id);
    if (ids.length) {
      await db.query(`ALTER TABLE documents DISABLE TRIGGER trg_documents_no_delete`);
      await db.query(`ALTER TABLE document_versions DISABLE TRIGGER trg_document_versions_no_delete`);
      try {
        // documents.current_version_id points AT document_versions, so it has to
        // be cleared before a version row can be deleted — fk_documents_current_version.
        await db.query(`UPDATE documents SET current_version_id = NULL WHERE client_id = ANY($1)`, [ids]);
        await db.query(`DELETE FROM document_versions WHERE document_id IN
                         (SELECT id FROM documents WHERE client_id = ANY($1))`, [ids]);
        await db.query(`DELETE FROM documents WHERE client_id = ANY($1)`, [ids]);
      } finally {
        await db.query(`ALTER TABLE documents ENABLE TRIGGER trg_documents_no_delete`);
        await db.query(`ALTER TABLE document_versions ENABLE TRIGGER trg_document_versions_no_delete`);
      }
    }
    await db.query(`DELETE FROM account_sessions WHERE account_id IN
                     (SELECT id FROM accounts WHERE email LIKE $1)`, [`${EMAIL_TAG}%`]);
    await db.query(`DELETE FROM accounts WHERE email LIKE $1`, [`${EMAIL_TAG}%`]);
    await db.query(`DELETE FROM sessions WHERE staff_id IN
                     (SELECT id FROM staff WHERE email LIKE $1)`, [`${EMAIL_TAG}%`]);
    await db.query(`DELETE FROM staff WHERE email LIKE $1`, [`${EMAIL_TAG}%`]);
    await db.query(`DELETE FROM clients WHERE email LIKE $1 OR (first_name = 'Other' AND last_name = 'Org')`,
      [`${EMAIL_TAG}%`]);
    await db.query(`DELETE FROM orgs WHERE slug = 'upload-fixture-org'`);
  }

  after(async () => {
    await purge();
    if (priorSecret === undefined) delete process.env.DOCUMENT_URL_SECRET;
    else process.env.DOCUMENT_URL_SECRET = priorSecret;
    await close();
  });

  // ── auth ─────────────────────────────────────────────────────────────────

  test("no session at all is refused", async () => {
    const r = await post(null, uploadForm(PDF_BYTES));
    assert.equal(r.status, 401);
  });

  test("a non-POST method is refused", async () => {
    const r = await call("/api/documents-upload", { method: "GET", headers: { authorization: "Bearer x" } });
    assert.equal(r.status, 405);
  });

  // ── the happy paths ─────────────────────────────────────────────────────

  test("a client can upload their own document", async () => {
    const r = await post(clientToken, uploadForm(PDF_BYTES, { filename: "bank-statement.pdf" }));
    const body = await r.json();
    assert.equal(r.status, 200, JSON.stringify(body));
    assert.equal(body.ok, true);
    assert.equal(body.documents.length, 1);
    const doc = body.documents[0];
    assert.equal(doc.client_id, clientId);
    assert.equal(doc.kind, "client_upload");
    assert.equal(doc.mime_type, "application/pdf");
    assert.ok(doc.download && doc.download.url, "no signed download url in the response");
    assert.equal(doc.storage_key, undefined, "storage_key leaked into the response");
  });

  test("a client's own client_id is used even if the form lies about it", async () => {
    const r = await post(clientToken, uploadForm(PDF_BYTES, { clientId: otherClientId }));
    const body = await r.json();
    assert.equal(r.status, 200, JSON.stringify(body));
    assert.equal(body.documents[0].client_id, clientId, "a client uploaded under someone else's id");
  });

  test("staff can upload on a named client's behalf", async () => {
    const r = await post(staffToken, uploadForm(PDF_BYTES, { clientId, subtype: "bank_statement" }));
    const body = await r.json();
    assert.equal(r.status, 200, JSON.stringify(body));
    assert.equal(body.documents[0].client_id, clientId);
    assert.equal(body.documents[0].subtype, "bank_statement");
  });

  test("staff must name a client — no client_id is a 400, not a guess", async () => {
    const r = await post(staffToken, uploadForm(PDF_BYTES));
    assert.equal(r.status, 400);
  });

  test("staff cannot upload for a client in a different org", async () => {
    const r = await post(staffToken, uploadForm(PDF_BYTES, { clientId: otherClientId }));
    assert.equal(r.status, 404);
  });

  // ── the document vault (Capital Blueprint B3): which business is this paper for? ──

  test("a business paper names its business container, and the document keeps it", async () => {
    const biz = (await db.query(
      `INSERT INTO entities (org_id, client_id, kind, name) VALUES ($1,$2,'business','Upload Fixture LLC') RETURNING id`,
      [org, clientId])).rows[0].id;
    const r = await post(clientToken, uploadForm(PDF_BYTES, { subtype: "business_bank_statement", entityId: biz, filename: "sept.pdf" }));
    const body = await r.json();
    assert.equal(r.status, 200, JSON.stringify(body));
    assert.equal(body.documents[0].subtype, "business_bank_statement", "a vault subtype is a known subtype, not 'other'");
    assert.equal(body.documents[0].metadata.entity_id, biz);
    assert.equal(body.documents[0].metadata.original_filename, "sept.pdf");
  });

  test("a business id that is not this client's is refused, never silently dropped", async () => {
    const theirs = (await db.query(
      `INSERT INTO entities (org_id, client_id, kind, name) VALUES ($1,$2,'business','Other Org LLC') RETURNING id`,
      [otherOrg, otherClientId])).rows[0].id;
    const r = await post(clientToken, uploadForm(PDF_BYTES, { subtype: "business_bank_statement", entityId: theirs }));
    assert.equal(r.status, 404);
    assert.equal((await r.json()).error, "no such business");
    const personal = (await db.query(
      `INSERT INTO entities (org_id, client_id, kind, name) VALUES ($1,$2,'personal','Upload Fixture (personal)') RETURNING id`,
      [org, clientId])).rows[0].id;
    const asPersonal = await post(clientToken, uploadForm(PDF_BYTES, { entityId: personal }));
    assert.equal(asPersonal.status, 404, "a personal container is not a business");
    const archived = (await db.query(
      `INSERT INTO entities (org_id, client_id, kind, name, archived_at) VALUES ($1,$2,'business','Archived LLC', now()) RETURNING id`,
      [org, clientId])).rows[0].id;
    assert.equal((await post(clientToken, uploadForm(PDF_BYTES, { entityId: archived }))).status, 404);
  });

  test("a malformed business id is a 400, and an upload with none is exactly what it was", async () => {
    const bad = await post(clientToken, uploadForm(PDF_BYTES, { entityId: "not-a-uuid" }));
    assert.equal(bad.status, 400);
    const none = await post(clientToken, uploadForm(PDF_BYTES, { subtype: "id_document" }));
    const body = await none.json();
    assert.equal(none.status, 200, JSON.stringify(body));
    assert.equal(Object.hasOwn(body.documents[0].metadata, "entity_id"), false);
  });

  test("an unknown subtype falls back to 'other' rather than failing", async () => {
    const r = await post(staffToken, uploadForm(PDF_BYTES, { clientId, subtype: "not-a-real-subtype" }));
    const body = await r.json();
    assert.equal(r.status, 200, JSON.stringify(body));
    assert.equal(body.documents[0].subtype, "other");
  });

  // ── validation: bytes decide, not the filename or declared header ─────────

  test("rejects a file whose bytes are not jpg/png/pdf, even with a .pdf filename", async () => {
    const r = await post(clientToken, uploadForm(NOT_A_DOC, { filename: "totally-a-pdf.pdf" }));
    const body = await r.json();
    assert.equal(r.status, 400);
    assert.equal(body.error, "invalid_file_type");
  });

  test("rejects an oversized file", async () => {
    const prior = process.env.DOCUMENT_UPLOAD_MAX_BYTES;
    process.env.DOCUMENT_UPLOAD_MAX_BYTES = "10";
    try {
      const r = await post(clientToken, uploadForm(PDF_BYTES));
      const body = await r.json();
      assert.equal(r.status, 400);
      assert.equal(body.error, "file_too_large");
    } finally {
      if (prior === undefined) delete process.env.DOCUMENT_UPLOAD_MAX_BYTES;
      else process.env.DOCUMENT_UPLOAD_MAX_BYTES = prior;
    }
  });

  test("no file in the request is a 400", async () => {
    const form = new FormData();
    form.append("client_id", clientId);
    const r = await post(clientToken, form);
    assert.equal(r.status, 400);
  });

  // ── storage round-trip: the bytes that come back are the bytes sent ───────

  test("the signed download link returns the exact bytes that were uploaded", async () => {
    const r = await post(clientToken, uploadForm(PDF_BYTES, { filename: "roundtrip.pdf" }));
    const body = await r.json();
    assert.equal(r.status, 200, JSON.stringify(body));
    const link = body.documents[0].download.path;

    const dl = await call(link);
    assert.equal(dl.status, 200, "GET " + link + " did not return 200");
    const got = Buffer.from(await dl.arrayBuffer());
    assert.ok(got.equals(PDF_BYTES), "downloaded bytes do not match the uploaded bytes");
    assert.equal(dl.headers.get("content-type"), "application/pdf");
  });

  test("a png round-trips as binary-identical bytes too", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5]);
    const r = await post(clientToken, uploadForm(png, { mimeType: "image/png", filename: "id.png" }));
    const body = await r.json();
    assert.equal(r.status, 200, JSON.stringify(body));

    const dl = await call(body.documents[0].download.path);
    assert.equal(dl.status, 200);
    assert.ok(Buffer.from(await dl.arrayBuffer()).equals(png));
  });

  // ── the event bus: docs.received fires, which is what F-06 listens for ────

  test("a successful upload emits docs.received naming the document and client", async () => {
    const r = await post(clientToken, uploadForm(PDF_BYTES, { filename: "event-check.pdf" }));
    const body = await r.json();
    assert.equal(r.status, 200, JSON.stringify(body));
    const documentId = body.documents[0].id;

    const rows = (await db.query(
      `SELECT payload, client_id FROM events
        WHERE org_id = $1 AND name = 'docs.received' AND payload->>'document_id' = $2`,
      [org, documentId])).rows;
    assert.equal(rows.length, 1, "expected exactly one docs.received event for this document");
    assert.equal(rows[0].client_id, clientId);
    assert.equal(rows[0].payload.kind, "client_upload");
  });

  // ── two uploads from the same client never collapse into one document ─────

  test("two uploads from the same client produce two distinct documents", async () => {
    const a = await post(clientToken, uploadForm(PDF_BYTES, { filename: "one.pdf" }));
    const b = await post(clientToken, uploadForm(PDF_BYTES, { filename: "two.pdf" }));
    const da = (await a.json()).documents[0];
    const db_ = (await b.json()).documents[0];
    assert.notEqual(da.id, db_.id, "two separate uploads were registered as the same document");
  });
});
