// Clarity Payments — the pure math and the SQL shapes, no Postgres.
// The database rules themselves live in db/migrations/443_clarity_payments.sql;
// the last block reads that file so a rule cannot be dropped silently.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  planView, installmentView, allocatePayment, validatePlanInput, planWords, ClarityInputError,
  addClarityPayment, recordClarityPayment, settleClarityPayment, listClarityPayments, logMoneyAction
} from "./clarity-payments.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SQL_443 = fs.readFileSync(path.resolve(HERE, "../../db/migrations/443_clarity_payments.sql"), "utf8");
const SQL_444 = fs.readFileSync(path.resolve(HERE, "../../db/migrations/444_money_agent_templates.sql"), "utf8");

const TODAY = "2026-10-06";
/* The owner's sample: $1,500 in 3 payments — one paid, one 4 days late, one coming. */
const PLAN = { id: "p1", kind: "clarity", owed_to: "Fundhub LLC", label: null, original_cents: "150000", status: "open" };
const INST = [
  { id: "i1", seq: 1, due_on: "2026-09-02", amount_cents: "50000", paid_cents: "50000", paid_at: "2026-09-02T17:00:00Z" },
  { id: "i2", seq: 2, due_on: "2026-10-02", amount_cents: "50000", paid_cents: "0", paid_at: null },
  { id: "i3", seq: 3, due_on: "2026-11-02", amount_cents: "50000", paid_cents: "0", paid_at: null }
];

describe("planView", () => {
  test("the sample: $1,000 left, 4 days late, next is the late one", () => {
    const v = planView(PLAN, INST, TODAY);
    assert.equal(v.original_cents, 150000);
    assert.equal(v.paid_cents, 50000);
    assert.equal(v.left_cents, 100000);
    assert.equal(v.is_late, true);
    assert.equal(v.days_late, 4);
    assert.equal(v.late_cents, 50000);
    assert.deepEqual(v.installments.map((i) => i.state), ["paid", "late", "upcoming"]);
    assert.equal(v.next.seq, 2);
    assert.equal(v.name, "Fundhub payment plan");
  });

  test("due in 3 days is due_soon; due today is due_soon, not late", () => {
    assert.equal(installmentView({ due_on: "2026-10-09", amount_cents: 1, paid_cents: 0 }, TODAY).state, "due_soon");
    assert.equal(installmentView({ due_on: "2026-10-06", amount_cents: 1, paid_cents: 0 }, TODAY).state, "due_soon");
    assert.equal(installmentView({ due_on: "2026-10-10", amount_cents: 1, paid_cents: 0 }, TODAY).state, "upcoming");
  });

  test("a settled plan shows nothing left and no late badge", () => {
    const v = planView({ ...PLAN, status: "settled", settled_at: "2026-10-06T00:00:00Z" }, INST, TODAY);
    assert.equal(v.left_cents, 0);
    assert.equal(v.is_late, false);
    assert.equal(v.next, null);
  });

  test("names: BNPL with a subsidiary says who it is owed to", () => {
    assert.equal(planWords({ kind: "bnpl", owed_to: "Fundhub Education" }), "buy now, pay later plan with Fundhub Education");
    assert.equal(planWords({ kind: "clarity", owed_to: "Fundhub LLC" }), "Fundhub payment plan");
    assert.equal(planWords({ kind: "clarity", label: "Program balance" }), "Program balance");
  });
});

describe("allocatePayment", () => {
  test("pays the oldest unpaid installment first and spills into the next", () => {
    const m = allocatePayment(INST, 70000);
    assert.deepEqual(m.map((x) => [x.id, x.from_cents, x.to_cents, x.fully_paid]), [
      ["i2", 0, 50000, true],
      ["i3", 0, 20000, false]
    ]);
  });

  test("more than is left is refused — never write down money we cannot place", () => {
    assert.throws(() => allocatePayment(INST, 100001), (e) => e instanceof ClarityInputError && e.code === "overpayment");
  });

  test("zero, negative or fractional cents are refused", () => {
    for (const bad of [0, -5, 10.5, NaN]) assert.throws(() => allocatePayment(INST, bad), ClarityInputError);
  });
});

describe("validatePlanInput", () => {
  test("original defaults to the sum of the schedule", () => {
    const p = validatePlanInput({ kind: "bnpl", installments: [
      { due_on: "2026-10-15", amount_cents: 30000 }, { due_on: "2026-11-15", amount_cents: 30000 }] });
    assert.equal(p.original_cents, 60000);
    assert.equal(p.owed_to, "Fundhub LLC");
    assert.deepEqual(p.installments.map((i) => i.seq), [1, 2]);
  });

  test("a schedule that does not add up to the plan is refused", () => {
    assert.throws(() => validatePlanInput({ kind: "clarity", original_cents: 150000,
      installments: [{ due_on: "2026-10-01", amount_cents: 50000 }] }), (e) => e.code === "schedule_mismatch");
  });

  test("bad kind, bad date, bad amount, empty schedule are refused", () => {
    assert.throws(() => validatePlanInput({ kind: "loan", installments: [{ due_on: "2026-10-01", amount_cents: 1 }] }));
    assert.throws(() => validatePlanInput({ kind: "clarity", installments: [{ due_on: "10/01/2026", amount_cents: 1 }] }));
    assert.throws(() => validatePlanInput({ kind: "clarity", installments: [{ due_on: "2026-10-01", amount_cents: 1.5 }] }));
    assert.throws(() => validatePlanInput({ kind: "clarity", installments: [] }));
  });
});

/* A db stand-in that records every statement and answers by pattern. */
function fakeDb(answer = () => ({ rows: [] })) {
  const calls = [];
  return { calls, query: async (sql, params) => { calls.push({ sql, params }); return answer(sql, params) || { rows: [] }; } };
}

describe("writes", () => {
  test("addClarityPayment writes the plan and its schedule in ONE statement (the deferred check needs it)", async () => {
    const db = fakeDb(() => ({ rows: [{ id: "new", installments: 3 }] }));
    const r = await addClarityPayment(db, { orgId: "o", clientId: "c", input: {
      kind: "clarity", installments: [
        { due_on: "2026-09-02", amount_cents: 50000 }, { due_on: "2026-10-02", amount_cents: 50000 }, { due_on: "2026-11-02", amount_cents: 50000 }] } });
    assert.equal(r.id, "new");
    assert.equal(db.calls.length, 1);
    assert.match(db.calls[0].sql, /INSERT INTO clarity_payments[\s\S]*INSERT INTO clarity_payment_installments/);
    assert.deepEqual(db.calls[0].params[9], [50000, 50000, 50000]);
  });

  test("recordClarityPayment updates only rows still at the paid amount it read, and settles a paid-off plan", async () => {
    const db = fakeDb((sql) => {
      if (/FROM clarity_payments WHERE id/.test(sql)) return { rows: [PLAN] };
      if (/SELECT[\s\S]*FROM clarity_payment_installments/.test(sql)) return { rows: INST };
      if (/UPDATE clarity_payment_installments/.test(sql)) return { rows: [{ id: "i2" }, { id: "i3" }] };
      if (/UPDATE clarity_payments/.test(sql)) return { rows: [{ id: "p1" }] };
      return { rows: [] };
    });
    const r = await recordClarityPayment(db, { orgId: "o", clientId: "c", planId: "p1", amountCents: 100000, paidAt: new Date("2026-10-06T12:00:00Z") });
    assert.equal(r.ok, true);
    assert.equal(r.settled, true);
    const upd = db.calls.find((c) => /UPDATE clarity_payment_installments/.test(c.sql));
    assert.match(upd.sql, /i\.paid_cents = m\.from_cents/);
    assert.deepEqual(upd.params[2], [50000, 50000]);
  });

  test("recordClarityPayment reports a conflict when another write got there first", async () => {
    const db = fakeDb((sql) => {
      if (/FROM clarity_payments WHERE id/.test(sql)) return { rows: [PLAN] };
      if (/SELECT[\s\S]*FROM clarity_payment_installments/.test(sql)) return { rows: INST };
      return { rows: [] };
    });
    const r = await recordClarityPayment(db, { orgId: "o", clientId: "c", planId: "p1", amountCents: 500 });
    assert.equal(r.error, "conflict");
  });

  test("another client's plan is not found; a closed plan is refused", async () => {
    assert.equal((await recordClarityPayment(fakeDb(), { orgId: "o", clientId: "c", planId: "p1", amountCents: 1 })).error, "not_found");
    const closed = fakeDb(() => ({ rows: [{ ...PLAN, status: "settled" }] }));
    assert.equal((await settleClarityPayment(closed, { orgId: "o", clientId: "c", planId: "p1" })).error, "plan_not_open");
  });

  test("list and every lookup filter on org AND client", async () => {
    const db = fakeDb((sql) => (/FROM clarity_payments/.test(sql) ? { rows: [PLAN] } : { rows: INST.map((i) => ({ ...i, clarity_payment_id: "p1" })) }));
    const plans = await listClarityPayments(db, { orgId: "o", clientId: "c", today: TODAY });
    assert.equal(plans.length, 1);
    assert.match(db.calls[0].sql, /org_id = \$1 AND client_id = \$2/);
    assert.deepEqual(db.calls[0].params, ["o", "c"]);
  });

  test("logMoneyAction is ON CONFLICT DO NOTHING; a staff row carries no brain", async () => {
    const db = fakeDb(() => ({ rows: [] }));
    const r = await logMoneyAction(db, { orgId: "o", clientId: "c", itemKind: "client", decidedOn: TODAY, action: "plan_added", actor: "staff" });
    assert.equal(r.created, false);
    assert.match(db.calls[0].sql, /ON CONFLICT DO NOTHING/);
    assert.equal(db.calls[0].params[8], null);
  });
});

describe("db/migrations/443 + 444 hold the rules", () => {
  test("kinds, statuses, never overpaid, paid_at on a paid row, schedule adds up", () => {
    assert.match(SQL_443, /kind IN \('clarity', 'bnpl', 'other'\)/);
    assert.match(SQL_443, /status IN \('open', 'settled', 'cancelled'\)/);
    assert.match(SQL_443, /CHECK \(paid_cents <= amount_cents\)/);
    assert.match(SQL_443, /paid_cents < amount_cents OR paid_at IS NOT NULL/);
    assert.match(SQL_443, /CREATE CONSTRAINT TRIGGER clarity_installments_schedule_ck[\s\S]*DEFERRABLE INITIALLY DEFERRED/);
  });

  test("the caps are unique indexes: one row per key, one client text per day", () => {
    assert.match(SQL_443, /money_agent_log_idem_uniq[\s\S]*\(org_id, idempotency_key\)/);
    assert.match(SQL_443, /money_agent_log_one_text_per_day[\s\S]*\(client_id, decided_on\) WHERE texts_client/);
  });

  test("RLS is on with a policy and the app role can read and write (no bare lock)", () => {
    for (const t of ["clarity_payments", "clarity_payment_installments", "money_agent_log"]) {
      assert.match(SQL_443, new RegExp(`ALTER TABLE public\\.${t} ENABLE ROW LEVEL SECURITY`));
      assert.match(SQL_443, new RegExp(`CREATE POLICY ${t}_app_all`));
      assert.match(SQL_443, new RegExp(`GRANT SELECT, INSERT, UPDATE ON public\\.${t} TO fundhub_app`));
    }
  });

  test("444 seeds the three helper texts, each with the opt-out line, without overwriting edits", () => {
    for (const k of ["SMS-MONEY-AGENT-REMINDER", "SMS-MONEY-AGENT-LATE-1", "SMS-MONEY-AGENT-LATE-2"]) assert.match(SQL_444, new RegExp(k));
    assert.equal((SQL_444.match(/Reply STOP to opt out\./g) || []).length, 3);
    assert.match(SQL_444, /ON CONFLICT \(org_id, template_key\) DO NOTHING/);
    assert.doesNotMatch(SQL_444, /\[DRAFT\]/);
  });
});
