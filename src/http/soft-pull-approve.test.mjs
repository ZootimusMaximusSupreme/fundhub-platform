import { test } from "node:test";
import assert from "node:assert/strict";
import handler, {
  ageMonthsFromIncorporated,
  clientPullProgress,
  ensureSoftPullCheckout,
  normalizeSoftPullEin,
  parseIncorporatedDate,
  parseSoftPullBusinesses,
  replaceSoftPullBusinesses,
  stampBusinessIncorporated
} from "../../api/soft-pull-approve.mjs";
import { softPullTotalCents } from "../finance/soft-pull-pricing.mjs";
import { ConsentError } from "../consent/index.mjs";
import { resumePaidDiagnosticSoftPull } from "../handlers/diagnostic-soft-pull.mjs";
import { signature } from "../consent/approve-token.mjs";

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
      if (/status = 'paid'/i.test(sql)) return { rows: [] };
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

test("paid diagnostic never gets a second checkout, even if the form total changed", async () => {
  const paid = { id: "paid-1", status: "paid", amount_cents: 3200 };
  const calls = [];
  const database = { async query(sql) {
    calls.push(String(sql));
    if (/status = 'paid'/i.test(sql)) return { rows: [paid] };
    throw new Error("a second checkout query must not run");
  } };
  const out = await ensureSoftPullCheckout(database, {
    orgId: "o", clientId: "c", amountCents: 4200, env: {}
  });
  assert.equal(out, paid);
  assert.equal(calls.length, 1);
});

test("consent after verified payment resumes the same event once; failure stays paid", async () => {
  const event = { id: "event-paid-1", org_id: "org-1", client_id: "client-1",
    payload: { source: "commas", product: "crs", amount: 32 } };
  const database = { async query(sql, params) {
    assert.match(sql, /name = 'diagnostic.paid'/);
    assert.deepEqual(params, ["org-1", "client-1"]);
    return { rows: [event] };
  } };
  const calls = [];
  const paid = await resumePaidDiagnosticSoftPull(database, {
    orgId: "org-1", clientId: "client-1", amountCents: 3200,
    runPaidPull: async (original) => {
      calls.push(original.id);
      return { pulled: true, requestId: "pull-1" };
    }
  });
  assert.equal(paid.paid, true);
  assert.equal(paid.pull.pulled, true);
  assert.deepEqual(calls, ["event-paid-1"]);
  const failed = await resumePaidDiagnosticSoftPull(database, {
    orgId: "org-1", clientId: "client-1", amountCents: 3200,
    runPaidPull: async () => { throw new Error("CRS unavailable"); }
  });
  assert.equal(failed.paid, true);
  assert.equal(failed.pull, null);
  assert.match(failed.error, /CRS unavailable/);
});

test("different paid amount does not pull or create a second checkout", async () => {
  const database = { async query() { return { rows: [{ id: "event-1", org_id: "o", client_id: "c",
    payload: { source: "commas", product: "crs", amount: 32 } }] }; } };
  const out = await resumePaidDiagnosticSoftPull(database, {
    orgId: "o", clientId: "c", amountCents: 4200,
    runPaidPull: async () => { throw new Error("must not pull"); }
  });
  assert.equal(out.paid, true);
  assert.equal(out.reason, "paid_amount_mismatch");
});

test("portal approval GET derives client and org from session, never query fields", async () => {
  const orgId = "11111111-1111-4111-8111-111111111111";
  const clientId = "22222222-2222-4222-8222-222222222222";
  const queries = [];
  const database = { async query(sql, params) {
    queries.push({ sql: String(sql), params });
    if (/FROM clients/.test(sql)) return { rows: [{ id: clientId, first_name: "Sam", last_name: "Buyer" }] };
    if (/FROM client_consents/.test(sql)) return { rows: [] };
    if (/FROM events/.test(sql)) return { rows: [] };
    if (/FROM payment_links/.test(sql)) return { rows: [] };
    if (/FROM soft_pull_requests/.test(sql)) return { rows: [] };
    if (/FROM crs_results/.test(sql)) return { rows: [] };
    throw new Error(`unexpected query: ${String(sql).slice(0, 80)}`);
  } };
  const response = { statusCode: 0, body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
  await handler({ method: "GET", query: { portal: "1", org: "spoofed", client: "spoofed" } }, response, {
    db: database,
    requirePrincipal: async () => ({ kind: "client", orgId, clientId, accountId: "account-1" })
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.contact.first_name, "Sam");
  assert.deepEqual(response.body.pull, { status: "not_started", result_ready: false });
  assert.deepEqual(queries[0].params, [clientId, orgId]);
  assert.equal(JSON.stringify(response.body).includes("ssn"), false);
});

test("client progress only completes for a real result tied to the latest request", async () => {
  const requestedAt = "2026-10-31T18:00:00Z";
  let request = { id: "request-2", status: "processing", requested_at: requestedAt, crs_result_id: null };
  let result = { id: "result-1", created_at: "2026-10-30T18:00:00Z", result: { bureaus: {} }, is_demo: false };
  const database = { async query(sql) {
    if (/FROM soft_pull_requests/.test(sql)) return { rows: request ? [request] : [] };
    if (/FROM crs_results/.test(sql)) return { rows: result ? [result] : [] };
    throw new Error("unexpected query");
  } };
  const args = { orgId: "org-1", clientId: "client-1" };
  assert.deepEqual(await clientPullProgress(database, args), { status: "processing", result_ready: false });
  result = { ...result, id: "result-2", created_at: "2026-10-31T18:01:00Z", is_demo: true };
  assert.deepEqual(await clientPullProgress(database, args), { status: "processing", result_ready: false });
  result = { ...result, is_demo: false };
  assert.deepEqual(await clientPullProgress(database, args), { status: "complete", result_ready: true });
  request = { ...request, status: "failed", requested_at: "2026-10-31T18:02:00Z" };
  assert.deepEqual(await clientPullProgress(database, args), { status: "failed", result_ready: false });
});

test("signed soft-pull link sends a client without an account to portal claim", async () => {
  const orgId = "11111111-1111-4111-8111-111111111111";
  const clientId = "22222222-2222-4222-8222-222222222222";
  const secret = "test-soft-pull-secret";
  const exp = String(Math.floor(Date.now() / 1000) + 3600);
  const query = { org: orgId, client: clientId, exp,
    sig: signature({ orgId, clientId, expiresAt: Number(exp), secret }) };
  const database = { async query(sql) {
    if (/FROM clients/.test(sql)) return { rows: [{ id: clientId, email: "buyer@example.test" }] };
    throw new Error("consent and identity must not be touched without a client session");
  } };
  for (const method of ["GET", "POST"]) {
    const response = { statusCode: 0, body: null,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; }
    };
    await handler({ method, query, body: { granted_name: "Sam Buyer" } }, response, {
      db: database, secret, resolvePrincipal: async () => null
    });
    assert.equal(response.statusCode, 401);
    assert.equal(response.body.error, "account_required");
    assert.equal(response.body.create_account_url, "/portal-login.html?mode=claim");
  }
});

test("replaceSoftPullBusinesses rolls back a mid-list failure and replays without duplicates", async () => {
  // A disposable transaction-aware fake: no customer, bureau, payment or
  // production database is involved.
  const rows = [
    { org: "org-A", client: "client-A", name: "Prior LLC", source: "soft_pull_approve" },
    { org: "org-B", client: "client-B", name: "Other company", source: "soft_pull_approve" }
  ];
  let failSecond = true;
  let inserts = 0;
  let releases = 0;
  const queries = [];
  const pool = {
    async connect() {
      let snapshot = null;
      return {
        async query(sql, params = []) {
          const statement = String(sql).trim();
          queries.push({ statement, params });
          if (statement === "BEGIN") {
            snapshot = rows.map((r) => ({ ...r }));
            return { rows: [] };
          }
          if (statement === "ROLLBACK") {
            rows.splice(0, rows.length, ...snapshot.map((r) => ({ ...r })));
            return { rows: [] };
          }
          if (statement === "COMMIT") return { rows: [] };
          if (/^SELECT id FROM clients/.test(statement)) {
            assert.match(statement, /org_id = \$2 FOR UPDATE/);
            return { rows: params[0] === "client-A" && params[1] === "org-A"
              ? [{ id: "client-A" }] : [] };
          }
          if (/^DELETE FROM businesses/.test(statement)) {
            for (let i = rows.length - 1; i >= 0; i--) {
              if (rows[i].org === params[0] && rows[i].client === params[1]
                  && rows[i].source === params[2]) rows.splice(i, 1);
            }
            return { rows: [] };
          }
          if (/^INSERT INTO businesses/.test(statement)) {
            inserts += 1;
            if (failSecond && inserts === 2) throw new Error("synthetic insert failure");
            rows.push({ org: params[0], client: params[1], name: params[2],
              source: JSON.parse(params[4]).source });
            return { rows: [] };
          }
          throw new Error("Unexpected SQL");
        },
        release() { releases += 1; }
      };
    }
  };
  const businesses = [
    { name: "New A", age_months: 12 },
    { name: "New B", age_months: 18 }
  ];
  await assert.rejects(
    replaceSoftPullBusinesses(pool, { orgId: "org-A", clientId: "client-A", businesses }),
    /synthetic insert failure/
  );
  assert.deepEqual(rows.map((r) => r.name), ["Prior LLC", "Other company"],
    "a failed second insert must not erase the previously approved businesses");
  assert.equal(queries.filter((q) => q.statement === "ROLLBACK").length, 1);
  assert.equal(releases, 1);
  failSecond = false;
  await replaceSoftPullBusinesses(pool, { orgId: "org-A", clientId: "client-A", businesses });
  await replaceSoftPullBusinesses(pool, { orgId: "org-A", clientId: "client-A", businesses });
  assert.deepEqual(rows.map((r) => r.name), ["Other company", "New A", "New B"]);
  assert.equal(releases, 3);
  assert.equal(queries.filter((q) => q.statement === "COMMIT").length, 2);
});

test("replaceSoftPullBusinesses rejects a wrong-org client before deletion", async () => {
  let deleted = false, rolledBack = false, released = false;
  const pool = { async connect() { return {
    async query(sql) {
      if (/^SELECT id FROM clients/.test(String(sql).trim())) return { rows: [] };
      if (/^DELETE FROM businesses/.test(String(sql).trim())) deleted = true;
      if (sql === "ROLLBACK") rolledBack = true;
      return { rows: [] };
    },
    release() { released = true; }
  }; } };
  await assert.rejects(
    replaceSoftPullBusinesses(pool, { orgId: "wrong-org", clientId: "client-A", businesses: [] }),
    (e) => e instanceof ConsentError && e.code === "not_found"
  );
  assert.equal(deleted, false);
  assert.equal(rolledBack, true);
  assert.equal(released, true);
});
