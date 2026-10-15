// Batch 17 practice test: the status lines under each processor on /app/money-connections.html
// (last sale or payout, event count, last synced, last sync error, the still-reading note).
//
// Three halves run together over fake rows: the server's own shaping of a saved connection row
// (publicConnection in src/merchant/store.mjs), the page's own render (public/app/money-connections.js,
// run whole in a vm), and (repair cycle 1) the server's own SELECT: listConnections runs the real
// SELECT_CONNECTION text, with its event count subquery, over stand-in rows (SQLite, real column names
// from db/migrations, fin-b17-sql-kit.mjs), so the count and the last sale time the page paints are judged
// as the database would hand them back, with another connection's, another client's and another
// company's events beside them. No browser, no database, no network.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

import { listConnections, publicConnection } from "../../../merchant/store.mjs";
import { proofRows } from "./fin-b17-kit.mjs";
import { makeStandIn, portableSql } from "./fin-b17-sql-kit.mjs";

const proof = proofRows(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const JS = fs.readFileSync(path.join(ROOT, "public/app/money-connections.js"), "utf8");
const FIXTURE = JSON.parse(fs.readFileSync(path.join(ROOT, "src/http/fixtures/money-connections.sample.json"), "utf8"));
const NOW = Date.parse("2026-10-06T12:00:00Z");

const sandbox = { window: {} };
vm.runInNewContext(JS, sandbox);
const M = sandbox.window.FHMoneyConnections;
const decode = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
const text = (html) => decode(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

/** One saved connection row, the shape SELECT_CONNECTION returns, run through the server's own public shape. */
function row(over = {}) {
  return {
    id: "c0000000-0000-4000-8000-000000000001", org_id: "o", client_id: "k", entity_id: "e1", provider: "whop", mode: "push",
    status: "active", api_key_hint: null, encrypted_webhook_secret: "enc", encrypted_api_key: null, sync_cursor: null,
    synced_through: null, last_synced_at: null, last_sync_error: null, last_event_at: null, disabled_at: null,
    created_at: "2026-09-01T00:00:00Z", entity_name: "Fundhub LLC", entity_kind: "business", event_count: 0, ...over,
  };
}
function page(rows) {
  const d = JSON.parse(JSON.stringify(FIXTURE));
  d.connections = rows.map((r) => publicConnection(r, { baseUrl: "https://app.example.test" }));
  d.__now = NOW;
  return d;
}
/** The text of one connection's block, up to its message line. */
function block(d, id) {
  const html = M.render(d, null);
  const at = html.indexOf(`data-conn="${id}"`);
  assert.ok(at >= 0, "the connection is on the page");
  const rest = html.slice(at);
  return text(rest.slice(0, rest.indexOf("act-msg")));
}

test("the status lines say the last sale or payout and the event count, singular and plural, from the saved row", async () => {
  await proof.check(/^Connection status lines/, async () => {
    const hours = (n) => new Date(NOW - n * 3600_000).toISOString();
    const many = row({ id: "c0000000-0000-4000-8000-000000000011", event_count: "3", last_event_at: hours(2) });
    const one = row({ id: "c0000000-0000-4000-8000-000000000012", event_count: "1", last_event_at: hours(30) });
    const none = row({ id: "c0000000-0000-4000-8000-000000000013", event_count: "0", last_event_at: null });
    const d = page([many, one, none]);
    assert.match(block(d, many.id), /Last sale or payout: 2h ago · 3 events/);
    assert.match(block(d, one.id), /Last sale or payout: Oct 4, 11:00 PM · 1 event(?!s)/, "a day old is a date (Arizona time), not 'hours ago'");
    assert.match(block(d, none.id), /Last sale or payout: never · 0 events/);
    // the exact time is on the line's title for a person who hovers
    assert.match(M.render(d, null), new RegExp(`title="${hours(2).replace(/[.]/g, "\\.")}">Last sale or payout`));
  });
});

test("a pull connection says when it last synced, that it is still reading, and the last error in words; a webhook one says none of that", async () => {
  await proof.check(/^Connection status lines/, async () => {
    const at = new Date(NOW - 3600_000).toISOString();
    const ok = row({ id: "c0000000-0000-4000-8000-000000000021", mode: "pull", encrypted_api_key: "enc", api_key_hint: "9f2c", encrypted_webhook_secret: null, last_synced_at: at, event_count: "4", last_event_at: at });
    const partway = row({ id: "c0000000-0000-4000-8000-000000000022", mode: "pull", encrypted_api_key: "enc", api_key_hint: "11aa", encrypted_webhook_secret: null, last_synced_at: at, sync_cursor: "page-7" });
    const failed = row({ id: "c0000000-0000-4000-8000-000000000023", mode: "pull", encrypted_api_key: "enc", api_key_hint: "22bb", encrypted_webhook_secret: null, last_synced_at: null, last_sync_error: "The processor did not accept this <b>API</b> key." });
    const off = row({ id: "c0000000-0000-4000-8000-000000000024", mode: "pull", status: "disabled", disabled_at: at, encrypted_api_key: "enc", api_key_hint: "33cc", encrypted_webhook_secret: null, last_synced_at: at, sync_cursor: "page-2", last_sync_error: "Old failure." });
    // a webhook connection whose row still carries sync words from before it was switched: none of them is shown
    const push = row({ id: "c0000000-0000-4000-8000-000000000025", mode: "push", sync_cursor: "stale", last_sync_error: "Stale failure.", last_synced_at: at });
    const d = page([ok, partway, failed, off, push]);

    const a = block(d, ok.id);
    assert.match(a, /Read with your API key ending in 9f2c · Last synced: 1h ago/);
    assert.doesNotMatch(a, /Still reading your history|Last sync did not finish/);

    const b = block(d, partway.id);
    assert.match(b, /Last synced: 1h ago/);
    assert.match(b, /Still reading your history\. The next sync picks up where this one stopped\./);

    const c = block(d, failed.id);
    assert.match(c, /Last synced: never/);
    assert.match(c, /Last sync did not finish: The processor did not accept this <b>API<\/b> key\./, "the error is painted as words, never as markup");
    assert.ok(!M.render(d, null).includes("<b>API</b>"), "the error text is escaped");

    const e = block(d, off.id);
    assert.match(e, /Turned off/);
    assert.match(e, /Last synced: 1h ago/);
    assert.match(e, /Last sync did not finish: Old failure\./);
    assert.doesNotMatch(e, /data-act="sync"|Sync now/, "a turned-off connection has no Sync now");

    const f = block(d, push.id);
    assert.doesNotMatch(f, /Last synced|Still reading your history|Last sync did not finish|Stale failure/);
    assert.match(f, /Last sale or payout: never · 0 events/);
  });
});

test("the server shapes the lines: event count is a number, partway is a flag, and a push row carries no sync words", async () => {
  await proof.check(/^Connection status lines/, async () => {
    const pull = publicConnection(row({ mode: "pull", encrypted_api_key: "enc", api_key_hint: "9f2c", sync_cursor: "page-3", last_sync_error: "boom", last_synced_at: "2026-10-06T11:00:00Z", event_count: "12", last_event_at: "2026-10-06T10:00:00Z" }));
    assert.equal(pull.event_count, 12);
    assert.equal(pull.sync_partway, true);
    assert.equal(pull.last_sync_error, "boom");
    assert.equal(pull.last_synced_at, "2026-10-06T11:00:00.000Z");
    assert.equal(pull.last_event_at, "2026-10-06T10:00:00.000Z");
    const finished = publicConnection(row({ mode: "pull", encrypted_api_key: "enc", sync_cursor: null }));
    assert.equal(finished.sync_partway, false);
    const push = publicConnection(row({ mode: "push", sync_cursor: "stale", last_sync_error: "Stale.", last_synced_at: "2026-10-06T11:00:00Z" }));
    assert.equal(push.sync_partway, null);
    assert.equal(push.last_sync_error, null);
    assert.equal(push.last_synced_at, null);
    assert.equal(publicConnection(row({ event_count: null })).event_count, 0, "no count saved is zero, not a blank");
  });
});

// ───────────────────────────── the real SELECT, over stand-in rows ─────────────────────────────

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "22222222-2222-4222-8222-222222222222";
const CLIENT = "33333333-3333-4333-8333-333333333333";
const OTHER_CLIENT = "44444444-4444-4444-8444-444444444444";

/** Rows in, what listConnections hands back for (ORG, CLIENT), run through the server's public shape. */
async function listed(rows) {
  const standIn = makeStandIn(["merchant_connections", "merchant_events", "entities"]);
  try {
    for (const [table, r] of rows) standIn.insert(table, r);
    const db = { async query(sql, params) { return { rows: standIn.db.prepare(portableSql(sql)).all(...params) }; } };
    const got = await listConnections(db, { orgId: ORG, clientId: CLIENT });
    return got.map((r) => publicConnection(r, { baseUrl: "https://app.example.test" }));
  } finally {
    standIn.close();
  }
}
const entity = (id, over = {}) => ["entities", { id, org_id: ORG, client_id: CLIENT, kind: "business", name: "Fundhub LLC", ...over }];
const connRow = (id, entityId, over = {}) => ["merchant_connections", {
  id, org_id: ORG, client_id: CLIENT, entity_id: entityId, provider: "whop", mode: "push", status: "active",
  encrypted_webhook_secret: "enc", last_event_at: null, created_at: "2026-09-01T00:00:00.000Z", ...over,
}];
let eventNo = 0;
const eventRow = (connectionId, at = "2026-10-05T10:00:00.000Z") => ["merchant_events", {
  id: `ev-${(eventNo += 1)}`, connection_id: connectionId, provider_event_id: `p-${eventNo}`, kind: "sale", amount_cents: 1000, occurred_at: at, received_at: at,
}];

test("the real SELECT counts each connection's own events and hands back each one's saved last sale time", async () => {
  await proof.check(/^Connection status lines/, async () => {
    const A = "a0000000-0000-4000-8000-00000000000a";
    const B = "b0000000-0000-4000-8000-00000000000b";
    const C = "c0000000-0000-4000-8000-00000000000c";
    const D = "d0000000-0000-4000-8000-00000000000d"; // another client's connection in this company
    const E = "e0000000-0000-4000-8000-00000000000e"; // another company's
    const got = await listed([
      entity("ent-1"), entity("ent-2", { kind: "personal", name: "Sam (personal)" }),
      entity("ent-d", { client_id: OTHER_CLIENT }), entity("ent-e", { org_id: OTHER_ORG, client_id: OTHER_CLIENT }),
      connRow(A, "ent-1", { last_event_at: "2026-10-05T10:00:00.000Z", created_at: "2026-09-01T00:00:00.000Z" }),
      connRow(B, "ent-2", { provider: "commas", last_event_at: "2026-10-04T08:30:00.000Z", created_at: "2026-09-02T00:00:00.000Z" }),
      connRow(C, "ent-1", { provider: "api", status: "waiting", encrypted_webhook_secret: null, created_at: "2026-09-03T00:00:00.000Z" }),
      connRow(D, "ent-d", { client_id: OTHER_CLIENT, last_event_at: "2026-10-09T00:00:00.000Z" }),
      connRow(E, "ent-e", { org_id: OTHER_ORG, client_id: OTHER_CLIENT, last_event_at: "2026-10-10T00:00:00.000Z" }),
      // three events on A, one on B, none on C, and many on connections that are not this client's
      eventRow(A, "2026-10-03T10:00:00.000Z"), eventRow(A, "2026-10-04T10:00:00.000Z"), eventRow(A, "2026-10-05T10:00:00.000Z"),
      eventRow(B, "2026-10-04T08:30:00.000Z"),
      eventRow(D), eventRow(D), eventRow(D), eventRow(D), eventRow(D), eventRow(E), eventRow(E),
    ]);
    // only this client's connections in this company, open ones first and then by when they were made
    assert.deepEqual(got.map((c) => c.id), [A, B, C]);
    assert.deepEqual(got.map((c) => c.event_count), [3, 1, 0], "each connection counts its own events and nobody else's");
    assert.deepEqual(got.map((c) => c.last_event_at), ["2026-10-05T10:00:00.000Z", "2026-10-04T08:30:00.000Z", null], "the saved last sale time, as saved");

    // and the page paints those same numbers under the right processor
    const d = page(got.map((c) => row({
      id: c.id, provider: c.provider, entity_name: c.entity_name, entity_kind: c.entity_kind, status: c.status,
      event_count: c.event_count, last_event_at: c.last_event_at, encrypted_webhook_secret: c.has_secret ? "enc" : null,
      api_key_hint: c.api_key_hint,
    })));
    assert.match(block(d, A), /Last sale or payout: .* · 3 events/);
    assert.match(block(d, B), /Last sale or payout: .* · 1 event(?!s)/);
    assert.match(block(d, C), /Last sale or payout: never · 0 events/);
  });
});

test("a turned-off connection sorts after a live one and each keeps its own count and time through the SELECT", async () => {
  await proof.check(/^Connection status lines/, async () => {
    const A = "a1000000-0000-4000-8000-0000000000a1";
    const B = "b1000000-0000-4000-8000-0000000000b1";
    const got = await listed([
      entity("ent-1"),
      connRow(A, "ent-1", { status: "disabled", disabled_at: "2026-10-06T00:00:00.000Z", last_event_at: "2026-10-05T10:00:00.000Z", created_at: "2026-09-01T00:00:00.000Z" }),
      connRow(B, "ent-1", { last_event_at: "2026-10-07T12:00:00.000Z", created_at: "2026-09-05T00:00:00.000Z" }),
      eventRow(A, "2026-10-05T10:00:00.000Z"), eventRow(B, "2026-10-07T12:00:00.000Z"), eventRow(B, "2026-10-07T11:00:00.000Z"),
    ]);
    // a turned-off connection sorts after the live one
    assert.deepEqual(got.map((c) => [c.id, c.status, c.event_count, c.last_event_at]), [
      [B, "active", 2, "2026-10-07T12:00:00.000Z"],
      [A, "disabled", 1, "2026-10-05T10:00:00.000Z"],
    ]);
  });
});

test("every listed row was exercised", () => {
  assert.equal(proof.rows.length, 1);
  proof.assertAllClaimed();
});
