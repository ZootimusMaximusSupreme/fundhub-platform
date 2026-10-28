import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BELIEFS,
  normalizeBelief,
  normalizeOutcome,
  OUTCOMES
} from "../sales/beliefs.mjs";
import {
  CallOutcomeError,
  logCallOutcome,
  paidTransactionForLink,
  resolveCashCollected,
  presentOutcome
} from "../sales/call-outcomes.mjs";

test("beliefs: seven Cole Gordon beliefs", () => {
  assert.deepEqual(BELIEFS, ["pain", "doubt", "cost", "desire", "money", "support", "trust"]);
});

test("normalizeBelief: none and empty become null; unknown is undefined", () => {
  assert.equal(normalizeBelief("none"), null);
  assert.equal(normalizeBelief(""), null);
  assert.equal(normalizeBelief("desire"), "desire");
  assert.equal(normalizeBelief("nope"), undefined);
});

test("normalizeOutcome: accepts spaces and underscores", () => {
  assert.equal(normalizeOutcome("no show"), "no_show");
  assert.equal(normalizeOutcome("deposit"), "deposit");
  assert.equal(normalizeOutcome("bogus"), undefined);
  assert.ok(OUTCOMES.includes("not_a_fit"));
});

function stubDb(handlers = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      for (const [re, fn] of handlers) {
        if (re.test(sql)) return fn(params, sql);
      }
      if (/INSERT INTO events/.test(sql)) return { rows: [{ id: "evt-stub" }] };
      return { rows: [] };
    }
  };
}

test("resolveCashCollected: non-deposit outcomes are zero", async () => {
  const db = stubDb();
  const r = await resolveCashCollected(db, {
    orgId: "o", clientId: "c", outcome: "callback"
  });
  assert.equal(r.cashCollectedCents, 0);
  assert.equal(db.calls.length, 0);
});

test("resolveCashCollected: reads amount from paid transaction", async () => {
  const db = stubDb([
    [/FROM transactions/, () => ({ rows: [{ id: "tx1", amount_paid: "3000.00" }] })]
  ]);
  const r = await resolveCashCollected(db, {
    orgId: "11111111-1111-4111-8111-111111111111",
    clientId: "22222222-2222-4222-8222-222222222222",
    outcome: "deposit", transactionId: "tx1"
  });
  assert.equal(r.cashCollectedCents, 300000);
  assert.equal(r.transactionId, "tx1");
});

test("resolveCashCollected: an accepted offer cannot claim another paid item", async () => {
  const db = stubDb([[/FROM transactions/, () => { throw new Error("must not search client purchases"); }]]);
  const r = await resolveCashCollected(db, { orgId: "o", clientId: "c", outcome: "deposit" });
  assert.deepEqual(r, { cashCollectedCents: 0, transactionId: null });
  assert.equal(db.calls.length, 0);
});

test("paidTransactionForLink only accepts the call's paid checkout link", async () => {
  const db = stubDb([[/FROM payment_links pl/, () => ({ rows: [{ id: "tx-1" }] })]]);
  const id = await paidTransactionForLink(db, {
    orgId: "org-1", clientId: "client-1", staffId: "staff-1",
    paymentLinkId: "link-1", productCode: "card-stacking-dfy"
  });
  assert.equal(id, "tx-1");
  assert.deepEqual(db.calls[0].params, ["link-1", "org-1", "client-1", "staff-1", "card-stacking-dfy"]);
  assert.match(db.calls[0].sql, /sp.payment_link_id = pl.id/);
  assert.match(db.calls[0].sql, /t.status IN \('paid','succeeded','complete','completed'\)/);
  const missing = await paidTransactionForLink(db, {
    orgId: "org-1", clientId: "client-1", staffId: "staff-1",
    paymentLinkId: null, productCode: "card-stacking-dfy"
  });
  assert.equal(missing, null);
  assert.equal(db.calls.length, 1);
});

test("logCallOutcome: refuses typed cash by never reading amount from input", async () => {
  const org = "11111111-1111-4111-8111-111111111111";
  const client = "22222222-2222-4222-8222-222222222222";
  const staff = "33333333-3333-4333-8333-333333333333";
  const db = stubDb([
    [/FROM clients/, () => ({ rows: [{ id: client }] })],
    [/FROM transactions/, () => ({ rows: [{ id: "tx1", amount_paid: 2000 }] })],
    [/INSERT INTO call_outcomes/, (params) => ({
      rows: [{
        id: "out1", org_id: org, client_id: client, staff_id: staff,
        outcome: "deposit", belief_failed: "desire",
        cash_collected_cents: params[7], transaction_id: params[8],
        logged_at: new Date().toISOString()
      }]
    })]
  ]);
  const { row, created } = await logCallOutcome(db, {
    orgId: org, clientId: client, staffId: staff,
    outcome: "deposit", beliefFailed: "desire", transactionId: "tx1",
    // caller tries to pass cash — ignored; module only takes transactionId
    amount: 999999
  });
  assert.equal(created, true);
  assert.equal(row.cash_collected_cents, 200000);
  const presented = presentOutcome(row);
  assert.equal(presented.belief_failed, "desire");
  assert.match(presented.belief_label, /Desire/);
});

test("logCallOutcome: checklist is stored and returned, unchecked boxes are false not missing", async () => {
  const org = "11111111-1111-4111-8111-111111111111";
  const client = "22222222-2222-4222-8222-222222222222";
  const staff = "33333333-3333-4333-8333-333333333333";
  let notes;
  const db = stubDb([
    [/FROM clients/, () => ({ rows: [{ id: client }] })],
    [/INSERT INTO call_outcomes/, (params) => {
      notes = params[11];
      return {
        rows: [{
          id: "out1", org_id: org, client_id: client, staff_id: staff,
          outcome: "callback", belief_failed: null,
          cash_collected_cents: 0, notes
        }]
      };
    }]
  ]);
  const { row } = await logCallOutcome(db, {
    orgId: org, clientId: client, staffId: staff,
    outcome: "callback",
    checklist: { call_recorded: true, personal_guarantee: false }
  });
  assert.match(String(notes), /checklist:/);
  const presented = presentOutcome(row);
  assert.equal(presented.checklist.call_recorded, true);
  assert.equal(presented.checklist.personal_guarantee, false);
  assert.equal(presented.checklist.month_14_cliff, false);
  assert.equal(presented.checklist.bank_decides, false);
  assert.equal(presented.checklist.incorporation_verified, false);
});

test("logCallOutcome: bad outcome throws CallOutcomeError", async () => {
  await assert.rejects(
    () => logCallOutcome(stubDb(), {
      orgId: "11111111-1111-4111-8111-111111111111",
      clientId: "22222222-2222-4222-8222-222222222222",
      staffId: "33333333-3333-4333-8333-333333333333",
      outcome: "maybe"
    }),
    (e) => e instanceof CallOutcomeError && e.status === 400
  );
});

test("logCallOutcome: emits call.completed with closer disposition after a write", async () => {
  const org = "11111111-1111-4111-8111-111111111111";
  const client = "22222222-2222-4222-8222-222222222222";
  const staff = "33333333-3333-4333-8333-333333333333";
  const taskId = "44444444-4444-4444-8444-444444444444";
  let eventInsert;
  const db = stubDb([
    [/FROM clients/, () => ({ rows: [{
      id: client,
      custom_fields: { closer_deck_disposition: { offer_key: "REPAIR_DFY" } }
    }] })],
    [/FROM tasks/, () => ({ rows: [{ id: taskId }] })],
    [/INSERT INTO call_outcomes/, () => ({
      rows: [{
        id: "out-closer-1", org_id: org, client_id: client, staff_id: staff,
        task_id: taskId, outcome: "not_a_fit", belief_failed: null,
        cash_collected_cents: 0
      }]
    })],
    [/INSERT INTO events/, (params) => {
      eventInsert = params;
      return { rows: [{ id: "evt-closer-1" }] };
    }]
  ]);
  const { created } = await logCallOutcome(db, {
    orgId: org, clientId: client, staffId: staff, taskId,
    outcome: "not_a_fit", repairReferral: true
  });
  assert.equal(created, true);
  assert.equal(eventInsert[1], "call.completed");
  assert.equal(eventInsert[3], "call.completed:closer:out-closer-1");
  assert.deepEqual(eventInsert[5], {
    clientId: client,
    orgId: org,
    outcome: "not_a_fit",
    offerKey: "REPAIR_DFY",
    disposition: "closer",
    repairReferral: true,
    declineReason: null,
    taskId,
    transactionId: null
  });
});

test("logCallOutcome: re-save uses the same idempotency key and does not insert a second outcome", async () => {
  const org = "11111111-1111-4111-8111-111111111111";
  const client = "22222222-2222-4222-8222-222222222222";
  const staff = "33333333-3333-4333-8333-333333333333";
  const taskId = "44444444-4444-4444-8444-444444444444";
  const existing = {
    id: "out-existing", org_id: org, client_id: client, staff_id: staff,
    task_id: taskId, outcome: "callback"
  };
  const eventKeys = [];
  let outcomeInserts = 0;
  const db = stubDb([
    [/FROM clients/, () => ({ rows: [{ id: client, custom_fields: {} }] })],
    [/FROM tasks/, () => ({ rows: [{ id: taskId }] })],
    [/SELECT \* FROM call_outcomes/, () => ({ rows: [existing] })],
    [/INSERT INTO call_outcomes/, () => {
      outcomeInserts += 1;
      return { rows: [existing] };
    }],
    [/INSERT INTO events/, (params) => {
      eventKeys.push(params[3]);
      return { rows: [{ id: "evt-existing" }] };
    }]
  ]);
  const first = await logCallOutcome(db, {
    orgId: org, clientId: client, staffId: staff, taskId, outcome: "callback"
  });
  const second = await logCallOutcome(db, {
    orgId: org, clientId: client, staffId: staff, taskId, outcome: "callback"
  });
  assert.equal(first.created, false);
  assert.equal(second.created, false);
  assert.equal(outcomeInserts, 0);
  assert.deepEqual(eventKeys, [
    "call.completed:closer:out-existing",
    "call.completed:closer:out-existing"
  ]);
  assert.equal(first.row.outcome, "callback");
  assert.notEqual(eventKeys[0], null);
});

test("logCallOutcome: closer disposition is never a no-answer value", async () => {
  const org = "11111111-1111-4111-8111-111111111111";
  const client = "22222222-2222-4222-8222-222222222222";
  const staff = "33333333-3333-4333-8333-333333333333";
  let payload;
  const db = stubDb([
    [/FROM clients/, () => ({ rows: [{ id: client, custom_fields: {} }] })],
    [/INSERT INTO call_outcomes/, () => ({
      rows: [{
        id: "out-cb", org_id: org, client_id: client, staff_id: staff,
        task_id: null, outcome: "callback"
      }]
    })],
    [/INSERT INTO events/, (params) => {
      payload = params[5];
      return { rows: [{ id: "evt-cb" }] };
    }]
  ]);
  await logCallOutcome(db, {
    orgId: org, clientId: client, staffId: staff, outcome: "callback"
  });
  assert.equal(payload.disposition, "closer");
  assert.equal(["no_answer", "no-answer", "voicemail"].includes(payload.disposition), false);
});

test("logCallOutcome cannot close a same-org task that belongs to another customer", async () => {
  const org = "11111111-1111-4111-8111-111111111111";
  const client = "22222222-2222-4222-8222-222222222222";
  const other = "55555555-5555-4555-8555-555555555555";
  const staff = "33333333-3333-4333-8333-333333333333";
  const taskId = "44444444-4444-4444-8444-444444444444";
  let inserted = 0;
  const db = stubDb([
    [/FROM clients/, () => ({ rows: [{ id: client, custom_fields: {} }] })],
    [/FROM tasks/, (params, sql) => {
      // Model PostgreSQL: without a client_id predicate, this foreign client's
      // task would be returned because the org and task ID still match.
      const scoped = /client_id = \\$3/.test(sql);
      const matches = params[0] === taskId && params[1] === org
        && (!scoped || params[2] === other);
      return { rows: matches ? [{ id: taskId, client_id: other }] : [] };
    }],
    [/INSERT INTO call_outcomes/, () => {
      inserted += 1;
      return { rows: [] };
    }]
  ]);
  await assert.rejects(
    () => logCallOutcome(db, {
      orgId: org, clientId: client, staffId: staff, taskId, outcome: "callback"
    }),
    (e) => e instanceof CallOutcomeError && e.status === 404
  );
  const taskRead = db.calls.find((c) => /FROM tasks/.test(c.sql));
  assert.match(taskRead.sql, /client_id = \\$3/);
  assert.deepEqual(taskRead.params, [taskId, org, client]);
  assert.equal(inserted, 0, "never write a cross-customer call outcome");
  assert.equal(db.calls.some((c) => /UPDATE tasks/.test(c.sql)), false,
    "never mark the other customer's task complete");
});

test("logCallOutcome does not reuse another customer's matching booking reference", async () => {
  const org = "11111111-1111-4111-8111-111111111111";
  const client = "22222222-2222-4222-8222-222222222222";
  const other = "55555555-5555-4555-8555-555555555555";
  const staff = "33333333-3333-4333-8333-333333333333";
  const bookingRef = "shared-booking-reference";
  const oldOutcome = { id: "foreign-outcome", org_id: org, client_id: other, outcome: "callback" };
  const db = stubDb([
    [/FROM clients/, () => ({ rows: [{ id: client, custom_fields: {} }] })],
    [/SELECT \\* FROM call_outcomes/, (params, sql) => {
      const scoped = /client_id = \\$4/.test(sql);
      return { rows: (!scoped || params[3] === other) ? [oldOutcome] : [] };
    }],
    [/INSERT INTO call_outcomes/, (params) => ({
      rows: [{
        id: "correct-outcome", org_id: org, client_id: client, staff_id: staff,
        booking_ref: params[4], outcome: "callback", cash_collected_cents: 0
      }]
    })]
  ]);
  const result = await logCallOutcome(db, {
    orgId: org, clientId: client, staffId: staff, bookingRef, outcome: "callback"
  });
  assert.equal(result.created, true, "another customer's record is never replayed");
  assert.equal(result.row.client_id, client);
  const lookup = db.calls.find((c) => /SELECT \\* FROM call_outcomes/.test(c.sql));
  assert.match(lookup.sql, /client_id = \\$4/);
  assert.deepEqual(lookup.params, [org, null, bookingRef, client]);
});
