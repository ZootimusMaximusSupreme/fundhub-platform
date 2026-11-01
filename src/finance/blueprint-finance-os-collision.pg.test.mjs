// FinanceOS 12-month collision acceptance: scratch Postgres ONLY, rollback every fixture.
// No external providers, customers, subscriptions or live billing are changed.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { financeOsEntitlement, addUtcMonths } from "./finance-os-entitlement.mjs";
import { isBlueprintCoachClient } from "../blueprint/coach.mjs";
import { dueClients } from "../workflows/finance-os-pull-sweeper.mjs";
import { onPaymentRefundedMoney, ensureSalePayment } from "../handlers/money-chain.mjs";
import { FINANCE_OS_BLUEPRINT_NOTE } from "./finance-os-entitlement.mjs";

const connectionString = process.env.BLUEPRINT_TEST_DATABASE_URL || process.env.DATABASE_URL;
let safe = false;
try {
  const u = new URL(connectionString);
  safe = ["127.0.0.1", "localhost", "::1", "[::1]"].includes(u.hostname)
    && /(?:test|scratch|_ci)(?:\b|_)/i.test(u.pathname);
} catch { /* refuse unknown and production databases */ }
const pool = safe ? new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 5000 }) : null;
after(async () => { if (pool) await pool.end(); });

test("refund receipt lookup and cumulative amounts stay inside the original provider", { skip: !safe }, async () => {
  const conn = await pool.connect();
  await conn.query("BEGIN");
  try {
    for (const table of ["transactions", "products", "product_aliases", "sales", "sale_payments",
      "entitlements", "subscriptions", "events", "partner_revenue"]) {
      await conn.query(`CREATE TEMP TABLE ${table} (LIKE public.${table} INCLUDING ALL) ON COMMIT DROP`);
    }
    await conn.query("SET LOCAL search_path TO pg_temp, public");
    const org = randomUUID(), grants = {}, clients = {};
    const product = (await conn.query("INSERT INTO products (org_id,code,name,category) VALUES ($1,'consulting-package','Consulting Services Package','consulting') RETURNING id", [org])).rows[0].id;
    for (const provider of ["whop", "commas"]) {
      const client = randomUUID();
      clients[provider] = client;
      const payment = (await conn.query(
        `INSERT INTO transactions (org_id,client_id,product_name,amount_paid,status,provider,provider_ref)
         VALUES ($1,$2,'Consulting Services Package',100,'succeeded',$3,$4) RETURNING id`,
        [org, client, provider, `${provider}-original`]
      )).rows[0].id;
      grants[provider] = (await conn.query(
        `INSERT INTO entitlements (org_id,client_id,entitlement_code,source_transaction_id,grant_reason)
         VALUES ($1,$2,'credit-optimization-roadmap',$3,'purchase:consulting-package') RETURNING id`,
        [org, client, payment]
      )).rows[0].id;
    }
    const refund = async (source, amount, ref = `${source}-original`) => {
      const payload = { originalProviderRef: ref, providerRef: randomUUID(), source, amount };
      const id = (await conn.query(
        "INSERT INTO events (org_id,name,version,idempotency_key,payload) VALUES ($1,'payment.refunded',1,$2,$3) RETURNING id",
        [org, randomUUID(), payload]
      )).rows[0].id;
      return onPaymentRefundedMoney({ id, name: "payment.refunded", orgId: org, payload }, { query: conn.query.bind(conn) });
    };
    const revoked = async provider => (await conn.query("SELECT revoked_at FROM entitlements WHERE id=$1", [grants[provider]])).rows[0].revoked_at;
    const sale = (await conn.query(
      "INSERT INTO sales (org_id,client_id,product_id,agreed_price) VALUES ($1,$2,$3,100) RETURNING id",
      [org, clients.commas, product]
    )).rows[0].id;
    const purchase = await ensureSalePayment({ query: conn.query.bind(conn) }, {
      id: randomUUID(), orgId: org, payload: { source: "commas", providerRef: "whop-original",
        productName: "Consulting Services Package", amount: 100 }
    }, { saleId: sale, clientId: clients.commas, productId: product, kind: "deposit" });
    assert.equal(purchase.reason, "transaction_source_conflict",
      "provider lookup must preserve purchase refusal rather than fall back to an event-only payment");
    assert.equal((await conn.query("SELECT count(*)::int n FROM sale_payments")).rows[0].n, 0);
    assert.equal((await refund("commas", 100, "whop-original")).reason, "no_original_payment",
      "a callback's provider must match the receipt, even when its reference exists in the same org");
    assert.equal((await refund("whop", 40, "commas-original")).reason, "no_original_payment");
    assert.equal((await refund("commas", 60)).blueprintIncludedEnded, false,
      "another provider's unowned refund event cannot complete this provider's refund");
    assert.equal(await revoked("whop"), null);
    assert.equal(await revoked("commas"), null);
    assert.equal((await refund("commas", 40)).blueprintIncludedEnded, true);
    assert.notEqual(await revoked("commas"), null);
    assert.equal(await revoked("whop"), null, "Commas refund cannot revoke the colliding Whop purchase");
    assert.equal((await refund("whop", 60)).blueprintIncludedEnded, false);
    assert.equal((await refund("whop", 40)).blueprintIncludedEnded, true);
    assert.notEqual(await revoked("whop"), null);
  } finally {
    await conn.query("ROLLBACK");
    conn.release();
  }
});

test("paid Blueprint year survives the shorter FinanceOS monthly term, but not a refund or month 13",
  { skip: safe ? false : "requires a local test/scratch PostgreSQL database" }, async () => {
    const db = await pool.connect();
    await db.query("BEGIN");
    await db.query("SET LOCAL TIME ZONE 'UTC'");
    try {
      // Keep refund writes inside this fixture's rollback transaction. The
      // production helper acquires a connection only for pool-like handles.
      const refundDb = { query: db.query.bind(db) };
      for (const table of ["subscriptions", "soft_pull_requests", "crs_results",
        "entitlements", "transactions", "products", "product_aliases", "sales",
        "sale_payments", "partner_revenue", "events"]) {
        await db.query("CREATE TEMP TABLE " + table + " (LIKE public." + table
          + " INCLUDING ALL) ON COMMIT DROP");
      }
      await db.query("SET LOCAL search_path TO pg_temp, public");
      const org = randomUUID(), client = randomUUID(), foreignOrg = randomUUID();
      const product = (await db.query(
        "INSERT INTO products (org_id,code,name,category) VALUES ($1,'consulting-package','Consulting Services Package','consulting') RETURNING id",
        [org])).rows[0].id;
      const monthly = (await db.query(
        "INSERT INTO subscriptions (org_id,client_id,tier,status,current_period_start,current_period_end,effective_from) "
        + "VALUES ($1,$2,'finance-os','active','2026-10-01','2026-11-01','2026-10-01') RETURNING id",
        [org,client])).rows[0].id;
      const payment = (await db.query(
        "INSERT INTO transactions (org_id,client_id,product_name,amount_paid,status,provider_ref,created_at) "
        + "VALUES ($1,$2,'Consulting Services Package',7500,'succeeded','bp-collision-paid','2026-10-31T00:00:00Z') RETURNING id",
        [org,client])).rows[0].id;
      const sale = (await db.query(
        "INSERT INTO sales (org_id,client_id,product_id,agreed_price) VALUES ($1,$2,$3,7500) RETURNING id",
        [org, client, product])).rows[0].id;
      await db.query(
        "INSERT INTO sale_payments (org_id,sale_id,transaction_id,product_id,kind,amount,paid_at) "
        + "VALUES ($1,$2,$3,$4,'deposit',7500,'2026-10-29T00:00:00Z')",
        [org, sale, payment, product]);
      const grant = (await db.query(
        "INSERT INTO entitlements (org_id,client_id,entitlement_code,source_transaction_id,grant_reason,granted_at) "
        + "VALUES ($1,$2,'credit-optimization-roadmap',$3,'purchase:consulting-package','2026-10-29') RETURNING id",
        [org,client,payment])).rows[0].id;
      const access = iso => financeOsEntitlement(db, {
        orgId: org, clientId: client, asOf: new Date(iso)
      });
      const due = async iso => (await dueClients(db, new Date(iso)))
        .map(row => row.subscription_id);
      assert.equal((await access("2026-10-30T00:00:00Z")).subscriptionId, monthly);
      assert.equal((await access("2026-11-30T00:00:00Z")).subscriptionId, grant);
      assert.deepEqual(await due("2026-11-30T00:00:00Z"), [grant]);
      assert.equal((await access("2027-10-28T00:00:00Z")).entitled, true);
      assert.equal((await access("2027-10-29T00:00:00Z")).entitled, false);
      assert.equal((await access("2027-10-30T00:00:00Z")).entitled, false,
        "recording the transaction two days late cannot extend the paid year");
      const coachAt = iso => isBlueprintCoachClient(db, {
        orgId: org, clientId: client, asOf: new Date(iso)
      });
      assert.equal(await coachAt("2026-10-30T00:00:00Z"), true);
      assert.equal(await coachAt("2027-10-28T00:00:00Z"), true);
      assert.equal(await coachAt("2027-10-29T00:00:00Z"), false);
      assert.equal(await isBlueprintCoachClient(db, { orgId: foreignOrg, clientId: client,
        asOf: new Date("2026-11-30T00:00:00Z") }), false);
      assert.deepEqual(await due("2027-10-29T00:00:00Z"), []);
      assert.equal((await financeOsEntitlement(db, {
        orgId: foreignOrg, clientId: client, asOf: new Date("2026-11-30")
      })).entitled, false, "foreign tenant cannot claim the client's purchase");
      const refund = await onPaymentRefundedMoney({ name: "payment.refunded", orgId: org,
        payload: { providerRef: "bp-collision-paid", amount: 7500 } }, refundDb);
      assert.equal(refund.blueprintIncludedEnded, true);
      assert.equal((await db.query("SELECT revoked_at FROM entitlements WHERE id=$1", [grant])).rows[0].revoked_at != null, true);
      assert.equal(await coachAt("2026-11-30T00:00:00Z"), false);
      assert.equal((await access("2026-11-30T00:00:00Z")).entitled, false);
      assert.deepEqual(await due("2026-11-30T00:00:00Z"), []);
      const original = (await db.query(
        "SELECT current_period_end, status FROM subscriptions WHERE id=$1", [monthly])).rows[0];
      assert.equal(new Date(original.current_period_end).toISOString(),
        "2026-11-01T00:00:00.000Z");
      assert.equal(original.status, "active", "original billed monthly plan stays unchanged");

      const includedClient = randomUUID();
      const includedPayment = (await db.query(
        "INSERT INTO transactions (org_id,client_id,product_name,amount_paid,status,provider_ref,created_at) "
        + "VALUES ($1,$2,'Consulting Services Package',5000,'succeeded','bp-included-only','2026-10-29') RETURNING id",
        [org, includedClient])).rows[0].id;
      await db.query("INSERT INTO entitlements (org_id,client_id,entitlement_code,source_transaction_id,grant_reason) "
        + "VALUES ($1,$2,'credit-optimization-roadmap',$3,'purchase:consulting-package')",
      [org, includedClient, includedPayment]);
      const includedSub = (await db.query("INSERT INTO subscriptions "
        + "(org_id,client_id,tier,status,effective_from,current_period_start,current_period_end,notes) "
        + "VALUES ($1,$2,'finance-os','active','2026-10-29','2026-10-29','2027-10-29',$3) RETURNING id",
      [org, includedClient, FINANCE_OS_BLUEPRINT_NOTE])).rows[0].id;
      assert.equal((await financeOsEntitlement(db, { orgId: org, clientId: includedClient,
        asOf: new Date("2026-10-30") })).entitled, true);
      const includedRefund = await onPaymentRefundedMoney({ name: "payment.refunded", orgId: org,
        payload: { providerRef: "bp-included-only", amount: 5000 } }, refundDb);
      assert.equal(includedRefund.blueprintIncludedEnded, true);
      assert.equal((await financeOsEntitlement(db, { orgId: org, clientId: includedClient,
        asOf: new Date("2026-11-30") })).entitled, false);
      const closed = (await db.query("SELECT status, effective_to FROM subscriptions WHERE id=$1", [includedSub])).rows[0];
      assert.equal(closed.status, "cancelled");
      assert.ok(closed.effective_to);

      const splitClient = randomUUID();
      const splitPayment = (await db.query(
        "INSERT INTO transactions (org_id,client_id,product_name,amount_paid,status,provider_ref,created_at) "
        + "VALUES ($1,$2,'Consulting Services Package',5000,'succeeded','bp-split-payment','2026-10-29') RETURNING id",
        [org, splitClient])).rows[0].id;
      const splitSale = (await db.query(
        "INSERT INTO sales (org_id,client_id,product_id,agreed_price) VALUES ($1,$2,$3,5000) RETURNING id",
        [org, splitClient, product])).rows[0].id;
      await db.query("INSERT INTO sale_payments (org_id,sale_id,transaction_id,product_id,kind,amount,paid_at) "
        + "VALUES ($1,$2,$3,$4,'deposit',5000,'2026-10-29')",
      [org, splitSale, splitPayment, product]);
      const splitGrant = (await db.query("INSERT INTO entitlements "
        + "(org_id,client_id,entitlement_code,source_transaction_id,grant_reason) "
        + "VALUES ($1,$2,'credit-optimization-roadmap',$3,'purchase:consulting-package') RETURNING id",
      [org, splitClient, splitPayment])).rows[0].id;
      const splitSub = (await db.query("INSERT INTO subscriptions "
        + "(org_id,client_id,tier,status,effective_from,current_period_start,current_period_end,notes) "
        + "VALUES ($1,$2,'finance-os','active','2026-10-29','2026-10-29','2027-10-29',$3) RETURNING id",
      [org, splitClient, FINANCE_OS_BLUEPRINT_NOTE])).rows[0].id;
      const splitRefund = async (refundRef, amount) => {
        const payload = { originalProviderRef: "bp-split-payment", providerRef: refundRef, amount };
        const eventId = (await db.query("INSERT INTO events "
          + "(org_id,name,version,client_id,idempotency_key,payload) "
          + "VALUES ($1,'payment.refunded',1,$2,$3,$4) RETURNING id",
        [org, splitClient, refundRef, payload])).rows[0].id;
        return onPaymentRefundedMoney({ id: eventId, name: "payment.refunded", orgId: org,
          payload }, refundDb);
      };
      assert.equal((await splitRefund("rf_split_a", 2000)).blueprintIncludedEnded, false);
      assert.equal((await db.query("SELECT revoked_at FROM entitlements WHERE id=$1",
        [splitGrant])).rows[0].revoked_at, null);
      assert.equal((await splitRefund("rf_split_b", 3000)).blueprintIncludedEnded, true,
        "two distinct settled partial refunds totaling the purchase end included access");
      assert.equal((await db.query("SELECT revoked_at FROM entitlements WHERE id=$1",
        [splitGrant])).rows[0].revoked_at != null, true);
      assert.equal((await db.query("SELECT status FROM subscriptions WHERE id=$1",
        [splitSub])).rows[0].status, "cancelled");

      const renewedClient = randomUUID();
      const oldPayment = (await db.query("INSERT INTO transactions "
        + "(org_id,client_id,product_name,amount_paid,status,provider_ref,created_at) "
        + "VALUES ($1,$2,'Consulting Services Package',5000,'succeeded','bp-old-payment','2025-01-01') RETURNING id",
      [org, renewedClient])).rows[0].id;
      const newPayment = (await db.query("INSERT INTO transactions "
        + "(org_id,client_id,product_name,amount_paid,status,provider_ref,created_at) "
        + "VALUES ($1,$2,'Consulting Services Package',5000,'succeeded','bp-new-payment','2026-01-01') RETURNING id",
      [org, renewedClient])).rows[0].id;
      const oldSale = (await db.query("INSERT INTO sales "
        + "(org_id,client_id,product_id,agreed_price) VALUES ($1,$2,$3,5000) RETURNING id",
      [org, renewedClient, product])).rows[0].id;
      await db.query("INSERT INTO sale_payments "
        + "(org_id,sale_id,transaction_id,product_id,kind,amount,paid_at) "
        + "VALUES ($1,$2,$3,$4,'deposit',5000,'2025-01-01')",
      [org, oldSale, oldPayment, product]);
      for (const transactionId of [oldPayment, newPayment]) {
        await db.query("INSERT INTO entitlements "
          + "(org_id,client_id,entitlement_code,source_transaction_id,grant_reason) "
          + "VALUES ($1,$2,'credit-optimization-roadmap',$3,'purchase:consulting-package')",
        [org, renewedClient, transactionId]);
      }
      const newSub = (await db.query("INSERT INTO subscriptions "
        + "(org_id,client_id,tier,status,effective_from,current_period_start,current_period_end,notes) "
        + "VALUES ($1,$2,'finance-os','active','2026-01-01','2026-01-01','2027-01-01',$3) RETURNING id",
      [org, renewedClient, FINANCE_OS_BLUEPRINT_NOTE])).rows[0].id;
      await onPaymentRefundedMoney({ name: "payment.refunded", orgId: org,
        payload: { providerRef: "bp-old-payment", amount: 5000 } }, refundDb);
      assert.equal((await db.query("SELECT status FROM subscriptions WHERE id=$1",
        [newSub])).rows[0].status, "active",
      "refunding an old purchase cannot close the newer paid year");

      const overlapClient = randomUUID();
      const overlapOld = (await db.query("INSERT INTO transactions "
        + "(org_id,client_id,product_name,amount_paid,status,provider_ref,created_at) "
        + "VALUES ($1,$2,'Consulting Services Package',5000,'succeeded','bp-overlap-old','2026-01-01') RETURNING id",
      [org, overlapClient])).rows[0].id;
      const overlapNew = (await db.query("INSERT INTO transactions "
        + "(org_id,client_id,product_name,amount_paid,status,provider_ref,created_at) "
        + "VALUES ($1,$2,'Consulting Services Package',5000,'succeeded','bp-overlap-new','2026-07-01') RETURNING id",
      [org, overlapClient])).rows[0].id;
      const overlapSale = (await db.query("INSERT INTO sales "
        + "(org_id,client_id,product_id,agreed_price) VALUES ($1,$2,$3,5000) RETURNING id",
      [org, overlapClient, product])).rows[0].id;
      await db.query("INSERT INTO sale_payments "
        + "(org_id,sale_id,transaction_id,product_id,kind,amount,paid_at) "
        + "VALUES ($1,$2,$3,$4,'deposit',5000,'2026-01-01')",
      [org, overlapSale, overlapOld, product]);
      for (const transactionId of [overlapOld, overlapNew]) {
        await db.query("INSERT INTO entitlements "
          + "(org_id,client_id,entitlement_code,source_transaction_id,grant_reason) "
          + "VALUES ($1,$2,'credit-optimization-roadmap',$3,'purchase:consulting-package')",
        [org, overlapClient, transactionId]);
      }
      const overlapSub = (await db.query("INSERT INTO subscriptions "
        + "(org_id,client_id,tier,status,effective_from,current_period_start,current_period_end,notes) "
        + "VALUES ($1,$2,'finance-os','active','2026-01-01','2026-01-01','2027-01-01',$3) RETURNING id",
      [org, overlapClient, FINANCE_OS_BLUEPRINT_NOTE])).rows[0].id;
      await onPaymentRefundedMoney({ name: "payment.refunded", orgId: org,
        payload: { providerRef: "bp-overlap-old", amount: 5000 } }, refundDb);
      assert.equal((await db.query("SELECT status FROM subscriptions WHERE id=$1",
        [overlapSub])).rows[0].status, "cancelled",
      "the refunded purchase's own included row closes even when a newer grant keeps access");
      assert.equal((await financeOsEntitlement(db, { orgId: org, clientId: overlapClient,
        asOf: new Date("2026-11-30") })).entitled, true);

      const noPeriodClient = randomUUID();
      const noPeriodPayment = (await db.query("INSERT INTO transactions "
        + "(org_id,client_id,product_name,amount_paid,status,provider_ref,created_at) "
        + "VALUES ($1,$2,'Consulting Services Package',5000,'succeeded','bp-null-period','2026-10-29') RETURNING id",
      [org, noPeriodClient])).rows[0].id;
      const noPeriodGrant = (await db.query("INSERT INTO entitlements "
        + "(org_id,client_id,entitlement_code,source_transaction_id,grant_reason) "
        + "VALUES ($1,$2,'credit-optimization-roadmap',$3,'purchase:consulting-package') RETURNING id",
      [org, noPeriodClient, noPeriodPayment])).rows[0].id;
      await db.query("INSERT INTO subscriptions "
        + "(org_id,client_id,tier,status,effective_from,current_period_start,current_period_end) "
        + "VALUES ($1,$2,'finance-os','active','2026-10-01',NULL,NULL)",
      [org, noPeriodClient]);
      const noPeriodDue = await dueClients(db, new Date("2026-11-30T00:00:00Z"));
      assert.equal(noPeriodDue.find(row => row.client_id === noPeriodClient)?.subscription_id,
        noPeriodGrant, "a null-period row cannot hide a paid Blueprint monthly refresh");
      assert.equal((await financeOsEntitlement(db, { orgId: org, clientId: noPeriodClient,
        asOf: new Date("2026-11-30T00:00:00Z") })).subscriptionId, noPeriodGrant,
      "a null-period row is not a separately paid FinanceOS plan");
      assert.equal((await financeOsEntitlement(db, { orgId: org, clientId: noPeriodClient,
        asOf: new Date("2027-10-29T00:00:00Z") })).entitled, false,
      "a null-period row cannot extend the paid Blueprint year");
      const noPeriodRefund = await onPaymentRefundedMoney({ name: "payment.refunded", orgId: org,
        payload: { providerRef: "bp-null-period", amount: 5000 } }, refundDb);
      assert.equal(noPeriodRefund.blueprintIncludedEnded, true);
      assert.equal((await financeOsEntitlement(db, { orgId: org, clientId: noPeriodClient,
        asOf: new Date("2026-11-30T00:00:00Z") })).entitled, false,
      "a null-period row cannot preserve premium reads after a full refund");

      const billedClient = randomUUID();
      const billedSub = (await db.query("INSERT INTO subscriptions "
        + "(org_id,client_id,tier,status,effective_from,current_period_start,current_period_end) "
        + "VALUES ($1,$2,'finance-os','active','2026-11-01','2026-11-01','2026-12-01') RETURNING id",
      [org, billedClient])).rows[0].id;
      assert.equal((await financeOsEntitlement(db, { orgId: org, clientId: billedClient,
        asOf: new Date("2026-11-30T00:00:00Z") })).subscriptionId, billedSub,
      "a separately billed FinanceOS plan works within its saved paid period");
      assert.equal((await financeOsEntitlement(db, { orgId: org, clientId: billedClient,
        asOf: new Date("2026-12-01T00:00:00Z") })).entitled, false);
    } finally {
      await db.query("ROLLBACK");
      db.release();
    }
});


test("Blueprint genuine refresh ignores all known completed rehearsal formats; unresolved work never redials",
  { skip: safe ? false : "requires a local test/scratch PostgreSQL database" }, async () => {
    const conn = await pool.connect();
    await conn.query("BEGIN");
    try {
      for (const table of ["subscriptions", "soft_pull_requests", "crs_results",
        "entitlements", "transactions", "products", "product_aliases"]) {
        await conn.query("CREATE TEMP TABLE " + table + " (LIKE public." + table
          + " INCLUDING ALL) ON COMMIT DROP");
      }
      await conn.query("SET LOCAL search_path TO pg_temp, public");
      const org = randomUUID(), client = randomUUID(), foreignOrg = randomUUID();
      const subscriptionId = (await conn.query(
        "INSERT INTO subscriptions (org_id,client_id,tier,status,effective_from,current_period_start,current_period_end) "
          + "VALUES ($1,$2,'finance-os','active','2026-10-01','2026-10-01','2026-12-31') RETURNING id",
        [org, client])).rows[0].id;
      const at = new Date("2026-10-12T00:00:00Z");
      const due = async (realPull) => (await dueClients(conn, at, { realPull }))
        .map((row) => row.subscription_id);
      const clear = async () => {
        await conn.query("DELETE FROM soft_pull_requests");
        await conn.query("DELETE FROM crs_results");
      };
      const completed = async ({ provider = "crs_softview", result, resultOrg = org }) => {
        const credit = (await conn.query(
          "INSERT INTO crs_results (org_id,client_id,provider,provider_result_id,result) VALUES ($1,$2,$3,$4,$5::jsonb) RETURNING id",
          [resultOrg, client, provider, randomUUID(), JSON.stringify(result)])).rows[0].id;
        await conn.query(
          "INSERT INTO soft_pull_requests (org_id,client_id,subscription_id,requested_by_kind,reason,status,requested_at,resolved_at,crs_result_id) "
            + "VALUES ($1,$2,$3,'system','Included refresh synthetic fixture','fulfilled','2026-10-10','2026-10-10',$4)",
          [org, client, subscriptionId, credit]);
      };
      assert.deepEqual(await due(true), [subscriptionId], "paid subscriber initially due");
      for (const sample of [
        { provider: "crs_softview_simulated", result: {} },
        { result: { simulated: true, environment: "production" } },
        { result: { simulated: "1", environment: "production" } },
        { result: { simulated: false, environment: "sandbox" } },
        { result: { simulated: false, environment: "simulated" } }
      ]) {
        await clear();
        await completed(sample);
        assert.deepEqual(await due(false), [], "rehearsal must not loop in simulated mode");
        assert.deepEqual(await due(true), [subscriptionId],
          "completed rehearsal cannot spend a real refresh: " + JSON.stringify(sample));
      }
      await clear();
      await completed({ result: { simulated: false, environment: "production" } });
      assert.deepEqual(await due(true), [], "real credit result blocks a second automatic pull");
      await clear();
      await completed({ result: { simulated: true }, resultOrg: foreignOrg });
      assert.deepEqual(await due(true), [], "foreign-org report cannot release a local request");
      for (const state of ["queued", "failed"]) {
        await clear();
        await conn.query(
          "INSERT INTO soft_pull_requests (org_id,client_id,subscription_id,requested_by_kind,reason,status,requested_at,resolved_at) "
            + "VALUES ($1,$2,$3,'system','Included refresh unresolved fixture',$4,'2026-10-10',$5)",
          [org, client, subscriptionId, state, state === "failed" ? "2026-10-10" : null]);
        assert.deepEqual(await due(true), [], state + " requires recovery, never automatic re-pull");
      }
    } finally {
      await conn.query("ROLLBACK");
      conn.release();
    }
  });


test("BP-20: included FinanceOS Feb 29 anniversary equals real PostgreSQL 12 calendar months",
  { skip: safe ? false : "requires a local test/scratch PostgreSQL database" }, async () => {
    const conn = await pool.connect();
    await conn.query("BEGIN READ ONLY");
    try {
      const paidAt = new Date("2024-02-29T17:45:30.123Z");
      const { rows } = await conn.query(
        "SELECT ($1::timestamptz + INTERVAL '12 months') AS ends_at",
        [paidAt.toISOString()]
      );
      assert.equal(addUtcMonths(paidAt, 12).toISOString(),
        new Date(rows[0].ends_at).toISOString(),
        "the saved subscription end must not run past the SQL service-year end");
    } finally {
      await conn.query("ROLLBACK");
      conn.release();
    }
  });
