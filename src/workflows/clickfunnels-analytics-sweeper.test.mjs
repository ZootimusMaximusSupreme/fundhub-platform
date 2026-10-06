// The ClickFunnels night pull — that it can SEE the account it is meant to pull.
//
// THE BREAK. From 2026-09-22 the night pull wrote nothing. It asked for active
// ClickFunnels accounts with a plain connection; analytics_connections is FORCE
// ROW LEVEL SECURITY, staff only (302), so it saw 0 rows and quietly did nothing.
//
// NO DATABASE IN HERE. The fake pool below behaves like that one policy: it
// returns the account only inside a transaction where set_config stamped
// fundhub.actor = 'staff' — exactly what fundhub_is_staff() checks. The REAL
// asStaff()/withPartnerScope() code runs against it, so this proves the sweeper
// now asks through the staff scope. It does NOT prove the live policy, grants or
// role; src/workflows/clickfunnels-analytics-sweeper.pg.test.mjs does that
// against a real Postgres as the unprivileged app role, and the read-only SQL on
// the board checks the live table after the first 07:15 UTC pass.

import { test, describe } from "node:test";
import assert from "node:assert";
import { sweep, activeOrgs, ACTIVE_ORGS_SQL, SWEEP_CRON } from "./clickfunnels-analytics-sweeper.mjs";

const ORG = "00000000-0000-0000-0000-00000000c0f1";

/* A pool whose analytics_connections obeys "staff only". */
function staffOnlyPool() {
  const log = [];
  const pool = () => ({
    connect: async () => {
      let actor = "";
      return {
        query: async (sql, params) => {
          log.push(String(sql));
          if (/set_config\('fundhub\.actor'/.test(sql)) actor = params[0];
          if (/^(COMMIT|ROLLBACK)$/.test(String(sql).trim())) actor = ""; // set_config(..., true) dies with the transaction
          if (/FROM analytics_connections/i.test(sql)) {
            return { rows: actor === "staff" ? [{ org_id: ORG }] : [] };
          }
          return { rows: [] };
        },
        release: () => {}
      };
    }
  });
  return { pool, log };
}

/* A plain connection: no actor is ever stamped, so the policy hides the row. */
const plainDb = { query: async () => ({ rows: [] }) };

describe("the night pull can see the ClickFunnels account", () => {
  test("it lists accounts through the staff scope, so row security lets the account through", async () => {
    const { pool, log } = staffOnlyPool();
    const synced = [];
    const out = await sweep({
      db: plainDb, // the old code listed with this and saw nothing
      pool,
      syncOrg: async ({ orgId, days, deps }) => {
        synced.push({ orgId, days, pool: deps.pool });
        return { ok: true, pagesSynced: 12 };
      }
    });

    assert.equal(out.orgs, 1, "the sweeper saw 0 accounts — it is asking with a plain connection again");
    assert.equal(out.synced, 1);
    assert.equal(out.pages, 12);
    assert.deepEqual(synced.map((s) => [s.orgId, s.days]), [[ORG, 30]]);
    assert.ok(log.some((s) => /set_config\('fundhub\.actor'/.test(s)), "the list was not read inside a staff-stamped transaction");
  });

  test("activeOrgs reads only active ClickFunnels rows", async () => {
    const { pool } = staffOnlyPool();
    assert.deepEqual(await activeOrgs({ pool }), [ORG]);
    assert.match(ACTIVE_ORGS_SQL, /platform = 'clickfunnels'/);
    assert.match(ACTIVE_ORGS_SQL, /connection_state = 'active'/);
  });

  test("the same query on a plain connection sees nothing — the reason it had to change", async () => {
    const rows = (await plainDb.query(ACTIVE_ORGS_SQL)).rows;
    assert.equal(rows.length, 0);
  });

  test("still a 07:15 UTC daily clock", () => {
    assert.equal(SWEEP_CRON, "15 7 * * *");
  });
});

describe("one org's failure is recorded, not thrown", () => {
  test("a failed pull and a missing connection are counted, and the pass finishes", async () => {
    const out = await sweep({
      listOrgs: async () => ["a", "b", "c"],
      syncOrg: async ({ orgId }) => {
        if (orgId === "a") return { ok: false, message: "ClickFunnels said 401" };
        if (orgId === "b") return { notFound: true };
        throw new Error("network down");
      }
    });
    assert.equal(out.orgs, 3);
    assert.equal(out.synced, 0);
    assert.equal(out.skipped, 1);
    assert.deepEqual(out.errors.map((e) => e.orgId), ["a", "c"]);
  });
});
