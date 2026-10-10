// The next funding sequence planner end to end, and the daily alert. A fake db
// answers by query text; no Postgres. Every query is checked: all reads, and the
// only write is the closer task.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { computeNextSequenceDate, sweepSuggested, suggestionCandidates } from "./next-sequence-plan.mjs";
import {
  createNextSequenceCloserTask, nextSequenceAlertKey, nextSequenceTitle, sweep, SOURCE_WORKFLOW
} from "./next-funding-sequence.mjs";
import { sweepAll, handle } from "../workflows/blueprint-next-funding-sequence-sweeper.mjs";

const ORG = "fb789b0b-8d8d-4cdc-8a24-ee6b6659e0b6";
const CLIENT = "029964c5-4d8e-47ed-88c9-53ac13863fd4";
const OTHER = "f1cb9c27-f858-4db1-b6bb-4eddc898bb8e";

/* One client who funded a first round on 2026-09-20 and was pulled again on
   2026-10-05. Three applications, one per bureau; three new cards; card use 10%. */
function funded(over = {}) {
  return {
    buyer: true,
    client: {
      id: CLIENT,
      custom_fields: {
        crs_negative_items_count: 0, crs_late_payments_count: 0,
        crs_inquiries_ex: 1, crs_inquiries_eq: 1, crs_inquiries_tu: 1
      }
    },
    crs: [{
      id: "crs-1", created_at: "2026-10-05T12:00:00Z",
      result: {
        environment: "production", bureausPulled: ["EX", "EQ", "TU"],
        scores: { ex: 731, eq: 740, tu: 725 },
        inquiries: [
          { source: "EX", date: "2026-09-14", creditorName: "CHASE" },
          { source: "EQ", date: "2026-09-15", creditorName: "AMEX" },
          { source: "TU", date: "2026-09-16", creditorName: "CITI" }
        ]
      }
    }],
    tradelines: [
      { id: "t0", lender: "OLD CHASE", kind: "revolving", credit_limit_cents: 1500000, balance_cents: 150000, apr: "0.1899", opened_on: "2019-05-28", closed_at: null },
      { id: "t1", lender: "CHASE", kind: "revolving", credit_limit_cents: 1000000, balance_cents: 100000, apr: "0.1899", opened_on: "2026-09-20", closed_at: null },
      { id: "t2", lender: "AMEX", kind: "revolving", credit_limit_cents: 1000000, balance_cents: 100000, apr: "0.1899", opened_on: "2026-09-20", closed_at: null },
      { id: "t3", lender: "CITI", kind: "revolving", credit_limit_cents: 1000000, balance_cents: 100000, apr: "0.1899", opened_on: "2026-09-20", closed_at: null }
    ],
    rounds: [{
      id: "r1", round_number: 1, status: "funded", funded_amount: "50000.00", approved_amount: "50000.00",
      created_at: new Date("2026-09-10T00:00:00Z"), updated_at: new Date("2026-09-25T00:00:00Z")
    }],
    apps: [
      ["a1", "Chase", "2026-09-14", "EX"], ["a2", "Amex", "2026-09-15", "EQ"], ["a3", "Citi", "2026-09-16", "TU"]
    ].map(([id, lender, day, bureau]) => ({
      id, status: "Approved", lender_name: lender, lender_id: null, submitted_on: day,
      status_at: new Date("2026-09-20T09:00:00Z"), created_at: new Date("2026-09-10T00:00:00Z"),
      round_number: 1, book_bureaus: bureau, observed_bureau: null
    })),
    savedPlan: null,
    cards: [],
    ...over
  };
}

function makeDb(state) {
  const log = [];
  state.tasks = state.tasks || new Map();
  return {
    log,
    state,
    async query(sql, params = []) {
      log.push({ sql, params });
      const s = sql.replace(/\s+/g, " ");
      if (/AS ready_date/.test(s)) return { rows: state.staffDue || [] };
      if (/SELECT DISTINCT c\.id AS client_id/.test(s)) return { rows: state.candidates || [] };
      if (/FROM transactions t JOIN products p/.test(s)) return { rows: state.buyer ? [{ "?column?": 1 }] : [] };
      if (/FROM tasks WHERE/.test(s)) {
        const found = state.tasks.get(`${params[0]}|${params[1]}|${JSON.stringify(params[2])}`);
        return { rows: found ? [{ id: found.id }] : [] };
      }
      if (/INSERT INTO tasks/.test(s)) {
        const key = `${params[1]}|${params[5]}|${JSON.stringify(params[3])}`;
        if (state.tasks.has(key)) return { rows: [] };
        const row = { id: `task-${state.tasks.size + 1}`, title: params[2], body: params[3], source: params[5], role: params[6], client: params[1] };
        state.tasks.set(key, row);
        return { rows: [{ id: row.id }] };
      }
      if (/FROM blueprint_declines/.test(s)) {
        if (state.declinesMissing) throw Object.assign(new Error('relation "blueprint_declines" does not exist'), { code: "42P01" });
        if (/outcome = 'open'/.test(s)) return { rows: [{ n: state.declinesOpen || 0 }] };
        return { rows: state.declineNotes || [] };
      }
      if (/FROM applications a/.test(s)) return { rows: state.apps || [] };
      if (/FROM funding_rounds/.test(s)) return { rows: state.rounds || [] };
      if (/FROM payment_strategy_plans/.test(s)) return { rows: state.savedPlan ? [state.savedPlan] : [] };
      if (/FROM bank_accounts/.test(s)) return { rows: state.cards || [] };
      if (/FROM crs_results/.test(s)) return { rows: state.crs || [] };
      if (/FROM tradelines/.test(s)) return { rows: state.tradelines || [] };
      if (/FROM card_liabilities/.test(s)) return { rows: [] };
      if (/FROM businesses/.test(s)) return { rows: [] };
      if (/FROM clients WHERE id = \$1 AND org_id = \$2/.test(s)) return { rows: state.client ? [state.client] : [] };
      throw new Error(`unexpected query: ${s.slice(0, 100)}`);
    }
  };
}

const tasksOf = (db) => [...db.state.tasks.values()];

describe("computeNextSequenceDate", () => {
  test("a finished sequence: the date, each reason with its source, computed, nothing blocking", async () => {
    const db = makeDb(funded());
    const plan = await computeNextSequenceDate(db, { orgId: ORG, clientId: CLIENT, asOf: new Date("2026-10-06T12:00:00Z") });
    assert.equal(plan.confidence, "computed");
    assert.deepEqual(plan.reasons.map((r) => [r.factor, r.status, r.ready_on]), [
      ["inquiries", "ready", null],
      ["new_credit", "waiting", "2027-03-21"],
      ["utilization", "ready", null]
    ]);
    assert.equal(plan.suggested_date, "2027-03-21");
    assert.deepEqual(plan.blockers, []);
    assert.equal(plan.ready, false);
    assert.equal(plan.blueprint_buyer, true);
    assert.equal(plan.after_funding.alert_key, "r1");
    assert.equal(plan.reasons[2].detail.basis, "credit_file");
    assert.equal(plan.reasons[2].detail.use_pct, 10);
  });

  test("read only: every query is a SELECT and carries the org and the client", async () => {
    const db = makeDb(funded());
    await computeNextSequenceDate(db, { orgId: ORG, clientId: CLIENT, asOf: new Date("2026-10-06T12:00:00Z") });
    assert.ok(db.log.length >= 10);
    for (const q of db.log) {
      assert.match(q.sql.trim(), /^SELECT/i, q.sql.slice(0, 50));
      assert.ok(q.params.includes(ORG) && q.params.includes(CLIENT), q.sql.replace(/\s+/g, " ").slice(0, 70));
    }
    assert.equal(db.state.tasks.size, 0);
  });

  test("a client that is not in that org is null, so the caller answers 404", async () => {
    const db = makeDb(funded({ client: null }));
    assert.equal(await computeNextSequenceDate(db, { orgId: ORG, clientId: CLIENT }), null);
  });

  test("the staff date wins, and the suggestion rides next to it", async () => {
    const f = funded();
    f.client.custom_fields.blueprint_next_sequence_ready_date = "2026-12-01";
    const plan = await computeNextSequenceDate(makeDb(f), { orgId: ORG, clientId: CLIENT, asOf: new Date("2026-10-06T12:00:00Z") });
    assert.equal(plan.effective_date, "2026-12-01");
    assert.equal(plan.effective_source, "staff");
    assert.equal(plan.suggested_date, "2027-03-21");
    assert.deepEqual(plan.flags.map((x) => x.id), ["staff_date_before_suggestion"]);
  });

  test("a client who never funded: the date still computes from the file, and the blocker says why it is not ready", async () => {
    const plan = await computeNextSequenceDate(makeDb(funded({ rounds: [], apps: [] })), { orgId: ORG, clientId: CLIENT, asOf: new Date("2027-06-01T12:00:00Z") });
    assert.deepEqual(plan.blockers.map((b) => b.id), ["no_funding_yet"]);
    assert.equal(plan.ready, false);
    assert.equal(plan.after_funding.alert_key, null);
  });

  test("an open application stops the alert: wait for the decision before the next one", async () => {
    const f = funded();
    f.apps = [...f.apps, { id: "a4", status: "Applied", lender_name: "Wells", lender_id: null, submitted_on: "2026-10-01",
      status_at: new Date("2026-10-01T09:00:00Z"), created_at: new Date("2026-10-01T00:00:00Z"), round_number: 1, book_bureaus: "EX", observed_bureau: null }];
    const plan = await computeNextSequenceDate(makeDb(f), { orgId: ORG, clientId: CLIENT, asOf: new Date("2027-06-01T12:00:00Z") });
    assert.ok(plan.blockers.some((b) => b.id === "decisions_pending"));
    assert.equal(plan.ready, false);
    /* it was sent after the 2026-10-05 pull? no: 10-01 is before the pull, so the pull already shows it */
    assert.equal(plan.reasons[0].detail.from_applications, 0);
  });

  test("an application sent after the pull is a new inquiry at its bank's bureau and moves the date", async () => {
    const f = funded();
    f.apps = [...f.apps, { id: "a5", status: "Applied", lender_name: "Wells", lender_id: null, submitted_on: "2026-10-06",
      status_at: new Date("2026-10-06T09:00:00Z"), created_at: new Date("2026-10-06T00:00:00Z"), round_number: 1, book_bureaus: "EX", observed_bureau: null }];
    const plan = await computeNextSequenceDate(makeDb(f), { orgId: ORG, clientId: CLIENT, asOf: new Date("2026-10-07T12:00:00Z") });
    assert.equal(plan.reasons[0].detail.from_applications, 1);
    assert.equal(plan.reasons.find((r) => r.factor === "new_credit").detail.newest_on, "2026-10-06");
    assert.equal(plan.after_funding.credit_file_stale, true, "the pull ran before this application");
    assert.ok(plan.blockers.some((b) => b.id === "credit_file_stale"));
  });

  test("a decline still being worked blocks, and the plan says how many; closed declines are notes and never a date", async () => {
    const f = funded({ declinesOpen: 2, declineNotes: [
      { id: "d1", bank: "Chase", product: "Ink Cash", outcome: "reapply_later", reapply_on: "2027-01-10" },
      { id: "d2", bank: "Wells Fargo", product: null, outcome: "still_declined", reapply_on: null }
    ] });
    const plan = await computeNextSequenceDate(makeDb(f), { orgId: ORG, clientId: CLIENT, asOf: new Date("2027-04-04T12:00:00Z") });
    const b = plan.blockers.find((x) => x.id === "open_reconsiderations");
    assert.equal(b.count, 2);
    assert.match(b.text, /2 bank declines are still being worked\. Finish them before the next funding sequence\./);
    assert.match(b.source.ref, /blueprint_declines/);
    assert.equal(plan.ready, false);
    assert.deepEqual(plan.declines.notes.map((n) => n.note), [
      "Chase · Ink Cash: re-apply on or after Jan 10, 2027.",
      "Wells Fargo: still declined after reconsideration."
    ]);
    assert.equal(plan.declines.tracked, true);
    assert.equal(plan.declines.open, 2);
    /* the re-apply day is a note: the suggested date is the same with or without it */
    const without = await computeNextSequenceDate(makeDb(funded()), { orgId: ORG, clientId: CLIENT, asOf: new Date("2027-04-04T12:00:00Z") });
    assert.equal(plan.suggested_date, without.suggested_date);
  });

  test("declines tracked and none open: no blocker. Declines table missing: not tracked, no blocker, nothing breaks", async () => {
    const tracked = await computeNextSequenceDate(makeDb(funded()), { orgId: ORG, clientId: CLIENT, asOf: new Date("2027-04-04T12:00:00Z") });
    assert.deepEqual(tracked.declines, { tracked: true, open: 0, notes: [] });
    assert.deepEqual(tracked.blockers, []);
    const missing = await computeNextSequenceDate(makeDb(funded({ declinesMissing: true })), { orgId: ORG, clientId: CLIENT, asOf: new Date("2027-04-04T12:00:00Z") });
    assert.deepEqual(missing.declines, { tracked: false, open: null, notes: [] });
    assert.deepEqual(missing.blockers, []);
    assert.equal(missing.ready, true);
  });

  test("card use over 30% with a saved plan from after the sequence: the plan's date is the card-use date", async () => {
    const f = funded();
    f.tradelines = f.tradelines.map((t) => ({ ...t, balance_cents: t.id === "t0" ? 1200000 : 700000 }));
    f.savedPlan = {
      id: "p1", method: "avalanche", monthly_cents: "50000", goal_kind: null, goal_by: null, as_of: "2026-10-05",
      debt_free_on: null, cash_check: "safe", saved_by_kind: "client", created_at: new Date("2026-10-05T10:00:00Z"),
      inputs: [], milestones: [], summary: { crossings: [{ pct: 30, on: "2027-05-05", already: false, earliest: false }] }
    };
    const plan = await computeNextSequenceDate(makeDb(f), { orgId: ORG, clientId: CLIENT, asOf: new Date("2026-10-06T12:00:00Z") });
    const util = plan.reasons.find((r) => r.factor === "utilization");
    assert.equal(util.status, "waiting");
    assert.equal(util.ready_on, "2027-05-05");
    assert.equal(plan.suggested_date, "2027-05-05", "the latest of the three");
  });
});

describe("the closer task", () => {
  test("a staff date makes one task per date, and a second run makes none (the body is a stable key)", async () => {
    const db = makeDb(funded());
    const first = await createNextSequenceCloserTask(db, { orgId: ORG, clientId: CLIENT, readyDate: "2026-12-01" });
    const second = await createNextSequenceCloserTask(db, { orgId: ORG, clientId: CLIENT, readyDate: "2026-12-01" });
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(second.reason, "duplicate_event");
    const [t] = tasksOf(db);
    assert.equal(tasksOf(db).length, 1);
    assert.equal(t.body, `blueprint-next-sequence:${CLIENT}:2026-12-01`);
    assert.equal(t.role, "closer");
    assert.equal(t.source, SOURCE_WORKFLOW);
    assert.equal(t.title, nextSequenceTitle("staff"));
    const nextDay = await createNextSequenceCloserTask(db, { orgId: ORG, clientId: CLIENT, readyDate: "2026-12-02" });
    assert.equal(nextDay.created, true, "a different staff date is a different alert");
  });

  test("a suggestion is keyed on the finished sequence, not the date", async () => {
    assert.equal(nextSequenceAlertKey({ clientId: CLIENT, basis: "suggested", alertKey: "r2", readyDate: "2027-03-21" }),
      `blueprint-next-sequence:${CLIENT}:after:r2`);
    const db = makeDb(funded());
    const a = await createNextSequenceCloserTask(db, { orgId: ORG, clientId: CLIENT, readyDate: "2027-03-21", basis: "suggested", alertKey: "r1" });
    const moved = await createNextSequenceCloserTask(db, { orgId: ORG, clientId: CLIENT, readyDate: "2027-05-09", basis: "suggested", alertKey: "r1" });
    const later = await createNextSequenceCloserTask(db, { orgId: ORG, clientId: CLIENT, readyDate: "2028-01-09", basis: "suggested", alertKey: "r2" });
    assert.deepEqual([a.created, moved.created, later.created], [true, false, true]);
    assert.equal(tasksOf(db)[0].title, nextSequenceTitle("suggested"));
  });

  test("not a Blueprint buyer, or a missing piece: no task", async () => {
    const db = makeDb(funded({ buyer: false }));
    assert.deepEqual(await createNextSequenceCloserTask(db, { orgId: ORG, clientId: CLIENT, readyDate: "2026-12-01" }),
      { created: false, reason: "not_blueprint_buyer" });
    assert.equal((await createNextSequenceCloserTask(db, { orgId: ORG, clientId: CLIENT })).reason, "missing_args");
    assert.equal((await createNextSequenceCloserTask(makeDb(funded()), { orgId: ORG, clientId: CLIENT, readyDate: "2027-03-21", basis: "suggested" })).reason, "missing_args");
    assert.equal(db.state.tasks.size, 0);
  });
});

describe("sweepSuggested: the closer is told once, on the day the file math says ready", () => {
  const NOW_READY = new Date("2027-03-22T12:00:00Z");
  const NOW_EARLY = new Date("2026-10-06T12:00:00Z");
  const candidates = [{ client_id: CLIENT, org_id: ORG }];

  test("before the date: waiting, no task", async () => {
    const db = makeDb(funded({ candidates }));
    const tally = await sweepSuggested(db, { now: NOW_EARLY });
    assert.deepEqual({ checked: tally.checked, created: tally.created, waiting: tally.waiting }, { checked: 1, created: 0, waiting: 1 });
    assert.equal(db.state.tasks.size, 0);
  });

  test("on the day: one task for the closer. Run it again, and again: still one", async () => {
    const db = makeDb(funded({ candidates }));
    const one = await sweepSuggested(db, { now: NOW_READY });
    const two = await sweepSuggested(db, { now: NOW_READY });
    const next = await sweepSuggested(db, { now: new Date("2027-03-23T12:00:00Z") });
    assert.equal(one.created, 1);
    assert.equal(two.created, 0);
    assert.equal(next.created, 0);
    assert.deepEqual(two.skipped, [{ clientId: CLIENT, reason: "duplicate_event" }]);
    assert.equal(tasksOf(db).length, 1);
    assert.equal(tasksOf(db)[0].body, `blueprint-next-sequence:${CLIENT}:after:r1`);
    assert.equal(tasksOf(db)[0].role, "closer");
  });

  test("a client with a staff date is left to the staff pass", async () => {
    const f = funded({ candidates });
    f.client.custom_fields.blueprint_next_sequence_ready_date = "2026-12-01";
    const db = makeDb(f);
    const tally = await sweepSuggested(db, { now: NOW_READY });
    assert.deepEqual(tally.skipped, [{ clientId: CLIENT, reason: "staff_date_set" }]);
    assert.equal(db.state.tasks.size, 0);
  });

  test("a partial answer, or a blocker, never alerts", async () => {
    const partial = funded({ candidates });
    partial.tradelines = partial.tradelines.map((t) => ({ ...t, balance_cents: t.id === "t0" ? 1200000 : 700000 }));
    const db1 = makeDb(partial);
    assert.equal((await sweepSuggested(db1, { now: NOW_READY })).waiting, 1, "card use over 30% and no plan: unknown");
    assert.equal(db1.state.tasks.size, 0);

    const blocked = funded({ candidates });
    blocked.apps = [...blocked.apps, { id: "a9", status: "Missing Docs", lender_name: "Wells", lender_id: null, submitted_on: "2026-09-18",
      status_at: new Date("2026-09-18T09:00:00Z"), created_at: new Date("2026-09-18T00:00:00Z"), round_number: 1, book_bureaus: "EX", observed_bureau: null }];
    const db2 = makeDb(blocked);
    assert.equal((await sweepSuggested(db2, { now: NOW_READY })).waiting, 1);
    assert.equal(db2.state.tasks.size, 0);
  });

  test("an open decline reconsideration stops the alert until ops closes it", async () => {
    const db = makeDb(funded({ candidates, declinesOpen: 1 }));
    const waiting = await sweepSuggested(db, { now: NOW_READY });
    assert.equal(waiting.waiting, 1);
    assert.equal(db.state.tasks.size, 0);
    db.state.declinesOpen = 0; // ops records the outcome
    const sent = await sweepSuggested(db, { now: NOW_READY });
    assert.equal(sent.created, 1);
  });

  test("a client who is not a Blueprint buyer gets no task", async () => {
    const db = makeDb(funded({ candidates, buyer: false }));
    const tally = await sweepSuggested(db, { now: NOW_READY });
    assert.deepEqual(tally.skipped, [{ clientId: CLIENT, reason: "not_blueprint_buyer" }]);
    assert.equal(db.state.tasks.size, 0);
  });

  test("one client failing does not stop the rest", async () => {
    const db = makeDb(funded({ candidates: [{ client_id: OTHER, org_id: ORG }, { client_id: CLIENT, org_id: ORG }] }));
    const compute = async (d, args) => {
      if (args.clientId === OTHER) throw new Error("boom");
      return computeNextSequenceDate(d, args);
    };
    const tally = await sweepSuggested(db, { now: NOW_READY, compute });
    assert.deepEqual(tally.errored, [{ clientId: OTHER, error: "boom" }]);
    assert.equal(tally.created, 1);
  });

  test("a new funded round is a new sequence and earns its own alert", async () => {
    const db = makeDb(funded({ candidates }));
    const ready = (key) => async () => ({ ready: true, staff_date: null, suggested_date: "2027-03-21", after_funding: { alert_key: key } });
    assert.equal((await sweepSuggested(db, { now: NOW_READY, compute: ready("r1") })).created, 1);
    assert.equal((await sweepSuggested(db, { now: NOW_READY, compute: ready("r1") })).created, 0);
    assert.equal((await sweepSuggested(db, { now: NOW_READY, compute: ready("r2") })).created, 1);
    assert.equal(tasksOf(db).length, 2);
  });

  test("only funded clients without a staff date are looked at, and the read is a SELECT", async () => {
    const db = makeDb(funded({ candidates }));
    await suggestionCandidates(db);
    const q = db.log.find((x) => /SELECT DISTINCT c\.id AS client_id/.test(x.sql.replace(/\s+/g, " ")));
    assert.match(q.sql, /funded/);
    assert.match(q.sql, /is_demo/);
    assert.deepEqual(q.params, ["blueprint_next_sequence_ready_date"]);
  });
});

describe("the daily workflow runs both passes", () => {
  test("a staff date that came makes one task however many times the day runs (the old body held a timestamp)", async () => {
    const f = funded({ staffDue: [{ client_id: CLIENT, org_id: ORG, ready_date: "2026-12-01" }], candidates: [] });
    const db = makeDb(f);
    const first = await sweepAll(db, { now: new Date("2026-12-02T06:30:00Z") });
    const second = await sweepAll(db, { now: new Date("2026-12-02T18:30:00Z") });
    const nextDay = await sweepAll(db, { now: new Date("2026-12-03T06:30:00Z") });
    assert.deepEqual([first.created, second.created, nextDay.created], [1, 0, 0]);
    assert.equal(tasksOf(db).length, 1);
    assert.equal(first.suggested.checked, 0);
  });

  test("handle() returns both tallies, and a failing suggested pass does not take the staff pass down", async () => {
    const f = funded({ staffDue: [{ client_id: CLIENT, org_id: ORG, ready_date: "2026-12-01" }] });
    const db = makeDb(f);
    const bad = { query: async (sql, params) => {
      if (/SELECT DISTINCT c\.id AS client_id/.test(sql.replace(/\s+/g, " "))) throw new Error("candidates failed");
      return db.query(sql, params);
    } };
    const out = await handle({ db: bad });
    assert.equal(out.created, 1, "the staff pass still ran");
    assert.deepEqual(out.suggested.errored, [{ error: "candidates failed" }]);
    assert.ok(Array.isArray((await sweep(db, { now: new Date("2026-12-02T00:00:00Z") })).skipped));
  });
});
