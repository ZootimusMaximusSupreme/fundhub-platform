// F-05 real SQL acceptance proof: tenant scope, terminal inquiry preservation,
// replay and refusal of unknown/cross-org client identities.
// Disposable LOCAL CI PostgreSQL only. All rows are transaction-local TEMP
// fixtures, rolled back; no real customer/provider side effects.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { handle } from "./f-05-inquiry-cleanup-gate.mjs";

const connectionString = process.env.DATABASE_URL;
let safe = false;
try {
  const url = new URL(connectionString);
  safe = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname)
    && /(?:test|scratch|_ci)(?:\\b|_)/i.test(url.pathname);
} catch { /* never connect to an unknown/prod database */ }
const options = { skip: safe ? false : "local CI/test/scratch PostgreSQL only; production refused" };
const pool = safe ? new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 5000 }) : null;
after(async () => { if (pool) await pool.end(); });

test("approved round only updates open inquiries for its existing org/client (real PostgreSQL)", options, async () => {
  const conn = await pool.connect();
  const orgA = randomUUID();
  const orgB = randomUUID();
  const clientA = randomUUID();
  const clientB = randomUUID();
  const step = { run: async (_name, fn) => fn() };
  const event = { id: randomUUID(), name: "round.approved", orgId: orgA, clientId: clientA, payload: {} };
  try {
    await conn.query("BEGIN");
    // Shadows production tables in this transaction only. No fixture escapes.
    await conn.query(`CREATE TEMP TABLE clients (
      id uuid, org_id uuid, email text
    ) ON COMMIT DROP`);
    await conn.query(`CREATE TEMP TABLE inquiry_log (
      marker text, org_id uuid, client_id uuid, status text,
      is_open boolean, confirmed_at timestamptz
    ) ON COMMIT DROP`);
    await conn.query("INSERT INTO clients (id,org_id,email) VALUES ($1,$2,$3),($4,$5,$6)",
      [clientA, orgA, "f05+main@example.test", clientB, orgB, "f05+other@example.test"]);
    const fixtures = [
      ["local-new",orgA,clientA,"New",true,null],
      ["local-unconfirmed",orgA,clientA,"unconfirmed",true,null],
      ["local-removed",orgA,clientA,"Removed",false,null],
      ["local-cleared",orgA,clientA,"Cleared",true,null],
      ["local-confirmed-at",orgA,clientA,"Active",true,"2026-10-01T00:00:00Z"],
      ["local-closed",orgA,clientA,"Active",false,null],
      // A corrupt cross-org inquiry row with the SAME client ID must not be touched.
      ["other-org-same-client",orgB,clientA,"New",true,null],
      ["same-org-other-client",orgA,clientB,"New",true,null]
    ];
    for (const row of fixtures) {
      await conn.query(
        "INSERT INTO inquiry_log (marker,org_id,client_id,status,is_open,confirmed_at) VALUES ($1,$2,$3,$4,$5,$6)",
        row
      );
    }
    const first = await handle({ event, db: conn, step });
    const replay = await handle({ event, db: conn, step });
    assert.deepEqual(first, { done: true, updated: 2 });
    assert.deepEqual(replay, { done: true, updated: 0 });

    const rows = (await conn.query("SELECT marker,status FROM inquiry_log ORDER BY marker")).rows;
    const statuses = Object.fromEntries(rows.map(r => [r.marker, r.status]));
    assert.equal(statuses["local-new"], "Pending Removal");
    assert.equal(statuses["local-unconfirmed"], "Pending Removal");
    assert.equal(statuses["local-removed"], "Removed");
    assert.equal(statuses["local-cleared"], "Cleared");
    assert.equal(statuses["local-confirmed-at"], "Active");
    assert.equal(statuses["local-closed"], "Active");
    assert.equal(statuses["other-org-same-client"], "New");
    assert.equal(statuses["same-org-other-client"], "New");

    // Existing round events may use an email, but never create new customers.
    const byEmail = await handle({
      event: { ...event, clientId: null, payload: { email: " F05+MAIN@EXAMPLE.TEST " } },
      db: conn, step
    });
    assert.deepEqual(byEmail, { done: true, updated: 0 });
    const wrongOrg = await handle({
      event: { ...event, orgId: orgB }, db: conn, step
    });
    assert.deepEqual(wrongOrg, { done: false, reason: "no_client" });
    const unknownEmail = await handle({
      event: { ...event, clientId: null, payload: { email: "f05+nobody@example.test" } },
      db: conn, step
    });
    assert.deepEqual(unknownEmail, { done: false, reason: "no_client" });
    assert.equal((await conn.query("SELECT COUNT(*)::int AS n FROM clients")).rows[0].n, 2);
  } finally {
    await conn.query("ROLLBACK");
    conn.release();
  }
});
