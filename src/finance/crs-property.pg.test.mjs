import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { isLocalScratchDatabaseUrl } from "../verification/scratch-guard.mjs";
import { encryptSsn, storeIdentity } from "../pii/index.mjs";
import { getPropertyReport, orderPropertyReport, recordClientPropertyConsent } from "./crs-property.mjs";
import { PROPERTY_CONSENT_TEXT, PROPERTY_CONSENT_VERSION } from "./crs-property-contract.mjs";
import { captureConsent } from "../consent/index.mjs";
const url = process.env.APP_DATABASE_URL || process.env.DATABASE_URL;
const env = { CRS_PROPERTY_API_HOST: "mware.crscreditapi.com", CRS_PROPERTY_API_USERNAME: "synthetic-user", CRS_PROPERTY_API_PASSWORD: "synthetic-password",
  CRS_PROPERTY_ALLOW_LIVE: "on", CRS_PROPERTY_SANDBOX_IDENTITY_SHA256: "0".repeat(64), ADAPTERS_DRY_RUN: "off", PII_ENC_KEY: Buffer.alloc(32, 5).toString("base64") };
test("property ledger binds consent/identity/receipt, denies scope changes and dedupes SSN re-encryption as fundhub_app", {
  skip: !isLocalScratchDatabaseUrl(url)
}, async () => {
  const pool = new pg.Pool({ connectionString: url }); const tx = await pool.connect();
  try {
    const role = (await tx.query("SELECT current_user,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user")).rows[0];
    assert.equal(role.current_user, "fundhub_app"); assert.equal(role.rolsuper || role.rolbypassrls, false);
    await tx.query("BEGIN");
    const slug = `property-synthetic-${randomUUID()}`;
    const orgId = (await tx.query("INSERT INTO orgs(slug,name) VALUES($1,'Synthetic property proof') RETURNING id", [slug])).rows[0].id;
    const foreignOrgId = (await tx.query("INSERT INTO orgs(slug,name) VALUES($1,'Synthetic foreign property proof') RETURNING id", [`${slug}-foreign`])).rows[0].id;
    const staffId = (await tx.query("INSERT INTO staff(org_id,name,role,status) VALUES($1,'Synthetic property advisor','funding_advisor','active') RETURNING id", [orgId])).rows[0].id;
    const clientId = (await tx.query("INSERT INTO clients(org_id,first_name,last_name,email,is_demo) VALUES($1,'Synthetic','Property',$2,false) RETURNING id",
      [orgId, `property+${randomUUID()}@example.test`])).rows[0].id;
    const principal = { kind: "staff", orgId, staffId, role: "funding_advisor" };
    await storeIdentity(tx, { orgId, clientId, ssn: "666123456", dob: "1990-01-02", env });
    let orders = 0;
    const requestId = randomUUID();
    const client = { async order({ identity }) {
      orders++; assert.equal(identity.ssn, "666123456");
      assert.equal((await tx.query("SELECT count(*)::int AS n FROM crs_property_requests WHERE org_id=$1 AND status='in_flight'", [orgId])).rows[0].n, 1);
      return { ok: true, requestId, report: { providerRequestId: requestId,
        summary: { ownedPropertyCount: 1, foreclosureEventCount: 0 }, properties: [], currentEquity: null } };
    } };
    const input = () => ({ clientId, operationId: randomUUID(), consentAccepted: true, consentVersion: PROPERTY_CONSENT_VERSION });
    const first = await orderPropertyReport(tx, principal, input(), { env, client });
    assert.equal(first.body.status, "completed");
    const rows = (await tx.query("SELECT * FROM crs_property_requests WHERE org_id=$1 AND client_id=$2", [orgId, clientId])).rows;
    assert.equal(rows.length, 1); assert.equal(rows[0].provider_request_id, requestId);
    assert.equal(rows[0].consent_version, PROPERTY_CONSENT_VERSION);
    assert.equal((await tx.query("SELECT count(*)::int AS n FROM pii_access_log WHERE org_id=$1 AND client_id=$2", [orgId, clientId])).rows[0].n, 1);
    const original = (await tx.query("SELECT ssn_enc FROM pii_identity WHERE client_id=$1 AND org_id=$2", [clientId, orgId])).rows[0].ssn_enc;
    const reencryption = encryptSsn("666123456", { clientId, env });
    assert.equal(original.equals(reencryption), false);
    await tx.query("UPDATE pii_identity SET ssn_enc=$3 WHERE client_id=$1 AND org_id=$2", [clientId, orgId, reencryption]);
    assert.equal((await getPropertyReport(tx, principal, { clientId }, { env })).body.reason, "identity_changed");
    const replay = await orderPropertyReport(tx, principal, input(), { env, client });
    assert.equal(replay.body.status, "completed"); assert.equal(replay.body.replayed, true); assert.equal(orders, 1);
    assert.equal((await getPropertyReport(tx, principal, { clientId }, { env })).body.status, "completed");
    assert.equal((await tx.query("SELECT count(*)::int AS n FROM crs_property_requests WHERE org_id=$1", [orgId])).rows[0].n, 1);
    assert.doesNotMatch(JSON.stringify(rows), /666123456|1990-01-02|synthetic-password/);
    await tx.query("SAVEPOINT attribution");
    await assert.rejects(tx.query("UPDATE crs_property_requests SET client_id=$2 WHERE id=$1", [rows[0].id, randomUUID()]), /permission denied|immutable/);
    await tx.query("ROLLBACK TO SAVEPOINT attribution");
    await tx.query("SAVEPOINT foreign_scope");
    await assert.rejects(tx.query(`INSERT INTO crs_property_requests(org_id,client_id,requester_staff_id,operation_id,environment,identity_fingerprint,identity_version_fingerprint,consent_text,consent_version,status)
      VALUES($1,$2,$3,$4,'production',$5,$6,'Synthetic permission',$7,'in_flight')`,
    [foreignOrgId, clientId, staffId, randomUUID(), "a".repeat(64), "b".repeat(64), PROPERTY_CONSENT_VERSION]), /scope mismatch/);
    await tx.query("ROLLBACK TO SAVEPOINT foreign_scope");
    await assert.rejects(orderPropertyReport(tx, { ...principal, orgId: foreignOrgId }, input(), { env, client }), /client_not_found/);
  } finally { await tx.query("ROLLBACK"); tx.release(); await pool.end(); }
});

test("the client's own saved property permission lets staff order once, is bound to the saved identity, and is immutable as fundhub_app", {
  skip: !isLocalScratchDatabaseUrl(url)
}, async () => {
  const pool = new pg.Pool({ connectionString: url }); const tx = await pool.connect();
  try {
    await tx.query("BEGIN");
    const slug = `property-client-consent-${randomUUID()}`;
    const orgId = (await tx.query("INSERT INTO orgs(slug,name) VALUES($1,'Synthetic property consent proof') RETURNING id", [slug])).rows[0].id;
    const staffId = (await tx.query("INSERT INTO staff(org_id,name,role,status) VALUES($1,'Synthetic property advisor','funding_advisor','active') RETURNING id", [orgId])).rows[0].id;
    const clientId = (await tx.query("INSERT INTO clients(org_id,first_name,last_name,email,is_demo) VALUES($1,'Synthetic','Homeowner',$2,false) RETURNING id",
      [orgId, `property-consent+${randomUUID()}@example.test`])).rows[0].id;
    const accountId = (await tx.query("INSERT INTO accounts(org_id,kind,email,status,client_id) VALUES($1,'client',$2,'active',$3) RETURNING id",
      [orgId, `property-consent+${randomUUID()}@example.test`, clientId])).rows[0].id;
    const principal = { kind: "staff", orgId, staffId, role: "funding_advisor" };
    let orders = 0;
    const client = { async order() { orders++; const requestId = randomUUID(); return { ok: true, requestId, report: { providerRequestId: requestId,
      summary: { ownedPropertyCount: 1, foreclosureEventCount: 0 }, properties: [], currentEquity: null } }; } };
    const relying = () => ({ clientId, operationId: randomUUID(), consentAccepted: false, consentVersion: PROPERTY_CONSENT_VERSION });
    // No permission yet: no identity, no consent, no order.
    await assert.rejects(recordClientPropertyConsent(tx, { orgId, clientId, accountId, grantedName: "Synthetic Homeowner" }), /identity_required/);
    await storeIdentity(tx, { orgId, clientId, ssn: "666123457", dob: "1988-03-04", env });
    await assert.rejects(orderPropertyReport(tx, principal, relying(), { env, client }), /property_consent_required/);
    assert.equal(orders, 0);
    // The client ticks the box on the authorization form.
    const consent = await recordClientPropertyConsent(tx, { orgId, clientId, accountId, grantedName: "Synthetic Homeowner", capturedIp: "203.0.113.9" });
    assert.equal(consent.kind, "property_report_consent"); assert.equal(consent.granted_by_kind, "client"); assert.equal(consent.granted_by_account_id, accountId);
    assert.equal((await getPropertyReport(tx, principal, { clientId }, { env })).body.clientConsent.valid, true);
    assert.equal(orders, 0);
    // A staff-recorded row of the same kind never counts as the client's permission.
    const staffRow = await captureConsent(tx, { orgId, clientId, kind: "property_report_consent", consentText: PROPERTY_CONSENT_TEXT,
      consentVersion: PROPERTY_CONSENT_VERSION, captureMethod: "checkbox", grantedBy: { kind: "staff", id: staffId } });
    await tx.query("SAVEPOINT staff_kind");
    await assert.rejects(tx.query(`INSERT INTO crs_property_consents(consent_id,org_id,client_id,identity_version_fingerprint) VALUES($1,$2,$3,$4)`,
      [staffRow.id, orgId, clientId, "c".repeat(64)]), /scope mismatch/);
    await tx.query("ROLLBACK TO SAVEPOINT staff_kind");
    assert.equal((await getPropertyReport(tx, principal, { clientId }, { env })).body.clientConsent.valid, true);
    // The order relies on the saved permission and records which consent it used.
    const first = await orderPropertyReport(tx, principal, relying(), { env, client });
    assert.equal(first.body.status, "completed"); assert.equal(first.body.consentSource, "client"); assert.equal(orders, 1);
    const row = (await tx.query("SELECT consent_source,client_consent_id FROM crs_property_requests WHERE org_id=$1 AND client_id=$2", [orgId, clientId])).rows[0];
    assert.deepEqual(row, { consent_source: "client", client_consent_id: consent.id });
    await tx.query("SAVEPOINT source_immutable");
    await assert.rejects(tx.query("UPDATE crs_property_requests SET consent_source='staff',client_consent_id=NULL WHERE org_id=$1 AND client_id=$2", [orgId, clientId]), /permission denied|immutable/);
    await tx.query("ROLLBACK TO SAVEPOINT source_immutable");
    // A re-submitted form re-encrypts the SSN: the old tick no longer matches the saved identity.
    await tx.query("UPDATE pii_identity SET ssn_enc=$3 WHERE client_id=$1 AND org_id=$2", [clientId, orgId, encryptSsn("666123457", { clientId, env })]);
    assert.equal((await getPropertyReport(tx, principal, { clientId }, { env })).body.clientConsent.valid, false);
    // Revoking the permission (the generic consent path) also closes it.
    await tx.query("UPDATE client_consents SET revoked_at=now(),revoked_reason='synthetic',revoked_by_kind='client',revoked_by_account_id=$2 WHERE id=$1", [consent.id, accountId]);
    assert.equal((await getPropertyReport(tx, principal, { clientId }, { env })).body.clientConsent.valid, false);
    assert.equal(orders, 1);
  } finally { await tx.query("ROLLBACK"); tx.release(); await pool.end(); }
});
