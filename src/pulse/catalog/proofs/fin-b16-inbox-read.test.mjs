// Batch 16 practice test: the server half of the staff inbox's "Needs reply" tab.
//
// The tab asks GET /api/read/inbox?needs_reply=1 and paints the answer, so the page test
// (fin-b16-messaging.test.mjs) can only show that it asks and paints. WHICH threads the server calls "owed a
// reply" is api/read/inbox.mjs. This file runs that real handler (its own SQL text, unchanged) over stand-in
// rows with the real column names, and checks the answer: a thread is owed a reply exactly when the newest
// message on it came from the client; a thread with no messages is owed nothing (null, not true); another
// company's threads are never in the answer; and the filter, not the browser, drops the answered ones.
//
// SQLite stands in for Postgres (there is none on this Mac). The kit spells the Postgres text for SQLite, and
// the one thing SQLite cannot run, the `LEFT JOIN LATERAL ... LIMIT 1` "newest message" join, is turned into
// the same question asked with a window function (rewriteLateral below, with its own test). Everything else is
// the handler's own text: change the direction word, the filter, the org binding or the sort and a test here
// goes red. No database, no network, nothing live.

import assert from "node:assert/strict";
import test from "node:test";

import { run } from "../../../../api/read/inbox.mjs";
import { makeStandIn, portableSql } from "./fin-b16-sql-kit.mjs";
import { proofRows } from "./fin-b16-kit.mjs";

const proof = proofRows(import.meta.url);

const ORG = "00000000-0000-4000-8000-0000000000ff";
const OTHER_ORG = "00000000-0000-4000-8000-0000000000ee";
const T = (minutesAgo) => new Date(Date.parse("2026-10-14T12:00:00.000Z") - minutesAgo * 60_000).toISOString();

/** The one LATERAL shape the inbox uses, spelled as a window function. Throws on any other shape. */
export function rewriteLateral(sql) {
  const shape = /LEFT\s+JOIN\s+LATERAL\s*\(\s*SELECT\s+([\s\S]*?)\s+FROM\s+(\w+)\s+(\w+)\s+WHERE\s+\3\.(\w+)\s*=\s*(\w+)\.(\w+)\s+ORDER\s+BY\s+([\s\S]*?)\s+LIMIT\s+1\s*\)\s*(\w+)\s+ON\s+true/i;
  const m = shape.exec(sql);
  if (!m) throw new Error("the inbox's newest-message join is not the shape this stand-in can run");
  const [whole, cols, table, alias, fk, outerAlias, outerCol, order, name] = m;
  const out = `LEFT JOIN (SELECT ${cols}, ${alias}.${fk} AS __k FROM (SELECT ${alias}.*, ROW_NUMBER() OVER (PARTITION BY ${alias}.${fk} ORDER BY ${order}) AS __rn FROM ${table} ${alias}) ${alias} WHERE ${alias}.__rn = 1) ${name} ON ${name}.__k = ${outerAlias}.${outerCol}`;
  return sql.replace(whole, out);
}

function fixture() {
  const standIn = makeStandIn(["conversations", "messages", "clients"]);
  const client = (id, org, first) => standIn.insert("clients", { id, org_id: org, first_name: first, last_name: "Test" });
  const convo = (id, org, clientId, channel, pulse) => standIn.insert("conversations", { id, org_id: org, client_id: clientId, channel, last_pulse_at: pulse, created_at: pulse || T(600) });
  const msg = (id, org, clientId, convoId, direction, body, at) => standIn.insert("messages", {
    id, org_id: org, client_id: clientId, conversation_id: convoId, direction, channel: "sms", rendered_body: body, status: "sent", created_at: at,
  });
  client("cl-answered", ORG, "Answered"); client("cl-waiting", ORG, "Waiting"); client("cl-empty", ORG, "Empty");
  client("cl-twice", ORG, "Twice"); client("cl-other", OTHER_ORG, "Foreign");

  // 1. Answered: the client spoke, then we did. The staff reply is the newest message.
  convo("c-answered", ORG, "cl-answered", "sms", T(60));
  msg("m-a1", ORG, "cl-answered", "c-answered", "inbound", "hello?", T(180));
  msg("m-a2", ORG, "cl-answered", "c-answered", "outbound", "hi, here now", T(60));
  // 2. Waiting: the client spoke last, ten minutes ago.
  convo("c-waiting", ORG, "cl-waiting", "sms", T(10));
  msg("m-w1", ORG, "cl-waiting", "c-waiting", "inbound", "any update on my file?", T(10));
  // 3. Nothing said yet: a thread with no messages.
  convo("c-empty", ORG, "cl-empty", "email", null);
  // 4. Waiting again after an answer: the newest message is inbound although it was written first in the table.
  convo("c-twice", ORG, "cl-twice", "email", T(30));
  msg("m-t2", ORG, "cl-twice", "c-twice", "inbound", "one more thing", T(30));
  msg("m-t1", ORG, "cl-twice", "c-twice", "outbound", "we answered earlier", T(90));
  // 5. Another company's waiting thread. Never in this company's answer.
  convo("c-other", OTHER_ORG, "cl-other", "sms", T(5));
  msg("m-o1", OTHER_ORG, "cl-other", "c-other", "inbound", "another company's client", T(5));
  return standIn;
}

/** The real handler, with its SQL run over the stand-in and each call recorded. */
async function drive(query = {}, { orgId = ORG } = {}) {
  const standIn = fixture();
  const calls = [];
  const fake = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      const text = rewriteLateral(portableSql(sql.replace(/--[^\n]*/g, "")));
      const bound = params.map((p) => (p === true ? 1 : p === false ? 0 : p));
      const rows = standIn.db.prepare(text).all(...bound).map((r) => ({
        ...r, needs_reply: r.needs_reply === null || r.needs_reply === undefined ? null : Boolean(r.needs_reply),
      }));
      return { rows };
    },
  };
  const out = { code: null, body: null };
  const res = { status: (c) => { out.code = c; return res; }, json: (b) => { out.body = b; return res; } };
  const staff = async () => ({ id: "00000000-0000-4000-8000-000000000001", role: "closer", org_id: orgId, email: "x@example.com", name: "X", status: "active" });
  try {
    await run({ method: "GET", query, headers: {} }, res, { db: fake, requireAuth: staff });
  } finally {
    standIn.close();
  }
  return { ...out, calls };
}

const ids = (body) => body.items.map((r) => r.id);

test("rewriteLateral turns the inbox's newest-message join into a window function, and refuses any other shape", () => {
  const original = `SELECT 1 FROM page LEFT JOIN LATERAL (
    SELECT m.id, m.direction FROM messages m WHERE m.conversation_id = page.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1
  ) last ON true`;
  const out = rewriteLateral(original);
  assert.ok(!/LATERAL/i.test(out));
  assert.match(out, /ROW_NUMBER\(\) OVER \(PARTITION BY m\.conversation_id ORDER BY m\.created_at DESC, m\.id DESC\)/);
  assert.match(out, /ON last\.__k = page\.id/);
  assert.throws(() => rewriteLateral("SELECT 1 FROM page LEFT JOIN LATERAL (SELECT 1) last ON true"), /not the shape/);
});

test("the inbox with no filter lists this company's threads, newest first, each with who spoke last", { timeout: 60_000 }, async () => {
  await proof.check(/^Tab: Needs reply \(client spoke last/, async () => {
    const { code, body } = await drive();
    assert.equal(code, 200);
    assert.deepEqual(ids(body), ["c-waiting", "c-twice", "c-answered", "c-empty"], "this company's threads only, newest activity first");
    const byId = Object.fromEntries(body.items.map((r) => [r.id, r]));
    assert.equal(byId["c-waiting"].needs_reply, true);
    assert.equal(byId["c-waiting"].last_direction, "inbound");
    assert.equal(byId["c-waiting"].last_body, "any update on my file?");
    assert.equal(byId["c-twice"].needs_reply, true, "the newest message decides, not the order rows were written");
    assert.equal(byId["c-twice"].last_body, "one more thing");
    assert.equal(byId["c-answered"].needs_reply, false, "a staff reply clears it");
    assert.equal(byId["c-answered"].last_direction, "outbound");
    assert.equal(byId["c-empty"].needs_reply, null, "nothing was said, so nobody is owed a reply: null, not true");
    assert.equal(byId["c-empty"].last_body, null);
    assert.ok(!ids(body).includes("c-other"), "another company's thread is not in this company's inbox");
  });
});

test("?needs_reply=1 returns only the threads whose newest message came from the client", { timeout: 60_000 }, async () => {
  await proof.check(/^Tab: Needs reply \(client spoke last/, async () => {
    for (const on of ["1", "true"]) {
      const { code, body, calls } = await drive({ needs_reply: on });
      assert.equal(code, 200);
      assert.deepEqual(ids(body), ["c-waiting", "c-twice"], `needs_reply=${on}: exactly the owed threads, newest first`);
      assert.ok(body.items.every((r) => r.needs_reply === true));
      assert.ok(calls[0].params.includes(true), "the flag reaches the query");
    }
    // Not answered, not empty, not another company's.
    const { body } = await drive({ needs_reply: "1" });
    for (const gone of ["c-answered", "c-empty", "c-other"]) assert.ok(!ids(body).includes(gone), gone);
  });
});

test("only an explicit 1 or true turns the filter on; anything else lists every thread", { timeout: 60_000 }, async () => {
  await proof.check(/^Tab: Needs reply \(client spoke last/, async () => {
    for (const raw of ["0", "false", "", "no", "yes"]) {
      const { body } = await drive({ needs_reply: raw });
      assert.deepEqual(ids(body), ["c-waiting", "c-twice", "c-answered", "c-empty"], `needs_reply=${JSON.stringify(raw)} must not filter`);
    }
  });
});

test("a session with no company binds null and gets nothing, and the page asks for one more than it shows", { timeout: 60_000 }, async () => {
  await proof.check(/^Tab: Needs reply \(client spoke last/, async () => {
    const none = await drive({ needs_reply: "1" }, { orgId: null });
    assert.deepEqual(ids(none.body), [], "no company on the session, no threads");
    const paged = await drive({ needs_reply: "1", limit: "1" });
    assert.equal(paged.body.items.length, 1);
    assert.equal(paged.body.hasMore, true, "a second owed thread exists, so there is more");
    assert.deepEqual(ids(paged.body), ["c-waiting"]);
  });
});

test("every listed row was exercised", () => {
  proof.assertAllClaimed();
});
