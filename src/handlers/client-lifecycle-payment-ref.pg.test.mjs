import { test, after } from "node:test";
import assert from "node:assert";
import { randomUUID } from "node:crypto";
import { db, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import {
  onPaymentFailed,
  onPaymentReceived,
  PaymentProviderRefConflictError
} from "./client-lifecycle.mjs";

const SCRATCH = (() => {
  if (process.env.CI !== "true" || !process.env.DATABASE_URL) return false;
  try {
    const u = new URL(process.env.DATABASE_URL);
    return ["127.0.0.1", "localhost"].includes(u.hostname)
      && u.pathname === "/fundhub_ci";
  } catch {
    return false;
  }
})();

after(async () => {
  if (SCRATCH) await close();
});

async function insertClient(orgId, email) {
  const row = await db.query(
    `INSERT INTO clients (org_id, email, first_name, last_name, ghl_contact_id)
     VALUES ($1, $2, 'Pg', 'Pay', $3) RETURNING id`,
    [orgId, email, "pg-pay-" + randomUUID()]
  );
  return row.rows[0].id;
}

async function cleanup(orgId, ref, clientIds) {
  await db.query(`DELETE FROM transactions WHERE org_id = $1 AND provider_ref = $2`, [orgId, ref]);
  for (const id of clientIds) {
    await db.query(`DELETE FROM clients WHERE id = $1`, [id]);
  }
}

test("real Postgres: failed then succeeded on same provider_ref upgrades atomically", { skip: !SCRATCH }, async () => {
  const orgId = await resolveDefaultOrg(db);
  const ref = "pg-fail-ok-" + randomUUID();
  const email = `pg-fail-ok+${randomUUID()}@example.invalid`;
  const clientId = await insertClient(orgId, email);
  const payload = {
    email,
    productName: "Consulting Services Deposit",
    amount: 3000,
    providerRef: ref,
    source: "commas",
    currency: "USD",
    paidAt: "2026-10-31T18:00:00.000Z"
  };

  try {
    await onPaymentFailed({ id: randomUUID(), orgId, name: "payment.failed", payload: { ...payload, paidAt: undefined } }, db);
    await onPaymentReceived({ id: randomUUID(), orgId, name: "payment.received", payload }, db);
    const tx = (await db.query(
      `SELECT status, client_id, raw_payload FROM transactions WHERE org_id = $1 AND provider_ref = $2`,
      [orgId, ref]
    )).rows;
    assert.equal(tx.length, 1);
    assert.equal(tx[0].status, "succeeded");
    assert.equal(String(tx[0].client_id), String(clientId));
    assert.equal(tx[0].raw_payload.provider_paid_at, "2026-10-31T18:00:00.000Z");
  } finally {
    await cleanup(orgId, ref, [clientId]);
  }
});

test("real Postgres: conflicting buyer on same provider_ref throws and leaves failed row", { skip: !SCRATCH }, async () => {
  const orgId = await resolveDefaultOrg(db);
  const ref = "pg-conflict-" + randomUUID();
  const firstId = await insertClient(orgId, `pg-first+${randomUUID()}@example.invalid`);
  const secondId = await insertClient(orgId, `pg-second+${randomUUID()}@example.invalid`);
  const firstEmail = (await db.query(`SELECT email FROM clients WHERE id = $1`, [firstId])).rows[0].email;
  const secondEmail = (await db.query(`SELECT email FROM clients WHERE id = $1`, [secondId])).rows[0].email;
  const base = {
    productName: "Consulting Services Deposit",
    amount: 3000,
    providerRef: ref,
    source: "commas",
    currency: "USD"
  };

  try {
    await onPaymentFailed({
      id: randomUUID(), orgId, name: "payment.failed",
      payload: { ...base, email: firstEmail }
    }, db);
    await assert.rejects(
      () => onPaymentReceived({
        id: randomUUID(), orgId, name: "payment.received",
        payload: { ...base, email: secondEmail }
      }, db),
      (err) => err instanceof PaymentProviderRefConflictError
    );
    const tx = (await db.query(
      `SELECT status, client_id FROM transactions WHERE org_id = $1 AND provider_ref = $2`,
      [orgId, ref]
    )).rows[0];
    assert.equal(tx.status, "failed");
    assert.equal(String(tx.client_id), String(firstId));
  } finally {
    await cleanup(orgId, ref, [firstId, secondId]);
  }
});

test("real Postgres: concurrent failed inserts on same provider_ref leave one row", { skip: !SCRATCH }, async () => {
  const orgId = await resolveDefaultOrg(db);
  const ref = "pg-race-" + randomUUID();
  const email = `pg-race+${randomUUID()}@example.invalid`;
  const clientId = await insertClient(orgId, email);
  const payload = {
    email,
    productName: "Consulting Services Deposit",
    amount: 3000,
    providerRef: ref,
    source: "commas",
    currency: "USD"
  };
  const event = () => ({
    id: randomUUID(),
    orgId,
    name: "payment.failed",
    payload
  });

  try {
    await Promise.all([
      onPaymentFailed(event(), db),
      onPaymentFailed(event(), db)
    ]);
    const tx = (await db.query(
      `SELECT count(*)::int AS n, max(status) AS status, max(client_id::text) AS client_id
         FROM transactions WHERE org_id = $1 AND provider_ref = $2`,
      [orgId, ref]
    )).rows[0];
    assert.equal(tx.n, 1);
    assert.equal(tx.status, "failed");
    assert.equal(tx.client_id, String(clientId));
  } finally {
    await cleanup(orgId, ref, [clientId]);
  }
});
