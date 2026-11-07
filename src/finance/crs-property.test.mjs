import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { getPropertyReport, orderPropertyReport, recordClientPropertyConsent } from "./crs-property.mjs";
import { PROPERTY_CONSENT_TEXT, PROPERTY_CONSENT_VERSION } from "./crs-property-contract.mjs";
const principal = { kind: "staff", role: "owner", orgId: randomUUID(), staffId: randomUUID() };
const clientId = randomUUID();
const env = { CRS_PROPERTY_API_HOST: "mware.crscreditapi.com", CRS_PROPERTY_API_USERNAME: "unit-user", CRS_PROPERTY_API_PASSWORD: "unit-password",
  CRS_PROPERTY_ALLOW_LIVE: "on", CRS_PROPERTY_SANDBOX_IDENTITY_SHA256: "0".repeat(64), ADAPTERS_DRY_RUN: "off", PII_ENC_KEY: Buffer.alloc(32,7).toString("base64") };
const input = () => ({ clientId, operationId: randomUUID(), consentAccepted: true, consentVersion: PROPERTY_CONSENT_VERSION });
function fakeDb() {
  const state = { client: { id: clientId, first_name: "Synthetic", last_name: "Property", is_demo: false },
    identity: { id: randomUUID(), dob: "1990-01-02", ssn_enc: Buffer.from("synthetic-encrypted-value") }, rows: [], calls: [] };
  return { state, async query(sql, values) {
    state.calls.push({ sql, values });
    if (sql.includes("FROM clients")) return { rows: state.client ? [state.client] : [] };
    if (sql.includes("FROM pii_identity")) return { rows: state.identity ? [state.identity] : [] };
    if (sql.includes("FROM client_consents c JOIN crs_property_consents")) return { rows: state.clientConsent ? [state.clientConsent] : [] };
    if (sql.includes("INSERT INTO client_consents")) {
      const row = { id: randomUUID(), org_id: values[0], client_id: values[1], kind: values[2],
        consent_text: values[3], consent_version: values[4], granted_by_kind: values[5],
        granted_by_account_id: values[6], capture_method: values[8], granted_name: values[9] };
      state.clientConsent = row; return { rows: [row] };
    }
    if (sql.includes("INSERT INTO crs_property_consents")) {
      assert.equal(values[0], state.clientConsent.id);
      state.clientConsent.identity_version_fingerprint = values[3];
      state.clientConsent.valid = true;
      return { rows: [] };
    }
    if (sql.includes("INSERT INTO crs_property_requests")) {
      const [org_id, client_id, requester_staff_id, operation_id, environment, identity_fingerprint, identity_version_fingerprint, consent_text, consent_version] = values;
      const row = { id: randomUUID(), org_id, client_id, requester_staff_id, operation_id, environment, identity_fingerprint,
        identity_version_fingerprint, consent_text, consent_version, status: "in_flight", created_at: new Date().toISOString() };
      state.rows.push(row); return { rows: [row] };
    }
    if (sql.includes("UPDATE crs_property_requests")) {
      const row = state.rows.find(v => v.id === values[0]);
      if (sql.includes("SET identity_version_fingerprint")) {
        row.identity_version_fingerprint = values[3]; return { rows: [row] };
      }
      Object.assign(row, { status: values[3], provider_request_id: values[4], normalized_response: values[5] && JSON.parse(values[5]), error_code: values[6], finished_at: new Date().toISOString() });
      return { rows: [row] };
    }
    if (sql.includes("FROM crs_property_requests")) {
      let rows = [...state.rows].reverse();
      if (sql.includes("operation_id=$2")) rows = rows.filter(v => v.operation_id === values[1]);
      else if (values.length === 3) rows = rows.filter(v => v.client_id === values[1] && (sql.includes("identity_version_fingerprint=$3")
        ? v.identity_version_fingerprint === values[2] || v.status === "in_flight" : v.identity_fingerprint === values[2]));
      return { rows: rows.slice(0, 1) };
    }
    throw new Error("Unexpected synthetic query");
  } };
}
function options(db, extra = {}) {
  return { env, reveal: async (_tx, value) => { assert.equal(value.orgId, principal.orgId); return { ssn: "666123456" }; },
    client: { async order({ identity }) { assert.equal(db.state.rows.length, 1); assert.equal(db.state.rows[0].status, "in_flight");
      assert.equal(identity.firstName, "Synthetic"); return { ok: true, requestId: randomUUID(), report: { summary: { ownedPropertyCount: 1 } } }; } }, ...extra };
}
test("property GET only reads saved status and never reveals or orders", async () => {
  const db = fakeDb();
  const result = await getPropertyReport(db, principal, { clientId }, options(db));
  assert.equal(result.body.status, "empty"); assert.equal(result.body.mayOrder, true);
  assert.ok(db.state.calls.every(v => v.sql.startsWith("SELECT")));
  assert.doesNotMatch(JSON.stringify(result), /synthetic-encrypted-value|666123456/);
});
test("client property permission records the specific words and account and does not order", async () => {
  const db = fakeDb(), accountId = randomUUID();
  await recordClientPropertyConsent(db, { orgId: principal.orgId, clientId, accountId, grantedName: "Synthetic Property" });
  assert.equal(db.state.clientConsent.kind, "property_report_consent");
  assert.equal(db.state.clientConsent.consent_text, PROPERTY_CONSENT_TEXT);
  assert.equal(db.state.clientConsent.consent_version, PROPERTY_CONSENT_VERSION);
  assert.equal(db.state.clientConsent.granted_by_account_id, accountId);
  assert.equal(db.state.clientConsent.capture_method, "checkbox");
  assert.equal((await getPropertyReport(db, principal, { clientId }, { env })).body.clientConsent.valid, true);
  assert.equal(db.state.rows.length, 0);
});
test("recorded property permission is bound to the saved identity and rechecked before ordering", async () => {
  const db = fakeDb(); let orders = 0;
  const opts = options(db); const base = opts.client.order;
  opts.client.order = async args => { orders++; return base(args); };
  const accepted = { ...input(), consentAccepted: false };
  await assert.rejects(orderPropertyReport(db, principal, accepted, opts), /property_consent_required/);
  assert.equal(orders, 0);
  const fingerprint = createHash("sha256").update(JSON.stringify([
    db.state.client.first_name, db.state.client.last_name, db.state.identity.dob,
    db.state.identity.ssn_enc.toString("hex")
  ])).digest("hex");
  db.state.clientConsent = { id: randomUUID(), valid: true, consent_version: PROPERTY_CONSENT_VERSION,
    consent_text: PROPERTY_CONSENT_TEXT, identity_version_fingerprint: fingerprint };
  assert.equal((await getPropertyReport(db, principal, { clientId }, opts)).body.clientConsent.valid, true);
  db.state.clientConsent.valid = false;
  await assert.rejects(orderPropertyReport(db, principal, accepted, opts), /property_consent_required/);
  db.state.clientConsent.valid = true;
  db.state.client.first_name = "Changed";
  assert.equal((await getPropertyReport(db, principal, { clientId }, opts)).body.clientConsent.valid, false);
  await assert.rejects(orderPropertyReport(db, principal, accepted, opts), /property_consent_required/);
  db.state.client.first_name = "Synthetic";
  const result = await orderPropertyReport(db, principal, accepted, opts);
  assert.equal(result.body.status, "completed"); assert.equal(orders, 1);
});
test("property order binds saved identity, records separate permission and replays without another order", async () => {
  const db = fakeDb(); let orders = 0;
  const opts = options(db); const base = opts.client.order; opts.client.order = async args => { orders++; return base(args); };
  const first = await orderPropertyReport(db, principal, input(), opts);
  assert.equal(first.body.status, "completed"); assert.equal(first.body.replayed, false);
  const replay = await orderPropertyReport(db, principal, input(), opts);
  assert.equal(replay.body.replayed, true); assert.equal(orders, 1);
  assert.equal(db.state.rows[0].consent_version, PROPERTY_CONSENT_VERSION);
  assert.equal(db.state.rows[0].requester_staff_id, principal.staffId);
});
test("property refuses role, foreign client, missing identity and consent before a claim", async () => {
  for (const principalPatch of [{ role: "closer" }, { role: "setter" }, { kind: "client" }, { orgId: null }]) {
    const db = fakeDb(); await assert.rejects(orderPropertyReport(db, { ...principal, ...principalPatch }, input(), options(db)), /forbidden/);
    assert.equal(db.state.rows.length, 0);
  }
  const db = fakeDb(); db.state.client = null;
  await assert.rejects(orderPropertyReport(db, principal, input(), options(db)), /client_not_found/);
  const noIdentity = fakeDb(); noIdentity.state.identity = null;
  await assert.rejects(orderPropertyReport(noIdentity, principal, input(), options(noIdentity)), /identity_required/);
  await assert.rejects(orderPropertyReport(fakeDb(), principal, { ...input(), consentAccepted: false }, { env }), /property_consent_required/);
});
test("uncertain property result stays held on replay and identity changes hide the report", async () => {
  const db = fakeDb(); let calls = 0;
  const opts = options(db, { client: { async order() { calls++; throw new Error("synthetic unknown transport"); } } });
  assert.equal((await orderPropertyReport(db, principal, input(), opts)).body.status, "needs_review");
  assert.equal((await orderPropertyReport(db, principal, input(), opts)).body.replayed, true); assert.equal(calls, 1);
  const other = fakeDb(); const normal = options(other);
  await orderPropertyReport(other, principal, input(), normal);
  other.state.client.first_name = "Changed";
  const read = await getPropertyReport(other, principal, { clientId }, { env });
  assert.equal(read.body.reason, "identity_changed"); assert.equal(read.body.report, null);
});
test("identity changed during provider work cannot publish the earlier report as current", async () => {
  const db = fakeDb();
  const result = await orderPropertyReport(db, principal, input(), options(db, { client: { async order() {
    db.state.client.first_name = "Changed";
    return { ok: true, requestId: randomUUID(), report: { summary: { ownedPropertyCount: 1 } } };
  } } }));
  assert.equal(result.body.status, "needs_review"); assert.equal(result.body.report, null);
  assert.equal(result.body.reason, "identity_changed");
});
test("re-encrypting the same saved identity rebinds its receipt without a second paid request", async () => {
  const db = fakeDb(); let orders = 0;
  const opts = options(db); const base = opts.client.order; opts.client.order = async args => { orders++; return base(args); };
  await orderPropertyReport(db, principal, input(), opts);
  db.state.identity.ssn_enc = Buffer.from("different-synthetic-encryption-of-same-ssn");
  assert.equal((await getPropertyReport(db, principal, { clientId }, { env })).body.reason, "identity_changed");
  const replay = await orderPropertyReport(db, principal, input(), opts);
  assert.equal(replay.body.replayed, true); assert.equal(replay.body.status, "completed");
  assert.equal(orders, 1); assert.equal(db.state.rows.length, 1);
  assert.equal((await getPropertyReport(db, principal, { clientId }, { env })).body.status, "completed");
});
