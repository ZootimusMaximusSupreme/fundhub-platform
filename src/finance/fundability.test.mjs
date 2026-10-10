// src/finance/fundability.mjs — the fundability read. Stubbed db, no network,
// no Postgres. The rules under test:
//   - the score is a count of UnderwriteIQ's own checks; an unknown never passes
//   - tier is the engine's own `fundable` gate, never a second opinion
//   - null when the engine has no inputs (no pull) — never 0
//   - the money is one bureau's worth ($212,000), never the tripled $636,000
//   - a projection re-runs the SAME engine and changes only what it lists:
//     time, business age, the client's own paydown waypoints
//   - the "if removed" line exists only with a real dispute plan, is its own
//     line, and always says it is not promised — removals are never invented
//   - each business is read on its own and nothing adds them up
//   - every query is scoped to org AND client
//
// The vendored engine reads the clock (src/underwrite/engine.mjs note 1), so
// every account-opened date here is written relative to today, and no date is
// placed within a month of the engine's 24-month line.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  buildFundability, fundability, readEngine, personalChecks, scoreOf, tierOf,
  fundingEstimateCents, projectFile, paydownPlan, disputeTargets, addMonths,
  businessEntries, PERSONAL_CHECKS, BUSINESS_CHECKS, CANNOT_PROJECT
} from "./fundability.mjs";
import { underwriteSuggestions } from "./credit-overview.mjs";

const ORG = "fb789b0b-8d8d-4cdc-8a24-ee6b6659e0b6";
const CID = "029964c5-4d8e-47ed-88c9-53ac13863fd4";
const TODAY = new Date().toISOString().slice(0, 10);
const ago = (n) => addMonths(TODAY, -n);
const AS_OF = new Date();

/* One file, the shape of the sample client (029964c5…): three seasoned cards,
   a car loan, 771 / 778 / 766, 6% use, no negatives, 4 inquiries. */
const PULL = {
  id: "p1", created_at: "2026-09-30T04:30:03.759Z",
  result: { scores: { ex: 771, eq: 778, tu: 766 }, scoreModels: {}, environment: "simulated", simulated: true }
};
const LINE = (o) => ({
  id: o.id, lender: o.lender, kind: o.kind || "revolving", credit_limit_cents: o.limit, balance_cents: o.balance,
  opened_on: o.opened, closed_at: null, last4: o.last4 ?? null, apr: null, raw: { accountStatusType: "Open" }
});
const LINES = () => [
  LINE({ id: "t1", lender: "CHASE CARD SERVICES", limit: "2000000", balance: "120000", opened: ago(88) }),
  LINE({ id: "t2", lender: "AMEX", limit: "1500000", balance: "85000", opened: ago(64) }),
  LINE({ id: "t3", lender: "CAPITAL ONE", limit: "1000000", balance: "70000", opened: ago(43) }),
  LINE({ id: "t4", lender: "TOYOTA MOTOR CREDIT", kind: "installment", limit: "3400000", balance: "1120000", opened: ago(40) })
];
const CURRENT = (ids) => ids.map((id) => ({ tradeline_id: id, payment_status: "current", as_of: "2026-09-30" }));
const CF = (o = {}) => ({
  crs_inquiries_ex: 2, crs_inquiries_eq: 1, crs_inquiries_tu: 1,
  crs_negative_items_count: 0, crs_late_payments_count: 0, ...o
});
const CLIENT = (cf = CF()) => ({ id: CID, first_name: "Sim", last_name: "Eleven-Blueprint", custom_fields: cf });

function build(o = {}) {
  return buildFundability({
    client: o.client || CLIENT(o.cf),
    asOf: AS_OF,
    crsRows: o.crsRows || [PULL],
    tradelineRows: o.lines || LINES(),
    liabilities: o.liabilities || CURRENT(["t1", "t2", "t3", "t4"]),
    businessRows: o.businesses || [],
    containers: o.containers || [],
    waypoints: o.waypoints || [],
    disputeItems: o.disputes || []
  });
}

const plan = (d) => d.projections.filter((p) => p.scenario === "plan");
const removed = (d) => d.projections.filter((p) => p.scenario === "if_removed");

describe("the score is a count of UnderwriteIQ's own checks", () => {
  test("the sample file: 5 of 6 — every check passes but hard inquiries", () => {
    const d = build();
    assert.equal(d.now.score, 5);
    assert.equal(d.now.score_max, 6);
    assert.equal(d.now.unknown, 0);
    const failing = d.now.factors.filter((f) => f.passed === false).map((f) => f.key);
    assert.deepEqual(failing, ["no_inquiries"]);
    assert.deepEqual(d.now.factors.map((f) => f.key), PERSONAL_CHECKS.map((c) => c.key));
  });

  test("an input nobody entered is unknown, never a pass", () => {
    const d = build({ cf: CF({ crs_inquiries_eq: null }) });
    const inq = d.now.factors.find((f) => f.key === "no_inquiries");
    assert.equal(inq.passed, null);
    assert.equal(inq.value, null);
    assert.equal(d.now.unknown, 1);
    assert.equal(d.now.score, 5, "the unknown is not counted as a pass");
    assert.ok(d.now.missing.includes("inquiries"));
  });

  test("scoreOf counts passes only, and is null when nothing was scored", () => {
    const checks = [{ passed: true }, { passed: false }, { passed: null }];
    assert.deepEqual(scoreOf(checks), { score: 1, score_max: 3, unknown: 1 });
    assert.deepEqual(scoreOf(checks, { scored: false }), { score: null, score_max: 3, unknown: 3 });
  });
});

describe("tier is the engine's own fundable gate", () => {
  const files = {
    clean: {},
    lowScore: { crsRows: [{ ...PULL, result: { ...PULL.result, scores: { ex: 640, eq: 655, tu: 648 } } }] },
    negatives: { cf: CF({ crs_negative_items_count: 3 }) },
    negativesUnknown: { cf: CF({ crs_negative_items_count: null }) },
    maxedCards: { lines: LINES().map((l) => (l.kind === "revolving" ? { ...l, balance_cents: l.credit_limit_cents } : l)) }
  };

  test("(tier === 'fundable') === uw.fundable on every file — never a second opinion", () => {
    for (const [name, o] of Object.entries(files)) {
      const read = readEngine({
        lines: o.lines || LINES(), liabilities: CURRENT(["t1", "t2", "t3", "t4"]),
        crsRows: o.crsRows || [PULL], customFields: o.cf || CF(), businesses: []
      });
      assert.equal(tierOf(read.uw) === "fundable", read.uw.fundable === true, name);
    }
  });

  test("a measured fail is not_fundable; a fail that rests only on a blank is null", () => {
    assert.equal(build(files.lowScore).now.tier, "not_fundable");
    assert.equal(build(files.negatives).now.tier, "not_fundable");
    assert.equal(build(files.maxedCards).now.tier, "not_fundable");
    const blank = build(files.negativesUnknown);
    assert.equal(blank.now.tier, null, "the engine refuses an unknown negatives count; we cannot tell");
    assert.ok(blank.now.missing.includes("negative_items"));
  });
});

describe("the money: one bureau's worth, only for a fundable file", () => {
  test("$212,000 — the engine's primary-bureau figure, not the tripled $636,000", () => {
    const d = build();
    assert.equal(d.now.funding_estimate_cents, 21200000);
    const read = readEngine({ lines: LINES(), liabilities: CURRENT(["t1", "t2", "t3", "t4"]), crsRows: [PULL], customFields: CF(), businesses: [] });
    assert.equal(read.uw.totals.total_personal_funding, 636000, "the engine's own total adds each bureau");
    assert.notEqual(d.now.funding_estimate_cents, 63600000);
  });

  test("a pull with one bureau scored keeps the engine's own one-bureau cut", () => {
    const one = { ...PULL, result: { ...PULL.result, scores: { ex: null, eq: 778, tu: null } } };
    const d = build({ crsRows: [one] });
    const read = readEngine({ lines: LINES(), liabilities: CURRENT(["t1", "t2", "t3", "t4"]), crsRows: [one], customFields: CF(), businesses: [] });
    assert.equal(read.uw.per_bureau.equifax.totalPersonalFunding, 212000);
    assert.equal(Math.round(read.uw.totals.total_personal_funding * 100), 7066667, "the engine cuts a lone fundable bureau to a third");
    assert.equal(d.now.funding_estimate_cents, 7066667, "the lower of the two engine figures");
  });

  test("no figure for a file the engine calls not fundable", () => {
    const d = build({ cf: CF({ crs_negative_items_count: 2 }) });
    assert.equal(d.now.tier, "not_fundable");
    assert.equal(d.now.funding_estimate_cents, null);
    assert.equal(fundingEstimateCents({ per_bureau: { ex: { totalPersonalFunding: 1 } }, primary_bureau: "ex" }, null), null);
  });
});

describe("null when the engine has no inputs", () => {
  test("no credit pull: score, tier and money are null, nothing is projected", () => {
    const d = build({ crsRows: [], lines: [], liabilities: [] });
    assert.equal(d.has_pull, false);
    assert.equal(d.now.score, null);
    assert.equal(d.now.tier, null);
    assert.equal(d.now.funding_estimate_cents, null);
    assert.deepEqual(d.now.missing, ["credit_pull"]);
    assert.deepEqual(d.now.sentences, []);
    assert.deepEqual(d.projections, []);
    for (const f of d.now.factors) assert.equal(f.passed, null, f.key);
  });

  test("a sandbox pull is not this person's file and scores nothing", () => {
    const sandbox = { ...PULL, result: { ...PULL.result, environment: "sandbox", simulated: false } };
    const d = build({ crsRows: [sandbox], lines: [], liabilities: [] });
    assert.equal(d.has_pull, false);
    assert.equal(d.now.score, null);
  });
});

describe("projections re-run the same engine on a projected copy", () => {
  test("three plan points at +3, +6, +12 months, each listing what it assumed", () => {
    const d = build();
    assert.deepEqual(plan(d).map((p) => p.months), [3, 6, 12]);
    assert.deepEqual(plan(d).map((p) => p.date), [3, 6, 12].map((m) => addMonths(TODAY, m)));
    for (const p of plan(d)) {
      assert.ok(Array.isArray(p.assumptions) && p.assumptions.length > 0, `+${p.months} lists its assumptions`);
      assert.equal(p.assumptions[0], `${p.months} months go by. Your open accounts stay open.`);
      assert.equal(typeof p.checks.no_inquiries, "boolean");
    }
  });

  test("nothing in the plan moves the engine → a flat line, and inquiries never age off", () => {
    const d = build();
    for (const p of plan(d)) {
      assert.equal(p.score, 5);
      assert.equal(p.checks.no_inquiries, false, "UnderwriteIQ has no inquiry age window");
      assert.equal(p.funding_estimate_cents, 21200000);
    }
  });

  test("time is the only thing that seasons a card: 22 months old fails the anchor now, passes at +3", () => {
    const young = [
      LINE({ id: "y1", lender: "DISCOVER", limit: "800000", balance: "40000", opened: ago(22) }),
      LINE({ id: "y2", lender: "CITI", limit: "300000", balance: "10000", opened: ago(30) }),
      LINE({ id: "y3", lender: "BOFA", limit: "200000", balance: "10000", opened: ago(31) })
    ];
    const d = build({ lines: young, liabilities: CURRENT(["y1", "y2", "y3"]) });
    assert.equal(d.now.factors.find((f) => f.key === "anchor_card").passed, false);
    const at3 = plan(d).find((p) => p.months === 3);
    assert.equal(at3.checks.anchor_card, true);
    assert.equal(at3.score, d.now.score + 1);
    // Card funding appears once the $8,000 card seasons: 8,000 × 5.5 = $44,000.
    assert.equal(at3.funding_estimate_cents, 4400000);
  });

  test("a paydown applies only from its own due date, only to its card, and only when it moves a balance", () => {
    const hot = LINES().map((l) => (l.id === "t1" ? { ...l, balance_cents: "1600000" } : l)); // Chase 80%
    const due = addMonths(TODAY, 4);
    const waypoints = [{
      key: "paydown_chase_card_services", state: "not_started", due_at: `${due}T12:00:00Z`, verify_kind: "paydown",
      params: { definition_key: "paydown_revolving_account", creditor: "CHASE CARD SERVICES",
        creditor_key: "chase_card_services", account_prints: [], target_cents: 200000 }
    }];
    const d = build({ lines: hot, waypoints });
    assert.equal(d.now.factors.find((f) => f.key === "utilization_30").passed, false);
    const [p3, p6, p12] = plan(d);
    assert.ok(!p3.assumptions.some((a) => a.startsWith("You pay")), "not due yet at +3");
    assert.equal(p3.checks.utilization_30, false);
    assert.ok(p6.assumptions.some((a) => /^You pay CHASE CARD SERVICES down to \$2,000/.test(a)), p6.assumptions.join(" | "));
    assert.equal(p6.checks.utilization_30, true);
    assert.equal(p12.checks.utilization_30, true);
    assert.equal(d.plan.paydowns.length, 1);
  });

  test("a card already at its target is not listed as an assumption", () => {
    const waypoints = [{
      key: "paydown_amex", state: "done", due_at: `${addMonths(TODAY, 1)}T12:00:00Z`, verify_kind: "paydown",
      params: { creditor: "AMEX", creditor_key: "amex", account_prints: [], target_cents: 150000 }
    }];
    const d = build({ waypoints });
    for (const p of plan(d)) assert.ok(!p.assumptions.some((a) => a.startsWith("You pay")));
  });

  test("projectFile never mutates today's file", () => {
    const base = { lines: LINES(), liabilities: [], crsRows: [PULL], customFields: CF(), businesses: [{ age_months: 10 }] };
    const before = JSON.stringify(base);
    projectFile(base, { months: 12, date: addMonths(TODAY, 12), paydowns: [], removal: { accounts: 1, after: 0 } });
    assert.equal(JSON.stringify(base), before);
  });

  test("months 0 with no plan is today's file exactly", () => {
    const base = { lines: LINES(), liabilities: CURRENT(["t1", "t2", "t3", "t4"]), crsRows: [PULL], customFields: CF(), businesses: [] };
    const a = readEngine(base);
    const b = readEngine(projectFile(base, { months: 0 }).input);
    assert.deepEqual(b.uw, a.uw);
  });
});

describe("removals are never invented", () => {
  const derog = (o = {}) => ({ id: o.id || "d1", rule_id: "DEROG-COLLECTION", status: "sent", creditor: "MIDLAND", account_last4: "1234", ...o });

  test("no dispute plan → no 'if removed' line, and the plan line never touches negatives", () => {
    const d = build({ cf: CF({ crs_negative_items_count: 2 }) });
    assert.deepEqual(removed(d), []);
    assert.equal(d.plan.if_removed, false);
    for (const p of plan(d)) {
      assert.equal(p.checks.no_negatives, false);
      assert.ok(!p.assumptions.some((a) => /dispute/i.test(a)));
    }
  });

  test("a Metro 2 field dispute, a closed item, or a deleted one is not a removal plan", () => {
    const items = [
      derog({ id: "a", rule_id: "M2-014" }),
      derog({ id: "b", status: "closed" }),
      derog({ id: "c", status: "deleted" }),
      derog({ id: "e", status: "updated" })
    ];
    const d = build({ cf: CF({ crs_negative_items_count: 2 }), disputes: items });
    assert.deepEqual(removed(d), []);
    assert.equal(disputeTargets(items).accounts, 0);
  });

  test("an open derogatory dispute → its own dashed line that says it is not promised", () => {
    const items = [derog({ id: "a" }), derog({ id: "b", rule_id: "DEROG-CHARGEOFF", creditor: "CAP ONE", account_last4: "9999" })];
    const d = build({ cf: CF({ crs_negative_items_count: 3 }), disputes: items });
    assert.equal(d.plan.dispute_accounts, 2);
    const r = removed(d);
    assert.deepEqual(r.map((p) => p.months), [3, 6, 12]);
    for (const p of r) {
      const last = p.assumptions[p.assumptions.length - 1];
      assert.match(last, /targets 2 negative accounts/);
      assert.match(last, /from 3 to 1/);
      assert.match(last, /not promised/);
      assert.equal(p.checks.no_negatives, false, "3 − 2 leaves one; the line does not round down to clean");
    }
    for (const p of plan(d)) assert.equal(p.checks.no_negatives, false, "the plan line still carries all three");
  });

  test("the same account disputed at three bureaus counts once", () => {
    const items = ["EX", "EQ", "TU"].map((b, i) => derog({ id: `x${i}` }));
    assert.deepEqual(disputeTargets(items), { accounts: 1, items: 3 });
  });

  test("no line when the negatives count is unknown or already zero — there is nothing to remove", () => {
    assert.deepEqual(removed(build({ cf: CF({ crs_negative_items_count: null }), disputes: [derog()] })), []);
    assert.deepEqual(removed(build({ cf: CF({ crs_negative_items_count: 0 }), disputes: [derog()] })), []);
  });
});

describe("businesses: one card each, never added up", () => {
  const BIZ = (o) => ({ id: o.id, name: o.name, age_months: o.age, created_at: o.created || "2026-10-01T00:00:00Z",
    entity_data: { source: "finance_os", entity_id: o.container, ...(o.naics ? { naics: o.naics } : {}) } });
  const CONTAINERS = [
    { id: "c1", kind: "business", name: "Alpha LLC", archived_at: null },
    { id: "c2", kind: "business", name: "Beta LLC", archived_at: null },
    { id: "c3", kind: "business", name: "Gamma LLC", archived_at: null }
  ];
  const ROWS = [
    BIZ({ id: "b1", name: "Alpha LLC", age: 30, container: "c1", naics: "541611" }),
    BIZ({ id: "b2", name: "Beta LLC", age: 8, container: "c2", created: "2026-10-02T00:00:00Z" })
  ];

  test("each business has its own score, tier and estimate; no field sums them", () => {
    const d = build({ businesses: ROWS, containers: CONTAINERS });
    assert.equal(d.businesses.length, 3);
    const [a, b, c] = d.businesses;
    assert.equal(a.name, "Alpha LLC");
    assert.equal(a.now.score_max, BUSINESS_CHECKS.length);
    // primary card funding $110,000 × 2 (24+ months) and × 0.5 (under 12).
    assert.equal(a.now.funding_estimate_cents, 22000000);
    assert.equal(b.now.funding_estimate_cents, 5500000);
    assert.equal(a.now.multiplier, 2);
    assert.equal(b.now.multiplier, 0.5);
    assert.equal(c.has_info, false, "a container with no details saved yet");
    assert.equal(c.now, null);
    // Nothing on the payload is the sum of the two.
    const json = JSON.stringify(d);
    assert.ok(!json.includes(String(22000000 + 5500000)), "no summed business figure");
    assert.ok(!json.includes(String(21200000 + 22000000 + 5500000)), "no personal + business total");
    assert.equal(d.now.funding_estimate_cents, 21200000, "the personal figure stays personal");
  });

  test("a business's own checks: name and NAICS on file, age in the engine's top band", () => {
    const d = build({ businesses: ROWS, containers: CONTAINERS });
    const keys = (b) => Object.fromEntries(b.now.factors.map((f) => [f.key, f.passed]));
    assert.deepEqual(keys(d.businesses[0]), {
      personal_fundable: true, anchor_card: true, age_24: true, name_on_file: true, naics_on_file: true
    });
    const beta = keys(d.businesses[1]);
    assert.equal(beta.age_24, false);
    assert.equal(beta.naics_on_file, false);
    assert.match(d.businesses[1].now.factors.find((f) => f.key === "naics_on_file").note, /no place to save/);
    assert.equal(d.businesses[0].now.score, 5);
    assert.equal(d.businesses[1].now.score, 3);
  });

  test("a business ages on its own line: 8 months now → 1× band at +6, the age assumption names it", () => {
    const d = build({ businesses: ROWS, containers: CONTAINERS });
    const beta = d.businesses[1];
    const at6 = beta.projections.find((p) => p.months === 6 && p.scenario === "plan");
    assert.equal(at6.multiplier, 1);
    assert.equal(at6.funding_estimate_cents, 11000000);
    assert.ok(at6.assumptions.includes("Beta LLC is 14 months old."));
  });

  test("an unknown age is unknown — no figure, named as missing", () => {
    const d = build({ businesses: [BIZ({ id: "b9", name: "Nine LLC", age: null, container: "c1" })], containers: CONTAINERS.slice(0, 1) });
    const b = d.businesses[0];
    assert.equal(b.now.funding_estimate_cents, null);
    assert.equal(b.now.tier, null);
    assert.ok(b.now.missing.includes("business_age"));
  });

  test("no business money while the personal file is not fundable — personal comes first", () => {
    const d = build({ businesses: ROWS, containers: CONTAINERS, cf: CF({ crs_negative_items_count: 1 }) });
    for (const b of d.businesses.filter((x) => x.now)) {
      assert.equal(b.now.tier, "not_fundable");
      assert.equal(b.now.funding_estimate_cents, null);
    }
  });

  test("businessEntries lists every company the engine counts, then empty containers", () => {
    const slo = { id: "s1", name: "Shop Co", age_months: 40, entity_data: { source: "slo" }, created_at: "2026-09-01T00:00:00Z" };
    const out = businessEntries({ businessRows: [slo, ...ROWS], containers: CONTAINERS });
    assert.deepEqual(out.map((e) => [e.name, e.container_id, e.has_info]), [
      ["Shop Co", null, true], ["Alpha LLC", "c1", true], ["Beta LLC", "c2", true], ["Gamma LLC", "c3", false]
    ]);
  });
});

describe("the engine's words", () => {
  test("sentences are UnderwriteIQ's verbatim — the same ones the Credit page shows", () => {
    const d = build();
    const credit = underwriteSuggestions({
      lines: LINES(), liabilities: CURRENT(["t1", "t2", "t3", "t4"]), crsRows: [PULL], customFields: CF(), businesses: []
    }).filter((s) => s.topic !== "llc").map((s) => s.text);
    assert.deepEqual(d.now.sentences.map((s) => s.text), credit);
    assert.equal(d.now.sentences[0].check, "no_inquiries");
  });

  test("the page says what it cannot project", () => {
    const d = build();
    assert.deepEqual(d.cannot_project, [...CANNOT_PROJECT]);
    assert.ok(d.cannot_project.some((t) => /scores/i.test(t)));
    assert.ok(d.cannot_project.some((t) => /inquiries/i.test(t)));
    assert.ok(d.cannot_project.some((t) => /Banking history/.test(t)));
  });

  test("the sample flag comes off the pull", () => {
    assert.equal(build().sample, true);
  });
});

describe("plan parsing", () => {
  test("skipped and blocked paydowns are not the plan; a paydown with no target is dropped", () => {
    const rows = [
      { key: "a", state: "skipped", verify_kind: "paydown", params: { creditor: "A", target_cents: 100 } },
      { key: "b", state: "blocked", verify_kind: "paydown", params: { creditor: "B", target_cents: 100 } },
      { key: "c", state: "not_started", verify_kind: "paydown", params: { creditor: "C" } },
      { key: "d", state: "in_progress", verify_kind: null, params: { definition_key: "paydown_revolving_account", creditor: "D", target_cents: "300" }, due_at: null },
      { key: "e", state: "not_started", verify_kind: "no_new_credit", params: {} }
    ];
    const out = paydownPlan(rows);
    assert.deepEqual(out.map((p) => [p.key, p.target_cents, p.due_on]), [["d", 300, null]]);
  });

  test("a paydown with no due date is never applied to a point", () => {
    const hot = LINES().map((l) => (l.id === "t1" ? { ...l, balance_cents: "1600000" } : l));
    const d = build({ lines: hot, waypoints: [{ key: "p", state: "not_started", verify_kind: "paydown", due_at: null,
      params: { creditor: "CHASE CARD SERVICES", creditor_key: "chase_card_services", target_cents: 200000 } }] });
    for (const p of plan(d)) assert.ok(!p.assumptions.some((a) => a.startsWith("You pay")));
  });

  test("addMonths keeps the day, or the month's last day, and never makes up a date", () => {
    assert.equal(addMonths("2026-10-06", 3), "2027-01-06");
    assert.equal(addMonths("2027-01-31", 1), "2027-02-28");
    assert.equal(addMonths("2026-03-15", -15), "2024-12-15");
    assert.equal(addMonths(null, 3), null);
    assert.equal(addMonths("not a date", 3), null);
  });
});

describe("the read", () => {
  function stubDb({ inOrg = true } = {}) {
    const calls = [];
    return {
      calls,
      query: async (sql, params) => {
        calls.push({ sql: sql.replace(/\s+/g, " ").trim(), params });
        if (/FROM clients/.test(sql)) return { rows: inOrg ? [CLIENT()] : [] };
        if (/FROM crs_results/.test(sql)) return { rows: [PULL] };
        if (/FROM tradelines/.test(sql)) return { rows: LINES() };
        if (/FROM card_liabilities/.test(sql)) return { rows: CURRENT(["t1", "t2", "t3", "t4"]) };
        return { rows: [] };
      }
    };
  }

  test("every query is scoped to client AND org, and nothing writes", async () => {
    const db = stubDb();
    const d = await fundability(db, { orgId: ORG, clientId: CID, asOf: AS_OF });
    assert.equal(d.ok, true);
    assert.equal(d.now.score, 5);
    assert.equal(db.calls.length, 8);
    for (const c of db.calls) {
      assert.match(c.sql, /^SELECT /, c.sql);
      assert.match(c.sql, /org_id = \$2/, c.sql);
      assert.match(c.sql, /(client_id|id) = \$1/, c.sql);
    }
    assert.deepEqual(db.calls[0].params, [CID, ORG]);
    for (const c of db.calls.slice(1)) assert.deepEqual(c.params, [CID, ORG]);
  });

  test("a client outside the org is null — the endpoint answers 404", async () => {
    const db = stubDb({ inOrg: false });
    assert.equal(await fundability(db, { orgId: ORG, clientId: CID }), null);
    assert.equal(db.calls.length, 1, "nothing else is read");
  });

  test("demo rows are left out, as the Credit page leaves them out", async () => {
    const db = stubDb();
    await fundability(db, { orgId: ORG, clientId: CID, asOf: AS_OF });
    assert.match(db.calls.find((c) => /crs_results/.test(c.sql)).sql, /is_demo IS NOT TRUE/);
    assert.match(db.calls.find((c) => /FROM tradelines/.test(c.sql)).sql, /is_demo IS NOT TRUE/);
  });
});

describe("checks read the engine's own fields", () => {
  test("personalChecks on an engine result with no lines: depth and anchor are unknown, not failed", () => {
    const read = readEngine({ lines: [], liabilities: [], crsRows: [PULL], customFields: CF(), businesses: [] });
    const byKey = Object.fromEntries(personalChecks(read).map((c) => [c.key, c.passed]));
    assert.equal(byKey.file_depth, null);
    assert.equal(byKey.anchor_card, null);
    assert.equal(byKey.score_700, true);
  });

  test("an account with no open date leaves the anchor unknown instead of failed", () => {
    const undated = LINES().map((l) => ({ ...l, opened_on: null }));
    const d = build({ lines: undated });
    const anchor = d.now.factors.find((f) => f.key === "anchor_card");
    assert.equal(anchor.passed, null);
    assert.match(anchor.note, /no open date/);
    assert.ok(d.now.missing.includes("opened_dates"));
  });
});
