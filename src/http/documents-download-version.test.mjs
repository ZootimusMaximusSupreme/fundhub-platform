// GET /api/documents-download?id&version — the full credit report for one past
// soft pull (the fulfillment cycle). Same ownership gate as the newest version;
// only which saved version is signed changes.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import downloadHandler from "../../api/documents-download.mjs";
import { verifyDocumentUrl } from "../documents/signed-url.mjs";
import { callShared } from "../testing/s3-handler-call.mjs";
import { tableRules } from "../testing/s3-scoped-rows.mjs";
import { req, accountSession, ORG_ID } from "../testing/handler-harness.mjs";

const CLIENT = "c1000000-0000-4000-8000-000000000001";
const OTHER_CLIENT = "c2000000-0000-4000-8000-000000000002";
const DOC = "d1000000-0000-4000-8000-0000000000d1";
const OTHER_DOC = "d2000000-0000-4000-8000-0000000000d2";
const V1 = "e1000000-0000-4000-8000-0000000000e1";
const V2 = "e2000000-0000-4000-8000-0000000000e2";

describe("GET /api/documents-download with a version", () => {
  let saved;
  const secret = crypto.randomBytes(24).toString("hex");
  beforeEach(() => { saved = process.env.DOCUMENT_URL_SECRET; process.env.DOCUMENT_URL_SECRET = secret; });
  afterEach(() => { if (saved === undefined) delete process.env.DOCUMENT_URL_SECRET; else process.env.DOCUMENT_URL_SECRET = saved; });

  const doc = (over = {}) => ({ id: DOC, org_id: ORG_ID, client_id: CLIENT, title: "Complete Credit Report", document_key: "full-report",
    kind: "deliverable", subtype: "crs_full_credit_report", mime_type: "application/pdf", byte_size: 99,
    current_version: 2, current_version_id: V2, expires_at: null, storage_key: "secret/key", ...over });
  const versions = [
    { id: V1, org_id: ORG_ID, document_id: DOC, version: 1, mime_type: "application/pdf", storage_key: "secret/v1", generated_at: "2026-10-06T12:00:00Z" },
    { id: V2, org_id: ORG_ID, document_id: DOC, version: 2, mime_type: "application/pdf", storage_key: "secret/v2", generated_at: "2026-11-06T12:00:00Z" }
  ];
  const open = (query, clientId = CLIENT, docs = [doc(), doc({ id: OTHER_DOC, client_id: OTHER_CLIENT })]) =>
    callShared(downloadHandler, req("GET", { query }), [...accountSession({ kind: "client", clientId }),
      ...tableRules("documents", docs), ...tableRules("document_versions", versions)]);

  test("a client opens an older pull's report: that version is signed, not the newest", async () => {
    const { res } = await open({ id: DOC, version: "1" });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.document.version, 1);
    assert.equal(JSON.stringify(res.body).includes("secret/"), false);
    const url = new URL(res.body.document.download.path, "https://fundhub.test");
    assert.equal(url.searchParams.get("v"), V1);
    assert.equal(verifyDocumentUrl({ documentId: DOC, versionId: V1, expiresAt: url.searchParams.get("exp"), sig: url.searchParams.get("sig") }).valid, true);
    assert.equal(res.headers["cache-control"], "private, no-store");
  });

  test("without a version the newest is unchanged", async () => {
    const { res } = await open({ id: DOC });
    assert.equal(res.statusCode, 200);
    assert.equal(new URL(res.body.document.download.path, "https://fundhub.test").searchParams.get("v"), V2);
    assert.equal(res.body.document.version, undefined);
  });

  test("another client's report, a missing version and a bad version are refused", async () => {
    assert.equal((await open({ id: OTHER_DOC, version: "1" })).res.statusCode, 404);
    assert.equal((await open({ id: DOC, version: "7" })).res.statusCode, 404);
    for (const version of ["0", "-1", "1.5", "abc", "1;drop"]) {
      assert.equal((await open({ id: DOC, version })).res.statusCode, 400, version);
    }
  });
});
