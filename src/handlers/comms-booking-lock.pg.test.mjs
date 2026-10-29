// Front-of-house concurrency + tenant proof on GitHub's disposable PostgreSQL.
// This fixture cannot create a client or make a provider call on live Supabase.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { onBookingCreated } from "./comms.mjs";

const SCRATCH = (() => {
  if (process.env.CI !== "true" || !process.env.DATABASE_URL) return false;
  try {
    const u = new URL(process.env.DATABASE_URL);
    return ["127.0.0.1", "localhost"].includes(u.hostname)
      && u.pathname === "/fundhub_ci";
  } catch { return false; }
})();

test("simultaneous booking.created webhooks keep one UID, buyer and closer task (real disposable PostgreSQL)",
  { skip: !SCRATCH }, async () => {
    const orgId = await resolveDefaultOrg(db);
    const uid = "ci-booking-owner-" + randomUUID();
    const startsAt = "2026-11-18T20:00:00Z";
    const clientIds = [];

    try {
      for (const suffix of ["first", "other"]) {
        const email = `ci-front-booking+${suffix}-${randomUUID()}@example.invalid`;
        const row = await db.query(
          `INSERT INTO clients (org_id, email, first_name, last_name, ghl_contact_id)
           VALUES ($1, $2, 'Synthetic', 'Booking', $3) RETURNING id`,
          [orgId, email, "ci-booking-" + randomUUID()]
        );
        clientIds.push({ id: row.rows[0].id, email });
      }

      // Both writers use independent pool connections inside the handler,
      // so PostgreSQL must serialize their (org, provider UID) identity check.
      const event = (client, n) => ({
        id: randomUUID(),
        orgId,
        clientId: client.id,
        name: "booking.created",
        payload: {
          email: client.email,
          source: "clickfunnels",
          bookingUid: uid,
          startTime: startsAt,
          eventTypeSlug: "strategy-session"
        }
      });
      const results = await Promise.all([
        onBookingCreated(event(clientIds[0], 1), db),
        onBookingCreated(event(clientIds[1], 2), db)
      ]);

      const bookingRows = await db.query(
        "SELECT client_id, status FROM bookings WHERE org_id = $1 AND provider_uid = $2",
        [orgId, uid]
      );
      assert.equal(bookingRows.rows.length, 1, "one booking for the provider UID");
      assert.equal(bookingRows.rows[0].status, "booked");
      const winner = bookingRows.rows[0].client_id;
      const loser = clientIds.find(c => c.id !== winner);
      assert.ok(clientIds.some(c => c.id === winner));
      assert.ok(loser, "two distinct synthetic buyers were tested");
      assert.equal(
        results.filter(r => r?.skipped === "booking_client_mismatch").length,
        1, "the losing buyer was refused after the winner committed"
      );

      const tasks = await db.query(
        `SELECT client_id, assignee_role, done FROM tasks
          WHERE org_id = $1 AND body = $2 AND client_id = ANY($3::uuid[])`,
        [orgId, uid, clientIds.map(c => c.id)]
      );
      assert.equal(tasks.rows.length, 1, "no task was made for the losing buyer");
      assert.equal(tasks.rows[0].client_id, winner);
      assert.equal(tasks.rows[0].assignee_role, "closer");
      assert.equal(tasks.rows[0].done, false);

      const clientRows = await db.query(
        "SELECT id, tags, custom_fields FROM clients WHERE id = ANY($1::uuid[])",
        [clientIds.map(c => c.id)]
      );
      const byId = new Map(clientRows.rows.map(r => [r.id, r]));
      assert.equal(byId.get(winner).custom_fields?.call_outcome, "booked");
      assert.ok(byId.get(winner).tags?.includes("call:booked"));
      assert.notEqual(byId.get(loser.id).custom_fields?.call_outcome, "booked");
      assert.equal(byId.get(loser.id).tags?.includes("call:booked") || false, false);
    } finally {
      // This is a disposable CI DB, but explicitly clean every synthetic root.
      if (clientIds.length) {
        const ids = clientIds.map(c => c.id);
        await db.query("DELETE FROM tasks WHERE client_id = ANY($1::uuid[])", [ids]);
        await db.query("DELETE FROM bookings WHERE org_id=$1 AND provider_uid=$2", [orgId, uid]);
        await db.query("DELETE FROM cards WHERE client_id = ANY($1::uuid[])", [ids]);
        await db.query("DELETE FROM clients WHERE id = ANY($1::uuid[])", [ids]);
      }
      await close();
    }
  }
);
