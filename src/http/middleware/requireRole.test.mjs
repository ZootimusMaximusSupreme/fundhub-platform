import { test } from "node:test";
import assert from "node:assert";
import { requireRole, hasRole, SUPER_ROLES } from "./requireRole.mjs";
import { newToken } from "../../auth/session.mjs";

function fakeDb({ role = "closer", live = true } = {}) {
  return {
    async query() {
      if (!live) return { rows: [] };
      return { rows: [{
        session_id: "sess-1", expires_at: new Date(Date.now() + 6e8),
        staff_id: "staff-1", org_id: "org-1", role,
        email: "a@b.com", name: "A", status: "active", active_flag: null
      }] };
    }
  };
}

function fakeRes() {
  const res = { statusCode: null, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

const authed = () => ({ headers: { authorization: `Bearer ${newToken()}` } });

// --------------------------------------------------------------- hasRole

test("hasRole matches the staff role, case- and whitespace-insensitively", () => {
  assert.equal(hasRole({ role: "closer" }, ["closer"]), true);
  assert.equal(hasRole({ role: "CLOSER" }, ["closer"]), true);
  assert.equal(hasRole({ role: "  closer  " }, ["Closer"]), true);
  assert.equal(hasRole({ role: "closer" }, "closer"), true, "bare string accepted");
  assert.equal(hasRole({ role: "closer" }, ["admin", "closer"]), true);
  assert.equal(hasRole({ role: "closer" }, ["admin"]), false);
});

test("owner passes every gate without being listed", () => {
  assert.deepEqual(SUPER_ROLES, ["owner"]);
  assert.equal(hasRole({ role: "owner" }, ["admin"]), true);
  assert.equal(hasRole({ role: "owner" }, ["inquiry_specialist"]), true);
  assert.equal(hasRole({ role: "OWNER" }, ["anything"]), true);
  assert.equal(hasRole({ role: "closer", roles: ["closer", "owner"] }, ["anything"]), false);
});

test("an assigned role passes, but an unrelated role stays denied", () => {
  assert.equal(hasRole({ role: "closer", roles: ["closer", "setter"] }, ["setter"]), true);
  assert.equal(hasRole({ role: "closer", roles: ["closer", "setter"] }, ["admin"]), false);
});

test("external and restricted primary identities cannot borrow a staff role", () => {
  for (const role of ["client", "affiliate", "partner", "outbound_rep"]) {
    assert.equal(hasRole({ role, roles: ["owner"] }, ["admin"]), false);
  }
});

test("a staff member with no role passes nothing", () => {
  for (const role of [null, undefined, "", "   "]) {
    assert.equal(hasRole({ role }, ["closer"]), false, `role=${JSON.stringify(role)}`);
    assert.equal(hasRole({ role }, []), false, "not even an empty requirement");
  }
});

test("hasRole is false for a missing staff object rather than throwing", () => {
  assert.equal(hasRole(null, ["closer"]), false);
  assert.equal(hasRole(undefined, ["closer"]), false);
});

test("an empty allow-list means any staff member with a role", () => {
  assert.equal(hasRole({ role: "closer" }, []), true);
});

// ------------------------------------------------------------ requireRole

test("requireRole passes a matching role straight through", async () => {
  const res = fakeRes();
  const staff = await requireRole("closer")(authed(), res, { db: fakeDb({ role: "closer" }) });
  assert.equal(staff.role, "closer");
  assert.equal(res.statusCode, null);
});

test("requireRole accepts an assigned role from the resolved session", async () => {
  const res = fakeRes();
  const db = fakeDb({ role: "closer" });
  const original = db.query.bind(db);
  db.query = async (sql, params) => {
    const result = await original(sql, params);
    if (/WITH live AS/.test(sql)) result.rows[0].assigned_roles = ["setter"];
    return result;
  };
  const staff = await requireRole("setter")(authed(), res, { db });
  assert.deepEqual(staff.roles, ["closer", "setter"]);
  assert.equal(res.statusCode, null);
});

test("requireRole accepts a list, varargs or an array", async () => {
  for (const gate of [requireRole("admin", "closer"), requireRole(["admin", "closer"])]) {
    const res = fakeRes();
    const staff = await gate(authed(), res, { db: fakeDb({ role: "closer" }) });
    assert.equal(staff.role, "closer");
    assert.equal(res.statusCode, null);
  }
});

test("the wrong role is 403, and says what was required", async () => {
  const res = fakeRes();
  const staff = await requireRole("admin")(authed(), res, { db: fakeDb({ role: "closer" }) });
  assert.equal(staff, null);
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, { ok: false, error: "forbidden", required: ["admin"] });
});

test("no session is 401, not 403 — the two answers mean different things", async () => {
  const res = fakeRes();
  const staff = await requireRole("admin")({ headers: {} }, res, { db: fakeDb() });
  assert.equal(staff, null);
  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { ok: false, error: "unauthorized" });
});

test("an expired session is 401 even when the role would have matched", async () => {
  const res = fakeRes();
  await requireRole("closer")(authed(), res, { db: fakeDb({ role: "closer", live: false }) });
  assert.equal(res.statusCode, 401);
});

test("owner reaches an admin-gated route", async () => {
  const res = fakeRes();
  const staff = await requireRole("admin")(authed(), res, { db: fakeDb({ role: "owner" }) });
  assert.equal(staff.role, "owner");
  assert.equal(res.statusCode, null);
});

test("the 403 body carries no session or identity detail", async () => {
  const res = fakeRes();
  await requireRole("admin")(authed(), res, { db: fakeDb({ role: "closer" }) });
  const blob = JSON.stringify(res.body);
  assert.ok(!blob.includes("staff-1"));
  assert.ok(!blob.includes("a@b.com"));
  assert.ok(!blob.includes("sess-1"));
});
