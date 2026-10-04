// Businesses on the $297 order (src/slo/businesses.mjs) and their price
// (src/finance/slo-business-pricing.mjs): first business free, each extra $15.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SLO_BUSINESS_SOURCE,
  businessPhone,
  monthYear,
  parseSloBusinesses,
  replaceSloBusinesses
} from "./businesses.mjs";
import {
  SLO_EXTRA_BUSINESS_CENTS,
  sloBusinessOwedCents,
  sloBusinessPricingPublic,
  sloCheckoutTotalCents
} from "../finance/slo-business-pricing.mjs";

const NOW = new Date("2026-09-22T12:00:00Z");

function biz(over = {}) {
  return {
    name: "Acme Holdings LLC",
    address: "200 Commerce St",
    city: "Dallas",
    state: "TX",
    zip: "75201",
    ein: "12-3456789",
    phone: "(214) 555-0100",
    started: "03/2021",
    ...over
  };
}

test("price: 1 business is $147, each extra is $15, integer cents", () => {
  assert.equal(SLO_EXTRA_BUSINESS_CENTS, 1500);
  assert.equal(sloCheckoutTotalCents(1), 14700);
  assert.equal(sloCheckoutTotalCents(2), 16200);
  assert.equal(sloCheckoutTotalCents(5), 14700 + 1500 * 4);
  assert.throws(() => sloCheckoutTotalCents(0), RangeError);
  assert.throws(() => sloCheckoutTotalCents(21), RangeError);
  assert.throws(() => sloCheckoutTotalCents(1.5), RangeError);
  const pub = sloBusinessPricingPublic(3);
  assert.equal(pub.extraCount, 2);
  assert.equal(pub.extraCents, 3000);
  assert.equal(pub.extraDisplay, "$30");
});

test("owed: more businesses than paid for is recorded, never negative", () => {
  assert.equal(sloBusinessOwedCents({ submitted: 3, paid: 1 }), 3000);
  assert.equal(sloBusinessOwedCents({ submitted: 1, paid: 3 }), 0);
  assert.equal(sloBusinessOwedCents({ submitted: 0, paid: 1 }), 0);
});

test("a full business row parses; EIN and phone are normalized", () => {
  const out = parseSloBusinesses([biz()], { now: NOW });
  assert.deepEqual(out.errors, []);
  assert.equal(out.businesses.length, 1);
  const b = out.businesses[0];
  assert.equal(b.ein, "12-3456789");
  assert.equal(b.phone, "2145550100");
  assert.equal(b.incorporated_date, "2021-03");
  assert.equal(b.state, "TX");
  assert.equal(typeof b.age_months, "number");
});

test("EIN is required (owner-set 2026-09-23); phone stays optional; started is required and not in the future", () => {
  const noEin = parseSloBusinesses([biz({ ein: "" })], { now: NOW });
  assert.equal(noEin.errors[0].field, "businesses.0.ein");
  assert.equal(noEin.errors[0].code, "business_ein_required");
  assert.deepEqual(noEin.businesses, []);

  const noPhone = parseSloBusinesses([biz({ phone: "" })], { now: NOW });
  assert.deepEqual(noPhone.errors, []);
  assert.equal(noPhone.businesses[0].phone, null);

  const future = parseSloBusinesses([biz({ started: "12/2030" })], { now: NOW });
  assert.equal(future.errors[0].field, "businesses.0.started");
  assert.equal(future.errors[0].code, "business_started_future");

  const missing = parseSloBusinesses([biz({ started: "" })], { now: NOW });
  assert.equal(missing.errors[0].code, "business_started_required");
});

test("every error names its row and box; one bad row refuses the list", () => {
  const out = parseSloBusinesses([biz(), biz({ name: "", ein: "123", zip: "1" })], { now: NOW });
  const fields = out.errors.map((e) => e.field).sort();
  assert.deepEqual(fields, ["businesses.1.ein", "businesses.1.name", "businesses.1.zip"]);
  assert.deepEqual(out.businesses, []);
});

test("an all-blank row is skipped, not refused; more than 20 is refused", () => {
  const out = parseSloBusinesses([biz(), { name: "", address: "" }], { now: NOW });
  assert.equal(out.errors.length, 0);
  assert.equal(out.businesses.length, 1);
  const tooMany = parseSloBusinesses(Array.from({ length: 21 }, () => biz()), { now: NOW });
  assert.equal(tooMany.errors[0].code, "businesses_max");
  assert.equal(parseSloBusinesses("nope").errors[0].code, "businesses_invalid");
});

test("month/year and phone helpers", () => {
  assert.equal(monthYear("3/2021"), "2021-03");
  assert.equal(monthYear("2021-03"), "2021-03");
  assert.equal(monthYear("March 2021"), null);
  assert.equal(businessPhone("1-214-555-0100"), "2145550100");
  assert.equal(businessPhone("555-0100"), null);
});

test("replaceSloBusinesses touches only source 'slo' rows, in one transaction", async () => {
  const seen = [];
  const tx = { query: async (sql, params) => { seen.push({ sql, params }); return { rows: [] }; } };
  const database = {
    query: tx.query,
    connect: async () => ({ ...tx, release() {} })
  };
  const parsed = parseSloBusinesses([biz()], { now: NOW }).businesses;
  await replaceSloBusinesses(database, { orgId: "org-1", clientId: "cl-1", businesses: parsed });
  const del = seen.find((q) => /DELETE FROM businesses/.test(q.sql));
  assert.ok(del, "old slo rows are cleared");
  assert.match(del.sql, /entity_data->>'source'/);
  assert.equal(del.params[2], SLO_BUSINESS_SOURCE);
  const ins = seen.filter((q) => /INSERT INTO businesses/.test(q.sql));
  assert.equal(ins.length, 1);
  assert.equal(JSON.parse(ins[0].params[4]).source, "slo");
});
