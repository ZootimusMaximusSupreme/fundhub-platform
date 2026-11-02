// A/R A60: dashboard client receivables must be issued, still owed, and
// owned by their organization. Exact production v_client_ar_balance view.
// Only GitHub Actions disposable localhost/fundhub_ci, BEGIN/ROLLBACK and
// synthetic +tag@example.invalid buyers. No production DB or provider writes.
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool, close } from "../db.mjs";
import { createInvoice, markSent, markPaid } from "../invoices/index.mjs";

const SAFE_SCRATCH = (() => {
  if (process.env.CI !== "true" || !process.env.DATABASE_URL) return false;
  try {
    const url = new URL(process.env.DATABASE_URL);
    return ["localhost", "127.0.0.1"].includes(url.hostname)
      && url.pathname === "/fundhub_ci";
  } catch { return false; }
})();

describe("client A/R totals are owned and issued-only (disposable PostgreSQL)", {
  skip: SAFE_SCRATCH ? false : "CI localhost/fundhub_ci only"
}, () => {
  let db, orgA, orgB, buyerA, buyerB, draftOnlyBuyer;
  let sent, partial, draft, paid, foreign, contradictory;

  const make = async (orgId, clientId, amount, { status = "draft", dueAt = null } = {}) => {
    const row = await createInvoice(db, {
      orgId, clientId, amount, source: "funding_success_fee", dueAt
    });
    assert.ok(row?.id);
    if (status === "draft") return row;
    const issued = await markSent(db, { invoiceId: row.id });
    assert.equal(issued?.status, "sent");
    if (status === "paid") {
      const result = await markPaid(db, { invoiceId: row.id });
      assert.equal(result?.status, "paid");
      return result;
    }
    if (status === "partially_paid") {
      await db.query("UPDATE invoices SET status='partially_paid' WHERE id=$1", [row.id]);
      return { ...issued, status };
    }
    return issued;
  };

  const resultFor = async (orgId, clientId) => (await db.query(
    `SELECT org_id, client_id, open_invoices, overdue_invoices,
            balance_due, overdue_balance, max_days_overdue, oldest_due_at
       FROM v_client_ar_balance
      WHERE org_id=$1 AND client_id=$2`,
    [orgId, clientId]
  )).rows;

  before(async () => {
    db = await pool().connect();
    await db.query("BEGIN");
    const createOrg = async (tag) => (await db.query(
      "INSERT INTO orgs(slug,name) VALUES ($1,$2) RETURNING id",
      ["ci-ar-client-balance-" + tag + "-" + randomUUID(), "CI AR Balance " + tag]
    )).rows[0].id;
    orgA = await createOrg("a");
    orgB = await createOrg("b");
    const createBuyer = async (orgId, tag) => (await db.query(
      "INSERT INTO clients(org_id,first_name,last_name,email) VALUES ($1,'AR','BalanceBuyer',$2) RETURNING id",
      [orgId, "ar-client-balance+" + tag + "-" + randomUUID() + "@example.invalid"]
    )).rows[0].id;
    buyerA = await createBuyer(orgA, "a");
    buyerB = await createBuyer(orgB, "b");
    draftOnlyBuyer = await createBuyer(orgA, "draft-only");

    const past = new Date(Date.now() - 4 * 86_400_000).toISOString();
    const future = new Date(Date.now() + 10 * 86_400_000).toISOString();

    // The four org-A rows would formerly inflate balances to $960.
    draft = await make(orgA, buyerA, 475, { dueAt: past });
    sent = await make(orgA, buyerA, 125, { status: "sent", dueAt: past });
    partial = await make(orgA, buyerA, 250, { status: "partially_paid", dueAt: future });
    await db.query(
      "INSERT INTO invoice_payments(org_id,invoice_id,kind,amount,method) VALUES ($1,$2,'payment',100,'test')",
      [orgA, partial.id]
    );
    // Intentional inconsistent status/ledger: paid invoice with zero receipts
    // must be flagged for reconciliation, not billed again in the aggregate.
    paid = await make(orgA, buyerA, 210, { status: "paid", dueAt: past });
    await make(orgA, draftOnlyBuyer, 45, { dueAt: past });
    foreign = await make(orgB, buyerB, 830, { status: "sent", dueAt: past });
    // Legacy ID-only invoice FK permits a cross-tenant buyer. Reports must not.
    // Historical malformed row for the view's legacy-data isolation test.
    // The canonical createInvoice helper now rejects this mismatched buyer.
    contradictory = (await db.query(
      `INSERT INTO invoices (org_id,client_id,amount_due,source,due_at,status)
       VALUES ($1,$2,999,'funding_success_fee',$3,'sent') RETURNING *`,
      [orgA, buyerB, past]
    )).rows[0];
  });

  after(async () => {
    if (db) {
      await db.query("ROLLBACK").catch(() => {});
      db.release();
    }
    await close();
  });

  test("company A owes exactly $275 issued debt, not $960 including drafts/paid", async () => {
    const rows = await resultFor(orgA, buyerA);
    assert.equal(rows.length, 1);
    assert.equal(Number(rows[0].open_invoices), 2);
    assert.equal(Number(rows[0].balance_due), 275, "$125 + ($250 - $100)");
    assert.equal(Number(rows[0].overdue_invoices), 1);
    assert.equal(Number(rows[0].overdue_balance), 125);
    assert.ok(Number(rows[0].max_days_overdue) >= 3);
    assert.ok(rows[0].oldest_due_at);
  });

  test("draft-only buyer retains a report row but owes zero", async () => {
    const rows = await resultFor(orgA, draftOnlyBuyer);
    assert.equal(rows.length, 1);
    assert.equal(Number(rows[0].open_invoices), 0);
    assert.equal(Number(rows[0].balance_due), 0);
    assert.equal(Number(rows[0].overdue_invoices), 0);
    assert.equal(Number(rows[0].overdue_balance), 0);
    assert.equal(rows[0].max_days_overdue, null);
    assert.equal(rows[0].oldest_due_at, null);
  });

  test("tenant B's $830 is B's alone; A cannot count contradictory B-owned $999", async () => {
    const raw = (await db.query(
      "SELECT invoice_id, org_id, client_id, open_balance FROM v_invoice_aging WHERE invoice_id=$1",
      [contradictory.id]
    )).rows[0];
    assert.equal(String(raw.org_id), String(orgA));
    assert.equal(String(raw.client_id), String(buyerB));
    assert.equal(Number(raw.open_balance), 999);

    assert.deepEqual(await resultFor(orgA, buyerB), []);
    const rows = await resultFor(orgB, buyerB);
    assert.equal(rows.length, 1);
    assert.equal(Number(rows[0].balance_due), 830);
    assert.equal(Number(rows[0].open_invoices), 1);
  });

  test("ledger shows test draft/paid/partial states without changing them", async () => {
    const rows = (await db.query(
      "SELECT id, status FROM invoices WHERE id=ANY($1::uuid[])",
      [[draft.id, paid.id, partial.id, sent.id, foreign.id]]
    )).rows;
    const statuses = new Map(rows.map(r => [String(r.id), r.status]));
    assert.equal(statuses.get(String(draft.id)), "draft");
    assert.equal(statuses.get(String(paid.id)), "paid");
    assert.equal(statuses.get(String(partial.id)), "partially_paid");
    assert.equal(statuses.get(String(sent.id)), "sent");
    assert.equal(statuses.get(String(foreign.id)), "sent");
  });
});
