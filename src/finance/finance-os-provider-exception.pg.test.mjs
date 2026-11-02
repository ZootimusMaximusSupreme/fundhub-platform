// FinanceOS provider exception proof: disposable, named local test Postgres ONLY.
// No bureau calls, real customers, live data, or other provider side effects.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { fulfilQueuedSystemPulls } from "./finance-os-pull-fulfil.mjs";

const connectionString = process.env.BLUEPRINT_TEST_DATABASE_URL || process.env.DATABASE_URL;
let safe = false;
try {
  const u = new URL(connectionString);
  safe = ["127.0.0.1", "localhost", "::1", "[::1]"].includes(u.hostname)
    && /(?:test|scratch|_ci)(?:\b|_)/i.test(u.pathname);
} catch { /* remote and unknown database URLs prohibited */ }
const pool = safe ? new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 5000 }) : null;
after(async () => { if (pool) await pool.end(); });

test("real provider refusal and ambiguous error leave one tenant-bound owner task each, no replay",
  { skip: safe ? false : "disposable local test Postgres required" }, async () => {
    const db = await pool.connect();
    await db.query("BEGIN");
    try {
      for (const table of ["soft_pull_requests", "tasks"]) {
        await db.query(`CREATE TEMP TABLE ${table} (LIKE public.${table} INCLUDING ALL) ON COMMIT DROP`);
      }
      await db.query("SET LOCAL search_path TO pg_temp, public");
      const org = randomUUID(), otherOrg = randomUUID(), buyer = randomUUID(), plan = randomUUID();
      async function makeRequest() {
        const key = `finance-os-monthly:${plan}:${(await db.query("SELECT count(*)::int AS n FROM soft_pull_requests")).rows[0].n}:real`;
        return (await db.query(`INSERT INTO soft_pull_requests
          (org_id,client_id,subscription_id,idempotency_key,requested_by_kind,reason,status)
          VALUES ($1,$2,$3,$4,'system','Included monthly refresh','queued') RETURNING id`,
          [org,buyer,plan,key])).rows[0].id;
      }
      const active = {
        env: { FINANCE_OS_SYSTEM_PULL_LIVE: "1", CRS_ALLOW_LIVE: "1" },
        consentCheck: async () => ({ valid: true }),
        entitlementCheck: async () => ({ entitled: true, subscriptionId: plan }),
        aftercare: async () => { throw Error("no aftercare without genuine result"); }
      };
      const refusedId = await makeRequest();
      const refused = await fulfilQueuedSystemPulls(db, {
        ...active, runPull: async (_db, input) => {
          await db.query("UPDATE soft_pull_requests SET status='failed', resolved_at=now() WHERE id=$1", [input.requestId]);
          return { ok: false, code: "crs_unavailable" };
        }
      });
      assert.equal(refused.ok, false);
      assert.equal(refused.failed, 1);
      assert.equal(refused.providerExceptions.length, 1);
      assert.equal((await fulfilQueuedSystemPulls(db, { ...active,
        runPull: async () => { throw Error("must not retry refused order"); } })).checked, 0);
      const unknownId = await makeRequest();
      const thrown = await fulfilQueuedSystemPulls(db, {
        ...active, runPull: async (_db, input) => {
          await db.query("UPDATE soft_pull_requests SET status='processing' WHERE id=$1", [input.requestId]);
          throw Error("provider transport interrupted after claim");
        }
      });
      assert.equal(thrown.ok, false);
      assert.equal(thrown.errored.length, 1);
      assert.equal(thrown.providerExceptions.length, 1);
      const tasks = (await db.query(`SELECT org_id,client_id,assignee_role,source_workflow,body,detail
        FROM tasks WHERE source_workflow='finance-os-monthly-provider-exception' ORDER BY body`)).rows;
      assert.equal(tasks.length, 2);
      assert.ok(tasks.every(t => t.org_id === org && t.client_id === buyer && t.assignee_role === "owner"));
      assert.deepEqual(tasks.map(t => t.body).sort(),
        [`finance-os-monthly-provider:${refusedId}`, `finance-os-monthly-provider:${unknownId}`].sort());
      assert.ok(tasks.every(t => /Do not automatically redial or re-pull/.test(t.detail)));
      assert.equal((await db.query("SELECT count(*)::int AS n FROM tasks WHERE org_id=$1", [otherOrg])).rows[0].n, 0);
      assert.equal((await db.query("SELECT status FROM soft_pull_requests WHERE id=$1", [unknownId])).rows[0].status,
        "processing", "ambiguous provider outcome stays held for human reconciliation");
      assert.equal((await fulfilQueuedSystemPulls(db, { ...active,
        runPull: async () => { throw Error("must not re-order processing request"); } })).checked, 0);
    } finally {
      await db.query("ROLLBACK");
      db.release();
    }
  });
