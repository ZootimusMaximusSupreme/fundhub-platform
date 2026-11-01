/* Postgres integration for the Commas payment inbox.
 * SKIPS unless DATABASE_URL is set.
 *
 * WHY THIS EXISTS ALONGSIDE THE UNIT TESTS. src/adapters/commas.test.mjs drives
 * the same path against a fake database that MODELS the two unique indexes. A
 * fake that models an index is still a fake, and the guarantee being claimed
 * here — "one payment cannot be counted twice" — is enforced by a real Postgres
 * unique index and a real FOR UPDATE SKIP LOCKED claim, neither of which a
 * hand-written fake can prove. This file is what makes the unit tests
 * trustworthy rather than self-confirming.
 */

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import crypto from "node:crypto";
import { db, pool, close } from "../db.mjs";
import { _resetOrgCache, defaultOrgId } from "../events/bus.mjs";
import { clearHandlers, on } from "../events/registry.mjs";
import { handleCommasWebhook, processCommasInboxRow } from "../adapters/commas.mjs";
import { drain, claim, enqueue, MAX_ATTEMPTS } from "./commas-inbox.mjs";
import { onPaymentRefunded } from "../handlers/commas-disputes.mjs";
import { onPaymentRefundedMoney } from "../handlers/money-chain.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const SECRET = "whsec_pg_commas";
const MARK = "commasinbox_pg";
const sign = (raw) => crypto.createHmac("sha256", SECRET).update(raw).digest("hex");

describe("commas inbox (real Postgres)", { skip: !HAS_DB ? "no DATABASE_URL" : false }, () => {
  let orgId;

  async function wipe() {
    await db.query(`DELETE FROM commas_inbox WHERE payment_id LIKE $1`, [`${MARK}%`]);
    await db.query(
      `DELETE FROM events WHERE idempotency_key LIKE $1 OR payload->>'email' LIKE $2`,
      [`commas:${MARK}%`, `${MARK}%`]
    );
  }

  before(async () => {
    _resetOrgCache();
    clearHandlers();
    orgId = await defaultOrgId(db);
    await wipe();
  });

  after(async () => {
    await wipe();
    clearHandlers();
    await close();
  });

  const envelope = (paymentId, { envelopeId = "env_1", type = "payment.succeeded", title = "Consulting Services Deposit" } = {}) =>
    JSON.stringify({
      id: envelopeId,
      type,
      created_at: "2026-08-06T04:00:00Z",
      data: {
        payment_id: paymentId,
        amount: 3000,
        product: { title },
        fan: { email: `${MARK}@example.com` }
      }
    });

  test("the webhook stores the exact bytes and emits nothing before answering", async () => {
    await wipe();
    const paymentId = `${MARK}_ack`;
    const raw = envelope(paymentId);

    const before = (await db.query(`SELECT count(*)::int AS n FROM events`)).rows[0].n;
    const ack = await handleCommasWebhook({
      db, rawBody: raw, signatureHeader: sign(raw), secret: SECRET
    });
    const after = (await db.query(`SELECT count(*)::int AS n FROM events`)).rows[0].n;

    assert.equal(ack.status, 200);
    assert.equal(ack.queued, true);
    assert.equal(after, before, "an event was written on the request path");

    const row = (await db.query(
      `SELECT * FROM commas_inbox WHERE org_id = $1 AND payment_id = $2`,
      [orgId, paymentId]
    )).rows[0];
    assert.ok(row, "the payment was not made durable");
    assert.equal(row.raw_body, raw, "stored bytes differ from the bytes that were signed");
    assert.equal(row.status, "pending");
    assert.equal(row.source, "webhook");
  });

  /* THE MONEY GUARANTEE, against the real unique index.
     Commas' envelope id is per-delivery; the payment id is the payment. Two
     deliveries of one payment must produce one row and one payment.received. */
  test("two deliveries of one payment collapse to a single row and a single event", async () => {
    await wipe();
    clearHandlers();
    let received = 0;
    on("payment.received", () => { received += 1; });

    const paymentId = `${MARK}_twice`;
    for (const envelopeId of ["env_A", "env_B"]) {
      const raw = envelope(paymentId, { envelopeId });
      const ack = await handleCommasWebhook({ db, rawBody: raw, signatureHeader: sign(raw), secret: SECRET });
      assert.equal(ack.status, 200);
      await drain(db, { process: processCommasInboxRow });
    }

    const rows = (await db.query(
      `SELECT * FROM commas_inbox WHERE org_id = $1 AND payment_id = $2`,
      [orgId, paymentId]
    )).rows;
    assert.equal(rows.length, 1, "one payment produced two inbox rows — it would be counted twice");
    assert.equal(rows[0].status, "done");

    const events = (await db.query(
      `SELECT name FROM events WHERE idempotency_key LIKE $1 ORDER BY name`,
      [`commas:${paymentId}:%`]
    )).rows.map((r) => r.name);
    assert.deepEqual(events, ["deposit.paid", "payment.received"]);
    assert.equal(received, 1, "the deposit was credited twice");
  });

  /* WHOSE MONEY IS THIS.
     Every payment event this adapter wrote used to be stored with a null
     client. The CRM could show that $3,000 had arrived and could not say who
     paid it. events.client_id is the column that answers that question, and it
     is a real column with a real foreign key — the unit tests model it, only a
     real Postgres proves the value survives the round trip.

     NOTE ON THE CLIENT ROW: resolving a payer find-or-creates by email, the
     same as the handler that runs a moment later, so this test leaves one
     fixture client behind on purpose. It is keyed on (org, lower(email)), so
     running the suite a hundred times still leaves exactly one. wipe() does
     not remove it — this file does not delete client rows. */
  test("a payment's events carry the client the money belongs to", async () => {
    await wipe();
    clearHandlers();
    const paymentId = `${MARK}_whose`;
    const raw = envelope(paymentId);
    await handleCommasWebhook({ db, rawBody: raw, signatureHeader: sign(raw), secret: SECRET });
    await drain(db, { process: processCommasInboxRow });

    const rows = (await db.query(
      `SELECT name, client_id FROM events WHERE idempotency_key LIKE $1 ORDER BY name`,
      [`commas:${paymentId}:%`]
    )).rows;
    assert.deepEqual(rows.map((r) => r.name), ["deposit.paid", "payment.received"]);
    assert.ok(rows.every((r) => r.client_id), "a payment landed with nobody's name on it");

    const payer = (await db.query(
      `SELECT id FROM clients WHERE org_id = $1 AND lower(email) = $2 LIMIT 1`,
      [orgId, `${MARK}@example.com`]
    )).rows[0];
    assert.ok(payer, "the payer was never resolved at all");
    assert.ok(
      rows.every((r) => r.client_id === payer.id),
      "one payment's events disagree about who paid it"
    );
  });

  test("the unique index itself rejects a duplicate, not just the application", async () => {
    await wipe();
    const paymentId = `${MARK}_idx`;
    const first = await enqueue(db, {
      orgId, rawBody: envelope(paymentId), paymentId, eventType: "payment.succeeded"
    });
    const second = await enqueue(db, {
      orgId, rawBody: envelope(paymentId, { envelopeId: "different" }), paymentId, eventType: "payment.succeeded"
    });
    assert.equal(first.deduped, false);
    assert.equal(second.deduped, true);
    assert.equal(second.id, first.id, "the duplicate did not resolve back to the original row");
  });

  test("different events on ONE payment stay separate rows", async () => {
    await wipe();
    const paymentId = `${MARK}_lifecycle`;
    for (const type of ["payment.succeeded", "refund.created", "dispute.created"]) {
      const raw = envelope(paymentId, { type, envelopeId: `env_${type}` });
      await handleCommasWebhook({ db, rawBody: raw, signatureHeader: sign(raw), secret: SECRET });
    }
    const rows = (await db.query(
      `SELECT event_type FROM commas_inbox WHERE org_id = $1 AND payment_id = $2 ORDER BY event_type`,
      [orgId, paymentId]
    )).rows.map((r) => r.event_type);
    assert.deepEqual(rows, ["dispute.created", "payment.succeeded", "refund.created"],
      "a refund or dispute was swallowed by its own payment's dedupe key");
  });

  test("refund identities survive replay, separate partials and unmatched-original dead-letter review", async () => {
    await wipe();
    clearHandlers();
    const conn = await pool().connect();
    try {
      await conn.query("BEGIN");
      on("payment.refunded", onPaymentRefunded);
      on("payment.refunded", onPaymentRefundedMoney);
      const tag = `${MARK}_${crypto.randomUUID()}`;
      const paymentId = `${tag}_ORD`;
      const transactionHashid = `${tag}_hashid`;
      const envelopeId = `${tag}_delivery`;
      const clientId = (await conn.query(
        `INSERT INTO clients (org_id,email,first_name,last_name)
         VALUES ($1,$2,'Refund','Fixture') RETURNING id`, [orgId, `${tag}@example.invalid`]
      )).rows[0].id;
      // Deliberate decoys: a refund hashid/delivery ID matching a receipt must
      // never be used as an undocumented crosswalk to that receipt.
      for (const ref of [paymentId, transactionHashid, envelopeId]) {
        await conn.query(
          `INSERT INTO transactions (org_id,client_id,product_name,amount_paid,status,provider,provider_ref,raw_payload)
           VALUES ($1,$2,'Consulting Services Package',100,'succeeded','commas',$3,'{}')`,
          [orgId, clientId, ref]
        );
      }
      const raw = (refundId, deliveryId, amount, original = paymentId) => JSON.stringify({
        id: deliveryId, type: "refund.created", data: {
          refund_id: refundId, refund_transaction_id: transactionHashid,
          ...(original ? { payment_id: original } : {}), amount, status: "success",
          buyer: { email: `${tag}@example.invalid` }, item: { title: "Consulting Services Package" }
        }
      });
      const receive = async (body) => {
        const ack = await handleCommasWebhook({ db: conn, rawBody: body, signatureHeader: sign(body), secret: SECRET });
        assert.equal(ack.ok, true);
        return ack;
      };
      // Concurrent replay hits the actual org/refund unique key.
      const first = raw(`${tag}_refundA`, `${tag}_deliveryA`, 40);
      for (const status of ["failed", "pending"]) {
        const unsettled = JSON.parse(first);
        unsettled.id = `${tag}_${status}`;
        unsettled.data.status = status;
        await receive(JSON.stringify(unsettled));
      }
      await drain(conn, { process: processCommasInboxRow, maxBatches: 1 });
      assert.equal((await conn.query(
        `SELECT count(*)::int AS n FROM events WHERE payload->>'paymentId'=$1`, [paymentId]
      )).rows[0].n, 0, "unsettled refund cannot reach the money/access handlers");
      const acks = await Promise.all([receive(first), receive(raw(`${tag}_refundA`, `${tag}_redelivery`, 40))]);
      assert.equal(acks.filter((a) => a.deduped).length, 1);
      await receive(raw(`${tag}_refundB`, `${tag}_deliveryB`, 60));
      await drain(conn, { process: processCommasInboxRow, maxBatches: 1 });
      const events = (await conn.query(
        `SELECT client_id,payload FROM events WHERE payload->>'paymentId'=$1 ORDER BY (payload->>'amount')::numeric`, [paymentId]
      )).rows;
      assert.deepEqual(events.map((e) => e.payload.amount), [40, 60]);
      assert.ok(events.every((e) => e.client_id === clientId && e.payload.providerRef === paymentId &&
        e.payload.refundTransactionId === transactionHashid));
      assert.equal((await conn.query(
        `SELECT count(*)::int AS n FROM tasks WHERE org_id=$1 AND client_id=$2 AND source_workflow='commas-refund'`,
        [orgId, clientId]
      )).rows[0].n, 2);

      await receive(raw(`${tag}_unmatched`, envelopeId, 25, null));
      await receive(raw(`${tag}_unmatched`, `${tag}_changedEnvelope`, 25, null));
      await drain(conn, { process: processCommasInboxRow, maxBatches: 1 });
      const unresolved = (await conn.query(
        `SELECT client_id,payload FROM events WHERE payload->>'refundId'=$1`, [`${tag}_unmatched`]
      )).rows;
      assert.equal(unresolved.length, 1);
      assert.equal(unresolved[0].client_id, null);
      assert.equal(unresolved[0].payload.providerRef, null);
      assert.equal(unresolved[0].payload.paymentId, null);
      assert.equal(unresolved[0].payload.refundTransactionId, transactionHashid);
      const failed = (await conn.query(
        `SELECT payload,error_message FROM failed_events WHERE payload->>'refundId'=$1`, [`${tag}_unmatched`]
      )).rows;
      assert.equal(failed.length, 1);
      assert.match(failed[0].error_message, /manual reconciliation/);
      assert.equal(failed[0].payload.refundTransactionId, transactionHashid);
      assert.equal((await conn.query(
        `SELECT count(*)::int AS n FROM tasks WHERE org_id=$1 AND client_id=$2 AND source_workflow='commas-refund'`,
        [orgId, clientId]
      )).rows[0].n, 2, "unmatched callback cannot assign work to the email/ID decoy");

      // Preserve an already handled refund under either pre-upgrade key shape.
      for (const original of [paymentId, null]) {
        const refundId = `${tag}_legacy_${original ? 'payment' : 'body'}`;
        const body = raw(refundId, `${tag}_oldDelivery`, 10, original);
        const legacy = await enqueue(conn, { orgId, paymentId: original, refundStatus: "success", eventType: "refund.created", rawBody: body });
        await conn.query("UPDATE commas_inbox SET status='done' WHERE id=$1", [legacy.id]);
        const replay = await receive(raw(refundId, `${tag}_newDelivery`, 10, original));
        assert.equal(replay.deduped, true);
        assert.equal(replay.inboxId, legacy.id);
      }
      assert.equal((await conn.query(
        `SELECT count(*)::int AS n FROM transactions WHERE org_id=$1 AND client_id=$2 AND status='succeeded' AND amount_paid=100`,
        [orgId, clientId]
      )).rows[0].n, 3, "refund identity handling must not rewrite receipt money");
    } finally {
      await conn.query("ROLLBACK");
      conn.release();
      clearHandlers();
    }
  });

  /* expired / canceled are abandoned checkouts. They must reach the bus for
     visibility and must NOT credit money or count as a decline. */
  test("an expired checkout records the fact and credits nothing", async () => {
    await wipe();
    const paymentId = `${MARK}_expired`;
    const raw = envelope(paymentId, { type: "payment.expired", envelopeId: "env_exp" });
    await handleCommasWebhook({ db, rawBody: raw, signatureHeader: sign(raw), secret: SECRET });
    await drain(db, { process: processCommasInboxRow });

    const names = (await db.query(
      `SELECT name FROM events WHERE idempotency_key LIKE $1`,
      [`commas:${paymentId}:%`]
    )).rows.map((r) => r.name);
    assert.deepEqual(names, ["payment.expired"]);
    assert.ok(!names.includes("payment.failed"), "an abandoned checkout was counted as a decline");
    assert.ok(!names.includes("payment.received"), "an abandoned checkout credited money");
  });

  /* A serverless function killed mid-pass leaves a row in 'processing'. Without
     reclaim that row is invisible forever and the payment is lost — exactly what
     this table exists to prevent. */
  test("a row stranded in 'processing' is reclaimed after the stale window", async () => {
    await wipe();
    const paymentId = `${MARK}_stranded`;
    await enqueue(db, { orgId, rawBody: envelope(paymentId), paymentId, eventType: "payment.succeeded" });

    await db.query(
      `UPDATE commas_inbox
          SET status = 'processing', claimed_at = now() - interval '1 hour', attempts = 1
        WHERE org_id = $1 AND payment_id = $2`,
      [orgId, paymentId]
    );

    const claimed = await claim(db, { limit: 10 });
    assert.ok(
      claimed.some((r) => r.payment_id === paymentId),
      "a payment stranded by a killed function was never picked up again"
    );
  });

  test("a fresh 'processing' row is NOT stolen from the pass that holds it", async () => {
    await wipe();
    const paymentId = `${MARK}_inflight`;
    await enqueue(db, { orgId, rawBody: envelope(paymentId), paymentId, eventType: "payment.succeeded" });
    await db.query(
      `UPDATE commas_inbox SET status = 'processing', claimed_at = now(), attempts = 1
        WHERE org_id = $1 AND payment_id = $2`,
      [orgId, paymentId]
    );
    const claimed = await claim(db, { limit: 10 });
    assert.ok(
      !claimed.some((r) => r.payment_id === paymentId),
      "two passes would process one payment at the same time"
    );
  });

  test("a row that keeps failing stops being retried but keeps its bytes", async () => {
    await wipe();
    const paymentId = `${MARK}_poison`;
    const raw = envelope(paymentId);
    await enqueue(db, { orgId, rawBody: raw, paymentId, eventType: "payment.succeeded" });
    await db.query(
      `UPDATE commas_inbox SET status = 'failed', attempts = $3, last_error = 'boom'
        WHERE org_id = $1 AND payment_id = $2`,
      [orgId, paymentId, MAX_ATTEMPTS]
    );

    const claimed = await claim(db, { limit: 10 });
    assert.ok(!claimed.some((r) => r.payment_id === paymentId), "an exhausted row was retried anyway");

    const row = (await db.query(
      `SELECT raw_body, last_error FROM commas_inbox WHERE org_id = $1 AND payment_id = $2`,
      [orgId, paymentId]
    )).rows[0];
    assert.equal(row.raw_body, raw, "the payment's bytes were lost — recovery is now impossible");
    assert.equal(row.last_error, "boom");
  });
});
