import { test } from "node:test";
import assert from "node:assert/strict";
import { setStaffRoles } from "./staff-role-assignments.mjs";
import { hashToken } from "./session.mjs";
const actor = { id: "owner", org_id: "org", role: "owner" };
test("additional jobs do not accept browser authority or elevated jobs", async () => {
  let reads = 0;
  const db = { async query() { reads++; throw new Error("must not read"); } };
  for (const role of ["setter", "client", "partner"]) {
    assert.equal((await setStaffRoles(db, { actor: { ...actor, role }, token: "fixture",
      staffId: "target", role: "closer", roles: ["setter"] })).status, 403);
  }
  for (const roles of [["owner"], ["admin"], ["made_up"], "setter", null]) {
    assert.equal((await setStaffRoles(db, { actor, token: "fixture",
      staffId: "target", role: "closer", roles })).status, 400);
  }
  assert.equal(reads, 0);
});
test("role writes send a token hash to the narrow atomic operation, never a caller actor id", async () => {
  const calls = [];
  const db = { async query(sql, args) { calls.push({ sql, args });
    return { rows: [{ result: { ok: true, staff: { roles: ["closer", "setter"] } } }] }; } };
  assert.equal((await setStaffRoles(db, { actor, token: "fixture", staffId: "target",
    role: "closer", roles: ["setter", "setter"] })).ok, true);
  assert.deepEqual(calls[0].args, [hashToken("fixture"), "target", "closer", ["setter"]]);
  assert.match(calls[0].sql, /public\.set_staff_role_assignments/);
  assert(!calls[0].args.includes("fixture"));
});
