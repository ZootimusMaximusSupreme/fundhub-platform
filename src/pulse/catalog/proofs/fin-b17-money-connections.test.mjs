// Batch 17 practice test: the status lines under each processor on /app/money-connections.html
// (last sale or payout, event count, last synced, last sync error, the still-reading note).
//
// Two halves run together over fake rows: the server's own shaping of a saved connection row
// (publicConnection in src/merchant/store.mjs) and the page's own render (public/app/money-connections.js,
// run whole in a vm). No browser, no database, no network.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

import { publicConnection } from "../../../merchant/store.mjs";
import { proofRows } from "./fin-b17-kit.mjs";

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

test("every listed row was exercised", () => {
  assert.equal(proof.rows.length, 1);
  proof.assertAllClaimed();
});
