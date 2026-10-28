// Batch 16 practice test: the server half of "Send this one to". A typed destination goes on the ONE message
// and is never written back to the client's record.
//
// The saved result of a write-back cannot be seen afterwards (the live check skips a message whose address now
// equals the record, because by then the record has the typed address on it), and the page test only counts
// the requests the page makes. So this runs the real composeAndSend (src/messaging/compose.mjs, unchanged)
// with a database that records every statement, and judges the statements themselves:
//   - the typed address is on the message insert and is the destination of exactly that message,
//   - no statement writes to the clients table (or any table but the message and its thread),
//   - with nothing typed, the client's record answers and is only read.
// The dispatcher's claim finds nothing to send (the stand-in says the message is not claimable), so no provider
// is reached. No database, no network, nothing sent.

import assert from "node:assert/strict";
import test from "node:test";

import { composeAndSend } from "../../../messaging/compose.mjs";
import { proofRows } from "./fin-b16-kit.mjs";

const proof = proofRows(import.meta.url);

const ORG = "00000000-0000-4000-8000-0000000000ff";
const STAFF = "00000000-0000-4000-8000-000000000001";
const CLIENT = "11111111-1111-4111-8111-111111111111";
const CONVO = "3f1a2b3c-4d5e-4f60-8a9b-0c1d2e3f4a5b";
const ON_FILE_PHONE = "+15550100001";
const ON_FILE_EMAIL = "dana@example.com";

/** A database that answers just enough for one compose to reach the dispatcher, and keeps every statement. */
function recordingDb({ channel = "sms" } = {}) {
  const statements = [];
  return {
    statements,
    async query(sql, params = []) {
      statements.push({ sql: String(sql).replace(/\s+/g, " ").trim(), params });
      const text = String(sql);
      if (/FROM conversations cv\s+JOIN clients c ON c\.id = cv\.client_id AND c\.org_id = cv\.org_id/i.test(text)) return { rows: [{ id: CONVO, client_id: CLIENT, channel }] };
      if (/SELECT (phone|email) AS address FROM clients/i.test(text)) return { rows: [{ address: channel === "email" ? ON_FILE_EMAIL : ON_FILE_PHONE }] };
      if (/INSERT INTO messages/i.test(text)) return { rows: [{ id: "msg-1", created_at: "2026-10-14T12:00:00.000Z" }] };
      if (/FROM messages WHERE id = \$1/i.test(text)) return { rows: [{ id: "msg-1", conversation_id: CONVO, client_id: CLIENT, channel, direction: "outbound", status: "queued" }] };
      return { rows: [] };
    },
  };
}

const writesOf = (db) => db.statements.filter((s) => /^\s*(INSERT|UPDATE|DELETE|MERGE|TRUNCATE|ALTER|DROP)\b/i.test(s.sql));
const tablesWritten = (db) => writesOf(db).map((s) => {
  const m = /^\s*(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:ONLY\s+)?(?:public\.)?"?([a-z_]+)"?/i.exec(s.sql);
  return m ? m[1].toLowerCase() : `UNKNOWN: ${s.sql.slice(0, 60)}`;
});

test("a typed number goes on that one message and no statement writes to the clients table", async () => {
  await proof.check(/^'Send this one to' address box/, async () => {
    const db = recordingDb({ channel: "sms" });
    const typed = "+15550109999";
    const out = await composeAndSend(db, { orgId: ORG, staffId: STAFF, conversationId: CONVO, body: "hello", toAddress: typed });
    assert.equal(out.deduped, false);
    const inserts = writesOf(db).filter((s) => /^INSERT INTO messages/i.test(s.sql));
    assert.equal(inserts.length, 1, "one message row is written");
    assert.ok(inserts[0].params.includes(typed), "the typed number is the destination of the message");
    assert.ok(!inserts[0].params.includes(ON_FILE_PHONE), "and the number on file is not");
    assert.ok(!db.statements.some((s) => /FROM clients/i.test(s.sql)), "the record is not even asked when an address was typed");
    for (const table of tablesWritten(db)) {
      assert.ok(["messages", "conversations"].includes(table), `compose wrote to ${table}; it may write only the message and its thread`);
    }
    assert.ok(!db.statements.some((s) => /\bclients\b/i.test(s.sql) && /^\s*(INSERT|UPDATE|DELETE)/i.test(s.sql)), "nothing is written to clients");
    // The typed address is never carried into any statement except the message's own insert.
    const withTyped = db.statements.filter((s) => s.params.includes(typed));
    assert.deepEqual(withTyped.map((s) => s.sql.slice(0, 20)), ["INSERT INTO messages"], "the typed number rides on the message insert and nowhere else");
  });
});

test("a typed email goes on that one message, and the record is untouched", async () => {
  await proof.check(/^'Send this one to' address box/, async () => {
    const db = recordingDb({ channel: "email" });
    const typed = "other.person@example.com";
    await composeAndSend(db, { orgId: ORG, staffId: STAFF, conversationId: CONVO, body: "hello", toAddress: `  ${typed}  ` });
    const insert = writesOf(db).find((s) => /^INSERT INTO messages/i.test(s.sql));
    assert.ok(insert.params.includes(typed), "the typed email, trimmed, is the destination");
    assert.ok(!insert.params.includes(ON_FILE_EMAIL));
    for (const table of tablesWritten(db)) assert.notEqual(table, "clients");
    assert.deepEqual(db.statements.filter((s) => s.params.includes(typed)).length, 1);
  });
});

test("with nothing typed the client's record answers, and it is only read", async () => {
  await proof.check(/^'Send this one to' address box/, async () => {
    const db = recordingDb({ channel: "sms" });
    await composeAndSend(db, { orgId: ORG, staffId: STAFF, conversationId: CONVO, body: "hello" });
    const insert = writesOf(db).find((s) => /^INSERT INTO messages/i.test(s.sql));
    assert.ok(insert.params.includes(ON_FILE_PHONE), "the number on file is the destination");
    assert.ok(db.statements.some((s) => /SELECT phone AS address FROM clients/i.test(s.sql)), "the record was read");
    for (const table of tablesWritten(db)) assert.notEqual(table, "clients", "and only read");
  });
});

test("a typed destination that is not an address is refused before anything is written", async () => {
  await proof.check(/^'Send this one to' address box/, async () => {
    for (const [channel, bad] of [["sms", "555-0100"], ["sms", "5550109999"], ["email", "someone@"], ["email", "a b@c.com"]]) {
      const db = recordingDb({ channel });
      await assert.rejects(
        () => composeAndSend(db, { orgId: ORG, staffId: STAFF, conversationId: CONVO, body: "hi", toAddress: bad }),
        (err) => err && err.code === "BAD_REQUEST",
        `${channel}: ${bad}`,
      );
      assert.deepEqual(writesOf(db), [], `${channel}: nothing was written for ${bad}`);
    }
  });
});

test("every listed row was exercised", () => {
  proof.assertAllClaimed();
});
