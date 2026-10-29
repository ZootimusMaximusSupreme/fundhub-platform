// Booking provider IDs must remain attached to the original customer even
// when webhooks arrive concurrently. Real SQL, disposable CI PostgreSQL only.
// Never run these synthetic writes against a remote/production Supabase URL.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { upsertBooking, findByProviderUid } from "./store.mjs";

const SCRATCH = (() => {
  if (process.env.CI !== "true" || !process.env.DATABASE_URL) return false;
  try {
    const u = new URL(process.env.DATABASE_URL);
    return (u.hostname === "localhost" || u.hostname === "127.0.0.1")
      && u.pathname === "/fundhub_ci";
  } catch { return false; }
})();

const FIRST = "2026-11-18T20:00:00.000Z";
const LATER = "2026-11-20T20:00:00.000Z";

async function client(conn, orgId, suffix) {
  const email = `ci-booking-atomic+${suffix}-${randomUUID()}@example.invalid`;
  const r = await conn.query(
    `INSERT INTO clients (org_id, email, first_name, last_name)
     VALUES ($1,$2,'Atomic','Booking') RETURNING id`,
    [orgId, email]
  );
  return r.rows[0].id;
}

function event({ orgId, clientId, uid, status = "booked", startsAt = FIRST }) {
  return {
    orgId, clientId, providerUid: uid, source: "ci-synthetic",
    startsAt, status, attendeeEmail: "example@example.invalid",
  };
}

test("same UID cannot reassign buyer or rewind a reschedule/cancellation (real PG)", { skip: !SCRATCH }, async () => {
  const conn = await pool().connect();
  try {
    await conn.query("BEGIN");
    const orgId = await resolveDefaultOrg(conn);
    const a = await client(conn, orgId, "original");
    const b = await client(conn, orgId, "other");
    const uid = `ci-booking-atomic-${randomUUID()}`;

    const booked = await upsertBooking(conn, event({ orgId, clientId: a, uid }));
    assert.ok(booked?.id, "initial appointment is saved");
    const stolen = await upsertBooking(conn, event({ orgId, clientId: b, uid, startsAt: LATER }));
    assert.equal(stolen, null, "a different buyer may not claim an existing provider UID");

    const original = await findByProviderUid(conn, { orgId, providerUid: uid });
    assert.equal(original.client_id, a);
    assert.equal(new Date(original.starts_at).toISOString(), FIRST);

    const moved = await upsertBooking(conn, event({
      orgId, clientId: a, uid, status: "rescheduled", startsAt: LATER,
    }));
    assert.equal(moved.id, booked.id);
    const staleAfterMove = await upsertBooking(conn, event({ orgId, clientId: a, uid }));
    assert.equal(staleAfterMove, null, "old booking.created may not reset a reschedule");
    const afterMove = await findByProviderUid(conn, { orgId, providerUid: uid });
    assert.equal(afterMove.status, "rescheduled");
    assert.equal(new Date(afterMove.starts_at).toISOString(), LATER);

    const cancelled = await upsertBooking(conn, event({
      orgId, clientId: a, uid, status: "cancelled", startsAt: LATER,
    }));
    assert.equal(cancelled.status, "cancelled");
    assert.equal(await upsertBooking(conn, event({ orgId, clientId: a, uid })), null);
    const terminal = await findByProviderUid(conn, { orgId, providerUid: uid });
    assert.equal(terminal.status, "cancelled");
    assert.equal(terminal.client_id, a);

    const otherUid = await upsertBooking(conn, event({
      orgId, clientId: a, uid: `ci-rebook-${randomUUID()}`, startsAt: LATER,
    }));
    assert.ok(otherUid?.id, "a genuine new provider UID is still bookable");
  } finally {
    await conn.query("ROLLBACK").catch(() => {});
    conn.release();
    await close();
  }
});

test("simultaneous conflicting provider-UID writers cannot change the accepted buyer (real PG)", { skip: !SCRATCH }, async () => {
  // Independent pool connections are necessary to exercise the real SQL
  // ON CONFLICT row lock; a single transaction would only test a replay.
  const db = { query: (...args) => pool().query(...args) };
  const orgId = await resolveDefaultOrg(db);
  const a = await client(db, orgId, "parallel-a");
  const b = await client(db, orgId, "parallel-b");
  const uid = `ci-parallel-booking-${randomUUID()}`;
  try {
    const answers = await Promise.all([
      upsertBooking(db, event({ orgId, clientId: a, uid })),
      upsertBooking(db, event({ orgId, clientId: b, uid, startsAt: LATER })),
    ]);
    assert.equal(answers.filter(Boolean).length, 1, "only one conflicting writer wins");
    const winner = (await findByProviderUid(db, { orgId, providerUid: uid })).client_id;
    assert.ok(winner === a || winner === b);
    const loser = winner === a ? b : a;

    const replay = await upsertBooking(db, event({ orgId, clientId: loser, uid }));
    assert.equal(replay, null);
    const after = await findByProviderUid(db, { orgId, providerUid: uid });
    assert.equal(after.client_id, winner, "concurrent insert cannot reassign existing booking");
  } finally {
    await db.query("DELETE FROM bookings WHERE org_id=$1 AND provider_uid=$2", [orgId, uid]).catch(() => {});
    await db.query("DELETE FROM clients WHERE id=ANY($1::uuid[])", [[a, b]]).catch(() => {});
    await close();
  }
});
