// Capital Blueprint BP-10: ONLY real, same-client credit results inform FinanceOS bank guidance.
// Disposable local Postgres only. No test ever reaches a bureau, provider or production DB.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { CRS_SQL, TRADELINE_SQL, LIABILITY_SQL, fundingEstimate } from "./bank-strategy.mjs";

const connectionString = process.env.BLUEPRINT_TEST_DATABASE_URL || process.env.DATABASE_URL || "";
let scratchOnly = false;
try {
  const parsed = new URL(connectionString);
  scratchOnly = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(parsed.hostname)
    && /(?:test|scratch|_ci)(?:\b|_)/i.test(parsed.pathname);
} catch { /* No local scratch database. */ }
const options = { skip: scratchOnly ? false : "no LOCAL test/scratch Postgres; live databases forbidden" };
const pool = scratchOnly ? new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 5000 }) : null;
after(async () => { if (pool) await pool.end(); });

test("Blueprint bank strategy ignores simulated/sandbox CRS results, retaining genuine and legacy rows in its own tenant", options, async () => {
  const db = await pool.connect();
  await db.query("BEGIN");
  try {
    // A minimal transaction-local table makes the actual CRS_SQL run in Postgres.
    // It shadows public.crs_results without reading or writing any customer data.
    await db.query("CREATE TEMP TABLE crs_results (" +
      "id uuid PRIMARY KEY, org_id uuid, client_id uuid, provider text, " +
      "result jsonb, outcome_tier text, created_at timestamptz) ON COMMIT DROP");
    const orgId = randomUUID();
    const clientId = randomUUID();
    async function add({ org = orgId, client = clientId, provider = null, report = {}, at }) {
      const id = randomUUID();
      await db.query("INSERT INTO crs_results (id, org_id, client_id, provider, result, created_at) " +
        "VALUES ($1,$2,$3,$4,$5::jsonb,$6)", [id, org, client, provider, JSON.stringify(report), at]);
      return id;
    }
    const legacy = await add({ report: { fundingEstimate: 35000 },
      at: "2026-10-01T00:00:00Z" });
    const genuine = await add({ provider: "crs_softview",
      report: { environment: "production", simulated: false, fundingEstimate: 65000 },
      at: "2026-10-11T00:00:00Z" });
    await add({ provider: "crs_softview_simulated",
      report: { simulated: true, environment: "sandbox", fundingEstimate: 900000 },
      at: "2026-10-12T00:00:00Z" });
    await add({ provider: "crs_softview",
      report: { simulated: true, environment: "production", fundingEstimate: 800000 },
      at: "2026-10-13T00:00:00Z" });
    await add({ provider: "crs_softview",
      report: { simulated: false, environment: "sandbox", fundingEstimate: 700000 },
      at: "2026-10-14T00:00:00Z" });
    await add({ org: randomUUID(), provider: "crs_softview",
      report: { fundingEstimate: 999999 }, at: "2026-10-15T00:00:00Z" });
    await add({ client: randomUUID(), provider: "crs_softview",
      report: { fundingEstimate: 999999 }, at: "2026-10-16T00:00:00Z" });

    const { rows } = await db.query(CRS_SQL, [clientId, orgId]);
    assert.deepEqual(rows.map(row => row.id), [genuine, legacy],
      "newer rehearsals, sandbox reports and cross-tenant reports must not displace real credit evidence");
    assert.equal(fundingEstimate({}, rows).cents, 6500000,
      "FinanceOS bank guidance must use the newest genuine bureau estimate, not a simulated amount");
  } finally {
    await db.query("ROLLBACK");
    db.release();
  }
});

test("Blueprint bank guidance rejects sample-origin tradelines and card liabilities, preserves scoped genuine/manual rows", options, async () => {
  const db = await pool.connect();
  await db.query("BEGIN");
  try {
    // Actual production SELECTs run on transaction-local stand-ins; nothing
    // touches a user table or a bureau/provider. All rows are synthetic.
    await db.query(`CREATE TEMP TABLE crs_results (
      id uuid PRIMARY KEY, org_id uuid, client_id uuid, provider text,
      result jsonb, outcome_tier text, created_at timestamptz
    ) ON COMMIT DROP`);
    await db.query(`CREATE TEMP TABLE tradelines (
      id uuid PRIMARY KEY, org_id uuid, client_id uuid, source text,
      source_ref uuid, lender text, apr numeric
    ) ON COMMIT DROP`);
    await db.query(`CREATE TEMP TABLE card_liabilities (
      id uuid PRIMARY KEY, org_id uuid, client_id uuid, source text,
      source_ref uuid, as_of date
    ) ON COMMIT DROP`);
    const orgId = randomUUID(), clientId = randomUUID();
    const otherOrg = randomUUID(), otherClient = randomUUID();
    async function report({ org = orgId, client = clientId, provider = "crs_softview", result = {} } = {}) {
      const id = randomUUID();
      await db.query(
        `INSERT INTO crs_results (id, org_id, client_id, provider, result, created_at)
         VALUES ($1,$2,$3,$4,$5::jsonb,now())`,
        [id, org, client, provider, JSON.stringify(result)]
      );
      return id;
    }
    const real = await report({ result: { environment: "production", simulated: false } });
    const legacy = await report({ provider: null, result: {} });
    const simulated = await report({ provider: "crs_softview_simulated", result: { simulated: true } });
    const flagged = await report({ result: { simulated: true } });
    const sandbox = await report({ result: { environment: "sandbox" } });
    const fakeEnvironment = await report({ result: { environment: "simulated" } });
    const foreignParent = await report({ org: otherOrg });
    const otherClientParent = await report({ client: otherClient });
    const fixtures = [
      { name: "MANUAL", source: "manual", ref: null, allowed: true },
      { name: "REAL", source: "crs", ref: real, allowed: true },
      { name: "LEGACY", source: "crs", ref: legacy, allowed: true },
      { name: "SIMULATED_PROVIDER", source: "crs", ref: simulated },
      { name: "SIMULATED_FLAG", source: "crs", ref: flagged },
      { name: "SANDBOX", source: "crs", ref: sandbox },
      { name: "SIMULATED_ENVIRONMENT", source: "crs", ref: fakeEnvironment },
      { name: "ORPHAN", source: "crs", ref: randomUUID() },
      { name: "FOREIGN_ORG_PARENT", source: "crs", ref: foreignParent },
      { name: "FOREIGN_CLIENT_PARENT", source: "crs", ref: otherClientParent },
      { name: "OTHER_ORG_ROW", source: "manual", ref: null, org: otherOrg },
      { name: "OTHER_CLIENT_ROW", source: "manual", ref: null, client: otherClient }
    ];
    for (const f of fixtures) {
      const id = randomUUID();
      const params = [id, f.org || orgId, f.client || clientId, f.source, f.ref];
      await db.query(
        `INSERT INTO tradelines (id, org_id, client_id, source, source_ref, lender, apr)
         VALUES ($1,$2,$3,$4,$5,$6,0.2)`, [...params, f.name]);
      await db.query(
        `INSERT INTO card_liabilities (id, org_id, client_id, source, source_ref, as_of)
         VALUES ($1,$2,$3,$4,$5,'2026-10-31')`, params);
    }
    const lines = await db.query(TRADELINE_SQL, [clientId, orgId]);
    assert.deepEqual(new Set(lines.rows.map(r => r.lender)), new Set(["MANUAL", "REAL", "LEGACY"]),
      "no fabricated limit may enter UnderwriteIQ or bank strategy through stored tradelines");
    const liabilities = await db.query(LIABILITY_SQL, [clientId, orgId]);
    const expectedRefs = [null, real, legacy];
    assert.equal(liabilities.rows.length, expectedRefs.length,
      "no sample bill, orphan source or cross-tenant liability may enter the bank plan");
    assert.deepEqual(new Set(liabilities.rows.map(r => r.source_ref && String(r.source_ref))),
      new Set(expectedRefs),
      "manual, same-org genuine and legacy rows remain readable");
    const parentRows = await db.query(CRS_SQL, [clientId, orgId]);
    assert.deepEqual(new Set(parentRows.rows.map(r => String(r.id))), new Set([real, legacy]),
      "the same provenance rule applies to parent reports");
  } finally {
    await db.query("ROLLBACK");
    db.release();
  }
});
