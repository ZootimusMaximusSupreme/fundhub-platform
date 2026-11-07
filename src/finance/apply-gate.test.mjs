// Apply gate, seasoning clock and approval odds — the rules, with no database.
// Each rule is tested both ways: a case that passes, and a case that fails if
// the logic breaks. src/finance/apply-gate.mjs holds the rules.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  SEASON_DAYS, BETTER_DAYS, applicationLimits, limitStatus, windowStart, seasoningClock, gateChecks,
  oddsForBank, groupBanks, buildApplyGate, applyGate, setApplyOverride, ApplyGateInputError, readOverrides,
  bankKey, safeLogo, APPROVALS_SQL
} from "./apply-gate.mjs";

const TODAY = "2026-11-07";

/* The bank book's own words, as the Legacy Strong import stored them. */
const BOA_WORDS = "Giovanni list: TransUnion.\nChecking account is required with liquidity seasoned 30+ days.; " +
  "Business checking required. Season with $5K–$10K for 30+ days.; Max of 2 card approvals within 30 days.; " +
  "Max of 3 card approvals within a year.; Max of 4 card approvals within 2 years.; This is a newer rule and doesn't always apply.";
const CITI_TIPS = "The 1 in 8 Rule & 2 in 65 Rule set by Citi ensures a controlled application process. " +
  "Citi card approval every eight days, with no more than two approvals within a rolling 65-day window.";

const BOA = { id: "b0a00000-0000-4000-8000-000000000001", name: "Bank of America", lender_table: "OnlineBizCC",
  requires_account_opening: "yes", stated_requirements: BOA_WORDS, logo_path: "/assets/lenders/bank-of-america.png",
  external_row_id: "LEGACY-ONLINEBIZCC-BANK-OF-AMERICA", product_name: "Business Advantage Unlimited Cash" };
const CHASE = { id: "c4a5e000-0000-4000-8000-000000000001", name: "Chase", lender_table: "OnlineBizCC",
  requires_account_opening: "yes", stated_requirements: "Giovanni list: Experian.\n30+ days of liquidity seasoning strongly improves odds",
  logo_path: "/assets/lenders/chase.png" };
const AMEX = { id: "a3e40000-0000-4000-8000-000000000001", name: "American Express", lender_table: "OnlineBizCC",
  stated_requirements: "No business checking required." };
const CITI = { id: "c1710000-0000-4000-8000-000000000001", name: "Citi", lender_table: "PersonalCC", insider_tips: CITI_TIPS };

/** A fundability read the way src/finance/fundability.mjs answers it. */
function fund({ pull = true, tier = "fundable", inquiries = 0, sample = false, misses = [] } = {}) {
  const f = (key, label, passed, value = null) => ({ key, label, passed, value });
  return {
    ok: true, has_pull: pull, sample, client: { id: "cli-1", name: "Alex Sample" },
    now: {
      tier: pull ? tier : null,
      factors: pull ? [
        f("score_700", "Credit score 700 or higher", !misses.includes("score_700")),
        f("utilization_30", "Cards used 30% or less", !misses.includes("utilization_30")),
        f("no_negatives", "No negative items", !misses.includes("no_negatives")),
        f("anchor_card", "A card 2+ years old with a $5,000+ limit", true),
        f("no_inquiries", "No hard inquiries", inquiries === null ? null : inquiries === 0, inquiries),
        f("file_depth", "3 or more accounts in good standing", true)
      ] : ["score_700", "utilization_30", "no_negatives", "anchor_card", "no_inquiries", "file_depth"].map((k) => f(k, k, null))
    }
  };
}

/** One readRelationships() line. */
function rel(bank, opened, extra = {}) {
  return { id: `rel-${bankKey(bank)}`, bank, bank_key: bankKey(bank), account_kind: "business",
    status: opened ? "seasoning" : "planned", opened_on: opened, lender_id: null, ...extra };
}

describe("the bank book's application limits", () => {
  test("Bank of America's three stated limits are read from its own words", () => {
    const lims = applicationLimits(BOA).map((l) => [l.max, l.amount, l.unit]);
    assert.deepEqual(lims, [[2, 30, "day"], [3, 1, "year"], [4, 2, "year"]]);
  });
  test("Citi's limits are read only where the book names the days", () => {
    const lims = applicationLimits(CITI).map((l) => [l.max, l.amount, l.unit]);
    assert.deepEqual(lims, [[2, 65, "day"], [1, 8, "day"]]);
  });
  test("a bank whose book states no limit has none — nothing is assumed", () => {
    assert.deepEqual(applicationLimits(CHASE), []);
    assert.deepEqual(applicationLimits({ name: "X", stated_requirements: "Apply online. Wait for the decision." }), []);
  });
  test("two approvals inside 30 days reach the limit; the older one sets the day it frees", () => {
    const lim = applicationLimits(BOA)[0];
    assert.deepEqual(limitStatus(lim, ["2026-10-30", "2026-11-05"], TODAY), { in_window: 2, reached: true, frees_on: "2026-11-29" });
  });
  test("an approval 30 days old is outside the window, so one approval is not the limit", () => {
    const lim = applicationLimits(BOA)[0];
    assert.equal(windowStart(TODAY, lim), "2026-10-08");
    assert.deepEqual(limitStatus(lim, ["2026-10-08", "2026-11-05"], TODAY), { in_window: 1, reached: false, frees_on: null });
  });
  test("a year window counts calendar months back", () => {
    const year = applicationLimits(BOA)[1];
    assert.equal(windowStart(TODAY, year), "2025-11-07");
    const st = limitStatus(year, ["2026-01-02", "2026-05-01", "2026-09-09"], TODAY);
    assert.equal(st.reached, true);
    assert.equal(st.frees_on, "2027-01-02");
  });
});

describe("the seasoning clock", () => {
  test("day 18 of 30 says the day it is seasoned, and no congrats yet", () => {
    const c = seasoningClock(rel("Chase", "2026-10-20"), { today: TODAY });
    assert.equal(c.day, 18);
    assert.equal(c.milestone, "seasoning");
    assert.equal(c.seasoned, false);
    assert.equal(c.seasoned_on, "2026-11-19");
    assert.equal(c.congrats, null);
    assert.match(c.text, /Day 18 of 30\. Seasoned on Nov 19, 2026\./);
  });
  test("at 30 days the client sees the congrats line, and 60 is marked as better", () => {
    const c = seasoningClock(rel("Chase", "2026-10-08"), { today: TODAY });
    assert.equal(c.day, SEASON_DAYS);
    assert.equal(c.milestone, "seasoned");
    assert.equal(c.congrats, "Congrats. Your Chase account is seasoned.");
    assert.deepEqual(c.next_mark, { days: BETTER_DAYS[0], on: "2026-12-07" });
  });
  test("60 and 90 days are their own marks", () => {
    assert.equal(seasoningClock(rel("Chase", "2026-09-08"), { today: TODAY }).milestone, "seasoned_60");
    const c90 = seasoningClock(rel("Chase", "2026-08-01"), { today: TODAY });
    assert.equal(c90.milestone, "seasoned_90");
    assert.equal(c90.next_mark, null);
  });
  test("an account marked open with no open day is unknown — never counted as seasoned", () => {
    const c = seasoningClock({ ...rel("Chase", null), status: "open" }, { today: TODAY });
    assert.equal(c.milestone, "day_unknown");
    assert.equal(c.day, null);
    assert.equal(c.seasoned, null);
  });
  test("a planned account has no clock yet, and a skipped one is left out", () => {
    assert.equal(seasoningClock(rel("Chase", null), { today: TODAY }).milestone, "not_opened");
    assert.equal(seasoningClock({ ...rel("Chase", "2026-01-01"), status: "skipped" }, { today: TODAY }), null);
  });
});

describe("the gate", () => {
  const seasoned = seasoningClock(rel("Chase", "2026-10-01"), { today: TODAY });
  const young = seasoningClock(rel("Chase", "2026-10-20"), { today: TODAY });

  test("fundable + no inquiries + a seasoned account opens the gate", () => {
    const g = gateChecks({ fundability: fund(), clocks: [seasoned] });
    assert.equal(g.status, "open");
    assert.deepEqual(g.checks.map((c) => c.passed), [true, true, true]);
  });
  test("a seasoned account alone never opens it: 3 inquiries keep it locked", () => {
    const g = gateChecks({ fundability: fund({ inquiries: 3 }), clocks: [seasoned] });
    assert.equal(g.status, "locked");
    assert.match(g.checks[1].text, /3 hard inquiries are on your file/);
  });
  test("not fundable names the engine's own failing checks", () => {
    const g = gateChecks({ fundability: fund({ tier: "not_fundable", misses: ["score_700"] }), clocks: [seasoned] });
    assert.equal(g.status, "locked");
    assert.equal(g.checks[0].passed, false);
    assert.match(g.checks[0].text, /Credit score 700 or higher/);
  });
  test("no credit pull is unknown, and unknown keeps the gate locked", () => {
    const g = gateChecks({ fundability: fund({ pull: false }), clocks: [seasoned] });
    assert.equal(g.status, "locked");
    assert.equal(g.checks[0].passed, null);
    assert.equal(g.checks[1].passed, null);
  });
  test("a 29-day-old account is not seasoned; the check says which day it is on", () => {
    const g = gateChecks({ fundability: fund(), clocks: [young] });
    assert.equal(g.status, "locked");
    assert.equal(g.checks[2].passed, false);
    assert.match(g.checks[2].text, /day 18 of 30/);
  });
  test("no bank account on the plan keeps it locked", () => {
    const g = gateChecks({ fundability: fund(), clocks: [] });
    assert.equal(g.checks[2].passed, false);
    assert.equal(g.status, "locked");
  });
});

describe("approval odds per bank", () => {
  const groups = groupBanks([CHASE, BOA, AMEX]);
  const at = (k) => groups.find((g) => g.key === k);
  const openGate = gateChecks({ fundability: fund(), clocks: [seasoningClock(rel("Chase", "2026-10-01"), { today: TODAY })] });

  test("not fundable → Not yet at every bank, with the engine's reason", () => {
    const g = gateChecks({ fundability: fund({ tier: "not_fundable", misses: ["no_negatives"] }), clocks: [] });
    const o = oddsForBank(at("chase"), { today: TODAY, gate: g });
    assert.equal(o.status, "not_yet");
    assert.match(o.reasons[0].text, /No negative items/);
  });
  test("a bank that wants an account: seasoned there → Ready", () => {
    const o = oddsForBank(at("chase"), { today: TODAY, gate: openGate,
      clocks: [seasoningClock(rel("Chase", "2026-10-01"), { today: TODAY })] });
    assert.equal(o.status, "ready");
    assert.equal(o.logo_path, "/assets/lenders/chase.png");
  });
  test("a bank that wants an account: not open there → Wait, even when another account is seasoned", () => {
    const o = oddsForBank(at("bank of america"), { today: TODAY, gate: openGate, clocks: [] });
    assert.equal(o.status, "wait");
    assert.match(o.reasons[0].text, /Open your Bank of America account first/);
  });
  test("a bank that wants an account: day 18 → Wait with the day it is ready", () => {
    const o = oddsForBank(at("bank of america"), { today: TODAY, gate: openGate,
      clocks: [seasoningClock(rel("Bank of America", "2026-10-20"), { today: TODAY })] });
    assert.equal(o.status, "wait");
    assert.equal(o.ready_on, "2026-11-19");
  });
  test("a bank that wants no account follows the gate's first seasoned account", () => {
    assert.equal(oddsForBank(at("american express"), { today: TODAY, gate: openGate }).status, "ready");
    const locked = gateChecks({ fundability: fund(), clocks: [] });
    const o = oddsForBank(at("american express"), { today: TODAY, gate: locked });
    assert.equal(o.status, "wait");
    assert.match(o.reasons[0].text, /first bank account is seasoned 30 days/);
  });
  test("2 Bank of America card approvals in 30 days → Wait, and the book's words are the reason", () => {
    const clocks = [seasoningClock(rel("Bank of America", "2026-09-01"), { today: TODAY })];
    const o = oddsForBank(at("bank of america"), { today: TODAY, gate: openGate, clocks,
      approvals: ["2026-10-30", "2026-11-05"] });
    assert.equal(o.status, "wait");
    assert.equal(o.ready_on, "2026-11-29");
    assert.match(o.reasons.at(-1).text, /up to 2 card approvals in 30 days at Bank of America\. You have 2 approved there\. A large deposit can allow more/);
    assert.equal(o.limits[0].reached, true);
  });
  test("staff allowing more lifts the book's limit — and only the limit", () => {
    const clocks = [seasoningClock(rel("Bank of America", "2026-09-01"), { today: TODAY })];
    const override = { bank_key: "bank of america", allow_more: true, note: "Big deposit landed", created_at: "2026-11-06T00:00:00Z" };
    const o = oddsForBank(at("bank of america"), { today: TODAY, gate: openGate, clocks,
      approvals: ["2026-10-30", "2026-11-05"], override, viewer: "staff" });
    assert.equal(o.status, "ready");
    assert.ok(o.reasons.some((r) => /cleared more applications/.test(r.text)));
    assert.equal(o.override.note, "Big deposit landed");
    /* The override never opens a locked gate. */
    const shut = gateChecks({ fundability: fund({ inquiries: 2 }), clocks });
    assert.equal(oddsForBank(at("bank of america"), { today: TODAY, gate: shut, clocks, override }).status, "not_yet");
  });
  test("the client never reads staff's note", () => {
    const override = { bank_key: "bank of america", allow_more: true, note: "Big deposit landed", created_at: "2026-11-06T00:00:00Z" };
    const o = oddsForBank(at("bank of america"), { today: TODAY, gate: openGate, override, viewer: "client" });
    assert.equal(o.override.note, null);
    assert.equal(o.override.allow_more, true);
  });
});

describe("the whole payload", () => {
  test("approvals count against card limits only; an unknown product type is counted apart", () => {
    const out = buildApplyGate({
      today: TODAY, fundability: fund(), matches: [BOA, CHASE], extra: [],
      relationships: [rel("Bank of America", "2026-09-01"), rel("Chase", "2026-10-01")],
      approvals: [
        { lender_id: BOA.id, bank: "Bank of America", lender_table: "OnlineBizCC", decided_on: "2026-10-30" },
        { lender_id: null, bank: "Bank of America", lender_table: "BizLOC_Stated", decided_on: "2026-11-01" },
        { lender_id: null, bank: "Bank of America", lender_table: null, decided_on: "2026-11-02" }
      ]
    });
    const boa = out.odds.find((o) => o.bank_key === "bank of america");
    assert.equal(boa.limits[0].in_window, 1);
    assert.equal(boa.status, "ready");
    assert.equal(out.unknown_type_approvals, 1);
    assert.equal(out.gate.status, "open");
    assert.equal(out.counts.ready, 2);
  });
  test("guidance lists every stated limit but never locks the gate", () => {
    const out = buildApplyGate({ today: TODAY, fundability: fund(), matches: [BOA], relationships: [rel("Bank of America", "2026-09-01")] });
    assert.equal(out.gate.status, "open");
    assert.equal(out.gate.guidance.length, 3);
    assert.match(out.gate.guidance[0].text, /up to 2 card approvals in 30 days at Bank of America/);
    assert.equal(out.rules.limit_note, "A large deposit can allow more. Your Fundhub team decides.");
  });
  test("the clock takes its logo from the bank book row, and staff can override", () => {
    const out = buildApplyGate({ today: TODAY, fundability: fund(), matches: [], extra: [CHASE],
      relationships: [rel("Chase", "2026-10-20")], viewer: "staff" });
    assert.equal(out.seasoning[0].logo_path, "/assets/lenders/chase.png");
    assert.equal(out.can_override, true);
    assert.equal(out.odds.length, 0);
  });
  test("a client view cannot override; a sample report is flagged", () => {
    const out = buildApplyGate({ today: TODAY, fundability: fund({ sample: true }) });
    assert.equal(out.can_override, false);
    assert.equal(out.sample, true);
    assert.equal(out.gate.status, "locked");
  });
  test("only our own lender logo files are passed through", () => {
    assert.equal(safeLogo("/assets/lenders/chase.png"), "/assets/lenders/chase.png");
    assert.equal(safeLogo("https://evil.example/x.png"), null);
    assert.equal(safeLogo("/assets/lenders/../x.png"), null);
  });
});

describe("the reads carry org and client on every query", () => {
  function recorder(rowsFor = () => []) {
    const seen = [];
    return {
      seen,
      query: async (sql, params) => {
        seen.push({ sql, params });
        if (/FROM blueprint_bank_relationship_todos/.test(sql)) return { rows: [{ id: "r1", bank_key: "chase", bank_name: "Chase",
          account_kind: "business", state: "done", opened_on: "2026-10-01", lender_id: null, entity_id: null }] };
        return { rows: rowsFor(sql) };
      }
    };
  }
  test("applyGate reads with the org and the client, and answers null for a client in another org", async () => {
    const db = recorder();
    const out = await applyGate(db, { orgId: "org-1", clientId: "cli-1", asOf: new Date(`${TODAY}T12:00:00Z`),
      fundability: async () => fund(), match: async (_db, a) => { assert.deepEqual(a, { orgId: "org-1", clientId: "cli-1" }); return { matches: [CHASE] }; },
      logos: async (_db, a) => { assert.equal(a.orgId, "org-1"); return a.banks.map((b) => ({ logo: b.name === "Chase" ? "/assets/lenders/chase.png" : null, logo_source: b.name === "Chase" ? "bank_book" : null })); } });
    assert.equal(out.ok, true);
    assert.equal(out.seasoning[0].milestone, "seasoned");
    assert.equal(out.seasoning[0].logo, "/assets/lenders/chase.png", "Plaid first, then the bank book: the shared lookup's answer rides on the clock");
    for (const q of db.seen) {
      assert.ok(q.params.includes("org-1"), `org missing: ${q.sql.slice(0, 60)}`);
      if (!/FROM lenders/.test(q.sql)) assert.ok(q.params.includes("cli-1"), `client missing: ${q.sql.slice(0, 60)}`);
    }
    assert.equal(await applyGate(recorder(), { orgId: "org-1", clientId: "x", fundability: async () => null }), null);
  });
  test("the approvals read takes only the bank's yes, never a demo row", () => {
    assert.match(APPROVALS_SQL, /a\.status = 'Approved'/);
    assert.match(APPROVALS_SQL, /is_demo, false\) = false/);
    assert.match(APPROVALS_SQL, /a\.org_id = \$1/);
  });
  test("before migration 577 the override read is empty, but any other failure is thrown", async () => {
    const missing = { query: async () => { const e = new Error("no table"); e.code = "42P01"; throw e; } };
    const orig = console.error;
    console.error = () => {};
    try {
      assert.deepEqual(await readOverrides(missing, { orgId: "o", clientId: "c" }), []);
    } finally { console.error = orig; }
    const broken = { query: async () => { const e = new Error("boom"); e.code = "57P01"; throw e; } };
    await assert.rejects(readOverrides(broken, { orgId: "o", clientId: "c" }), /boom/);
  });
});

describe("staff override write", () => {
  test("saves one append-only row for a bank in the book", async () => {
    const seen = [];
    const db = { query: async (sql, params) => {
      seen.push({ sql, params });
      if (/FROM lenders/.test(sql)) return { rows: [{ name: "Bank of America" }] };
      return { rows: [{ id: "ov-1", bank_key: params[2], allow_more: params[4], created_at: "now" }] };
    } };
    const out = await setApplyOverride(db, { orgId: "org-1", clientId: "cli-1", staffId: "st-1",
      input: { bank: " Bank of America ", allow_more: true, note: "Large deposit" } });
    assert.deepEqual(out, { ok: true, id: "ov-1", bank_key: "bank of america", allow_more: true });
    assert.match(seen[1].sql, /INSERT INTO apply_gate_overrides/);
    assert.deepEqual(seen[1].params, ["org-1", "cli-1", "bank of america", "Bank of America", true, "Large deposit", "st-1"]);
  });
  test("refuses a bank that is not in the book, and a missing yes/no", async () => {
    const empty = { query: async () => ({ rows: [] }) };
    assert.deepEqual(await setApplyOverride(empty, { orgId: "o", clientId: "c", input: { bank: "Made Up Bank", allow_more: true } }),
      { ok: false, error: "not_found" });
    await assert.rejects(setApplyOverride(empty, { orgId: "o", clientId: "c", input: { bank: "Chase" } }),
      (e) => e instanceof ApplyGateInputError && e.code === "allow_more_required");
    await assert.rejects(setApplyOverride(empty, { orgId: "o", clientId: "c", input: { allow_more: false } }),
      (e) => e instanceof ApplyGateInputError && e.code === "bank_required");
  });
});
