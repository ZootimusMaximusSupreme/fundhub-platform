// Finance OS phone alerts — the lock-screen words, the queue, the dispatcher-side
// sender and the companion rule. Stub database, stub phone pipes: nothing leaves
// this process, no Postgres, no Apple, no push service.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  lockScreenFor, queuePhoneAlert, deliverPhoneAlert, companionForFinanceText, sendAfter,
  stopReason, billIdOfKey, installmentIdOfKey, customIdOfKey, phoneAlertState, listPhoneAlerts, phoneState, phoneSummary, tapFor,
  coveringPushRef, PUSH_OUTCOME, FINANCE_TEXT_KEYS, MONEY_HELPER_REMINDER_SMS, UNKNOWN_OUTCOME_NOTE, NO_PHONE_NOTE
} from "./finance-alerts.mjs";
import { buildPushPayload, PushPayloadRefused, FINANCE_ALERTS_URL, APPROVED_URLS } from "./payload.mjs";
import { notificationForSentMessage } from "./message-policy.mjs";
import { dispatchOne, OUTCOME } from "../messaging/dispatch.mjs";
import { PHONE_KINDS, PUSH_TEMPLATES } from "../finance/file-alerts/phone-alerts.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ORG = "0f000000-0000-4000-8000-000000000001";
const CLIENT = "c1000000-0000-4000-8000-000000000001";
const BILL = "b1000000-0000-4000-8000-000000000001";
const ACCT = "a1000000-0000-4000-8000-000000000001";
const INSTALLMENT = "e1000000-0000-4000-8000-000000000001";
const CUSTOM = "c0a1e2d3-4b5c-4d6e-8f70-81a2b3c4d5e1";
const WHOP_PLAN = "d1000000-0000-4000-8000-000000000001";

/* 10:00 a.m. Arizona (17:00 UTC) is inside 9 to 5. 00:30 a.m. Arizona (07:30 UTC) is not. */
const IN_WINDOW = new Date("2026-10-12T17:00:00.000Z");
const AT_NIGHT = new Date("2026-10-12T07:30:00.000Z");
const PUSH_ENV = Object.freeze({
  MESSAGING_DRY_RUN: "0",
  APNS_KEY_ID: "ABCDEFGHIJ", APNS_TEAM_ID: "KLMNOPQRST", APNS_PRIVATE_KEY_BASE64: "x", PUSH_SUB_ENC_KEY: "y",
  VAPID_PUBLIC_KEY: "p", VAPID_PRIVATE_KEY: "q", VAPID_SUBJECT: "mailto:x@example.test"
});

/* ------------------------------------------------------------------ *
 * The lock screen
 * ------------------------------------------------------------------ */

describe("what a locked phone shows", () => {
  const BANKS = /chase|amex|american express|visa|mastercard|discover|capital one|citi|wells|bank of america|navy federal|barclays|synchrony/i;
  test("every finance alert is a fixed sentence: no amount, no digit, no bank, no card name, and it says Fundhub", () => {
    for (const kind of PHONE_KINDS) {
      const p = lockScreenFor(kind);
      assert.doesNotMatch(p.body, /\d/, `${kind} has a digit`);
      assert.doesNotMatch(p.body, /\$|dollar|cents?\b|balance|limit|ending/i, `${kind} names money or an account`);
      assert.doesNotMatch(p.body, BANKS, `${kind} names a bank`);
      assert.match(p.body, /Open Fundhub/, `${kind} says Fundhub, spelled right`);
      assert.doesNotMatch(p.body, /FundHub/);
      assert.equal(p.url, kind === "plan_due" ? "/app/financeos.html#payments" : "/app/financeos.html#alerts",
        "a plan alert opens Payments; every other opens Alerts");
      assert.equal(tapFor(kind), p.url);
      assert.ok(APPROVED_URLS.includes(p.url));
    }
  });

  test("a body with an amount or a bank is refused, not trimmed (the gate this rides on)", () => {
    for (const body of ["Your Chase card payment of $35.00 is due Nov 10.", "A card payment is due in 3 days. Open Fundhub to see it."]) {
      assert.throws(() => buildPushPayload({ kind: "card_payment_due", body, url: FINANCE_ALERTS_URL }), PushPayloadRefused);
    }
    assert.throws(() => buildPushPayload({ kind: "card_payment_due", url: "/app/financeos.html#alerts?card=4404" }), PushPayloadRefused);
  });

  test("the eight kinds map to eight different sentences, and the words say what kind of payment", () => {
    const bodies = PHONE_KINDS.map((k) => lockScreenFor(k).body);
    assert.equal(new Set(bodies).size, 8);
    assert.match(lockScreenFor("custom_alert").body, /^An alert you set is due soon\./);
    assert.match(lockScreenFor("custom_bill").body, /^A bill you added charges soon\./);
    assert.match(lockScreenFor("loan_due").body, /^A loan payment is due soon\./);
    assert.match(lockScreenFor("credit_line_due").body, /^A credit line payment is due soon\./);
    assert.match(lockScreenFor("plan_due").body, /^A payment on your plan is due soon\./);
    assert.doesNotMatch(lockScreenFor("plan_due").body, /Clarity|Whop|BNPL/i, "no lender or partner name on a locked phone");
    assert.throws(() => lockScreenFor("cash_reserve"));
  });
});

/* ------------------------------------------------------------------ *
 * The queue
 * ------------------------------------------------------------------ */

function queueDb(returning = [{ id: "m-1", inserted: true }]) {
  const calls = [];
  return { calls, async query(sql, params) { calls.push({ sql: String(sql), params }); return { rows: returning }; } };
}

describe("queuePhoneAlert — one row, queued, nothing sent", () => {
  const plan = { kind: "important_bill", key: `bill:${BILL}:2026-10-14` };

  test("the row carries no send time (the dispatcher holds it to 9 a.m.); the body is the fixed sentence; the ref is the cycle's key", async () => {
    const db = queueDb();
    const r = await queuePhoneAlert(db, { orgId: ORG, clientId: CLIENT, plan, now: AT_NIGHT });
    assert.deepEqual(r, { queued: true, messageId: "m-1", rearmed: false, reason: null });
    const [{ sql, params }] = db.calls;
    assert.match(sql, /INSERT INTO messages/);
    assert.match(sql, /'push', \$3, \$4, \$5, 'queued'/);
    assert.match(sql, /ON CONFLICT \(org_id, provider_ref\) WHERE provider_ref IS NOT NULL/);
    assert.match(sql, /WHERE messages\.status = 'failed'/, "only a failed row is ever re-armed");
    assert.doesNotMatch(sql, /scheduled_at/, "the dispatcher is the one writer of messages.scheduled_at");
    assert.deepEqual(params, [ORG, CLIENT, PUSH_TEMPLATES.important_bill, lockScreenFor("important_bill").body,
      `finance-push:bill:${BILL}:2026-10-14`]);
  });

  test("inside 9 to 5 it is due now; outside, it waits (the 9-to-5 rule)", () => {
    assert.equal(sendAfter(IN_WINDOW), null);
    assert.equal(sendAfter(AT_NIGHT), "2026-10-12T16:00:00.000Z");
    assert.equal(sendAfter(new Date("2026-10-13T00:30:00.000Z")), "2026-10-13T16:00:00.000Z", "5:30 p.m. waits for tomorrow");
  });

  test("a second queue of the same cycle writes nothing new", async () => {
    const r = await queuePhoneAlert(queueDb([]), { orgId: ORG, clientId: CLIENT, plan, now: AT_NIGHT });
    assert.deepEqual(r, { queued: false, messageId: null, rearmed: false, reason: "already_queued" });
  });

  test("an unknown kind or a missing key is refused before any write", async () => {
    const db = queueDb();
    await assert.rejects(queuePhoneAlert(db, { orgId: ORG, clientId: CLIENT, plan: { kind: "promo_end", key: "x" } }));
    await assert.rejects(queuePhoneAlert(db, { orgId: ORG, clientId: CLIENT, plan: { kind: "card_due" } }));
    assert.equal(db.calls.length, 0);
  });
});

/* ------------------------------------------------------------------ *
 * The sender the dispatcher calls
 * ------------------------------------------------------------------ */

function sendDb({ client = {}, wanted = true } = {}) {
  const calls = [];
  const row = wanted ? {
    custom_fields: {}, phone_alerts: true, payment_timing: true, opted_out: false, bill_important: true, ...client
  } : null;
  return {
    calls,
    async query(sql, params) {
      const s = String(sql);
      calls.push({ sql: s, params });
      if (/FROM clients c/.test(s)) return { rows: row ? [row] : [] };
      if (/^UPDATE messages/.test(s.trim())) return { rows: [] };
      throw new Error(`unexpected sql: ${s.slice(0, 80)}`);
    }
  };
}
const claimed = (over = {}) => ({
  id: "m-9", org_id: ORG, client_id: CLIENT, channel: "push", attempts: 1,
  template_key: PUSH_TEMPLATES.card_due, provider_ref: `finance-push:card-due:${ACCT}:2026-10-14`,
  rendered_body: lockScreenFor("card_due").body, ...over
});
function pipes(answer = { attempted: 1, sent: 1, expired: 0, failed: 0 }) {
  const seen = [];
  const pipe = async (_db, target) => { seen.push(target); return typeof answer === "function" ? answer() : answer; };
  return { seen, sendNative: pipe, sendWeb: pipe };
}
const lastUpdate = (db) => db.calls.filter((c) => /^UPDATE messages/.test(c.sql.trim())).at(-1);

describe("deliverPhoneAlert — the window, the fence and the opt-outs come before any phone", () => {
  test("outside 9 to 5 it waits: back on the queue, the attempt given back, no send time written, no phone touched", async () => {
    const db = sendDb();
    const p = pipes();
    const r = await deliverPhoneAlert(db, claimed(), { env: PUSH_ENV, now: AT_NIGHT, ...p });
    assert.equal(r.outcome, PUSH_OUTCOME.DEFERRED);
    assert.equal(r.detail, "2026-10-12T16:00:00.000Z");
    assert.equal(p.seen.length, 0);
    assert.match(lastUpdate(db).sql, /status = 'queued', attempts = GREATEST\(attempts - 1, 0\)/);
    assert.ok(!db.calls.some((c) => /scheduled_at/.test(c.sql)), "the dispatcher is the one writer of messages.scheduled_at");
  });

  test("the dry-run fence holds it, it does not fail it", async () => {
    const db = sendDb();
    const p = pipes();
    const r = await deliverPhoneAlert(db, claimed(), { env: { ...PUSH_ENV, MESSAGING_DRY_RUN: "1" }, now: IN_WINDOW, ...p });
    assert.equal(r.outcome, PUSH_OUTCOME.DRY_RUN);
    assert.equal(p.seen.length, 0);
    assert.match(lastUpdate(db).sql, /status = 'queued'/);
  });

  for (const [name, client, msg, reason] of [
    ["a client who said STOP", { opted_out: true }, claimed(), "opted_out"],
    ["a client who switched phone alerts off", { phone_alerts: false }, claimed(), "phone_alerts_off"],
    ["a statement-close push after the pay-before-close alert was switched off", { payment_timing: false },
      claimed({ template_key: PUSH_TEMPLATES.statement_close, provider_ref: `finance-push:fpa:pay:${ACCT}:2026-10-15` }), "alert_off"],
    ["a bill that is no longer marked Important", { bill_important: false },
      claimed({ template_key: PUSH_TEMPLATES.important_bill, provider_ref: `finance-push:bill:${BILL}:2026-10-14` }), "not_important"],
    ["a plan installment paid (or the plan settled) since the pass queued it", { plan_left_cents: null },
      claimed({ template_key: PUSH_TEMPLATES.plan_due, provider_ref: `finance-push:plan:${INSTALLMENT}:2026-10-14` }), "paid"],
    ["a loan push for a client who said STOP", { opted_out: true },
      claimed({ template_key: PUSH_TEMPLATES.loan_due, provider_ref: `finance-push:loan-due:${ACCT}:2026-10-14` }), "opted_out"],
    ["a Whop plan whose charge moved to another day since the pass queued it", { whop_charge_on: "2026-11-13" },
      claimed({ template_key: PUSH_TEMPLATES.plan_due, provider_ref: `finance-push:whop:${WHOP_PLAN}:2026-10-14` }), "not_due"],
    ["a Whop plan that ended, is ending or is paid off", { whop_charge_on: null, plan_left_cents: 65000 },
      claimed({ template_key: PUSH_TEMPLATES.plan_due, provider_ref: `finance-push:whop:${WHOP_PLAN}:2026-10-14` }), "not_due"]
  ]) {
    test(`${name}: stopped, recorded as blocked with the reason, no phone touched`, async () => {
      const db = sendDb({ client });
      const p = pipes();
      const r = await deliverPhoneAlert(db, msg, { env: PUSH_ENV, now: IN_WINDOW, ...p });
      assert.deepEqual([r.outcome, r.detail], [PUSH_OUTCOME.BLOCKED, reason]);
      assert.equal(p.seen.length, 0);
      const u = lastUpdate(db);
      assert.match(u.sql, /status = 'blocked', blocked_reason = \$2, blocked_at = now\(\)/);
      assert.deepEqual(u.params, ["m-9", reason]);
    });
  }

  test("the fresh read is scoped to the row's own company and client, and names the bill only for a bill", async () => {
    const db = sendDb();
    await deliverPhoneAlert(db, claimed({ template_key: PUSH_TEMPLATES.important_bill, provider_ref: `finance-push:bill:${BILL}:2026-10-14` }),
      { env: PUSH_ENV, now: IN_WINDOW, ...pipes() });
    const read = db.calls.find((c) => /FROM clients c/.test(c.sql));
    assert.deepEqual(read.params, [ORG, CLIENT, BILL, null, null, null]);
    assert.match(read.sql, /WHERE c\.id = \$2 AND c\.org_id = \$1/);
    assert.match(read.sql, /p\.org_id = c\.org_id AND p\.client_id = c\.id/, "the plan read is the row's own client");
    assert.match(read.sql, /w\.id = \$6::uuid AND w\.org_id = c\.org_id AND w\.client_id = c\.id/, "the Whop plan read is the row's own client");
    assert.equal(billIdOfKey(`card-due:${ACCT}:2026-10-14`), null);
    assert.equal(installmentIdOfKey(`plan:${INSTALLMENT}:2026-10-14`), INSTALLMENT);
    assert.equal(installmentIdOfKey(`bill:${BILL}:2026-10-14`), null);
    assert.equal(customIdOfKey(`custom:${CUSTOM}:2026-10-14`), CUSTOM);
    assert.equal(customIdOfKey(`bill:${BILL}:2026-10-14`), null);
    assert.match(read.sql, /f\.org_id = c\.org_id AND f\.client_id = c\.id/, "the added alert read is the row's own client");
  });

  test("a push about a day that already passed is never sent", async () => {
    const db = sendDb();
    const p = pipes();
    const r = await deliverPhoneAlert(db, claimed({ provider_ref: `finance-push:card-due:${ACCT}:2026-10-11` }), { env: PUSH_ENV, now: IN_WINDOW, ...p });
    assert.equal(r.outcome, PUSH_OUTCOME.REJECTED);
    assert.match(r.detail, /^too_late/);
    assert.equal(p.seen.length, 0);
  });

  test("a synthetic test client is refused for good", async () => {
    const p = pipes();
    const r = await deliverPhoneAlert(sendDb({ client: { custom_fields: { synthetic: true } } }), claimed(), { env: PUSH_ENV, now: IN_WINDOW, ...p });
    assert.equal(r.outcome, PUSH_OUTCOME.SYNTHETIC);
    assert.equal(p.seen.length, 0);
  });

  test("a row with no approved sender is refused and nothing is sent", async () => {
    const p = pipes();
    for (const msg of [claimed({ template_key: "BS-COMPANION-PUSH" }), claimed({ provider_ref: "marketing-push:x" })]) {
      const r = await deliverPhoneAlert(sendDb(), msg, { env: PUSH_ENV, now: IN_WINDOW, ...p });
      assert.equal(r.outcome, PUSH_OUTCOME.REJECTED);
    }
    assert.equal(p.seen.length, 0);
  });
});

describe("deliverPhoneAlert — sending and recording", () => {
  test("a plan installment still owed goes with its own words and the Payments tap", async () => {
    const db = sendDb({ client: { plan_left_cents: 65000 } });
    const p = pipes();
    const r = await deliverPhoneAlert(db, claimed({ template_key: PUSH_TEMPLATES.plan_due, provider_ref: `finance-push:plan:${INSTALLMENT}:2026-10-14` }),
      { env: PUSH_ENV, now: IN_WINDOW, ...p });
    assert.equal(r.outcome, PUSH_OUTCOME.SENT);
    assert.deepEqual(p.seen[0].notification, { kind: "plan_payment_due", url: "/app/financeos.html#payments" });
    const read = db.calls.find((c) => /FROM clients c/.test(c.sql));
    assert.deepEqual(read.params, [ORG, CLIENT, null, INSTALLMENT, null, null]);
  });

  test("a Whop plan still charging on that day goes with the plan words and the Payments tap (unit W)", async () => {
    const db = sendDb({ client: { whop_charge_on: "2026-10-14", plan_left_cents: null } });
    const p = pipes();
    const r = await deliverPhoneAlert(db, claimed({ template_key: PUSH_TEMPLATES.plan_due, provider_ref: `finance-push:whop:${WHOP_PLAN}:2026-10-14` }),
      { env: PUSH_ENV, now: IN_WINDOW, ...p });
    assert.equal(r.outcome, PUSH_OUTCOME.SENT);
    assert.deepEqual(p.seen[0].notification, { kind: "plan_payment_due", url: "/app/financeos.html#payments" });
    const read = db.calls.find((c) => /FROM clients c/.test(c.sql));
    assert.deepEqual(read.params, [ORG, CLIENT, null, null, null, WHOP_PLAN]);
  });

  /* AL2 (2026-11-07): an alert or a repeat bill the client added by hand. */
  const customRow = (over = {}) => ({ kind: "alert", phone_alert: true, archived: false, cadence: "monthly", day_of_month: 14, start_on: null, ...over });
  test("an alert the client added goes with its own words to Alerts, read by its own id", async () => {
    const db = sendDb({ client: { custom_row: customRow() } });
    const p = pipes();
    const r = await deliverPhoneAlert(db, claimed({ template_key: PUSH_TEMPLATES.custom_alert, provider_ref: `finance-push:custom:${CUSTOM}:2026-10-14` }),
      { env: PUSH_ENV, now: IN_WINDOW, ...p });
    assert.equal(r.outcome, PUSH_OUTCOME.SENT);
    assert.deepEqual(p.seen[0].notification, { kind: "custom_reminder_due", url: "/app/financeos.html#alerts" });
    const read = db.calls.find((c) => /FROM clients c/.test(c.sql));
    assert.deepEqual(read.params, [ORG, CLIENT, null, null, CUSTOM, null]);
    const bill = pipes();
    const b = await deliverPhoneAlert(sendDb({ client: { custom_row: customRow({ kind: "bill", cadence: "weekly", day_of_month: null, start_on: "2026-09-16" }) } }),
      claimed({ template_key: PUSH_TEMPLATES.custom_bill, provider_ref: `finance-push:custom:${CUSTOM}:2026-10-14` }), { env: PUSH_ENV, now: IN_WINDOW, ...bill });
    assert.equal(b.outcome, PUSH_OUTCOME.SENT, b.detail);
    assert.deepEqual(bill.seen[0].notification, { kind: "custom_bill_soon", url: "/app/financeos.html#alerts" });
  });

  test("removed, switched off, or moved to another day since it was queued: blocked, no phone touched", async () => {
    for (const [row, reason] of [
      [null, "removed"],
      [customRow({ archived: true }), "removed"],
      [customRow({ kind: "bill" }), "removed"],
      [customRow({ phone_alert: false }), "alert_off"],
      [customRow({ day_of_month: 20 }), "date_changed"]
    ]) {
      const db = sendDb({ client: { custom_row: row } });
      const p = pipes();
      const r = await deliverPhoneAlert(db, claimed({ template_key: PUSH_TEMPLATES.custom_alert, provider_ref: `finance-push:custom:${CUSTOM}:2026-10-14` }),
        { env: PUSH_ENV, now: IN_WINDOW, ...p });
      assert.equal(r.outcome, PUSH_OUTCOME.BLOCKED, JSON.stringify(row));
      assert.equal(r.detail, reason, JSON.stringify(row));
      assert.equal(p.seen.length, 0);
    }
    assert.equal(stopReason("custom_alert", { custom_row: customRow() }, { eventOn: "2026-10-14" }), null);
    assert.equal(stopReason("custom_alert", { custom_row: customRow() }, { eventOn: null }), "date_changed");
  });

  test("a loan and a credit line push go with their own words to Alerts", async () => {
    for (const [kind, word] of [["loan_due", "loan_payment_due"], ["credit_line_due", "credit_line_payment_due"]]) {
      const p = pipes();
      const r = await deliverPhoneAlert(sendDb(), claimed({ template_key: PUSH_TEMPLATES[kind], provider_ref: `finance-push:loan-due:${ACCT}:2026-10-14` }),
        { env: PUSH_ENV, now: IN_WINDOW, ...p });
      assert.equal(r.outcome, PUSH_OUTCOME.SENT, kind);
      assert.deepEqual(p.seen[0].notification, { kind: word, url: "/app/financeos.html#alerts" });
    }
  });

  test("a wanted push goes to both pipes with the fixed kind and the Alerts tap, and is recorded sent", async () => {
    const db = sendDb();
    const p = pipes();
    const r = await deliverPhoneAlert(db, claimed(), { env: PUSH_ENV, now: IN_WINDOW, ...p });
    assert.equal(r.outcome, PUSH_OUTCOME.SENT);
    assert.equal(p.seen.length, 2, "the iPhone app and web push");
    for (const t of p.seen) {
      assert.deepEqual([t.orgId, t.clientId], [ORG, CLIENT]);
      assert.deepEqual(t.notification, { kind: "card_payment_due", url: "/app/financeos.html#alerts" });
    }
    assert.deepEqual(lastUpdate(db).params, ["m-9", "sent", "apns_web_push", null]);
  });

  test("an unknown phone answer stays 'sending' and is never retried (no double buzz)", async () => {
    const db = sendDb();
    const p = pipes({ attempted: 1, sent: 0, expired: 0, failed: 1, unknown: 1 });
    const r = await deliverPhoneAlert(db, claimed(), { env: PUSH_ENV, now: IN_WINDOW, ...p });
    assert.equal(r.outcome, PUSH_OUTCOME.REJECTED);
    assert.deepEqual(lastUpdate(db).params, ["m-9", "sending", "apns_web_push", UNKNOWN_OUTCOME_NOTE]);
  });

  test("a client with no phone left is recorded failed with no_push_device, which a later pass may re-arm", async () => {
    const db = sendDb();
    const r = await deliverPhoneAlert(db, claimed(), { env: PUSH_ENV, now: IN_WINDOW, ...pipes({ attempted: 0, sent: 0, expired: 0, failed: 0 }) });
    assert.equal(r.outcome, PUSH_OUTCOME.NO_ADDRESS);
    assert.deepEqual(lastUpdate(db).params, ["m-9", "failed", null, NO_PHONE_NOTE]);
  });

  test("with no push keys on the server nothing is sent and it says why", async () => {
    const p = pipes();
    const r = await deliverPhoneAlert(sendDb(), claimed(), { env: { MESSAGING_DRY_RUN: "0" }, now: IN_WINDOW, ...p });
    assert.equal(r.outcome, PUSH_OUTCOME.REJECTED);
    assert.match(r.detail, /push keys/);
    assert.equal(p.seen.length, 0);
  });

  test("every outcome word is one the dispatcher already uses", () => {
    const known = new Set(Object.values(OUTCOME));
    for (const word of Object.values(PUSH_OUTCOME)) assert.ok(known.has(word), word);
  });
});

describe("the dispatcher hands a queued push row to this sender", () => {
  test("channel 'push' goes to deliverPhoneAlert: no compliance gate, no route lookup", async () => {
    const db = sendDb();
    const p = pipes();
    const r = await dispatchOne(db, claimed(), { env: PUSH_ENV, now: IN_WINDOW, sendNative: p.sendNative, sendWeb: p.sendWeb });
    assert.equal(r.outcome, OUTCOME.SENT);
    assert.equal(p.seen.length, 2);
    assert.ok(!db.calls.some((c) => /message_channel_routing|message_templates|opt_outs WHERE client_id = \$1 AND channel/.test(c.sql)),
      "the text-only steps never ran");
  });

  test("at night the dispatcher defers it to 9 a.m. like any drip", async () => {
    const db = sendDb();
    const p = pipes();
    const r = await dispatchOne(db, claimed(), { env: PUSH_ENV, now: AT_NIGHT, sendNative: p.sendNative, sendWeb: p.sendWeb });
    assert.equal(r.outcome, OUTCOME.DEFERRED);
    assert.equal(r.detail, "2026-10-12T16:00:00.000Z");
    assert.equal(p.seen.length, 0);
    const hold = lastUpdate(db);
    assert.match(hold.sql, /status = 'queued', scheduled_at = \$2, attempts = GREATEST\(attempts - 1, 0\)/);
    assert.deepEqual(hold.params, ["m-9", "2026-10-12T16:00:00.000Z"]);
    assert.ok(!db.calls.some((c) => /FROM clients c/.test(c.sql)), "nothing is read for a push that waits");
  });
});

/* ------------------------------------------------------------------ *
 * The text's companion buzz
 * ------------------------------------------------------------------ */

function companionDb({ covered = false, phoneAlerts = null } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql: String(sql), params });
      return { rows: [{ covered, phone_alerts: phoneAlerts }] };
    }
  };
}
const cardDueText = (over = {}) => ({
  id: "sms-1", org_id: ORG, client_id: CLIENT, channel: "sms", template_key: "SMS-FINANCE-OS-CARD-DUE",
  provider_ref: `workflow:SMS-FINANCE-OS-CARD-DUE:card-due:${ACCT}:2026-10-14`, ...over
});

describe("one buzz per event: the finance push replaces the generic companion for the same card and date", () => {
  test("the finance texts are the card and loan due text, the pay-before-close text and the money helper's plan reminder", async () => {
    assert.deepEqual([...FINANCE_TEXT_KEYS].sort(), ["SMS-FILE-PROTECT-PAY-BEFORE-CLOSE", "SMS-FINANCE-OS-CARD-DUE", "SMS-MONEY-AGENT-REMINDER"]);
    const { TEMPLATES } = await import("../finance/money-agent.mjs");
    assert.equal(MONEY_HELPER_REMINDER_SMS, TEMPLATES.reminder, "the carried money helper template is its own");
  });

  test("a loan due text is covered by its loan push; a plan reminder by any push for that installment", () => {
    assert.deepEqual(coveringPushRef("SMS-FINANCE-OS-CARD-DUE", `loan-due:${ACCT}:2026-10-14`),
      { exact: `finance-push:loan-due:${ACCT}:2026-10-14`, prefix: null });
    assert.deepEqual(coveringPushRef(MONEY_HELPER_REMINDER_SMS, `money-agent:clarity_installment:${INSTALLMENT}:0`),
      { exact: null, prefix: `finance-push:plan:${INSTALLMENT}:` });
    // Only the helper's before-the-date reminder (rung 0); a late check-in is not a "due soon" event.
    assert.deepEqual(coveringPushRef(MONEY_HELPER_REMINDER_SMS, `money-agent:clarity_installment:${INSTALLMENT}:1`), { exact: null, prefix: null });
  });

  test("a plan reminder text with its plan push already queued: no generic companion", async () => {
    const db = companionDb({ covered: true });
    const text = cardDueText({ template_key: MONEY_HELPER_REMINDER_SMS,
      provider_ref: `workflow:SMS-MONEY-AGENT-REMINDER:money-agent:clarity_installment:${INSTALLMENT}:0` });
    assert.equal(await notificationForSentMessage(db, text), null);
    assert.deepEqual(db.calls[0].params, [ORG, CLIENT, null, `finance-push:plan:${INSTALLMENT}:`]);
  });

  test("a finance push already queued for that card and date: no generic companion", async () => {
    const db = companionDb({ covered: true });
    assert.equal(await notificationForSentMessage(db, cardDueText()), null);
    assert.deepEqual(db.calls[0].params, [ORG, CLIENT, `finance-push:card-due:${ACCT}:2026-10-14`, null]);
  });

  test("phone alerts switched off: no companion either", async () => {
    assert.equal(await companionForFinanceText(companionDb({ phoneAlerts: false }), cardDueText()), null);
  });

  test("no finance push for it (a loan, no phone, an older text): the companion is exactly today's", async () => {
    assert.deepEqual(await notificationForSentMessage(companionDb(), cardDueText()), { kind: "update" });
    const payText = cardDueText({ template_key: "SMS-FILE-PROTECT-PAY-BEFORE-CLOSE",
      provider_ref: `workflow:SMS-FILE-PROTECT-PAY-BEFORE-CLOSE:fpa:pay:${ACCT}:2026-10-15` });
    const db = companionDb();
    assert.deepEqual(await notificationForSentMessage(db, payText), { kind: "update" });
    assert.equal(db.calls[0].params[2], `finance-push:fpa:pay:${ACCT}:2026-10-15`);
    // The companion query matches the prefix only when one is given.
    assert.match(db.calls[0].sql, /m\.provider_ref = \$3::text OR m\.provider_ref LIKE \(\$4::text \|\| '%'\)/);
  });

  test("any other service text keeps its companion with no extra read", async () => {
    const db = companionDb({ covered: true });
    assert.deepEqual(await notificationForSentMessage(db, cardDueText({ template_key: "SMS-FILE-PROTECT-PROMO-END" })), { kind: "update" });
    assert.equal(db.calls.length, 0);
  });
});

/* ------------------------------------------------------------------ *
 * Reads, and what this file may never do
 * ------------------------------------------------------------------ */

describe("reads", () => {
  test("phoneState and the screen list are scoped to one company and client", async () => {
    const db = { calls: [], async query(sql, params) { this.calls.push({ sql, params }); return { rows: [] }; } };
    assert.deepEqual(await phoneState(db, { orgId: ORG, clientId: CLIENT }), { hasPhone: false, optedOut: false });
    await listPhoneAlerts(db, { orgId: ORG, clientId: CLIENT });
    for (const c of db.calls) assert.deepEqual(c.params.slice(0, 2), [ORG, CLIENT]);
  });

  test("phoneSummary gives the Payments section the switch, the phone and only the plan alerts", async () => {
    const db = {
      async query(sql) {
        const s = String(sql);
        if (/FROM file_protection_settings/.test(s)) return { rows: [{ phone_alerts: false }] };
        if (/has_phone/.test(s)) return { rows: [{ has_phone: true, opted_out: false }] };
        return { rows: [
          { id: "m1", template_key: PUSH_TEMPLATES.plan_due, provider_ref: `finance-push:plan:${INSTALLMENT}:2026-10-14`, status: "sent" },
          { id: "m2", template_key: PUSH_TEMPLATES.card_due, provider_ref: `finance-push:card-due:${ACCT}:2026-10-14`, status: "sent" }
        ] };
      }
    };
    const s = await phoneSummary(db, { orgId: ORG, clientId: CLIENT });
    assert.deepEqual([s.enabled, s.opted_out, s.has_phone, s.days_before], [false, false, true, 3]);
    assert.deepEqual(s.sent.map((a) => [a.kind, a.subject_id, a.about_on, a.state]), [["plan_due", INSTALLMENT, "2026-10-14", "sent"]]);
  });

  test("a row's state is one plain word", () => {
    assert.equal(phoneAlertState({ status: "queued" }), "waiting");
    assert.equal(phoneAlertState({ status: "sent" }), "sent");
    assert.equal(phoneAlertState({ status: "blocked" }), "stopped");
    assert.equal(phoneAlertState({ status: "failed", last_error: NO_PHONE_NOTE }), "no_phone");
    assert.equal(phoneAlertState({ status: "sending", last_error: UNKNOWN_OUTCOME_NOTE }), "unknown");
  });

  test("stopReason reads only what the client said", () => {
    assert.equal(stopReason("card_due", null), "client_not_found");
    assert.equal(stopReason("card_due", { phone_alerts: true, payment_timing: false }), null, "the text switch does not stop a due-date push");
    assert.equal(stopReason("important_bill", { bill_important: null }), "not_important");
    // A Whop plan (unit W) is judged by its own charge day, never by a Clarity installment.
    const whopKey = `whop:${WHOP_PLAN}:2026-11-20`;
    assert.equal(stopReason("plan_due", { whop_charge_on: "2026-11-20", plan_left_cents: null }, { key: whopKey }), null);
    assert.equal(stopReason("plan_due", { whop_charge_on: "2026-12-20" }, { key: whopKey }), "not_due");
    assert.equal(stopReason("plan_due", { whop_charge_on: null }, { key: whopKey }), "not_due");
    assert.equal(stopReason("plan_due", { whop_charge_on: "2026-11-20", opted_out: true }, { key: whopKey }), "opted_out");
    assert.equal(stopReason("plan_due", { plan_left_cents: null, whop_charge_on: "2026-11-20" }, { key: `plan:${INSTALLMENT}:2026-11-20` }), "paid");
  });
});

describe("this file sends nothing itself", () => {
  const src = readFileSync(join(HERE, "finance-alerts.mjs"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  test("no transport, provider, dispatcher or network import: the dispatcher hands the two pipes in", () => {
    assert.doesNotMatch(src, /from\s+["'][^"']*(apns|native-send|\/send\.mjs|messaging\/providers|messaging\/dispatch|outbound-fetch)/);
    assert.doesNotMatch(src, /\bfetch\s*\(|node:https?|node:http2/);
  });
});
