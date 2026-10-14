// Slice S3 proof: GET /api/documents-download. A saved document answers with a
// fresh signed link; staff reach their own company's files, a client only their
// own. The real handler and real signer run against a stand-in database.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import downloadHandler from "../../api/documents-download.mjs";
import { verifyDocumentUrl } from "../documents/signed-url.mjs";
import { callShared } from "../testing/s3-handler-call.mjs";
import { req, staffSession, accountSession, ORG_ID } from "../testing/handler-harness.mjs";

const CLIENT = "c1000000-0000-4000-8000-000000000001";
const OTHER_CLIENT = "c2000000-0000-4000-8000-000000000002";
const DOC = "d1000000-0000-4000-8000-0000000000d1";
const VERSION = "e1000000-0000-4000-8000-0000000000e1";

describe("GET /api/documents-download", () => {
  let saved;
  const secret = crypto.randomBytes(24).toString("hex");
  beforeEach(() => { saved = process.env.DOCUMENT_URL_SECRET; process.env.DOCUMENT_URL_SECRET = secret; });
  afterEach(() => { if (saved === undefined) delete process.env.DOCUMENT_URL_SECRET; else process.env.DOCUMENT_URL_SECRET = saved; });

  const row = (over = {}) => ({
    id: DOC, org_id: ORG_ID, client_id: CLIENT, title: "Credit analysis", document_key: "credit-analysis",
    kind: "deliverable", subtype: "credit_analysis_report", mime_type: "application/pdf", byte_size: 1234,
    current_version: 2, current_version_id: VERSION, expires_at: null, storage_key: "secret/object/key", ...over
  });
  const found = (over) => [/FROM documents d\s+WHERE d\.id = \$1 AND \(\$2::uuid IS NULL OR d\.org_id = \$2\)/, [row(over)]];

  test("staff get a fresh signed link for a saved document of their own company, with no storage key in the answer", async () => {
    const { res, fake } = await callShared(downloadHandler, req("GET", { query: { id: DOC } }), [staffSession(), found()]);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.document.id, DOC);
    assert.equal(res.body.document.title, "Credit analysis");
    assert.equal(JSON.stringify(res.body).includes("secret/object/key"), false);
    assert.equal(res.headers["cache-control"], "private, no-store");
    assert.deepEqual(fake.find(/FROM documents d/)[0].params, [DOC, ORG_ID]);
    const url = new URL(res.body.document.download.path, "https://fundhub.test");
    assert.ok(url.pathname.endsWith(`/${DOC}`));
    const check = verifyDocumentUrl({
      documentId: DOC, versionId: url.searchParams.get("v"), expiresAt: url.searchParams.get("exp"), sig: url.searchParams.get("sig")
    });
    assert.equal(check.valid, true);
    assert.equal(url.searchParams.get("v"), VERSION);
  });

  test("a client opens their own file only; another client's document in the same company is a 404", async () => {
    const mine = await callShared(downloadHandler, req("GET", { query: { id: DOC } }), [...accountSession({ kind: "client", clientId: CLIENT }), found()]);
    assert.equal(mine.res.statusCode, 200);
    const theirs = await callShared(downloadHandler, req("GET", { query: { id: DOC } }), [...accountSession({ kind: "client", clientId: OTHER_CLIENT }), found()]);
    assert.equal(theirs.res.statusCode, 404);
    assert.equal(theirs.res.body.document, undefined);
  });

  test("a document from another company, an expired one and a bad id all answer the same 404 or 400, with no link", async () => {
    const other = await callShared(downloadHandler, req("GET", { query: { id: DOC } }), [staffSession(), [/FROM documents d/, []]]);
    assert.equal(other.res.statusCode, 404);
    const expired = await callShared(downloadHandler, req("GET", { query: { id: DOC } }), [staffSession(), found({ expires_at: "2020-01-01T00:00:00.000Z" })]);
    assert.equal(expired.res.statusCode, 404);
    const bad = await callShared(downloadHandler, req("GET", { query: { id: "not-a-uuid" } }), [staffSession()]);
    assert.equal(bad.res.statusCode, 400);
    for (const out of [other, expired, bad]) assert.equal(out.res.body.document, undefined);
  });
});
