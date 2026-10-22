import test, { after } from "node:test";
import assert from "node:assert/strict";
import { VERIFIED_SQL, NEXT_ACTION_SQL } from "./gap-bank-outreach.mjs";
import { VERIFIED_SQL as HOURLY_VERIFIED_SQL } from "../beats/beat-bank-outreach.mjs";
import { HAS_DB, ORG, OTHER_ORG, closeShadowDb, runShadowSql, shadow, withShadows } from "./money-test-kit.mjs";
import { lenderExtras, lenderValues } from "../../outreach/model.mjs";

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
const evidence = "Banker email and terms";
const expectedNotes = lenderValues(
  { org_id: ORG, name: "Example Bank" },
  { lender_table: "BizLOC_Stated", product_name: "Business LOC", evidence },
  facts,
  { name: "Alex Rep" }
)[10];

function query(sql, { account = {}, product = {}, lender = {}, contacts = [{}] } = {}) {
  const tables = [
    shadow("outreach_programs", [["id", "uuid"], ["org_id", "uuid"], ["key", "text"]], [
      { id: programId, org_id: ORG, key: "bank_relationships" }
    ]),
    shadow("outreach_accounts", [["id", "uuid"], ["org_id", "uuid"], ["program_id", "uuid"], ["name", "text"], ["status", "text"], ["next_action", "text"], ["next_due_at", "timestamptz"]], [
      { id: accountId, org_id: ORG, program_id: programId, name: "Example Bank", status: "engaged", next_action: "Call banker", next_due_at: "2026-10-21T14:00:00Z", ...account }
    ]),
    shadow("outreach_products", [["id", "uuid"], ["org_id", "uuid"], ["account_id", "uuid"], ["product_name", "text"], ["lender_table", "text"], ["facts", "jsonb"], ["evidence", "text"], ["verified_at", "timestamptz"], ["lender_id", "uuid"]], [
      { id: productId, org_id: ORG, account_id: accountId, product_name: "Business LOC", lender_table: "BizLOC_Stated", facts, evidence, verified_at: "2026-10-19T14:00:00Z", lender_id: lenderId, ...product }
    ]),
    shadow("outreach_contacts", [["org_id", "uuid"], ["account_id", "uuid"], ["name", "text"], ["linkedin_url", "text"], ["email", "text"], ["phone", "text"]], contacts.map((c) => ({
      org_id: ORG, account_id: accountId, name: "Alex Banker", linkedin_url: null, email: "alex@bank.example", phone: null, ...c
    }))),
    shadow("lenders", [["id", "uuid"], ["org_id", "uuid"], ["name", "text"], ["product_name", "text"], ["lender_table", "text"], ["application_url", "text"], ["eligible_states", "text"], ["bureaus_pulled", "text"], ["minimum_time_in_business_years", "numeric"], ["minimum_revenue_threshold", "numeric"], ["stated_requirements", "text"], ["notes", "text"], ["active", "boolean"],
      // The twenty columns a pushed product fills beyond the base ones, typed as in db/migrations/138_lenders.sql.
      ["double_pull", "text"], ["relationship_required", "text"], ["requires_account_opening", "text"], ["minimum_deposit", "numeric(14,2)"],
      ["prequal_soft_pull", "text"], ["business_bureau_pulled", "text"], ["underwriter_interaction", "text"], ["intro_offers", "text"],
      ["multiple_llc_allowed", "text"], ["application_method", "text"], ["typical_approval_range", "numeric(14,2)"], ["apr_range_pct", "numeric(8,4)"],
      ["repayment_terms_months", "integer"], ["funding_speed", "text"], ["average_starting_loc", "numeric(14,2)"], ["max_known_loc", "numeric(14,2)"],
      ["draw_period_renewal", "text"], ["docs_requested", "text"], ["collateral_required", "text"], ["loc_type", "text"]], [
      { id: lenderId, org_id: ORG, name: "Example Bank", product_name: "Business LOC", lender_table: "BizLOC_Stated", application_url: "https://bank.example/apply", eligible_states: "AZ", bureaus_pulled: "EX", minimum_time_in_business_years: 2, minimum_revenue_threshold: 100000, stated_requirements: "Minimum credit score 680. Inquiry tolerance: Some. Stated income: no.", notes: expectedNotes, active: true, ...lender }
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
    { lender: { notes: null } },
    { lender: { notes: "Banker email and terms\nPaper application: https://wrong.example/paper" } },
    { product: { facts: { ...facts, paper_application_url: "https://bank.example/paper" } } },
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

test("notes match the canonical evidence and secondary paper URL even when an online URL exists", { skip: !HAS_DB && "DATABASE_URL not set" }, async () => {
  const paper = "https://bank.example/paper";
  const amendedFacts = { ...facts, paper_application_url: paper };
  const notes = lenderValues(
    { org_id: ORG, name: "Example Bank" },
    { lender_table: "BizLOC_Stated", product_name: "Business LOC", evidence },
    amendedFacts,
    { name: "Alex Rep" }
  )[10];
  const result = (await runShadowSql(query(VERIFIED_SQL, {
    product: { facts: amendedFacts }, lender: { notes }
  }))).rows[0];
  assert.deepEqual(result, { total: 1, broken: 0 });
});

test("active work without a next action is red; paused work is not counted", { skip: !HAS_DB && "DATABASE_URL not set" }, async () => {
  assert.deepEqual((await runShadowSql(query(NEXT_ACTION_SQL))).rows[0], { active: 1, missing: 0 });
  assert.deepEqual((await runShadowSql(query(NEXT_ACTION_SQL, { account: { next_action: null } }))).rows[0], { active: 1, missing: 1 });
  assert.deepEqual((await runShadowSql(query(NEXT_ACTION_SQL, { account: { status: "paused", next_action: null } }))).rows[0], { active: 0, missing: 0 });
});

// A personal product has no years-in-business or revenue to ask: the server stores "n/a" and Lenders keeps NULL.
const personalFacts = { ...facts, minimum_time_in_business_years: "n/a", minimum_revenue_threshold: "n/a" };
const personal = (over = {}) => ({
  product: { lender_table: "PersonalLoans", facts: personalFacts, ...(over.product || {}) },
  lender: { lender_table: "PersonalLoans", minimum_time_in_business_years: null, minimum_revenue_threshold: null, ...(over.lender || {}) }
});

test("n/a on the two business-only keys is a sound personal product, in the morning check and the hourly beat", { skip: !HAS_DB && "DATABASE_URL not set" }, async () => {
  for (const sql of [VERIFIED_SQL, HOURLY_VERIFIED_SQL]) {
    assert.deepEqual((await runShadowSql(query(sql, personal()))).rows[0], { total: 1, broken: 0 });
    // Only one of the two may be n/a; unknown still counts for the other.
    const mixed = personal({ product: { facts: { ...personalFacts, minimum_revenue_threshold: "unknown" } } });
    assert.deepEqual((await runShadowSql(query(sql, mixed))).rows[0], { total: 1, broken: 0 });
  }
});

test("n/a is red anywhere unknown would be wrong: another key, a spelling variant, or a Lenders row that kept a number", { skip: !HAS_DB && "DATABASE_URL not set" }, async () => {
  const bad = [
    personal({ product: { facts: { ...personalFacts, minimum_score: "n/a" } } }),
    personal({ product: { facts: { ...personalFacts, stated_income: "n/a" } } }),
    personal({ product: { facts: { ...personalFacts, eligible_states: "n/a" } } }),
    personal({ product: { facts: { ...personalFacts, bureaus_pulled: "n/a" } } }),
    personal({ product: { facts: { ...personalFacts, application_url: "n/a", paper_application_url: "n/a" } } }),
    personal({ product: { facts: { ...personalFacts, minimum_time_in_business_years: "N/A" } } }),
    personal({ product: { facts: { ...personalFacts, minimum_revenue_threshold: "na" } } }),
    personal({ product: { facts: { ...personalFacts, minimum_time_in_business_years: "" } } }),
    personal({ lender: { minimum_time_in_business_years: 3 } }),
    personal({ lender: { minimum_revenue_threshold: 100000 } })
  ];
  for (const fixture of bad) {
    for (const sql of [VERIFIED_SQL, HOURLY_VERIFIED_SQL]) {
      assert.equal((await runShadowSql(query(sql, fixture))).rows[0].broken, 1, JSON.stringify(fixture));
    }
  }
});

/* ---- Answers beyond the nine base facts: each one a pushed product saved must match its Lenders column ---- */
const EVERY = { double_pull: false, relationship_required: false, requires_account_opening: false, minimum_deposit: "unknown", prequal_soft_pull: true };
// A pushed personal loan: the facts the product saved and the Lenders row the push wrote from them.
const loanFacts = { ...personalFacts, ...EVERY, application_method: "Online", typical_amount: 15000, apr_pct: 11.5, repayment_months: 36, funding_speed: "Next business day" };
const loanExtras = { double_pull: "No", relationship_required: "No", requires_account_opening: "No", minimum_deposit: null, prequal_soft_pull: "Yes", application_method: "Online", typical_approval_range: 15000, apr_range_pct: 11.5, repayment_terms_months: 36, funding_speed: "Next business day" };
const loan = (over = {}) => personal({
  product: { facts: loanFacts, ...(over.product || {}) },
  lender: { ...loanExtras, ...(over.lender || {}) }
});
// A pushed online business card.
const cardFacts = { ...facts, ...EVERY, double_pull: true, requires_account_opening: true, minimum_deposit: 250.5, business_bureau_pulled: "D&B/SBFE", underwriter: "Underwritten by Elan", intro_offers: "0% intro APR - 12 months", multiple_llc_allowed: "unknown" };
const cardExtras = { double_pull: "Yes", relationship_required: "No", requires_account_opening: "Yes", minimum_deposit: 250.5, prequal_soft_pull: "Yes", business_bureau_pulled: "D&B/SBFE", underwriter_interaction: "Underwritten by Elan", intro_offers: "0% intro APR - 12 months", multiple_llc_allowed: null };
const card = (over = {}) => ({
  product: { lender_table: "OnlineBizCC", facts: cardFacts, ...(over.product || {}) },
  lender: { lender_table: "OnlineBizCC", ...cardExtras, ...(over.lender || {}) }
});
const both = [VERIFIED_SQL, HOURLY_VERIFIED_SQL];
const brokenOf = async (sql, fixture) => (await runShadowSql(query(sql, fixture))).rows[0];

test("the writer's own Lenders columns for a pushed product are sound, in the morning check and the hourly beat", { skip: !HAS_DB && "DATABASE_URL not set" }, async () => {
  const fromWriter = {
    product: { lender_table: "PersonalLoans", facts: loanFacts },
    lender: { lender_table: "PersonalLoans", minimum_time_in_business_years: null, minimum_revenue_threshold: null, ...lenderExtras("PersonalLoans", loanFacts) }
  };
  // What the writer sends is the hand-written expectation, so the oracle and the writer agree.
  assert.deepEqual(lenderExtras("PersonalLoans", loanFacts), loanExtras);
  for (const sql of both) assert.deepEqual(await brokenOf(sql, fromWriter), { total: 1, broken: 0 });
});

test("a pushed personal loan whose rate, term and other answers match its Lenders row is sound; a hand-edited Lenders column is red", { skip: !HAS_DB && "DATABASE_URL not set" }, async () => {
  for (const sql of both) {
    assert.deepEqual(await brokenOf(sql, loan()), { total: 1, broken: 0 });
    for (const lender of [
      { apr_range_pct: 12.25 },
      { apr_range_pct: null },
      { repayment_terms_months: 48 },
      { typical_approval_range: 15000.01 },
      { application_method: "Branch" },
      { funding_speed: null },
      { minimum_deposit: 100 }, // the banker said "unknown": Lenders must keep NULL
      { prequal_soft_pull: "No" },
      { double_pull: "Yes" }
    ]) {
      assert.equal((await brokenOf(sql, loan({ lender }))).broken, 1, JSON.stringify(lender));
    }
    // The saved answer changed but the Lenders row did not.
    for (const facts_ of [{ apr_pct: 9 }, { repayment_months: 60 }, { application_method: "Phone" }, { prequal_soft_pull: false }]) {
      assert.equal((await brokenOf(sql, loan({ product: { facts: { ...loanFacts, ...facts_ } } }))).broken, 1, JSON.stringify(facts_));
    }
  }
});

test("a pushed business card with double_pull true is red when Lenders says No, Yes-for-false, or blank", { skip: !HAS_DB && "DATABASE_URL not set" }, async () => {
  for (const sql of both) {
    assert.deepEqual(await brokenOf(sql, card()), { total: 1, broken: 0 });
    for (const lender of [
      { double_pull: "No" },
      { double_pull: null },
      { double_pull: "yes" },
      { relationship_required: "Yes" },
      { minimum_deposit: 250 },
      { business_bureau_pulled: "Equifax Business" },
      { underwriter_interaction: null },
      { intro_offers: "No intro offer" },
      { multiple_llc_allowed: "Yes" } // "unknown" never becomes a yes
    ]) {
      assert.equal((await brokenOf(sql, card({ lender }))).broken, 1, JSON.stringify(lender));
    }
    assert.equal((await brokenOf(sql, card({ product: { facts: { ...cardFacts, double_pull: false } } }))).broken, 1);
    assert.equal((await brokenOf(sql, card({ product: { facts: { ...cardFacts, double_pull: "unknown" } } }))).broken, 1);
  }
});

test("unknown and n/a mean NULL in Lenders for yes/no, number and text answers alike", { skip: !HAS_DB && "DATABASE_URL not set" }, async () => {
  const unknownCard = { ...cardFacts, double_pull: "unknown", minimum_deposit: "unknown", underwriter: "n/a", intro_offers: "unknown" };
  const nulls = { double_pull: null, minimum_deposit: null, underwriter_interaction: null, intro_offers: null };
  for (const sql of both) {
    assert.deepEqual(await brokenOf(sql, card({ product: { facts: unknownCard }, lender: nulls })), { total: 1, broken: 0 });
    assert.equal((await brokenOf(sql, card({ product: { facts: unknownCard }, lender: { ...nulls, underwriter_interaction: "n/a" } }))).broken, 1);
    assert.equal((await brokenOf(sql, card({ product: { facts: unknownCard }, lender: { ...nulls, double_pull: "No" } }))).broken, 1);
  }
});

test("an older product with only the nine base facts stays sound even when its Lenders row holds values in the extra columns", { skip: !HAS_DB && "DATABASE_URL not set" }, async () => {
  for (const sql of both) {
    assert.deepEqual(await brokenOf(sql, { lender: { ...cardExtras, ...loanExtras, apr_range_pct: 9.99 } }), { total: 1, broken: 0 });
    // Only the keys the product saved are compared: a loan that never saved apr_pct ignores the APR column.
    const { apr_pct, ...withoutApr } = loanFacts;
    assert.deepEqual(await brokenOf(sql, loan({ product: { facts: withoutApr }, lender: { apr_range_pct: 77 } })), { total: 1, broken: 0 });
    assert.equal((await brokenOf(sql, loan({ product: { facts: withoutApr }, lender: { repayment_terms_months: 1 } }))).broken, 1);
  }
});
