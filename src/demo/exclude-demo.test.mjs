import { test } from "node:test";
import assert from "node:assert/strict";
import { andNotDemo, crmDemoFilterSQL, andNotTestAddress } from "./exclude-demo.mjs";
import { classifyVisitor } from "../slo/visitor.mjs";
test("andNotDemo", () => assert.match(andNotDemo("c"), /is_demo/));
test("crmDemoFilterSQL", () => {
  assert.match(crmDemoFilterSQL("c", { demoMode: false }), /is_demo/);
  assert.equal(crmDemoFilterSQL("c", { demoMode: true }), "");
});

/* andNotTestAddress is the SQL twin of classifyVisitor's email rule. Read the
   domains and the pattern back out of the SQL and check both agree on the same
   addresses, so the twin cannot drift from the original unnoticed. */
test("andNotTestAddress agrees with classifyVisitor on who is a test address", () => {
  const sql = andNotTestAddress("c");
  const domains = [...sql.matchAll(/'([a-z.]+\.(?:ai|com|net|org))'/g)].map((m) => m[1]);
  const pattern = new RegExp(sql.match(/~ '([^']+)'/)[1]);
  const sqlSaysTest = (email) => {
    const e = email.toLowerCase();
    const local = e.split("@")[0];
    const domain = e.split("@")[1] || "";
    return domains.includes(domain) || pattern.test(local);
  };
  for (const email of [
    "e2e.slo.1@fundhub.ai", "someone@example.com", "x+e2e@test.fundhub.ai", "a+sim3@gmail.com",
    "pat.test@gmail.com", "chris@gmail.com", "owner@thedrinklabs.com", "latest@neuralytica.ai", "testing@acme.com"
  ]) {
    const visitorSaysTest = classifyVisitor({ email }).actor === "agent";
    assert.equal(sqlSaysTest(email), visitorSaysTest, email);
  }
  assert.match(sql, /coalesce\(c\.email, ''\)/, "a client with no email must be kept, not dropped by a NULL");
});
