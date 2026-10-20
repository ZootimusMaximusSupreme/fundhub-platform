import test, { after } from "node:test";
import assert from "node:assert/strict";
import { VERIFIED_SQL, NEXT_ACTION_SQL } from "./gap-bank-outreach.mjs";
import { HAS_DB, ORG, OTHER_ORG, closeShadowDb, runShadowSql, shadow, withShadows } from "./money-test-kit.mjs";

after(closeShadowDb);

const accountId = "aaaaaaaa-0000-4000-8000-000000000001";
const productId = "bbbbbbbb-0000-4000-8000-000000000001";
const lenderId = "cccccccc-0000-4000-8000-000000000001";
const programId = "dddddddd-0000-4000-8000-000000000001";
const facts = {
  minimum_score: 680, minimum_time_in_business_years: 2, minimum_revenue_threshold: 100000,
  bureaus_pulled: ["EX"], inquiry_tolerance: "Some", stated_income: false,
  eligible_states: ["AZ"], application_url: "https://bank.example/apply", paper_application_url: "unknown"
};

function query(sql, { account = {}, product = {}, lender = {}, contacts = [{}] } = {}) {
  const tables = [
    shadow("outreach_programs", [["id", "uuid"], ["org_id", "uuid"], ["key", "text"]], [
      { id: programId, org_id: ORG, key: "bank_relationships" }
    ]),
    shadow("outreach_accounts", [["id", "uuid"], ["org_id", "uuid"], ["program_id", "uuid"], ["name", "text"], ["status", "text"], ["next_action", "text"], ["next_due_at", "timestamptz"]], [
      { id: accountId, org_id: ORG, program_id: programId, name: "Example Bank", status: "engaged", next_action: "Call banker", next_due_at: "2026-10-21T14:00:00Z", ...account }
    ]),
    shadow("outreach_products", [["id", "uuid"], ["org_id", "uuid"], ["account_id", "uuid"], ["product_name", "text"], ["lender_table", "text"], ["facts", "jsonb"], ["evidence", "text"], ["verified_at", "timestamptz"], ["lender_id", "uuid"]], [
      { id: productId, org_id: ORG, account_id: accountId, product_name: "Business LOC", lender_table: "BizLOC_Stated", facts, evidence: "Banker email and terms", verified_at: "2026-10-19T14:00:00Z", lender_id: lenderId, ...product }
    ]),
    shadow("outreach_contacts", [["org_id", "uuid"], ["account_id", "uuid"], ["name", "text"], ["linkedin_url", "text"], ["email", "text"], ["phone", "text"]], contacts.map((c) => ({
      org_id: ORG, account_id: accountId, name: "Alex Banker", linkedin_url: null, email: "alex@bank.example", phone: null, ...c
    }))),
    shadow("lenders", [["id", "uuid"], ["org_id", "uuid"], ["name", "text"], ["product_name", "text"], ["lender_table", "text"], ["application_url", "text"], ["eligible_states", "text"], ["bureaus_pulled", "text"], ["minimum_time_in_business_years", "numeric"], ["minimum_revenue_threshold", "numeric"], ["stated_requirements", "text"], ["active", "boolean"]], [
      { id: lenderId, org_id: ORG, name: "Example Bank", product_name: "Business LOC", lender_table: "BizLOC_Stated", application_url: "https://bank.example/apply", eligible_states: "AZ", bureaus_pulled: "EX", minimum_time_in_business_years: 2, minimum_revenue_threshold: 100000, stated_requirements: "Minimum credit score 680. Inquiry tolerance: Some. Stated income: no.", active: true, ...lender }
    ])
  ];
  return withShadows(sql, tables);
}

test("saved result SQL passes a real linked product and fails cross-org, missing contact, and mismatched application", { skip: !HAS_DB && "DATABASE_URL not set" }, async () => {
  const good = (await runShadowSql(query(VERIFIED_SQL))).rows[0];
  assert.equal(good.total, 1);
  assert.equal(good.broken, 0);
  for (const fixture of [
    { lender: { org_id: OTHER_ORG } },
    { lender: { application_url: "https://wrong.example/apply" } },
    { lender: { eligible_states: "SC" } },
    { lender: { bureaus_pulled: "TU" } },
    { lender: { minimum_time_in_business_years: 3 } },
    { lender: { minimum_revenue_threshold: 200000 } },
    { lender: { stated_requirements: "Minimum credit score 700. Inquiry tolerance: Some. Stated income: no." } },
    { product: { facts: { ...facts, inquiry_tolerance: "None" } } },
    { product: { facts: { ...facts, stated_income: true } } },
    { product: { facts: { ...facts, minimum_score: "680" } } },
    { product: { facts: { ...facts, bureaus_pulled: [] } } },
    { product: { facts: { ...facts, eligible_states: "AZ" } } },
    { contacts: [] },
    { product: { evidence: "" } },
    { product: { facts: { ...facts, minimum_score: null } } }
  ]) {
    const result = (await runShadowSql(query(VERIFIED_SQL, fixture))).rows[0];
    assert.equal(result.broken, 1, JSON.stringify(fixture));
  }
});

test("active work without a next action is red; paused work is not counted", { skip: !HAS_DB && "DATABASE_URL not set" }, async () => {
  assert.deepEqual((await runShadowSql(query(NEXT_ACTION_SQL))).rows[0], { active: 1, missing: 0 });
  assert.deepEqual((await runShadowSql(query(NEXT_ACTION_SQL, { account: { next_action: null } }))).rows[0], { active: 1, missing: 1 });
  assert.deepEqual((await runShadowSql(query(NEXT_ACTION_SQL, { account: { status: "paused", next_action: null } }))).rows[0], { active: 0, missing: 0 });
});
