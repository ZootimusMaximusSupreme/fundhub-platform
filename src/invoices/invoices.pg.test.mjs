// Postgres-backed tests for src/invoices/index.mjs.
//
// WHY THIS FILE EXISTS. Every function here was already covered by unit tests —
// and every one of them was broken. 031_invoices.sql renamed amount ->
// amount_due, provider_ref -> external_ref and issued_at -> sent_at, and this
// module was never updated, so each call raised SQLSTATE 42703 against a real
// database. The existing tests passed because they run against in-memory fakes
// (src/workflows/test-support.mjs pgFake, and the stub in index.test.mjs) that
// still model the pre-031 column names.
//
// A fake that models the schema you WISH you had cannot fail when the schema
// moves. These tests run the real SQL against real Postgres, so the next rename
// breaks a test instead of a workflow.

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { pool, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import {
  createInvoice, markSent, markPaid, voidInvoice, getInvoice,
  successFeeKey, depositKey
} from "./index.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;

describe("invoices against real Postgres", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let c, org, clientId;

  const mk = async (over = {}) => {
    return createInvoice(c, {
      orgId: org, clientId, source: "diy_letters", amount: 1000, ...over
    });
  };

  const EMAIL = `invoice.fixture+${process.pid}-${Date.now()}@example.com`;

  before(async () => {
    c = await pool().connect();
    await c.query("BEGIN");
    org = await resolveDefaultOrg(c);
    clientId = (await c.query(
      `INSERT INTO clients (org_id, first_name, last_name, email)
       VALUES ($1,'Invoice','Fixture',$2) RETURNING id`,
      [org, EMAIL])).rows[0].id;
  });

  after(async () => {
    if (c) {
      await c.query("ROLLBACK").catch(() => {});
      c.release();
    }
    await close();
  });

  // ── the regression itself ──────────────────────────────────────────────────

  test("createInvoice writes a row — the columns 031 renamed actually exist", async () => {
    const row = await mk({ amount: 1234.56 });
    assert.ok(row, "createInvoice returned null — the insert matched nothing");
    assert.equal(Number(row.amount_due), 1234.56, "amount landed in amount_due");
    assert.equal(row.status, "draft");
    assert.equal(row.source, "diy_letters");
  });

  test("markSent moves draft -> sent and stamps sent_at, not issued_at", async () => {
    const row = await mk();
    const sent = await markSent(c, { invoiceId: row.id });
    assert.ok(sent, "markSent returned null — the UPDATE matched nothing");
    assert.equal(sent.status, "sent");
    assert.ok(sent.sent_at, "sent_at was not stamped");
  });

  test("markSent is a one-way door — a sent invoice cannot be re-sent", async () => {
    const row = await mk();
    await markSent(c, { invoiceId: row.id });
    assert.equal(await markSent(c, { invoiceId: row.id }), null);
  });

  test("providerRef lands in external_ref", async () => {
    const row = await mk({ provider: "commas", providerRef: "ext_" + Date.now.name + Math.abs(1) + "_a" });
    assert.ok(row.external_ref, "provider reference did not persist");
  });

  // ── the AR ladder 031 redefined ────────────────────────────────────────────

  test("markPaid settles every OPEN rung, including the two 031 added", async () => {
    for (const status of ["draft", "sent", "reminded", "escalated", "partially_paid"]) {
      const row = await mk();
      if (status !== "draft") {
        await c.query(`UPDATE invoices SET status = $2 WHERE id = $1`, [row.id, status]);
      }
      const paid = await markPaid(c, { invoiceId: row.id });
      assert.ok(paid, `markPaid did not settle an invoice in status '${status}'`);
      assert.equal(paid.status, "paid");
      assert.ok(paid.paid_at);
    }
  });

  test("markPaid refuses a settled or void invoice", async () => {
    const paid = await mk();
    await markPaid(c, { invoiceId: paid.id });
    assert.equal(await markPaid(c, { invoiceId: paid.id }), null, "an invoice was paid twice");

    const voided = await mk();
    await voidInvoice(c, { invoiceId: voided.id });
    assert.equal(await markPaid(c, { invoiceId: voided.id }), null, "a void invoice was paid");
  });

  test("voidInvoice refuses to void something already paid", async () => {
    const row = await mk();
    await markPaid(c, { invoiceId: row.id });
    assert.equal(await voidInvoice(c, { invoiceId: row.id }), null);
  });

  // ── idempotency: all three dimensions, absorbed not raised ─────────────────

  test("a replay on idempotency_key writes one row, not two", async () => {
    const key = depositKey("sale-" + clientId);
    const first = await mk({ idempotencyKey: key });
    const second = await mk({ idempotencyKey: key });
    assert.ok(first);
    assert.equal(second, null, "the second write was not absorbed");
    const { rows } = await c.query(
      `SELECT count(*)::int n FROM invoices WHERE org_id = $1 AND idempotency_key = $2`, [org, key]);
    assert.equal(rows[0].n, 1);
  });

  test("a replay on source_event_id writes one row — the guard for a NULL key", async () => {
    // This is the case that used to double-bill: DS-02 with no saleId wrote a
    // NULL idempotency_key, so the targeted ON CONFLICT never fired.
    const evt = "00000000-0000-4000-8000-00000000e001";
    const first = await mk({ sourceEventId: evt, idempotencyKey: null });
    const second = await mk({ sourceEventId: evt, idempotencyKey: null });
    assert.ok(first);
    assert.equal(second, null, "a replayed event billed the client twice");
  });

  test("a replay on (provider, external_ref) is absorbed, not raised", async () => {
    const ref = "ext-dup-" + clientId;
    const first = await mk({ provider: "commas", providerRef: ref });
    const second = await mk({ provider: "commas", providerRef: ref });
    assert.ok(first);
    assert.equal(second, null, "a duplicate provider ref raised instead of being absorbed");
  });

  // ── source / invoice_type stay consistent in both directions ───────────────

  test("passing source projects onto the legacy invoice_type column", async () => {
    const row = await mk({ source: "funding_success_fee" });
    assert.equal(row.source, "funding_success_fee");
    assert.equal(row.invoice_type, "success_fee", "031's sync trigger did not project");
  });

  test("passing only the legacy invoiceType still derives source", async () => {
    const row = await createInvoice(c, {
      orgId: org, clientId, invoiceType: "success_fee", amount: 500
    });
    assert.equal(row.source, "funding_success_fee");
  });

  test("passing neither is refused in code, before Postgres has to", async () => {
    await assert.rejects(
      () => createInvoice(c, { orgId: org, clientId, amount: 100 }),
      /source .*or invoiceType|invoiceType/
    );
  });

  test("getInvoice round-trips", async () => {
    const row = await mk({ amount: 42 });
    const got = await getInvoice(c, { invoiceId: row.id });
    assert.equal(got.id, row.id);
    assert.equal(Number(got.amount_due), 42);
  });

  test("the success-fee key is stable for the same sale and round", () => {
    assert.equal(successFeeKey("s1", "r1"), successFeeKey("s1", "r1"));
    assert.notEqual(successFeeKey("s1", "r1"), successFeeKey("s1", "r2"));
  });
});
