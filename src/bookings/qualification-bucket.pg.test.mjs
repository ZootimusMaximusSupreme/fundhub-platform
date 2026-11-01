// A booking takes its client's funding call bucket once and keeps it (migration 508).
// Real, disposable CI PostgreSQL.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { pool, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { upsertBooking } from "./store.mjs";
import { stampQualificationBucket } from "../config/survey-qualification.mjs";
import { sweepCortanaBookingFeed } from "../workflows/cortana-booking-feed.mjs";

const SCRATCH = (() => {
  if (process.env.CI !== "true" || !process.env.DATABASE_URL) return false;
  try {
    const url = new URL(process.env.DATABASE_URL);
    return ["localhost", "127.0.0.1"].includes(url.hostname)
      && (url.pathname === "/fundhub_ci" || /^\/fundhub_ci_qual_[a-z0-9_]+$/.test(url.pathname));
  } catch { return false; }
})();

test("bookings keep the bucket their client had when booked (real Postgres)", {
  skip: !SCRATCH
}, async () => {
  const conn = await pool().connect();
  try {
    await conn.query("BEGIN");
    const orgId = await resolveDefaultOrg(conn);
    async function customer(label, fico, customerOrgId = orgId) {
      const row = await conn.query(
        `INSERT INTO clients (org_id, first_name, last_name, email, custom_fields)
         VALUES ($1, 'Bucket', $2, $3, $4::jsonb) RETURNING id`,
        [customerOrgId, label, `ci-bucket+${label}-${randomUUID()}@example.invalid`,
          JSON.stringify(fico ? { cf_svy_self_reported_fico: fico } : {})]
      );
      return row.rows[0].id;
    }
    const bucketOf = async (table, id) =>
      (await conn.query(`SELECT qualification_bucket FROM ${table} WHERE id = $1`, [id])).rows[0].qualification_bucket;
    const book = async (clientId, label, startsAt = new Date(Date.now() + 86400000).toISOString()) => (await upsertBooking(conn, {
      orgId, clientId, source: "ci-synthetic",
      providerUid: `ci-bucket-${label}-${randomUUID()}`,
      startsAt, status: "booked",
    })).id;

    // Survey first, then the booking: the booking copies the client's bucket.
    const high = await customer("high", "750+");
    assert.equal(await stampQualificationBucket(conn, high, orgId), "funding_qualified");
    assert.equal(await bucketOf("clients", high), "funding_qualified");
    const highBooking = await book(high, "high");
    assert.equal(await bucketOf("bookings", highBooking), "funding_qualified");

    // Provider first omits the time, then supplies it. The first valid time
    // copies the org-matched client bucket; a replay cannot replace it.
    const delayedUid = `ci-bucket-delayed-${randomUUID()}`;
    const noTime = await upsertBooking(conn, {
      orgId, clientId: high, source: "ci-synthetic", providerUid: delayedUid, status: "booked"
    });
    assert.equal(await bucketOf("bookings", noTime.id), null);
    const delayedStart = new Date(Date.now() + 86400000).toISOString();
    await upsertBooking(conn, { orgId, clientId: high, source: "ci-synthetic",
      providerUid: delayedUid, startsAt: delayedStart, status: "booked" });
    assert.equal(await bucketOf("bookings", noTime.id), "funding_qualified");

    // A later answer moves the client, never the call already booked.
    await conn.query(
      `UPDATE clients SET custom_fields = custom_fields || '{"cf_svy_self_reported_fico":"Not sure"}'::jsonb WHERE id = $1`,
      [high]
    );
    assert.equal(await stampQualificationBucket(conn, high, orgId), "funding_unqualified");
    assert.equal(await bucketOf("clients", high), "funding_unqualified");
    assert.equal(await bucketOf("bookings", highBooking), "funding_qualified");
    await upsertBooking(conn, { orgId, clientId: high, source: "ci-synthetic",
      providerUid: delayedUid, startsAt: delayedStart, status: "booked" });
    assert.equal(await bucketOf("bookings", noTime.id), "funding_qualified", "replayed booking keeps its first bucket");
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
    assert.equal(await stampQualificationBucket(conn, later, orgId), "funding_unqualified");
    assert.equal(await bucketOf("bookings", laterBooking), "funding_unqualified");

    // A past call without at-booking evidence stays unknown, including after
    // unrelated booking updates and a later client score.
    const historical = await customer("historical", null);
    const pastBooking = await book(historical, "past", new Date(Date.now() - 86400000).toISOString());
    await conn.query(`UPDATE clients SET custom_fields = '{"cf_svy_self_reported_fico":"760-850"}'::jsonb WHERE id = $1`, [historical]);
    assert.equal(await stampQualificationBucket(conn, historical, orgId), "funding_qualified");
    assert.equal(await bucketOf("bookings", pastBooking), null);
    await conn.query(`UPDATE bookings SET raw = '{"later_update":true}'::jsonb WHERE id = $1`, [pastBooking]);
    assert.equal(await bucketOf("bookings", pastBooking), null, "generic updates cannot stamp a past call");
    const delayedPastBooking = await book(historical, "delayed-past", new Date(Date.now() - 86400000).toISOString());
    assert.equal(await bucketOf("bookings", delayedPastBooking), null, "a delayed import cannot label an old call from today's score");

    // A booking with an org/client mismatch must never copy another org's score.
    const otherOrg = (await conn.query(`INSERT INTO orgs (slug, name) VALUES ($1, 'Other Bucket Test') RETURNING id`,
      [`ci-bucket-other-${randomUUID()}`])).rows[0].id;
    const otherClient = await customer("other-org", "760-850", otherOrg);
    assert.equal(await stampQualificationBucket(conn, otherClient, otherOrg), "funding_qualified");
    const wrongOrgBooking = (await conn.query(
      `INSERT INTO bookings (org_id, client_id, source, provider_uid, starts_at, status)
       VALUES ($1,$2,'ci-synthetic',$3,$4,'booked') RETURNING id`,
      [orgId, otherClient, `ci-bucket-wrong-org-${randomUUID()}`, new Date(Date.now() + 86400000).toISOString()]
    )).rows[0].id;
    assert.equal(await bucketOf("bookings", wrongOrgBooking), null);
    assert.equal(await stampQualificationBucket(conn, otherClient, orgId), null);
    assert.equal(await bucketOf("bookings", wrongOrgBooking), null);

    // The real feed claims, fails safely on a bucket write error, retries, and
    // sends exactly once with the saved bucket.
    const feedEnv = { CORTANA_FEED_ENABLED: "1",
      CORTANA_WEBHOOK_BOOKING_URL: "https://app.directroas.com/api/webhook/ci-synthetic",
      ADAPTERS_DRY_RUN: "1" };
    const feedClient = await customer("feed", "760-850");
    const feedBooking = await upsertBooking(conn, {
      orgId, clientId: feedClient, source: "clickfunnels",
      providerUid: `ci-feed-${randomUUID()}`, status: "booked",
      startsAt: new Date(Date.now() + 86400000).toISOString(),
      attendeeEmail: `buyer-${randomUUID()}@fundingmail.net`, attendeeName: "Buyer Person"
    });
    assert.equal(await bucketOf("bookings", feedBooking.id), null);
    let failOnce = true;
    const flaky = { query: async (sql, params) => {
      if (failOnce && sql.includes("UPDATE bookings b SET qualification_bucket")) {
        failOnce = false;
        throw Error("synthetic bucket write failure");
      }
      return conn.query(sql, params);
    } };
    const sent = [];
    const send = async (booking) => { sent.push(booking); return { ok: true }; };
    assert.equal((await sweepCortanaBookingFeed(flaky, { env: feedEnv, send })).failed, 1);
    assert.equal(sent.length, 0);
    assert.equal((await conn.query(`SELECT status FROM cortana_booking_sends WHERE booking_id = $1`,
      [feedBooking.id])).rows[0].status, "failed");
    assert.equal((await sweepCortanaBookingFeed(conn, { env: feedEnv, send })).sent, 1);
    assert.equal(sent[0].qualification_bucket, "funding_qualified");
    assert.equal((await sweepCortanaBookingFeed(conn, { env: feedEnv, send })).scanned, 0);
    assert.equal(sent.length, 1, "replay must not send a second conversion");

    // A no-time appointment cannot reach the feed; supplying the time copies
    // the first known bucket and makes it sendable.
    const noTimeUid = `ci-feed-no-time-${randomUUID()}`;
    const noTimeFeed = await upsertBooking(conn, { orgId, clientId: high,
      source: "clickfunnels", providerUid: noTimeUid, status: "booked",
      attendeeEmail: `buyer-${randomUUID()}@fundingmail.net`, attendeeName: "Buyer Person" });
    assert.equal(await bucketOf("bookings", noTimeFeed.id), null);
    assert.equal((await sweepCortanaBookingFeed(conn, { env: feedEnv, send })).scanned, 0);
    await upsertBooking(conn, { orgId, clientId: high, source: "clickfunnels",
      providerUid: noTimeUid, status: "booked", startsAt: new Date(Date.now() + 86400000).toISOString() });
    assert.equal(await bucketOf("bookings", noTimeFeed.id), "funding_unqualified");
    assert.equal((await sweepCortanaBookingFeed(conn, { env: feedEnv, send })).sent, 1);
    assert.equal(sent[1].qualification_bucket, "funding_unqualified");

    // If the first stamp fails and the call then ends, the feed cannot use
    // today's client score as historical at-booking evidence. An explicit
    // booking reconciliation makes exactly one later send possible.
    const lateClient = await customer("late-feed", "760-850");
    const lateFeed = await upsertBooking(conn, { orgId, clientId: lateClient,
      source: "clickfunnels", providerUid: `ci-feed-late-${randomUUID()}`,
      status: "booked", startsAt: new Date(Date.now() + 86400000).toISOString(),
      attendeeEmail: `buyer-${randomUUID()}@fundingmail.net`, attendeeName: "Buyer Person" });
    let lateFailOnce = true;
    const lateFlaky = { query: async (sql, params) => {
      if (lateFailOnce && sql.includes("UPDATE bookings b SET qualification_bucket")) {
        lateFailOnce = false;
        throw Error("synthetic late bucket write failure");
      }
      return conn.query(sql, params);
    } };
    assert.equal((await sweepCortanaBookingFeed(lateFlaky, { env: feedEnv, send })).failed, 1);
    await conn.query(`UPDATE bookings SET starts_at = $2, ends_at = $3 WHERE id = $1`,
      [lateFeed.id, new Date(Date.now() - 86400000).toISOString(),
        new Date(Date.now() - 82800000).toISOString()]);
    assert.equal(await bucketOf("bookings", lateFeed.id), null);
    assert.equal((await sweepCortanaBookingFeed(conn, { env: feedEnv, send })).failed, 1);
    assert.equal(sent.length, 2, "the ended call cannot send a guessed NULL bucket");
    assert.equal(await bucketOf("bookings", lateFeed.id), null, "the past call is not stamped from today's score");
    await conn.query(`UPDATE bookings SET qualification_bucket = 'funding_qualified' WHERE id = $1`, [lateFeed.id]);
    assert.equal((await sweepCortanaBookingFeed(conn, { env: feedEnv, send })).sent, 1);
    assert.equal(sent[2].qualification_bucket, "funding_qualified");
    assert.equal((await sweepCortanaBookingFeed(conn, { env: feedEnv, send })).scanned, 0);
    assert.equal(sent.length, 3);

    const wrongFeed = await upsertBooking(conn, { orgId, clientId: otherClient,
      source: "clickfunnels", providerUid: `ci-feed-wrong-org-${randomUUID()}`,
      status: "booked", startsAt: new Date(Date.now() + 86400000).toISOString(),
      attendeeEmail: `buyer-${randomUUID()}@fundingmail.net`, attendeeName: "Buyer Person" });
    assert.equal((await sweepCortanaBookingFeed(conn, { env: feedEnv, send })).failed, 1);
    assert.equal((await conn.query(`SELECT status FROM cortana_booking_sends WHERE booking_id = $1`,
      [wrongFeed.id])).rows[0].status, "failed");
    assert.equal(sent.length, 3, "an org mismatch is never sent");

    // Replay the migration's data backfill against existing bookings and saved answers.
    const cases = [
      ["current-high", { cf_svy_self_reported_fico: "700-759", cf_svy_has_negatives: "Yes" }, "funding_qualified"],
      ["legacy-high", { cf_svy_self_reported_fico: "750+" }, "funding_qualified"],
      ["setter-down", { cf_svy_self_reported_fico: "760-850", setter_survey_edits: { cf_svy_self_reported_fico: "620-699" } }, "funding_unqualified"],
      ["unreadable", { cf_svy_self_reported_fico: "88001" }, null]
    ];
    const ids = [];
    for (const [label, fields] of cases) {
      const row = await conn.query(
        `INSERT INTO clients (org_id, first_name, last_name, email, custom_fields)
         VALUES ($1, 'Bucket', $2, $3, $4::jsonb) RETURNING id`,
        [orgId, label, `ci-bucket+${label}-${randomUUID()}@example.invalid`, JSON.stringify(fields)]
      );
      ids.push(row.rows[0].id);
    }
    const migration = readFileSync(new URL("../../db/migrations/508_qualification_bucket.sql", import.meta.url), "utf8");
    const begin = migration.indexOf("WITH answers AS (");
    const end = migration.indexOf("-- Older bookings have no saved at-booking score.", begin);
    assert.ok(begin >= 0 && end > begin);
    await conn.query(migration.slice(begin, end));
    for (let i = 0; i < cases.length; i += 1) {
      assert.equal(await bucketOf("clients", ids[i]), cases[i][2], cases[i][0]);
    }
    assert.equal(await bucketOf("bookings", pastBooking), null, "migration replay does not backfill old calls");

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
