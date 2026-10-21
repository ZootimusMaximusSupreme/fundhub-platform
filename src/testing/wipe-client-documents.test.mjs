// No database needed: a fake connection records every statement.
import { test } from "node:test";
import assert from "node:assert/strict";
import { wipeClientDocuments } from "./wipe-client-documents.mjs";

function fakePool({ failOn = null, hasDocuments = true } = {}) {
  const log = [];
  let released = 0;
  const client = {
    async query(sql) {
      const s = String(sql).replace(/\s+/g, " ").trim();
      log.push(s);
      if (failOn && failOn.test(s)) throw new Error(`refused: ${s.slice(0, 40)}`);
      if (s.startsWith("SELECT 1 FROM documents")) return { rows: hasDocuments ? [{ "?column?": 1 }] : [] };
      return { rows: [], rowCount: 0 };
    },
    release() { released += 1; }
  };
  return { pool: { connect: async () => client }, log, released: () => released };
}

const WHERE = { where: "client_id = ANY($1::uuid[])", params: [["00000000-0000-0000-0000-000000000001"]] };

test("a clean wipe runs every step inside one transaction and commits", async () => {
  const f = fakePool();
  await wipeClientDocuments(f.pool, WHERE);
  assert.equal(f.log[0], "BEGIN");
  assert.equal(f.log.at(-1), "COMMIT");
  const unpin = f.log.findIndex((s) => s.startsWith("UPDATE documents SET current_version_id = NULL"));
  const delVersions = f.log.findIndex((s) => s.startsWith("DELETE FROM document_versions"));
  const delDocs = f.log.findIndex((s) => s.startsWith("DELETE FROM documents"));
  assert.ok(unpin > 0 && unpin < delVersions && delVersions < delDocs, "unpin, then versions, then documents");
  assert.ok(!f.log.includes("ROLLBACK"));
  assert.equal(f.released(), 1);
});

test("a refused guard switch rolls back before anything is unpinned", async () => {
  const f = fakePool({ failOn: /DISABLE TRIGGER trg_documents_no_delete/ });
  await assert.rejects(() => wipeClientDocuments(f.pool, WHERE), /refused/);
  assert.ok(!f.log.some((s) => s.startsWith("UPDATE documents")), "no unpin after a refused switch");
  assert.equal(f.log.at(-1), "ROLLBACK");
  assert.ok(!f.log.includes("COMMIT"));
  assert.equal(f.released(), 1);
});

test("a refused delete rolls the unpin back instead of leaving a document with no version", async () => {
  const f = fakePool({ failOn: /^DELETE FROM document_versions/ });
  await assert.rejects(() => wipeClientDocuments(f.pool, WHERE), /refused/);
  assert.ok(f.log.some((s) => s.startsWith("UPDATE documents")), "the unpin ran inside the transaction");
  assert.equal(f.log.at(-1), "ROLLBACK");
  assert.ok(!f.log.includes("COMMIT"));
});

test("no documents on file: commits without touching a guard", async () => {
  const f = fakePool({ hasDocuments: false, failOn: /DISABLE TRIGGER/ });
  await wipeClientDocuments(f.pool, WHERE);
  assert.ok(!f.log.some((s) => /TRIGGER|^UPDATE|^DELETE/.test(s)));
  assert.equal(f.log.at(-1), "COMMIT");
  assert.equal(f.released(), 1);
});

test("refuses to run with no condition, so it can never wipe every document", async () => {
  const f = fakePool();
  await assert.rejects(() => wipeClientDocuments(f.pool, { where: "  " }), /where/);
  assert.equal(f.log.length, 0);
});
