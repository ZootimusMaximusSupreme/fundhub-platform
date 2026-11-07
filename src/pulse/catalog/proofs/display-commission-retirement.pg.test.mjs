import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import pg from "pg";
import { isLocalScratchDatabaseUrl } from "../../../verification/scratch-guard.mjs";
import { DISPLAY_RESULT_CONTRACTS } from "./display-saved-result.mjs";

const ORG = "11111111-1111-4111-8111-111111111111";
const CUTOFF = "2026-10-30T00:00:00.000Z";
const SQL = DISPLAY_RESULT_CONTRACTS.find((entry) => entry.control.startsWith("Commission rule 'Close v<N>"))?.sql;

const oldRule = (overrides = {}) => ({
  id: "22222222-2222-4222-8222-222222222222", org_id: ORG, name: "Closer funding rule",
  product_id: null, role: "closer", staff_id: null, basis: "back_end", stacking: "base",
  effective_from: "2026-08-20T00:00:00.000Z", effective_to: CUTOFF,
  notes: "Owner-set 2026-08-20.", ...overrides
});
const nextRule = (overrides = {}) => ({
  ...oldRule(), id: "33333333-3333-4333-8333-333333333333",
  effective_from: CUTOFF, effective_to: null, notes: "Owner approved new rate.", ...overrides
});

describe("commission rule closeout proof against real scratch Postgres", {
  skip: isLocalScratchDatabaseUrl(process.env.DATABASE_URL) ? false : "requires local scratch Postgres"
}, () => {
  let db;
  before(async () => {
    assert.ok(SQL, "the catalog must keep the commission closeout contract");
    db = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();
  });
  after(async () => { await db?.end(); });

  async function judge(rows) {
    // The CTE shadows the table without inserting or changing a real commission rule.
    const fixture = `WITH commission_rules AS (
      SELECT (r->>'id')::uuid AS id, (r->>'org_id')::uuid AS org_id,
             r->>'name' AS name, (r->>'product_id')::uuid AS product_id,
             r->>'role' AS role, (r->>'staff_id')::uuid AS staff_id,
             r->>'basis' AS basis, r->>'stacking' AS stacking,
             (r->>'effective_from')::timestamptz AS effective_from,
             (r->>'effective_to')::timestamptz AS effective_to,
             r->>'notes' AS notes
        FROM jsonb_array_elements($2::jsonb) r
    )`;
    return (await db.query(`${fixture}\n${SQL}`, [ORG, JSON.stringify(rows)])).rows[0];
  }

  test("a same-boundary replacement with a reason passes; a missing or reasonless replacement fails", async () => {
    assert.deepEqual(await judge([oldRule(), nextRule()]), { sample_count: 1, bad_count: 0 });
    assert.deepEqual(await judge([oldRule()]), { sample_count: 1, bad_count: 1 });
    assert.deepEqual(await judge([oldRule(), nextRule({ notes: "" })]), { sample_count: 1, bad_count: 1 });
  });

  test("an explicit dated owner retirement passes; a wrong date or empty reason fails", async () => {
    const retired = "Owner-set 2026-08-20. Owner-retired effective 2026-10-30 by migration 531; no closer commission on amount funded.";
    assert.deepEqual(await judge([oldRule({ notes: retired })]), { sample_count: 1, bad_count: 0 });
    assert.deepEqual(await judge([oldRule({ notes: retired.replace("2026-10-30", "2026-10-29") })]), { sample_count: 1, bad_count: 1 });
    assert.deepEqual(await judge([oldRule({ notes: retired.replace("; no closer commission on amount funded.", "; ") })]), { sample_count: 1, bad_count: 1 });
    assert.deepEqual(await judge([oldRule({ notes: retired }), nextRule({ notes: "" })]),
      { sample_count: 1, bad_count: 1 }, "the retirement note cannot excuse a broken replacement");
  });
});
