import { test } from "node:test";
import assert from "node:assert/strict";
import handler, {
  ageMonthsFromIncorporated,
  ensureSoftPullCheckout,
  normalizeSoftPullEin,
  parseIncorporatedDate,
  parseSoftPullBusinesses,
  replaceSoftPullBusinesses,
  stampBusinessIncorporated
} from "../../api/soft-pull-approve.mjs";
import { softPullTotalCents } from "../finance/soft-pull-pricing.mjs";
import { ConsentError } from "../consent/index.mjs";

function row(over = {}) {
  return {
    name: "Acme LLC",
    address_line1: "1 Main St",
    city: "Phoenix",
    state: "az",
    postal_code: "85001",
    ein: "123456789",
    incorporated_date: "2020-01",
    ...over
  };
}

test("normalizeSoftPullEin stores XX-XXXXXXX", () => {
  assert.equal(normalizeSoftPullEin("123456789"), "12-3456789");
  assert.equal(normalizeSoftPullEin("12-3456789"), "12-3456789");
  assert.equal(normalizeSoftPullEin("12 345 6789"), "12-3456789");
  assert.equal(normalizeSoftPullEin("12-34567"), null);
  assert.equal(normalizeSoftPullEin(""), null);
});

test("parseSoftPullBusinesses: empty / missing → []", () => {
  assert.deepEqual(parseSoftPullBusinesses(null), []);
  assert.deepEqual(parseSoftPullBusinesses([]), []);
  assert.deepEqual(parseSoftPullBusinesses(""), []);
});

test("parseSoftPullBusinesses: accepts complete rows including 6+", () => {
  const one = parseSoftPullBusinesses([row()]);
  assert.equal(one.length, 1);
  assert.equal(one[0].state, "AZ");
  assert.equal(one[0].ein, "12-3456789");
  assert.equal(one[0].extra_owner_name, null);
  assert.equal(one[0].incorporated_date, "2020-01");
  assert.equal(one[0].age_months, ageMonthsFromIncorporated("2020-01"));
  assert.equal(softPullTotalCents(one.length), 4200);

  const six = parseSoftPullBusinesses(Array.from({ length: 6 }, (_, i) => row({
    name: "Biz " + i,
    ein: "12-345678" + String(i)
  })));
  assert.equal(six.length, 6);
  assert.equal(softPullTotalCents(six.length), 9200);
});

test("parseSoftPullBusinesses: extra owner is optional and trimmed", () => {
  const named = parseSoftPullBusinesses([row({ extra_owner_name: "  Pat Lee  " })]);
  assert.equal(named[0].extra_owner_name, "Pat Lee");
  const blank = parseSoftPullBusinesses([row({ extra_owner_name: "   " })]);
  assert.equal(blank[0].extra_owner_name, null);
});

test("parseSoftPullBusinesses: EIN is required when a row is present", () => {
  assert.throws(
    () => parseSoftPullBusinesses([row({ ein: "" })]),
    (e) => e instanceof ConsentError && e.code === "business_ein_required"
  );
});

test("parseIncorporatedDate accepts month/year or full date", () => {
  assert.equal(parseIncorporatedDate("2020-01"), "2020-01");
  assert.equal(parseIncorporatedDate("2020-01-15"), "2020-01-15");
  assert.equal(parseIncorporatedDate("2020-13"), null);
  assert.equal(parseIncorporatedDate("2020-02-30"), null);
  assert.equal(parseIncorporatedDate(""), null);
});

test("ageMonthsFromIncorporated does not invent a default", () => {
  assert.equal(ageMonthsFromIncorporated(""), null);
  assert.equal(ageMonthsFromIncorporated("not-a-date"), null);
  assert.equal(ageMonthsFromIncorporated("2099-01", new Date("2026-08-25T00:00:00Z")), null);
  assert.equal(ageMonthsFromIncorporated("2024-08", new Date("2026-08-25T00:00:00Z")), 24);
  assert.equal(ageMonthsFromIncorporated("2024-08-26", new Date("2026-08-25T00:00:00Z")), 23);
});

test("parseSoftPullBusinesses: incorporation date is required when a row is present", () => {
  assert.throws(
    () => parseSoftPullBusinesses([row({ incorporated_date: "" })]),
    (e) => e instanceof ConsentError && e.code === "business_incorporated_required"
  );
});

test("parseSoftPullBusinesses: refuses more than 20", () => {
  const rows = Array.from({ length: 21 }, (_, i) => row({
    name: "Biz " + i,
    ein: String(100000000 + i)
  }));
  assert.throws(
    () => parseSoftPullBusinesses(rows),
    (e) => e instanceof ConsentError && e.code === "businesses_max"
  );
});

test("parseSoftPullBusinesses: incomplete row fails", () => {
  assert.throws(
    () => parseSoftPullBusinesses([{ name: "Acme", city: "Phoenix", state: "AZ", ein: "12-3456789" }]),
    (e) => e instanceof ConsentError && e.code === "business_address_required"
  );
});

test("replaceSoftPullBusinesses writes ein, incorporated_date, and age_months", async () => {
  const inserts = [];
  const db = {
    async query(sql, params) {
      if (/DELETE FROM businesses/i.test(sql)) return { rows: [] };
      if (/INSERT INTO businesses/i.test(sql)) {
        inserts.push({ age_months: params[3], entity: JSON.parse(params[4]) });
        return { rows: [] };
      }
      throw new Error("unexpected: " + String(sql).slice(0, 80));
    }
  };
  const parsed = parseSoftPullBusinesses([row({ extra_owner_name: "Pat Lee" })]);
  await replaceSoftPullBusinesses(db, {
    orgId: "o",
    clientId: "c",
    businesses: parsed
  });
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0].age_months, parsed[0].age_months);
  assert.equal(inserts[0].entity.source, "soft_pull_approve");
  assert.equal(inserts[0].entity.ein, "12-3456789");
  assert.equal(inserts[0].entity.incorporated_date, "2020-01");
  assert.equal(inserts[0].entity.extra_owner_name, "Pat Lee");
  assert.equal(inserts[0].entity.address_line1, "1 Main St");
  assert.equal(inserts[0].entity.state, "AZ");
});

test("stampBusinessIncorporated writes month/year and age on one existing company", async () => {
  const updates = [];
  const db = {
    async query(sql, params) {
      if (/UPDATE businesses/i.test(sql)) {
        updates.push(params);
        return {
          rows: [{
            id: "b1",
            name: params[2],
            age_months: params[3],
            incorporated_date: params[4]
          }]
        };
      }
      throw new Error("unexpected: " + String(sql).slice(0, 80));
    }
  };
  const out = await stampBusinessIncorporated(db, {
    orgId: "o",
    clientId: "c",
    businessName: "Fund Horse Logistics",
    incorporatedDate: "2020-01",
    now: new Date("2026-08-25T00:00:00Z")
  });
  assert.equal(updates.length, 1);
  assert.equal(updates[0][2], "Fund Horse Logistics");
  assert.equal(updates[0][3], 79);
  assert.equal(updates[0][4], "2020-01");
  assert.equal(out.age_months, 79);
  assert.equal(out.incorporated_date, "2020-01");
});

test("stampBusinessIncorporated refuses a missing or future date without writing", async () => {
  const db = { query() { throw new Error("should not write"); } };
  await assert.rejects(
    () => stampBusinessIncorporated(db, {
      orgId: "o", clientId: "c", businessName: "Fund Horse Logistics", incorporatedDate: ""
    }),
    (e) => e instanceof ConsentError && e.code === "business_incorporated_required"
  );
  await assert.rejects(
    () => stampBusinessIncorporated(db, {
      orgId: "o", clientId: "c", businessName: "Fund Horse Logistics",
      incorporatedDate: "2099-01", now: new Date("2026-08-25T00:00:00Z")
    }),
    (e) => e instanceof ConsentError && e.code === "business_incorporated_invalid"
  );
});

test("POST stamp_incorporated reaches the staff handler and writes the named business", async () => {
  const orgId = "11111111-1111-4111-8111-111111111111";
  const clientId = "22222222-2222-4222-8222-222222222222";
  const writes = [];
  const database = {
    async query(sql, params) {
      if (/SELECT 1 FROM clients/.test(sql)) return { rows: [{ "?column?": 1 }] };
      if (/UPDATE businesses/.test(sql)) {
        writes.push(params);
        return { rows: [{ name: params[2], age_months: params[3], incorporated_date: params[4] }] };
      }
      throw new Error(`unexpected query: ${String(sql).slice(0, 80)}`);
    }
  };
  const response = {
    statusCode: 0,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };

  await handler({
    method: "POST",
    body: {
      action: "stamp_incorporated",
      client_id: clientId,
      business_name: "Fund Horse Logistics",
      incorporated_date: "2020-05"
    }
  }, response, {
    db: database,
    requireAuth: async () => ({ id: "staff-1", role: "owner", org_id: orgId })
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.business.incorporated_date, "2020-05");
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].slice(0, 3), [orgId, clientId, "Fund Horse Logistics"]);
});

test("ensureSoftPullCheckout reuses matching open link", async () => {
  const link = {
    id: "link-1",
    status: "sent",
    amount_cents: 4200,
    checkout_url: "https://pay.example/42",
    purpose: "diagnostic"
  };
  const calls = [];
  const db = {
    async query(sql, params) {
      calls.push({ sql: String(sql), params });
      if (/amount_cents = \$4/i.test(sql) && /ORDER BY created_at/i.test(sql)) {
        return { rows: [link] };
      }
      throw new Error("unexpected: " + String(sql).slice(0, 80));
    }
  };
  const out = await ensureSoftPullCheckout(db, {
    orgId: "o",
    clientId: "c",
    amountCents: 4200,
    description: "test",
    env: {}
  });
  assert.equal(out.checkout_url, link.checkout_url);
  assert.equal(out.amount_cents, 4200);
});
