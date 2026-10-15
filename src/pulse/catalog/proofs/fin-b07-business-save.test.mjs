// Practice test for the staff approval form's "Business fields" row: name, street, city, state, ZIP, EIN,
// incorporated month, extra owner. The REAL parser and saver (api/soft-pull-approve.mjs) run against a
// stand-in `businesses` table that holds the real columns, and what they saved is judged by the EXACT
// live SQL of the display check (fin-b07-business-fields).
//
// The live SQL reads rows that were already saved. It cannot see a field the form dropped before the
// row was written, or a rule that stopped being asked, so this holds, directly:
//   * every field typed lands on the saved row, in the shape the check expects (state in capitals, the
//     EIN as NN-NNNNNNN, the incorporated month, the age in months counted from it);
//   * each of street, city, state, ZIP, EIN and the incorporated month is refused when missing, and a
//     state that is not two letters or a month in the future is refused;
//   * the extra owner is kept when typed and saved as nothing when blank;
//   * saving again replaces the form's own businesses and never touches another form's.

import assert from "node:assert/strict";
import test from "node:test";

import { parseSoftPullBusinesses, replaceSoftPullBusinesses } from "../../../../api/soft-pull-approve.mjs";
import { ORG, contractSql, id } from "./fin-b07-case-runner.mjs";
import { UUID_DEFAULT, makeStandIn } from "./fin-b07-sql-kit.mjs";

const CLIENT = id(1);

const typed = (extra = {}) => ({
  name: "  Whitfield Holdings LLC ", address_line1: "12 Main St", city: "Phoenix", state: "az", postal_code: "85001",
  ein: "123456789", incorporated_date: "2020-03", extra_owner_name: "  Pat Lee ", ...extra,
});

function world() {
  const standIn = makeStandIn(["businesses", "clients"], {
    defaults: { businesses: { id: UUID_DEFAULT, created_at: "(datetime('now'))", updated_at: "(datetime('now'))" } },
  });
  standIn.insert("clients", { id: CLIENT, org_id: ORG, first_name: "Dana", last_name: "Whitfield", is_demo: false });
  return standIn;
}

const save = async (standIn, rows) => replaceSoftPullBusinesses(standIn.pg(), { orgId: ORG, clientId: CLIENT, businesses: parseSoftPullBusinesses(rows) });
const judged = (standIn) => standIn.run(contractSql("fin-b07-business-fields"), ORG);

test("every field typed lands on the saved row in the shape the check expects, and the check reads it clean", async () => {
  const standIn = world();
  try {
    await save(standIn, [typed()]);
    const [row] = standIn.rows("businesses");
    assert.equal(row.name, "Whitfield Holdings LLC", "the name is trimmed");
    assert.equal(row.entity_data.source, "soft_pull_approve");
    assert.equal(row.entity_data.address_line1, "12 Main St");
    assert.equal(row.entity_data.city, "Phoenix");
    assert.equal(row.entity_data.state, "AZ", "the state is saved in capitals");
    assert.equal(row.entity_data.postal_code, "85001");
    assert.equal(row.entity_data.ein, "12-3456789", "nine digits are saved as NN-NNNNNNN");
    assert.equal(row.entity_data.incorporated_date, "2020-03");
    assert.equal(row.entity_data.extra_owner_name, "Pat Lee", "the extra owner is kept, trimmed");
    const now = new Date();
    const expectedAge = (now.getUTCFullYear() - 2020) * 12 + (now.getUTCMonth() + 1 - 3);
    assert.ok(Math.abs(row.age_months - expectedAge) <= 1, `age is the months since 2020-03 (got ${row.age_months}, expected about ${expectedAge})`);
    assert.deepEqual(judged(standIn), { sample_count: 1, bad_count: 0 });
  } finally {
    standIn.close();
  }
});

test("the extra owner is optional: blank is saved as nothing, and the business is still whole", async () => {
  const standIn = world();
  try {
    await save(standIn, [typed({ extra_owner_name: "   " })]);
    const [row] = standIn.rows("businesses");
    assert.equal(row.entity_data.extra_owner_name, null);
    assert.deepEqual(judged(standIn), { sample_count: 1, bad_count: 0 });
  } finally {
    standIn.close();
  }
});

const REFUSED = [
  ["no name", { name: "" }, "business_name_required"],
  ["no street", { address_line1: "" }, "business_address_required"],
  ["no city", { city: "" }, "business_address_required"],
  ["no state", { state: "" }, "business_address_required"],
  ["a state that is not two letters", { state: "Arizona" }, "business_address_required"],
  ["no ZIP", { postal_code: "" }, "business_address_required"],
  ["no EIN", { ein: "" }, "business_ein_required"],
  ["an EIN that is not nine digits", { ein: "12-345" }, "business_ein_required"],
  ["no incorporated month", { incorporated_date: "" }, "business_incorporated_required"],
  ["an incorporated month that is not a date", { incorporated_date: "2020-13" }, "business_incorporated_required"],
  ["an incorporated month in the future", { incorporated_date: "2099-01" }, "business_incorporated_invalid"],
];

test("each required field is refused when missing or wrong, and nothing is saved", async () => {
  for (const [label, change, code] of REFUSED) {
    const standIn = world();
    try {
      await assert.rejects(() => save(standIn, [typed(change)]), (err) => err.code === code, `${label}: should be refused as ${code}`);
      assert.equal(standIn.rows("businesses").length, 0, `${label}: nothing is saved`);
    } finally {
      standIn.close();
    }
  }
});

test("saving again replaces this form's businesses and never touches another form's", async () => {
  const standIn = world();
  try {
    standIn.insert("businesses", { id: id(50), org_id: ORG, client_id: CLIENT, name: "From the $297 form", age_months: 12, entity_data: { source: "slo", state: "Arizona" }, created_at: "2026-09-01 10:00:00" });
    await save(standIn, [typed(), typed({ name: "Second Co LLC", ein: "98-7654321", city: "Mesa" })]);
    assert.equal(standIn.rows("businesses").filter((r) => r.entity_data.source === "soft_pull_approve").length, 2);
    await save(standIn, [typed({ name: "Only Co LLC" })]);
    const mine = standIn.rows("businesses").filter((r) => r.entity_data.source === "soft_pull_approve");
    assert.deepEqual(mine.map((r) => r.name), ["Only Co LLC"], "the form's own earlier businesses are replaced");
    assert.equal(standIn.rows("businesses").filter((r) => r.entity_data.source === "slo").length, 1, "the other form's business is left alone");
    assert.deepEqual(judged(standIn), { sample_count: 1, bad_count: 0 });
  } finally {
    standIn.close();
  }
});
