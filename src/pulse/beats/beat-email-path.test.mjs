// beat-email-path: every step has a PASS case and a FAIL case, the beat is read only, and it goes red at the right step.
// The SQL under it is proven on a real database in lib/send-path.pg.test.mjs (read only).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as beat from "./beat-email-path.mjs";
import { validateBeat, runBeat, checkBeatSelfTest, pinBeatSource, missingFixGuidePaths } from "./contract.mjs";
import { makeFakeCtx, ctxLog } from "./ctx.mjs";
import { EMAIL_PATH, EMAIL_STEPS, fakeReads, FIXTURE_NOW } from "./lib/send-path.mjs";
import { JOBS } from "../heartbeats.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const SECRET = "ab".repeat(32);
const LIVE_OK = { NETLIFY: "true", MESSAGING_DRY_RUN: "0", UNSUBSCRIBE_TOKEN_SECRET: SECRET };
const at = (m) => new Date(Date.parse(FIXTURE_NOW) - m * 60 * 1000);

/* Run the beat on a fake ctx. over.env is the settings, the other keys replace one labelled read. */
async function go({ env = {}, ...over } = {}) {
  const ctx = makeFakeCtx(beat, { env, read: fakeReads(EMAIL_PATH, over) });
  const result = await runBeat(beat, ctx);
  return { result, log: ctxLog(ctx) };
}

test("email-path: the beat is valid, on the real sweeper job, and the fix guide names files that exist", async () => {
  assert.deepEqual(validateBeat(beat, { file: "beat-email-path.mjs" }), []);
  assert.equal(beat.id, "email-path");
  assert.equal(beat.kind, "send");
  assert.equal(beat.box, false);
  assert.equal(beat.damp, 1);
  assert.deepEqual(beat.covers, ["job:message-dispatch-sweeper"]);
  assert.ok(JOBS.some((j) => j.job === "message-dispatch-sweeper"), "the covered job is a registered job");
  assert.deepEqual(beat.steps, ["fence-open", "template-ready", "dispatcher-alive", "queue-moving", "failures-recent", "receipts-moving", "opt-out-readable", "unsubscribe-secret"]);
  assert.deepEqual(beat.reads, [], "an email beat makes no web call at all");
  const { paths, missing } = missingFixGuidePaths(beat.fixGuide, (p) => fs.existsSync(path.join(ROOT, p)));
  assert.ok(paths.length >= 4);
  assert.deepEqual(missing, [], "every file in the fix guide exists");
  for (const word of ["sweeper", "Resend", "domain", "MESSAGING_DRY_RUN", "lorem ipsum", "[DRAFT]", "send switch", "UNSUBSCRIBE_TOKEN_SECRET"]) {
    assert.ok(beat.fixGuide.includes(word), `the fix guide should mention ${word}`);
  }
  assert.ok(!/\*{4}/.test(beat.fixGuide), "no mask in the fix guide");
});

test("email-path: the file and its helper pass the static pin (no database, no fetch, no sender)", () => {
  assert.deepEqual(pinBeatSource(fs.readFileSync(path.join(HERE, "beat-email-path.mjs"), "utf8"), { role: "beat" }), []);
  assert.deepEqual(pinBeatSource(fs.readFileSync(path.join(HERE, "lib/send-path.mjs"), "utf8"), { role: "lib" }), []);
});

test("email-path: its own selfTest passes and fails at a declared step", async () => {
  assert.deepEqual(await checkBeatSelfTest(beat), []);
  const red = await runBeat(beat, makeFakeCtx(beat, beat.selfTest.fail()));
  assert.deepEqual([red.ok, red.step], [false, "queue-moving"]);
  assert.ok(red.notRun.includes("failures-recent"), "the steps after the red did not run");
});

test("email-path PASS: a healthy line is green on a laptop: 7 steps run, the 8th is skipped, 7 reads and makes no web call", async () => {
  const { result, log } = await go();
  assert.deepEqual([result.ok, result.step], [true, "done"]);
  assert.deepEqual(result.steps.map((s) => s.name), EMAIL_STEPS);
  assert.deepEqual(result.notRun, []);
  assert.deepEqual(result.skipped, ["unsubscribe-secret"], "the secret step needs the live server and is skipped, never red, on a laptop");
  assert.match(result.detail, /unsubscribe-secret skipped/);
  assert.equal(log.reads.length, 7);
  assert.deepEqual(log.http, []);
  assert.deepEqual(log.refused, []);
  assert.ok(log.reads.every((r) => /^\/\* pulse send-path: [a-z-]+ \*\/\s*(SELECT|WITH)/.test(r.sql)), "every read is a labelled SELECT");
  assert.match(result.detail, /email path alive/);
  assert.equal(result.evidence.channel, "email");
  assert.equal(result.evidence.templatesChecked, 4);
  assert.doesNotMatch(JSON.stringify(result.evidence), /@|\+1|\d{10}/, "no address or number in the evidence");
});

test("email-path PASS on the live server: the fence is read and open", async () => {
  const { result } = await go({ env: LIVE_OK });
  assert.equal(result.ok, true);
  assert.equal(result.evidence.fence.dryRunFence, "open");
  assert.doesNotMatch(result.detail, /not read/);
});

/* ---------------- fence-open ---------------- */

test("email-path fence-open FAIL: switch off, no route, route off", async () => {
  const off = await go({ fence: { outbound_enabled: false } });
  assert.deepEqual([off.result.ok, off.result.step], [false, "fence-open"]);
  assert.match(off.result.detail, /send switch is OFF/);
  assert.equal(off.log.reads.length, 1, "it stopped at the first red");
  const noRoute = await go({ fence: { has_route: false, route_enabled: null, provider: null } });
  assert.equal(noRoute.result.step, "fence-open");
  assert.match(noRoute.result.detail, /No route is saved for emails/);
  const routeOff = await go({ fence: { route_enabled: false } });
  assert.match(routeOff.result.detail, /route for emails is switched off/);
  const noCompany = await go({ fence: [] });
  assert.match(noCompany.result.detail, /No default company/);
});

test("email-path fence-open FAIL on the live server: MESSAGING_DRY_RUN unset, on, or garbled closes the fence", async () => {
  for (const value of [undefined, "", "1", "true", "on", "garbage"]) {
    const env = { NETLIFY: "true", UNSUBSCRIBE_TOKEN_SECRET: SECRET, ...(value === undefined ? {} : { MESSAGING_DRY_RUN: value }) };
    const { result } = await go({ env });
    assert.deepEqual([result.ok, result.step], [false, "fence-open"], `value ${JSON.stringify(value)}`);
    assert.match(result.detail, /MESSAGING_DRY_RUN is not set to an off value/);
  }
  for (const value of ["0", "false", "no", "off", "OFF"]) {
    assert.equal((await go({ env: { NETLIFY: "true", UNSUBSCRIBE_TOKEN_SECRET: SECRET, MESSAGING_DRY_RUN: value } })).result.ok, true, `value ${value}`);
  }
});

test("email-path: on a laptop the env fence is NOT read, so a closed laptop copy is not a break", async () => {
  const { result } = await go({ env: { MESSAGING_DRY_RUN: "1" } });
  assert.equal(result.ok, true);
  assert.match(result.detail, /MESSAGING_DRY_RUN not read \(not the live server\)/);
});

/* ---------------- template-ready ---------------- */

test("email-path template-ready FAIL: missing, not approved, lorem ipsum, a draft mark", async () => {
  const rows = (over) => EMAIL_PATH.templates.map((key, i) => ({ template_key: key, compliance_passed: true, body: "Hello from Fundhub", subject: null, ...(over(i) || {}) }));
  const cases = [
    [rows((i) => (i === 0 ? { compliance_passed: false } : null)), /EMAIL-S00-WELCOME is not approved/],
    [rows((i) => (i === 1 ? { body: "Lorem ipsum dolor sit amet" } : null)), /EMAIL-S04-01-CONFIRM still has lorem ipsum/],
    [rows((i) => (i === 2 ? { body: "[DRAFT] write me" } : null)), /EMAIL-PORTAL-MAGIC-LINK still has a \[DRAFT\] mark/],
    [rows(() => null).slice(1), /EMAIL-S00-WELCOME is missing/]
  ];
  for (const [templates, re] of cases) {
    const { result } = await go({ templates });
    assert.deepEqual([result.ok, result.step], [false, "template-ready"]);
    assert.match(result.detail, re);
  }
});

test("email-path template-ready PASS: flagged templates that are NOT on the launch path do not turn it red", async () => {
  // the read asks only for the launch keys, so a lorem template elsewhere (BS-REPAIR-...) never reaches the judge
  const ctx = makeFakeCtx(beat, { read: fakeReads(EMAIL_PATH) });
  await runBeat(beat, ctx);
  const sql = ctxLog(ctx).reads.find((r) => r.sql.includes("send-path: templates"));
  assert.deepEqual(sql.params, ["email", [...EMAIL_PATH.templates]]);
  assert.match(sql.sql, /template_key = ANY\(\$2::text\[\]\)/);
});

/* ---------------- dispatcher-alive ---------------- */

test("email-path dispatcher-alive FAIL: no run, 16 minutes old, two errors in a row; PASS at 15 minutes", async () => {
  const none = await go({ heartbeat: [] });
  assert.deepEqual([none.result.ok, none.result.step], [false, "dispatcher-alive"]);
  assert.match(none.result.detail, /no run on record/);
  const late = await go({ heartbeat: [{ finished_at: at(16), outcome: "ok" }] });
  assert.equal(late.result.step, "dispatcher-alive");
  assert.match(late.result.detail, /last ran 16 min ago/);
  const errs = await go({ heartbeat: [{ finished_at: at(1), outcome: "error" }, { finished_at: at(6), outcome: "error" }] });
  assert.match(errs.result.detail, /both ended in an error/);
  assert.equal((await go({ heartbeat: [{ finished_at: at(15), outcome: "ok" }] })).result.ok, true);
  assert.equal((await go({ heartbeat: [{ finished_at: at(1), outcome: "error" }, { finished_at: at(6), outcome: "ok" }] })).result.ok, true);
});

/* ---------------- queue-moving ---------------- */

test("email-path queue-moving FAIL: emails waiting over 15 minutes, emails stuck on sending over 10", async () => {
  const q = await go({ queue: { queued_n: 4, oldest_queued: at(31), sample_error: "Resend 422 for jane.doe@example.com" } });
  assert.deepEqual([q.result.ok, q.result.step], [false, "queue-moving"]);
  assert.match(q.result.detail, /^4 emails have waited in the line for over 15 minutes \(oldest 31 min\)/);
  assert.doesNotMatch(q.result.detail, /jane|example/, "the address is cleaned out");
  const s = await go({ queue: { sending_n: 1, oldest_sending: at(14) } });
  assert.equal(s.result.step, "queue-moving");
  assert.match(s.result.detail, /1 email was picked up and never finished for over 10 minutes/);
});

test("email-path queue-moving: the cutoffs sent to the database are 15 and 10 minutes back, and the test-address pattern rides along", async () => {
  const ctx = makeFakeCtx(beat, { read: fakeReads(EMAIL_PATH) });
  await runBeat(beat, ctx);
  const q = ctxLog(ctx).reads.find((r) => r.sql.includes("send-path: queue"));
  assert.equal(q.params[0], "email");
  assert.equal(q.params[1], at(15).toISOString());
  assert.equal(q.params[2], at(10).toISOString());
  assert.match(q.params[3], /e2e\|demo\|test/);
});

/* ---------------- failures-recent ---------------- */

test("email-path failures-recent FAIL: 3 failed and none through; PASS for one bad address", async () => {
  const bad = await go({ failures: { failed_n: 3, ok_n: 0, sample_error: "Resend 401: API key is invalid" } });
  assert.deepEqual([bad.result.ok, bad.result.step], [false, "failures-recent"]);
  assert.match(bad.result.detail, /3 emails failed in the last hour and 0 went through\. Last error: Resend 401/);
  const one = await go({ failures: { failed_n: 1, ok_n: 0 } });
  assert.equal(one.result.ok, true);
  assert.match(one.result.detail, /1 failed, bounced or refused in the last hour out of 1/);
  assert.equal((await go({ failures: { failed_n: 3, ok_n: 9 } })).result.ok, true);
});

test("email-path failures-recent: the window is the last hour", async () => {
  const ctx = makeFakeCtx(beat, { read: fakeReads(EMAIL_PATH) });
  await runBeat(beat, ctx);
  const f = ctxLog(ctx).reads.find((r) => r.sql.includes("send-path: failures"));
  assert.equal(f.params[1], at(60).toISOString());
});

test("email-path failures-recent: messages our own sender REFUSES turn it red (a broken gate drops every email and nothing fails)", async () => {
  const bad = await go({ failures: { blocked_n: 3, ok_n: 0, sample_block: "gate_error" } });
  assert.deepEqual([bad.result.ok, bad.result.step], [false, "failures-recent"]);
  assert.match(bad.result.detail, /3 emails were refused by our own sender in the last hour and 0 went through\. Block code: gate_error/);
  const placeholder = await go({ failures: { blocked_n: 4, ok_n: 2, sample_block: "placeholder_copy" } });
  assert.equal(placeholder.result.ok, false);
  assert.match(placeholder.result.detail, /placeholder_copy/);
  // outnumbered by sends, or too few, is a note and not a red
  assert.equal((await go({ failures: { blocked_n: 3, ok_n: 9 } })).result.ok, true);
  const two = await go({ failures: { blocked_n: 2, ok_n: 0 } });
  assert.equal(two.result.ok, true);
  assert.match(two.result.detail, /2 failed, bounced or refused in the last hour out of 2/);
  assert.equal(two.result.evidence.blockedLastHour, 2);
});

test("email-path: the deadline is the 12 second maximum (all beats share one connection, and 8 s was too thin)", () => {
  assert.equal(beat.deadlineMs, 12000);
});

test("email-path fix guide: does not claim the sweeper's own failures show at dispatcher-alive", () => {
  assert.doesNotMatch(beat.fixGuide, /fails every pass \(shows at dispatcher-alive\)/);
  assert.match(beat.fixGuide, /stopped running \(shows at dispatcher-alive\)/);
  assert.match(beat.fixGuide, /queue-moving after 15 minutes/);
  assert.match(beat.fixGuide, /refused/);
});

/* ---------------- receipts-moving ---------------- */

test("email-path receipts-moving: AMBER only. No receipts at all is still GREEN, with a note", async () => {
  const amber = await go({ receipts: { handed_n: 12, receipts_n: 0, waiting_n: 12 } });
  assert.deepEqual([amber.result.ok, amber.result.step], [true, "done"], "never red alone");
  assert.match(amber.result.detail, /AMBER receipts: 12 emails handed off in 24 h and none has a delivery receipt/);
  assert.equal(amber.result.evidence.receipts.amber, true);
  const few = await go({ receipts: { handed_n: 2, receipts_n: 0, waiting_n: 2 } });
  assert.equal(few.result.ok, true);
  assert.match(few.result.detail, /too few to judge/);
  assert.doesNotMatch(few.result.detail, /AMBER/);
  const fine = await go({ receipts: { handed_n: 10, receipts_n: 9, waiting_n: 1 } });
  assert.match(fine.result.detail, /receipts: 9 of 10 have a delivery receipt/);
});

test("email-path receipts-moving FAIL only when the read itself breaks", async () => {
  const { result } = await go({ receipts: { error: "canceling statement due to statement timeout" } });
  assert.deepEqual([result.ok, result.step], [false, "receipts-moving"]);
  assert.match(result.detail, /could not read delivery receipts/);
});

/* ---------------- opt-out-readable ---------------- */

test("email-path opt-out-readable FAIL: the list cannot be read, or answers with no row; PASS with an empty list", async () => {
  const err = await go({ "opt-outs": { error: 'relation "opt_outs" does not exist' } });
  assert.deepEqual([err.result.ok, err.result.step], [false, "opt-out-readable"]);
  assert.match(err.result.detail, /could not read the opt-out list/);
  const noRow = await go({ "opt-outs": [] });
  assert.equal(noRow.result.step, "opt-out-readable");
  assert.match(noRow.result.detail, /no row/);
  const empty = await go({ "opt-outs": { total: 0, active_n: 0 } });
  assert.equal(empty.result.ok, true);
  assert.deepEqual(empty.result.evidence.optOuts, { total: 0, active: 0 });
});

/* ---------------- a read that breaks goes red at ITS step ---------------- */

test("email-path: a read that fails (timeout, permission denied) goes red at that step, with the reason, and no data in it", async () => {
  const labels = ["fence", "templates", "heartbeat", "queue", "failures", "receipts", "opt-outs"];
  assert.equal(labels.length, EMAIL_STEPS.length - 1, "the 8th step makes no read");
  for (const [i, label] of labels.entries()) {
    const { result } = await go({ [label]: { error: "permission denied for table messages" } });
    assert.deepEqual([result.ok, result.step], [false, EMAIL_STEPS[i]], label);
    assert.match(result.detail, /could not read .*permission denied/);
  }
});

test("email-path: the beat cannot write or send. A write handed to ctx.read is refused and the run is red", async () => {
  // prove the beat's door is read only by hand: a beat-shaped run that tries an UPDATE is red at no-refusals
  const writer = { ...beat, async run(ctx) { await ctx.step("fence-open", async () => { try { await ctx.read("UPDATE messages SET status = 'sent'"); } catch { /* swallowed */ } }); return ctx.done("done"); } };
  const r = await runBeat(writer, makeFakeCtx(writer, { read: fakeReads(EMAIL_PATH) }));
  assert.deepEqual([r.ok, r.step], [false, "no-refusals"]);
  // and the real beat never refuses
  const { log } = await go();
  assert.deepEqual(log.refused, []);
  assert.ok(log.reads.every((q) => !/\b(insert|update|delete)\b/i.test(q.sql)));
});

/* ---------------- unsubscribe-secret (live server only) ---------------- */

test("email-path unsubscribe-secret PASS: a real 64 character secret on the live server", async () => {
  const { result } = await go({ env: LIVE_OK });
  assert.deepEqual([result.ok, result.step], [true, "done"]);
  assert.deepEqual(result.skipped, []);
  assert.deepEqual(result.steps.map((s) => s.name), EMAIL_STEPS);
  assert.equal(result.evidence.unsubscribeSecret, "good");
  assert.equal((await go({ env: { NETLIFY: "true", MESSAGING_DRY_RUN: "0", DOCUMENT_URL_SECRET: "c".repeat(40) } })).result.ok, true, "the sender falls back to DOCUMENT_URL_SECRET");
});

test("email-path unsubscribe-secret FAIL on the live server: unset, a mask, too short. The value is never in the result", async () => {
  const base = { NETLIFY: "true", MESSAGING_DRY_RUN: "0" };
  for (const [env, re] of [
    [{}, /UNSUBSCRIBE_TOKEN_SECRET is not set/],
    [{ UNSUBSCRIBE_TOKEN_SECRET: "*".repeat(36) }, /row of asterisks/],
    [{ UNSUBSCRIBE_TOKEN_SECRET: "****************f377" }, /row of asterisks/],
    [{ UNSUBSCRIBE_TOKEN_SECRET: "q".repeat(31) }, /shorter than 32/]
  ]) {
    const { result } = await go({ env: { ...base, ...env } });
    assert.deepEqual([result.ok, result.step], [false, "unsubscribe-secret"], JSON.stringify(Object.keys(env)));
    assert.match(result.detail, re);
    for (const v of Object.values(env)) assert.ok(!result.detail.includes(v), "the value is not printed");
  }
});

test("email-path unsubscribe-secret: a bad secret on a LAPTOP is skipped, not red (the laptop holds masks)", async () => {
  const { result } = await go({ env: { UNSUBSCRIBE_TOKEN_SECRET: "*".repeat(36) } });
  assert.deepEqual([result.ok, result.skipped], [true, ["unsubscribe-secret"]]);
});

test("email-path: the secret step runs last, so a red earlier in the line stops the beat before it", async () => {
  const { result } = await go({ env: { NETLIFY: "true", MESSAGING_DRY_RUN: "0" }, queue: { queued_n: 1, oldest_queued: at(40) } });
  assert.deepEqual([result.ok, result.step], [false, "queue-moving"]);
  assert.ok(result.notRun.includes("unsubscribe-secret"));
});

test("email-path: it never calls the dispatcher or the sender, only ctx.read (critic issue 13), and its fix guide says it sends nothing", () => {
  for (const file of ["beat-email-path.mjs", "lib/send-path.mjs"]) {
    const src = fs.readFileSync(path.join(HERE, file), "utf8").split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*")).join("\n");
    for (const banned of ["claimDue", "dispatchDue", "dispatchOne", "sendTemplated", "drainAll", "drainMessageNow", "queueEmail", "ctx.http", "ctx.dbSettings"]) {
      assert.ok(!src.includes(banned), `${file} must not name ${banned}`);
    }
  }
  assert.match(beat.fixGuide, /reads the line and sends nothing/);
});
