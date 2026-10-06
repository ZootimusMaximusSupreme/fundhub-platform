// The money helper — the rules brain and one client's run, against an
// in-memory stand-in that keeps money_agent_log's two unique indexes. No
// Postgres, no network, and NO real text: `send` is a spy every time.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  rulesBrain, pickBrain, rungFor, cardLateItem, runForClient, askForPerson, keyFor, doneRungsFrom, TEMPLATES
} from "./money-agent.mjs";

const ORG = "o1";
const CLIENT = "c1";

describe("rungFor — the ladder", () => {
  test("reminder 0-3 days before, check-in day 1, again day 3, CSM day 7", () => {
    assert.equal(rungFor(-4), null);
    assert.equal(rungFor(-3).action, "reminder");
    assert.equal(rungFor(0).action, "reminder");
    assert.equal(rungFor(1).action, "late_check_in");
    assert.equal(rungFor(2).action, "late_check_in");
    assert.equal(rungFor(3).action, "second_check_in");
    assert.equal(rungFor(6).action, "second_check_in");
    assert.equal(rungFor(7).action, "csm_task");
    assert.equal(rungFor(40).action, "csm_task");
  });
});

describe("rulesBrain", () => {
  const item = (o = {}) => ({ kind: "clarity_installment", leftCents: 50000, daysLate: 4, doneRungs: new Set(), ...o });

  test("4 days late with nothing done → second check-in (highest rung wins, no pile of old ones)", () => {
    const d = rulesBrain(item(), {});
    assert.equal(d.action, "second_check_in");
    assert.equal(d.texts, true);
  });

  test("a rung already done, or a higher one, means nothing today", () => {
    assert.equal(rulesBrain(item({ doneRungs: new Set([2]) }), {}).action, null);
    assert.equal(rulesBrain(item({ daysLate: 1, doneRungs: new Set([3]) }), {}).action, null);
  });

  test("after the CSM task there are no more texts about that item", () => {
    assert.equal(rulesBrain(item({ daysLate: 20, doneRungs: new Set([3]) }), {}).reason, "already_done");
  });

  test("paid, or linked to an invoice the AR ladder owns → nothing", () => {
    assert.equal(rulesBrain(item({ leftCents: 0 }), {}).reason, "paid");
    assert.equal(rulesBrain(item({ linkedInvoice: true }), {}).reason, "invoice_owned_by_ar_ladder");
  });

  test("card reminders before the due date belong to the card due texts — never repeated here", () => {
    assert.equal(rulesBrain(item({ kind: "card_due", daysLate: -1 }), {}).reason, "card_reminder_sent_by_card_due_texts");
    assert.equal(rulesBrain(item({ kind: "card_due", daysLate: 1 }), {}).action, "late_check_in");
  });

  test("opted out, escalation, or a person already on it → held, never a text", () => {
    assert.deepEqual(rulesBrain(item(), { optedOut: true }), { action: "held", rung: 2, reason: "opted_out" });
    assert.equal(rulesBrain(item(), { escalated: true }).reason, "escalation_on_file");
    assert.equal(rulesBrain(item(), { handedToPerson: true }).reason, "a_person_has_this");
  });

  test("the CSM step still happens for an opted-out client — a person is not a text", () => {
    assert.equal(rulesBrain(item({ daysLate: 7 }), { optedOut: true }).action, "csm_task");
  });

  test("the brain today is the rules brain", () => {
    assert.equal(pickBrain({ ANYTHING: "1" }), rulesBrain);
    assert.equal(rulesBrain.brainId, "rules");
  });
});

describe("cardLateItem", () => {
  const row = (raw, o = {}) => ({ bank_account_id: "a1", name: "Business Amex", minimum_payment_cents: 13500, last_statement_balance_cents: 90000, last_statement_date: "2026-09-25", raw, ...o });

  test("due date passed, no payment since the statement → late item", () => {
    const it = cardLateItem(row({ next_payment_due_date: "2026-10-02" }), "2026-10-06");
    assert.equal(it.daysLate, 4);
    assert.equal(it.key, "card_due:a1:2026-10-02");
    assert.equal(it.what, "Business Amex card");
  });

  test("a payment on or after the statement date → not late", () => {
    assert.equal(cardLateItem(row({ next_payment_due_date: "2026-10-02", last_payment_date: "2026-09-30" }), "2026-10-06"), null);
  });

  test("not yet due, nothing due, or no due date → nothing", () => {
    assert.equal(cardLateItem(row({ next_payment_due_date: "2026-10-09" }), "2026-10-06"), null);
    assert.equal(cardLateItem(row({ next_payment_due_date: "2026-10-02" }, { minimum_payment_cents: 0 }), "2026-10-06"), null);
    assert.equal(cardLateItem(row({}), "2026-10-06"), null);
  });
});

describe("keys", () => {
  test("held rows never count as a rung done", () => {
    const m = doneRungsFrom([keyFor("clarity_installment:i2", 1), keyFor("clarity_installment:i2", 2, "opted_out")]);
    assert.deepEqual([...m.get("clarity_installment:i2")], [1]);
  });
});

/* ── one client's run, against an in-memory money_agent_log ──────────────── */

function world({ installments = [], cycles = [], facts = {}, log = [] } = {}) {
  const rows = log.map((r) => ({ ...r }));
  const updates = [];
  const db = {
    rows, updates,
    async query(sql, params) {
      if (/EXISTS \(SELECT 1 FROM opt_outs/.test(sql)) {
        return { rows: [{ opted_out: !!facts.optedOut, escalated: !!facts.escalated, handed: !!facts.handed }] };
      }
      if (/SELECT idempotency_key FROM money_agent_log/.test(sql)) return { rows: rows.map((r) => ({ idempotency_key: r.idempotency_key })) };
      if (/FROM account_statement_cycles/.test(sql)) return { rows: cycles };
      if (/FROM clarity_payment_installments i/.test(sql)) return { rows: installments };
      if (/INSERT INTO money_agent_log/.test(sql)) {
        const [orgId, clientId, , , , decidedOn, action, , , , texts, , , key] = params;
        const dupKey = key && rows.some((r) => r.org_id === orgId && r.idempotency_key === key);
        const dupText = texts && rows.some((r) => r.client_id === clientId && r.decided_on === decidedOn && r.texts_client);
        if (dupKey || dupText) return { rows: [] };
        const id = `log-${rows.length + 1}`;
        rows.push({ id, org_id: orgId, client_id: clientId, decided_on: decidedOn, action, texts_client: texts, idempotency_key: key });
        return { rows: [{ id }] };
      }
      if (/UPDATE money_agent_log/.test(sql)) { updates.push({ sql, params }); return { rows: [] }; }
      throw new Error(`unexpected SQL: ${sql.slice(0, 80)}`);
    }
  };
  return db;
}

const INST_LATE = { id: "i2", seq: 2, due_on: "2026-10-02", amount_cents: "50000", paid_cents: "0", plan_id: "p1", kind: "clarity", owed_to: "Fundhub LLC", label: null, invoice_id: null };

function spySend(result = { sent: true }) {
  const calls = [];
  const fn = async (_db, args) => { calls.push(args); return result; };
  fn.calls = calls;
  return fn;
}
function spyTask() {
  const calls = [];
  const fn = async (_db, args) => { calls.push(args); return { created: true, id: "task-1" }; };
  fn.calls = calls;
  return fn;
}

describe("runForClient", () => {
  test("4 days late: claims the second check-in, then queues ONE text with the amount and date", async () => {
    const db = world({ installments: [INST_LATE] });
    const send = spySend();
    const r = await runForClient(db, { orgId: ORG, clientId: CLIENT, todayIso: "2026-10-06", send, createTask: spyTask() });
    assert.equal(r.queued, 1);
    assert.equal(send.calls.length, 1);
    assert.equal(send.calls[0].templateKey, TEMPLATES.second_check_in);
    assert.equal(send.calls[0].channel, "sms");
    assert.deepEqual(send.calls[0].context.money, { what: "Fundhub payment plan", amount_phrase: " of $500.00", due: "Oct 2" });
    assert.equal(send.calls[0].eventId, "money-agent:clarity_installment:i2:2");
    // claimed BEFORE queued, then the outcome written back
    assert.equal(db.rows.length, 1);
    assert.equal(db.updates[0].params[1], "queued");
  });

  test("the same day again, or tomorrow, sends nothing more for that rung", async () => {
    const db = world({ installments: [INST_LATE] });
    const send = spySend();
    await runForClient(db, { orgId: ORG, clientId: CLIENT, todayIso: "2026-10-06", send, createTask: spyTask() });
    await runForClient(db, { orgId: ORG, clientId: CLIENT, todayIso: "2026-10-06", send, createTask: spyTask() });
    await runForClient(db, { orgId: ORG, clientId: CLIENT, todayIso: "2026-10-07", send, createTask: spyTask() });
    assert.equal(send.calls.length, 1);
  });

  test("day 7: a CSM task, and no text", async () => {
    const db = world({ installments: [INST_LATE] });
    const send = spySend();
    const task = spyTask();
    const r = await runForClient(db, { orgId: ORG, clientId: CLIENT, todayIso: "2026-10-09", send, createTask: task });
    assert.equal(r.tasks, 1);
    assert.equal(send.calls.length, 0);
    assert.equal(task.calls[0].assigneeRole, "csm");
    assert.equal(task.calls[0].sourceWorkflow, "money-agent");
    assert.match(task.calls[0].title, /Late payment: Fundhub payment plan \(7 days\)/);
    // and never again after that
    await runForClient(db, { orgId: ORG, clientId: CLIENT, todayIso: "2026-10-20", send, createTask: task });
    assert.equal(send.calls.length, 0);
    assert.equal(task.calls.length, 1);
  });

  test("opted out: a 'held' row, no text queued", async () => {
    const db = world({ installments: [INST_LATE], facts: { optedOut: true } });
    const send = spySend();
    const r = await runForClient(db, { orgId: ORG, clientId: CLIENT, todayIso: "2026-10-06", send, createTask: spyTask() });
    assert.equal(send.calls.length, 0);
    assert.equal(r.held, 1);
    assert.equal(db.rows[0].action, "held");
    assert.equal(db.rows[0].texts_client, false);
  });

  test("two late items: one text today (the most late one), the other waits", async () => {
    const card = { bank_account_id: "a1", name: "Business Amex", minimum_payment_cents: 13500, last_statement_balance_cents: 90000,
      last_statement_date: "2026-09-25", raw: { next_payment_due_date: "2026-10-05" } };
    const db = world({ installments: [INST_LATE], cycles: [card] });
    const send = spySend();
    const r = await runForClient(db, { orgId: ORG, clientId: CLIENT, todayIso: "2026-10-06", send, createTask: spyTask() });
    assert.equal(send.calls.length, 1);
    assert.equal(send.calls[0].eventId, "money-agent:clarity_installment:i2:2");
    assert.equal(r.waiting, 1);
    // tomorrow the card gets its turn
    await runForClient(db, { orgId: ORG, clientId: CLIENT, todayIso: "2026-10-07", send, createTask: spyTask() });
    assert.equal(send.calls.length, 2);
    assert.equal(send.calls[1].eventId, "money-agent:card_due:a1:2026-10-05:1");
    assert.deepEqual(send.calls[1].context.money, { what: "Business Amex card", amount_phrase: " of $135.00", due: "Oct 5" });
  });

  test("a refused send is written down, not retried", async () => {
    const db = world({ installments: [INST_LATE] });
    const send = spySend({ sent: false, reason: "opted_out" });
    const r = await runForClient(db, { orgId: ORG, clientId: CLIENT, todayIso: "2026-10-06", send, createTask: spyTask() });
    assert.equal(r.queued, 0);
    assert.deepEqual(r.notQueued, [{ key: "money-agent:clarity_installment:i2:2", reason: "opted_out" }]);
    assert.equal(db.updates[0].params[1], "opted_out");
  });

  test("a brain cannot invent an action — anything off the ladder is ignored", async () => {
    const db = world({ installments: [INST_LATE] });
    const send = spySend();
    const rogue = async () => ({ action: "wire_money", rung: 9 });
    const r = await runForClient(db, { orgId: ORG, clientId: CLIENT, todayIso: "2026-10-06", brain: rogue, send, createTask: spyTask() });
    assert.equal(r.decided, 0);
    assert.equal(send.calls.length, 0);
    assert.equal(db.rows.length, 0);
  });

  test("a plugged-in brain names itself in the log", async () => {
    const db = world({ installments: [INST_LATE] });
    const seen = [];
    const fakeAi = async (item, facts) => rulesBrain(item, facts);
    fakeAi.brainId = "ai-test";
    const realQuery = db.query.bind(db);
    db.query = async (sql, params) => { if (/INSERT INTO money_agent_log/.test(sql)) seen.push(params[8]); return realQuery(sql, params); };
    await runForClient(db, { orgId: ORG, clientId: CLIENT, todayIso: "2026-10-06", brain: fakeAi, send: spySend(), createTask: spyTask() });
    assert.deepEqual(seen, ["ai-test"]);
  });
});

describe("askForPerson", () => {
  test("opens one CSM task per client per day and logs it as the client's ask", async () => {
    const db = world();
    const task = spyTask();
    const r = await askForPerson(db, { orgId: ORG, clientId: CLIENT, todayIso: "2026-10-06", createTask: task });
    assert.equal(r.ok, true);
    assert.equal(task.calls[0].assigneeRole, "csm");
    assert.equal(task.calls[0].eventId, "money-agent:asked:c1:2026-10-06");
    assert.equal(db.rows[0].action, "asked_for_person");
  });
});
