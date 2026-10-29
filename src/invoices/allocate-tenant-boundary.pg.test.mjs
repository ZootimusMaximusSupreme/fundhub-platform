// A/R cross-tenant invoice lookups and review routing on disposable PostgreSQL.
// CI loopback /fundhub_ci only; all writes are within one ROLLBACK transaction.
// No production Supabase, processor, CRM, email, SMS, or real customer mutation.
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { createInvoice, markSent, getInvoice } from "./index.mjs";
import { allocatePayment } from "./allocate.mjs";

const SCRATCH = (() => {
  if (process.env.CI !== "true" || !process.env.DATABASE_URL) return false;
  try {
    const url = new URL(process.env.DATABASE_URL);
    return ["localhost", "127.0.0.1"].includes(url.hostname)
      && url.pathname === "/fundhub_ci";
  } catch { return false; }
})();

describe("A/R tenant-isolated invoice payment identity (rollback-only real Postgres)",
  { skip: SCRATCH ? false : "GitHub Actions loopback fundhub_ci only" }, () => {
    let conn, tx, org, otherOrg, buyer, otherBuyer, secondBuyer;
    before(async () => {
      conn = await pool().connect();
      await conn.query("BEGIN");
      tx = { query: (...args) => conn.query(...args) };
      org = await resolveDefaultOrg(conn);
      otherOrg = (await conn.query(
        "INSERT INTO orgs (slug, name) VALUES ($1, 'AR Foreign Tenant') RETURNING id",
        [`ar-foreign-${randomUUID()}`]
      )).rows[0].id;
      const mkBuyer = async (orgId, suffix) => (await conn.query(
        `INSERT INTO clients (org_id, first_name, last_name, email)
         VALUES ($1, 'AR', 'Tenant', $2) RETURNING id`,
        [orgId, `ar-tenant+${suffix}-${randomUUID()}@example.invalid`]
      )).rows[0].id;
      buyer = await mkBuyer(org, "original");
      secondBuyer = await mkBuyer(org, "second");
      otherBuyer = await mkBuyer(otherOrg, "foreign");
    });
    after(async () => {
      if (conn) {
        await conn.query("ROLLBACK").catch(() => {});
        conn.release();
      }
      await close();
    });
    const issue = async ({ orgId = org, clientId = buyer, source = "funding_success_fee", ref = null } = {}) => {
      const draft = await createInvoice(conn, {
        orgId, clientId, source, amount: 100, provider: ref ? "commas" : null,
        providerRef: ref
      });
      assert.ok(draft?.id);
      return markSent(conn, { invoiceId: draft.id });
    };
    const received = (overrides = {}) => ({
      id: randomUUID(), orgId: org, clientId: null,
      payload: { product: "success_fee", amount: 25, paymentId: randomUUID() },
      ...overrides
    });
    const receiptCount = async (invoiceId) => (await conn.query(
      "SELECT count(*)::int AS n FROM invoice_payments WHERE invoice_id = $1", [invoiceId]
    )).rows[0].n;
    const badTaskCount = async () => (await conn.query(
      "SELECT count(*)::int AS n FROM tasks WHERE org_id = $1 AND client_id = $2 AND source_workflow = 'ar-allocate'",
      [org, otherBuyer]
    )).rows[0].n;

    test("foreign invoice ID never credits or creates a local-org task on a foreign buyer", async () => {
      const foreign = await issue({ orgId: otherOrg, clientId: otherBuyer });
      const res = await allocatePayment(tx, received({
        payload: { product: "success_fee", amount: 25, invoiceId: foreign.id, paymentId: randomUUID() }
      }));
      assert.equal(res.allocated, false);
      assert.equal(res.reason, "invoice_mismatch");
      assert.equal("invoiceId" in res, false, "do not echo foreign invoice metadata");
      assert.equal(await badTaskCount(), 0);
      assert.equal(await receiptCount(foreign.id), 0);
      assert.equal((await getInvoice(conn, { invoiceId: foreign.id })).status, "sent");
    });

    test("foreign non-success-fee invoice ID is rejected BEFORE revealing its type", async () => {
      const foreign = await issue({ orgId: otherOrg, clientId: otherBuyer, source: "diy_letters" });
      const res = await allocatePayment(tx, received({
        payload: { product: "success_fee", amount: 25, invoiceId: foreign.id, paymentId: randomUUID() }
      }));
      assert.equal(res.reason, "invoice_mismatch");
      assert.equal("invoiceId" in res, false);
      assert.equal(await badTaskCount(), 0);
      assert.equal(await receiptCount(foreign.id), 0);
    });

    test("foreign payment-link ID cannot resolve or credit the other company's invoice", async () => {
      const foreign = await issue({ orgId: otherOrg, clientId: otherBuyer });
      const link = (await conn.query(
        `INSERT INTO payment_links (org_id, client_id, purpose, amount_cents,
            link_ref, checkout_url, invoice_id)
         VALUES ($1,$2,'custom',10000,$3,'https://example.invalid/ci',$4)
         RETURNING id`,
        [otherOrg, otherBuyer, `ar-other-link-${randomUUID()}`, foreign.id]
      )).rows[0].id;
      const res = await allocatePayment(tx, received({
        payload: { product: "success_fee", amount: 25, paymentLinkId: link, paymentId: randomUUID() }
      }));
      assert.equal(res.allocated, false);
      // A supplied foreign checkout identifier is a conflicting identity,
      // not an unspecified payment. No invoice/client details are disclosed.
      assert.equal(res.reason, "invoice_mismatch");
      assert.equal(await badTaskCount(), 0);
      assert.equal(await receiptCount(foreign.id), 0);
    });

    test("foreign provider reference cannot borrow another org's invoice", async () => {
      const ref = `ar-foreign-provider-${randomUUID()}`;
      const foreign = await issue({ orgId: otherOrg, clientId: otherBuyer, ref });
      const res = await allocatePayment(tx, received({
        payload: { product: "success_fee", amount: 25, invoiceRef: ref, paymentId: randomUUID() }
      }));
      assert.equal(res.reason, "unresolved");
      assert.equal(res.allocated, false);
      assert.equal(await receiptCount(foreign.id), 0);
      assert.equal(await badTaskCount(), 0);
    });

    test("valid local invoice ID plus a foreign checkout ID is a conflict, not permission to settle", async () => {
      const local = await issue();
      const foreign = await issue({ orgId: otherOrg, clientId: otherBuyer });
      const foreignLink = (await conn.query(
        `INSERT INTO payment_links (org_id, client_id, purpose, amount_cents,
            link_ref, checkout_url, invoice_id)
         VALUES ($1,$2,'custom',10000,$3,'https://example.invalid/ci',$4)
         RETURNING id`,
        [otherOrg, otherBuyer, `ar-foreign-conflict-${randomUUID()}`, foreign.id]
      )).rows[0].id;
      const res = await allocatePayment(tx, received({
        payload: {
          product: "success_fee", amount: 25, invoiceId: local.id,
          paymentLinkId: foreignLink, paymentId: randomUUID()
        }
      }));
      assert.equal(res.reason, "invoice_mismatch");
      assert.equal(res.allocated, false);
      assert.equal(await receiptCount(local.id), 0);
      assert.equal(await receiptCount(foreign.id), 0);
      assert.equal(await badTaskCount(), 0);
    });

    test("replayed local receipt with a foreign checkout ID is refused as conflicting", async () => {
      const local = await issue();
      const paymentId = randomUUID();
      const first = await allocatePayment(tx, received({
        payload: { product: "success_fee", amount: 25, invoiceId: local.id, paymentId }
      }));
      assert.equal(first.allocated, true);
      const foreign = await issue({ orgId: otherOrg, clientId: otherBuyer });
      const foreignLink = (await conn.query(
        `INSERT INTO payment_links (org_id, client_id, purpose, amount_cents,
            link_ref, checkout_url, invoice_id)
         VALUES ($1,$2,'custom',10000,$3,'https://example.invalid/ci',$4)
         RETURNING id`,
        [otherOrg, otherBuyer, `ar-replay-foreign-link-${randomUUID()}`, foreign.id]
      )).rows[0].id;
      const res = await allocatePayment(tx, received({
        payload: {
          product: "success_fee", amount: 25, invoiceId: local.id,
          paymentLinkId: foreignLink, paymentId
        }
      }));
      assert.equal(res.allocated, false);
      assert.equal(res.replay, false);
      assert.equal(res.reason, "receipt_reference_mismatch");
      assert.equal(await receiptCount(local.id), 1);
      assert.equal(await receiptCount(foreign.id), 0);
    });

    test("unknown invoice reference with a foreign customer ID cannot create an in-org task on that buyer", async () => {
      const res = await allocatePayment(tx, received({
        clientId: otherBuyer,
        payload: { product: "success_fee", amount: 25, invoiceId: randomUUID(), paymentId: randomUUID() }
      }));
      assert.equal(res.allocated, false);
      assert.equal(res.reason, "unresolved");
      assert.equal(await badTaskCount(), 0, "review queue must never mix event org and foreign client");
    });

    test("same-org mismatched buyer queues exactly one review for invoice owner, not event contact", async () => {
      const local = await issue();
      const paymentId = randomUUID();
      const res = await allocatePayment(tx, received({
        clientId: secondBuyer,
        payload: { product: "success_fee", amount: 25, invoiceId: local.id, paymentId }
      }));
      assert.equal(res.reason, "invoice_mismatch");
      assert.equal(await receiptCount(local.id), 0);
      // Other tests in this rollback-only transaction already created review
      // tasks for *other* payment IDs. Filter by this conflict's immutable
      // PSP reference so this checks its exact owner and idempotency.
      const target = await conn.query(
        `SELECT client_id FROM tasks
         WHERE org_id = $1 AND source_workflow = 'ar-allocate' AND body = $2`,
        [org, `invoice_mismatch:${paymentId}`]
      );
      assert.equal(target.rows.length, 1);
      assert.equal(String(target.rows[0].client_id), String(buyer),
        "review must attach to actual invoice owner");
      assert.notEqual(String(target.rows[0].client_id), String(secondBuyer),
        "forged callback customer must never be task owner");
    });

    test("valid same-organization invoice-only receipt still allocates normally", async () => {
      const local = await issue();
      const res = await allocatePayment(tx, received({
        payload: { product: "success_fee", amount: 25, invoiceId: local.id, paymentId: randomUUID() }
      }));
      assert.equal(res.allocated, true);
      assert.equal(res.appliedCents, 2500);
      assert.equal((await getInvoice(conn, { invoiceId: local.id })).status, "partially_paid");
      assert.equal(await receiptCount(local.id), 1);
    });
  });
