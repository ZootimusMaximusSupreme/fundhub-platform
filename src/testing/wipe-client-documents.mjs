// Remove a test's own documents in ONE transaction, or not at all.
//
// documents refuse DELETE (trg_documents_no_delete) and so do their versions
// (trg_document_versions_no_delete), and a document points at its current
// version (fk_documents_current_version), so a test wipe has to switch the two
// guards off, unpin the current version, then delete versions and documents.
//
// The old copies of this did those steps one at a time and swallowed a refused
// guard switch with .catch(() => {}). On a database where the login may not
// switch the guard off, the unpin still went through and the delete then
// failed: the document stayed, with no current version. Its Download link in
// "What You Own" then pointed at nothing. That is how deliverable 983904a0
// (client repair_generate_pg_test@example.com) lost its version on 2026-10-12.
//
// Here every step runs inside one BEGIN … COMMIT on one connection. Any refusal
// rolls the whole thing back, so a document is either gone with its versions
// or exactly as it was. Postgres also rolls back the guard switch itself, so a
// crash can never leave the guards off.
//
// `pool` is anything with connect() that hands back a client with query() and
// release() (src/db.mjs pool()). `where` is a condition on documents, written
// without an alias, that may use `params` ($1, $2, …).

export const DOCUMENT_GUARDS = Object.freeze([
  ["documents", "trg_documents_no_delete"],
  ["document_versions", "trg_document_versions_no_delete"]
]);

export async function wipeClientDocuments(pool, { where, params = [] } = {}) {
  if (!pool || typeof pool.connect !== "function") {
    throw new Error("wipeClientDocuments needs a pool with connect()");
  }
  if (typeof where !== "string" || !where.trim()) {
    throw new Error("wipeClientDocuments needs a where condition");
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Nothing of this test's on file: no guard to switch, nothing to unpin. A login
    // that may not switch guards still gets a clean empty wipe, as it did before.
    const found = await client.query(`SELECT 1 FROM documents WHERE ${where} LIMIT 1`, params);
    if (!found.rows?.length) {
      await client.query("COMMIT");
      return;
    }
    for (const [table, trigger] of DOCUMENT_GUARDS) {
      await client.query(`ALTER TABLE ${table} DISABLE TRIGGER ${trigger}`);
    }
    await client.query(`UPDATE documents SET current_version_id = NULL WHERE ${where}`, params);
    await client.query(
      `DELETE FROM document_versions WHERE document_id IN (SELECT id FROM documents WHERE ${where})`, params);
    await client.query(`DELETE FROM documents WHERE ${where}`, params);
    for (const [table, trigger] of DOCUMENT_GUARDS) {
      await client.query(`ALTER TABLE ${table} ENABLE TRIGGER ${trigger}`);
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
