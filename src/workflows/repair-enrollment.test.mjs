// repair-enrollment — the paid-for program starts itself, on the right number
// of rounds, and somebody is told to do something about it.
//
// The full enrolment write is proved end to end against a real Postgres in
// src/handlers/purchase-routing.pg.test.mjs. These are the decisions that do
// not need a database: which program the purchase means, when the first tasks
// are due, and every branch that must NOT open a program.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  repairPurchase,
  existingProgram,
  firstRepairTasks,
  createRepairStartTasks,
  ensureRepairEnrollment,
  TRIAL_PRODUCT_CODE,
  REPAIR_TASK_ROLE,
  SOURCE_WORKFLOW
} from "./repair-enrollment.mjs";
import { STAGE_SLA } from "../repair/sla.mjs";

const ORG = "11111111-1111-4111-8111-111111111111";
const CLIENT = "22222222-2222-4222-8222-222222222222";

/* A fake that answers only the statements this module issues. Anything else
   throws, so a query added later cannot pass by silently returning nothing. */
function fakeDb({ sales = [], programs = [], tasks = [], afterTaskSelectSnapshot = null } = {}) {
  const state = { sales, programs, tasks, enrolCalls: [] };
  state.query = async (sql, params = []) => {
    if (/FROM sales s/.test(sql)) {
      // This fake models SQL's paid-sale filter, while asserting the query
      // itself contains the critical same-sale, tenant, and refund gates.
      assert.match(sql, /paid\.net_paid > 0/, "never enroll an unpaid sale");
      assert.match(sql, /sp\.org_id = s\.org_id AND sp\.sale_id = s\.id/, "only money on this sale and company");
      assert.match(sql, /WHEN sp\.kind = 'refund' THEN -sp\.amount/, "refunds reduce paid money");
      return { rows: state.sales.filter((row) => Number(row.paid_so_far) > 0) };
    }
    if (/FROM repair_programs/.test(sql)) return { rows: state.programs.slice(0, 1) };
    if (/SELECT id FROM tasks/.test(sql)) {
      const [clientId, sourceWorkflow, title] = params;
      const hit = state.tasks.find(
        (t) => t.client_id === clientId && t.source_workflow === sourceWorkflow && t.title === title
      );
      // An adversarial synchronization point after the SELECT snapshot makes
      // both concurrent callers see "not present" before either can INSERT.
      if (afterTaskSelectSnapshot) await afterTaskSelectSnapshot({ title });
      return { rows: hit ? [{ id: hit.id }] : [] };
    }
    if (/INSERT INTO tasks/.test(sql)) {
      const [org_id, client_id, title, body, due_at, source_workflow, assignee_role] = params;
      // db/schema/006_tasks_idempotency.sql: the real unique index is on
      // (client_id, source_workflow, body) NULLS NOT DISTINCT. ON CONFLICT
      // DO NOTHING returns no row, even when the two task titles differ.
      if (state.tasks.some((task) =>
        task.client_id === client_id &&
        task.source_workflow === source_workflow &&
        task.body === body
      )) return { rows: [] };
      const row = {
        id: `task-${state.tasks.length + 1}`,
        org_id, client_id, title, body, due_at, source_workflow, assignee_role,
        detail: params[9] ?? null
      };
      state.tasks.push(row);
      return { rows: [{ id: row.id }] };
    }
    throw new Error(`fakeDb: unexpected query ${sql.slice(0, 80)}`);
  };
  return state;
}

const bundleSale = {
  sale_id: "sale-bundle",
  product_code: "repair-bundle",
  agreed_price: "1000.00",
  paid_so_far: "1000.00"
};
const trialSale = {
  sale_id: "sale-trial",
  product_code: TRIAL_PRODUCT_CODE,
  agreed_price: "200.00",
  paid_so_far: "200.00"
};

describe("which program a repair purchase means", () => {
  test("the full bundle is six rounds, not two", async () => {
    const db = fakeDb({ sales: [bundleSale] });
    const p = await repairPurchase(db, { orgId: ORG, clientId: CLIENT });
    assert.equal(p.program, "full");
    assert.equal(p.roundsCap, 6);
    assert.equal(p.priceTotal, 1000);
    assert.equal(p.amountPaid, 1000);
  });

  test("the named trial product, and only it, caps at two rounds", async () => {
    const db = fakeDb({ sales: [trialSale] });
    const p = await repairPurchase(db, { orgId: ORG, clientId: CLIENT });
    assert.equal(p.program, "trial");
    assert.equal(p.roundsCap, 2);
    assert.equal(p.priceTotal, 200);
  });

  test("a repair product nobody has met yet gets the full program, never the cap", async () => {
    // The failure this pins: capping a paying client at two rounds because a
    // new product code was not on a list somewhere.
    const db = fakeDb({
      sales: [{ sale_id: "s", product_code: "repair-premium", agreed_price: "2500.00", paid_so_far: "2500.00" }]
    });
    const p = await repairPurchase(db, { orgId: ORG, clientId: CLIENT });
    assert.equal(p.program, "full");
    assert.equal(p.roundsCap, 6);
  });

  test("a client who bought the trial and then the bundle is on the bundle", async () => {
    const db = fakeDb({ sales: [trialSale, bundleSale] });
    const p = await repairPurchase(db, { orgId: ORG, clientId: CLIENT });
    assert.equal(p.productCode, "repair-bundle");
    assert.equal(p.roundsCap, 6);
  });

  test("a signed but unpaid full bundle cannot replace a paid trial", async () => {
    const db = fakeDb({ sales: [
      { sale_id: "unsigned-money", product_code: "repair-bundle", agreed_price: "1000.00", paid_so_far: "0" },
      trialSale
    ] });
    const p = await repairPurchase(db, { orgId: ORG, clientId: CLIENT });
    assert.equal(p.saleId, trialSale.sale_id);
    assert.equal(p.program, "trial");
    assert.equal(p.roundsCap, 2);
    assert.equal(p.amountPaid, 200);
  });

  test("a fully refunded full bundle cannot replace a paid trial", async () => {
    const db = fakeDb({ sales: [
      { sale_id: "fully-refunded", product_code: "repair-bundle", agreed_price: "1000.00", paid_so_far: "0.00" },
      trialSale
    ] });
    const p = await repairPurchase(db, { orgId: ORG, clientId: CLIENT });
    assert.equal(p.saleId, trialSale.sale_id);
    assert.equal(p.program, "trial");
  });

  test("a partially refunded paid full sale uses net cash, not gross deposits", async () => {
    const db = fakeDb({ sales: [
      { sale_id: "part-refund", product_code: "repair-bundle", agreed_price: "1000.00", paid_so_far: "450.00" }
    ] });
    const p = await repairPurchase(db, { orgId: ORG, clientId: CLIENT });
    assert.equal(p.program, "full");
    assert.equal(p.priceTotal, 1000);
    assert.equal(p.amountPaid, 450);
  });

  test("a success-fee-only repair sale is not a paid program", async () => {
    const db = fakeDb({ sales: [
      { sale_id: "fee-only", product_code: "repair-bundle", agreed_price: "1000.00", paid_so_far: "0" }
    ] });
    assert.equal(await repairPurchase(db, { orgId: ORG, clientId: CLIENT }), null);
  });

  test("no active repair sale is null, not a guess", async () => {
    const db = fakeDb({ sales: [] });
    assert.equal(await repairPurchase(db, { orgId: ORG, clientId: CLIENT }), null);
  });

  test("an unpriced sale falls back to the money that actually landed", async () => {
    const db = fakeDb({
      sales: [{ sale_id: "s", product_code: "repair-bundle", agreed_price: null, paid_so_far: "500.00" }]
    });
    const p = await repairPurchase(db, { orgId: ORG, clientId: CLIENT });
    assert.equal(p.priceTotal, 500);
  });

  test("an unpriced, unpaid offer has no program to choose", async () => {
    const db = fakeDb({
      sales: [{ sale_id: "s", product_code: "repair-bundle", agreed_price: null, paid_so_far: null }]
    });
    const p = await repairPurchase(db, { orgId: ORG, clientId: CLIENT });
    assert.equal(p, null, "no funding from an unpaid signature or unknown amount");
  });
});

describe("the first two jobs on a repair file", () => {
  test("both exist, both are owned, and both are dated from the stage clocks", () => {
    const now = new Date("2026-09-07T00:00:00Z"); // a Monday
    const t = firstRepairTasks({ roundsCap: 6, now });
    assert.equal(t.length, 2);
    assert.match(t[0].title, /confirm the plan with the client/);
    assert.match(t[1].title, /photo identification and proof of address/);

    // intake: three business days. Mon 7 Sep -> Thu 10 Sep.
    assert.equal(STAGE_SLA.intake.days, 3);
    assert.equal(t[0].dueAt.toISOString().slice(0, 10), "2026-09-10");

    // awaiting_documents: fourteen days.
    assert.equal(STAGE_SLA.awaiting_documents.days, 14);
    assert.equal(t[1].dueAt.toISOString().slice(0, 10), "2026-09-21");
  });

  test("the round count in the wording comes from the program, not a constant", () => {
    assert.match(firstRepairTasks({ roundsCap: 6 })[0].body, /6 rounds are paid for/);
    assert.match(firstRepairTasks({ roundsCap: 2 })[0].body, /2 rounds are paid for/);
  });

  test("an unknown round count says nothing about rounds rather than a wrong number", () => {
    const body = firstRepairTasks({ roundsCap: null })[0].body;
    assert.doesNotMatch(body, /rounds are paid for/);
  });

  test("the tasks reach a real employee role", async () => {
    const db = fakeDb();
    await createRepairStartTasks(db, { orgId: ORG, clientId: CLIENT, roundsCap: 6 });
    assert.equal(db.tasks.length, 2);
    for (const t of db.tasks) {
      assert.equal(t.assignee_role, REPAIR_TASK_ROLE);
      assert.equal(t.source_workflow, SOURCE_WORKFLOW);
    }
  });

  test("a single paid event creates BOTH jobs under the actual database unique key", async () => {
    const db = fakeDb();
    const first = await createRepairStartTasks(db, {
      orgId: ORG, clientId: CLIENT, eventId: "same-payment-event", roundsCap: 6
    });
    assert.equal(first.count, 2, "the second job was discarded by ON CONFLICT");
    assert.equal(db.tasks.length, 2);
    assert.equal(new Set(db.tasks.map((t) => t.body)).size, 2,
      "two titles shared one idempotency key");
    const replay = await createRepairStartTasks(db, {
      orgId: ORG, clientId: CLIENT, eventId: "different-event-same-buyer", roundsCap: 6
    });
    assert.equal(replay.count, 0);
    assert.equal(db.tasks.length, 2);
  });

  test("concurrent trial/full plan changes cannot create two tasks with the same title", async () => {
    // Before this change, plan task body changed from "2 rounds" to "6 rounds".
    // Both title SELECTs saw zero; the unique index saw different bodies and
    // allowed two competing instructions for the same paid client's file.
    const planTitle = firstRepairTasks({ roundsCap: 2 })[0].title;
    let waiting = 0;
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const db = fakeDb({
      afterTaskSelectSnapshot: async ({ title }) => {
        if (title !== planTitle) return;
        if (++waiting === 2) release();
        await gate;
      }
    });
    await Promise.all([
      createRepairStartTasks(db, { orgId: ORG, clientId: CLIENT, roundsCap: 2 }),
      createRepairStartTasks(db, { orgId: ORG, clientId: CLIENT, roundsCap: 6 })
    ]);
    assert.equal(db.tasks.filter((t) => t.title === planTitle).length, 1,
      "read-then-insert title dedupe lost a race when plan wording changed");
    assert.equal(db.tasks.length, 2, "there must be one plan job and one document job");
    assert.equal(new Set(db.tasks.map((t) => t.body)).size, 2);
    assert.ok(db.tasks.every((t) => t.detail),
      "round-count/document instructions must remain readable to staff");
  });

  test("a historical one-task repair intake receives only the missing document job", async () => {
    const task = firstRepairTasks({ roundsCap: 6 })[0];
    const db = fakeDb({ tasks: [{
      id: "old-task", client_id: CLIENT, source_workflow: SOURCE_WORKFLOW,
      title: task.title, body: "legacy-payment-event"
    }] });
    const result = await createRepairStartTasks(db, {
      orgId: ORG, clientId: CLIENT, eventId: "later-installment", roundsCap: 6
    });
    assert.equal(result.count, 1);
    assert.equal(db.tasks.length, 2);
    assert.equal(db.tasks[0].body, "legacy-payment-event", "never rewrite a live task");
    assert.match(db.tasks[1].title, /photo identification and proof of address/);
  });

  test("a replayed payment does not hand the same person the same job twice", async () => {
    const db = fakeDb();
    await createRepairStartTasks(db, { orgId: ORG, clientId: CLIENT, eventId: "evt-1", roundsCap: 6 });
    await createRepairStartTasks(db, { orgId: ORG, clientId: CLIENT, eventId: "evt-2", roundsCap: 6 });
    assert.equal(db.tasks.length, 2, "a second payment event duplicated the intake tasks");
  });
});

describe("when a program must NOT be opened", () => {
  test("no repair sale: nothing is enrolled", async () => {
    const db = fakeDb({ sales: [] });
    const r = await ensureRepairEnrollment(db, { orgId: ORG, clientId: CLIENT });
    assert.equal(r.enrolled, false);
    assert.equal(r.reason, "no_active_repair_sale");
    assert.equal(db.tasks.length, 0);
  });

  test("an unpriced, unpaid repair offer cannot start a program or tasks", async () => {
    const db = fakeDb({
      sales: [{ sale_id: "s", product_code: "repair-bundle", agreed_price: null, paid_so_far: null }]
    });
    const r = await ensureRepairEnrollment(db, { orgId: ORG, clientId: CLIENT });
    assert.equal(r.enrolled, false);
    assert.equal(r.reason, "no_active_repair_sale");
    assert.equal(db.tasks.length, 0);
  });

  test("a live program is never rewritten by a later payment", async () => {
    // The client is four rounds into the full program. A trial sale arriving
    // afterwards must not drag rounds_cap down to two.
    const db = fakeDb({
      sales: [trialSale],
      programs: [{ id: "prog-1", program: "full", rounds_cap: 6, status: "active" }]
    });
    const r = await ensureRepairEnrollment(db, { orgId: ORG, clientId: CLIENT });
    assert.equal(r.enrolled, false);
    assert.equal(r.reason, "already_enrolled");
    assert.equal(r.roundsCap, 6, "an existing six-round program was downgraded");
  });

  test("a client enrolled by hand before this existed still gets their tasks", async () => {
    const db = fakeDb({
      sales: [trialSale],
      programs: [{ id: "prog-1", program: "trial", rounds_cap: 2, status: "active" }]
    });
    const r = await ensureRepairEnrollment(db, { orgId: ORG, clientId: CLIENT });
    assert.equal(r.tasks.count, 2);
    assert.equal(db.tasks.length, 2);
  });

  test("missing ids do nothing at all", async () => {
    const db = fakeDb();
    assert.equal((await ensureRepairEnrollment(db, { orgId: ORG })).reason, "missing_ids");
    assert.equal((await ensureRepairEnrollment(db, { clientId: CLIENT })).reason, "missing_ids");
  });
});

describe("existingProgram", () => {
  test("reads back the open program", async () => {
    const db = fakeDb({ programs: [{ id: "prog-1", program: "full", rounds_cap: 6, status: "active" }] });
    assert.equal((await existingProgram(db, { orgId: ORG, clientId: CLIENT })).rounds_cap, 6);
  });

  test("no program is null", async () => {
    const db = fakeDb();
    assert.equal(await existingProgram(db, { orgId: ORG, clientId: CLIENT }), null);
  });
});
