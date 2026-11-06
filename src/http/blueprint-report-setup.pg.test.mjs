import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import approve from "../../api/soft-pull-approve.mjs";
import services from "../../api/blueprint/services.mjs";
import { createAccountSession } from "../auth/account-session.mjs";
import { grant } from "../entitlements/entitlements.mjs";
import { loadClientIdentity } from "../finance/crs-pull.mjs";
import { storeIdentity } from "../pii/index.mjs";
import { captureConsent, revokeConsent } from "../consent/index.mjs";
import { CURRENT_SOFT_PULL_VERSION, SOFT_PULL_DISCLOSURES } from "../consent/disclosures.mjs";
import { emit } from "../events/bus.mjs";
import { onPaymentReceived } from "../handlers/client-lifecycle.mjs";
import { onPaymentReceivedMoney } from "../handlers/money-chain.mjs";
import { requestSoftPull } from "../finance/soft-pulls.mjs";
import { dueClients } from "../workflows/finance-os-pull-sweeper.mjs";
import { isLocalScratchDatabaseUrl } from "../verification/scratch-guard.mjs";

const url = process.env.APP_DATABASE_URL || process.env.DATABASE_URL;
const query = { portal: "1", blueprint: "1" };
const env = { PII_ENC_KEY: randomBytes(32).toString("base64") };
const form = { first_name: "María José", last_name: "De la Cruz", ssn: "0".repeat(9), dob: "1980-01-01",
  address_line1: "1 Test Street", city: "Phoenix", state: "AZ", postal_code: "85001" };

async function call(handler, db, token, method, body, queryParams = {}) {
  const res = { code: 200, setHeader() {}, status(code) { this.code = code; return this; }, json(out) { this.body = out; } };
  await handler({ method, body, query: queryParams, headers: { authorization: "Bearer " + token } }, res, {
    db, env, fetchImpl: () => assert.fail("first report must not call checkout"), runPaidPull: () => assert.fail("must not run a diagnostic")
  });
  return res;
}

async function buyer(db, orgId) {
  const email = "first-report+" + randomUUID() + "@example.test";
  const { id: clientId } = (await db.query("INSERT INTO clients(org_id,first_name,email) VALUES($1,'Olddisplay',$2) RETURNING id", [orgId, email])).rows[0];
  const { id: accountId } = (await db.query(`INSERT INTO accounts(org_id,client_id,kind,email,status,password_hash)
    VALUES($1,$2,'client',$3,'active','synthetic-fixture') RETURNING id`, [orgId, clientId, email])).rows[0];
  const { token } = await createAccountSession(db, { accountId, orgId });
  return { orgId, clientId, accountId, token };
}

async function purchase(db, { orgId, clientId }) {
  const { id: productId } = (await db.query("SELECT id FROM products WHERE org_id=$1 AND code='blueprint-self-funding'", [orgId])).rows[0];
  const { id: paymentLinkId } = (await db.query(`INSERT INTO payment_links(org_id,client_id,product_id,purpose,description,amount_cents,link_ref,checkout_url,status)
    VALUES($1,$2,$3,'custom','Full Blueprint',3000000,$4,'https://example.test/fixture','paid') RETURNING id`,
    [orgId, clientId, productId, "pl_fixture_" + randomUUID()])).rows[0];
  const event = { name: "payment.received", orgId, clientId, payload: { productName: "blueprint-self-funding", product: "diy",
    productId, paymentLinkId, amount: 30000, amountCents: 3000000, providerRef: "synthetic-" + randomUUID(), source: "commas" } };
  event.id = (await emit(db, event.name, event.payload, { orgId, clientId, skipInngest: true })).id;
  await onPaymentReceived(event, db);
  assert.equal((await onPaymentReceivedMoney(event, db)).done, true);
}

test("new full purchase collects buyer identity and typed consent, then queues exactly one included report", {
  skip: !isLocalScratchDatabaseUrl(url)
}, async () => {
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    assert.equal((await db.query("SELECT current_user")).rows[0].current_user, "fundhub_app");
    const { id: orgId } = (await db.query("SELECT id FROM orgs WHERE is_default LIMIT 1")).rows[0];
    const first = await buyer(db, orgId);
    const outsider = await buyer(db, orgId);
    await purchase(db, first);
    const { clientId, accountId, token } = first;
    for (const table of ["pii_identity", "client_consents", "crs_results", "soft_pull_requests"]) {
      assert.equal((await db.query("SELECT 1 FROM " + table + " WHERE client_id=$1", [clientId])).rowCount, 0);
    }
    const biz = (await db.query(`INSERT INTO businesses(org_id,client_id,name,entity_data)
      VALUES($1,$2,'Preserved Company','{"source":"soft_pull_approve"}') RETURNING id`, [orgId, clientId])).rows[0].id;
    const view = await call(services, db, token, "GET");
    assert.equal(view.code, 200); assert.deepEqual(view.body.reportSetup, { required: true, authorizationUrl: "/app/soft-pull-approve.html?portal=1&blueprint=1" });
    const gate = await call(services, db, token, "POST", { action: "request_report", idempotencyKey: randomUUID() });
    assert.equal(gate.body.error, "report_setup_required"); assert.equal(gate.code, 409);
    const open = await call(approve, db, token, "GET", null, query);
    assert.equal(open.code, 200); assert.equal(open.body.mode, "blueprint"); assert.equal(open.body.consent.valid, false);
    assert.equal(open.body.reportSetup.required, true); assert.ok(open.body.disclosure.text);
    assert.equal((await call(approve, db, outsider.token, "POST", form, query)).code, 403);
    assert.equal((await call(approve, db, token, "POST", { ...form, client: outsider.clientId }, query)).code, 403);
    assert.equal((await call(approve, db, token, "POST", { ...form, ssn: "" }, query)).body.error, "ssn_required");
    assert.equal((await call(approve, db, token, "POST", { ...form, last_name: "" }, query)).body.error, "last_name_required");
    const submitted = await call(approve, db, token, "POST", { ...form, org: orgId, client: clientId }, query);
    assert.equal(submitted.code, 201, JSON.stringify(submitted.body)); assert.equal(submitted.body.pull.status, "queued");
    assert.ok(submitted.body.reportRequestId); assert.equal(submitted.body.checkout, undefined);
    assert.equal((await call(approve, db, token, "POST", form, query)).body.reportRequestId, submitted.body.reportRequestId);
    assert.equal((await call(services, db, token, "GET")).body.reportSetup.required, false);
    const saved = (await db.query(`SELECT octet_length(ssn_enc)>20 AS encrypted, position(convert_to($2,'UTF8') in ssn_enc)=0 AS ciphertext
      FROM pii_identity WHERE client_id=$1 AND org_id=$3`, [clientId, form.ssn, orgId])).rows[0];
    assert.deepEqual(saved, { encrypted: true, ciphertext: true });
    const providerIdentity = await loadClientIdentity(db, { clientId, env });
    assert.deepEqual([providerIdentity.firstName, providerIdentity.lastName, providerIdentity.birthDate],
      [form.first_name, form.last_name, form.dob], "the actual bureau loader must receive the authorized legal name");
    const consents = (await db.query(`SELECT consent_text,consent_version,granted_name,capture_method,granted_by_account_id FROM client_consents
      WHERE org_id=$1 AND client_id=$2 AND kind='soft_pull_consent'`, [orgId, clientId])).rows;
    assert.deepEqual(consents, [{ consent_text: SOFT_PULL_DISCLOSURES[CURRENT_SOFT_PULL_VERSION].text, consent_version: CURRENT_SOFT_PULL_VERSION,
      granted_name: form.first_name + " " + form.last_name, capture_method: "typed", granted_by_account_id: accountId }]);
    const ledger = (await db.query(`SELECT id,status,requested_by_account_id,blueprint_report_kind,blueprint_engagement_id FROM soft_pull_requests
      WHERE org_id=$1 AND client_id=$2`, [orgId, clientId])).rows;
    assert.deepEqual(ledger, [{ id: submitted.body.reportRequestId, status: "queued", requested_by_account_id: accountId,
      blueprint_report_kind: "included", blueprint_engagement_id: view.body.engagement.id }]);
    assert.equal((await db.query("SELECT 1 FROM businesses WHERE id=$1 AND client_id=$2", [biz, clientId])).rowCount, 1);
    assert.equal((await db.query("SELECT 1 FROM payment_links WHERE client_id=$1 AND purpose='diagnostic'", [clientId])).rowCount, 0);
    assert.equal((await db.query("SELECT 1 FROM paid_service_requests WHERE client_id=$1", [clientId])).rowCount, 0);
    assert.equal((await db.query("SELECT 1 FROM crs_results WHERE client_id=$1", [clientId])).rowCount, 0);

    // Re-consent with a previously saved authorization but no encrypted identity still needs the form.
    const partial = await buyer(db, orgId);
    await purchase(db, partial);
    await captureConsent(db, { ...partial, kind: "soft_pull_consent", consentText: "Previously authorized",
      captureMethod: "typed", grantedName: "Synthetic Buyer", grantedBy: { kind: "client", id: partial.accountId } });
    assert.equal((await dueClients(db, new Date(Date.now() + 1000), { realPull: true })).some(row => row.client_id === partial.clientId), false);
    const missingIdentity = (await call(approve, db, partial.token, "GET", null, query)).body;
    assert.equal(missingIdentity.consent.valid, true); assert.equal(missingIdentity.reportSetup.required, true);
    // A prior entrance used the allowance before the buyer completed identity.
    // An unresolved provider outcome must not be ordered again or turned into paid help.
    const used = await requestSoftPull(db, { orgId, clientId: partial.clientId,
      requestedBy: { kind: "client", accountId: partial.accountId }, reason: "Existing report request", idempotencyKey: randomUUID() });
    await db.query("UPDATE soft_pull_requests SET status='failed',resolved_at=now(),state_reason='Needs provider reconciliation' WHERE id=$1", [used.request.id]);
    const existing = await call(approve, db, partial.token, "POST", form, query);
    assert.equal(existing.code, 201); assert.equal(existing.body.pull.status, "failed"); assert.ok(existing.body.nextIncludedAt);
    assert.equal((await call(approve, db, partial.token, "GET", null, query)).body.reportSetup.required, false);
    assert.equal((await db.query("SELECT 1 FROM soft_pull_requests WHERE client_id=$1", [partial.clientId])).rowCount, 1);
    assert.equal((await db.query("SELECT 1 FROM paid_service_requests WHERE client_id=$1", [partial.clientId])).rowCount, 0);

    await db.query("UPDATE blueprint_fulfillment_engagements SET status='completed',completed_at=now() WHERE id=$1", [view.body.engagement.id]);
    for (const method of ["GET", "POST"]) assert.ok([403, 409].includes((await call(approve, db, token, method, form, query)).code));
  } finally { await db.query("ROLLBACK"); db.release(); await pool.end(); }
});

test("every monthly entry for an active full buyer waits for usable identity and consent", {
  skip: !isLocalScratchDatabaseUrl(url)
}, async () => {
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const { id: orgId } = (await db.query("SELECT id FROM orgs WHERE is_default LIMIT 1")).rows[0];
    const mixed = await buyer(db, orgId);
    const prepOnly = await buyer(db, orgId);
    const now = new Date(Date.now() + 1000);
    const due = async person => (await dueClients(db, now, { realPull: true })).find(row => row.client_id === person.clientId);
    async function prep(person) {
      const receipt = (await db.query(`INSERT INTO transactions(org_id,client_id,product_name,amount_paid,status)
        SELECT $1,$2,name,7500,'succeeded' FROM products WHERE org_id=$1 AND code='consulting-package' RETURNING id`,
        [orgId, person.clientId])).rows[0];
      return grant(db, { orgId, clientId: person.clientId, code: "credit-optimization-roadmap", sourceTransactionId: receipt.id });
    }
    await purchase(db, mixed);
    const prepGrant = await prep(mixed);
    const legacy = await prep(prepOnly);
    assert.equal((await due(prepOnly)).subscription_id, legacy.id, "standalone prep retains its existing eligibility");
    const consent = await captureConsent(db, { ...mixed, kind: "soft_pull_consent", consentText: "Saved typed permission",
      grantedName: "Synthetic Buyer", captureMethod: "typed", grantedBy: { kind: "client", id: mixed.accountId } });
    assert.equal(await due(mixed), undefined, "prep access cannot bypass the full-package setup");
    await storeIdentity(db, { ...mixed, ssn: form.ssn, env });
    assert.equal((await call(services, db, mixed.token, "GET")).body.reportSetup.required, true);
    assert.equal(await due(mixed), undefined, "SSN alone is not a usable bureau identity");
    await storeIdentity(db, { ...mixed, dob: form.dob, addresses: [], env });
    assert.equal(await due(mixed), undefined);
    await storeIdentity(db, { ...mixed, dob: form.dob, addresses: [{ addressLine1: form.address_line1, city: form.city,
      state: form.state, postalCode: form.postal_code }], env });
    assert.equal(await due(mixed), undefined, "a record still missing its legal last name requires setup");
    await db.query("UPDATE clients SET first_name=$3,last_name=$4 WHERE org_id=$1 AND id=$2",
      [orgId, mixed.clientId, form.first_name, form.last_name]);
    assert.equal((await due(mixed)).subscription_id, prepGrant.id);
    const sub = (await db.query(`INSERT INTO subscriptions(org_id,client_id,tier,status,effective_from,current_period_start,current_period_end)
      VALUES($1,$2,'finance-os','active',now()-interval '1 day',now()-interval '1 day',now()+interval '29 days') RETURNING id`,
      [orgId, mixed.clientId])).rows[0];
    assert.equal((await due(mixed)).subscription_id, sub.id);
    await revokeConsent(db, { orgId, consentId: consent.id, reason: "Synthetic withdrawal", revokedBy: { kind: "client", id: mixed.accountId } });
    assert.equal(await due(mixed), undefined, "a paid subscription cannot bypass withdrawn consent for a full buyer");
    assert.equal((await call(services, db, mixed.token, "GET")).body.reportSetup.required, true);
    assert.equal((await db.query("SELECT 1 FROM soft_pull_requests WHERE client_id=$1", [mixed.clientId])).rowCount, 0);
  } finally { await db.query("ROLLBACK"); db.release(); await pool.end(); }
});
