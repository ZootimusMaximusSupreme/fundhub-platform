import { test } from "node:test";
import assert from "node:assert/strict";
import staffRoster from "../../api/read/staff.mjs";

const STAFF = { id: "owner-1", org_id: "org-1", role: "owner" };
const response = () => ({
  status(code) { this.code = code; return this; },
  json(body) { this.body = body; return this; }
});

function database(failure) {
  const rosterCalls = [];
  return {
    rosterCalls,
    async query(sql, params) {
      if (/SELECT demo_mode_enabled FROM orgs/.test(sql)) return { rows: [{ demo_mode_enabled: false }] };
      if (/SELECT count\(\*\)::int AS n\s+FROM staff s/.test(sql)) return { rows: [{ n: 0 }] };
      if (/SELECT s\.id, s\.name, s\.email, s\.role/.test(sql)) {
        rosterCalls.push({ sql, params });
        if (rosterCalls.length === 1) throw failure;
        return { rows: [{ id: "closer-1", name: "Dana", role: "closer", roles: ["closer"] }] };
      }
      throw new Error(`unexpected query: ${sql.slice(0, 70)}`);
    }
  };
}

test("staff roster falls back to primary roles only when the assignment table is missing", async () => {
  const db = database(Object.assign(
    new Error('relation "staff_role_assignments" does not exist'), { code: "42P01" }));
  const res = response();
  await staffRoster({ method: "GET", query: {} }, res, {
    db, requireAuth: async () => STAFF
  });
  assert.equal(res.code, 200);
  assert.deepEqual(res.body.items[0].roles, ["closer"]);
  assert.equal(db.rosterCalls.length, 2);
  assert.deepEqual(db.rosterCalls[0].params, db.rosterCalls[1].params);
  assert.equal(db.rosterCalls[1].params[3], STAFF.org_id);
  assert.match(db.rosterCalls[1].sql, /s\.org_id = \$4::uuid/);
  assert.match(db.rosterCalls[1].sql, /s\.removed_at IS NULL/);
  assert.match(db.rosterCalls[1].sql, /array_remove\(ARRAY\[NULLIF\(lower\(btrim\(s\.role\)\), ''\)\], NULL\) AS roles/);
  assert.doesNotMatch(db.rosterCalls[1].sql, /staff_role_assignments/);
});

test("staff roster does not hide other missing tables or permission errors", async () => {
  for (const [code, message] of [
    ["42P01", 'relation "staff" does not exist'],
    ["42501", 'permission denied for table staff_role_assignments']
  ]) {
    const db = database(Object.assign(new Error(message), { code }));
    const res = response();
    await staffRoster({ method: "GET", query: {} }, res, {
      db, requireAuth: async () => STAFF
    });
    assert.equal(res.code, 500);
    assert.equal(db.rosterCalls.length, 1);
  }
});
