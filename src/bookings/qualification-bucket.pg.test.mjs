// A booking takes its client's funding call bucket once and keeps it (migration 508).
// Real, disposable CI PostgreSQL.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { upsertBooking } from "./store.mjs";
import { stampQualificationBucket } from "../config/survey-qualification.mjs";

const SCRATCH = (() => {
  if (process.env.CI !== "true" || !process.env.DATABASE_URL) return false;
  try {
    const url = new URL(process.env.DATABASE_URL);
    return ["localhost", "127.0.0.1"].includes(url.hostname)
      && url.pathname === "/fundhub_ci";
  } catch { return false; }
})();

test("bookings keep the bucket their client had when booked (real Postgres)", {
  skip: !SCRATCH
}, async () => {
  const conn = await pool().connect();
  try {
    await conn.query("BEGIN");
    const orgId = await resolveDefaultOrg(conn);
    async function customer(label, fico) {
      const row = await conn.query(
        `INSERT INTO clients (org_id, first_name, last_name, email, custom_fields)
         VALUES ($1, 'Bucket', $2, $3, $4::jsonb) RETURNING id`,
        [orgId, label, `ci-bucket+${label}-${randomUUID()}@example.invalid`,
          JSON.stringify(fico ? { cf_svy_self_reported_fico: fico } : {})]
      );
      return row.rows[0].id;
    }
    const bucketOf = async (table, id) =>
      (await conn.query(`SELECT qualification_bucket FROM ${table} WHERE id = $1`, [id])).rows[0].qualification_bucket;
    const book = async (clientId, label) => (await upsertBooking(conn, {
      orgId, clientId, source: "ci-synthetic",
      providerUid: `ci-bucket-${label}-${randomUUID()}`,
      startsAt: "2026-11-18T20:00:00.000Z", status: "booked",
    })).id;

    // Survey first, then the booking: the booking copies the client's bucket.
    const high = await customer("high", "750+");
    assert.equal(await stampQualificationBucket(conn, high), "funding_qualified");
    assert.equal(await bucketOf("clients", high), "funding_qualified");
    const highBooking = await book(high, "high");
    assert.equal(await bucketOf("bookings", highBooking), "funding_qualified");

    // A later answer moves the client, never the call already booked.
    await conn.query(
      `UPDATE clients SET custom_fields = custom_fields || '{"cf_svy_self_reported_fico":"Not sure"}'::jsonb WHERE id = $1`,
      [high]
    );
    assert.equal(await stampQualificationBucket(conn, high), "funding_unqualified");
    assert.equal(await bucketOf("clients", high), "funding_unqualified");
    assert.equal(await bucketOf("bookings", highBooking), "funding_qualified");
    await conn.query(`UPDATE bookings SET qualification_bucket = 'funding_unqualified' WHERE id = $1`, [highBooking]);
    assert.equal(await bucketOf("bookings", highBooking), "funding_qualified", "the trigger keeps the first bucket");

    // Booking first, survey after: the stamp fills the empty booking.
    const later = await customer("later", null);
    const laterBooking = await book(later, "later");
    assert.equal(await bucketOf("bookings", laterBooking), null, "no score yet is unknown, not guessed");
    await conn.query(
      `UPDATE clients SET custom_fields = custom_fields || '{"cf_svy_self_reported_fico":"580-649"}'::jsonb WHERE id = $1`,
      [later]
    );
    assert.equal(await stampQualificationBucket(conn, later), "funding_unqualified");
    assert.equal(await bucketOf("bookings", laterBooking), "funding_unqualified");

    // Only the two values are allowed.
    await conn.query("SAVEPOINT bad_value");
    await assert.rejects(
      conn.query(`UPDATE clients SET qualification_bucket = 'qualified' WHERE id = $1`, [later]),
      /qualification_bucket_check/
    );
    await conn.query("ROLLBACK TO SAVEPOINT bad_value");
  } finally {
    await conn.query("ROLLBACK").catch(() => {});
    conn.release();
    await close();
  }
});
