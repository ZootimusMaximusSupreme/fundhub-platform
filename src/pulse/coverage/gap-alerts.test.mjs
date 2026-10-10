// Account alerts lane: did the promised text go out? The SQL runs on a real Postgres in gap-alerts.pg.test.mjs.
// This file hands the lane a fake database that answers each read by its exact SQL text.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ALERT_TEXTS_SQL,
  CARD_CYCLES_SQL,
  CARD_TEMPLATE_SQL,
  CARD_TEXTS_SQL,
  CHECK_IDS,
  alertProblem,
  gapChecks,
  lastPassDate,
  owedReminders
} from "./gap-alerts.mjs";
import { GAP_FILES } from "./modules.mjs";
import { TEST_ADDRESS_RE } from "./gap-sms.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(HERE, "gap-alerts.mjs"), "utf8");
const ORG = "11111111-1111-4111-8111-111111111111";
const ID = "alerts:texts-went-out";
// 06:00 Arizona, 13:00 UTC: the 6 a.m. pulse. The job's last pass was yesterday's 16:00 UTC.
const NOW = new Date("2026-10-10T13:00:00.000Z");

function fakeDb(answers = {}) {
  const calls = [];
  return {
    calls,
    async query(text, params) {
      calls.push({ text, params });
      if (!Object.prototype.hasOwnProperty.call(answers, text)) return { rows: [] };
      const a = answers[text];
      if (a instanceof Error) throw a;
      return { rows: typeof a === "function" ? a(params) : a };
    }
  };
}

const CARD_OK = { [CARD_TEMPLATE_SQL]: [{ compliance_passed: true }] };

async function run(answers = {}, ctx = {}) {
  const db = fakeDb({ ...CARD_OK, ...answers });
  const [row] = await gapChecks({ db, orgId: ORG, now: NOW, ...ctx });
  return { row, db };
}

/** A Plaid card whose payment is due `inDays` days after the job's last pass (2026-10-09). */
function card(over = {}) {
  return {
    cycle_id: "c1",
    client_id: "cl1",
    bank_account_id: "acct-1",
    minimum_payment_cents: 135000,
    last_statement_balance_cents: 500000,
    last_statement_date: "2026-09-20",
    raw: { next_payment_due_date: "2026-10-11" },
    name: "Business Amex",
    mask: "4404",
    is_loan: false,
    sms_opted_out: false,
    ...over
  };
}

const REF = "workflow:SMS-FINANCE-OS-CARD-DUE:card-due:acct-1:2026-10-11";

test("alerts: one id, and the lane is on the named list", async () => {
  assert.deepEqual([...CHECK_IDS], [ID]);
  assert.ok(GAP_FILES.some(([name]) => name === "gap-alerts.mjs"));
  const mod = await GAP_FILES.find(([name]) => name === "gap-alerts.mjs")[1]();
  assert.deepEqual([...mod.CHECK_IDS], [ID]);
});

test("alerts: no database or no company is a skip with the reason, never a PASS", async () => {
  const [a] = await gapChecks({ orgId: ORG, now: NOW });
  assert.equal(a.status, "skip");
  assert.match(a.detail, /No database in this run/);
  const [b] = await gapChecks({ db: fakeDb(), now: NOW });
  assert.equal(b.status, "skip");
  assert.match(b.detail, /No company in this run/);
});

test("alerts: nothing owed and nothing queued is a PASS that counts what it looked at", async () => {
  const { row } = await run();
  assert.equal(row.status, "PASS");
  assert.equal(row.suggestedFix, null);
  assert.match(row.detail, /0 file-protection alerts and 0 payment reminders owed at the 2026-10-09 pass/);
});

test("alerts: every read is one SELECT and its parameters are all supplied; nothing is written or sent", async () => {
  const { db } = await run({ [CARD_CYCLES_SQL]: [card()] });
  assert.ok(db.calls.length >= 3);
  for (const c of db.calls) {
    assert.match(c.text, /^SELECT\b/);
    assert.doesNotMatch(c.text, /;/);
    assert.doesNotMatch(c.text, /\b(insert|update|delete|alter|drop|truncate|create|grant|begin|commit|rollback)\b/i);
    const max = Math.max(0, ...[...c.text.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])));
    assert.equal(c.params.length, max, c.text.slice(0, 60));
  }
  assert.doesNotMatch(SRC, /providers\/|\bsendTemplated\s*\(|\bfetch\s*\(|\bdispatch\w*\s*\(/);
  assert.doesNotMatch(SRC, /readFileSync|readdirSync/);
  const alertCall = db.calls.find((c) => c.text === ALERT_TEXTS_SQL);
  assert.equal(alertCall.params[3], TEST_ADDRESS_RE);
  assert.equal(alertCall.params[2], "2026-10-10");
});

// ── file-protection alerts ───────────────────────────────────────────────────

const ago = (hours) => new Date(NOW.getTime() - hours * 3600 * 1000).toISOString();
const alertRow = (over = {}) => ({
  kind: "payment_timing", due_on: "2026-10-12", sent_at: ago(3), message_id: "m1", status: "delivered",
  blocked_reason: null, message_created_at: ago(3), due_at: ago(3), last_attempt_at: ago(3), ...over
});

test("alerts: alertProblem — delivered is fine, failed is not, and each stuck state has a clock", () => {
  assert.equal(alertProblem(alertRow(), NOW), null);
  assert.equal(alertProblem(alertRow({ status: "complained" }), NOW), null);
  assert.match(alertProblem(alertRow({ message_id: null, status: null }), NOW), /message row is gone/);
  assert.match(alertProblem(alertRow({ status: "failed" }), NOW), /failed/);
  assert.match(alertProblem(alertRow({ status: "bounced" }), NOW), /bounced/);
  // A person who said STOP after it was queued is the gate working. Another reason is not.
  assert.equal(alertProblem(alertRow({ status: "blocked", blocked_reason: "opted_out" }), NOW), null);
  assert.match(alertProblem(alertRow({ status: "blocked", blocked_reason: "draft_template" }), NOW), /our own gate held it \(draft_template\)/);
  // Queued at night waits for 8 a.m.: not stuck until two hours past its time.
  assert.equal(alertProblem(alertRow({ status: "queued", due_at: ago(1) }), NOW), null);
  assert.match(alertProblem(alertRow({ status: "queued", due_at: ago(5) }), NOW), /queued since it was due/);
  assert.match(alertProblem(alertRow({ status: "sending", due_at: ago(5) }), NOW), /sending since it was due/);
  assert.equal(alertProblem(alertRow({ status: "sent", last_attempt_at: ago(2) }), NOW), null);
  assert.match(alertProblem(alertRow({ status: "sent", last_attempt_at: ago(30) }), NOW), /no delivery receipt came back in 24 hours/);
});

test("alerts: an alert whose text failed is a FAIL that names the kind and the reason", async () => {
  const { row } = await run({
    [ALERT_TEXTS_SQL]: [alertRow({ status: "failed" }), alertRow({ kind: "promo_end", message_id: null, status: null }), alertRow()]
  });
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /^2 of 3 file-protection alerts did not go out/);
  assert.match(row.detail, /payment_timing: the text failed x1/);
  assert.match(row.detail, /promo_end: its message row is gone x1/);
  assert.match(row.suggestedFix, /Do not send from this check\./);
});

// ── card-due reminders ───────────────────────────────────────────────────────

test("alerts: lastPassDate is the date of the job's last pass that has had its hour", () => {
  assert.equal(lastPassDate(new Date("2026-10-10T06:00:00Z")), "2026-10-09");
  assert.equal(lastPassDate(new Date("2026-10-10T16:30:00Z")), "2026-10-09");
  assert.equal(lastPassDate(new Date("2026-10-10T17:00:00Z")), "2026-10-10");
  assert.equal(lastPassDate(new Date("2026-10-10T23:59:00Z")), "2026-10-10");
});

test("alerts: owedReminders runs the job's own planners, for cards and for loans", () => {
  const loan = card({
    bank_account_id: "loan-1", is_loan: true, name: "SBA Loan", payment_due_day: 11, minimum_payment_cents: 105000,
    current_balance_cents: 900000, raw: {}
  });
  const owed = owedReminders([card(), loan, card({ bank_account_id: "far", raw: { next_payment_due_date: "2026-10-30" } })], "2026-10-09");
  const refs = owed.map((o) => o.ref).sort();
  assert.deepEqual(refs, [
    "workflow:SMS-FINANCE-OS-CARD-DUE:card-due:acct-1:2026-10-11",
    "workflow:SMS-FINANCE-OS-CARD-DUE:loan-due:loan-1:2026-10-11"
  ]);
  assert.deepEqual(owed.map((o) => o.kind).sort(), ["card", "loan"]);
});

test("alerts: a reminder the job owed with no text is a FAIL; with a delivered text it is a PASS", async () => {
  const red = (await run({ [CARD_CYCLES_SQL]: [card()] })).row;
  assert.equal(red.status, "FAIL");
  assert.match(red.detail, /1 of 1 payment reminder the job owed has no text \(Business Amex due 2026-10-11\)\./);

  const green = (await run({
    [CARD_CYCLES_SQL]: [card()],
    [CARD_TEXTS_SQL]: [{ provider_ref: REF, status: "delivered", blocked_reason: null, due_at: ago(18), last_attempt_at: ago(18), message_created_at: ago(18), message_id: "m9" }]
  })).row;
  assert.equal(green.status, "PASS");
  assert.match(green.detail, /1 payment reminder owed at the 2026-10-09 pass/);
});

test("alerts: the references the lane asks the messages table for are exactly the ones the job would have written", async () => {
  const { db } = await run({ [CARD_CYCLES_SQL]: [card(), card({ bank_account_id: "acct-2", raw: { next_payment_due_date: "2026-10-12" } })] });
  const call = db.calls.find((c) => c.text === CARD_TEXTS_SQL);
  assert.deepEqual(call.params[1].sort(), [
    "workflow:SMS-FINANCE-OS-CARD-DUE:card-due:acct-1:2026-10-11",
    "workflow:SMS-FINANCE-OS-CARD-DUE:card-due:acct-2:2026-10-12"
  ]);
});

test("alerts: a person who said STOP is owed no text, and the template not approved is named as the reason", async () => {
  const stopped = (await run({ [CARD_CYCLES_SQL]: [card({ sms_opted_out: true })] })).row;
  assert.equal(stopped.status, "PASS");
  assert.match(stopped.detail, /0 payment reminders owed/);
  const pending = (await run({ [CARD_CYCLES_SQL]: [card()], [CARD_TEMPLATE_SQL]: [{ compliance_passed: false }] })).row;
  assert.equal(pending.status, "FAIL");
  assert.match(pending.detail, /The card-due template is not approved, so the job queues nothing\./);
});

test("alerts: a card-due text that failed or is stuck is a FAIL", async () => {
  const failed = (await run({
    [CARD_CYCLES_SQL]: [card()],
    [CARD_TEXTS_SQL]: [{ provider_ref: REF, status: "failed", blocked_reason: null, due_at: ago(18), last_attempt_at: ago(18), message_created_at: ago(18), message_id: "m9" }]
  })).row;
  assert.equal(failed.status, "FAIL");
  assert.match(failed.detail, /1 card-due text did not go out \(Business Amex due 2026-10-11: the text failed\)/);
});

test("alerts: a read that failed is a skip with the reason, and a FAIL elsewhere still stands", async () => {
  const none = (await run({ [ALERT_TEXTS_SQL]: new Error("canceling statement due to statement timeout") })).row;
  assert.equal(none.status, "skip");
  assert.match(none.detail, /file-protection alerts could not be read \(canceling statement due to statement timeout\)/);
  const mixed = (await run({
    [ALERT_TEXTS_SQL]: new Error("boom"),
    [CARD_CYCLES_SQL]: [card()]
  })).row;
  assert.equal(mixed.status, "FAIL");
  assert.match(mixed.detail, /Not read: file-protection alerts could not be read \(boom\)/);
  const cyclesDown = (await run({ [CARD_CYCLES_SQL]: new Error("no such table") })).row;
  assert.equal(cyclesDown.status, "skip");
});
