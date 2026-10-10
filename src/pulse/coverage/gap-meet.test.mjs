import test, { describe, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { cronIntervalMs, STALE_MULTIPLE } from "../heartbeats.mjs";
import { SWEEP_CRON } from "../../workflows/meet-transcript-sweeper.mjs";
import {
  CANDIDATE_SQL,
  CHECK_IDS,
  CLIENT_CAP,
  MEET_JOB,
  RECORDING_SQL,
  TRANSCRIPT_WAIT_MS,
  contextHasWords,
  gapChecks
} from "./gap-meet.mjs";
import { db as pgDb, close as closePg } from "../../db.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(HERE, "gap-meet.mjs"), "utf8");
const ORG = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-10-08T20:00:00Z");

/* A fake db that answers by the tag in each query, and keeps what it was sent. */
function fakeDb({ recording = [], candidates = [] } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql: String(sql), params });
      if (/gap:meet-recording-no-transcript/.test(sql)) return { rows: recording };
      if (/gap:meet-transcript-unreadable/.test(sql)) return { rows: candidates };
      throw new Error(`unexpected sql: ${sql}`);
    }
  };
}

const withWords = { recent_calls: [{ transcript: "hello this is the call" }] };
const noWords = { recent_calls: [{ transcript: null }, { transcript: "   " }, { transcript: "" }] };

function shape(row) {
  assert.equal(typeof row.id, "string");
  assert.ok(CHECK_IDS.includes(row.id));
  assert.ok(["PASS", "FAIL", "skip"].includes(row.status));
  assert.equal(typeof row.detail, "string");
  assert.ok(row.detail.length > 0);
  assert.ok("suggestedFix" in row);
  if (row.status === "FAIL") {
    assert.equal(typeof row.suggestedFix, "string");
    assert.match(row.suggestedFix, /Recon \(AG-07\) is the one tripwire/);
    assert.match(row.suggestedFix, /meet-transcript-sweeper/);
    assert.match(row.suggestedFix, /Do not transcribe a new file/);
    assert.match(row.suggestedFix, /Do not call a model/);
    assert.doesNotMatch(row.suggestedFix, /second watchdog|new watchdog|second tripwire/i);
  } else {
    assert.equal(row.suggestedFix, null);
  }
}

async function run(db, extra = {}) {
  const rows = await gapChecks({ db, orgId: ORG, now: NOW, ...extra });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.id), [...CHECK_IDS]);
  rows.forEach(shape);
  return Object.fromEntries(rows.map((r) => [r.id, r]));
}

test("gap meet: source stays read-only, reads no repo file, and starts no watcher", () => {
  assert.doesNotMatch(SRC, /\b(INSERT|UPDATE|DELETE|DROP)\b/);
  assert.doesNotMatch(SRC, /\bfetch\s*\(/);
  assert.doesNotMatch(SRC, /whisperBytes|sweepMeetTranscripts|createFunction|new Inngest|openai/i);
  assert.doesNotMatch(SRC, /setInterval|setTimeout/);
  assert.doesNotMatch(SRC, /from ["']node:(fs|path)["']|readFileSync|readText/);
  assert.doesNotMatch(SRC, /\bBEGIN\b|\bCOMMIT\b|\bROLLBACK\b/);
  assert.deepEqual([...CHECK_IDS], ["meet:recording-no-transcript", "meet:transcript-unreadable"]);
});

test("gap meet: the transcriber-failed row is gone because job:meet-transcript-sweeper already reds on an error run", () => {
  assert.ok(!CHECK_IDS.includes("meet:transcriber-failed"));
  assert.doesNotMatch(SRC, /job_heartbeats/);
  assert.equal(MEET_JOB, "meet-transcript-sweeper");
});

test("gap meet: the wait is 3 times the sweeper schedule, imported from the sweeper", () => {
  assert.equal(SWEEP_CRON, "*/10 * * * *");
  assert.equal(TRANSCRIPT_WAIT_MS, STALE_MULTIPLE * cronIntervalMs(SWEEP_CRON));
  assert.equal(TRANSCRIPT_WAIT_MS, 30 * 60 * 1000);
});

test("gap meet: no database or no company skips both rows, with a reason", async () => {
  const noDb = await gapChecks({ orgId: ORG, now: NOW });
  assert.deepEqual(noDb.map((r) => r.status), ["skip", "skip"]);
  assert.match(noDb[0].detail, /no database/);
  const noOrg = await gapChecks({ db: fakeDb(), now: NOW });
  assert.deepEqual(noOrg.map((r) => r.status), ["skip", "skip"]);
  assert.match(noOrg[0].detail, /no company/);
  assert.equal((await gapChecks()).length, 2);
});

test("gap meet: no call with a tape link and no words is PASS; the wait and window are sent to the query", async () => {
  const db = fakeDb();
  const by = await run(db);
  assert.equal(by["meet:recording-no-transcript"].status, "PASS");
  assert.match(by["meet:recording-no-transcript"].detail, /30-minute wait/);
  const sent = db.calls.find((c) => /meet-recording-no-transcript/.test(c.sql)).params;
  assert.equal(sent[0], ORG);
  assert.equal(sent[1], new Date(NOW.getTime() - 30 * 60 * 1000).toISOString());
  assert.equal(sent[2], new Date(NOW.getTime() - 14 * 24 * 3600e3).toISOString());
});

test("gap meet: calls with a tape link and no words fail, with the count", async () => {
  const one = await run(fakeDb({ recording: [{ key: "c1" }] }));
  assert.equal(one["meet:recording-no-transcript"].status, "FAIL");
  assert.match(one["meet:recording-no-transcript"].detail, /1 logged call with a recording link and no transcript after the 30-minute wait/);
  const two = await run(fakeDb({ recording: [{ key: "c1" }, { key: "c2" }] }));
  assert.match(two["meet:recording-no-transcript"].detail, /2 logged calls with a recording link/);
});

test("gap meet: recording SQL leaves out demo calls and clients, uses the link, and ages out", () => {
  assert.match(RECORDING_SQL, /COALESCE\(co\.is_demo, false\) = false/);
  assert.match(RECORDING_SQL, /COALESCE\(c\.is_demo, false\) = false/);
  assert.match(RECORDING_SQL, /co\.recording_url IS NOT NULL/);
  assert.match(RECORDING_SQL, /co\.logged_at < \$2/);
  assert.match(RECORDING_SQL, /co\.logged_at >= \$3/);
  // Words already in Company Brain are the other row's business.
  assert.match(RECORDING_SQL, /bf\.web_view_link = co\.recording_url/);
  // Files still waiting in Company Brain are the machine row's. Not read here.
  assert.doesNotMatch(RECORDING_SQL, /needs_transcription/);
});

test("gap meet: no client with Meet words is PASS and says nothing was checked", async () => {
  const by = await run(fakeDb(), { fetchContext: async () => { throw new Error("must not be called"); } });
  assert.equal(by["meet:transcript-unreadable"].status, "PASS");
  assert.match(by["meet:transcript-unreadable"].detail, /no client has Meet words from the last 14 days/);
});

test("gap meet: fetchContext is run for each client and must show a transcript", async () => {
  const asked = [];
  const fetchContext = async (_db, args) => {
    asked.push(args);
    return args.clientId === "c-hidden" ? noWords : withWords;
  };
  const db = fakeDb({ candidates: [{ client_id: "c-ok" }, { client_id: "c-hidden" }, { client_id: "c-ok2" }] });
  const by = await run(db, { fetchContext });
  assert.equal(by["meet:transcript-unreadable"].status, "FAIL");
  assert.match(by["meet:transcript-unreadable"].detail, /1 client with Meet words where fetchContext shows no transcript in the last 3 calls/);
  assert.deepEqual(asked.map((a) => a.clientId), ["c-ok", "c-hidden", "c-ok2"]);
  assert.ok(asked.every((a) => a.orgId === ORG));

  const clean = await run(fakeDb({ candidates: [{ client_id: "c-ok" }, { client_id: "c-ok2" }] }), { fetchContext });
  assert.equal(clean["meet:transcript-unreadable"].status, "PASS");
  assert.match(clean["meet:transcript-unreadable"].detail, /for all 2 clients checked/);
});

test("gap meet: the candidate query gets the window, the wait, and a cap on clients", async () => {
  const db = fakeDb({ candidates: [] });
  await run(db);
  const sent = db.calls.find((c) => /meet-transcript-unreadable/.test(c.sql)).params;
  assert.equal(sent[0], ORG);
  assert.equal(sent[1], new Date(NOW.getTime() - 14 * 24 * 3600e3).toISOString());
  assert.equal(sent[2], new Date(NOW.getTime() - 30 * 60 * 1000).toISOString());
  assert.equal(sent[3], CLIENT_CAP);
  assert.equal(CLIENT_CAP, 15);
});

test("gap meet: a fetchContext that throws is a FAIL with the reason, never a PASS", async () => {
  const by = await run(fakeDb({ candidates: [{ client_id: "c1" }] }), {
    fetchContext: async () => { throw new Error("relation call_outcomes does not exist"); }
  });
  assert.equal(by["meet:transcript-unreadable"].status, "FAIL");
  assert.match(by["meet:transcript-unreadable"].detail, /fetchContext failed for 1 client with Meet words: relation call_outcomes does not exist/);
});

test("gap meet: a database error is a FAIL with the reason, never a PASS, and does not throw", async () => {
  const boom = { async query() { throw new Error("pool timeout"); } };
  const by = await run(boom);
  assert.equal(by["meet:recording-no-transcript"].status, "FAIL");
  assert.match(by["meet:recording-no-transcript"].detail, /pool timeout/);
  assert.equal(by["meet:transcript-unreadable"].status, "FAIL");
  assert.match(by["meet:transcript-unreadable"].detail, /pool timeout/);
});

test("contextHasWords reads the recent_calls fetchContext returns", () => {
  assert.equal(contextHasWords(withWords), true);
  assert.equal(contextHasWords(noWords), false);
  assert.equal(contextHasWords({ recent_calls: [] }), false);
  assert.equal(contextHasWords({}), false);
  assert.equal(contextHasWords(null), false);
});

test("gap meet: candidate SQL reads Meet tapes and transcript files, only with text and a call, and leaves out demo", () => {
  assert.match(CANDIDATE_SQL, /FROM brain_files bf/);
  assert.match(CANDIDATE_SQL, /FROM brain_chunks bc/);
  assert.match(CANDIDATE_SQL, /gmt\[0-9\]\{8\}/);
  assert.match(CANDIDATE_SQL, /gemini\[\[:space:\]\]\+notes/);
  assert.match(CANDIDATE_SQL, /FROM call_outcomes co2/);
  assert.match(CANDIDATE_SQL, /COALESCE\(c\.is_demo, false\) = false/);
  assert.match(CANDIDATE_SQL, /LIMIT \$4::int/);
});

/* ------------------------------------------------------------------------
   The SQL and the real fetchContext, run for real. Each table is replaced for
   one query by fixture rows (a CTE with the table's name). The other tables
   fetchContext reads answer with their real, empty-for-this-client rows.
   SELECT only, nothing is stored. Skipped without DATABASE_URL, like every
   *.pg.test.mjs.
   ------------------------------------------------------------------------ */
const HAVE_DB = !!process.env.DATABASE_URL;
const COLS = {
  clients: [["id", "uuid"], ["org_id", "uuid"], ["is_demo", "boolean"], ["first_name", "text"], ["last_name", "text"], ["email", "text"], ["phone", "text"], ["funded", "boolean"], ["funded_amount", "numeric"], ["outcome_tier", "text"], ["dnd_sms", "boolean"], ["dnd_email", "boolean"], ["dnd_voice", "boolean"], ["tags", "text[]"]],
  call_outcomes: [["id", "uuid"], ["org_id", "uuid"], ["client_id", "uuid"], ["is_demo", "boolean"], ["logged_at", "timestamptz"], ["outcome", "text"], ["notes", "text"], ["recording_url", "text"], ["transcript", "text"]],
  brain_files: [["id", "uuid"], ["org_id", "uuid"], ["client_id", "uuid"], ["name", "text"], ["web_view_link", "text"], ["indexed_at", "timestamptz"], ["created_at", "timestamptz"]],
  brain_chunks: [["file_id", "uuid"], ["org_id", "uuid"], ["content", "text"]]
};
let seq = 0;
const uid = () => `00000000-0000-4000-8000-${(++seq).toString(16).padStart(12, "0")}`;
const ago = (h) => new Date(NOW.getTime() - h * 3600e3).toISOString();

function fixtureDb(rows = {}) {
  const ctes = Object.entries(COLS).map(([name, cols]) => {
    const json = JSON.stringify(rows[name] || []).replace(/'/g, "''");
    return `${name} AS (SELECT * FROM jsonb_to_recordset('${json}'::jsonb) AS x(${cols.map(([c, t]) => `"${c}" ${t}`).join(", ")}))`;
  });
  return {
    async query(sql, params) {
      const t = String(sql).replace(/^\s*(\/\*[\s\S]*?\*\/\s*)+/, "");
      return pgDb.query(`WITH ${ctes.join(", ")} ${t}`, params);
    }
  };
}

describe("gap-meet SQL and fetchContext on the Postgres engine, over fixture rows", { skip: HAVE_DB ? false : "no DATABASE_URL" }, () => {
  after(async () => { await closePg(); });
  const org = uid();
  const CL = uid();
  const client = (o = {}) => ({ id: CL, org_id: org, is_demo: false, first_name: "A", last_name: "B", ...o });
  const call = (o = {}) => ({ id: uid(), org_id: org, client_id: CL, is_demo: false, logged_at: ago(2), outcome: "deposit", notes: null, recording_url: null, transcript: null, ...o });
  const file = (o = {}) => ({ id: uid(), org_id: org, client_id: CL, name: "Google Meet recording 2026-10-08", web_view_link: "https://drive.google.com/file/d/abc", indexed_at: ago(2), created_at: ago(2), ...o });
  const chunk = (f) => ({ file_id: f.id, org_id: org, content: "hello this is the call" });

  async function rowsFor(rows) {
    const out = await gapChecks({ db: fixtureDb(rows), orgId: org, now: NOW });
    return Object.fromEntries(out.map((r) => [r.id, r.status]));
  }

  test("a call with a tape link and no words fails after the wait; not before, not with words, not demo, not old", async () => {
    const R = "meet:recording-no-transcript";
    const url = "https://drive.google.com/x";
    assert.equal((await rowsFor({ clients: [client()], call_outcomes: [call({ recording_url: url })] }))[R], "FAIL");
    assert.equal((await rowsFor({ clients: [client()], call_outcomes: [call({ recording_url: url, logged_at: ago(0.17) })] }))[R], "PASS");
    assert.equal((await rowsFor({ clients: [client()], call_outcomes: [call({ recording_url: url, transcript: "words" })] }))[R], "PASS");
    assert.equal((await rowsFor({ clients: [client()], call_outcomes: [call({ recording_url: url, is_demo: true })] }))[R], "PASS");
    assert.equal((await rowsFor({ clients: [client({ is_demo: true })], call_outcomes: [call({ recording_url: url })] }))[R], "PASS");
    assert.equal((await rowsFor({ clients: [client()], call_outcomes: [call({ recording_url: url, logged_at: ago(480) })] }))[R], "PASS");
    assert.equal((await rowsFor({ clients: [client()], call_outcomes: [call()] }))[R], "PASS");
  });

  test("the real fetchContext: words stamped on the newest call pass; words only in Company Brain fail", async () => {
    const U = "meet:transcript-unreadable";
    assert.equal((await rowsFor({ clients: [client()], call_outcomes: [call({ transcript: "words" })] }))[U], "PASS");
    const f = file();
    assert.equal((await rowsFor({ clients: [client()], call_outcomes: [call()], brain_files: [f], brain_chunks: [chunk(f)] }))[U], "FAIL");
    assert.equal((await rowsFor({ clients: [client()], call_outcomes: [call({ transcript: "words" })], brain_files: [f], brain_chunks: [chunk(f)] }))[U], "PASS");
    const gemini = file({ name: "Gemini notes - Strategy call" });
    assert.equal((await rowsFor({ clients: [client()], call_outcomes: [call()], brain_files: [gemini], brain_chunks: [chunk(gemini)] }))[U], "FAIL");
  });

  test("the real fetchContext reads only the last 3 calls, so a transcript on the 4th newest fails", async () => {
    const U = "meet:transcript-unreadable";
    const calls = [
      call({ logged_at: ago(24), transcript: "old words" }),
      call({ logged_at: ago(5) }),
      call({ logged_at: ago(4) }),
      call({ logged_at: ago(3) })
    ];
    assert.equal((await rowsFor({ clients: [client()], call_outcomes: calls }))[U], "FAIL");
  });

  test("not a miss: inside the wait, no call to hold the words, demo, over 14 days, or not a Meet file", async () => {
    const U = "meet:transcript-unreadable";
    const fresh = file({ indexed_at: ago(0.08), created_at: ago(0.08) });
    assert.equal((await rowsFor({ clients: [client()], call_outcomes: [call()], brain_files: [fresh], brain_chunks: [chunk(fresh)] }))[U], "PASS");
    const lone = file();
    assert.equal((await rowsFor({ clients: [client()], call_outcomes: [], brain_files: [lone], brain_chunks: [chunk(lone)] }))[U], "PASS");
    const demo = file();
    assert.equal((await rowsFor({ clients: [client({ is_demo: true })], call_outcomes: [call()], brain_files: [demo], brain_chunks: [chunk(demo)] }))[U], "PASS");
    assert.equal((await rowsFor({ clients: [client()], call_outcomes: [call({ logged_at: ago(480), transcript: "words" })] }))[U], "PASS");
    const notes = file({ name: "Weekly sync notes" });
    assert.equal((await rowsFor({ clients: [client()], call_outcomes: [call()], brain_files: [notes], brain_chunks: [chunk(notes)] }))[U], "PASS");
  });
});
