// Postgres integration for money-chain writers.
// SKIPS unless DATABASE_URL is set.
//
// Proves: each writer fires once per event, replay does not duplicate, and the
// read APIs (commissions / entitlements / funding-rounds) return the written rows.

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { db, close, pool } from "../db.mjs";
import { randomUUID } from "node:crypto";
import { emit, replay, _resetOrgCache } from "../events/bus.mjs";
import { clearHandlers } from "../events/registry.mjs";
import { register as registerLifecycle, onPaymentReceived, onPaymentFailed } from "./client-lifecycle.mjs";
import { register as registerMoneyChain, onPaymentReceivedMoney, onDepositPaidMoney, ensureSale, ensureSalePayment } from "./money-chain.mjs";
import { createSession } from "../auth/session.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const MARK = "moneychain_pg";
const EMAIL = `${MARK}@example.com`;

describe("money-chain writers", { skip: !HAS_DB ? "no DATABASE_URL" : false }, () => {
  let org, closerId, advisorId, handler, ownerToken;
  let fundingProductId, diagProductId, diyProductId;
  let frontRuleId, backRuleId;

  async function wipe() {
    const clients = (await db.query(
      `SELECT id FROM clients WHERE email LIKE $1 OR first_name = $2`,
      [`${MARK}%`, MARK]
    )).rows.map((r) => r.id);
    if (clients.length) {
      await db.query(`ALTER TABLE commission_ledger DISABLE TRIGGER trg_commission_ledger_no_delete`);
      try {
        await db.query(`DELETE FROM commission_ledger WHERE client_id = ANY($1)`, [clients]);
      } finally {
        await db.query(`ALTER TABLE commission_ledger ENABLE TRIGGER trg_commission_ledger_no_delete`);
      }
      await db.query(`ALTER TABLE entitlements DISABLE TRIGGER trg_entitlements_no_delete`);
      try {
        await db.query(`DELETE FROM entitlements WHERE client_id = ANY($1)`, [clients]);
      } finally {
        await db.query(`ALTER TABLE entitlements ENABLE TRIGGER trg_entitlements_no_delete`);
      }
      await db.query(`DELETE FROM sale_payments WHERE sale_id IN (SELECT id FROM sales WHERE client_id = ANY($1))`, [clients]);
      await db.query(`DELETE FROM sale_attributions WHERE sale_id IN (SELECT id FROM sales WHERE client_id = ANY($1))`, [clients]);
      await db.query(`DELETE FROM funding_round_sales WHERE sale_id IN (SELECT id FROM sales WHERE client_id = ANY($1))`, [clients]);
      await db.query(`DELETE FROM funding_rounds WHERE client_id = ANY($1)`, [clients]);
      await db.query(`DELETE FROM sales WHERE client_id = ANY($1)`, [clients]);
      await db.query(`DELETE FROM transactions WHERE client_id = ANY($1)`, [clients]);
      await db.query(`DELETE FROM events WHERE client_id = ANY($1) OR payload->>'email' LIKE $2`, [clients, `${MARK}%`]);
      // tasks.client_id has no cascade, and the money chain now opens tasks on
      // the client (CI failed here with tasks_client_id_fkey, 2026-10-05).
      await db.query(`DELETE FROM tasks WHERE client_id = ANY($1)`, [clients]);
      await db.query(`DELETE FROM clients WHERE id = ANY($1)`, [clients]);
    }
    if (frontRuleId) {
      await db.query(`DELETE FROM commission_rules WHERE id = ANY($1)`, [[frontRuleId, backRuleId].filter(Boolean)]);
    }
    /* The product→entitlement mapping is NOT wiped any more. It used to be a
       test fixture this file inserted and deleted; since
       180_product_entitlements_seed.sql it is shipped configuration, and
       deleting it here would strip real config out of whatever database
       DATABASE_URL points at. */
    await db.query(`DELETE FROM staff WHERE email LIKE $1`, [`${MARK}%`]);
  }

  before(async () => {
    _resetOrgCache();
    clearHandlers();
    registerLifecycle();
    registerMoneyChain();

    org = await resolveDefaultOrg(db);
    await wipe();

    closerId = (await db.query(
      `INSERT INTO staff (org_id, email, name, role, status)
       VALUES ($1,$2,'Money Chain Closer','closer','active') RETURNING id`,
      [org, `${MARK}.closer@example.com`]
    )).rows[0].id;
    advisorId = (await db.query(
      `INSERT INTO staff (org_id, email, name, role, status)
       VALUES ($1,$2,'Money Chain Advisor','funding_advisor','active') RETURNING id`,
      [org, `${MARK}.advisor@example.com`]
    )).rows[0].id;

    fundingProductId = (await db.query(
      `SELECT id FROM products WHERE org_id = $1 AND code = 'card-stacking-dfy'`, [org]
    )).rows[0].id;
    diagProductId = (await db.query(
      `SELECT id FROM products WHERE org_id = $1 AND code = 'diagnostic'`, [org]
    )).rows[0].id;
    diyProductId = (await db.query(
      `SELECT id FROM products WHERE org_id = $1 AND code = 'consulting-package'`, [org]
    )).rows[0].id;

    frontRuleId = (await db.query(
      `INSERT INTO commission_rules (
         org_id, name, basis, stacking, role, staff_id, product_id,
         calc_method, flat_amount, amount_basis, effective_from, active
       ) VALUES (
         $1, 'MC closer flat deposit', 'front_end', 'base', 'closer', $3, $2,
         'flat', 500.00, 'deposit_collected', '2020-01-01', true
       ) RETURNING id`,
      [org, fundingProductId, closerId]
    )).rows[0].id;

    backRuleId = (await db.query(
      `INSERT INTO commission_rules (
         org_id, name, basis, stacking, role, product_id,
         calc_method, percent, amount_basis, effective_from, active
       ) VALUES (
         $1, 'MC advisor 0.25% funded', 'back_end', 'base', 'funding_advisor', $2,
         'percent', 0.25, 'amount_funded', '2020-01-01', true
       ) RETURNING id`,
      [org, fundingProductId]
    )).rows[0].id;

    /* WAS: this file inserted its own three-pair mapping, so the grant tests
       below passed against a fixture while production granted nothing. The
       mapping is shipped configuration now
       (180_product_entitlements_seed.sql); read it instead of writing it, and
       fail loudly rather than silently re-creating it. */
    const mapping = (await db.query(
      `SELECT product_code, entitlement_code FROM product_entitlements WHERE org_id = $1`,
      [org]
    )).rows.map((r) => `${r.product_code}→${r.entitlement_code}`);
    for (const pair of [
      "diagnostic→credit-analysis-report",
      "consulting-package→metro2-letter-pack",
      "card-stacking-dfy→funding-snapshot"
    ]) {
      if (!mapping.includes(pair)) {
        throw new Error(
          `product_entitlements is missing ${pair}. ` +
          `Apply db/migrations/180_product_entitlements_seed.sql before running these tests.`
        );
      }
    }

    const owner = (await db.query(
      `SELECT id, org_id FROM staff WHERE org_id = $1 AND role = 'owner' LIMIT 1`, [org]
    )).rows[0];
    ownerToken = (await createSession(db, { staffId: owner.id, orgId: owner.org_id })).token;
    ({ default: handler } = await import("../../netlify/functions/api.mjs"));
  });

  after(async () => {
    await wipe();
    await close();
  });

  const call = async (path) =>
    handler(new Request("https://x" + path, {
      headers: { authorization: "Bearer " + ownerToken, host: "x" }
    }), {});
  const json = async (r) => JSON.parse(await r.text());

  test("deposit.paid writes sale + payment + front-end ledger; replay does not duplicate", async () => {
    const payload = {
      email: EMAIL,
      name: "Money Chain Client",
      product: "deposit",
      productName: "Consulting Services Deposit",
      amount: 3000,
      providerRef: `${MARK}_dep_1`,
      closerId,
      source: "commas"
    };

    await emit(db, "payment.received", payload, {
      orgId: org, idempotencyKey: `${MARK}:pay1`
    });
    await emit(db, "deposit.paid", payload, {
      orgId: org, idempotencyKey: `${MARK}:dep1`
    });

    const client = (await db.query(`SELECT id FROM clients WHERE email = $1`, [EMAIL])).rows[0];
    assert.ok(client, "client created");

    const sales = (await db.query(
      `SELECT * FROM sales WHERE client_id = $1 AND product_id = $2`,
      [client.id, fundingProductId]
    )).rows;
    assert.equal(sales.length, 1, "exactly one sale");
    assert.equal(Number(sales[0].agreed_price), 3000);

    const pays = (await db.query(
      `SELECT * FROM sale_payments WHERE sale_id = $1`, [sales[0].id]
    )).rows;
    assert.ok(pays.length >= 1, "deposit.paid must write sale_payments when a sale exists");
    assert.ok(pays.some((p) => p.kind === "deposit" && Number(p.amount) === 3000));
    assert.ok(
      pays.every((p) => String(p.product_id) === String(sales[0].product_id)),
      "sale_payments.product_id must copy the sale row"
    );

    const attrs = (await db.query(
      `SELECT * FROM sale_attributions WHERE sale_id = $1 AND basis = 'front_end'`,
      [sales[0].id]
    )).rows;
    assert.equal(attrs.length, 1);
    assert.equal(attrs[0].staff_id, closerId);

    const ledger = (await db.query(
      `SELECT * FROM commission_ledger WHERE sale_id = $1 AND basis = 'front_end'`,
      [sales[0].id]
    )).rows;
    assert.equal(ledger.length, 1, "one front-end ledger row");
    assert.equal(Number(ledger[0].amount), 500);
    assert.equal(ledger[0].staff_id, closerId);

    const ents = (await db.query(
      `SELECT entitlement_code FROM entitlements WHERE client_id = $1 AND revoked_at IS NULL`,
      [client.id]
    )).rows;
    assert.ok(ents.some((e) => e.entitlement_code === "funding-snapshot"));

    await replay(db, {});
    assert.equal(
      (await db.query(`SELECT count(*)::int n FROM sales WHERE client_id = $1`, [client.id])).rows[0].n,
      1
    );
    assert.equal(
      (await db.query(`SELECT count(*)::int n FROM commission_ledger WHERE sale_id = $1`, [sales[0].id])).rows[0].n,
      1
    );
    assert.equal(
      (await db.query(`SELECT count(*)::int n FROM sale_payments WHERE sale_id = $1`, [sales[0].id])).rows[0].n,
      pays.length
    );

    const commRes = await call(`/api/read/commissions?client_id=${client.id}`);
    assert.equal(commRes.status, 200);
    const commBody = await json(commRes);
    const items = commBody.items || [];
    assert.ok(items.some((i) => Number(i.amount) === 500 && i.basis === "front_end"),
      "GET /api/read/commissions returns the written ledger row");

    const entRes = await call(`/api/read/entitlements?client_id=${client.id}`);
    assert.equal(entRes.status, 200);
    const entBody = await json(entRes);
    const entItems = entBody.items || [];
    assert.ok(
      entItems.some((i) => i.entitlement_code === "funding-snapshot"),
      "GET /api/read/entitlements returns the grant"
    );
  });

  test("diagnostic.paid and sale.closed each write exactly one sale; replay safe", async () => {
    const diagEmail = `${MARK}.diag@example.com`;
    const diyEmail = `${MARK}.diy@example.com`;

    await emit(db, "payment.received", {
      email: diagEmail, product: "crs", productName: "Business Financial Assessment",
      amount: 32, providerRef: `${MARK}_diag_1`, source: "commas"
    }, { orgId: org, idempotencyKey: `${MARK}:diag-pay` });
    await emit(db, "diagnostic.paid", {
      email: diagEmail, product: "crs", productName: "Business Financial Assessment",
      amount: 32, providerRef: `${MARK}_diag_1`, source: "commas"
    }, { orgId: org, idempotencyKey: `${MARK}:diag` });

    await emit(db, "payment.received", {
      email: diyEmail, product: "diy", productName: "Consulting Services Package",
      amount: 1000, providerRef: `${MARK}_diy_1`, source: "commas"
    }, { orgId: org, idempotencyKey: `${MARK}:diy-pay` });
    await emit(db, "sale.closed", {
      email: diyEmail, product: "diy", productName: "Consulting Services Package",
      amount: 1000, providerRef: `${MARK}_diy_1`, closerId, source: "commas"
    }, { orgId: org, idempotencyKey: `${MARK}:diy` });

    const diagClient = (await db.query(`SELECT id FROM clients WHERE email = $1`, [diagEmail])).rows[0].id;
    const diyClient = (await db.query(`SELECT id FROM clients WHERE email = $1`, [diyEmail])).rows[0].id;

    assert.equal(
      (await db.query(`SELECT count(*)::int n FROM sales WHERE client_id = $1 AND product_id = $2`,
        [diagClient, diagProductId])).rows[0].n, 1);
    assert.equal(
      (await db.query(`SELECT count(*)::int n FROM sales WHERE client_id = $1 AND product_id = $2`,
        [diyClient, diyProductId])).rows[0].n, 1);

    await replay(db, {});
    assert.equal(
      (await db.query(`SELECT count(*)::int n FROM sales WHERE client_id = $1`, [diagClient])).rows[0].n, 1);
    assert.equal(
      (await db.query(`SELECT count(*)::int n FROM sales WHERE client_id = $1`, [diyClient])).rows[0].n, 1);

    const diagEnt = (await db.query(
      `SELECT entitlement_code FROM entitlements WHERE client_id = $1`, [diagClient]
    )).rows;
    assert.ok(diagEnt.some((e) => e.entitlement_code === "credit-analysis-report"));

    const diyEnt = (await db.query(
      `SELECT entitlement_code FROM entitlements WHERE client_id = $1`, [diyClient]
    )).rows;
    assert.ok(diyEnt.some((e) => e.entitlement_code === "metro2-letter-pack"));
  });

  test("round.started freezes funding_round_sales; round.funded writes back-end ledger once", async () => {
    const email = `${MARK}.fund@example.com`;
    await emit(db, "payment.received", {
      email, product: "deposit", productName: "Consulting Services Deposit",
      amount: 3000, providerRef: `${MARK}_fund_dep`, closerId, source: "commas"
    }, { orgId: org, idempotencyKey: `${MARK}:fund-pay` });
    await emit(db, "deposit.paid", {
      email, product: "deposit", productName: "Consulting Services Deposit",
      amount: 3000, providerRef: `${MARK}_fund_dep`, closerId, advisorId, source: "commas"
    }, { orgId: org, idempotencyKey: `${MARK}:fund-dep` });

    const client = (await db.query(`SELECT id FROM clients WHERE email = $1`, [email])).rows[0];
    const sale = (await db.query(
      `SELECT id FROM sales WHERE client_id = $1 AND product_id = $2 ORDER BY sold_at DESC LIMIT 1`,
      [client.id, fundingProductId]
    )).rows[0];
    assert.ok(sale);

    await emit(db, "round.started", {
      email, roundNumber: 1, saleId: sale.id, advisorId
    }, { orgId: org, clientId: client.id, idempotencyKey: `${MARK}:rnd-start` });

    const rounds = (await db.query(
      `SELECT * FROM funding_rounds WHERE client_id = $1`, [client.id]
    )).rows;
    assert.equal(rounds.length, 1, "one funding round");
    assert.equal(rounds[0].round_number, 1);

    const links = (await db.query(
      `SELECT * FROM funding_round_sales WHERE funding_round_id = $1`, [rounds[0].id]
    )).rows;
    assert.equal(links.length, 1, "round→sale link frozen");
    assert.equal(links[0].sale_id, sale.id);

    await emit(db, "round.funded", {
      email, roundNumber: 1, fundingRoundId: rounds[0].id,
      fundedAmount: 50000, approvedAmount: 50000, advisorId
    }, { orgId: org, clientId: client.id, idempotencyKey: `${MARK}:rnd-fund` });

    const funded = (await db.query(
      `SELECT * FROM funding_rounds WHERE id = $1`, [rounds[0].id]
    )).rows[0];
    assert.equal(funded.status, "funded");
    assert.equal(Number(funded.funded_amount), 50000);

    const back = (await db.query(
      `SELECT * FROM commission_ledger
        WHERE funding_round_id = $1 AND basis = 'back_end'`,
      [rounds[0].id]
    )).rows;
    assert.equal(back.length, 1, "only the advisor earns on the funded amount");
    assert.equal(Number(back.find((row) => row.staff_id === advisorId)?.amount), 125);
    assert.equal(back.some((row) => row.staff_id === closerId), false);

    await replay(db, {});
    assert.equal(
      (await db.query(`SELECT count(*)::int n FROM funding_rounds WHERE client_id = $1`, [client.id])).rows[0].n,
      1
    );
    assert.equal(
      (await db.query(
        `SELECT count(*)::int n FROM commission_ledger WHERE funding_round_id = $1 AND basis = 'back_end'`,
        [rounds[0].id]
      )).rows[0].n,
      1
    );

    const frRes = await call(`/api/read/funding-rounds?client_id=${client.id}`);
    assert.equal(frRes.status, 200);
    const frBody = await json(frRes);
    const frItems = frBody.items || [];
    assert.ok(
      frItems.some((r) => r.id === rounds[0].id && Number(r.funded_amount) === 50000),
      "GET /api/read/funding-rounds returns the written round"
    );

    const commRes = await call(`/api/read/commissions?client_id=${client.id}`);
    const commBody = await json(commRes);
    const items = commBody.items || [];
    assert.ok(items.some((i) => i.basis === "back_end" && Number(i.amount) === 125));
  });

  test("deposit.paid writes sale_payments for an existing sale (BLK-008)", async () => {
    const email = `${MARK}.blk008@example.com`;
    await emit(db, "deposit.paid", {
      email, product: "deposit", productName: "Consulting Services Deposit",
      amount: 3000, providerRef: `${MARK}_blk008_a`, closerId, source: "commas"
    }, { orgId: org, idempotencyKey: `${MARK}:blk008-a` });

    const client = (await db.query(`SELECT id FROM clients WHERE email = $1`, [email])).rows[0];
    assert.ok(client, "client created");
    const sale = (await db.query(
      `SELECT * FROM sales WHERE client_id = $1 ORDER BY sold_at DESC LIMIT 1`, [client.id]
    )).rows[0];
    assert.ok(sale, "sale exists");

    const firstPays = (await db.query(
      `SELECT * FROM sale_payments WHERE sale_id = $1`, [sale.id]
    )).rows;
    assert.equal(firstPays.length, 1, "deposit.paid writes sale_payments when it creates the sale");
    assert.equal(String(firstPays[0].product_id), String(sale.product_id));

    await emit(db, "deposit.paid", {
      email, product: "deposit", productName: "Consulting Services Deposit",
      amount: 500, providerRef: `${MARK}_blk008_b`, closerId, source: "commas"
    }, { orgId: org, clientId: client.id, idempotencyKey: `${MARK}:blk008-b` });

    const pays = (await db.query(
      `SELECT * FROM sale_payments WHERE sale_id = $1 ORDER BY paid_at`, [sale.id]
    )).rows;
    assert.equal(pays.length, 2, "deposit.paid writes sale_payments when a sale already exists");
    assert.ok(pays.every((p) => String(p.product_id) === String(sale.product_id)));
    assert.ok(pays.some((p) => p.kind === "deposit" && Number(p.amount) === 500));
  });

  test("payment.received against an existing sale writes sale_payments once on replay", async () => {
    const email = `${MARK}.install@example.com`;
    await emit(db, "deposit.paid", {
      email, product: "deposit", productName: "Consulting Services Deposit",
      amount: 1500, providerRef: `${MARK}_inst_dep`, closerId, source: "commas"
    }, { orgId: org, idempotencyKey: `${MARK}:inst-dep` });

    const client = (await db.query(`SELECT id FROM clients WHERE email = $1`, [email])).rows[0];
    const sale = (await db.query(
      `SELECT id FROM sales WHERE client_id = $1 ORDER BY sold_at DESC LIMIT 1`, [client.id]
    )).rows[0];

    await emit(db, "payment.received", {
      email, product: "deposit", productName: "Consulting Services Deposit",
      amount: 500, providerRef: `${MARK}_inst_2`, source: "commas"
    }, { orgId: org, clientId: client.id, idempotencyKey: `${MARK}:inst-pay2` });

    const pays = (await db.query(
      `SELECT * FROM sale_payments WHERE sale_id = $1 ORDER BY paid_at`, [sale.id]
    )).rows;
    assert.ok(pays.length >= 2, `expected >=2 payments, got ${pays.length}`);

    const nBefore = pays.length;
    await emit(db, "payment.received", {
      email, product: "deposit", productName: "Consulting Services Deposit",
      amount: 500, providerRef: `${MARK}_inst_2`, source: "commas"
    }, { orgId: org, clientId: client.id, idempotencyKey: `${MARK}:inst-pay2` });
    assert.equal(
      (await db.query(`SELECT count(*)::int n FROM sale_payments WHERE sale_id = $1`, [sale.id])).rows[0].n,
      nBefore
    );

    await replay(db, {});
    assert.equal(
      (await db.query(`SELECT count(*)::int n FROM sale_payments WHERE sale_id = $1`, [sale.id])).rows[0].n,
      nBefore
    );
  });

  /* ── money landed → something opened, and when it does not, why not ──
     These are the tests the live audit of 2026-08-18 wanted: paid sales existed
     and the client held zero entitlements, because product_entitlements was
     empty and the refusal to guess was invisible. */

  test("a paid purchase unlocks the mapped deliverable exactly once, replay included", async () => {
    const email = `${MARK}.grant@example.com`;
    await emit(db, "diagnostic.paid", {
      email, product: "crs", productName: "Business Financial Assessment",
      amount: 32, providerRef: `${MARK}_grant_1`, source: "commas"
    }, { orgId: org, idempotencyKey: `${MARK}:grant-diag` });

    const client = (await db.query(`SELECT id FROM clients WHERE email = $1`, [email])).rows[0];
    assert.ok(client, "the payment created the client");

    const held = async () => (await db.query(
      `SELECT count(*)::int n FROM entitlements
        WHERE client_id = $1 AND entitlement_code = 'credit-analysis-report'
          AND revoked_at IS NULL`,
      [client.id]
    )).rows[0].n;

    assert.equal(await held(), 1, "paying for the diagnostic must unlock the report");

    await replay(db, {});
    assert.equal(await held(), 1, "a replayed webhook must not grant a second time");
  });

  test("a foreign buyer's or failed provider transaction cannot be credited to this sale", async () => {
    const foreignEmail = `${MARK}.foreign_ref@example.com`;
    const buyerEmail = `${MARK}.owned_ref@example.com`;
    const foreign = (await db.query(
      `INSERT INTO clients (org_id, email, first_name, last_name)
       VALUES ($1,$2,$3,'Foreign') RETURNING id`, [org, foreignEmail, MARK]
    )).rows[0];
    const buyer = (await db.query(
      `INSERT INTO clients (org_id, email, first_name, last_name)
       VALUES ($1,$2,$3,'Owned') RETURNING id`, [org, buyerEmail, MARK]
    )).rows[0];
    const { sale } = await ensureSale(db, {
      orgId: org, clientId: buyer.id, name: "checkout.accepted",
      payload: { productId: fundingProductId, amount: 3000 }
    }, { productBucket: "deposit" });
    assert.ok(sale);
    for (const scenario of [
      { owner: foreign.id, status: "succeeded", amount: 3000 },
      { owner: buyer.id, status: "failed", amount: 3000 },
      { owner: buyer.id, status: "succeeded", amount: 2400 }
    ]) {
      const providerRef = `${MARK}_scope_${scenario.status}_${scenario.amount}_${scenario.owner}`;
      await db.query(
        `INSERT INTO transactions (org_id, client_id, product_name, amount_paid,
                                  status, provider, provider_ref, raw_payload)
         VALUES ($1,$2,'Consulting Services Deposit',$3,$4,'commas',$5,'{}'::jsonb)`,
        [org, scenario.owner, scenario.amount, scenario.status, providerRef]
      );
      const result = await ensureSalePayment(db, {
        id: "00000000-0000-4000-8000-000000000e64", orgId: org, clientId: buyer.id,
        name: "payment.received", payload: { amount: 3000, providerRef }
      }, {
        clientId: buyer.id, saleId: sale.id, productId: fundingProductId, kind: "deposit"
      });
      assert.equal(result.payment, null, "conflicted processor reference is not cash");
      assert.equal(result.reason, "transaction_source_conflict");
    }
    const n = (await db.query(
      `SELECT count(*)::int n FROM sale_payments WHERE sale_id = $1`, [sale.id]
    )).rows[0].n;
    assert.equal(n, 0, "none of the foreign/failed/incorrect-amount receipts may credit buyer");
  });

  test("a succeeded orphan provider receipt never credits the buyer's newest funding sale", async () => {
    const buyerEmail = `${MARK}.orphan_fee@example.com`;
    const buyer = (await db.query(
      `INSERT INTO clients (org_id, email, first_name, last_name)
       VALUES ($1,$2,$3,'Orphan') RETURNING id`, [org, buyerEmail, MARK]
    )).rows[0];
    const origin = await ensureSale(db, {
      orgId: org, clientId: buyer.id, name: "checkout.accepted",
      payload: { productId: fundingProductId, amount: 3000 }
    }, { productBucket: "deposit" });
    assert.ok(origin.sale, "this fixture needs an actual existing funding sale");
    const providerRef = `${MARK}_orphan_fee_ref`;
    await db.query(
      `INSERT INTO transactions (org_id, client_id, product_name, amount_paid,
                                status, provider, provider_ref, raw_payload)
       VALUES ($1,$2,'Unmatched provider payment',2500,'succeeded','commas',$3,'{}'::jsonb)`,
      [org, buyer.id, providerRef]
    );
    const result = await onPaymentReceivedMoney({
      id: "00000000-0000-4000-8000-000000000e65", name: "payment.received",
      orgId: org, clientId: buyer.id,
      payload: { product: "unmatched", productName: null, amount: 2500, providerRef }
    }, db);
    assert.equal(result.done, false, "unassigned payment cannot settle a guessed contract");
    assert.equal(result.reason, "no_sale_yet");
    const n = (await db.query(
      `SELECT count(*)::int n FROM sale_payments WHERE sale_id = $1`, [origin.sale.id]
    )).rows[0].n;
    assert.equal(n, 0, "orphan receipt must not inflate installment or success-fee balances");
  });


  test("a recorded buyer payment with a foreign or unknown invoice ID cannot credit even an explicit owned sale", async () => {
    const buyerEmail = `${MARK}.unowned_invoice@example.invalid`;
    const buyer = (await db.query(
      `INSERT INTO clients (org_id, email, first_name, last_name)
       VALUES ($1,$2,$3,'Unowned Invoice') RETURNING id`,
      [org, buyerEmail, MARK]
    )).rows[0];
    const origin = await ensureSale(db, {
      orgId: org, clientId: buyer.id, name: "checkout.accepted",
      payload: { productId: fundingProductId, amount: 3000 }
    }, { productBucket: "deposit" });
    assert.ok(origin.sale);
    const providerRef = `${MARK}_unowned_invoice_ref`;
    await db.query(
      `INSERT INTO transactions (org_id, client_id, product_name, amount_paid,
                                 status, provider, provider_ref, raw_payload)
       VALUES ($1,$2,'Unmatched invoice receipt',2500,'succeeded','commas',$3,'{}'::jsonb)`,
      [org, buyer.id, providerRef]
    );
    const result = await onPaymentReceivedMoney({
      id: "00000000-0000-4000-8000-000000000e69", name: "payment.received",
      orgId: org, clientId: buyer.id,
      payload: {
        invoiceId: "00000000-0000-4000-8000-000000000f69",
        saleId: origin.sale.id, product: "unmatched",
        productName: null, purpose: null, amount: 2500, providerRef
      }
    }, db);
    assert.equal(result.done, false);
    assert.equal(result.reason, "invoice_identity_conflict");
    assert.equal((await db.query(
      `SELECT count(*)::int n FROM sale_payments WHERE sale_id = $1`,
      [origin.sale.id]
    )).rows[0].n, 0, "unknown invoice must never inflate a real sale balance");
  });

  test("a payment we cannot pin to a client refuses and names the reason", async () => {
    const out = await onPaymentReceivedMoney(
      { id: null, name: "payment.received", orgId: org, payload: { amount: 100 } },
      db
    );
    assert.equal(out.done, false);
    assert.equal(out.reason, "no_client");
  });

  test("an unmapped product grants nothing and names WHICH gap it hit", async () => {
    const email = `${MARK}.unmapped@example.com`;
    // ghl_contact_id preset so the lifecycle backfill has nothing to sync.
    const clientId = (await db.query(
      `INSERT INTO clients (org_id, email, first_name, last_name, ghl_contact_id)
       VALUES ($1,$2,$3,'Unmapped',$4) RETURNING id`,
      [org, email, MARK, `dry-${MARK}-unmapped`]
    )).rows[0].id;

    // 'Inquiry Removal' is a real product. 180 deliberately does NOT map it,
    // because no shipped code says what an inquiry removal delivers.
    // An owned checkout sale and an actual stored transaction are both required
    // before this test can assert the separate missing entitlement mapping.
    const origin = await ensureSale(db, {
      orgId: org, clientId, name: "checkout.accepted",
      payload: { productName: "Inquiry Removal", amount: 500, providerRef: `${MARK}_inq_1` }
    }, { productBucket: "unmatched" });
    assert.ok(origin.sale, "an unmapped but real product still has a canonical sale");
    await db.query(
      `INSERT INTO transactions (org_id, client_id, product_name, amount_paid,
                                status, provider, provider_ref, raw_payload)
       VALUES ($1,$2,'Inquiry Removal',500,'succeeded','commas',$3,'{}'::jsonb)`,
      [org, clientId, `${MARK}_inq_1`]
    );
    const unmapped = await onPaymentReceivedMoney({
      id: null, name: "payment.received", orgId: org, clientId,
      payload: { saleId: origin.sale.id, productName: "Inquiry Removal", amount: 500, providerRef: `${MARK}_inq_1` }
    }, db);
    assert.equal(unmapped.done, true, "the stored sale and payment were accepted");
    assert.equal(unmapped.entitlements.unmapped, true);
    assert.equal(unmapped.entitlements.reason, "no_mapping");
    assert.equal(unmapped.entitlements.productCode, "inquiry-removal");

    // A name that matches no product at all is a different gap, and says so.
    const noProduct = await onPaymentReceivedMoney({
      id: null, name: "payment.received", orgId: org, clientId,
      payload: { productName: "Nothing We Sell", amount: 10, providerRef: `${MARK}_np_1` }
    }, db);
    // A product with no original sale is not paid and cannot grant access.
    assert.equal(noProduct.done, false);
    assert.equal(noProduct.reason, "no_sale_yet");
    assert.equal(noProduct.entitlements, undefined);

    assert.equal(
      (await db.query(
        `SELECT count(*)::int n FROM entitlements WHERE client_id = $1`, [clientId]
      )).rows[0].n,
      0,
      "nothing may be granted on a guess"
    );
  });

  test("invoice pair guards and failed capture recovery hold in real Postgres", async () => {
    const conn = await pool().connect();
    try {
      await conn.query("BEGIN");
      const clientId = (await conn.query(
        `INSERT INTO clients (org_id, email, first_name, ghl_contact_id)
         VALUES ($1,$2,$3,'existing-local-link') RETURNING id`,
        [org, `${MARK}.pair-${randomUUID()}@example.invalid`, MARK]
      )).rows[0].id;
      const otherClient = (await conn.query(
        `INSERT INTO clients (org_id, email, first_name, ghl_contact_id)
         VALUES ($1,$2,$3,'existing-local-link') RETURNING id`,
        [org, `${MARK}.pair-other-${randomUUID()}@example.invalid`, MARK]
      )).rows[0].id;
      const providerRef = `pair-${randomUUID()}`;
      const payload = { product: "deposit", productId: fundingProductId,
        productName: "Consulting Services Deposit", amount: 3000,
        providerRef, source: "commas" };
      const event = (name, extra = {}, buyer = clientId) => ({
        id: randomUUID(), name, orgId: org, clientId: buyer, payload: { ...payload, ...extra }
      });
      const readTransaction = async (ref = providerRef) => (await conn.query(
        "SELECT * FROM transactions WHERE org_id=$1 AND provider_ref=$2", [org, ref]
      )).rows[0];

      // The upsert itself must enforce identity, not a mock of its SQL.
      for (const [label, change, buyer] of [
        ["amount", { amount: 2999 }, clientId],
        ["product", { productName: "Another purchase" }, clientId],
        ["provider", { source: "another-provider" }, clientId],
        ["buyer", {}, otherClient],
        ["unknown-buyer", {}, randomUUID()]
      ]) {
        const ref = `${providerRef}-${label}`;
        await onPaymentFailed(event("payment.failed", { providerRef: ref }), conn);
        await onPaymentReceived(event("payment.received", { providerRef: ref, ...change }, buyer), conn);
        const held = await readTransaction(ref);
        assert.equal(held.status, "failed", `${label} cannot replace the original failed attempt`);
        assert.equal(held.client_id, clientId);
        assert.equal(Number(held.amount_paid), 3000);
      }

      const origin = await ensureSale(conn, event("checkout.accepted"), { productBucket: "deposit" });
      assert.ok(origin.sale);
      const invoiceId = (await conn.query(
        `INSERT INTO invoices (org_id, client_id, sale_id, invoice_type, source, status, amount_due)
         VALUES ($1,$2,$3,'deposit','other','sent',3000) RETURNING id`,
        [org, clientId, origin.sale.id]
      )).rows[0].id;
      const linkId = (await conn.query(
        `INSERT INTO payment_links (org_id, client_id, product_id, sale_id, invoice_id,
          purpose, amount_cents, link_ref, checkout_url)
         VALUES ($1,$2,$3,$4,$5,'deposit',300000,$6,'https://example.invalid/checkout') RETURNING id`,
        [org, clientId, fundingProductId, origin.sale.id, invoiceId, randomUUID()]
      )).rows[0].id;
      const bound = { paymentLinkId: linkId, invoiceId, saleId: origin.sale.id };
      for (const [label, change] of [
        ["provider", { source: "another-provider" }],
        ["product", { productName: "Another purchase" }]
      ]) {
        const ref = `${providerRef}-captured-${label}`;
        await onPaymentReceived(event("payment.received", { ...bound, providerRef: ref }), conn);
        const conflicting = event("payment.received", { ...bound, providerRef: ref, ...change });
        await onPaymentReceived(conflicting, conn);
        for (const handler of [onPaymentReceivedMoney, onDepositPaidMoney]) {
          const refused = await handler(conflicting, conn);
          assert.equal(refused.reason, "transaction_source_conflict", `${label} cannot repurpose captured money`);
        }
      }
      // The adapter now preserves its link-derived deposit bucket on both
      // callbacks even when the provider omits a display title.
      const titleless = { ...bound, providerRef: `${providerRef}-titleless`, productName: null };
      await onPaymentFailed(event("payment.failed", titleless), conn);
      await onPaymentReceived(event("payment.received", titleless), conn);
      assert.equal((await readTransaction(titleless.providerRef)).status, "succeeded");
      assert.equal((await readTransaction(titleless.providerRef)).product_name, "deposit");
      await onPaymentFailed(event("payment.failed", bound), conn);
      const transactionId = (await readTransaction()).id;
      const received = event("payment.received", { ...bound, invoiceId: randomUUID() });
      await onPaymentReceived(received, conn);
      assert.equal((await readTransaction()).status, "succeeded");
      assert.equal((await readTransaction()).id, transactionId, "capture settles the existing attempt");
      assert.equal((await onPaymentReceivedMoney(received, conn)).reason, "payment_link_invoice_conflict");
      assert.equal((await onDepositPaidMoney({ ...received, id: randomUUID(), name: "deposit.paid" }, conn)).reason,
        "payment_link_invoice_conflict");
      for (const table of ["sale_payments", "commission_ledger", "entitlements", "cards"]) {
        const clause = table === "sale_payments" ? "sale_id=$1" : "client_id=$1";
        const key = table === "sale_payments" ? origin.sale.id : clientId;
        assert.equal((await conn.query(`SELECT count(*)::int n FROM ${table} WHERE ${clause}`, [key])).rows[0].n,
          0, `conflicting event pair cannot write ${table}`);
      }
      const paid = event("payment.received", bound);
      assert.equal((await onPaymentReceivedMoney(paid, conn)).done, true);
      const deposit = event("deposit.paid", bound);
      assert.equal((await onDepositPaidMoney(deposit, conn)).done, true);
      assert.equal((await onDepositPaidMoney({ ...deposit, id: randomUUID() }, conn)).done, true);
      await onPaymentFailed(event("payment.failed", bound), conn);
      assert.equal((await readTransaction()).status, "succeeded", "late decline cannot downgrade captured money");
      assert.equal((await conn.query("SELECT count(*)::int n FROM sale_payments WHERE sale_id=$1", [origin.sale.id])).rows[0].n, 1);
      assert.equal((await conn.query("SELECT count(*)::int n FROM entitlements WHERE client_id=$1", [clientId])).rows[0].n, 1);
      assert.equal((await conn.query("SELECT count(*)::int n FROM cards WHERE client_id=$1", [clientId])).rows[0].n, 1);
    } finally {
      await conn.query("ROLLBACK").catch(() => {});
      conn.release();
    }
  });
});
