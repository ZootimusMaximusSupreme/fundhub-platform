// beat-engine-alive: each step has a PASS and a FAIL case, the beat is read only, and it goes red at the right step.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as beat from "./beat-engine-alive.mjs";
import { validateBeat, runBeat, checkBeatSelfTest, pinBeatSource, missingFixGuidePaths } from "./contract.mjs";
import { makeFakeCtx, ctxLog } from "./ctx.mjs";
import { JOBS } from "../heartbeats.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const NOW_ISO = "2026-10-10T04:07:00.000Z";
const NOW = Date.parse(NOW_ISO);
const MIN = 60 * 1000;
const [SWEEPER, WATCH] = beat.WATCHED_JOBS;

/* minutesAgo list -> receipt rows for one job */
const rowsFor = (job, agos) => agos.map((m) => ({ job, finished_at: new Date(NOW - m * MIN).toISOString(), db_now: NOW_ISO }));
const every5 = (from = 90, to = 2) => {
  const out = [];
  for (let m = from; m >= to; m -= 5) out.push(m);
  return out;
};

async function go(rows) {
  const ctx = makeFakeCtx(beat, { read: [{ match: /FROM job_heartbeats/, rows }] });
  const result = await runBeat(beat, ctx);
  return { result, log: ctxLog(ctx) };
}

test("engine-alive: valid, covers the two real 5-minute jobs, and the fix guide names files that exist", () => {
  assert.deepEqual(validateBeat(beat, { file: "beat-engine-alive.mjs" }), []);
  assert.equal(beat.id, "engine-alive");
  assert.equal(beat.box, false);
  assert.deepEqual(beat.covers, ["job:message-dispatch-sweeper", "job:pulse-instant-watch"]);
  for (const job of beat.WATCHED_JOBS) {
    const row = JOBS.find((j) => j.job === job);
    assert.ok(row, `${job} is a registered job`);
    assert.equal(row.cron, "*/5 * * * *", `${job} ticks every 5 minutes`);
  }
  assert.deepEqual(beat.steps, ["receipts-fresh", "no-quiet-stretch"]);
  const { paths, missing } = missingFixGuidePaths(beat.fixGuide, (p) => fs.existsSync(path.join(ROOT, p)));
  assert.ok(paths.length >= 3);
  assert.deepEqual(missing, []);
});

test("engine-alive: the file passes the static pin (no database, no fetch, no sender)", () => {
  assert.deepEqual(pinBeatSource(fs.readFileSync(path.join(HERE, "beat-engine-alive.mjs"), "utf8"), { role: "beat" }), []);
});

test("engine-alive: its own selfTest passes and fails at a declared step", async () => {
  assert.deepEqual(await checkBeatSelfTest(beat), []);
  const red = await runBeat(beat, makeFakeCtx(beat, beat.selfTest.fail()));
  assert.deepEqual([red.ok, red.step], [false, "no-quiet-stretch"]);
});

test("engine-alive PASS: both jobs ticking every 5 minutes is green, one read, no web call", async () => {
  const { result, log } = await go([...rowsFor(SWEEPER, every5()), ...rowsFor(WATCH, every5())]);
  assert.deepEqual([result.ok, result.step], [true, "done"]);
  assert.equal(log.reads.length, 1);
  assert.deepEqual(log.http, []);
  assert.deepEqual(log.refused, []);
  assert.match(result.detail, /both 5-minute alarms are ticking/);
});

test("engine-alive FAIL receipts-fresh: the newest receipt is 30 minutes old", async () => {
  const old = every5(120, 30).filter((m) => m <= 90);
  const { result } = await go([...rowsFor(SWEEPER, old), ...rowsFor(WATCH, old)]);
  assert.deepEqual([result.ok, result.step], [false, "receipts-fresh"]);
  assert.match(result.detail, /last ran 30 minutes ago/);
  assert.match(result.detail, /engine may be down/);
});

test("engine-alive FAIL receipts-fresh: one job has no receipt at all", async () => {
  const { result } = await go(rowsFor(SWEEPER, every5()));
  assert.deepEqual([result.ok, result.step], [false, "receipts-fresh"]);
  assert.match(result.detail, /pulse-instant-watch saved no receipt/);
});

test("engine-alive FAIL receipts-fresh: no receipts from either job", async () => {
  const { result } = await go([]);
  assert.deepEqual([result.ok, result.step], [false, "receipts-fresh"]);
});

test("engine-alive FAIL no-quiet-stretch: a 46 minute stall that already ended, with Arizona times", async () => {
  // Real shape of 2026-10-09: silent 46 minutes, then a catch-up burst. Here it ended 14 minutes ago.
  const agos = [...every5(90, 60), 14, 8, 8, 7, 6, 5, 2];
  const { result } = await go([...rowsFor(SWEEPER, agos), ...rowsFor(WATCH, agos)]);
  assert.deepEqual([result.ok, result.step], [false, "no-quiet-stretch"]);
  assert.match(result.detail, /went quiet for 46 minutes/);
  assert.match(result.detail, /\d{1,2}:\d{2} [ap]\.m\. to \d{1,2}:\d{2} [ap]\.m\./);
});

test("engine-alive PASS: a stall that ended more than 70 minutes ago is not reported again", async () => {
  // The only gap is 95 to 72 minutes ago (23 min): the later receipt is older than the 70 minute look-back.
  const agos = [95, 72, ...every5(67, 2)];
  const { result } = await go([...rowsFor(SWEEPER, agos), ...rowsFor(WATCH, agos)]);
  assert.deepEqual([result.ok, result.step], [true, "done"]);
});

test("engine-alive: a failed read is red, never green, and says no secret", async () => {
  const ctx = makeFakeCtx(beat, { read: async () => { throw new Error("boom postgres://user:secret@host"); } });
  const result = await runBeat(beat, ctx);
  assert.equal(result.ok, false);
  assert.doesNotMatch(JSON.stringify(result), /postgres:|secret|@host/);
});
