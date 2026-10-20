import { test } from "node:test";
import assert from "node:assert/strict";
import { restrictedStaffAllowed } from "./restricted-staff.mjs";
import { requireAuth, authenticate } from "./middleware/requireAuth.mjs";
import { requirePrincipal } from "./middleware/requirePrincipal.mjs";
import { requireDashboardAccess } from "./dashboard-auth.mjs";
import { fakeDb, staffSession, makeRes, req } from "../testing/handler-harness.mjs";
import { staffRoleKey } from "../auth/company-email.mjs";

const rep = { role: "outbound_rep" };
const database = () => fakeDb([staffSession({ role: "outbound_rep" })]);
function request(path, method = "GET") { return { ...req(method), url: path }; }

test("limited seats use the existing invitation role label", () => {
  assert.equal(staffRoleKey("Outbound Rep"), "outbound_rep");
});
test("outbound seat can enter only outreach and read its session/brand", () => {
  for (const path of ["/api/auth/session", "/api/org-brand", "/api/read/bank-outreach", "/.netlify/functions/api/read/bank-outreach/?id=one"]) {
    assert.equal(restrictedStaffAllowed(request(path), rep), true, path);
  }
  assert.equal(restrictedStaffAllowed(request("/api/bank-outreach", "POST"), rep), true);
  for (const path of ["/api/dashboard/clients", "/api/tasks", "/api/read/lenders", "/api/messages", "/api/read/client-progress", "/api/read/search", "/api/read/bank-outreach/other", "/api/bank-outreach?path=read/lenders"]) {
    assert.equal(restrictedStaffAllowed(request(path), rep), false, path);
  }
  assert.equal(restrictedStaffAllowed(request("/api/org-brand", "PUT"), rep), false);
  assert.equal(restrictedStaffAllowed(request("/api/read/bank-outreach", "POST"), rep), false);
  assert.equal(restrictedStaffAllowed({}, rep), false);
  assert.equal(restrictedStaffAllowed(request("/api/tasks"), { role: "setter" }), true);
});
test("real staff session is refused at all three existing client entry gates", async () => {
  for (const gate of [
    (r, s, db) => requireAuth(r, s, { db }),
    (r, s, db) => requirePrincipal(r, s, ["staff"], { db }),
    (r, s, db) => requireDashboardAccess(r, s, { db })
  ]) {
    const db = database();
    const res = makeRes();
    const value = await gate(request("/api/dashboard/clients"), res, db);
    assert.equal(value, null);
    assert.equal(res.statusCode, 403);
    assert.equal(db.calls.some(({ sql }) => /FROM clients\b/.test(sql)), false);
  }
});
test("scoping cannot be bypassed with request role or company parameters", async () => {
  const r = request("/api/tasks?role=owner&org_id=another");
  r.staff = { role: "owner" };
  assert.equal(await authenticate(r, { db: database() }), null);
  assert.equal(r.authForbidden, true);
});
test("the same real outbound session authenticates for its own workspace", async () => {
  const r = request("/api/read/bank-outreach");
  const result = await requireAuth(r, makeRes(), { db: database() });
  assert.equal(result.role, "outbound_rep");
});
