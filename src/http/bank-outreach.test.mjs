import { test } from "node:test";
import assert from "node:assert/strict";
import read from "../../api/read/bank-outreach.mjs";
import write from "../../api/bank-outreach.mjs";
import { fakeDb, makeRes, req, staffSession } from "../testing/handler-harness.mjs";

const call = async (handler, method, role, body) => {
  const db = fakeDb(role ? [staffSession({ role })] : []);
  const request = { ...req(method, { body }), url: method === "GET" ? "/api/read/bank-outreach" : "/api/bank-outreach" };
  if (!role) request.headers = {};
  const res = makeRes();
  await handler(request, res, { db });
  return { res, db };
};
test("outreach HTTP handlers refuse unsupported methods before sign-in", async () => {
  assert.equal((await call(read, "POST")).res.statusCode, 405);
  assert.equal((await call(write, "GET")).res.statusCode, 405);
});
test("outreach endpoints require real sessions", async () => {
  assert.equal((await call(read, "GET")).res.statusCode, 401);
  assert.equal((await call(write, "POST")).res.statusCode, 401);
});
test("unrelated staff and account roles never query outreach records", async () => {
  for (const role of ["closer", "funding_advisor", "setter", "csm", "inquiry_specialist", "client", "partner", "affiliate"]) {
    for (const [handler, method] of [[read, "GET"], [write, "POST"]]) {
      const { db, res } = await call(handler, method, role, { action: "import", csv: "x" });
      assert.equal(res.statusCode, 403, `${role}: ${method}`);
      assert.equal(db.calls.some(({ sql }) => /outreach_/.test(sql)), false);
    }
  }
});
