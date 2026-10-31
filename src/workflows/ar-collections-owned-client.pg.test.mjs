// A/R collection notices and staff handoffs require the invoice buyer to belong
// to the invoice tenant. Test runs ONLY on CI localhost /fundhub_ci and always
// rolls back synthetic plus-tag fixtures; no real messages or payment calls.
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool, close } from "../db.mjs";
import { createInvoice, markSent, getInvoice } from "../invoices/index.mjs";
import { handle } from "./ar-collections.mjs";

const SCRATCH = (() => {
  if (process.env.CI !== "true" || !process.env.DATABASE_URL) return false;
  try {
    const url = new URL(process.env.DATABASE_URL);
    return (url.hostname === "localhost" || url.hostname === "127.0.0.1")
      && url.pathname === "/fundhub_ci";
  } catch { return false; }
})();

describe("A/R collection tenant ownership is verified against real PostgreSQL", {
  skip: SCRATCH ? false : "CI localhost fundhub_ci only"
}, () => {
  let conn, orgA, orgB, buyerA, buyerB, ownedInvoice, contradictoryInvoice;

  before(async () => {
    conn = await pool().connect();
    await conn.query("BEGIN");

    async function org(suffix) {
      return (await conn.query(
        "INSERT INTO orgs (slug, name) VALUES ($1, $2) RETURNING id",
        [`ci-ar-chase-${suffix}-${randomUUID()}`, `CI AR Chase ${suffix}`]
      )).rows[0].id;
    }
    orgA = await org("a");
    orgB = await org("b");

    async function buyer(orgId, suffix) {
      return (await conn.query(
        `INSERT INTO clients (org_id, first_name, last_name, email)
         VALUES ($1, 'AR', 'ChaseFixture', $2) RETURNING id`,
        [orgId, `ar-chase-owned+${suffix}-${randomUUID()}@example.invalid`]
      )).rows[0].id;
    }
    buyerA = await buyer(orgA, "a");
    buyerB = await buyer(orgB, "b");

    async function issued(orgId, clientId) {
      const draft = await createInvoice(conn, {
        orgId, clientId, source: "funding_success_fee", amount: 325
      });
      assert.ok(draft?.id, "synthetic invoice inserted");
      const sent = await markSent(conn, { invoiceId: draft.id });
      assert.ok(sent?.id, "synthetic invoice issued");
      return sent;
    }
    ownedInvoice = await issued(orgA, buyerA);
    // The historical schema permits mismatched org/buyer rows. Seed one with
    // direct rollback-only SQL because createInvoice now refuses to create it.
    const historical = (await conn.query(
      `INSERT INTO invoices (org_id,client_id,amount_due,source)
       VALUES ($1,$2,325,'funding_success_fee') RETURNING id`,
      [orgA, buyerB]
    )).rows[0];
    contradictoryInvoice = await markSent(conn, { invoiceId: historical.id });
    assert.ok(contradictoryInvoice?.id);
  });

  after(async () => {
    if (conn) {
      await conn.query("ROLLBACK").catch(() => {});
      conn.release();
    }
    await close();
  });

  const event = (invoiceId, clientId) => ({
    id: randomUUID(), name: "invoice.sent", orgId: orgA, clientId,
    payload: { invoiceId, source: "funding_success_fee" }
  });

  test("contradictory foreign client cannot begin any collection send or CSM handoff", async () => {
    let steps = 0;
    const blockedStep = {
      run: async () => { steps++; throw new Error("unexpected collection side effect"); },
      sleep: async () => { throw new Error("unexpected collection timer"); }
    };
    const beforeTags = (await conn.query("SELECT tags FROM clients WHERE id = $1", [buyerB])).rows[0].tags;
    const result = await handle({
      event: event(contradictoryInvoice.id, buyerB), db: conn,
      step: blockedStep, env: {}
    });
    assert.equal(result.done, false);
    assert.equal(result.reason, "invoice_client_not_owned");
    assert.equal(steps, 0, "a cross-org invoice must be refused before any step");
    assert.equal((await getInvoice(conn, { invoiceId: contradictoryInvoice.id })).status, "sent");
    const [messages, links, tasks] = await Promise.all([
      conn.query("SELECT COUNT(*)::int n FROM messages WHERE org_id = $1 AND client_id = $2", [orgA, buyerB]),
      conn.query("SELECT COUNT(*)::int n FROM payment_links WHERE org_id = $1 AND invoice_id = $2", [orgA, contradictoryInvoice.id]),
      conn.query("SELECT COUNT(*)::int n FROM tasks WHERE org_id = $1 AND client_id = $2", [orgA, buyerB])
    ]);
    assert.equal(messages.rows[0].n, 0);
    assert.equal(links.rows[0].n, 0);
    assert.equal(tasks.rows[0].n, 0);
    const afterTags = (await conn.query("SELECT tags FROM clients WHERE id = $1", [buyerB])).rows[0].tags;
    assert.deepEqual(afterTags, beforeTags);
  });

  test("genuine same-org invoice passes owner check without contacting provider", async () => {
    let firstStage = false;
    const stopBeforeSending = {
      run: async (name) => {
        assert.equal(name, "send-ar-01");
        firstStage = true;
        return { skipped: true, reason: "ci_deliberately_no_send" };
      },
      sleep: async () => { throw new Error("unexpected sleep"); }
    };
    const result = await handle({
      event: event(ownedInvoice.id, buyerA), db: conn,
      step: stopBeforeSending, env: {}
    });
    assert.equal(result.done, true);
    assert.equal(result.stoppedAt, "before-ar-01");
    assert.equal(result.first.reason, "ci_deliberately_no_send");
    assert.equal(firstStage, true);
    const sent = await conn.query(
      "SELECT COUNT(*)::int n FROM messages WHERE org_id = $1 AND client_id = $2",
      [orgA, buyerA]
    );
    assert.equal(sent.rows[0].n, 0);
  });
});
