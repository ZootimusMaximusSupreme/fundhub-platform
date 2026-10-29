// Buyer/UID ownership during reschedule, cancellation and no-show.
// Real disposable GitHub Actions PostgreSQL only: NEVER production Supabase.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import {
  onBookingCreated, onBookingRescheduled,
  onBookingCancelled, onBookingNoshow
} from "./comms.mjs";

const SCRATCH = (() => {
  if (process.env.CI !== "true" || !process.env.DATABASE_URL) return false;
  try {
    const u = new URL(process.env.DATABASE_URL);
    return ["127.0.0.1", "localhost"].includes(u.hostname) && u.pathname === "/fundhub_ci";
  } catch { return false; }
})();

test("cross-buyer UID cannot move or terminate the original client's booking, task or tags (disposable PG)",
  { skip: !SCRATCH }, async () => {
    const orgId = await resolveDefaultOrg(db);
    const identities = [];
    const uid = "ci-change-owner-" + randomUUID();
    const otherUid = "ci-change-other-" + randomUUID();
    const startA = "2026-11-18T20:00:00.000Z";
    const startB = "2026-11-18T21:00:00.000Z";
    try {
      for (const label of ["a", "b"]) {
        const email = `ci-booking-change+${label}-${randomUUID()}@example.invalid`;
        const r = await db.query(
          `INSERT INTO clients (org_id, first_name, last_name, email, ghl_contact_id)
           VALUES ($1, 'Synthetic', 'UIDOwner', $2, $3) RETURNING id`,
          [orgId, email, "ci-change-" + randomUUID()]
        );
        identities.push({ id: r.rows[0].id, email });
      }
      const [a, b] = identities;
      const booking = (who, providerUid, startsAt) => ({
        id: randomUUID(), name: "booking.created", orgId, clientId: who.id,
        payload: { email: who.email, bookingUid: providerUid, startTime: startsAt, source: "clickfunnels" }
      });
      await onBookingCreated(booking(a, uid, startA), db);
      await onBookingCreated(booking(b, otherUid, startB), db);
      const snapshot = async () => {
        const rows = await db.query(
          `SELECT client_id, provider_uid, status, starts_at
           FROM bookings WHERE org_id=$1 AND provider_uid = ANY($2::text[])
           ORDER BY provider_uid`, [orgId, [uid, otherUid]]
        );
        const tasks = await db.query(
          `SELECT client_id, body, done, due_at
           FROM tasks WHERE org_id=$1 AND client_id = ANY($2::uuid[])
             AND body = ANY($3::text[])
           ORDER BY body`, [orgId, identities.map(x => x.id), [uid, otherUid]]
        );
        const clients = await db.query(
          "SELECT id, tags, custom_fields FROM clients WHERE id = ANY($1::uuid[]) ORDER BY id",
          [identities.map(x => x.id)]
        );
        return { rows: rows.rows, tasks: tasks.rows, clients: clients.rows };
      };
      const baseline = await snapshot();
      assert.equal(baseline.rows.length, 2, "both initial bookings saved");
      assert.equal(baseline.tasks.length, 2, "both legitimate closer tasks saved");

      const event = (name) => ({
        id: randomUUID(), name, orgId, clientId: b.id,
        payload: { email: b.email, bookingUid: uid, startTime: "2026-11-19T20:00:00.000Z", source: "clickfunnels" }
      });
      for (const [name, handler] of [
        ["booking.rescheduled", onBookingRescheduled],
        ["booking.cancelled", onBookingCancelled],
        ["booking.noshow", onBookingNoshow]
      ]) {
        const result = await handler(event(name), db);
        assert.deepEqual(result, { skipped: "booking_client_mismatch" }, name);
        assert.deepEqual(await snapshot(), baseline,
          `${name}: no buyer's appointment, task, tag or confirmation changed`);
      }
      const legitimate = {
        ...event("booking.rescheduled"),
        clientId: a.id,
        payload: { email: a.email, bookingUid: uid,
          startTime: "2026-11-20T20:00:00.000Z", source: "clickfunnels" }
      };
      const accepted = await onBookingRescheduled(legitimate, db);
      assert.ok(!accepted?.skipped, "real owner may reschedule");
      const after = await snapshot();
      assert.equal(after.rows.find(x => x.provider_uid === uid)?.status, "rescheduled");
      assert.equal(after.rows.find(x => x.provider_uid === otherUid)?.status, "booked");
    } finally {
      if (identities.length) {
        const ids = identities.map(x => x.id);
        await db.query("DELETE FROM tasks WHERE client_id = ANY($1::uuid[])", [ids]);
        await db.query("DELETE FROM bookings WHERE org_id=$1 AND provider_uid = ANY($2::text[])", [orgId, [uid, otherUid]]);
        await db.query("DELETE FROM cards WHERE client_id = ANY($1::uuid[])", [ids]);
        await db.query("DELETE FROM clients WHERE id = ANY($1::uuid[])", [ids]);
      }
      await close();
    }
  }
);
