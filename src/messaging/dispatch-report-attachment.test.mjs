import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveDocumentAttachments } from "./dispatch.mjs";

const message = { org_id: "org-1", client_id: "client-1" };

test("credit PDF bytes are resolved only at send time from this client's saved document", async () => {
  const calls = [];
  const db = { async query(sql, params) {
    calls.push({ sql, params });
    return { rows: [{ storage_key: "opaque-key", checksum: "sha256:expected", mime_type: "application/pdf" }] };
  } };
  const store = { async get(key, opts) {
    assert.equal(key, "opaque-key");
    assert.equal(opts.expectedChecksum, "sha256:expected");
    return { body: Buffer.from("%PDF-1.4") };
  } };
  const out = await resolveDocumentAttachments(db,
    [{ document_id: "doc-1", filename: "Report.pdf" }], message, { store });
  assert.equal(calls[0].params[1], "org-1");
  assert.equal(calls[0].params[2], "client-1");
  assert.match(calls[0].sql, /subtype = 'crs_full_credit_report'/);
  assert.deepEqual(out, [{ filename: "Report.pdf", content: Buffer.from("%PDF-1.4").toString("base64"), content_type: "application/pdf" }]);
});

test("another client's or missing report is never attached", async () => {
  const db = { async query() { return { rows: [] }; } };
  const store = { async get() { throw new Error("must not read storage"); } };
  await assert.rejects(
    resolveDocumentAttachments(db, [{ document_id: "other-client-doc" }], message, { store }),
    /not on this client file/
  );
});

test("ordinary message assets are passed through unchanged", async () => {
  const list = [{ asset: "existing-asset", filename: "file.pdf" }];
  const out = await resolveDocumentAttachments(null, list, message);
  assert.deepEqual(out, list);
});
