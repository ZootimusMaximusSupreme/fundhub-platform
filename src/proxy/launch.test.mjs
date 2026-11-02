import { test } from "node:test";
import assert from "node:assert/strict";
import { launchProxySession, ProxySessionError } from "./launch.mjs";

function fakeDb({ client, lender, application, businesses = [], cases = [], inquiries = [], fraudCase = false } = {}) {
  const sessions = [];
  return {
    sessions,
    query(sql, params) {
      if (/SELECT tags FROM clients/.test(sql)) return { rows: [{ tags: client?.tags || [] }] };
      if (/SELECT 1 FROM inquiry_removal_cases/.test(sql)) return { rows: fraudCase ? [{ exists: 1 }] : [] };
      if (/SELECT \*\s+FROM inquiry_removal_cases/.test(sql)) return { rows: cases };
      if (/SELECT bureau, status, created_at FROM inquiry_log/.test(sql)) return { rows: inquiries };
      if (/SELECT bureaus_pulled FROM lenders/.test(sql)) return { rows: lender ? [{ bureaus_pulled: lender.bureaus_pulled }] : [] };
      if (/FROM clients/.test(sql)) {
        return { rows: client ? [client] : [] };
      }
      if (/FROM businesses/.test(sql)) {
        return { rows: businesses };
      }
      if (/FROM lenders/.test(sql)) {
        return { rows: lender ? [lender] : [] };
      }
      if (/FROM applications/.test(sql)) {
        return { rows: application ? [application] : [] };
      }
      if (/INSERT INTO proxy_sessions/.test(sql)) {
        const row = {
          id: "sess-row-1",
          org_id: params[0],
          client_id: params[1],
          staff_id: params[2],
          lender_id: params[3],
          application_id: params[4],
          requested_city: params[5],
          requested_state: params[6],
          sessid: params[11],
          application_url: params[13],
          status: params[14]
        };
        sessions.push(row);
        return { rows: [row] };
      }
      if (/UPDATE proxy_sessions SET/.test(sql)) {
        const row = {
          ...sessions[0],
          status: params[7] || sessions[0]?.status,
          granted_city: params[2],
          granted_region: params[3],
          targeting_level: params[4],
          exit_ip: params[5],
          proxy_username: params[6],
          error_code: params[8],
          error_message: params[9]
        };
        sessions[0] = row;
        return { rows: [row] };
      }
      return { rows: [] };
    }
  };
}

const ENV = { OXYLABS_USERNAME: "acct", OXYLABS_PASSWORD: "secret" };

test("launchProxySession returns connection + verification and never claims routing_active", async () => {
  const db = fakeDb({
    client: {
      id: "c1",
      org_id: "o1",
      email: "ada@client.com",
      custom_fields: { business_city: "Mesa", business_state: "AZ" }
    },
    lender: {
      id: "l1",
      org_id: "o1",
      name: "Test Bank",
      product_name: "Biz CC",
      application_url: "https://bank.example/apply"
    }
  });

  const out = await launchProxySession(db, {
    orgId: "o1",
    staffId: "s1",
    clientId: "c1",
    lenderId: "l1",
    env: ENV,
    fetchFn: async () => ({
      status: 200,
      body: "{}",
      json: { ip: "198.51.100.7", city: "Mesa", region: "Arizona", country: "US" }
    })
  });

  assert.equal(out.routing_active, false);
  assert.equal(out.extension_required, true);
  assert.equal(out.application_url, "https://bank.example/apply");
  assert.equal(out.bank_form_email.email, "ada@client.com");
  assert.equal(out.bank_form_email.warning, null);
  assert.equal(out.verification.exit_ip, "198.51.100.7");
  assert.equal(out.verification.city, "Mesa");
  assert.equal(out.verification.targeting_level, "city");
  assert.equal(out.connection.host, "pr.oxylabs.io");
  assert.equal(out.connection.port, 7777);
  assert.match(out.connection.username, /city-mesa/);
  assert.equal(out.connection.password, "secret");
  assert.equal(db.sessions[0].status, "active");
});

test("launchProxySession fails when credentials missing, and still leaves an audit row", async () => {
  const db = fakeDb({
    client: { id: "c1", org_id: "o1", custom_fields: { city: "Mesa", state: "AZ" } },
    lender: { id: "l1", org_id: "o1", name: "B", application_url: "https://x.test" }
  });
  await assert.rejects(
    () => launchProxySession(db, {
      orgId: "o1", staffId: "s1", clientId: "c1", lenderId: "l1", env: {}
    }),
    (err) =>
      err instanceof ProxySessionError &&
      err.code === "oxylabs_credentials_missing" &&
      err.status === 503 &&
      err.sessionId === "sess-row-1"
  );
  // Regression: this used to throw before insertProxySession, so a refused launch
  // left proxy_sessions empty and the attempt was invisible to the audit trail.
  assert.equal(db.sessions.length, 1);
  assert.equal(db.sessions[0].status, "failed");
  assert.equal(db.sessions[0].error_code, "oxylabs_credentials_missing");
  // The row must record WHY, not just repeat the code next to it.
  assert.match(db.sessions[0].error_message, /OXYLABS_USERNAME, OXYLABS_PASSWORD/);
});

test("launchProxySession closes the audit row when the launch throws", async () => {
  const db = fakeDb({
    client: { id: "c1", org_id: "o1", custom_fields: { city: "Mesa", state: "AZ" } },
    lender: { id: "l1", org_id: "o1", name: "B", application_url: "https://x.test" }
  });
  await assert.rejects(
    () => launchProxySession(db, {
      orgId: "o1",
      staffId: "s1",
      clientId: "c1",
      lenderId: "l1",
      // A whitespace-only username is truthy, so cfg.ready passes — but
      // buildProxyUsername sits OUTSIDE launchCredentials' inner try and throws.
      // This is the real path that strands a row, not a dropped socket (that one
      // is caught inside the adapter and comes back as geo_unavailable).
      env: { OXYLABS_USERNAME: "   ", OXYLABS_PASSWORD: "p" },
      fetchFn: async () => { throw new Error("should not be reached"); }
    }),
    /oxylabs_username_required/
  );
  // Nothing in this repo sweeps stale 'verifying' rows, so a throw between the
  // insert and the update would strand this row as an in-flight bank application.
  assert.equal(db.sessions.length, 1);
  assert.equal(db.sessions[0].status, "failed");
  assert.equal(db.sessions[0].error_code, "launch_threw");
});

test("launchProxySession uses company city/state when the person row has none", async () => {
  const db = fakeDb({
    client: { id: "c1", org_id: "o1", custom_fields: {} },
    businesses: [{ entity_data: { city: "Austin", state: "TX" } }],
    lender: {
      id: "l1",
      org_id: "o1",
      name: "1st Source Bank",
      product_name: "Biz CC",
      application_url: "https://bank.example/apply"
    }
  });

  const out = await launchProxySession(db, {
    orgId: "o1",
    staffId: "s1",
    clientId: "c1",
    lenderId: "l1",
    env: ENV,
    fetchFn: async () => ({
      status: 200,
      body: "{}",
      json: { ip: "198.51.100.8", city: "Austin", region: "Texas", country: "US" }
    })
  });

  assert.equal(out.application_url, "https://bank.example/apply");
  assert.equal(out.verification.city, "Austin");
  assert.match(out.connection.username, /city-austin/);
  assert.equal(db.sessions[0].requested_city, "Austin");
  assert.equal(db.sessions[0].requested_state, "TX");
});

test("launchProxySession fails when client has no location", async () => {
  const db = fakeDb({
    client: { id: "c1", org_id: "o1", custom_fields: {} },
    lender: { id: "l1", org_id: "o1", name: "B", application_url: "https://x.test" }
  });
  await assert.rejects(
    () => launchProxySession(db, {
      orgId: "o1", staffId: "s1", clientId: "c1", lenderId: "l1", env: ENV
    }),
    (err) => err instanceof ProxySessionError && err.code === "client_location_missing"
  );
});

test("launchProxySession fails when lender has no application_url", async () => {
  const db = fakeDb({
    client: { id: "c1", org_id: "o1", custom_fields: { city: "Mesa", state: "AZ" } },
    lender: { id: "l1", org_id: "o1", name: "B", application_url: null }
  });
  await assert.rejects(
    () => launchProxySession(db, {
      orgId: "o1", staffId: "s1", clientId: "c1", lenderId: "l1", env: ENV
    }),
    (err) => err instanceof ProxySessionError && err.code === "application_url_missing"
  );
});

const baseClient = () => ({ id: "c1", org_id: "o1", custom_fields: { city: "Mesa", state: "AZ" } });
const baseLender = (bureaus_pulled) => ({ id: "l1", org_id: "o1", name: "B", application_url: "https://x.test", bureaus_pulled });
const launch = (db) => launchProxySession(db, { orgId: "o1", staffId: "s1", clientId: "c1", lenderId: "l1", env: {} });

test("direct Apply launch refuses a lender pulling an active bureau", async () => {
  const db = fakeDb({ client: baseClient(), lender: baseLender("EX"), cases: [{ selected_bureaus_raw: "EX", case_status: "In Progress" }] });
  await assert.rejects(launch(db), (err) => err.code === "lender_bureau_on_hold" && err.status === 409);
  assert.equal(db.sessions.length, 0);
});

test("clean bureau can start Apply while another bureau is protected", async () => {
  const db = fakeDb({ client: baseClient(), lender: baseLender("TU"), cases: [{ selected_bureaus_raw: "EX", case_status: "In Progress" }] });
  await assert.rejects(launch(db), (err) => err.code === "oxylabs_credentials_missing");
  assert.equal(db.sessions.length, 1);
});

test("multi-bureau lender and unmapped lender cannot bypass protection", async () => {
  for (const pulled of ["EX,TU", null]) {
    const db = fakeDb({ client: baseClient(), lender: baseLender(pulled), inquiries: [{ bureau: "EX", status: "Removed", created_at: new Date().toISOString() }] });
    await assert.rejects(launch(db), (err) => err.code === (pulled ? "lender_bureau_on_hold" : "lender_bureau_unknown"));
    assert.equal(db.sessions.length, 0);
  }
});

test("owner case override allows that bureau when no inquiry log still protects it", async () => {
  const db = fakeDb({ client: baseClient(), lender: baseLender("EX"), cases: [{ selected_bureaus_raw: "EX", case_status: "In Progress", gate_override_by: "owner", gate_override_at: new Date().toISOString() }] });
  await assert.rejects(launch(db), (err) => err.code === "oxylabs_credentials_missing");
  assert.equal(db.sessions.length, 1);
});

test("fraud, document, and paused holds block Apply even on a clean bureau", async () => {
  for (const reason of ["Fraud Alert", "Documents Pending Approval", "Funding Paused"]) {
    const client = baseClient();
    client.custom_fields.round_hold_reason = reason;
    const db = fakeDb({ client, lender: baseLender("TU") });
    await assert.rejects(launch(db), (err) => err.code === "funding_on_hold");
    assert.equal(db.sessions.length, 0);
  }
  const db = fakeDb({ client: baseClient(), lender: baseLender("TU"), fraudCase: true });
  await assert.rejects(launch(db), (err) => err.code === "funding_on_hold");
});
