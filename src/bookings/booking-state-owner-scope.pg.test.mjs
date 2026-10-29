// A sleeping booking reminder must never borrow another buyer's appointment
// state from a stale/colliding provider UID. Real, disposable CI PostgreSQL.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { bookingStateAt, upsertBooking, SLOT_STATE } from "./store.mjs";

const SCRATCH = (() => {
  if (process.env.CI !== "true" || !process.env.DATABASE_URL) return false;
  try {
    const url = new URL(process.env.DATABASE_URL);
    return ["localhost", "127.0.0.1"].includes(url.hostname)
      && url.pathname === "/fundhub_ci";
  } catch { return false; }
})();
const START = "2026-11-18T20:00:00.000Z";
const LATER = "2026-11-20T20:00:00.000Z";

test("booking slot status follows known customer, not another customer's UID (real Postgres)", {
  skip: !SCRATCH
}, async () => {
  const conn = await pool().connect();
  try {
    await conn.query("BEGIN");
    const orgId = await resolveDefaultOrg(conn);
    async function customer(label) {
      const row = await conn.query(
        `INSERT INTO clients (org_id, first_name, last_name, email)
         VALUES ($1, 'Slot', $2, $3) RETURNING id`,
        [orgId, label, `ci-booking-slot+${label}-${randomUUID()}@example.invalid`]
      );
      return row.rows[0].id;
    }
    const buyerA = await customer("buyer-a");
    const buyerB = await customer("buyer-b");
    const uidA = `ci-slot-a-${randomUUID()}`;
    const uidB = `ci-slot-b-${randomUUID()}`;

    // Buyer A cancelled at START; a stale UID must not suppress B's reminder.
    await upsertBooking(conn, {
      orgId, clientId: buyerA, source: "ci-synthetic",
      providerUid: uidA, startsAt: START, status: "cancelled",
    });
    assert.equal(await bookingStateAt(conn, {
      orgId, clientId: buyerB, bookingUid: uidA, startTime: START
    }), SLOT_STATE.UNKNOWN, "wrong UID must never borrow buyer A's cancellation");

    assert.equal(await bookingStateAt(conn, {
      orgId, clientId: buyerA, bookingUid: uidA, startTime: START
    }), SLOT_STATE.CANCELLED, "the appointment's true owner still sees cancellation");

    assert.equal(await bookingStateAt(conn, {
      orgId, bookingUid: uidA, startTime: START
    }), SLOT_STATE.CANCELLED, "UID-only status works when buyer is genuinely unknown");

    // A legitimate booking owned by B still wins despite a foreign stale UID.
    await upsertBooking(conn, {
      orgId, clientId: buyerB, source: "ci-synthetic",
      providerUid: uidB, startsAt: START, status: "booked",
    });
    assert.equal(await bookingStateAt(conn, {
      orgId, clientId: buyerB, bookingUid: uidA, startTime: START
    }), SLOT_STATE.ON, "buyer B sees only buyer B's live slot");

    // A moved slot has history; B must never inherit A's moved/active state.
    const uidMoved = `ci-slot-moved-${randomUUID()}`;
    await upsertBooking(conn, {
      orgId, clientId: buyerA, source: "ci-synthetic",
      providerUid: uidMoved, startsAt: START, status: "booked",
    });
    await upsertBooking(conn, {
      orgId, clientId: buyerA, source: "ci-synthetic",
      providerUid: uidMoved, startsAt: LATER, status: "rescheduled",
    });
    assert.equal(await bookingStateAt(conn, {
      orgId, clientId: buyerA, bookingUid: uidMoved, startTime: LATER
    }), SLOT_STATE.ON, "owner still sees new scheduled slot");
    assert.equal(await bookingStateAt(conn, {
      orgId, clientId: buyerB, bookingUid: uidMoved, startTime: LATER
    }), SLOT_STATE.UNKNOWN, "wrong buyer does not inherit an active moved slot");
  } finally {
    await conn.query("ROLLBACK").catch(() => {});
    conn.release();
    await close();
  }
});
