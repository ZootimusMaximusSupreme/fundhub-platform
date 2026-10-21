import test from "node:test";
import assert from "node:assert/strict";
import * as beat from "./beat-message-health.mjs";
import * as smsTruth from "./lib/sms-truth.mjs";
import * as msgTruth from "./lib/msg-truth.mjs";
import * as smsLane from "../coverage/gap-sms.mjs";
import * as msgLane from "../coverage/gap-msg.mjs";
import { checkBeatSelfTest, runBeat, validateBeat } from "./contract.mjs";
import { makeFakeCtx } from "./ctx.mjs";
import { DEFAULT_ORG_SQL, SELF_TEST_NOW, SELF_TEST_ORG, laneSelfTest } from "./lib/money-hourly.mjs";
import { loadBeats } from "./index.mjs";
import { TRIPWIRES } from "../tripwires.mjs";

const compact = (sql) => String(sql).trim().replaceAll(/\s+/g, " ");

/** One red answer per check: the step it must stop at, the read it comes from, and the rows that read returns. */
const RED = Object.freeze({
  "gap-sms-sending-stuck": [smsTruth.SENDING_SQL, [{ customer_n: 1, staff_n: 0 }]],
  "gap-sms-journey-zero": [smsTruth.buildJourneyZeroSql(), [{ n: 1, names: ["entry.captured"] }]],
  "gap-msg-inbound-unmatched": [smsTruth.REPLY_SQL, [{ own_n: 0, real_n: 1, saved_n: 0, lost_n: 1, unlinked_n: 0, matchable_n: 0 }]],
  "msg-sent-body-blanks": [msgTruth.BLANKS_SQL, [{ template_key: "EMAIL-X", channel: "email", n: 1, dollar_n: 1, spaces_n: 0, braces_n: 0, words_n: 0, greeting_n: 0 }]],
  "msg-staff-template-to-client": [msgTruth.STAFF_TO_CLIENT_SQL, [{ template_key: "DPC-05", channel: "email", n: 1, client_n: 1 }]],
  "msg-links-in-body": [msgTruth.LINK_BODIES_SQL, [{ template_key: "EMAIL-X", channel: "email", rendered_body: '<a href="">Open</a>' }]],
  "msg-per-template-path": [msgTruth.TEMPLATE_PATH_SQL, [{ template_key: "EMAIL-X", channel: "email", aged_n: 3, delivered_n: 0, waiting_n: 0, sent_n: 3, failed_n: 0 }]],
  "msg-brakes": [msgTruth.DAILY_SENDS_SQL, [{ day: "2026-10-08T00:00:00.000Z", n: 900 }]]
});

function redSpec(sql, rows) {
  return laneSelfTest({ ...beat.LANE, selfTest: { passRows: beat.LANE.selfTest.passRows, failRows: [[sql, rows]] } }, true);
}

test("message-health is valid, goes green on a quiet day and red at the sending step", async () => {
  assert.deepEqual(validateBeat(beat, { file: "beat-message-health.mjs" }), []);
  assert.deepEqual(await checkBeatSelfTest(beat), []);
  const passed = await runBeat(beat, makeFakeCtx(beat, beat.selfTest.pass()));
  assert.equal(passed.ok, true);
  assert.match(passed.detail, /^8 message checks passed$/);
  const failed = await runBeat(beat, makeFakeCtx(beat, beat.selfTest.fail()));
  assert.equal(failed.ok, false);
  assert.equal(failed.step, "gap-sms-sending-stuck");
  assert.match(failed.detail, /1 customer text and 0 staff texts are stuck on sending/);
  // A red step ends the beat: the steps run are the ones up to and including it.
  assert.deepEqual(failed.steps.map((step) => step.name), beat.steps.slice(0, beat.steps.indexOf("gap-sms-sending-stuck") + 1));
});

test("message-health: each of its eight checks can go red on its own", async () => {
  assert.deepEqual(Object.keys(RED), beat.steps.filter((step) => step !== "read"));
  for (const [step, [sql, rows]] of Object.entries(RED)) {
    const result = await runBeat(beat, makeFakeCtx(beat, redSpec(sql, rows)));
    assert.equal(result.ok, false, step);
    assert.equal(result.step, step, `${step}: ${result.detail}`);
  }
});

test("message-health: a read that fails or a count that comes back unreadable is never green", async () => {
  // Every read throws except the company lookup: each check is skip with the reason, never PASS.
  const broken = {
    now: new Date(SELF_TEST_NOW.getTime()),
    read: async (sql) => {
      if (compact(sql) === compact(DEFAULT_ORG_SQL)) return { rows: [{ id: SELF_TEST_ORG }], rowCount: 1 };
      throw new Error("connection reset");
    },
    env: {},
    http: {}
  };
  const result = await runBeat(beat, makeFakeCtx(beat, broken));
  assert.equal(result.ok, true);
  assert.match(result.detail, /^0 message checks passed; 8 had nothing safe to judge$/);
  assert.ok(result.steps.filter((step) => step.name !== "read").every((step) => step.skipped), JSON.stringify(result.steps));

  // A count that is not a number is a skip too.
  const junk = await runBeat(beat, makeFakeCtx(beat, redSpec(smsTruth.SENDING_SQL, [{ customer_n: "lots", staff_n: 0 }])));
  assert.equal(junk.ok, true);
  assert.ok(junk.steps.find((step) => step.name === "gap-sms-sending-stuck").skipped);
});

test("message-health: the daily lanes and the hourly beat share one SQL and one judge", async () => {
  assert.equal(smsLane.smsChecks, smsTruth.smsChecks);
  assert.equal(smsLane.msgChecks, smsTruth.msgChecks);
  assert.equal(smsLane.SENDING_SQL, smsTruth.SENDING_SQL);
  assert.equal(smsLane.REPLY_SQL, smsTruth.REPLY_SQL);
  assert.equal(smsLane.buildJourneyZeroSql, smsTruth.buildJourneyZeroSql);
  assert.equal(msgLane.runMsgTruthChecks, msgTruth.runMsgTruthChecks);
  assert.equal(msgLane.BLANKS_SQL, msgTruth.BLANKS_SQL);
  assert.equal(msgLane.TEMPLATE_PATH_SQL, msgTruth.TEMPLATE_PATH_SQL);
  assert.equal(msgLane.DUPLICATE_TEXTS_SQL, msgTruth.DUPLICATE_TEXTS_SQL);
  assert.deepEqual(msgTruth.TRUTH_CHECK_IDS, msgLane.CHECK_IDS.slice(0, 5));
  for (const id of beat.SMS_IDS) assert.ok(smsTruth.SMS_CHECK_IDS.includes(id), id);
  for (const id of beat.QUEUE_IDS) assert.ok(smsTruth.MSG_CHECK_IDS.includes(id), id);

  // Same answers in, same rows out: every red answer at once, through the lanes and through the beat.
  const answers = new Map(Object.values(RED).map(([sql, rows]) => [compact(sql), rows]));
  for (const [sql, rows] of beat.LANE.selfTest.passRows) if (!answers.has(compact(sql))) answers.set(compact(sql), rows);
  const query = async (sql) => {
    const rows = answers.get(compact(sql)) || [];
    return { rows, rowCount: rows.length };
  };
  const now = new Date(SELF_TEST_NOW.getTime());
  const daily = [
    ...(await smsLane.gapChecks({ db: { query }, orgId: SELF_TEST_ORG, now })),
    ...(await msgLane.gapChecks({ db: { query }, orgId: SELF_TEST_ORG, now }))
  ];
  const hourly = await beat.LANE.run({ read: query, orgId: SELF_TEST_ORG, now, readWeb: async () => ({ status: 200 }) });
  assert.equal(hourly.length, beat.HOURLY_CHECK_IDS.length);
  for (const row of hourly) {
    const twin = daily.find((candidate) => candidate.id === row.id);
    assert.ok(twin, `${row.id} is not in the morning lanes`);
    assert.equal(row.status, "FAIL", row.id);
    assert.deepEqual(row, twin, row.id);
  }
});

test("message-health: every surface it covers is a tripwire whose deep checks run hourly", async () => {
  const hourly = new Set((await loadBeats()).flatMap((loaded) => (Array.isArray(loaded.checkIds) ? loaded.checkIds : [])));
  for (const checkId of beat.HOURLY_CHECK_IDS) assert.ok(hourly.has(checkId), `${checkId} is not on the loaded beat list`);
  for (const surface of beat.covers) {
    const wire = TRIPWIRES[surface];
    assert.ok(wire, `${surface} is not a tripwire`);
    for (const checkId of wire.checks) assert.ok(hourly.has(checkId), `${surface} needs ${checkId}, which no hourly beat runs`);
  }
  // The one check it leans on from another beat: the welcome hand-off runs hourly in lead-handoff.
  assert.ok(!beat.HOURLY_CHECK_IDS.includes("handoff:lead-first-touches-missing"));
  assert.ok(TRIPWIRES["job:s-00-welcome"].checks.includes("handoff:lead-first-touches-missing"));
});

test("message-health: the link opener reads only our two declared hosts, with GET or HEAD, and asks a silent page once", async () => {
  assert.deepEqual(beat.reads.map((entry) => entry.host).sort(), [...beat.LINK_HOSTS].sort());
  for (const entry of beat.reads) assert.deepEqual(entry.methods, ["GET", "HEAD"]);
  const calls = [];
  const open = beat.pageOpener({
    readWeb: async (method, url) => {
      calls.push(`${method} ${url}`);
      if (url.endsWith("/silent")) return { status: 0 };
      return { status: url.endsWith("/gone") ? 404 : 200 };
    }
  });
  assert.deepEqual(await open("https://fundhub.ai/a.html", { method: "HEAD" }), { status: 200 });
  assert.deepEqual(await open("https://apply.fundhub.ai/gone", { method: "GET" }), { status: 404 });
  await assert.rejects(() => open("https://www.fundhub.ai/x", { method: "HEAD" }), /not opened from the hourly check/);
  await assert.rejects(() => open("https://evil.example/x", { method: "POST" }), /not opened from the hourly check/);
  await assert.rejects(() => open("https://fundhub.ai/silent", { method: "HEAD" }), /no answer/);
  await assert.rejects(() => open("https://fundhub.ai/silent", { method: "HEAD" }), /no answer earlier/);
  assert.deepEqual(calls, ["HEAD https://fundhub.ai/a.html", "GET https://apply.fundhub.ai/gone", "HEAD https://fundhub.ai/silent"]);

  // Through the shared judge: a dead page of ours is red, a page on a host we do not open from here is a skip.
  const dead = await msgTruth.judgeLinkRows(
    [{ template_key: "EMAIL-X", rendered_body: "https://fundhub.ai/gone" }],
    { openPage: open, budgetMs: beat.LINK_BUDGET_MS }
  );
  assert.equal(dead.status, "FAIL");
  assert.match(dead.detail, /answered 404/);
  const other = await msgTruth.judgeLinkRows(
    [{ template_key: "EMAIL-X", rendered_body: "https://www.fundhub.ai/x" }],
    { openPage: open, budgetMs: beat.LINK_BUDGET_MS }
  );
  assert.equal(other.status, "skip");
});
