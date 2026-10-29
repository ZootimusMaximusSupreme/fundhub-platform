// Front-house tenant boundary: an event's clientId is not tenant authority.
// CI-only local disposable PostgreSQL, transaction rolled back. No provider sends.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { resolveClient } from "./client-lifecycle.mjs";

const SCRATCH = (() => {
  if (process.env.CI !== "true" || !process.env.DATABASE_URL) return false;
  try {
    const u = new URL(process.env.DATABASE_URL);
    return (u.hostname === "localhost" || u.hostname === "127.0.0.1")
      && u.pathname === "/fundhub_ci";
  } catch { return false; }
})();

test("foreign, unknown and no-org explicit client IDs cause zero contact writes",
  { skip: !SCRATCH }, async () => {
    const conn = await pool().connect();
    try {
      await conn.query("BEGIN");
      const orgId = await resolveDefaultOrg(conn);
      const email = `front-house+explicit-${randomUUID()}@example.invalid`;
      const inserted = await conn.query(
        `INSERT INTO clients (org_id, first_name, last_name, email, phone)
         VALUES ($1, 'Original', 'Owner', $2, '+15550001000') RETURNING id`,
        [orgId, email]
      );
      const clientId = inserted.rows[0].id;
      const makeEvent = (tenantId, id = clientId) => ({
        id: randomUUID(), name: "booking.created", orgId: tenantId, clientId: id,
        payload: {
          email, name: "Updated Buyer", phone: "(415) 555-0142",
          source: "clickfunnels", funnel: "apply-survey"
        }
      });
      const read = async () => (await conn.query(
        "SELECT first_name, last_name, phone FROM clients WHERE id = $1",
        [clientId]
      )).rows[0];

      assert.equal(await resolveClient(
        conn, makeEvent(randomUUID()), { skipCrmLink: true }
      ), null, "a foreign organization cannot select another tenant's buyer");
      assert.equal(await resolveClient(
        conn, makeEvent(null), { skipCrmLink: true }
      ), null, "an event without an organization cannot bypass tenant checks");
      assert.equal(await resolveClient(
        conn, makeEvent(orgId, randomUUID()), { skipCrmLink: true }
      ), null, "an unknown buyer cannot be treated as an accepted local customer");
      assert.deepEqual(await read(), {
        first_name: "Original", last_name: "Owner", phone: "+15550001000"
      }, "rejected event does not edit contact data");

      assert.equal(await resolveClient(
        conn, makeEvent(orgId), { skipCrmLink: true }
      ), clientId, "a valid, same-organization buyer still resolves");
      assert.deepEqual(await read(), {
        first_name: "Updated", last_name: "Buyer", phone: "+14155550142"
      }, "legitimate fresh booking still replaces stale contact fields");
    } finally {
      await conn.query("ROLLBACK").catch(() => {});
      conn.release();
      await close();
    }
  });
