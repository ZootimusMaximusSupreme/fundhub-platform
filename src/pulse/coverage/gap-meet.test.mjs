import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { cronIntervalMs, STALE_MULTIPLE } from "../heartbeats.mjs";
import {
  CHECK_IDS,
  MEET_JOB,
  fetchContextCallLimit,
  gapChecks,
  transcriptWaitMs
} from "./gap-meet.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const SRC = fs.readFileSync(path.join(HERE, "gap-meet.mjs"), "utf8");
const ORG = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-10-08T15:00:00Z");

function readTextFor(cron, limit = 3) {
  return (rel) => {
    if (rel.endsWith("meet-transcript-sweeper.mjs")) {
      return `export const SWEEP_CRON = "${cron}";`;
    }
    if (rel.endsWith("context.mjs")) {
      return `SELECT transcript\nFROM call_outcomes\nWHERE client_id = $1\nLIMIT ${limit}`;
    }
    throw new Error(`unexpected read: ${rel}`);
  };
}

function fakeDb({ recording = 0, unreadable = 0, job = { outcome: "ok", error: null, finished_at: NOW } } = {}) {
  return {
    async query(sql) {
      if (/gap:meet-recording-no-transcript/.test(sql)) return { rows: [{ n: recording }] };
      if (/gap:meet-transcript-unreadable/.test(sql)) return { rows: [{ n: unreadable }] };
      if (/gap:meet-transcriber-failed/.test(sql)) {
        if (job == null) return { rows: [] };
        return { rows: [job] };
      }
      throw new Error(`unexpected sql: ${sql}`);
    }
  };
}

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
    assert.match(row.suggestedFix, /Do not call an AI/);
    assert.doesNotMatch(row.suggestedFix, /second watchdog|new watchdog|second tripwire/i);
  } else {
    assert.equal(row.suggestedFix, null);
  }
}

test("gap meet: source stays read-only and does not start a watcher", () => {
  assert.doesNotMatch(SRC, /\b(INSERT|UPDATE|DELETE|DROP)\b/);
  assert.doesNotMatch(SRC, /\bfetch\s*\(/);
  assert.doesNotMatch(SRC, /whisperBytes|sweepMeetTranscripts|createFunction|new Inngest|openai/i);
  assert.doesNotMatch(SRC, /setInterval|setTimeout/);
  assert.deepEqual([...CHECK_IDS], [
    "meet:recording-no-transcript",
    "meet:transcript-unreadable",
    "meet:transcriber-failed"
  ]);
  const jobSql = SRC.slice(SRC.indexOf("gap:meet-transcriber-failed"));
  assert.doesNotMatch(jobSql.slice(0, 400), /interval|now\s*\(/i);
});

test("gap meet: the wait and the call window come from the live code", () => {
  const sweeper = fs.readFileSync(path.join(ROOT, "src/workflows/meet-transcript-sweeper.mjs"), "utf8");
  const cron = sweeper.match(/export const SWEEP_CRON = "([^"]+)"/)[1];
  assert.equal(transcriptWaitMs(), STALE_MULTIPLE * cronIntervalMs(cron));
  assert.equal(transcriptWaitMs(), 30 * 60 * 1000);
  assert.equal(fetchContextCallLimit(), 3);
  const context = fs.readFileSync(path.join(ROOT, "src/agents/context.mjs"), "utf8");
  assert.match(context, /FROM call_outcomes[\s\S]{0,400}?LIMIT\s+3/);
});

test("gap meet: no database skips all three reads", async () => {
  const rows = await gapChecks({ now: NOW, readText: readTextFor("*/10 * * * *") });
  assert.equal(rows.length, 3);
  rows.forEach(shape);
  assert.deepEqual(rows.map((r) => r.status), ["skip", "skip", "skip"]);
});

test("gap meet: no company skips the two data reads and still reads the job", async () => {
  const rows = await gapChecks({
    db: fakeDb({}),
    now: NOW,
    readText: readTextFor("*/10 * * * *")
  });
  rows.forEach(shape);
  assert.deepEqual(rows.map((r) => r.status), ["skip", "skip", "PASS"]);
});

test("gap meet: a clear tape path is three PASS rows", async () => {
  const seen = [];
  const db = {
    async query(sql, params) {
      seen.push({ sql, params });
      if (/gap:meet-transcriber-failed/.test(sql)) {
        return { rows: [{ outcome: "ok", error: null, finished_at: "2026-10-08T14:50:00.000Z" }] };
      }
      return { rows: [{ n: 0 }] };
    }
  };
  const rows = await gapChecks({
    db,
    orgId: ORG,
    now: NOW,
    readText: readTextFor("*/10 * * * *")
  });
  assert.equal(rows.length, 3);
  rows.forEach(shape);
  assert.ok(rows.every((r) => r.status === "PASS"));
  assert.equal(seen.length, 3);
  for (const call of seen) {
    assert.match(call.sql, /^\s*\/\* gap:/);
    assert.doesNotMatch(call.sql, /\b(INSERT|UPDATE|DELETE|DROP)\b/i);
  }
  const recording = seen.find((c) => /gap:meet-recording-no-transcript/.test(c.sql));
  assert.equal(recording.params[0], ORG);
  assert.equal(recording.params[1], "2026-10-08T14:30:00.000Z");
  const unreadable = seen.find((c) => /gap:meet-transcript-unreadable/.test(c.sql));
  assert.equal(unreadable.params[0], ORG);
  assert.equal(unreadable.params[1], 3);
  const job = seen.find((c) => /gap:meet-transcriber-failed/.test(c.sql));
  assert.deepEqual(job.params, [MEET_JOB]);
  assert.match(rows[2].detail, /finished ok/);
});

test("gap meet: each named break is a FAIL and the others stay PASS", async () => {
  const cases = [
    {
      counts: { recording: 2 },
      id: "meet:recording-no-transcript",
      detail: /2 Meet recordings stored with no transcript after the 30-minute wait/
    },
    {
      counts: { unreadable: 1 },
      id: "meet:transcript-unreadable",
      detail: /1 Meet transcript stored where fetchContext cannot read it/
    },
    {
      counts: { job: { outcome: "error", error: "whisper credits", finished_at: NOW } },
      id: "meet:transcriber-failed",
      detail: /meet-transcript-sweeper last run failed/
    }
  ];
  for (const c of cases) {
    const rows = await gapChecks({
      db: fakeDb(c.counts),
      orgId: ORG,
      now: NOW,
      readText: readTextFor("*/10 * * * *")
    });
    rows.forEach(shape);
    const hit = rows.find((r) => r.id === c.id);
    assert.equal(hit.status, "FAIL");
    assert.match(hit.detail, c.detail);
    const rest = rows.filter((r) => r.id !== c.id);
    assert.ok(rest.every((r) => r.status === "PASS"));
  }
});

test("gap meet: an old successful run is not a second lateness watchdog", async () => {
  const rows = await gapChecks({
    db: fakeDb({
      job: { outcome: "ok", error: null, finished_at: "2026-01-01T00:00:00.000Z" }
    }),
    orgId: ORG,
    now: NOW,
    readText: readTextFor("*/10 * * * *")
  });
  rows.forEach(shape);
  const job = rows.find((r) => r.id === "meet:transcriber-failed");
  assert.equal(job.status, "PASS");
  assert.match(job.detail, /finished ok/);
});

test("gap meet: no heartbeat yet is skip, not a failed job", async () => {
  const rows = await gapChecks({
    db: fakeDb({ job: null }),
    orgId: ORG,
    now: NOW,
    readText: readTextFor("*/10 * * * *")
  });
  rows.forEach(shape);
  const job = rows.find((r) => r.id === "meet:transcriber-failed");
  assert.equal(job.status, "skip");
  assert.match(job.detail, /heartbeat yet/);
  assert.ok(rows.filter((r) => r.id !== job.id).every((r) => r.status === "PASS"));
});

test("gap meet: a shorter sweeper schedule shortens the recording wait", async () => {
  const seen = [];
  const db = {
    async query(sql, params) {
      seen.push({ sql, params });
      if (/gap:meet-transcriber-failed/.test(sql)) {
        return { rows: [{ outcome: "ok", error: null, finished_at: NOW }] };
      }
      return { rows: [{ n: 0 }] };
    }
  };
  const rows = await gapChecks({
    db,
    orgId: ORG,
    now: NOW,
    readText: readTextFor("*/5 * * * *", 3)
  });
  rows.forEach(shape);
  assert.ok(rows.every((r) => r.status === "PASS"));
  const recording = seen.find((c) => /gap:meet-recording-no-transcript/.test(c.sql));
  assert.equal(recording.params[1], "2026-10-08T14:45:00.000Z");
  assert.match(rows[0].detail, /15-minute wait/);
});

test("gap meet: a missing schedule or call window is FAIL and does not query that check", async () => {
  const seen = [];
  const db = {
    async query(sql, params) {
      seen.push(sql);
      if (/gap:meet-transcriber-failed/.test(sql)) {
        return { rows: [{ outcome: "ok", error: null, finished_at: NOW }] };
      }
      return { rows: [{ n: 0 }] };
    }
  };
  const rows = await gapChecks({
    db,
    orgId: ORG,
    now: NOW,
    readText: () => "no schedule and no limit here"
  });
  rows.forEach(shape);
  assert.equal(rows[0].status, "FAIL");
  assert.match(rows[0].detail, /wait is unknown/);
  assert.equal(rows[1].status, "FAIL");
  assert.match(rows[1].detail, /fetchContext/);
  assert.equal(rows[2].status, "PASS");
  assert.equal(seen.length, 1);
  assert.match(seen[0], /gap:meet-transcriber-failed/);
});

test("gap meet: a read error is FAIL, not a throw", async () => {
  const db = {
    async query() {
      throw new Error("relation brain_files does not exist");
    }
  };
  const rows = await gapChecks({
    db,
    orgId: ORG,
    now: NOW,
    readText: readTextFor("*/10 * * * *")
  });
  rows.forEach(shape);
  assert.ok(rows.every((r) => r.status === "FAIL"));
  assert.match(rows[0].detail, /brain_files/);
  assert.match(rows[1].detail, /brain_files/);
  assert.match(rows[2].detail, /transcriber job/);
});
