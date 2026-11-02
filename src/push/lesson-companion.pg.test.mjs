import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { notificationForSentMessage, claimMarketingPush, recordMarketingPush } from "./message-policy.mjs";
import { NATIVE_PUSH_OWNERS_SQL } from "../pulse/coverage/gap-native-push.mjs";

const dsn = process.env.DATABASE_URL;
const scratch = (() => {
  try {
    const url = new URL(dsn);
    return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname)
      && /(?:scratch|test|ci)/i.test(url.pathname);
  } catch { return false; }
})();

test("lesson push uses the current booking and persisted device results on scratch Postgres", {
  skip: scratch ? false : "A local scratch DATABASE_URL is required; no database proof ran."
}, async () => {
  const db = new pg.Client({ connectionString: dsn });
  await db.connect();
  try {
    // TEMP tables shadow the application tables only for this connection.
    await db.query(`
      CREATE TEMP TABLE precall_send_plans(id text,org_id text,client_id text,deck_slug text,status text);
      CREATE TEMP TABLE clients (id text, org_id text, custom_fields jsonb);
      CREATE TEMP TABLE opt_outs (client_id text, org_id text, channel text, opted_in_at timestamptz);
      CREATE TEMP TABLE events (id text, client_id text, name text, payload jsonb, created_at timestamptz);
      CREATE TEMP TABLE bookings (org_id text, client_id text, status text, starts_at timestamptz,
        created_at timestamptz, updated_at timestamptz, raw jsonb);
      CREATE TEMP TABLE messages (id text DEFAULT md5(random()::text), org_id text, client_id text,
        direction text, channel text, template_key text, rendered_body text, provider_ref text,
        status text, compliance_check_passed boolean, provider text, last_error text,
        updated_at timestamptz DEFAULT now());
      CREATE UNIQUE INDEX lesson_push_ref ON messages (org_id, provider_ref) WHERE provider_ref IS NOT NULL;
      CREATE TEMP TABLE client_apns_devices (id text, account_id text, client_id text, session_id text,
        org_id text, failure_count int, updated_at timestamptz, expired_at timestamptz, revoked_at timestamptz);
      CREATE TEMP TABLE accounts (id text, kind text, status text, org_id text, client_id text);
      CREATE TEMP TABLE account_sessions (id text, account_id text, org_id text, active_client_id text);
      INSERT INTO clients VALUES ('client-1', 'org-1', '{"marketing_push_enabled":true}');
    `);
    const now = new Date();
    now.setUTCHours(17, 0, 0, 0); // 10 a.m. Arizona.
    const source = { id: "source-1", org_id: "org-1", client_id: "client-1", channel: "email",
      template_key: "EMAIL-BS-DECK-LESSON",
      provider_ref: "workflow:EMAIL-BS-DECK-LESSON:bs-deck:client-1:the-call" };
    await db.query(`INSERT INTO bookings VALUES ('org-1','client-1','booked',
      $1::timestamptz + interval '78 hours', $1::timestamptz - interval '1 hour',
      $1::timestamptz - interval '1 hour', '{"__event_id":"booking-1"}')`, [now.toISOString()]);
    await db.query(`INSERT INTO events VALUES
        ('booking-1','client-1','booking.created','{}', $1::timestamptz - interval '1 hour'),
        ('old-call','client-1','call.completed','{"outcome":"showed"}', $1::timestamptz - interval '2 hours'),
        ('no-show','client-1','call.completed','{"outcome":"no_show"}', $1::timestamptz - interval '30 minutes')`,
    [now.toISOString()]);
    const planId='11111111-1111-4111-8111-111111111111';
    await db.query("INSERT INTO precall_send_plans VALUES($1,'org-1','client-1','the-call','queued')",[planId]);
    const planned={...source,provider_ref:`workflow:EMAIL-BS-DECK-LESSON:precall-plan:${planId}`,rendered_body:'https://fundhub.ai/slideshows/the-call.html'};
    assert.deepEqual(await notificationForSentMessage(db,planned,{now}),{kind:'check_in',url:'/slideshows/the-call.html'});
    assert.equal(await notificationForSentMessage(db,{...planned,org_id:'foreign'},{now}),null);
    await db.query("UPDATE precall_send_plans SET status='cancelled'");
    assert.equal(await notificationForSentMessage(db,planned,{now}),null);
    const notification = await notificationForSentMessage(db, source, { now });
    assert.deepEqual(notification, { kind: "check_in", url: "/slideshows/the-call.html" },
      "a previous call/no-show and a lesson 78 hours before this booking do not suppress it");

    await db.query(`INSERT INTO events VALUES ('held-now','client-1','call.completed',
      '{"outcome":"showed"}', $1::timestamptz - interval '15 minutes')`, [now.toISOString()]);
    assert.equal(await notificationForSentMessage(db, source, { now }), null);
    await db.query("DELETE FROM events WHERE id = 'held-now'");
    await db.query("UPDATE bookings SET status = 'cancelled'");
    assert.equal(await notificationForSentMessage(db, source, { now }), null);
    await db.query("UPDATE bookings SET status = 'booked'");

    const claims = await Promise.all([claimMarketingPush(db, source, notification, { now }),
      claimMarketingPush(db, { ...source, id: "source-2" }, notification, { now })]);
    assert.equal(claims.filter(Boolean).length, 1, "one persisted daily claim wins");
    const id = claims.find(Boolean);
    await db.query("UPDATE messages SET updated_at = now() - interval '16 minutes' WHERE id = $1", [id]);
    assert.equal((await db.query(NATIVE_PUSH_OWNERS_SQL)).rows[0].recent_failed, 1,
      "an interrupted attempt becomes a read-only alert instead of an automatic duplicate send");
    for (const result of [{status:"rejected",reason:new Error("timeout after possible acceptance")},
      {status:"fulfilled",value:undefined},{status:"fulfilled",value:{sent:0,unknown:1}}]) {
      await recordMarketingPush(db,id,[result]);
      assert.equal((await db.query("SELECT status FROM messages WHERE id=$1",[id])).rows[0].status,"sending");
      assert.equal(await claimMarketingPush(db,source,notification,{now}),null,"an unknown attempt cannot be automatically reclaimed");
    }
    await recordMarketingPush(db, id, [{ status: "fulfilled", value: { sent: 0 } }]);
    assert.equal((await db.query(NATIVE_PUSH_OWNERS_SQL)).rows[0].recent_failed, 0);
    assert.equal((await db.query("SELECT status FROM messages WHERE id = $1", [id])).rows[0].status, "failed");
    assert.equal(await claimMarketingPush(db, source, notification, { now }), id,
      "no device accepted the alert, so the failed claim can be reclaimed");
    await recordMarketingPush(db, id, [{ status: "fulfilled", value: { sent: 1 } }]);
    assert.equal(await claimMarketingPush(db, source, notification, { now }), null,
      "a sent or in-flight claim prevents another push inside 24 hours");

    await db.query("UPDATE messages SET updated_at = $1::timestamptz - interval '25 hours'", [now.toISOString()]);
    await db.query(`INSERT INTO messages (org_id,client_id,channel,status,updated_at) VALUES
      ('org-1','client-1','push','sent',$1::timestamptz - interval '2 days'),
      ('org-1','client-1','push','sent',$1::timestamptz - interval '3 days')`, [now.toISOString()]);
    assert.equal(await notificationForSentMessage(db, source, { now }), null, "three sent pushes use the weekly cap");
    assert.equal(await claimMarketingPush(db, source, notification, { now }), null);
  } finally { await db.end(); }
});
