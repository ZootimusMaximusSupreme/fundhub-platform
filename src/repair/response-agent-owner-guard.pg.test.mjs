// Fulfillment bureau-response ownership: real disposable PostgreSQL, never live Supabase.
// All data is transaction-local and rolled back. Provider/model/email remain mocked.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { ownsBureauResponseDocument, processBureauResponse } from "./response-agent.mjs";

let scratch = false;
try {
  const url = new URL(process.env.DATABASE_URL);
  scratch = process.env.CI === "true" &&
    ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname) &&
    url.pathname === "/fundhub_ci";
} catch { /* no allowed scratch database */ }

const pool = scratch ? new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 }) : null;
after(async () => { await pool?.end(); });

test("tenant, kind, expiry and version fencing against actual SQL", {
  skip: scratch ? false : "requires CI disposable loopback /fundhub_ci"
}, async () => {
  const db = await pool.connect();
  await db.query("BEGIN");
  try {
    // Search path makes both reads target TEMP shadows; public is never written.
    for (const table of ["documents", "document_versions"]) {
      await db.query(`CREATE TEMP TABLE ${table} (LIKE public.${table} INCLUDING ALL) ON COMMIT DROP`);
    }
    const org = randomUUID();
    const otherOrg = randomUUID();
    const client = randomUUID();
    const otherClient = randomUUID();

    const insertDocument = async (orgId, clientId, kind, expired = false) => {
      const documentKey = `ci-bureau-response-${randomUUID()}`;
      const row = await db.query(
        `INSERT INTO documents
          (org_id, client_id, document_key, kind, subtype, title,
           storage_key, mime_type, expires_at)
         VALUES ($1,$2,$3,$4,'bureau_letter','Synthetic bureau response',
                 'memory://synthetic-bureau-response','image/jpeg',$5)
         RETURNING id`,
        [orgId, clientId, documentKey, kind, expired ? new Date("2020-01-01T00:00:00Z") : null]
      );
      return row.rows[0].id;
    };

    const own = await insertDocument(org, client, "bureau_response");
    const anotherClient = await insertDocument(org, otherClient, "bureau_response");
    const anotherOrg = await insertDocument(otherOrg, client, "bureau_response");
    const unrelatedKind = await insertDocument(org, client, "client_upload");
    const expired = await insertDocument(org, client, "bureau_response", true);

    const insertVersion = async (orgId, documentId, version = 1) => (await db.query(
      `INSERT INTO document_versions (org_id, document_id, version, storage_key, mime_type)
       VALUES ($1,$2,$3,'memory://synthetic-bureau-response','image/jpeg') RETURNING id`,
      [orgId, documentId, version]
    )).rows[0].id;
    const goodVersion = await insertVersion(org, own);
    const foreignVersion = await insertVersion(org, anotherClient);
    const wrongTenantVersion = await insertVersion(otherOrg, own, 2);

    const check = (documentId, versionId = null) => ownsBureauResponseDocument(db, {
      orgId: org, clientId: client, documentId, versionId
    });
    assert.equal(await check(own), true);
    assert.equal(await check(own, goodVersion), true);
    assert.equal(await check(own, foreignVersion), false);
    assert.equal(await check(own, wrongTenantVersion), false);
    assert.equal(await check(anotherClient), false);
    assert.equal(await check(anotherOrg), false);
    assert.equal(await check(unrelatedKind), false);
    assert.equal(await check(expired), false);
    assert.equal(await check(randomUUID()), false);
    assert.equal(await check("bad-document-id"), false);

    let modelCount = 0, mailCount = 0, eventCount = 0;
    const blocked = await processBureauResponse(db, {
      orgId: org, clientId: client, documentId: anotherClient,
      bytes: Buffer.from("foreign tenant data"),
      callModelImpl: async () => { modelCount++; },
      sendTemplatedImpl: async () => { mailCount++; },
      onEvent: async () => { eventCount++; }
    });
    assert.deepEqual(blocked, { ok: false, reason: "bureau_response_document_unavailable" });
    assert.equal(modelCount, 0);
    assert.equal(mailCount, 0);
    assert.equal(eventCount, 0);
  } finally {
    await db.query("ROLLBACK").catch(() => {});
    db.release();
  }
});
