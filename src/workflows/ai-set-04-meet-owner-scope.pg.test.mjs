// Front-of-house reminder Meet-room ownership: disposable PostgreSQL only.
// Never invoke the real Calendar, SMS dispatcher, merchant, or production DB.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { meetingLinkFor, meetLinkFromHostCalendar } from "./ai-set-04-3way-handoff.mjs";

const SCRATCH = (() => {
  if (process.env.CI !== "true" || !process.env.DATABASE_URL) return false;
  try {
    const url = new URL(process.env.DATABASE_URL);
    return (url.hostname === "localhost" || url.hostname === "127.0.0.1")
      && url.pathname === "/fundhub_ci";
  } catch { return false; }
})();

const START = "2026-11-18T20:00:00.000Z";
const MEET_A = "https://meet.google.com/aaa-bbbb-ccc";
const MEET_B = "https://meet.google.com/ddd-eeee-fff";

test("3-way handoff never borrows a different buyer's Meet room or email (real disposable PostgreSQL)",
  { skip: !SCRATCH }, async () => {
    const orgId = await resolveDefaultOrg(db);
    const buyerIds = [];
    const bookingIds = [];
    try {
      const clients = [];
      for (const label of ["buyer-a", "buyer-b"]) {
        const email = `front-3way+${label}-${randomUUID()}@example.invalid`;
        const row = await db.query(
          `INSERT INTO clients (org_id, email, first_name, last_name)
           VALUES ($1, $2, 'Synthetic', 'Meeting') RETURNING id`,
          [orgId, email]
        );
        buyerIds.push(row.rows[0].id);
        clients.push({ id: row.rows[0].id, email });
      }
      const [buyerA, buyerB] = clients;
      const uidA = "ci-meet-a-" + randomUUID();
      const uidB = "ci-meet-b-" + randomUUID();
      for (const [buyer, uid, link] of [[buyerA, uidA, MEET_A], [buyerB, uidB, MEET_B]]) {
        const row = await db.query(
          `INSERT INTO bookings
             (org_id, client_id, source, provider_uid, starts_at, status, meeting_url)
           VALUES ($1, $2, 'ci-synthetic', $3, $4, 'booked', $5)
           RETURNING id`,
          [orgId, buyer.id, uid, START, link]
        );
        bookingIds.push(row.rows[0].id);
      }

      // The webhook has buyer A's verified identity but buyer B's UID.
      // The old OR-based query selected B's Meet URL at the exact same time.
      const noCalendar = async () => ({ ok: false, reason: "synthetic_no_calendar" });
      const mixed = await meetingLinkFor(db, {
        orgId, clientId: buyerA.id,
        payload: { email: buyerA.email, startTime: START, bookingUid: uidB },
        findLink: noCalendar
      });
      assert.deepEqual(mixed, { url: MEET_A, from: "booking_exact_call" },
        "a foreign booking UID must not override the resolved customer");

      // If A's call has no stored Meet, B's does not become A's fallback.
      await db.query("UPDATE bookings SET meeting_url = NULL WHERE id = $1", [bookingIds[0]]);
      const missing = await meetingLinkFor(db, {
        orgId, clientId: buyerA.id,
        payload: { email: buyerA.email, startTime: START, bookingUid: uidB },
        findLink: noCalendar
      });
      assert.equal(missing.from, "portal_sign_in");
      assert.notEqual(missing.url, MEET_B);

      // A calendar lookup may NOT read a foreign tenant's customer email.
      let observedEmail;
      const capture = async ({ email }) => {
        observedEmail = email;
        return { ok: false, reason: "synthetic_no_calendar" };
      };
      const foreign = await meetLinkFromHostCalendar(db, {
        orgId: randomUUID(), clientId: buyerA.id,
        payload: { startTime: START }, findLink: capture
      });
      assert.equal(foreign.ok, false);
      assert.equal(observedEmail, "", "wrong-tenant client email stays private");
      const owned = await meetLinkFromHostCalendar(db, {
        orgId, clientId: buyerA.id,
        payload: { startTime: START }, findLink: capture
      });
      assert.equal(owned.ok, false);
      assert.equal(observedEmail, buyerA.email, "matching tenant still resolves its actual customer");
    } finally {
      try {
        if (bookingIds.length) await db.query("DELETE FROM bookings WHERE id = ANY($1::uuid[])", [bookingIds]);
        if (buyerIds.length) await db.query("DELETE FROM clients WHERE id = ANY($1::uuid[])", [buyerIds]);
      } finally {
        await close();
      }
    }
  }
);
