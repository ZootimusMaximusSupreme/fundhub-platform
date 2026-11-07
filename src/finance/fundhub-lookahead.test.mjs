// src/finance/fundhub-lookahead.mjs — the Fundhub look-ahead and the closer's
// roadmap. Stubbed db, no network, no Postgres. Each rule both ways:
//   - month 9 is in the quick picks, and any month 1–24 re-runs UnderwriteIQ
//   - a point is UnderwriteIQ's own projection: it matches fundability.mjs on
//     every month the two share, and changes only the plan's own steps
//   - the "if removed" line starts only after the repair rounds end
//   - no pull, no points and a null score
//   - each business is listed on its own; nothing adds them up
//   - the closing line, no probability words, no heavy disclaimers
//   - every query names the client and the org
//
// The vendored engine reads the clock, so every account date here is written
// relative to today, and no date sits within a month of the 24-month line.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  buildLookahead, fundhubLookahead, parseLookaheadMonth, lookaheadMonths, repairTimeline,
  roadmapSteps, closingLine, chexStep, addDays, LOOKAHEAD_MONTHS, REPAIR_ROUND_DAYS, REPAIR_ROUND_WINDOW
} from "./fundhub-lookahead.mjs";
import { buildFundability, addMonths } from "./fundability.mjs";

const ORG = "fb789b0b-8d8d-4cdc-8a24-ee6b6659e0b6";
const CID = "029964c5-4d8e-47ed-88c9-53ac13863fd4";
const TODAY = new Date().toISOString().slice(0, 10);
const ago = (n) => addMonths(TODAY, -n);
const AS_OF = new Date();

const PULL = (scores = { ex: 771, eq: 778, tu: 766 }) => ({
  id: "p1", created_at: "2026-09-30T04:30:03.759Z",
  result: { scores, scoreModels: {}, environment: "simulated", simulated: true }
});
const LINE = (o) => ({
  id: o.id, lender: o.lender, kind: o.kind || "revolving", credit_limit_cents: o.limit, balance_cents: o.balance,
  opened_on: o.opened, closed_at: null, last4: null, apr: null, raw: { accountStatusType: "Open" }
});
/* The sample client: three seasoned cards and a car loan, 6% use, clean. */
const CLEAN = () => [
  LINE({ id: "t1", lender: "CHASE CARD SERVICES", limit: "2000000", balance: "120000", opened: ago(88) }),
  LINE({ id: "t2", lender: "AMEX", limit: "1500000", balance: "85000", opened: ago(64) }),
  LINE({ id: "t3", lender: "CAPITAL ONE", limit: "1000000", balance: "70000", opened: ago(43) }),
  LINE({ id: "t4", lender: "TOYOTA MOTOR CREDIT", kind: "installment", limit: "3400000", balance: "1120000", opened: ago(40) })
];
/* A messed-up file: cards maxed on one line, two negative items. */
const MESSY = () => [
  LINE({ id: "a1", lender: "CHASE", limit: "1000000", balance: "900000", opened: ago(40) }),
  LINE({ id: "a2", lender: "AMEX", limit: "800000", balance: "100000", opened: ago(40) }),
  LINE({ id: "a3", lender: "CAPITAL ONE", limit: "600000", balance: "50000", opened: ago(40) })
];
const CURRENT = (ids) => ids.map((id) => ({ tradeline_id: id, payment_status: "current", as_of: "2026-09-30" }));
const CF = (o = {}) => ({
  crs_inquiries_ex: 2, crs_inquiries_eq: 1, crs_inquiries_tu: 1,
  crs_negative_items_count: 0, crs_late_payments_count: 0, ...o
});
const DISPUTES = [
  { id: "d1", rule_id: "DEROG-COLLECTION", status: "open", creditor: "Midland Credit", account_last4: "1111" },
  { id: "d2", rule_id: "DEROG-CHARGEOFF", status: "sent", creditor: "Portfolio Recovery", account_last4: "2222" }
];
const PAYDOWN = (due, target = 100000) => ({
  key: "pd-chase", state: "not_started", due_at: due, verify_kind: "paydown",
  params: { creditor: "CHASE", creditor_key: "chase", target_cents: target }
});

function rows(o = {}) {
  return {
    client: { id: CID, first_name: "Sim", last_name: "Eleven-Blueprint", custom_fields: o.cf || CF() },
    asOf: AS_OF,
    crsRows: o.crsRows || [PULL()],
    tradelineRows: o.lines || CLEAN(),
    liabilities: o.liabilities || CURRENT(["t1", "t2", "t3", "t4"]),
    businessRows: o.businesses || [],
    containers: o.containers || [],
    waypoints: o.waypoints || [],
    disputeItems: o.disputes || [],
    disputeCases: o.cases || [],
    relationships: o.relationships ?? null
  };
}
const build = (o = {}, x = {}) => buildLookahead({ ...rows(o), ...x });
const messy = (o = {}) => ({ lines: MESSY(), liabilities: CURRENT(["a1", "a2", "a3"]), cf: CF({ crs_negative_items_count: 2 }), disputes: DISPUTES, ...o });
const at = (d, m, s = "plan") => d.points.find((p) => p.months === m && p.scenario === s);

describe("any month, re-run through UnderwriteIQ", () => {
  test("the quick picks are 3, 6, 9 and 12 — month 9 is there", () => {
    assert.deepEqual([...LOOKAHEAD_MONTHS], [3, 6, 9, 12]);
    const d = build();
    assert.deepEqual(d.points.map((p) => p.months), [3, 6, 9, 12]);
    assert.equal(d.months, 9);
    assert.ok(at(d, 9));
  });

  test("any month from 1 to 24 runs too; anything else is refused", () => {
    assert.deepEqual(build({}, { months: 18 }).points.map((p) => p.months), [3, 6, 9, 12, 18]);
    assert.deepEqual(build({}, { months: 1 }).points.map((p) => p.months), [1, 3, 6, 9, 12]);
    assert.deepEqual(lookaheadMonths(24), [3, 6, 9, 12, 24]);
    assert.deepEqual(lookaheadMonths(25), [3, 6, 9, 12]);
    assert.equal(parseLookaheadMonth("9"), 9);
    assert.equal(parseLookaheadMonth("24"), 24);
    assert.equal(parseLookaheadMonth(undefined), null);
    assert.equal(parseLookaheadMonth(""), null);
    for (const bad of ["0", "25", "3.5", "-3", "nine", "9;drop"]) assert.ok(Number.isNaN(parseLookaheadMonth(bad)), bad);
  });

  test("every shared month matches fundability.mjs exactly — the same engine, the same rules", () => {
    for (const o of [{}, messy({ waypoints: [PAYDOWN(addMonths(TODAY, 2))] })]) {
      const r = rows(o);
      const ours = buildLookahead({ ...r, months: 12 });
      const theirs = buildFundability({ ...r, months: [3, 6, 12] });
      for (const m of [3, 6, 12]) {
        const a = at(ours, m);
        const b = theirs.projections.find((p) => p.months === m && p.scenario === "plan");
        assert.equal(a.tier, b.tier, `month ${m} tier`);
        assert.equal(a.funding_estimate_cents, b.funding_estimate_cents, `month ${m} estimate`);
        assert.equal(a.checks_passed, b.score, `month ${m} checks`);
      }
      assert.equal(ours.now.tier, theirs.now.tier);
      assert.equal(ours.now.funding_estimate_cents, theirs.now.funding_estimate_cents);
    }
  });

  test("the sample client: fundable today and at month 9, about $212,000, one bureau's worth", () => {
    const d = build();
    assert.equal(d.now.tier, "fundable");
    assert.equal(d.now.funding_estimate_cents, 21200000);
    assert.equal(at(d, 9).funding_estimate_cents, 21200000);
    assert.equal(d.now.fundhub_score.band, "fundable");
    assert.ok(Number.isInteger(d.now.fundhub_score.score));
  });

  test("a point uses only the plan's own steps: no paydown waypoint, no paydown", () => {
    const without = build(messy());
    assert.ok(without.points.every((p) => !p.assumptions.some((t) => /pay CHASE down/i.test(t))));
    // A paydown due after the point is not used at that point; due before, it is.
    const later = build(messy({ waypoints: [PAYDOWN(addMonths(TODAY, 7))] }));
    assert.ok(!at(later, 6).assumptions.some((t) => /pay CHASE down/i.test(t)), "month 6 is before the due date");
    assert.ok(at(later, 9).assumptions.some((t) => /pay CHASE down to \$1,000/i.test(t)), "month 9 is after it");
    const s6 = at(later, 6).fundhub_score.score;
    const s9 = at(later, 9).fundhub_score.score;
    assert.ok(s9 > s6, `the paydown lifts the Fundhub score: ${s6} → ${s9}`);
  });

  test("no pull: no points, a null score and the reason, never 0", () => {
    const d = build({ crsRows: [], lines: [], liabilities: [] });
    assert.equal(d.has_pull, false);
    assert.equal(d.points.length, 0);
    assert.equal(d.now.fundhub_score.score, null);
    assert.match(d.now.fundhub_score.reasons[0].text, /needs a credit report/);
    assert.equal(d.now.funding_estimate_cents, null);
  });
});

describe("the repair timeline", () => {
  test("one round is 7 days to mail, 30 for the bureau (FCRA) and 7 to answer", () => {
    assert.deepEqual({ ...REPAIR_ROUND_WINDOW }, { mail_out_days: 7, investigation_days: 30, results_back_days: 7 });
    assert.equal(REPAIR_ROUND_DAYS, 44);
    const none = repairTimeline({ cases: [], today: TODAY });
    assert.equal(none.finish_on, addDays(TODAY, 44));
    assert.equal(none.rounds[0].basis, "not_mailed");
    const mailed = repairTimeline({ cases: [{ bureau: "EX", round: "R1", status: "awaiting_response", mailed_at: addDays(TODAY, -10) }], today: TODAY });
    assert.equal(mailed.finish_on, addDays(TODAY, 34));
    const due = repairTimeline({ cases: [{ bureau: "TU", round: "R2", status: "open", response_due_at: addDays(TODAY, 20), mailed_at: addDays(TODAY, -10) }], today: TODAY });
    assert.equal(due.finish_on, addDays(TODAY, 27), "a due date on file wins, plus the answer's trip back");
    const closed = repairTimeline({ cases: [{ bureau: "EQ", status: "closed", response_due_at: addDays(TODAY, 300) }], today: TODAY });
    assert.equal(closed.finish_on, addDays(TODAY, 44), "a closed round is not in play");
    const late = repairTimeline({ cases: [{ bureau: "EQ", status: "awaiting_response", response_due_at: addDays(TODAY, -40) }], today: TODAY });
    assert.equal(late.finish_on, TODAY);
    assert.match(none.text, /if all negative items are removed by then/);
  });

  test("the if-removed line starts only after the rounds end", () => {
    const soon = build(messy({ waypoints: [PAYDOWN(addMonths(TODAY, 2))] }), { months: 1 });
    assert.equal(at(soon, 1, "if_removed").removal_applied, false, "month 1 is inside the 44 days");
    assert.ok(at(soon, 1, "if_removed").assumptions.some((t) => /nothing comes off by this date/.test(t)));
    assert.equal(at(soon, 1, "if_removed").tier, at(soon, 1, "plan").tier);
    assert.equal(at(soon, 3, "if_removed").removal_applied, true);
    assert.equal(at(soon, 3, "if_removed").tier, "fundable");
    // A round answered far out pushes the start back.
    const far = build(messy({ cases: [{ bureau: "EX", round: "R3", status: "awaiting_response", response_due_at: addDays(TODAY, 120) }] }));
    assert.equal(at(far, 3, "if_removed").removal_applied, false);
    assert.equal(at(far, 6, "if_removed").removal_applied, true);
    // The plan line never assumes a removal.
    assert.ok(far.points.filter((p) => p.scenario === "plan").every((p) => p.removal_applied === false && p.tier === "not_fundable"));
  });

  test("no dispute plan, no repair date and no if-removed line", () => {
    const d = build(messy({ disputes: [] }));
    assert.equal(d.repair, null);
    assert.equal(d.points.some((p) => p.scenario === "if_removed"), false);
  });
});

describe("businesses — each one on its own", () => {
  const BIZ = [
    { id: "b1", name: "Older LLC", age_months: 30, entity_data: {}, created_at: "2025-01-01T00:00:00Z" },
    { id: "b2", name: "Young LLC", age_months: 4, entity_data: {}, created_at: "2026-01-01T00:00:00Z" }
  ];
  test("each business gets UnderwriteIQ's own slice at the month, listed, never summed", () => {
    const d = build({ businesses: BIZ }, { months: 9 });
    const p = at(d, 9);
    assert.deepEqual(p.businesses.map((b) => b.name), ["Older LLC", "Young LLC"]);
    assert.deepEqual(p.businesses.map((b) => b.age_months), [39, 13]);
    assert.deepEqual(p.businesses.map((b) => b.multiplier), [2, 1]);
    // card figure $110,000 (the $20,000 card × 5.5) × the age band.
    assert.deepEqual(p.businesses.map((b) => b.funding_estimate_cents), [22000000, 11000000]);
    const json = JSON.stringify(d);
    assert.doesNotMatch(json, /business_total|combined|total_business/);
    assert.equal(p.funding_estimate_cents, 21200000, "personal stays personal");
  });
});

describe("business evidence — an amount needs a report or reviewed papers", () => {
  const BIZ = [{ id: "b1", name: "Older LLC", age_months: 30, entity_data: { state: "AZ" }, created_at: "2025-01-01T00:00:00Z" }];
  test("no saved business report and no reviewed papers: not supported", () => {
    const d = build({ businesses: BIZ }, { months: 9 });
    const b = at(d, 9).businesses[0];
    assert.equal(b.supported, false);
    assert.deepEqual(b.evidence, { report: false, reviewed: false });
    assert.equal(d.now.businesses[0].supported, false);
  });
  test("a saved report for that company on a real pull supports it; a sandbox pull does not", () => {
    const report = { name: "Older LLC", state: "AZ", report: { data: { scoreInformation: { commercialScore: { score: 55 } } } } };
    const real = PULL();
    real.result = { ...(real.result || {}), businessReports: [report] };
    const d = build({ businesses: BIZ, crsRows: [real] }, { months: 9 });
    assert.equal(at(d, 9).businesses[0].supported, true);
    assert.equal(at(d, 9).businesses[0].evidence.report, true);
    const sandbox = PULL();
    sandbox.result = { ...(sandbox.result || {}), environment: "sandbox", businessReports: [report] };
    // A sandbox pull is not scored at all, so read the business line on `now`.
    assert.equal(build({ businesses: BIZ, crsRows: [sandbox] }, { months: 9 }).now.businesses[0].supported, false);
  });
  test("formation and EIN papers reviewed on the Blueprint plan support it; one alone does not", () => {
    const plan = (formation, ein) => CF({ blueprint_business_plans: { businesses: [{ businessId: "b1", evidence: { formation: { status: formation }, ein: { status: ein } } }] } });
    assert.equal(at(build({ businesses: BIZ, cf: plan("reviewed", "reviewed") }, { months: 9 }), 9).businesses[0].supported, true);
    assert.equal(at(build({ businesses: BIZ, cf: plan("reviewed", "not_added") }, { months: 9 }), 9).businesses[0].supported, false);
  });
});

describe("the closer's roadmap", () => {
  test("not fundable today, the dispute plan used: the closing line names the month and the personal estimate", () => {
    const d = build(messy({ waypoints: [PAYDOWN(addMonths(TODAY, 2))] }), { months: 9, view: "plan" });
    assert.equal(d.roadmap.scenario, "if_removed");
    assert.equal(d.roadmap.closing_line,
      "Not fundable today. If you follow this plan, the disputed items come off and nothing new hits your file, in 9 months UnderwriteIQ estimates Fundable, about $55,000 personal.");
    assert.deepEqual(d.roadmap.steps.map((s) => s.kind).slice(0, 2), ["repair", "paydown"]);
  });

  test("fundable today: the plan line, and the same words for the month", () => {
    const d = build({}, { months: 9, view: "plan" });
    assert.equal(d.roadmap.scenario, "plan");
    assert.equal(d.roadmap.closing_line,
      "Fundable today. If you follow this plan and nothing new hits your file, in 9 months UnderwriteIQ estimates Fundable, about $212,000 personal.");
  });

  test("not fundable at the month either: no dollar figure is said", () => {
    const d = build(messy({ disputes: [] }), { months: 6, view: "plan" });
    assert.equal(d.roadmap.closing_line,
      "Not fundable today. If you follow this plan and nothing new hits your file, in 6 months UnderwriteIQ estimates not fundable yet.");
    assert.equal(closingLine({ todayTier: null, months: 3, target: { tier: null } }),
      "UnderwriteIQ cannot tell yet today. UnderwriteIQ needs more of the file on record before it can look ahead.");
  });

  test("the steps are one dated path: repair, paydowns, ChexSystems, bank accounts and seasoning, business age", () => {
    const steps = roadmapSteps({
      today: TODAY,
      repair: repairTimeline({ cases: [], today: TODAY }),
      paydowns: [{ creditor: "CHASE", target_cents: 100000, due_on: addMonths(TODAY, 3), state: "not_started" }],
      chex: chexStep({ blueprint_business_plans: { version: 1, stepProgress: [{ stepKey: "chexsystems", status: "in_progress", targetDate: addDays(TODAY, 20) }] } }),
      relationships: [
        { bank: "Chase", account_kind: "business", status: "planned", planned_open_on: addDays(TODAY, 30), seasoning: { days: 30 } },
        { bank: "PNC", account_kind: "personal", status: "seasoning", seasoned_on: addDays(TODAY, 10), seasoning: { days: 45 } },
        { bank: "Skip Bank", account_kind: "personal", status: "skipped" }
      ],
      entries: [{ has_info: true, name: "Young LLC", age_months: 4 }]
    });
    assert.deepEqual(steps.map((s) => s.kind),
      ["seasoning", "chexsystems", "bank_account", "repair", "seasoning", "paydown", "business_age", "business_age"]);
    const dates = steps.map((s) => s.date);
    assert.deepEqual([...dates].sort(), dates, "date order");
    assert.ok(!steps.some((s) => /Skip Bank/.test(s.text)));
    assert.match(steps.find((s) => s.kind === "chexsystems").text, /ChexSystems/);
    assert.equal(chexStep({}), null, "no Blueprint plan, no ChexSystems step");
  });

  test("the roadmap is staff only: the client look-ahead does not carry it", () => {
    assert.equal(build({}, { view: "lookahead" }).roadmap, undefined);
    assert.ok(build({}, { view: "plan" }).roadmap);
  });

  test("light words: no probability words and no heavy disclaimers anywhere in the payload", () => {
    for (const d of [build(messy(), { view: "plan" }), build({}, { view: "plan", months: 24 })]) {
      const json = JSON.stringify(d);
      assert.doesNotMatch(json, /probab|100%|guarantee|likely|chance|machine learning/i);
      assert.doesNotMatch(json, /not promised|not a promise|not an approval/i);
    }
  });
});

describe("the read", () => {
  function stubDb(tables = {}) {
    const calls = [];
    return {
      calls,
      query: async (sql, params = []) => {
        const text = String(sql).replace(/\s+/g, " ").trim();
        calls.push({ sql: text, params });
        const m = /\bFROM\s+(clients|crs_results|tradelines|card_liabilities|businesses|entities|client_waypoints|dispute_items|dispute_cases)\b/i.exec(text);
        if (!m) throw new Error(`unexpected SQL: ${text.slice(0, 60)}`);
        if (m[1] === "clients") return { rows: params[0] === CID && params[1] === ORG ? [rows().client] : [] };
        return { rows: tables[m[1]] || [] };
      }
    };
  }

  test("every query is a SELECT naming the client and the org; a client of another org is null", async () => {
    const db = stubDb({ crs_results: [PULL()], tradelines: CLEAN(), card_liabilities: CURRENT(["t1", "t2", "t3", "t4"]) });
    const d = await fundhubLookahead(db, { orgId: ORG, clientId: CID, asOf: AS_OF, months: 9 });
    assert.equal(d.now.tier, "fundable");
    assert.equal(db.calls.length, 9);
    for (const c of db.calls) {
      assert.match(c.sql, /^SELECT /);
      assert.deepEqual(c.params, [CID, ORG]);
      assert.match(c.sql, /client_id = \$1|id = \$1/);
      assert.match(c.sql, /org_id = \$2/);
    }
    assert.equal(await fundhubLookahead(stubDb(), { orgId: "other", clientId: CID }), null);
  });

  test("the plan view reads the bank steps; when that read fails the roadmap still loads and says so", async () => {
    const db = stubDb({ crs_results: [PULL()], tradelines: CLEAN(), card_liabilities: CURRENT(["t1", "t2", "t3", "t4"]) });
    let asked = null;
    const ok = await fundhubLookahead(db, { orgId: ORG, clientId: CID, asOf: AS_OF, view: "plan",
      readBankSteps: async (_db, scope) => { asked = scope; return [{ bank: "Chase", account_kind: "personal", status: "planned", planned_open_on: addDays(TODAY, 15), seasoning: null }]; } });
    assert.deepEqual({ orgId: asked.orgId, clientId: asked.clientId }, { orgId: ORG, clientId: CID });
    assert.equal(ok.roadmap.bank_steps_read, true);
    assert.ok(ok.roadmap.steps.some((s) => s.kind === "bank_account"));
    const orig = console.error;
    console.error = () => {};
    try {
      const failed = await fundhubLookahead(db, { orgId: ORG, clientId: CID, asOf: AS_OF, view: "plan",
        readBankSteps: async () => { throw new Error("relation does not exist"); } });
      assert.equal(failed.roadmap.bank_steps_read, false);
      assert.ok(failed.roadmap.closing_line);
    } finally { console.error = orig; }
    // The client view never reads the bank steps.
    let read = false;
    await fundhubLookahead(db, { orgId: ORG, clientId: CID, asOf: AS_OF, readBankSteps: async () => { read = true; return []; } });
    assert.equal(read, false);
  });
});
