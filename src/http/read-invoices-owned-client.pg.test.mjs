// The staff A/R list must not reveal a foreign company's buyer identifier,
// client code, or contradictory invoice balance. The original invoice/client
// foreign key is NOT tenant-composite; this tests the exact production list SQL.
// CI disposable Postgres on localhost/fundhub_ci only. Synthetic plus-tag
// fixtures remain inside one transaction that always ROLLBACKs. No merchant,
// provider, email, SMS, or live Supabase contact.
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool, close } from "../db.mjs";
import { createInvoice, markSent } from "../invoices/index.mjs";
import { AR_INVOICE_LIST_SQL } from "../../api/read/invoices.mjs";

const SCRATCH = (() => {
  if (process.env.CI !== "true" || !process.env.DATABASE_URL) return false;
  try {
    const u = new URL(process.env.DATABASE_URL);
    return ["localhost", "127.0.0.1"].includes(u.hostname)
      && u.pathname === "/fundhub_ci";
  } catch { return false; }
})();

describe("staff AR list enforces same-org invoice buyer (real PostgreSQL)", {
  skip: SCRATCH ? false : "CI loopback fundhub_ci only"
}, () => {
  let conn, orgA, orgB, buyerA, buyerB, validA, contradictory, validB;

  before(async () => {
    conn = await pool().connect();
    await conn.query("BEGIN");
    const mkOrg = async (tag) => (await conn.query(
      "INSERT INTO orgs (slug, name) VALUES ($1, $2) RETURNING id",
      ["ci-ar-finance-list-" + tag + "-" + randomUUID(), "CI AR Finance List " + tag]
    )).rows[0].id;
    orgA = await mkOrg("a");
    orgB = await mkOrg("b");

    const mkBuyer = async (orgId, tag) => (await conn.query(
      "INSERT INTO clients (org_id, first_name, last_name, email) VALUES ($1, 'AR', 'FinanceBuyer', $2) RETURNING id",
      [orgId, "ar-finance-list+" + tag + "-" + randomUUID() + "@example.invalid"]
    )).rows[0].id;
    buyerA = await mkBuyer(orgA, "a");
    buyerB = await mkBuyer(orgB, "b");

    const issue = async (orgId, buyer, amount) => {
      const draft = await createInvoice(conn, {
        orgId, clientId: buyer, source: "funding_success_fee", amount
      });
      assert.ok(draft?.id);
      const sent = await markSent(conn, { invoiceId: draft.id });
      assert.equal(sent?.status, "sent");
      return sent.id;
    };
    validA = await issue(orgA, buyerA, 125);
    // Existing malformed rows must remain invisible. Seed this *legacy* case
    // directly in disposable PostgreSQL; production createInvoice now refuses it.
    contradictory = (await conn.query(
      `INSERT INTO invoices (org_id,client_id,amount_due,source)
       VALUES ($1,$2,999,'funding_success_fee') RETURNING id`,
      [orgA, buyerB]
    )).rows[0].id;
    const badSent = await markSent(conn, { invoiceId: contradictory });
    assert.equal(badSent?.status, "sent");
    validB = await issue(orgB, buyerB, 600);
  });

  after(async () => {
    if (conn) {
      await conn.query("ROLLBACK").catch(() => {});
      conn.release();
    }
    await close();
  });

  const list = async (orgId, openOnly = true) => (await conn.query(
    AR_INVOICE_LIST_SQL, [51, 0, null, null, orgId, openOnly]
  )).rows;

  test("the exact staff SQL requires owned buyer, not just invoice org", () => {
    assert.match(AR_INVOICE_LIST_SQL,
      /JOIN clients c ON c\.id = v\.client_id AND c\.org_id = v\.org_id/);
    assert.doesNotMatch(AR_INVOICE_LIST_SQL,
      /LEFT JOIN clients c ON c\.id = v\.client_id/);
  });

  test("company A sees its $125 receivable, never B's buyer or $999 misbound invoice", async () => {
    const rows = await list(orgA);
    assert.deepEqual(rows.map((r) => String(r.id)), [String(validA)]);
    assert.equal(Number(rows[0].balance_due), 125);
    assert.equal(String(rows[0].client_id), String(buyerA));
    assert.ok(!rows.some((r) => String(r.id) === String(contradictory)));
    assert.ok(!rows.some((r) => String(r.client_id) === String(buyerB)));
  });

  test("company B still sees its own $600 invoice, and no A invoice", async () => {
    const rows = await list(orgB);
    assert.deepEqual(rows.map((r) => String(r.id)), [String(validB)]);
    assert.equal(Number(rows[0].open_balance), 600);
    assert.ok(rows.every((r) => String(r.client_id) === String(buyerB)));
  });

  test("full-history finance filter also excludes the contradictory invoice", async () => {
    const rows = await list(orgA, false);
    assert.deepEqual(rows.map((r) => String(r.id)), [String(validA)]);
  });
});
