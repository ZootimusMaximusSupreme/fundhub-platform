// A/R reversal identity safety on GitHub Actions' disposable local PostgreSQL.
// Every fixture INSERT and task write lives inside one ROLLBACK-only transaction.
// Never connect this test to live Supabase or another remote service.
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { onPaymentDisputed, onPaymentRefunded } from "./commas-disputes.mjs";

const SCRATCH = (() => {
  if (process.env.CI !== "true" || !process.env.DATABASE_URL) return false;
  try {
    const u = new URL(process.env.DATABASE_URL);
    return ["127.0.0.1", "localhost"].includes(u.hostname) && u.pathname === "/fundhub_ci";
  } catch { return false; }
})();

describe("A/R reversal owner and no phantom buyer (rollback-only PostgreSQL)",
  { skip: !SCRATCH ? "requires local disposable fundhub_ci in CI" : false }, () => {
    let conn, orgId, original, other, paymentRef;
    before(async () => {
      conn = await pool().connect();
      await conn.query("BEGIN");
      orgId = await resolveDefaultOrg(conn);
      const insertClient = async (name) => {
        const email = `ar-reversal+${name}-${randomUUID()}@example.invalid`;
        const r = await conn.query(
          `INSERT INTO clients (org_id, email, first_name, last_name)
           VALUES ($1,$2,'AR','ReversalFixture') RETURNING id`,
          [orgId, email]
        );
        return r.rows[0].id;
      };
      original = await insertClient("original");
      other = await insertClient("other");
      paymentRef = "ci-reversal-" + randomUUID();
      await conn.query(
        `INSERT INTO transactions
           (org_id, client_id, product_name, amount_paid, status, provider, provider_ref, raw_payload)
         VALUES ($1,$2,'CI consulting payment',125.25,'succeeded','commas',$3,'{}'::jsonb)`,
        [orgId, original, paymentRef]
      );
    });

    after(async () => {
      if (conn) {
        await conn.query("ROLLBACK").catch(() => {});
        conn.release();
      }
      await close();
    });

    test("original succeeded receipt wins over mismatched same-org callback identity; replay is one owner task", async () => {
      const event = {
        id: "ci-dispute-" + randomUUID(), name: "payment.disputed", orgId, clientId: other,
        payload: {
          email: "wrong-callback@example.invalid",
          amount: 125.25, paymentId: paymentRef,
          dueBy: "2026-11-07T23:00:00Z"
        }
      };
      const first = await onPaymentDisputed(event, conn);
      const second = await onPaymentDisputed(event, conn);
      assert.equal(first.created, true);
      assert.equal(second.created, false);
      const rows = await conn.query(
        `SELECT org_id, client_id, assignee_role, due_at
           FROM tasks WHERE org_id=$1 AND source_workflow='commas-dispute'
             AND body LIKE '%ci-reversal-%'`, [orgId]
      );
      assert.equal(rows.rows.length, 1);
      assert.equal(String(rows.rows[0].client_id), String(original));
      assert.equal(rows.rows[0].assignee_role, "owner");
      assert.equal(new Date(rows.rows[0].due_at).toISOString(), "2026-11-07T23:00:00.000Z");
    });

    test("refund on original receipt assigns original customer and never changes sale/commission totals", async () => {
      const event = {
        id: "ci-refund-" + randomUUID(), name: "payment.refunded", orgId, clientId: other,
        payload: { paymentId: paymentRef, email: "wrong@example.invalid", amount: 20 }
      };
      const answer = await onPaymentRefunded(event, conn);
      assert.equal(answer.created, true);
      const r = await conn.query(
        "SELECT org_id, client_id, assignee_role FROM tasks WHERE id=$1",
        [answer.id]
      );
      assert.equal(String(r.rows[0].client_id), String(original));
      assert.equal(r.rows[0].assignee_role, "owner");
      const t = await conn.query(
        "SELECT status, amount_paid FROM transactions WHERE org_id=$1 AND provider_ref=$2",
        [orgId, paymentRef]
      );
      assert.equal(t.rows[0].status, "succeeded", "unresolved reversal must not change money");
      assert.equal(Number(t.rows[0].amount_paid), 125.25);
    });

    test("unknown and foreign-ID-only callbacks cannot create buyers or wrong-owner tasks", async () => {
      const missing = "ar-reversal+unknown-" + randomUUID() + "@example.invalid";
      const foreignId = randomUUID();
      const beforeClients = await conn.query(
        "SELECT COUNT(*)::int n FROM clients WHERE org_id=$1", [orgId]
      );
      const event = {
        id: "ci-unknown-dispute-" + randomUUID(), name: "payment.disputed",
        orgId, clientId: foreignId,
        payload: { paymentId: "no-such-payment-" + randomUUID(), email: missing, amount: 99 }
      };
      await assert.rejects(onPaymentDisputed(event, conn), /unowned payment.disputed/);
      await assert.rejects(onPaymentRefunded({ ...event, name: "payment.refunded" }, conn), /unowned payment.refunded/);
      const afterClients = await conn.query(
        "SELECT COUNT(*)::int n FROM clients WHERE org_id=$1", [orgId]
      );
      assert.equal(afterClients.rows[0].n, beforeClients.rows[0].n);
      const phantom = await conn.query(
        "SELECT id FROM clients WHERE org_id=$1 AND lower(email)=$2", [orgId, missing]
      );
      assert.equal(phantom.rows.length, 0);
      const incorrect = await conn.query(
        "SELECT id FROM tasks WHERE org_id=$1 AND client_id=$2", [orgId, other]
      );
      assert.equal(incorrect.rows.length, 0, "no tasks for the unrelated buyer");
    });
  });
