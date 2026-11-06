import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { grant } from "../entitlements/entitlements.mjs";
import { captureConsent } from "../consent/index.mjs";
import { requestSoftPull } from "../finance/soft-pulls.mjs";
import { onPaidServicePaymentReceived } from "../handlers/paid-service-payment.mjs";
import { requestBlueprintHelp, quoteBlueprintHelp, checkoutBlueprintHelp, readBlueprintClientServices, requestBlueprintReport, offerBlueprintHelp, readBlueprintServiceOversight } from "./client-services.mjs";
import { processBlueprintClientServices } from "./report-requests.mjs";
import { authorizeBlueprintReportExecution } from "./report-allowance.mjs";

const url = process.env.DATABASE_URL;
const safe = url && (() => { const parsed = new URL(url); return ["localhost", "127.0.0.1"].includes(parsed.hostname) && /test|scratch|ci/i.test(parsed.pathname); })();

test("Blueprint paid services preserve exact scope, payments and one shared included report", { skip: !url ? "no DATABASE_URL" : false }, async () => {
  assert.equal(safe, true, "this test requires an isolated local scratch/CI database");
  const pool = new pg.Pool({ connectionString: url, ssl: false });
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const orgId = (await db.query("SELECT id FROM orgs ORDER BY created_at LIMIT 1")).rows[0].id;
    const clientId = (await db.query("INSERT INTO clients(org_id,first_name,last_name,email) VALUES ($1,'Service','Fixture',$2) RETURNING id", [orgId, `services-${randomUUID()}@example.com`])).rows[0].id;
    const accountId = (await db.query("INSERT INTO accounts(org_id,kind,email,status,client_id,password_hash) VALUES ($1,'client',$2,'active',$3,'fixture_hash') RETURNING id", [orgId, `services-account-${randomUUID()}@example.com`, clientId])).rows[0].id;
    const staffId = (await db.query("INSERT INTO staff(org_id,name,email,role) VALUES ($1,'Service CSM',$2,'csm') RETURNING id", [orgId, `services-csm-${randomUUID()}@example.com`])).rows[0].id;
    const transactionId = (await db.query("INSERT INTO transactions(org_id,client_id,product_name,amount_paid,status) SELECT $1,$2,name,30000,'succeeded' FROM products WHERE org_id=$1 AND code='blueprint-self-funding' RETURNING id", [orgId, clientId])).rows[0].id;
    await grant(db, { orgId, clientId, code: "blueprint-client-fulfillment", sourceTransactionId: transactionId });
    const installed = (await db.query("SELECT id,status FROM blueprint_fulfillment_engagements WHERE source_transaction_id=$1", [transactionId])).rows[0];
    assert.ok(installed, "the real paid grant installs the engagement");
    const scope = { orgId, clientId, accountId, engagement: { id: installed.id, status: installed.status, roundId: null }, now: new Date() };
    const oversight = await readBlueprintServiceOversight(db, { orgId });
    assert.ok(oversight.clients.some(row => row.clientId === clientId && row.helpRequests === 0), "healthy buyers appear in CSM oversight before requesting help");
    await captureConsent(db, { orgId, clientId, kind: "soft_pull_consent", consentText: "I authorize Fundhub to obtain my consumer credit report through a soft inquiry.", consentVersion: "soft-pull-v1", grantedBy: { kind: "client", id: accountId }, captureMethod: "checkbox" });
    const refused = async work => {
      await db.query("SAVEPOINT expected_refusal");
      try { await assert.rejects(work); } finally { await db.query("ROLLBACK TO SAVEPOINT expected_refusal"); }
    };

    const proactive = await offerBlueprintHelp(db, { ...scope, staffId }, { serviceKind: "funding_round", priceCents: 300000, idempotencyKey: "csm_proactive_funding_fixture" });
    assert.equal(proactive.request.status, "quoted");
    assert.equal(proactive.request.priceCents, 300000);
    assert.equal((await db.query("SELECT requested_by_kind,requested_by_staff_id FROM paid_service_requests WHERE id=$1", [proactive.request.id])).rows[0].requested_by_staff_id, staffId);
    const repairCases = (await db.query("INSERT INTO dispute_cases(org_id,client_id,bureau,round) VALUES ($1,$2,'EX','R1'),($1,$2,'TU','R1') RETURNING id", [orgId, clientId])).rows;
    const roundHelp = await requestBlueprintHelp(db, scope, { serviceKind: "repair_round", targetId: repairCases[0].id, idempotencyKey: "request_repair_round_fixture" });
    const sameRound = await requestBlueprintHelp(db, scope, { serviceKind: "repair_round", targetId: repairCases[1].id, idempotencyKey: "request_same_round_fixture" });
    assert.equal(sameRound.request.id, roundHelp.request.id);
    assert.equal(roundHelp.request.roundKey, "R1");

    const help = await requestBlueprintHelp(db, scope, { serviceKind: "repair_full", idempotencyKey: "request_full_repair_fixture" });
    const replay = await requestBlueprintHelp(db, scope, { serviceKind: "repair_full", idempotencyKey: "request_full_repair_fixture" });
    assert.equal(replay.request.id, help.request.id);
    await assert.rejects(quoteBlueprintHelp(db, scope, { requestId: help.request.id, priceCents: 100000 }), { code: "forbidden" });
    await quoteBlueprintHelp(db, { ...scope, staffId }, { requestId: help.request.id, priceCents: 100000 });
    let checkouts = 0;
    const mint = async () => { checkouts++; return { ok: true, checkoutUrl: "https://pay.example.com/fixture-service" }; };
    await checkoutBlueprintHelp(db, scope, { requestId: help.request.id, authorization: true }, { mint });
    await checkoutBlueprintHelp(db, scope, { requestId: help.request.id, authorization: true }, { mint });
    assert.equal(checkouts, 1);
    await assert.rejects(quoteBlueprintHelp(db, { ...scope, staffId }, { requestId: help.request.id, priceCents: 50000 }), { code: "quote_locked" });
    const wrongPayment = await onPaidServicePaymentReceived({ orgId, payload: { ref: help.request.id, amountCents: 99999, paymentId: "fixture_short" } }, db);
    assert.equal(wrongPayment.done, false);
    assert.equal((await db.query("SELECT status FROM paid_service_requests WHERE id=$1", [help.request.id])).rows[0].status, "awaiting_payment");
    const event = { orgId, payload: { ref: help.request.id, amountCents: 100000, paymentId: `fixture-help-${help.request.id}` } };
    assert.equal((await onPaidServicePaymentReceived(event, db)).done, true);
    assert.equal((await onPaidServicePaymentReceived(event, db)).done, true);
    assert.equal(Number((await db.query("SELECT count(*) FROM tasks WHERE org_id=$1 AND client_id=$2 AND source_workflow='blueprint-paid-help'", [orgId, clientId])).rows[0].count), 1);

    const included = await requestBlueprintReport(db, scope, { idempotencyKey: "included_report_fixture" });
    assert.equal(included.requiresPayment, false);
    const ledger = (await db.query("SELECT * FROM soft_pull_requests WHERE id=$1", [included.reportRequestId])).rows[0];
    assert.equal(ledger.blueprint_report_kind, "included");
    await authorizeBlueprintReportExecution(db, ledger);
    await db.query("UPDATE soft_pull_requests SET status='failed',resolved_at=now(),state_reason='fixture definite failure requiring review' WHERE id=$1", [ledger.id]);
    await refused(() => requestSoftPull(db, { orgId, clientId, requestedBy: { kind: "staff", staffId }, reason: "second staff request", idempotencyKey: "second-request-fixture" }));
    await refused(() => requestSoftPull(db, { orgId, clientId, requestedBy: { kind: "system" }, reason: "second scheduled request", idempotencyKey: "another-system-fixture" }));
    const extra = await requestBlueprintReport(db, scope, { idempotencyKey: "paid_extra_report_fixture" });
    assert.equal(extra.requiresPayment, true);
    assert.equal(extra.request.priceCents, 3200);
    await checkoutBlueprintHelp(db, scope, { requestId: extra.request.id, authorization: true }, { mint });
    const extraEvent = { orgId, payload: { ref: extra.request.id, amountCents: 3200, paymentId: `fixture-extra-${extra.request.id}` } };
    await onPaidServicePaymentReceived(extraEvent, db);
    await onPaidServicePaymentReceived(extraEvent, db);
    assert.equal(Number((await db.query("SELECT count(*) FROM soft_pull_requests WHERE blueprint_service_request_id=$1", [extra.request.id])).rows[0].count), 1);
    await authorizeBlueprintReportExecution(db, (await db.query("SELECT * FROM soft_pull_requests WHERE blueprint_service_request_id=$1", [extra.request.id])).rows[0]);
    let providerCalls = 0;
    let aftercareCalls = 0;
    const result = await processBlueprintClientServices(db, {
      env: { CRS_ALLOW_LIVE: "1", FINANCE_OS_SYSTEM_PULL_LIVE: "1" },
      runPull: async (_db, request) => {
        providerCalls++;
        const reportId = (await db.query("INSERT INTO crs_results(org_id,client_id,provider,provider_result_id,result) VALUES ($1,$2,'fixture',$3,'{}') RETURNING id", [orgId, clientId, `service-report-${request.requestId}`])).rows[0].id;
        await db.query("UPDATE soft_pull_requests SET status='fulfilled',crs_result_id=$2,resolved_at=now() WHERE id=$1", [request.requestId, reportId]);
        return { ok: true, simulated: false, crsResultId: reportId };
      }, aftercare: async (_db, input) => { aftercareCalls++; assert.equal(input.clientId, clientId); return { ok: true }; }
    });
    assert.equal(result.fulfilled, 1);
    assert.equal(providerCalls, 1);
    assert.equal(aftercareCalls, 1);
    const delivered = (await db.query("SELECT p.status,p.produced_kind,s.state FROM paid_service_requests p JOIN blueprint_client_services s ON s.id=p.id WHERE p.id=$1", [extra.request.id])).rows[0];
    assert.deepEqual(delivered, { status: "fulfilled", produced_kind: "crs_result", state: "completed" });
    const legacyRoundId = randomUUID();
    await db.query(`INSERT INTO paid_service_requests(id,org_id,client_id,service_kind,requested_by_kind,requested_by_account_id,
      status,price_components,price_total_cents,amount_paid_cents,payment_ref,paid_at,round_no)
      VALUES ($1,$2,$3,'dispute_round','client',$4,'paid','[{"code":"round_base","amount_cents":10000}]',10000,10000,$5,now(),1)`,
    [legacyRoundId, orgId, clientId, accountId, `fixture-legacy-round-${legacyRoundId}`]);
    const legacy = await requestSoftPull(db, { orgId, clientId, requestedBy: { kind: "client", accountId }, reason: "Fresh report included with a separately paid round", idempotencyKey: `paid_round_pull:${legacyRoundId}` });
    const legacyLedger = (await db.query("SELECT * FROM soft_pull_requests WHERE id=$1", [legacy.request.id])).rows[0];
    assert.equal(legacyLedger.blueprint_report_kind, "paid_round");
    await authorizeBlueprintReportExecution(db, legacyLedger);
    await db.query("UPDATE soft_pull_requests SET status='failed',resolved_at=now(),state_reason='fixture complete' WHERE id=$1", [legacy.request.id]);
    const view = await readBlueprintClientServices(db, { ...scope, staffId });
    assert.equal(view.capabilities.quote, true);
    assert.equal(view.requests.find(row => row.id === help.request.id).scopeType, "client");
    assert.equal(view.serviceTypes.find(type => type.key === "repair_round").targets.length, 1);
    assert.equal(view.serviceTypes.find(type => type.key === "funding_round").targets[0].id, scope.engagement.id);
    await refused(() => db.query("UPDATE blueprint_client_services SET target_id=$2 WHERE id=$1", [help.request.id, randomUUID()]));
    await db.query("UPDATE blueprint_fulfillment_engagements SET status='completed',completed_at=now() WHERE id=$1", [scope.engagement.id]);
    await refused(() => requestSoftPull(db, { orgId, clientId, requestedBy: { kind: "system" }, reason: "closed engagement included pull", idempotencyKey: "ended-monthly-fixture" }));
  } finally {
    try { await db.query("ROLLBACK"); } finally { db.release(); await pool.end(); }
  }
});

test("simultaneous client and scheduled requests reserve only one included report", { skip: !url ? "no DATABASE_URL" : false }, async () => {
  assert.equal(safe, true, "this test requires an isolated local scratch/CI database");
  const pool = new pg.Pool({ connectionString: url, ssl: false, max: 4 });
  let clientId;
  try {
    const orgId = (await pool.query("SELECT id FROM orgs ORDER BY created_at LIMIT 1")).rows[0].id;
    clientId = (await pool.query("INSERT INTO clients(org_id,first_name,last_name,email) VALUES ($1,'Concurrent','Fixture',$2) RETURNING id", [orgId, `concurrent-services-${randomUUID()}@example.com`])).rows[0].id;
    const accountId = (await pool.query("INSERT INTO accounts(org_id,kind,email,status,client_id,password_hash) VALUES ($1,'client',$2,'active',$3,'fixture_hash') RETURNING id", [orgId, `concurrent-account-${randomUUID()}@example.com`, clientId])).rows[0].id;
    const transactionId = (await pool.query("INSERT INTO transactions(org_id,client_id,product_name,amount_paid,status) SELECT $1,$2,name,30000,'succeeded' FROM products WHERE org_id=$1 AND code='blueprint-self-funding' RETURNING id", [orgId, clientId])).rows[0].id;
    await grant(pool, { orgId, clientId, code: "blueprint-client-fulfillment", sourceTransactionId: transactionId });
    await captureConsent(pool, { orgId, clientId, kind: "soft_pull_consent", consentText: "I authorize Fundhub to obtain my consumer credit report through a soft inquiry.", consentVersion: "soft-pull-v1", grantedBy: { kind: "client", id: accountId }, captureMethod: "checkbox" });
    const requests = await Promise.all([
      requestSoftPull(pool, { orgId, clientId, requestedBy: { kind: "client", accountId }, reason: "concurrent client request", idempotencyKey: `concurrent-client:${clientId}` }),
      requestSoftPull(pool, { orgId, clientId, requestedBy: { kind: "system" }, reason: "concurrent scheduled request", idempotencyKey: `concurrent-system:${clientId}` })
    ]);
    assert.equal(requests.filter(row => row.created).length, 1);
    assert.equal(new Set(requests.map(row => row.request.id)).size, 1);
    const rows = (await pool.query("SELECT blueprint_report_kind FROM soft_pull_requests WHERE client_id=$1", [clientId])).rows;
    assert.deepEqual(rows, [{ blueprint_report_kind: "included" }]);
  } finally {
    if (clientId) {
      const db = await pool.connect();
      try {
        await db.query("BEGIN");
        await db.query("UPDATE soft_pull_requests SET status='cancelled',resolved_at=now() WHERE client_id=$1 AND status IN ('queued','processing')", [clientId]);
        await db.query("UPDATE blueprint_fulfillment_engagements SET status='completed',completed_at=now() WHERE client_id=$1", [clientId]);
        await db.query("UPDATE entitlements SET revoked_at=now(),revoke_reason='scratch_test_complete' WHERE client_id=$1", [clientId]);
        await db.query("UPDATE accounts SET status='suspended' WHERE client_id=$1", [clientId]);
        await db.query("UPDATE clients SET custom_fields=COALESCE(custom_fields,'{}')||jsonb_build_object('crm_archived_at',now()::text) WHERE id=$1", [clientId]);
        await db.query("COMMIT");
      } catch (error) { await db.query("ROLLBACK"); await pool.end(); throw error; }
      finally { db.release(); }
    }
    await pool.end();
  }
});
