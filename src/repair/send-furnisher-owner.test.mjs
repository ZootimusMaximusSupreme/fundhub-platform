// Tenant boundary on explicit furnisher mailing-address IDs.
// All rows and provider calls here are fake. Real SQL scope is separately
// checked against transaction-local TEMP rows in the paired .pg test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveLetterRouting, sendRepairLetters } from "./send.mjs";

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const CLIENT = "33333333-3333-4333-8333-333333333333";
const STAFF = "44444444-4444-4444-8444-444444444444";
const OWNED_ID = "55555555-5555-4555-8555-555555555555";
const FOREIGN_ID = "66666666-6666-4666-8666-666666666666";
const GLOBAL_ID = "77777777-7777-4777-8777-777777777777";
const INACTIVE_ID = "88888888-8888-4888-8888-888888888888";

function address(id, org_id, active = true) {
  return { id, org_id, active, name: "Synthetic Furnisher",
    address_line1: "1 Example Rd", address_line2: null,
    city: "Phoenix", state: "AZ", zip: "85001", country: "US" };
}

function fakeDb() {
  const rows = [
    address(OWNED_ID, ORG),
    address(FOREIGN_ID, OTHER),
    address(GLOBAL_ID, null),
    address(INACTIVE_ID, ORG, false)
  ];
  const queries = [];
  return {
    queries,
    async query(sql, args = []) {
      queries.push({ sql: String(sql), args });
      if (String(sql).includes("FROM furnisher_mail_addresses")) {
        const found = rows.filter((r) => r.id === args[0]);
        // An unscoped SQL query will intentionally return the foreign row,
        // making the regression fail against the original vulnerable source.
        const scoped = String(sql).includes("(org_id IS NULL OR org_id = $2::uuid)")
          && String(sql).includes("AND active");
        return { rows: scoped
          ? found.filter((r) => r.active && (r.org_id === null || r.org_id === args[1]))
          : found };
      }
      return { rows: [] };
    }
  };
}

function letter(furnisherAddressId, extra = {}) {
  return { target: "furnisher", bureau: "EX", furnisherAddressId, ...extra };
}

test("explicit foreign furnisher address refuses before mailing, including with a manual destination", async () => {
  const db = fakeDb();
  const outcome = await resolveLetterRouting(db, letter(FOREIGN_ID), { orgId: ORG });
  assert.equal(outcome.refusal, "furnisher_address_not_found_or_not_owned");
  assert.equal(outcome.to, null);
  assert.deepEqual(db.queries[0].args, [FOREIGN_ID, ORG]);

  const override = await resolveLetterRouting(db, letter(FOREIGN_ID, {
    to: { address_line1: "8 Unverified Way" }
  }), { orgId: ORG });
  assert.equal(override.refusal, "furnisher_address_not_found_or_not_owned");

  let sends = 0;
  const result = await sendRepairLetters(db, {
    orgId: ORG, clientId: CLIENT, staffId: STAFF, mail: true,
    letters: [letter(FOREIGN_ID, { html: "<html>fake</html>" })],
    mailSender: async () => { sends += 1; return { ok: true, providerId: "fake" }; }
  });
  assert.equal(result.ok, false);
  assert.equal(result.results[0].error, "furnisher_address_not_found_or_not_owned");
  assert.equal(sends, 0, "a foreign address can never reach the mailer");
});

test("same-org and shared active catalog addresses still route; inactive and missing refuse", async () => {
  const db = fakeDb();
  for (const id of [OWNED_ID, GLOBAL_ID]) {
    const outcome = await resolveLetterRouting(db, letter(id), { orgId: ORG });
    assert.equal(outcome.refusal, null);
    assert.equal(outcome.to.company_name, "Synthetic Furnisher");
    assert.equal(outcome.to.address_zip, "85001");
  }
  for (const id of [INACTIVE_ID, "99999999-9999-4999-8999-999999999999"]) {
    const outcome = await resolveLetterRouting(db, letter(id), { orgId: ORG });
    assert.equal(outcome.refusal, "furnisher_address_not_found_or_not_owned");
  }
});

test("no explicit address ID preserves the existing name-based lookup path", async () => {
  const calls = [];
  const db = {
    async query(sql, args = []) {
      calls.push({ sql: String(sql), args });
      if (String(sql).includes("FROM furnisher_mail_addresses")) {
        return { rows: [address(GLOBAL_ID, null)] };
      }
      return { rows: [] };
    }
  };
  const outcome = await resolveLetterRouting(db, { target: "furnisher",
    bureau: "EX", furnisherName: "Synthetic Furnisher" }, { orgId: ORG });
  assert.equal(outcome.refusal, null);
  assert.equal(outcome.to.address_city, "Phoenix");
  assert.ok(calls[0].sql.includes("org_id IS NULL OR org_id = $2"));
  assert.deepEqual(calls[0].args, ["synthetic furnisher", ORG]);
});
