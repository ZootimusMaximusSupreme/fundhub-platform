// The send-path helper: every judge has a PASS case and a FAIL case, the copied constants are held to
// their sources, and every SQL string is a labelled read the read box accepts.
// The SQL itself is proven against a real database in send-path.pg.test.mjs (read only).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as L from "./send-path.mjs";
import { assertReadOnlySql } from "../readbox.mjs";
import { pinBeatSource } from "../contract.mjs";
import { FAKE_NOW } from "../ctx.mjs";
import { fenceVerdict } from "../../../lib/dry-run.mjs";
import { isDraftTemplateCopy } from "../../../messaging/draft-guard.mjs";
import { isPlaceholderCopy } from "../../../messaging/dispatch.mjs";
import { unsubscribeSecret } from "../../../messaging/unsubscribe.mjs";
import { TEST_ADDRESS_RE as GAP_SMS_TEST_ADDRESS_RE } from "../../coverage/gap-sms.mjs";
import { JOBS, cronIntervalMs } from "../../heartbeats.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const NOW = new Date(L.FIXTURE_NOW);
const minAgo = (m) => new Date(NOW.getTime() - m * 60 * 1000);

/* ---------------- held to the sources they were copied from ---------------- */

test("send-path: the constants copied from other files equal those files", async () => {
  assert.equal(L.TEST_ADDRESS_RE, GAP_SMS_TEST_ADDRESS_RE, "the test-address pattern drifted from gap-sms.mjs");
  assert.equal(L.FIXTURE_NOW, FAKE_NOW.toISOString(), "the fixture clock must be the fake ctx clock");
  // the sweeper is a real job on a 5 minute clock, and 15 minutes is 3 times that (heartbeats.mjs STALE_MULTIPLE)
  const job = JOBS.find((j) => j.job === L.SWEEPER_JOB);
  assert.ok(job, "message-dispatch-sweeper must be in JOBS (src/pulse/heartbeats.mjs)");
  assert.equal(L.HEARTBEAT_MAX_MINUTES * 60 * 1000, 3 * cronIntervalMs(job.cron));
  // the two copy guards
  const samples = ["Lorem ipsum dolor", "lorem   IPSUM", "dolor sit amet", "Hi, welcome", "[DRAFT] hello", "[draft x", "[DRAFTED", "A DRAFT of the letter", "", null, undefined];
  for (const s of samples) {
    assert.equal(L.LOREM_RE.test(String(s ?? "")), isPlaceholderCopy(s), `lorem guard drifted on ${JSON.stringify(s)}`);
    assert.equal(L.DRAFT_RE.test(String(s ?? "")), isDraftTemplateCopy(s), `draft guard drifted on ${JSON.stringify(s)}`);
  }
  // the fence grammar
  for (const v of [undefined, null, "", " ", "0", "1", "false", "FALSE", " Off ", "no", "No", "true", "yes", "on", "2", "garbage", "0 "]) {
    const env = v === undefined ? {} : { MESSAGING_DRY_RUN: v };
    assert.equal(L.fenceIsOpen(env.MESSAGING_DRY_RUN), fenceVerdict("MESSAGING_DRY_RUN", env).allowed, `fence grammar drifted on ${JSON.stringify(v)}`);
  }
  assert.equal(L.MESSAGING_FENCE, "MESSAGING_DRY_RUN");
  // the unsubscribe secret rule
  for (const env of [
    {}, { UNSUBSCRIBE_TOKEN_SECRET: "x".repeat(31) }, { UNSUBSCRIBE_TOKEN_SECRET: "x".repeat(32) },
    { DOCUMENT_URL_SECRET: "y".repeat(40) }, { UNSUBSCRIBE_TOKEN_SECRET: "short", DOCUMENT_URL_SECRET: "y".repeat(40) },
    { UNSUBSCRIBE_TOKEN_SECRET: "", DOCUMENT_URL_SECRET: "y".repeat(40) }
  ]) {
    let sender = true;
    try { unsubscribeSecret(env); } catch { sender = false; }
    assert.equal(L.judgeUnsubscribeSecret(env).problem === null, sender, `the secret rule drifted for ${JSON.stringify(Object.keys(env))}`);
  }
});

test("send-path: the template keys are the ones the launch workflows really use", async () => {
  const s00 = await import("../../../workflows/s-00-welcome.mjs");
  const s04 = await import("../../../workflows/s-04b-booking-reminders.mjs");
  const doc = await import("../../../workflows/s-doc-collection.mjs");
  const magic = await import("../../../auth/magic-link.mjs");
  const contract = await import("../../../contracts/notify.mjs");
  assert.deepEqual([...L.TEXT_PATH.templates].sort(), [s00.SMS_TEMPLATE_KEY, s04.SMS_CONFIRM, doc.SMS_TEMPLATE_KEY].sort());
  assert.deepEqual([...L.EMAIL_PATH.templates].sort(), [s00.EMAIL_TEMPLATE_KEY, s04.EMAIL_CONFIRM, magic.MAGIC_LINK_TEMPLATE_KEY, contract.SEND_TEMPLATE_KEY].sort());
  assert.ok(Object.isFrozen(L.TEXT_PATH) && Object.isFrozen(L.TEXT_PATH.templates) && Object.isFrozen(L.EMAIL_PATH.templates));
});

test("send-path: this file passes the same static pin the beats do (no db, no fetch, no process)", () => {
  const src = fs.readFileSync(path.join(HERE, "send-path.mjs"), "utf8");
  assert.deepEqual(pinBeatSource(src, { role: "lib" }), []);
  assert.deepEqual(L.TEXT_STEPS.filter((s) => !L.EMAIL_STEPS.includes(s)), []);
  assert.deepEqual(L.EMAIL_STEPS.filter((s) => !L.TEXT_STEPS.includes(s)), ["unsubscribe-secret"]);
});

/* ---------------- the SQL ---------------- */

const SQLS = { fence: L.FENCE_SQL, templates: L.TEMPLATE_SQL, heartbeat: L.HEARTBEAT_SQL, queue: L.QUEUE_SQL, failures: L.FAILURE_SQL, receipts: L.RECEIPT_SQL, "opt-outs": L.OPT_OUT_SQL };

test("send-path SQL: each string is one labelled read the read box accepts, and only reads the tables it should", () => {
  for (const [label, sql] of Object.entries(SQLS)) {
    assert.doesNotThrow(() => assertReadOnlySql(sql), label);
    assert.ok(sql.startsWith(`/* pulse send-path: ${label} */`), `${label} needs its label comment first (the fake reads and the slow-query log use it)`);
    assert.doesNotMatch(sql, /\b(insert|update|delete|nextval|for\s+update)\b/i, label);
  }
  // the read box is a gate: a write would be refused, so the allow-list really is the thing being passed
  assert.throws(() => assertReadOnlySql("/* pulse send-path: queue */ UPDATE messages SET status = 'sent'"), /pulse_refused_sql/);
});

test("send-path SQL: every message read leaves out demo traffic, test clients and test addresses, and scopes to the default company", () => {
  for (const label of ["queue", "failures", "receipts"]) {
    const sql = SQLS[label];
    assert.match(sql, /COALESCE\(m\.is_demo, false\) = false/, label);
    assert.match(sql, /custom_fields ->> 'synthetic'/, label);
    assert.match(sql, /m\.to_address[^!]*!~\*/, label);
    assert.match(sql, /SELECT id FROM orgs WHERE is_default/, label);
    assert.match(sql, /m\.direction = 'outbound'/, label);
  }
  assert.match(L.QUEUE_SQL, /m\.blocked_reason IS NULL/, "a held message is not stuck");
  assert.match(L.QUEUE_SQL, /COALESCE\(m\.scheduled_at, m\.created_at\)/, "a future scheduled_at is waiting, not stuck");
  assert.match(L.FAILURE_SQL, /%to send to%/, "a client with nowhere to send to is not a provider failure");
});

test("send-path SQL: the parameter numbers match the values the runner passes", async () => {
  const { makeFakeCtx } = await import("../ctx.mjs");
  const beat = { id: "x", steps: [...L.EMAIL_STEPS], reads: [] };
  const seen = [];
  const base = L.fakeReads(L.EMAIL_PATH);
  const ctx = makeFakeCtx(beat, { read: async (text, params) => { seen.push([text, params]); return base(text, params); } });
  await L.runSendPath(ctx, L.EMAIL_PATH);
  assert.equal(seen.length, 7);
  for (const [text, params] of seen) {
    const highest = Math.max(0, ...[...text.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])));
    assert.equal(params.length, highest, `${text.slice(0, 40)}: SQL uses $${highest} but ${params.length} values are passed`);
    assert.ok(highest === 0 || [...Array(highest).keys()].every((i) => text.includes(`$${i + 1}`)), "parameter numbers have a gap");
  }
  // every cutoff passed to the SQL is a plain ISO time, never a function or an object
  for (const [, params] of seen) for (const p of params) assert.ok(typeof p === "string" || Array.isArray(p), "params are strings or arrays");
});

/* ---------------- ageText and cleanError ---------------- */

test("ageText: minutes, hours, days, and unreadable times", () => {
  assert.equal(L.ageText(minAgo(0.2), NOW), "1 min");
  assert.equal(L.ageText(minAgo(42), NOW), "42 min");
  assert.equal(L.ageText(minAgo(180), NOW), "3 h");
  assert.equal(L.ageText(minAgo(60 * 24 * 5), NOW), "5 days");
  assert.equal(L.ageText(minAgo(30).toISOString(), NOW), "30 min");
  assert.equal(L.ageText("not a time", NOW), null);
  assert.equal(L.ageText(null, NOW), null);
});

test("cleanError: a phone number, an email and a long error never reach a record or a text", () => {
  const raw = "The 'To' number +1 (480) 555-0147 is not valid for jane.doe@example.com   at 4805550147";
  const out = L.cleanError(raw, 200);
  assert.doesNotMatch(out, /555|480|jane|example/);
  assert.match(out, /<number>/);
  assert.match(out, /<email>/);
  assert.ok(L.cleanError("x".repeat(500)).length <= 70);
  assert.equal(L.cleanError(null), "");
  assert.equal(L.cleanError("Twilio 30034: message blocked"), "Twilio 30034: message blocked", "an error code stays");
});

/* ---------------- fence-open ---------------- */

const GOOD_FENCE = { has_settings: true, outbound_enabled: true, has_route: true, route_enabled: true, provider: "twilio" };

test("judgeFence PASS: switch on, route on, fence open on the live server", () => {
  const v = L.judgeFence({ row: GOOD_FENCE, live: true, env: { MESSAGING_DRY_RUN: "0" }, path: L.TEXT_PATH });
  assert.deepEqual(v.problems, []);
  assert.deepEqual(v.facts, { switch: "on", route: "on (twilio)", dryRunFence: "open" });
});

test("judgeFence PASS: a missing settings row counts as on (the sender says so); a laptop does not read the fence", () => {
  const v = L.judgeFence({ row: { ...GOOD_FENCE, has_settings: false, outbound_enabled: null }, live: false, env: {}, path: L.EMAIL_PATH });
  assert.deepEqual(v.problems, []);
  assert.equal(v.facts.switch, "no row (counts as on)");
  assert.equal(v.facts.dryRunFence, "not read (laptop copy)");
  assert.equal(v.notes.length, 1);
});

test("judgeFence FAIL: each lock names itself, and a closed fence is never printed with its value", () => {
  const off = L.judgeFence({ row: { ...GOOD_FENCE, outbound_enabled: false }, live: false, env: {}, path: L.TEXT_PATH });
  assert.match(off.problems.join(" "), /send switch is OFF/);
  const noRoute = L.judgeFence({ row: { ...GOOD_FENCE, has_route: false, route_enabled: null, provider: null }, live: false, env: {}, path: L.TEXT_PATH });
  assert.match(noRoute.problems.join(" "), /No route is saved for texts/);
  const routeOff = L.judgeFence({ row: { ...GOOD_FENCE, route_enabled: false }, live: false, env: {}, path: L.EMAIL_PATH });
  assert.match(routeOff.problems.join(" "), /route for emails is switched off/);
  for (const closed of [undefined, "", "1", "true", "on", "yes", "garbage"]) {
    const env = closed === undefined ? {} : { MESSAGING_DRY_RUN: closed };
    const v = L.judgeFence({ row: GOOD_FENCE, live: true, env, path: L.TEXT_PATH });
    assert.equal(v.problems.length, 1, `value ${JSON.stringify(closed)} must close the fence`);
    assert.match(v.problems[0], /MESSAGING_DRY_RUN is not set to an off value/);
    if (closed) assert.ok(!v.problems[0].includes(closed) || closed.length < 2, "the value is not printed");
  }
  const none = L.judgeFence({ row: undefined, live: true, env: {}, path: L.TEXT_PATH });
  assert.match(none.problems[0], /No default company/);
  const all = L.judgeFence({ row: { ...GOOD_FENCE, outbound_enabled: false, has_route: false }, live: true, env: {}, path: L.TEXT_PATH });
  assert.equal(all.problems.length, 3, "all three locks are named together");
});

/* ---------------- template-ready ---------------- */

const tpl = (path_, over = {}) => path_.templates.map((key) => ({ template_key: key, compliance_passed: true, body: "Hi from Fundhub", subject: "Hello", ...over }));

test("judgeTemplates PASS: approved copy with real words", () => {
  assert.deepEqual(L.judgeTemplates({ rows: tpl(L.TEXT_PATH), path: L.TEXT_PATH }), { problems: [], checked: 3 });
  assert.deepEqual(L.judgeTemplates({ rows: tpl(L.EMAIL_PATH, { subject: null }), path: L.EMAIL_PATH }), { problems: [], checked: 4 });
});

test("judgeTemplates FAIL: missing, not approved, empty, lorem ipsum, a draft mark; each names the template key", () => {
  const base = tpl(L.EMAIL_PATH);
  const one = (i, over) => base.map((r, j) => (j === i ? { ...r, ...over } : r));
  const cases = [
    [base.slice(1), /EMAIL-S00-WELCOME is missing/],
    [one(0, { compliance_passed: false }), /EMAIL-S00-WELCOME is not approved/],
    [one(1, { compliance_passed: null }), /EMAIL-S04-01-CONFIRM is not approved/],
    [one(2, { body: "   " }), /EMAIL-PORTAL-MAGIC-LINK has no words/],
    [one(2, { body: null }), /EMAIL-PORTAL-MAGIC-LINK has no words/],
    [one(3, { body: "Lorem ipsum dolor sit amet" }), /CONTRACT-SEND-EMAIL still has lorem ipsum/],
    [one(3, { subject: "LOREM  IPSUM" }), /CONTRACT-SEND-EMAIL still has lorem ipsum/],
    [one(0, { body: "[DRAFT] write this later" }), /EMAIL-S00-WELCOME still has a \[DRAFT\] mark/],
    [one(0, { subject: "[draft subject]" }), /EMAIL-S00-WELCOME still has a \[DRAFT\] mark/]
  ];
  for (const [rows, re] of cases) {
    const v = L.judgeTemplates({ rows, path: L.EMAIL_PATH });
    assert.match(v.problems.join(" "), re);
  }
  // the 15 flagged templates the 6 a.m. lane found (BS-REPAIR-..., S-02) are not on the launch path, so they do not turn this red
  const withOthers = [...tpl(L.TEXT_PATH), { template_key: "BS-REPAIR-D1-E1-morning", compliance_passed: true, body: "Lorem ipsum", subject: null }, { template_key: "S-02", compliance_passed: true, body: "[DRAFT]", subject: null }];
  assert.deepEqual(L.judgeTemplates({ rows: withOthers, path: L.TEXT_PATH }).problems, []);
  assert.equal(L.judgeTemplates({ rows: undefined, path: L.TEXT_PATH }).problems.length, 3);
});

/* ---------------- dispatcher-alive ---------------- */

test("judgeHeartbeat PASS: a pass in the last 15 minutes; one error in a row is not enough", () => {
  assert.equal(L.judgeHeartbeat({ rows: [{ finished_at: minAgo(2), outcome: "ok" }], now: NOW }).problem, null);
  assert.equal(L.judgeHeartbeat({ rows: [{ finished_at: minAgo(15), outcome: "ok" }], now: NOW }).problem, null, "exactly 15 minutes is still on time");
  assert.equal(L.judgeHeartbeat({ rows: [{ finished_at: minAgo(3), outcome: "error" }, { finished_at: minAgo(8), outcome: "ok" }], now: NOW }).problem, null);
  assert.equal(L.judgeHeartbeat({ rows: [{ finished_at: minAgo(3).toISOString(), outcome: "ok" }], now: NOW }).ageMin, 3, "an ISO string works too");
});

test("judgeHeartbeat FAIL: no run, a run 16 minutes ago, two errors in a row, an unreadable time", () => {
  assert.match(L.judgeHeartbeat({ rows: [], now: NOW }).problem, /no run on record/);
  assert.match(L.judgeHeartbeat({ rows: undefined, now: NOW }).problem, /no run on record/);
  const late = L.judgeHeartbeat({ rows: [{ finished_at: minAgo(16), outcome: "ok" }], now: NOW });
  assert.match(late.problem, /last ran 16 min ago/);
  assert.match(L.judgeHeartbeat({ rows: [{ finished_at: minAgo(240), outcome: "ok" }], now: NOW }).problem, /last ran 4 h ago/);
  assert.match(L.judgeHeartbeat({ rows: [{ finished_at: minAgo(2), outcome: "error" }, { finished_at: minAgo(7), outcome: "error" }], now: NOW }).problem, /last 2 passes both ended in an error/);
  assert.match(L.judgeHeartbeat({ rows: [{ finished_at: "garbage", outcome: "ok" }], now: NOW }).problem, /cannot be read/);
});

/* ---------------- queue-moving ---------------- */

test("judgeQueue PASS: an empty line", () => {
  assert.equal(L.judgeQueue({ row: { queued_n: 0, sending_n: 0 }, now: NOW, path: L.TEXT_PATH }).problem, null);
  assert.equal(L.judgeQueue({ row: { queued_n: "0", sending_n: null }, now: NOW, path: L.TEXT_PATH }).problem, null);
  assert.equal(L.judgeQueue({ row: undefined, now: NOW, path: L.TEXT_PATH }).problem, null);
});

test("judgeQueue FAIL: queued past 15 minutes, sending past 10, both; the age is named and the error is cleaned", () => {
  const q = L.judgeQueue({ row: { queued_n: "3", oldest_queued: minAgo(42), sending_n: 0, sample_error: "To +1 480 555 0147 refused" }, now: NOW, path: L.TEXT_PATH });
  assert.match(q.problem, /^3 texts have waited in the line for over 15 minutes \(oldest 42 min\)\./);
  assert.match(q.problem, /Last error: To <number> refused/);
  assert.doesNotMatch(q.problem, /480/);
  const s = L.judgeQueue({ row: { queued_n: 0, sending_n: 1, oldest_sending: minAgo(25) }, now: NOW, path: L.EMAIL_PATH });
  assert.match(s.problem, /^1 email was picked up and never finished for over 10 minutes \(oldest 25 min\)\./);
  const both = L.judgeQueue({ row: { queued_n: 1, oldest_queued: minAgo(20), sending_n: 2, oldest_sending: minAgo(12) }, now: NOW, path: L.EMAIL_PATH });
  assert.match(both.problem, /1 email has waited.*2 emails were picked up/);
  assert.deepEqual([both.queued, both.sending], [1, 2]);
});

/* ---------------- failures-recent ---------------- */

test("judgeFailures PASS: nothing failed, a couple of bad addresses, or failures outnumbered by sends", () => {
  assert.equal(L.judgeFailures({ row: { failed_n: 0, bounced_n: 0, ok_n: 0 }, path: L.TEXT_PATH }).problem, null);
  const two = L.judgeFailures({ row: { failed_n: 2, bounced_n: 0, ok_n: 0 }, path: L.TEXT_PATH });
  assert.equal(two.problem, null);
  assert.match(two.note, /2 failed, bounced or refused in the last hour out of 2 \(too few/);
  assert.equal(L.judgeFailures({ row: { failed_n: 3, bounced_n: 0, ok_n: 4 }, path: L.TEXT_PATH }).problem, null, "3 failed but 4 went through");
  assert.equal(L.judgeFailures({ row: { failed_n: 0, bounced_n: 4, ok_n: 0 }, path: L.EMAIL_PATH }).problem, null, "4 bounces is bad addresses");
  assert.equal(L.judgeFailures({ row: { failed_n: 0, bounced_n: 7, ok_n: 9 }, path: L.EMAIL_PATH }).problem, null);
  assert.equal(L.judgeFailures({ row: undefined, path: L.EMAIL_PATH }).problem, null);
});

test("judgeFailures FAIL: 3 failed with none through (or as many failed as sent), 5 bounced with none through", () => {
  const a = L.judgeFailures({ row: { failed_n: 3, bounced_n: 0, ok_n: 0, sample_error: "Twilio 20003: Authenticate" }, path: L.TEXT_PATH });
  assert.match(a.problem, /^3 texts failed in the last hour and 0 went through\. Last error: Twilio 20003: Authenticate/);
  const b = L.judgeFailures({ row: { failed_n: 3, bounced_n: 0, ok_n: 3 }, path: L.TEXT_PATH });
  assert.match(b.problem, /3 texts failed/);
  const c = L.judgeFailures({ row: { failed_n: 0, bounced_n: 5, ok_n: 5 }, path: L.EMAIL_PATH });
  assert.match(c.problem, /5 emails bounced in the last hour and 5 went through/);
  assert.equal(L.judgeFailures({ row: { failed_n: 1, bounced_n: 0, ok_n: 0 }, path: L.TEXT_PATH }).problem, null, "one failure alone is not a pattern");
});

test("judgeFailures: blocked (refused by our own sender) is red on the pattern, a note below it, and never green when it outnumbers the sends", () => {
  const red = L.judgeFailures({ row: { failed_n: 0, bounced_n: 0, blocked_n: 3, ok_n: 0, sample_block: "gate_error" }, path: L.TEXT_PATH });
  assert.match(red.problem, /^3 texts were refused by our own sender in the last hour and 0 went through\. Block code: gate_error/);
  assert.equal(red.blocked, 3);
  assert.match(L.judgeFailures({ row: { blocked_n: 1, ok_n: 0, sample_block: "draft_template" }, path: L.EMAIL_PATH }).note, /1 failed, bounced or refused/);
  assert.equal(L.judgeFailures({ row: { blocked_n: 1, ok_n: 0 }, path: L.EMAIL_PATH }).problem, null, "one refusal is not a pattern");
  assert.equal(L.judgeFailures({ row: { blocked_n: 4, ok_n: 5 }, path: L.EMAIL_PATH }).problem, null, "outnumbered by sends");
  assert.match(L.judgeFailures({ row: { blocked_n: 4, ok_n: 4 }, path: L.EMAIL_PATH }).problem, /4 emails were refused/);
  // a block code with a phone number in it never reaches the record
  assert.doesNotMatch(L.judgeFailures({ row: { blocked_n: 3, ok_n: 0, sample_block: "bad +1 480 555 0147" }, path: L.TEXT_PATH }).problem, /555/);
  // failed still wins the wording when both are over the bar
  assert.match(L.judgeFailures({ row: { failed_n: 3, blocked_n: 3, ok_n: 0 }, path: L.TEXT_PATH }).problem, /3 texts failed/);
});

test("send-path SQL: the gate codes left out of 'refused' are the person's own doing, by name", () => {
  assert.deepEqual([...L.PERSONAL_BLOCK_CODES].sort(), ["opted_out", "quiet_hours", "recipient_unknown"]);
  assert.deepEqual([...L.PERSONAL_BLOCK_ERRORS], ["retired_ghl_doc"]);
  for (const c of [...L.PERSONAL_BLOCK_CODES, ...L.PERSONAL_BLOCK_ERRORS]) assert.ok(L.FAILURE_SQL.includes(`'${c}'`), c);
  // the codes the gate and dispatch really write are the ones named in the source
  const gate = fs.readFileSync(path.join(HERE, "../../../messaging/gate.mjs"), "utf8");
  for (const c of L.PERSONAL_BLOCK_CODES) assert.ok(gate.includes(`"${c}"`), `${c} is not a code gate.mjs writes`);
  const dispatch = fs.readFileSync(path.join(HERE, "../../../messaging/dispatch.mjs"), "utf8");
  for (const c of ["retired_ghl_doc", "placeholder_copy", "draft_template"]) assert.ok(dispatch.includes(`"${c}"`), `${c} is not written by dispatch.mjs`);
  assert.ok(!L.FAILURE_SQL.includes("'placeholder_copy'") && !L.FAILURE_SQL.includes("'draft_template'"), "these two are real problems and must stay counted");
});

test("send-path header: says plainly that the sweeper's own failures do not show in its heartbeat", () => {
  const src = fs.readFileSync(path.join(HERE, "send-path.mjs"), "utf8");
  assert.match(src, /never throws/);
  assert.match(src, /cannot fire today/);
  assert.match(src, /status "blocked"/);
});

/* ---------------- receipts-moving ---------------- */

test("judgeReceipts: AMBER only. It never returns a problem, whatever the numbers", () => {
  for (const row of [undefined, {}, { handed_n: 0 }, { handed_n: 4, receipts_n: 0, waiting_n: 4 }, { handed_n: 5, receipts_n: 0, waiting_n: 5 }, { handed_n: 200, receipts_n: 0, waiting_n: 200 }, { handed_n: 10, receipts_n: 10, waiting_n: 0 }]) {
    const v = L.judgeReceipts({ row, path: L.TEXT_PATH });
    assert.equal("problem" in v, false, "receipts-moving has no red");
    assert.equal(typeof v.note, "string");
  }
});

test("judgeReceipts: below 5 hand-offs it says too few, at 5 with no receipt it is amber, with receipts it is fine", () => {
  const few = L.judgeReceipts({ row: { handed_n: 4, receipts_n: 0, waiting_n: 4 }, path: L.TEXT_PATH });
  assert.deepEqual([few.amber, /too few to judge/.test(few.note)], [false, true]);
  const amber = L.judgeReceipts({ row: { handed_n: 5, receipts_n: 0, waiting_n: 5 }, path: L.EMAIL_PATH });
  assert.equal(amber.amber, true);
  assert.match(amber.note, /^AMBER receipts: 5 emails handed off in 24 h and none has a delivery receipt/);
  const fine = L.judgeReceipts({ row: { handed_n: 10, receipts_n: 8, waiting_n: 2 }, path: L.EMAIL_PATH });
  assert.deepEqual([fine.amber, fine.note], [false, "receipts: 8 of 10 have a delivery receipt"]);
  assert.match(L.judgeReceipts({ row: { handed_n: 1 }, path: L.TEXT_PATH }).note, /1 text handed off/);
});

/* ---------------- unsubscribe-secret ---------------- */

test("judgeUnsubscribeSecret PASS: a real secret of 32 or more characters, or the fallback when the first is empty", () => {
  assert.deepEqual(L.judgeUnsubscribeSecret({ UNSUBSCRIBE_TOKEN_SECRET: "a1".repeat(32) }), { problem: null, name: "UNSUBSCRIBE_TOKEN_SECRET" });
  assert.deepEqual(L.judgeUnsubscribeSecret({ UNSUBSCRIBE_TOKEN_SECRET: "x".repeat(32) }), { problem: null, name: "UNSUBSCRIBE_TOKEN_SECRET" });
  assert.deepEqual(L.judgeUnsubscribeSecret({ DOCUMENT_URL_SECRET: "b".repeat(48) }), { problem: null, name: "DOCUMENT_URL_SECRET" });
  assert.deepEqual(L.judgeUnsubscribeSecret({ UNSUBSCRIBE_TOKEN_SECRET: "", DOCUMENT_URL_SECRET: "b".repeat(48) }), { problem: null, name: "DOCUMENT_URL_SECRET" });
});

test("judgeUnsubscribeSecret FAIL: unset, a mask, too short; the name is shown, the value never is", () => {
  assert.match(L.judgeUnsubscribeSecret({}).problem, /not set/);
  assert.match(L.judgeUnsubscribeSecret({ UNSUBSCRIBE_TOKEN_SECRET: "*".repeat(40) }).problem, /row of asterisks/);
  assert.match(L.judgeUnsubscribeSecret({ UNSUBSCRIBE_TOKEN_SECRET: "x".repeat(31) }).problem, /shorter than 32/);
  assert.match(L.judgeUnsubscribeSecret({ UNSUBSCRIBE_TOKEN_SECRET: "x".repeat(10), DOCUMENT_URL_SECRET: "y".repeat(50) }).problem, /UNSUBSCRIBE_TOKEN_SECRET is shorter/, "a short first secret does not fall back (the sender throws)");
  assert.match(L.judgeUnsubscribeSecret({ DOCUMENT_URL_SECRET: "****abcd" }).problem, /DOCUMENT_URL_SECRET is a row of asterisks/);
  const secret = "S3cretValue".repeat(2);
  assert.ok(!L.judgeUnsubscribeSecret({ UNSUBSCRIBE_TOKEN_SECRET: secret }).problem?.includes(secret));
  assert.ok(!(L.judgeUnsubscribeSecret({ UNSUBSCRIBE_TOKEN_SECRET: "t".repeat(9) }).problem || "").includes("ttttt"));
});

/* ---------------- fakeReads is not an "answer anything" fake ---------------- */

test("fakeReads: answers only the labelled send-path reads; any other query fails loudly", async () => {
  const read = L.fakeReads(L.TEXT_PATH);
  await assert.rejects(() => read("SELECT 1"), /no canned answer/);
  await assert.rejects(() => read("/* pulse send-path: nope */ SELECT 1"), /no canned answer/);
  assert.equal((await read(L.FENCE_SQL)).rows.length, 1);
  const bad = L.fakeReads(L.TEXT_PATH, { queue: { error: "boom" } });
  await assert.rejects(() => bad(L.QUEUE_SQL), /boom/);
  const merged = await L.fakeReads(L.TEXT_PATH, { failures: { failed_n: 9 } })(L.FAILURE_SQL);
  assert.deepEqual([merged.rows[0].failed_n, merged.rows[0].ok_n], [9, 6], "an override merges onto the healthy row");
});
