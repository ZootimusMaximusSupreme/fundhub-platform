// Capital Blueprint BP-10: ONLY real, same-client credit results inform FinanceOS bank guidance.
// Disposable local Postgres only. No test ever reaches a bureau, provider or production DB.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { CRS_SQL, fundingEstimate } from "./bank-strategy.mjs";

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
