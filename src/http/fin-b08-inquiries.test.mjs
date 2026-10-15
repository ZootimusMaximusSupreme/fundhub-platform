// finish-853 batch 08: GET/POST /api/inquiries. The real handler and the real work store
// (src/inquiries/work.mjs, the shift gate, the telemetry writer, the event bus) run over a stand-in
// inquiry_log, inquiry_attempts, shifts and events that answer by the company each statement names.
// The row's words: GET ?inquiry_id= expands one row's attempt history; ?recent=letters lists recent
// letters (specialist desk only); POST attempt / confirm / status writes what a specialist did to a
// client's inquiry; the POST needs an open shift. Practice test, fake data, no network, no database.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import handler from "../../api/inquiries.mjs";
import { fakeDb, makeRes, req, runWithSharedDb, staffSession, accountSession, ORG_ID, OTHER_ORG_ID, STAFF_ID } from "../testing/handler-harness.mjs";
import { rowsWhere, bindProblem, assertSqlHas } from "../testing/s3-scoped-rows.mjs";
import { STAFF_ROLES } from "../pulse/catalog/proofs/s2-route-kit.mjs";

const INQ = "b1000000-0000-4000-8000-000000000001";
const OTHER_INQ = "b2000000-0000-4000-8000-000000000002";
const FOREIGN_INQ = "b9000000-0000-4000-8000-000000000009";
const CASE = "ca000000-0000-4000-8000-000000000001";
const CLIENT = "c1000000-0000-4000-8000-000000000001";
const SHIFT = "5e000000-0000-4000-8000-0000000000aa";

function inquiryFile({ openShift = true, log, attempts = [] } = {}) {
  const inquiry_log = log || [
    { id: INQ, org_id: ORG_ID, client_id: CLIENT, bureau: "EX", inquiry: "Chase Bank", status: "Open", is_open: true, call_attempts: 0, outcome: null, worked_by: null, case_id: null, confirmed_at: null, cleared_at: null },
    { id: OTHER_INQ, org_id: ORG_ID, client_id: CLIENT, bureau: "TU", inquiry: "Amex", status: "Open", is_open: true, call_attempts: 0, outcome: null, worked_by: null, case_id: CASE, confirmed_at: null, cleared_at: null },
    { id: FOREIGN_INQ, org_id: OTHER_ORG_ID, client_id: "c9000000-0000-4000-8000-000000000009", bureau: "EQ", inquiry: "Foreign Bank", status: "Open", is_open: true, call_attempts: 0, outcome: null, worked_by: null, case_id: null, confirmed_at: null, cleared_at: null },
  ];
  const inquiry_attempts = attempts;
  const state = { inquiry_log, inquiry_attempts, staffEvents: [], events: [], cases: [{ id: CASE, case_status: "In Progress", open_inquiry_count: 2 }] };
  let seq = 0;
  const fake = fakeDb([
    [/^\s*SELECT \* FROM shifts\s+WHERE staff_id = \$1 AND ended_at IS NULL/i, (_s, p) => (openShift && p[0] === STAFF_ID ? [{ id: SHIFT, staff_id: STAFF_ID, org_id: ORG_ID, started_at: "2026-10-14T08:00:00Z" }] : [])],
    [/^\s*SELECT id, org_id FROM inquiry_log WHERE id = \$1 AND org_id = \$2 FOR UPDATE/i, (s, p) => rowsWhere(inquiry_log, s, p).map((r) => ({ id: r.id, org_id: r.org_id }))],
    [/^\s*INSERT INTO inquiry_attempts/i, (_s, p) => {
      inquiry_attempts.push({ id: `at${++seq}`, org_id: p[0], inquiry_id: p[1], staff_id: p[2], kind: p[3], outcome: p[4], note: p[5], created_at: `2026-10-14T12:0${seq}:00Z` });
      return { rows: [], rowCount: 1 };
    }],
    [/^\s*UPDATE inquiry_log\s+SET call_attempts = \(/i, (s, p) => {
      const hit = rowsWhere(inquiry_log, s.slice(s.indexOf("WHERE id = $1 AND org_id = $4")), p);
      for (const r of hit) {
        r.call_attempts = inquiry_attempts.filter((a) => a.inquiry_id === r.id && ["call", "letter", "portal"].includes(a.kind)).length;
        r.outcome = p[1] ?? r.outcome;
        r.worked_by = p[2];
      }
      return hit.map((r) => ({ ...r }));
    }],
    [/^\s*INSERT INTO staff_events/i, (_s, p) => {
      const row = { id: `se${state.staffEvents.length + 1}`, org_id: ORG_ID, staff_id: p[0], shift_id: p[2], kind: p[3], detail: JSON.parse(p[4]) };
      state.staffEvents.push(row);
      return [row];
    }],
    [/^\s*UPDATE inquiry_log\s+SET status = \$3,\s+confirmed_at = now\(\)/i, (s, p) => {
      const hit = rowsWhere(inquiry_log, s.slice(s.indexOf("WHERE id = $1 AND org_id = $4")), p);
      for (const r of hit) Object.assign(r, { status: p[2], confirmed_at: "now", cleared_at: r.cleared_at || "now", is_open: false, worked_by: p[1] });
      return hit.map((r) => ({ ...r }));
    }],
    [/^\s*SELECT COUNT\(\*\)::int AS n FROM inquiry_log WHERE case_id = \$1 AND is_open = true/i, (_s, p) => [{ n: inquiry_log.filter((r) => r.case_id === p[0] && r.is_open).length }]],
    [/^\s*UPDATE inquiry_removal_cases SET\s+case_status = 'Completed'/i, (_s, p) => { const c = state.cases.find((x) => x.id === p[0]); if (c) { c.case_status = "Completed"; c.open_inquiry_count = 0; } return { rows: [], rowCount: 1 }; }],
    [/^\s*UPDATE inquiry_removal_cases SET\s+open_inquiry_count = \$2::int/i, (_s, p) => { const c = state.cases.find((x) => x.id === p[0]); if (c) c.open_inquiry_count = p[1]; return { rows: [], rowCount: 1 }; }],
    [/^\s*INSERT INTO events \(org_id, name, version, idempotency_key, client_id, payload\)/i, (_s, p) => {
      if (p[3] && state.events.some((e) => e.org_id === p[0] && e.idempotency_key === p[3])) return [];
      const e = { id: `ev${state.events.length + 1}`, org_id: p[0], name: p[1], idempotency_key: p[3], client_id: p[4], payload: p[5] };
      state.events.push(e);
      return [{ id: e.id }];
    }],
    [/^\s*UPDATE inquiry_log\s+SET status = \$3,\s+confirmed_at = CASE/i, (s, p) => {
      const hit = rowsWhere(inquiry_log, s.slice(s.indexOf("WHERE id = $1 AND org_id = $5")), p);
      for (const r of hit) Object.assign(r, { status: p[2], confirmed_at: p[3] ? (r.confirmed_at || "now") : null, worked_by: p[1] });
      return hit.map((r) => ({ ...r }));
    }],
    [/^\s*SELECT a\.id, a\.kind, a\.outcome, a\.note, a\.created_at, a\.staff_id,/i, (s, p) => {
      const ok = new Set(inquiry_log.filter((r) => r.org_id === p[1]).map((r) => r.id));
      return inquiry_attempts.filter((a) => a.inquiry_id === p[0] && a.org_id === p[1] && ok.has(a.inquiry_id))
        .sort((a, b) => b.created_at.localeCompare(a.created_at)).map((a) => ({ ...a, staff_name: "Specialist" }));
    }],
    [/^\s*SELECT a\.id, a\.kind, a\.outcome, a\.created_at,\s+il\.bureau,/i, (s, p) => {
      const logs = new Map(inquiry_log.filter((r) => r.org_id === p[0]).map((r) => [r.id, r]));
      return inquiry_attempts.filter((a) => a.org_id === p[0] && ["letter", "portal"].includes(a.kind) && logs.has(a.inquiry_id))
        .sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, p[1])
        .map((a) => ({ id: a.id, kind: a.kind, outcome: a.outcome, created_at: a.created_at, bureau: logs.get(a.inquiry_id).bureau, staff_name: "Specialist", client_name: "Dana Whitfield" }));
    }],
    [/^\s*(BEGIN|COMMIT|ROLLBACK)\b/i, []],
  ]);
  const inner = fake.query;
  fake.query = async (sql, params = []) => {
    const text = typeof sql === "string" ? sql : sql.text;
    const args = typeof sql === "string" ? params : sql.values;
    const problem = bindProblem(text, args);
    if (problem) throw Object.assign(new Error(`bind: ${problem}`), { code: "08P01" });
    return inner(sql, params);
  };
  fake.connect = async () => ({ query: fake.query, release() {} });
  fake.state = state;
  return fake;
}

async function call(request, fake, who = [staffSession({ role: "closer" })]) {
  const session = fakeDb(who);
  const res = makeRes();
  const combined = {
    calls: fake.calls,
    query: (sql, params) => (/FROM live JOIN staff|UPDATE account_sessions|FROM accounts WHERE id/.test(typeof sql === "string" ? sql : sql.text) ? session.query(sql, params) : fake.query(sql, params)),
    connect: () => fake.connect(),
  };
  let error = null;
  await runWithSharedDb(combined, async () => { try { await handler(request, res); } catch (e) { error = e; } });
  return { res, fake, error };
}
const post = (body) => req("POST", { body });

describe("/api/inquiries", () => {
  test("POST attempt writes one attempt, counts it, stamps who worked it, and logs the telemetry on the shift", async () => {
    const fake = inquiryFile();
    const { res } = await call(post({ inquiry_id: INQ, action: "attempt", kind: "call", outcome: "No answer", note: "Left a voicemail" }), fake);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.inquiry.call_attempts, 1);
    assert.equal(res.body.inquiry.outcome, "No answer");
    assert.equal(res.body.inquiry.worked_by, STAFF_ID);
    assert.deepEqual(fake.state.inquiry_attempts.map((a) => [a.inquiry_id, a.staff_id, a.kind, a.org_id]), [[INQ, STAFF_ID, "call", ORG_ID]]);
    assert.equal(fake.state.staffEvents.length, 1);
    assert.equal(fake.state.staffEvents[0].kind, "call_made");
    assert.equal(fake.state.staffEvents[0].shift_id, SHIFT, "the work is on the clock the gate found");
    assert.equal(fake.state.staffEvents[0].detail.note, undefined, "the free-text note is not copied into telemetry");
    const second = await call(post({ inquiry_id: INQ, action: "attempt", kind: "note", outcome: "Typed by mistake", note: "Called back" }), fake);
    assert.equal(second.res.body.inquiry.call_attempts, 1, "a note is not an attempt");
    assert.equal(second.res.body.inquiry.outcome, "No answer", "a note never changes the outcome");
    assert.equal(fake.state.staffEvents.length, 1, "a note is not telemetry either");
    // The stand-in counts the attempts itself, so the words of the count are pinned.
    const update = fake.calls.find((c) => /UPDATE inquiry_log\s+SET call_attempts/.test(c.sql));
    assertSqlHas(update.sql, {
      "only calls, letters and portal filings count": "WHERE inquiry_id = $1 AND kind IN ('call','letter','portal')",
      "the company is on the write": "WHERE id = $1 AND org_id = $4",
    });
  });

  test("no login is 401 and nothing is read, and a GET that names no real inquiry id is 400", async () => {
    const fake = inquiryFile();
    const none = await call(req("GET", { query: { inquiry_id: INQ } }), fake, []);
    assert.equal(none.res.statusCode, 401);
    assert.equal(none.error, null, "the handler stops at the sign-in gate and does not throw");
    assert.equal(fake.calls.filter((c) => /inquiry_log|inquiry_attempts/.test(c.sql)).length, 0);
    for (const inquiry_id of ["nope", undefined]) {
      const bad = await call(req("GET", { query: { inquiry_id } }), fake);
      assert.equal(bad.res.statusCode, 400, String(inquiry_id));
      assert.equal(bad.res.body.error, "inquiry_id must be a uuid");
    }
    assert.equal(fake.calls.filter((c) => /FROM inquiry_attempts/.test(c.sql)).length, 0, "no history was read for a bad id");
    const write = await call(post({ inquiry_id: "nope", action: "attempt", kind: "call" }), fake);
    assert.equal(write.res.statusCode, 400);
    assert.equal(write.res.body.error, "inquiry_id must be a uuid");
    assert.equal(fake.state.inquiry_attempts.length, 0, "nothing was written for a bad id");
  });

  test("the POST needs an open shift: with none it is 403 and nothing is written; an owner does not clock in", async () => {
    const closed = inquiryFile({ openShift: false });
    const { res, error } = await call(post({ inquiry_id: INQ, action: "attempt", kind: "call" }), closed);
    assert.equal(res.statusCode, 403);
    assert.equal(error, null, "the handler stops at the shift gate instead of carrying on after the refusal");
    assert.equal(closed.state.inquiry_attempts.length, 0);
    assert.equal(closed.state.inquiry_log[0].worked_by, null);
    const owner = await call(post({ inquiry_id: INQ, action: "attempt", kind: "call" }), inquiryFile({ openShift: false }), [staffSession({ role: "owner" })]);
    assert.equal(owner.res.statusCode, 200, "the owner is exempt from the shift gate");
  });

  test("an inquiry of another company is 404 and nothing is written", async () => {
    const fake = inquiryFile();
    for (const action of ["attempt", "confirm", "status"]) {
      const { res } = await call(post({ inquiry_id: FOREIGN_INQ, action, status: "Removed", kind: "call" }), fake);
      assert.equal(res.statusCode, 404, action);
    }
    assert.equal(fake.state.inquiry_attempts.length, 0);
    assert.equal(fake.state.inquiry_log.find((r) => r.id === FOREIGN_INQ).status, "Open");
    assert.equal(fake.state.inquiry_log.find((r) => r.id === FOREIGN_INQ).worked_by, null);
  });

  test("confirm removes the inquiry and, when it is the case's last open one, completes the case and announces inquiry.removed once", async () => {
    const fake = inquiryFile();
    // The case has two open inquiries: the first confirm only lowers the count.
    fake.state.inquiry_log.push({ id: "b3000000-0000-4000-8000-000000000003", org_id: ORG_ID, client_id: CLIENT, bureau: "EQ", inquiry: "Discover", status: "Open", is_open: true, case_id: CASE, call_attempts: 0, outcome: null, worked_by: null });
    const first = await call(post({ inquiry_id: OTHER_INQ, action: "confirm" }), fake);
    assert.equal(first.res.statusCode, 200);
    assert.equal(first.res.body.inquiry.status, "Removed");
    assert.equal(first.res.body.inquiry.is_open, false);
    assert.equal(fake.state.cases[0].case_status, "In Progress");
    assert.equal(fake.state.cases[0].open_inquiry_count, 1);
    const second = await call(post({ inquiry_id: "b3000000-0000-4000-8000-000000000003", action: "confirm" }), fake);
    assert.equal(second.res.statusCode, 200);
    assert.equal(fake.state.cases[0].case_status, "Completed");
    assert.equal(fake.state.cases[0].open_inquiry_count, 0);
    const removed = fake.state.events.filter((e) => e.name === "inquiry.removed");
    assert.ok(removed.length >= 1);
    assert.ok(removed.every((e) => e.org_id === ORG_ID && e.client_id === CLIENT));
    const again = await call(post({ inquiry_id: "b3000000-0000-4000-8000-000000000003", action: "confirm" }), fake);
    assert.equal(again.res.statusCode, 200);
    const keys = fake.state.events.map((e) => e.idempotency_key);
    assert.equal(new Set(keys).size, keys.length, "a repeat confirm does not announce the same removal twice");
  });

  test("status writes the new word, stamps who, and a removed-like word stamps the confirmation and announces the removal", async () => {
    const fake = inquiryFile();
    const open = await call(post({ inquiry_id: INQ, action: "status", status: "Disputed" }), fake);
    assert.equal(open.res.statusCode, 200);
    assert.equal(open.res.body.inquiry.status, "Disputed");
    assert.equal(open.res.body.inquiry.confirmed_at, null);
    assert.equal(open.res.body.inquiry.worked_by, STAFF_ID);
    assert.equal(fake.state.events.length, 0);
    const done = await call(post({ inquiry_id: INQ, action: "status", status: "Deleted by bureau" }), fake);
    assert.equal(done.res.body.inquiry.status, "Deleted by bureau");
    assert.ok(done.res.body.inquiry.confirmed_at);
    assert.equal(fake.state.events.filter((e) => e.name === "inquiry.removed").length, 1);
    const blank = await call(post({ inquiry_id: INQ, action: "status", status: "  " }), fake);
    assert.equal(blank.res.statusCode, 400);
  });

  test("GET ?inquiry_id= lists that inquiry's attempts newest first, and none from another company", async () => {
    const fake = inquiryFile({ attempts: [
      { id: "a1", org_id: ORG_ID, inquiry_id: INQ, staff_id: STAFF_ID, kind: "call", outcome: "No answer", note: null, created_at: "2026-10-12T10:00:00Z" },
      { id: "a2", org_id: ORG_ID, inquiry_id: INQ, staff_id: STAFF_ID, kind: "letter", outcome: "Sent", note: "Mailed", created_at: "2026-10-13T10:00:00Z" },
      { id: "a3", org_id: OTHER_ORG_ID, inquiry_id: INQ, staff_id: STAFF_ID, kind: "call", outcome: "leak", note: null, created_at: "2026-10-14T10:00:00Z" },
    ] });
    const { res } = await call(req("GET", { query: { inquiry_id: INQ } }), fake);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.attempts.map((a) => a.id), ["a2", "a1"]);
    const bad = await call(req("GET", { query: { inquiry_id: "nope" } }), fake);
    assert.equal(bad.res.statusCode, 400);
    const read = fake.calls.find((c) => /FROM inquiry_attempts a/.test(c.sql));
    assertSqlHas(read.sql, {
      "the inquiry is joined inside the same company": "JOIN inquiry_log il ON il.id = a.inquiry_id AND il.org_id = $2",
      "this inquiry and this company's attempts": "WHERE a.inquiry_id = $1 AND a.org_id = $2",
      "newest first": "ORDER BY a.created_at DESC",
    });
  });

  test("GET ?recent=letters lists this company's letters and portal filings only, for the four specialist-desk roles", async () => {
    const attempts = [
      { id: "l1", org_id: ORG_ID, inquiry_id: INQ, staff_id: STAFF_ID, kind: "letter", outcome: "Sent", note: null, created_at: "2026-10-13T10:00:00Z" },
      { id: "l2", org_id: ORG_ID, inquiry_id: INQ, staff_id: STAFF_ID, kind: "call", outcome: "No answer", note: null, created_at: "2026-10-13T11:00:00Z" },
      { id: "l3", org_id: ORG_ID, inquiry_id: OTHER_INQ, staff_id: STAFF_ID, kind: "portal", outcome: "Filed", note: null, created_at: "2026-10-14T09:00:00Z" },
      { id: "l4", org_id: OTHER_ORG_ID, inquiry_id: FOREIGN_INQ, staff_id: STAFF_ID, kind: "letter", outcome: "Sent", note: null, created_at: "2026-10-14T10:00:00Z" },
    ];
    const letIn = [];
    for (const role of STAFF_ROLES) {
      const { res } = await call(req("GET", { query: { recent: "letters" } }), inquiryFile({ attempts }), [staffSession({ role })]);
      if (res.statusCode === 403) continue;
      letIn.push(role);
      assert.deepEqual(res.body.letters.map((l) => l.id), ["l3", "l1"], role);
    }
    assert.deepEqual(letIn.sort(), ["admin", "funding_advisor", "inquiry_specialist", "owner"]);
    const probe = inquiryFile({ attempts });
    await call(req("GET", { query: { recent: "letters", limit: "500" } }), probe, [staffSession({ role: "owner" })]);
    const letters = probe.calls.find((c) => /FROM inquiry_attempts a/.test(c.sql));
    assertSqlHas(letters.sql, {
      "the inquiry is joined inside the same company": "JOIN inquiry_log il ON il.id = a.inquiry_id AND il.org_id = $1::uuid",
      "this company's letters and portal filings only": "WHERE a.org_id = $1::uuid AND a.kind IN ('letter', 'portal')",
      "newest first, bounded": "ORDER BY a.created_at DESC LIMIT $2",
    });
    assert.equal(letters.params[1], 50, "the limit is capped");
  });

  test("a client or partner login and no login are refused; the unknown action is 400", async () => {
    const client = await call(post({ inquiry_id: INQ, action: "status", status: "Removed" }), inquiryFile(), accountSession({ kind: "client", clientId: CLIENT }));
    assert.equal(client.res.statusCode, 403);
    const none = await call(post({ inquiry_id: INQ, action: "status", status: "Removed" }), inquiryFile(), []);
    assert.equal(none.res.statusCode, 401);
    const bad = await call(post({ inquiry_id: INQ, action: "wipe" }), inquiryFile());
    assert.equal(bad.res.statusCode, 400);
  });
});
