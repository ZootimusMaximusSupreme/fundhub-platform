import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CALL_DUE_STATUSES,
  CALL_GRACE_MS,
  DESK_CASES_SQL,
  GATE_SOURCE,
  LETTER_SQL,
  LETTER_STATUSES,
  NIL_CLIENT_ID,
  STUCK_AFTER_MS,
  STUCK_SQL,
  UPLOAD_DOOR_PATH,
  gapChecks
} from "./gap-inquiry.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const SRC = fs.readFileSync(path.join(HERE, "gap-inquiry.mjs"), "utf8");
const ORG = "11111111-1111-1111-1111-111111111111";
const NOW = new Date("2026-10-08T18:00:00Z");

const SHAPE = ["id", "status", "detail", "suggestedFix"];
const IDS = [
  "inquiry:case-stuck",
  "inquiry:letter-round",
  "inquiry:specialist-api",
  "inquiry:upload-door"
];

function assertShape(rows) {
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map((row) => row.id), IDS);
  for (const row of rows) {
    assert.deepEqual(Object.keys(row), SHAPE);
    assert.ok(row.status === "PASS" || row.status === "FAIL" || row.status === "skip");
    assert.equal(typeof row.detail, "string");
    assert.ok(row.detail.length > 0);
    if (row.status === "FAIL") {
      assert.equal(typeof row.suggestedFix, "string");
      assert.match(row.suggestedFix, /Do not auto-fix/);
    } else {
      assert.equal(row.suggestedFix, null);
    }
  }
}

/**
 * Answers by what the SQL is, and records every query. The five specialist reads
 * (case list, two packet reads, desk cases) and the two counts are all SELECTs.
 */
function fakeDb(over = {}) {
  const seen = [];
  const answers = {
    stuck: { rows: [{ n: 0 }] },
    letters: { rows: [{ n: 0 }] },
    list: { rows: [] },
    documents: { rows: [] },
    consents: { rows: [] },
    desk: { rows: [] },
    ...over
  };
  const respond = (a, params) => {
    const v = typeof a === "function" ? a(params) : a;
    if (v instanceof Error) throw v;
    return v;
  };
  return {
    seen,
    async query(sql, params) {
      const text = String(sql);
      seen.push({ sql: text, params });
      if (!/^\s*select\b/i.test(text)) throw new Error(`not a read: ${text.slice(0, 40)}`);
      if (text === STUCK_SQL) return respond(answers.stuck, params);
      if (text === LETTER_SQL) return respond(answers.letters, params);
      if (text === DESK_CASES_SQL) return respond(answers.desk, params);
      if (/COUNT\(\*\) OVER/.test(text)) return respond(answers.list, params);
      if (/FROM documents/.test(text)) return respond(answers.documents, params);
      if (/FROM client_consents/.test(text)) return respond(answers.consents, params);
      throw new Error(`unexpected query: ${text.slice(0, 80)}`);
    }
  };
}

function portalFetch(calls, html = '<div class="upload-door" data-kind="inquiry_doc"></div>', status = 200) {
  return async function fetchImpl(url, opts) {
    calls.push({ url, method: opts && opts.method });
    return { status, text: async () => html };
  };
}

test("gap inquiry: no database and no fetch skips every row", async () => {
  const rows = await gapChecks({});
  assertShape(rows);
  assert.deepEqual(rows.map((row) => row.status), ["skip", "skip", "skip", "skip"]);
});

test("gap inquiry: a quiet file passes, the specialist reads really run, and only the portal page is fetched", async () => {
  const calls = [];
  const db = fakeDb();
  const rows = await gapChecks({
    db,
    orgId: ORG,
    fetchImpl: portalFetch(calls),
    baseUrl: "http://pulse.test/",
    now: NOW
  });
  assertShape(rows);
  assert.deepEqual(rows.map((row) => row.status), ["PASS", "PASS", "PASS", "PASS"]);
  // The registry already pings the specialist doors. This lane must not ping them again.
  assert.deepEqual(calls, [{ url: `http://pulse.test${UPLOAD_DOOR_PATH}`, method: "GET" }]);
  // The specialist check ran the real reads: case list, both packet reads, desk cases.
  const texts = db.seen.map((q) => q.sql);
  assert.ok(texts.some((t) => /COUNT\(\*\) OVER/.test(t)), "case list read");
  assert.ok(texts.some((t) => /FROM documents/.test(t)), "document packet read");
  assert.ok(texts.some((t) => /FROM client_consents/.test(t)), "consent packet read");
  assert.ok(texts.includes(DESK_CASES_SQL), "desk cases read");
  const packet = db.seen.find((q) => /FROM documents/.test(q.sql));
  assert.deepEqual(packet.params[1], [NIL_CLIENT_ID]);          // a client that matches nothing
  for (const q of db.seen) assert.doesNotMatch(q.sql, /\b(INSERT|UPDATE|DELETE)\b/i);
});

test("gap inquiry: a stuck case fails, and the read is a count with the right cut-offs", async () => {
  let stuckParams;
  const db = fakeDb({
    stuck: (params) => {
      stuckParams = params;
      return { rows: [{ n: 2 }] };
    }
  });
  const rows = await gapChecks({ db, orgId: ORG, fetchImpl: portalFetch([]), baseUrl: "http://pulse.test", now: NOW });
  const stuck = rows[0];
  assert.equal(stuck.status, "FAIL");
  assert.match(stuck.detail, /2 inquiry cases are stuck/);
  assert.match(stuck.suggestedFix, /Do not mail a bureau/);
  assert.equal(stuckParams[0], ORG);
  assert.equal(stuckParams[1], new Date(NOW.getTime() - STUCK_AFTER_MS).toISOString());
  assert.deepEqual(stuckParams[2], [...CALL_DUE_STATUSES]);
  assert.equal(stuckParams[3], new Date(NOW.getTime() - CALL_GRACE_MS).toISOString());
  assert.equal(STUCK_AFTER_MS, 72 * 60 * 60 * 1000);
  assert.equal(CALL_GRACE_MS, 45 * 60 * 1000);                  // 3 runs of the 15 minute call sweeper

  const one = await gapChecks({ db: fakeDb({ stuck: { rows: [{ n: 1 }] } }), orgId: ORG, now: NOW });
  assert.match(one[0].detail, /1 inquiry case is stuck/);
});

test("gap inquiry: the stuck read only counts cases nothing else will move", () => {
  // Status lists passed to the read: Blocked waits on client documents, Completed and
  // Canceled are done. None of them may be in the list a stuck case is judged on.
  for (const bad of ["Blocked", "Completed", "Canceled", "Escalated"]) {
    assert.equal(CALL_DUE_STATUSES.includes(bad), false, bad);
  }
  assert.deepEqual([...CALL_DUE_STATUSES], ["Queued", "Scheduled", "In Progress"]);
  // The three stuck shapes, and the guards that keep waiting cases out.
  assert.match(STUCK_SQL, /case_status::text = 'Escalated'\s+AND irc\.updated_at < \$2/);
  assert.match(STUCK_SQL, /call_due_at IS NULL\s+AND irc\.call_fired_at IS NULL\s+AND irc\.updated_at < \$2/);
  assert.match(STUCK_SQL, /call_due_at <= \$4[^)]*AND irc\.call_fired_at IS NULL/);
  assert.match(STUCK_SQL, /irc\.closed_at IS NULL/);
  assert.match(STUCK_SQL, /irc\.is_demo IS NOT TRUE/);
  assert.match(STUCK_SQL, /c\.is_demo IS TRUE OR c\.custom_fields->>'synthetic' = 'true'/);
  assert.doesNotMatch(STUCK_SQL, /\b(INSERT|UPDATE|DELETE)\b/i);
});

test("gap inquiry: one funding round with open inquiries and no draft fails, and only gate cases count", async () => {
  let letterParams;
  const db = fakeDb({
    letters: (params) => {
      letterParams = params;
      return { rows: [{ n: 1 }] };
    }
  });
  const rows = await gapChecks({ db, orgId: ORG, fetchImpl: portalFetch([]), baseUrl: "http://pulse.test", now: NOW });
  const letter = rows[1];
  assert.equal(letter.status, "FAIL");
  assert.match(letter.detail, /1 funding round has open inquiries and no letter draft/);
  assert.match(letter.suggestedFix, /Do not mail a bureau/);
  assert.match(letter.suggestedFix, /no real name/);
  assert.equal(letterParams[0], ORG);
  assert.deepEqual(letterParams[1], [...LETTER_STATUSES]);
  assert.equal(letterParams[2], GATE_SOURCE);
  assert.equal(GATE_SOURCE, "inquiry_gate");                   // the value the gate writes on a case
  assert.match(LETTER_SQL, /irc\.request_source = \$3/);
  assert.match(LETTER_SQL, /irc\.letter_provider_id IS NULL/);
  assert.match(LETTER_SQL, /irc\.draft_letter_document_id IS NULL/);
  assert.match(LETTER_SQL, /irc\.open_inquiry_count > 0/);
  assert.match(LETTER_SQL, /irc\.is_demo IS NOT TRUE/);

  const two = await gapChecks({ db: fakeDb({ letters: { rows: [{ n: 2 }] } }), orgId: ORG, now: NOW });
  assert.match(two[1].detail, /2 funding rounds have open inquiries/);
});

test("gap inquiry: each specialist desk read can fail on its own, and a crash names the door", async () => {
  const boom = (msg) => new Error(msg);
  const cases = [
    { over: { list: boom('relation "inquiry_removal_cases" does not exist') }, want: /case list failed.*inquiry_removal_cases/ },
    { over: { documents: boom("documents offline") }, want: /document packet read failed/ },
    { over: { consents: boom("consents offline") }, want: /document packet read failed/ },
    { over: { desk: boom("column ai_call_status does not exist") }, want: /\/api\/inquiry\?action=cases failed.*ai_call_status/ }
  ];
  for (const c of cases) {
    const rows = await gapChecks({ db: fakeDb(c.over), orgId: ORG, fetchImpl: portalFetch([]), baseUrl: "http://pulse.test", now: NOW });
    const desk = rows[2];
    assert.equal(desk.id, "inquiry:specialist-api");
    assert.equal(desk.status, "FAIL", JSON.stringify(Object.keys(c.over)));
    assert.match(desk.detail, c.want);
    assert.match(desk.suggestedFix, /Do not place a bureau call/);
    assert.equal(rows[0].status, "PASS");
  }
  // Injected readers: a thrown case list, and a packet read that answers null.
  const thrown = await gapChecks({
    db: fakeDb(),
    orgId: ORG,
    readers: { listCases: async () => { throw new Error("handler 500"); } }
  });
  assert.equal(thrown[2].status, "FAIL");
  assert.match(thrown[2].detail, /handler 500/);
  const nulled = await gapChecks({ db: fakeDb(), orgId: ORG, readers: { loadDocPackets: async () => null } });
  assert.equal(nulled[2].status, "FAIL");
  assert.match(nulled[2].detail, /shows not checked/);
});

test("gap inquiry: the desk cases read is the same select the live door runs", () => {
  const door = fs.readFileSync(path.join(ROOT, "api/inquiry.mjs"), "utf8").replace(/\s+/g, " ");
  const mine = DESK_CASES_SQL.replace(/\s+/g, " ").trim();
  const list = /SELECT (id, case_id, client_id, case_status, selected_bureaus_raw, call_fired_at, ai_call_status, open_inquiry_count, created_at) FROM inquiry_removal_cases WHERE org_id = \$1::uuid/.exec(mine);
  assert.ok(list, "the desk select list changed in this file");
  assert.ok(door.includes(`SELECT ${list[1]} FROM inquiry_removal_cases WHERE org_id = $1::uuid`), "api/inquiry.mjs changed its select list");
  assert.match(DESK_CASES_SQL, /LIMIT 1\s*$/);
});

test("gap inquiry: upload door is dead when the portal box is missing or the page errors", async () => {
  const ctx = { db: fakeDb(), orgId: ORG, baseUrl: "http://pulse.test", now: NOW };
  const gone = await gapChecks({ ...ctx, fetchImpl: portalFetch([], "<html>no door</html>") });
  const crashed = await gapChecks({ ...ctx, fetchImpl: portalFetch([], '<div data-kind="inquiry_doc"></div>', 500) });
  const down = await gapChecks({ ...ctx, fetchImpl: async () => { throw new Error("socket closed"); } });
  assert.equal(gone[3].status, "FAIL");
  assert.match(gone[3].detail, /upload door dead/);
  assert.match(gone[3].detail, /inquiry_doc box missing=true/);
  assert.match(gone[3].suggestedFix, /Do not upload a real ID/);
  assert.equal(crashed[3].status, "FAIL");
  assert.match(crashed[3].detail, /portal 500/);
  assert.equal(down[3].status, "FAIL");
  assert.match(down[3].detail, /socket closed/);
  const alias = await gapChecks({ ...ctx, fetch: portalFetch([]) });      // ctx.fetch is accepted too
  assert.equal(alias[3].status, "PASS");
});

test("gap inquiry: a thrown read fails that row and does not invent a send", async () => {
  const db = fakeDb({
    stuck: new Error("connection refused"),
    letters: new Error("letter table missing")
  });
  const rows = await gapChecks({ db, orgId: ORG, now: NOW });
  assert.equal(rows[0].status, "FAIL");
  assert.match(rows[0].detail, /connection refused/);
  assert.equal(rows[1].status, "FAIL");
  assert.match(rows[1].detail, /letter table missing/);
  assert.match(rows[0].suggestedFix, /Do not mail a bureau/);
  assert.equal(rows[2].status, "PASS");
});

test("gap inquiry: this file does not repeat slice 29, the registry pings, or Recon, and does not send", () => {
  assert.equal(SRC.includes("slice-29-inquiry-remover"), false);
  assert.equal(SRC.includes("inquiry-remover.html"), false);
  assert.equal(SRC.includes('method: "POST"'), false);
  assert.equal(SRC.includes("method: 'POST'"), false);
  assert.equal(SRC.includes("documents-upload"), false);
  assert.equal(SRC.includes("mail-letter"), false);
  assert.equal(SRC.includes("postgrid"), false);
  assert.doesNotMatch(SRC, /FROM agents/);                       // Recon is read by the daily pulse itself
  assert.doesNotMatch(SRC, /"\/api\/read\/inquiry-cases"|"\/api\/inquiry\?action=cases"/); // the registry pings these
  for (const id of [
    "c-02-inquiry-created",
    "c-02b-inquiry-removal-requested",
    "inquiry-call-sweeper"
  ]) {
    assert.equal(SRC.includes(id), false, id);
  }
});
