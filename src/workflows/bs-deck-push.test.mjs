import { test } from "node:test";
import assert from "node:assert/strict";
import { sendDeckPush } from "./bs-deck-push.mjs";
import { APPROVED_URLS, buildPushPayload } from "../push/payload.mjs";

function fixture({ enabled = true, optedOut = false, booked = true, count = 0, paused = false } = {}) {
  const rows = [];
  const db = { async query(sql, params) {
    if (sql.includes("FROM messaging_settings")) {
      return { rows: [{ outbound_enabled: !paused }] };
    }
    if (sql.includes("custom_fields ->> 'marketing_push_enabled'")) {
      return { rows: [{ enabled: String(enabled) }] };
    }
    if (sql.includes("FROM opt_outs")) return { rows: optedOut ? [{ one: 1 }] : [] };
    if (sql.includes("FROM bookings")) return { rows: booked ? [{ one: 1 }] : [] };
    if (sql.includes("count(*)::int AS n")) return { rows: [{ n: count }] };
    if (sql.includes("INSERT INTO messages")) {
      if (rows.length) return { rows: [] };
      rows.push({ id: "push-1", params, status: "sending" });
      return { rows: [{ id: "push-1" }] };
    }
    if (sql.includes("UPDATE messages SET status")) {
      rows[0].status = params[1];
      return { rows: [] };
    }
    throw new Error("Unexpected query");
  } };
  return { db, rows };
}

const args = {
  orgId: "org-1", clientId: "client-1", eventId: "event-1",
  slug: "the-call", now: new Date("2026-11-10T18:00:00Z"),
  env: { MESSAGING_DRY_RUN: "off" }
};

test("lesson push uses a fixed safe body and a published deck path", async () => {
  const { db, rows } = fixture();
  const notifications = [];
  const opts = {
    ...args,
    sendNative: async (_db, target) => { notifications.push(target.notification); return { sent: 1 }; },
    sendWeb: async () => ({ sent: 0 })
  };
  const result = await sendDeckPush(db, opts);
  assert.equal(result.sent, true);
  assert.equal(rows[0].status, "sent");
  assert.equal(rows[0].params[3], "bs-deck-push:client-1:the-call");
  assert.deepEqual(notifications, [{ kind: "check_in", url: "/slideshows/the-call.html" }]);
  assert.ok(APPROVED_URLS.includes(notifications[0].url));
  assert.equal(JSON.parse(buildPushPayload(notifications[0])).url, notifications[0].url);
  assert.equal((await sendDeckPush(db, opts)).reason, "already_claimed");
});

for (const [name, values, reason] of [
  ["outbound paused", { paused: true }, "outbound_paused"],
  ["no permission", { enabled: false }, "push_not_enabled"],
  ["opted out", { optedOut: true }, "opted_out"],
  ["no future call", { booked: false }, "no_future_booking"],
  ["daily cap", { count: 1 }, "daily_push_cap"]
]) {
  test(`lesson push stays quiet with ${name}`, async () => {
    const { db, rows } = fixture(values);
    const result = await sendDeckPush(db, { ...args,
      sendNative: async () => { throw new Error("must not send"); },
      sendWeb: async () => { throw new Error("must not send"); }
    });
    assert.equal(result.reason, reason);
    assert.equal(rows.length, 0);
  });
}

test("dry-run and a bad deck slug cannot send", async () => {
  const { db, rows } = fixture();
  assert.equal((await sendDeckPush(db, { ...args, env: {} })).reason, "dry_run");
  assert.equal((await sendDeckPush(db, { ...args, slug: "../secret" })).reason, "invalid_slug");
  assert.equal(rows.length, 0);
});

test("provider failure is recorded without claiming delivery", async () => {
  const { db, rows } = fixture();
  const result = await sendDeckPush(db, { ...args,
    sendNative: async () => { throw new Error("offline"); },
    sendWeb: async () => ({ sent: 0 })
  });
  assert.equal(result.sent, false);
  assert.equal(rows[0].status, "failed");
});
