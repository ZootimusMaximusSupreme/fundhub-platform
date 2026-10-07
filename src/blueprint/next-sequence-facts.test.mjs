// What the next funding sequence planner reads, and how rows become its inputs.
// A fake db answers by query text; no Postgres.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  pickInquiryPull, normalizeApplication, normalizeRounds, normalizePlan, normalizeLinked,
  fileFromUnderwrite, assembleInputs, planFromRows, readSequenceFacts
} from "./next-sequence-facts.mjs";

const ORG = "fb789b0b-8d8d-4cdc-8a24-ee6b6659e0b6";
const CLIENT = "029964c5-4d8e-47ed-88c9-53ac13863fd4";

/* The shape of the real Blueprint sim in production on 2026-10-06: the newest row
   is a sandbox pull with no scores and no inquiries; the one before it is the
   simulated file that carries the scores and four dated inquiries. */
const SIM_CRS = [
  { id: "crs-sandbox", created_at: "2026-09-30T06:00:07.062Z",
    result: { environment: "sandbox", bureausPulled: ["TU", "EX", "EQ"], scores: { eq: null, ex: null, tu: null }, inquiries: [] } },
  { id: "crs-sim", created_at: "2026-09-30T04:30:03.759Z",
    result: {
      environment: "simulated", bureausPulled: ["TU", "EX", "EQ"], scores: { eq: 778, ex: 771, tu: 766 },
      inquiries: [
        { date: "2026-02-28", source: "EX", sourceType: "Experian", creditorName: "CAPITAL ONE" },
        { date: "2026-05-28", source: "EX", sourceType: "Experian", creditorName: "SYNCB/PAYPAL CREDIT" },
        { date: "2025-12-28", source: "TU", sourceType: "TransUnion", creditorName: "NAVY FEDERAL CU" },
        { date: "2026-07-28", source: "EQ", sourceType: "Equifax", creditorName: "CITIBANK NA" }
      ]
    } }
];

describe("which credit pull the inquiries come from", () => {
  test("a newer sandbox pull with no score does not wipe out the real file", () => {
    const pull = pickInquiryPull(SIM_CRS);
    assert.equal(pull.on, "2026-09-30");
    assert.deepEqual(pull.bureausPulled.sort(), ["EQ", "EX", "TU"]);
    assert.equal(pull.list.length, 4);
    assert.deepEqual(pull.list.map((i) => [i.bureau, i.date]).sort(), [
      ["EQ", "2026-07-28"], ["EX", "2026-02-28"], ["EX", "2026-05-28"], ["TU", "2025-12-28"]
    ]);
  });

  test("rows in any order; the newest scored one wins; a stored result may be a JSON string", () => {
    const rows = [
      { id: "old", created_at: "2026-01-01T00:00:00Z", result: JSON.stringify({ bureausPulled: ["EX"], scores: { ex: 700 }, inquiries: [] }) },
      { id: "new", created_at: "2026-06-01T00:00:00Z", result: JSON.stringify({ bureausPulled: ["EX", "EQ"], scores: { ex: 720 }, inquiries: [{ source: "EQ", date: "2026-05-20" }] }) }
    ];
    const pull = pickInquiryPull(rows);
    assert.equal(pull.on, "2026-06-01");
    assert.deepEqual(pull.list, [{ bureau: "EQ", date: "2026-05-20", creditor: null }]);
  });

  test("no scored pull: null; a payload with no inquiry list: list is null, not empty", () => {
    assert.equal(pickInquiryPull([]), null);
    assert.equal(pickInquiryPull([{ created_at: "2026-01-01T00:00:00Z", result: { scores: {} } }]), null);
    const noList = pickInquiryPull([{ created_at: "2026-01-01T00:00:00Z", result: { bureausPulled: ["EX"], scores: { ex: 700 } } }]);
    assert.equal(noList.list, null);
  });

  test("the bureau comes from the code or the vendor's name; an inquiry with no bureau is dropped", () => {
    const pull = pickInquiryPull([{ created_at: "2026-01-01T00:00:00Z", result: {
      bureausPulled: ["EX", "TU"], scores: { ex: 700 },
      inquiries: [{ sourceType: "Experian", inquiryDate: "2025-12-01" }, { source: "TU", date: "2025-12-02" }, { creditorName: "no bureau" }]
    } }]);
    assert.deepEqual(pull.list.map((i) => [i.bureau, i.date]), [["EX", "2025-12-01"], ["TU", "2025-12-02"]]);
  });
});

describe("applications", () => {
  const base = { id: "a1", lender_name: " Chase ", lender_id: "L1", round_number: "1" };

  test("the day sent: staff's own date, else the day the status changed, else the day the row was made", () => {
    const exact = normalizeApplication({ ...base, status: "Applied", submitted_on: "2026-10-01", status_at: new Date("2026-10-03T09:00:00Z"), created_at: new Date("2026-09-20T00:00:00Z") });
    assert.equal(exact.applied_on, "2026-10-01");
    assert.equal(exact.applied_on_exact, true);
    const byStatus = normalizeApplication({ ...base, status: "Applied", submitted_on: null, status_at: new Date("2026-10-03T09:00:00Z"), created_at: new Date("2026-09-20T00:00:00Z") });
    assert.equal(byStatus.applied_on, "2026-10-03");
    assert.equal(byStatus.applied_on_exact, false);
    const byRow = normalizeApplication({ ...base, status: "Applied", status_at: null, created_at: new Date("2026-09-20T10:00:00Z") });
    assert.equal(byRow.applied_on, "2026-09-20");
    assert.equal(byRow.lender_name, "Chase");
    assert.equal(byRow.round_number, 1);
  });

  test("Apply is a to-do: no day sent. Approved carries the approval day", () => {
    assert.equal(normalizeApplication({ ...base, status: "Apply", created_at: new Date("2026-09-20T10:00:00Z") }).applied_on, null);
    assert.equal(normalizeApplication({ ...base, status: null, created_at: new Date("2026-09-20T10:00:00Z") }).applied_on, null);
    const ok = normalizeApplication({ ...base, status: "Approved", submitted_on: "2026-09-14", status_at: new Date("2026-09-20T09:00:00Z") });
    assert.equal(ok.decided_on, "2026-09-20");
    assert.equal(normalizeApplication({ ...base, status: "Denied", submitted_on: "2026-09-14", status_at: new Date("2026-09-20T09:00:00Z") }).decided_on, null);
  });

  test("the bureau staff saw beats the bank book; only the three personal bureaus count", () => {
    assert.deepEqual(normalizeApplication({ ...base, status: "Applied", observed_bureau: "TU", book_bureaus: "EX" }).bureaus, ["TU"]);
    assert.deepEqual(normalizeApplication({ ...base, status: "Applied", book_bureaus: "EX/TU" }).bureaus, ["EX", "TU"]);
    assert.equal(normalizeApplication({ ...base, status: "Applied", book_bureaus: "D&B" }).bureaus, null);
    assert.equal(normalizeApplication({ ...base, status: "Applied" }).bureaus, null);
  });
});

describe("rounds, plans and linked cards", () => {
  test("a round is funded by its status or by a funded amount; the day is the last approval, else the row's day", () => {
    const apps = [normalizeApplication({ id: "a", status: "Approved", round_number: 1, submitted_on: "2026-09-14", status_at: new Date("2026-09-20T09:00:00Z") })];
    const rounds = normalizeRounds([
      { id: "r1", round_number: 1, status: "funded", funded_amount: null, created_at: new Date("2026-09-10T00:00:00Z"), updated_at: new Date("2026-10-30T00:00:00Z") },
      { id: "r2", round_number: 2, status: "started", funded_amount: "25000.00", created_at: new Date("2026-11-01T00:00:00Z"), updated_at: new Date("2026-11-05T00:00:00Z") },
      { id: "r3", round_number: 3, status: "started", funded_amount: null, created_at: new Date("2026-12-01T00:00:00Z"), updated_at: new Date("2026-12-01T00:00:00Z") }
    ], apps);
    assert.deepEqual(rounds.map((r) => [r.round_number, r.funded, r.funded_on]), [
      [1, true, "2026-09-20"], [2, true, "2026-11-05"], [3, false, null]
    ]);
  });

  test("the saved plan gives one date: when card use crosses 30%", () => {
    const saved = { saved_at: "2026-10-04T10:00:00.000Z", as_of: "2026-10-04", summary: { crossings: [
      { pct: 30, on: "2027-01-06", already: false, earliest: true }, { pct: 10, on: "2027-05-06" }
    ] } };
    assert.deepEqual(normalizePlan(saved), { saved_on: "2026-10-04", as_of: "2026-10-04", crossing30: { on: "2027-01-06", already: false, earliest: true } });
    assert.equal(normalizePlan(null), null);
    assert.equal(normalizePlan({ saved_at: "2026-10-04T10:00:00Z", summary: {} }).crossing30, null);
    assert.equal(normalizePlan({ saved_at: "2026-10-04T10:00:00Z", summary: { crossings: [{ pct: 30, on: null }] } }).crossing30.on, null);
  });

  test("linked cards: overall use, and the OLDEST balance day among the cards counted", () => {
    const l = normalizeLinked([
      { credit_limit_cents: "1000000", current_balance_cents: "250000", closed_at: null, balance_as_of: new Date("2026-10-05T00:00:00Z") },
      { credit_limit_cents: "500000", current_balance_cents: "0", closed_at: null, balance_as_of: new Date("2026-10-03T00:00:00Z") },
      { credit_limit_cents: null, current_balance_cents: "999", closed_at: null, balance_as_of: null },
      { credit_limit_cents: "100", current_balance_cents: "100", closed_at: new Date(), balance_as_of: null }
    ]);
    assert.deepEqual(l, { num: 250000, den: 1500000, as_of: "2026-10-03", cards: 2 });
    assert.equal(normalizeLinked([{ credit_limit_cents: "100", current_balance_cents: null }]), null);
    assert.equal(normalizeLinked([{ credit_limit_cents: "100", current_balance_cents: "5", balance_as_of: null }]).as_of, null);
  });

  test("the engine reports an unknown score as 0; here that is unknown, never a score of 0", () => {
    assert.equal(fileFromUnderwrite({ metrics: { score: 0, negative_accounts: null, utilization_pct: null } }).score, null);
    assert.deepEqual(fileFromUnderwrite({ metrics: { score: 731, negative_accounts: 0, utilization_pct: 12 } }, "2026-10-05"),
      { ran: true, score: 731, negatives: 0, util_pct: 12, on: "2026-10-05" });
    assert.equal(fileFromUnderwrite(null).ran, false);
  });
});

describe("rows → inputs → answer", () => {
  test("the Blueprint sim as it stands in production: the real file is read, nothing is guessed", () => {
    const customFields = { crs_inquiries_ex: 2, crs_inquiries_eq: 1, crs_inquiries_tu: 1, crs_negative_items_count: 0 };
    const inputs = assembleInputs({
      asOf: new Date("2026-10-07T04:00:00Z"), customFields, crsRows: SIM_CRS,
      tradelineRows: [
        /* a `date` column arrives as a Date at LOCAL midnight; the day must not move */
        { lender: "AMEX", kind: "revolving", opened_on: new Date(2021, 4, 28), closed_at: null },
        { lender: "TOYOTA MOTOR CREDIT", kind: "installment", opened_on: "2023-06-28", closed_at: null }
      ],
      underwrite: { metrics: { score: 778, negative_accounts: 0, utilization_pct: 6.1 } },
      facts: null
    });
    assert.equal(inputs.asOf, "2026-10-07");
    assert.deepEqual(inputs.accounts.map((a) => [a.lender, a.opened_on]), [["AMEX", "2021-05-28"], ["TOYOTA MOTOR CREDIT", "2023-06-28"]]);
    assert.deepEqual(inputs.counts, { EX: 2, EQ: 1, TU: 1 });
    assert.equal(inputs.file.on, "2026-09-30");

    const plan = planFromRows({
      asOf: new Date("2026-10-07T04:00:00Z"), customFields, crsRows: SIM_CRS,
      tradelineRows: [{ lender: "AMEX", kind: "revolving", opened_on: "2021-05-28" }, { lender: "TOYOTA", kind: "installment", opened_on: "2023-06-28" }],
      underwrite: { metrics: { score: 778, negative_accounts: 0, utilization_pct: 6.1 } }, facts: null
    });
    /* Every bureau is under both limits (EX 1 in 6 months and 2 in 12; EQ 1; TU 1 in 12) and card use is 6.1%. */
    assert.equal(plan.reasons.find((r) => r.factor === "inquiries").status, "ready");
    assert.equal(plan.reasons.find((r) => r.factor === "utilization").status, "ready");
    assert.equal(plan.reasons.find((r) => r.factor === "new_credit").ready_on, "2023-12-29");
    /* and it has not funded, so it is not "ready for the next funding sequence" */
    assert.deepEqual(plan.blockers.map((b) => b.id), ["no_funding_yet"]);
    assert.equal(plan.ready, false);
  });

  test("the accounts are the ones the engine reads: with no stored rows, the lines in the newest pull", () => {
    const crsRows = [{ id: "c", created_at: "2026-10-01T00:00:00Z", result: {
      bureausPulled: ["EX"], scores: { ex: 700 }, inquiries: [],
      tradelines: [{ creditorName: "CHASE", creditLimitAmount: "5000", currentBalanceAmount: "100", accountOpenedDate: "2026-09-01", accountType: "Revolving" }]
    } }];
    const inputs = assembleInputs({ asOf: "2026-10-06", crsRows, tradelineRows: [] });
    assert.deepEqual(inputs.accounts.map((a) => [a.lender, a.opened_on]), [["CHASE", "2026-09-01"]]);
  });

  test("a staff date in custom_fields is read; junk is not", () => {
    assert.equal(assembleInputs({ asOf: "2026-10-06", customFields: { blueprint_next_sequence_ready_date: "2026-12-01" } }).staffDate, "2026-12-01");
    assert.equal(assembleInputs({ asOf: "2026-10-06", customFields: { blueprint_next_sequence_ready_date: "Dec 1" } }).staffDate, null);
  });
});

describe("the reads", () => {
  function fakeDb({ declines = "tracked", open = 1 } = {}) {
    const seen = [];
    return {
      seen,
      query: async (sql, params) => {
        seen.push({ sql, params });
        if (/FROM blueprint_declines/.test(sql)) {
          if (declines === "missing") throw Object.assign(new Error('relation "blueprint_declines" does not exist'), { code: "42P01" });
          if (/outcome = 'open'/.test(sql)) return { rows: [{ n: open }] };
          return { rows: [{ id: "d1", bank: "Chase", product: "Ink Cash", outcome: "reapply_later", reapply_on: "2027-01-10" }] };
        }
        if (/FROM applications a/.test(sql)) {
          return { rows: [{ id: "a1", status: "Approved", lender_name: "Chase", lender_id: "L1", submitted_on: "2026-09-14",
            status_at: new Date("2026-09-20T09:00:00Z"), created_at: new Date("2026-09-10T00:00:00Z"), round_number: 1, book_bureaus: "EX", observed_bureau: null }] };
        }
        if (/FROM funding_rounds/.test(sql)) {
          return { rows: [{ id: "r1", round_number: 1, status: "funded", funded_amount: "50000.00", approved_amount: "50000.00",
            created_at: new Date("2026-09-10T00:00:00Z"), updated_at: new Date("2026-09-25T00:00:00Z") }] };
        }
        if (/FROM payment_strategy_plans/.test(sql)) {
          return { rows: [{ id: "p1", method: "avalanche", monthly_cents: "50000", goal_kind: null, goal_by: null, as_of: "2026-10-04",
            debt_free_on: null, cash_check: "safe", saved_by_kind: "client", created_at: new Date("2026-10-04T10:00:00Z"),
            inputs: [], milestones: [], summary: { crossings: [{ pct: 30, on: "2027-01-06", already: false, earliest: false }] } }] };
        }
        if (/FROM bank_accounts/.test(sql)) {
          return { rows: [{ current_balance_cents: "250000", credit_limit_cents: "1000000", closed_at: null, balance_as_of: new Date("2026-10-05T00:00:00Z") }] };
        }
        throw new Error(`unexpected query: ${sql.slice(0, 80)}`);
      }
    };
  }

  test("six reads, all SELECT, every one pinned to the org and the client", async () => {
    const db = fakeDb();
    const facts = await readSequenceFacts(db, { orgId: ORG, clientId: CLIENT });
    assert.equal(db.seen.length, 6, "rounds, applications, saved plan, linked cards, open declines, decline notes");
    for (const q of db.seen) {
      assert.match(q.sql.trim(), /^SELECT/i);
      assert.ok(q.params.includes(ORG) && q.params.includes(CLIENT), q.sql.slice(0, 60));
      assert.doesNotMatch(q.sql, /\b(INSERT|UPDATE|DELETE)\b/i);
    }
    assert.deepEqual(facts.rounds.map((r) => [r.round_number, r.funded, r.funded_on]), [[1, true, "2026-09-20"]]);
    assert.deepEqual(facts.applications.map((a) => [a.status, a.applied_on, a.bureaus]), [["Approved", "2026-09-14", ["EX"]]]);
    assert.equal(facts.plan.crossing30.on, "2027-01-06");
    assert.deepEqual(facts.linked, { num: 250000, den: 1000000, as_of: "2026-10-05", cards: 1 });
  });

  test("declines: the count still open (a blocker) and decline defense's own notes (never a date)", async () => {
    const facts = await readSequenceFacts(fakeDb({ open: 2 }), { orgId: ORG, clientId: CLIENT });
    assert.equal(facts.reconsiderations.open, 2);
    assert.match(facts.reconsiderations.source.ref, /blueprint_declines\.outcome = 'open'/);
    assert.deepEqual(facts.reconsiderations.notes.map((n) => [n.bank, n.outcome, n.reapply_on, n.note]), [
      ["Chase", "reapply_later", "2027-01-10", "Chase · Ink Cash: re-apply on or after Jan 10, 2027."]
    ]);
    const none = await readSequenceFacts(fakeDb({ open: 0 }), { orgId: ORG, clientId: CLIENT });
    assert.equal(none.reconsiderations.open, 0, "tracked, and none are open");
  });

  test("the declines table is not there (migration 470 not applied): not tracked, which is null and not 'none open', and nothing breaks", async () => {
    const facts = await readSequenceFacts(fakeDb({ declines: "missing" }), { orgId: ORG, clientId: CLIENT });
    assert.equal(facts.reconsiderations, null);
    assert.equal(facts.rounds.length, 1, "the other reads still came back");
  });

  test("any other failure in the declines read is not swallowed", async () => {
    const db = fakeDb();
    const real = db.query;
    db.query = async (sql, params) => {
      if (/FROM blueprint_declines/.test(sql)) throw new Error("connection reset");
      return real(sql, params);
    };
    await assert.rejects(readSequenceFacts(db, { orgId: ORG, clientId: CLIENT }), /connection reset/);
  });

  test("demo rows are never read", async () => {
    const db = fakeDb();
    await readSequenceFacts(db, { orgId: ORG, clientId: CLIENT });
    for (const q of db.seen.filter((x) => /funding_rounds|applications/.test(x.sql))) {
      assert.match(q.sql, /is_demo/);
    }
  });
});
